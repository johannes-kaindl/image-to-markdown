# Born-digital PDF Text-Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Born-digital PDF-Seiten (mit echtem Text-Layer) liefern ihren exakten Text an das lokale Modell als reinen Text (kein Bild) zur Markdown-Formatierung — statt OCR; Scan-/Figuren-Seiten fallen automatisch aufs Vision-Modell zurück.

**Architecture:** Reiner Rekonstruktor + Schwelle in `pdf_to_md.ts`; pdf.js-Extraktion in `pdf_render.ts` (DOM); neuer text-only Streaming-Pfad `transcribeTextStream` in `vision_client.ts` (spiegelt `transcribeStream` ohne Bild); Per-Seite-Entscheid im `main.ts`-Glue; Setting `pdfUseTextLayer` + i18n.

**Tech Stack:** TypeScript (strict), pdfjs-dist 4.10.38 (legacy build), esbuild, vitest + happy-dom, Obsidian Plugin API, OpenAI-kompatibler Streaming-Endpoint.

Spec: `../specs/2026-06-30-pdf-textlayer-design.md`.

## Global Constraints

- TS strict + `noImplicitAny` — keine `any`-Casts (strukturelle `as`-Casts wie im Bestand ok).
- Reiner Kern obsidian-frei: `pdf_to_md.ts` importiert NICHT pdf.js/DOM; `pdf_render.ts` darf `pdf_to_md.ts` importieren (DOM→pur), nicht umgekehrt (kein Zyklus).
- i18n via `t()`, **EN kanonisch**, EN+DE-Parität (es gibt jetzt einen Paritätstest in `i18n.test.ts`).
- Keine restricted globals (eslint-plugin-obsidianmd); `minAppVersion` 1.8.7; `pdfjs-dist` bleibt 4.10.38.
- Nach jeder Änderung **alle Tests grün**; `tsc --noEmit` + `eslint src` + `npm run build` sauber.
- Conventional Commits, nur berührte Dateien stagen, Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## File Structure

- **Modify** `src/pdf_to_md.ts` — `reconstructPdfText`, `countNonWhitespace`, `PDF_TEXTLAYER_MIN_CHARS` (rein).
- **Modify** `tests/pdf_to_md.test.ts`.
- **Modify** `src/vision_client.ts` — `transcribeTextStream` (text-only).
- **Modify** `tests/vision_client.test.ts`.
- **Modify** `src/settings.ts` — Feld `pdfUseTextLayer` + Default + Toggle.
- **Modify** `tests/settings.test.ts`.
- **Modify** `src/i18n.ts` — `settings.pdfUseTextLayer.*` + `pdf.textLayerPrompt` (EN+DE).
- **Modify** `src/pdf_render.ts` — `extractPdfPageText` (DOM/pdf.js).
- **Modify** `src/main.ts` — Per-Seite-Glue im PDF-Zweig.
- **Modify** README EN/DE · `docs/manual` · `CHANGELOG.md`.

---

### Task 1: Reiner Rekonstruktor + Schwelle (`pdf_to_md.ts`)

**Files:**
- Modify: `src/pdf_to_md.ts` (oben, nach den Imports/Typen)
- Modify: `tests/pdf_to_md.test.ts`

**Interfaces:**
- Produces: `reconstructPdfText(items: { str: string; hasEOL?: boolean }[]): string`; `countNonWhitespace(s: string): number`; `PDF_TEXTLAYER_MIN_CHARS: number` (=200).

- [ ] **Step 1: Failing test.** In `tests/pdf_to_md.test.ts` ergänzen (Import oben um die drei Namen erweitern):

```ts
import { reconstructPdfText, countNonWhitespace, PDF_TEXTLAYER_MIN_CHARS } from "../src/pdf_to_md";

describe("reconstructPdfText", () => {
  it("fügt Strings zusammen, Zeilenumbruch bei hasEOL", () => {
    expect(reconstructPdfText([{ str: "Hallo " }, { str: "Welt", hasEOL: true }, { str: "Zeile 2" }])).toBe("Hallo Welt\nZeile 2");
  });
  it("kollabiert mehrere Leerzeilen + trimmt", () => {
    expect(reconstructPdfText([{ str: "A", hasEOL: true }, { str: "", hasEOL: true }, { str: "", hasEOL: true }, { str: "B", hasEOL: true }])).toBe("A\n\nB");
  });
  it("leere Item-Liste → ''", () => {
    expect(reconstructPdfText([])).toBe("");
  });
});

describe("countNonWhitespace / Schwelle", () => {
  it("zählt Nicht-Whitespace-Zeichen", () => {
    expect(countNonWhitespace("a b\nc\t")).toBe(3);
    expect(countNonWhitespace("   \n\t ")).toBe(0);
  });
  it("PDF_TEXTLAYER_MIN_CHARS ist 200", () => {
    expect(PDF_TEXTLAYER_MIN_CHARS).toBe(200);
  });
});
```

- [ ] **Step 2: Test laufen → fehlschlägt.** Run: `npx vitest run tests/pdf_to_md.test.ts` · Expected: FAIL (Imports nicht definiert).

- [ ] **Step 3: Implementieren.** In `src/pdf_to_md.ts` (nach den bestehenden Typen, vor `pagePrefix`) einfügen:

```ts
/** Mindest-Zeichen (Nicht-Whitespace) im Text-Layer, ab denen eine PDF-Seite als born-digital gilt
 *  und ihr exakter Text formatiert statt gerendert+OCR't wird. Darunter: Fallback aufs Vision-Modell. */
export const PDF_TEXTLAYER_MIN_CHARS = 200;

/** Nicht-Whitespace-Zeichen zählen (Schwellen-Check für den Text-Layer). Reine Funktion. */
export function countNonWhitespace(s: string): number { return s.replace(/\s/g, "").length; }

/** Rekonstruiert Lauftext aus pdf.js-Text-Items: Strings fügen, Zeilenumbruch bei hasEOL, Zeilen
 *  rechts-trimmen, ≥3 Newlines → Absatz, Gesamt-trim. Mehrspalten = best-effort (Item-Reihenfolge). Rein. */
export function reconstructPdfText(items: { str: string; hasEOL?: boolean }[]): string {
  let out = "";
  for (const it of items) { out += it.str ?? ""; if (it.hasEOL) out += "\n"; }
  return out.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}
```

- [ ] **Step 4: Test laufen → grün.** Run: `npx vitest run tests/pdf_to_md.test.ts` · Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/pdf_to_md.ts tests/pdf_to_md.test.ts
git commit -m "feat(pdf): reiner Text-Layer-Rekonstruktor + Schwelle"
```

---

### Task 2: text-only Streaming (`vision_client.ts`)

**Files:**
- Modify: `src/vision_client.ts` (neue Methode nach `transcribeStream`)
- Modify: `tests/vision_client.test.ts`

**Interfaces:**
- Consumes: `streamSSE`, `parseErrorEnvelope` (bestehend).
- Produces: `VisionClient.transcribeTextStream(text, prompt, onContent, onReasoning, signal?): Promise<{ content: string; reasoning: string; model: string }>`.

- [ ] **Step 1: Failing test.** In `tests/vision_client.test.ts` im `transcribeStream`-describe (oder einem neuen) ergänzen:

```ts
describe("VisionClient.transcribeTextStream (text-only)", () => {
  it("streamt content, Body ist text-only (String-content, kein image_url)", async () => {
    const calls: { body?: string }[] = [];
    setStreamFetch((_url, init) => { calls.push({ body: init?.body as string | undefined }); return Promise.resolve(streamRes(['data: {"model":"m","choices":[{"delta":{"content":"# A"}}]}\n\ndata: [DONE]\n\n'])); });
    const got: string[] = [];
    const r = await new VisionClient("http://x", "vm").transcribeTextStream("ROHTEXT", "Formatiere", t => got.push(t), () => {});
    expect(got).toEqual(["# A"]);
    expect(r).toEqual({ content: "# A", reasoning: "", model: "m" });
    const body = JSON.parse(calls[0].body!) as { messages: { content: unknown }[]; stream: boolean };
    expect(body.stream).toBe(true);
    expect(body.messages[0].content).toBe("Formatiere\n\nROHTEXT");
  });
  it("wirft Servermeldung bei 200-Error-Body", async () => {
    setStreamFetch(() => Promise.resolve(streamRes(['{"error":{"message":"boom"}}'])));
    await expect(new VisionClient("http://x", "vm").transcribeTextStream("t", "p", () => {}, () => {})).rejects.toThrow("boom");
  });
  it("wirft bei HTTP-Fehler", async () => {
    setStreamFetch(() => Promise.resolve(streamRes([], false, 500)));
    await expect(new VisionClient("http://x", "vm").transcribeTextStream("t", "p", () => {}, () => {})).rejects.toThrow("500");
  });
});
```

- [ ] **Step 2: Test laufen → fehlschlägt.** Run: `npx vitest run tests/vision_client.test.ts` · Expected: FAIL (`transcribeTextStream` undefined).

- [ ] **Step 3: Implementieren.** In `src/vision_client.ts` direkt NACH `transcribeStream` (vor der schließenden Klassen-`}`) einfügen:

```ts
  /** Wie transcribeStream, aber sendet reinen TEXT (kein Bild) — für born-digital PDF-Seiten, deren
   *  exakter Text-Layer extrahiert und vom Modell nur nach Markdown formatiert wird. */
  async transcribeTextStream(
    text: string, prompt: string,
    onContent: (t: string) => void, onReasoning: (t: string) => void,
    signal?: AbortSignal,
  ): Promise<{ content: string; reasoning: string; model: string }> {
    if (!streamFn) throw new Error("VisionClient: Stream-Transport nicht konfiguriert (setStreamFetch aufrufen)");
    const res = await streamFn(`${this.endpoint}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, messages: [{ role: "user", content: `${prompt}\n\n${text}` }], stream: true }),
      signal,
    });
    if (!res.ok) throw new Error(`Vision HTTP ${res.status}`);
    const r = await streamSSE(res, onContent, onReasoning);
    if (!r.content.trim() && !/^\s*data:/m.test(r.raw)) {
      const envelope = parseErrorEnvelope(r.raw);
      if (envelope) throw new Error(envelope);
    }
    return { content: r.content, reasoning: r.reasoning, model: r.model || this.model };
  }
```

- [ ] **Step 4: Test laufen → grün.** Run: `npx vitest run tests/vision_client.test.ts` · Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/vision_client.ts tests/vision_client.test.ts
git commit -m "feat(vision): transcribeTextStream — text-only Streaming-Pfad"
```

---

### Task 3: Setting `pdfUseTextLayer` + i18n

**Files:**
- Modify: `src/settings.ts` (Interface ~`:33-41`; `defaultSettings` ~`:43-53`; Toggle im `render()` nach dem PDF-Page-Separator ~`:224-234`)
- Modify: `src/i18n.ts` (EN nach den `settings.pdfPageSep.*`-Keys; DE analog; `pdf.textLayerPrompt` bei den `pdf.*`-Keys)
- Modify: `tests/settings.test.ts`

**Interfaces:**
- Produces: `ImageToMarkdownSettings.pdfUseTextLayer: boolean`; `defaultSettings().pdfUseTextLayer === true`; i18n-Keys `settings.pdfUseTextLayer.name/.desc`, `pdf.textLayerPrompt`.

- [ ] **Step 1: Failing test.** In `tests/settings.test.ts` im `defaultSettings`-describe ergänzen:

```ts
it("pdfUseTextLayer ist default true", () => {
  expect(defaultSettings().pdfUseTextLayer).toBe(true);
});
```

- [ ] **Step 2: Test laufen → fehlschlägt.** Run: `npx vitest run tests/settings.test.ts` · Expected: FAIL (`undefined`).

- [ ] **Step 3: Settings-Feld + Default.** Interface (`src/settings.ts`) um eine Zeile (nach `pdfPageSeparator`):

```ts
  pdfPageSeparator: PdfPageSeparator;
  pdfUseTextLayer: boolean;
}
```

  `defaultSettings()` (nach `pdfPageSeparator: "comment",`):

```ts
    pdfPageSeparator: "comment",
    pdfUseTextLayer: true,
  };
```

- [ ] **Step 4: i18n-Keys.** In `src/i18n.ts` **EN** nach `"settings.pdfPageSep.none": …,`:

```ts
  "settings.pdfUseTextLayer.name": "Use embedded PDF text",
  "settings.pdfUseTextLayer.desc": "When a PDF page has a real text layer, send its exact text to the model to format as Markdown instead of OCR-ing a rendered image — faster and without OCR errors. Pages without enough text (scans, figures) fall back to the vision model.",
```

  EN bei den `pdf.*`-Keys (nach `"pdf.pageFailed": …,`):

```ts
  "pdf.textLayerPrompt":
    "Format the following text, extracted from a PDF page, into clean Markdown. Preserve the exact " +
    "wording — do not rephrase, add or omit content; only add structure (headings, lists, tables, " +
    "emphasis). Output only the Markdown, no comments.",
```

  **DE** nach `"settings.pdfPageSep.none": …,`:

```ts
  "settings.pdfUseTextLayer.name": "Eingebetteten PDF-Text nutzen",
  "settings.pdfUseTextLayer.desc": "Hat eine PDF-Seite einen echten Text-Layer, wird ihr exakter Text ans Modell geschickt und nach Markdown formatiert, statt ein gerendertes Bild zu OCR'en — schneller und ohne OCR-Fehler. Seiten ohne genug Text (Scans, Figuren) fallen aufs Vision-Modell zurück.",
```

  DE bei den `pdf.*`-Keys (nach `"pdf.pageFailed": …,`):

```ts
  "pdf.textLayerPrompt":
    "Formatiere den folgenden, aus einer PDF-Seite extrahierten Text zu sauberem Markdown. Erhalte den " +
    "Wortlaut exakt — formuliere nichts um, füge nichts hinzu, lass nichts weg; ergänze nur Struktur " +
    "(Überschriften, Listen, Tabellen, Hervorhebungen). Gib nur das Markdown aus, keine Kommentare.",
```

- [ ] **Step 5: Settings-Toggle.** In `src/settings.ts` `render()` nach dem PDF-Page-Separator-`Setting` (vor dem Ende von `render()`):

```ts
    // ── PDF Text-Layer ──
    new Setting(containerEl)
      .setName(t("settings.pdfUseTextLayer.name")).setDesc(t("settings.pdfUseTextLayer.desc"))
      .addToggle(tg => tg.setValue(this.plugin.settings.pdfUseTextLayer)
        .onChange(async (v: boolean) => { this.plugin.settings.pdfUseTextLayer = v; await this.plugin.saveSettings(); }));
```

- [ ] **Step 6: Tests laufen → grün.** Run: `npx vitest run tests/settings.test.ts tests/i18n.test.ts` · Expected: PASS (inkl. EN/DE-Paritätstest).

- [ ] **Step 7: Commit.**

```bash
git add src/settings.ts src/i18n.ts tests/settings.test.ts
git commit -m "feat(settings): pdfUseTextLayer-Toggle (default an) + i18n"
```

---

### Task 4: pdf.js-Extraktion + main.ts-Glue (DOM/Integration)

**Files:**
- Modify: `src/pdf_render.ts` (Import + neue Funktion `extractPdfPageText`)
- Modify: `src/main.ts` (Imports; PDF-Zweig `transcribeStream` `:152-153`)

**Interfaces:**
- Consumes: `reconstructPdfText`, `countNonWhitespace`, `PDF_TEXTLAYER_MIN_CHARS` (Task 1); `transcribeTextStream` (Task 2); `t("pdf.textLayerPrompt")` (Task 3).
- Produces: `extractPdfPageText(bytes: ArrayBuffer, page: number): Promise<string>`.

*DOM/Glue ohne eigenen Unit-Test (`pdf_render.ts`/`main.ts` sind DOM bzw. Glue — wie `renderPdfPage`) — verifiziert über `tsc`/`build` + Geräte-Abnahme; der reine Rekonstruktor ist in Task 1 getestet.*

- [ ] **Step 1: `extractPdfPageText`.** In `src/pdf_render.ts` Import ergänzen:

```ts
import { reconstructPdfText } from "./pdf_to_md";
```

  und nach `renderPdfPage` einfügen:

```ts
/** Extrahiert den eingebetteten Text-Layer einer Seite (1-basiert) als rekonstruierten Lauftext.
 *  "" wenn kein Text-Layer. DOM/pdf.js-Schicht; die Rekonstruktion ist rein (pdf_to_md). */
export async function extractPdfPageText(bytes: ArrayBuffer, page: number): Promise<string> {
  ensureWorker();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
  try {
    const pdfPage = await doc.getPage(page);
    const tc = await pdfPage.getTextContent();
    const items: { str: string; hasEOL?: boolean }[] = [];
    for (const it of tc.items) {
      const o = it as { str?: unknown; hasEOL?: unknown };
      if (typeof o.str === "string") items.push({ str: o.str, hasEOL: o.hasEOL === true });
    }
    return reconstructPdfText(items);
  } finally { await doc.destroy(); }
}
```

- [ ] **Step 2: main.ts-Imports.** In `src/main.ts`:
  - `import { pdfPageCount, renderPdfPage } from "./pdf_render";` → `import { pdfPageCount, renderPdfPage, extractPdfPageText } from "./pdf_render";`
  - `import { writePdfTranscript } from "./pdf_to_md";` → `import { writePdfTranscript, countNonWhitespace, PDF_TEXTLAYER_MIN_CHARS } from "./pdf_to_md";`

- [ ] **Step 3: Per-Seite-Glue.** In `src/main.ts` den PDF-Block (`:152-153`) ersetzen:

  Vorher:
```ts
          const bytes = await this.app.vault.adapter.readBinary(filePath);
          dataUrl = await renderPdfPage(bytes, page ?? 1, scale);
```
  Nachher:
```ts
          const bytes = await this.app.vault.adapter.readBinary(filePath);
          if (this.settings.pdfUseTextLayer) {
            const layerText = await extractPdfPageText(bytes, page ?? 1);
            if (countNonWhitespace(layerText) >= PDF_TEXTLAYER_MIN_CHARS) {
              const fmt = t("pdf.textLayerPrompt");
              try {
                return await this.visionClient.transcribeTextStream(layerText, fmt, onContent, onReasoning, signal);
              } catch (err) {
                await this.resolveAndReconnect();
                if (this.activeEndpoint) return this.visionClient.transcribeTextStream(layerText, fmt, onContent, onReasoning, signal);
                throw err;
              }
            }
          }
          dataUrl = await renderPdfPage(bytes, page ?? 1, scale);
```

- [ ] **Step 4: Voll verifizieren.** Run: `npx vitest run && npm run typecheck && npm run lint && npm run build` · Expected: alle grün/sauber.

- [ ] **Step 5: Commit.**

```bash
git add src/pdf_render.ts src/main.ts
git commit -m "feat(pdf): Text-Layer-Extraktion + Per-Seite-Entscheid (born-digital → text-only LLM)"
```

---

### Task 5: Doku (README EN/DE · Manual · CHANGELOG)

**Files:**
- Modify: `README.md`, `README.de.md` (Feature-Liste: Text-Layer erwähnen)
- Modify: `docs/manual/how-to.md` (PDF-Abschnitt) + `docs/manual/reference.md` (Settings-Tabelle: neue Zeile)
- Modify: `CHANGELOG.md` (`## [Unreleased]` → `### Hinzugefügt`)

*Reine Doku — kein Test; Vollständigkeit per Review.*

- [ ] **Step 1: CHANGELOG `[Unreleased]`.**

```markdown
### Hinzugefügt

- **Born-digital PDFs nutzen den eingebetteten Text:** Hat eine PDF-Seite einen echten Text-Layer
  (exportierte Folien, Paper, Text-PDFs), wird ihr exakter Text ans Modell geschickt und nach Markdown
  formatiert — statt ein gerendertes Bild zu OCR'en. Schneller und ohne OCR-Fehler. Scan-/Figuren-Seiten
  fallen automatisch aufs Vision-Modell zurück. Abschaltbar (Setting „Eingebetteten PDF-Text nutzen").
```

- [ ] **Step 2: README EN + DE** — je einen Feature-Bullet ergänzen (Stil der Nachbarpunkte; absolute Links). EN-Vorschlag: „**Born-digital PDFs** — pages with a real text layer are sent to the model as exact text (not an image) to format as Markdown: faster and without OCR errors; scanned pages fall back to the vision model". DE sinngemäß.

- [ ] **Step 3: Manual** — `how-to.md` (PDF-Rezept) um 1–2 Sätze zum Text-Layer + Setting ergänzen; `reference.md`-Settings-Tabelle eine Zeile „Use embedded PDF text / Eingebetteten PDF-Text nutzen | … | `true`".

- [ ] **Step 4: Commit.**

```bash
git add README.md README.de.md docs/manual CHANGELOG.md
git commit -m "docs: born-digital PDF Text-Layer (README EN/DE, Manual, CHANGELOG)"
```

---

## Nach dem Plan (außerhalb der Tasks)

Adversarieller Whole-Branch-Review → `version-bump 0.8.0` → Merge `main` (`--no-ff`) → Deploy Pallas → **Geräte-Abnahme (User):** born-digital-PDF → schnelles, fehlerfreies MD; Scan-PDF → unverändert Vision → Release 0.8.0 (Codeberg + GitHub; Mirror ggf. wieder manuell, siehe Memory `codeberg-release-gotcha`).

## Self-Review (durchgeführt)
- **Spec-Coverage:** Rekonstruktor+Schwelle (T1) · text-only Pfad (T2) · Setting+i18n inkl. Format-Prompt (T3) · Extraktion+Glue+Per-Seite-Fallback+Retry (T4) · Doku (T5). ✓
- **Placeholder-Scan:** kein TBD/TODO; jeder Code-Step zeigt echten Code. ✓
- **Typ-Konsistenz:** `reconstructPdfText(items:{str,hasEOL?}[])` · `extractPdfPageText(bytes,page)` · `transcribeTextStream(text,prompt,onContent,onReasoning,signal?)` · `countNonWhitespace`/`PDF_TEXTLAYER_MIN_CHARS` durchgängig identisch (T1/T2 Definition ↔ T4 Konsum). ✓
