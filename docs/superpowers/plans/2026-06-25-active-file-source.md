# Aktive Datei als Quelle (Etappe 3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine direkt geöffnete PDF- oder Bild-Datei (ohne umgebende Quellnotiz) per Sidebar nach Markdown transkribieren — die Datei selbst ist die Quelle.

**Architecture:** Ansatz A — der Scan liefert für eine aktive Mediendatei **ein** synthetisches `ImgItem` (`selfSource:true, embed:false`); die bestehende Streaming-/Schreib-/Idempotenz-Pipeline wird wiederverwendet. Drei Verzweigungen: Stream liest die Datei direkt, Schreibpfad bekommt einen `destDir` (`getNewFileParent`), `source_note`/`replaceEmbed`/Quell-Read entfallen. Die nicht-triviale Item-Konstruktion lebt im reinen Kern (`buildSelfSourceItem`), `main.ts` bleibt dünner Glue.

**Tech Stack:** TypeScript (strict), esbuild, vitest + happy-dom, Obsidian Plugin API.

## Global Constraints

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen (Tests dürfen den bestehenden `any`-Fake-IO-Stil nutzen).
- **`minAppVersion` bleibt 1.8.7** — `getNewFileParent` ist `@public @since 1.1.13`, kein Bump.
- **Reiner Kern ohne `obsidian`-Imports:** `img_to_md.ts`, `pdf_to_md.ts`, `img_to_md_state.ts`, `i18n.ts` bleiben obsidian-/DOM-frei. Nur `main.ts`/`img_to_md_view.ts` importieren `obsidian`.
- **i18n:** jeder neue nutzersichtbare String via `t()` aus `i18n.ts`, **EN kanonisch + DE** (flache Punkt-Keys).
- **Tests:** nach jedem Task **alle** Tests grün (`npm test`). `npx tsc --noEmit` + `npm run lint` (inkl. `eslint-plugin-obsidianmd`) am Ende sauber.
- **Commits:** Conventional Commits (deutsche Beschreibung erlaubt), **nur berührte Dateien stagen**, Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Baseline:** 171 Tests grün vor Beginn.

---

### Task 1: `classifySource` + `extOf`-Export (reiner Kern)

**Files:**
- Modify: `src/img_to_md.ts` (`extOf` exportieren, `classifySource` ergänzen)
- Test: `tests/img_to_md.test.ts`

**Interfaces:**
- Consumes: `IMAGE_EXTS`, `PDF_EXT` (bestehend in `img_to_md.ts`).
- Produces:
  - `export function extOf(link: string): string` (bisher modul-privat — nur das `export` ergänzen, Logik unverändert)
  - `export function classifySource(ext: string): "image" | "pdf" | null`

- [ ] **Step 1: Failing test**

In `tests/img_to_md.test.ts` den Import um `classifySource` erweitern und einen Block ergänzen:

```ts
import { /* …bestehende… */ classifySource } from "../src/img_to_md";

describe("classifySource", () => {
  it("Bild-Extensions → image", () => {
    expect(classifySource("png")).toBe("image");
    expect(classifySource("JPG")).toBe("image");
    expect(classifySource("heic")).toBe("image");
  });
  it("pdf → pdf", () => {
    expect(classifySource("pdf")).toBe("pdf");
    expect(classifySource("PDF")).toBe("pdf");
  });
  it("md/canvas/leer → null", () => {
    expect(classifySource("md")).toBeNull();
    expect(classifySource("canvas")).toBeNull();
    expect(classifySource("")).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run tests/img_to_md.test.ts -t classifySource`
Expected: FAIL (`classifySource is not a function` / kein Export).

- [ ] **Step 3: Implementieren**

In `src/img_to_md.ts`: das `function extOf` zu `export function extOf` machen. Direkt darunter ergänzen:

```ts
/** Klassifiziert eine Datei-Extension als transkribierbare Selbst-Quelle. */
export function classifySource(ext: string): "image" | "pdf" | null {
  const e = ext.toLowerCase();
  if (IMAGE_EXTS.includes(e)) return "image";
  if (e === PDF_EXT) return "pdf";
  return null;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run tests/img_to_md.test.ts -t classifySource`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/img_to_md.ts tests/img_to_md.test.ts
git commit -m "feat(core): classifySource + extOf-Export für Selbst-Quelle-Erkennung

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `sourceName` optional in `buildTranscriptNote` + `buildPdfNote`

**Files:**
- Modify: `src/img_to_md.ts` (`buildTranscriptNote`)
- Modify: `src/pdf_to_md.ts` (`buildPdfNote`)
- Test: `tests/img_to_md.test.ts`, `tests/pdf_to_md.test.ts`

**Interfaces:**
- Produces:
  - `buildTranscriptNote(o: { imageLink: string; sourceName?: string; date: string; model: string; transcript: string }): string` — fehlt `sourceName`, entfällt die `source_note`-Zeile.
  - `buildPdfNote(o: { …; sourceName?: string; … }): string` — analog.

- [ ] **Step 1: Failing tests**

In `tests/img_to_md.test.ts` im `describe("buildTranscriptNote", …)` ergänzen:

```ts
it("ohne sourceName → keine source_note-Zeile", () => {
  const note = buildTranscriptNote({ imageLink: "scan.png", date: "2026-06-25", model: "vm", transcript: "x" });
  expect(note).toContain('source_image: "[[scan.png]]"');
  expect(note).not.toContain("source_note");
});
```

In `tests/pdf_to_md.test.ts` im `describe("buildPdfNote", …)` ergänzen:

```ts
it("ohne sourceName → keine source_note-Zeile", () => {
  const note = buildPdfNote({ pdfLink: "doc.pdf", date: "2026-06-25", model: "vm", rangeFrom: 1, rangeTo: 1, separator: "comment", pages: [{ page: 1, text: "x" }] });
  expect(note).toContain('source_pdf: "[[doc.pdf]]"');
  expect(note).not.toContain("source_note");
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run tests/img_to_md.test.ts tests/pdf_to_md.test.ts -t "ohne sourceName"`
Expected: FAIL (TS-Fehler „sourceName fehlt" bzw. `source_note` doch enthalten).

- [ ] **Step 3: Implementieren**

In `src/img_to_md.ts` `buildTranscriptNote` ersetzen:

```ts
export function buildTranscriptNote(o: { imageLink: string; sourceName?: string; date: string; model: string; transcript: string }): string {
  const esc = (s: string) => s.replace(/"/g, '\\"');   // YAML-Doppelquote-String — schützt vor Frontmatter-Bruch
  const lines = ["---", `source_image: "[[${esc(o.imageLink)}]]"`];
  if (o.sourceName !== undefined) lines.push(`source_note: "[[${esc(o.sourceName)}]]"`);
  lines.push(`created: ${o.date}`, `transcribed_by: "${esc(o.model)}"`, "---", `![[${o.imageLink}]]`, "", o.transcript, "");
  return lines.join("\n");
}
```

In `src/pdf_to_md.ts` `buildPdfNote` die Frontmatter-Konstruktion ersetzen — den `frontmatter`-Array-Aufbau (`["---", source_pdf, source_note, created, …]`) so umbauen, dass `source_note` konditional ist:

```ts
export function buildPdfNote(o: {
  pdfLink: string; sourceName?: string; date: string; model: string;
  pages: PdfPageTranscript[]; rangeFrom: number; rangeTo: number;
  separator: PdfPageSeparator;
}): string {
  const esc = (s: string) => s.replace(/"/g, '\\"');
  const fm = ["---", `source_pdf: "[[${esc(o.pdfLink)}]]"`];
  if (o.sourceName !== undefined) fm.push(`source_note: "[[${esc(o.sourceName)}]]"`);
  fm.push(`created: ${o.date}`, `transcribed_by: "${esc(o.model)}"`, `pages: "${o.rangeFrom}-${o.rangeTo}"`, "---");
  const frontmatter = fm.join("\n");
  const body = buildPdfBody(o.pages, o.separator);
  return `${frontmatter}\n![[${o.pdfLink}]]\n\n${body}\n`;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run tests/img_to_md.test.ts tests/pdf_to_md.test.ts`
Expected: PASS (neue + alle bestehenden buildNote-Tests grün).

- [ ] **Step 5: Commit**

```bash
git add src/img_to_md.ts src/pdf_to_md.ts tests/img_to_md.test.ts tests/pdf_to_md.test.ts
git commit -m "feat(core): source_note im Frontmatter optional (ohne sourceName weglassen)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `transcriptNotePath` — optionaler `destDir`

**Files:**
- Modify: `src/img_to_md.ts` (`transcriptNotePath`)
- Test: `tests/img_to_md.test.ts`

**Interfaces:**
- Produces: `transcriptNotePath(io, sourcePath, imagePath, kind, destDir?: string): string` — mit `destDir` landet die Notiz unter `destDir`, sonst (Default) unter `dirOf(sourcePath)` wie bisher.

- [ ] **Step 1: Failing test**

In `tests/img_to_md.test.ts` im `describe("transcriptNotePath", …)` ergänzen:

```ts
it("destDir überschreibt das Verzeichnis der Quellnotiz", () => {
  const io = { noteExists: () => false };
  expect(transcriptNotePath(io, "Anhänge/scan.pdf", "Anhänge/scan.pdf", "pdf", "Transkripte")).toBe("Transkripte/scan (pdf transcript).md");
  expect(transcriptNotePath(io, "Anhänge/scan.pdf", "Anhänge/scan.pdf", "pdf", "")).toBe("scan (pdf transcript).md");
});
```

> Hinweis: Der erwartete Suffix ist `t("note.suffix.pdf")` bzw. `.image` bei Default-Sprache EN. Vor dem Festschreiben des Erwartungswerts den realen Suffix prüfen (`grep '"note.suffix' src/i18n.ts`) und im Test exakt übernehmen.

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run tests/img_to_md.test.ts -t "destDir überschreibt"`
Expected: FAIL (zu viele Argumente / `destDir` ignoriert).

- [ ] **Step 3: Implementieren**

In `src/img_to_md.ts` `transcriptNotePath` ersetzen:

```ts
/** Pfad für die Transkript-Notiz: unter `destDir` (falls gesetzt) bzw. neben der Quellnotiz,
 *  Basename des Bildes + lokalisierter Suffix, kollisionsfrei. */
export function transcriptNotePath(io: { noteExists(p: string): boolean }, sourcePath: string, imagePath: string, kind: "image" | "pdf", destDir?: string): string {
  const base = `${basenameNoExt(imagePath)} ${transcriptSuffix(kind)}`;
  return uniqueNotePath(io, destDir ?? dirOf(sourcePath), base);
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run tests/img_to_md.test.ts -t transcriptNotePath`
Expected: PASS (neuer + bestehender Test grün).

- [ ] **Step 5: Commit**

```bash
git add src/img_to_md.ts tests/img_to_md.test.ts
git commit -m "feat(core): transcriptNotePath mit optionalem destDir

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `writeTranscripts` — `opts.selfSource` / `destDir` (Bild-Schreibpfad)

**Files:**
- Modify: `src/img_to_md.ts` (`writeTranscripts`)
- Test: `tests/img_to_md.test.ts`

**Interfaces:**
- Consumes: `transcriptNotePath(…, destDir?)` (Task 3), `buildTranscriptNote({ sourceName? })` (Task 2).
- Produces: `writeTranscripts(io, sourcePath, entries, opts?: { selfSource?: boolean; destDir?: string }): Promise<{ paths: string[] }>`. Bei `opts.selfSource`: **kein** `readNote`/`writeNote` auf `sourcePath`, **kein** `replaceEmbed`, `source_note` weggelassen, Ablage unter `opts.destDir`.

- [ ] **Step 1: Failing test**

In `tests/img_to_md.test.ts` im `describe("writeTranscripts", …)` ergänzen. `fakeIO` protokolliert bereits `created`/`notes`; ergänze einen Read-/Write-Spy auf `sourcePath`:

```ts
it("selfSource: schreibt unter destDir, kein source_note, kein Quell-Read/-Write", async () => {
  const reads: string[] = [];
  const io = fakeIO({
    readNote: async (p: string) => { reads.push(p); return ""; },
  });
  const r = await writeTranscripts(io, "Anhänge/scan.png", [
    { raw: "", link: "scan.png", content: "Hallo", model: "vm", embed: false },
  ], { selfSource: true, destDir: "Transkripte" });

  expect(r.paths).toEqual(["Transkripte/scan (transcript).md"]);
  const note = io.notes.get("Transkripte/scan (transcript).md");
  expect(note).toContain('source_image: "[[scan.png]]"');
  expect(note).not.toContain("source_note");
  expect(reads).not.toContain("Anhänge/scan.png");   // Quelldatei nie gelesen
  expect(io.notes.has("Anhänge/scan.png")).toBe(false); // und nie geschrieben
});
```

> Falls `fakeIO` `notes` nicht nach außen gibt: den Helfer minimal erweitern, sodass `io.notes` (die `Map`) erreichbar ist — bestehende Tests bleiben unberührt.

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run tests/img_to_md.test.ts -t "selfSource: schreibt unter destDir"`
Expected: FAIL (4. Argument unbekannt / liest `sourcePath` / enthält `source_note`).

- [ ] **Step 3: Implementieren**

In `src/img_to_md.ts` `writeTranscripts` ersetzen:

```ts
export async function writeTranscripts(
  io: ImgToMdIO, sourcePath: string,
  entries: { raw: string; link: string; content: string; model: string; overwritePath?: string; embed?: boolean }[],
  opts?: { selfSource?: boolean; destDir?: string },
): Promise<{ paths: string[] }> {
  const self = opts?.selfSource === true;
  const before = self ? "" : await io.readNote(sourcePath);
  let content = before;
  const sourceName = self ? undefined : basenameNoExt(sourcePath);
  const paths: string[] = [];
  for (const e of entries) {
    const transcript = e.content.trim();
    if (!transcript) continue;
    if (e.overwritePath) {
      const old = await io.readNote(e.overwritePath);
      await io.writeNote(e.overwritePath, rewriteTranscript(old, { model: e.model, sourceLink: e.link, body: transcript }));
      paths.push(e.overwritePath);
      continue;
    }
    const imagePath = self ? sourcePath : (io.resolveImage(e.link, sourcePath)?.path ?? e.link);
    const newPath = transcriptNotePath(io, sourcePath, imagePath, "image", opts?.destDir);
    await io.createNote(newPath, buildTranscriptNote({ imageLink: e.link, sourceName, date: io.date(), model: e.model, transcript }));
    if (!self && e.embed !== false) content = replaceEmbed(content, e.raw, basenameNoExt(newPath));
    paths.push(newPath);
  }
  if (!self && content !== before) await io.writeNote(sourcePath, content);
  return { paths };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run tests/img_to_md.test.ts`
Expected: PASS (neuer Test + alle bestehenden writeTranscripts/runImgToMd-Tests grün).

- [ ] **Step 5: Commit**

```bash
git add src/img_to_md.ts tests/img_to_md.test.ts
git commit -m "feat(core): writeTranscripts selfSource-Pfad (destDir, kein Quell-Read/replaceEmbed/source_note)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `writePdfTranscript` — `opts.selfSource` / `destDir` (PDF-Schreibpfad)

**Files:**
- Modify: `src/pdf_to_md.ts` (`writePdfTranscript`)
- Test: `tests/pdf_to_md.test.ts`

**Interfaces:**
- Consumes: `transcriptNotePath(…, destDir?)` (Task 3), `buildPdfNote({ sourceName? })` (Task 2).
- Produces: `writePdfTranscript(io, sourcePath, source, pages, separator, overwritePath?, embed?, opts?: { selfSource?: boolean; destDir?: string }): Promise<{ path: string | null }>`. Bei `opts.selfSource`: `source_note` weggelassen, Ablage unter `destDir`, `pdfPath = sourcePath`, **kein** `replaceEmbed`/Quell-Read.

- [ ] **Step 1: Failing test**

In `tests/pdf_to_md.test.ts` im `describe("writePdfTranscript", …)` ergänzen (Muster wie der bestehende `embed:false`-Test mit `pdfIO`):

```ts
it("selfSource: Notiz unter destDir, kein source_note, Quelldatei unangetastet", async () => {
  const io = pdfIO("");   // leerer Vault, keine Quellnotiz
  const r = await writePdfTranscript(io, "Anhänge/scan.pdf", { raw: "", link: "scan.pdf" },
    [{ page: 1, content: "Seite 1", model: "vm" }], "comment", undefined, false, { selfSource: true, destDir: "Transkripte" });

  expect(r.path).toBe("Transkripte/scan (pdf transcript).md");
  const note = io.notes.get("Transkripte/scan (pdf transcript).md");
  expect(note).toContain('source_pdf: "[[scan.pdf]]"');
  expect(note).not.toContain("source_note");
  expect(io.notes.has("Anhänge/scan.pdf")).toBe(false);   // Quelldatei nie geschrieben
});
```

> Suffix-Erwartung (`(pdf transcript)`) vor dem Festschreiben gegen `t("note.suffix.pdf")` prüfen und exakt übernehmen. Falls `pdfIO` die `notes`-Map nicht exponiert, minimal erweitern (bestehende Tests unberührt).

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run tests/pdf_to_md.test.ts -t "selfSource"`
Expected: FAIL (8. Argument unbekannt / falsches Verzeichnis / `source_note` enthalten).

- [ ] **Step 3: Implementieren**

In `src/pdf_to_md.ts` `writePdfTranscript` erweitern — Signatur + die drei Verzweigungen (`sourceName`, `pdfPath`, `notePath`, `embed`-Block):

```ts
export async function writePdfTranscript(
  io: ImgToMdIO, sourcePath: string,
  source: { raw: string; link: string },
  pages: { page: number; content: string; model: string }[],
  separator: PdfPageSeparator,
  overwritePath?: string,
  embed = true,
  opts?: { selfSource?: boolean; destDir?: string },
): Promise<{ path: string | null }> {
  const self = opts?.selfSource === true;
  const kept = pages.filter(p => p.content.trim()).sort((a, b) => a.page - b.page);
  if (!kept.length) return { path: null };
  const model = kept.find(p => p.model)?.model ?? "";
  const pagesStr = `${kept[0].page}-${kept[kept.length - 1].page}`;
  if (overwritePath) {
    const old = await io.readNote(overwritePath);
    const body = buildPdfBody(kept.map(p => ({ page: p.page, text: p.content })), separator);
    await io.writeNote(overwritePath, rewriteTranscript(old, { model, sourceLink: source.link, body, pages: pagesStr }));
    return { path: overwritePath };
  }
  const sourceName = self ? undefined : basenameNoExt(sourcePath);
  const pdfPath = self ? sourcePath : (io.resolveImage(source.link, sourcePath)?.path ?? source.link);
  const notePath = transcriptNotePath(io, sourcePath, pdfPath, "pdf", opts?.destDir);
  const content = buildPdfNote({
    pdfLink: source.link, sourceName, date: io.date(), model,
    pages: kept.map(p => ({ page: p.page, text: p.content })),
    rangeFrom: kept[0].page, rangeTo: kept[kept.length - 1].page, separator,
  });
  await io.createNote(notePath, content);
  if (embed && !self) {
    const before = await io.readNote(sourcePath);
    const replaced = replaceEmbed(before, source.raw, basenameNoExt(notePath));
    if (replaced !== before) await io.writeNote(sourcePath, replaced);
  }
  return { path: notePath };
}
```

> `transcriptNotePath` ggf. zum bestehenden Import aus `./img_to_md` ergänzen (ist bereits importiert).

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run tests/pdf_to_md.test.ts`
Expected: PASS (neuer Test + alle bestehenden PDF-Tests grün).

- [ ] **Step 5: Commit**

```bash
git add src/pdf_to_md.ts tests/pdf_to_md.test.ts
git commit -m "feat(core): writePdfTranscript selfSource-Pfad (destDir, kein source_note/replaceEmbed)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `ImgItem.selfSource` + `basename` + `buildSelfSourceItem` (reiner Kern)

**Files:**
- Modify: `src/img_to_md_state.ts` (`ImgItem`-Feld)
- Modify: `src/img_to_md.ts` (`basename`-Export, `buildSelfSourceItem`)
- Test: `tests/img_to_md.test.ts`

**Interfaces:**
- Consumes: `classifySource`, `extOf` (Task 1), `IMAGE_EXTS`/`SUPPORTED_EXTS`, `ImgItem` (type-only aus `./img_to_md_state`).
- Produces:
  - `ImgItem` mit zusätzlichem `selfSource?: boolean`.
  - `export function basename(path: string): string` (letztes Pfadsegment **mit** Extension).
  - `export function buildSelfSourceItem(sourcePath: string, opts: { pageCount?: number; existingTranscriptPath?: string; pdfMaxPages: number }): ImgItem | null` — `null` wenn `sourcePath` keine Mediendatei ist.

- [ ] **Step 1: Failing test**

In `tests/img_to_md.test.ts` Import um `buildSelfSourceItem`, `basename` erweitern und ergänzen:

```ts
describe("buildSelfSourceItem", () => {
  it("Bild → image-Item, supported, embed:false, selfSource:true", () => {
    const it = buildSelfSourceItem("Anhänge/scan.png", { pdfMaxPages: 20 });
    expect(it).toMatchObject({ kind: "image", link: "scan.png", ext: "png", supported: true, embed: false, selfSource: true, raw: "" });
  });
  it("HEIC → image-Item, supported:false", () => {
    expect(buildSelfSourceItem("foto.heic", { pdfMaxPages: 20 })?.supported).toBe(false);
  });
  it("PDF → pdf-Item mit pageCount/range, range to auf pdfMaxPages gekappt", () => {
    const it = buildSelfSourceItem("doc.pdf", { pageCount: 50, pdfMaxPages: 20 });
    expect(it).toMatchObject({ kind: "pdf", supported: true, pageCount: 50, range: { from: 1, to: 20 }, selfSource: true });
  });
  it("PDF ohne lesbare Seiten → supported:false, range to:1", () => {
    const it = buildSelfSourceItem("doc.pdf", { pageCount: 0, pdfMaxPages: 20 });
    expect(it).toMatchObject({ supported: false, range: { from: 1, to: 1 } });
  });
  it("existingTranscriptPath wird durchgereicht", () => {
    const it = buildSelfSourceItem("scan.png", { pdfMaxPages: 20, existingTranscriptPath: "scan (transcript).md" });
    expect(it?.existingTranscriptPath).toBe("scan (transcript).md");
  });
  it("Nicht-Medien-Datei → null", () => {
    expect(buildSelfSourceItem("note.md", { pdfMaxPages: 20 })).toBeNull();
    expect(buildSelfSourceItem("board.canvas", { pdfMaxPages: 20 })).toBeNull();
  });
});

describe("basename", () => {
  it("letztes Segment mit Extension", () => {
    expect(basename("a/b/scan.png")).toBe("scan.png");
    expect(basename("scan.pdf")).toBe("scan.pdf");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run tests/img_to_md.test.ts -t "buildSelfSourceItem"`
Expected: FAIL (Funktionen nicht definiert).

- [ ] **Step 3: Implementieren**

In `src/img_to_md_state.ts` das `ImgItem`-Interface um ein Feld ergänzen:

```ts
  embed?: boolean;   // false = reiner Link (Quelltext bleibt); fehlt/true = Embed (heutiges Verhalten)
  selfSource?: boolean;   // true = die aktive Datei selbst ist die Quelle (embed dann immer false)
```

In `src/img_to_md.ts` oben den Type-Import ergänzen (kein Runtime-Zyklus — `img_to_md_state.ts` importiert `img_to_md.ts` nicht):

```ts
import type { ImgItem } from "./img_to_md_state";
```

und nahe `basenameNoExt` ergänzen:

```ts
/** Letztes Pfadsegment inkl. Extension (für Wikilink/Anzeige der Selbst-Quelle). */
export function basename(path: string): string { return path.slice(path.lastIndexOf("/") + 1); }

/** Baut das eine ImgItem für eine direkt geöffnete Medien-Datei (Selbst-Quelle).
 *  null, wenn sourcePath kein Bild/PDF ist. pageCount/existingTranscriptPath kommen
 *  von der Obsidian-Schicht (I/O); diese Funktion bleibt rein. */
export function buildSelfSourceItem(
  sourcePath: string,
  opts: { pageCount?: number; existingTranscriptPath?: string; pdfMaxPages: number },
): ImgItem | null {
  const ext = extOf(sourcePath);
  const cls = classifySource(ext);
  if (!cls) return null;
  const common = { raw: "", link: basename(sourcePath), ext, existingTranscriptPath: opts.existingTranscriptPath, embed: false, selfSource: true };
  if (cls === "pdf") {
    const pageCount = opts.pageCount ?? 0;
    const cappedTo = Math.min(pageCount, opts.pdfMaxPages);
    return { ...common, kind: "pdf", supported: pageCount > 0, pageCount, range: { from: 1, to: cappedTo > 0 ? cappedTo : 1 } };
  }
  return { ...common, kind: "image", supported: SUPPORTED_EXTS.includes(ext) };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run tests/img_to_md.test.ts`
Expected: PASS. Zusätzlich `npx tsc --noEmit` → keine Fehler (Type-Import + neues Feld sauber).

- [ ] **Step 5: Commit**

```bash
git add src/img_to_md.ts src/img_to_md_state.ts tests/img_to_md.test.ts
git commit -m "feat(core): buildSelfSourceItem + ImgItem.selfSource für die aktive Datei als Quelle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: i18n `view.thisFile` + View-Label in `renderList`

**Files:**
- Modify: `src/i18n.ts` (neuer Key EN+DE)
- Modify: `src/img_to_md_view.ts` (`renderList`, Zeile ~168)
- Test: `tests/i18n.test.ts`, `tests/img_to_md_view.test.ts`

**Interfaces:**
- Consumes: `ImgItem.selfSource` (Task 6), `t()`.
- Produces: i18n-Key `view.thisFile`; eine Listenzeile mit `item.selfSource:true` rendert das „diese Datei"-Label (CSS-Klasse `img2md-linked`, wie das `view.linked`-Badge).

- [ ] **Step 1: Failing tests**

In `tests/i18n.test.ts` ergänzen:

```ts
it("view.thisFile EN/DE", () => {
  setLang("en"); expect(t("view.thisFile")).toBe("this file");
  setLang("de"); expect(t("view.thisFile")).toBe("diese Datei");
});
```

In `tests/img_to_md_view.test.ts` ergänzen (Muster wie bestehende renderList-Tests mit `mkView({ scan })`):

```ts
it("selfSource-Item rendert das 'diese Datei'-Label statt 'verlinkt'", async () => {
  const item = { raw: "", link: "scan.png", ext: "png", supported: true, kind: "image", embed: false, selfSource: true };
  const { view } = mkView({ scan: async () => [item] as any });
  await view.onOpen();
  const el = (view as any).containerEl as HTMLElement;
  expect(el.querySelector(".img2md-linked")?.textContent).toBe("this file");
});
```

> Den genauen Zugriff auf das gerenderte Root-Element (`containerEl`/`contentEl`) an die bestehenden View-Tests angleichen; falls dort bereits ein Helfer das gerenderte DOM liefert, denselben verwenden.

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run tests/i18n.test.ts tests/img_to_md_view.test.ts -t "thisFile|diese Datei"`
Expected: FAIL (Key fehlt → Fallback liefert den Key; Label nicht gerendert).

- [ ] **Step 3: Implementieren**

In `src/i18n.ts` in der **EN**-Map direkt nach `"view.linked": "linked",` ergänzen:

```ts
  "view.thisFile": "this file",
```

und in der **DE**-Map nach dem dortigen `"view.linked": …` ergänzen:

```ts
  "view.thisFile": "diese Datei",
```

In `src/img_to_md_view.ts` die `renderList`-Zeile (aktuell `if (item.embed === false) row.createEl(...view.linked...)`) ersetzen durch:

```ts
      if (item.selfSource) row.createEl("span", { cls: "img2md-linked", text: t("view.thisFile") });
      else if (item.embed === false) row.createEl("span", { cls: "img2md-linked", text: t("view.linked") });
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run tests/i18n.test.ts tests/img_to_md_view.test.ts`
Expected: PASS (neue + alle bestehenden View-/i18n-Tests grün).

- [ ] **Step 5: Commit**

```bash
git add src/i18n.ts src/img_to_md_view.ts tests/i18n.test.ts tests/img_to_md_view.test.ts
git commit -m "feat(view): 'diese Datei'-Label für Selbst-Quelle-Items (i18n view.thisFile)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `main.ts`-Integration (Scan-Verzweigung, Stream, getNewFileParent)

**Files:**
- Modify: `src/main.ts` (`makeImgViewDeps`: `scan`, `transcribeStream`, `writeTranscripts`, `writePdf`)

**Interfaces:**
- Consumes: `classifySource`, `extOf`, `buildSelfSourceItem` (Tasks 1/6), `writeTranscripts(…, opts)` (Task 4), `writePdfTranscript(…, opts)` (Task 5), `findExistingTranscript`, `pdfPageCount`, `app.fileManager.getNewFileParent`.
- Produces: kein neues Interface — verdrahtet die getesteten Kern-Bausteine. **Kein Unit-Test** (main.ts lädt `obsidian`, wird im Repo nicht direkt getestet — wie der bestehende Embed-Scan). Verifikation: `tsc` + `lint` + alle Tests grün + empirisch in Obsidian.

- [ ] **Step 1: Imports ergänzen**

In `src/main.ts` die Imports aus `./img_to_md` um `classifySource, extOf, buildSelfSourceItem` und aus `./pdf_render` um `pdfPageCount` (ist bereits importiert) erweitern:

```ts
import { runImgToMd, findImageEmbeds, ImgToMdIO, writeTranscripts, SUPPORTED_EXTS, classifySource, extOf, buildSelfSourceItem } from "./img_to_md";
```

- [ ] **Step 2: `scan` um den Selbst-Quelle-Zweig erweitern**

In `makeImgViewDeps()` den Anfang von `scan` (vor `let content: string; try { content = await … }`) ergänzen:

```ts
      scan: async (sourcePath: string): Promise<ImgItem[]> => {
        const lookup = this.backlinkLookup();
        const cls = classifySource(extOf(sourcePath));
        if (cls) {   // aktive Datei IST ein Bild/PDF → Selbst-Quelle
          const existingTranscriptPath = findExistingTranscript(lookup, sourcePath) ?? undefined;
          let pageCount: number | undefined;
          if (cls === "pdf") {
            try { pageCount = await pdfPageCount(await this.app.vault.adapter.readBinary(sourcePath)); } catch { pageCount = 0; }
          }
          const item = buildSelfSourceItem(sourcePath, { pageCount, existingTranscriptPath, pdfMaxPages: this.settings.pdfMaxPages });
          return item ? [item] : [];
        }
        let content: string;
        try { content = await this.app.vault.adapter.read(sourcePath); } catch { return []; }
        const seen = new Set<string>();
        const items: ImgItem[] = [];
        for (const e of findImageEmbeds(content)) {
          // … bestehender Loop unverändert (lookup wird oben schon erzeugt) …
        }
        return items;
      },
```

> Achtung: `const lookup = this.backlinkLookup();` wird nach oben gezogen — die bestehende Deklaration im Loop-Vorlauf entfernen, damit `lookup` nicht doppelt deklariert ist.

- [ ] **Step 3: `transcribeStream` für Selbst-Quelle**

`transcribeStream` so anpassen, dass bei `item.selfSource` direkt `sourcePath` gelesen wird:

```ts
      transcribeStream: async (sourcePath, item, onContent, onReasoning, signal, page) => {
        let filePath: string; let ext: string;
        if (item.selfSource) { filePath = sourcePath; ext = item.ext; }
        else {
          const resolved = this.app.metadataCache.getFirstLinkpathDest(item.link, sourcePath);
          if (!resolved) throw new Error(t("core.imageNotFound", item.link));
          filePath = resolved.path; ext = resolved.extension;
        }
        let dataUrl: string;
        if (item.kind === "pdf") {
          if ((item.range?.to ?? 1) - (item.range?.from ?? 1) + 1 > this.settings.pdfMaxPages) {
            throw new Error(t("core.pdfTooManyPages", item.pageCount ?? 0, this.settings.pdfMaxPages));
          }
          const scale = Platform.isMobile ? Math.min(this.settings.pdfRenderScale, 1.5) : this.settings.pdfRenderScale;
          const bytes = await this.app.vault.adapter.readBinary(filePath);
          dataUrl = await renderPdfPage(bytes, page ?? 1, scale);
        } else {
          dataUrl = `data:image/${this.mimeOf(ext)};base64,${arrayBufferToBase64(await this.app.vault.adapter.readBinary(filePath))}`;
        }
        return this.visionClient.transcribeStream(dataUrl, this.settings.visionPrompt, onContent, onReasoning, signal);
      },
```

- [ ] **Step 4: `writeTranscripts`/`writePdf`-Deps: `selfSource` + `destDir` aus `sourcePath` ableiten**

```ts
      writeTranscripts: async (sourcePath, entries) => {
        const self = classifySource(extOf(sourcePath)) !== null;
        const destDir = self ? this.app.fileManager.getNewFileParent(sourcePath).path : undefined;
        const { paths } = await writeTranscripts(this.makeImgIO(), sourcePath, entries.map(e => ({ raw: e.item.raw, link: e.item.link, content: e.content, model: e.model, overwritePath: e.item.existingTranscriptPath, embed: e.item.embed })), { selfSource: self, destDir });
        return paths;
      },
      writePdf: async (sourcePath, raw, link, pages, overwritePath, embed) => {
        const self = classifySource(extOf(sourcePath)) !== null;
        const destDir = self ? this.app.fileManager.getNewFileParent(sourcePath).path : undefined;
        const { path } = await writePdfTranscript(this.makeImgIO(), sourcePath, { raw, link }, pages, this.settings.pdfPageSeparator, overwritePath, embed, { selfSource: self, destDir });
        return path;
      },
```

- [ ] **Step 5: Verifizieren (statt Unit-Test)**

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build
```
Expected: `tsc` 0 Fehler · `lint` 0/0 · **alle Tests grün** (Baseline 171 + neue) · Build erzeugt `main.js`.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts
git commit -m "feat(main): aktive PDF/Bild-Datei als Selbst-Quelle scannen, streamen, an getNewFileParent ablegen

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Abschluss (nach Task 8)

- [ ] **CHANGELOG + Doku:** `CHANGELOG.md` (neuer Eintrag „aktive Datei als Quelle"), `README.md`/`README.de.md` (Feature-Zeile), Diátaxis-Manual (`docs/manual/`), AGENTS.md (Modul-Layout-Notiz zu `buildSelfSourceItem`/Selbst-Quelle) nachziehen. Eigener Commit `docs: …`.
- [ ] **Whole-Branch-Review** (Repo-Standard): finaler opus-Review des gesamten Branch-Diffs vor dem Merge.
- [ ] **Empirische Verifikation in Obsidian** (`npm run deploy` → Pallas): PDF **und** Bild je ohne Quellnotiz öffnen → Sidebar zeigt „diese Datei" → (PDF: Seitenbereich) transkribieren → Notiz landet am `getNewFileParent`-Ort, **ohne** `source_note`, Quelldatei unangetastet; Datei erneut öffnen → „✓ vorhanden → öffnen", Override überschreibt.
- [ ] **Release** (optional, separate Entscheidung): `npm run version-bump 0.5.0` + Codeberg/GitHub-Release nach Memory `codeberg-release-gotcha`.

## Self-Review (vom Plan-Autor durchgeführt)

- **Spec-Coverage:** §3-Architektur → Tasks 1/6 (classifySource/buildSelfSourceItem) + 8 (scan/stream/getNewFileParent); §5-Schreibpfad → Tasks 2/3/4/5; §4-View-Label → Task 7; §2 Sidebar-only → Task 8 (kein Command/file-menu). Edge-Cases §5/§8: HEIC/0-Seiten-PDF (Task 6 Tests), kein Quell-Read/-Write (Tasks 4/5 Tests), `.md`/`.canvas` → keine Selbst-Quelle (Task 6 Test + Task 8 Zweig). Idempotenz/Override: bestehender Pfad, in Tasks 4/5 als unverändert abgesichert.
- **Placeholder-Scan:** keine TBD/TODO; alle Code-Steps mit vollständigem Code. Zwei Stellen erfordern eine kleine Verifikation des erwarteten i18n-Suffix-Werts (`note.suffix.*`) — explizit als Hinweis markiert, kein Platzhalter.
- **Type-Konsistenz:** `opts: { selfSource?, destDir? }` identisch in Tasks 4/5; `buildSelfSourceItem`-Signatur in Task 6 == Aufruf in Task 8; `transcriptNotePath(…, destDir?)` in Task 3 == Nutzung in Tasks 4/5; `classifySource`/`extOf`/`buildSelfSourceItem` in Task 1/6 exportiert == importiert in Task 8.
