import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import { ImgToMdState, ImgItem, PdfGroup, partitionDoneCards, actualModel } from "./img_to_md_state";
import { truncateMiddle } from "./img_to_md";
import { t } from "./i18n";
import { thinkToggleView } from "./reasoning_toggle";

export const VIEW_TYPE_IMGMD = "image-to-markdown-view";

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
  liveWas: boolean;
  autoCollapsed: boolean;
}

export interface ImgToMdViewDeps {
  getActivePath: () => string | null;
  scan: (sourcePath: string) => Promise<ImgItem[]>;
  transcribeStream: (sourcePath: string, item: ImgItem, onContent: (t: string) => void, onReasoning: (t: string) => void, signal: AbortSignal, page?: number) => Promise<{ content: string; reasoning: string; model: string }>;
  writeTranscripts: (sourcePath: string, entries: { item: ImgItem; content: string; model: string; knownBody?: string }[]) => Promise<(string | null)[]>;
  writePdf: (sourcePath: string, raw: string, link: string, pages: { page: number; content: string; model: string }[], overwritePath?: string, embed?: boolean, range?: { from: number; to: number }, knownBody?: string) => Promise<{ path: string | null; body: string | null }>;
  connectionStatus: () => Promise<{ ok: boolean; endpoint: string | null }>;
  listModels: () => Promise<string[]>;
  getModel: () => string;
  setModel: (m: string) => void;
  listPresets: () => { id: string; label: string }[];
  getPreset: () => string;
  setPreset: (id: string) => void;
  getSuppress: () => boolean;
  setSuppress: (v: boolean) => void;
  openPath: (p: string) => void;
  copyText: (t: string) => void;
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
  private toggleBtn: HTMLElement | null = null;
  private runBtn: HTMLElement | null = null;
  private retryAllBtn: HTMLElement | null = null;
  private controller: AbortController | null = null;
  private running = false;
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
    const modelRow = c.createDiv({ cls: "img2md-model-row" });
    this.modelSel = modelRow.createEl("select", { cls: "img2md-model dropdown" });
    this.modelSel.addEventListener("change", () => { this.deps.setModel(this.modelSel?.value ?? ""); this.renderThinkToggle(); });
    this.presetSel = modelRow.createEl("select", { cls: "img2md-preset dropdown" });
    for (const p of this.deps.listPresets()) { const o = this.presetSel.createEl("option", { text: p.label }); o.value = p.id; }
    this.presetSel.value = this.deps.getPreset();
    this.presetSel.addEventListener("change", () => this.deps.setPreset(this.presetSel?.value ?? "default"));
    this.modelStatusEl = modelRow.createEl("span", { cls: "img2md-model-status" });
    this.refreshBtn = modelRow.createEl("button", { cls: "img2md-model-refresh clickable-icon", attr: { "aria-label": t("view.refreshModels"), title: t("view.refreshModels") } });
    setIcon(this.refreshBtn, "refresh-cw");
    this.refreshBtn.addEventListener("click", () => void this.refreshModels(true));
    this.thinkToggleEl = modelRow.createEl("button", { cls: "img2md-think-toggle clickable-icon" });
    this.thinkToggleEl.addEventListener("click", () => {
      if (thinkToggleView(this.deps.getModel(), this.deps.getSuppress()).disabled) return;
      this.deps.setSuppress(!this.deps.getSuppress());
      this.renderThinkToggle();
    });
    const head = c.createDiv({ cls: "img2md-head" });
    this.toggleBtn = head.createEl("button", { cls: "img2md-toggle", text: t("view.deselectAll") });
    this.toggleBtn.addEventListener("click", () => { this.state.toggleAll(); this.renderList(); });
    this.runBtn = head.createEl("button", { cls: "img2md-run mod-cta", text: t("view.transcribe") });
    this.runBtn.addEventListener("click", () => this.onRunClick());
    this.listEl = c.createDiv({ cls: "img2md-list" });
    this.cardsEl = c.createDiv({ cls: "img2md-cards" });
    const foot = c.createDiv({ cls: "img2md-foot" });
    foot.createEl("button", { cls: "img2md-all", text: t("view.createAll") }).addEventListener("click", () => void this.writeAll());
    this.retryAllBtn = foot.createEl("button", { cls: "img2md-retry-all is-hidden", text: t("view.retryAllFailed") });
    this.retryAllBtn.addEventListener("click", () => void this.retryAll());
    await this.refreshStatus();
    await this.refreshModels();
    await this.rescan();
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
  }

  async rescan(): Promise<void> {
    const path = this.deps.getActivePath();
    const items = path ? await this.deps.scan(path) : [];
    this.state.setItems(items);
    this.renderList();
  }

  /** Aktive Notiz gewechselt → Karten der alten Notiz verwerfen + neu scannen. */
  async refresh(): Promise<void> {
    if (this.running) return;
    this.state.clearCards();
    this.resetCards();
    await this.rescan();
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
      if (item.existingTranscriptPath) {
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
    // Transkript-Text (lazy, inkrementell).
    if (card.text) {
      if (!refs.textEl) refs.textEl = cardEl.createDiv({ cls: "img2md-text" });
      refs.textEl.setText(card.text);
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
    // „angelegt"-Zeile (lazy, bei written).
    if (card.status === "written" && !refs.writtenEl) {
      const w = cardEl.createDiv({ cls: "img2md-written", text: t("view.created", card.writtenPath ?? "") });
      w.addEventListener("click", () => { const c = this.state.cards[i]; if (c?.writtenPath) this.deps.openPath(c.writtenPath); });
      refs.writtenEl = w;
    }
    // Aktionen (lazy, sobald Text da): Kopieren immer; „Notiz anlegen" nur bei done.
    if (card.text) {
      if (!refs.actionsEl) {
        const actions = cardEl.createDiv({ cls: "img2md-card-actions" });
        const copyBtn = actions.createEl("button", { cls: "img2md-copy clickable-icon", attr: { "aria-label": t("view.copyTranscript") } });
        setIcon(copyBtn, "copy");
        copyBtn.addEventListener("click", () => this.deps.copyText(this.state.cards[i].text));
        refs.actionsEl = actions;
      }
      // „Notiz anlegen" nur bei done UND wenn kein Lauf aktiv ist — sonst no-op'te ein Klick still,
      // solange eine Schwester-Seite (PDF) noch streamt (writePdfGroup schiebt bei pending auf).
      if (card.status === "done" && !this.running && !refs.writeBtn) {
        const wb = refs.actionsEl.createEl("button", { cls: "img2md-write" });
        const wbIcon = wb.createSpan({ cls: "img2md-write-icon" });
        setIcon(wbIcon, "file-plus");
        wb.createSpan({ cls: "img2md-write-lbl", text: t("view.createNote") });
        wb.addEventListener("click", () => void this.writeOne(i));
        refs.writeBtn = wb;
      } else if ((card.status !== "done" || this.running) && refs.writeBtn) {
        refs.actionsEl.removeChild(refs.writeBtn);
        refs.writeBtn = undefined;
      }
    }
    this.updateRetryAll();
  }

  /** Footer-Button „Fehlgeschlagene erneut" nur einblenden, wenn es Fehler-Karten gibt. */
  private updateRetryAll(): void {
    const btn = this.retryAllBtn; if (!btn) return;
    if (this.state.cards.some(c => c.status === "error")) btn.removeClass("is-hidden");
    else btn.addClass("is-hidden");
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
    this.resetCards();
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

  /** Gemeinsamer Transkriptions-Loop für run() und Retry. Bei isRetry werden die Ziel-Karten
   *  zuvor zurückgesetzt (State + DOM in-place); sonst laufen frische Karten aus startCards. */
  private async runIndices(path: string, indices: number[], isRetry: boolean): Promise<void> {
    this.running = true; this.runBtn?.setText("Stop");
    this.controller = new AbortController();
    const signal = this.controller.signal;
    for (const i of indices) {
      if (signal.aborted) break;
      if (isRetry) { this.state.resetCard(i); this.resetCardDom(i); }
      try {
        const r = await this.deps.transcribeStream(
          path, this.state.cards[i].item,
          (t) => { this.state.appendContent(i, t); this.updateCard(i); },
          (t) => { this.state.appendReasoning(i, t); this.updateCard(i); },
          signal, this.state.cards[i].page,
        );
        this.state.cards[i].model = r.model;
        this.state.setDone(i);
      } catch (e) {
        if (signal.aborted) break;   // Stop gedrückt — Rest unten als „Abgebrochen" markieren
        this.state.setError(i, e instanceof Error ? e.message : String(e));
      }
      this.updateCard(i);
    }
    // Nach Abbruch: noch laufende Karten kennzeichnen (bei Retry sind nur die Ziel-Karten betroffen).
    for (let i = 0; i < this.state.cards.length; i++) if (this.state.cards[i].status === "streaming") this.state.setError(i, t("view.aborted"));
    this.running = false; this.runBtn?.setText(t("view.transcribe"));
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
      const [created] = await this.deps.writeTranscripts(path, [{ item: card.item, content: transcript, model: card.model, knownBody }]);
      if (created) { this.sessionOwned.set(created, transcript); this.state.markWritten(i, created); }
    }
    this.updateAllCards();
    await this.rescan();
  }

  async writeAll(): Promise<void> {
    const path = this.deps.getActivePath();
    if (!path) return;
    const part = partitionDoneCards(this.state.cards);
    if (part.images.length) {
      const transcripts = part.images.map(x => x.card.text.trim());
      const entries = part.images.map((x, k) => {
        const op = x.card.item.existingTranscriptPath;
        return { item: x.card.item, content: transcripts[k], model: x.card.model, knownBody: op ? this.sessionOwned.get(op) : undefined };
      });
      const paths = await this.deps.writeTranscripts(path, entries);
      part.images.forEach((x, k) => { const p = paths[k]; if (p) { this.sessionOwned.set(p, transcripts[k]); this.state.markWritten(x.cardIndex, p); } });
    }
    for (const g of part.pdfs) await this.writePdfGroup(path, g);
    this.updateAllCards();
    await this.rescan();
  }

  async onClose(): Promise<void> {
    this.controller?.abort();
    this.cardEls = [];
    this.contentEl.removeClass("img2md-root");
  }
}
