import { describe, it, expect, vi } from "vitest";
import { MigrationModal, MigrationChoice } from "../src/migration_modal";
import { MigrationPlan } from "../src/fm_migration";
import { MappingChange } from "../src/fm_migration";
import { makeFakeApp } from "./__mocks__/obsidian";
import { setLang } from "../src/i18n";

const confirmMock = vi.hoisted(() => vi.fn<[unknown, unknown], Promise<boolean>>());
vi.mock("../src/vendor/kit-obsidian/confirm", () => ({ confirmAction: confirmMock }));

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
  const onResolve = vi.fn<[MigrationChoice], void>();
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

  it("„Migrieren & anwenden“ fragt ERST über das Kit-Bestätigungs-Modal nach, löst NICHT sofort aus", async () => {
    confirmMock.mockReset();
    confirmMock.mockImplementation(() => new Promise<boolean>(() => undefined));   // Frage bleibt offen
    const { modal, onResolve } = mkModal();
    modal.onOpen();
    all(modal.contentEl, "img2md-migration-btn-migrate")[0].click();
    await Promise.resolve();
    expect(onResolve).not.toHaveBeenCalled();
    expect(confirmMock).toHaveBeenCalledOnce();
    // Der Text nennt die Notiz-Anzahl; kein window.confirm.
    expect(JSON.stringify(confirmMock.mock.calls[0]?.[1])).toContain("1");
  });

  it("zweite Bestätigung: Bestätigen löst erst dann onResolve('migrate') aus", async () => {
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
    const { modal, onResolve } = mkModal();
    modal.onOpen();
    all(modal.contentEl, "img2md-migration-btn-migrate")[0].click();
    await vi.waitFor(() => expect(onResolve).toHaveBeenCalledWith("migrate"));
    expect(onResolve).toHaveBeenCalledTimes(1);
  });

  it("zweite Bestätigung: Abbrechen dort löst onResolve('cancel') aus (kein migrate)", async () => {
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(false);
    const { modal, onResolve } = mkModal();
    modal.onOpen();
    all(modal.contentEl, "img2md-migration-btn-migrate")[0].click();
    await vi.waitFor(() => expect(onResolve).toHaveBeenCalledWith("cancel"));
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
