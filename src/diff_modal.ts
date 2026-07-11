// src/diff_modal.ts
import { App, Modal } from "obsidian";
import { DiffLine, groupHunks, applySelection } from "./diff";
import { t } from "./i18n";
import { basename } from "./img_to_md";

/** Zeigt einen Zeilen-Diff alt↔neu mit einer Checkbox pro Hunk (Default: alle an) und liefert
 *  den gemergten Body zurück (string) — bzw. null bei Abbrechen oder wenn nichts effektiv geändert wird.
 *  Einzige neue obsidian-abhängige Datei; DOM ausschließlich via createEl/createDiv (UI-STANDARD §2). */
export class DiffModal extends Modal {
  private decided = false;
  private selected: boolean[];
  private oldBody: string;
  constructor(app: App, private path: string, private diff: DiffLine[], private onResolve: (body: string | null) => void) {
    super(app);
    this.selected = groupHunks(diff).map(() => true); // Default: alle Hunks übernehmen
    this.oldBody = applySelection(diff, groupHunks(diff).map(() => false)); // alter Body (für No-op-Vergleich)
  }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("img2md-diff-modal");
    contentEl.createEl("h3", { text: t("diff.modal.title", basename(this.path)) });
    const box = contentEl.createDiv({ cls: "img2md-diff" });
    const hunks = groupHunks(this.diff);
    let hunkIdx = 0;
    let i = 0;
    while (i < this.diff.length) {
      const d = this.diff[i];
      if (d.kind === "ctx") {
        this.renderLine(box, d);
        i++;
        continue;
      }
      // Hunk-Start: Wrapper mit Checkbox + alle zusammenhängenden add/del-Zeilen
      const k = hunkIdx++;
      const wrap = box.createDiv({ cls: "img2md-diff-hunk" });
      const cb = wrap.createEl("input", { cls: "img2md-diff-hunk-cb", type: "checkbox" });
      cb.checked = true;
      cb.setAttr("aria-label", t("diff.hunk.aria", String(k + 1)));
      cb.addEventListener("change", () => { this.selected[k] = cb.checked; wrap.toggleClass("is-off", !cb.checked); });
      const lines = wrap.createDiv({ cls: "img2md-diff-hunk-lines" });
      while (i < this.diff.length && this.diff[i].kind !== "ctx") {
        this.renderLine(lines, this.diff[i]);
        i++;
      }
    }
    void hunks; // Hunk-Zahl == hunkIdx (Konsistenzanker)
    const btns = contentEl.createDiv({ cls: "img2md-diff-actions" });
    const cancel = btns.createEl("button", { text: t("diff.cancel") });
    cancel.addEventListener("click", () => { this.finish(null); });
    const ok = btns.createEl("button", { text: t("diff.overwrite"), cls: "mod-warning" });
    ok.addEventListener("click", () => {
      const merged = applySelection(this.diff, this.selected);
      this.finish(merged === this.oldBody ? null : merged); // No-op (alle abgewählt / kein Effekt) → nicht schreiben
    });
  }
  private renderLine(parent: HTMLElement, d: DiffLine): void {
    const marker = d.kind === "add" ? "+" : d.kind === "del" ? "-" : " ";
    const line = parent.createDiv({ cls: `img2md-diff-line img2md-diff-${d.kind}` });
    line.createSpan({ cls: "img2md-diff-marker", text: marker });
    line.createSpan({ cls: "img2md-diff-text", text: d.text });
  }
  private finish(body: string | null): void { this.decided = true; this.onResolve(body); this.close(); }
  onClose(): void { this.contentEl.empty(); if (!this.decided) this.onResolve(null); }
}
