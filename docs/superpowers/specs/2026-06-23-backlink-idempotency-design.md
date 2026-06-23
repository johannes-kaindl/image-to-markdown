# Design: Backlink-Idempotenz + Override (Slice 2, Etappe 1)

**Datum:** 2026-06-23
**Status:** Entwurf
**Scope:** Erkennen, ob für eine Quelle (Bild/PDF) bereits eine Transkript-Notiz existiert, und das in der Sidebar anzeigen — mit der Möglichkeit, das bestehende Transkript bewusst zu überschreiben („Override"). Fundament für die späteren Etappen (verlinkte Dateien, offene Datei als Quelle).

---

## 1. Motivation

Heute ist Idempotenz **implizit**: nach dem Transkribieren ersetzt `replaceEmbed` (`img_to_md.ts:52`) den `![[x]]`-Embed durch einen Embed der Transkript-Notiz → beim erneuten Scan wird die Quelle nicht mehr gefunden. Diese Mechanik trägt nur, solange die Quelle ein **Embed** ist, der ersetzt wird. Für die geplanten nächsten Etappen (reine Links bleiben im Text; offene Datei hat gar keine Quellnotiz) bricht sie weg.

Diese Etappe baut das **explizite, Backlink-basierte** Fundament: Eine Quelle gilt als „schon transkribiert", wenn eine Notiz existiert, die im **Frontmatter** `source_pdf`/`source_image` auf sie zeigt. Das wirkt sofort auch für heutige Embeds (z.B. dasselbe Bild in zwei Notizen, oder Re-Transkription aus der Transkript-Notiz heraus) und ist Voraussetzung für Etappe 2/3.

Zusätzlich: **Override** — ein bestehendes Transkript bewusst neu erzeugen (z.B. nachdem man eine zu niedrige Render-Auflösung oder ein zu kleines Modell bemerkt hat), wobei der **Text der bestehenden Notiz ersetzt** wird statt eine zweite anzulegen.

---

## 2. Scope

### Diese Etappe (1)
- Reine Erkennungs-Funktion `findExistingTranscript` (linearer `resolvedLinks`-Scan + Frontmatter-Bestätigung), app-frei testbar.
- `scan()` hängt `existingTranscriptPath?` an jedes Quell-Item.
- Sidebar zeigt Quellen mit vorhandenem Transkript als „✓ Transkript vorhanden → [öffnen]", Checkbox **standardmäßig aus**.
- **Override**: ein solches Item ankreuzen + transkribieren → die **bestehende** Transkript-Notiz wird überschrieben (`created` bleibt erhalten, `transcribed_by`/`pages` aktualisiert), **kein** Embed-Handling.

### Bewusst NICHT (spätere Etappen)
- **Etappe 2:** reine Links `[[x.pdf]]`/`[text](x.pdf)` erkennen (Regex auf optionales `!`, `mode`-Feld, Link im Text belassen, Frontmatter vom Scan ausschließen).
- **Etappe 3:** aktive Datei selbst (PDF/Bild) als Quelle, `getNewFileParent`-Notiz-Ort.
- **Nicht vorbauen:** invertierter Batch-Index/Cache, `metadataCache.on('resolved')`-Verdrahtung (on-demand-Scan beim Sidebar-Refresh reicht), Override via eigenem Button (opt-in via Checkbox genügt).

---

## 3. Architektur

### Neue Datei: `src/backlinks.ts` (reiner Kern)

App-frei, in Node testbar. Nimmt ein schmales Lookup-Interface (von der Obsidian-Schicht injiziert, analog `ImgToMdIO`):

```ts
export interface BacklinkLookup {
  /** Obsidian app.metadataCache.resolvedLinks: notePath → { targetPath → count }. */
  resolvedLinks: Record<string, Record<string, number>>;
  /** Frontmatter-Links einer Notiz (aus getFileCache(f).frontmatterLinks): { key, link }. */
  frontmatterLinks(notePath: string): { key: string; link: string }[];
  /** Wikilink → Zielpfad relativ zur Notiz (getFirstLinkpathDest). null wenn nicht auflösbar. */
  resolveLink(link: string, fromPath: string): string | null;
}

/** Pfad einer existierenden Transkript-Notiz für `sourcePath`, oder null.
 *  Eine Notiz zählt nur, wenn ihr Frontmatter source_pdf/source_image auf sourcePath zeigt —
 *  der resolvedLinks-Treffer allein genügt NICHT (die Transkript-Notiz embedet die Quelle auch
 *  im Body, würde sich sonst selbst/fremd fälschlich als Transkript zählen). */
export function findExistingTranscript(lookup: BacklinkLookup, sourcePath: string): string | null;
```

**Algorithmus:** über `resolvedLinks` iterieren; nur Notizen betrachten, deren Targets `sourcePath` enthalten; für jede deren `frontmatterLinks` prüfen, ob ein Key (Präfix vor erstem `.`, wegen Array-Keys wie `source_pdf.0`) `source_pdf`/`source_image` ist **und** `resolveLink(link, notePath) === sourcePath`. Erster Treffer gewinnt.

### `src/main.ts` (Obsidian-Schicht)
- `backlinkLookup(): BacklinkLookup` aus `app.metadataCache.resolvedLinks` / `getFileCache(f).frontmatterLinks` / `getFirstLinkpathDest`.
- `scan()` (`main.ts:81`): pro Item nach dem Resolve `existingTranscriptPath = findExistingTranscript(lookup, resolved.path)` setzen (für Bild und PDF). `resolvedLinks` benutzt absolute Vault-Pfade — derselbe Pfad wie `resolved.path`.
- `writePdf`/`writeTranscripts`-Deps: Override-Pfad durchreichen (siehe §5).

### `src/img_to_md_state.ts`
- `ImgItem` → `existingTranscriptPath?: string`.
- `setItems` (`:26`): Default-Selektion nur für `supported && !existingTranscriptPath` (vorhandene Transkripte sind default **aus** → Override ist opt-in). `toggle` bleibt unverändert (ankreuzbar, da supported).

### `src/img_to_md_view.ts`
- `renderList` (`:90`): hat ein Item `existingTranscriptPath`, rendere zusätzlich zum Namen einen Badge „✓ {t(view.transcriptExists)}" + einen klickbaren „→ {t(view.open)}"-Link (`deps.openPath(existingTranscriptPath)`), im Stil der bestehenden „angelegt"-Zeile (`:121-124`). Dezenter Hinweis-Titel „erneut transkribieren überschreibt". Checkbox bleibt aktiv (Override opt-in).

---

## 4. Datenfluss

```
scan(note)
  pro Embed → resolved.path
  existingTranscriptPath = findExistingTranscript(backlinkLookup, resolved.path)
  ImgItem{ …, existingTranscriptPath? }

renderList
  ohne Transkript → wie heute (Checkbox default an)
  mit Transkript  → Checkbox default AUS + "✓ vorhanden → öffnen" + Hinweis

Override (User kreuzt ein vorhandenes Item an + Transkribieren)
  startCards → Karte trägt item.existingTranscriptPath
  Schreiben  → entry.overwritePath = existingTranscriptPath
             → modify(overwritePath, note mit erhaltenem created)
             → KEIN replaceEmbed
```

---

## 5. Override-Schreibpfad

`writeTranscripts` (`img_to_md.ts:88`) und `writePdfTranscript` (`pdf_to_md.ts`) bekommen je Eintrag einen optionalen `overwritePath`.

- **`overwritePath` gesetzt (Override):** Inhalt via `io.readNote(overwritePath)` lesen → `created` extrahieren (Regex `^created: (.+)$`, Fallback `io.date()`) → neue Notiz mit `buildTranscriptNote`/`buildPdfNote` und diesem `created` bauen → `io.writeNote(overwritePath, …)` (überschreiben). **Kein** `replaceEmbed`, **kein** neuer Pfad, die Quellnotiz wird nicht angefasst.
- **`overwritePath` nicht gesetzt:** Verhalten exakt wie heute (`transcriptNotePath` → `createNote` → `replaceEmbed`).

`buildTranscriptNote` (`img_to_md.ts:35`) und `buildPdfNote` nehmen `created` bereits als Parameter — keine Signaturänderung dort. Neuer Helfer `extractCreated(noteContent): string | null` (rein, testbar).

Die View setzt `overwritePath = card.item.existingTranscriptPath` für Override-Karten beim Aufruf von `writeTranscripts`/`writePdf`.

---

## 6. i18n

Neue Keys (EN kanonisch + DE):
- `view.transcriptExists` = „Transcript exists" / „Transkript vorhanden"
- `view.open` = „open" / „öffnen"
- `view.overwriteHint` = „re-transcribing overwrites it" / „erneut transkribieren überschreibt"

---

## 7. Tests

**Reiner Kern (`backlinks.ts`, vitest, gefaktes Lookup):**
- `findExistingTranscript`: findet Notiz mit `source_pdf`→Quelle; ignoriert Notiz, die die Quelle nur im **Body** embedet (kein passender Frontmatter-Key) — der load-bearing Filter; behandelt Array-Key `source_pdf.0`; `null` wenn keine Notiz verweist; `source_image` analog; mehrere Verweise → erster Treffer.
- `extractCreated`: liest `created`-Zeile; Fallback `null` ohne Frontmatter/Feld.

**Override-Schreiblogik (`img_to_md.ts`/`pdf_to_md.ts`, gefaktes IO):**
- `writeTranscripts`/`writePdfTranscript` mit `overwritePath`: schreibt auf den vorhandenen Pfad (`writeNote`, kein `createNote`-Unique), erhält `created`, ersetzt **keinen** Embed in der Quelle.
- ohne `overwritePath`: bestehende Tests bleiben grün (Regressions-Schutz).

**State (`img_to_md_state.ts`):**
- `setItems`: Item mit `existingTranscriptPath` ist default **nicht** selektiert; ohne → selektiert (wie heute). `toggle` aktiviert es trotzdem (Override).

**View (`img_to_md_view.ts`, makeFakeApp):**
- Item mit `existingTranscriptPath` rendert den „vorhanden/öffnen"-Badge; Klick ruft `openPath` mit dem Transkript-Pfad; Checkbox default aus.

**Regression:** alle bestehenden Tests grün; `tsc` + `eslint` (inkl. `eslint-plugin-obsidianmd`) sauber. `findExistingTranscript`-APIs (`resolvedLinks`, `frontmatterLinks`, `getFirstLinkpathDest`) sind alle `@public` — der Community-Review-Bot flaggt nichts (verifiziert gegen `obsidian.d.ts`, alle `@since ≤ 1.4.0 < minAppVersion 1.8.7`).

---

## 8. Risiken & offene Detailpunkte

- **Frontmatter-Filter ist load-bearing:** Ohne ihn würde jede Notiz, die die Quelle im Body embedet (= jede Transkript-Notiz selbst), als Treffer zählen. Tests decken genau das ab.
- **Pfad-Identität:** `resolvedLinks`-Targets und `getFirstLinkpathDest(...).path` müssen denselben absoluten Vault-Pfad liefern (tun sie — beide Obsidian-normalisiert). In `scan` denselben `resolved.path` als `sourcePath` übergeben.
- **Cache-Timing:** Beim allerersten Sidebar-Öffnen direkt nach Plugin-Start kann `resolvedLinks` noch unvollständig sein. Akzeptabel: der Scan ist on-demand und wird bei `active-leaf-change`/Refresh wiederholt; ein verpasster Treffer führt höchstens zu einem vermeidbaren Zweit-Transkript, nicht zu Datenverlust. (Kein `on('resolved')` in dieser Etappe — YAGNI.)
- **Performance:** linearer Scan über `resolvedLinks` pro Item. Für eine aktive Notiz mit wenigen Quellen vernachlässigbar. Invertierter Index erst, wenn Etappe 2 mehrere Quellen pro Scan real macht.
- **`created`-Erhalt:** simpler Regex auf die `created:`-Zeile genügt (unser Frontmatter schreibt sie als erste Nicht-Quote-Zeile). Fremd-bearbeitete Notizen mit exotischem `created`-Format fallen auf `io.date()` zurück — unkritisch.
- **Override-Frontmatter `pages`:** beim PDF-Override wird `pages` aus dem neuen Lauf neu gesetzt (gewollt — der Bereich kann sich geändert haben).

---

## 9. Definition of Done

- [ ] `findExistingTranscript` + `extractCreated` rein implementiert + getestet (Frontmatter-Filter, Array-Key, Body-Embed-Ausschluss).
- [ ] `scan` setzt `existingTranscriptPath`; Sidebar zeigt „vorhanden → öffnen", Checkbox default aus.
- [ ] Override überschreibt die bestehende Notiz (created erhalten), legt keine zweite an, ersetzt keinen Embed.
- [ ] Bild-Transkription + PDF-Transkription (ohne Override) unverändert; alle Alt-Tests grün; neue Tests grün; `tsc`/`eslint` sauber.
- [ ] Empirisch in Obsidian: Bild zweimal eingebettet → zweite Notiz erkennt „vorhanden"; Transkript-Notiz öffnen → Quelle zeigt „vorhanden", Override mit höherer Auflösung überschreibt.
