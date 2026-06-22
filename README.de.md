# Image to Markdown

> [🇬🇧 English](README.md) · 🇩🇪 Deutsch

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Docs: CC BY-SA 4.0](https://img.shields.io/badge/docs-CC%20BY--SA%204.0-lightgrey.svg)](LICENSE-DOCS)
[![Release](https://img.shields.io/gitea/v/release/jkaindl/image-to-markdown?gitea_url=https%3A%2F%2Fcodeberg.org&label=release)](https://codeberg.org/jkaindl/image-to-markdown/releases)
![Platform](https://img.shields.io/badge/platform-Obsidian%201.4%2B%20·%20desktop%20%26%20mobile-7c3aed)

Transkribiert die Bilder einer Notiz per lokalem Vision-LLM nach Markdown — komplett offline,
nicht-destruktiv, live ins Sidebar gestreamt.

Für jedes ausgewählte Bild baut das Plugin einen multimodalen Request an einen
OpenAI-kompatiblen Vision-Endpoint, streamt das Markdown live in die Sidebar und legt pro Bild
eine eigene Transkript-Notiz an. Der Bild-Embed in der Quellnotiz wird durch einen Embed der
neuen Notiz ersetzt — der Originaltext wird nie überschrieben, ein Mehrfach-Lauf erzeugt keine
Duplikate. Nichts verlässt die Maschine: keine Cloud, keine Telemetrie, kein VPN.

> Schwester-Plugin von [vault-rag](https://codeberg.org/jkaindl/vault-rag) — dort liegt der
> RAG-Kern (Related-Notes, semantische Suche, Chat). `image-to-markdown` wurde am 2026-06-21 aus
> vault-rag 0.2.0 ausgegliedert, weil Bild-Transkription kein RAG ist (geteilt wurde nur der
> SSE-Transport).

## Funktionen

- **Sidebar-View.** Das Ribbon-Icon `scan-text` (Label „Image → Markdown") öffnet die Sidebar
  „IMG → MD". Sie zeigt alle eingebetteten Bilder der aktiven Notiz als Checkbox-Liste (alle
  vorausgewählt; nicht unterstützte Formate deaktiviert). Der Button „Transkribieren" streamt
  die Antwort des Vision-Modells **live** in eine Karte pro Bild — mit aufklappbarem
  Gedanken-/Thinking-Block bei Reasoning-Modellen und einem Kopier-Button. Pro Karte gibt es
  „Notiz anlegen", außerdem „Alle anlegen". Karten sind read-only; rohes Markdown im
  pre-wrap. Nach dem Schreiben fällt das behandelte Bild beim Re-Scan aus der Liste.
- **Zweisprachige Oberfläche (Deutsch / English)** — alle nutzersichtbaren Texte folgen der
  Sprach-Einstellung von Obsidian; Englisch ist kanonisch, Deutsch wird automatisch geliefert.
  Die Sprache wird einmalig beim Laden des Plugins erkannt (zum Wechseln neu laden).
- **Command** „Bilder der aktiven Notiz transkribieren" (`transcribe-active-note`) —
  Batch-Transkription ohne Sidebar.
- **Command** „Sidebar öffnen" (`open-sidebar`) — öffnet die Sidebar.
- **Editor-Kontextmenü** „Image → Markdown" (Icon `scan-text`) — nur das Bild unter dem Cursor.

Sichtbares Thinking: `reasoning_content` aus dem Stream plus inline `<think>`-Tags landen im
Gedanken-Block. Das Reasoning ist ephemer und geht nie in die LLM-History ein.

## Voraussetzungen

- Obsidian 1.8.7+ (Desktop oder Mobile).
- Ein OpenAI-kompatibler lokaler Server mit einem **vision-fähigen** Modell — z.B.
  [LM Studio](https://lmstudio.ai), [Ollama](https://ollama.com) oder ein MLX-Server. In den
  Einstellungen konfigurierbar; nichts verlässt die Maschine (offline-first, keine Cloud, kein
  VPN).

## Installation

### Community Plugins

**Coming soon.** `image-to-markdown` wird für das Obsidian-Community-Plugin-Directory
vorbereitet.

### Manuell

`main.js`, `manifest.json` und `styles.css` aus dem
[letzten Release](https://codeberg.org/jkaindl/image-to-markdown/releases) nach
`<vault>/.obsidian/plugins/image-to-markdown/` legen, dann unter **Settings → Community
plugins** aktivieren.

### BRAT (Beta)

Den GitHub-Mirror `johannes-kaindl/image-to-markdown` in
[BRAT](https://github.com/TfTHacker/obsidian42-brat) eintragen.

### From source

```bash
git clone https://codeberg.org/jkaindl/image-to-markdown
cd image-to-markdown
npm install
npm run build   # → main.js
```

Danach `main.js`, `manifest.json` und `styles.css` nach
`<vault>/.obsidian/plugins/image-to-markdown/` kopieren und Obsidian neu laden.

## Verwendung

1. Das Plugin auf den lokalen Vision-Server ausrichten (siehe [Konfiguration](#konfiguration)
   weiter unten) und sicherstellen, dass das Modell geladen ist.
2. Eine Notiz mit eingebetteten Bildern öffnen.
3. Auf das Ribbon-Icon **„Image → Markdown"** klicken (oder den Command **„Sidebar öffnen"**
   ausführen), um die Sidebar **„IMG → MD"** zu öffnen. Die eingebetteten Bilder erscheinen als
   vorausgewählte Checkbox-Liste; nicht unterstützte Formate sind deaktiviert.
4. Auf **„Transkribieren"** klicken. Jedes ausgewählte Bild bekommt eine Karte, die sich live mit
   dem gestreamten Markdown füllt. Bei Reasoning-Modellen den Gedanken-Block aufklappen, um dem
   Modell beim Denken zuzusehen; über den Kopier-Button das rohe Markdown übernehmen.
5. Auf **„Notiz anlegen"** einer einzelnen Karte klicken oder mit **„Alle anlegen"** alle
   Transkripte auf einmal schreiben. Jedes Bild wird zu einer Transkript-Notiz, und sein Embed in
   der Quellnotiz wird durch einen Embed der neuen Notiz ersetzt.

Lieber ohne Sidebar? Den Command **„Bilder der aktiven Notiz transkribieren"** ausführen, um die
aktive Notiz im Batch zu transkribieren. Oder im Editor mit Rechtsklick auf ein Bild
**„Image → Markdown"** wählen, um nur das Bild unter dem Cursor zu transkribieren.

### Konfiguration

Setting-Heading in Obsidian: **„Vision (Image → Markdown)"**.

| Einstellung | Default | Hinweis |
|---|---|---|
| **Vision-Endpunkt** | `http://localhost:8080` | OpenAI-kompatibler Server mit Vision-Modell. Das ist der MLX-Default — **LM Studio nutzt `:1234`** (häufigste Fehlkonfiguration). |
| **Vision-Modell** | (leer) | Vision-fähiges Modell (z.B. Qwen2-VL, Llama-3.2-Vision). Dropdown, gefüllt aus `/v1/models` des Endpoints; ist der Endpoint offline, wird es zum Freitextfeld. Das tatsächlich genutzte Modell wird aus `response.model` gelesen. |
| **Vision-Prompt** | Markdown-Transkription (siehe unten) | Anweisung an das Vision-Modell, frei editierbar (Text-Area). |

Default-Prompt:

> Transkribiere den Text im Bild exakt nach Markdown. Erhalte die Struktur: Überschriften,
> Absätze, \*\*Hervorhebungen\*\*, Listen und Tabellen. Gib nur das Markdown aus, keine
> Kommentare.

**Endpoint-Tipp:** die Base-URL **ohne** abschließendes `/v1` eintragen — der Client hängt
`/v1` selbst an (`normalizeEndpoint` strippt ein abschließendes `/v1`; beide Formen werden
akzeptiert).

Der Settings-Tab zeigt außerdem einen **Verbindungs-Status** mit „**Verbindung testen**" sowie
eine **„Vision-Fähigkeit"**-Zeile mit „**Vision testen**"-Button, der aktiv prüft, ob das gewählte
Modell wirklich Bilder lesen kann — Details im [Handbuch](docs/manual/reference.md#vision-capability-detection).

## Funktionsweise

- Für jedes ausgewählte Bild baut das Plugin einen multimodalen chat-completions-Request (das
  Bild im `content`-Array) an den konfigurierten OpenAI-kompatiblen Vision-Endpoint und streamt
  das Markdown zurück (SSE; `content` + `reasoning_content`).
- Es schreibt eine Transkript-Notiz pro Bild (gebündelt, read-once/write-once, keine Race) mit
  `transcribed_by`-Frontmatter (Modell aus `response.model`) und ersetzt den Bild-Embed in der
  Quellnotiz durch einen Embed der neuen Notiz. Nicht-destruktiv, idempotent.

Architektur- und Modul-Layout stehen in [AGENTS.md](AGENTS.md).

## Unterstützte Formate

- **An das Modell gesendet:** PNG, JPG, JPEG, WebP, GIF.
- **Erkannt, aber übersprungen** (mit Notice): BMP, HEIC, HEIF. HEIC/HEIF ist iOS-Default und
  wird von Vision-Modellen abgelehnt → iOS auf „Maximal kompatibel" / „Most Compatible" stellen
  oder vorher konvertieren. Beim Überspringen erscheint eine Notice à la:
  `Format .heic nicht unterstützt (HEIC? iOS auf „Maximal kompatibel")`.

## Gotchas

- **`/v1`-Footgun:** ein Endpoint mit abschließendem `/v1` ergab früher
  `…/v1/v1/chat/completions`. LM Studio antwortet auf falsche Pfade mit HTTP 200 + Fehler-Body
  (kein echter Fehler) → `res.ok` true, Stream leer → still ein leeres Transkript. Behoben durch
  `normalizeEndpoint()` (strippt abschließendes `/v1` plus Slashes).
- **LM Studio ignoriert das `model`-Feld** im Request und nutzt das geladene Modell → das
  tatsächlich genutzte Modell wird aus `response.model` gelesen und landet im
  `transcribed_by`-Frontmatter der Transkript-Notiz.
- **Vision-Endpoint-Default `:8080` (MLX) ≠ LM Studio `:1234`.**

## Dokumentation

- Handbuch: [docs/manual/index.md](docs/manual/index.md)
- Changelog: [CHANGELOG.md](CHANGELOG.md)

## Entwicklung

```bash
npm install
npm run dev     # esbuild watch
npm run build   # prod-Bundle → main.js
npm test        # vitest
```

Konventionen (Branch-Modell, Conventional Commits, Qualitäts-Gates vor Commit) stehen in
[AGENTS.md](AGENTS.md).

## Sicherheit

Bilddaten werden ausschließlich an den vom Nutzer konfigurierten **lokalen** Endpoint gesendet —
keine Telemetrie, nichts an Cloud oder Dritte. Der Vertrauensanker ist der lokale Server, den
der Nutzer kontrolliert.

Sicherheitslücken bitte **nicht** öffentlich als Issue melden, sondern per E-Mail an
[code@jkaindl.de](mailto:code@jkaindl.de) (gerne PGP-verschlüsselt).

## Lizenz

- Code: [AGPL-3.0-or-later](LICENSE). Eine kommerzielle Dual-License ist auf Anfrage verfügbar,
  falls die AGPL-Copyleft nicht passt.
- Dokumentation/Text: [CC BY-SA 4.0](LICENSE-DOCS).

Copyright © 2026 Johannes Kaindl.
