# Design: View-Performance — inkrementelles Karten-Rendering

**Datum:** 2026-06-28
**Status:** Entwurf
**Scope:** Die Sidebar-View rendert die Ergebnis-Karten beim Streaming inkrementell statt bei jedem Token komplett neu. Spürbar flüssigeres Streaming (besonders auf Mobile/iPhone), und der reasoning-`<details>`-Block sowie die Scroll-Position springen nicht mehr.

---

## 1. Motivation

Beim Streaming ruft die View pro **Content- und Reasoning-Token** `renderCards()` auf (`img_to_md_view.ts:232-233`). `renderCards()` macht `el.empty()` (kompletter DOM-Wipe) und baut danach **alle** Karten von Grund auf neu auf (`img_to_md_view.ts:179-211`): pro Karte Head, optionaler reasoning-`<details>`, Text-Div, Status-Teile, Buttons inkl. `setIcon` und Event-Listener.

Das ist O(Karten × Token) DOM-Arbeit. Reale Folgen, im Mobile-Betrieb verifiziert (Screenshot 2026-06-28, Modell `google/gemma-4-e2b` mit langem Reasoning-Strom → hunderte Vollrebuilds):

- **Flackern / Scroll-Sprünge** während des Streamings.
- Der reasoning-`<details>`-**Toggle springt zurück**: klappt der Nutzer ihn zu/auf, baut der nächste Token das DOM neu und stellt `det.open = live` wieder her.
- Unnötige CPU-/Akku-Last und Event-Listener-Neubindung pro Token — auf der iPhone-CPU am deutlichsten.

Die State-Schicht ist bereits inkrementell (`ImgToMdState.appendContent` ist O(1), `img_to_md_state.ts:82`). Nur die View-Schicht hängt hinterher.

---

## 2. Scope

### Diese Spec
- Streaming-Hot-Path rendert inkrementell: nur die aktive Karte wird aktualisiert, kein `el.empty()` pro Token.
- Der reasoning-`<details>`-Toggle- und der Scroll-Zustand bleiben während des gesamten Laufs stabil (Definition of Done aus dem Brainstorming: „flüssig + stabil", **kein** Auto-Scroll-Feature).
- Reiner Eingriff in die View-Schicht (`src/img_to_md_view.ts`) + neue Tests. Kern (`img_to_md.ts`), State (`img_to_md_state.ts`), `styles.css` bleiben unberührt.

### Bewusst NICHT (YAGNI / anderer Faden)
- **Kein Auto-Scroll** („dem Text nach unten folgen", chat-artig) — vom Nutzer im Brainstorming explizit abgewählt; Ziel ist Stabilität, nicht Mitlaufen.
- **Keine** Render-Drosselung via `requestAnimationFrame` (Ansatz B) — der Vollrebuild bliebe und verletzte die Toggle-/Scroll-Stabilität; zudem in vitest/happy-dom schwer testbar.
- **Kein** virtuelles Rendering / DOM-Diffing-Framework — die Kartenzahl pro Lauf ist klein, eine handgeführte idempotente Per-Karte-Sync genügt (YAGNI).
- **Nicht** der 13px-Checkbox-Touch-Fix — das ist der separate Mobile-Touch-Faden, gehört nicht in diese Spec.
- `renderList()` (Bild-Liste) bleibt unverändert — sie liegt nicht im Streaming-Hot-Path (läuft nur bei Auswahl-Toggles).

---

## 3. Architektur (Ansatz A: retained-mode, idempotente Per-Karte-Sync)

Zwei Render-Begriffe statt einem Voll-Render:

- **`resetCards()`** — der einzige Ort, der noch `cardsEl.empty()` aufruft. Wird beim Neuaufbau eines Laufs (`startCards`) und bei `clearCards`/`refresh` genutzt. Leert das Karten-Array, setzt `cardEls = []`, und legt für jede Karte den Teilbaum über `updateCard(i)` an.
- **`updateCard(i)`** — bringt den DOM-Teilbaum *einer* Karte idempotent auf ihren aktuellen State. Legt fehlende Knoten lazy an, aktualisiert Texte via `setText`, ergänzt status-abhängige Teile (Actions/Error/Written). Mehrfachaufruf mit unverändertem State ist ein No-op.

Der Streaming-Hot-Path ruft nur noch `updateCard(i)` für die aktive Karte — kein `empty()`, keine anderen Karten angefasst.

### DOM-Referenzen

Ein Array `cardEls: CardRefs[]` parallel zu `state.cards`:

```ts
interface CardRefs {
  cardEl: HTMLElement;
  headEl: HTMLElement;
  reasoningDet?: HTMLDetailsElement;
  reasoningSum?: HTMLElement;
  reasoningBody?: HTMLElement;
  textEl?: HTMLElement;
  actionsEl?: HTMLElement;
  liveWas: boolean;       // letzter bekannter live-Zustand (für den einmaligen Auto-Collapse)
  autoCollapsed: boolean; // wurde der reasoning-Block schon einmal automatisch zugeklappt?
}
```

`updateCard(i)` adressiert `cardEls[i]`. Optionale Knoten werden beim ersten Bedarf erzeugt.

**Knoten-Reihenfolge-Invariante:** Der reasoning-`<details>` steht direkt nach `headEl` und **vor** dem Text-`<div>`. Das wird über die **Anlege-Reihenfolge** erreicht: Knoten werden lazy per `createEl`/`createDiv` (am Container-Ende) erzeugt, und Reasoning kommt real wie in allen Tests vor dem Content → head → reasoning → text. Kein DOM-Umsortieren (`insertBefore`) nötig — der Test-Mock böte es ohnehin nicht. Der theoretische Fall „Content vor Reasoning" (bei realen Vision-Modellen praktisch ausgeschlossen, da `reasoning_content`/`<think>` zuerst strömen) bliebe rein **kosmetisch** (Reasoning erschiene unter dem Text, kein Datenverlust) und wird bewusst nicht gesondert behandelt (YAGNI).

## 4. Reasoning-Block-Lebenszyklus

Ersetzt das heutige `det.open = live` (das pro Token neu gesetzt wird und springt) durch eine stabile, einmalige Regel:

1. **Anlegen** (erstes Reasoning-Delta): `<details>` wird mit `det.open = live` erzeugt (`live = (status === "streaming" && text === "")`), Summary „💭 thinking…" (`view.thinking`) bzw. „💭 thoughts" je nach `live`. Im Normalfall kommt Reasoning zuerst → `live === true` → offen, der Nutzer sieht das Denken live. (Käme Content ausnahmsweise vor Reasoning, ist `live` schon false → der Block wird direkt zugeklappt angelegt, `autoCollapsed = true`.) `liveWas` wird auf den Anlege-`live` gesetzt.
2. **Einmaliger Auto-Collapse:** Sobald `live` von true→false kippt — durch ersten Content **oder** done/error — wird der Block **genau einmal** zugeklappt (`det.open = false`) und die Summary auf „💭 thoughts" (`view.thoughts`) gesetzt; `autoCollapsed = true`.
3. **Danach unangetastet:** `updateCard` setzt `det.open` nie wieder. Klappt der Nutzer auf/zu, bleibt es so — über den ganzen Lauf, auch bei Multi-Karten-/PDF-Läufen (die heute fertige Karten per Vollrebuild zurücksetzen).

Die Summary-**Text**-Angleichung (thinking↔thoughts) darf bei jedem `updateCard` erfolgen; nur `.open` unterliegt der Einmal-Regel.

## 5. Mapping der `renderCards()`-Aufrufstellen

| Stelle (heute) | Neu |
|---|---|
| `run()` nach `startCards` (Z. 223) | `resetCards()` |
| Content-Callback (Z. 232) | `updateCard(i)` — Hot-Path |
| Reasoning-Callback (Z. 233) | `updateCard(i)` — Hot-Path |
| nach Karte, catch/done (Z. 242) | `updateCard(i)` (Status → Actions/Error) |
| `run()`-Ende (Z. 257) | `updateCard(i)` über alle Karten (Abbruch-Markierungen) |
| `writeOne` (Z. 273) | `updateCard(i)` bzw. die markierten PDF-Karten-Indizes |
| `writeAll` (Z. 290) | `updateCard(i)` über die markierten Indizes |
| `refresh()` nach `clearCards` (Z. 129) | `resetCards()` (entfernt alte Karten-DOM) |

`renderCards()` als Name kann als Synonym für „`resetCards()`" bestehen bleiben oder wird umbenannt — Implementierungsdetail des Plans.

## 6. Fehler / Abbruch / Edge-Cases

- **Abbruch (Stop):** unverändert in der Logik — `setError` setzt den Status, `updateCard(i)` rendert die „Abgebrochen"-/Fehlerzeile idempotent; der reasoning-Block klappt per Regel-Schritt 2 einmal zu.
- **Leeres Transkript** (`setDone` → error): `updateCard` zeigt die Fehlerzeile statt der Actions; `live` kippt ohne Content auf false → einmaliger Auto-Collapse.
- **PDF / mehrere Karten:** jede Seite ist eine eigene Karte mit eigenen `cardEls`-Refs; Toggle-Zustände bleiben unabhängig und über den ganzen Lauf erhalten.
- **Actions / `writtenPath`-Klick:** Event-Listener werden beim Anlegen der Knoten **einmal** gebunden (nicht mehr pro Token neu) — nebenbei kein Listener-Churn.

## 7. Test-Strategie

- **Bestehende View-Tests bleiben unverändert grün** — das finale DOM ist identisch (gleiche Klassen, gleiche `textContent`, gleiche Karten-/Reasoning-Existenz). Verifiziert über `npm test`.
- **Neue Tests** in `tests/img_to_md_view.test.ts`:
  1. *Inkrementell statt Rebuild:* Ein Mock-`transcribeStream` greift zwischen zwei `onContent`-Deltas die `img2md-card`-Knotenreferenz ab; sie muss über die Deltas **dasselbe Element** bleiben (kein Neuaufbau pro Token). Mock-unabhängig über Knoten-Identität, kein `empty`-Spy nötig.
  2. *Toggle bleibt über Karten:* zwei Karten sequenziell; nach Karte 1 deren `<details>.open = true` setzen; während/nach Karte 2 muss Karte 1 `open === true` bleiben.
  3. *Auto-Collapse genau einmal:* reasoning, dann content → am Ende `<details>.open === false` und Summary „thoughts"; im Nur-reasoning-Zustand (kein content) `open === true` / „thinking…".
  4. *Append-Korrektheit:* mehrere Content-Deltas → `img2md-text.textContent` ist die Konkatenation (der Default-Mock `"Hal"+"lo"` deckt das bereits ab).

## 8. Definition of Done

- `npm test` grün (inkl. neue Tests), `npm run typecheck`, `npm run lint`, `npm run build` sauber.
- Obsidian-Verifikation am Gerät: flüssiges Streaming, reasoning-Toggle und Scroll-Position springen nicht.
- Reiner View-Schicht-Eingriff; Kern/State/`styles.css` unberührt; `minAppVersion` unverändert (keine neuen APIs).
