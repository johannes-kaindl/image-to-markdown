# Design: Verlinkte Quellen — Link bleibt erhalten (Slice 2, Etappe 2)

**Datum:** 2026-06-23
**Status:** Entwurf
**Scope:** Zusätzlich zu eingebetteten Bildern/PDFs (`![[x.pdf]]`) auch **reine Links** (`[[x.pdf]]`, `[text](x.pdf)` ohne `!`) als transkribierbare Quelle erkennen — dabei den Link im Quelltext **belassen** (nicht durch ein Transkript-Embed ersetzen). Baut auf Etappe 1 (Backlink-Idempotenz) auf, die die Re-Transkriptions-Schleife für belassene Links verhindert.

---

## 1. Motivation

Heute erkennt `findImageEmbeds` (`img_to_md.ts:22`) nur **Embeds** — die Regexe erzwingen ein führendes `!`. Ein reiner Link auf ein PDF/Bild (`[[scan.pdf]]`, `[Vertrag](scan.pdf)`) wird nicht als Quelle angeboten.

Ein reiner Link ist aber semantisch anders als ein Embed: Der Embed ist ein **Platzhalter** für den Datei-Inhalt (deshalb darf er durch das Transkript ersetzt werden); ein reiner Link ist ein **bewusster Verweis im Fließtext** („siehe [[scan.pdf]]"). Ihn durch ein Transkript-Embed zu ersetzen, würde den Satz zerstören.

Deshalb: reine Links erkennen, transkribieren, aber **den Link unangetastet lassen**. Die Quellnotiz wird nicht verändert; es entsteht nur die separate Transkript-Notiz. Wiederauffinden und Idempotenz laufen über die in Etappe 1 gebaute Backlink-Erkennung (`existingTranscriptPath` → Sidebar „✓ vorhanden → öffnen"). Ohne diese Etappe-1-Vorbedingung würde der im Text verbleibende Link bei jedem Scan erneut „transkribieren" anbieten (Re-Transkriptions-Schleife).

---

## 2. Geklärte Design-Entscheidungen

1. **Typ-abhängiges Festverhalten, kein Setting.** `![[x]]` (Embed) → ersetzen (heute, unverändert). `[[x]]`/`[text](x)` (reiner Link) → **unberührt lassen**. Keine Konfiguration (YAGNI; hält die Settings schlank und die Nicht-Destruktivitäts-Linie klar).
2. **Scope = Symmetrie zum Embed-Scan.** Dieselben vier Formen — Wikilink + Markdown-Link, je Bild *und* PDF — nur ohne erzwungenes `!`. Externe URLs (`http(s)://`) bleiben ausgeschlossen. Der Extension-Filter verwirft Nicht-Bild/PDF-Ziele (`[text](note.md)`, `[#heading]`) automatisch.
3. **Seitenangabe** `[[x.pdf#page=3]]` wird wie beim Embed behandelt (`pageOf()`, Seite in der Sidebar vorbelegt).
4. **Frontmatter-Loop-Schutz.** Der Scan überspringt den führenden YAML-Frontmatter-Block, damit `source_pdf: "[[x.pdf]]"` / `source_note: "[[…]]"` einer Transkript-Notiz nicht als verlinkte Quelle erkannt wird (der „`source_pdf`-Loop").
5. **UI:** Link-Items tragen einen dezenten Badge **„linked"** (Stil wie der „✓ vorhanden"-Badge), damit sichtbar ist, dass *diese* Quelle die Notiz nicht verändert.
6. **Kein neues Frontmatter-Feld.** Die Embed/Link-Unterscheidung lebt nur als internes `embed: boolean` in `ImageEmbed`/`ImgItem` und steuert, ob `replaceEmbed` läuft. (Etappe 3 kann bei Bedarf nachrüsten.)

### Bewusst NICHT (bleibt Etappe 3)
- Die **aktive Datei selbst** (PDF/Bild ohne Quellnotiz) als Quelle, `getNewFileParent`-Notizort, `source_note` konditional weglassen.

---

## 3. Architektur

Ein neues Flag `embed: boolean` reist durch die ganze Kette. `true` = Embed (heutiges Verhalten), `false` = reiner Link (neu: Link bleibt). Der **Override**-Pfad (Etappe 1, `overwritePath`) bleibt davon unabhängig — siehe die drei Write-Zweige in §5.

### `src/img_to_md.ts` — Erkennung
- `ImageEmbed` (`:7`) bekommt `embed: boolean`. (Der Typname bleibt aus Kompatibilität; ein Kommentar stellt klar, dass er nun auch reine Links umfasst.)
- `findImageEmbeds` (`:22`): optionales `!` als Capture-Group.
  - Wikilink: `/(!?)\[\[([^\]]+?)\]\]/g` → `embed = m[1] === "!"`.
  - Markdown: `/(!?)\[[^\]]*\]\(([^)]+?)\)/g` → `embed = m[1] === "!"`.
  - Beide Regexe überlappen nicht (`![[x]]` matcht nur die Wikilink-Regex; `[text](x)` nur die Markdown-Regex). Der gleiche `https?://`-Ausschluss und der Extension-/`kind`-Split bleiben unverändert.
- **`stripFrontmatter(content): string`** (neuer reiner Helfer): entfernt einen führenden YAML-Block (`^---\n … \n---\n`); ohne Frontmatter unverändert. `findImageEmbeds` ruft `stripFrontmatter` **intern als ersten Schritt** auf und scannt nur den Body — so kann der Loop-Schutz nicht vergessen werden und wird direkt von den `findImageEmbeds`-Tests abgedeckt. Aufrufer (`scan()`) übergeben weiterhin den vollen `content`.
  - *Hinweis Offset:* `findImageEmbeds` gibt keine String-Offsets zurück (Ersetzung läuft über `content.split(raw).join(...)` in `replaceEmbed` auf dem **vollen** `content`), daher ist der interne Frontmatter-Schnitt rein scan-lokal und beeinflusst die spätere Ersetzung nicht.

### `src/img_to_md_state.ts` — State
- `ImgItem` (`:3`) bekommt `embed: boolean`.
- `setItems`/Default-Selektion (`:36`) unverändert: `supported && !existingTranscriptPath` — gilt für Embed wie Link gleichermaßen.

### `src/main.ts` — Scan-Verdrahtung
- `scan()` (`:96`) reicht `e.embed` in jedes `ImgItem` durch. Sonst unverändert (inkl. `existingTranscriptPath` aus Etappe 1).

### `src/img_to_md_view.ts` — View
- `renderList` (`:91`): hat ein Item `embed === false`, rendere einen dezenten Badge `t(view.linked)` (Stil wie der „✓ vorhanden"-Badge `:124`). Checkbox-/Auswahl-Logik unverändert.

### `src/pdf_to_md.ts` — PDF-Write
- `writePdfTranscript` reicht `embed` durch und unterdrückt `replaceEmbed` bei `embed === false` (siehe §5).

---

## 4. Datenfluss

```
scan(note)
  findImageEmbeds(content)            // strippt intern den Frontmatter-Block
    → { raw, link, ext, kind, page?, embed }
  pro Treffer → resolved.path → existingTranscriptPath (Etappe 1)
  ImgItem{ …, embed }

renderList
  embed === true   → wie heute
  embed === false  → zusätzlich Badge „linked"

Transkribieren + Schreiben → §5
```

---

## 5. Schreibpfad — drei Zweige

`writeTranscripts` (`img_to_md.ts:122`) und `writePdfTranscript` (`pdf_to_md.ts:55`) verzweigen pro Eintrag in genau drei Fälle:

1. **`overwritePath` gesetzt (Override, Etappe 1):** `rewriteTranscript` auf den bestehenden Pfad, **kein** `replaceEmbed`, Quellnotiz unangetastet. *(unverändert)*
2. **`embed === true` (Embed):** neue Notiz via `createNote` + `replaceEmbed(content, raw, basename)` — der Embed wird durch `![[Transkript]]` ersetzt. *(heutiges Verhalten)*
3. **`embed === false` (reiner Link, NEU):** neue Notiz via `createNote`, **kein** `replaceEmbed`. Die Quellnotiz wird nicht geschrieben (kein `io.writeNote(sourcePath, …)`). Der Link bleibt exakt erhalten.

Fall 3 ist **nicht** der Override-Fall: Es entsteht eine *neue* Transkript-Notiz (kein `overwritePath`), nur ohne Quelltext-Ersetzung. Das Transkript-Frontmatter (`source_image`/`source_pdf`/`source_note`) wird wie gehabt geschrieben — dadurch greift die Etappe-1-Idempotenz beim nächsten Scan (das Item erscheint dann als „✓ vorhanden").

**Durchreichen von `embed`:** Die View setzt `entry.embed = card.item.embed` beim Aufruf von `writeTranscripts`/`writePdfTranscript` — analog dazu, wie sie in Etappe 1 `overwritePath = item.existingTranscriptPath` für Override-Karten reicht. Default (`embed` fehlt/`undefined`) wird als `true` behandelt, damit Bestandsaufrufe und Alt-Tests unverändert das Embed-Verhalten zeigen.

**PDF-Besonderheit:** `writePdfTranscript` schreibt die Quellnotiz heute nur, wenn `replaced !== before` (`pdf_to_md.ts:83`). Bei `embed === false` wird `replaceEmbed` gar nicht erst aufgerufen und die Quellnotiz nicht angefasst.

---

## 6. i18n

Ein neuer Key (EN kanonisch + DE):
- `view.linked` = „linked" / „verlinkt"

---

## 7. Tests

**Reiner Kern (`img_to_md.ts`, vitest):**
- `findImageEmbeds`:
  - `[[scan.pdf]]` → `embed:false`, `kind:"pdf"`; `![[scan.pdf]]` → `embed:true`.
  - `[Vertrag](scan.pdf)` → `embed:false`; `![alt](img.png)` → `embed:true`, `kind:"image"`.
  - `[[doc.pdf#page=3]]` (Link) → `page:3`, `embed:false`.
  - externe URL `[x](https://e.com/a.pdf)` → nicht erfasst; `[note](other.md)` → nicht erfasst (Extension-Filter).
  - gemischter Inhalt mit Embed **und** Link derselben Datei → zwei Treffer mit korrektem `embed`.
- `stripFrontmatter`: entfernt führenden `---…---`-Block; lässt Inhalt ohne Frontmatter unverändert; ein `[[x.pdf]]` **im** Frontmatter (`source_pdf: "[[x.pdf]]"`) wird nach dem Strippen **nicht** mehr gefunden (Loop-Schutz).

**Write-Logik (`img_to_md.ts`/`pdf_to_md.ts`, gefaktes IO):**
- `writeTranscripts` mit `embed:false` → `createNote` wird aufgerufen, `io.writeNote(sourcePath, …)` **nicht** (kein `replaceEmbed`); Transkript-Frontmatter enthält `source_image`.
- `writeTranscripts` mit `embed:true` → wie heute (`replaceEmbed`, Quellnotiz geschrieben). *(Regression)*
- `writePdfTranscript` analog für `embed:false` / `embed:true`.
- Override (`overwritePath`) mit `embed` beliebig → Verhalten wie Etappe 1 (Override gewinnt, kein `replaceEmbed`). *(Regression)*

**State (`img_to_md_state.ts`):** `ImgItem` mit `embed:false` ist regulär selektierbar; Default-Selektion unverändert (`supported && !existingTranscriptPath`).

**View (`img_to_md_view.ts`, makeFakeApp):** Item mit `embed:false` rendert den „linked"-Badge; `embed:true` nicht.

**Regression:** alle bestehenden Tests grün; `tsc --noEmit` + `eslint` (inkl. `eslint-plugin-obsidianmd`) sauber.

---

## 8. Risiken & offene Detailpunkte

- **Regex-Disjunktheit:** `![[x]]` und `[[x]]` dürfen nicht doppelt matchen. Die Wikilink-Regex konsumiert das `!` mit (`(!?)\[\[`), sodass pro Stelle genau ein Treffer entsteht. Test deckt gemischten Inhalt ab.
- **Frontmatter-Schnitt vs. Ersetzung:** `stripFrontmatter` wirkt nur auf den **Scan**. `replaceEmbed` arbeitet weiter auf dem vollen `content` (über `split/join` auf `raw`), ist also vom Schnitt unberührt. Da Embeds praktisch nie im Frontmatter stehen, entsteht kein Ersetzungs-Konflikt.
- **Reiner Link im Frontmatter einer *normalen* Notiz:** theoretisch könnte ein Nutzer `cover: "[[bild.png]]"` im Frontmatter haben. Durch den Frontmatter-Schnitt wird dieses bewusst **nicht** als Quelle angeboten — akzeptabel und konsistent mit dem Loop-Schutz.
- **Idempotenz hängt an Etappe 1:** Der belassene Link wird beim nächsten Scan erneut gefunden; erst der `existingTranscriptPath`-Check macht ihn zu „✓ vorhanden" (default abgewählt). Etappe 1 ist die harte Vorbedingung (erfüllt).
- **Markdown-Link mit Leerzeichen/Anker im Pfad:** der bestehende `link`-Cleaner (Strip von `#…`/`|…`/Whitespace) gilt unverändert auch für Links.

---

## 9. Definition of Done

- [ ] `findImageEmbeds` erkennt Embeds **und** reine Links (Wikilink + Markdown, Bild + PDF) mit korrektem `embed`-Flag; externe URLs/Nicht-Medien ausgeschlossen; `#page=N` respektiert.
- [ ] `stripFrontmatter` implementiert + getestet; Frontmatter-Links werden nicht als Quelle erkannt (Loop-Schutz).
- [ ] Schreibpfad: `embed:false` legt eine neue Transkript-Notiz an **ohne** `replaceEmbed` und **ohne** Quellnotiz-Schreibung; `embed:true` und Override unverändert.
- [ ] Sidebar zeigt für Link-Items den „linked"-Badge; Auswahl/Default unverändert.
- [ ] Alle Alt-Tests grün; neue Tests grün; `tsc`/`eslint` sauber.
- [ ] Empirisch in Obsidian: Notiz mit `[[scan.pdf]]` (reiner Link) → transkribieren → Link bleibt im Text, neue Transkript-Notiz entsteht, beim Re-Scan „✓ vorhanden"; Notiz mit `![[scan.pdf]]` (Embed) → unverändertes Ersetzungs-Verhalten.
