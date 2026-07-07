# v1.1-Rest: Content-aware Gate + CRLF-Diff-Fidelity

Follow-up zu [`2026-07-07-diff-before-overwrite-design.md`](2026-07-07-diff-before-overwrite-design.md) (Tier-2 #4, v1, released 0.9.0). Löst den dort dokumentierten „Bekannte Einschränkung — v1.1-Follow-up"-Abschnitt auf.

## Kontext

v1 des Diff-before-overwrite-Gates markiert eine überschriebene Notiz nach dem ersten Write als `sessionOwned` (view-globales `Set<string>`) und überspringt den Diff-Dialog bei jedem weiteren Write derselben Notiz in derselben Session — gedacht für den reibungslosen PDF-Partial-Failure-Retry (mehrere Writes derselben Notiz in einem Lauf).

**Bug:** Wird eine bereits überschriebene Notiz N **manuell editiert** und danach dieselbe Quelle in derselben Session **erneut transkribiert + geschrieben**, überspringt der Gate den Diff (N ist „session-owned") → die manuellen Edits werden still überschrieben. Entspricht dem v1-Design-Wortlaut, überschreitet aber die „nur In-Session-Retry"-Intent.

Zusätzlich beim Review dieses Zyklus gefunden: zwei Regexes in `img_to_md.ts` sind nicht `\r?\n`-tolerant (anders als `stripFrontmatter`, die es bereits korrekt macht) — CRLF-Notizen verlieren dadurch Diff-Fidelity **und** im Override-Fall sogar Frontmatter-Felder (Datenverlust).

## Teil (a) — Content-aware Gate

**Ansatz (gewählt):** Content-Fingerprint statt mtime-Vergleich. Der Core liest `old` beim Override ohnehin schon (für den Diff) — ein Vergleich gegen den zuletzt bekannten Body braucht daher keine neue IO-Abhängigkeit und ist präzise (kein Zeitstempel-Granularitäts-Risiko, kein „Anfassen ohne inhaltliche Änderung"-Fehlalarm).

**Datenmodell.** `img_to_md_view.ts`: `sessionOwned: Set<string>` → `sessionOwned: Map<string, string>` (Pfad → zuletzt vom Plugin geschriebener Transkript-Body, exakt der `transcript`-String des letzten Writes). Lifetime unverändert: lebt für die gesamte View-Instanz, wird nie geleert (konsistent mit dem bisherigen `sessionOwned`-Set, entspricht der Spec-Intention „pro Session").

**Signaturänderung.** Der bisherige `confirm?: boolean` (in den Entries von `writeTranscripts` und im `opts` von `writePdfTranscript`) wird durch `knownBody?: string` ersetzt — die View reicht den gemerkten Body durch statt selbst zu entscheiden, ob gated wird.

**Core-Logik** (`writeTranscripts` in `img_to_md.ts`, spiegelnd in `writePdfTranscript` in `pdf_to_md.ts`):

```ts
const old = await io.readNote(e.overwritePath);
const alreadyMatches = e.knownBody !== undefined && extractTranscriptBody(old) === e.knownBody;
if (!alreadyMatches && io.confirmOverwrite) {
  const diff = diffLines(extractTranscriptBody(old), transcript);
  const changed = diff.some(d => d.kind !== "ctx");
  if (changed && !(await io.confirmOverwrite({ path: e.overwritePath, diff }))) {
    io.notify(t("notice.overwriteSkipped"));
    paths.push(null);
    continue;
  }
}
await io.writeNote(...);
```

- Erste Berührung einer vorbestehenden Notiz in der Session (`knownBody === undefined`) → `alreadyMatches` false → gated, wie in v1.
- PDF-Partial-Failure-Retry / erneuter Write derselben Notiz **ohne** externe Änderung → on-disk-Body entspricht dem gemerkten Body → `alreadyMatches` true → kein Dialog (keine Regression ggü. v1).
- Notiz wurde zwischen zwei Plugin-Writes **manuell editiert** → on-disk-Body weicht vom gemerkten Body ab → `alreadyMatches` false → re-gated; der Diff zeigt jetzt die manuellen Edits gegen die neue Transkription.

**View-Wiring.** Nach jedem erfolgreichen Write aktualisiert die View die Map mit dem gerade geschriebenen `transcript`-String (unabhängig davon, ob der Dialog erschien) — an allen drei Call-Sites (`writeOne`, `writeAll`, `writePdfGroup`), analog zum bisherigen `sessionOwned.add(created)`.

## Teil (b) — CRLF-Diff-Fidelity

Zwei Regexes in `img_to_md.ts` auf `\r?\n` umstellen (Angleichung an `stripFrontmatter`, Zeile 46, die es bereits korrekt macht):

- `extractTranscriptBody` (Zeile 107): `/^---\n[\s\S]*?\n---\n?/` → `/^---\r?\n[\s\S]*?\r?\n---\r?\n?/`
- `rewriteTranscript`s Frontmatter-Extraktion (Zeile 91): `/^---\n([\s\S]*?)\n---/` → `/^---\r?\n([\s\S]*?)\r?\n---/`

Der zweite Fix behebt einen eigenständigen Datenverlust-Bug (nicht nur Diff-Kosmetik): bei einer CRLF-Notiz matcht die alte Regex nicht, der Fallback greift und verwirft `source_image`/`source_note`/`created` beim Override komplett. Bewusst im selben Zug mitgenommen (gleiche Fehlerklasse, kleiner Zusatzaufwand), auf User-Entscheidung.

Kein weiterer verdeckter Fund: `grep` über `src/*.ts` nach `^---\n`/`^---\r`-Mustern bestätigt, dass dies die einzigen zwei nicht-tolerant gebliebenen Stellen sind.

## Betroffene Dateien

| Datei | Änderung |
|---|---|
| `src/img_to_md.ts` | `extractTranscriptBody`- und `rewriteTranscript`-Regex `\r?\n`-tolerant; `writeTranscripts`: `confirm?` → `knownBody?`, content-aware Gate-Logik |
| `src/pdf_to_md.ts` | `writePdfTranscript`: `opts.confirm?` → `opts.knownBody?`, spiegelnde Gate-Logik |
| `src/img_to_md_view.ts` | `sessionOwned: Set<string>` → `Map<string, string>`; `writeOne`/`writeAll`/`writePdfGroup` reichen `knownBody` statt `confirm` durch und aktualisieren die Map nach Write |
| `tests/*` | CRLF-Roundtrip (beide Regex-Stellen), Re-Gate nach simuliertem manuellem Edit (on-disk-Body ≠ knownBody), kein Re-Gate bei PDF-Retry-Continuation (on-disk-Body = knownBody), View-Wiring-Tests für die Map-Übergabe |

## Testing

TDD wie bei #4: reine Core-Funktionen (`extractTranscriptBody`, `rewriteTranscript`, `writeTranscripts`, `writePdfTranscript`) sind Node-testbar ohne Obsidian-Mock; View-Wiring-Tests (mit `tests/vendor/kit/obsidian-mock.ts`) decken die Map-Übergabe ab. Keine neuen obsidian-Importe, kein UI-Diff — Modal/Diff-Rendering unverändert.

## Out of Scope

- Persistenz der Content-Fingerprints über Plugin-Reload/View-Schließung hinaus (Spec-Intention ist ausdrücklich „pro Session").
- Zurücksetzen der Fingerprints bei `rescan()`/`active-leaf-change` (Konsistenz mit dem bestehenden `sessionOwned`-Lifecycle-Muster).
- Jede weitere CRLF-Stelle außerhalb der zwei identifizierten Regexes (per Grep verifiziert: keine weiteren vorhanden).
