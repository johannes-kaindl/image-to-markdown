# Frontmatter-Mapping-Migration (Phase 1b) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Beim nachträglichen Ändern eines Frontmatter-Mappings die Keys/Werte in bestehenden i2m-Notizen sicher umschreiben — mit Diff-Vorschau, doppelter Bestätigung, best-effort + idempotent.

**Architecture:** Reiner, obsidian-freier Kern `src/fm_migration.ts` (Mapping-Diff, i2m-Fingerabdruck, Ein-Durchgang-Frontmatter-Umschrift mit Kollisions-Schutz, Vault-Plan) — voll unit-getestet. Dünne Obsidian-Schicht: Migrations-Modal (`src/migration_modal.ts`, Diff-Reuse) + Vault-Sweep/Schreiben (`main.ts`) + blur-Commit-Umbau der FM-Felder (`settings.ts`).

**Tech Stack:** TypeScript (strict), vitest + happy-dom, esbuild, Obsidian Plugin API. Diff-Reuse aus `src/diff.ts`.

**Spec:** `docs/superpowers/specs/2026-07-26-frontmatter-mapping-migration-design.md`

## Global Constraints

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen.
- **Reiner Kern ohne obsidian-Imports** — `fm_migration.ts` importiert nur `./frontmatter_map` (PROF-OBS-03/04). Nur `migration_modal.ts`, `main.ts`, `settings.ts` importieren `obsidian`.
- **Nach jeder Task alle Tests grün** (`npm test`) + `npx tsc --noEmit` separat + `npm run lint` sauber.
- **CRLF-Fidelity:** bestehende Zeilenenden erhalten — die Migration ersetzt nur geänderte Key-Zeilen, sie baut die Notiz nicht neu (anders als `rewriteTranscript`, das bewusst mit `\n` neu aufbaut).
- **Fremde Frontmatter-Keys + Body bleiben zeichengenau erhalten.**
- **i18n:** alle nutzersichtbaren Strings via `t()` aus `i18n.ts`, EN kanonisch + DE. EN/DE-Paritätstest grün halten.
- **Commits:** Conventional Commits, deutsche Beschreibung erlaubt, nur berührte Dateien stagen. Trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

- **Create `src/fm_migration.ts`** — reiner Kern: `MappingChange`, `diffMappings`, `isI2mNote`, `MigrationResult`, `migrateNoteFrontmatter`, `NotePlan`/`MigrationPlan`, `planMigration`. Interne Helfer `fmBlock`/`hasKey`/`lineValue`.
- **Create `tests/fm_migration.test.ts`** — Unit-Tests für alle Kern-Funktionen.
- **Create `src/migration_modal.ts`** — Obsidian-Modal: Multi-Notiz-Diff-Vorschau + Drei-Wege-Aktionen + zweite Bestätigung.
- **Modify `src/i18n.ts`** — neue EN/DE-Strings (Modal, Buttons, Bericht, Warnung, Konflikt).
- **Modify `src/settings.ts`** — FM-Felder von `onChange`-Autosave auf **blur-Commit** + Migrations-Trigger.
- **Modify `src/main.ts`** — Plugin-Methode `offerFmMigration(oldMap, newMap)`: Vault-Sweep → `planMigration` → Modal → best-effort schreiben → Bericht.

---

### Task 1: `diffMappings` — Mapping-Änderungen erkennen (rein)

**Files:**
- Create: `src/fm_migration.ts`
- Test: `tests/fm_migration.test.ts`

**Interfaces:**
- Consumes: `FrontmatterMap` aus `src/frontmatter_map.ts`.
- Produces: `type MappingChange = { field: keyof FrontmatterMap; from: string; to: string }`; `diffMappings(oldMap: FrontmatterMap, newMap: FrontmatterMap): MappingChange[]`.

- [ ] **Step 1: Failing test schreiben**

```ts
import { describe, it, expect } from "vitest";
import { diffMappings } from "../src/fm_migration";
import { DEFAULT_FM_MAP } from "../src/frontmatter_map";

describe("diffMappings", () => {
  it("leer wenn identisch", () => {
    expect(diffMappings(DEFAULT_FM_MAP, { ...DEFAULT_FM_MAP })).toEqual([]);
  });
  it("erkennt Key-Änderung", () => {
    const next = { ...DEFAULT_FM_MAP, kindKey: "type" };
    expect(diffMappings(DEFAULT_FM_MAP, next)).toEqual([{ field: "kindKey", from: "kind", to: "type" }]);
  });
  it("erkennt Wert-Änderung (kindTranscript)", () => {
    const next = { ...DEFAULT_FM_MAP, kindTranscript: "Transkript" };
    expect(diffMappings(DEFAULT_FM_MAP, next)).toEqual([{ field: "kindTranscript", from: "transcript", to: "Transkript" }]);
  });
  it("mehrere Änderungen", () => {
    const next = { ...DEFAULT_FM_MAP, kindKey: "type", created: "erstellt" };
    expect(diffMappings(DEFAULT_FM_MAP, next)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Test läuft rot**

Run: `npx vitest run tests/fm_migration.test.ts -t diffMappings`
Expected: FAIL („diffMappings is not a function" / Modul fehlt).

- [ ] **Step 3: Minimal implementieren**

```ts
import { FrontmatterMap } from "./frontmatter_map";

export type MappingChange = { field: keyof FrontmatterMap; from: string; to: string };

export function diffMappings(oldMap: FrontmatterMap, newMap: FrontmatterMap): MappingChange[] {
  const out: MappingChange[] = [];
  (Object.keys(oldMap) as (keyof FrontmatterMap)[]).forEach((field) => {
    if (oldMap[field] !== newMap[field]) out.push({ field, from: oldMap[field], to: newMap[field] });
  });
  return out;
}
```

- [ ] **Step 4: Test läuft grün**

Run: `npx vitest run tests/fm_migration.test.ts -t diffMappings`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/fm_migration.ts tests/fm_migration.test.ts
git commit -m "feat(migration): diffMappings — Mapping-Änderungen erkennen

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `isI2mNote` — i2m-Fingerabdruck (rein)

**Files:**
- Modify: `src/fm_migration.ts`
- Test: `tests/fm_migration.test.ts`

**Interfaces:**
- Produces: `isI2mNote(content: string, oldMap: FrontmatterMap): boolean`. Interne Helfer `fmBlock(content): string | null`, `hasKey(block, key): boolean`, `lineValue(block, key): string | null` (auch von Task 3 genutzt).

**Wichtig:** Pre-0.13-Transkript-Notizen haben **keine** `kind`-Zeile (der `kind`-Key kam erst mit Beschreiben-Modus, 0.13.0). Fehlt der alte `kindKey` → Notiz trotzdem als i2m behandeln (`kind === null` → `true`), sonst würden genau die alten Notizen ausgeschlossen.

- [ ] **Step 1: Failing test schreiben**

```ts
import { isI2mNote } from "../src/fm_migration";

const T = (fm: string) => `---\n${fm}\n---\n![[a.png]]\n\nBody\n`;

describe("isI2mNote", () => {
  it("Transkript-Notiz erkannt (source_image + kind: transcript)", () => {
    expect(isI2mNote(T(`source_image: "[[a.png]]"\nkind: transcript`), DEFAULT_FM_MAP)).toBe(true);
  });
  it("Beschreibungs-Notiz erkannt (source_image + kind: description)", () => {
    expect(isI2mNote(T(`source_image: "[[a.png]]"\nkind: description`), DEFAULT_FM_MAP)).toBe(true);
  });
  it("PDF-Notiz erkannt (source_pdf)", () => {
    expect(isI2mNote(T(`source_pdf: "[[a.pdf]]"\nkind: transcript`), DEFAULT_FM_MAP)).toBe(true);
  });
  it("Pre-0.13-Notiz ohne kind-Zeile erkannt", () => {
    expect(isI2mNote(T(`source_image: "[[a.png]]"\ncreated: 2026-01-01`), DEFAULT_FM_MAP)).toBe(true);
  });
  it("Fremdnotiz ohne source-Key abgelehnt", () => {
    expect(isI2mNote(T(`title: Foo\nkind: transcript`), DEFAULT_FM_MAP)).toBe(false);
  });
  it("source-Key aber fremder kind-Wert abgelehnt", () => {
    expect(isI2mNote(T(`source_image: "[[a.png]]"\nkind: note`), DEFAULT_FM_MAP)).toBe(false);
  });
  it("Notiz ohne Frontmatter abgelehnt", () => {
    expect(isI2mNote("kein FM\n![[a.png]]", DEFAULT_FM_MAP)).toBe(false);
  });
});
```

- [ ] **Step 2: Test läuft rot**

Run: `npx vitest run tests/fm_migration.test.ts -t isI2mNote`
Expected: FAIL.

- [ ] **Step 3: Implementieren**

```ts
function fmBlock(content: string): string | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  return m ? m[1] : null;
}
function kEsc(key: string): string {
  return key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function hasKey(block: string, key: string): boolean {
  return new RegExp(`^${kEsc(key)}:`, "m").test(block);
}
function lineValue(block: string, key: string): string | null {
  const m = new RegExp(`^${kEsc(key)}:[ \\t]*(.*)$`, "m").exec(block);
  return m ? m[1].trim() : null;
}

export function isI2mNote(content: string, oldMap: FrontmatterMap): boolean {
  const block = fmBlock(content);
  if (!block) return false;
  if (!hasKey(block, oldMap.sourceImage) && !hasKey(block, oldMap.sourcePdf)) return false;
  const kind = lineValue(block, oldMap.kindKey);
  if (kind === null) return true; // Pre-0.13-Notizen ohne kind-Zeile gehören uns
  return kind === oldMap.kindTranscript || kind === oldMap.kindDescription;
}
```

- [ ] **Step 4: Test läuft grün**

Run: `npx vitest run tests/fm_migration.test.ts -t isI2mNote`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/fm_migration.ts tests/fm_migration.test.ts
git commit -m "feat(migration): isI2mNote — i2m-Fingerabdruck (Pre-0.13-tolerant)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `migrateNoteFrontmatter` — Ein-Durchgang-Umschrift (rein)

**Files:**
- Modify: `src/fm_migration.ts`
- Test: `tests/fm_migration.test.ts`

**Interfaces:**
- Produces: `interface MigrationResult { changed: boolean; next: string; conflict: boolean }`; `migrateNoteFrontmatter(content: string, oldMap: FrontmatterMap, newMap: FrontmatterMap): MigrationResult`. (Kollisions-Erkennung → `conflict` folgt in Task 4; hier `conflict` immer `false`.)

**Kern-Prinzipien:** Ein einziger Durchgang über die Frontmatter-Zeilen (kein kaskadierendes Text-Replace → keine Doppelanwendung bei verketteten/getauschten Umbenennungen). CRLF pro Zeile erhalten. Nur Key-Zeilen berühren, deren Key sich ändert; die `kind`-Zeile ggf. zusätzlich im Wert. Fremde Keys + Body unverändert.

- [ ] **Step 1: Failing tests schreiben**

```ts
import { migrateNoteFrontmatter } from "../src/fm_migration";

describe("migrateNoteFrontmatter", () => {
  const base = `---\nsource_image: "[[a.png]]"\nkind: transcript\ncreated: 2026-01-01\ntranscribed_by: "m"\n---\n![[a.png]]\n\nBody\n`;

  it("benennt Key um, Rest der Zeile bleibt", () => {
    const r = migrateNoteFrontmatter(base, DEFAULT_FM_MAP, { ...DEFAULT_FM_MAP, created: "erstellt" });
    expect(r.changed).toBe(true);
    expect(r.next).toContain(`erstellt: 2026-01-01`);
    expect(r.next).not.toContain(`created:`);
  });
  it("benennt kind-Key UND -Wert auf einer Zeile um", () => {
    const r = migrateNoteFrontmatter(base, DEFAULT_FM_MAP, { ...DEFAULT_FM_MAP, kindKey: "type", kindTranscript: "Transkript" });
    expect(r.next).toContain(`type: Transkript`);
    expect(r.next).not.toMatch(/^kind:/m);
  });
  it("erhält fremde Keys + Body zeichengenau", () => {
    const withForeign = `---\nsource_image: "[[a.png]]"\nkind: transcript\naliases: [foo]\n---\n![[a.png]]\n\nBody\n`;
    const r = migrateNoteFrontmatter(withForeign, DEFAULT_FM_MAP, { ...DEFAULT_FM_MAP, kindKey: "type" });
    expect(r.next).toContain(`aliases: [foo]`);
    expect(r.next.endsWith(`![[a.png]]\n\nBody\n`)).toBe(true);
  });
  it("CRLF-Notiz behält \\r\\n", () => {
    const crlf = base.replace(/\n/g, "\r\n");
    const r = migrateNoteFrontmatter(crlf, DEFAULT_FM_MAP, { ...DEFAULT_FM_MAP, created: "erstellt" });
    expect(r.next).toContain(`erstellt: 2026-01-01\r\n`);
    expect(r.next).not.toContain(`\ncreated:`);
  });
  it("verkettete Umbenennung a→b, b→c ohne Doppelanwendung", () => {
    const note = `---\nsource_image: "[[a.png]]"\nkind: transcript\ncategory: X\ntags: Y\n---\nB\n`;
    // category→tags, tags→foo  (Kette)
    const r = migrateNoteFrontmatter(note, DEFAULT_FM_MAP, { ...DEFAULT_FM_MAP, category: "tags", tags: "foo" });
    expect(r.next).toContain(`tags: X`);   // altes category
    expect(r.next).toContain(`foo: Y`);    // altes tags
  });
  it("Idempotenz — zweimal anwenden = No-op beim 2. Mal", () => {
    const newMap = { ...DEFAULT_FM_MAP, kindKey: "type" };
    const once = migrateNoteFrontmatter(base, DEFAULT_FM_MAP, newMap).next;
    const twice = migrateNoteFrontmatter(once, DEFAULT_FM_MAP, newMap);
    expect(twice.changed).toBe(false);
    expect(twice.next).toBe(once);
  });
  it("Notiz ohne Frontmatter unverändert", () => {
    const r = migrateNoteFrontmatter("kein FM\nBody\n", DEFAULT_FM_MAP, { ...DEFAULT_FM_MAP, kindKey: "type" });
    expect(r.changed).toBe(false);
  });
});
```

- [ ] **Step 2: Test läuft rot**

Run: `npx vitest run tests/fm_migration.test.ts -t migrateNoteFrontmatter`
Expected: FAIL.

- [ ] **Step 3: Implementieren**

```ts
export interface MigrationResult { changed: boolean; next: string; conflict: boolean }

export function migrateNoteFrontmatter(content: string, oldMap: FrontmatterMap, newMap: FrontmatterMap): MigrationResult {
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(content);
  if (!m) return { changed: false, next: content, conflict: false };
  const [full, open, block, close] = m;

  // Key-Umbenennungen (die zwei reinen Wert-Felder ausgenommen).
  const rename = new Map<string, string>();
  (Object.keys(oldMap) as (keyof FrontmatterMap)[]).forEach((f) => {
    if (f === "kindTranscript" || f === "kindDescription") return;
    if (oldMap[f] !== newMap[f]) rename.set(oldMap[f], newMap[f]);
  });

  const kindValueChanged = oldMap.kindTranscript !== newMap.kindTranscript || oldMap.kindDescription !== newMap.kindDescription;
  const keyOf = (bare: string): string | null => {
    const mm = /^([^\r\n:]+):/.exec(bare);
    return mm ? mm[1] : null;
  };

  const outLines = block.split("\n").map((line) => {
    const cr = line.endsWith("\r") ? "\r" : "";
    const bare = cr ? line.slice(0, -1) : line;
    const k = keyOf(bare);
    if (k === null) return line;
    const newKey = rename.get(k) ?? k;
    let rest = bare.slice(k.length); // ":" + Wert
    if (k === oldMap.kindKey && kindValueChanged) {
      const vm = /^:[ \t]*(.*)$/.exec(rest);
      if (vm) {
        const val = vm[1].trim();
        const nv = val === oldMap.kindTranscript ? newMap.kindTranscript
                 : val === oldMap.kindDescription ? newMap.kindDescription
                 : val;
        if (nv !== val) rest = `: ${nv}`;
      }
    }
    return newKey + rest + cr;
  });

  const next = open + outLines.join("\n") + close + content.slice(full.length);
  return { changed: next !== content, next, conflict: false };
}
```

- [ ] **Step 4: Test läuft grün**

Run: `npx vitest run tests/fm_migration.test.ts -t migrateNoteFrontmatter`
Expected: PASS.

- [ ] **Step 5: `tsc` + lint + Commit**

```bash
npx tsc --noEmit && npm run lint
git add src/fm_migration.ts tests/fm_migration.test.ts
git commit -m "feat(migration): migrateNoteFrontmatter — Ein-Durchgang-Umschrift (CRLF/fremde Keys erhalten)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Kollisions-Schutz in `migrateNoteFrontmatter` (rein)

**Files:**
- Modify: `src/fm_migration.ts`
- Test: `tests/fm_migration.test.ts`

**Interfaces:**
- Ändert das Verhalten von `migrateNoteFrontmatter`: würde eine Umbenennung `oldKey→newKey` auf einen bereits vorhandenen (nicht selbst weg-umbenannten) Key treffen, oder zwei Quellen auf denselben Ziel-Key → `{ changed: false, next: content, conflict: true }`.

- [ ] **Step 1: Failing tests schreiben**

```ts
describe("migrateNoteFrontmatter — Kollision", () => {
  it("Ziel-Key existiert schon als fremder Key → conflict, unverändert", () => {
    const note = `---\nsource_image: "[[a.png]]"\nkind: transcript\ntype: manuell\n---\nB\n`;
    const r = migrateNoteFrontmatter(note, DEFAULT_FM_MAP, { ...DEFAULT_FM_MAP, kindKey: "type" });
    expect(r.conflict).toBe(true);
    expect(r.changed).toBe(false);
    expect(r.next).toBe(note);
  });
  it("Kette a→b, b→c ist KEINE Kollision (b wird weg-umbenannt)", () => {
    const note = `---\nsource_image: "[[a.png]]"\nkind: transcript\ncategory: X\ntags: Y\n---\nB\n`;
    const r = migrateNoteFrontmatter(note, DEFAULT_FM_MAP, { ...DEFAULT_FM_MAP, category: "tags", tags: "foo" });
    expect(r.conflict).toBe(false);
    expect(r.changed).toBe(true);
  });
});
```

- [ ] **Step 2: Test läuft rot**

Run: `npx vitest run tests/fm_migration.test.ts -t Kollision`
Expected: FAIL (erster Test: `conflict` ist noch `false`).

- [ ] **Step 3: Kollisions-Check ergänzen** (in `migrateNoteFrontmatter`, direkt nach dem Aufbau von `rename`, vor dem `outLines`-Mapping)

```ts
  const existingKeys = new Set<string>();
  for (const line of block.split("\n")) {
    const k = keyOf(line.endsWith("\r") ? line.slice(0, -1) : line);
    if (k) existingKeys.add(k);
  }
  const targets = new Set<string>();
  for (const [from, to] of rename) {
    if (to === from) continue;
    if (existingKeys.has(to) && !rename.has(to)) return { changed: false, next: content, conflict: true };
    if (targets.has(to)) return { changed: false, next: content, conflict: true };
    targets.add(to);
  }
```

(`keyOf` muss vor diesem Block definiert sein — ggf. die `keyOf`-Definition aus Task 3 nach oben ziehen.)

- [ ] **Step 4: Test läuft grün + volle Datei grün**

Run: `npx vitest run tests/fm_migration.test.ts`
Expected: PASS (alle).

- [ ] **Step 5: Commit**

```bash
git add src/fm_migration.ts tests/fm_migration.test.ts
git commit -m "feat(migration): Kollisions-Schutz — Ziel-Key-Konflikt überspringt Notiz

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `planMigration` — Vault-Plan (rein)

**Files:**
- Modify: `src/fm_migration.ts`
- Test: `tests/fm_migration.test.ts`

**Interfaces:**
- Produces: `interface NotePlan { path: string; old: string; next: string }`; `interface MigrationPlan { migrations: NotePlan[]; conflicts: string[] }`; `planMigration(files: { path: string; content: string }[], oldMap: FrontmatterMap, newMap: FrontmatterMap): MigrationPlan`.

- [ ] **Step 1: Failing test schreiben**

```ts
import { planMigration } from "../src/fm_migration";

describe("planMigration", () => {
  const newMap = { ...DEFAULT_FM_MAP, kindKey: "type" };
  const i2m = `---\nsource_image: "[[a.png]]"\nkind: transcript\n---\nB\n`;
  const foreign = `---\ntitle: Foo\n---\nB\n`;
  const conflict = `---\nsource_image: "[[b.png]]"\nkind: transcript\ntype: x\n---\nB\n`;

  it("nimmt nur i2m-Notizen mit Änderung auf, sammelt Konflikte, ignoriert Fremdnotizen", () => {
    const plan = planMigration(
      [{ path: "a.md", content: i2m }, { path: "f.md", content: foreign }, { path: "c.md", content: conflict }],
      DEFAULT_FM_MAP, newMap,
    );
    expect(plan.migrations.map(p => p.path)).toEqual(["a.md"]);
    expect(plan.conflicts).toEqual(["c.md"]);
  });
  it("überspringt i2m-Notizen ohne effektive Änderung", () => {
    const plan = planMigration([{ path: "a.md", content: i2m }], DEFAULT_FM_MAP, { ...DEFAULT_FM_MAP });
    expect(plan.migrations).toEqual([]);
  });
});
```

- [ ] **Step 2: Test läuft rot**

Run: `npx vitest run tests/fm_migration.test.ts -t planMigration`
Expected: FAIL.

- [ ] **Step 3: Implementieren**

```ts
export interface NotePlan { path: string; old: string; next: string }
export interface MigrationPlan { migrations: NotePlan[]; conflicts: string[] }

export function planMigration(
  files: { path: string; content: string }[],
  oldMap: FrontmatterMap,
  newMap: FrontmatterMap,
): MigrationPlan {
  const migrations: NotePlan[] = [];
  const conflicts: string[] = [];
  for (const f of files) {
    if (!isI2mNote(f.content, oldMap)) continue;
    const r = migrateNoteFrontmatter(f.content, oldMap, newMap);
    if (r.conflict) { conflicts.push(f.path); continue; }
    if (r.changed) migrations.push({ path: f.path, old: f.content, next: r.next });
  }
  return { migrations, conflicts };
}
```

- [ ] **Step 4: Test grün + `tsc`/lint**

Run: `npx vitest run tests/fm_migration.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS/clean.

- [ ] **Step 5: Commit**

```bash
git add src/fm_migration.ts tests/fm_migration.test.ts
git commit -m "feat(migration): planMigration — Vault-Plan (Migrationen + Konflikte)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: i18n-Strings (EN kanonisch + DE)

**Files:**
- Modify: `src/i18n.ts`
- Test: `tests/i18n.test.ts` (bestehender EN/DE-Paritätstest muss grün bleiben)

**Interfaces:**
- Produces (neue Keys, in `STRINGS.en` UND `STRINGS.de`):
  - `migration.title` — Modal-Titel, z. B. EN `"Migrate frontmatter keys"` / DE `"Frontmatter-Keys migrieren"`.
  - `migration.summary` — Kopf mit Zähler, `{0}` = Notizzahl. EN `"{0} notes will be updated"` / DE `"{0} Notizen werden aktualisiert"`.
  - `migration.change` — eine Key-Änderung, `{0}`→`{1}`. EN `"{0} → {1}"` / DE `"{0} → {1}"`.
  - `migration.conflicts` — `{0}` = Konfliktzahl. EN `"{0} notes skipped (key conflict)"` / DE `"{0} Notizen übersprungen (Key-Konflikt)"`.
  - `migration.migrateApply` — EN `"Migrate & apply"` / DE `"Migrieren & anwenden"`.
  - `migration.applyOnly` — EN `"Apply without migrating"` / DE `"Ohne Migration anwenden"`.
  - `migration.cancel` — EN `"Cancel"` / DE `"Abbrechen"`.
  - `migration.confirm` — zweite Bestätigung, `{0}` = Notizzahl. EN `"Rewrite {0} notes now? This cannot be undone."` / DE `"Jetzt {0} Notizen umschreiben? Das lässt sich nicht rückgängig machen."`.
  - `migration.reportDone` — `{0}` migriert, `{1}` fehlgeschlagen, `{2}` Konflikte. EN `"Migration: {0} updated · {1} failed · {2} conflicts"` / DE `"Migration: {0} aktualisiert · {1} fehlgeschlagen · {2} Konflikte"`.
  - `migration.appliedNoMigrate` — Warnung, `{0}` = Notizzahl. EN `"Mapping applied. {0} existing notes keep the old keys and won't be recognized (duplicate risk)."` / DE `"Mapping angewendet. {0} bestehende Notizen behalten die alten Keys und werden nicht mehr erkannt (Dubletten-Risiko)."`.

- [ ] **Step 1: Paritätstest zuerst laufen lassen (Baseline grün)**

Run: `npx vitest run tests/i18n.test.ts`
Expected: PASS (vor der Änderung).

- [ ] **Step 2: Alle Keys in `STRINGS.en` ergänzen** (Werte s. Interfaces oben, EN).

- [ ] **Step 3: Dieselben Keys in `STRINGS.de` ergänzen** (DE-Werte oben).

- [ ] **Step 4: Paritätstest grün**

Run: `npx vitest run tests/i18n.test.ts`
Expected: PASS (EN/DE-Schlüsselmengen identisch).

- [ ] **Step 5: Commit**

```bash
git add src/i18n.ts
git commit -m "feat(migration): i18n-Strings für Migrations-Modal + Bericht (EN/DE)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Migrations-Modal (Obsidian)

**Files:**
- Create: `src/migration_modal.ts`
- Test: `tests/migration_modal.test.ts` (leichter Konstruktions-/Callback-Test mit dem obsidian-Mock, Muster wie `tests/img_to_md_view.test.ts`)

**Interfaces:**
- Consumes: `MigrationPlan`/`NotePlan` (Task 5), `diffLines` aus `src/diff.ts`, `t` aus `src/i18n.ts`.
- Produces: `type MigrationChoice = "migrate" | "apply" | "cancel"`; `class MigrationModal extends Modal` mit `constructor(app: App, plan: MigrationPlan, changes: MappingChange[], onResolve: (choice: MigrationChoice) => void)`.

**Design:** Modell nach `src/diff_modal.ts`. Kopf: `migration.summary` + je `MappingChange` eine `migration.change`-Zeile + ggf. `migration.conflicts`. Darunter scrollbarer Bereich: pro `NotePlan` der Pfad + ein read-only Diff — `diffLines(altes FM, neues FM)` gerendert (nur der Frontmatter-Block, nicht der Body; Zeilen `add`/`del`/`ctx` farb-**und**-zeichen-kodiert wie im DiffModal, `+`/`-`). Footer: drei Buttons (`migration.migrateApply` `mod-cta`, `migration.applyOnly`, `migration.cancel`). Klick auf „Migrieren & anwenden" öffnet **erst** die zweite Bestätigung (`migration.confirm`, natives `confirm`-freies Sub-Modal ODER ein zweiter Button-Zustand — kein `window.confirm`, siehe Gotcha) und ruft dann `onResolve("migrate")`. Die anderen zwei rufen direkt `onResolve("apply")` / `onResolve("cancel")` und `close()`.

**UI-STANDARD:** nur `createEl`, Theme-CSS-Variablen, keine Farb-Literale; Diff-Marker farbunabhängig (`+`/`-` als Text, wie DiffModal). Kein `window.confirm`/`alert` (blockiert die Obsidian-Event-Loop).

- [ ] **Step 1: Failing test schreiben** (Callback-Verdrahtung, headless mit Mock)

```ts
import { describe, it, expect, vi } from "vitest";
import { MigrationModal } from "../src/migration_modal";
// App/Modal aus tests/__mocks__/obsidian.ts

describe("MigrationModal", () => {
  const plan = { migrations: [{ path: "a.md", old: "---\nkind: transcript\n---\n", next: "---\ntype: transcript\n---\n" }], conflicts: [] };
  const changes = [{ field: "kindKey" as const, from: "kind", to: "type" }];

  it("liefert 'apply' bei „Ohne Migration anwenden"", () => {
    const onResolve = vi.fn();
    const modal = new MigrationModal({} as never, plan, changes, onResolve);
    modal.onOpen();
    // Button „Ohne Migration anwenden" finden + klicken (contentEl-Query im Mock)
    modal.contentEl.querySelectorAll("button").forEach(b => { if (b.textContent === "Ohne Migration anwenden") b.click(); });
    expect(onResolve).toHaveBeenCalledWith("apply");
  });
});
```

(Ist das Callback-Testen mit dem Mock zu spröde, entfällt dieser Test — dann trägt die **Geräte-Abnahme**; im Commit vermerken.)

- [ ] **Step 2: Test läuft rot**

Run: `npx vitest run tests/migration_modal.test.ts`
Expected: FAIL.

- [ ] **Step 3: `MigrationModal` implementieren** (Struktur nach `diff_modal.ts`; Diff-Rendering pro Notiz mit `diffLines` auf den extrahierten Frontmatter-Blöcken; drei Buttons + zweite Bestätigung).

- [ ] **Step 4: Test grün + `tsc`/lint**

Run: `npx vitest run tests/migration_modal.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS/clean.

- [ ] **Step 5: Commit**

```bash
git add src/migration_modal.ts tests/migration_modal.test.ts
git commit -m "feat(migration): Migrations-Modal — Diff-Vorschau + Drei-Wege + 2. Bestätigung

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Vault-Sweep + Settings-Glue (blur-Commit) verdrahten (Obsidian)

**Files:**
- Modify: `src/main.ts` — Methode `offerFmMigration`.
- Modify: `src/settings.ts` — FM-Felder `onChange`-Autosave → blur-Commit + Trigger.

**Interfaces:**
- Consumes: `planMigration` (Task 5), `MigrationModal`/`MigrationChoice` (Task 7), `fmMapFromSettings`/`diffMappings`.
- Produces: `ImageToMarkdownPlugin.offerFmMigration(oldMap: FrontmatterMap, newMap: FrontmatterMap): Promise<void>`.

**`offerFmMigration` (main.ts):**
1. `const changes = diffMappings(oldMap, newMap); if (changes.length === 0) return;`
2. Vault lesen: `const files = this.app.vault.getMarkdownFiles(); const withContent = await Promise.all(files.map(async f => ({ path: f.path, content: await this.app.vault.read(f) })));`
3. `const plan = planMigration(withContent, oldMap, newMap);`
4. `plan.migrations.length === 0 && plan.conflicts.length === 0` → `newMap` speichern (`this.settings.frontmatterMap = newMap; await this.saveSettings();`), **stumm** zurück.
5. Sonst `MigrationModal` öffnen. Auf `choice`:
   - `"migrate"`: `newMap` speichern; dann best-effort schreiben —
     ```ts
     let ok = 0, fail = 0;
     for (const p of plan.migrations) {
       const file = this.app.vault.getAbstractFileByPath(p.path);
       if (!(file instanceof TFile)) { fail++; continue; }
       try { await this.app.vault.modify(file, p.next); ok++; }
       catch (e) { fail++; console.error("[i2m-migration]", p.path, e); }
     }
     new Notice(t("migration.reportDone", String(ok), String(fail), String(plan.conflicts.length)));
     ```
   - `"apply"`: `newMap` speichern; `new Notice(t("migration.appliedNoMigrate", String(plan.migrations.length)))`.
   - `"cancel"`: nichts speichern; die Settings-UI muss das Feld auf `oldMap` zurücksetzen (der SettingTab liest beim nächsten `display()` ohnehin aus `settings`; nach `cancel` das Feld explizit auf `oldMap[field]` zurücksetzen — siehe settings.ts unten).

**Settings-Glue (settings.ts):** die FM-Feld-Schleife (aktuell `onChange`→`saveSettings`) so umbauen, dass beim **blur** committet wird — Muster wie die Endpoint-Liste (`applyEndpointEdit`-Wiring über `inputEl`-`blur`-Listener). Beim blur:
```ts
const oldMap = fmMapFromSettings(this.plugin.settings);
const candidate = { ...oldMap, [field]: tx.getValue().trim() || DEFAULT_FM_MAP[field] };
if (candidate[field] === oldMap[field]) return;      // kein Diff
await this.plugin.offerFmMigration(oldMap, candidate);
this.display();                                       // Felder aus (ggf. unverändertem) settings neu zeichnen → Reset bei cancel
```
Kein `saveSettings` mehr im `onChange` dieser Felder (nur noch Anzeige-State); `offerFmMigration` ist ab jetzt die einzige Stelle, die `frontmatterMap` persistiert.

- [ ] **Step 1: `offerFmMigration` in main.ts implementieren** (Logik oben; `TFile`/`Notice` aus `obsidian` importieren; `planMigration`/`diffMappings` aus `./fm_migration`; `MigrationModal` aus `./migration_modal`).

- [ ] **Step 2: settings.ts FM-Feld-Schleife auf blur-Commit umbauen** (onChange-Autosave entfernen; blur-Listener + `offerFmMigration` + `this.display()`).

- [ ] **Step 3: `tsc` + lint + volle Test-Suite**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: clean / alle grün (bestehende `settings.test.ts` weiter grün; falls ein Test das alte onChange-Autosave-Verhalten festzurrt, an das blur-Verhalten anpassen).

- [ ] **Step 4: Build-Smoke**

Run: `npm run build`
Expected: `main.js` gebaut, keine Fehler.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/settings.ts tests/settings.test.ts
git commit -m "feat(migration): Vault-Sweep + blur-Commit-Trigger verdrahten

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec-Abdeckung:**
- Auslöser „beim Ändern anbieten" → Task 8 (blur-Commit + `offerFmMigration`). ✓
- Vorschau „Diff pro Notiz" → Task 7 (`diffLines`-Reuse). ✓
- Drei-Wege-Dialog → Task 7 (`MigrationChoice`) + Task 8 (Aktionen). ✓
- Zweite Bestätigung → Task 7 (`migration.confirm`). ✓
- Best-effort + Bericht → Task 8 (try/catch + `migration.reportDone`). ✓
- `diffMappings`/`isI2mNote`/`migrateNoteFrontmatter`/`planMigration` → Tasks 1/2/3+4/5. ✓
- Ein-Durchgang, CRLF, fremde Keys, Kollision → Tasks 3/4. ✓
- Pre-0.13-ohne-kind-Toleranz → Task 2. ✓
- 0 betroffene → stumm speichern → Task 8 Schritt 4. ✓
- „Ohne Migration anwenden"-Warnung → Task 6 (`migration.appliedNoMigrate`) + Task 8. ✓

**2. Placeholder-Scan:** keine TBD/TODO; alle Code-Schritte mit echtem Code; i18n-Werte ausgeschrieben. ✓

**3. Typ-Konsistenz:** `MappingChange`/`MigrationResult`/`NotePlan`/`MigrationPlan`/`MigrationChoice` durchgängig gleich benannt; `migrateNoteFrontmatter`/`planMigration`/`isI2mNote`/`diffMappings`/`offerFmMigration`-Signaturen über Tasks konsistent. `keyOf`/`fmBlock`/`hasKey`/`lineValue` als interne Helfer in Task 2/3 eingeführt, in Task 4 (Kollision) wiederverwendet. ✓

**Backstop:** Massen-Datei-Operation = höchstes Datenverlust-Risiko → **Opus-Whole-Branch-Review vor Merge** + **Geräte-Abnahme** (echte GUI: Key ändern → Modal → migrieren → Idempotenz-Recheck → Dubletten-Freiheit prüfen).
