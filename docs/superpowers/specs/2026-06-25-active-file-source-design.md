# Design: Aktive Datei als Quelle (Slice 2, Etappe 3)

**Datum:** 2026-06-25
**Status:** Entwurf
**Scope:** Eine **direkt geöffnete** PDF- oder Bild-Datei (ohne umgebende Quellnotiz) als Transkriptions-Quelle nutzen. Letzter Baustein der Slice-2-Roadmap (nach Etappe 1 Backlink-Idempotenz und Etappe 2 verlinkte Quellen).

---

## 1. Motivation

Heute setzt die gesamte Pipeline voraus, dass die aktive Datei eine **Markdown-Notiz** ist, deren Embeds/Links gescannt werden (`scan()` liest `vault.adapter.read(sourcePath)` → `findImageEmbeds`). Öffnet man dagegen ein **PDF oder Bild direkt** (Obsidian zeigt beide nativ an), liefert `findImageEmbeds` auf dem Binär-/Nicht-Markdown-Inhalt nichts → leere Liste → die Sidebar meldet „keine Bilder". Ein häufiger Fall: ein gescanntes Dokument oder Foto liegt als Datei im Vault, ist aber (noch) in keiner Notiz eingebettet.

Etappe 3 schließt diese Lücke: Ist die aktive Datei selbst ein PDF/Bild, wird **sie** zur Quelle. Drei Dinge unterscheiden sich vom Notiz-Pfad:

1. **Kein `replaceEmbed`** — es gibt keine Quellnotiz, in der ein Embed ersetzt würde (verhält sich wie der `embed:false`-Pfad aus Etappe 2, nur ohne Quelltext).
2. **Ablageort** der Transkript-Notiz kommt aus `app.fileManager.getNewFileParent(sourcePath)` statt `dirOf(sourcePath)` — es gibt kein „neben der Quellnotiz".
3. **`source_note` entfällt** im Frontmatter — die Quelle *ist* die Datei, es gibt keine Notiz, auf die zurückverwiesen würde.

Die Backlink-Idempotenz aus Etappe 1 (`findExistingTranscript` via `source_pdf`/`source_image`) trägt **unverändert** weiter: die erzeugte Transkript-Notiz zeigt im Frontmatter auf die Datei, also wird sie beim erneuten Öffnen als „vorhanden" erkannt.

---

## 2. Scope

### Diese Etappe (3)
- `scan()` erkennt: ist die **aktive Datei selbst** ein PDF/Bild (Extension-Klassifikation), liefert sie **ein** synthetisches `ImgItem` mit `selfSource:true`, `embed:false` — statt `findImageEmbeds` auf dem Datei-Inhalt aufzurufen.
- Die bestehende View-/Streaming-/Schreib-Pipeline wird wiederverwendet (Karten, Idempotenz-Badge, Override, Modellwahl, PDF-Seitenbereich); nur drei Stellen verzweigen (Stream-Read, Ablageort, `source_note`/`replaceEmbed`).
- Ablageort via `getNewFileParent`; `source_note` weggelassen; Quelldatei wird **nie** geschrieben.
- Eintrittspunkt ausschließlich die **Sidebar** (reagiert bereits auf `active-leaf-change`).

### Bewusst NICHT (YAGNI)
- **Kein** Command- oder `file-menu`-Eintrittspunkt — die Sidebar bietet PDF-Seitenbereich, Idempotenz-Badge und Streaming; ein UI-loser Pfad würde bei großen PDFs unkontrolliert die Default-Range rendern und die Logik duplizieren.
- **Keine** eigene Plugin-Einstellung für den Ablageort — `getNewFileParent` respektiert bereits die globale „Default location for new notes"-Einstellung des Users.
- **Keine** eigene UI-Sektion — ein dezentes „diese Datei"-Label an der bestehenden Listenzeile genügt.

---

## 3. Architektur (Ansatz A: synthetisches Item + parametrisierter Ablageort)

### `src/img_to_md_state.ts`
- `ImgItem` → neues optionales Feld `selfSource?: boolean` (true = die aktive Datei selbst ist die Quelle; `embed` ist dann immer `false`). Abwärtskompatibel.

### `src/img_to_md.ts` (reiner Kern) — Extension-Klassifikation
- **`classifySource(ext): "image" | "pdf" | null`** — reiner Helfer (DOM-/obsidian-frei, in Node testbar): `IMAGE_EXTS` → `"image"`, `"pdf"` → `"pdf"`, sonst `null`. Von `main.ts` importiert; `SUPPORTED_EXTS` entscheidet danach `supported`, analog Embeds.

### `src/main.ts` (Obsidian-Schicht)
- **`scan(sourcePath)`** verzweigt eingangs auf die per `classifySource(extOf(sourcePath))` ermittelte Klasse:
  - klassifiziert als `image`/`pdf` → **Selbst-Quelle-Zweig**: ein Item bauen
    - gemeinsam: `link = basename(sourcePath)`, `ext`, `existingTranscriptPath = findExistingTranscript(lookup, sourcePath) ?? undefined`, `embed:false`, `selfSource:true`, `raw:""`.
    - Bild: `kind:"image"`, `supported = SUPPORTED_EXTS.includes(ext.toLowerCase())`.
    - PDF: `kind:"pdf"`, `pageCount = pdfPageCount(readBinary(sourcePath))` (Fehler → 0), `supported = pageCount>0`, `range = {from:1, to: min(pageCount, pdfMaxPages) || 1}`.
  - sonst (`.md`) → bestehender Notiz-Scan (`findImageEmbeds`), unverändert.
  - alles andere (`.canvas`, …) fällt durch beide Zweige → leere Liste (wie heute).
- **`transcribeStream(sourcePath, item, …)`:** bei `item.selfSource` ist die Quelldatei `sourcePath` selbst — Bytes direkt via `vault.adapter.readBinary(sourcePath)` (PDF-Render bzw. Bild-Data-URL), **kein** `getFirstLinkpathDest`. Mobile-Scale-Limit und PDF-Render unverändert.
- **Ablageort:** bei Selbst-Quelle `destDir = app.fileManager.getNewFileParent(sourcePath).path` berechnen und an den Schreibpfad durchreichen.
- **`writeTranscripts`/`writePdf`-Deps:** das `selfSource`-Flag + `destDir` durchreichen (siehe §5).

### `src/img_to_md_view.ts`
- `renderList`: hat ein Item `selfSource:true`, rendere ein dezentes Label „{t(view.thisFile)}" an der Zeile (im Stil des `view.linked`-Badges aus Etappe 2) statt eines Embed/Link-Hinweises. Idempotenz-Badge („✓ vorhanden → öffnen") und Override-Hinweis unverändert.

### Reiner Kern (`img_to_md.ts` / `pdf_to_md.ts`) — additive, abwärtskompatible Parametrisierung
- `buildTranscriptNote` / `buildPdfNote`: `sourceName` → **optional**. Ist es `undefined`, entfällt die `source_note`-Zeile im Frontmatter (sonst unverändert).
- `transcriptNotePath(io, sourcePath, imagePath, kind, destDir?)`: optionaler `destDir` (Default wie bisher `dirOf(sourcePath)`).
- `writeTranscripts` / `writePdfTranscript`: optionales `opts?: { selfSource?: boolean; destDir?: string }`.

---

## 4. Datenfluss

```
User öffnet scan.pdf (kein Embed in einer Notiz)
  active-leaf-change → view.refresh() → scan("…/scan.pdf")

scan(sourcePath)
  ext = "pdf" → classifySource → "pdf"
  pageCount = pdfPageCount(readBinary(sourcePath))
  ImgItem{ raw:"", link:"scan.pdf", ext:"pdf", kind:"pdf", supported: pageCount>0,
           pageCount, range, existingTranscriptPath?, embed:false, selfSource:true }

renderList
  ohne Transkript → Checkbox default AN + Label „diese Datei"
  mit Transkript  → Checkbox default AUS + „✓ vorhanden → öffnen" + „diese Datei"

Transkribieren
  transcribeStream(sourcePath, item, …)
    item.selfSource → bytes = readBinary(sourcePath); PDF-Render / Bild-Data-URL
  writePdf(sourcePath, …, { selfSource:true, destDir:getNewFileParent(sourcePath).path })
    → notePath unter destDir, buildPdfNote(sourceName: undefined) (kein source_note)
    → KEIN replaceEmbed, Quelldatei unangetastet
```

---

## 5. Schreibpfad bei Selbst-Quelle

`writeTranscripts` (`img_to_md.ts`) und `writePdfTranscript` (`pdf_to_md.ts`) bekommen je ein optionales `opts: { selfSource?: boolean; destDir?: string }`.

- **`selfSource` gesetzt:**
  - **Ablageort:** `transcriptNotePath(io, sourcePath, imagePath, kind, opts.destDir)` → Notiz landet unter `destDir`. `imagePath = sourcePath` (für den Basename des Notiznamens, z.B. `scan Transkript.md`).
  - **`source_note` weglassen:** `buildTranscriptNote`/`buildPdfNote` mit `sourceName: undefined`.
  - **Kein Quell-Read/-Write:** der `before = readNote(sourcePath)`-Schritt (Bild-Pfad) und der `replaceEmbed`-Block (beide Pfade) werden übersprungen — die Quelldatei (Binär!) wird **nie** gelesen oder geschrieben. (Bei PDF schützt schon `embed:false`; beim Bild-Pfad ist der explizite Skip nötig, da `writeTranscripts` heute die Quelle immer einliest.)
  - **Override** (`existingTranscriptPath` → `overwritePath`): unverändert via `rewriteTranscript` — erhält das komplette Frontmatter der bestehenden Notiz (inkl. evtl. vorhandenem `source_note`), ersetzt nur `transcribed_by`/`pages`/Body. Kein Sonderfall nötig.
- **`selfSource` nicht gesetzt:** Verhalten exakt wie heute (Notiz- und Etappe-2-`embed:false`-Pfad unberührt).

**Frontmatter Selbst-Quelle (Beispiel PDF):**
```yaml
---
source_pdf: "[[scan.pdf]]"
created: 2026-06-25
transcribed_by: "<modell>"
pages: "1-3"
---
![[scan.pdf]]

<transkript>
```
Bild analog mit `source_image` (ohne `pages`). In beiden Fällen **kein** `source_note`.

---

## 6. i18n

Neuer Key (EN kanonisch + DE):
- `view.thisFile` = „this file" / „diese Datei"

---

## 7. Tests

**Reiner Kern (`img_to_md.ts` / `pdf_to_md.ts`, vitest, gefaktes IO):**
- `buildTranscriptNote` / `buildPdfNote` **ohne** `sourceName` → Frontmatter enthält **keine** `source_note`-Zeile; `source_image`/`source_pdf`, `created`, `transcribed_by` (PDF: `pages`) bleiben. Mit `sourceName` → unverändert (Regression).
- `transcriptNotePath` mit `destDir` → Pfad liegt unter `destDir`; ohne → `dirOf(sourcePath)` (Regression).
- `classifySource`: `png/jpg/…` → `"image"`, `pdf` → `"pdf"`, `md`/`canvas`/`""` → `null`.
- `writeTranscripts` / `writePdfTranscript` mit `opts.selfSource` (+ `destDir`): legt Notiz unter `destDir` an, **kein** `readNote`/`writeNote` auf `sourcePath`, **kein** `source_note`; Override mit `overwritePath` unverändert (erhält Frontmatter, ersetzt Body).
- ohne `opts`: bestehende Tests bleiben grün.

**View/main (`img_to_md_view.ts` + Scan-Logik, `makeFakeApp`):**
- `scan` auf PDF-Pfad → genau ein Item `selfSource:true, kind:"pdf"` mit `pageCount`/`supported`/`range`; auf Bild-Pfad → ein Item `selfSource:true, kind:"image"`; auf `.md` → bestehender Embed-Scan; auf `.canvas` → leere Liste.
- `existingTranscriptPath` wird gesetzt, wenn eine Notiz im Frontmatter auf die Datei zeigt → Checkbox default aus, „✓ vorhanden → öffnen".
- `renderList`: Item `selfSource:true` rendert das „diese Datei"-Label.

**Regression:** alle bestehenden 171 Tests grün; Etappe-2-`embed:false`-Pfad und Notiz-Pfad unberührt. `npx tsc --noEmit` + `npm run lint` (inkl. `eslint-plugin-obsidianmd`) sauber.

---

## 8. Risiken & offene Detailpunkte

- **`getNewFileParent`-API:** `@public @since 1.1.13` (verifiziert gegen `node_modules/obsidian/obsidian.d.ts`) < `minAppVersion 1.8.7` → **kein** Review-Bot-Blocker, **kein** `minAppVersion`-Bump.
- **Binärdatei nie als Text:** Der explizite Quell-Read-/Write-Skip im Bild-Pfad ist load-bearing — ohne ihn würde `writeTranscripts` die Bild-/PDF-Datei via `readNote(sourcePath)` als Text einlesen (verschwenderisch und fehleranfällig). Test deckt „kein `readNote`/`writeNote` auf `sourcePath`" ab.
- **Pfad-Identität für Idempotenz:** `findExistingTranscript(lookup, sourcePath)` braucht denselben absoluten Vault-Pfad, den auch `resolvedLinks`-Targets/`getFirstLinkpathDest` liefern — `sourcePath` (= `getActiveFile().path`) ist Obsidian-normalisiert, identisch.
- **Frontmatter-Wikilink `[[basename]]`:** Bei gleichnamigen Dateien in verschiedenen Ordnern ist der Shortlink mehrdeutig (Obsidian-Konvention, wie bei Embeds). Stream und Idempotenz nutzen den eindeutigen vollen `sourcePath`, nicht den Linktext — kein Funktionsrisiko, höchstens ein optisch mehrdeutiger Wikilink im Frontmatter.
- **Aktive Transkript-Notiz:** Öffnet man eine erzeugte Transkript-Notiz (`.md` mit `source_pdf`), greift der normale Notiz-Scan; ihr Body-Embed zeigt die Quelle als „✓ vorhanden" (Etappe-1-Verhalten). Kein Konflikt mit dem Selbst-Quelle-Zweig (der nur bei Nicht-`.md`-Dateien greift).
- **Cache-Timing:** wie Etappe 1 — beim allerersten Öffnen direkt nach Plugin-Start kann `resolvedLinks` unvollständig sein; on-demand-Scan beim Refresh wiederholt. Ein verpasster Treffer führt höchstens zu einem vermeidbaren Zweit-Transkript, nie zu Datenverlust.

---

## 9. Definition of Done

- [ ] `classifySource` + die optionalen Kern-Parameter (`sourceName?`, `destDir`, `opts.selfSource`) implementiert + getestet.
- [ ] `scan` liefert für aktive PDF/Bild-Dateien genau ein `selfSource`-Item (mit `pageCount`/`supported`/`range` für PDF); `.md` unverändert, sonstige Dateien leer.
- [ ] Transkription einer Selbst-Quelle legt die Notiz am `getNewFileParent`-Ort an, **ohne** `source_note`, **ohne** die Quelldatei zu lesen/schreiben; PDF-Seitenbereich greift.
- [ ] Idempotenz: erneut geöffnete Datei zeigt „✓ vorhanden → öffnen", Checkbox default aus; Override überschreibt die bestehende Notiz (Frontmatter erhalten).
- [ ] Notiz- und Etappe-2-Pfad unverändert; alle Alt-Tests grün; neue Tests grün; `tsc` + `eslint` sauber.
- [ ] Empirisch in Obsidian: PDF und Bild je ohne Quellnotiz öffnen → transkribieren → Notiz am erwarteten Ort, Quelldatei unangetastet; erneut öffnen → „vorhanden"; Override mit höherer Auflösung überschreibt.
