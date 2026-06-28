# Feature-Gap-Analyse — Best Practice / State of the Art (2026-06-28)

Methode: Multi-Agent-Workflow (45 Agenten). Inventar aus Code/Docs → 6 unabhängige Lenses
(Vision/OCR-SOTA · Obsidian-API · Konkurrenz-Plugins · Power-User-Workflow · Robustheit · Privacy/A11y)
→ Dedup → **adversarielle Prüfung jeder Idee gegen den echten Quellcode + die Offline-first/
nicht-destruktiv/pure-core-Philosophie** → Synthese. 44 Roh-Ideen → 36 Kandidaten → **20 nach
Verifikation**.

Reihenfolge der Umsetzung von Johannes bestätigt (Text-Layer-PDF vor Batch); „nach und nach".
Lebende Roadmap (Status/Häkchen): Coding-Cockpit `image-to-markdown.md` §🗺️.

## Top-Empfehlungen (priorisiert nach Wert × Philosophie-Fit / Aufwand)

### 1 — Partial-Failure-Recovery für PDFs (Bug-Fix) · hoch · M
Behebt einen latenten **Daten-Integritäts-Bug**: `partitionDoneCards` (`img_to_md_state.ts:111`)
sammelt nur `status==='done'` — eine fehlgeschlagene Seite (lokale Backends OOM/timeouten mitten im
Lauf) verschwindet spurlos; `pagesStr` (`pdf_to_md.ts:66`) = `kept[0]..kept[last]` labelt den Bereich
zudem falsch (überleben erste+letzte Seite, bleibt das Label „1-N", obwohl Mittel-Seiten fehlen). Fix:
sichtbarer „Seite N fehlgeschlagen"-Platzhalter an korrekter Position, `pages:` aus der **gewählten
Range** statt aus kept; per-Karte „Retry" + „Fehlgeschlagene erneut". pure-core, idempotent (Retry
überschreibt via Override).

### 2 — HTTP-200-mit-Error-Body erkennen · hoch · S
`transcribe` (`vision_client.ts:66-68`) wirft nur bei `!res.ok`; ein 200 mit `{error:{message}}` →
`content ?? ""` → leer → generisches „Empty transcript", echte Servermeldung verworfen. Streaming:
200 ohne `data:`-Zeilen → leer, kein Fehler. Fix: reine `parseErrorEnvelope(text)`, in beide Pfade
verdrahtet → echte Meldung („LM Studio: model X is not loaded"). Höchster Wert pro Zeile.

### 3 — Named Prompt-Presets · hoch · M
Statt einem globalen Prompt eine Mode-Auswahl (faithful Markdown / Tabellen→GFM / Handschrift /
Mathe→LaTeX / Code / Bildbeschreibung), per-Run wählbar, `prompt_preset` im Frontmatter, Migration
des alten `visionPrompt`. Bei fixem lokalem VLM ist der Prompt der dominante Qualitätshebel; subsumiert
Glossar, Output-Sprache, Chart→Mermaid, Alt-Text als künftige Presets.

### 4 — Diff-before-overwrite (+ optional Inline-Edit) · mittel · M
Beim Override-Pfad (`img_to_md.ts:88`, die einzige potenziell zerstörende Operation) Zeilen-Diff
alt↔neu + explizite Bestätigung; optional Inline-Edit von `card.text` vor dem Schreiben. Diff als reines
Modul.

### 5 — Vault-/Ordner-weiter Batch · hoch · L
Command „Alle untranskribierten Bilder/PDFs transkribieren" (Scope: aktive Notiz / Ordner / Vault),
**headless** via Status-Bar (nicht durch die Karten-UI streamen — skaliert nicht). Idempotenz ist
gelöst: reiner Filter über `findExistingTranscript` (`backlinks.ts:16`). Neues pures `batch_queue.ts`.

## Auch erwägenswert
- **Born-digital PDFs: Text-Layer statt OCR** (vorgezogen vor #5): pdf.js `getTextContent()`; bei echtem
  Text-Layer direkt nutzen — schneller, GPU-frei, oft treuer. M.
- **Rechtsklick im Datei-Explorer** (`file-menu`-Hook, Einzeldatei): kanonischer Per-Datei-Einstieg.
  Kann `runImgToMd` NICHT wiederverwenden (note/embed-only) → Glue über `buildSelfSourceItem`.
- **`{pageInfo}`-Prompt-Variable + Struktur/Lesereihenfolge-Hint**: reiner Interpolator; `{pageInfo}`
  („Seite N von M") ist heute nicht erreichbar. `{sourceNoteContext}` bewusst weglassen (verzerrt Treue).
- **Qualitäts-Heuristiken + Low-Confidence-Badge** (pure `quality.ts`): Runaway-Repetition,
  Refusal-Erkennung, ungeschlossene Tabellen/Code-Fences. Self-Consistency-Resampling weglassen.
- **BMP-Vorkonvertierung** (sofort, ~15 Zeilen Canvas-Roundtrip) + **HEIC/HEIF lazy** (libheif-wasm,
  Bundle-Gotcha wie pdfjs-Pin re-validieren).
- **Re-run-stale** (`source_mtime`-Frontmatter + `isStale()` + Badge; Phase B = Batch).
- **`obsidian://`-URI-Handler** (Apple Shortcuts/Share-Sheet — iPhone+WireGuard-Flow).
- **Declarative Settings `getSettingDefinitions()` (1.13)** — schließt offenes PROF-OBS-06 (nur die
  ~4 statischen Felder; Modell-Dropdown/Endpoint-Reihen bleiben imperativ).
- **Transcribe-on-paste** (opt-in `editor-paste`-Hook, OFF by default; Embed landet asynchron → defer).

## Bewusst verworfen (mit Begründung — nicht erneut vorschlagen)
- **Inline-Callout-Output** (Transkript in den Quelltext): Philosophie-Konflikt; in
  `docs/manual/explanation.md` schon bewusst abgelehnt. Günstigere Lösung für „zu viele Notizen":
  konfigurierbarer Transkript-Ordner (`destDir` existiert bereits).
- **PII/Redaction**: Vault ist eh lokal — kein Dritter; „best-effort"-Maskierung weckt falsches Vertrauen.
- **Content-Hash-Cache**: selbstwidersprüchlich (Nutzen braucht Persistenz, sicherer Default ist memory-only);
  Offline-Read-Pfad ist schon durch die synchronisierte Notiz + Backlink-Idempotenz gelöst.
- **Auto-Watch-Folder**: Hintergrund-Autonomie widerspricht dem bewusst manuellen Tool; loses Attachment
  hat keine Quellnotiz.
- **Canvas-Integration**: Backlink-Idempotenz trägt nicht (Duplikate); Concurrent-Edit-Hazard auf `.canvas`.
- **Text-Extractor-API/Omnisearch**: Notizen sind schon nativ durchsuchbar; Registrierungs-Kollision.
- **High-Contrast-Audit**: existiert bereits (0 Farb-Literale, redundante Icon+Text+Farb-Kodierung).
- **prefers-reduced-motion-Toggle**: das Plugin hat keine eigenen Animationen.
- **Multi-Language-Bundle / Output-Übersetzung**, **HiRes-Tiling**, **Alt-Text-Inline-Inject**,
  **processFrontMatter-Migration**, **Output-Templating**: jeweils niedriger Wert / Konflikt / Scope-Creep
  (Details siehe Workflow-Verdikte).
