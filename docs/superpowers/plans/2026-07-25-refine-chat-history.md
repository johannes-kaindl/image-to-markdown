# Refine-Chat-Verlauf (v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das In-place-Nachbessern (0.14.x) wird zu einem Chat-artigen, scrollbaren Verlauf pro Transkript-Karte — jede Runde mit sichtbarem Thinking und Vollversion, beliebige Version wählbar (ersetzt das Ein-Schritt-Undo).

**Architecture:** `ImgCard.refine` bekommt `{ base, rounds:[{feedback,text,reasoning}], selected }`. Der reine `refine.ts`-Messages-Builder und die `VisionClient.refineStream`/`main.ts`-Dep bleiben unverändert (die Dep-Signatur `{feedback,text}[]` ist kompatibel; das Reasoning-Streaming existiert schon — nur der View-`onReasoning` wird verdrahtet). Die View rendert einen höhenbegrenzten, scrollbaren Verlauf (yijing-Muster `max-height + overflow-y:auto`) mit Auto-Scroll; die gewählte Version spiegelt `card.text`, sodass der gesamte Schreib-/Diff-Gate-Pfad unverändert bleibt.

**Tech Stack:** TypeScript (strict, noImplicitAny) · esbuild · vitest + happy-dom · Obsidian Plugin API.

## Global Constraints

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen.
- **Reiner Kern obsidian-/DOM-frei:** `img_to_md_state.ts`, `refine.ts`, `i18n.ts`.
- **i18n:** neue nutzersichtbare Strings über `t()`, EN kanonisch, EN **und** DE (Paritätstest `tests/i18n.test.ts`).
- **UI-STANDARD:** nur Obsidian-native Elemente + Theme-CSS-Variablen; keine Farb-Literale.
- **Grenzen (aus v1):** text-only, nur Transkript-Karten (`mode !== "description"`), kein editierbarer System-Prompt, Dialog **nicht** in die Notiz, **In-Session** (CardCache, kein Disk-Persist).
- **Perf-Muster (0.6.0):** kein Vollrebuild im Streaming-Hot-Path — Log-Einträge inkrementell/idempotent (nur der Live-Eintrag aktualisiert pro Token).
- **Commits:** Conventional Commits, deutsche Beschreibung erlaubt, **nur berührte Dateien stagen**, Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Gate je Task:** `npm test` grün, `npm run typecheck` grün, `npm run lint` grün.

---

## Task 1: State v2 + refineCard (Reasoning-Capture, Rundenmodell) + Undo entfernen

**Files:**
- Modify: `src/img_to_md_state.ts` (`ImgCard.refine` Z. 37; `commitRefine` Z. 122–128; `undoRefine` Z. 132–138; `canUndo` Z. 158–161)
- Modify: `src/img_to_md_view.ts` (Import Z. 2; `CardRefs` Z. 36–40; View-Feld `refineDrafts`; `refineCard` Z. 575–608; `undoRefine`-Methode Z. 610–616; `updateCard` Text-/Refine-Block Z. 410–416 + 458–484)
- Modify: `src/i18n.ts` (Key `view.refineUndo` entfernen, EN+DE)
- Test: `tests/img_to_md_state.test.ts`, `tests/img_to_md_view.test.ts`

**Interfaces:**
- Produces:
  - `interface RefineRound { feedback: string; text: string; reasoning: string }` (exportiert aus `img_to_md_state.ts`)
  - `ImgCard.refine?: { base: string; rounds: RefineRound[]; selected: number }`
  - `ImgToMdState.commitRefineRound(i, feedback, text, reasoning): void`
  - `ImgToMdState.selectRefineVersion(i, index): void`
  - `canRefine` unverändert; `undoRefine`/`canUndo` entfernt.

- [ ] **Step 1: State-Tests schreiben (ersetzt den v1-„Refine (#7)"-Block)**

Den bestehenden `describe("ImgToMdState — Refine (#7)", …)`-Block in `tests/img_to_md_state.test.ts` **komplett ersetzen** durch:

```ts
import { canRefine } from "../src/img_to_md_state";
// (Falls selectRefineVersion/commitRefineRound noch nicht importiert: über die Instanz aufrufen — Methoden.)

describe("ImgToMdState — Refine v2 (Chat-Verlauf)", () => {
  function doneCard(): ImgToMdState {
    const s = new ImgToMdState();
    s.setItems([{ raw: "![[a.png]]", link: "a.png", ext: "png", supported: true, kind: "image" }]);
    s.startCards();
    s.appendContent(0, "v0");
    s.setDone(0);   // status done, text "v0", mode undefined (Transkript)
    return s;
  }

  it("commitRefineRound erste Runde: base=vorige Version, eine Runde inkl. Reasoning, selected=1", () => {
    const s = doneCard();
    s.commitRefineRound(0, "f1", "v1", "denke1");
    expect(s.cards[0].refine).toEqual({ base: "v0", rounds: [{ feedback: "f1", text: "v1", reasoning: "denke1" }], selected: 1 });
    expect(s.cards[0].text).toBe("v1");
    expect(s.cards[0].status).toBe("done");
  });

  it("commitRefineRound zweite Runde: base bleibt, rounds akkumulieren, selected=2", () => {
    const s = doneCard();
    s.commitRefineRound(0, "f1", "v1", "");
    s.commitRefineRound(0, "f2", "v2", "denke2");
    expect(s.cards[0].refine!.base).toBe("v0");
    expect(s.cards[0].refine!.rounds.map(r => r.text)).toEqual(["v1", "v2"]);
    expect(s.cards[0].refine!.selected).toBe(2);
    expect(s.cards[0].text).toBe("v2");
  });

  it("selectRefineVersion wählt Original (0) bzw. eine Runde und spiegelt card.text", () => {
    const s = doneCard();
    s.commitRefineRound(0, "f1", "v1", "");
    s.commitRefineRound(0, "f2", "v2", "");
    s.selectRefineVersion(0, 0);
    expect(s.cards[0].refine!.selected).toBe(0);
    expect(s.cards[0].text).toBe("v0");
    s.selectRefineVersion(0, 1);
    expect(s.cards[0].text).toBe("v1");
  });

  it("selectRefineVersion klemmt Out-of-range-Indizes", () => {
    const s = doneCard();
    s.commitRefineRound(0, "f1", "v1", "");
    s.selectRefineVersion(0, 9);
    expect(s.cards[0].refine!.selected).toBe(1);   // geklemmt auf rounds.length
    expect(s.cards[0].text).toBe("v1");
    s.selectRefineVersion(0, -3);
    expect(s.cards[0].refine!.selected).toBe(0);
    expect(s.cards[0].text).toBe("v0");
  });

  it("commitRefineRound auf written-Karte setzt Status zurück auf done (writtenPath bleibt)", () => {
    const s = doneCard();
    s.markWritten(0, "note.md");
    s.commitRefineRound(0, "f1", "v1", "");
    expect(s.cards[0].status).toBe("done");
    expect(s.cards[0].writtenPath).toBe("note.md");
  });

  it("canRefine: done/written-Transkript ja, Beschreiben nein, streaming nein", () => {
    const s = doneCard();
    expect(canRefine(s.cards[0])).toBe(true);
    const desc: ImgCard = { ...s.cards[0], status: "done", mode: "description" };
    expect(canRefine(desc)).toBe(false);
    const streaming: ImgCard = { ...s.cards[0], status: "streaming" };
    expect(canRefine(streaming)).toBe(false);
  });
});
```

- [ ] **Step 2: Tests rot laufen lassen**

Run: `npx vitest run tests/img_to_md_state.test.ts -t "Refine v2"`
Expected: FAIL — `commitRefineRound`/`selectRefineVersion` nicht definiert.

- [ ] **Step 3: State implementieren**

In `src/img_to_md_state.ts`:

(a) `RefineRound`-Typ ergänzen (nach dem `ImgItem`-Interface, vor `ImgCard`) und das `refine`-Feld ändern:

```ts
export interface RefineRound { feedback: string; text: string; reasoning: string; }
```
Zeile 37 (`refine?: { base: string; steps: RefineStep[] };`) →
```ts
  /** In-Session-Nachbesserungs-Chat (#7 v2). base = Original-Transkription, rounds = je Runde
   *  Feedback + Ergebnis + Reasoning; selected = kanonische Version (0 = base, k = rounds[k-1]),
   *  gespiegelt in card.text. Reitet auf dem CardCache. */
  refine?: { base: string; rounds: RefineRound[]; selected: number };
```
Den `import type { RefineStep } from "./refine";` (Z. 3) **entfernen**, falls `RefineStep` sonst nicht mehr genutzt wird (Typecheck zeigt es).

(b) `commitRefine` (Z. 122–128) ersetzen durch:

```ts
  /** Committet eine erfolgreiche Nachbesserung als neue Runde: setzt beim ersten Mal die Basis
   *  (die vorige card.text — während des Streamens nicht mutiert), hängt {feedback,text,reasoning}
   *  an, wählt die neue Runde und macht sie zur aktuellen. Status → done (written-Karte re-schreibbar,
   *  writtenPath bleibt). */
  commitRefineRound(i: number, feedback: string, text: string, reasoning: string): void {
    const c = this.cards[i]; if (!c) return;
    if (!c.refine) c.refine = { base: c.text, rounds: [], selected: 0 };
    c.refine.rounds.push({ feedback, text, reasoning });
    c.refine.selected = c.refine.rounds.length;
    c.text = text;
    c.status = "done";
  }
```

(c) `undoRefine` (Z. 130–138) ersetzen durch `selectRefineVersion`:

```ts
  /** Wählt die kanonische Version (0 = Original/base, k = rounds[k-1]); klemmt den Index und
   *  spiegelt card.text. Status bleibt done. Ersetzt das v1-Ein-Schritt-Undo. */
  selectRefineVersion(i: number, index: number): void {
    const c = this.cards[i]; const r = c?.refine; if (!c || !r) return;
    const sel = Math.max(0, Math.min(index, r.rounds.length));
    r.selected = sel;
    c.text = sel === 0 ? r.base : r.rounds[sel - 1].text;
    c.status = "done";
  }
```

(d) `canUndo` (Z. 158–161) **ersatzlos entfernen**. `canRefine` bleibt.

- [ ] **Step 4: View an das neue Modell anpassen (Undo raus, Reasoning rein) — noch ohne Log-Render**

In `src/img_to_md_view.ts`:

(i) Import (Z. 2): `canUndo` streichen → `import { ImgToMdState, ImgItem, PdfGroup, partitionDoneCards, actualModel, canRefine } from "./img_to_md_state";`

(ii) `CardRefs` (Z. 36–40): `refineUndo?: HTMLButtonElement;` entfernen (die anderen refine-Felder bleiben).

(iii) View-Feld `refineDrafts` (Suche `private refineDrafts`) auf Objekt-Form umstellen:
```ts
  /** Transiente, nicht-committete Refine-Streams je Karten-Index (Live-Anzeige; card.text/refine
   *  bleiben bis zum Commit unangetastet). Trägt Feedback + Text + Reasoning der laufenden Runde. */
  private refineDrafts = new Map<number, { feedback: string; text: string; reasoning: string }>();
```

(iv) `updateCard` Text-Block (Z. 410–416): der Draft ist jetzt ein Objekt:
```ts
    const draft = this.refineDrafts.get(i);
    const shownText = draft ? draft.text : card.text;
    if (shownText) {
      if (!refs.textEl) refs.textEl = cardEl.createDiv({ cls: "img2md-text" });
      refs.textEl.setText(shownText);
    }
```

(v) `updateCard` Refine-Block (Z. 458–484): die **Undo-Button-Zeilen entfernen** (die `const undo = …`-Erstellung, `setIcon(undo,…)`, der `undo.addEventListener`, `refs.refineUndo = undo`, und die Zeile `refs.refineUndo!.toggleClass("is-hidden", !canUndo(card));`). Der Rest (refineRow, input, submit, Fehlerzeile) bleibt. Resultierender Block:
```ts
    if (canRefine(card)) {
      if (!refs.refineRow) {
        const row = cardEl.createDiv({ cls: "img2md-refine-row" });
        const input = row.createEl("input", { cls: "img2md-refine-input", attr: { placeholder: t("view.refinePlaceholder"), "aria-label": t("view.refine") } });
        input.type = "text";
        const submit = row.createEl("button", { cls: "img2md-refine-submit", text: t("view.refine") });
        submit.addEventListener("click", () => { const v = input.value; input.value = ""; void this.refineCard(i, v); });
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") { const v = input.value; input.value = ""; void this.refineCard(i, v); } });
        refs.refineRow = row; refs.refineInput = input; refs.refineSubmit = submit;
      }
      const locked = this.running;
      refs.refineInput!.disabled = locked;
      refs.refineSubmit!.disabled = locked;
      const err = this.refineErrors.get(i);
      if (err) {
        if (!refs.refineErrEl) refs.refineErrEl = refs.refineRow.createDiv({ cls: "img2md-refine-error" });
        refs.refineErrEl.setText(err);
      } else if (refs.refineErrEl) { refs.refineRow.removeChild(refs.refineErrEl); refs.refineErrEl = undefined; }
    }
```

(vi) `refineCard` (Z. 575–608) ersetzen (Draft-Objekt + Reasoning-Capture + `commitRefineRound`):
```ts
  async refineCard(i: number, feedback: string): Promise<void> {
    if (this.running) return;
    const card = this.state.cards[i];
    if (!card || !canRefine(card)) return;
    const fb = feedback.trim();
    if (!fb) return;
    this.refineErrors.delete(i);
    this.running = true; this.runBtn?.setText("Stop");
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const base = card.refine?.base ?? card.text;
    const rounds = (card.refine?.rounds ?? []).map(r => ({ feedback: r.feedback, text: r.text }));
    this.refineDrafts.set(i, { feedback: fb, text: "", reasoning: "" });
    this.updateAllCards();
    try {
      const r = await this.deps.refine(
        base, rounds, fb,
        (t) => { const d = this.refineDrafts.get(i); if (d) { d.text += t; this.updateCard(i); } },
        (t) => { const d = this.refineDrafts.get(i); if (d) { d.reasoning += t; this.updateCard(i); } },
        signal,
      );
      if (!signal.aborted) {
        if (r.content.trim()) { card.model = r.model; this.state.commitRefineRound(i, fb, r.content, r.reasoning); }
        else this.refineErrors.set(i, t("view.refineEmpty"));
      }
    } catch (e) {
      if (!signal.aborted) this.refineErrors.set(i, e instanceof Error ? e.message : String(e));
    } finally {
      this.refineDrafts.delete(i);
      this.running = false; this.runBtn?.setText(this.runLabel());
      this.controller = null;
      this.updateAllCards();
    }
  }
```
Hinweis: committet wird `r.reasoning` (das vollständige Reasoning aus der Stream-Antwort), nicht der lokale Puffer — das ist die autoritative Quelle und deckt sich mit dem Draft.

(vii) `undoRefine`-Methode (Z. 610–616) **ersatzlos entfernen**.

- [ ] **Step 5: i18n toten Key entfernen**

In `src/i18n.ts` den Key `"view.refineUndo": …` in **beiden** Dicts (EN + DE) entfernen (Undo gibt es nicht mehr; Paritätstest bleibt grün, weil in beiden entfernt).

- [ ] **Step 6: View-Tests anpassen**

In `tests/img_to_md_view.test.ts` im `describe("Refine-Zeile (#7)", …)`-Block:
- Den Undo-Test (`"Undo-Button erscheint …"`) **entfernen**.
- Den Commit-Test auf das Rundenmodell umstellen und einen Reasoning-Capture-Test ergänzen:
```ts
  it("refineCard committet eine Runde in card.refine.rounds (mit Reasoning)", async () => {
    const { view } = await runToDone({
      refine: async (_b: string, _r: any[], _fb: string, onContent: any, onReasoning: any) => {
        onReasoning("den"); onReasoning("ke"); onContent("VERBESSERT");
        return { content: "VERBESSERT", reasoning: "denke", model: "vm" };
      },
    });
    await (view as any).refineCard(0, "Tabellen als GFM");
    const rf = (view as any).state.cards[0].refine;
    expect(rf.rounds).toEqual([{ feedback: "Tabellen als GFM", text: "VERBESSERT", reasoning: "denke" }]);
    expect(rf.selected).toBe(1);
    expect((view as any).state.cards[0].text).toBe("VERBESSERT");
  });
```
- Die Tests „leeres Feedback → kein Refine-Aufruf" und „Fehler lässt aktuelle Version intakt" bleiben; bei letzterem `expect((view as any).state.cards[0].refine).toBeUndefined();` bleibt gültig (kein Commit bei Fehler).
- Der Test „Refine einer geschriebenen Karte: Status zurück auf done …" bleibt gültig (nutzt `refineCard`, jetzt via `commitRefineRound`).

- [ ] **Step 7: Alles grün + Commit**

Run: `npm test && npm run typecheck && npm run lint`
Expected: alle grün (Baseline 430 minus entfernter Undo-Tests, plus neue).

```bash
git add src/img_to_md_state.ts src/img_to_md_view.ts src/i18n.ts tests/img_to_md_state.test.ts tests/img_to_md_view.test.ts
git commit -m "refactor(refine): Rundenmodell + Versionswahl im State, Reasoning-Capture, Undo raus (v2 Task 1)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Chat-Verlauf-UI — Log-Render, Versionswahl, Thinking, Scroll, CSS

**Files:**
- Modify: `src/img_to_md_view.ts` (`CardRefs`; View-Felder; `updateCard`; neue Methode `syncRefineLog`)
- Modify: `src/i18n.ts` (neue Keys EN+DE)
- Modify: `styles.css`
- Test: `tests/img_to_md_view.test.ts`

**Interfaces:**
- Consumes: `commitRefineRound`/`selectRefineVersion`/`canRefine` (Task 1), `refineDrafts` (Task 1).

**Neue i18n-Keys** (EN / DE), in beiden Dicts nach den bestehenden `view.refine*`-Keys:
- `view.refineOriginal` = "Original" / "Original"
- `view.refineYou` = "You: {0}" / "Du: {0}"
- `view.refineUse` = "Use this version" / "Diese Version verwenden"
- `view.refineSelected` = "Selected version" / "Gewählte Version"

- [ ] **Step 1: View-Tests schreiben (Render + Auswahl)**

Neuen Block in `tests/img_to_md_view.test.ts` (nutzt `mkView`/`runToDone`/`all`):
```ts
describe("Refine-Chat-Verlauf (v2)", () => {
  async function withOneRound(over: any = {}) {
    const { view } = await runToDone(over);
    await (view as any).refineCard(0, "Tabellen als GFM");   // Default-refine → "VERBESSERT"
    return view;
  }

  it("nach einer Runde rendert der Verlauf Original + Runde + Auswahl-Buttons", async () => {
    const view = await withOneRound();
    const root = (view as any).contentEl;
    expect(all(root, "img2md-refine-log").length).toBe(1);
    // Original-Eintrag + 1 Runden-Eintrag:
    expect(all(root, "img2md-refine-entry").length).toBe(2);
    // je Eintrag ein „diese verwenden"-Button:
    expect(all(root, "img2md-refine-use").length).toBe(2);
  });

  it("Klick auf 'diese verwenden' am Original wählt Version 0 und spiegelt card.text", async () => {
    const view = await withOneRound();
    const root = (view as any).contentEl;
    const useBtns = all(root, "img2md-refine-use");
    // Reihenfolge: [0]=Original, [1]=Runde 1
    useBtns[0].dispatchEvent ? useBtns[0].dispatchEvent(new Event("click")) : (view as any).selectRefineVersion?.(0, 0);
    // Fallback: direkter State-Call, falls das Mock-Element kein dispatchEvent hat:
    (view as any).state.selectRefineVersion(0, 0);
    (view as any).updateAllCards();
    expect((view as any).state.cards[0].refine.selected).toBe(0);
    expect((view as any).state.cards[0].text).toBe("Hallo");   // Original (Default-Transkript)
  });

  it("Beschreiben-Karte zeigt keinen Verlauf", async () => {
    const view = await runToDone({ initialMode: "describe" });
    expect(all((view as any).contentEl, "img2md-refine-log").length).toBe(0);
  });
});
```
Hinweis für die Implementierung: der Klick-Test muss real über den DOM-Button funktionieren (kein State-Fallback). Prüfe im Mock (`tests/__mocks__/obsidian.ts`), wie Klick-Handler ausgelöst werden (andere Tests klicken via einer Hilfsfunktion oder rufen den Handler direkt). Nutze **dasselbe** Muster wie die bestehenden Button-Klick-Tests in dieser Datei (z. B. der Retry-/Write-Button-Klick) und ersetze den obigen Fallback entsprechend, sodass der Test **den echten Handler** trifft.

- [ ] **Step 2: Tests rot laufen lassen**

Run: `npx vitest run tests/img_to_md_view.test.ts -t "Refine-Chat-Verlauf"`
Expected: FAIL — `img2md-refine-log`/`img2md-refine-entry` existieren nicht.

- [ ] **Step 3: i18n-Keys ergänzen**

In `src/i18n.ts` EN-Dict (nach `view.refineEmpty`) und DE-Dict (analog):
```ts
  "view.refineOriginal": "Original",
  "view.refineYou": "You: {0}",
  "view.refineUse": "Use this version",
  "view.refineSelected": "Selected version",
```
DE:
```ts
  "view.refineOriginal": "Original",
  "view.refineYou": "Du: {0}",
  "view.refineUse": "Diese Version verwenden",
  "view.refineSelected": "Gewählte Version",
```

- [ ] **Step 4: `CardRefs` + View-Felder für den Log**

In `CardRefs` ergänzen:
```ts
  refineLog?: HTMLElement;                    // scrollbarer Container
  refineEntryEls?: { textEl: HTMLElement; reasoningBody?: HTMLElement; useBtn: HTMLElement }[];  // je committete Runde
  refineLiveEl?: HTMLElement;                 // transienter Live-Eintrag während des Streamens
  refineOrigUse?: HTMLElement;                // „diese verwenden" am Original-Eintrag
```
View-Feld (Reasoning-Draft wird schon in `refineDrafts.reasoning` getragen — kein zusätzliches Feld nötig).

- [ ] **Step 5: Log-Render in `updateCard` + `syncRefineLog`**

(a) In `updateCard`, im Text-Block (Task-1-Fassung): den **Top-Text auf die Original-Version fixieren**, sobald ein Refine existiert oder läuft, damit die gewählte Version (card.text) den oberen Text nicht ersetzt:
```ts
    const draft = this.refineDrafts.get(i);
    const shownText = (card.refine || draft) ? (card.refine?.base ?? card.text) : card.text;
    if (shownText) {
      if (!refs.textEl) refs.textEl = cardEl.createDiv({ cls: "img2md-text" });
      refs.textEl.setText(shownText);
    }
```

(b) Direkt **nach** dem `if (canRefine(card)) { … refineRow … }`-Block einen Aufruf ergänzen: `this.syncRefineLog(i, refs, cardEl);` (der Log gehört zwischen Original-Text und Refine-Eingabezeile — lege den Log-Container an, bevor die Refine-Row erzeugt wird, ODER verschiebe die Row-Erzeugung so, dass die Reihenfolge Original-Text → Log → Eingabe stimmt. Einfachster Weg: `syncRefineLog` VOR dem `if (canRefine)`-Row-Block aufrufen, damit der Log-Container über der Eingabe sitzt.)

(c) Neue Methode `syncRefineLog` (inkrementell, kein Vollrebuild):
```ts
  /** Rendert/aktualisiert den Nachbesserungs-Verlauf einer Karte inkrementell: Original-Auswahl +
   *  je committete Runde ein Eintrag (Feedback-Kopf, Thinking-<details>, Versionstext, „diese
   *  verwenden"), plus einen transienten Live-Eintrag während des Streamens. Auto-Scroll (stick-to-
   *  bottom), solange der Nutzer nicht selbst hochgescrollt hat. */
  private syncRefineLog(i: number, refs: CardRefs, cardEl: HTMLElement): void {
    const card = this.state.cards[i];
    const draft = this.refineDrafts.get(i);
    const rounds = card.refine?.rounds ?? [];
    // Log nur bei Transkript-Karten mit ≥1 Runde ODER laufender Nachbesserung.
    if (card.mode === "description" || (!card.refine && !draft)) return;

    if (!refs.refineLog) {
      const log = cardEl.createDiv({ cls: "img2md-refine-log" });
      // Original-Auswahl (Version 0) — kompakte Zeile über den Runden.
      const origRow = log.createDiv({ cls: "img2md-refine-entry img2md-refine-orig" });
      origRow.createSpan({ cls: "img2md-refine-head", text: t("view.refineOriginal") });
      const origUse = origRow.createEl("button", { cls: "img2md-refine-use", text: t("view.refineUse") });
      origUse.addEventListener("click", () => { this.state.selectRefineVersion(i, 0); this.updateCard(i); });
      refs.refineLog = log; refs.refineOrigUse = origUse; refs.refineEntryEls = [];
    }
    const log = refs.refineLog;
    const entries = refs.refineEntryEls!;

    // Neue committete Runden inkrementell anhängen.
    for (let k = entries.length; k < rounds.length; k++) {
      const r = rounds[k];
      const entry = log.createDiv({ cls: "img2md-refine-entry" });
      entry.createDiv({ cls: "img2md-refine-head", text: t("view.refineYou", r.feedback) });
      let reasoningBody: HTMLElement | undefined;
      if (r.reasoning.trim()) {
        const det = entry.createEl("details", { cls: "img2md-reasoning" });
        const sum = det.createEl("summary", { cls: "img2md-reasoning-sum" });
        setIcon(sum.createSpan({ cls: "img2md-reasoning-icon" }), "brain");
        sum.createSpan({ cls: "img2md-reasoning-lbl", text: t("view.thoughts") });
        reasoningBody = det.createDiv({ cls: "img2md-reasoning-body" });
        reasoningBody.setText(r.reasoning);
      }
      const textEl = entry.createDiv({ cls: "img2md-refine-version", text: r.text });
      const useBtn = entry.createEl("button", { cls: "img2md-refine-use", text: t("view.refineUse") });
      const idx = k + 1;   // rounds[k] hat Auswahl-Index k+1
      useBtn.addEventListener("click", () => { this.state.selectRefineVersion(i, idx); this.updateCard(i); });
      entries.push({ textEl, reasoningBody, useBtn });
    }

    // Auswahl-Markierung (Original + je Runde).
    const selected = card.refine?.selected ?? 0;
    const mark = (btn: HTMLElement, on: boolean) => {
      btn.toggleClass("is-selected", on);
      btn.setText(on ? t("view.refineSelected") : t("view.refineUse"));
      btn.setAttribute("aria-pressed", String(on));
    };
    if (refs.refineOrigUse) mark(refs.refineOrigUse, selected === 0);
    entries.forEach((e, k) => mark(e.useBtn, selected === k + 1));

    // Live-Eintrag (transient) während des Streamens.
    if (draft) {
      if (!refs.refineLiveEl) {
        const live = log.createDiv({ cls: "img2md-refine-entry img2md-refine-live" });
        live.createDiv({ cls: "img2md-refine-head", text: t("view.refineYou", draft.feedback) });
        const rBody = live.createDiv({ cls: "img2md-reasoning-body img2md-refine-live-reasoning" });
        const vEl = live.createDiv({ cls: "img2md-refine-version" });
        refs.refineLiveEl = live;
        (live as unknown as { _r?: HTMLElement; _v?: HTMLElement })._r = rBody;
        (live as unknown as { _v?: HTMLElement })._v = vEl;
      }
      const holder = refs.refineLiveEl as unknown as { _r?: HTMLElement; _v?: HTMLElement };
      holder._r?.setText(draft.reasoning);
      holder._v?.setText(draft.text);
    } else if (refs.refineLiveEl) {
      log.removeChild(refs.refineLiveEl); refs.refineLiveEl = undefined;
    }

    // Stick-to-bottom: nur nachziehen, wenn der Nutzer ohnehin (fast) unten steht.
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
    if (draft && nearBottom) log.scrollTop = log.scrollHeight;
  }
```
Hinweis: Die `_r`/`_v`-Zwischenspeicherung am Live-Element vermeidet zusätzliche `CardRefs`-Felder für den transienten Eintrag. Falls der Reviewer das als zu trickreich sieht, statt dessen zwei `CardRefs`-Felder (`refineLiveReasoning?`, `refineLiveVersion?`) nutzen — funktional identisch.

- [ ] **Step 6: CSS (yijing-Muster, nur Theme-Variablen)**

In `styles.css` (bei den anderen `.img2md-refine-*`-Regeln):
```css
.img2md-refine-log { max-height: 50vh; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; margin: 6px 0; }
.img2md-refine-entry { border-left: 2px solid var(--background-modifier-border); padding-left: 8px; }
.img2md-refine-entry.is-selected, .img2md-refine-entry:has(.img2md-refine-use.is-selected) { border-left-color: var(--interactive-accent); }
.img2md-refine-head { font-size: 12px; color: var(--text-muted); margin-bottom: 2px; }
.img2md-refine-version { white-space: pre-wrap; font-size: 13px; }
.img2md-refine-use { font-size: 12px; margin-top: 4px; }
.img2md-refine-use.is-selected { color: var(--text-on-accent); background: var(--interactive-accent); }
```

- [ ] **Step 7: Grün + Commit**

Run: `npm test && npm run typecheck && npm run lint`
Expected: alle grün (neue Render-/Auswahl-Tests inklusive).

```bash
git add src/img_to_md_view.ts src/i18n.ts styles.css tests/img_to_md_view.test.ts
git commit -m "feat(refine): Chat-Verlauf-UI — Runden, Thinking, Versionswahl, Scroll (v2 Task 2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: CHANGELOG + Build-Verifikation

**Files:**
- Modify: `CHANGELOG.md` (`[Unreleased]`)

- [ ] **Step 1: Volles Gate + Build**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: alle grün; `main.js` gebaut.

- [ ] **Step 2: CHANGELOG unter `[Unreleased]`**

```markdown
### Geändert

- **Nachbessern als Chat-Verlauf:** Jede Nachbesserung wird jetzt als eigener Eintrag unten
  angehängt (statt den Text in-place zu ersetzen) — mit sichtbarem Denk-Prozess (Thinking) und
  scrollbarem Verlauf. Du kannst die Versionen vergleichen und **jede** frei als die zu
  schreibende Version wählen (ersetzt das bisherige „Zurück").
```
(Unter das bestehende `## [Unreleased]`; falls dort schon ein `### Geändert` steht, den Bullet dort ergänzen.)

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): Refine-Chat-Verlauf (v2) unter [Unreleased]

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (Plan gegen Spec)

**Spec-Coverage:**
- Voller Chat-Verlauf (v0 + Runden, Feedback+Thinking+Version) → Task 2 `syncRefineLog`. ✓
- Sichtbares Thinking → Task 1 (Reasoning-Capture in `commitRefineRound`), Task 2 (Thinking-`<details>` je Runde + Live). ✓
- Scrollbar + Auto-Scroll (yijing) → Task 2 CSS `max-height/overflow-y` + stick-to-bottom. ✓
- Beliebige Version wählbar, spiegelt card.text → Task 1 `selectRefineVersion`, Task 2 „diese verwenden"-Buttons. ✓
- In-Session (CardCache) → `card.refine` auf dem Karten-Objekt, kein Disk-Persist. ✓
- Linear (Modell bekommt alle Runden) → `refineCard` reicht `rounds` (alle) an die unveränderte `deps.refine`/`buildRefineMessages`. ✓
- Undo entfällt → Task 1 (State + View + i18n-Key). ✓
- Grenzen (text-only, nur Transkript, kein Dialog in Notiz) → unverändert; Log nur bei `mode !== "description"`; nur `card.text` (gewählte Version) wird geschrieben. ✓
- Schreib-/Diff-Gate-Pfad unverändert → `card.text` spiegelt die Auswahl; keine Änderung an writeOne/writeAll/partition. ✓

**Placeholder-Scan:** keine TBD/TODO; Code vollständig. Der Klick-Test-Fallback in Task 2 Step 1 ist explizit als „durch echtes Klick-Muster ersetzen" markiert (Implementierungs-Hinweis, kein Platzhalter im Produktcode). ✓

**Typ-Konsistenz:** `RefineRound` (Task 1) in State + View-Draft konsistent (`{feedback,text,reasoning}`); `deps.refine`-Signatur (`{feedback,text}[]`) unverändert, `rounds.map(r=>({feedback,text}))` erfüllt sie; `selectRefineVersion(i,index)`/`commitRefineRound(i,fb,text,reasoning)` in Task 1 definiert, in Task 2 genutzt. ✓
