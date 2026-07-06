// src/diff_modal.ts
import { App, Modal } from "obsidian";
import { DiffLine } from "./diff";
import { t } from "./i18n";
import { basename } from "./img_to_md";

/** Zeigt einen Zeilen-Diff alt↔neu und lässt den Override bestätigen/abbrechen.
 *  Einzige neue obsidian-abhängige Datei; DOM ausschließlich via createEl/createDiv (UI-STANDARD §2). */
export class DiffModal extends Modal {
  private decided = false;
  constructor(app: App, private path: string, private diff: DiffLine[], private onResolve: (ok: boolean) => void) {
    super(app);
  }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("img2md-diff-modal");
    contentEl.createEl("h3", { text: t("diff.modal.title", basename(this.path)) });
    const box = contentEl.createDiv({ cls: "img2md-diff" });
    for (const d of this.diff) {
      const marker = d.kind === "add" ? "+" : d.kind === "del" ? "-" : " ";
      const line = box.createDiv({ cls: `img2md-diff-line img2md-diff-${d.kind}` });
      line.createSpan({ cls: "img2md-diff-marker", text: marker });
      line.createSpan({ cls: "img2md-diff-text", text: d.text });
    }
    const btns = contentEl.createDiv({ cls: "img2md-diff-actions" });
    const cancel = btns.createEl("button", { text: t("diff.cancel") });
    cancel.addEventListener("click", () => { this.decide(false); });
    const ok = btns.createEl("button", { text: t("diff.overwrite"), cls: "mod-warning" });
    ok.addEventListener("click", () => { this.decide(true); });
  }
  private decide(ok: boolean): void { this.decided = true; this.onResolve(ok); this.close(); }
  onClose(): void { this.contentEl.empty(); if (!this.decided) this.onResolve(false); }
}
