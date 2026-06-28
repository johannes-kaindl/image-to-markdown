# Spec — Integritäts-Paket (0.6.1): PDF-Partial-Failure-Recovery + Error-Surfacing

Zwei verifizierte Befunde aus der Gap-Analyse (2026-06-28). Beide pure-core, offline,
nicht-destruktiv. Ziel: das Kernversprechen „das Transkript entspricht der Quelle" härten.

## Feature A — HTTP-200-mit-Error-Body erkennen (#2, S)

**Problem (verifiziert):** Lokale OpenAI-kompatible Server (LM Studio) antworten auf manche Fehler
mit **HTTP 200 + `{error:{message}}`**. `transcribe` prüft nur `res.ok`, liest dann
`choices[0].message.content ?? ""` → leer → `setDone` kollabiert das zu generischem
`core.emptyTranscript`; die echte Servermeldung geht verloren. Streaming: 200 ohne `data:`-Zeilen →
`parseSSE` liefert leer, kein Fehler.

**Lösung:** Reine Funktion `parseErrorEnvelope(text): string | null` (obsidian-frei, unit-testbar wie
`parseSSE`):
- erkennt `{error:{message}}`, `{error:"…"}`; ohne `choices` zusätzlich `{detail}`/`{message}`;
- gibt die getrimmte Meldung zurück, sonst `null` (auch bei Nicht-JSON/HTML, valider Completion).

Verdrahtung:
- `transcribe`: Envelope vor/nach JSON-Parse prüfen. Bei `!res.ok` → `throw envelope ?? "Vision HTTP {status}"`.
  Bei 200 + leerem content + Envelope → `throw envelope`. (Leerer content **ohne** Envelope bleibt der
  bestehende emptyTranscript-Pfad — kein Fehlalarm.)
- `streamSSE`: gibt zusätzlich `raw` (kompletter dekodierter Body) zurück (additiv; bestehende Tests
  nutzen nur `.content/.reasoning/.model`/`toMatchObject`).
- `transcribeStream`: nach `streamSSE`, wenn content leer **und** der Body keine `data:`-Zeile enthielt
  (`/^data:/m`), Envelope aus `raw` prüfen → `throw`. Ein legitimer leerer SSE-Stream (`data:[DONE]`)
  enthält eine `data:`-Zeile → kein Throw.

Die geworfene Meldung fließt durch die bestehenden catch-Pfade (`run()` `img_to_md_view.ts:312`,
`runImgToMd`) und landet als Kartenfehler/Notice. **Guardrail:** nur Meldung halten, nie das Bild.

## Feature B — PDF-Partial-Failure-Recovery (#1, M)

**Problem (verifiziert):** Bei mehrseitigen PDFs sammelt `partitionDoneCards` nur done-Karten →
fehlgeschlagene Seite verschwindet **still** aus der zusammengeführten Notiz; `pages:` aus
`kept[0]..kept[last]` labelt den Bereich falsch. Eine 30-Seiten-Notiz mit fehlender Seite 17 sieht
vollständig aus.

**Lösung (zwei Teile):**

### B1 — Ehrliche Zusammenführung (pure core)
- `partitionDoneCards` zusätzlich (additiv): pro PDF `failedPages: number[]` (Karten mit `status==='error'`)
  und `pending: boolean` (`status==='streaming'`). `pages`/`images`/`cardIndices` bleiben done-only →
  bestehende Tests unberührt.
- `buildPdfBody(pages, separator, range?)`: mit `range` über `from..to` iterieren; Seite mit Inhalt →
  Block, fehlende Seite → **sichtbarer** Platzhalter `t("pdf.pageFailed", n)` (`**Seite N — …**`),
  jeweils mit `pagePrefix`. Ohne `range` unverändert.
- `buildPdfNote`/`writePdfTranscript`: `opts.range` durchreichen; `pages:`-Frontmatter aus der
  **gewählten Range** statt aus kept. Ohne `range` (bestehende Tests) altes Verhalten.
- Guard „alle Seiten leer → keine Notiz" bleibt (kein reiner Platzhalter-Note).

### B2 — Retry (view)
- Kartenfehlerzeile bekommt einen **Retry**-Button (`refresh-cw`, error-Status). Footer:
  **„Fehlgeschlagene erneut"** (sichtbar nur wenn error-Karten existieren).
- `run()` wird auf ein gemeinsames `runIndices(path, indices, isRetry)` refaktoriert; `retryOne(i)`/
  `retryAll()` setzen die betroffenen Karten zurück (`resetCard` + DOM-Reset in-place) und re-streamen.
  Abbrechbar über denselben `AbortController` (Run-Button → „Stop").
- **Write-Korrektheit über Sessions:** `writePdfGroup` schreibt mit `range` + Platzhaltern; setzt nach
  Create `item.existingTranscriptPath` (geteiltes Item → spätere Writes nutzen Override, keine Dublette);
  markiert Karten **nur written, wenn keine `failedPages`** (sonst bleiben done-Karten „done", damit der
  spätere komplette Override sie via Partition wieder einbezieht). Damit ist der Retry-nach-Write-Fluss
  nicht-destruktiv.

## i18n (EN kanonisch + DE)
- `pdf.pageFailed` = „Page {0} — transcription failed" / „Seite {0} — Transkription fehlgeschlagen"
- `view.retry` = „Retry" / „Erneut versuchen"
- `view.retryAllFailed` = „Retry failed" / „Fehlgeschlagene erneut"

## Out of scope (bewusst)
- Cross-Reopen-Persistenz des Lauf-Zustands (XL, geringer Nutzen).
- Part B von #2 (Header-Diagnostik, Meta-Panel) — eigener Zyklus.
- Block-statt-Platzhalter: Platzhalter ist nutzerfreundlicher (dauerhaft fehlschlagende Seite blockiert
  nicht die ganze Notiz) und bleibt ehrlich.
- **`transcribeStream` `!ok`-Zweig hebt den Envelope nicht** (Asymmetrie zu `transcribe`): ein
  streamendes 400 mit `{error:{message}}` zeigt nur „Vision HTTP 400". Bewusst — der streamende Body
  würde beim Lesen konsumiert; der reale LM-Studio-Footgun ist der **200**-Fall (gehandhabt). Kein
  Regress ggü. main.
- **200-Stream, der den Fehler als `data: {error}`-Event liefert**, fällt auf generisches
  „Empty transcript" zurück (`/^\s*data:/m` matcht → Envelope-Check übersprungen). Seltener Trigger;
  pre-Feature-Verhalten identisch. Bei Bedarf: geparste SSE-data-Payloads bei leerem content auf einen
  Envelope prüfen.

## DoD
Alle bestehenden + neuen Tests grün (`vitest`), `tsc --noEmit` + `eslint` sauber, `build` ok, nach
Pallas deployed, Geräte-Abnahme, 0.6.1 (Codeberg kanonisch + GitHub-Mirror).
