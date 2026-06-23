import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import { ImgToMdState, ImgItem, partitionDoneCards, actualModel } from "./img_to_md_state";
import { t } from "./i18n";

export const VIEW_TYPE_IMGMD = "image-to-markdown-view";

export interface ImgToMdViewDeps {
  getActivePath: () => string | null;
  scan: (sourcePath: string) => Promise<ImgItem[]>;
  transcribeStream: (sourcePath: string, item: ImgItem, onContent: (t: string) => void, onReasoning: (t: string) => void, signal: AbortSignal, page?: number) => Promise<{ content: string; reasoning: string; model: string }>;
  writeTranscripts: (sourcePath: string, entries: { item: ImgItem; content: string; model: string }[]) => Promise<string[]>;
  writePdf: (sourcePath: string, raw: string, link: string, pages: { page: number; content: string; model: string }[], overwritePath?: string, embed?: boolean) => Promise<string | null>;
  ping: () => Promise<boolean>;
  listModels: () => Promise<string[]>;
  getModel: () => string;
  setModel: (m: string) => void;
  openPath: (p: string) => void;
  copyText: (t: string) => void;
}

export class ImgToMdView extends ItemView {
  private state = new ImgToMdState();
  private statusEl: HTMLElement | null = null;
  private modelSel: HTMLSelectElement | null = null;
  private modelStatusEl: HTMLElement | null = null;
  private refreshBtn: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private cardsEl: HTMLElement | null = null;
  private toggleBtn: HTMLElement | null = null;
  private runBtn: HTMLElement | null = null;
  private controller: AbortController | null = null;
  private running = false;

  constructor(leaf: WorkspaceLeaf, private deps: ImgToMdViewDeps) { super(leaf); }
  getViewType(): string { return VIEW_TYPE_IMGMD; }
  getDisplayText(): string { return "IMG → MD"; }
  getIcon(): string { return "scan-text"; }

  async onOpen(): Promise<void> {
    const c = this.contentEl; c.empty(); c.addClass("img2md-root");
    this.statusEl = c.createDiv({ cls: "img2md-status" });
    this.statusEl.addEventListener("click", () => void this.refreshStatus());
    const modelRow = c.createDiv({ cls: "img2md-model-row" });
    this.modelSel = modelRow.createEl("select", { cls: "img2md-model dropdown" });
    this.modelSel.addEventListener("change", () => this.deps.setModel(this.modelSel?.value ?? ""));
    this.modelStatusEl = modelRow.createEl("span", { cls: "img2md-model-status" });
    this.refreshBtn = modelRow.createEl("button", { cls: "img2md-model-refresh clickable-icon", attr: { "aria-label": t("view.refreshModels"), title: t("view.refreshModels") } });
    setIcon(this.refreshBtn, "refresh-cw");
    this.refreshBtn.addEventListener("click", () => void this.refreshModels(true));
    const head = c.createDiv({ cls: "img2md-head" });
    this.toggleBtn = head.createEl("button", { cls: "img2md-toggle", text: t("view.deselectAll") });
    this.toggleBtn.addEventListener("click", () => { this.state.toggleAll(); this.renderList(); });
    this.runBtn = head.createEl("button", { cls: "img2md-run mod-cta", text: t("view.transcribe") });
    this.runBtn.addEventListener("click", () => this.onRunClick());
    this.listEl = c.createDiv({ cls: "img2md-list" });
    this.cardsEl = c.createDiv({ cls: "img2md-cards" });
    const foot = c.createDiv({ cls: "img2md-foot" });
    foot.createEl("button", { cls: "img2md-all", text: t("view.createAll") }).addEventListener("click", () => void this.writeAll());
    await this.refreshStatus();
    await this.refreshModels();
    await this.rescan();
  }

  async refreshStatus(): Promise<void> {
    const el = this.statusEl; if (!el) return;
    el.setText(t("view.checking"));
    const ok = await this.deps.ping();
    el.setText(ok ? t("view.connected") : t("view.offline"));
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
      this.statusEl?.setText(t("view.modelChanged", cur));
      realigned = true;
    }
    sel.empty();
    const list = models.includes(cur) || !cur ? models : [cur, ...models];
    for (const m of list) { const o = sel.createEl("option", { text: m }); o.value = m; }
    sel.value = cur;
    this.updateModelStatus(models, cur);
    this.refreshBtn?.removeClass("is-loading");
    // Bei manuellem Refresh ohne Modellwechsel ein kurzes „N Modelle geladen" — sonst bliebe der Klick unsichtbar.
    if (userTriggered && !realigned) this.statusEl?.setText(t("view.modelsLoaded", models.length));
  }

  /** Grüner Haken neben dem Dropdown, wenn die Auswahl im Backend (/v1/models) geladen ist. */
  private updateModelStatus(models: string[], cur: string): void {
    const el = this.modelStatusEl; if (!el) return;
    el.empty();
    const loaded = !!cur && models.includes(cur);
    if (loaded) { el.addClass("is-loaded"); setIcon(el, "check"); el.setAttribute("title", t("view.modelLoaded")); }
    else { el.removeClass("is-loaded"); el.setAttribute("title", ""); }
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
    this.renderCards();
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
      if (item.embed === false) row.createEl("span", { cls: "img2md-linked", text: t("view.linked") });
      if (item.existingTranscriptPath) {
        row.createEl("span", { cls: "img2md-exists", text: t("view.transcriptExists") });
        const open = row.createEl("a", { cls: "img2md-exists-open", text: t("view.open") });
        open.addEventListener("click", () => this.deps.openPath(item.existingTranscriptPath!));
        row.setAttribute("title", t("view.overwriteHint"));
      }
    }
  }

  private renderCards(): void {
    const el = this.cardsEl; if (!el) return; el.empty();
    for (let i = 0; i < this.state.cards.length; i++) {
      const card = this.state.cards[i];
      const cardEl = el.createDiv({ cls: "img2md-card" });
      const head = card.page != null
        ? t("view.cardHeadPage", this.basename(card.item.link), card.page, card.total)
        : t("view.cardHead", card.index, card.total, this.basename(card.item.link));
      cardEl.createDiv({ cls: "img2md-card-head", text: head });
      if (card.reasoning) {
        const live = card.status === "streaming" && card.text === "";
        const det = cardEl.createEl("details", { cls: "img2md-reasoning" });
        det.open = live;
        det.createEl("summary", { cls: "img2md-reasoning-sum", text: live ? t("view.thinking") : t("view.thoughts") });
        det.createDiv({ cls: "img2md-reasoning-body", text: card.reasoning });
      }
      if (card.text) cardEl.createDiv({ cls: "img2md-text", text: card.text });
      if (card.status === "error") cardEl.createDiv({ cls: "img2md-error", text: card.error ?? t("view.error") });
      if (card.status === "written") {
        const w = cardEl.createDiv({ cls: "img2md-written", text: t("view.created", card.writtenPath ?? "") });
        w.addEventListener("click", () => { if (card.writtenPath) this.deps.openPath(card.writtenPath); });
      }
      if (card.text) {
        const actions = cardEl.createDiv({ cls: "img2md-card-actions" });
        const copyBtn = actions.createEl("button", { cls: "img2md-copy clickable-icon", attr: { "aria-label": t("view.copyTranscript") } });
        setIcon(copyBtn, "copy");
        copyBtn.addEventListener("click", () => this.deps.copyText(card.text));
        if (card.status === "done") {
          actions.createEl("button", { cls: "img2md-write", text: t("view.createNote") }).addEventListener("click", () => void this.writeOne(i));
        }
      }
    }
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
    this.renderCards();
    if (!cards.length) return;
    this.running = true; this.runBtn?.setText("Stop");
    this.controller = new AbortController();
    const signal = this.controller.signal;
    for (let i = 0; i < cards.length; i++) {
      try {
        const r = await this.deps.transcribeStream(
          path, cards[i].item,
          (t) => { this.state.appendContent(i, t); this.renderCards(); },
          (t) => { this.state.appendReasoning(i, t); this.renderCards(); },
          signal, cards[i].page,
        );
        cards[i].model = r.model;
        this.state.setDone(i);
      } catch (e) {
        if (signal.aborted) break;   // Stop gedrückt — Rest unten als „Abgebrochen" markieren
        this.state.setError(i, e instanceof Error ? e.message : String(e));
      }
      this.renderCards();
    }
    // Nach Abbruch: noch nicht verarbeitete Karten kennzeichnen.
    for (let i = 0; i < cards.length; i++) if (cards[i].status === "streaming") this.state.setError(i, t("view.aborted"));
    this.running = false; this.runBtn?.setText(t("view.transcribe"));
    this.controller = null;
    // Post-Sync: das real verwendete Modell (response.model) → Auswahl angleichen
    const actual = actualModel(this.state.cards);
    if (actual && actual !== this.deps.getModel()) {
      this.deps.setModel(actual);
      await this.refreshModels();
      // refreshModels kann im atypischen Fall (actual nicht in /v1/models) selbst auf ein anderes Modell
      // angleichen und den Hinweis setzen; den eigenen Hinweis nur überschreiben, wenn actual gewonnen hat.
      if (this.deps.getModel() === actual) this.statusEl?.setText(t("view.modelChanged", actual));
    }
    this.renderCards();
  }
  async writeOne(i: number): Promise<void> {
    const path = this.deps.getActivePath();
    const card = this.state.cards[i];
    if (!path || !card || card.status !== "done") return;
    if (card.item.kind === "pdf") {
      const g = partitionDoneCards(this.state.cards).pdfs.find(x => x.raw === card.item.raw);
      if (g) {
        const created = await this.deps.writePdf(path, g.raw, g.link, g.pages.map(p => ({ page: p.page, content: p.content.trim(), model: p.model })), g.item.existingTranscriptPath, g.item.embed);
        if (created) g.cardIndices.forEach(j => this.state.markWritten(j, created));
      }
    } else {
      const [created] = await this.deps.writeTranscripts(path, [{ item: card.item, content: card.text.trim(), model: card.model }]);
      if (created) this.state.markWritten(i, created);
    }
    this.renderCards();
    await this.rescan();
  }

  async writeAll(): Promise<void> {
    const path = this.deps.getActivePath();
    if (!path) return;
    const part = partitionDoneCards(this.state.cards);
    if (part.images.length) {
      const entries = part.images.map(x => ({ item: x.card.item, content: x.card.text.trim(), model: x.card.model }));
      const paths = await this.deps.writeTranscripts(path, entries);
      part.images.forEach((x, k) => { if (paths[k]) this.state.markWritten(x.cardIndex, paths[k]); });
    }
    for (const g of part.pdfs) {
      const created = await this.deps.writePdf(path, g.raw, g.link, g.pages.map(p => ({ page: p.page, content: p.content.trim(), model: p.model })), g.item.existingTranscriptPath, g.item.embed);
      if (created) g.cardIndices.forEach(i => this.state.markWritten(i, created));
    }
    this.renderCards();
    await this.rescan();
  }

  async onClose(): Promise<void> {
    this.controller?.abort();
    this.contentEl.removeClass("img2md-root");
  }
}
