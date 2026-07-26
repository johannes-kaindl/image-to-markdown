// src/migration_modal.ts
import { App, Modal } from "obsidian";
import { DiffLine, diffLines } from "./diff";
import { t } from "./i18n";
import { MigrationPlan, NotePlan, MappingChange } from "./fm_migration";

/** Frei entscheidbares Ergebnis der Migrations-Vorschau. */
export type MigrationChoice = "migrate" | "apply" | "cancel";

/** Extrahiert den Frontmatter-Block (inkl. Fences) für den read-only Diff — der Rest der
 *  Notiz (Body) bleibt bewusst unberücksichtigt (Task 7: nur die Frontmatter-Änderung zeigen). */
function frontmatterBlock(content: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---/.exec(content);
  return m ? m[0] : content;
}

/** Zeigt den Migrationsplan (Task 5: planMigration) vor der Ausführung: Zusammenfassung,
 *  Mapping-Änderungen, Konflikte und je Notiz einen read-only Frontmatter-Diff. Drei Wege
 *  (migrieren+anwenden / nur anwenden / abbrechen); „Migrieren & anwenden“ verlangt eine
 *  zweite, modal-interne Bestätigung (kein window.confirm — blockiert die Obsidian-Event-Loop).
 *  DOM ausschließlich via createEl/createDiv (UI-STANDARD §2). */
export class MigrationModal extends Modal {
  private decided = false;
  constructor(
    app: App,
    private plan: MigrationPlan,
    private changes: MappingChange[],
    private onResolve: (choice: MigrationChoice) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.addClass("img2md-migration-modal");
    this.renderMain();
  }

  private renderMain(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: t("migration.title") });
    contentEl.createEl("p", {
      text: t("migration.summary", String(this.plan.migrations.length)),
      cls: "img2md-migration-summary",
    });

    const changesBox = contentEl.createDiv({ cls: "img2md-migration-changes" });
    this.changes.forEach((c) => {
      changesBox.createDiv({ cls: "img2md-migration-change", text: t("migration.change", c.from, c.to) });
    });

    if (this.plan.conflicts.length > 0) {
      contentEl.createEl("p", {
        text: t("migration.conflicts", String(this.plan.conflicts.length)),
        cls: "img2md-migration-conflicts",
      });
      const conflictBox = contentEl.createDiv({ cls: "img2md-migration-conflict-list" });
      this.plan.conflicts.forEach((path) => {
        conflictBox.createDiv({ cls: "img2md-migration-conflict-path", text: `⚠ ${path}` });
      });
    }

    const body = contentEl.createDiv({ cls: "img2md-migration-body" });
    this.plan.migrations.forEach((note) => this.renderNote(body, note));

    const actions = contentEl.createDiv({ cls: "img2md-diff-actions" });
    const cancel = actions.createEl("button", { text: t("migration.cancel"), cls: "img2md-migration-btn-cancel" });
    cancel.addEventListener("click", () => { this.finish("cancel"); });
    const applyOnly = actions.createEl("button", { text: t("migration.applyOnly"), cls: "img2md-migration-btn-apply" });
    applyOnly.addEventListener("click", () => { this.finish("apply"); });
    const migrate = actions.createEl("button", {
      text: t("migration.migrateApply"),
      cls: "mod-cta img2md-migration-btn-migrate",
    });
    migrate.addEventListener("click", () => { this.renderConfirm(); });
  }

  private renderNote(parent: HTMLElement, note: NotePlan): void {
    const wrap = parent.createDiv({ cls: "img2md-migration-note" });
    wrap.createEl("h4", { text: note.path, cls: "img2md-migration-note-path" });
    const box = wrap.createDiv({ cls: "img2md-diff" });
    const diff = diffLines(frontmatterBlock(note.old), frontmatterBlock(note.next));
    diff.forEach((d) => this.renderDiffLine(box, d));
  }

  private renderDiffLine(parent: HTMLElement, d: DiffLine): void {
    const marker = d.kind === "add" ? "+" : d.kind === "del" ? "-" : " ";
    const line = parent.createDiv({ cls: `img2md-diff-line img2md-diff-${d.kind}` });
    line.createSpan({ cls: "img2md-diff-marker", text: marker });
    line.createSpan({ cls: "img2md-diff-text", text: d.text });
  }

  /** Zweite Bestätigung vor dem irreversiblen Umschreiben — modal-intern, kein window.confirm. */
  private renderConfirm(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", {
      text: t("migration.confirm", String(this.plan.migrations.length)),
      cls: "img2md-migration-confirm-text",
    });
    const actions = contentEl.createDiv({ cls: "img2md-diff-actions" });
    const cancel = actions.createEl("button", { text: t("migration.cancel"), cls: "img2md-migration-btn-cancel" });
    cancel.addEventListener("click", () => { this.finish("cancel"); });
    const confirm = actions.createEl("button", {
      text: t("migration.migrateApply"),
      cls: "mod-cta img2md-migration-btn-confirm",
    });
    confirm.addEventListener("click", () => { this.finish("migrate"); });
  }

  private finish(choice: MigrationChoice): void {
    this.decided = true;
    this.onResolve(choice);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.decided) this.onResolve("cancel");
  }
}
