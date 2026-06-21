# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden hier dokumentiert.
Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung nach [SemVer](https://semver.org/lang/de/).

## [0.1.0] — 2026-06-21

Erstes Release. Ausgegliedert aus [vault-rag](https://codeberg.org/jkaindl/vault-rag) 0.2.0.

### Hinzugefügt

- **Sidebar-View** mit Bild-Auswahl, live streamender Transkription (Gedanken-Block bei
  Reasoning-Modellen, Kopier-Button) und Notiz-Anlage pro Bild bzw. „Alle anlegen".
- **Command** „Bilder der aktiven Notiz transkribieren" (Batch).
- **Editor-Kontextmenü** „Image → Markdown" für das Bild unter dem Cursor.
- Geteilter SSE-Streaming-Transport; `VisionClient` mit `ping`/`listModels` für Modell-Picker
  und Verbindungsstatus.
- Nicht-destruktiv & idempotent: pro Bild eine Transkript-Notiz, Bild-Embed wird ersetzt.
