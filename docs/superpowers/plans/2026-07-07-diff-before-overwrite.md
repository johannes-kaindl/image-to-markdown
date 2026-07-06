# Diff-before-overwrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vor der einzigen zerstörenden Operation (Override einer bestehenden Transkript-Notiz) einen Zeilen-Diff alt↔neu in einem nativen Modal zeigen und explizit bestätigen lassen.

**Architecture:** Reiner Kern (`diff.ts` pure `diffLines`, `extractTranscriptBody` in `img_to_md.ts`) + injizierter `confirmOverwrite`-Callback auf `ImgToMdIO`. Das Gate sitzt im `overwritePath`-Zweig von `writeTranscripts`/`writePdfTranscript`, vor dem `writeNote`. Die View steuert per `confirm`-Flag, dass der Gate NUR beim expliziten Override greift (nicht beim PDF-In-Session-Retry). Das Modal (`diff_modal.ts`) ist die einzige neue obsidian-abhängige Datei.

**Tech Stack:** TypeScript (strict, `noImplicitAny`) · vitest + happy-dom · Obsidian Plugin API · esbuild.

## Global Constraints

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen.
- **Reiner Kern ohne obsidian-Imports:** `diff.ts`, `img_to_md.ts`, `pdf_to_md.ts`, `i18n.ts` importieren NICHT `obsidian`. Nur `main.ts`, `img_to_md_view.ts`, `diff_modal.ts`, `settings.ts` dürfen `obsidian`/DOM.
- **UI-STANDARD (verbindlich):** DOM nur via `createEl`/`createDiv`/`createSpan` (nie `innerHTML`); Bestätigung als `Modal`; nur Theme-CSS-Variablen (kein `#…`/`rgb()`/`!important`); Klassen-Präfix `img2md-`; Buttons `mod-warning`/`mod-cta`.
- **i18n:** nutzersichtbare Strings via `t()` aus `i18n.ts`, EN kanonisch, EN+DE-Parität (Test erzwingt es).
- **Tests:** nach jeder Änderung alle grün (`npm test`) + `npx tsc --noEmit` separat. Ausgangsbasis: 266 Tests grün.
- **Commits:** Conventional Commits (deutsche Beschreibung erlaubt), nur berührte Dateien stagen, Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Diff-Berechnung Eigenbau** — KEINE npm-Diff-Library (`dependencies` bleibt nur `pdfjs-dist`).

---

### Task 1: Pure `diffLines` in neuem Modul `src/diff.ts`

**Files:**
- Create: `src/diff.ts`
- Test: `tests/diff.test.ts`

**Interfaces:**
- Consumes: nichts.
- Produces: `type DiffLine = { kind: "ctx" | "add" | "del"; text: string }` und `export function diffLines(oldText: string, newText: string): DiffLine[]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/diff.test.ts
import { describe, it, expect } from "vitest";
import { diffLines, DiffLine } from "../src/diff";

describe("diffLines", () => {
  it("identischer Text → nur ctx", () => {
    expect(diffLines("a\nb", "a\nb")).toEqual<DiffLine[]>([
      { kind: "ctx", text: "a" }, { kind: "ctx", text: "b" },
    ]);
  });
  it("reine Addition am Ende", () => {
    expect(diffLines("a", "a\nb")).toEqual<DiffLine[]>([
      { kind: "ctx", text: "a" }, { kind: "add", text: "b" },
    ]);
  });
  it("reine Löschung", () => {
    expect(diffLines("a\nb", "a")).toEqual<DiffLine[]>([
      { kind: "ctx", text: "a" }, { kind: "del", text: "b" },
    ]);
  });
  it("Ersetzung = del + add", () => {
    expect(diffLines("a\nX\nc", "a\nY\nc")).toEqual<DiffLine[]>([
      { kind: "ctx", text: "a" }, { kind: "del", text: "X" }, { kind: "add", text: "Y" }, { kind: "ctx", text: "c" },
    ]);
  });
  it("leerer alter Text → alles add", () => {
    expect(diffLines("", "a\nb")).toEqual<DiffLine[]>([
      { kind: "add", text: "a" }, { kind: "add", text: "b" },
    ]);
  });
  it("leerer neuer Text → alles del", () => {
    expect(diffLines("a\nb", "")).toEqual<DiffLine[]>([
      { kind: "del", text: "a" }, { kind: "del", text: "b" },
    ]);
  });
});
```

Hinweis: `"".split("\n")` ergibt `[""]` — der Test „leerer alter Text" erwartet, dass eine einzelne Leerzeile gegen mehrere neue Zeilen als reine Additionen erscheint (die gemeinsame `""`-Zeile ist LCS und wird zu `ctx`?). Um Mehrdeutigkeit zu vermeiden, behandelt `diffLines` einen komplett leeren Input (`text === ""`) als **leere Zeilenliste** `[]` (nicht `[""]`). Das macht die beiden Leer-Tests eindeutig.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/diff.test.ts`
Expected: FAIL — `Cannot find module '../src/diff'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/diff.ts
// Reiner Zeilen-Diff (LCS) — obsidian-frei, in Node testbar (PROF-OBS-03/04).
export type DiffLine = { kind: "ctx" | "add" | "del"; text: string };

function toLines(text: string): string[] {
  return text === "" ? [] : text.split("\n");
}

/** Klassischer LCS-Zeilen-Diff. Bodies sind klein → O(n·m) unkritisch.
 *  Reihenfolge bei Ersetzung: erst die gelöschten (alt), dann die hinzugefügten (neu). */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = toLines(oldText);
  const b = toLines(newText);
  const n = a.length, m = b.length;
  // lcs[i][j] = Länge der LCS von a[i..] und b[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ kind: "ctx", text: a[i] }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { out.push({ kind: "del", text: a[i] }); i++; }
    else { out.push({ kind: "add", text: b[j] }); j++; }
  }
  while (i < n) { out.push({ kind: "del", text: a[i] }); i++; }
  while (j < m) { out.push({ kind: "add", text: b[j] }); j++; }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/diff.test.ts`
Expected: PASS (6 Tests).

- [ ] **Step 5: Commit**

```bash
git add src/diff.ts tests/diff.test.ts
git commit -m "feat(diff): pure diffLines (LCS-Zeilen-Diff)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `extractTranscriptBody` in `src/img_to_md.ts`

**Files:**
- Modify: `src/img_to_md.ts` (neue exportierte Funktion nahe `rewriteTranscript`, ~Z.100)
- Test: `tests/img_to_md.test.ts`

**Interfaces:**
- Consumes: nichts.
- Produces: `export function extractTranscriptBody(note: string): string` — gibt den Transkript-Text ohne `---…---`-Frontmatter und ohne die führende `![[…]]`-Embed-Zeile (samt darauffolgender Leerzeile) zurück, `trim`-getrimmt am Ende.

- [ ] **Step 1: Write the failing test**

```ts
// tests/img_to_md.test.ts — im bestehenden import extractTranscriptBody ergänzen, neuer describe-Block
describe("extractTranscriptBody", () => {
  it("strippt Frontmatter + Embed-Zeile, gibt reinen Body", () => {
    const note = `---\nsource_image: "[[b.png]]"\ntranscribed_by: "vm"\n---\n![[b.png]]\n\nZeile 1\nZeile 2\n`;
    expect(extractTranscriptBody(note)).toBe("Zeile 1\nZeile 2");
  });
  it("ohne Frontmatter → nur Embed-Zeile strippen", () => {
    expect(extractTranscriptBody(`![[b.png]]\n\nNur Text`)).toBe("Nur Text");
  });
  it("ohne Embed-Zeile → Body unverändert (getrimmt)", () => {
    expect(extractTranscriptBody(`Kein Embed hier\n`)).toBe("Kein Embed hier");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/img_to_md.test.ts -t extractTranscriptBody`
Expected: FAIL — `extractTranscriptBody is not a function` / Import-Fehler.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/img_to_md.ts — direkt nach rewriteTranscript einfügen
/** Extrahiert den reinen Transkript-Text: entfernt das ---…----Frontmatter und die führende
 *  ![[…]]-Embed-Zeile (samt Leerzeile). Für den Diff — Frontmatter (transcribed_by/pages) und die
 *  unveränderte Embed-Zeile sind Rauschen. */
export function extractTranscriptBody(note: string): string {
  let s = note.replace(/^---\n[\s\S]*?\n---\n?/, "");
  s = s.replace(/^!\[\[[^\]]*\]\]\n?/, "");
  return s.trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/img_to_md.test.ts -t extractTranscriptBody`
Expected: PASS (3 Tests).

- [ ] **Step 5: Commit**

```bash
git add src/img_to_md.ts tests/img_to_md.test.ts
git commit -m "feat(core): extractTranscriptBody — Body ohne Frontmatter/Embed für den Diff

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `confirmOverwrite`-Gate + index-stabile `paths` in `writeTranscripts`

**Files:**
- Modify: `src/img_to_md.ts` (`ImgToMdIO`-Interface ~Z.152, `writeTranscripts` ~Z.171-199)
- Test: `tests/img_to_md.test.ts`

**Interfaces:**
- Consumes: `diffLines`/`DiffLine` (Task 1), `extractTranscriptBody` (Task 2).
- Produces:
  - `ImgToMdIO.confirmOverwrite?(ctx: { path: string; diff: DiffLine[] }): Promise<boolean>` (neue optionale Methode).
  - `writeTranscripts`-Entry erweitert: `{ raw; link; content; model; overwritePath?; embed?; confirm? }` (`confirm?: boolean`).
  - Rückgabe geändert: `Promise<{ paths: (string | null)[] }>` — **index-stabil**: ein Element pro Entry, `null` für übersprungene (leerer Content ODER Override abgebrochen).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/img_to_md.test.ts — im bestehenden writeTranscripts-describe ergänzen.
// Der bestehende Mock-IO-Helper (makeIO o.ä.) muss confirmOverwrite optional aufnehmen können.
it("Override mit confirmOverwrite=true → schreibt", async () => {
  const io = makeIO({ "b (transcript).md": `---\ntranscribed_by: "alt"\n---\n![[b.png]]\n\nALT` });
  let seen: any = null;
  io.confirmOverwrite = async (ctx) => { seen = ctx; return true; };
  const r = await writeTranscripts(io, "q.md", [
    { raw: "![[b.png]]", link: "b.png", content: "NEU", model: "neu", overwritePath: "b (transcript).md", confirm: true },
  ]);
  expect(r.paths).toEqual(["b (transcript).md"]);
  expect(seen.path).toBe("b (transcript).md");
  expect(seen.diff).toEqual([{ kind: "del", text: "ALT" }, { kind: "add", text: "NEU" }]);
});
it("Override mit confirmOverwrite=false → schreibt NICHT, paths[i]=null", async () => {
  const io = makeIO({ "b (transcript).md": `---\ntranscribed_by: "alt"\n---\n![[b.png]]\n\nALT` });
  const writes: string[] = [];
  const origWrite = io.writeNote;
  io.writeNote = async (p, c) => { writes.push(p); return origWrite(p, c); };
  io.confirmOverwrite = async () => false;
  const r = await writeTranscripts(io, "q.md", [
    { raw: "![[b.png]]", link: "b.png", content: "NEU", model: "neu", overwritePath: "b (transcript).md", confirm: true },
  ]);
  expect(r.paths).toEqual([null]);
  expect(writes).not.toContain("b (transcript).md");
});
it("Override mit confirm=false (Flag) → kein Callback, schreibt direkt", async () => {
  const io = makeIO({ "b (transcript).md": `---\ntranscribed_by: "alt"\n---\n![[b.png]]\n\nALT` });
  let called = false;
  io.confirmOverwrite = async () => { called = true; return false; };
  const r = await writeTranscripts(io, "q.md", [
    { raw: "![[b.png]]", link: "b.png", content: "NEU", model: "neu", overwritePath: "b (transcript).md", confirm: false },
  ]);
  expect(called).toBe(false);
  expect(r.paths).toEqual(["b (transcript).md"]);
});
it("identischer Body → kein Callback, schreibt", async () => {
  const io = makeIO({ "b (transcript).md": `---\ntranscribed_by: "alt"\n---\n![[b.png]]\n\nGLEICH` });
  let called = false;
  io.confirmOverwrite = async () => { called = true; return true; };
  const r = await writeTranscripts(io, "q.md", [
    { raw: "![[b.png]]", link: "b.png", content: "GLEICH", model: "neu", overwritePath: "b (transcript).md", confirm: true },
  ]);
  expect(called).toBe(false);
  expect(r.paths).toEqual(["b (transcript).md"]);
});
```

Und den bestehenden Leer-Content-Test anpassen (index-stabil):

```ts
// tests/img_to_md.test.ts:~152 — war: expect(r.paths).toEqual([]);
expect(r.paths).toEqual([null]);
```

> Falls es im Test noch keinen `makeIO`-Helper mit editierbarem `confirmOverwrite` gibt: den bestehenden IO-Mock-Helper um ein optionales `confirmOverwrite`-Feld erweitern (bleibt bei bestehenden Tests undefined → Verhalten unverändert).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/img_to_md.test.ts -t writeTranscripts`
Expected: FAIL — neue Tests rot (kein confirm-Handling), Leer-Test rot (`[]` ≠ `[null]`).

- [ ] **Step 3: Write minimal implementation**

Interface ergänzen:

```ts
// src/img_to_md.ts — im ImgToMdIO-Interface (nach notify), import { diffLines, DiffLine } from "./diff"; oben ergänzen
  confirmOverwrite?(ctx: { path: string; diff: DiffLine[] }): Promise<boolean>;
```

`writeTranscripts` umbauen (Signatur-Rückgabe + Entry-Feld + Gate):

```ts
export async function writeTranscripts(
  io: ImgToMdIO, sourcePath: string,
  entries: { raw: string; link: string; content: string; model: string; overwritePath?: string; embed?: boolean; confirm?: boolean }[],
  opts?: { selfSource?: boolean; destDir?: string },
): Promise<{ paths: (string | null)[] }> {
  const self = opts?.selfSource === true;
  const destDir = opts?.destDir;
  const before = self ? "" : await io.readNote(sourcePath);
  let content = before;
  const sourceName = self ? undefined : basenameNoExt(sourcePath);
  const paths: (string | null)[] = [];
  for (const e of entries) {
    const transcript = e.content.trim();
    if (!transcript) { paths.push(null); continue; }
    if (e.overwritePath) {
      const old = await io.readNote(e.overwritePath);
      if (e.confirm && io.confirmOverwrite) {
        const diff = diffLines(extractTranscriptBody(old), transcript);
        const changed = diff.some(d => d.kind !== "ctx");
        if (changed && !(await io.confirmOverwrite({ path: e.overwritePath, diff }))) {
          io.notify(t("notice.overwriteSkipped"));
          paths.push(null);
          continue;
        }
      }
      await io.writeNote(e.overwritePath, rewriteTranscript(old, { model: e.model, sourceLink: e.link, body: transcript }));
      paths.push(e.overwritePath);
      continue;
    }
    const imagePath = self ? sourcePath : (io.resolveImage(e.link, sourcePath)?.path ?? e.link);
    const newPath = transcriptNotePath(io, sourcePath, imagePath, "image", destDir);
    await io.createNote(newPath, buildTranscriptNote({ imageLink: e.link, sourceName, date: io.date(), model: e.model, transcript }));
    if (!self && e.embed !== false) content = replaceEmbed(content, e.raw, basenameNoExt(newPath));
    paths.push(newPath);
  }
  if (!self && content !== before) await io.writeNote(sourcePath, content);
  return { paths };
}
```

> `t` ist in `img_to_md.ts` bereits importiert (für `transcriptSuffix`). Der neue Key `notice.overwriteSkipped` wird in Task 5 angelegt — bis dahin gibt `t()` den Key als Fallback zurück (kein Crash). Reihenfolge egal, aber Task 5 vor der Geräte-Abnahme.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/img_to_md.test.ts` und `npx tsc --noEmit`
Expected: PASS (writeTranscripts-Block inkl. neuer Tests grün, tsc sauber).

- [ ] **Step 5: Commit**

```bash
git add src/img_to_md.ts tests/img_to_md.test.ts
git commit -m "feat(core): confirmOverwrite-Gate + index-stabile paths in writeTranscripts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `confirmOverwrite`-Gate in `writePdfTranscript`

**Files:**
- Modify: `src/pdf_to_md.ts` (`writePdfTranscript` ~Z.84-109)
- Test: `tests/pdf_to_md.test.ts`

**Interfaces:**
- Consumes: `diffLines` + `extractTranscriptBody` (via Import aus `./img_to_md`; `diffLines` aus `./diff`), `ImgToMdIO.confirmOverwrite` (Task 3).
- Produces: `writePdfTranscript`-`opts` erweitert um `confirm?: boolean`. Signatur sonst unverändert; Rückgabe bleibt `{ path: string | null }` (`null` auch bei Abbruch).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/pdf_to_md.test.ts — neuer describe/it-Block, nutzt den dortigen IO-Mock
it("PDF-Override confirm=true, false → schreibt nicht, path null", async () => {
  const io = makeIO({ "doc (PDF transcript).md": `---\ntranscribed_by: "alt"\npages: "1-1"\n---\n![[doc.pdf]]\n\nALT` });
  const writes: string[] = [];
  const ow = io.writeNote; io.writeNote = async (p, c) => { writes.push(p); return ow(p, c); };
  io.confirmOverwrite = async () => false;
  const r = await writePdfTranscript(io, "q.md", { raw: "![[doc.pdf]]", link: "doc.pdf" },
    [{ page: 1, content: "NEU", model: "vm" }], "%% page %d %%", "doc (PDF transcript).md", true,
    { range: { from: 1, to: 1 }, confirm: true });
  expect(r.path).toBeNull();
  expect(writes).not.toContain("doc (PDF transcript).md");
});
it("PDF-Override confirm=false (Retry) → kein Callback, schreibt", async () => {
  const io = makeIO({ "doc (PDF transcript).md": `---\ntranscribed_by: "alt"\npages: "1-1"\n---\n![[doc.pdf]]\n\nALT` });
  let called = false;
  io.confirmOverwrite = async () => { called = true; return false; };
  const r = await writePdfTranscript(io, "q.md", { raw: "![[doc.pdf]]", link: "doc.pdf" },
    [{ page: 1, content: "NEU", model: "vm" }], "%% page %d %%", "doc (PDF transcript).md", true,
    { range: { from: 1, to: 1 }, confirm: false });
  expect(called).toBe(false);
  expect(r.path).toBe("doc (PDF transcript).md");
});
```

> Separator-Format an das im Test übliche anpassen (dort verwendetes `PdfPageSeparator`-Literal übernehmen). IO-Mock ggf. um `confirmOverwrite` erweitern (wie Task 3).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/pdf_to_md.test.ts -t Override`
Expected: FAIL — `confirm` unbekannt / Callback wird nicht berücksichtigt.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/pdf_to_md.ts — Import ergänzen: import { diffLines } from "./diff";
//   und extractTranscriptBody zum bestehenden Import aus "./img_to_md" hinzufügen.
// opts-Typ erweitern:
  opts?: { selfSource?: boolean; destDir?: string; range?: { from: number; to: number }; confirm?: boolean },
// ... im overwritePath-Zweig (nach `const body = buildPdfBody(...)`, vor writeNote):
  if (overwritePath) {
    const old = await io.readNote(overwritePath);
    const body = buildPdfBody(bodyPages, separator, range);
    if (opts?.confirm && io.confirmOverwrite) {
      const diff = diffLines(extractTranscriptBody(old), body.trim());
      const changed = diff.some(d => d.kind !== "ctx");
      if (changed && !(await io.confirmOverwrite({ path: overwritePath, diff }))) {
        io.notify(t("notice.overwriteSkipped"));
        return { path: null };
      }
    }
    await io.writeNote(overwritePath, rewriteTranscript(old, { model, sourceLink: source.link, body, pages: pagesStr }));
    return { path: overwritePath };
  }
```

> `t` in `pdf_to_md.ts` importieren, falls noch nicht vorhanden: `import { t } from "./i18n";`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/pdf_to_md.test.ts` und `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pdf_to_md.ts tests/pdf_to_md.test.ts
git commit -m "feat(pdf): confirmOverwrite-Gate im writePdfTranscript-Override-Zweig

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: i18n-Keys (EN/DE)

**Files:**
- Modify: `src/i18n.ts` (EN- und DE-Dict)
- Test: `tests/i18n.test.ts` (bestehender Paritätstest deckt es ab)

**Interfaces:**
- Consumes: nichts.
- Produces: neue Keys `notice.overwriteSkipped`, `diff.modal.title` (mit `{0}` für den Notiznamen), `diff.overwrite`, `diff.cancel` — in EN und DE.

- [ ] **Step 1: Write the failing test**

```ts
// tests/i18n.test.ts — expliziter Wert-Test ergänzen (Parität ist schon getestet)
it("Diff-Keys vorhanden (EN)", () => {
  setLang("en");
  expect(t("diff.overwrite")).toBe("Overwrite");
  expect(t("diff.modal.title", "note")).toContain("note");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/i18n.test.ts`
Expected: FAIL — Keys fehlen (Wert = Key zurückgegeben), evtl. Paritätstest rot falls nur eine Sprache ergänzt.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/i18n.ts — im EN-Dict:
  "notice.overwriteSkipped": "Skipped — existing note kept",
  "diff.modal.title": "Overwrite {0}?",
  "diff.overwrite": "Overwrite",
  "diff.cancel": "Cancel",
// im DE-Dict:
  "notice.overwriteSkipped": "Übersprungen — bestehende Notiz behalten",
  "diff.modal.title": "{0} überschreiben?",
  "diff.overwrite": "Überschreiben",
  "diff.cancel": "Abbrechen",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/i18n.test.ts`
Expected: PASS (inkl. Paritätstest).

- [ ] **Step 5: Commit**

```bash
git add src/i18n.ts tests/i18n.test.ts
git commit -m "feat(i18n): Diff-Modal-/Skip-Strings EN/DE

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `DiffModal` in neuem `src/diff_modal.ts`

**Files:**
- Create: `src/diff_modal.ts`
- Modify: `styles.css` (Diff-Zeilen-Styling)

**Interfaces:**
- Consumes: `DiffLine` (Task 1), `t` (i18n), `Modal`/`App` (obsidian).
- Produces: `export class DiffModal extends Modal` mit Konstruktor `(app: App, path: string, diff: DiffLine[], onResolve: (ok: boolean) => void)`. Beim Schließen ohne Klick → `onResolve(false)`.

Kein Unit-Test (obsidian-abhängiger Glue, konsistent mit main.ts/View-Wirings). Verifikation über tsc/lint/build + Geräte-Abnahme.

- [ ] **Step 1: Implementierung schreiben**

```ts
// src/diff_modal.ts
import { App, Modal, setIcon } from "obsidian";
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
```

> `setIcon` nur importieren, falls tatsächlich genutzt — sonst weglassen, damit lint (`no-unused`) nicht meckert. Prüfe, ob `basename` aus `img_to_md.ts` exportiert ist (ja, `export function basename`).

- [ ] **Step 2: CSS ergänzen**

```css
/* styles.css — Diff-Modal (nur Theme-Variablen, img2md-Präfix, kein !important) */
.img2md-diff {
  max-height: 50vh;
  overflow: auto;
  font-family: var(--font-monospace);
  font-size: var(--font-ui-small);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  padding: var(--size-4-2);
  margin: var(--size-4-2) 0;
}
.img2md-diff-line { display: flex; gap: var(--size-4-1); white-space: pre-wrap; }
.img2md-diff-marker { width: 1ch; flex: 0 0 auto; color: var(--text-faint); }
.img2md-diff-add { background: var(--background-modifier-success); color: var(--text-normal); }
.img2md-diff-add .img2md-diff-marker { color: var(--text-success); }
.img2md-diff-del { background: var(--background-modifier-error); color: var(--text-normal); }
.img2md-diff-del .img2md-diff-marker { color: var(--text-error); }
.img2md-diff-ctx { color: var(--text-muted); }
.img2md-diff-actions { display: flex; justify-content: flex-end; gap: var(--size-4-2); margin-top: var(--size-4-2); }
```

- [ ] **Step 3: Typecheck + Lint + Build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: alle sauber (kein `innerHTML`, keine unused imports).

- [ ] **Step 4: Commit**

```bash
git add src/diff_modal.ts styles.css
git commit -m "feat(ui): DiffModal — nativer Zeilen-Diff-Bestätigungsdialog

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: View-Wiring — `confirm`-Flag + `sessionOwned` + Skip-Handling

**Files:**
- Modify: `src/img_to_md_view.ts` (`ImgToMdViewDeps` ~Z.23-38, `writeOne` ~Z.417, `writeAll` ~Z.432, `writePdfGroup` ~Z.405, neues Feld `sessionOwned`)
- Test: `tests/img_to_md_view.test.ts`

**Interfaces:**
- Consumes: nichts Neues extern.
- Produces (Dep-Signaturänderungen, die Task 8/main.ts erfüllt):
  - `writeTranscripts: (sourcePath: string, entries: { item: ImgItem; content: string; model: string; confirm?: boolean }[]) => Promise<(string | null)[]>`
  - `writePdf: (sourcePath: string, raw: string, link: string, pages: {...}[], overwritePath?: string, embed?: boolean, range?: {...}, confirm?: boolean) => Promise<string | null>`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/img_to_md_view.test.ts — neue Tests. Item mit existingTranscriptPath = Override.
it("Override-Erst-Write setzt confirm=true; Folge-Retry confirm=false (session-owned)", async () => {
  const item = { raw: "![[b.png]]", link: "b.png", ext: "png", kind: "image", supported: true, existingTranscriptPath: "b (transcript).md", embed: true } as any;
  const confirms: (boolean | undefined)[] = [];
  const { view } = mkView({
    scan: async () => [item],
    writeTranscripts: async (_sp: string, entries: any[]) => { confirms.push(entries[0].confirm); return [entries[0].overwritePath ? "b (transcript).md" : "n.md"]; },
  });
  await view.onOpen();
  // ... Karte auf "done" bringen (wie in bestehenden Tests), dann:
  await (view as any).writeOne(0);
  await (view as any).writeOne(0); // simulierter zweiter Write derselben Notiz
  expect(confirms[0]).toBe(true);
  expect(confirms[1]).toBe(false);
});
it("PDF-Override reicht confirm=true beim ersten Write, false beim Retry", async () => {
  // analog: writePdf-Mock erfasst den confirm-Parameter; erster Write true, zweiter false
});
```

> An die bestehenden View-Test-Muster anlehnen (wie Karten auf `done` gesetzt werden — siehe vorhandene `writeOne`/`writeAll`-Tests ab Z.336). Der `writeTranscripts`-Mock im `mkView`-Default (Z.24) gibt schon `entries.map(...)` zurück — Rückgabetyp `(string|null)[]` ist kompatibel.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/img_to_md_view.test.ts -t confirm`
Expected: FAIL — `confirm` wird nicht gesetzt/durchgereicht.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/img_to_md_view.ts
// (a) Dep-Signaturen (ImgToMdViewDeps):
  writeTranscripts: (sourcePath: string, entries: { item: ImgItem; content: string; model: string; confirm?: boolean }[]) => Promise<(string | null)[]>;
  writePdf: (sourcePath: string, raw: string, link: string, pages: { page: number; content: string; model: string }[], overwritePath?: string, embed?: boolean, range?: { from: number; to: number }, confirm?: boolean) => Promise<string | null>;

// (b) neues Feld in der Klasse (bei den anderen private-Feldern):
  private sessionOwned = new Set<string>();

// (c) writeOne — Bild-Zweig:
    } else {
      const op = card.item.existingTranscriptPath;
      const confirm = !!op && !this.sessionOwned.has(op);
      const [created] = await this.deps.writeTranscripts(path, [{ item: card.item, content: card.text.trim(), model: card.model, confirm }]);
      if (created) { this.sessionOwned.add(created); this.state.markWritten(i, created); }
    }

// (d) writeAll — Bild-Zweig:
    if (part.images.length) {
      const entries = part.images.map(x => {
        const op = x.card.item.existingTranscriptPath;
        return { item: x.card.item, content: x.card.text.trim(), model: x.card.model, confirm: !!op && !this.sessionOwned.has(op) };
      });
      const paths = await this.deps.writeTranscripts(path, entries);
      part.images.forEach((x, k) => { const p = paths[k]; if (p) { this.sessionOwned.add(p); this.state.markWritten(x.cardIndex, p); } });
    }

// (e) writePdfGroup:
  private async writePdfGroup(path: string, g: PdfGroup): Promise<void> {
    if (g.pending || !g.pages.length) return;
    const op = g.item.existingTranscriptPath;
    const confirm = !!op && !this.sessionOwned.has(op);
    const created = await this.deps.writePdf(
      path, g.raw, g.link,
      g.pages.map(p => ({ page: p.page, content: p.content.trim(), model: p.model })),
      g.item.existingTranscriptPath, g.item.embed, g.range, confirm,
    );
    if (!created) return;
    this.sessionOwned.add(created);
    if (!g.item.existingTranscriptPath) g.item.existingTranscriptPath = created;
    if (!g.failedPages.length) g.cardIndices.forEach(j => this.state.markWritten(j, created));
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/img_to_md_view.test.ts` und `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/img_to_md_view.ts tests/img_to_md_view.test.ts
git commit -m "feat(view): confirm-Flag + sessionOwned — Diff-Gate nur beim expliziten Override

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: main.ts — `confirmOverwrite`-Impl + `confirm` durchreichen

**Files:**
- Modify: `src/main.ts` (`makeImgIO` ~Z.73, `writeTranscripts`/`writePdf`-Dep-Closures ~Z.183-193, Import)

**Interfaces:**
- Consumes: `DiffModal` (Task 6), Dep-Signaturen (Task 7), `confirmOverwrite` (Task 3).
- Produces: nichts (Verdrahtung/Endpunkt).

Kein Unit-Test (main.ts = ungetesteter Glue, konsistent mit dem Repo). Verifikation über tsc/lint/build + Geräte-Abnahme.

- [ ] **Step 1: Implementierung schreiben**

```ts
// src/main.ts
// (a) Import ergänzen:
import { DiffModal } from "./diff_modal";

// (b) makeImgIO — confirmOverwrite hinzufügen (nach notify):
      confirmOverwrite: (ctx) => new Promise<boolean>((resolve) => new DiffModal(this.app, ctx.path, ctx.diff, resolve).open()),

// (c) writeTranscripts-Dep-Closure — confirm durchreichen:
      writeTranscripts: async (sourcePath, entries) => {
        const self = classifySource(extOf(sourcePath)) !== null;
        const destDir = self ? this.app.fileManager.getNewFileParent(sourcePath).path : undefined;
        const { paths } = await writeTranscripts(this.makeImgIO(), sourcePath, entries.map(e => ({ raw: e.item.raw, link: e.item.link, content: e.content, model: e.model, overwritePath: e.item.existingTranscriptPath, embed: e.item.embed, confirm: e.confirm })), { selfSource: self, destDir });
        return paths;
      },

// (d) writePdf-Dep-Closure — confirm durchreichen:
      writePdf: async (sourcePath, raw, link, pages, overwritePath, embed, range, confirm) => {
        const self = classifySource(extOf(sourcePath)) !== null;
        const destDir = self ? this.app.fileManager.getNewFileParent(sourcePath).path : undefined;
        const { path } = await writePdfTranscript(this.makeImgIO(), sourcePath, { raw, link }, pages, this.settings.pdfPageSeparator, overwritePath, embed, { selfSource: self, destDir, range, confirm });
        return path;
      },
```

- [ ] **Step 2: Typecheck + Lint + Build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: alle sauber. `paths` (jetzt `(string|null)[]`) ist mit der Dep-Rückgabe `Promise<(string|null)[]>` kompatibel.

- [ ] **Step 3: Full test run**

Run: `npm test`
Expected: alle grün (≥ 266 + neue Tests).

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat(main): DiffModal als confirmOverwrite verdrahten + confirm durchreichen

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Abschluss (nach allen Tasks)

- [ ] **Whole-Branch-Review** (adversariell) — Datenverlust-Pfade, Index-Stabilität `paths`, Scope-Grenze (In-Session-Retro kein Confirm), UI-STANDARD-Konformität.
- [ ] **Geräte-Abnahme in Obsidian** (Backstop für Modal + main-Glue):
  1. Bild mit bestehendem Transkript → Override-Haken → transkribieren → Diff-Modal erscheint → „Abbrechen" → alte Notiz unverändert.
  2. Erneut → „Überschreiben" → Notiz ersetzt, Diff war korrekt.
  3. PDF mit Fehlseite: erster Override → Diff-Modal; „Fehlgeschlagene erneut" (In-Session-Retry) → KEIN Modal.
  4. EN + DE UI prüfen.
- [ ] **Docs:** CHANGELOG-Eintrag; README-Feature-Zeile falls sinnvoll.
- [ ] **Cockpit** (`§🧭` + Frontmatter) nach Merge nachziehen.

## Self-Review (gegen die Spec)

- **Spec-Coverage:** `diffLines` (T1) · `extractTranscriptBody` (T2) · `confirmOverwrite`+Gate Bild (T3) · Gate PDF (T4) · Scope-Grenze/confirm-Flag/sessionOwned (T7) · Modal+CSS (T6) · i18n (T5) · main-Wiring (T8) · Edge-Cases (kein Diff→T3/T4, Abbruch-Notice→T3/T4, confirm ungesetzt→optional, In-Session-Retry→T7). Alle Spec-Punkte abgedeckt.
- **Typkonsistenz:** `DiffLine`/`diffLines`, `confirmOverwrite(ctx:{path,diff})`, Entry-`confirm?`, `paths:(string|null)[]`, View-Deps-Signaturen — durchgängig identisch T1→T8.
- **Placeholder-Scan:** keine TBD/TODO; jeder Code-Schritt zeigt vollständigen Code.
