# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden hier dokumentiert.
Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung nach [SemVer](https://semver.org/lang/de/).

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
