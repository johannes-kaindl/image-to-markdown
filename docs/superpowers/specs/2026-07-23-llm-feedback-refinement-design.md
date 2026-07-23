# Spec: LLM-Feedback-Refinement (Roadmap #7)

**Datum:** 2026-07-23
**Status:** Design freigegeben (Brainstorming), Plan ausstehend
**Roadmap:** Tier-2 #7 — LLM-Feedback-Refinement (iterative Korrektur)

## Problem & Motivation

Ein Transkript übernimmt die Formatierung uneinheitlich (Tabellen mal als GFM, mal
als Fließtext; falsche Überschriften-Ebenen; zu viele Absätze). Bisher bleibt nur der
Umweg über ein anderes Prompt-Preset (#3, 0.7.0) und komplettes Neu-Transkribieren.

`#7` gibt dem Nutzer stattdessen einen **gezielten Nachbesserungs-Loop pro Ergebnis**:
nach einer Transkription in Prosa Feedback ans Modell geben („diese Tabelle als GFM",
„Überschriften-Ebene falsch", „Absätze zusammenfassen") → das Modell erzeugt eine
**neue Gesamtversion** der Transkription. Konversationell, aber **kein Voll-Chat**.

## Scope-Entscheidungen (aus Brainstorming 2026-07-23)

| # | Frage | Entscheidung |
|---|-------|--------------|
| 1 | Loop-Modell | **Iterativer Verlauf** — Runde n sieht das Original + den gesamten bisherigen Feedback-Verlauf. |
| 2 | Grundlage | **Nur Text** — kein Bild wird erneut mitgeschickt; reine Text-Transformation über den text-only-Pfad. |
| 3 | Reichweite | **Nur Transkript-Karten** (`mode !== "description"`). Beschreiben-Refine ist eigener, späterer Scope. |
| 4 | Lifecycle | **Auch nach dem Schreiben** — `done` UND `written` sind nachbesserbar; `written` → zurück auf `done` → erneut schreiben via bestehendem Diff-Gate. |
| 5 | Rückgängig | **Ein Schritt zurück** — Undo macht die letzte Nachbesserung rückgängig, wiederholbar bis zum Original. |

### „Kein Voll-Chat" — die Grenze konkret

Der Feedback-Verlauf wird intern als echtes Chat-Completions-Message-Array an das
Modell geschickt (das ist das richtige Wire-Format, kein Scope-Verstoß). Die Grenze
ist **UX- und Zustandsgrenze**, nicht Wire-Format:

- kein editierbarer System-Prompt,
- keine freie Themenwahl (die Aufgabe ist fest: „verbessere DIESES Transkript"),
- **kein** Speichern des Dialogs in die Zielnotiz,
- **keine** Disk-Persistenz des Verlaufs (nur In-Session, über den CardCache),
- keine volle Versions-Navigation (nur ein-Schritt-Undo).

## Gewählter Ansatz

**Ansatz A — echter Multi-Turn-Messages-Array über einen reinen `refine.ts` + eine
dünne `VisionClient.refineStream`.** Der Verlauf wird als alternierendes
Chat-Completions-Message-Array gebaut. Sauberster Modell-Kontext, reiner testbarer
Kern, minimale Client-Erweiterung.

Verworfen: **B** (Logik im `main.ts`-Glue → ungetestet, gegen Pure-Core-Prinzip);
**C** (flacher Sammel-Prompt mit Inline-Verlauf → flachgeklopfter Kontext, Prompt-Bloat,
Verwechslungsgefahr „welche Version ist aktuell").

## Architektur

### 1. Datenmodell — `ImgCard`-Erweiterung (`img_to_md_state.ts`, reiner Zustand)

```ts
interface ImgCard {
  // … bestehend …
  refine?: {
    base: string;                                 // v0 — Text zum Start des ersten Refine
    steps: { feedback: string; text: string }[];  // je Runde: Feedback + Ergebnisversion
  };
}
```

- **Aktuelle Version** = `steps.length ? steps.at(-1).text : base`, gespiegelt in
  `card.text` (Rendering + Schreiben laufen unverändert über `card.text`).
- **Undo** = `steps.pop()`; `card.text` zurück auf die vorige Version (bzw. `base`).
- **Persistenz:** `card.refine` liegt auf dem Karten-Objekt → reitet automatisch auf
  dem CardCache (0.12.0), überlebt In-Session-Notizwechsel. Kein Disk-Persist.

Neue reine State-Methoden (DOM-frei, in `ImgToMdState`):

- `startRefine(i)` — snapshottet die aktuelle `card.text` als `refine.base` (nur beim
  ersten Mal), setzt Status auf `streaming`; die laufende Version wird in einen
  Temp-Puffer gestreamt (nicht direkt in `card.text`, siehe Fehlerbehandlung).
- `commitRefine(i, feedback, text)` — pusht `{feedback, text}` in `steps`, setzt
  `card.text = text`, Status → `done`.
- `undoRefine(i)` — `steps.pop()`, `card.text` auf vorige Version, ggf. `refine`
  ganz entfernen wenn `steps` leer und keine Basis-Abweichung.
- `failRefine(i, msg)` — Temp verwerfen, aktuelle Version + Status bleiben unangetastet,
  Inline-Fehler an der Karte hinterlegen.
- `canRefine(card)` / `canUndo(card)` — reine Prädikate für die View
  (`mode !== "description"` && Status ∈ {done, written}; `steps.length ≥ 1`).

### 2. Reiner Kern `refine.ts` (neu, obsidian-frei)

- `buildRefineMessages(base, steps, feedback, systemPrompt)` → alternierender
  Messages-Array:

  ```
  [ system: <Refine-System-Prompt> ]
  [ user:   <feedback_1>\n\n---\n\n<base> ]
  [ assistant: <steps[0].text> ]
  [ user:   <feedback_2> ]
  [ assistant: <steps[1].text> ]
  …
  [ user:   <neues feedback> ]
  ```

  Runde 1 (leerer `steps`) → nur System + eine User-Message (Feedback + Basistext).
- Der Refine-System-Prompt kommt aus `i18n.ts` (App-Sprache EN/DE, EN kanonisch, analog
  `defaultVisionPrompt`): sinngemäß „Du überarbeitest ein Markdown-Dokument gemäß der
  Anweisung des Nutzers. Gib immer die **vollständige** korrigierte Fassung aus, nur
  das Dokument, ohne Vorrede."

### 3. Transport `VisionClient.refineStream(messages, opts)` (`vision_client.ts`)

- Dünne, **text-only** Streaming-Methode. Sie teilt die SSE-/Error-Envelope-Behandlung
  mit `transcribeTextStream`; dafür wird ein privater `streamChat(messages, opts)`-Kern
  extrahiert, den beide nutzen (kein Duplikat von `streamSSE`/`parseErrorEnvelope`).
- Kein `image_url`. Signatur spiegelt `transcribeStream` (Callbacks für content +
  reasoning, `AbortSignal`, `suppressThinking`).
- `suppressThinking` wird via `effectiveSuppress(model, suppressThinking)`
  durchgereicht (Thinking-Toggle-Invariante, wie an allen anderen Call-Sites).

### 4. UI (`img_to_md_view.ts`, UI-STANDARD-konform, nur Theme-CSS-Variablen)

Auf `done`/`written` **Transkript**-Karten eine Refine-Zeile unter dem Text
(und unter dem reasoning-`<details>`):

```
┌ Karte ─────────────────────────────────────────────┐
│  [ transkribierter/verbesserter Text … ]            │
│  ⌄ reasoning                                        │
│  ─────────────────────────────────────────────────  │
│  [ Feedback: z. B. „Tabellen als GFM" ] [Nachbessern] │
│  ↶ Zurück                (nur wenn steps ≥ 1)        │
│  [ Schreiben ]                                      │
└─────────────────────────────────────────────────────┘
```

- Beim Nachbessern wird der **Temp-Puffer** (die noch nicht committete neue Version, siehe
  §6) an der Stelle des Kartentexts **live gerendert** (Wiederverwendung des
  `updateCard`-Hot-Path aus 0.6.0 — kein Vollrebuild). `card.text` selbst bleibt bis zum
  erfolgreichen Commit die alte Version; die Live-Anzeige ist reine Darstellung des Temp-Puffers.
- Eingabefeld + Buttons während eines laufenden Streams deaktiviert.
- Leeres Feedback → `Nachbessern` deaktiviert.
- Beschreiben-Karten (`mode === "description"`) zeigen die Refine-Zeile **nicht**.
- i18n EN/DE für alle neuen sichtbaren Strings (Placeholder, Button-Label, `aria-label`
  für Nachbessern/Zurück).

### 5. Schreib-Integration (nutzt bestehende Maschinerie)

- Wird eine `written`-Karte nachgebessert, geht ihr Status zurück auf `done`.
- Erneutes Schreiben läuft durch das **bestehende** `sessionOwned`-Gate (v1.1,
  `img_to_md.ts`): Ist die Notiz auf Disk unverändert = zuletzt von uns geschrieben
  → glattes Überschreiben **ohne** Diff-Modal (session-owned). Hat der Nutzer die
  Notiz zwischendurch manuell editiert → Diff-Modal feuert. **Keine neue Schreiblogik.**
- Zielpfad bleibt deterministisch (dieselbe Quelle → dieselbe Notiz) → keine Dublette.

### 6. Fehlerbehandlung

- Der Refine-Stream läuft in einen **Temp-Puffer**; `refine.steps` wird **erst bei
  erfolgreichem `done` committet**. Ein guter Stand darf durch einen fehlgeschlagenen
  Refine **nie** verloren gehen.
- Netz-/Error-Body-Fehler → aktuelle Version + Status bleiben, Inline-Fehler an der Karte.
- Leeres/whitespace-only Ergebnis → wie `setDone`: als Fehler behandeln, alte Version bleibt.
- Abbruch über den bestehenden `AbortController`-Pfad.

## Testplan

- **`refine.ts` (pur):** `buildRefineMessages` bei leerem Verlauf / 1 Runde / n Runden;
  korrekte Rollen-Alternation; i18n-Prompt-Sprache (EN/DE).
- **`img_to_md_state.ts`:** Refine-Transitionen (start → commit; commit → undo; undo bis
  base; error-restore lässt aktuelle Version intakt; `written` → `done`); Prädikate
  `canRefine`/`canUndo` (u. a. Beschreiben-Karte → `canRefine=false`).
- **`vision_client.refineStream`:** SSE-Content/Reasoning-Parsing + `parseErrorEnvelope`
  (Spiegel zu den `transcribeTextStream`-Tests); kein `image_url` im Request.
- **Geräte-Abnahme (Backstop):** View-Glue — Feedback eingeben → neue Version streamt;
  Undo stellt vorige her; nachgebessertes written-Transkript neu schreiben → glatt bzw.
  Diff-Modal nach manuellem Edit.

## Bewusst out of scope

- Bild-Re-Grounding (kein erneutes Mitschicken des Bildes; keine Ergänzung übersehener
  Bild-Inhalte).
- Beschreiben-Refine (Prosa + Kategorie + Tags) — eigener späterer Zyklus.
- Editierbarer System-Prompt; freies Chat-Thema.
- Speichern des Feedback-Dialogs in die Notiz.
- Disk-Persistenz des Verlaufs (nur In-Session via CardCache).
- Volle Versions-Navigation (nur ein-Schritt-Undo).
- PDF-Sonderbehandlung — jede PDF-Seite ist eine eigene Karte und wird identisch
  (text-only) nachgebessert; keine seiten-übergreifende Refine-Logik.
