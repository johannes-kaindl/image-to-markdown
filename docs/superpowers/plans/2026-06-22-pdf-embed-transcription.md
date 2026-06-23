# PDF-Embed-Transkription (Phase 1a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eingebettete PDFs einer Notiz seitenweise per lokalem Vision-LLM nach Markdown transkribieren — analog zur bestehenden Bild-Transkription, in der Sidebar, mit Bereichsauswahl und einer Standard-Notiz pro PDF.

**Architecture:** PDF-Seiten werden clientseitig via pdf.js zu PNG-Data-URLs gerendert und durch die **bestehende, unveränderte** Vision-Pipeline (`vision_client.ts`/`sse.ts`) geschickt. Der reine Kern bleibt obsidian-/DOM-frei; pdf.js + Canvas leben isoliert in `pdf_render.ts`. Die N-Seiten-Vervielfachung passiert in der Karten-/Notiz-Schicht, nicht an der `replaceEmbed`-Naht (ein PDF-Embed → eine Notiz).

**Tech Stack:** TypeScript (strict), esbuild (cjs single-file), vitest + happy-dom, Obsidian Plugin API, pdfjs-dist 4.10.38, OpenAI-kompatibler Vision-Endpoint.

## Global Constraints

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Produktionstypen.
- **Reiner Kern obsidian-/DOM-frei** (PROF-OBS-03/04): nur `main.ts`, `settings.ts`, `img_to_md_view.ts`, `http.ts`, **`pdf_render.ts`** dürfen `obsidian`/DOM/pdf.js importieren. `img_to_md.ts`, `img_to_md_state.ts`, `pdf_to_md.ts`, `vision_client.ts`, `capabilities.ts`, `i18n.ts`, `sse.ts`, `think_splitter.ts` bleiben in Node testbar.
- **i18n via `t()`**, EN kanonisch, EN/DE gespiegelt (PROF-OBS-07). Keine Muttersprachen-Literale in neuer UI. Geteilter Prompt (`settings.visionPrompt`) für Bild **und** PDF — **kein** neuer Prompt-Default.
- **`pdfjs-dist` exakt `4.10.38` pinnen** (nicht `^`; v5/v6 lagern WASM aus und brechen das Single-File-Bundle).
- **`manifest.json` `isDesktopOnly` bleibt `false`** — PDF-Pfad muss auf Mobile laufen oder über Limits sauber degradieren.
- **Tests:** nach jeder Task **alle** Tests grün (`npm test`), `npm run typecheck` und `npm run lint` sauber. Bestehende 111 Tests dürfen nur dort brechen, wo eine Task sie bewusst anpasst (Suffix-Ripple in Task 3).
- **Commits:** Conventional Commits, deutsche Beschreibung erlaubt, **nur berührte Dateien stagen**, Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **`data.json`/`main.js` nie committen** (gitignored).

---

## Task 1: pdf.js-Render-Schicht + Build-Pipeline (Integrations-Spike)

Größtes Risiko zuerst — empirisch verifizieren, bevor darauf aufgebaut wird. Kein reiner Unit-Test möglich (pdf.js braucht echten Canvas-2d-Context, den happy-dom nicht liefert — vgl. `settings.ts:22` `FALLBACK_PNG`). Verifikation erfolgt im laufenden Plugin.

**Files:**
- Modify: `package.json` (dependency + build-scripts)
- Create: `scripts/build-pdf-worker.mjs`
- Create: `scripts/polyfills.mjs`
- Create: `src/pdf_render.ts`
- Create: `src/pdfjs.d.ts` (nur falls TS den `.mjs`-Subpfad nicht typt)
- Modify: `esbuild.config.mjs`
- Modify: `.gitignore`
- Modify: `src/main.ts` (temporärer Verifikations-Command)
- Modify: `src/i18n.ts` (Command-Name)

**Interfaces:**
- Produces: `pdfPageCount(bytes: ArrayBuffer): Promise<number>`, `renderPdfPage(bytes: ArrayBuffer, page: number, scale: number): Promise<string>` (PNG-Data-URL), `pdfSmokeTest(): Promise<boolean>` — alle aus `src/pdf_render.ts`.

- [ ] **Step 1: pdfjs-dist installieren (gepinnt)**

Run: `npm install --save-exact pdfjs-dist@4.10.38`
Expected: `package.json` → `"dependencies": { "pdfjs-dist": "4.10.38" }` (ohne `^`).

- [ ] **Step 2: Worker-Build-Script anlegen**

Create `scripts/build-pdf-worker.mjs` — kompiliert den pdf.js-Worker (`.mjs`/ESM) zu es2020-Text und legt ihn als TS-Modul ab, das im Hauptbundle als String landet:

```js
import esbuild from "esbuild";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const workerEntry = require.resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs");

const result = await esbuild.build({
  entryPoints: [workerEntry],
  bundle: true, format: "iife", target: "es2020",
  minify: true, write: false, legalComments: "none", logLevel: "info",
});

const code = result.outputFiles[0].text;
writeFileSync(
  "src/pdf-worker-src.generated.ts",
  "// AUTO-GENERATED – nicht editieren. Quelle: pdfjs-dist legacy worker.\n" +
    "export const PDF_WORKER_SRC = " + JSON.stringify(code) + ";\n",
);
console.log("[pdf-worker] eingebettet:", (code.length / 1024).toFixed(0), "KB");
```

- [ ] **Step 3: Promise.withResolvers-Polyfill (alte Mobile-WebViews)**

Create `scripts/polyfills.mjs`:

```js
if (typeof Promise.withResolvers !== "function") {
  Promise.withResolvers = function () {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}
```

- [ ] **Step 4: Render-Schicht anlegen**

Create `src/pdf_render.ts`:

```ts
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDF_WORKER_SRC } from "./pdf-worker-src.generated";

let workerReady = false;

function ensureWorker(): void {
  if (workerReady) return;
  const blob = new Blob([PDF_WORKER_SRC], { type: "text/javascript" });
  pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
  workerReady = true;
}

/** Seitenzahl eines PDF. */
export async function pdfPageCount(bytes: ArrayBuffer): Promise<number> {
  ensureWorker();
  // Kopie: getDocument transferiert den Buffer in den Worker und detached das Original.
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
  try { return doc.numPages; } finally { await doc.destroy(); }
}

/** Rendert Seite (1-basiert) zu PNG als data:image/png;base64,... */
export async function renderPdfPage(bytes: ArrayBuffer, page: number, scale: number): Promise<string> {
  ensureWorker();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
  try {
    const pdfPage = await doc.getPage(page);
    const viewport = pdfPage.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D-Canvas-Context nicht verfügbar");
    await pdfPage.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL("image/png");
  } finally { await doc.destroy(); }
}

/** Smoke: minimal-PDF rendern; true bei Erfolg. */
export async function pdfSmokeTest(): Promise<boolean> {
  const MINIMAL_PDF_BASE64 =
    "JVBERi0xLjEKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBv" +
    "Ymo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlw" +
    "ZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgOTkgOTldPj5lbmRvYmoKdHJhaWxlcjw8" +
    "L1Jvb3QgMSAwIFI+Pg==";
  const bin = atob(MINIMAL_PDF_BASE64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const pages = await pdfPageCount(buf.buffer);
  const png = await renderPdfPage(buf.buffer, 1, 1.0);
  return pages === 1 && png.startsWith("data:image/png;base64,");
}
```

- [ ] **Step 5: esbuild um Polyfill-Inject erweitern**

Modify `esbuild.config.mjs` — eine Zeile in den Context-Optionen ergänzen:

```js
const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"], bundle: true, format: "cjs",
  target: "es2020", external: ["obsidian", "electron"],
  outfile: "main.js", sourcemap: prod ? false : "inline", logLevel: "info",
  inject: ["./scripts/polyfills.mjs"],
});
```

- [ ] **Step 6: Build-Scripts verdrahten**

Modify `package.json` scripts (Worker vor dem Hauptbundle bauen):

```jsonc
"build:worker": "node scripts/build-pdf-worker.mjs",
"build": "npm run build:worker && node esbuild.config.mjs production",
"dev":   "npm run build:worker && node esbuild.config.mjs"
```

- [ ] **Step 7: Generierten Worker ignorieren**

Modify `.gitignore` → Zeile `src/pdf-worker-src.generated.ts` hinzufügen.

- [ ] **Step 8: Worker-Build ausführen**

Run: `npm run build:worker`
Expected: `[pdf-worker] eingebettet: <~350-450> KB`, Datei `src/pdf-worker-src.generated.ts` existiert.

- [ ] **Step 9: Typecheck**

Run: `npm run typecheck`
Expected: keine Fehler. Falls `Cannot find module 'pdfjs-dist/legacy/build/pdf.mjs'`: Create `src/pdfjs.d.ts`:

```ts
declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export * from "pdfjs-dist";
}
```
Dann `npm run typecheck` erneut → grün.

- [ ] **Step 10: Verifikations-Command einbauen (i18n + main)**

Modify `src/i18n.ts` — in `EN` und `DE` je einen Key ergänzen:
- EN: `"cmd.pdfSmoke": "PDF render self-test",`
- DE: `"cmd.pdfSmoke": "PDF-Render-Selbsttest",`

Modify `src/main.ts` — Import + Command in `onload()`:

```ts
import { pdfSmokeTest } from "./pdf_render";
// … in onload(), bei den anderen addCommand-Aufrufen:
this.addCommand({ id: "pdf-render-selftest", name: t("cmd.pdfSmoke"), callback: async () => {
  try { new Notice(`PDF-Render: ${(await pdfSmokeTest()) ? "OK" : "FEHLER"}`); }
  catch (e) { new Notice(`PDF-Render-Fehler: ${e instanceof Error ? e.message : String(e)}`); }
} });
```

- [ ] **Step 11: Build + Tests + Lint**

Run: `npm run build && npm test && npm run lint`
Expected: Build erzeugt `main.js`; alle bestehenden Tests grün; eslint sauber. (Bundle-Größe `main.js` ~+0,8-1,0 MB — erwartet.)

- [ ] **Step 12: Empirische Verifikation im Plugin (Desktop)**

Run: `npm run deploy` (setzt `OBSIDIAN_PLUGIN_DIR`).
Dann in Obsidian: Plugin neu laden → Command-Palette → „PDF-Render-Selbsttest" ausführen.
Expected: Notice „PDF-Render: OK". (Bei „FEHLER"/Exception: Worker-Blob-Strategie debuggen, **bevor** weitergebaut wird — das ist das Kernrisiko.)

- [ ] **Step 13: Commit**

```bash
git add package.json package-lock.json scripts/build-pdf-worker.mjs scripts/polyfills.mjs src/pdf_render.ts src/pdfjs.d.ts esbuild.config.mjs .gitignore src/main.ts src/i18n.ts
git commit -m "feat(pdf): pdf.js-Render-Schicht + Worker-Bundling (empirisch verifiziert)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Embed-Erkennung — kind/page für PDF

**Files:**
- Modify: `src/img_to_md.ts:3-32` (PDF_EXT, `ImageEmbed`, `extOf`, `findImageEmbeds`), `:110-141` (`runImgToMd` skippt PDF mit Hinweis)
- Modify: `src/i18n.ts` (Hinweis-String)
- Test: `tests/img_to_md.test.ts`

**Interfaces:**
- Produces: `PDF_EXT = "pdf"`; `interface ImageEmbed { raw: string; link: string; ext: string; kind: "image" | "pdf"; page?: number }`; `findImageEmbeds(content: string): ImageEmbed[]`.

- [ ] **Step 1: Bestehenden findImageEmbeds-Test um `kind` erweitern + PDF-Tests schreiben**

Modify `tests/img_to_md.test.ts` — in `describe("findImageEmbeds")` die strikte Assertion anpassen und neue Fälle ergänzen:

```ts
it("findet wikilink- und markdown-Bild-Embeds, filtert Extensions", () => {
  const c = "text\n![[foto.jpg]]\n![[notiz]]\n![alt](bilder/x.png)\n![web](https://e/x.png)";
  const r = findImageEmbeds(c);
  expect(r.map(e => e.link)).toEqual(["foto.jpg", "bilder/x.png"]);
  expect(r[0]).toEqual({ raw: "![[foto.jpg]]", link: "foto.jpg", ext: "jpg", kind: "image" });
});
it("erkennt PDF-Embeds als kind pdf (ohne #page → page undefined)", () => {
  expect(findImageEmbeds("![[doc.pdf]]")[0]).toEqual({ raw: "![[doc.pdf]]", link: "doc.pdf", ext: "pdf", kind: "pdf", page: undefined });
});
it("liest #page=N aus dem PDF-Wikilink", () => {
  expect(findImageEmbeds("![[doc.pdf#page=3]]")[0]).toMatchObject({ link: "doc.pdf", kind: "pdf", page: 3 });
});
it("mischt Bild und PDF in Dokument-Reihenfolge", () => {
  expect(findImageEmbeds("![[a.png]] ![[doc.pdf]]").map(e => e.kind)).toEqual(["image", "pdf"]);
});
it("erkennt PDF auch als Markdown-Embed", () => {
  expect(findImageEmbeds("![x](files/doc.pdf)")[0]).toMatchObject({ link: "files/doc.pdf", kind: "pdf" });
});
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `npx vitest run tests/img_to_md.test.ts -t findImageEmbeds`
Expected: FAIL (`kind` fehlt im Ergebnis; PDF wird nicht erkannt).

- [ ] **Step 3: findImageEmbeds implementieren**

Modify `src/img_to_md.ts` — Konstante, Typ und Parser:

```ts
export const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "heic", "heif"];
export const SUPPORTED_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];
export const PDF_EXT = "pdf";

export interface ImageEmbed { raw: string; link: string; ext: string; kind: "image" | "pdf"; page?: number }

function extOf(link: string): string {
  const clean = link.split("#")[0].split("|")[0].trim();
  const dot = clean.lastIndexOf(".");
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : "";
}

/** #page=N aus dem rohen Linkziel (vor dem #-Strip) lesen. */
function pageOf(rawTarget: string): number | undefined {
  const m = /#page=(\d+)/i.exec(rawTarget);
  return m ? Number(m[1]) : undefined;
}

export function findImageEmbeds(content: string): ImageEmbed[] {
  const out: ImageEmbed[] = [];
  let m: RegExpExecArray | null;
  const wiki = /!\[\[([^\]]+?)\]\]/g;
  while ((m = wiki.exec(content)) !== null) {
    const inner = m[1];
    const link = inner.split("#")[0].split("|")[0].trim();
    const ext = extOf(link);
    if (IMAGE_EXTS.includes(ext)) out.push({ raw: m[0], link, ext, kind: "image" });
    else if (ext === PDF_EXT) out.push({ raw: m[0], link, ext, kind: "pdf", page: pageOf(inner) });
  }
  const md = /!\[[^\]]*\]\(([^)]+?)\)/g;
  while ((m = md.exec(content)) !== null) {
    const target = m[1].trim();
    if (/^https?:\/\//i.test(target)) continue;
    const link = target.split("#")[0].trim();
    const ext = extOf(link);
    if (IMAGE_EXTS.includes(ext)) out.push({ raw: m[0], link, ext, kind: "image" });
    else if (ext === PDF_EXT) out.push({ raw: m[0], link, ext, kind: "pdf", page: pageOf(target) });
  }
  return out;
}
```

- [ ] **Step 4: Test ausführen — muss bestehen**

Run: `npx vitest run tests/img_to_md.test.ts -t findImageEmbeds`
Expected: PASS.

- [ ] **Step 5: runImgToMd skippt PDFs mit klarem Hinweis (statt „Format nicht unterstützt")**

Modify `src/i18n.ts` — EN: `"core.pdfUseSidebar": "PDF detected ({0}) — transcribe PDFs in the sidebar.",` DE: `"core.pdfUseSidebar": "PDF erkannt ({0}) — PDFs in der Sidebar transkribieren.",`

Modify `src/img_to_md.ts` in `runImgToMd`, direkt nach dem `resolved`-Check (vor dem `SUPPORTED_EXTS`-Check, ~`:127`):

```ts
    if (e.kind === "pdf") { io.notify(t("core.pdfUseSidebar", e.link)); skipped++; continue; }
```

- [ ] **Step 6: PDF-Skip-Test für runImgToMd**

Modify `tests/img_to_md.test.ts` — in `describe("runImgToMd")` ergänzen:

```ts
it("PDF-Embed → Hinweis auf Sidebar, kein Schreiben", async () => {
  const { io, created, notices } = fakeIO({ notes: [["q.md", "![[doc.pdf]]"]], resolveImage: (l: string) => ({ path: l, ext: "pdf" }) });
  const r = await runImgToMd(io, "q.md");
  expect(r).toEqual({ transcribed: 0, skipped: 1 });
  expect(Object.keys(created)).toEqual([]);
  expect(notices.some(n => n.includes("sidebar"))).toBe(true);
});
```

- [ ] **Step 7: Volllauf + Lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: alle grün.

- [ ] **Step 8: Commit**

```bash
git add src/img_to_md.ts src/i18n.ts tests/img_to_md.test.ts
git commit -m "feat(pdf): PDF-Embeds erkennen (kind/page); runImgToMd verweist auf Sidebar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Lokalisierter Notiz-Suffix (Bild + PDF)

Transkript-Notizen bekommen einen lokalisierten Suffix: Bild `bild (transcript).md`, PDF `doc (PDF transcript).md`. Konsistenz-Entscheidung aus dem Spec-Review — betrifft auch die bestehende Bild-Benennung (Ripple in den Alt-Tests).

**Files:**
- Modify: `src/i18n.ts` (`note.suffix.image`, `note.suffix.pdf`)
- Modify: `src/img_to_md.ts` (`transcriptNotePath`-Signatur + Suffix; `basenameNoExt` exportieren; `writeTranscripts`-Aufruf)
- Test: `tests/img_to_md.test.ts` (angepasste Assertions)

**Interfaces:**
- Consumes: `t()` (i18n), default `currentLang = "en"` → Suffix `(transcript)` / `(PDF transcript)` in Tests.
- Produces: `transcriptNotePath(io: { noteExists(p: string): boolean }, sourcePath: string, imagePath: string, kind: "image" | "pdf"): string`; `export function basenameNoExt(path: string): string`.

- [ ] **Step 1: i18n-Suffix-Keys ergänzen**

Modify `src/i18n.ts` — in `EN`: `"note.suffix.image": "(transcript)",` `"note.suffix.pdf": "(PDF transcript)",` — in `DE`: `"note.suffix.image": "(Transkript)",` `"note.suffix.pdf": "(PDF-Transkript)",`

- [ ] **Step 2: Tests auf den Suffix umstellen (failing)**

Modify `tests/img_to_md.test.ts` — folgende Assertions ersetzen:

`describe("transcriptNotePath")`:
```ts
it("legt neben die Quellnotiz, Basename + lokalisierter Suffix, Kollisions-Zähler", () => {
  const exists = new Set(["dir/foto (transcript).md"]);
  const io = { noteExists: (p: string) => exists.has(p) };
  expect(transcriptNotePath(io, "dir/quelle.md", "dir/img/foto.png", "image")).toBe("dir/foto (transcript)-2.md");
  expect(transcriptNotePath(io, "quelle.md", "foto.png", "image")).toBe("foto (transcript).md");
});
```

`describe("writeTranscripts")` — erster Test:
```ts
expect(r.paths).toEqual(["foto (transcript).md", "bild (transcript).md"]);
expect(created["foto (transcript).md"]).toContain("# A");
expect(created["foto (transcript).md"]).toContain('transcribed_by: "vm"');
expect(notes.get("q.md")).toBe("a ![[foto (transcript)]] b ![[bild (transcript)]]");
```
— dritter Test (Kollision):
```ts
expect(r.paths).toEqual(["foto (transcript).md", "foto (transcript)-2.md"]);
```

`describe("runImgToMd")` — Happy-Path:
```ts
expect(created["foto (transcript).md"]).toContain("# Transkript");
expect(created["foto (transcript).md"]).toContain('transcribed_by: "vmodel"');
expect(notes.get("q.md")).toBe("vor\n![[foto (transcript)]]\nnach");
```
— „Namens-Kollision → Zähler" (Fixture-Notiz auf den Suffix-Namen umstellen, sonst keine Kollision):
```ts
it("Namens-Kollision → Zähler", async () => {
  const { io, created } = fakeIO({ notes: [["q.md", "![[foto.jpg]]"], ["foto (transcript).md", "alt"]] });
  await runImgToMd(io, "q.md");
  expect(created["foto (transcript)-2.md"]).toBeTruthy();
});
```
— „onlyRaw":
```ts
expect(Object.keys(created)).toEqual(["b (transcript).md"]);
```
— „Duplikat-Embeds":
```ts
expect(Object.keys(created)).toEqual(["foto (transcript).md"]);
expect(notes.get("q.md")).toBe("![[foto (transcript)]]\ntext\n![[foto (transcript)]]");
```

- [ ] **Step 3: Tests ausführen — müssen fehlschlagen**

Run: `npx vitest run tests/img_to_md.test.ts`
Expected: FAIL (alte suffixlose Pfade vs. erwartete Suffix-Pfade).

- [ ] **Step 4: transcriptNotePath + Suffix implementieren**

Modify `src/img_to_md.ts`:

```ts
// basenameNoExt von lokal → exportiert (Task 5 braucht es):
export function basenameNoExt(path: string): string {
  const b = path.slice(path.lastIndexOf("/") + 1);
  const d = b.lastIndexOf("."); return d >= 0 ? b.slice(0, d) : b;
}

function transcriptSuffix(kind: "image" | "pdf"): string {
  return t(kind === "pdf" ? "note.suffix.pdf" : "note.suffix.image");
}

export function transcriptNotePath(
  io: { noteExists(p: string): boolean }, sourcePath: string, imagePath: string, kind: "image" | "pdf",
): string {
  const base = `${basenameNoExt(imagePath)} ${transcriptSuffix(kind)}`;
  return uniqueNotePath(io, dirOf(sourcePath), base);
}
```
Im `writeTranscripts` den Aufruf anpassen (`:101`): `const newPath = transcriptNotePath(io, sourcePath, imagePath, "image");`

- [ ] **Step 5: Tests ausführen — müssen bestehen**

Run: `npm test`
Expected: alle grün (img_to_md + alle übrigen).

- [ ] **Step 6: Typecheck + Lint + Commit**

Run: `npm run typecheck && npm run lint`
Expected: grün.
```bash
git add src/i18n.ts src/img_to_md.ts tests/img_to_md.test.ts
git commit -m "feat: lokalisierter Suffix für Transkript-Notizen (Bild + PDF)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: PDF-Notiz-Builder `buildPdfNote`

**Files:**
- Create: `src/pdf_to_md.ts`
- Modify: `src/i18n.ts` (`pdf.pageHeading`)
- Test: `tests/pdf_to_md.test.ts`

**Interfaces:**
- Produces: `interface PdfPageTranscript { page: number; text: string }`; `buildPdfNote(o: { pdfLink: string; sourceName: string; date: string; model: string; pages: PdfPageTranscript[]; rangeFrom: number; rangeTo: number }): string`.

- [ ] **Step 1: i18n-Key für die Seiten-Überschrift**

Modify `src/i18n.ts` — EN: `"pdf.pageHeading": "Page {0}",` DE: `"pdf.pageHeading": "Seite {0}",`

- [ ] **Step 2: Failing test schreiben**

Create `tests/pdf_to_md.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildPdfNote } from "../src/pdf_to_md";

describe("buildPdfNote", () => {
  it("Frontmatter + PDF-Embed oben + Seiten-Sektionen in Reihenfolge", () => {
    const note = buildPdfNote({ pdfLink: "doc.pdf", sourceName: "Quelle", date: "2026-06-22", model: "vm", rangeFrom: 1, rangeTo: 2, pages: [{ page: 1, text: "# A" }, { page: 2, text: "# B" }] });
    expect(note).toContain('source_pdf: "[[doc.pdf]]"');
    expect(note).toContain('source_note: "[[Quelle]]"');
    expect(note).toContain('transcribed_by: "vm"');
    expect(note).toContain('pages: "1-2"');
    expect(note).toContain("![[doc.pdf]]");
    expect(note).toContain("## Page 1");
    expect(note).toContain("## Page 2");
    expect(note.indexOf("![[doc.pdf]]")).toBeLessThan(note.indexOf("## Page 1"));
    expect(note.indexOf("## Page 1")).toBeLessThan(note.indexOf("## Page 2"));
  });
  it("überspringt leere Seiten", () => {
    const note = buildPdfNote({ pdfLink: "doc.pdf", sourceName: "Q", date: "2026-06-22", model: "vm", rangeFrom: 1, rangeTo: 2, pages: [{ page: 1, text: "   " }, { page: 2, text: "X" }] });
    expect(note).not.toContain("## Page 1");
    expect(note).toContain("## Page 2");
  });
  it("escaped Anführungszeichen im Frontmatter", () => {
    const note = buildPdfNote({ pdfLink: 'd"c.pdf', sourceName: 'Q"x', date: "2026-06-22", model: 'v"m', rangeFrom: 1, rangeTo: 1, pages: [{ page: 1, text: "x" }] });
    expect(note).toContain('source_pdf: "[[d\\"c.pdf]]"');
    expect(note).toContain('transcribed_by: "v\\"m"');
  });
});
```

- [ ] **Step 3: Test ausführen — muss fehlschlagen**

Run: `npx vitest run tests/pdf_to_md.test.ts`
Expected: FAIL (`buildPdfNote` nicht definiert).

- [ ] **Step 4: buildPdfNote implementieren**

Create `src/pdf_to_md.ts`:

```ts
import { t } from "./i18n";

export interface PdfPageTranscript { page: number; text: string }

/** Baut die PDF-Transkript-Notiz: Frontmatter + PDF-Embed oben + ## Seite N je nicht-leerer Seite. */
export function buildPdfNote(o: {
  pdfLink: string; sourceName: string; date: string; model: string;
  pages: PdfPageTranscript[]; rangeFrom: number; rangeTo: number;
}): string {
  const esc = (s: string) => s.replace(/"/g, '\\"');
  const head = [
    "---",
    `source_pdf: "[[${esc(o.pdfLink)}]]"`,
    `source_note: "[[${esc(o.sourceName)}]]"`,
    `created: ${o.date}`,
    `transcribed_by: "${esc(o.model)}"`,
    `pages: "${o.rangeFrom}-${o.rangeTo}"`,
    "---",
    `![[${o.pdfLink}]]`,
    "",
  ];
  const body = o.pages
    .filter(p => p.text.trim())
    .map(p => `## ${t("pdf.pageHeading", p.page)}\n\n${p.text.trim()}\n`);
  return head.concat(body).join("\n");
}
```

- [ ] **Step 5: Test grün + Lint**

Run: `npx vitest run tests/pdf_to_md.test.ts && npm run typecheck && npm run lint`
Expected: PASS, grün.

- [ ] **Step 6: Commit**

```bash
git add src/pdf_to_md.ts src/i18n.ts tests/pdf_to_md.test.ts
git commit -m "feat(pdf): buildPdfNote — Standard-Notiz mit Seiten-Sektionen

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: PDF-Schreiblogik `writePdfTranscript`

**Files:**
- Modify: `src/pdf_to_md.ts` (`writePdfTranscript`)
- Test: `tests/pdf_to_md.test.ts`

**Interfaces:**
- Consumes: `ImgToMdIO`, `replaceEmbed`, `transcriptNotePath`, `basenameNoExt` (alle aus `img_to_md.ts`); `buildPdfNote` (Task 4).
- Produces: `writePdfTranscript(io: ImgToMdIO, sourcePath: string, embed: { raw: string; link: string }, pages: { page: number; content: string; model: string }[]): Promise<{ path: string | null }>`.

- [ ] **Step 1: Failing test schreiben**

Modify `tests/pdf_to_md.test.ts` — ergänzen:

```ts
import { writePdfTranscript } from "../src/pdf_to_md";

function pdfIO(initial: string) {
  const notes = new Map<string, string>([["q.md", initial]]);
  const created: Record<string, string> = {};
  const io: any = {
    date: () => "2026-06-22",
    readNote: async (p: string) => notes.get(p) ?? "",
    writeNote: async (p: string, c: string) => { notes.set(p, c); },
    createNote: async (p: string, c: string) => { created[p] = c; notes.set(p, c); },
    noteExists: (p: string) => notes.has(p),
    resolveImage: (l: string) => ({ path: l, ext: "pdf" }),
  };
  return { io, created, notes };
}

describe("writePdfTranscript", () => {
  it("eine Notiz für alle Seiten, PDF-Suffix, Embed ersetzt", async () => {
    const { io, created, notes } = pdfIO("vor ![[doc.pdf]] nach");
    const r = await writePdfTranscript(io, "q.md", { raw: "![[doc.pdf]]", link: "doc.pdf" }, [
      { page: 1, content: "# A", model: "vm" }, { page: 2, content: "# B", model: "vm" },
    ]);
    expect(r.path).toBe("doc (PDF transcript).md");
    expect(created["doc (PDF transcript).md"]).toContain("## Page 1");
    expect(created["doc (PDF transcript).md"]).toContain("## Page 2");
    expect(notes.get("q.md")).toBe("vor ![[doc (PDF transcript)]] nach");
  });
  it("alle Seiten leer → keine Notiz, Quelle unverändert", async () => {
    const { io, created, notes } = pdfIO("![[doc.pdf]]");
    const r = await writePdfTranscript(io, "q.md", { raw: "![[doc.pdf]]", link: "doc.pdf" }, [
      { page: 1, content: "   ", model: "vm" },
    ]);
    expect(r.path).toBe(null);
    expect(Object.keys(created)).toEqual([]);
    expect(notes.get("q.md")).toBe("![[doc.pdf]]");
  });
});
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `npx vitest run tests/pdf_to_md.test.ts -t writePdfTranscript`
Expected: FAIL (`writePdfTranscript` nicht definiert).

- [ ] **Step 3: writePdfTranscript implementieren**

Modify `src/pdf_to_md.ts` — Imports oben ergänzen und Funktion anhängen:

```ts
import { ImgToMdIO, replaceEmbed, transcriptNotePath, basenameNoExt } from "./img_to_md";

/** Schreibt EINE Standard-Notiz für ein PDF (alle nicht-leeren Seiten), ersetzt den PDF-Embed. */
export async function writePdfTranscript(
  io: ImgToMdIO, sourcePath: string,
  embed: { raw: string; link: string },
  pages: { page: number; content: string; model: string }[],
): Promise<{ path: string | null }> {
  const kept = pages.filter(p => p.content.trim()).sort((a, b) => a.page - b.page);
  if (!kept.length) return { path: null };
  const before = await io.readNote(sourcePath);
  const sourceName = basenameNoExt(sourcePath);
  const resolved = io.resolveImage(embed.link, sourcePath);
  const pdfPath = resolved?.path ?? embed.link;
  const notePath = transcriptNotePath(io, sourcePath, pdfPath, "pdf");
  const model = kept.find(p => p.model)?.model ?? "";
  const content = buildPdfNote({
    pdfLink: embed.link, sourceName, date: io.date(), model,
    pages: kept.map(p => ({ page: p.page, text: p.content })),
    rangeFrom: kept[0].page, rangeTo: kept[kept.length - 1].page,
  });
  await io.createNote(notePath, content);
  const replaced = replaceEmbed(before, embed.raw, basenameNoExt(notePath));
  if (replaced !== before) await io.writeNote(sourcePath, replaced);
  return { path: notePath };
}
```

- [ ] **Step 4: Test grün + Volllauf + Lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: alle grün.

- [ ] **Step 5: Commit**

```bash
git add src/pdf_to_md.ts tests/pdf_to_md.test.ts
git commit -m "feat(pdf): writePdfTranscript — ein PDF → eine Notiz, Embed ersetzt

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: State — PDF-Items, Seiten-Karten-Expansion, Schreib-Partition

**Files:**
- Modify: `src/img_to_md_state.ts` (`ImgItem`, `ImgCard`, `startCards`, `partitionDoneCards`)
- Test: `tests/img_to_md_state.test.ts`

**Interfaces:**
- Consumes: `ImgItem` (erweitert).
- Produces:
  - `interface ImgItem { raw: string; link: string; ext: string; supported: boolean; kind: "image" | "pdf"; pageCount?: number; range?: { from: number; to: number } }`
  - `interface ImgCard { …; page?: number }`
  - `partitionDoneCards(cards: ImgCard[]): { images: { card: ImgCard; cardIndex: number }[]; pdfs: { raw: string; link: string; item: ImgItem; cardIndices: number[]; pages: { page: number; content: string; model: string }[] }[] }` — gruppiert **done**-Karten: Bilder einzeln, PDF-Seiten nach `link`.

- [ ] **Step 1: Fixtures + neue Tests schreiben (failing)**

Modify `tests/img_to_md_state.test.ts` — die `items`-Fixture um `kind` erweitern und Tests ergänzen:

```ts
const items: ImgItem[] = [
  { raw: "![[a.png]]", link: "a.png", ext: "png", supported: true, kind: "image" },
  { raw: "![[b.jpg]]", link: "b.jpg", ext: "jpg", supported: true, kind: "image" },
  { raw: "![[c.heic]]", link: "c.heic", ext: "heic", supported: false, kind: "image" },
];

describe("ImgToMdState — PDF-Karten", () => {
  const pdf: ImgItem = { raw: "![[doc.pdf]]", link: "doc.pdf", ext: "pdf", supported: true, kind: "pdf", pageCount: 3, range: { from: 1, to: 3 } };

  it("startCards expandiert ein PDF zu einer Karte je Seite im Bereich", () => {
    const s = new ImgToMdState(); s.setItems([pdf]);
    const cards = s.startCards();
    expect(cards.length).toBe(3);
    expect(cards.map(c => c.page)).toEqual([1, 2, 3]);
    expect(cards.map(c => c.index)).toEqual([1, 2, 3]);
    expect(cards[0].total).toBe(3);
  });

  it("Teilbereich expandiert nur die gewählten Seiten", () => {
    const s = new ImgToMdState();
    s.setItems([{ ...pdf, range: { from: 2, to: 3 } }]);
    expect(s.startCards().map(c => c.page)).toEqual([2, 3]);
  });

  it("partitionDoneCards gruppiert PDF-Seiten nach link, Bilder einzeln", () => {
    const s = new ImgToMdState();
    s.setItems([items[0], pdf]);   // a.png + doc.pdf(3 Seiten) → 4 Karten
    s.startCards();
    s.cards.forEach((_, i) => { s.appendContent(i, `t${i}`); s.setDone(i); });
    const part = partitionDoneCards(s.cards);
    expect(part.images.map(x => x.card.item.link)).toEqual(["a.png"]);
    expect(part.pdfs.length).toBe(1);
    expect(part.pdfs[0].link).toBe("doc.pdf");
    expect(part.pdfs[0].pages.map(p => p.page)).toEqual([1, 2, 3]);
    expect(part.pdfs[0].cardIndices.length).toBe(3);
  });
});
```
Import-Zeile oben ergänzen: `import { ImgToMdState, ImgItem, partitionDoneCards } from "../src/img_to_md_state";`

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `npx vitest run tests/img_to_md_state.test.ts`
Expected: FAIL (`kind` Pflichtfeld bzw. `partitionDoneCards`/`page` fehlen).

- [ ] **Step 3: State implementieren**

Modify `src/img_to_md_state.ts`:

```ts
export interface ImgItem {
  raw: string; link: string; ext: string; supported: boolean;
  kind: "image" | "pdf";
  pageCount?: number;
  range?: { from: number; to: number };
}

export interface ImgCard {
  item: ImgItem; index: number; total: number;
  text: string; reasoning: string; model: string; status: CardStatus;
  page?: number;
  error?: string; writtenPath?: string;
}
```
`startCards` ersetzen:
```ts
startCards(): ImgCard[] {
  const sel = this.selectedItems();
  const units: { item: ImgItem; page?: number }[] = [];
  for (const item of sel) {
    if (item.kind === "pdf" && item.range) {
      for (let p = item.range.from; p <= item.range.to; p++) units.push({ item, page: p });
    } else {
      units.push({ item });
    }
  }
  this.cards = units.map((u, k) => ({
    item: u.item, page: u.page, index: k + 1, total: units.length,
    text: "", reasoning: "", model: "", status: "streaming",
  }));
  return this.cards;
}
```
Am Dateiende `partitionDoneCards` als reine Funktion (außerhalb der Klasse):
```ts
/** Gruppiert done-Karten: Bilder einzeln, PDF-Seiten nach embed-link (raw). Behält Karten-Indizes. */
export function partitionDoneCards(cards: ImgCard[]): {
  images: { card: ImgCard; cardIndex: number }[];
  pdfs: { raw: string; link: string; item: ImgItem; cardIndices: number[]; pages: { page: number; content: string; model: string }[] }[];
} {
  const images: { card: ImgCard; cardIndex: number }[] = [];
  const pdfMap = new Map<string, { raw: string; link: string; item: ImgItem; cardIndices: number[]; pages: { page: number; content: string; model: string }[] }>();
  cards.forEach((card, cardIndex) => {
    if (card.status !== "done") return;
    if (card.item.kind === "pdf") {
      let g = pdfMap.get(card.item.raw);
      if (!g) { g = { raw: card.item.raw, link: card.item.link, item: card.item, cardIndices: [], pages: [] }; pdfMap.set(card.item.raw, g); }
      g.cardIndices.push(cardIndex);
      g.pages.push({ page: card.page ?? 1, content: card.text, model: card.model });
    } else {
      images.push({ card, cardIndex });
    }
  });
  return { images, pdfs: [...pdfMap.values()] };
}
```

- [ ] **Step 4: Test grün + Volllauf**

Weil `ImgItem.kind` jetzt Pflichtfeld ist, brechen die `tests/img_to_md_view.test.ts`-Fixtures (Literale ohne `kind`). **Deterministisch:** in `tests/img_to_md_view.test.ts` die `ITEMS`-Fixture (`:13`) und die `twoItems`-Fixture (im „Alle anlegen"-Test) je um `kind: "image"` ergänzen (reine Test-Daten). Erst danach:

Run: `npm test && npm run typecheck && npm run lint`
Expected: alle grün.

- [ ] **Step 5: Commit**

```bash
git add src/img_to_md_state.ts tests/img_to_md_state.test.ts tests/img_to_md_view.test.ts
git commit -m "feat(pdf): State — Seiten-Karten-Expansion + Schreib-Partition

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Settings — pdfMaxPages + pdfRenderScale

**Files:**
- Modify: `src/settings.ts` (`ImageToMarkdownSettings`, `defaultSettings`, `display()`)
- Modify: `src/i18n.ts` (Settings-Strings)
- Test: `tests/settings.test.ts` (neu, nur `defaultSettings`)

**Interfaces:**
- Produces: `ImageToMarkdownSettings` zusätzlich `pdfMaxPages: number; pdfRenderScale: number`; `defaultSettings()` liefert `pdfMaxPages: 25, pdfRenderScale: 2.0`.

- [ ] **Step 1: i18n-Strings ergänzen**

Modify `src/i18n.ts` — EN:
```ts
"settings.pdfMaxPages.name": "PDF max. pages per run",
"settings.pdfMaxPages.desc": "Safety cap — larger PDFs must be narrowed via the page range.",
"settings.pdfRenderScale.name": "PDF render scale",
"settings.pdfRenderScale.desc": "Higher = sharper OCR but more memory (2.0 ≈ 144 dpi).",
```
DE:
```ts
"settings.pdfMaxPages.name": "PDF max. Seiten pro Lauf",
"settings.pdfMaxPages.desc": "Schutzgrenze — größere PDFs über den Seitenbereich einschränken.",
"settings.pdfRenderScale.name": "PDF-Render-Auflösung",
"settings.pdfRenderScale.desc": "Höher = schärfere OCR, aber mehr Speicher (2.0 ≈ 144 dpi).",
```

- [ ] **Step 2: defaultSettings-Test (failing)**

Create `tests/settings.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { defaultSettings } from "../src/settings";

describe("defaultSettings", () => {
  it("enthält PDF-Defaults", () => {
    const s = defaultSettings();
    expect(s.pdfMaxPages).toBe(25);
    expect(s.pdfRenderScale).toBe(2.0);
  });
});
```

- [ ] **Step 3: Test ausführen — muss fehlschlagen**

Run: `npx vitest run tests/settings.test.ts`
Expected: FAIL (Felder fehlen).

- [ ] **Step 4: Settings-Typ + Defaults + UI**

Modify `src/settings.ts` — Interface + Defaults:
```ts
export interface ImageToMarkdownSettings {
  visionEndpoint: string;
  visionModel: string;
  visionPrompt: string;
  pdfMaxPages: number;
  pdfRenderScale: number;
}

export function defaultSettings(): ImageToMarkdownSettings {
  return {
    visionEndpoint: "http://localhost:8080",
    visionModel: "",
    visionPrompt: defaultVisionPrompt(),
    pdfMaxPages: 25,
    pdfRenderScale: 2.0,
  };
}
```
In `display()` nach dem Prompt-Setting (`:140`) zwei Settings ergänzen:
```ts
new Setting(containerEl)
  .setName(t("settings.pdfMaxPages.name")).setDesc(t("settings.pdfMaxPages.desc"))
  .addText(tx => tx.setValue(String(this.plugin.settings.pdfMaxPages))
    .onChange(async (v: string) => {
      const n = Number(v); if (Number.isFinite(n) && n > 0) { this.plugin.settings.pdfMaxPages = Math.floor(n); await this.plugin.saveSettings(); }
    }));
new Setting(containerEl)
  .setName(t("settings.pdfRenderScale.name")).setDesc(t("settings.pdfRenderScale.desc"))
  .addText(tx => tx.setValue(String(this.plugin.settings.pdfRenderScale))
    .onChange(async (v: string) => {
      const n = Number(v); if (Number.isFinite(n) && n > 0) { this.plugin.settings.pdfRenderScale = n; await this.plugin.saveSettings(); }
    }));
```

- [ ] **Step 5: Test grün + Volllauf + Lint + Commit**

Run: `npm test && npm run typecheck && npm run lint`
Expected: grün.
```bash
git add src/settings.ts src/i18n.ts tests/settings.test.ts
git commit -m "feat(pdf): Settings pdfMaxPages (25) + pdfRenderScale (2.0)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: View-Logik für PDF (renderList, Bereich, Karten, Schreib-Gruppierung)

Alles, was ohne echtes pdf.js testbar ist: PDF-Listeneintrag mit Bereichsfeldern, Karten-Kopf je Seite, gruppiertes Schreiben über erweiterte Deps. `transcribeStream`/`writePdf` sind in den Tests gemockt.

**Files:**
- Modify: `src/img_to_md_view.ts` (Deps um `writePdf`+`page`; `renderList` PDF-Zweig; `renderCards` PDF-Kopf; `writeAll`/`writeOne` Partition)
- Modify: `src/i18n.ts` (View-Strings)
- Test: `tests/img_to_md_view.test.ts`

**Interfaces:**
- Consumes: `partitionDoneCards`, `ImgItem`, `ImgCard` (Task 6).
- Produces (Deps-Erweiterung):
  - `transcribeStream(sourcePath, item, onContent, onReasoning, signal, page?: number)` — `page` optional **am Ende** (bestehende Bild-Aufrufe bleiben gültig).
  - `writePdf(sourcePath: string, raw: string, link: string, pages: { page: number; content: string; model: string }[]): Promise<string | null>`.

- [ ] **Step 1: View-i18n-Strings**

Modify `src/i18n.ts` — EN:
```ts
"view.pdfPages": "{0} · {1} pages",
"view.pdfRangeFrom": "from page",
"view.pdfRangeTo": "to page",
"view.cardHeadPage": "{0} · page {1}/{2}",
```
DE:
```ts
"view.pdfPages": "{0} · {1} Seiten",
"view.pdfRangeFrom": "von Seite",
"view.pdfRangeTo": "bis Seite",
"view.cardHeadPage": "{0} · Seite {1}/{2}",
```

- [ ] **Step 2: View-PDF-Tests (failing)**

Modify `tests/img_to_md_view.test.ts` (die `kind: "image"`-Ergänzung der Fixtures erfolgte bereits in Task 6):
- `mkView`-Deps um `writePdf` ergänzen: `writePdf: over.writePdf ?? (async (_sp: string, _raw: string, _link: string, _pages: any[]) => { calls.written.push(_pages); return "doc (PDF transcript).md"; }),`
- Neue describe-Gruppe:
```ts
const PDF_ITEMS: ImgItem[] = [
  { raw: "![[doc.pdf]]", link: "doc.pdf", ext: "pdf", supported: true, kind: "pdf", pageCount: 2, range: { from: 1, to: 2 } },
];

describe("ImgToMdView — PDF", () => {
  it("listet PDF mit Seitenzahl + Bereichsfeldern", async () => {
    const { view } = mkView({ scan: async () => PDF_ITEMS });
    await view.onOpen();
    expect(all(view.contentEl, "img2md-name")[0].textContent).toContain("2");
    expect(all(view.contentEl, "img2md-pdf-from").length).toBe(1);
    expect(all(view.contentEl, "img2md-pdf-to").length).toBe(1);
  });
  it("run erzeugt eine Karte je Seite mit Seiten-Kopf", async () => {
    const { view } = mkView({ scan: async () => PDF_ITEMS });
    await view.onOpen(); await view.run();
    const cards = all(view.contentEl, "img2md-card");
    expect(cards.length).toBe(2);
    expect(all(view.contentEl, "img2md-card-head")[0].textContent).toContain("page 1/2");
  });
  it("Alle anlegen ruft writePdf einmal mit beiden Seiten", async () => {
    const { view, calls } = mkView({ scan: async () => PDF_ITEMS });
    await view.onOpen(); await view.run();
    all(view.contentEl, "img2md-all")[0].click();
    await Promise.resolve(); await Promise.resolve();
    expect(calls.written.length).toBe(1);
    expect(calls.written[0].map((p: any) => p.page)).toEqual([1, 2]);
    // beide Seiten-Karten als „angelegt" markiert (eine Notiz):
    expect(all(view.contentEl, "img2md-written").length).toBe(2);
  });
});
```

- [ ] **Step 3: Tests ausführen — müssen fehlschlagen**

Run: `npx vitest run tests/img_to_md_view.test.ts -t PDF`
Expected: FAIL.

- [ ] **Step 4: Deps-Interface erweitern**

Modify `src/img_to_md_view.ts` — `ImgToMdViewDeps`:
```ts
transcribeStream: (sourcePath: string, item: ImgItem, onContent: (t: string) => void, onReasoning: (t: string) => void, signal: AbortSignal, page?: number) => Promise<{ content: string; reasoning: string; model: string }>;
writePdf: (sourcePath: string, raw: string, link: string, pages: { page: number; content: string; model: string }[]) => Promise<string | null>;
```

- [ ] **Step 5: renderList PDF-Zweig**

Modify `renderList()` (`:90`) — innerhalb der Item-Schleife, statt nur Name:
```ts
if (item.kind === "pdf") {
  row.createEl("span", { cls: "img2md-name", text: t("view.pdfPages", this.basename(item.link), item.pageCount ?? 0) });
  const r = item.range ?? { from: 1, to: item.pageCount ?? 1 };
  const from = row.createEl("input", { cls: "img2md-pdf-from" }); from.type = "number"; from.value = String(r.from);
  from.setAttribute("aria-label", t("view.pdfRangeFrom"));
  const to = row.createEl("input", { cls: "img2md-pdf-to" }); to.type = "number"; to.value = String(r.to);
  to.setAttribute("aria-label", t("view.pdfRangeTo"));
  const clamp = () => {
    const max = item.pageCount ?? 1;
    let f = Math.max(1, Math.min(max, Math.floor(Number(from.value) || 1)));
    let tt = Math.max(f, Math.min(max, Math.floor(Number(to.value) || max)));
    item.range = { from: f, to: tt }; from.value = String(f); to.value = String(tt);
  };
  from.addEventListener("change", clamp); to.addEventListener("change", clamp);
} else {
  const label = item.supported ? this.basename(item.link) : t("view.unsupportedSuffix", this.basename(item.link));
  row.createEl("span", { cls: "img2md-name", text: label });
}
```
(Die Checkbox-Zeilen `:96-100` bleiben davor unverändert.)

- [ ] **Step 6: renderCards PDF-Kopf + run reicht page durch**

In `renderCards()` (`:111`) den Kopf abhängig vom Karten-Typ:
```ts
const head = card.page != null
  ? t("view.cardHeadPage", this.basename(card.item.link), card.page, card.total)
  : t("view.cardHead", card.index, card.total, this.basename(card.item.link));
cardEl.createDiv({ cls: "img2md-card-head", text: head });
```
In `run()` (`:154`) den `transcribeStream`-Aufruf um `card.page` ergänzen:
```ts
const r = await this.deps.transcribeStream(
  path, cards[i].item,
  (t) => { this.state.appendContent(i, t); this.renderCards(); },
  (t) => { this.state.appendReasoning(i, t); this.renderCards(); },
  signal, cards[i].page,
);
```

- [ ] **Step 7: writeAll/writeOne über Partition**

Modify `writeAll()` (`:184`) — Bilder wie bisher, PDFs gruppiert:
```ts
async writeAll(): Promise<void> {
  const path = this.deps.getActivePath();
  if (!path) return;
  const part = partitionDoneCards(this.state.cards);
  if (part.images.length) {
    const entries = part.images.map(x => ({ item: x.card.item, content: x.card.text.trim(), model: x.card.model }));
    const paths = await this.deps.writeTranscripts(path, entries);
    part.images.forEach((x, k) => { if (paths[k]) this.state.markWritten(x.cardIndex, paths[k]); });
  }
  for (const g of part.pdfs) {
    const created = await this.deps.writePdf(path, g.raw, g.link, g.pages.map(p => ({ page: p.page, content: p.content.trim(), model: p.model })));
    if (created) g.cardIndices.forEach(i => this.state.markWritten(i, created));
  }
  this.renderCards();
  await this.rescan();
}
```
Import oben anpassen (bestehend ist `import { ImgToMdState, ImgItem } from "./img_to_md_state";`): `import { ImgToMdState, ImgItem, partitionDoneCards } from "./img_to_md_state";`
`writeOne(i)` (`:174`) für PDF-Karten auf den Gruppen-Pfad umleiten:
```ts
async writeOne(i: number): Promise<void> {
  const path = this.deps.getActivePath();
  const card = this.state.cards[i];
  if (!path || !card || card.status !== "done") return;
  if (card.item.kind === "pdf") {
    const g = partitionDoneCards(this.state.cards).pdfs.find(x => x.raw === card.item.raw);
    if (g) {
      const created = await this.deps.writePdf(path, g.raw, g.link, g.pages.map(p => ({ page: p.page, content: p.content.trim(), model: p.model })));
      if (created) g.cardIndices.forEach(j => this.state.markWritten(j, created));
    }
  } else {
    const [created] = await this.deps.writeTranscripts(path, [{ item: card.item, content: card.text.trim(), model: card.model }]);
    if (created) this.state.markWritten(i, created);
  }
  this.renderCards();
  await this.rescan();
}
```

- [ ] **Step 8: Tests grün (View) + Volllauf**

Run: `npm test && npm run typecheck && npm run lint`
Expected: alle grün.

- [ ] **Step 9: Commit**

```bash
git add src/img_to_md_view.ts src/i18n.ts tests/img_to_md_view.test.ts
git commit -m "feat(pdf): View — PDF-Liste mit Bereich, Seiten-Karten, gruppiertes Schreiben

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: main.ts-Verdrahtung + Limits (Integration, empirisch)

Verbindet die reine Logik mit pdf.js/Obsidian: `scan` lädt Seitenzahl, `transcribeStream` rendert die Seite, `writePdf`-Dep, max-/Mobile-Limit.

**Files:**
- Modify: `src/main.ts` (`scan`, `transcribeStream`, `readImageDataUrl`, `writePdf`-Dep, Limits)
- Modify: `src/i18n.ts` (Limit-Notice)

**Interfaces:**
- Consumes: `pdfPageCount`, `renderPdfPage` (Task 1); `writePdfTranscript` (Task 5); `partitionDoneCards` (Task 6); `SUPPORTED_EXTS`, `PDF_EXT` (Task 2).

- [ ] **Step 1: Limit-i18n**

Modify `src/i18n.ts` — EN: `"core.pdfTooManyPages": "PDF has {0} pages (limit {1}) — narrow the page range.",` DE: `"core.pdfTooManyPages": "PDF hat {0} Seiten (Limit {1}) — Seitenbereich einschränken.",`

- [ ] **Step 2: scan PDF-aware (Seitenzahl laden, supported)**

Modify `src/main.ts` `makeImgViewDeps().scan` (`:81`):
```ts
scan: async (sourcePath: string): Promise<ImgItem[]> => {
  let content: string;
  try { content = await this.app.vault.adapter.read(sourcePath); } catch { return []; }
  const seen = new Set<string>();
  const items: ImgItem[] = [];
  for (const e of findImageEmbeds(content)) {
    if (seen.has(e.link)) continue; seen.add(e.link);
    if (e.kind === "pdf") {
      const resolved = this.app.metadataCache.getFirstLinkpathDest(e.link, sourcePath);
      let pageCount = 0;
      if (resolved) {
        try { pageCount = await pdfPageCount(await this.app.vault.adapter.readBinary(resolved.path)); } catch { pageCount = 0; }
      }
      const supported = pageCount > 0;
      const cappedTo = Math.min(pageCount, this.settings.pdfMaxPages);
      items.push({ raw: e.raw, link: e.link, ext: e.ext, supported, kind: "pdf", pageCount, range: { from: 1, to: cappedTo > 0 ? cappedTo : 1 } });
    } else {
      items.push({ raw: e.raw, link: e.link, ext: e.ext, supported: SUPPORTED_EXTS.includes(e.ext.toLowerCase()), kind: "image" });
    }
  }
  return items;
},
```
Import oben ergänzen: `import { pdfPageCount, renderPdfPage } from "./pdf_render";` und `import { writePdfTranscript } from "./pdf_to_md";`. (`SUPPORTED_EXTS` ist in `main.ts:5` bereits importiert.)

- [ ] **Step 3: transcribeStream rendert PDF-Seite; Limit prüfen**

Modify `transcribeStream`-Dep (`:92`):
```ts
transcribeStream: async (sourcePath, item, onContent, onReasoning, signal, page) => {
  const resolved = this.app.metadataCache.getFirstLinkpathDest(item.link, sourcePath);
  if (!resolved) throw new Error(t("core.imageNotFound", item.link));
  let dataUrl: string;
  if (item.kind === "pdf") {
    if ((item.range?.to ?? 1) - (item.range?.from ?? 1) + 1 > this.settings.pdfMaxPages) {
      throw new Error(t("core.pdfTooManyPages", item.pageCount ?? 0, this.settings.pdfMaxPages));
    }
    const scale = Platform.isMobile ? Math.min(this.settings.pdfRenderScale, 1.5) : this.settings.pdfRenderScale;
    const bytes = await this.app.vault.adapter.readBinary(resolved.path);
    dataUrl = await renderPdfPage(bytes, page ?? 1, scale);
  } else {
    dataUrl = `data:image/${this.mimeOf(resolved.extension)};base64,${arrayBufferToBase64(await this.app.vault.adapter.readBinary(resolved.path))}`;
  }
  return this.visionClient.transcribeStream(dataUrl, this.settings.visionPrompt, onContent, onReasoning, signal);
},
```
`Platform` aus `obsidian` importieren (`:1`).

- [ ] **Step 4: writePdf-Dep**

In `makeImgViewDeps()` ergänzen:
```ts
writePdf: async (sourcePath, raw, link, pages) => {
  const { path } = await writePdfTranscript(this.makeImgIO(), sourcePath, { raw, link }, pages);
  return path;
},
```

- [ ] **Step 5: Build + Volllauf + Lint**

Run: `npm run build && npm test && npm run typecheck && npm run lint`
Expected: alle grün, `main.js` gebaut.

- [ ] **Step 6: Empirische Verifikation (Desktop) — Kern-Akzeptanz**

Run: `npm run deploy`. In Obsidian (Plugin neu laden), eine Testnotiz mit `![[<mehrseitiges>.pdf]]` anlegen, lokalen Vision-Endpoint starten. Sidebar öffnen.
Expected:
- PDF erscheint mit „<name> · N Seiten" + Bereichsfeldern (Default 1–min(N,25)).
- „Transkribieren" zeigt eine Karte je Seite, Text streamt.
- „Alle anlegen" erzeugt **eine** Notiz `<name> (PDF-Transkript).md` mit `## Seite k`-Sektionen + eingebettetem PDF; in der Quellnotiz ist `![[…pdf]]` durch den Notiz-Embed ersetzt.
- Bereich z.B. „2–3" → nur diese Seiten.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts src/i18n.ts
git commit -m "feat(pdf): main-Verdrahtung — scan/render/writePdf + max-/Mobile-Limit

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Verifikations-Command entfernen, Doku, Manifest, finale Prüfung

**Files:**
- Modify: `src/main.ts`, `src/i18n.ts` (Smoke-Command entfernen)
- Modify: `README.md`, `README.de.md`, `CHANGELOG.md`, `AGENTS.md`, `docs/manual/...`
- Modify: `manifest.json`, `package.json`, `versions.json` (Version-Bump)

- [ ] **Step 1: Temporären Smoke-Command entfernen**

Modify `src/main.ts` — den in Task 1/Step 10 hinzugefügten `addCommand("pdf-render-selftest", …)` entfernen; `pdfSmokeTest`-Import entfernen. Modify `src/i18n.ts` — `cmd.pdfSmoke` (EN+DE) entfernen. (`pdfSmokeTest` bleibt in `pdf_render.ts` als Util.)

- [ ] **Step 2: Doku aktualisieren**

- `CHANGELOG.md`: neuer Eintrag „PDF embeds: transcribe embedded PDFs page-by-page (sidebar, page range, one note per PDF)".
- `README.md` + `README.de.md`: PDF-Feature im Funktionsabschnitt; Hinweis „PDFs via Sidebar, Seitenbereich wählbar".
- `AGENTS.md`: `pdf_render.ts` + `pdf_to_md.ts` ins Modul-Layout; pdf.js-Bundling-Gotcha (Worker-Blob, v4.10.38 gepinnt) in „Gotchas".
- `docs/manual/`: How-to „PDF transkribieren" ergänzen (kurz).

- [ ] **Step 3: Version-Bump**

Run: `npm run version-bump 0.2.0`
Expected: `manifest.json`, `package.json`, `versions.json` auf `0.2.0`. (minAppVersion bleibt `1.8.7`; `isDesktopOnly` bleibt `false`.)

- [ ] **Step 4: Finaler Volllauf**

Run: `npm run build && npm test && npm run typecheck && npm run lint`
Expected: alle grün; `main.js` gebaut.

- [ ] **Step 5: Mobile-Smoke (falls Gerät verfügbar) — sonst dokumentieren**

Wenn ein Mobile-Vault erreichbar ist: Plugin laden, kleines PDF (1–2 Seiten) transkribieren, auf Speicher/Absturz achten. Falls untragbar: in `AGENTS.md`/Manual den Mobile-Vorbehalt notieren (Limit greift; ggf. künftige Option desktop-only). Kein stiller Ausfall.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts src/i18n.ts README.md README.de.md CHANGELOG.md AGENTS.md docs/manual manifest.json package.json versions.json
git commit -m "docs+release: PDF-Embed-Transkription dokumentiert, v0.2.0

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Spec-Coverage-Check

| Spec §  | Anforderung | Task |
|---|---|---|
| §2 | PDF in Sidebar erkennen | 2, 9 |
| §2 | Seitenzahl anzeigen | 8, 9 |
| §2 | Bereichsauswahl (Default alle) | 8, 9 |
| §2 | Streamende Karte je Seite | 8, 9 |
| §2 | Eine Standard-Notiz pro PDF, Embed ersetzt | 4, 5 |
| §2 | max-Seiten-Limit | 7, 9 |
| §2 | Mobile-Schutz (Scale/Limit) | 7, 9 |
| §2 | Geteilter Prompt | 9 (nutzt `visionPrompt`) |
| §2 | pdf.js gebundlet | 1 |
| §2 | Command/Kontextmenü NICHT für PDF (Hinweis) | 2 |
| §3 | `pdf_render.ts` (pdf.js isoliert) | 1 |
| §3 | `pdf_to_md.ts` (reiner Kern) | 4, 5 |
| §3 | `ImageEmbed.kind/page`, `#page`-Anker | 2 |
| §3 | State-Erweiterung + Expansion | 6 |
| §6 | Notiz-Layout + lokalisierter Suffix (Bild+PDF) | 3, 4 |
| §8 | Settings pdfMaxPages/pdfRenderScale | 7 |
| §9 | i18n-Keys | 2,3,4,7,8,9 |
| §10 | Tests reiner Kern + State + View | 2–8 |
| §10 | Render-Schicht manuell smoke | 1, 9 |

Keine Spec-Anforderung ohne Task.
