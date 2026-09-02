# GUI-Smoke — Prüfpunkte gegen ein laufendes Obsidian

Die vitest-Suite prüft den Kern ohne Obsidian (`img_to_md.ts`, `backlinks.ts`, `pdf_to_md.ts` …).
Was sie **nicht** sieht, ist die Naht zum Host: ob die Sidebar-View im echten Workspace
entsteht, ob `metadataCache` die Backlinks liefert, aus denen die Idempotenz-Anzeige folgt,
und ob pdf.js mit seinem als Blob-URL eingebetteten Worker im Renderer wirklich lädt. Genau
dort liegen die Fehler, die einem Nutzer zuerst begegnen.

`npm run smoke:gui -- --vault image-to-markdown` fährt die Punkte unten gegen ein laufendes
Obsidian (CDP über `--remote-debugging-port`). Voraussetzungen und Vault-Aufbau:
`npm run shots -- --setup`, Details in `docs/images/README.md`.

**Vor dem Lauf gehört ein Deploy des gebauten Repo-Stands in den Vault, gegen den gemessen
wird.** Der Treiber erzwingt das seit 2026-09-02 mit `requireEigenerBuild` (zentral in
`tools/obsidian-cdp/vault.ts`): er vergleicht die `main.js` im Vault per sha1 mit der frisch
gebauten und bricht ab, wenn dort ein anderer Build liegt — eine Store-Installation etwa.
Die trägt dieselbe Versionsnummer, weshalb A1 sie nicht sehen kann; am 2026-08-30 standen
workspace-weit 69 von 150 grünen Prüfpunkten auf Code, der nicht belegt der Repo-Stand war.
Den geprüften Pfad holt der Guard aus der **laufenden** Instanz (`app.vault.adapter.basePath`),
nicht aus dem konfigurierten Staging-Pfad: der Treiber dockt per `--vault` an ein beliebiges
Fenster an, und geprüft werden muss, was gemessen wird. Fehlt die frisch gebaute `main.js`,
bleibt nur der schwache Nachweis (Store-Suffix) — der Lauf warnt dann, statt abzubrechen,
und die Warnung steht auch unter der Schlussbilanz.

**Der Kernlauf braucht kein Modell.** Das ist Absicht: ein Smoke, der einen erreichbaren
Vision-Endpoint voraussetzt, ist nicht reproduzierbar grün — er misst dann die Laune eines
LLM mit. Die Punkte, die zwingend einen Lauf brauchen, stehen unter `--with-model` und
bleiben optional.

## Prüfpunkte

| # | Punkt | Was gemessen wird |
| --- | --- | --- |
| A1 | Plugin geladen | `app.plugins.enabledPlugins` kennt `image-to-markdown`, und die Version kommt aus der **deployten** `manifest.json`, nicht aus `plugin.manifest` (die ist der Stand vom App-Start) |
| A2 | Sidebar öffnet | `open-sidebar` erzeugt ein Blatt `data-type="image-to-markdown-view"`, das echte Fläche hat (`getClientRects`), nicht nur einen DOM-Knoten |
| B1 | Quellen erkannt | „Field notes" listet genau zwei Zeilen (`.img2md-item`): `field-notes.png` und `photo.heic` |
| B2 | Nicht unterstütztes Format | die `.heic`-Zeile hat eine **deaktivierte** Checkbox, die `.png`-Zeile eine aktive — HEIC wird angezeigt und übersprungen, nicht verschwiegen |
| B3 | Empty-State | „Reading list" (ohne Bilder) zeigt `.img2md-empty` mit dem Text aus `i18n` |
| C1 | Idempotenz erkannt | `field-notes.png` trägt `.img2md-exists` + `.img2md-exists-open` — das ist `findExistingTranscript` über den echten `metadataCache`, inklusive des load-bearing Frontmatter-Filters |
| C2 | „open" springt | Klick auf den Link macht `Field notes (transcript).md` zur aktiven Datei |
| D1 | PDF geladen | „Trail handbook" zeigt eine PDF-Zeile mit Seitenbereich `1`–`3`. Die `3` kommt aus `pdfPageCount` — der Punkt prüft damit die **Worker-Blob-Strategie** mit, an der das Bundling hängt |
| D2 | Seitenbereich begrenzt | die `to`-Eingabe akzeptiert keinen Wert über der Seitenzahl |
| E1 | Endpunkt-Editor + seine CSS-Hälfte | der Settings-Tab zeigt den Kit-Baustein (`.okit-ep-row`, `.okit-ep-status`) **und** dessen Darstellung greift: `.setting-item-info` der Zeile steht auf `display:none`. Das ist der inhaltliche Gegenpart zu `tools/ui_adoption_check.py` — der vergleicht nur die Regelmenge in `styles.css`, nicht ob sie wirkt |

### Nur mit `--with-model` — **geplant, noch nicht gebaut**

Der Treiber kennt das Flag und die Skip-Mechanik; **Prüfpunkte dieser Art gibt es bisher
keine.** Das steht hier als Absicht, nicht als Abdeckung — eine Checkliste, die Punkte
führt, die nichts messen, ist schlimmer als eine kurze: sie wird beim Zitieren zu
behaupteter Abdeckung. Erkennbar ist der Zustand auch am Lauf selbst, der weder eine
Ergebniszeile noch ein „übersprungen" für sie ausgibt.

| # | Punkt | Was gemessen werden soll |
| --- | --- | --- |
| M1 | Transkription läuft | ein Lauf über `field-notes.png` füllt eine Karte (`.img2md-card`) mit Text |
| M2 | PDF rendert sichtbar | ein Lauf über Seite 1 des PDF liefert ein Bild mit Inhalt — die Gegenprobe darauf, dass die nicht eingebettete Standard-Schrift (Helvetica) im Renderer wirklich gezeichnet wird. Bis dahin ist **offen**, ob das Fixture-PDF im Plugin sichtbar rendert; strukturell geprüft ist es (pdf.js liest 3 Seiten und den Text-Layer), sichtbar geprüft nicht. |

## Was Handarbeit bleibt

Nicht mechanisch entscheidbar und deshalb bewusst nicht automatisiert: ob der Stream sich
flüssig anfühlt, ob eine Transkription inhaltlich gut ist, ob die Karten im dunklen Theme
gut aussehen.

## Durchläufe

| Datum | Obsidian | Ergebnis | Gegenprobe |
| --- | --- | --- | --- |
| 2026-08-30 (spät) | 1.13.7 | **9/9** | Geführt an E1: CSS-Hälfte im Staging-Vault entfernt → rot mit `display=block` und handlungsleitender Meldung, nach dem Zurückdrehen wieder grün, kein anderer Punkt sprang mit. **E1 hat dabei sich selbst korrigiert:** vorher meldete er „Einstellungen in eigenem Fenster — von hier nicht messbar" als *grünen* Punkt; ab Obsidian 1.13 sind die Einstellungen ein eigenes CDP-Target, gemessen wird jetzt über `attachTo("settings", …)`. Nebenbefund des ersten Laufs: `styles.css` war im Staging-Vault **nie deployt** — der alte E1 konnte das nicht sehen. |
| 2026-08-30 | 1.13.7 | **9/9** | Geführt: A2 war rot am echten Defekt (Sidebar öffnete beim ersten Aufruf unsichtbar), grün nach dem Fix in `main.ts` — und **kein anderer Punkt fiel mit oder sprang mit**. Von den beiden roten Punkten des ersten Laufs war nur einer ein Plugin-Fehler: B3 maß die Notiz des vorherigen Punktes, weil die Wartebedingung (Liste *oder* Empty-State steht) schon vom alten Zustand erfüllt war. Behoben, indem auf `view.cardsSourcePath` gewartet wird — den einzigen Zustand der View, der sagt: ich habe *diese* Datei verarbeitet. |
