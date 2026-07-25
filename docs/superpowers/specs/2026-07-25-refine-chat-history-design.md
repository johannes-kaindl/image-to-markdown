# Spec: Refine-Chat-Verlauf (LLM-Feedback-Refinement v2)

**Datum:** 2026-07-25
**Status:** Design freigegeben (Brainstorming), Plan ausstehend
**Baut auf:** #7 LLM-Feedback-Refinement (0.14.0) — [[2026-07-23-llm-feedback-refinement-design]]

## Problem & Motivation

Die erste Version des Nachbesserns (0.14.0) ersetzt den Kartentext **in-place** und bietet
nur ein **Ein-Schritt-Undo**. Aus der Geräte-Abnahme (Jay):

1. Beim Nachbessern läuft das **Thinking unsichtbar** im Hintergrund (v1 hat den
   `onReasoning`-Callback bewusst als No-op verdrahtet).
2. Man kann die **Nachbesserungen nicht vergleichen** — jede Runde überschreibt die vorige
   in der Anzeige; nur die aktuelle Version ist sichtbar.

Gewünscht: ein **Chat-artiger, scrollbarer Verlauf** pro Karte — jede Runde unten angehängt,
alle Versionen sichtbar, Thinking sichtbar, und die **beste Version frei wählbar**. Das
Scroll-Container-Muster wird von `../yijing-oracle` übernommen.

## Scope-Entscheidungen (Brainstorming 2026-07-25)

| # | Frage | Entscheidung |
|---|-------|--------------|
| 1 | Anzeige-Modell | **Voller Chat-Verlauf** — Original → je Runde (Feedback + Thinking + Vollversion), unten angehängt, scrollbar, Auto-Scroll beim Streamen. |
| 2 | Kanonische Version | **Beliebige wählbar** — „diese verwenden"-Markierung pro Version; die gewählte wird geschrieben (Default: letzte). Ersetzt das Ein-Schritt-Undo. |
| 3 | Lebensdauer | **Nur in der Session** (CardCache, RAM) — überlebt Notizwechsel/View-Close, weg nach Obsidian-Neustart. Kein Disk-Persist. |
| 4 | Verfeinern-Basis | **Linear** — neue Runde baut immer auf der letzten auf (Modell bekommt `v0 + alle Runden + Feedback`); die Auswahl beeinflusst nur, *was geschrieben* wird. Kein Verzweigen (Baum) in diesem Zyklus. |

### Grenzen (aus v1 unverändert)

Trotz Chat-Optik bleibt es ein **begrenzter Nachbesserungs-Loop**, kein Voll-Chat:

- **text-only** (kein Bild-Re-Grounding),
- **nur Transkript-Karten** (`mode !== "description"`),
- **kein** editierbarer System-Prompt,
- der **Dialog wird nicht in die Notiz geschrieben** (nur die gewählte Version landet im Body),
- **In-Session** (kein Disk-Persist des Verlaufs).

## Architektur

### 1. Datenmodell — `ImgCard.refine` erweitern (`img_to_md_state.ts`, reiner Zustand)

Von v1:
```ts
refine?: { base: string; steps: { feedback: string; text: string }[] };
```
zu v2:
```ts
interface RefineRound { feedback: string; text: string; reasoning: string; }
refine?: {
  base: string;              // v0 — die Original-Transkription
  rounds: RefineRound[];     // je Runde: Feedback + Ergebnis + Reasoning
  selected: number;          // Index der kanonischen Version: 0 = base, k = rounds[k-1]
};
```

- **Kanonische Version** = `selected === 0 ? base : rounds[selected-1].text`, gespiegelt in
  `card.text` (der gesamte Schreib-/Partition-/Diff-Gate-Pfad bleibt unverändert, weil er
  über `card.text` läuft).
- **Persistenz:** `card.refine` liegt auf dem Karten-Objekt → reitet auf dem CardCache
  (In-Session). Kein Disk-Persist.

Neue/geänderte reine State-Methoden (DOM-frei):

- `commitRefineRound(i, feedback, text, reasoning)` — setzt `base` beim ersten Mal (= die
  vorige `card.text`), hängt `{feedback, text, reasoning}` an `rounds` an, setzt
  `selected` auf die neue (letzte) Runde, `card.text = text`, Status → `done`.
- `selectRefineVersion(i, index)` — setzt `selected = index` (geklemmt auf
  `0..rounds.length`), spiegelt `card.text` = kanonische Version. Status bleibt `done`.
- Reine Helfer/Prädikate: `refineVersions(card)` → geordnete Liste `[{label, text,
  reasoning?, feedback?}]` für die View (v0 + Runden); `canRefine(card)` unverändert
  (Transkript-Karte, done/written).
- **Entfällt:** `undoRefine` / `canUndo` (durch die Versionswahl ersetzt).

Das v1-Feld `steps` wird vollständig durch `rounds`+`selected` ersetzt (kein Doppelmodell).

### 2. Reiner Kern `refine.ts` — Messages aus Runden bauen

`buildRefineMessages` bleibt konzeptionell gleich, nimmt aber die neue Rundenform. Der
Modell-Kontext ist **linear** (§4): `System + user(feedback₁+base) + assistant(v1) +
user(feedback₂) + assistant(v2) + … + user(neues Feedback)` über **alle** Runden bis zur
letzten (nicht bis `selected`). Signatur bleibt kompatibel (nimmt `base`, die bisherigen
Runden `{feedback,text}[]`, das neue `feedback`, den `systemPrompt`).

### 3. Transport `VisionClient.refineStream` — unverändert

Bereits vorhanden und passend: streamt `content` **und** `reasoning`. In v2 wird der
`onReasoning`-Callback **verdrahtet** (v1 hatte ihn als No-op) → das Reasoning einer Runde
läuft in einen Puffer, der bei Commit in `round.reasoning` festgehalten wird.

### 4. UI (`img_to_md_view.ts`) — Chat-Verlauf statt in-place

Auf `done`/`written` **Transkript**-Karten:

- **Verlaufs-Container** (`img2md-refine-log`): höhenbegrenzt + scrollbar
  (`max-height: 50vh; overflow-y: auto` — Startwert, in der Impl feinjustierbar; yijing-Muster,
  nur Theme-CSS). **Stick-to-bottom**
  beim Streamen: vor jedem Content-Tick prüfen, ob der Nutzer nahe am unteren Rand ist
  (`scrollHeight - scrollTop - clientHeight < ε`); wenn ja, nach dem Anhängen
  `scrollTop = scrollHeight` setzen (scrollt der Nutzer selbst hoch, wird nicht erzwungen).
- **Pro Eintrag** (v0 + je Runde):
  - Kopf: `Original` bzw. das Feedback der Runde (`du: „…"`).
  - Reasoning: bestehender `<details>`-Block (klappt nach dem Streamen zu; danach gehört
    `.open` dem Nutzer) — nur für Runden mit `reasoning`.
  - Versionstext (`img2md-refine-version`).
  - **Auswahl-Aktion**: „diese verwenden" (inaktiv/markiert für die aktuell gewählte).
- **Eingabezeile** (bleibt): Feedback-Feld + „Nachbessern". „↶ Zurück" **entfällt**.
- Während des Streamens einer Runde: neue (noch nicht committete) Version wird als letzter
  Eintrag live gerendert (Reuse des `updateCard`-Hot-Paths); Eingabe/Buttons gesperrt.
- Beschreiben-Karten (`mode === "description"`): **kein** Verlauf/Feld.

Die gewählte Version steuert die **Schreib-Buttons** (aus 0.14.1) unverändert: „Notiz
aktualisieren" schreibt `card.text` (= kanonische Version).

### 5. Fehler-/Abbruch-Semantik (aus v1 übernommen)

- Streaming-Puffer transient; `rounds` wird **erst bei erfolgreichem, nicht-leerem** Ergebnis
  committet. Fehler/Abbruch/leeres Ergebnis: aktuelle Runden + Auswahl bleiben unangetastet,
  transiente Fehlermeldung an der Karte. Abbruch über den bestehenden `AbortController`.

### 6. `main.ts` — `refine`-Dep unverändert

Baut weiter `buildRefineMessages(base, rounds→{feedback,text}, feedback, t("refine.systemPrompt"))`
und ruft `refineStream` mit `effectiveSuppress`. Die View reicht jetzt einen **echten**
`onReasoning` durch (statt No-op).

## Testplan

- **`refine.ts` (pur):** `buildRefineMessages` mit der Rundenform (leerer Verlauf / 1 / n),
  lineare Rollen-Alternation über **alle** Runden (nicht bis `selected`).
- **`img_to_md_state.ts`:** `commitRefineRound` (base-Erstsetzung, Reasoning gespeichert,
  `selected` → neue Runde, `card.text` gespiegelt, Status done); `selectRefineVersion`
  (Klemmung, `card.text` = gewählte Version, auch `selected=0` → base); `refineVersions`
  (Reihenfolge v0..vn); `commitRefineRound` auf `written`-Karte → `done`, `writtenPath`
  bleibt.
- **`vision_client.refineStream`:** Reasoning-Streaming (bereits getestet; ggf. ein Test,
  der `onReasoning` empfängt).
- **View (headless):** Verlauf rendert v0 + Runden; „diese verwenden" setzt die gewählte
  Version (und damit `card.text` fürs Schreiben); Beschreiben-Karte zeigt keinen Verlauf;
  Fehler lässt Verlauf/Auswahl intakt.
- **Geräte-Abnahme (Backstop):** Thinking pro Runde sichtbar; Auto-Scroll; Versionen
  vergleichen + auswählen + schreiben.

## Bewusst out of scope

- **Verzweigen** (ab einer früheren Version neu abbiegen, Baum-Modell) — eigener späterer Bogen.
- **Disk-Persistenz** des Verlaufs.
- **Beschreiben-Refine** (Prosa + Kategorie/Tags).
- **Bild-Re-Grounding** (kein erneutes Mitschicken des Bildes).
- **Dialog in die Notiz schreiben** (nur die gewählte Version landet im Body).
- **Seitenweise diff/Vergleichsansicht** zwischen zwei Versionen (die sequenzielle
  Sichtbarkeit im Chat reicht für den Vergleich).
