# Design: Diff-before-overwrite (Tier-2 #4, v1)

**Datum:** 2026-07-07
**Status:** Design (zur Review)
**Scope:** Tier-2 Feature #4 der Feature-Roadmap. **Nur das Sicherheitsnetz** (Diff anzeigen +
Bestätigen/Abbrechen). Inline-Edit ist bewusst **out-of-scope** (späterer eigener Zyklus, falls nötig).

## Kontext & Ziel

`image-to-markdown` ist strikt nicht-destruktiv — mit **einer** Ausnahme: der opt-in **Override**
(„bestehende Transkript-Notiz überschreiben"). Das ist die einzige Operation, die vorhandene
Nutzerdaten überschreibt. Aktuell passiert das ohne jede Vorschau: Haken setzen → transkribieren →
die alte Notiz ist weg.

**Ziel:** Vor genau dieser Überschreibung einen **Zeilen-Diff alt↔neu** in einem nativen Modal
zeigen und explizit bestätigen lassen. Sicherheitsnetz gegen versehentlichen Datenverlust (z. B.
Override versehentlich angehakt, oder das neue Transkript ist schlechter als das alte).

### Die zwei Überschreib-Pfade (Kern)

Beide sind symmetrisch: im `overwritePath`-Zweig wird die alte Notiz gelesen und via
`rewriteTranscript` neu geschrieben.

- **Bilder:** `writeTranscripts` (`src/img_to_md.ts:185`) — `e.overwritePath` → `readNote(old)` →
  `writeNote(overwritePath, rewriteTranscript(...))`.
- **PDFs:** `writePdfTranscript` (`src/pdf_to_md.ts:104`) — `overwritePath` → `readNote(old)` →
  `writeNote(overwritePath, rewriteTranscript(...))`.

### Scope-Grenze: nur der explizite Override

Es gibt einen **zweiten** Überschreib-Kontext, der NICHT gated wird: der **PDF-In-Session-Retry**
(eine fehlgeschlagene Seite wird nachgetragen, indem die Notiz, die das Plugin **in diesem Lauf
selbst** angelegt hat, erneut geschrieben wird — `writePdfGroup`, `img_to_md_view.ts:405`). Das ist
kein Datenverlust-Risiko, sondern die Fortsetzung eines laufenden Vorgangs. Der Diff-Gate greift
**ausschließlich** beim expliziten Override-Haken gegen eine vor dem Lauf existierende Notiz.

### Nicht in diesem Scope

Inline-Edit des neuen Texts vor dem Speichern · Diff beim In-Session-Retry · Diff/Confirm beim
Nicht-Override-Pfad (Neuanlage ist per Konstruktion nie destruktiv) · Wort-/Zeichen-Granularität
(Zeilen-Diff genügt).

## Ansatz

**Injizierter `confirmOverwrite`-Callback + pure `diffLines`** (gewählt gegen: Zwei-Phasen-Kern
dry-run/commit — Overengineering für einen Pfad; und Diff-Logik komplett in View/main — dupliziert
die Body-Bau-Logik des Kerns). Der gewählte Ansatz folgt dem etablierten Repo-Muster (reiner Kern +
injizierte I/O über `ImgToMdIO`): die Diff-Berechnung bleibt pure Kern-Logik, die einzige neue
obsidian-abhängige Komponente (das Modal) ist in einer eigenen Datei isoliert.

**Diff-Berechnung als Eigenbau, keine npm-Library** — konsistent mit der gerade abgeschlossenen
Dependency-Minimierung (`package.json` `dependencies` = nur noch `pdfjs-dist`); ein Zeilen-LCS ist
klein und gehört als pure Funktion in den Kern.

## Architektur & Komponenten

### Neues reines Modul `src/diff.ts` (obsidian-frei)

```ts
export type DiffLine = { kind: "ctx" | "add" | "del"; text: string };
export function diffLines(oldText: string, newText: string): DiffLine[];
```

- LCS-basierter Zeilen-Diff. Transkript-Bodies sind klein → O(n·m) unkritisch.
- Ausgabe: Sequenz aus `ctx` (unverändert), `del` (nur alt), `add` (nur neu).
- Voll unit-testbar, keine DOM-/obsidian-Abhängigkeit.

### Neuer pure Helper in `src/img_to_md.ts`

```ts
export function extractTranscriptBody(note: string): string;
```

- Strippt das `---…---`-Frontmatter und die führende `![[…]]`-Embed-Zeile, gibt den reinen
  Transkript-Text zurück. So difft der Nutzer **Inhalt gegen Inhalt** — die immer wechselnden
  Frontmatter-Felder (`transcribed_by`, `pages`) und die unveränderte Embed-Zeile sind Rauschen.
- Platziert nahe `rewriteTranscript` (das bereits Frontmatter via Regex parst) — konsistentes
  Notiz-Format-Wissen an einem Ort.

### `ImgToMdIO`-Erweiterung (`src/img_to_md.ts`)

```ts
confirmOverwrite?(ctx: { path: string; diff: DiffLine[] }): Promise<boolean>;
```

- **Optional** → kein Bestandstest bricht, Nicht-Override-Pfade bleiben unberührt.

### Einhak in beiden Kern-Schreibpfaden

Im `overwritePath`-Zweig von `writeTranscripts` und `writePdfTranscript`, nach `readNote(old)`,
**vor** `writeNote`:

```
if (overwritePath && confirm && io.confirmOverwrite) {
  const diff = diffLines(extractTranscriptBody(old), newBody);
  if (diff enthält kein add/del) {          // Body identisch
    // still schreiben (nur Frontmatter-Refresh, harmlos) — kein Modal
  } else if (!await io.confirmOverwrite({ path: overwritePath, diff })) {
    // Abbruch: NICHT schreiben, überspringen
  }
}
```

- `newBody` = der neue getrimmte Transkript-Text (Bild: `transcript`; PDF: der zusammengeführte
  Mehrseiten-Body vor dem `rewriteTranscript`-Aufruf).
- **Übersprungene Overrides zählen nicht als geschrieben:** Bild → kein Push in `paths`; PDF →
  `return { path: null }`. Die Karte bleibt „nicht written", der Nutzer kann erneut entscheiden.

### Scope-Steuerung: per-Aufruf-`confirm`-Flag (View steuert, Kern führt aus)

Der Kern kann „erster Override vs. In-Session-Retry" nicht unterscheiden — das entscheidet die
aufrufende Schicht:

- View-Dep-Signaturen (`ImgToMdViewDeps`) und die betroffenen Kern-Parameter bekommen ein
  `confirm`-Flag (Bild-Entry: `confirm?: boolean`; `writePdf(...)`: `confirm?` Parameter).
- Die View setzt `confirm = true` **nur** beim expliziten Override (existingTranscriptPath stammt
  aus dem Scan = Vor-Session).
- Nach dem ersten bestätigten Write markiert die View die Notiz als „session-owned" (Flag pro
  Karte/Gruppe); Folge-Retries laufen `confirm = false`. Damit greift der Gate exakt einmal, beim
  echten destruktiven Erst-Write.

### Neues `src/diff_modal.ts` (`extends Modal` — einzige neue obsidian-abhängige Datei)

- Konstruktor: `{ path, diff, onResolve }`.
- `onOpen`: Titel i18n „Overwrite {name}?" / „{name} überschreiben?"; Diff-Container: pro `DiffLine`
  ein `createDiv` mit Präfix-Klasse `img2md-diff-line` + `-add`/`-del`/`-ctx` und `+`/`-`/` `-Marker.
  **DOM nur via `createEl`/`createDiv`** (UI-STANDARD §2, kein `innerHTML`).
- Buttons: „Cancel" (default) + „Overwrite" (`mod-warning`). `onClose` ohne Wahl = Cancel
  (`resolve(false)`).
- `main.ts` implementiert `confirmOverwrite` = `new DiffModal(app, ...).open()`, resolved das Promise
  über den `onResolve`-Callback.

### CSS (`styles.css`)

`.img2md-diff-add`/`-del`/`-ctx` ausschließlich über Theme-Variablen (`--text-success`/
`--text-error`/`--text-muted` + dezente `--background-modifier-*`-Flächen), kein `!important`,
`img2md-`-Präfix (UI-STANDARD §3).

## Fehlerbehandlung & Edge-Cases

- **Kein Body-Unterschied** → kein Modal, still schreiben (nur Frontmatter-Refresh, harmlos).
- **Abbrechen** → alte Notiz unangetastet; Karte behält den neuen Text (nicht als written
  markiert); dezente `Notice` „Skipped"/„Übersprungen".
- **`confirmOverwrite` nicht gesetzt** (z. B. Tests) → Verhalten wie bisher (direkt schreiben).
- **PDF-Mehrseiten** → ein Diff über den zusammengeführten Body (inkl. Seitentrenner).
- **In-Session-Retry** (PDF) → `confirm = false` → Callback wird nicht aufgerufen, kein Modal.

## Teststrategie (vitest, TDD)

- **`diff.ts`** — `diffLines`: reine Additions, reine Löschungen, gemischt, identisch, leerer
  alt/neu-Text.
- **`img_to_md.ts`** — `extractTranscriptBody` (mit/ohne Frontmatter, mit Embed-Zeile);
  `writeTranscripts`-Override ruft `confirmOverwrite` und **schreibt bei `false` nicht** / schreibt
  bei `true`; `confirm=false` → kein Callback; identischer Body → kein Callback, schreibt.
- **`pdf_to_md.ts`** — `writePdfTranscript`-Override analog; `confirm=false` (Retry) → kein Callback.
- **`img_to_md_view.ts`** — ViewModel/Wiring: Override-Erst-Write setzt `confirm=true`, Folge-Retry
  `confirm=false` (session-owned).
- **i18n** — neue Keys EN/DE (Modal-Titel, Buttons, Notice), EN kanonisch, Paritätstest.
- **Modal** selbst = dünner Glue, ungetestet (konsistent mit main.ts-/View-Wirings); die
  **Geräte-Abnahme** ist der Backstop (Override → Diff sichtbar → Abbrechen erhält alte Notiz,
  Überschreiben ersetzt sie).

## Betroffene Dateien

| Datei | Änderung |
|---|---|
| `src/diff.ts` | **neu** — `diffLines` + `DiffLine` |
| `src/diff_modal.ts` | **neu** — `DiffModal extends Modal` |
| `src/img_to_md.ts` | `extractTranscriptBody`, `ImgToMdIO.confirmOverwrite?`, `confirm`-Flag + Gate in `writeTranscripts` |
| `src/pdf_to_md.ts` | `confirm`-Parameter + Gate in `writePdfTranscript` |
| `src/img_to_md_view.ts` | `confirm`-Flag in Dep-Signaturen, session-owned-Markierung, „Skipped"-Notice |
| `src/main.ts` | `confirmOverwrite`-Impl (öffnet `DiffModal`) |
| `src/i18n.ts` | Modal-/Notice-Keys EN/DE |
| `styles.css` | `.img2md-diff-*` |
| `tests/*` | diff, extractTranscriptBody, Override-Gates, View-Wiring, i18n-Parität |

## Bekannte Einschränkung — v1.1-Follow-up (2026-07-07)

Der finale Whole-Branch-Review (Opus) fand einen engen, bewusst für v1 akzeptierten Randfall:
`sessionOwned` (die Menge der in dieser Session vom Plugin geschriebenen Notizen, die den Diff-Gate
überspringen) gilt **view-global**, nicht pro Transkriptions-Lauf. Folge: Wird eine bereits
überschriebene Notiz N **manuell editiert** und danach **dieselbe Quelle in derselben View-Session
erneut transkribiert + geschrieben**, überspringt der Gate den Diff (N ist „session-owned") → die
manuellen Edits werden still überschrieben.

Entspricht dem v1-Design-Wortlaut, überschreitet aber die „nur In-Session-Retry"-Intent. **v1.1-Fix
(geplant):** content-aware Gate — statt nur den Pfad zu merken, den zuletzt vom Plugin geschriebenen
Inhalt je Pfad vorhalten (`Map<pfad, inhalt>`) und **re-gaten, wenn der on-disk-Inhalt davon
abweicht**. Dabei den reibungslosen PDF-Partial-Failure-Retry (mehrere Writes derselben Notiz in
einem Lauf) nachweislich nicht regressieren. Zusätzlich mitnehmen: CRLF-Diff-Fidelity in
`extractTranscriptBody` (Frontmatter/Embed-Strip `\r?\n`-tolerant, wie `stripFrontmatter`).
