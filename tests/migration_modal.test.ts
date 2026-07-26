import { describe, it, expect, vi } from "vitest";
import { MigrationModal, MigrationChoice } from "../src/migration_modal";
import { MigrationPlan } from "../src/fm_migration";
import { MappingChange } from "../src/fm_migration";
import { makeFakeApp } from "./__mocks__/obsidian";
import { setLang } from "../src/i18n";

// Läuft rekursiv über contentEl.children und sammelt alle Nodes mit gegebener Klasse
// (kein DOM/querySelectorAll im obsidian-Mock — Muster aus tests/img_to_md_view.test.ts).
function all(el: any, cls: string): any[] {
  const out: any[] = [];
  const has = (c: any) => String(c.className ?? "").split(" ").includes(cls);
  const walk = (n: any) => (n.children ?? []).forEach((c: any) => { if (has(c)) out.push(c); walk(c); });
  walk(el); return out;
}

const plan: MigrationPlan = {
  migrations: [
    { path: "a.md", old: "---\nkind: transcript\n---\nBody unverändert.", next: "---\ntype: transcript\n---\nBody unverändert." },
  ],
  conflicts: [],
};
const changes: MappingChange[] = [{ field: "kindKey", from: "kind", to: "type" }];

function mkModal(over: { plan?: MigrationPlan; changes?: MappingChange[] } = {}) {
  const onResolve = vi.fn<(choice: MigrationChoice) => void>();
  const modal = new MigrationModal(makeFakeApp(), over.plan ?? plan, over.changes ?? changes, onResolve);
  return { modal, onResolve };
}

describe("MigrationModal", () => {
  setLang("en");

  it("rendert Zusammenfassung + Mapping-Änderungen im Kopf", () => {
    const { modal } = mkModal();
    modal.onOpen();
    expect(all(modal.contentEl, "img2md-migration-summary")[0].textContent).toContain("1");
    const changeLines = all(modal.contentEl, "img2md-migration-change");
    expect(changeLines.length).toBe(1);
    expect(changeLines[0].textContent).toContain("kind");
    expect(changeLines[0].textContent).toContain("type");
  });

  it("zeigt Konflikte sichtbar markiert, wenn plan.conflicts nicht leer ist", () => {
    const withConflicts: MigrationPlan = { migrations: plan.migrations, conflicts: ["dup.md"] };
    const { modal } = mkModal({ plan: withConflicts });
    modal.onOpen();
    expect(all(modal.contentEl, "img2md-migration-conflicts").length).toBe(1);
    const paths = all(modal.contentEl, "img2md-migration-conflict-path");
    expect(paths.length).toBe(1);
    expect(paths[0].textContent).toContain("dup.md");
  });

  it("rendert einen Read-only-Diff des Frontmatter-Blocks pro Notiz (+/- als Text)", () => {
    const { modal } = mkModal();
    modal.onOpen();
    const adds = all(modal.contentEl, "img2md-diff-add");
    const dels = all(modal.contentEl, "img2md-diff-del");
    expect(dels.some((d) => d.textContent.includes("kind: transcript"))).toBe(true);
    expect(adds.some((d) => d.textContent.includes("type: transcript"))).toBe(true);
    // Body-Text (unverändert) darf NICHT im Diff-Block auftauchen — nur der Frontmatter-Block wird verglichen.
    const noteBox = all(modal.contentEl, "img2md-diff")[0];
    expect(noteBox.textContent).not.toContain("Body unverändert");
  });

  it("„Ohne Migration anwenden“ löst sofort onResolve('apply') aus", () => {
    const { modal, onResolve } = mkModal();
    modal.onOpen();
    all(modal.contentEl, "img2md-migration-btn-apply")[0].click();
    expect(onResolve).toHaveBeenCalledWith("apply");
    expect(onResolve).toHaveBeenCalledTimes(1);
  });

  it("„Abbrechen“ löst sofort onResolve('cancel') aus", () => {
    const { modal, onResolve } = mkModal();
    modal.onOpen();
    all(modal.contentEl, "img2md-migration-btn-cancel")[0].click();
    expect(onResolve).toHaveBeenCalledWith("cancel");
  });

  it("„Migrieren & anwenden“ zeigt ERST eine zweite Bestätigung, löst NICHT sofort aus", () => {
    const { modal, onResolve } = mkModal();
    modal.onOpen();
    all(modal.contentEl, "img2md-migration-btn-migrate")[0].click();
    expect(onResolve).not.toHaveBeenCalled();
    // Bestätigungstext mit Notiz-Anzahl sichtbar, kein window.confirm.
    expect(all(modal.contentEl, "img2md-migration-confirm-text")[0].textContent).toContain("1");
  });

  it("zweite Bestätigung: Klick auf den Bestätigen-Button löst erst dann onResolve('migrate') aus", () => {
    const { modal, onResolve } = mkModal();
    modal.onOpen();
    all(modal.contentEl, "img2md-migration-btn-migrate")[0].click();
    all(modal.contentEl, "img2md-migration-btn-confirm")[0].click();
    expect(onResolve).toHaveBeenCalledWith("migrate");
    expect(onResolve).toHaveBeenCalledTimes(1);
  });

  it("zweite Bestätigung: Abbrechen dort löst onResolve('cancel') aus (kein migrate)", () => {
    const { modal, onResolve } = mkModal();
    modal.onOpen();
    all(modal.contentEl, "img2md-migration-btn-migrate")[0].click();
    all(modal.contentEl, "img2md-migration-btn-cancel")[0].click();
    expect(onResolve).toHaveBeenCalledWith("cancel");
    expect(onResolve).toHaveBeenCalledTimes(1);
  });

  it("Schließen ohne Entscheidung (onClose) löst onResolve('cancel') als Default aus", () => {
    const { modal, onResolve } = mkModal();
    modal.onOpen();
    modal.onClose();
    expect(onResolve).toHaveBeenCalledWith("cancel");
  });

  it("guard: onClose nach bereits getroffener Entscheidung ruft onResolve nicht erneut auf", () => {
    const { modal, onResolve } = mkModal();
    modal.onOpen();
    all(modal.contentEl, "img2md-migration-btn-apply")[0].click();
    modal.onClose();
    expect(onResolve).toHaveBeenCalledTimes(1);
  });
});
