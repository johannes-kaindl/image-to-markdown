# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden hier dokumentiert.
Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung nach [SemVer](https://semver.org/lang/de/).

## [Unreleased]

## [0.7.0] — 2026-06-30

### Hinzugefügt

- **Prompt-Presets:** Neben dem Modell-Picker in der Sidebar ein Preset-Wähler — „Standard" (dein
  editierbarer Prompt) plus feste Modi für **Tabellen → Markdown**, **Handschrift**, **Mathe → LaTeX**,
  **Quellcode** und **Bild beschreiben**. Die Wahl bleibt erhalten (sticky). Bei einem lokalen
  Vision-Modell ist der Prompt der wichtigste Qualitätshebel — die Presets schalten den Modus pro Lauf
  ohne Settings-Umweg um.

## [0.6.1] — 2026-06-28

### Behoben

- **Keine stillen Lücken mehr in PDF-Transkripten:** Schlug bei einem mehrseitigen PDF eine Seite fehl
  (z.B. weil das lokale Modell mittendrin abbrach), verschwand sie bisher spurlos aus der
  zusammengeführten Notiz — die Notiz sah vollständig aus, obwohl Seiten fehlten, und die
  `pages`-Angabe war falsch. Jetzt erscheint an der Stelle ein sichtbarer Hinweis
  („Seite N — Transkription fehlgeschlagen"), und der Seitenbereich im Frontmatter entspricht ehrlich
  dem transkribierten Bereich.

### Hinzugefügt

- **Fehlgeschlagene Seiten erneut transkribieren:** Jede fehlgeschlagene Karte hat jetzt einen
  „Erneut versuchen"-Knopf; im Fußbereich erscheint „Fehlgeschlagene erneut", sobald es Fehler gibt.
  Eine erneut erfolgreiche Seite wird beim nächsten Anlegen sauber in dieselbe Notiz übernommen
  (keine Dublette, nichts geht verloren).
- **Klare Fehlermeldungen vom Vision-Server:** Antwortet der lokale Server mit einem Fehler im Body
  (z.B. LM Studio: „model X is not loaded") statt eines echten HTTP-Fehlers, wird jetzt die echte
  Meldung angezeigt statt eines generischen „leeres Transkript".

## [0.6.0] — 2026-06-28

### Geändert

- **Flüssigeres Streaming in der Sidebar:** Die Transkriptions-Karten werden beim Streaming nur
  noch inkrementell aktualisiert statt bei jedem Token komplett neu aufgebaut. Kein Flackern und
  keine Scroll-Sprünge mehr — spürbar besonders auf Mobilgeräten; der Gedanken-Block behält dabei
  seinen Auf-/Zu-Zustand.
- **Aufgeräumte Sidebar-Optik (theme-treu):** Der Gedanken-Block trägt jetzt ein `brain`-Icon statt
  eines Emojis, lange Dateinamen werden im Karten-Kopf mittig gekürzt, der „Notiz anlegen"-Button
  hat ein Icon, und die Abstände im Kopfbereich sind ruhiger. Die Schrift bleibt unverändert vom
  Obsidian-Theme bestimmt (kein Font-Override).

## [0.5.1] — 2026-06-26

### Behoben

- **Endpunkt-Eingabe:** Beim Tippen ins Endpunkt-Feld wurde pro Tastendruck ein eigener,
  unvollständiger Eintrag angelegt (`l`, `lo`, `loc`, …) statt eines einzigen. Die Listen-
  Bearbeitung wird jetzt erst beim Verlassen des Felds (blur) angewandt — ein Feld = ein Eintrag.

### Hinzugefügt

- **Endpunkt löschen:** Jede Endpunkt-Zeile hat einen eigenen Lösch-Button (Mülleimer). Das
  Erreichbarkeits-Status-Icon (`circle-check`/`circle-x`) links bleibt reine Anzeige.

## [0.5.0] — 2026-06-25

### Hinzugefügt

- **Endpoint-Fallback-Liste:** statt eines einzelnen Vision-Endpoints lässt sich eine geordnete
  Liste konfigurieren — das Plugin pingt sie der Reihe nach und nutzt den **ersten erreichbaren**
  automatisch (re-resolved beim Sidebar-Refresh und nach einem fehlgeschlagenen Aufruf mit einem
  Retry). So funktioniert eine einzelne gesyncte Config auf mehreren Geräten und Netzen: z.B.
  `localhost:1234` (das Gerät, auf dem LM Studio läuft) als Erstes, dann `192.168.178.27:1234`
  (LAN-IP, erreichbar vom iPhone/iPad via WireGuard). Im Settings-Tab gibt es ein dynamisches
  Endpunkt-Feld pro Eintrag (leeres Feld am Ende = „Neuen hinzufügen"; Feld leeren entfernt den
  Eintrag beim Verlassen) mit je einem Erreichbarkeits-Icon pro Feld (Kreis-Haken / Kreis-X /
  Ladekreis + Titeltext). Der aktive Endpoint ist markiert. Die Sidebar zeigt
  **„verbunden via \<Endpoint\>"** statt nur des Status. Migration: ein vorhandenes
  `visionEndpoint`-Feld in `data.json` wird automatisch nach `visionEndpoints` migriert —
  bestehende Konfigurationen bleiben ohne manuellen Eingriff funktionsfähig.

- **Aktive Datei als Quelle (Etappe 3):** ist die aktive Datei selbst ein Bild oder eine PDF
  (d.h. keine Notiz, sondern die Mediendatei wird direkt in Obsidian angezeigt), zeigt die
  Sidebar diese Datei als einzelnen Eintrag mit dem Label **„diese Datei"** (DE) bzw.
  **„this file"** (EN) an und behandelt sie als Transkriptions-Quelle. PDFs: Seitenbereich
  wählbar wie gewohnt; Bilder: einzelne Karte. Die Transkript-Notiz wird am
  **„Standard-Speicherort für neue Notizen"** (`app.fileManager.getNewFileParent`) angelegt,
  da es keine Quellnotiz gibt, neben der sie abgelegt werden könnte. Das Frontmatter enthält
  kein `source_note`-Feld (es gibt keine Quellnotiz); `source_pdf`/`source_image`, `created`
  und `transcribed_by` (PDFs auch `pages`) bleiben erhalten. Die Quelldatei wird **nicht
  verändert** (kein Embed-Ersatz). Idempotenz und Override funktionieren wie gewohnt: eine
  bereits transkribierte Datei zeigt „✓ Transkript vorhanden → öffnen"; Override überschreibt
  die bestehende Notiz. Ausschließlich über die Sidebar — der Command „Bilder der aktiven Notiz
  transkribieren" und das Kontextmenü betreffen weiterhin nur Notizen mit Embeds.

## [0.4.2] — 2026-06-24

### Geändert

Barrierefreie Statusanzeige (keine Änderung am Transkribieren):

- Verbindungs- und Modell-Status werden über die Icon-**Form** unterschieden
  (`circle-check` verbunden · `circle-x` offline · `circle-slash` Modell nicht geladen ·
  `loader` prüft) statt allein über Farbe — lesbar auch bei Rot-Grün-Sehschwäche
  (WCAG 1.4.1, redundante Kodierung aus Form + Text + Farbe).
- `minAppVersion` bleibt 1.8.7.

## [0.4.1] — 2026-06-24

### Geändert

Wartungs-Release für die Konformität mit dem Obsidian-Community-Plugin-Review (keine
nutzersichtbaren Funktionsänderungen):

- Settings-Re-Render läuft über eine private Methode statt der seit Obsidian 1.13 veralteten
  `display()` — `minAppVersion` bleibt 1.8.7, Verhalten unverändert.
- `authorUrl` im Manifest zeigt auf die Autoren-Homepage (jkaindl.de).
- Installations-Doku auf die Community-Plugins-Suche umgestellt (BRAT-Anleitung entfernt, da
  das Plugin nun gelistet ist).

## [0.4.0] — 2026-06-24

### Hinzugefügt

- **Modell-Transparenz:** ein Refresh-Icon neben beiden Modell-Auswahlen (Sidebar + Einstellungen)
  lädt die Modell-Liste neu — nützlich, wenn ein externer Prozess das geladene Modell des lokalen
  Backends (MLX/LM Studio) gewechselt hat. Nach jeder Transkription gleicht die Sidebar die Auswahl
  automatisch an das tatsächlich verwendete Modell (`response.model`) an. Ein grüner Haken neben dem
  Dropdown zeigt, ob die Auswahl im Backend geladen ist; der Refresh gibt sichtbares Feedback
  („N Modelle geladen").

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
