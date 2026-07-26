# Spec: Vaultweite Frontmatter-Mapping-Migration (Phase 1b)

**Datum:** 2026-07-26
**Status:** Design freigegeben (Brainstorming), Plan ausstehend
**Baut auf:** #Konfigurierbares Frontmatter-Mapping (0.13.0) — [[2026-07-12-image-description-mode-design]] (führte `frontmatter_map.ts` ein)

## Problem & Motivation

Seit 0.13.0 lassen sich die Frontmatter-Keys der erzeugten Notizen (und die
`kind`-Diskriminator-Werte) an das eigene Vault-Schema anpassen (`src/frontmatter_map.ts`,
`FrontmatterMap`). Ändert man ein Mapping **nachträglich** — z. B. `kind` → `type` oder
`source_image` → `quelle` —, behalten **bestehende** Notizen ihre **alten** Keys.

Das ist nicht kosmetisch: `sourceImage`, `sourcePdf`, `kindKey`, `kindTranscript` und
`kindDescription` sind **load-bearing** für die Backlink-Idempotenz (`findExistingTranscript`
/ `findExistingDescription` in `src/backlinks.ts`, siehe `findByKind` — filtert Notizen über
`map.sourcePdf`/`map.sourceImage` und diskriminiert über `map.kindKey`/`map.kindDescription`).
Driften die Keys auf der Platte vom aktiven Mapping ab, wird eine alte Notiz **nicht mehr als
„vorhanden" erkannt** → eine erneute Transkription legt eine **Dublette** an, statt die
bestehende Notiz zu erkennen/überschreiben.

Der Code kennt die Lücke bereits: `frontmatter_map.ts` (Kommentar) und `settings.fmMap.desc`
(i18n) verweisen ausdrücklich auf „Phase 1b liefert die vaultweite Migration".

**Ziel:** Beim nachträglichen Ändern eines Mappings die Keys in **bestehenden** i2m-Notizen
sicher vom alten aufs neue Mapping umschreiben — mit Vorschau und doppelter Bestätigung,
nicht-destruktiv, idempotent.

## Scope-Entscheidungen (Brainstorming 2026-07-26)

| # | Frage | Entscheidung |
|---|-------|--------------|
| 1 | Auslöser | **Beim Ändern anbieten** — ändert man ein FM-Feld im Settings-Tab und committet (blur), erkennt das Plugin die Änderung sofort. `alt→neu` ist damit **exakt** bekannt (kein Raten des Alt-Mappings). |
| 2 | Vorschau-Format | **Diff pro Notiz** — Wiederverwendung des bewährten `diff.ts`/`diff_modal.ts`-Renderings: pro betroffener Notiz ein Vorher/Nachher der Frontmatter-Zeilen, scrollbar; Kopf zeigt `alt → neu` je Key. |
| 3 | Verhalten bei Abbruch | **Drei-Wege-Dialog** — „Migrieren & anwenden" · „Ohne Migration anwenden" (Eskalations-Ausstieg mit Dubletten-Warnung) · „Abbrechen" (Änderung verfällt, Feld springt zurück). |
| 4 | Teilerfolg | **Best-effort + Bericht** — über einzelne Schreibfehler hinweggehen, am Ende „N migriert · M fehlgeschlagen · K Konflikte" berichten. Sicher wiederholbar dank Idempotenz. |

## Architektur

Folgt dem Pure-Core-Muster des Plugins (reiner, obsidian-freier Kern + dünne Obsidian-Schicht
mit injizierter IO; PROF-OBS-03/04).

### Reines Modul `src/fm_migration.ts` (obsidian-frei, voll unit-testbar)

- **`diffMappings(oldMap: FrontmatterMap, newMap: FrontmatterMap): MappingChange[]`**
  Liefert die Felder, in denen sich **Key oder Wert** unterscheiden
  (`{ field: keyof FrontmatterMap, from: string, to: string }`). Basis für den Vorschau-Kopf
  und für die „gibt es überhaupt etwas zu tun?"-Entscheidung (leer → No-op).

- **`isI2mNote(content: string, oldMap: FrontmatterMap): boolean`**
  Fingerabdruck einer i2m-erzeugten Notiz gegen das **alte** Mapping: die Notiz hat den alten
  `sourceImage`- **oder** `sourcePdf`-Key **und** (kein alter `kindKey` vorhanden **oder**
  dessen Wert ∈ {alt `kindTranscript`, alt `kindDescription`}). Das ist exakt die Signatur, die
  `buildTranscriptNote`/`buildDescriptionNote` schreiben — schließt handgemachte Fremdnotizen
  zuverlässig aus.

- **`migrateNoteFrontmatter(content: string, oldMap: FrontmatterMap, newMap: FrontmatterMap): MigrationResult`**
  mit `MigrationResult = { changed: boolean; next: string; conflict: boolean }`.
  Schreibt die Frontmatter **einer** Notiz in **einem einzigen Durchgang** um:
  - **CRLF-tolerant** (`\r?\n`, analog `stripFrontmatter`/`rewriteTranscript`).
  - **Ein-Durchgang, nicht sequenziell:** die Zeilen werden einmal geparst und gegen eine
    `alt-Key → neu-Key`-Abbildung transformiert — **kein** kaskadierendes Text-Replace (das
    würde verkettete Umbenennungen wie `a→b, b→c` doppelt anwenden).
  - **Fremde Keys unangetastet** (Zeilen, deren Key in keinem `oldMap`-Feld vorkommt, bleiben
    zeichengenau erhalten — inkl. Werte, Quoting, Wikilinks, Kommentare).
  - **Body unangetastet** (nur der `---…---`-Block wird berührt).

### Obsidian-Schicht (dünn)

Scannt `app.vault.getMarkdownFiles()`, liest jede Datei, filtert per `isI2mNote(…, oldMap)`,
ruft `migrateNoteFrontmatter` und sammelt `{ file, old, next }` für alle mit `changed === true`
(sowie die `conflict === true`-Fälle separat). Öffnet das Migrations-Modal mit der
Diff-pro-Notiz-Vorschau. Auf Bestätigung: best-effort `vault.modify` je Datei.

### Settings-Glue (`src/settings.ts`)

**Vorbedingung — blur-Commit statt `onChange`:** Die FM-Felder speichern heute **pro
`onChange`** (jeder Tastendruck ruft `saveSettings`). Für die Migration braucht es einen
**diskreten Commit-Moment** — sonst feuerte die Rückfrage mitten im Tippen. Die Felder werden
deshalb auf **blur-Commit** umgestellt, exakt nach dem bestehenden Muster der Endpoint-Liste
(`applyEndpointEdit`, dessen Kommentar genau diese „einmal bei blur, nicht pro onChange"-
Begründung trägt). Während des Tippens wird nichts gespeichert; erst beim Verlassen des Feldes
wird der Wert übernommen und die Migrations-Entscheidung ausgelöst.

Beim blur-Commit wird das **zuletzt gespeicherte** Mapping als `oldMap` festgehalten und das
Kandidaten-`newMap` gebildet; sind sie gleich → No-op. Sonst Scan + Modal (siehe UX-Fluss).
Erst die gewählte Aktion entscheidet, ob `newMap` gespeichert wird — der `onChange`-Autosave
entfällt für diese Felder.

## Migrations-Semantik

- **Key-Umbenennungen** (10 Felder: `sourceImage`, `sourcePdf`, `sourceNote`, `category`,
  `tags`, `authorTranscribed`, `authorDescribed`, `created`, `pages`, `kindKey`): die
  Frontmatter-Zeile `oldKey: …` wird zu `newKey: …`; der Rest der Zeile bleibt 1:1.
- **Wert-Umbenennungen** (`kindTranscript`, `kindDescription`): die `kind`-Zeile erhält den
  neuen Wert, wenn ihr alter Wert dem alten Diskriminator entspricht — **gemeinsam** mit einer
  etwaigen `kindKey`-Umbenennung **auf derselben Zeile in einem Schritt**.
- **Nur Felder mit alt≠neu** werden angefasst (chirurgisch und vollständig zugleich).
- **Nur vorhandene Zeilen** werden umgeschrieben (`pages`/`category`/`tags` sind in
  `buildDescriptionNote`/`rewriteTranscript` bedingt und fehlen ggf.).
- **Kollisions-Schutz (Sicherheits-Kante):** soll `oldKey`→`newKey` umbenannt werden, die Notiz
  hat `newKey` aber **bereits** als (fremden oder anderen) Key → `conflict: true`, die Notiz
  wird **nicht** verändert (kein doppelter Key = keine Datenkorruption) und im Bericht als
  „übersprungen (Konflikt)" geführt.

## UX-Fluss

1. FM-Key im Settings-Tab ändern und Feld committen (blur).
2. `oldMap` (zuletzt gespeichert) vs. `newMap` (Kandidat). Gleich → No-op.
3. Vault-Scan → Liste betroffener i2m-Notizen mit Vorher/Nachher (+ Konflikt-Liste).
4. **0 betroffene Notizen** → `newMap` wird **stumm** gespeichert (kein Dialog).
5. **≥1 betroffen** → **Migrations-Modal** mit Diff-pro-Notiz-Vorschau (scrollbar; Kopf
   `alt → neu` je Key; Konflikt-Notizen erkennbar markiert). Drei Aktionen:
   - **„Migrieren & anwenden"** → zweite Bestätigung (siehe 6) → `newMap` speichern +
     best-effort-Sweep + Bericht.
   - **„Ohne Migration anwenden"** → `newMap` speichern, Warn-Notice („N Notizen tragen weiter
     die alten Keys und werden nicht mehr als vorhanden erkannt — Dubletten-Risiko"). Bewusster
     Eskalations-Ausstieg; **kein** Über-Versprechen einer bequemen späteren Migration (siehe
     Hinweis unten), da das Plugin das dann abgedriftete Alt-Mapping nicht mehr kennt.
   - **„Abbrechen"** → Feld springt auf `oldMap` zurück, nichts gespeichert.
6. **Zweite Bestätigung** direkt vor dem Schreiben („N Notizen werden umgeschrieben.
   Fortfahren?") — die geforderte doppelte Bestätigung.

## Fehlerbehandlung & Idempotenz

- **Best-effort:** jeder `vault.modify` in try/catch; ein Fehler stoppt den Sweep nicht.
- **Abschlussbericht** (Notice + `console` für Details): „N migriert · M fehlgeschlagen ·
  K Konflikte übersprungen" mit Dateiliste je Kategorie.
- **Idempotent:** ein erneuter Lauf scannt frisch — bereits migrierte Notizen matchen den
  **alten** Fingerabdruck nicht mehr → fallen aus der Menge → nur Fehlgeschlagene/neu
  Betroffene bleiben. Zweimaliges Anwenden derselben Migration = No-op.
- **Nicht-destruktiv bei Unerwartetem:** Notizen ohne Frontmatter, ohne alten Fingerabdruck
  oder mit Kollision werden **nie** angefasst.

## Tests

- **`fm_migration.ts` voll unit-getestet:**
  - `diffMappings` — Key-Diff, Wert-Diff, leeres Ergebnis bei Gleichheit.
  - `migrateNoteFrontmatter` — LF **und** CRLF; fremde Keys zeichengenau erhalten;
    `kind`-Wert-Umbenennung; kombinierte `kindKey`+`kind`-Wert-Änderung auf einer Zeile;
    verkettete Umbenennung `a→b, b→c` in einem Durchgang (keine Doppelanwendung); quotierte
    Werte + Wikilink-Werte; bedingt fehlende Zeilen (`pages`/`category`/`tags`); Kollision →
    `conflict`, Inhalt unverändert; **Idempotenz** (zweimal anwenden = No-op); Notiz ohne
    Frontmatter unverändert.
  - `isI2mNote` — Transkript/Beschreibung/PDF erkannt; Fremdnotiz + Notiz ohne Frontmatter
    abgelehnt.
- **Obsidian-Schicht** (Modal, Vault-Sweep, Settings-Glue) dünn gehalten, mit injizierter IO
  wo sinnvoll getestet.
- **Geräte-Abnahme** als Backstop für die reale GUI **und** ein **Opus-Whole-Branch-Review**
  vor dem Merge (Massen-Datei-Operation = höchstes Datenverlust-Risiko im Projekt).

## Bewusst out-of-scope (dieser Zyklus)

- **Kein `processFrontMatter`** — steht im Projekt bewusst auf der Verworfen-Liste; der
  String-Template-/Zeilen-Ansatz erhält Formatierung und fremde Keys zeichengenau.
- **Kein Standalone-Befehl / keine Alt-Mapping-Erkennung pro Notiz** — der Auslöser ist
  ausschließlich das Ändern in den Einstellungen (exaktes `alt→neu`). Ein späterer Zyklus
  könnte einen manuellen „Migrieren"-Befehl mit Erkennung ergänzen, falls je nötig.
- **„Ohne Migration anwenden" ist ein Einweg-Ausstieg** — wählt man ihn, driften Settings
  (`newMap`) und Platte (`oldMap`) bewusst auseinander; das Plugin hält das Alt-Mapping danach
  **nicht** vor, also gibt es in diesem Zyklus keinen bequemen „doch noch migrieren"-Pfad
  (das bräuchte die oben ausgeschlossene Alt-Mapping-Erkennung bzw. einen persistierten
  `pendingMigrationFrom`-Schnappschuss). Der empfohlene Pfad bleibt klar „Migrieren & anwenden".
- **Kein Rollback / keine Transaktion** — in Obsidian nicht sicher machbar; Idempotenz +
  Bericht sind der robuste Ersatz.
- **Kein Umbenennen von Notiz-Dateinamen oder Body-Inhalten** — nur Frontmatter-Keys/-Werte.
