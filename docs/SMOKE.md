# GUI-Smoke — Prüfpunkte gegen ein laufendes Obsidian

Die vitest-Suite prüft den Kern ohne Obsidian (`img_to_md.ts`, `backlinks.ts`, `pdf_to_md.ts` …).
Was sie **nicht** sieht, ist die Naht zum Host: ob die Sidebar-View im echten Workspace
entsteht, ob `metadataCache` die Backlinks liefert, aus denen die Idempotenz-Anzeige folgt,
und ob pdf.js mit seinem als Blob-URL eingebetteten Worker im Renderer wirklich lädt. Genau
dort liegen die Fehler, die einem Nutzer zuerst begegnen.

⚠️ **Der Smoke läuft in einer Zweitinstanz, nie in der laufenden Instanz.** Die laufende Obsidian-Instanz ist geteilte Infrastruktur — ein `quit` trifft die Instanz, an der möglicherweise eine andere Session arbeitet, und zerstört deren Zustand. Deshalb gibt es keinen Standardport: `--port` ist Pflicht, ohne ihn bricht der Treiber mit Exit 2 ab.

```bash
UD=/tmp/obs-test-image-to-markdown                 # Profil je Repo
pgrep -f "user-data-dir=$UD"                       # leer, sonst auf ein anderes Profil ausweichen
lsof -nP -iTCP:<port> -sTCP:LISTEN                 # leer
cp ~/Library/Application\ Support/obsidian/obsidian-*.asar "$UD"/
# $UD/obsidian.json: Vault ($STAGING_VAULTS_DIR/image-to-markdown) und "language":"en" eintragen
/Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir="$UD" --remote-debugging-port=<port> &
```

**Vor dem Lauf den CDP-Lock für den eigenen Port nehmen** — er ist die Eintrittskarte, nicht die Kür: ohne ihn blockt der PreToolUse-Guard jeden Zugriff.

```bash
python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label image-to-markdown \
  --intent "GUI-Smoke" --exclusive focus --port <port> --ttl 300     # danach: … release
```

`--exclusive focus`, weil dieser Treiber das Fenster nach vorn holt — ein fremdes `activate` würde eine laufende Messung zerschießen. Wer misst, startet je Lauf einen frischen Prozess; der erste Lauf nach der Profilanlage ist ein Aufwärmlauf und zählt nicht.

`npm run smoke:gui -- --port <port>` fährt die Punkte unten (`--with-model` nimmt die drei Modell-Punkte dazu). Den Vertrauensdialog und den Restricted Mode des frischen Profils erledigt der Treiber selbst (`bereiteInstanzVor`, Befund im Detail von A1). Vault-Aufbau: `npm run shots -- --setup`, Details in `docs/images/README.md`.

**Die Bilanz hat vier Zustände** (CORE-TEST-19): grün · rot · übersprungen · nichts gemessen. Die Soll-Liste (40 Punkte) ist der Nenner. Übersprungen sind nur die Modell-Punkte G1–G3 ohne `--with-model`; wirft ein Punkt, ohne dass sein Gegenstand erreicht wurde, steht er als „nichts gemessen" da und der Lauf endet mit Exit 1, ein Abbruch des Treibers mit Exit 2.

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
| E3 | Einstellungen: jedes Öffnen baut neu auf | dreimal hintereinander die Einstellungen des Plugins öffnen und schließen; ein Zähler auf dem vollen Aufbau (`renderFallback`, der Rückruf des Hakens `installTabRefreshOnOpen`) muss bei jedem Öffnen steigen. Gegenprobe: baut `hide()` den Haken ab, bleibt der Zähler vom zweiten Öffnen an stehen (Kit-Vertrag, Obsidian 1.14.5: das Öffnen ruft `renderTab()`). Eine Marke im Tab-Container hat die Mutation nicht gefangen (auch der native Aufbau leert ihn) |
| CL1 | Claude-Opt-in: „Automatisch“ nimmt Claude nie | Fake-Manager mit dem Claude-Eintrag VORN und einem lokalen dahinter. Kontrolle am Fake: `list()` ohne `transports` liefert 1, mit beiden 2, und `resolve` mit beiden Transporten würde den Claude-Eintrag nehmen. Das Plugin fragt den Manager bei „Automatisch“ nur mit `["http"]` (mitgeschnitten) und löst auf den lokalen Endpunkt auf; die ausdrückliche Wahl (`choice.endpointId`) löst auf Claude auf (Backend `anthropic`, Familie `claude`). Mutationsprobe: `transports: { anthropic: true }` in `main.ts` macht den Punkt rot |
| CL2 | Claude: ein Bild geht als Bildblock an die Messages-API | gegen den Claude-Stub der Brücke (`anbieter: "anthropic"`): der gesendete Body trägt einen Block `image` mit `source.type = base64` und `media_type = image/png`, `x-api-key` ist der des Managers, kein `temperature`, und der Text der Antwort kommt zurück. Die Wire lässt andere Bildtypen still weg; `tests/anthropic_images.test.ts` sichert, dass keine Endung aus `SUPPORTED_EXTS` dazu gehört |
| ML1 | Modellzeile: zwei Modelle, Name, Ansage | gegen einen Fake-Endpunkt mit **zwei** Modellen: genau eine `.okit-model-bar` in der Sidebar, das Dropdown trägt „Automatisch“ und beide Modelle, hat einen `aria-label`, und „Neu laden“ (echter Klick) sagt „2 Modelle geladen“ an (`aria-live`). Gegenprobe im selben Punkt: derselbe Weg gegen einen Endpunkt mit einem Modell zeigt nur eines |
| ML2 | Modellzeile: der Wechsel wirkt | die erste Anfrage am Fake-Endpunkt trägt Modell A; nach der Wahl von B im Dropdown meldet `llm.modelInUse()` B, und die nächste Anfrage trägt B (der Stub schneidet den Body mit) |
| ML3 | Modellzeile: Denk-Steuerung in der Zeile | gegen einen Fake-Endpunkt mit `google/gemma-4-e4b`: `.okit-model-bar .okit-thinking-control select` (ohne das unsichtbare Mess-`select` von Obsidian, `.is-measuring`) gibt es genau einmal und in der Sidebar insgesamt auch nur einmal; ein Zwei-Zustands-Knopf (`.okit-thinking-toggle`), die Preset-Zeile (Gegenprobe) und der alte Host `.img2md-think` tragen nichts |
| ML4 | Modellzeile: Sperre im Lauf | während eines (verlangsamten) Laufs sind Dropdown und „Neu laden“ gesperrt, davor und danach frei (gelesen am echten DOM, `disabled`) |
| ML5 | Post-Sync nach dem Lauf | die Altentscheidung (`response.model` bestimmt die Wahl) am echten Fenster: Wahl A, der Stub antwortet unter anderem Namen → die Wahl folgt dem genannten Modell; Wahl „Automatisch“ → die Wahl bleibt „Automatisch“ (der Kit-Satz „ändert nie ein Modell, das der Nutzer nicht gewählt hat“; vorher legte der Post-Sync sie fest, gemessen 2026-10-25) |
| N3 | Denkstufe in der Modellzeile | gegen einen Fake-Endpunkt mit `google/gemma-4-e4b`: das Dropdown der Denk-Steuerung trägt die Stufen des Modells (aus, niedrig, mittel, hoch), kein Zwei-Zustands-Knopf; eine Wahl (`change`) wird in `settings.request.thinking.transform` gespeichert und das Dropdown zeigt sie |
| N4 | „Stufenwahl im Chat“ ist wirkungslos | dieselbe Lage: mit `levelPickerInChat` aus und an zeigt die Modellzeile dasselbe Dropdown mit denselben Stufen und nie einen Knopf (Kit 0.73.0: `levelPicker` gilt in der Modellzeile nicht); deshalb bietet V5 die Einstellung nicht mehr an |
| N6 | gpt-oss: gespeichertes „aus“ sendet `low` | Fake-Endpunkt mit `openai/gpt-oss-20b`, `request.thinking.transform = "off"`: der gesendete Body trägt `reasoning_effort: "low"` (code-kit 0.39.0, vorher `minimal`), das Dropdown führt kein „aus“ und zeigt „Low“. Der Fake antwortet mit dem Modell der Zeile, sonst zeigt die Sidebar die Notice „andere Modellfamilie“ in der Ecke und ein folgender Klick trifft sie |
| LK1 | Link-Wächter: gekappter Link sieht aus wie Text | die Gegenstelle liefert ein Transkript mit `[gekappt](javascript:…)` und `[Ziel](https://…)` (`deps.transcribeStream` gestubbt, der Weg der Karte ist echt: `neutralizeModelMarkdown`, `renderMarkdownGuarded`, `.img2md-text`). Der gekappte Link trägt kein `href` und hat die Farbe des umgebenden Texts, keine Linie, keinen Zeiger, kein Icon und keinen Abstand rechts; der Link mit Ziel (Gegenprobe) bleibt ein Link (Linie, Farbe oder Zeiger). Die zwei Regeln in `styles.css` (`.img2md-text a:not([href])`, Kit 0.72.0 `STREAM_AREA_CSS` mit eigenem Vorfahren) tragen den Punkt: ohne sie rot |
| V1 | Schlüssel an Ping und Chat | gegen einen Fake-Endpunkt: eine Zeile mit `apiKey` → `GET /v1/models` und `POST /v1/chat/completions` tragen `Authorization: Bearer …`, die aufgelöste Config trägt den Schlüssel (`(await llm.resolve()).config`), und der Vision-Test der Einstellungen (`plugin.testVision`) läuft ohne Fehler. Auch die Backend-Erkennung (`/api/v1/models`, seit obsidian-kit 0.51.3) trägt den Schlüssel und muss vorkommen; per Mutation (Probe ohne Schlüssel) rot gemessen |
| V2 | Schlüsselbund | ein Klartext-`apiKey` wandert beim ersten `llm.resolve({ force: true })` in `app.secretStorage`: `data.json` enthält weder den Wert noch ein Feld `apiKey`, die Zeile trägt `secretId`, der Wert liegt im Schlüsselbund. Der Punkt räumt den Eintrag danach auf |
| V3 | Nicht-Stream-Weg | `makeImgIO().transcribe` (Befehl, Kontextmenü, Anbieter-API) sendet `stream: false` und liefert den Volltext des Fake-Endpunkts |
| V4 | Schwärzung (Textpfad) | ein Prompt mit `Bearer …` (≥ 16 Zeichen) geht als Platzhalter (`[redacted-token-1]`) an den Server, im Ergebnis steht das Original wieder. Bildteile werden nie geschwärzt |
| V5 | Host und Stufenwahl | der Anfrage-Abschnitt in den Einstellungen zeigt die Zeile „Stufenwahl im Chat“ **nicht mehr** (Kit 0.73.0: die Modellzeile zeigt die Stufe immer als Dropdown, die Einstellung wäre wirkungslos), die Hilfe-Zeile bleibt die erste und die Prompt-Zeile nach dem Host ist noch da (`renderSettings` bekommt einen eigenen Host, nicht den Tab) |
| R1 | Nachbessern mit Verzweigung | gestubbtes `deps.refine` an der echten View, `deps.transcribeStream` liefert `T0`: nachbessern (f1), nachbessern (f2), Rückwahl auf Runde 1 über `selectRefineVersion`, nachbessern (f3) → die dritte Anfrage trägt `[f1]`, nicht `[f1, f2]` (0.30.0, Stand 0.29.0 sendet beide). Der Punkt schreibt nichts und gibt der View das aktive Modell zurück, damit sie die Einstellungen nicht angleicht |
| P1 | Fokus-Erhalt (Pflichtpunkt §3a) | Notiz `Trail handbook`: eine Ziffer ins Seitenfeld `.img2md-pdf-from` tippen (Fokus und Wert werden vorher belegt, sonst „nichts gemessen“), dann `view.rescan()` (baut die Liste mit `renderList()` neu auf), danach ein Fenster von 1200 ms mit `messeFokusFenster`: der Fokus muss im Feld bleiben. Der Neuaufbau ersetzt das Feld; `renderList` merkt vorher Zeile (Link), Feld, getippten Text und Auswahl und stellt sie am neuen Feld wieder her (Naht `deps.activeElement`) |
| P1b | Gegenprobe zu P1 | dasselbe Tippen, dann `blur()` auf dem Feld: dieselbe Messung muss rot werden („Fokus fiel …“); wird sie grün, sieht P1 den Fokusverlust nicht |
| P2 | Erreichbarkeit der Fußknöpfe (Pflichtpunkt §3a) | fertige Karten (`deps.transcribeStream` gestubbt, `view.run()`), `.img2md-cards` mit Füllzeilen zum Überlaufen bringen, `messeErreichbarkeit` für `.img2md-clear` und `.img2md-apply`. Ausgenommen: `.img2md-run`, `-toggle`, `-mode-btn` (liegen über den Karten, können nicht verdeckt werden) und `.img2md-retry-all` (versteckt ohne fehlgeschlagene Karte) |
| P2b | Gegenprobe zu P2 | die Kartenliste wächst statt zu rollen (`art: wachsen`: `flex: none`, `overflow: visible`): mindestens ein Fußknopf muss unerreichbar werden |

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
| 2026-10-25 | 1.14.5 | **37 grün · 0 rot · 3 übersprungen (G1–G3) · 0 nichts gemessen von 40** (Kernlauf, frischer Prozess; vorher 31 grün · 0 rot · 3 übersprungen von 34; Pin-Stand ohne Umbau ebenfalls 31/0/3/0) | Geführt an der Modellzeile (Welle 27, obsidian-kit 0.70.0): neu ML1–ML5 und E3. Gegenproben je Lauf mit einem Wegwerf-Build, jede genau am erwarteten Punkt: Sperre entfernt (`disabled: () => false`) → **ML4 rot**; `setModel` des Adapters leer → **ML2 rot**; Denk-Optionen nicht übergeben → **ML3 rot** (und N3, N4, die denselben Knopf messen); Liste auf ein Modell gekürzt → **ML1 rot** (und ML2); `hide()` baut den Haken `installTabRefreshOnOpen` ab → **E3 rot** (der volle Aufbau zählt 0 / 0 / 0 statt 0 / 2 / 4). Eine Marke im Tab-Container fing diese letzte Mutation nicht (auch der native Aufbau leert ihn): E3 zählt deshalb die Aufrufe von `renderFallback`. ML5 misst die Altentscheidung Post-Sync: eine konkrete Wahl folgt dem Modell des Servers, „Automatisch“ bleibt Automatisch. Vorher legte der Post-Sync auch „Automatisch“ fest (gemessen im ersten Lauf, Entscheidung des Masters: ausnehmen); Gegenprobe: ohne die Bedingung ist ML5 rot. Ansicht am Bild bei 520, 300 und 260 px, hell und dunkel. |
| 2026-10-26 (Welle 28) | 1.14.5 | **38 grün · 0 rot · 3 übersprungen · 0 nichts gemessen von 41** (G1 bis G3 ohne `--with-model`) nach Pin-Hebung (obsidian-kit 0.72.0 / code-kit 0.38.0), `onRefreshed` statt Adapter und LK1 (neu) | Baseline davor 37 grün · 0 rot · 3 übersprungen von 40. Mutation: die zwei Regeln für `.img2md-text` entfernt macht LK1 rot (gekappter Link violett, unterstrichen, Zeiger, Icon). **B3 braucht den Vordergrund:** mit dem Dach-Standard `vordergrund: "nie"` war B3 rot („kein Empty-State, 1 Zeilen“), auch am unveränderten Stand 4b1624d (Worktree, 36 grün · 1 rot von 40); der Treiber ruft deshalb `requireVisible(cdp, { vordergrund: "nehmen" })` (nur unter `--exclusive focus`), damit 38 grün |
| 2026-10-25 | 1.14.5 | **31 grün · 0 rot · 3 übersprungen (G1–G3) · 0 nichts gemessen von 34** (Kernlauf, frischer Prozess; vorher 30 grün · 1 rot (P1)) | Geführt am Fokus-Fix (Welle 27): P1 grün, weil `renderList` das Seitenfeld der PDF-Zeile samt getipptem Wert am neuen Feld wieder fokussiert (Naht `deps.activeElement`). Mutation im Unit-Test: Fokus-Rücksprung entfernt → drei Tests rot. P1b bleibt grün im Sinn der Gegenprobe (Fokus genommen → Messung rot) |
| 2026-10-25 | 1.14.5 | **30 grün · 1 rot (P1) · 3 übersprungen (G1–G3) · 0 nichts gemessen von 34** (Kernlauf, frischer Prozess; Baseline vorher 27 grün · 3 übersprungen von 30) | Geführt an den Pflichtpunkten P1–P2b (Welle 26): P1b wird rot, sobald dem Feld der Fokus genommen wird; P2b macht beide Fußknöpfe unerreichbar, wenn die Kartenliste wächst statt zu rollen. P1 ist ein echter Befund (`renderList` ersetzt das Seitenfeld), Task im Cockpit |
| 2026-10-12 | 1.14.4 | **25 grün · 0 rot · 3 übersprungen (G1–G3) · 0 nichts gemessen von 28** (Kernlauf, frischer Prozess) | Geführt am Treiber-Umbau auf `bilanz.ts` (Welle 19, Baseline vorher 23 grün · 1 rot (B3) von 24 gezählten) und an R1: gegen den Wegwerf-Build von Tag 0.29.0 **rot** (dritte Anfrage trägt `f1, f2`), gegen 0.30.0 grün; Mutation (B2 wirft) → 23 grün · 1 nichts gemessen, Exit 1; ohne `--port` Exit 2 |
| 2026-10-09 | 1.14.4 | **23/23** (Kernlauf, zwei frische Prozesse) · mit `--with-model` G1–G3 grün | Geführt am Verbindungs-Tausch (Welle 15, Kit 0.51.3): Baseline vorher 18/18, danach 18 umgeschriebene/gleiche Punkte plus V1–V5. V3 und V4 per Mutation rot gemessen (`stream: false` entfernt, `redact: false`), V1 war am echten Befund rot (Backend-Probe ohne Schlüssel). **B3 streut** (in 4 von 8 Läufen rot, auch vor dem Tausch): erst der frische Prozess zählt |
| 2026-09-02 | 1.13.7 | **9/9** | Geführt am neuen Herkunfts-Guard (`requireEigenerBuild`), beide Ausgänge einzeln belegt: **(a)** ein Byte an die `main.js` im Vault angehängt → der Lauf **bricht ab, bevor ein Prüfpunkt läuft** („im Vault: 2.422.444 Bytes · gebaut: 2.422.443"), zurückgedreht wieder 9/9 und **kein anderer Punkt sprang mit**; **(b)** den frisch gebauten Vergleichsstand entfernt → Ausgang `ungeklaert`, also **Warnung statt Abbruch**, sichtbar oben *und* unter der Schlussbilanz. Im Normalfall ist der Guard still. Nebenbefund: Der Staging-Vault trug noch `manifest.json` 0.20.0, während `main.js` byte-gleich mit dem Repo-Stand war — A1 liest die deployte Datei und hätte das gemeldet; der Guard sieht es nicht, weil er die `main.js` misst. Die beiden Prüfungen ergänzen sich also, ersetzen einander nicht. |
| 2026-08-30 (spät) | 1.13.7 | **9/9** | Geführt an E1: CSS-Hälfte im Staging-Vault entfernt → rot mit `display=block` und handlungsleitender Meldung, nach dem Zurückdrehen wieder grün, kein anderer Punkt sprang mit. **E1 hat dabei sich selbst korrigiert:** vorher meldete er „Einstellungen in eigenem Fenster — von hier nicht messbar" als *grünen* Punkt; ab Obsidian 1.13 sind die Einstellungen ein eigenes CDP-Target, gemessen wird jetzt über `attachTo("settings", …)`. Nebenbefund des ersten Laufs: `styles.css` war im Staging-Vault **nie deployt** — der alte E1 konnte das nicht sehen. |
| 2026-08-30 | 1.13.7 | **9/9** | Geführt: A2 war rot am echten Defekt (Sidebar öffnete beim ersten Aufruf unsichtbar), grün nach dem Fix in `main.ts` — und **kein anderer Punkt fiel mit oder sprang mit**. Von den beiden roten Punkten des ersten Laufs war nur einer ein Plugin-Fehler: B3 maß die Notiz des vorherigen Punktes, weil die Wartebedingung (Liste *oder* Empty-State steht) schon vom alten Zustand erfüllt war. Behoben, indem auf `view.cardsSourcePath` gewartet wird — den einzigen Zustand der View, der sagt: ich habe *diese* Datei verarbeitet. |
