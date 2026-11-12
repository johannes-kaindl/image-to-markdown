import { describe, it, expect, vi, beforeEach } from "vitest";
import { Modal } from "obsidian";
import { askMigration, MigrationChoice } from "../src/migration_modal";
import { MigrationPlan } from "../src/fm_migration";
import { MappingChange } from "../src/fm_migration";
import { makeFakeApp } from "./__mocks__/obsidian";
import { setLang } from "../src/i18n";

const confirmMock = vi.hoisted(() => vi.fn<[unknown, unknown], Promise<boolean>>());
vi.mock("../src/vendor/kit-obsidian/confirm", () => ({ confirmAction: confirmMock }));

// Der Dialog ist das Kit-`askChoice` (obsidian-kit 0.83.0, Körper-Hook `render`); es läuft hier echt gegen den Modal-Mock.
// Modal.__last ist die Testaffordanz des Kit-Mocks: der zuletzt konstruierte Modal-Doppelgänger.
function lastModal(): { contentEl: any; titleEl: any; close: () => void } {
  return (Modal as unknown as { __last: { contentEl: any; titleEl: any; close: () => void } }).__last;
}

// Läuft rekursiv über contentEl.children und sammelt alle Nodes mit gegebener Klasse
// (kein DOM/querySelectorAll im obsidian-Mock — Muster aus tests/img_to_md_view.test.ts).
function all(el: any, cls: string): any[] {
  const out: any[] = [];
  const has = (c: any) => String(c.className ?? "").split(" ").includes(cls);
  const walk = (n: any) => (n.children ?? []).forEach((c: any) => { if (has(c)) out.push(c); walk(c); });
  walk(el); return out;
}

/** Die Knöpfe der Kit-Knopfzeile in Reihenfolge: { text, cta, klick }. */
function buttons(): { text: string; cta: boolean; click: () => void }[] {
  return all(lastModal().contentEl, "modal-button-container")[0].children.map((b: any) => ({
    text: b.__component.textValue, cta: b.__component.ctaSet, click: () => b.__component.clickCB(),
  }));
}

const plan: MigrationPlan = {
  migrations: [
    { path: "a.md", old: "---\nkind: transcript\n---\nBody unverändert.", next: "---\ntype: transcript\n---\nBody unverändert." },
  ],
  conflicts: [],
};
const changes: MappingChange[] = [{ field: "kindKey", from: "kind", to: "type" }];

function open(over: { plan?: MigrationPlan; changes?: MappingChange[] } = {}) {
  const result = askMigration(makeFakeApp(), over.plan ?? plan, over.changes ?? changes);
  const settled = vi.fn<[MigrationChoice], void>();
  void result.then(settled);
  return { result, settled };
}

beforeEach(() => { setLang("en"); confirmMock.mockReset(); });

describe("askMigration", () => {
  it("rendert Zusammenfassung + Mapping-Änderungen im Kopf, den Titel im Kit-Titel", () => {
    open();
    const el = lastModal().contentEl;
    expect(all(el, "img2md-migration-summary")[0].textContent).toContain("1");
    const changeLines = all(el, "img2md-migration-change");
    expect(changeLines.length).toBe(1);
    expect(changeLines[0].textContent).toContain("kind");
    expect(changeLines[0].textContent).toContain("type");
    expect(lastModal().titleEl.textContent ?? "").not.toBe("");
  });

  it("zeigt Konflikte sichtbar markiert, wenn plan.conflicts nicht leer ist", () => {
    open({ plan: { migrations: plan.migrations, conflicts: ["dup.md"] } });
    const el = lastModal().contentEl;
    expect(all(el, "img2md-migration-conflicts").length).toBe(1);
    const paths = all(el, "img2md-migration-conflict-path");
    expect(paths.length).toBe(1);
    expect(paths[0].textContent).toContain("dup.md");
  });

  it("rendert einen Read-only-Diff des Frontmatter-Blocks pro Notiz (+/- als Text) VOR der Knopfzeile", () => {
    open();
    const el = lastModal().contentEl;
    const adds = all(el, "img2md-diff-add");
    const dels = all(el, "img2md-diff-del");
    expect(dels.some((d) => d.textContent.includes("kind: transcript"))).toBe(true);
    expect(adds.some((d) => d.textContent.includes("type: transcript"))).toBe(true);
    // Body-Text (unverändert) darf NICHT im Diff-Block auftauchen — nur der Frontmatter-Block wird verglichen.
    expect(all(el, "img2md-diff")[0].textContent).not.toContain("Body unverändert");
    const klassen = el.children.map((c: any) => String(c.className));
    expect(klassen.findIndex((c: string) => c.includes("img2md-migration-body")))
      .toBeLessThan(klassen.findIndex((c: string) => c.includes("modal-button-container")));
  });

  it("die Knopfzeile: Abbrechen links, dann „Ohne Migration anwenden“, rechts „Migrieren & anwenden“ als Hauptknopf", () => {
    open();
    const b = buttons();
    expect(b.map((x) => x.text)).toEqual(["Cancel", "Apply without migrating", "Migrate & apply"]);
    expect(b.map((x) => x.cta)).toEqual([false, false, true]);
  });

  it("„Ohne Migration anwenden“ löst sofort 'apply' aus, ohne Rückfrage", async () => {
    const { result } = open();
    buttons()[1]!.click();
    await expect(result).resolves.toBe("apply");
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("„Abbrechen“ löst 'cancel' aus", async () => {
    const { result } = open();
    buttons()[0]!.click();
    await expect(result).resolves.toBe("cancel");
  });

  it("„Migrieren & anwenden“ fragt ERST über das Kit-Bestätigungs-Modal nach, löst NICHT sofort aus", async () => {
    confirmMock.mockImplementation(() => new Promise<boolean>(() => undefined));   // Frage bleibt offen
    const { settled } = open();
    buttons()[2]!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    expect(confirmMock).toHaveBeenCalledOnce();
    // Der Text nennt die Notiz-Anzahl; kein window.confirm.
    expect(JSON.stringify(confirmMock.mock.calls[0]?.[1])).toContain("1");
  });

  it("zweite Bestätigung: Bestätigen löst erst dann 'migrate' aus", async () => {
    confirmMock.mockResolvedValue(true);
    const { result } = open();
    buttons()[2]!.click();
    await expect(result).resolves.toBe("migrate");
  });

  it("zweite Bestätigung: Abbrechen dort löst 'cancel' aus (kein migrate)", async () => {
    confirmMock.mockResolvedValue(false);
    const { result } = open();
    buttons()[2]!.click();
    await expect(result).resolves.toBe("cancel");
  });

  it("Schließen ohne Entscheidung (Esc, Klick daneben) löst 'cancel' als Default aus, ohne Rückfrage", async () => {
    const { result } = open();
    lastModal().close();
    await expect(result).resolves.toBe("cancel");
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("guard: Schließen nach bereits getroffener Entscheidung biegt das Ergebnis nicht um", async () => {
    const { result } = open();
    buttons()[1]!.click();
    lastModal().close();
    await expect(result).resolves.toBe("apply");
  });
});
