# Backlink-Idempotenz + Override (Slice 2, Etappe 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Erkennen, ob für eine Quelle (Bild/PDF) bereits eine Transkript-Notiz existiert (Backlink + Frontmatter), das in der Sidebar anzeigen („✓ vorhanden → öffnen", Checkbox default aus), und Override ermöglichen (bestehende Notiz überschreiben statt zweite anlegen).

**Architecture:** Neue reine Funktion `findExistingTranscript(lookup, sourcePath)` über ein injiziertes `BacklinkLookup` (app-frei testbar). `scan()` hängt `existingTranscriptPath` an jedes Quell-Item. Override-Schreibpfad via `rewriteTranscript` (erhält das komplette Frontmatter, ersetzt `transcribed_by`/`pages` + Body) statt `createNote`+`replaceEmbed`.

**Tech Stack:** TypeScript (strict), vitest + happy-dom, Obsidian Plugin API (`metadataCache.resolvedLinks` / `frontmatterLinks` / `getFirstLinkpathDest` — alle `@public`).

## Global Constraints

- **TS strict + `noImplicitAny`** — kein `any` in neuem Produktionscode (Test-Mocks dürfen `any`).
- **Reiner Kern obsidian-/DOM-frei:** `backlinks.ts`, `img_to_md.ts`, `img_to_md_state.ts`, `pdf_to_md.ts`, `i18n.ts` bleiben Node-testbar. Nur `main.ts`/`img_to_md_view.ts`/`settings.ts`/`http.ts`/`pdf_render.ts` importieren `obsidian`/DOM.
- **Backlink-API ausschließlich `@public`:** `app.metadataCache.resolvedLinks`, `getFileCache(f).frontmatterLinks` (`{ key, link }`), `getFirstLinkpathDest`. **Nicht** `getBacklinksForFile` (nicht in der API). `minAppVersion` bleibt `1.8.7`.
- **Idempotenz-Filter ist load-bearing:** Eine Notiz zählt nur als Transkript, wenn ihr Frontmatter-Key (`source_pdf`/`source_image`, Präfix vor erstem `.`) auf die Quelle auflöst — NICHT schon, weil sie die Quelle im Body embeddet.
- **Override ist nicht-destruktiv an der Quelle:** kein `replaceEmbed`, die gescannte Notiz wird beim Override nicht verändert; nur die bestehende Transkript-Notiz wird überschrieben.
- **i18n via `t()`**, EN kanonisch + DE gespiegelt.
- **Tests:** alle bestehenden 131 Tests grün; `npm run typecheck` + `npm run lint` (inkl. `eslint-plugin-obsidianmd`) sauber.
- **Commits:** Conventional Commits, nur berührte Dateien stagen, Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## Task 1: `findExistingTranscript` + `BacklinkLookup`

**Files:**
- Create: `src/backlinks.ts`
- Test: `tests/backlinks.test.ts`

**Interfaces:**
- Produces: `interface BacklinkLookup { resolvedLinks: Record<string, Record<string, number>>; frontmatterLinks(notePath: string): { key: string; link: string }[]; resolveLink(link: string, fromPath: string): string | null }`; `findExistingTranscript(lookup: BacklinkLookup, sourcePath: string): string | null`.

- [ ] **Step 1: Failing test**

Create `tests/backlinks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { findExistingTranscript, BacklinkLookup } from "../src/backlinks";

function lookup(o: Partial<BacklinkLookup> = {}): BacklinkLookup {
  return {
    resolvedLinks: o.resolvedLinks ?? {},
    frontmatterLinks: o.frontmatterLinks ?? (() => []),
    resolveLink: o.resolveLink ?? (() => null),
  };
}

describe("findExistingTranscript", () => {
  it("findet Notiz, deren source_pdf-Frontmatter auf die Quelle zeigt", () => {
    const l = lookup({
      resolvedLinks: { "doc (PDF-Transkript).md": { "doc.pdf": 1 } },
      frontmatterLinks: (n) => n === "doc (PDF-Transkript).md" ? [{ key: "source_pdf", link: "doc.pdf" }] : [],
      resolveLink: (link) => link === "doc.pdf" ? "doc.pdf" : null,
    });
    expect(findExistingTranscript(l, "doc.pdf")).toBe("doc (PDF-Transkript).md");
  });
  it("ignoriert Notiz, die die Quelle nur im Body embeddet (kein source_*-Frontmatter)", () => {
    const l = lookup({
      resolvedLinks: { "andere.md": { "doc.pdf": 1 } },
      frontmatterLinks: () => [],
      resolveLink: () => "doc.pdf",
    });
    expect(findExistingTranscript(l, "doc.pdf")).toBe(null);
  });
  it("behandelt Array-Key source_pdf.0", () => {
    const l = lookup({
      resolvedLinks: { "t.md": { "x.pdf": 1 } },
      frontmatterLinks: () => [{ key: "source_pdf.0", link: "x.pdf" }],
      resolveLink: () => "x.pdf",
    });
    expect(findExistingTranscript(l, "x.pdf")).toBe("t.md");
  });
  it("source_image analog", () => {
    const l = lookup({
      resolvedLinks: { "t.md": { "b.png": 1 } },
      frontmatterLinks: () => [{ key: "source_image", link: "b.png" }],
      resolveLink: () => "b.png",
    });
    expect(findExistingTranscript(l, "b.png")).toBe("t.md");
  });
  it("ignoriert fremde Frontmatter-Keys (z.B. up)", () => {
    const l = lookup({
      resolvedLinks: { "t.md": { "doc.pdf": 1 } },
      frontmatterLinks: () => [{ key: "up", link: "doc.pdf" }],
      resolveLink: () => "doc.pdf",
    });
    expect(findExistingTranscript(l, "doc.pdf")).toBe(null);
  });
  it("null wenn keine Notiz auf die Quelle verlinkt", () => {
    expect(findExistingTranscript(lookup(), "doc.pdf")).toBe(null);
  });
});
```

- [ ] **Step 2: Run — FAIL** (`npx vitest run tests/backlinks.test.ts` → „findExistingTranscript is not defined").

- [ ] **Step 3: Implement**

Create `src/backlinks.ts`:

```ts
/** Schmales Lookup-Interface (von der Obsidian-Schicht injiziert), damit die Kernlogik app-frei testbar ist. */
export interface BacklinkLookup {
  /** app.metadataCache.resolvedLinks: notePath → { targetPath → count }. */
  resolvedLinks: Record<string, Record<string, number>>;
  /** Frontmatter-Links einer Notiz (getFileCache(f).frontmatterLinks): { key, link }. */
  frontmatterLinks(notePath: string): { key: string; link: string }[];
  /** Wikilink → Zielpfad relativ zur Notiz (getFirstLinkpathDest). null wenn unauflösbar. */
  resolveLink(link: string, fromPath: string): string | null;
}

const SOURCE_KEYS = ["source_pdf", "source_image"];

/** Pfad einer existierenden Transkript-Notiz für `sourcePath`, oder null.
 *  Tragend: nur Notizen mit source_pdf/source_image-Frontmatter, das auf sourcePath auflöst,
 *  zählen — der bloße resolvedLinks-Treffer (Body-Embed) genügt NICHT. */
export function findExistingTranscript(lookup: BacklinkLookup, sourcePath: string): string | null {
  for (const notePath of Object.keys(lookup.resolvedLinks)) {
    const targets = lookup.resolvedLinks[notePath];
    if (!targets || !(sourcePath in targets)) continue;
    for (const fl of lookup.frontmatterLinks(notePath)) {
      const baseKey = fl.key.split(".")[0];
      if (!SOURCE_KEYS.includes(baseKey)) continue;
      if (lookup.resolveLink(fl.link, notePath) === sourcePath) return notePath;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run — PASS** (`npx vitest run tests/backlinks.test.ts`).
- [ ] **Step 5: Commit**

```bash
git add src/backlinks.ts tests/backlinks.test.ts
git commit -m "feat(backlinks): findExistingTranscript — Backlink+Frontmatter-Idempotenz-Check

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Override-Helfer `rewriteTranscript` + `buildPdfBody`

**Files:**
- Modify: `src/img_to_md.ts` (neue Funktion `rewriteTranscript`)
- Modify: `src/pdf_to_md.ts` (`buildPdfBody` aus `buildPdfNote` extrahieren + exportieren)
- Test: `tests/img_to_md.test.ts`, `tests/pdf_to_md.test.ts`

**Interfaces:**
- Produces: `rewriteTranscript(old: string, o: { model: string; sourceLink: string; body: string; pages?: string }): string` (in `img_to_md.ts`); `buildPdfBody(pages: PdfPageTranscript[], separator: PdfPageSeparator): string` (in `pdf_to_md.ts`).

- [ ] **Step 1: Failing tests**

In `tests/img_to_md.test.ts` ergänzen (Import `rewriteTranscript` aus `../src/img_to_md`):

```ts
describe("rewriteTranscript", () => {
  it("erhält source_*/source_note/created, ersetzt transcribed_by + Body, kein doppeltes Frontmatter", () => {
    const old = `---\nsource_image: "[[b.png]]"\nsource_note: "[[Quelle]]"\ncreated: 2026-01-01\ntranscribed_by: "alt"\n---\n![[b.png]]\n\nALTER TEXT\n`;
    const out = rewriteTranscript(old, { model: "neu", sourceLink: "b.png", body: "NEUER TEXT" });
    expect(out).toContain('source_image: "[[b.png]]"');
    expect(out).toContain('source_note: "[[Quelle]]"');
    expect(out).toContain("created: 2026-01-01");
    expect(out).toContain('transcribed_by: "neu"');
    expect(out).not.toContain('transcribed_by: "alt"');
    expect(out).toContain("![[b.png]]");
    expect(out).toContain("NEUER TEXT");
    expect(out).not.toContain("ALTER TEXT");
    expect(out.match(/^---$/gm)?.length).toBe(2);
  });
  it("ersetzt vorhandenes pages bei PDF-Override", () => {
    const old = `---\nsource_pdf: "[[d.pdf]]"\ncreated: 2026-01-01\ntranscribed_by: "alt"\npages: "1-2"\n---\n![[d.pdf]]\n\nX\n`;
    const out = rewriteTranscript(old, { model: "neu", sourceLink: "d.pdf", body: "Y", pages: "1-5" });
    expect(out).toContain('pages: "1-5"');
    expect(out).not.toContain('pages: "1-2"');
  });
});
```

In `tests/pdf_to_md.test.ts` ergänzen (Import `buildPdfBody`):

```ts
describe("buildPdfBody", () => {
  it("baut nur die Seiten-Blöcke (ohne Frontmatter/Embed)", () => {
    const body = buildPdfBody([{ page: 1, text: "A" }, { page: 2, text: "B" }], "comment");
    expect(body).toContain("%% Page 1 %%");
    expect(body).toContain("A");
    expect(body).toContain("%% Page 2 %%");
    expect(body).not.toContain("source_pdf");
    expect(body).not.toContain("![[");
  });
});
```

- [ ] **Step 2: Run — FAIL** (beide neuen describe-Blöcke rot).

- [ ] **Step 3: Implement**

In `src/img_to_md.ts` nach `buildTranscriptNote` einfügen:

```ts
/** Override: erhält das komplette Frontmatter der alten Notiz, ersetzt transcribed_by (+ pages bei PDF)
 *  und den Body. Quelle/Quellnotiz/created bleiben damit unverändert. */
export function rewriteTranscript(old: string, o: { model: string; sourceLink: string; body: string; pages?: string }): string {
  const esc = (s: string) => s.replace(/"/g, '\\"');
  const fm = /^---\n([\s\S]*?)\n---/.exec(old);
  // Fallback nur theoretisch — Override wirkt ausschließlich auf unsere Transkript-Notizen, die immer Frontmatter haben.
  let frontmatter = fm ? fm[1] : `transcribed_by: "${esc(o.model)}"`;
  frontmatter = frontmatter.replace(/^transcribed_by:.*$/m, `transcribed_by: "${esc(o.model)}"`);
  if (o.pages !== undefined) {
    frontmatter = /^pages:.*$/m.test(frontmatter)
      ? frontmatter.replace(/^pages:.*$/m, `pages: "${o.pages}"`)
      : `${frontmatter}\npages: "${o.pages}"`;
  }
  return `---\n${frontmatter}\n---\n![[${o.sourceLink}]]\n\n${o.body}\n`;
}
```

In `src/pdf_to_md.ts` `buildPdfNote` so umbauen, dass es `buildPdfBody` nutzt (Verhalten unverändert), und `buildPdfBody` exportieren:

```ts
/** Nur die Seiten-Blöcke (ohne Frontmatter/Embed), getrennt gemäß separator. */
export function buildPdfBody(pages: PdfPageTranscript[], separator: PdfPageSeparator): string {
  return pages
    .filter(p => p.text.trim())
    .map(p => `${pagePrefix(separator, p.page)}${p.text.trim()}`)
    .join(pageGap(separator));
}
```
…und in `buildPdfNote` die `const body = …`-Zeile ersetzen durch `const body = buildPdfBody(o.pages, o.separator);`.

- [ ] **Step 4: Run — PASS** (`npm test`).
- [ ] **Step 5: Typecheck + Lint + Commit**

```bash
npm run typecheck && npm run lint
git add src/img_to_md.ts src/pdf_to_md.ts tests/img_to_md.test.ts tests/pdf_to_md.test.ts
git commit -m "feat(override): rewriteTranscript (Frontmatter erhalten) + buildPdfBody extrahiert

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Override in `writeTranscripts` (Bild)

**Files:**
- Modify: `src/img_to_md.ts:104-124` (`writeTranscripts`)
- Test: `tests/img_to_md.test.ts`

**Interfaces:**
- Consumes: `rewriteTranscript` (Task 2).
- Produces: `writeTranscripts(io, sourcePath, entries: { raw; link; content; model; overwritePath? }[])` — `overwritePath` gesetzt → bestehende Notiz überschreiben, kein `replaceEmbed`.

- [ ] **Step 1: Failing test** — in `tests/img_to_md.test.ts` `describe("writeTranscripts")` ergänzen:

```ts
it("Override: überschreibt bestehende Notiz, erhält Frontmatter, Quelle unverändert", async () => {
  const { io, notes } = fakeIO({ notes: [
    ["q.md", "![[b.png]]"],
    ["b (transcript).md", `---\nsource_image: "[[b.png]]"\nsource_note: "[[Orig]]"\ncreated: 2026-01-01\ntranscribed_by: "alt"\n---\n![[b.png]]\n\nALT\n`],
  ] });
  const r = await writeTranscripts(io, "q.md", [
    { raw: "![[b.png]]", link: "b.png", content: "NEU", model: "neu", overwritePath: "b (transcript).md" },
  ]);
  expect(r.paths).toEqual(["b (transcript).md"]);
  expect(notes.get("b (transcript).md")).toContain("NEU");
  expect(notes.get("b (transcript).md")).toContain("created: 2026-01-01");
  expect(notes.get("b (transcript).md")).toContain('transcribed_by: "neu"');
  expect(notes.get("q.md")).toBe("![[b.png]]");  // kein Embed-Ersatz
});
```

(Hinweis: `fakeIO` setzt `notes` via Map; `writeNote` aktualisiert sie — vorhandenes Helper-Verhalten genügt.)

- [ ] **Step 2: Run — FAIL** (Override-Pfad existiert nicht; `overwritePath` ist unbekanntes Feld → ggf. TS-Fehler erst nach Impl behoben).

- [ ] **Step 3: Implement** — `writeTranscripts` Signatur + Schleife (`src/img_to_md.ts`):

```ts
export async function writeTranscripts(
  io: ImgToMdIO, sourcePath: string,
  entries: { raw: string; link: string; content: string; model: string; overwritePath?: string }[],
): Promise<{ paths: string[] }> {
  const before = await io.readNote(sourcePath);
  let content = before;
  const sourceName = basenameNoExt(sourcePath);
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
    const resolved = io.resolveImage(e.link, sourcePath);
    const imagePath = resolved?.path ?? e.link;
    const newPath = transcriptNotePath(io, sourcePath, imagePath, "image");
    await io.createNote(newPath, buildTranscriptNote({ imageLink: e.link, sourceName, date: io.date(), model: e.model, transcript }));
    content = replaceEmbed(content, e.raw, basenameNoExt(newPath));
    paths.push(newPath);
  }
  if (content !== before) await io.writeNote(sourcePath, content);
  return { paths };
}
```

- [ ] **Step 4: Run — PASS** (`npm test`).
- [ ] **Step 5: Commit**

```bash
git add src/img_to_md.ts tests/img_to_md.test.ts
git commit -m "feat(override): writeTranscripts überschreibt bei overwritePath (Bild)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Override in `writePdfTranscript`

**Files:**
- Modify: `src/pdf_to_md.ts` (`writePdfTranscript`)
- Test: `tests/pdf_to_md.test.ts`

**Interfaces:**
- Consumes: `rewriteTranscript` (Task 2), `buildPdfBody` (Task 2).
- Produces: `writePdfTranscript(io, sourcePath, embed, pages, separator, overwritePath?)` — `overwritePath` gesetzt → bestehende Notiz überschreiben, kein `replaceEmbed`.

- [ ] **Step 1: Failing test** — in `tests/pdf_to_md.test.ts` `describe("writePdfTranscript")` ergänzen:

```ts
it("Override: überschreibt bestehende PDF-Notiz, neue pages, Quelle unverändert", async () => {
  const notes = new Map<string, string>([
    ["q.md", "![[doc.pdf]]"],
    ["doc (PDF transcript).md", `---\nsource_pdf: "[[doc.pdf]]"\ncreated: 2026-01-01\ntranscribed_by: "alt"\npages: "1-1"\n---\n![[doc.pdf]]\n\nALT\n`],
  ]);
  const created: Record<string, string> = {};
  const io: any = {
    date: () => "2026-06-23",
    readNote: async (p: string) => notes.get(p) ?? "",
    writeNote: async (p: string, c: string) => { notes.set(p, c); },
    createNote: async (p: string, c: string) => { created[p] = c; notes.set(p, c); },
    noteExists: (p: string) => notes.has(p),
    resolveImage: (l: string) => ({ path: l, ext: "pdf" }),
  };
  const r = await writePdfTranscript(io, "q.md", { raw: "![[doc.pdf]]", link: "doc.pdf" }, [
    { page: 1, content: "A", model: "neu" }, { page: 2, content: "B", model: "neu" },
  ], "comment", "doc (PDF transcript).md");
  expect(r.path).toBe("doc (PDF transcript).md");
  expect(Object.keys(created)).toEqual([]);                       // kein createNote
  expect(notes.get("doc (PDF transcript).md")).toContain("created: 2026-01-01");
  expect(notes.get("doc (PDF transcript).md")).toContain('pages: "1-2"');
  expect(notes.get("doc (PDF transcript).md")).toContain("%% Page 1 %%");
  expect(notes.get("q.md")).toBe("![[doc.pdf]]");                 // kein Embed-Ersatz
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement** — `writePdfTranscript` Signatur + Override-Zweig (`src/pdf_to_md.ts`):

```ts
export async function writePdfTranscript(
  io: ImgToMdIO, sourcePath: string,
  embed: { raw: string; link: string },
  pages: { page: number; content: string; model: string }[],
  separator: PdfPageSeparator,
  overwritePath?: string,
): Promise<{ path: string | null }> {
  const kept = pages.filter(p => p.content.trim()).sort((a, b) => a.page - b.page);
  if (!kept.length) return { path: null };
  const model = kept.find(p => p.model)?.model ?? "";
  const pagesStr = `${kept[0].page}-${kept[kept.length - 1].page}`;
  if (overwritePath) {
    const old = await io.readNote(overwritePath);
    const body = buildPdfBody(kept.map(p => ({ page: p.page, text: p.content })), separator);
    await io.writeNote(overwritePath, rewriteTranscript(old, { model, sourceLink: embed.link, body, pages: pagesStr }));
    return { path: overwritePath };
  }
  const before = await io.readNote(sourcePath);
  const sourceName = basenameNoExt(sourcePath);
  const resolved = io.resolveImage(embed.link, sourcePath);
  const pdfPath = resolved?.path ?? embed.link;
  const notePath = transcriptNotePath(io, sourcePath, pdfPath, "pdf");
  const content = buildPdfNote({
    pdfLink: embed.link, sourceName, date: io.date(), model,
    pages: kept.map(p => ({ page: p.page, text: p.content })),
    rangeFrom: kept[0].page, rangeTo: kept[kept.length - 1].page, separator,
  });
  await io.createNote(notePath, content);
  const replaced = replaceEmbed(before, embed.raw, basenameNoExt(notePath));
  if (replaced !== before) await io.writeNote(sourcePath, replaced);
  return { path: notePath };
}
```
Import oben ergänzen: `rewriteTranscript` zur bestehenden `./img_to_md`-Import-Zeile hinzufügen.

- [ ] **Step 4: Run — PASS** (`npm test`).
- [ ] **Step 5: Commit**

```bash
git add src/pdf_to_md.ts tests/pdf_to_md.test.ts
git commit -m "feat(override): writePdfTranscript überschreibt bei overwritePath

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `ImgItem.existingTranscriptPath` + Default-Selektion

**Files:**
- Modify: `src/img_to_md_state.ts:3-11` (`ImgItem`), `:35-38` (`setItems`)
- Test: `tests/img_to_md_state.test.ts`

**Interfaces:**
- Produces: `ImgItem` zusätzlich `existingTranscriptPath?: string`; `setItems` selektiert default nur `supported && !existingTranscriptPath`.

- [ ] **Step 1: Failing tests** — in `tests/img_to_md_state.test.ts` ergänzen:

```ts
describe("ImgToMdState — vorhandenes Transkript", () => {
  const withTx: ImgItem = { raw: "![[b.png]]", link: "b.png", ext: "png", supported: true, kind: "image", existingTranscriptPath: "b (transcript).md" };
  const without: ImgItem = { raw: "![[a.png]]", link: "a.png", ext: "png", supported: true, kind: "image" };
  it("setItems wählt Items mit vorhandenem Transkript NICHT vor", () => {
    const s = new ImgToMdState(); s.setItems([without, withTx]);
    expect(s.isSelected("a.png")).toBe(true);
    expect(s.isSelected("b.png")).toBe(false);
  });
  it("toggle aktiviert ein Item mit Transkript trotzdem (Override opt-in)", () => {
    const s = new ImgToMdState(); s.setItems([withTx]);
    s.toggle("b.png");
    expect(s.isSelected("b.png")).toBe(true);
  });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement** — `ImgItem` (Feld) + `setItems`:

```ts
export interface ImgItem {
  raw: string; link: string; ext: string; supported: boolean;
  kind: "image" | "pdf";
  pageCount?: number;
  range?: { from: number; to: number };
  existingTranscriptPath?: string;
}
```
```ts
setItems(items: ImgItem[]): void {
  this.items = items;
  this.selected = new Set(items.filter(i => i.supported && !i.existingTranscriptPath).map(i => i.link));
}
```

- [ ] **Step 4: Run — PASS** (`npm test`).
- [ ] **Step 5: Commit**

```bash
git add src/img_to_md_state.ts tests/img_to_md_state.test.ts
git commit -m "feat(idempotency): ImgItem.existingTranscriptPath + Default-Selektion (Override opt-in)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: View — „vorhanden → öffnen" + Override durchreichen

**Files:**
- Modify: `src/img_to_md_view.ts` (Deps `writePdf` + `overwritePath`; `renderList` Badge; `writeAll`/`writeOne` Override)
- Modify: `src/i18n.ts` (3 Keys), `styles.css` (Badge)
- Test: `tests/img_to_md_view.test.ts`

**Interfaces:**
- Consumes: `ImgItem.existingTranscriptPath` (Task 5).
- Produces (Deps): `writePdf(sourcePath, raw, link, pages, overwritePath?: string) => Promise<string | null>`. Bild-Override geht über `entries[].item.existingTranscriptPath` (kein Deps-Signaturwechsel bei `writeTranscripts`).

- [ ] **Step 1: i18n + CSS**

`src/i18n.ts` EN: `"view.transcriptExists": "✓ transcript exists",` `"view.open": "open",` `"view.overwriteHint": "re-transcribing overwrites it",` — DE: `"view.transcriptExists": "✓ Transkript vorhanden",` `"view.open": "öffnen",` `"view.overwriteHint": "erneut transkribieren überschreibt",`

`styles.css` ergänzen:
```css
.img2md-exists { color: var(--text-accent); font-size: 11px; margin-left: 4px; }
.img2md-exists-open { color: var(--text-accent); font-size: 11px; margin-left: 4px; cursor: pointer; text-decoration: underline; }
```

- [ ] **Step 2: Failing test** — in `tests/img_to_md_view.test.ts` ergänzen:

```ts
const ITEMS_EXISTS: ImgItem[] = [
  { raw: "![[b.png]]", link: "b.png", ext: "png", supported: true, kind: "image", existingTranscriptPath: "b (transcript).md" },
];

describe("ImgToMdView — vorhandenes Transkript", () => {
  it("zeigt Badge + öffnen-Link, Checkbox default aus", async () => {
    const { view, calls } = mkView({ scan: async () => ITEMS_EXISTS });
    await view.onOpen();
    expect(all(view.contentEl, "img2md-exists").length).toBe(1);
    expect(all(view.contentEl, "img2md-check")[0].checked).toBe(false);
    all(view.contentEl, "img2md-exists-open")[0].click();
    expect(calls.opened).toEqual(["b (transcript).md"]);
  });
});
```

Nur dieser eine View-Test (Anzeige + Checkbox-Default + öffnen-Klick). Die **Override-Durchreichung** (writeAll/writeOne setzen `overwritePath` aus `item.existingTranscriptPath`) wird durch die Kern-Tests (Task 3 `writeTranscripts`-Override, Task 4 `writePdfTranscript`-Override) und die empirische Verifikation (Task 7) abgedeckt — ein Checkbox-Simulations-Test im Fake-DOM wäre fragil und wird bewusst weggelassen.

- [ ] **Step 3: Run — FAIL.**

- [ ] **Step 4: Implement**

`renderList` (`img_to_md_view.ts`) — direkt vor dem schließenden `}` der `for`-Schleife (nach dem `if (item.kind === "pdf") {…} else {…}`-Block) einfügen:
```ts
      if (item.existingTranscriptPath) {
        row.createEl("span", { cls: "img2md-exists", text: t("view.transcriptExists") });
        const open = row.createEl("a", { cls: "img2md-exists-open", text: t("view.open") });
        open.addEventListener("click", () => this.deps.openPath(item.existingTranscriptPath!));
        row.setAttribute("title", t("view.overwriteHint"));
      }
```

Deps `writePdf` (`:12`) Signatur erweitern:
```ts
  writePdf: (sourcePath: string, raw: string, link: string, pages: { page: number; content: string; model: string }[], overwritePath?: string) => Promise<string | null>;
```

`writeAll` (`:216`) — Bild-Entries um `overwritePath` aus dem Item ergänzen, PDF-Gruppe `overwritePath` mitgeben:
```ts
    if (part.images.length) {
      const entries = part.images.map(x => ({ item: x.card.item, content: x.card.text.trim(), model: x.card.model }));
      const paths = await this.deps.writeTranscripts(path, entries);
      part.images.forEach((x, k) => { if (paths[k]) this.state.markWritten(x.cardIndex, paths[k]); });
    }
    for (const g of part.pdfs) {
      const created = await this.deps.writePdf(path, g.raw, g.link, g.pages.map(p => ({ page: p.page, content: p.content.trim(), model: p.model })), g.item.existingTranscriptPath);
      if (created) g.cardIndices.forEach(i => this.state.markWritten(i, created));
    }
```
`writeOne` (`:198`) — PDF-Zweig `overwritePath` mitgeben:
```ts
        const created = await this.deps.writePdf(path, g.raw, g.link, g.pages.map(p => ({ page: p.page, content: p.content.trim(), model: p.model })), g.item.existingTranscriptPath);
```
(Bild-Entries tragen das `item` ohnehin; `overwritePath` leitet `main.ts` daraus ab — Task 7. Kein Eingriff am `writeTranscripts`-Aufruf der View nötig.)

- [ ] **Step 5: Run — PASS** (`npm test`), `npm run typecheck && npm run lint`.
- [ ] **Step 6: Commit**

```bash
git add src/img_to_md_view.ts src/i18n.ts styles.css tests/img_to_md_view.test.ts
git commit -m "feat(idempotency): Sidebar zeigt 'Transkript vorhanden → öffnen' + reicht Override durch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: main.ts — Lookup, scan, Override-Verdrahtung (Integration)

**Files:**
- Modify: `src/main.ts` (`backlinkLookup`, `scan`, `writeTranscripts`-Dep, `writePdf`-Dep)

**Interfaces:**
- Consumes: `findExistingTranscript`/`BacklinkLookup` (Task 1), `ImgItem.existingTranscriptPath` (Task 5), `writePdf`-Override (Task 4/6), `writeTranscripts`-`overwritePath` (Task 3).

Kein reiner Unit-Test (Obsidian-Integration); Gate = `npm run build && npm test && typecheck && lint` + empirische Verifikation.

- [ ] **Step 1: Imports + `backlinkLookup`**

`src/main.ts` Import ergänzen: `import { findExistingTranscript, BacklinkLookup } from "./backlinks";` (und `TFile` ist bereits importiert).
Methode in der Plugin-Klasse ergänzen:
```ts
private backlinkLookup(): BacklinkLookup {
  return {
    resolvedLinks: this.app.metadataCache.resolvedLinks,
    frontmatterLinks: (notePath) => {
      const f = this.app.vault.getAbstractFileByPath(notePath);
      const cache = f instanceof TFile ? this.app.metadataCache.getFileCache(f) : null;
      return (cache?.frontmatterLinks ?? []).map(fl => ({ key: fl.key, link: fl.link }));
    },
    resolveLink: (link, fromPath) => this.app.metadataCache.getFirstLinkpathDest(link, fromPath)?.path ?? null,
  };
}
```

- [ ] **Step 2: `scan` setzt `existingTranscriptPath`** — den Schleifenkörper in `makeImgViewDeps().scan` (`:88-102`) ersetzen:
```ts
        const lookup = this.backlinkLookup();
        for (const e of findImageEmbeds(content)) {
          if (seen.has(e.link)) continue; seen.add(e.link);
          const resolved = this.app.metadataCache.getFirstLinkpathDest(e.link, sourcePath);
          const existingTranscriptPath = resolved ? (findExistingTranscript(lookup, resolved.path) ?? undefined) : undefined;
          if (e.kind === "pdf") {
            let pageCount = 0;
            if (resolved) {
              try { pageCount = await pdfPageCount(await this.app.vault.adapter.readBinary(resolved.path)); } catch { pageCount = 0; }
            }
            const supported = pageCount > 0;
            const cappedTo = Math.min(pageCount, this.settings.pdfMaxPages);
            items.push({ raw: e.raw, link: e.link, ext: e.ext, supported, kind: "pdf", pageCount, range: { from: 1, to: cappedTo > 0 ? cappedTo : 1 }, existingTranscriptPath });
          } else {
            items.push({ raw: e.raw, link: e.link, ext: e.ext, supported: SUPPORTED_EXTS.includes(e.ext.toLowerCase()), kind: "image", existingTranscriptPath });
          }
        }
```
(`const lookup` einmal vor die Schleife heben — nicht pro Item neu bauen.)

- [ ] **Step 3: Override in den Schreib-Deps**

`writeTranscripts`-Dep (`:121`) — `overwritePath` aus dem Item ableiten:
```ts
      writeTranscripts: async (sourcePath, entries) => {
        const { paths } = await writeTranscripts(this.makeImgIO(), sourcePath, entries.map(e => ({ raw: e.item.raw, link: e.item.link, content: e.content, model: e.model, overwritePath: e.item.existingTranscriptPath })));
        return paths;
      },
```
`writePdf`-Dep (`:125`) — `overwritePath` durchreichen:
```ts
      writePdf: async (sourcePath, raw, link, pages, overwritePath) => {
        const { path } = await writePdfTranscript(this.makeImgIO(), sourcePath, { raw, link }, pages, this.settings.pdfPageSeparator, overwritePath);
        return path;
      },
```

- [ ] **Step 4: Build + Gate**

Run: `npm run build && npm test && npm run typecheck && npm run lint`
Expected: alle grün, `main.js` gebaut.

- [ ] **Step 5: Empirische Verifikation (Handover-Notiz, vom Menschen)**
- Deploy (`npm run deploy`), Plugin neu laden.
- Bild in **zwei** Notizen einbetten, eines transkribieren → in der **zweiten** Notiz erscheint „✓ Transkript vorhanden → öffnen", Checkbox aus.
- Transkript-Notiz eines PDFs öffnen → das eingebettete PDF zeigt „vorhanden"; ankreuzen + höhere `pdfRenderScale` + Transkribieren → **dieselbe** Notiz wird überschrieben (kein zweites `… -2`), `created` bleibt, Text/`pages` neu.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts
git commit -m "feat(idempotency): main — backlinkLookup, scan-Erkennung, Override-Verdrahtung

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Doku + Release-Bump

**Files:**
- Modify: `CHANGELOG.md`, `README.md`, `README.de.md`, `AGENTS.md`
- Modify: `manifest.json`, `package.json`, `versions.json`

- [ ] **Step 1: Doku**
- `CHANGELOG.md` (neue `0.3.0`-Sektion): „Detects an existing transcript via backlinks (frontmatter `source_pdf`/`source_image`) and shows ‚transcript exists → open' in the sidebar; opt-in override re-transcribes and overwrites the existing note."
- `README.md` + `README.de.md`: kurzer Absatz „Already-transcribed sources are detected (via backlink) and shown as ‚exists → open'; tick to re-transcribe/overwrite".
- `AGENTS.md`: `backlinks.ts` (reiner Kern) ins Modul-Layout; Notiz, dass die Idempotenz über das `source_pdf`/`source_image`-Frontmatter + `resolvedLinks` läuft (Frontmatter-Filter load-bearing).

- [ ] **Step 2: Version-Bump** — `npm run version-bump 0.3.0` (minAppVersion bleibt `1.8.7`, `isDesktopOnly` bleibt `false`).
- [ ] **Step 3: Finaler Lauf** — `npm run build && npm test && npm run typecheck && npm run lint` (alle grün).
- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md README.md README.de.md AGENTS.md manifest.json package.json versions.json
git commit -m "docs+release: Backlink-Idempotenz + Override dokumentiert, v0.3.0

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Spec-Coverage-Check

| Spec §  | Anforderung | Task |
|---|---|---|
| §3 | `findExistingTranscript` + `BacklinkLookup` (Frontmatter-Filter load-bearing) | 1 |
| §3 | `scan` setzt `existingTranscriptPath` | 7 |
| §3 | `ImgItem.existingTranscriptPath`, Default-Selektion aus | 5 |
| §3 | Sidebar „vorhanden → öffnen", Override opt-in | 6 |
| §5 | Override-Schreibpfad (überschreiben, kein replaceEmbed, Frontmatter erhalten) | 2,3,4 |
| §6 | i18n-Keys | 6 |
| §7 | Tests Kern/State/View | 1–6 |
| §7 | lint-sichere `@public`-APIs | 7 |

**Abweichung von der Spec (Verbesserung):** §5 sah „neu bauen mit erhaltenem `created`" vor; der Plan erhält stattdessen via `rewriteTranscript` das **komplette** Frontmatter (auch `source_note`/`source_*`) und ersetzt nur `transcribed_by`/`pages` + Body — verhindert selbstreferenzierendes `source_note` beim Override aus der Transkript-Notiz. Funktional stärker, kein offener Punkt.
