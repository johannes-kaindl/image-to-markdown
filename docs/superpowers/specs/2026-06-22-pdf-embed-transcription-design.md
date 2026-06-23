# Design: PDF-Embeds transkribieren (Phase 1a)

**Datum:** 2026-06-22
**Status:** Entwurf zur Freigabe
**Scope:** Erweiterung von `image-to-markdown` um die Transkription **eingebetteter PDFs** einer Notiz — analog zur bestehenden Bild-Transkription, aber Seite-für-Seite.

---

## 1 · Motivation & Kern-Erkenntnis

Das Plugin transkribiert heute die **Bilder** einer Notiz per lokalem Vision-LLM nach Markdown. Eingebettete **PDFs** sollen denselben Weg gehen.

**Zentrale technische Einsicht (recherchiert):** Kein lokaler, OpenAI-Chat-Completions-kompatibler Vision-Endpoint (LM Studio, mlx_vlm, Ollama) nimmt PDFs direkt entgegen — LM Studio prüft sogar die Magic Bytes und lehnt mit HTTP 400 ab. Direkten PDF-Input gibt es nur bei der Anthropic-Messages- bzw. OpenAI-Responses-API, **nicht** in Chat Completions, das `vision_client.ts` spricht.

→ Der einzig tragfähige Weg ist **clientseitiges Rendern**: PDF-Seite → PNG (via pdf.js) → durch **genau den Bild-Pfad**, den das Plugin heute schon hat (`data:image/png;base64` → `buildMessages` → SSE). Die Vision-Schicht (`vision_client.ts`/`sse.ts`) bleibt damit **unverändert**; der gesamte Aufwand liegt *oberhalb*: Erkennung, Render, Multi-Page-Notizbau.

---

## 2 · Scope

### Phase 1a — diese Spec

- Eingebettete PDFs in der **Sidebar-View** erkennen (`![[doc.pdf]]`, `![[doc.pdf#page=N]]`, `![](doc.pdf)`).
- Seitenzahl ermitteln und anzeigen (pdf.js `numPages`).
- **Bereichsauswahl** pro PDF: Default **alle** Seiten, optional „von–bis".
- Pro gewählter Seite eine **streamende Karte** (wie heute pro Bild).
- Pro PDF **eine** Transkript-Notiz im **Standard-Layout**: Frontmatter + PDF-Embed + `## Seite N`-Sektionen.
- `![[doc.pdf]]`-Embed in der Quellnotiz wird durch einen Embed der neuen Notiz ersetzt (nicht-destruktiv, wie bei Bildern).
- **max-Seiten-Limit** (Setting) als Schutz gegen versehentliche Riesen-PDFs.
- **Mobile-Schutz:** niedrigeres Default-Limit + reduzierte Render-Scale auf Mobile (`Platform.isMobile`).
- Geteilter Prompt (Bild + PDF-Seite nutzen `settings.visionPrompt`).
- pdf.js (`pdfjs-dist`) ins Bundle aufnehmen.

### Bewusst NICHT in Phase 1a (YAGNI, spätere Slices)

- **Phase 1b — 2-Ebenen-Notizmodell:** Index-Notiz → N Seiten-Notizen, jede mit Seitenbild (PNG als Datei) + Text; Setting-Toggle Standard ↔ 2-Ebenen. *Begründung des Schnitts:* zuerst Qualitäts-Feedback der gerasterten OCR einholen, bevor die PNG-Datei-Speicherung gebaut wird.
- **Phase 2 — schrittweises Nachziehen** über mehrere Läufe (Skip schon erledigter Seiten, Merge in existierende Notiz, Embed-Ersetzung erst bei Vollständigkeit).
- **Command / Kontextmenü** für PDF (kein Bereich-UI vorhanden → Sidebar ist der PDF-Pfad). Auf einem PDF-Embed zeigt das Kontextmenü vorerst keinen Eintrag.

---

## 3 · Architektur

Reiner Kern bleibt obsidian-/DOM-frei (PROF-OBS-03/04). pdf.js + Canvas leben isoliert in einer eigenen Obsidian-Schicht-Datei.

### Neue Module

| Datei | Schicht | Verantwortung |
|---|---|---|
| **`pdf_render.ts`** | Obsidian/DOM | Einziger Ort, der pdf.js kennt: `pdfPageCount(bytes)`, `renderPdfPage(bytes, page, scale) → PNG-Data-URL`. Kapselt `getDocument`, Worker-Setup (Inline-Blob), Canvas-Render. |
| **`pdf_to_md.ts`** | reiner Kern | Notiz-Builder `buildPdfNote(...)` (Standard-Layout) + Pfad-Helfer. Reine Funktionen, in Node TDD-bar (kein pdf.js, kein DOM). |

### Geänderte Module

| Datei | Änderung |
|---|---|
| `img_to_md.ts:3-6` | `ImageEmbed` → `{ raw; link; ext; kind: "image" \| "pdf"; page?: number }`. `PDF_EXT = "pdf"` als eigene Kategorie (NICHT in `IMAGE_EXTS` — sonst erzeugt `mimeOf` ein ungültiges `image/pdf`). |
| `img_to_md.ts:8-9,15-32` | `extOf` + `findImageEmbeds`: `.pdf` erkennen; **`#page=N`-Anker erhalten** (geht heute bei `:9` und `:20` per `split("#")[0]` verloren) und als `page` mitführen. |
| `img_to_md_state.ts:3` | `ImgItem` → zusätzlich `kind`, `pageCount?` (PDF), `range?: { from; to }` (PDF). `startCards` expandiert PDF-Items zu Seiten-Karten. |
| `img_to_md_state.ts:7-17` | `ImgCard` → zusätzlich `page?: number` (PDF-Seite). |
| `img_to_md_view.ts:90-104` | Listeneintrag für PDF: Name + Seitenzahl + zwei Bereichs-Zahlenfelder. |
| `img_to_md_view.ts:142-194` | `run`/`writeAll`/`writeOne`: Karten-Streaming pro Seite; **Schreiben gruppiert PDF-Seiten-Karten nach `link`** zu einer Notiz. |
| `main.ts:58,70-71,92-97` | `scan`: PDFs erkennen, `pdfPageCount` laden, `pageCount`/`range` setzen. `transcribeStream`-Dep + `readImageDataUrl`: bei `kind==="pdf"` über `renderPdfPage(bytes, page, scale)` statt `readBinary→base64`. `mimeOf` für PDF nicht benutzt (PNG hart). Neue Schreib-Dep für PDF-Gruppen. |
| `settings.ts:7-20` | `ImageToMarkdownSettings` → `pdfMaxPages: number`, `pdfRenderScale: number` (+ Defaults). UI-Felder in `display()`. |
| `i18n.ts` | Neue Keys (PDF-Seiten-Karten-Kopf, PDF-Listeneintrag, Bereich, Limit-Warnung). Bild-zentrierte Strings, wo nötig, verallgemeinern. |
| `esbuild.config.mjs`, `package.json`, `manifest.json` | `pdfjs-dist` als Dependency + bundeln; Worker-Strategie; ggf. `minAppVersion`/Mobile prüfen. |

**Unverändert:** `vision_client.ts`, `sse.ts`, `think_splitter.ts`, `http.ts`, `capabilities.ts` — der Vision-/Transport-Pfad ist format-agnostisch und bekommt weiterhin nur eine PNG-Data-URL.

---

## 4 · Datenmodell

```ts
// img_to_md.ts
export const IMAGE_EXTS = [...];        // unverändert (steuert mimeOf)
export const PDF_EXT = "pdf";

export interface ImageEmbed {
  raw: string;                          // "![[doc.pdf]]" — Literal für replaceEmbed
  link: string;                         // "doc.pdf" (ohne #-Anker)
  ext: string;                          // "pdf" | "png" | …
  kind: "image" | "pdf";
  page?: number;                        // nur bei #page=N im Embed gesetzt
}

// img_to_md_state.ts
export interface ImgItem {
  raw: string; link: string; ext: string; supported: boolean;
  kind: "image" | "pdf";
  pageCount?: number;                   // PDF: aus pdfPageCount()
  range?: { from: number; to: number }; // PDF: Default {1, pageCount}, vom User editierbar
}

export interface ImgCard {
  item: ImgItem; index: number; total: number;
  text: string; reasoning: string; model: string; status: CardStatus;
  page?: number;                        // PDF-Seitennummer dieser Karte
  error?: string; writtenPath?: string;
}
```

**Bereichs-Semantik:** `range` wird beim Scan auf `{1, pageCount}` initialisiert (= alle). Der User editiert von/bis in der Liste. Beim Run werden Seiten `from..to` (geklemmt auf `1..pageCount`, gedeckelt auf `pdfMaxPages`) zu Karten expandiert. Ist `pageCount > pdfMaxPages` und der Bereich überschreitet das Limit → Notice mit Aufforderung, den Bereich einzuschränken (kein stiller Abschnitt).

---

## 5 · Datenfluss (Sidebar)

```
scan(notePath)
  Bilder  → ImgItem{kind:"image", supported}              (wie heute)
  PDFs    → bytes = readBinary(pdf)
            pageCount = pdfPageCount(bytes)
            ImgItem{kind:"pdf", pageCount, range:{1,pageCount}, supported:true}

renderList()
  Bild → Checkbox + Name                                  (wie heute)
  PDF  → Checkbox + "doc.pdf · 24 Seiten" + [from][to]-Felder

run()  (Stop bricht ab — wie heute)
  startCards(): Bild-Item → 1 Karte; PDF-Item → Karten für Seiten from..to
  pro Karte:
    Bild → readImageDataUrl(path, ext)                    (wie heute)
    PDF  → renderPdfPage(bytes, card.page, scale) → PNG-Data-URL
    transcribeStream(dataUrl, prompt, onContent, onReasoning, signal)  → live

writeAll() / writeOne()
  Gruppieren:
    Bild-Karten     → je 1 Notiz via writeTranscripts()   (wie heute)
    PDF-Karten/link → 1 Notiz via writePdfTranscript():
        buildPdfNote(pdfLink, sourceName, date, model, pages[], range)
        createNote(uniqueNotePath(basenameNoExt(pdf) + suffix))
        replaceEmbed(content, raw, newBasename)            // ![[doc.pdf]] → ![[doc (PDF-Transkript)]]
```

**Idempotenz** (identisch zur Bild-Mechanik): Nach dem Lauf ist `![[doc.pdf]]` durch den Notiz-Embed ersetzt → beim nächsten Scan wird das PDF nicht mehr gefunden. Kein „existiert?"-Check, kein State. (Genau das macht das spätere Phase-2-Nachziehen zu einem bewussten Zusatz, nicht zu einer Voraussetzung.)

---

## 6 · Notiz-Layout (Standard)

Pro PDF **eine** Notiz, Pfad `<pdf-basename> (PDF-Transkript).md` neben der Quellnotiz (kollisionsfrei via `uniqueNotePath`). Der Suffix ist **lokalisiert** (EN `(PDF transcript)`, DE `(PDF-Transkript)`).

**Konsistenz-Entscheidung (Review):** Damit Transkript-Notizen klar als solche erkennbar sind, bekommt auch die **Bild**-Transkription einen lokalisierten Suffix (`bild (Transkript).md` statt heute `bild.md`). `transcriptNotePath` (`img_to_md.ts:69-71`) wird dafür angepasst; der bestehende Naming-Test wird mitgezogen. Betrifft nur **neue** Notizen — bestehende bleiben unberührt.

```markdown
---
source_pdf: "[[doc.pdf]]"
source_note: "[[Quellnotiz]]"
created: 2026-06-22
transcribed_by: "qwen2-vl-7b"
pages: "5-12"
---
![[doc.pdf]]

## Seite 5
<transkribierter Text Seite 5>

## Seite 6
<transkribierter Text Seite 6>
…
```

`buildPdfNote` ist eine reine Funktion analog `buildTranscriptNote` (`img_to_md.ts:35`): YAML-Escaping der Quote-Strings, PDF-Embed oben, dann Sektionen in Seitenreihenfolge. Seiten mit leerem Transkript werden in der Sektion ausgelassen oder mit Hinweis markiert (Detail im Plan).

---

## 7 · Render-Schicht (`pdf_render.ts`)

```ts
export async function pdfPageCount(bytes: ArrayBuffer): Promise<number>;
export async function renderPdfPage(bytes: ArrayBuffer, page: number, scale: number): Promise<string>; // PNG data-URL
```

- pdf.js (`pdfjs-dist`) via `getDocument({ data: new Uint8Array(bytes) })`.
- **Worker:** Im `cjs`-Single-File-Bundle (`esbuild.config.mjs`) gibt es keinen separaten Worker-Dateipfad. Strategie: gebündelten Worker-Code als **Inline-Blob-URL** an `GlobalWorkerOptions.workerSrc` hängen, oder Main-Thread-Betrieb (Fake-Worker). Legacy-Build von pdf.js für breitere Kompatibilität (inkl. Mobile) prüfen. *(Konkrete Verdrahtung = Implementierungsdetail im Plan; empirisch verifizieren — der Worker ist der Haupt-Stolperstein.)*
- Render: `page.getViewport({ scale })` → `<canvas>` (bzw. `OffscreenCanvas`) → `page.render({ canvasContext, viewport })` → `canvas.toDataURL("image/png")`.

---

## 8 · Settings

```ts
interface ImageToMarkdownSettings {
  visionEndpoint: string;     // unverändert
  visionModel: string;        // unverändert
  visionPrompt: string;       // unverändert — geteilt mit PDF
  pdfMaxPages: number;        // NEU, Default 25 (Mobile: niedriger)
  pdfRenderScale: number;     // NEU, Default 2.0 (≈144 dpi; Mobile: reduziert)
}
```

- UI in `settings.ts` `display()`: zwei neue `Setting`-Zeilen (max. Seiten, Render-Auflösung) unter dem Prompt.
- Defaults in `defaultSettings()`. Mobile-Reduktion via `Platform.isMobile` zur Laufzeit (nicht im persistierten Setting), damit derselbe Vault auf Desktop/Mobile sinnvoll bleibt.

---

## 9 · i18n

Neue/angepasste Keys (EN kanonisch, DE gespiegelt — PROF-OBS-07). Geteilter Prompt → **kein** neuer Prompt-Default.

- `view.cardHead.page` = „{0} · Seite {1}/{2}" (PDF-Seiten-Karte: Datei, Seite, Seiten-im-Bereich).
- `view.pdfPages` = „{0} · {1} Seiten" (Listeneintrag).
- `view.pdfRange.from` / `view.pdfRange.to` (Feld-Labels/aria).
- `view.noImages` → neutraler fassen („Keine transkribierbaren Inhalte / Bilder oder PDFs").
- `core.pdfTooManyPages` = „PDF hat {0} Seiten (Limit {1}) — Bereich einschränken."
- `core.transcribingPage` = „Transkribiere {0} Seite {1}…".
- `settings.pdfMaxPages.*`, `settings.pdfRenderScale.*`.
- `note.suffix.image` = „(transcript)" / „(Transkript)", `note.suffix.pdf` = „(PDF transcript)" / „(PDF-Transkript)" — lokalisierter Dateinamen-Suffix der Transkript-Notizen.

---

## 10 · Tests (TDD-Grundlage)

**Reiner Kern (vitest, keine Mocks nötig):**
- `findImageEmbeds`: erkennt `![[doc.pdf]]` (kind:"pdf", page undefiniert) und `![[doc.pdf#page=3]]` (page:3); `#page`-Anker bleibt erhalten; Markdown `![](x.pdf)`; gemischt Bild+PDF in einem Dokument; `kind` korrekt.
- `buildPdfNote`: Frontmatter (inkl. `pages`-Range), PDF-Embed oben, `## Seite N`-Sektionen in Reihenfolge, YAML-Escaping, leere Seiten-Behandlung.
- Pfad/Range-Helfer: `transcriptNotePath` hängt den lokalisierten Suffix an (Bild *und* PDF); `uniqueNotePath`-Kollision (`-2`-Zähler); Range-Klemmung (`from<1`, `to>pageCount`, Limit-Überschreitung). Bestehender Naming-Test auf den Suffix angepasst.

**State (vitest):**
- PDF-Item → `startCards` expandiert zu N Karten mit korrekten `page`-Nummern und `index/total`.
- Schreib-Gruppierung: PDF-Seiten-Karten gleichen `link`s → ein `writePdfTranscript`-Aufruf; Bild-Karten unverändert je eine Notiz.

**Render-Schicht (`pdf_render.ts`):**
- Nicht sinnvoll als reiner Unit-Test: pdf.js braucht einen echten Canvas-2d-Context, den die happy-dom-Testumgebung nicht liefert (genau deshalb hat `settings.ts:22-24` schon einen `FALLBACK_PNG`). Daher Modul **dünn** halten (reine Datenlogik nach `pdf_to_md.ts`/State auslagern, damit sie testbar bleibt) und `pdf_render.ts` selbst **manuell im laufenden Plugin** smoke-testen (im Plan als expliziter, empirisch zu verifizierender Schritt). Kein stiller Truncation-/Leertranskript-Pfad ohne Notice.

**Regression:** alle 111 bestehenden Tests bleiben grün; `tsc --noEmit` + `eslint` (inkl. `eslint-plugin-obsidianmd`) sauber.

---

## 11 · Risiken & offene Detailpunkte

**Risiken:**
- **pdf.js-Worker im cjs-Single-File-Bundle** ist der Haupt-Stolperstein (Inline-Blob vs. Main-Thread); empirisch verifizieren. Bundle-Größe von `main.js` steigt spürbar.
- **Mobile-Speicher:** Canvas-Render großer Seiten ist CPU-/RAM-kritisch → durch `pdfMaxPages` (niedriger) + reduzierte `pdfRenderScale` gedeckelt. Falls untragbar: PDF-Pfad als Fallback desktop-only guarden (Bilder bleiben mobil).
- **Render-DPI ↔ OCR-Qualität:** `pdfRenderScale` ist der Tuning-Parameter; Default 2.0 als Startwert, empirisch nachjustieren.
- **`#page`-Subpath-Parsing** ist in der getypten Obsidian-API nicht dokumentiert → per Regex selbst parsen.
- **numPages beim Scan** kostet I/O pro PDF (getDocument); bei mehreren PDFs in einer Notiz spürbar, aber für Phase 1a akzeptabel.
- **Laufzeit:** N Seiten = N sequentielle Requests (wie heute pro Karte); `pdfMaxPages` begrenzt den Worst Case.

**Offene Detailpunkte (Default gewählt, im Plan/Review bestätigen):**
- ~~Notiz-Naming-Suffix~~ → **entschieden (Review):** lokalisierter Suffix für PDF *und* Bild (`(PDF-Transkript)` / `(Transkript)`), siehe §6.
- Leere-Seite-Darstellung in der Sektion (auslassen vs. Platzhalter).
- `pdfRenderScale` als sichtbares Setting (drin) vs. fester Wert.

**Spätere Phasen:** 1b (2-Ebenen + PNG-Dateien + Toggle), 2 (schrittweise/Merge), Command/Kontextmenü-PDF, `findImageEmbeds`→`findEmbeds`-Rename.

---

## 12 · Definition of Done (Phase 1a)

- [ ] Eingebettetes PDF erscheint in der Sidebar mit Seitenzahl + editierbarem Bereich.
- [ ] „Transkribieren" rendert die gewählten Seiten und streamt je Seite eine Karte.
- [ ] „Alle anlegen" erzeugt **eine** Standard-Notiz pro PDF (Frontmatter + Embed + `## Seite N`) und ersetzt den PDF-Embed.
- [ ] max-Seiten-Limit + Mobile-Reduktion greifen.
- [ ] Bild-Transkription unverändert; 111 Alt-Tests grün; neue Kern-Tests grün; `tsc`/`eslint` sauber.
- [ ] pdf.js im Bundle; Render im laufenden Plugin (Desktop) empirisch smoke-getestet.
