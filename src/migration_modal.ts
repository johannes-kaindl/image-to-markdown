// src/migration_modal.ts
import type { App } from "obsidian";
import { DiffLine, diffLines } from "./vendor/kit/diff";
import { t } from "./i18n";
import { askChoice } from "./vendor/kit-obsidian/choice-modal";
import { confirmAction } from "./vendor/kit-obsidian/confirm";
import { MigrationPlan, NotePlan, MappingChange } from "./fm_migration";

/** Frei entscheidbares Ergebnis der Migrations-Vorschau. */
export type MigrationChoice = "migrate" | "apply" | "cancel";

/** Extrahiert den Frontmatter-Block (inkl. Fences) für den read-only Diff — der Rest der
 *  Notiz (Body) bleibt bewusst unberücksichtigt (Task 7: nur die Frontmatter-Änderung zeigen). */
function frontmatterBlock(content: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---/.exec(content);
  return m ? m[0] : content;
}

function renderDiffLine(parent: HTMLElement, d: DiffLine): void {
  const marker = d.kind === "add" ? "+" : d.kind === "del" ? "-" : " ";
  const line = parent.createDiv({ cls: `img2md-diff-line img2md-diff-${d.kind}` });
  line.createSpan({ cls: "img2md-diff-marker", text: marker });
  line.createSpan({ cls: "img2md-diff-text", text: d.text });
}

function renderNote(parent: HTMLElement, note: NotePlan): void {
  const wrap = parent.createDiv({ cls: "img2md-migration-note" });
  wrap.createEl("h4", { text: note.path, cls: "img2md-migration-note-path" });
  const box = wrap.createDiv({ cls: "img2md-diff" });
  for (const d of diffLines(frontmatterBlock(note.old), frontmatterBlock(note.next))) renderDiffLine(box, d);
}

/** Körper der Migrations-Vorschau: Zusammenfassung, Mapping-Änderungen, Konflikte und je Notiz ein read-only Frontmatter-Diff.
 *  Knöpfe, Esc und Auflösung gehören dem Kit-`askChoice` (obsidian-kit 0.83.0, Körper-Hook `render`); DOM ausschließlich via
 *  createEl/createDiv (UI-STANDARD §2). */
function renderBody(contentEl: HTMLElement, plan: MigrationPlan, changes: MappingChange[]): void {
  contentEl.addClass("img2md-migration-modal");
  contentEl.createEl("p", { text: t("migration.summary", String(plan.migrations.length)), cls: "img2md-migration-summary" });

  const changesBox = contentEl.createDiv({ cls: "img2md-migration-changes" });
  for (const c of changes) changesBox.createDiv({ cls: "img2md-migration-change", text: t("migration.change", c.from, c.to) });

  if (plan.conflicts.length > 0) {
    contentEl.createEl("p", { text: t("migration.conflicts", String(plan.conflicts.length)), cls: "img2md-migration-conflicts" });
    const conflictBox = contentEl.createDiv({ cls: "img2md-migration-conflict-list" });
    for (const path of plan.conflicts) conflictBox.createDiv({ cls: "img2md-migration-conflict-path", text: `⚠ ${path}` });
  }

  const body = contentEl.createDiv({ cls: "img2md-migration-body" });
  for (const note of plan.migrations) renderNote(body, note);
}

/** Zeigt den Migrationsplan (Task 5: planMigration) vor der Ausführung. Drei Wege (migrieren+anwenden / nur anwenden / abbrechen);
 *  „Migrieren & anwenden“ verlangt eine zweite Bestätigung über das Kit-Modal `confirmAction` (kein window.confirm — blockiert die
 *  Obsidian-Event-Loop); „Abbrechen“ dort bricht wie bisher die ganze Migration ab. Esc, Klick daneben und der Abbrechen-Knopf
 *  liefern in `askChoice` `null`; hier heißt das „cancel“ — es wird nichts migriert und nichts gespeichert. */
export async function askMigration(app: App, plan: MigrationPlan, changes: MappingChange[]): Promise<MigrationChoice> {
  const choice = await askChoice<"migrate" | "apply">(app, {
    title: t("migration.title"),
    options: [
      { value: "apply", label: t("migration.applyOnly") },
      { value: "migrate", label: t("migration.migrateApply"), cta: true },
    ],
    cancelLabel: t("migration.cancel"),
    render: (contentEl) => { renderBody(contentEl, plan, changes); },
  });
  if (choice === null) return "cancel";
  if (choice === "apply") return "apply";
  const ok = await confirmAction(app, {
    title: t("migration.title"),
    message: t("migration.confirm", String(plan.migrations.length)),
    confirmLabel: t("migration.migrateApply"),
    cancelLabel: t("migration.cancel"),
  });
  return ok ? "migrate" : "cancel";
}
