# Plan — Integritäts-Paket (0.6.1) — TDD

Spec: `../specs/2026-06-28-integrity-robustness-design.md`. Reihenfolge: A (klein, isoliert) zuerst,
dann B. Nach jedem Task alle Tests grün halten.

## Task A1 — parseErrorEnvelope (pure)
- Test (`vision_client.test.ts`): `{error:{message}}`→msg · `{error:"e"}`→"e" · `{detail}`→detail ·
  `{message}` ohne choices→msg · valide Completion (`{choices:[…]}`)→null · ""/Nicht-JSON→null.
- Impl: `parseErrorEnvelope` exportiert in `vision_client.ts`.

## Task A2 — transcribe surface
- Test: 200 + `{error:{message:"model X not loaded"}}` → `rejects.toThrow("model X not loaded")`.
  `!ok` + error-body → wirft Servermeldung. Bestehende „liefert '' bei fehlendem content" bleibt grün.
- Impl: Envelope in `transcribe` verdrahten.

## Task A3 — streamSSE.raw + transcribeStream surface
- Test (`sse.test.ts`): `streamSSE` Rückgabe enthält `raw` (kompletter Body).
- Test (`vision_client.test.ts`): `transcribeStream` mit 200-Body `{"error":{"message":"boom"}}`
  (keine data-Zeile) → `rejects.toThrow("boom")`; reiner `data:[DONE]`-Stream → kein Throw, content "".
- Impl: `raw` in `streamSSE`; Envelope-Check in `transcribeStream`.

## Task B1 — partition failedPages/pending (pure)
- Test (`img_to_md_state.test.ts`): PDF mit done+error+streaming → `pages` nur done, `failedPages`
  enthält error-Seite, `pending` true bei streaming. Bestehende Partition-Tests bleiben grün.
- Test: `resetCard(i)` leert text/reasoning/model/error, status→streaming.
- Impl: Felder additiv in `partitionDoneCards`; `resetCard`.

## Task B2 — buildPdfBody/buildPdfNote/writePdfTranscript range+placeholder (pure)
- Test (`pdf_to_md.test.ts`): `buildPdfBody([{1,A},{3,C}], sep, {from:1,to:3})` → Platzhalter für 2.
  `buildPdfNote` mit range → `pages:"1-3"`. `writePdfTranscript` mit `opts.range` → Notiz hat
  Platzhalter + korrekte `pages`. Override mit range. Bestehende Tests (ohne range) unverändert.
- Impl: `range` durch `buildPdfBody`/`buildPdfNote`/`writePdfTranscript` (in `opts`).

## Task B3 — view retry + writePdfGroup (view + deps + main)
- Test (`img_to_md_view.test.ts`): error-Karte zeigt `img2md-retry`; Klick re-ruft transcribeStream,
  Karte→done, Fehler weg. `retryAll` re-läuft alle error-Karten. Footer `img2md-retry-all` sichtbar
  nur bei error-Karten. PDF mit fehlgeschlagener Seite → `writePdf` mit `range`-Arg, Karten korrekt
  markiert (done bleibt done bei failedPages).
- Impl: `runIndices`/`retryOne`/`retryAll`/`resetCardDom`/`writePdfGroup`; Retry-Buttons in `updateCard`
  + Footer; `writePdf`-Dep + `main.ts` um `range` erweitert; `styles.css`.

## Task C — i18n + Doku + Release
- i18n-Keys (EN/DE). README/Manual/CHANGELOG (0.6.1). `version-bump 0.6.1`. Build + deploy + Abnahme.
- Adversarieller Whole-Branch-Review (Workflow) vor Merge.
