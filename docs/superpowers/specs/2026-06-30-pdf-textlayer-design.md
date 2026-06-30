# Spec — Born-digital PDF: Text-Layer + LLM-Markdown (0.8.0)

Tier-2-Feature aus der Best-Practice/SOTA-Gap-Analyse (Roadmap §🗺️). Born-digital PDFs (exportierte
Folien, Paper, Text-PDFs) haben einen **eingebetteten Text-Layer**. Den per Vision-Modell zu OCR'en ist
verschwenderisch und fehleranfällig. Stattdessen: den **exakten** Text via pdf.js extrahieren und an das
lokale Modell **als reinen Text** (kein Bild) schicken mit der Anweisung, ihn nach Markdown zu formatieren.
Schneller als OCR (kein Bild, kleinerer Input), **keine OCR-Fehler**, trotzdem strukturiertes Markdown.

## Entscheidungen (Brainstorming 2026-06-30)

- **Steuerung:** Setting `pdfUseTextLayer`, Default **AN**; **pro Seite** Auto-Entscheidung mit Fallback.
- **Erkennung:** Eine Seite gilt als born-digital, wenn ihr Text-Layer **≥ 200 Nicht-Whitespace-Zeichen**
  liefert; sonst (Figuren-/Scan-Seite) Fallback auf das Vision-Modell (so geht keine Bild-Seite verloren).
- **Markdown:** **Text-only-LLM-Pass** (nicht reine Code-Heuristik) — exakter Text + „formatiere zu
  Markdown, Wortlaut exakt". Eigener Format-Prompt, **nicht** die Vision-Presets (#3, bild-orientiert).
- **Schwelle 200** ist eine hardcodierte Konstante (kein Setting — YAGNI).

## Architektur

Reine/DOM-Trennung gewahrt. Die pdf.js-Extraktion lebt in `pdf_render.ts` (DOM-Schicht), die
Text-Rekonstruktion ist rein und unit-getestet, der text-only LLM-Pfad spiegelt den bestehenden
Streaming-Pfad.

### `src/pdf_render.ts` (DOM/pdf.js)
- Neu `extractPdfPageText(bytes: ArrayBuffer, page: number): Promise<string>`:
  öffnet das Doc (wie `renderPdfPage`), `const tc = await pdfPage.getTextContent();`
  mappt `tc.items` auf `{ str, hasEOL }[]` (nur `TextItem` mit `str`; `TextMarkedContent` ohne `str`
  überspringen), ruft `reconstructPdfText(items)`, gibt die Zeichenkette zurück. `doc.destroy()` im finally.

### `src/pdf_to_md.ts` — reiner Rekonstruktor + Schwelle
- Neu `export const PDF_TEXTLAYER_MIN_CHARS = 200;` und `export function countNonWhitespace(s: string): number`
  (`s.replace(/\s/g, "").length`) — beide rein, von `main.ts` importiert; so liegt die Schwelle testbar
  und an einem Ort.
- Neu `reconstructPdfText(items: { str: string; hasEOL?: boolean }[]): string`:
  - akkumuliert `str`; nach einem Item mit `hasEOL === true` ein `"\n"` anhängen;
  - am Ende: `\n{3,}` → `\n\n` (Leerzeilen kollabieren), Zeilen rechts-trimmen, Gesamt-`trim()`.
  - Reine Funktion, kein pdf.js/DOM. Mehrspalten-Lesereihenfolge = best-effort (pdf.js-Item-Reihenfolge).

### `src/vision_client.ts` — text-only Streaming
- Neu `transcribeTextStream(text, prompt, onContent, onReasoning, signal): Promise<{ content; reasoning; model }>`:
  baut eine **reine Text-Nachricht** `[{ role:"user", content: `${prompt}\n\n${text}` }]` (String-Content,
  kein `image_url`), POSTet `stream:true` an `/v1/chat/completions`, nutzt `streamSSE` + die bestehende
  200-Error-Body-Erkennung (`parseErrorEnvelope` über `r.raw`), Modell aus dem Stream (Fallback Konstruktor).
  Spiegelt `transcribeStream` 1:1 ohne das Bild. `buildMessages` bleibt unverändert (Bild-Pfad).

### `src/main.ts` — Glue (ungetestet, Geräte-Abnahme)
- Im PDF-Zweig von `makeImgViewDeps().transcribeStream`, NACH dem Lesen der `bytes`:
  ```
  if (this.settings.pdfUseTextLayer) {
    const text = await extractPdfPageText(bytes, page ?? 1);
    if (countNonWhitespace(text) >= PDF_TEXTLAYER_MIN_CHARS) {
      const fmtPrompt = t("pdf.textLayerPrompt");
      try { return await this.visionClient.transcribeTextStream(text, fmtPrompt, onContent, onReasoning, signal); }
      catch (err) { await this.resolveAndReconnect(); if (this.activeEndpoint) return this.visionClient.transcribeTextStream(text, fmtPrompt, onContent, onReasoning, signal); throw err; }
    }
  }
  // sonst: bestehender Render+Vision-Pfad (renderPdfPage → transcribeStream mit Bild)
  ```
  `PDF_TEXTLAYER_MIN_CHARS = 200` + `countNonWhitespace` (klein, in `pdf_to_md.ts` als reiner Helfer,
  oder inline). `extractPdfPageText` + `transcribeTextStream` importieren.
- Für Fallback-Seiten wird das Doc zweimal geöffnet (extract-Check + render) — bewusst akzeptiert (v1,
  konsistent mit dem bestehenden per-Seite-`renderPdfPage`).

### Settings + i18n
- `settings.ts`: Feld `pdfUseTextLayer: boolean`; `defaultSettings()` → `true`. Settings-Tab: ein
  `addToggle` (Name/Desc aus i18n), gespeichert via `saveSettings()`.
- i18n EN/DE neu:
  - `settings.pdfUseTextLayer.name` = „Use embedded PDF text" / „Eingebetteten PDF-Text nutzen"
  - `settings.pdfUseTextLayer.desc` = „When a PDF page has a real text layer, send its exact text to the
    model to format as Markdown instead of OCR-ing a rendered image — faster and without OCR errors.
    Pages without enough text (scans, figures) fall back to the vision model." / DE sinngemäß.
  - `pdf.textLayerPrompt` = „Format the following text, extracted from a PDF page, into clean Markdown.
    Preserve the exact wording — do not rephrase, add or omit content; only add structure (headings,
    lists, tables, emphasis). Output only the Markdown, no comments." / DE sinngemäß.

## Datenfluss
born-digital Seite: `bytes → extractPdfPageText → reconstructPdfText → (≥200) → transcribeTextStream
(text-only) → streamSSE → Karte (model = Response-Modell)`. Scan/Figur-Seite: unverändert
`bytes → renderPdfPage(PNG) → transcribeStream(Bild) → Karte`. Die Merge-Notiz (`writePdfTranscript`,
Partition, Platzhalter, Range aus 0.6.1) bleibt unverändert — eine Karte mit Inhalt ist eine Karte mit
Inhalt, egal welcher Pfad.

## Testing
- `tests/pdf_to_md.test.ts`: `reconstructPdfText` — `hasEOL`→Zeilen, mehrere Leerzeilen kollabieren,
  leere/`str`-lose Items, `trim`; `countNonWhitespace`.
- `tests/vision_client.test.ts`: `transcribeTextStream` — streamt content, Body ist **text-only**
  (`content` ist String/ohne `image_url`), Modell aus Stream/Fallback, Error-Envelope bei 200-Fehler-Body,
  HTTP-Fehler wirft.
- `tests/settings.test.ts`: `defaultSettings().pdfUseTextLayer === true`.
- `extractPdfPageText` + der `main.ts`-Per-Seite-Entscheid = DOM/Glue → Geräte-Abnahme (born-digital-PDF
  → schnelles, fehlerfreies MD; Scan-PDF → unverändert Vision).
- Alle bestehenden Tests grün; `tsc`/`eslint`/`build` sauber.

## Out of scope (bewusst)
- Einzelseite mit Text **und** Figur: Text-Layer (≥200) gewinnt, eingebettete Figur wird nicht
  beschrieben (dokumentiert; konservativere Schwelle mildert es).
- Perfekte Mehrspalten-Lesereihenfolge (pdf.js-Item-Reihenfolge).
- Sehr dichte Seite > Modell-Kontext (gleiches Risiko wie jede lange Transkription).
- Alle Seiten in einem `doc`-open (Effizienz, später); Schwelle als Setting; separates „Text-Layer"-
  Provenienz-Label/Frontmatter.

## Risiko (dokumentiert)
Kleine Modelle könnten beim Formatieren paraphrasieren statt exakt zu erhalten — der Format-Prompt
schärft „Wortlaut exakt, nichts ändern"; Trade-off gegen OCR-Fehler; Feature per Setting abschaltbar.

## DoD
Alle Tests grün, `tsc`/`eslint`/`build` sauber, adversarieller Whole-Branch-Review, nach Pallas
deployed, Geräte-Abnahme (born-digital + Scan), Release 0.8.0 (Codeberg kanonisch + GitHub-Mirror).
