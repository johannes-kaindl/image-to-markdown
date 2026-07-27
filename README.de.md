# Image to Markdown

> [🇬🇧 English](https://codeberg.org/jkaindl/image-to-markdown/src/branch/main/README.md) · 🇩🇪 Deutsch

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](https://codeberg.org/jkaindl/image-to-markdown/src/branch/main/LICENSE)
[![Docs: CC BY-SA 4.0](https://img.shields.io/badge/docs-CC%20BY--SA%204.0-lightgrey.svg)](https://codeberg.org/jkaindl/image-to-markdown/src/branch/main/LICENSE-DOCS)
[![Release](https://img.shields.io/gitea/v/release/jkaindl/image-to-markdown?gitea_url=https%3A%2F%2Fcodeberg.org&label=release)](https://codeberg.org/jkaindl/image-to-markdown/releases)
![Platform](https://img.shields.io/badge/platform-Obsidian%201.8.7%2B%20·%20desktop%20%26%20mobile-7c3aed)

**Transkribiert Bilder und PDFs einer Notiz per lokalem Vision-LLM nach Markdown — komplett offline, nicht-destruktiv, live in die Sidebar gestreamt.**

## Funktionen

- Transkribiert **Bilder und PDFs** einer Notiz über ein beliebiges OpenAI-kompatibles lokales Vision-Modell
- **Beschreiben-Modus** — ein Umschalter „Beschreiben" neben „Transkribieren" erzeugt statt eines Transkripts eine Beschreibung, ideal für textarme Bilder (Fotos, Diagramme, Whiteboards), damit du sie über die Suche wiederfindest; nicht-destruktiv, zeigt Bild + Beschreibung zusammen mit editierbarer Kategorie (aus einer konfigurierbaren Taxonomie) und freien Tags; Transkript und Beschreibung zum selben Bild koexistieren unabhängig
- **Nachbessern per Feedback** — einer Transkript-Karte Prosa-Feedback geben („diese Tabelle als GFM", „Überschriften-Ebene falsch"), und das Modell schreibt sie neu; ein konversationeller, scrollbarer Verlauf pro Karte mit sichtbarem Denkprozess je Runde und freier Wahl, welche Version geschrieben wird; funktioniert auch, nachdem die Notiz schon geschrieben wurde (läuft über das Diff-Gate weiter unten)
- **Live-Streaming** in die Sidebar — das Markdown erscheint während der Modellgenerierung
- **PDF-Seitenbereiche** — wählbare Seiten zum Transkribieren; pdf.js ist gebündelt, vollständig offline
- **Born-digital PDFs** — Seiten mit echtem Text-Layer werden als exakter Text (kein Bild) ans Modell geschickt und nach Markdown formatiert: schneller und ohne OCR-Fehler; Scan-/Figuren-Seiten fallen aufs Vision-Modell zurück. In den Einstellungen abschaltbar
- **Idempotent** — eine Transkript-Notiz pro Quelle, keine Duplikate; Neu-Transkription ist opt-in
- **Diff vor dem Überschreiben** — die einzige destruktive Operation (opt-in Neu-Transkription) zeigt vorher einen zeilenweisen Diff mit einer Checkbox pro Änderungsstelle (Default: alle an), sodass du gezielt alte und neue Zeilen mischen kannst; In-Session-Wiederholungen laufen ohne diese Rückfrage
- **Ergebnisse überstehen einen Notizwechsel** — ein fertiges, noch nicht übernommenes Sidebar-Ergebnis überlebt einen Notizwechsel, das Zuklappen der Sidebar oder einen View-Wechsel innerhalb derselben Sitzung; ein Button „Ergebnisse verwerfen" räumt es explizit weg
- **Zweisprachig** — Obsidians Spracheinstellung (English / Deutsch) steuert die Oberfläche automatisch
- **Nicht-destruktiv** — Quellnotizen werden nie überschrieben; Embeds werden ersetzt, Originale bleiben erhalten
- **Eigenständige Dateien** — eine PDF oder ein Bild direkt in Obsidian öffnen, und die Sidebar behandelt *diese Datei* als Quelle — keine umgebende Notiz nötig
- **Prompt-Presets** — ein Wähler neben dem Modell in der Sidebar: ein „Standard"-Preset (dein editierbarer Prompt) plus feste Modi für Tabellen → Markdown, Handschrift, Mathe → LaTeX und Quellcode; die Wahl bleibt erhalten. Bei einem lokalen Vision-Modell ist der Prompt der wichtigste Qualitätshebel. (Bildbeschreibung gewünscht? Dafür gibt es jetzt den Beschreiben-Modus oben.)
- **Endpoint-Fallback-Liste** — eine geordnete Liste von Vision-Endpunkten konfigurieren; das Plugin pingt sie der Reihe nach und nutzt den ersten erreichbaren automatisch — eine einzige gesyncte Config funktioniert auf allen Geräten und Netzen
- **Thinking-Toggle** — ein Schalter neben der Modellauswahl schaltet das Nachdenken (Reasoning) von Hybrid-Modellen ab, um Wartezeit zu sparen; bleibt erhalten (Default: an); Modelle, die sich nicht abschalten lassen, zeigen „immer an"
- **Konfigurierbares Frontmatter-Mapping** — jeder Frontmatter-Schlüssel der erzeugten Notizen (und der `type`-Wert) lässt sich auf dein eigenes Vault-Schema anpassen — einheitlich für Transkript-, PDF- und Beschreibungs-Notizen

### Im Detail

Image to Markdown wandelt eingebettete Bilder und PDFs einer Obsidian-Notiz — Scans, Screenshots, fotografierte Seiten — mit einem OpenAI-kompatiblen Vision-Modell auf der eigenen Maschine in editierbares Markdown um. Nichts verlässt den Rechner. Die Quellnotiz wird nie überschrieben: jedes Bild und jede PDF bekommt eine eigene Transkript-Notiz, und der Original-Embed wird durch einen Embed dieser neuen Notiz ersetzt — kein Datenverlust, keine Duplikate, nichts an Cloud oder Dritte.

- **Sidebar-View.** Das Ribbon-Icon `scan-text` (Label „Image → Markdown") öffnet die Sidebar
  „IMG → MD". Sie zeigt alle eingebetteten Bilder der aktiven Notiz als Checkbox-Liste (alle
  vorausgewählt; nicht unterstützte Formate deaktiviert). Der Button „Transkribieren" streamt
  die Antwort des Vision-Modells **live** in eine Karte pro Bild — mit aufklappbarem
  Gedanken-/Thinking-Block bei Reasoning-Modellen und einem Kopier-Button. Pro Karte gibt es
  „Notiz anlegen", außerdem im Fußbereich einen farbigen „Anwenden"-Button, sobald mindestens eine
  Karte fertig ist. Karten sind read-only; rohes Markdown im pre-wrap. Nach dem Schreiben fällt das
  behandelte Bild beim Re-Scan aus der Liste.
- **Beschreiben-Modus.** Ein Moduswähler neben der Modellauswahl in der Sidebar — „Transkribieren" /
  „Beschreiben" — bestimmt, was der Lauf-Button tut: statt Text aus einem Bild zu ziehen, erzeugt
  „Beschreiben" eine Beschreibung, ideal für textarme Bilder (Fotos, Diagramme, Whiteboards), damit
  du sie über die Suche wiederfindest, obwohl kein Text drinsteht. Das Ergebnis ist nicht-destruktiv
  und zeigt Bild und Beschreibung zusammen auf einer Karte, mit editierbarer **Kategorie** (aus
  einer konfigurierbaren Taxonomie, als Vorschlagsliste angeboten) und freien **Tags** — beides
  editierbar, bevor du auf „Beschreibung speichern" klickst. Transkript und Beschreibung zum selben
  Bild koexistieren unabhängig.
- **Nachbessern per Feedback.** Ist eine Transkript-Karte fertig, gibst du im Feld „Nachbessern"
  (Platzhalter „Feedback, z. B. Tabellen als GFM") Prosa-Feedback ein — „diese Tabelle als GFM",
  „Überschriften-Ebene falsch" — und das Modell schreibt das ganze Dokument neu. Jede Karte behält
  einen konversationellen Verlauf (das Modell sieht Original plus alle bisherigen Runden), als
  scrollbarer Verlauf gerendert mit der Ursprungstranskription als erstem, gleichwertigem Eintrag,
  einem aufklappbaren Denkprozess je Runde und einem **[Kopieren] [Notiz anlegen]**-Aktionspaar auf
  jeder Version, sodass du frei wählst, welche du schreibst. Der Fußbereich bietet links „Ergebnisse
  verwerfen" und rechts einen farbigen „Anwenden"-Button, der die aktuellste Version schreibt.
  Text-only (kein Bild-Re-Grounding), komplett in-session, und — ist die Notiz schon geschrieben —
  läuft ein erneutes Schreiben über dasselbe Diff-Gate weiter unten.
- **PDF-Transkription (Sidebar).** Eingebettete PDFs erscheinen in derselben Sidebar wie Bilder.
  Den gewünschten Seitenbereich wählen (Default: alle Seiten), dann „Transkribieren" klicken —
  jede Seite wird über das gebündelte pdf.js gerendert und seitenweise transkribiert. Pro PDF
  entsteht eine Transkript-Notiz, der PDF-Embed wird ersetzt (genau wie bei Bildern). Limits:
  `pdfMaxPages` (konfigurierbar) und `pdfRenderScale` (Slider 1.0–4.0, mobil kleiner, OOM-Schutz);
  der Seitentrenner der zusammengeführten Notiz (`pdfPageSeparator`) ist konfigurierbar. Kein CDN —
  pdf.js ist vollständig offline gebündelt.
- **Eigenständige Datei als Quelle.** Ist die aktive Datei selbst eine PDF oder ein Bild — direkt in Obsidian geöffnet, nicht in eine Notiz eingebettet — zeigt die Sidebar sie als einzelnen Eintrag mit dem Label **„diese Datei"** an und behandelt sie als Transkriptions-Quelle. Der Seitenbereich ist bei PDFs wie gewohnt wählbar; Bilder zeigen eine einzelne Karte. Die Transkript-Notiz wird am **„Standard-Speicherort für neue Notizen"** (`app.fileManager.getNewFileParent`) angelegt, da es keine Quellnotiz gibt. Das Frontmatter enthält kein `source_note`-Feld; `source_pdf`/`source_image`, `created`, `transcribed_by` (bei PDFs auch `pages`) werden wie üblich geschrieben. Die Quelldatei wird nicht verändert. Idempotenz und Override gelten wie gewohnt.
- **Backlink-basierte Idempotenz.** Bereits transkribierte Quellen werden automatisch erkannt:
  Hat eine Notiz ein `source_pdf`- oder `source_image`-Frontmatter-Feld, das auf die Quelldatei
  auflöst, zeigt die Sidebar **„✓ Transkript vorhanden"** mit einem **„öffnen"**-Link statt erneut
  zu transkribieren. Solche Einträge sind zunächst abgewählt; die Zeilen-Checkbox erneut anhaken und
  transkribieren erzwingt eine neue Transkription (der Tooltip der Zeile lautet „erneut transkribieren
  überschreibt") — die bestehende Notiz wird überschrieben, das vollständige Frontmatter (bis auf
  `transcribed_by`/`pages`) bleibt erhalten. Das Überschreiben selbst läuft über das im Folgenden
  beschriebene Diff-Gate.
- **Diff vor dem Überschreiben.** Die einzige Operation, die vorhandenen Inhalt ersetzt — eine
  opt-in Neu-Transkription, die eine bereits bestehende Transkript-Notiz überschreibt — ist
  abgesichert: ein nativer Dialog mit dem Titel **„\<Datei\> überschreiben?"** zeigt einen
  zeilenweisen Diff alt↔neu, mit einer Checkbox pro Änderungsstelle (Default: alle angehakt) — so
  kannst du gezielt alte und neue Zeilen mischen; hakst du alle ab, passiert nichts (No-op, es wird
  nichts geschrieben). Bestätigen mit **„Übernehmen"** oder abbrechen mit **„Abbrechen"**. Die
  `+`/`-`-Marker sind farbunabhängig lesbar (Barrierefreiheit bei Rot-Grün-Sehschwäche).
  In-Session-Wiederholungen — z. B. eine beim ersten Versuch fehlgeschlagene PDF-Seite nachtragen —
  laufen ohne diese Rückfrage, und das Gate vergleicht den tatsächlichen Notiz-Inhalt auf der
  Festplatte, sodass es auch dann korrekt feuert, wenn du die Notiz zwischen zwei Überschreibungen
  derselben Sitzung von Hand bearbeitet hast.
- **Ergebnisse überstehen einen Notizwechsel.** Ein fertig transkribiertes, noch nicht übernommenes
  Ergebnis in der Seitenleiste geht nicht mehr verloren, wenn du zwischendurch die Notiz wechselst,
  die Seitenleiste zuklappst oder eine andere Ansicht öffnest — kommst du in derselben Sitzung zur
  Quelle zurück, ist das vorläufige Ergebnis wieder da (pro Quelldatei gemerkt). Ein Button
  „Ergebnisse verwerfen" räumt es explizit weg; ein erneutes Transkribieren derselben Quelle
  ersetzt es. Nach einem Obsidian-Neustart ist es weg (die Quelle liegt ja vor → neu transkribieren).
- **Endpoint-Fallback-Liste.** Statt eines einzelnen Vision-Endpunkts nimmt das Plugin eine geordnete Liste entgegen. Bei jedem Resolve (Sidebar-Refresh oder nach einem fehlgeschlagenen Aufruf mit einem automatischen Retry) werden die Endpunkte der Reihe nach angepingt und der erste erreichbare genutzt. Der aktive Endpunkt ist im Settings-Tab markiert und wird in der Sidebar-Statuszeile als **„verbunden via \<Endpunkt\>"** angezeigt. Der Settings-Tab rendert ein dynamisches Feld pro Eintrag — ein leeres Abschlussfeld ist der „Neu hinzufügen"-Einstieg; ein Feld leeren und verlassen entfernt den Eintrag. Jedes Feld zeigt ein eigenes Erreichbarkeits-Icon (Kreis-Haken / Kreis-X / Ladekreis) plus barrierefreien Titeltext. Eine einzige gesyncte `data.json` funktioniert damit auf allen Geräten: `localhost:1234` zuerst (das Gerät mit LM Studio), dann eine LAN-IP als Fallback (z.B. erreichbar vom Handy via WireGuard). Migration ist automatisch: ein vorhandenes `visionEndpoint`-Feld wird still nach `visionEndpoints` überführt — kein manueller Eingriff nötig.
- **Thinking-Toggle.** Ein Schalter neben der Modellauswahl (Gehirn-Icon, beschriftet
  „Thinking: an" / „Thinking: aus") schaltet das Nachdenken (Reasoning) von Hybrid-Modellen ab —
  praktisch, wenn ein großes Reasoning-Modell sonst lange denkt, bevor du das Ergebnis bekommst. Der
  Zustand bleibt erhalten (Standard: an). Modelle, die sich nicht abschalten lassen (z. B.
  gpt-oss/harmony), zeigen „Thinking: immer an" und bleiben unverändert.
- **Konfigurierbares Frontmatter-Mapping.** Alle Frontmatter-Schlüssel der erzeugten Notizen — plus
  der `type`-Wert selbst — lassen sich unter „Frontmatter-Mapping" in den Einstellungen an dein
  eigenes Vault-Schema anpassen (z. B. `kind` → `type`) — einheitlich für Transkript-, PDF- und
  Beschreibungs-Notizen. Beim späteren Ändern eines Keys wird eine **vaultweite Migration** der
  bestehenden Notizen angeboten — mit Diff-Vorschau pro Notiz und Drei-Wege-Bestätigung
  (migrieren & anwenden / ohne Migration anwenden / abbrechen).
- **Zweisprachige Oberfläche (Deutsch / English)** — alle nutzersichtbaren Texte folgen der
  Sprach-Einstellung von Obsidian; Englisch ist kanonisch, Deutsch wird automatisch geliefert.
  Die Sprache wird einmalig beim Laden des Plugins erkannt (zum Wechseln neu laden).
- **Command** „Bilder der aktiven Notiz transkribieren" (`transcribe-active-note`) —
  Batch-Transkription ohne Sidebar.
- **Command** „Sidebar öffnen" (`open-sidebar`) — öffnet die Sidebar.
- **Editor-Kontextmenü** „Image → Markdown" (Icon `scan-text`) — nur das Bild unter dem Cursor.
  (PDFs werden über das Kontextmenü nicht unterstützt — Sidebar verwenden.)

Sichtbares Thinking: `reasoning_content` aus dem Stream plus inline `<think>`-Tags landen im
Gedanken-Block. Das Reasoning ist ephemer und geht nie in die LLM-History ein.

## Voraussetzungen

- Obsidian 1.8.7+ (Desktop oder Mobile).
- Ein OpenAI-kompatibler lokaler Server mit einem **vision-fähigen** Modell — z.B.
  [LM Studio](https://lmstudio.ai), [Ollama](https://ollama.com) oder ein MLX-Server. In den
  Einstellungen konfigurierbar; nichts verlässt die Maschine (offline-first, keine Cloud, kein
  VPN).

## Installation

### Community-Plugins (empfohlen)

**Image to Markdown** in **Einstellungen → Community-Plugins → Durchsuchen** suchen, dann **Installieren** und **Aktivieren**.

### Manuell

`main.js`, `manifest.json` und `styles.css` aus dem
[letzten Release](https://codeberg.org/jkaindl/image-to-markdown/releases) nach
`<vault>/.obsidian/plugins/image-to-markdown/` legen, dann unter **Settings → Community
plugins** aktivieren.

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
2. Eine Notiz mit eingebetteten Bildern oder PDFs öffnen.
3. Auf das Ribbon-Icon **„Image → Markdown"** klicken (oder den Command **„Sidebar öffnen"**
   ausführen), um die Sidebar **„IMG → MD"** zu öffnen. Die eingebetteten Bilder und PDFs erscheinen als
   vorausgewählte Checkbox-Liste; nicht unterstützte Formate sind deaktiviert.
4. Auf **„Transkribieren"** klicken. Jedes ausgewählte Bild oder jede PDF bekommt eine Karte, die sich live mit
   dem gestreamten Markdown füllt. Bei Reasoning-Modellen den Gedanken-Block aufklappen, um dem
   Modell beim Denken zuzusehen; über den Kopier-Button das rohe Markdown übernehmen.
5. Auf **„Notiz anlegen"** einer einzelnen Karte klicken oder mit dem Fußbereich-Button **„Anwenden"** alle
   fertigen Transkripte auf einmal schreiben. Jedes Bild und jede PDF wird zu einer Transkript-Notiz, und sein Embed in
   der Quellnotiz wird durch einen Embed der neuen Notiz ersetzt.

Lieber ohne Sidebar? Den Command **„Bilder der aktiven Notiz transkribieren"** ausführen, um die
aktive Notiz im Batch zu transkribieren. Oder im Editor mit Rechtsklick auf ein Bild
**„Image → Markdown"** wählen, um nur das Bild unter dem Cursor zu transkribieren.

### Konfiguration

Setting-Heading in Obsidian: **„Vision (Image → Markdown)"**.

| Einstellung | Default | Hinweis |
|---|---|---|
| **Vision-Endpunkte** | `["http://localhost:8080"]` | Geordnete Liste OpenAI-kompatibler Server. Das Plugin pingt sie der Reihe nach und nutzt den ersten erreichbaren. MLX-Default — **LM Studio nutzt `:1234`** (häufigste Fehlkonfiguration). |
| **Vision-Modell** | (leer) | Vision-fähiges Modell (z.B. Qwen2-VL, Llama-3.2-Vision). Dropdown, gefüllt aus `/v1/models` des Endpoints; ist der Endpoint offline, wird es zum Freitextfeld. Das tatsächlich genutzte Modell wird aus `response.model` gelesen. |
| **Vision-Prompt** | Markdown-Transkription (siehe unten) | Anweisung an das Vision-Modell, frei editierbar (Text-Area). |
| **PDF max. Seiten pro Lauf** | `25` | Schutzgrenze für die Zahl transkribierter PDF-Seiten pro Lauf — größere PDFs über den Seitenbereich einschränken. Harte Obergrenze 500. |
| **PDF-Render-Auflösung** | `2.0` | Render-Auflösung der PDF-Seiten vor der OCR (Slider 1.0–4.0, Schritt 0.5). Niedrig = schneller, weniger Speicher; hoch = schärfere Seitenbilder & bessere OCR bei kleinem Text (2.0 ≈ 144 dpi). Mobil auf 1.5 begrenzt (OOM-Schutz). |
| **PDF-Seitentrenner** | Obsidian-Kommentar `%% Seite N %%` | Wie Seiten in der zusammengeführten Transkript-Notiz getrennt werden. Fünf Optionen: Obsidian-Kommentar `%% Seite N %%` (im Lesemodus unsichtbar), Überschrift `## Seite N`, Trennlinie `---`, Seitenumbruch (HTML, für Export) oder keiner (nahtloser Text). |
| **Eingebetteten PDF-Text nutzen** | An | Hat eine born-digital PDF-Seite einen echten Text-Layer, wird ihr exakter Text ans Modell geschickt und nach Markdown formatiert, statt ein gerendertes Bild zu OCR'en — schneller und ohne OCR-Fehler. Scan-/Figuren-Seiten fallen aufs Vision-Modell zurück. |
| **Denkprozess standardmäßig aufgeklappt** | Aus | Ob der Denkprozess-Block (Reasoning) jeder Nachbesserungs-Runde aufgeklappt startet. Aus = er klappt zu, sobald das Modell zu Ende gedacht hat (jederzeit von Hand zu öffnen). |
| **Beschreibungs-Kategorien** | Eine eingebaute Liste, editierbar | Die feste Menge an Kategorien, die dem Modell im Beschreiben-Modus angeboten wird (ein Feld pro Kategorie, hinzufügen/entfernen wie bei der Endpoint-Liste). |
| **Frontmatter-Mapping** | Die Standard-Keys des Plugins | Jeden Frontmatter-Schlüssel der erzeugten Notizen — und den `type`-Wert — an dein eigenes Vault-Schema anpassen (z. B. `kind` → `type`), einheitlich für Transkript-, PDF- und Beschreibungs-Notizen. Beim späteren Ändern eines Keys wird eine **vaultweite Migration** der bestehenden Notizen angeboten (Diff-Vorschau pro Notiz + doppelte Bestätigung). |

Default-Prompt:

> Transkribiere den Text im Bild exakt nach Markdown. Erhalte die Struktur: Überschriften,
> Absätze, \*\*Hervorhebungen\*\*, Listen und Tabellen. Gib nur das Markdown aus, keine
> Kommentare.

**Endpoint-Tipp:** die Base-URL **ohne** abschließendes `/v1` eintragen — der Client hängt
`/v1` selbst an (`normalizeEndpoint` strippt ein abschließendes `/v1`; beide Formen werden
akzeptiert).

Der Settings-Tab zeigt außerdem einen **Verbindungs-Status** mit „**Verbindung testen**" sowie
eine **„Vision-Fähigkeit"**-Zeile mit „**Vision testen**"-Button, der aktiv prüft, ob das gewählte
Modell wirklich Bilder lesen kann — Details im [Handbuch](https://codeberg.org/jkaindl/image-to-markdown/src/branch/main/docs/manual/reference.md#vision-capability-detection).

## Funktionsweise

- Für jedes ausgewählte Bild baut das Plugin einen multimodalen chat-completions-Request (das
  Bild im `content`-Array) an den konfigurierten OpenAI-kompatiblen Vision-Endpoint und streamt
  das Markdown zurück (SSE; `content` + `reasoning_content`).
- Es schreibt eine Transkript-Notiz pro Bild (gebündelt, read-once/write-once, keine Race) mit
  `transcribed_by`-Frontmatter (Modell aus `response.model`) und ersetzt den Bild-Embed in der
  Quellnotiz durch einen Embed der neuen Notiz. Nicht-destruktiv, idempotent.

Architektur- und Modul-Layout stehen in [AGENTS.md](https://codeberg.org/jkaindl/image-to-markdown/src/branch/main/AGENTS.md).

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

- Handbuch: [docs/manual/index.md](https://codeberg.org/jkaindl/image-to-markdown/src/branch/main/docs/manual/index.md)
- Changelog: [CHANGELOG.md](https://codeberg.org/jkaindl/image-to-markdown/src/branch/main/CHANGELOG.md)

## Entwicklung

```bash
npm install
npm run dev     # esbuild watch
npm run build   # prod-Bundle → main.js
npm test        # vitest
```

Konventionen (Branch-Modell, Conventional Commits, Qualitäts-Gates vor Commit) stehen in
[AGENTS.md](https://codeberg.org/jkaindl/image-to-markdown/src/branch/main/AGENTS.md).

## Sicherheit

Bilddaten werden ausschließlich an den vom Nutzer konfigurierten **lokalen** Endpoint gesendet —
keine Telemetrie, nichts an Cloud oder Dritte. Der Vertrauensanker ist der lokale Server, den
der Nutzer kontrolliert.

Sicherheitslücken bitte **nicht** öffentlich als Issue melden, sondern per E-Mail an
[code@jkaindl.de](mailto:code@jkaindl.de) (gerne PGP-verschlüsselt).

## Verwandtes

**[vault-rag](https://codeberg.org/jkaindl/vault-rag)** — das Schwester-Plugin mit dem RAG-Kern (Related-Notes, semantische Suche, Chat). Image to Markdown wurde am 2026-06-21 aus vault-rag 0.2.0 ausgegliedert, weil Bild-Transkription kein RAG ist; geteilt wurde nur der SSE-Transport.

## Lizenz

- Code: [AGPL-3.0-or-later](https://codeberg.org/jkaindl/image-to-markdown/src/branch/main/LICENSE). Eine kommerzielle Dual-License ist auf Anfrage verfügbar,
  falls die AGPL-Copyleft nicht passt.
- Dokumentation/Text: [CC BY-SA 4.0](https://codeberg.org/jkaindl/image-to-markdown/src/branch/main/LICENSE-DOCS).

Copyright © 2026 Johannes Kaindl.
