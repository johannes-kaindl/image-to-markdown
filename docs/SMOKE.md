# GUI-Smoke — Prüfpunkte gegen ein laufendes Obsidian

Die vitest-Suite prüft den Kern ohne Obsidian (`img_to_md.ts`, `backlinks.ts`, `pdf_to_md.ts` …).
Was sie **nicht** sieht, ist die Naht zum Host: ob die Sidebar-View im echten Workspace
entsteht, ob `metadataCache` die Backlinks liefert, aus denen die Idempotenz-Anzeige folgt,
und ob pdf.js mit seinem als Blob-URL eingebetteten Worker im Renderer wirklich lädt. Genau
dort liegen die Fehler, die einem Nutzer zuerst begegnen.

`npm run smoke:gui -- --vault image-to-markdown` fährt die Punkte unten gegen ein laufendes
Obsidian (CDP über `--remote-debugging-port`). Voraussetzungen und Vault-Aufbau:
`npm run shots -- --setup`, Details in `docs/images/README.md`.

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
| E1 | Einstellungen rendern | der Settings-Tab zeigt die Endpunkt-Liste mit mindestens einem Eintrag und einem Erreichbarkeits-Icon |

### Nur mit `--with-model`

| # | Punkt | Was gemessen wird |
| --- | --- | --- |
| M1 | Transkription läuft | ein Lauf über `field-notes.png` füllt eine Karte (`.img2md-card`) mit Text |
| M2 | PDF rendert sichtbar | ein Lauf über Seite 1 des PDF liefert ein Bild mit Inhalt — die Gegenprobe darauf, dass die nicht eingebettete Standard-Schrift (Helvetica) im Renderer wirklich gezeichnet wird |

## Was Handarbeit bleibt

Nicht mechanisch entscheidbar und deshalb bewusst nicht automatisiert: ob der Stream sich
flüssig anfühlt, ob eine Transkription inhaltlich gut ist, ob die Karten im dunklen Theme
gut aussehen.

## Durchläufe

| Datum | Obsidian | Ergebnis | Gegenprobe |
| --- | --- | --- | --- |
| 2026-08-30 | 1.13.7 | **9/9** | Geführt: A2 war rot am echten Defekt (Sidebar öffnete beim ersten Aufruf unsichtbar), grün nach dem Fix in `main.ts` — und **kein anderer Punkt fiel mit oder sprang mit**. Von den beiden roten Punkten des ersten Laufs war nur einer ein Plugin-Fehler: B3 maß die Notiz des vorherigen Punktes, weil die Wartebedingung (Liste *oder* Empty-State steht) schon vom alten Zustand erfüllt war. Behoben, indem auf `view.cardsSourcePath` gewartet wird — den einzigen Zustand der View, der sagt: ich habe *diese* Datei verarbeitet. |
