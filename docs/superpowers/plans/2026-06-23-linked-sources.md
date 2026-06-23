# Verlinkte Quellen (Etappe 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reine Links auf Bilder/PDFs (`[[x.pdf]]`, `[text](x.pdf)` ohne `!`) als transkribierbare Quelle erkennen und dabei den Link im Quelltext unverändert lassen.

**Architecture:** Ein neues Flag `embed: boolean` reist durch die Kette (Erkennung → State → Schreiben). `true` = Embed (heutiges Verhalten, `replaceEmbed` ersetzt den Embed). `false` = reiner Link (neu: `createNote` ohne `replaceEmbed`, Quellnotiz unangetastet). Override (`overwritePath`, Etappe 1) bleibt davon unabhängig. Ein interner `stripFrontmatter`-Schnitt im Scan verhindert, dass `source_pdf`/`source_note`-Frontmatter-Links als Quelle erkannt werden.

**Tech Stack:** TypeScript (strict), esbuild, vitest + happy-dom, Obsidian Plugin API.

## Global Constraints

- TS strict + `noImplicitAny` — keine `any`-Casts für neue Typen.
- Nach jeder Task: `npm test` grün **und** `npx tsc --noEmit` sauber (vitest ≠ tsc).
- Nutzersichtbare Strings via `t()` aus `i18n.ts`; EN kanonisch, DE gepflegt.
- Commits: Conventional Commits (deutsche Beschreibung ok), **nur berührte Dateien stagen**, Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- `minAppVersion` 1.8.7; keine neuen Obsidian-APIs.
- `eslint` (inkl. `eslint-plugin-obsidianmd`) sauber (`npm run lint`).

## File Structure

- `src/img_to_md.ts` — `stripFrontmatter` (neu), `ImageEmbed.embed` (neu), `findImageEmbeds` (Regex `(!?)`), `writeTranscripts`/`runImgToMd` (embed-Verzweigung).
- `src/pdf_to_md.ts` — `writePdfTranscript` (Objekt-Param `embed`→`source`, neuer `embed`-Param, Verzweigung).
- `src/img_to_md_state.ts` — `ImgItem.embed` (neu, optional).
- `src/main.ts` — `scan()` reicht `embed` durch; `writeTranscripts`/`writePdf`-Closures reichen `embed` durch.
- `src/img_to_md_view.ts` — `ViewDeps.writePdf`-Signatur (+`embed`), `writeOne`/`writeAll`-Aufrufe, `renderList` „linked"-Badge.
- `src/i18n.ts` — `view.linked` (EN+DE).
- Tests: `tests/img_to_md.test.ts`, `tests/pdf_to_md.test.ts`, `tests/img_to_md_view.test.ts`.

---

### Task 1: `stripFrontmatter`-Helfer

**Files:**
- Modify: `src/img_to_md.ts` (neue exportierte Funktion, vor `findImageEmbeds`)
- Test: `tests/img_to_md.test.ts`

**Interfaces:**
- Produces: `export function stripFrontmatter(content: string): string`

- [ ] **Step 1: Failing test** — in `tests/img_to_md.test.ts` `stripFrontmatter` zum Import (Zeile 2) hinzufügen und Block ergänzen:

```ts
describe("stripFrontmatter", () => {
  it("entfernt führenden YAML-Block", () => {
    expect(stripFrontmatter("---\nsource_pdf: \"[[x.pdf]]\"\n---\nBody [[y.png]]")).toBe("Body [[y.png]]");
  });
  it("lässt Inhalt ohne Frontmatter unverändert", () => {
    expect(stripFrontmatter("kein FM [[a.png]]")).toBe("kein FM [[a.png]]");
  });
  it("greift nur am Anfang (--- mitten im Text bleibt)", () => {
    expect(stripFrontmatter("text\n---\na: 1\n---\n")).toBe("text\n---\na: 1\n---\n");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run tests/img_to_md.test.ts -t stripFrontmatter`
Expected: FAIL ("stripFrontmatter is not a function" / Import-Fehler).

- [ ] **Step 3: Implement** — in `src/img_to_md.ts` direkt vor `findImageEmbeds` (Zeile 21) einfügen:

```ts
/** Entfernt einen führenden YAML-Frontmatter-Block (---\n…\n---). Ohne Frontmatter unverändert.
 *  Schützt den Link-Scan davor, source_pdf/source_note-Wikilinks als Quelle zu erkennen. */
export function stripFrontmatter(content: string): string {
  const m = /^---\n[\s\S]*?\n---\n?/.exec(content);
  return m ? content.slice(m[0].length) : content;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run tests/img_to_md.test.ts -t stripFrontmatter`
Expected: PASS (3 Tests).

- [ ] **Step 5: Commit**

```bash
git add src/img_to_md.ts tests/img_to_md.test.ts
git commit -m "feat(linked): stripFrontmatter-Helfer (Loop-Schutz-Vorbereitung)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `findImageEmbeds` erkennt reine Links + `embed`-Flag

**Files:**
- Modify: `src/img_to_md.ts:7` (`ImageEmbed`), `src/img_to_md.ts:22-43` (`findImageEmbeds`)
- Test: `tests/img_to_md.test.ts`

**Interfaces:**
- Consumes: `stripFrontmatter` (Task 1)
- Produces: `ImageEmbed` mit zusätzlichem `embed: boolean`. `findImageEmbeds` erkennt nun auch reine Links (`[[x]]`, `[t](x)`) und setzt `embed = false` dafür, `true` für `![[x]]`/`![](x)`.

- [ ] **Step 1: Failing tests** — bestehende `toEqual`-Assertions in `describe("findImageEmbeds")` um `embed` ergänzen UND neue Fälle hinzufügen. Konkret (in `tests/img_to_md.test.ts`):
  - Zeile 9 `expect(r[0]).toEqual({ raw: "![[foto.jpg]]", link: "foto.jpg", ext: "jpg", kind: "image" });` → `…, kind: "image", embed: true });`
  - Zeile 19 `…toEqual({ raw: "![[doc.pdf]]", link: "doc.pdf", ext: "pdf", kind: "pdf", page: undefined });` → `…, page: undefined, embed: true });`
  - Neue Tests im selben `describe`:

```ts
it("erkennt reinen Wikilink (ohne !) als embed:false", () => {
  expect(findImageEmbeds("siehe [[scan.pdf]] dazu")[0]).toMatchObject({ link: "scan.pdf", kind: "pdf", embed: false });
});
it("erkennt reinen Markdown-Link (ohne !) als embed:false", () => {
  expect(findImageEmbeds("[Vertrag](akten/scan.png)")[0]).toMatchObject({ link: "akten/scan.png", kind: "image", embed: false });
});
it("liest #page=N auch aus reinem PDF-Wikilink", () => {
  expect(findImageEmbeds("[[doc.pdf#page=3]]")[0]).toMatchObject({ kind: "pdf", page: 3, embed: false });
});
it("Embed und reiner Link derselben Datei → zwei Treffer mit korrektem embed", () => {
  const r = findImageEmbeds("![[a.png]] und [[a.png]]");
  expect(r.map(e => e.embed)).toEqual([true, false]);
});
it("ignoriert externe URL auch als reinen Link", () => {
  expect(findImageEmbeds("[x](https://e.com/a.pdf)")).toEqual([]);
});
it("findet Bild/PDF-Links nicht im Frontmatter (Loop-Schutz)", () => {
  expect(findImageEmbeds("---\nsource_pdf: \"[[scan.pdf]]\"\n---\nText ohne Quelle")).toEqual([]);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run tests/img_to_md.test.ts -t findImageEmbeds`
Expected: FAIL (neue `embed`-Felder fehlen; reine Links werden nicht erkannt).

- [ ] **Step 3: Implement** — `ImageEmbed` (Zeile 7) erweitern:

```ts
export interface ImageEmbed { raw: string; link: string; ext: string; kind: "image" | "pdf"; page?: number; embed: boolean }
```

`findImageEmbeds` (Zeile 22-43) ersetzen durch:

```ts
/** Findet Bild-/PDF-Embeds UND reine Links: ![[x]] / [[x]] (Wikilink) und ![alt](p) / [t](p)
 *  (Markdown, externe http(s) aus). `embed` = true bei führendem `!`. Frontmatter wird ignoriert. */
export function findImageEmbeds(content: string): ImageEmbed[] {
  const body = stripFrontmatter(content);
  const out: ImageEmbed[] = [];
  let m: RegExpExecArray | null;
  const wiki = /(!?)\[\[([^\]]+?)\]\]/g;
  while ((m = wiki.exec(body)) !== null) {
    const embed = m[1] === "!";
    const inner = m[2];
    const link = inner.split("#")[0].split("|")[0].trim();
    const ext = extOf(link);
    if (IMAGE_EXTS.includes(ext)) out.push({ raw: m[0], link, ext, kind: "image", embed });
    else if (ext === PDF_EXT) out.push({ raw: m[0], link, ext, kind: "pdf", page: pageOf(inner), embed });
  }
  const md = /(!?)\[[^\]]*\]\(([^)]+?)\)/g;
  while ((m = md.exec(body)) !== null) {
    const embed = m[1] === "!";
    const target = m[2].trim();
    if (/^https?:\/\//i.test(target)) continue;
    const link = target.split("#")[0].trim();
    const ext = extOf(link);
    if (IMAGE_EXTS.includes(ext)) out.push({ raw: m[0], link, ext, kind: "image", embed });
    else if (ext === PDF_EXT) out.push({ raw: m[0], link, ext, kind: "pdf", page: pageOf(target), embed });
  }
  return out;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run tests/img_to_md.test.ts && npx tsc --noEmit`
Expected: `findImageEmbeds`-Tests PASS; tsc sauber. (Hinweis: `tsc` meldet evtl. weitere Stellen, die `ImageEmbed`-Literale ohne `embed` bauen — es gibt keine außer `findImageEmbeds` selbst; falls doch, dort `embed` ergänzen.)

- [ ] **Step 5: Commit**

```bash
git add src/img_to_md.ts tests/img_to_md.test.ts
git commit -m "feat(linked): findImageEmbeds erkennt reine Links + embed-Flag

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Schreibpfad Bild — `writeTranscripts` + `runImgToMd` belassen Links

**Files:**
- Modify: `src/img_to_md.ts:122-148` (`writeTranscripts`), `src/img_to_md.ts:162,176` (`runImgToMd`)
- Test: `tests/img_to_md.test.ts`

**Interfaces:**
- Consumes: `ImageEmbed.embed` (Task 2)
- Produces: `writeTranscripts`-entries akzeptieren optionales `embed?: boolean`. `embed === false` → `createNote` ohne `replaceEmbed`, Quellnotiz wird nicht geschrieben. Fehlt/`true` → heutiges Verhalten.

- [ ] **Step 1: Failing test** — im `describe("writeTranscripts")`-Block ergänzen:

```ts
it("embed:false legt Notiz an, lässt den Quell-Link aber unverändert", async () => {
  const { io, created, notes } = fakeIO({ notes: [["q.md", "siehe [[scan.png]] dazu"]] });
  const r = await writeTranscripts(io, "q.md", [
    { raw: "[[scan.png]]", link: "scan.png", content: "# T", model: "vm", embed: false },
  ]);
  expect(r.paths).toEqual(["scan (transcript).md"]);
  expect(created["scan (transcript).md"]).toContain("# T");
  expect(notes.get("q.md")).toBe("siehe [[scan.png]] dazu");   // Quelle unangetastet
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run tests/img_to_md.test.ts -t "embed:false legt Notiz"`
Expected: FAIL (Quelle wird via `replaceEmbed` doch geschrieben → `notes.get("q.md")` weicht ab; und TS-Fehler `embed` nicht im entries-Typ).

- [ ] **Step 3: Implement** — `writeTranscripts`-Signatur (Zeile 122-125) `entries`-Typ um `embed?: boolean` erweitern:

```ts
  entries: { raw: string; link: string; content: string; model: string; overwritePath?: string; embed?: boolean }[],
```

Zeile 143 `content = replaceEmbed(content, e.raw, basenameNoExt(newPath));` ersetzen durch:

```ts
    if (e.embed !== false) content = replaceEmbed(content, e.raw, basenameNoExt(newPath));
```

In `runImgToMd`: entries-Typ (Zeile 162) und `entries.push` (Zeile 176) um `embed` ergänzen:

```ts
  const entries: { raw: string; link: string; content: string; model: string; embed: boolean }[] = [];
```
```ts
    entries.push({ raw: e.raw, link: e.link, content: res.content, model: res.model, embed: e.embed });
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run tests/img_to_md.test.ts && npx tsc --noEmit`
Expected: alle PASS (inkl. bestehende `writeTranscripts`-Tests = Regression für `embed` undefined → Ersetzung wie heute); tsc sauber.

- [ ] **Step 5: Commit**

```bash
git add src/img_to_md.ts tests/img_to_md.test.ts
git commit -m "feat(linked): writeTranscripts/runImgToMd belassen Links (embed:false)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Schreibpfad PDF — `writePdfTranscript` belässt Links

**Files:**
- Modify: `src/pdf_to_md.ts:55-86` (`writePdfTranscript`)
- Test: `tests/pdf_to_md.test.ts`

**Interfaces:**
- Produces: `writePdfTranscript(io, sourcePath, source, pages, separator, overwritePath?, embed?)` — der frühere `embed: {raw, link}`-Parameter heißt jetzt `source`; neuer letzter Parameter `embed: boolean = true`. `embed === false` → `createNote` ohne `replaceEmbed`.

- [ ] **Step 1: Failing test** — in `tests/pdf_to_md.test.ts` im `writePdfTranscript`-Bereich ergänzen (nutzt `pdfIO`, Zeile 47):

```ts
it("embed:false legt PDF-Notiz an, lässt den Quell-Link unverändert", async () => {
  const { io, created, notes } = pdfIO("siehe [[doc.pdf]] dazu");
  const r = await writePdfTranscript(io, "q.md", { raw: "[[doc.pdf]]", link: "doc.pdf" },
    [{ page: 1, content: "A", model: "m" }], "comment", undefined, false);
  expect(r.path).toBe("doc (PDF transcript).md");
  expect(created["doc (PDF transcript).md"]).toBeDefined();
  expect(notes.get("q.md")).toBe("siehe [[doc.pdf]] dazu");   // Quelle unangetastet
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run tests/pdf_to_md.test.ts -t "embed:false legt PDF"`
Expected: FAIL (zu viele Argumente / `replaceEmbed` läuft trotzdem).

- [ ] **Step 3: Implement** — in `src/pdf_to_md.ts` die Signatur (Zeile 55-61) ändern: Parameter `embed` → `source` umbenennen, neuen `embed`-Parameter anhängen:

```ts
export async function writePdfTranscript(
  io: ImgToMdIO, sourcePath: string,
  source: { raw: string; link: string },
  pages: { page: number; content: string; model: string }[],
  separator: PdfPageSeparator,
  overwritePath?: string,
  embed = true,
): Promise<{ path: string | null }> {
```

Im Body alle `embed.link`/`embed.raw` zu `source.link`/`source.raw` umbenennen (Zeile 69, 74, 83) und den Quellnotiz-Schreibblock (Zeile 72, 83-84) konditional machen:

```ts
  if (overwritePath) {
    const old = await io.readNote(overwritePath);
    const body = buildPdfBody(kept.map(p => ({ page: p.page, text: p.content })), separator);
    await io.writeNote(overwritePath, rewriteTranscript(old, { model, sourceLink: source.link, body, pages: pagesStr }));
    return { path: overwritePath };
  }
  const sourceName = basenameNoExt(sourcePath);
  const resolved = io.resolveImage(source.link, sourcePath);
  const pdfPath = resolved?.path ?? source.link;
  const notePath = transcriptNotePath(io, sourcePath, pdfPath, "pdf");
  const content = buildPdfNote({
    pdfLink: source.link, sourceName, date: io.date(), model,
    pages: kept.map(p => ({ page: p.page, text: p.content })),
    rangeFrom: kept[0].page, rangeTo: kept[kept.length - 1].page, separator,
  });
  await io.createNote(notePath, content);
  if (embed) {
    const before = await io.readNote(sourcePath);
    const replaced = replaceEmbed(before, source.raw, basenameNoExt(notePath));
    if (replaced !== before) await io.writeNote(sourcePath, replaced);
  }
  return { path: notePath };
```

(Die ursprüngliche `const before = await io.readNote(sourcePath)` stand bisher direkt **nach** dem `if (overwritePath)`-Block (Zeile 72) und entfällt dort — `before` wird nur noch im `if (embed)`-Block gelesen.)

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run tests/pdf_to_md.test.ts && npx tsc --noEmit`
Expected: alle PASS (bestehende `writePdfTranscript`-Tests = Regression für `embed` default true); tsc sauber.

- [ ] **Step 5: Commit**

```bash
git add src/pdf_to_md.ts tests/pdf_to_md.test.ts
git commit -m "feat(linked): writePdfTranscript belässt Link bei embed:false

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `ImgItem.embed` + Scan/Closure-Verdrahtung

**Files:**
- Modify: `src/img_to_md_state.ts:3-12` (`ImgItem`), `src/main.ts:113,115` (`scan`), `src/main.ts:137` (`writeTranscripts`-Closure)
- Test: keine neuen Unit-Tests (Obsidian-Schicht/Typ-Verdrahtung); Gate = `npx tsc --noEmit` + alle bestehenden Tests grün.

**Interfaces:**
- Consumes: `ImageEmbed.embed` (Task 2), `writeTranscripts`-entries `embed` (Task 3)
- Produces: `ImgItem.embed?: boolean`. `scan()` setzt es aus `e.embed`; die Bild-Closure reicht es in die Kern-entries.

- [ ] **Step 1: `ImgItem` erweitern** — in `src/img_to_md_state.ts` (Zeile 3-12) nach `existingTranscriptPath?` ergänzen:

```ts
  existingTranscriptPath?: string;
  embed?: boolean;   // false = reiner Link (Quelltext bleibt); fehlt/true = Embed (heutiges Verhalten)
```

- [ ] **Step 2: `scan()` reicht `embed` durch** — in `src/main.ts` beide `items.push` (Zeile 113 PDF, Zeile 115 Bild) um `embed: e.embed` ergänzen:

```ts
            items.push({ raw: e.raw, link: e.link, ext: e.ext, supported, kind: "pdf", pageCount, range: { from: 1, to: cappedTo > 0 ? cappedTo : 1 }, existingTranscriptPath, embed: e.embed });
```
```ts
            items.push({ raw: e.raw, link: e.link, ext: e.ext, supported: SUPPORTED_EXTS.includes(e.ext.toLowerCase()), kind: "image", existingTranscriptPath, embed: e.embed });
```

- [ ] **Step 3: Bild-Closure reicht `embed`** — in `src/main.ts` `writeTranscripts`-Closure (Zeile 137) die `entries.map` um `embed` ergänzen:

```ts
        const { paths } = await writeTranscripts(this.makeImgIO(), sourcePath, entries.map(e => ({ raw: e.item.raw, link: e.item.link, content: e.content, model: e.model, overwritePath: e.item.existingTranscriptPath, embed: e.item.embed })));
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: tsc sauber; alle bestehenden Tests grün (kein Verhaltenswechsel an getesteten Pfaden — Bilder-Links werden nun belassen, PDFs folgen in Task 6).

- [ ] **Step 5: Commit**

```bash
git add src/img_to_md_state.ts src/main.ts
git commit -m "feat(linked): ImgItem.embed + scan/Bild-Closure-Verdrahtung

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: View — „linked"-Badge, i18n, PDF-Closure-`embed`

**Files:**
- Modify: `src/i18n.ts:79` (+`view.linked` EN), DE-Block (`view.transcriptExists`-Gegenstück + `view.linked`), `src/img_to_md_view.ts:12` (`writePdf`-Signatur), `src/img_to_md_view.ts:211,232` (Aufrufe), `src/img_to_md_view.ts:120-123` (renderList Bild-Zweig), `src/main.ts:140-143` (`writePdf`-Closure)
- Test: `tests/img_to_md_view.test.ts`

**Interfaces:**
- Consumes: `ImgItem.embed` (Task 5), `writePdfTranscript`-`embed` (Task 4)
- Produces: Link-Items rendern Badge `img2md-linked`; `ViewDeps.writePdf` nimmt `embed?: boolean` als letzten Parameter.

- [ ] **Step 1: i18n-Keys** — in `src/i18n.ts` im EN-Block nach `"view.overwriteHint"` (Zeile 79) ergänzen:

```ts
  "view.linked": "linked",
```
und im DE-Block an gleicher Stelle (nach dem DE-`view.overwriteHint` = „erneut transkribieren überschreibt", ~Zeile 159):

```ts
  "view.linked": "verlinkt",
```

- [ ] **Step 2: Failing View-Test** — in `tests/img_to_md_view.test.ts` ergänzen (nutzt `mkView`/`all`, Zeile 18/6):

```ts
it("rendert 'linked'-Badge nur für reine Links (embed:false)", async () => {
  const items: ImgItem[] = [
    { raw: "![[a.png]]", link: "a.png", ext: "png", supported: true, kind: "image", embed: true },
    { raw: "[[b.png]]", link: "b.png", ext: "png", supported: true, kind: "image", embed: false },
  ];
  const { view } = mkView({ scan: async () => items });
  await view.onOpen();
  const badges = all(view.contentEl, "img2md-linked");
  expect(badges.length).toBe(1);
  expect(badges[0].textContent).toContain("linked");
});
```

- [ ] **Step 3: Run, verify fail**

Run: `npx vitest run tests/img_to_md_view.test.ts -t "linked'-Badge"`
Expected: FAIL (kein `img2md-linked`-Element).

- [ ] **Step 4: renderList-Badge** — in `src/img_to_md_view.ts` den Bild-Zweig (Zeile 120-123) um den Badge ergänzen; er gilt für Bild UND PDF, daher nach dem `if (item.kind === "pdf") {…} else {…}`-Block, vor dem `existingTranscriptPath`-Block (Zeile 124). Direkt vor `if (item.existingTranscriptPath) {` einfügen:

```ts
      if (item.embed === false) row.createEl("span", { cls: "img2md-linked", text: t("view.linked") });
```

- [ ] **Step 5: `writePdf`-Signatur + Aufrufe + Closure** —
  `src/img_to_md_view.ts` ViewDeps (Zeile 12) erweitern:

```ts
  writePdf: (sourcePath: string, raw: string, link: string, pages: { page: number; content: string; model: string }[], overwritePath?: string, embed?: boolean) => Promise<string | null>;
```

  Aufrufe in `writeOne` (Zeile 211) und `writeAll` (Zeile 232) um `g.item.embed` ergänzen:

```ts
        const created = await this.deps.writePdf(path, g.raw, g.link, g.pages.map(p => ({ page: p.page, content: p.content.trim(), model: p.model })), g.item.existingTranscriptPath, g.item.embed);
```

  `src/main.ts` `writePdf`-Closure (Zeile 140-143):

```ts
      writePdf: async (sourcePath, raw, link, pages, overwritePath, embed) => {
        const { path } = await writePdfTranscript(this.makeImgIO(), sourcePath, { raw, link }, pages, this.settings.pdfPageSeparator, overwritePath, embed);
        return path;
      },
```

- [ ] **Step 6: Run, verify pass**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: alle PASS; tsc + eslint sauber.

- [ ] **Step 7: Commit**

```bash
git add src/i18n.ts src/img_to_md_view.ts src/main.ts tests/img_to_md_view.test.ts
git commit -m "feat(linked): View-Badge 'linked' + PDF-Closure reicht embed durch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Styling + Doku-Nachzug

**Files:**
- Modify: `styles.css` (`.img2md-linked`), `CHANGELOG.md`, `docs/manual/reference.md`, `docs/manual/how-to.md`
- Test: keine (CSS/Doku)

- [ ] **Step 1: CSS** — in `styles.css` analog zu `.img2md-exists` eine dezente Badge-Regel ergänzen (gleiche Optik wie der „vorhanden"-Badge, ggf. andere Farbe). Beispiel:

```css
.img2md-linked { font-size: var(--font-ui-smaller); color: var(--text-muted); margin-left: 0.4em; }
```

(Vorher den bestehenden `.img2md-exists`-Block in `styles.css` ansehen und Stil/Variable übernehmen.)

- [ ] **Step 2: CHANGELOG** — unter `## [Unreleased]` (oder einen neuen `### Hinzugefügt`-Block über `[0.3.0]`) ergänzen:

```markdown
- **Verlinkte Quellen:** reine Links auf Bilder/PDFs (`[[x.pdf]]`, `[text](x.pdf)` ohne `!`) werden
  jetzt ebenfalls als Quelle erkannt und transkribiert; der Link im Text bleibt dabei unverändert
  (im Gegensatz zu Embeds, die durch das Transkript ersetzt werden). Sidebar markiert solche Einträge
  mit „linked".
```

- [ ] **Step 3: Manual** — in `docs/manual/reference.md` (Abschnitt zur Sidebar/Embed-Erkennung) und `docs/manual/how-to.md` (PDF/Bild-Recipe) je einen Satz ergänzen: reine Links werden erkannt, der Link bleibt erhalten, Badge „linked". Exakte EN-/DE-Labels aus `i18n.ts` (`view.linked`).

- [ ] **Step 4: Verify**

Run: `npm run build`
Expected: Build ok (CSS valide).

- [ ] **Step 5: Commit**

```bash
git add styles.css CHANGELOG.md docs/manual/reference.md docs/manual/how-to.md
git commit -m "docs+style(linked): 'linked'-Badge-Style + CHANGELOG/Manual

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Definition of Done (aus der Spec)

- [ ] `findImageEmbeds` erkennt Embeds **und** reine Links (Wikilink + Markdown, Bild + PDF) mit korrektem `embed`-Flag; externe URLs/Nicht-Medien ausgeschlossen; `#page=N` respektiert. *(Task 2)*
- [ ] `stripFrontmatter` implementiert + getestet; Frontmatter-Links nicht als Quelle erkannt. *(Task 1+2)*
- [ ] `embed:false` → neue Transkript-Notiz **ohne** `replaceEmbed`/Quellnotiz-Schreibung; `embed:true` + Override unverändert. *(Task 3+4)*
- [ ] Sidebar zeigt „linked"-Badge; Auswahl/Default unverändert. *(Task 5+6)*
- [ ] Alle Alt-Tests grün; neue Tests grün; `tsc`/`eslint` sauber. *(jede Task)*
- [ ] Empirisch in Obsidian: `[[scan.pdf]]` (reiner Link) → transkribieren → Link bleibt, neue Notiz, Re-Scan „✓ vorhanden"; `![[scan.pdf]]` → unverändertes Ersetzungs-Verhalten. *(nach Merge, Handover)*
