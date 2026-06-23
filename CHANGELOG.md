# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden hier dokumentiert.
Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung nach [SemVer](https://semver.org/lang/de/).

## [Unreleased]

### Hinzugefügt

- **Modell-Transparenz:** ein Refresh-Icon neben beiden Modell-Auswahlen (Sidebar + Einstellungen)
  lädt die Modell-Liste neu — nützlich, wenn ein externer Prozess das geladene Modell des lokalen
  Backends (MLX/LM Studio) gewechselt hat. Nach jeder Transkription gleicht die Sidebar die Auswahl
  automatisch an das tatsächlich verwendete Modell (`response.model`) an.

- **Verlinkte Quellen:** reine Links auf Bilder/PDFs (`[[x.pdf]]`, `[text](x.pdf)` ohne `!`) werden
  jetzt ebenfalls als Quelle erkannt und transkribiert; der Link im Text bleibt dabei unverändert
  (im Gegensatz zu Embeds, die durch das Transkript ersetzt werden). Sidebar markiert solche Einträge
  mit „linked".

## [0.3.0] — 2026-06-23

### Hinzugefügt

- **Backlink-Idempotenz:** Die Sidebar erkennt eine bereits existierende Transkript-Notiz für
  eine Quelle (via Backlink-Index + `source_pdf`/`source_image`-Frontmatter-Filter) und zeigt
  „vorhanden → öffnen" an, statt erneut zu transkribieren.
  Nur Notizen, deren Frontmatter per `source_pdf` / `source_image` auf die Quelldatei verweist,
  zählen — ein bloßer Body-Embed (z.B. `![[datei.pdf]]`) genügt nicht (Frontmatter-Filter load-bearing).
- **Override-Option:** Per Checkbox in der Sidebar lässt sich eine erneute Transkription erzwingen;
  das Plugin überschreibt dann die bestehende Transkript-Notiz und erhält dabei das komplette
  existierende Frontmatter (nur `transcribed_by`/`pages` + Body werden ersetzt).

### Geändert

- **PDF render scale** (`pdfRenderScale`) ist jetzt ein Slider (Bereich 1.0–4.0, Schritt 0.5)
  statt eines freien Textfelds — direktes, gegrenztes Einstellen der Render-Auflösung.

## [0.2.0] — 2026-06-22

### Hinzugefügt

- **PDF-Embed-Transkription:** eingebettete PDFs werden seitenweise über die Sidebar transkribiert.
  Seitenbereich wählbar (Default: alle), eine Transkript-Notiz pro PDF, PDF-Embed wird ersetzt.
  Limits: `pdfMaxPages` (konfigurierbar) und `pdfRenderScale` (mobil kleiner, schützt vor OOM).
  Umgesetzt über einen gebündelten pdf.js-Worker (Blob-URL, kein CDN, komplett offline).
- **Konfigurierbarer PDF-Seiten-Trenner** (`pdfPageSeparator`): per Dropdown wählbar, wie Seiten
  in der zusammengeführten Transkript-Notiz getrennt werden — fünf Optionen:
  „Obsidian comment %% Page N %% (hidden in reading view)" (Default), „Heading ## Page N",
  „Horizontal rule ---", „Page break (HTML, for export)" und „None (seamless text)".
- **Lokalisierter Titel-Suffix** für Transkript-Notizen: „(transcript)" für Bilder bzw.
  „(PDF transcript)" für PDFs (folgt der UI-Sprache).

## [0.1.3] — 2026-06-22

### Hinzugefügt

- GitHub-Actions-Release-Pipeline (`.github/workflows/release.yml`): baut das Plugin bei einem
  SemVer-Tag, erzeugt **Build-Provenance-Attestations** für `main.js`/`manifest.json`/`styles.css`
  und veröffentlicht das GitHub-Release. Läuft auf der GitHub-Mirror-Seite (BRAT/Registry).

## [0.1.2] — 2026-06-22

### Behoben

- Live-Streaming nutzt jetzt `activeWindow.fetch` (injizierter Stream-Transport) statt des
  globalen `fetch` — erfüllt die Obsidian-Lint-Regel `no-restricted-globals` ohne `eslint-disable`
  (das der Community-Review nicht erlaubt). Verhalten unverändert.
- README: „Coming soon"-Platzhalter im Community-Plugins-Abschnitt durch echte Install-Anleitung ersetzt.

## [0.1.1] — 2026-06-22

Submission-Readiness für die Obsidian-Community-Registry (Lint-/API-Konformität).

### Geändert

- `minAppVersion` auf **1.8.7** angehoben (offizielle `getLanguage()`-API statt 1.4.0 mit Fallback).
- Nicht-streamende Netzwerk-Calls laufen über Obsidians `requestUrl` (per Dependency-Injection;
  der reine Kern bleibt obsidian-frei). Das Live-Streaming nutzt weiterhin `fetch` — `requestUrl`
  liefert nur die vollständige Antwort und kann nicht token-weise streamen.

### Behoben

- Obsidian-Plugin-Lint sauber: keine `no-unsupported-api`-Verstöße mehr, `activeDocument` statt
  `document`, keine floating Promises / unsicheren `any`-Zuweisungen / unnötigen Type-Assertions.

### Entwicklung

- `eslint` + `eslint-plugin-obsidianmd` + `npm run lint` — reproduziert die Community-Review-Checks lokal.

## [0.1.0] — 2026-06-21

Erstes Release. Ausgegliedert aus [vault-rag](https://codeberg.org/jkaindl/vault-rag) 0.2.0.

### Hinzugefügt

- **Sidebar-View** mit Bild-Auswahl, live streamender Transkription (Gedanken-Block bei
  Reasoning-Modellen, Kopier-Button) und Notiz-Anlage pro Bild bzw. „Alle anlegen".
- **Commands** „Bilder der aktiven Notiz transkribieren" (Batch) und „Sidebar öffnen".
- **Editor-Kontextmenü** „Image → Markdown" für das Bild unter dem Cursor.
- Geteilter SSE-Streaming-Transport; `VisionClient` mit `ping`/`listModels` für Modell-Picker
  und Verbindungsstatus.
- Nicht-destruktiv & idempotent: pro Bild eine Transkript-Notiz, Bild-Embed wird ersetzt.
- **Settings-QoL:** große, resizebare Prompt-Textarea; Verbindungs-Status-Dot + „Verbindung testen";
  „Vision-Fähigkeit"-Anzeige mit aktivem „Vision testen"-Button; „Modelle laden"-Fallback bei offline.
- **Vision-Capability-Detektion** (`capabilities.ts`): Namens-Heuristik + Metadaten-Probe gegen
  Ollama (`/api/show`) und LM Studio (`/api/v1/models`, `/api/v0/models`).
- **Zweisprachige Oberfläche (Englisch/Deutsch):** alle nutzersichtbaren Strings folgen der
  Sprach-Einstellung von Obsidian. Englisch ist kanonisch, Deutsch ist die Übersetzung; die
  Sprache wird einmalig beim Laden des Plugins erkannt, ein Wechsel wird also nach einem
  Plugin-Reload wirksam. Auch der mitgelieferte Standard-Vision-Prompt ist lokalisiert; Marken-
  und Steuer-Strings („Image → Markdown", „IMG → MD", „Stop") bleiben unverändert.
- `npm run deploy` (env-gesteuert via `$OBSIDIAN_PLUGIN_DIR`).

### Behoben

- Sidebar-View überlebt jetzt einen Plugin-Reload/-Update (kein Leaf-Detach in `onunload` mehr).
