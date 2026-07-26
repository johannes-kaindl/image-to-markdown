import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import { ImgToMdState, ImgItem, PdfGroup, partitionDoneCards, actualModel, canRefine } from "./img_to_md_state";
import { truncateMiddle } from "./img_to_md";
import { t } from "./i18n";
import { thinkToggleView } from "./reasoning_toggle";
import { CardCache } from "./card_cache";
import { parseDescription } from "./describe";

export const VIEW_TYPE_IMGMD = "image-to-markdown-view";
export type ViewMode = "transcribe" | "describe";

/** Ob eine Karte im Beschreiben-Modus läuft: eine bereits gelaufene Karte behält ihren Modus
 *  (`card.mode` gesetzt — z. B. nach einem fehlgeschlagenen Beschreiben-Lauf, damit ein Retry
 *  auch dann richtig routet, wenn der globale Umschalter zwischenzeitlich umgesprungen ist);
 *  eine frische Karte (Modus noch unbekannt) folgt dem aktuellen globalen Modus. */
export function isDescribingCard(cardMode: "transcript" | "description" | undefined, defaultDescribing: boolean): boolean {
  if (cardMode === "description") return true;
  if (cardMode === "transcript") return false;
  return defaultDescribing;
}

interface CardRefs {
  cardEl: HTMLElement;
  headEl: HTMLElement;
  reasoningDet?: HTMLDetailsElement;
  reasoningLbl?: HTMLElement;
  reasoningBody?: HTMLElement;
  textEl?: HTMLElement;
  errorEl?: HTMLElement;
  writtenEl?: HTMLElement;
  actionsEl?: HTMLElement;
  writeBtn?: HTMLElement;
  catRow?: HTMLElement;
  categoryInput?: HTMLInputElement;
  tagsInput?: HTMLInputElement;
  refineRow?: HTMLElement;
  refineInput?: HTMLInputElement;
  refineSubmit?: HTMLButtonElement;
  refineErrEl?: HTMLElement;
  refineLog?: HTMLElement;                    // scrollbarer Verlauf-Container
  refineOrigBlock?: HTMLElement;              // Original als erster Block im Log (Text/Reasoning/Aktionen hinein verschoben)
  refineEntryEls?: { entryEl: HTMLElement; writeBtn: HTMLElement; writeLbl: HTMLElement }[];  // je Runde (Karte + „Notiz anlegen")
  refineLiveEl?: HTMLElement;                 // transienter Live-Eintrag während des Streamens
  refineLiveReasoning?: HTMLElement;          // Reasoning-Body des Live-Eintrags (im <details>)
  refineLiveVersion?: HTMLElement;            // Versionstext des Live-Eintrags
  liveWas: boolean;
  autoCollapsed: boolean;
}

export interface ImgToMdViewDeps {
  getActivePath: () => string | null;
  scan: (sourcePath: string) => Promise<ImgItem[]>;
  transcribeStream: (sourcePath: string, item: ImgItem, onContent: (t: string) => void, onReasoning: (t: string) => void, signal: AbortSignal, page?: number) => Promise<{ content: string; reasoning: string; model: string }>;
  writeTranscripts: (sourcePath: string, entries: { item: ImgItem; content: string; model: string; knownBody?: string }[]) => Promise<{ path: string | null; body: string | null }[]>;
  writePdf: (sourcePath: string, raw: string, link: string, pages: { page: number; content: string; model: string }[], overwritePath?: string, embed?: boolean, range?: { from: number; to: number }, knownBody?: string) => Promise<{ path: string | null; body: string | null }>;
  /** Modus des „Los"-Buttons (Transkribieren ⇄ Beschreiben). Rein Lauf-Typ-Steuerung — Bild-Auswahl
   *  und Karten-Rendering bleiben pro Karte an `card.mode` (aus setDone/setDescribed), nicht an diesem
   *  globalen Schalter, damit ein Moduswechsel mitten im Lauf keine bestehenden Karten umdeutet. */
  getMode: () => ViewMode;
  setMode: (m: ViewMode) => void;
  /** Wie transcribeStream, aber für den Beschreiben-Modus: liefert nur den Rohtext (`raw`) — das
   *  Parsen (CATEGORY:/TAGS:/Prosa) übernimmt die View via parseDescription. Kein page-Parameter
   *  (Beschreiben zielt auf Einzelbilder, nicht auf mehrseitige PDF-Läufe). */
  describeStream: (sourcePath: string, item: ImgItem, onContent: (t: string) => void, onReasoning: (t: string) => void, signal: AbortSignal) => Promise<{ raw: string; reasoning: string; model: string }>;
  /** Iterative Nachbesserung einer Transkript-Karte (#7): baut (in main.ts) aus base + steps +
   *  feedback das Multi-Turn-Messages-Array und streamt es text-only. Modell/Endpoint/Suppress
   *  kommen aus den Settings — die View gibt nur Verlauf + neues Feedback + Stream-Callbacks. */
  refine: (base: string, steps: { feedback: string; text: string }[], feedback: string, onContent: (t: string) => void, onReasoning: (t: string) => void, signal: AbortSignal) => Promise<{ content: string; reasoning: string; model: string }>;
  getTaxonomy: () => string[];
  writeDescriptions: (sourcePath: string, entries: { item: ImgItem; category: string | null; tags: string[]; prose: string; model: string }[]) => Promise<{ path: string | null }[]>;
  connectionStatus: () => Promise<{ ok: boolean; endpoint: string | null }>;
  listModels: () => Promise<string[]>;
  getModel: () => string;
  setModel: (m: string) => void;
  listPresets: () => { id: string; label: string }[];
  getPreset: () => string;
  setPreset: (id: string) => void;
  getSuppress: () => boolean;
  /** Ob Denkprozess-Blöcke im Nachbesserungs-Verlauf standardmäßig aufgeklappt starten. */
  getReasoningExpanded: () => boolean;
  setSuppress: (v: boolean) => void;
  openPath: (p: string) => void;
  copyText: (t: string) => void;
  cardCache: CardCache;
}

export class ImgToMdView extends ItemView {
  private state = new ImgToMdState();
  private statusEl: HTMLElement | null = null;
  private statusIconEl: HTMLElement | null = null;
  private statusLabelEl: HTMLElement | null = null;
  private modelSel: HTMLSelectElement | null = null;
  private presetSel: HTMLSelectElement | null = null;
  private modelStatusEl: HTMLElement | null = null;
  private refreshBtn: HTMLElement | null = null;
  private thinkToggleEl: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private cardsEl: HTMLElement | null = null;
  private cardEls: CardRefs[] = [];
  /** Transiente, nicht-committete Refine-Streams je Karten-Index (Live-Anzeige; card.text/refine
   *  bleiben bis zum Commit unangetastet). Trägt Feedback + Text + Reasoning der laufenden Runde. */
  private refineDrafts = new Map<number, { feedback: string; text: string; reasoning: string }>();
  /** Transiente Refine-Fehlermeldung je Karten-Index (bis zum nächsten Versuch/Erfolg). */
  private refineErrors = new Map<number, string>();
  private toggleBtn: HTMLElement | null = null;
  private modeTranscribeBtn: HTMLElement | null = null;
  private modeDescribeBtn: HTMLElement | null = null;
  private runBtn: HTMLElement | null = null;
  private allBtn: HTMLElement | null = null;
  private retryAllBtn: HTMLElement | null = null;
  private clearBtn: HTMLElement | null = null;
  private controller: AbortController | null = null;
  private running = false;
  private cardsSourcePath: string | null = null;
  /** Notizen-Pfade, die diese Session bereits selbst geschrieben hat, gemappt auf den zuletzt
   *  geschriebenen Transkript-Body — Diff-Confirm-Gate feuert beim ERSTEN Override einer aus dem
   *  Scan vorgefundenen (fremden) Notiz UND erneut, wenn der on-disk-Body inzwischen vom zuletzt
   *  geschriebenen abweicht (z.B. manueller Edit zwischen zwei Writes derselben Session). */
  private sessionOwned = new Map<string, string>();

  constructor(leaf: WorkspaceLeaf, private deps: ImgToMdViewDeps) { super(leaf); }
  getViewType(): string { return VIEW_TYPE_IMGMD; }
  getDisplayText(): string { return "IMG → MD"; }
  getIcon(): string { return "scan-text"; }

  async onOpen(): Promise<void> {
    const c = this.contentEl; c.empty(); c.addClass("img2md-root");
    this.statusEl = c.createDiv({ cls: "img2md-status" });
    this.statusIconEl = this.statusEl.createSpan({ cls: "img2md-status-icon" });
    this.statusLabelEl = this.statusEl.createSpan({ cls: "img2md-status-label" });
    this.statusEl.addEventListener("click", () => void this.refreshStatus());
    // Zeile 1: Modell (volle Breite für lange Namen) + Status + Refresh.
    const modelRow = c.createDiv({ cls: "img2md-model-row" });
    this.modelSel = modelRow.createEl("select", { cls: "img2md-model dropdown" });
    this.modelSel.addEventListener("change", () => { this.deps.setModel(this.modelSel?.value ?? ""); this.renderThinkToggle(); });
    this.modelStatusEl = modelRow.createEl("span", { cls: "img2md-model-status" });
    this.refreshBtn = modelRow.createEl("button", { cls: "img2md-model-refresh clickable-icon", attr: { "aria-label": t("view.refreshModels"), title: t("view.refreshModels") } });
    setIcon(this.refreshBtn, "refresh-cw");
    this.refreshBtn.addEventListener("click", () => void this.refreshModels(true));
    // Zeile 2: Preset + Thinking-Toggle (teilen sich die Breite → Sidebar bleibt schmal).
    const presetRow = c.createDiv({ cls: "img2md-preset-row" });
    this.presetSel = presetRow.createEl("select", { cls: "img2md-preset dropdown" });
    for (const p of this.deps.listPresets()) { const o = this.presetSel.createEl("option", { text: p.label }); o.value = p.id; }
    this.presetSel.value = this.deps.getPreset();
    this.presetSel.addEventListener("change", () => this.deps.setPreset(this.presetSel?.value ?? "default"));
    this.thinkToggleEl = presetRow.createEl("button", { cls: "img2md-think-toggle clickable-icon" });
    this.thinkToggleEl.addEventListener("click", () => {
      if (thinkToggleView(this.deps.getModel(), this.deps.getSuppress()).disabled) return;
      this.deps.setSuppress(!this.deps.getSuppress());
      this.renderThinkToggle();
    });
    // Modus-Umschalter (Segmented-Control): steuert nur den Lauf-Typ des „Los"-Buttons — Bild-Auswahl/
    // Karten bleiben unverändert, ein Wechsel mitten im Lauf ist gesperrt (this.running-Guard in setMode).
    const modeRow = c.createDiv({ cls: "img2md-mode-row" });
    this.modeTranscribeBtn = modeRow.createEl("button", { cls: "img2md-mode-btn", text: t("view.modeTranscribe") });
    this.modeTranscribeBtn.addEventListener("click", () => this.setMode("transcribe"));
    this.modeDescribeBtn = modeRow.createEl("button", { cls: "img2md-mode-btn", text: t("view.modeDescribe") });
    this.modeDescribeBtn.addEventListener("click", () => this.setMode("describe"));
    this.renderModeSwitch();
    const head = c.createDiv({ cls: "img2md-head" });
    this.toggleBtn = head.createEl("button", { cls: "img2md-toggle", text: t("view.deselectAll") });
    this.toggleBtn.addEventListener("click", () => { this.state.toggleAll(); this.renderList(); });
    this.runBtn = head.createEl("button", { cls: "img2md-run mod-cta", text: this.runLabel() });
    this.runBtn.addEventListener("click", () => this.onRunClick());
    this.listEl = c.createDiv({ cls: "img2md-list" });
    this.cardsEl = c.createDiv({ cls: "img2md-cards" });
    const foot = c.createDiv({ cls: "img2md-foot" });
    // Links: „Ergebnisse verwerfen" (grau) + „Fehlgeschlagene erneut". Rechts: farbiger CTA „Anwenden".
    this.clearBtn = foot.createEl("button", { cls: "img2md-clear is-hidden", text: t("view.clearResults") });
    this.retryAllBtn = foot.createEl("button", { cls: "img2md-retry-all is-hidden", text: t("view.retryAllFailed") });
    this.retryAllBtn.addEventListener("click", () => void this.retryAll());
    this.allBtn = foot.createEl("button", { cls: "img2md-apply mod-cta is-hidden", text: t("view.applyLatest") });
    this.allBtn.addEventListener("click", () => void this.writeAll());
    this.clearBtn.addEventListener("click", () => {
      if (this.running) return;   // während eines Laufs kein Clear (Button ist dann ohnehin verborgen)
      this.state.clearCards();
      this.resetCards();
      if (this.cardsSourcePath) this.deps.cardCache.clear(this.cardsSourcePath);
      this.updateAllCards();
    });
    await this.refreshStatus();
    await this.refreshModels();
    await this.rescan();
    this.restoreCardsFor(this.deps.getActivePath());
  }

  async refreshStatus(): Promise<void> {
    if (!this.statusEl) return;
    this.setConnState(null, null);
    const { ok, endpoint } = await this.deps.connectionStatus();
    this.setConnState(ok, endpoint);
  }

  /** Verbindungsstatus per Icon-FORM (loader / circle-check / circle-x) + Text; Farbe nur
   *  sekundär — lesbar auch bei Farbsehschwäche (WCAG 1.4.1). */
  private setConnState(state: boolean | null, endpoint: string | null): void {
    const root = this.statusEl, icon = this.statusIconEl, label = this.statusLabelEl;
    if (!root || !icon || !label) return;
    root.removeClass("is-ok"); root.removeClass("is-error"); root.removeClass("is-checking");
    if (state === null) { root.addClass("is-checking"); setIcon(icon, "loader"); label.setText(t("view.checking")); }
    else if (state) { root.addClass("is-ok"); setIcon(icon, "circle-check"); label.setText(endpoint ? t("view.connectedVia", endpoint) : t("view.connected")); }
    else { root.addClass("is-error"); setIcon(icon, "circle-x"); label.setText(t("view.offline")); }
  }

  private async refreshModels(userTriggered = false): Promise<void> {
    const sel = this.modelSel; if (!sel) return;
    this.refreshBtn?.addClass("is-loading");   // Klick-Feedback: Lade-Zustand
    let cur = this.deps.getModel();
    const models = await this.deps.listModels();
    let realigned = false;
    if (cur && models.length && !models.includes(cur)) {   // Auswahl nicht mehr geladen → angleichen
      cur = models[0];
      this.deps.setModel(cur);
      this.statusLabelEl?.setText(t("view.modelChanged", cur));
      realigned = true;
    }
    sel.empty();
    const list = models.includes(cur) || !cur ? models : [cur, ...models];
    for (const m of list) { const o = sel.createEl("option", { text: m }); o.value = m; }
    sel.value = cur;
    this.updateModelStatus(models, cur);
    this.refreshBtn?.removeClass("is-loading");
    // Bei manuellem Refresh ohne Modellwechsel ein kurzes „N Modelle geladen" — sonst bliebe der Klick unsichtbar.
    if (userTriggered && !realigned) this.statusLabelEl?.setText(t("view.modelsLoaded", models.length));
    this.renderThinkToggle();
  }

  /** Status-Icon neben dem Dropdown. Die Form (circle-check vs. circle-slash) trägt die
   *  Bedeutung, Farbe nur sekundär — lesbar auch bei Farbsehschwäche (WCAG 1.4.1). */
  private updateModelStatus(models: string[], cur: string): void {
    const el = this.modelStatusEl; if (!el) return;
    el.empty();
    const loaded = !!cur && models.includes(cur);
    if (loaded) { el.addClass("is-loaded"); setIcon(el, "circle-check"); el.setAttribute("title", t("view.modelLoaded")); }
    else { el.removeClass("is-loaded"); setIcon(el, "circle-slash"); el.setAttribute("title", t("view.modelNotLoaded")); }
  }

  /** Rendert den Thinking-Toggle aus (Modell, Suppress-Flag). brain-Icon + Zustands-Label;
   *  Bedeutung über Text + Zustand, nicht Farbe allein (WCAG 1.4.1). */
  private renderThinkToggle(): void {
    const btn = this.thinkToggleEl; if (!btn) return;
    const v = thinkToggleView(this.deps.getModel(), this.deps.getSuppress());
    btn.empty();
    const icon = btn.createSpan({ cls: "img2md-think-icon" });
    setIcon(icon, "brain");
    btn.createSpan({ cls: "img2md-think-lbl", text: t(v.labelKey) });
    btn.removeClass("is-off"); btn.removeClass("is-disabled");
    if (v.cls) btn.addClass(v.cls);
    btn.setAttribute("aria-label", t(v.labelKey));
    btn.setAttribute("title", t(v.labelKey));
    if (v.disabled) btn.setAttribute("aria-disabled", "true"); else btn.removeAttribute("aria-disabled");
  }

  /** Label des „Los"-Buttons — folgt dem aktuellen Modus (nicht dem "Stop"-Zustand während des Laufs,
   *  der wird separat in runIndices() gesetzt). */
  private runLabel(): string { return t(this.deps.getMode() === "describe" ? "view.describe" : "view.transcribe"); }

  /** Aktiv-Zustand der Modus-Buttons synchronisieren (Form + aria-pressed, nicht nur Farbe — WCAG 1.4.1). */
  private renderModeSwitch(): void {
    const mode = this.deps.getMode();
    this.modeTranscribeBtn?.toggleClass("is-active", mode === "transcribe");
    this.modeDescribeBtn?.toggleClass("is-active", mode === "describe");
    this.modeTranscribeBtn?.setAttribute("aria-pressed", String(mode === "transcribe"));
    this.modeDescribeBtn?.setAttribute("aria-pressed", String(mode === "describe"));
  }

  /** Moduswechsel: während eines Laufs gesperrt (bestehende Karten dürfen nicht umgedeutet werden).
   *  Re-rendert Button-Label + Liste (die Idempotenz-Zeile je Bild hängt vom Modus ab). */
  private setMode(m: ViewMode): void {
    if (this.running) return;
    if (this.deps.getMode() === m) return;
    this.deps.setMode(m);
    this.renderModeSwitch();
    this.runBtn?.setText(this.runLabel());
    this.renderList();
  }

  async rescan(): Promise<void> {
    const path = this.deps.getActivePath();
    const items = path ? await this.deps.scan(path) : [];
    this.state.setItems(items);
    this.renderList();
  }

  /** Aktive Notiz gewechselt → Karten der alten Notiz sichern, verwerfen + neu scannen,
   *  Karten der neuen Quelle (falls vorhanden) wiederherstellen. */
  async refresh(): Promise<void> {
    if (this.running) return;
    const path = this.deps.getActivePath();
    // active-leaf-change feuert auch bei Klicks IN der Sidebar (Leaf-Fokus) — dann ist der aktive
    // Pfad null oder unverändert. Nur bei einem ECHTEN Notizwechsel neu scannen/tauschen; sonst die
    // Karten NICHT anfassen (sonst „resettet" die Ansicht bei jedem Sidebar-Klick, weil der Cache
    // unter dem neuen Pfad — z.B. null — keinen Treffer hat und die Karten verworfen bleiben).
    if (path === null || path === this.cardsSourcePath) return;
    this.persistCards();
    this.state.clearCards();
    this.resetCards();
    this.refineErrors.clear();
    this.refineDrafts.clear();
    await this.rescan();
    this.restoreCardsFor(this.deps.getActivePath());
  }

  /** Aktuelle Karten unter ihrer Quelle im Cache sichern (No-op ohne bekannte Quelle). */
  private persistCards(): void {
    if (this.cardsSourcePath) this.deps.cardCache.save(this.cardsSourcePath, this.state.cards);
  }

  /** Gecachte Karten für `path` (falls vorhanden) übernehmen + neu rendern; merkt sich `path`
   *  in jedem Fall als aktuelle Karten-Quelle (für den nächsten persistCards-Aufruf). */
  private restoreCardsFor(path: string | null): void {
    const cached = path ? this.deps.cardCache.load(path) : undefined;
    if (cached) { this.state.cards = cached; this.resetCards(); }
    else this.updateRetryAll();   // kein Cache-Treffer → Footer-Buttons (retryAll/clear) trotzdem an leere Kartenliste angleichen
    this.cardsSourcePath = path;
  }

  private basename(link: string): string { return link.split("/").pop() ?? link; }

  private renderList(): void {
    const el = this.listEl; if (!el) return; el.empty();
    this.toggleBtn?.setText(this.state.allSelected() ? t("view.deselectAll") : t("view.selectAll"));
    if (!this.state.items.length) { el.createDiv({ cls: "img2md-empty", text: t("view.noImages") }); return; }
    for (const item of this.state.items) {
      const row = el.createDiv({ cls: "img2md-item" });
      const cb = row.createEl("input", { cls: "img2md-check" });
      cb.type = "checkbox";
      cb.checked = this.state.isSelected(item.link);
      cb.disabled = !item.supported;
      cb.addEventListener("change", () => { this.state.toggle(item.link); this.renderList(); });
      if (item.kind === "pdf") {
        const r = item.range ?? { from: 1, to: item.pageCount ?? 1 };
        const max = item.pageCount ?? 1;
        const name = row.createEl("span", { cls: "img2md-name", text: this.basename(item.link) });
        name.setAttribute("title", t("view.pdfPages", this.basename(item.link), max));
        const range = row.createEl("span", { cls: "img2md-pdf-range" });
        range.createEl("span", { cls: "img2md-pdf-lbl", text: t("view.pdfRangePrefix") });
        const from = range.createEl("input", { cls: "img2md-pdf-from" }); from.type = "number"; from.value = String(r.from);
        from.setAttribute("min", "1"); from.setAttribute("max", String(max)); from.setAttribute("aria-label", t("view.pdfRangeFrom"));
        range.createEl("span", { cls: "img2md-pdf-lbl", text: t("view.pdfRangeMid") });
        const to = range.createEl("input", { cls: "img2md-pdf-to" }); to.type = "number"; to.value = String(r.to);
        to.setAttribute("min", "1"); to.setAttribute("max", String(max)); to.setAttribute("aria-label", t("view.pdfRangeTo"));
        const clamp = () => {
          const f = Math.max(1, Math.min(max, Math.floor(Number(from.value) || 1)));
          const tt = Math.max(f, Math.min(max, Math.floor(Number(to.value) || max)));
          item.range = { from: f, to: tt }; from.value = String(f); to.value = String(tt);
        };
        from.addEventListener("change", clamp); to.addEventListener("change", clamp);
      } else {
        const label = item.supported ? this.basename(item.link) : t("view.unsupportedSuffix", this.basename(item.link));
        row.createEl("span", { cls: "img2md-name", text: label });
      }
      if (item.selfSource) row.createEl("span", { cls: "img2md-linked", text: t("view.thisFile") });
      else if (item.embed === false) row.createEl("span", { cls: "img2md-linked", text: t("view.linked") });
      // Idempotenz-Zeile: eigene Achse je Modus (Transkript vs. Beschreibung existieren unabhängig
      // voneinander — siehe findExistingTranscript/findExistingDescription).
      if (this.deps.getMode() === "describe") {
        if (item.existingDescriptionPath) {
          row.createEl("span", { cls: "img2md-exists", text: t("view.descriptionExists") });
          const open = row.createEl("a", { cls: "img2md-exists-open", text: t("view.open") });
          open.addEventListener("click", () => this.deps.openPath(item.existingDescriptionPath!));
        }
      } else if (item.existingTranscriptPath) {
        row.createEl("span", { cls: "img2md-exists", text: t("view.transcriptExists") });
        const open = row.createEl("a", { cls: "img2md-exists-open", text: t("view.open") });
        open.addEventListener("click", () => this.deps.openPath(item.existingTranscriptPath!));
        row.setAttribute("title", t("view.overwriteHint"));
      }
    }
  }

  /** Voll-Reset: einziger Ort mit empty(). Legt die Teilbäume aller Karten neu an. */
  private resetCards(): void {
    const el = this.cardsEl; if (!el) return;
    el.empty();
    this.cardEls = [];
    for (let i = 0; i < this.state.cards.length; i++) this.updateCard(i);
  }

  private updateAllCards(): void {
    for (let i = 0; i < this.state.cards.length; i++) this.updateCard(i);
    this.updateRetryAll();   // auch bei leerer Kartenliste ausführen (sonst bleibt retryAllBtn/clearBtn sichtbar hängen)
  }

  /** Idempotenter Sync EINER Karte auf ihren State: legt fehlende Knoten lazy an,
   *  aktualisiert Texte via setText. Mehrfachaufruf mit gleichem State ist ein No-op. */
  private updateCard(i: number): void {
    const el = this.cardsEl; if (!el) return;
    const card = this.state.cards[i]; if (!card) return;
    let refs = this.cardEls[i];
    if (!refs) {
      const cardEl = el.createDiv({ cls: "img2md-card" });
      const name = truncateMiddle(this.basename(card.item.link), 32);
      const head = card.page != null
        ? t("view.cardHeadPage", name, card.page, card.total)
        : t("view.cardHead", card.index, card.total, name);
      const headEl = cardEl.createDiv({ cls: "img2md-card-head", text: head });
      refs = this.cardEls[i] = { cardEl, headEl, liveWas: false, autoCollapsed: false };
    }
    const { cardEl } = refs;
    const live = card.status === "streaming" && card.text === "";
    // Reasoning-Block (lazy).
    if (card.reasoning) {
      if (!refs.reasoningDet) {
        const det = cardEl.createEl("details", { cls: "img2md-reasoning" });
        det.open = live;
        const sum = det.createEl("summary", { cls: "img2md-reasoning-sum" });
        const icon = sum.createSpan({ cls: "img2md-reasoning-icon" });
        setIcon(icon, "brain");
        const lbl = sum.createSpan({ cls: "img2md-reasoning-lbl" });
        const body = det.createDiv({ cls: "img2md-reasoning-body" });
        refs.reasoningDet = det; refs.reasoningLbl = lbl; refs.reasoningBody = body;
        refs.liveWas = live;
      }
      refs.reasoningLbl!.setText(live ? t("view.thinking") : t("view.thoughts"));
      refs.reasoningBody!.setText(card.reasoning);
      // Einmaliger Auto-Collapse beim Übergang live -> nicht-live; danach gehört .open dem User.
      if (refs.liveWas && !live && !refs.autoCollapsed) {
        refs.reasoningDet.open = false;
        refs.autoCollapsed = true;
      }
      refs.liveWas = live;
    }
    // Transkript-Text (lazy, inkrementell). Sobald ein Refine existiert oder läuft, bleibt der obere
    // Text auf der Original-Version fixiert (card.refine.base) — die gewählte Version erscheint im
    // Verlauf (syncRefineLog), nicht hier, damit ein Versionswechsel den oberen Text nicht ersetzt.
    const draft = this.refineDrafts.get(i);
    const shownText = (card.refine || draft) ? (card.refine?.base ?? card.text) : card.text;
    if (shownText) {
      if (!refs.textEl) refs.textEl = cardEl.createDiv({ cls: "img2md-text" });
      refs.textEl.setText(shownText);
    }
    // Fehlerzeile (lazy, bei error) — Meldung + Retry-Button (re-läuft genau diese Seite/Karte).
    if (card.status === "error" && !refs.errorEl) {
      const errLine = cardEl.createDiv({ cls: "img2md-error" });
      errLine.createSpan({ cls: "img2md-error-msg", text: card.error ?? t("view.error") });
      const retry = errLine.createEl("button", { cls: "img2md-retry clickable-icon", attr: { "aria-label": t("view.retry"), title: t("view.retry") } });
      setIcon(retry, "refresh-cw");
      retry.addEventListener("click", () => void this.retryOne(i));
      refs.errorEl = errLine;
    }
    // Nach einem Refine einer geschriebenen Karte (written → done) ist die „✓ created"-Zeile stale.
    if (card.status !== "written" && refs.writtenEl) { cardEl.removeChild(refs.writtenEl); refs.writtenEl = undefined; }
    // „angelegt"-Zeile (lazy, bei written).
    if (card.status === "written" && !refs.writtenEl) {
      const w = cardEl.createDiv({ cls: "img2md-written", text: t("view.created", card.writtenPath ?? "") });
      w.addEventListener("click", () => { const c = this.state.cards[i]; if (c?.writtenPath) this.deps.openPath(c.writtenPath); });
      refs.writtenEl = w;
    }
    // Kategorie/Tags-Zeile (nur Beschreiben-Karten, sobald fertig) — editierbar vor dem Speichern
    // (der „assistierte" Teil, siehe Spec §4). Spec §2 verlangt "Dropdown der Taxonomie + freie
    // Eingabe": ein Text-Input mit Taxonomie-Datalist als Vorschlag, aber frei überschreibbar — die
    // vom Modell vorgeschlagene Kategorie ist ein Vorschlag, kein Zwang.
    if (card.mode === "description" && card.status === "done") {
      if (!refs.catRow) {
        const row = cardEl.createDiv({ cls: "img2md-cat-row" });
        const dlId = `img2md-cat-dl-${i}`;
        const input = row.createEl("input", { cls: "img2md-category", attr: { list: dlId } });
        input.type = "text";
        input.setAttribute("aria-label", t("view.category"));
        const datalist = row.createEl("datalist", { cls: "img2md-category-list", attr: { id: dlId } });
        for (const cat of this.deps.getTaxonomy()) { const o = datalist.createEl("option", { text: cat }); o.value = cat; }
        input.addEventListener("change", () => { const c = this.state.cards[i]; if (c) c.category = input.value.trim() || null; });
        const tagsInput = row.createEl("input", { cls: "img2md-tags" });
        tagsInput.type = "text";
        tagsInput.setAttribute("aria-label", t("view.tags"));
        tagsInput.addEventListener("change", () => {
          const c = this.state.cards[i]; if (!c) return;
          c.tags = tagsInput.value.split(",").map(s => s.trim()).filter(Boolean);
        });
        refs.catRow = row; refs.categoryInput = input; refs.tagsInput = tagsInput;
      }
      refs.categoryInput!.value = card.category ?? "";
      refs.tagsInput!.value = (card.tags ?? []).join(", ");
    }
    if (canRefine(card)) {
      if (!refs.refineRow) {
        const row = cardEl.createDiv({ cls: "img2md-refine-row" });
        const input = row.createEl("input", { cls: "img2md-refine-input", attr: { placeholder: t("view.refinePlaceholder"), "aria-label": t("view.refine") } });
        input.type = "text";
        const submit = row.createEl("button", { cls: "img2md-refine-submit", text: t("view.refine") });
        submit.addEventListener("click", () => { const v = input.value; input.value = ""; void this.refineCard(i, v); });
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") { const v = input.value; input.value = ""; void this.refineCard(i, v); } });
        refs.refineRow = row; refs.refineInput = input; refs.refineSubmit = submit;
      }
      const locked = this.running;
      refs.refineInput!.disabled = locked;
      refs.refineSubmit!.disabled = locked;
      const err = this.refineErrors.get(i);
      if (err) {
        if (!refs.refineErrEl) refs.refineErrEl = refs.refineRow.createDiv({ cls: "img2md-refine-error" });
        refs.refineErrEl.setText(err);
      } else if (refs.refineErrEl) { refs.refineRow.removeChild(refs.refineErrEl); refs.refineErrEl = undefined; }
    }
    // Aktionen (lazy, sobald Text da): Kopieren immer; „Notiz anlegen"/„Beschreibung speichern" nur bei done.
    if (card.text) {
      if (!refs.actionsEl) {
        const actions = cardEl.createDiv({ cls: "img2md-card-actions" });
        const copyBtn = actions.createEl("button", { cls: "img2md-copy clickable-icon", attr: { "aria-label": t("view.copyTranscript") } });
        setIcon(copyBtn, "copy");
        // Der obere Block IST das Original — bei vorhandenem Verlauf kopiert/schreibt er die Basis-Version
        // (nicht card.text, das der zuletzt geschriebenen Runde folgt).
        copyBtn.addEventListener("click", () => this.deps.copyText(this.state.cards[i].refine?.base ?? this.state.cards[i].text));
        refs.actionsEl = actions;
      }
      // Schreiben nur bei done UND wenn kein Lauf aktiv ist — sonst no-op'te ein Klick still,
      // solange eine Schwester-Seite (PDF) noch streamt (writePdfGroup schiebt bei pending auf).
      if (card.status === "done" && !this.running && !refs.writeBtn) {
        const isDescription = card.mode === "description";
        const wb = refs.actionsEl.createEl("button", { cls: "img2md-write" });
        const wbIcon = wb.createSpan({ cls: "img2md-write-icon" });
        setIcon(wbIcon, "file-plus");
        // Verb create vs. update: trifft die Karte eine bestehende Notiz (Idempotenz-Treffer oder nach
        // einem eigenen Write), heißt der Button „aktualisieren" statt „anlegen". Beschreibungen kennen
        // (noch) keine Update-Semantik → bleiben bei „speichern".
        const writeLblKey = isDescription
          ? "view.saveDescription"
          : (card.item.existingTranscriptPath ? "view.updateNote" : "view.createNote");
        wb.createSpan({ cls: "img2md-write-lbl", text: t(writeLblKey) });
        wb.addEventListener("click", () => {
          const c = this.state.cards[i];
          if (!isDescription && c.refine) this.state.selectRefineVersion(i, 0);   // Original schreiben (Basis)
          void (isDescription ? this.writeDescriptionOne(i) : this.writeOne(i));
        });
        refs.writeBtn = wb;
      } else if ((card.status !== "done" || this.running) && refs.writeBtn) {
        refs.actionsEl.removeChild(refs.writeBtn);
        refs.writeBtn = undefined;
      }
    }
    // Verlauf zuletzt — dann existieren alle Original-Elemente (Text/Reasoning/Aktionen) und können in
    // den scrollbaren Log verschoben werden, damit die Ursprungstranskription gleichwertig mitscrollt.
    this.syncRefineLog(i, refs, cardEl);
    this.updateRetryAll();
  }

  /** Text einer Version: 0 = Original (base), k = rounds[k-1]. */
  private versionText(i: number, versionIdx: number): string {
    const c = this.state.cards[i]; const r = c?.refine;
    if (!r) return c?.text ?? "";
    return versionIdx === 0 ? r.base : (r.rounds[versionIdx - 1]?.text ?? "");
  }

  /** Baut eine [Kopieren][Notiz anlegen]-Aktionszeile für eine Version (0 = Original, k = Runde k) —
   *  identisch zur Ursprungstranskription. „Notiz anlegen" wählt die Version (spiegelt card.text) und
   *  schreibt sie; Kopieren kopiert genau diese Version. Label + Sichtbarkeit werden pro Render gepflegt. */
  private addVersionActions(host: HTMLElement, i: number, versionIdx: number): { writeBtn: HTMLElement; writeLbl: HTMLElement } {
    const actions = host.createDiv({ cls: "img2md-card-actions" });
    const copyBtn = actions.createEl("button", { cls: "img2md-copy clickable-icon", attr: { "aria-label": t("view.copyTranscript") } });
    setIcon(copyBtn, "copy");
    copyBtn.addEventListener("click", () => this.deps.copyText(this.versionText(i, versionIdx)));
    const wb = actions.createEl("button", { cls: "img2md-write" });
    setIcon(wb.createSpan({ cls: "img2md-write-icon" }), "file-plus");
    const writeLbl = wb.createSpan({ cls: "img2md-write-lbl" });
    wb.addEventListener("click", () => { this.state.selectRefineVersion(i, versionIdx); void this.writeOne(i); });
    return { writeBtn: wb, writeLbl };
  }

  /** Rendert/aktualisiert den Nachbesserungs-Verlauf inkrementell: je committete Runde eine Karte
   *  (Feedback-Kopf, Thinking-<details>, Versionstext, [Kopieren][Notiz anlegen] — gleicher Aufbau
   *  wie das Original oben), plus einen transienten Live-Eintrag beim Streamen. Auto-Scroll (stick-
   *  to-bottom), solange der Nutzer nicht selbst hochgescrollt hat. */
  private syncRefineLog(i: number, refs: CardRefs, cardEl: HTMLElement): void {
    const card = this.state.cards[i];
    const draft = this.refineDrafts.get(i);
    const rounds = card.refine?.rounds ?? [];
    // Verlauf nur bei Transkript-Karten mit ≥1 Runde ODER laufender Nachbesserung.
    if (card.mode === "description" || (!card.refine && !draft)) {
      // Kein Verlauf (mehr) — einen zuvor angelegten Container vollständig abräumen, sonst bleibt nach
      // einem fehlgeschlagenen/abgebrochenen ERSTEN Refine ein Geister-Live-Eintrag im DOM hängen.
      if (refs.refineLog) {
        // Teardown greift nur ohne committete Runde (card.refine falsy) — dann wurde der Original-Block
        // nie angelegt (er entsteht erst bei card.refine), die Original-Elemente liegen also noch
        // top-level und überleben. refineOrigBlock ist hier immer undefined; defensiv trotzdem genullt.
        cardEl.removeChild(refs.refineLog);
        refs.refineLog = undefined; refs.refineEntryEls = undefined; refs.refineOrigBlock = undefined;
        refs.refineLiveEl = undefined; refs.refineLiveReasoning = undefined; refs.refineLiveVersion = undefined;
      }
      return;
    }

    if (!refs.refineLog) {
      const log = cardEl.createDiv({ cls: "img2md-refine-log" });
      refs.refineLog = log; refs.refineEntryEls = [];
      // Eingabefeld unter den Verlauf schieben (Chat-Stil: Eingabe immer unten). Einmalig beim Anlegen
      // des Logs — nicht bei jedem Render (sonst Fokusverlust beim Tippen); move via remove+append.
      if (refs.refineRow) { cardEl.removeChild(refs.refineRow); cardEl.appendChild(refs.refineRow); }
    }
    const log = refs.refineLog;
    const entries = refs.refineEntryEls!;

    // Original als ERSTEN, gleichwertigen Block IN den scrollbaren Verlauf ziehen — erst nachdem eine
    // Runde committet ist (card.refine gesetzt), NICHT während des Streamens: schlägt der erste Refine
    // fehl, wird der Log abgeräumt und die noch top-level liegenden Original-Elemente bleiben erhalten.
    // Vorhandene Elemente werden wiederverwendet (kein Neubau/kein Doppel). Einmalig via !refineOrigBlock.
    if (card.refine && !refs.refineOrigBlock) {
      const orig = log.createDiv({ cls: "img2md-refine-round img2md-refine-orig" });
      orig.createDiv({ cls: "img2md-refine-round-head", text: t("view.refineOriginal") });
      if (refs.reasoningDet) { cardEl.removeChild(refs.reasoningDet); orig.appendChild(refs.reasoningDet); }
      if (refs.textEl) { cardEl.removeChild(refs.textEl); orig.appendChild(refs.textEl); }
      if (refs.actionsEl) { cardEl.removeChild(refs.actionsEl); orig.appendChild(refs.actionsEl); }
      refs.refineOrigBlock = orig;
    }

    // Committete Runden inkrementell als abgegrenzte Karten anhängen — je Runde derselbe Aufbau wie das
    // Original oben: Titel, aufklappbarer Denkprozess, Versionstext, [Kopieren][Notiz anlegen].
    for (let k = entries.length; k < rounds.length; k++) {
      const r = rounds[k];
      const round = log.createDiv({ cls: "img2md-refine-round" });
      round.createDiv({ cls: "img2md-refine-round-head", text: t("view.refineYou", r.feedback) });
      if (r.reasoning.trim()) {
        const det = round.createEl("details", { cls: "img2md-reasoning" });
        det.open = this.deps.getReasoningExpanded();
        const sum = det.createEl("summary", { cls: "img2md-reasoning-sum" });
        setIcon(sum.createSpan({ cls: "img2md-reasoning-icon" }), "brain");
        sum.createSpan({ cls: "img2md-reasoning-lbl", text: t("view.thoughts") });
        det.createDiv({ cls: "img2md-reasoning-body" }).setText(r.reasoning);
      }
      round.createDiv({ cls: "img2md-refine-version", text: r.text });
      const { writeBtn, writeLbl } = this.addVersionActions(round, i, k + 1);   // Runde k → Version k+1
      entries.push({ entryEl: round, writeBtn, writeLbl });
    }

    // Pro Render: „Notiz anlegen" je Runde nur bei done (kein Lauf) sichtbar; Label create vs. update.
    const writable = card.status === "done" && !this.running;
    entries.forEach((e) => {
      e.writeBtn.toggleClass("is-hidden", !writable);
      e.writeLbl.setText(t(card.item.existingTranscriptPath ? "view.updateNote" : "view.createNote"));
    });

    // Live-Eintrag (transient) während des Streamens — Denkprozess als aufklappbarer Block, beim Denken offen.
    if (draft) {
      if (!refs.refineLiveEl) {
        const live = log.createDiv({ cls: "img2md-refine-round img2md-refine-live" });
        live.createDiv({ cls: "img2md-refine-round-head", text: t("view.refineYou", draft.feedback) });
        const det = live.createEl("details", { cls: "img2md-reasoning" });
        det.open = true;
        const sum = det.createEl("summary", { cls: "img2md-reasoning-sum" });
        setIcon(sum.createSpan({ cls: "img2md-reasoning-icon" }), "brain");
        sum.createSpan({ cls: "img2md-reasoning-lbl", text: t("view.thinking") });
        refs.refineLiveReasoning = det.createDiv({ cls: "img2md-reasoning-body" });
        refs.refineLiveVersion = live.createDiv({ cls: "img2md-refine-version" });
        refs.refineLiveEl = live;
      }
      refs.refineLiveReasoning?.setText(draft.reasoning);
      refs.refineLiveVersion?.setText(draft.text);
    } else if (refs.refineLiveEl) {
      log.removeChild(refs.refineLiveEl);
      refs.refineLiveEl = undefined; refs.refineLiveReasoning = undefined; refs.refineLiveVersion = undefined;
    }

    // Stick-to-bottom: nur nachziehen, wenn der Nutzer ohnehin (fast) unten steht.
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
    if (draft && nearBottom) log.scrollTop = log.scrollHeight;
  }

  /** Footer-Button „Fehlgeschlagene erneut" nur einblenden, wenn es Fehler-Karten gibt. */
  private updateRetryAll(): void {
    // „Anwenden" (CTA rechts) sichtbar, sobald es mind. eine fertige Karte gibt — schreibt die jeweils
    // aktuellste Version (card.text) aller fertigen Karten. Die granulare Auswahl bleibt pro Version.
    const doneCount = this.state.cards.filter(c => c.status === "done").length;
    this.allBtn?.toggleClass("is-hidden", doneCount < 1 || this.running);
    const btn = this.retryAllBtn; if (!btn) return;
    if (this.state.cards.some(c => c.status === "error")) btn.removeClass("is-hidden");
    else btn.addClass("is-hidden");
    this.clearBtn?.toggleClass("is-hidden", this.state.cards.length === 0 || this.running);
  }

  /** Baut die DOM einer Karte für einen Retry frisch auf (an gleicher Stelle): verwirft alte
   *  Knoten/Refs, legt nur den Kopf neu an; updateCard füllt den Rest beim Streamen. */
  private resetCardDom(i: number): void {
    const refs = this.cardEls[i];
    const card = this.state.cards[i];
    if (!refs || !card) { this.updateCard(i); return; }
    refs.cardEl.empty();
    const name = truncateMiddle(this.basename(card.item.link), 32);
    const head = card.page != null
      ? t("view.cardHeadPage", name, card.page, card.total)
      : t("view.cardHead", card.index, card.total, name);
    const headEl = refs.cardEl.createDiv({ cls: "img2md-card-head", text: head });
    this.cardEls[i] = { cardEl: refs.cardEl, headEl, liveWas: false, autoCollapsed: false };
    this.updateCard(i);
  }

  private onRunClick(): void {
    if (this.running) { this.controller?.abort(); return; }
    void this.run();
  }

  async run(): Promise<void> {
    if (this.running) return;
    const path = this.deps.getActivePath();
    if (!path) return;
    const cards = this.state.startCards();
    this.cardsSourcePath = path;
    this.resetCards();
    this.updateRetryAll();   // Footer-Sichtbarkeit auch im Leer-Fall (nichts ausgewählt) synchron halten
    if (!cards.length) return;
    await this.runIndices(path, cards.map((_, i) => i), false);
  }

  /** Re-läuft genau eine fehlgeschlagene Karte (per-Karte „Retry"). */
  async retryOne(i: number): Promise<void> {
    if (this.running) return;
    const path = this.deps.getActivePath();
    const card = this.state.cards[i];
    if (!path || !card || card.status !== "error") return;
    await this.runIndices(path, [i], true);
  }

  /** Re-läuft alle fehlgeschlagenen Karten („Fehlgeschlagene erneut"). */
  async retryAll(): Promise<void> {
    if (this.running) return;
    const path = this.deps.getActivePath();
    if (!path) return;
    const idx = this.state.failedCardIndices();
    if (!idx.length) return;
    await this.runIndices(path, idx, true);
  }

  /** Nachbessern einer Transkript-Karte (#7): streamt die neue Version in einen Draft (card.text
   *  bleibt bis zum Commit die alte Version), committet nur bei nicht-leerem Erfolg. Bei Fehler
   *  bleibt die aktuelle Version intakt; die Meldung erscheint transient an der Karte. */
  async refineCard(i: number, feedback: string): Promise<void> {
    if (this.running) return;
    const card = this.state.cards[i];
    if (!card || !canRefine(card)) return;
    const fb = feedback.trim();
    if (!fb) return;
    this.refineErrors.delete(i);
    this.running = true; this.runBtn?.setText("Stop");
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const base = card.refine?.base ?? card.text;
    const rounds = (card.refine?.rounds ?? []).map(r => ({ feedback: r.feedback, text: r.text }));
    this.refineDrafts.set(i, { feedback: fb, text: "", reasoning: "" });
    this.updateAllCards();
    try {
      const r = await this.deps.refine(
        base, rounds, fb,
        (t) => { const d = this.refineDrafts.get(i); if (d) { d.text += t; this.updateCard(i); } },
        (t) => { const d = this.refineDrafts.get(i); if (d) { d.reasoning += t; this.updateCard(i); } },
        signal,
      );
      if (!signal.aborted) {
        if (r.content.trim()) { card.model = r.model; this.state.commitRefineRound(i, fb, r.content, r.reasoning); }
        else this.refineErrors.set(i, t("view.refineEmpty"));
      }
    } catch (e) {
      if (!signal.aborted) this.refineErrors.set(i, e instanceof Error ? e.message : String(e));
    } finally {
      this.refineDrafts.delete(i);
      this.running = false; this.runBtn?.setText(this.runLabel());
      this.controller = null;
      this.updateAllCards();
    }
  }

  /** Gemeinsamer Lauf-Loop für run() und Retry — verzweigt je aktuellem Modus zwischen Transkribieren
   *  (transcribeStream → setDone) und Beschreiben (describeStream → parseDescription → setDescribed).
   *  Bei isRetry werden die Ziel-Karten zuvor zurückgesetzt (State + DOM in-place); sonst laufen
   *  frische Karten aus startCards. */
  private async runIndices(path: string, indices: number[], isRetry: boolean): Promise<void> {
    this.running = true; this.runBtn?.setText("Stop");
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const defaultDescribing = this.deps.getMode() === "describe";
    for (const i of indices) {
      if (signal.aborted) break;
      if (isRetry) { this.state.resetCard(i); this.resetCardDom(i); }
      const card = this.state.cards[i];
      const describing = isDescribingCard(card.mode, defaultDescribing);
      try {
        if (describing) {
          card.mode = "description";   // vor dem Await setzen: auch der Fehlerpfad kennt so die Absicht (Retry-Routing)
          const r = await this.deps.describeStream(
            path, card.item,
            (t) => { this.state.appendContent(i, t); this.updateCard(i); },
            (t) => { this.state.appendReasoning(i, t); this.updateCard(i); },
            signal,
          );
          const parsed = parseDescription(r.raw, this.deps.getTaxonomy());
          this.state.setDescribed(i, parsed, r.model);
        } else {
          card.mode = "transcript";
          const r = await this.deps.transcribeStream(
            path, card.item,
            (t) => { this.state.appendContent(i, t); this.updateCard(i); },
            (t) => { this.state.appendReasoning(i, t); this.updateCard(i); },
            signal, card.page,
          );
          card.model = r.model;
          this.state.setDone(i);
        }
      } catch (e) {
        if (signal.aborted) break;   // Stop gedrückt — Rest unten als „Abgebrochen" markieren
        this.state.setError(i, e instanceof Error ? e.message : String(e));
      }
      this.updateCard(i);
    }
    // Nach Abbruch: noch laufende Karten kennzeichnen (bei Retry sind nur die Ziel-Karten betroffen).
    for (let i = 0; i < this.state.cards.length; i++) if (this.state.cards[i].status === "streaming") this.state.setError(i, t("view.aborted"));
    this.running = false; this.runBtn?.setText(this.runLabel());
    this.controller = null;
    // Post-Sync: das real verwendete Modell (response.model) → Auswahl angleichen
    const actual = actualModel(this.state.cards);
    if (actual && actual !== this.deps.getModel()) {
      this.deps.setModel(actual);
      await this.refreshModels();
      // refreshModels kann im atypischen Fall (actual nicht in /v1/models) selbst auf ein anderes Modell
      // angleichen und den Hinweis setzen; den eigenen Hinweis nur überschreiben, wenn actual gewonnen hat.
      if (this.deps.getModel() === actual) this.statusLabelEl?.setText(t("view.modelChanged", actual));
    }
    this.updateAllCards();
  }
  /** Schreibt EINE PDF-Gruppe als zusammengeführte Notiz — ehrlich (gewählte Range + sichtbare
   *  Platzhalter für fehlgeschlagene Seiten). Setzt nach dem ersten Anlegen existingTranscriptPath,
   *  damit Folge-Writes (z.B. nach Retry) dieselbe Notiz überschreiben statt zu duplizieren. Markiert
   *  Karten nur „angelegt", wenn vollständig — bei offenen Fehlern bleiben done-Karten „done", damit
   *  ein späterer kompletter Override sie via Partition wieder einbezieht. */
  private async writePdfGroup(path: string, g: PdfGroup): Promise<void> {
    if (g.pending || !g.pages.length) return;
    const op = g.item.existingTranscriptPath;
    const knownBody = op ? this.sessionOwned.get(op) : undefined;
    const { path: created, body } = await this.deps.writePdf(
      path, g.raw, g.link,
      g.pages.map(p => ({ page: p.page, content: p.content.trim(), model: p.model })),
      g.item.existingTranscriptPath, g.item.embed, g.range, knownBody,
    );
    if (!created || body === null) return;
    this.sessionOwned.set(created, body);
    if (!g.item.existingTranscriptPath) g.item.existingTranscriptPath = created;
    if (!g.failedPages.length) g.cardIndices.forEach(j => this.state.markWritten(j, created));
  }

  async writeOne(i: number): Promise<void> {
    const path = this.deps.getActivePath();
    const card = this.state.cards[i];
    if (!path || !card || card.status !== "done") return;
    if (card.item.kind === "pdf") {
      const g = partitionDoneCards(this.state.cards).pdfs.find(x => x.raw === card.item.raw);
      if (g) await this.writePdfGroup(path, g);
    } else {
      const op = card.item.existingTranscriptPath;
      const knownBody = op ? this.sessionOwned.get(op) : undefined;
      const transcript = card.text.trim();
      const [res] = await this.deps.writeTranscripts(path, [{ item: card.item, content: transcript, model: card.model, knownBody }]);
      if (res?.path) {
        this.sessionOwned.set(res.path, res.body ?? transcript);
        if (!card.item.existingTranscriptPath) card.item.existingTranscriptPath = res.path;
        this.state.markWritten(i, res.path);
      }
    }
    this.updateAllCards();
    await this.rescan();
  }

  /** Speichert EINE fertige Beschreiben-Karte als Beschreibungs-Notiz (embed-frei, kein Diff-Gate —
   *  Beschreibungen sind regenerierbarer Maschinen-Output, siehe Spec „außerhalb Scope"). */
  async writeDescriptionOne(i: number): Promise<void> {
    const path = this.deps.getActivePath();
    const card = this.state.cards[i];
    if (!path || !card || card.status !== "done" || card.mode !== "description") return;
    const [res] = await this.deps.writeDescriptions(path, [{ item: card.item, category: card.category ?? null, tags: card.tags ?? [], prose: card.text, model: card.model }]);
    if (res?.path) this.state.markWritten(i, res.path);
    this.updateAllCards();
    await this.rescan();
  }

  async writeAll(): Promise<void> {
    const path = this.deps.getActivePath();
    if (!path) return;
    // Beschreiben-Karten: eigener Pfad (writeDescriptions), getrennt von partitionDoneCards
    // (die schließt mode==="description" bewusst aus — kein Transkript-Merge für Beschreibungen).
    const descIdx = this.state.cards.map((c, k) => ({ c, k })).filter(x => x.c.status === "done" && x.c.mode === "description");
    if (descIdx.length) {
      const entries = descIdx.map(x => ({ item: x.c.item, category: x.c.category ?? null, tags: x.c.tags ?? [], prose: x.c.text, model: x.c.model }));
      const results = await this.deps.writeDescriptions(path, entries);
      descIdx.forEach((x, n) => { const r = results[n]; if (r?.path) this.state.markWritten(x.k, r.path); });
    }
    const part = partitionDoneCards(this.state.cards);
    if (part.images.length) {
      const transcripts = part.images.map(x => x.card.text.trim());
      const entries = part.images.map((x, k) => {
        const op = x.card.item.existingTranscriptPath;
        return { item: x.card.item, content: transcripts[k], model: x.card.model, knownBody: op ? this.sessionOwned.get(op) : undefined };
      });
      const results = await this.deps.writeTranscripts(path, entries);
      part.images.forEach((x, k) => {
        const r = results[k];
        if (r?.path) {
          this.sessionOwned.set(r.path, r.body ?? transcripts[k]);
          if (!x.card.item.existingTranscriptPath) x.card.item.existingTranscriptPath = r.path;
          this.state.markWritten(x.cardIndex, r.path);
        }
      });
    }
    for (const g of part.pdfs) await this.writePdfGroup(path, g);
    this.updateAllCards();
    await this.rescan();
  }

  async onClose(): Promise<void> {
    this.persistCards();
    this.controller?.abort();
    this.cardEls = [];
    this.contentEl.removeClass("img2md-root");
  }
}
