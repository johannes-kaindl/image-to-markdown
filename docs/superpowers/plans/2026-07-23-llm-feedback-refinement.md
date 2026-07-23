# LLM-Feedback-Refinement (#7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nach einer Transkription kann der Nutzer pro Karte in Prosa Feedback ans Modell geben; das Modell erzeugt iterativ eine neue Gesamtversion, ein Schritt zurücknehmbar.

**Architecture:** Reiner `refine.ts` baut aus (Original + Feedback-Verlauf + neuem Feedback) ein Multi-Turn-Chat-Messages-Array. Eine dünne `VisionClient.refineStream` streamt es text-only (teilt einen extrahierten `streamChat`-Kern mit `transcribeTextStream`). Der Karten-Zustand bekommt einen `refine`-Substate (reitet auf dem CardCache); die View rendert eine Refine-Zeile auf `done`/`written`-Transkript-Karten und streamt die neue Version in einen Draft, committet erst bei Erfolg.

**Tech Stack:** TypeScript (strict, noImplicitAny) · esbuild · vitest + happy-dom · Obsidian Plugin API · OpenAI-kompatibler Chat-Completions-Endpoint.

## Global Constraints

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen.
- **Reiner Kern obsidian-frei:** `refine.ts`, `img_to_md_state.ts`, `vision_client.ts`, `i18n.ts` importieren **nie** `obsidian`/DOM.
- **i18n:** jeder nutzersichtbare String über `t()` aus `i18n.ts`, EN kanonisch, EN **und** DE pflegen (Paritätstest `tests/i18n.test.ts` prüft deckungsgleiche Keys). Modell-facing Prompt ebenfalls in `i18n.ts` (wie `pdf.textLayerPrompt`).
- **UI-STANDARD:** nur Obsidian-native Elemente + Theme-CSS-Variablen; keine Farb-Literale.
- **Thinking-Toggle-Invariante:** an jeder Request-Call-Site `effectiveSuppress(model, suppressThinking)` statt des rohen Flags.
- **Commits:** Conventional Commits, deutsche Beschreibung erlaubt, **nur berührte Dateien stagen**, Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Gate nach jeder Task:** `npm test` grün, `npm run typecheck` grün, `npm run lint` grün.

---

## Task 1: Reiner Kern `refine.ts` — Multi-Turn-Messages bauen

**Files:**
- Create: `src/refine.ts`
- Test: `tests/refine.test.ts`

**Interfaces:**
- Produces:
  - `interface RefineStep { feedback: string; text: string }`
  - `interface ChatMessage { role: "system" | "user" | "assistant"; content: string }`
  - `function buildRefineMessages(base: string, steps: RefineStep[], feedback: string, systemPrompt: string): ChatMessage[]`

- [ ] **Step 1: Write the failing test**

```ts
// tests/refine.test.ts
import { describe, it, expect } from "vitest";
import { buildRefineMessages } from "../src/refine";

const SYS = "SYSTEM";

describe("buildRefineMessages", () => {
  it("Runde 1 (leerer Verlauf): System + eine User-Message mit Feedback + Basistext", () => {
    const msgs = buildRefineMessages("BASIS", [], "Tabellen als GFM", SYS);
    expect(msgs).toEqual([
      { role: "system", content: "SYSTEM" },
      { role: "user", content: "Tabellen als GFM\n\n---\n\nBASIS" },
    ]);
  });

  it("Runde 2: erste Runde als user/assistant, neues Feedback als letzte User-Message", () => {
    const msgs = buildRefineMessages("BASIS", [{ feedback: "f1", text: "v1" }], "f2", SYS);
    expect(msgs).toEqual([
      { role: "system", content: "SYSTEM" },
      { role: "user", content: "f1\n\n---\n\nBASIS" },
      { role: "assistant", content: "v1" },
      { role: "user", content: "f2" },
    ]);
  });

  it("Runde 3: alterniert korrekt, Basistext nur an der ersten User-Message", () => {
    const msgs = buildRefineMessages("BASIS", [
      { feedback: "f1", text: "v1" },
      { feedback: "f2", text: "v2" },
    ], "f3", SYS);
    expect(msgs).toEqual([
      { role: "system", content: "SYSTEM" },
      { role: "user", content: "f1\n\n---\n\nBASIS" },
      { role: "assistant", content: "v1" },
      { role: "user", content: "f2" },
      { role: "assistant", content: "v2" },
      { role: "user", content: "f3" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/refine.test.ts`
Expected: FAIL — `buildRefineMessages` (bzw. `../src/refine`) nicht gefunden.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/refine.ts
// Reiner Kern: baut aus (Original + Feedback-Verlauf + neuem Feedback) ein Multi-Turn-Chat-
// Messages-Array für die iterative Nachbesserung. Obsidian-/DOM-frei (PROF-OBS-03/04).
// Der Basistext hängt bewusst nur an der ERSTEN User-Message; die Assistant-Turns sind die
// bisherigen Versionen — so bekommt das Modell den Verlauf in genau der Form, auf die
// Chat-Completions trainiert sind (keine flachgeklopfte Inline-Historie).

export interface RefineStep { feedback: string; text: string; }
export interface ChatMessage { role: "system" | "user" | "assistant"; content: string; }

export function buildRefineMessages(base: string, steps: RefineStep[], feedback: string, systemPrompt: string): ChatMessage[] {
  const msgs: ChatMessage[] = [{ role: "system", content: systemPrompt }];
  const firstFeedback = steps.length ? steps[0].feedback : feedback;
  msgs.push({ role: "user", content: `${firstFeedback}\n\n---\n\n${base}` });
  for (let k = 0; k < steps.length; k++) {
    msgs.push({ role: "assistant", content: steps[k].text });
    const nextFeedback = k + 1 < steps.length ? steps[k + 1].feedback : feedback;
    msgs.push({ role: "user", content: nextFeedback });
  }
  return msgs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/refine.test.ts`
Expected: PASS (3 Tests).

- [ ] **Step 5: Commit**

```bash
git add src/refine.ts tests/refine.test.ts
git commit -m "feat(refine): reiner Multi-Turn-Messages-Builder für #7

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: i18n-Strings (Refine-System-Prompt + UI, EN/DE)

**Files:**
- Modify: `src/i18n.ts` (EN-Dict ab Zeile 20, DE-Dict ab Zeile 177)
- Test: `tests/i18n.test.ts`

**Interfaces:**
- Produces (Keys, über `t()` abrufbar in beiden Sprachen):
  - `refine.systemPrompt` · `view.refine` · `view.refinePlaceholder` · `view.refineUndo` · `view.refineEmpty`

- [ ] **Step 1: Write the failing test**

```ts
// tests/i18n.test.ts — neuer Block, ans Ende der Datei (vor der letzten `});` NICHT nötig; eigener describe)
import { setLang, t } from "../src/i18n";   // falls noch nicht importiert: bestehende Imports nutzen

describe("Refine-Keys (#7) EN/DE", () => {
  it("Modell-Prompt + UI-Strings sind in beiden Sprachen nicht leer", () => {
    for (const lang of ["en", "de"] as const) {
      setLang(lang);
      for (const k of ["refine.systemPrompt", "view.refine", "view.refinePlaceholder", "view.refineUndo", "view.refineEmpty"]) {
        expect(t(k).length, `${lang}:${k}`).toBeGreaterThan(0);
        expect(t(k), `${lang}:${k}`).not.toBe(k);   // kein roher Key-Fallback
      }
    }
    setLang("en");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/i18n.test.ts -t "Refine-Keys"`
Expected: FAIL — `t("refine.systemPrompt")` gibt den rohen Key zurück (`.not.toBe(k)` schlägt fehl).

- [ ] **Step 3: Write minimal implementation**

Im **EN**-Dict (`const EN: Dict = {`, nach `"view.thisFile": "this file",` bei Zeile ~145) einfügen:

```ts
  "refine.systemPrompt": "You revise a Markdown document according to the user's instruction. Always output the complete revised document, only the document — no preamble, no commentary.",
  "view.refine": "Refine",
  "view.refinePlaceholder": "Feedback, e.g. tables as GFM",
  "view.refineUndo": "Undo last refinement",
  "view.refineEmpty": "No revision returned",
```

Im **DE**-Dict (`const DE: Dict = {`, an der entsprechenden Stelle, z. B. nach `"view.thisFile": "diese Datei",`) einfügen:

```ts
  "refine.systemPrompt": "Du überarbeitest ein Markdown-Dokument gemäß der Anweisung des Nutzers. Gib immer die vollständige überarbeitete Fassung aus, nur das Dokument — keine Vorrede, kein Kommentar.",
  "view.refine": "Nachbessern",
  "view.refinePlaceholder": "Feedback, z. B. Tabellen als GFM",
  "view.refineUndo": "Letzte Nachbesserung rückgängig",
  "view.refineEmpty": "Keine Überarbeitung erhalten",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/i18n.test.ts`
Expected: PASS — der neue Block **und** der bestehende Paritätstest „EN/DE-Schlüssel sind deckungsgleich" bleiben grün.

- [ ] **Step 5: Commit**

```bash
git add src/i18n.ts tests/i18n.test.ts
git commit -m "feat(i18n): Refine-System-Prompt + UI-Strings (EN/DE) für #7

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Karten-Zustand — `refine`-Substate + Übergänge

**Files:**
- Modify: `src/img_to_md_state.ts` (Interface `ImgCard` ab Zeile 20; Klasse `ImgToMdState`; Ende der Datei für Helfer)
- Test: `tests/img_to_md_state.test.ts`

**Interfaces:**
- Consumes: `RefineStep` aus `./refine` (Task 1).
- Produces:
  - `ImgCard.refine?: { base: string; steps: RefineStep[] }`
  - `ImgToMdState.commitRefine(i: number, feedback: string, text: string): void`
  - `ImgToMdState.undoRefine(i: number): void`
  - `function canRefine(card: ImgCard): boolean`
  - `function canUndo(card: ImgCard): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// tests/img_to_md_state.test.ts — neuer describe-Block; Import oben ergänzen:
// import { ImgToMdState, ImgItem, ImgCard, partitionDoneCards, actualModel, canRefine, canUndo } from "../src/img_to_md_state";
import { canRefine, canUndo } from "../src/img_to_md_state";

describe("ImgToMdState — Refine (#7)", () => {
  function doneCard(): ImgToMdState {
    const s = new ImgToMdState();
    s.setItems([{ raw: "![[a.png]]", link: "a.png", ext: "png", supported: true, kind: "image" }]);
    s.startCards();
    s.appendContent(0, "v0");
    s.setDone(0);   // status "done", text "v0", mode undefined (Transkript)
    return s;
  }

  it("commitRefine erste Runde: base=vorige Version, ein Step, text=neu, Status done", () => {
    const s = doneCard();
    s.commitRefine(0, "f1", "v1");
    expect(s.cards[0].refine).toEqual({ base: "v0", steps: [{ feedback: "f1", text: "v1" }] });
    expect(s.cards[0].text).toBe("v1");
    expect(s.cards[0].status).toBe("done");
  });

  it("commitRefine zweite Runde: base bleibt Original, Steps akkumulieren", () => {
    const s = doneCard();
    s.commitRefine(0, "f1", "v1");
    s.commitRefine(0, "f2", "v2");
    expect(s.cards[0].refine!.base).toBe("v0");
    expect(s.cards[0].refine!.steps).toEqual([{ feedback: "f1", text: "v1" }, { feedback: "f2", text: "v2" }]);
    expect(s.cards[0].text).toBe("v2");
  });

  it("undoRefine: ein Schritt zurück auf vorige Version", () => {
    const s = doneCard();
    s.commitRefine(0, "f1", "v1");
    s.commitRefine(0, "f2", "v2");
    s.undoRefine(0);
    expect(s.cards[0].text).toBe("v1");
    expect(s.cards[0].refine!.steps).toEqual([{ feedback: "f1", text: "v1" }]);
  });

  it("undoRefine bis zum Original: Text=base, refine entfernt", () => {
    const s = doneCard();
    s.commitRefine(0, "f1", "v1");
    s.undoRefine(0);
    expect(s.cards[0].text).toBe("v0");
    expect(s.cards[0].refine).toBeUndefined();
  });

  it("commitRefine auf written-Karte setzt Status zurück auf done (erneut schreibbar)", () => {
    const s = doneCard();
    s.markWritten(0, "note.md");
    expect(s.cards[0].status).toBe("written");
    s.commitRefine(0, "f1", "v1");
    expect(s.cards[0].status).toBe("done");
    expect(s.cards[0].writtenPath).toBe("note.md");   // Pfad bleibt für idempotentes Re-Write
  });

  it("canRefine: done/written-Transkript ja, Beschreiben-Karte nein, streaming nein", () => {
    const s = doneCard();
    expect(canRefine(s.cards[0])).toBe(true);
    s.markWritten(0, "n.md");
    expect(canRefine(s.cards[0])).toBe(true);
    const desc: ImgCard = { ...s.cards[0], status: "done", mode: "description" };
    expect(canRefine(desc)).toBe(false);
    const streaming: ImgCard = { ...s.cards[0], status: "streaming" };
    expect(canRefine(streaming)).toBe(false);
  });

  it("canUndo: nur mit mindestens einem Step", () => {
    const s = doneCard();
    expect(canUndo(s.cards[0])).toBe(false);
    s.commitRefine(0, "f1", "v1");
    expect(canUndo(s.cards[0])).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/img_to_md_state.test.ts -t "Refine"`
Expected: FAIL — `commitRefine`/`canRefine`/`canUndo` nicht definiert.

- [ ] **Step 3: Write minimal implementation**

In `src/img_to_md_state.ts` oben den Import ergänzen (Zeile 2 nach dem bestehenden `describe`-Import-Bereich):

```ts
import type { RefineStep } from "./refine";
```

Im `ImgCard`-Interface (nach `tags?: string[];`, Zeile ~33) ergänzen:

```ts
  /** In-Session-Nachbesserungs-Verlauf (#7). base = Original-Version, steps = je Runde
   *  Feedback + Ergebnis. Aktuelle Version = card.text (Spiegel). Reitet auf dem CardCache. */
  refine?: { base: string; steps: RefineStep[] };
```

In der Klasse `ImgToMdState` (z. B. nach `resetCard`, Zeile ~113) einfügen:

```ts
  /** Committet eine erfolgreiche Nachbesserung: setzt beim ersten Mal die Basis (die vorige
   *  Version — card.text wurde während des Streamens NICHT mutiert, siehe View-Draft), hängt
   *  {feedback, text} an und macht die neue Version zur aktuellen. Status → done, damit eine
   *  zuvor geschriebene Karte erneut geschrieben werden kann (writtenPath bleibt für Idempotenz). */
  commitRefine(i: number, feedback: string, text: string): void {
    const c = this.cards[i]; if (!c) return;
    if (!c.refine) c.refine = { base: c.text, steps: [] };
    c.refine.steps.push({ feedback, text });
    c.text = text;
    c.status = "done";
  }

  /** Ein Schritt zurück: entfernt die letzte Runde, stellt die vorige Version her. Ohne Steps
   *  wird refine ganz entfernt (Text = Basis). Status bleibt done (erneut schreibbar). */
  undoRefine(i: number): void {
    const c = this.cards[i]; const r = c?.refine; if (!c || !r || !r.steps.length) return;
    r.steps.pop();
    c.text = r.steps.length ? r.steps[r.steps.length - 1].text : r.base;
    c.status = "done";
    if (!r.steps.length) c.refine = undefined;
  }
```

Am Dateiende (nach `actualModel`, Zeile ~124) die reinen Prädikate ergänzen:

```ts
/** Ob eine Karte nachbesserbar ist (#7): Transkript-Karte (nicht Beschreiben) mit fertigem
 *  bzw. geschriebenem Ergebnis. Streaming/Fehler-Karten sind es nicht. */
export function canRefine(card: ImgCard): boolean {
  return card.mode !== "description" && (card.status === "done" || card.status === "written");
}

/** Ob ein Zurück-Schritt möglich ist: mindestens eine committete Nachbesserung. */
export function canUndo(card: ImgCard): boolean {
  return !!card.refine && card.refine.steps.length >= 1;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/img_to_md_state.test.ts`
Expected: PASS — neuer Refine-Block + alle bestehenden State-Tests grün.

- [ ] **Step 5: Commit**

```bash
git add src/img_to_md_state.ts tests/img_to_md_state.test.ts
git commit -m "feat(state): refine-Substate + commit/undo/Prädikate für #7

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `VisionClient.refineStream` (+ `streamChat`-Extraktion)

**Files:**
- Modify: `src/vision_client.ts` (Klasse `VisionClient`, `transcribeTextStream` ab Zeile 144)
- Test: `tests/vision_client.test.ts`

**Interfaces:**
- Produces:
  - `VisionClient.refineStream(messages: unknown[], onContent: (t: string) => void, onReasoning: (t: string) => void, signal?: AbortSignal, opts?: { suppressThinking?: boolean }): Promise<{ content: string; reasoning: string; model: string }>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/vision_client.test.ts — neuer describe-Block (nutzt die bereits vorhandenen Helfer
// streamRes/setStreamFetch aus dieser Datei).
describe("VisionClient.refineStream (text-only Multi-Turn)", () => {
  it("schickt das übergebene Messages-Array unverändert, stream:true, kein image_url", async () => {
    const calls: { body?: string }[] = [];
    setStreamFetch((_u, init) => { calls.push({ body: init?.body as string }); return Promise.resolve(streamRes(['data: {"model":"m","choices":[{"delta":{"content":"# A"}}]}\n\ndata: [DONE]\n\n'])); });
    const msgs = [
      { role: "system", content: "SYS" },
      { role: "user", content: "f1\n\n---\n\nBASIS" },
    ];
    const got: string[] = [];
    const r = await new VisionClient("http://x", "vm").refineStream(msgs, t => got.push(t), () => {});
    expect(got).toEqual(["# A"]);
    expect(r).toEqual({ content: "# A", reasoning: "", model: "m" });
    const body = JSON.parse(calls[0].body!) as { messages: unknown; stream: boolean };
    expect(body.stream).toBe(true);
    expect(body.messages).toEqual(msgs);
  });
  it("wirft Servermeldung bei 200-Error-Body", async () => {
    setStreamFetch(() => Promise.resolve(streamRes(['{"error":{"message":"boom"}}'])));
    await expect(new VisionClient("http://x", "vm").refineStream([{ role: "user", content: "x" }], () => {}, () => {})).rejects.toThrow("boom");
  });
  it("wirft bei HTTP-Fehler", async () => {
    setStreamFetch(() => Promise.resolve(streamRes([], false, 500)));
    await expect(new VisionClient("http://x", "vm").refineStream([{ role: "user", content: "x" }], () => {}, () => {})).rejects.toThrow("500");
  });
  it("Fallback auf Konstruktor-Modell ohne model im Stream", async () => {
    setStreamFetch(() => Promise.resolve(streamRes(['data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n\n'])));
    const r = await new VisionClient("http://x", "vm").refineStream([{ role: "user", content: "x" }], () => {}, () => {});
    expect(r.model).toBe("vm");
  });
  it("suppressThinking=true → Suppress-Params im Body", async () => {
    const calls: { body?: string }[] = [];
    setStreamFetch((_u, init) => { calls.push({ body: init?.body as string }); return Promise.resolve(streamRes(['data: [DONE]\n\n'])); });
    await new VisionClient("http://x", "vm").refineStream([{ role: "user", content: "x" }], () => {}, () => {}, undefined, { suppressThinking: true });
    expect(JSON.parse(calls[0].body!)).toMatchObject({ reasoning_effort: "none", chat_template_kwargs: { enable_thinking: false }, reasoning_budget: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/vision_client.test.ts -t "refineStream"`
Expected: FAIL — `refineStream` nicht definiert.

- [ ] **Step 3: Write minimal implementation**

In `src/vision_client.ts` die bestehende `transcribeTextStream`-Methode (Zeile 144–163) durch den extrahierten Kern + zwei dünne Delegationen ersetzen:

```ts
  /** Gemeinsamer Streaming-Kern für die text-basierten Calls (transcribeTextStream + refineStream):
   *  serialisiert ein beliebiges Messages-Array, streamt via SSE, hebt einen 200-Error-Body als echte
   *  Servermeldung. Der multimodale transcribeStream bleibt eigenständig (image_url-Content). */
  private async streamChat(
    messages: unknown[],
    onContent: (t: string) => void, onReasoning: (t: string) => void,
    signal?: AbortSignal, opts?: { suppressThinking?: boolean },
  ): Promise<{ content: string; reasoning: string; model: string }> {
    if (!streamFn) throw new Error("VisionClient: Stream-Transport nicht konfiguriert (setStreamFetch aufrufen)");
    const res = await streamFn(`${this.endpoint}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, messages, stream: true, ...suppressParams(opts?.suppressThinking ?? false) }),
      signal,
    });
    if (!res.ok) throw new Error(`Vision HTTP ${res.status}`);
    const r = await streamSSE(res, onContent, onReasoning);
    if (!r.content.trim() && !/^\s*data:/m.test(r.raw)) {
      const envelope = parseErrorEnvelope(r.raw);
      if (envelope) throw new Error(envelope);
    }
    return { content: r.content, reasoning: r.reasoning, model: r.model || this.model };
  }

  /** Wie transcribeStream, aber sendet reinen TEXT (kein Bild) — für born-digital PDF-Seiten, deren
   *  exakter Text-Layer extrahiert und vom Modell nur nach Markdown formatiert wird. */
  async transcribeTextStream(
    text: string, prompt: string,
    onContent: (t: string) => void, onReasoning: (t: string) => void,
    signal?: AbortSignal, opts?: { suppressThinking?: boolean },
  ): Promise<{ content: string; reasoning: string; model: string }> {
    return this.streamChat([{ role: "user", content: `${prompt}\n\n${text}` }], onContent, onReasoning, signal, opts);
  }

  /** Iterative Nachbesserung (#7): streamt ein fertig gebautes Multi-Turn-Messages-Array (System +
   *  Original/Feedback-Verlauf), text-only. Das Array baut der reine refine.ts::buildRefineMessages. */
  async refineStream(
    messages: unknown[],
    onContent: (t: string) => void, onReasoning: (t: string) => void,
    signal?: AbortSignal, opts?: { suppressThinking?: boolean },
  ): Promise<{ content: string; reasoning: string; model: string }> {
    return this.streamChat(messages, onContent, onReasoning, signal, opts);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/vision_client.test.ts`
Expected: PASS — neuer `refineStream`-Block **und** die bestehenden `transcribeTextStream`-Tests (unveränderter Body/Fehlerpfad durch `streamChat`) grün.

- [ ] **Step 5: Commit**

```bash
git add src/vision_client.ts tests/vision_client.test.ts
git commit -m "feat(vision): refineStream + streamChat-Kern (DRY mit transcribeTextStream) für #7

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: View-Deps-Interface + `main.ts`-Verdrahtung (`refine`-Dep)

**Files:**
- Modify: `src/img_to_md_view.ts` (Interface `ImgToMdViewDeps`, Zeile 40–69)
- Modify: `src/main.ts` (Import-Block Zeile 1–17; `makeImgViewDeps`, Zeile 119–274)
- Modify: `tests/img_to_md_view.test.ts` (`mkView`-Deps-Default, Zeile ~22–46)

**Interfaces:**
- Consumes: `buildRefineMessages` (Task 1), `VisionClient.refineStream` (Task 4), `t("refine.systemPrompt")` (Task 2), `effectiveSuppress` (vorhanden).
- Produces (auf `ImgToMdViewDeps`):
  - `refine: (base: string, steps: { feedback: string; text: string }[], feedback: string, onContent: (t: string) => void, onReasoning: (t: string) => void, signal: AbortSignal) => Promise<{ content: string; reasoning: string; model: string }>`

- [ ] **Step 1: Interface um die Dep erweitern**

In `src/img_to_md_view.ts` im Interface `ImgToMdViewDeps` (nach der `describeStream`-Zeile, ~54) einfügen:

```ts
  /** Iterative Nachbesserung einer Transkript-Karte (#7): baut (in main.ts) aus base + steps +
   *  feedback das Multi-Turn-Messages-Array und streamt es text-only. Modell/Endpoint/Suppress
   *  kommen aus den Settings — die View gibt nur Verlauf + neues Feedback + Stream-Callbacks. */
  refine: (base: string, steps: { feedback: string; text: string }[], feedback: string, onContent: (t: string) => void, onReasoning: (t: string) => void, signal: AbortSignal) => Promise<{ content: string; reasoning: string; model: string }>;
```

- [ ] **Step 2: `main.ts` — Import + Dep-Implementierung**

Im Import-Block von `src/main.ts` (nach Zeile 11 `import { buildDescribePrompt } from "./describe";`) ergänzen:

```ts
import { buildRefineMessages } from "./refine";
```

In `makeImgViewDeps()` (nach dem `describeStream`-Dep-Block, vor `getTaxonomy:`, ~Zeile 248) einfügen:

```ts
      refine: async (base, steps, feedback, onContent, onReasoning, signal) => {
        const messages = buildRefineMessages(base, steps, feedback, t("refine.systemPrompt"));
        const opts = { suppressThinking: effectiveSuppress(this.settings.visionModel, this.settings.suppressThinking) };
        try {
          return await this.visionClient.refineStream(messages, onContent, onReasoning, signal, opts);
        } catch (err) {
          await this.resolveAndReconnect();
          if (this.activeEndpoint) return this.visionClient.refineStream(messages, onContent, onReasoning, signal, opts);
          throw err;
        }
      },
```

- [ ] **Step 3: Test-`mkView` um einen Default für die neue Dep erweitern**

In `tests/img_to_md_view.test.ts` in `mkView` (im `deps`-Objekt, z. B. nach der `describeStream`-Default-Zeile) ergänzen — Default liefert eine feste „verbesserte" Version:

```ts
    refine: over.refine ?? (async (_base: string, _steps: any[], _fb: string, onContent: any) => { onContent("VERBESSERT"); return { content: "VERBESSERT", reasoning: "", model: "vm" }; }),
```

- [ ] **Step 4: Typecheck + bestehende Tests**

Run: `npm run typecheck && npx vitest run tests/img_to_md_view.test.ts`
Expected: PASS — `ImgToMdViewDeps` ist überall (main.ts + Test-mkView) erfüllt, bestehende View-Tests grün.

- [ ] **Step 5: Commit**

```bash
git add src/img_to_md_view.ts src/main.ts tests/img_to_md_view.test.ts
git commit -m "feat(view): refine-Dep im Interface + main.ts-Verdrahtung für #7

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: View-UI — Refine-Zeile, Draft-Streaming, Undo, written→done-Cleanup

**Files:**
- Modify: `src/img_to_md_view.ts` (`CardRefs` Zeile 22–38; View-Felder Zeile 71–97; `updateCard` Zeile 355–463; neue Methode `refineCard`)
- Modify: `styles.css` (nach den `.img2md-card-actions`-Regeln, Zeile ~42)
- Test: `tests/img_to_md_view.test.ts`

**Interfaces:**
- Consumes: `canRefine`, `canUndo` (Task 3); `refine`-Dep (Task 5); i18n-Keys (Task 2).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/img_to_md_view.test.ts — neuer describe-Block. Nutzt mkView (Task 5) + den all()-Helfer.
// Import oben ergänzen: import { canRefine } from "../src/img_to_md_state";  (nur falls direkt genutzt)
describe("Refine-Zeile (#7)", () => {
  async function runToDone(over: any = {}) {
    const { view, deps, calls } = mkView(over);
    await view.onOpen();
    (view as any).state.toggleAll();          // nur a.png bleibt wählbar (b.heic unsupported)
    (view as any).state.toggle("a.png");      // a.png sicher an
    await (view as any).run();                // transcribeStream-Default → "Hallo", done
    return { view, deps, calls };
  }

  it("done-Transkript-Karte zeigt Feedback-Eingabe + Nachbessern-Button", async () => {
    const { view } = await runToDone();
    const root = (view as any).contentEl;
    expect(all(root, "img2md-refine-input").length).toBe(1);
    expect(all(root, "img2md-refine-submit").length).toBe(1);
  });

  it("Beschreiben-Karte zeigt KEINE Refine-Zeile", async () => {
    const { view } = await runToDone({ initialMode: "describe" });
    const root = (view as any).contentEl;
    expect(all(root, "img2md-refine-input").length).toBe(0);
  });

  it("refineCard committet die neue Version in card.text (Draft → Commit)", async () => {
    const { view } = await runToDone();
    await (view as any).refineCard(0, "Tabellen als GFM");
    expect((view as any).state.cards[0].text).toBe("VERBESSERT");
    expect((view as any).state.cards[0].refine.steps).toEqual([{ feedback: "Tabellen als GFM", text: "VERBESSERT" }]);
  });

  it("leeres Feedback → kein Refine-Aufruf, Karte unverändert", async () => {
    const refine = vi.fn();
    const { view } = await runToDone({ refine });
    await (view as any).refineCard(0, "   ");
    expect(refine).not.toHaveBeenCalled();
    expect((view as any).state.cards[0].text).toBe("Hallo");
  });

  it("Fehler beim Refine lässt die aktuelle Version intakt", async () => {
    const { view } = await runToDone({ refine: async () => { throw new Error("boom"); } });
    await (view as any).refineCard(0, "mach was");
    expect((view as any).state.cards[0].text).toBe("Hallo");   // unverändert
    expect((view as any).state.cards[0].refine).toBeUndefined();
  });

  it("Undo-Button erscheint nach einem Refine und stellt die vorige Version her", async () => {
    const { view } = await runToDone();
    await (view as any).refineCard(0, "f1");
    const root = (view as any).contentEl;
    expect(all(root, "img2md-refine-undo").length).toBe(1);
    (view as any).undoRefine(0);
    expect((view as any).state.cards[0].text).toBe("Hallo");
  });

  it("Refine einer geschriebenen Karte: Status zurück auf done (writeBtn wieder da), written-Zeile weg", async () => {
    const { view } = await runToDone();
    await (view as any).writeOne(0);
    expect((view as any).state.cards[0].status).toBe("written");
    await (view as any).refineCard(0, "f1");
    expect((view as any).state.cards[0].status).toBe("done");
    const root = (view as any).contentEl;
    expect(all(root, "img2md-written").length).toBe(0);       // stale „✓ created" entfernt
    expect(all(root, "img2md-write").length).toBe(1);         // erneut schreibbar
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/img_to_md_view.test.ts -t "Refine-Zeile"`
Expected: FAIL — `img2md-refine-input` nicht vorhanden / `refineCard`/`undoRefine` nicht definiert.

- [ ] **Step 3: Implementierung — `CardRefs`, View-Felder, `refineCard`/`undoRefine`, `updateCard`-Block, Cleanup**

(a) In `src/img_to_md_view.ts` Import erweitern (Zeile 2):

```ts
import { ImgToMdState, ImgItem, PdfGroup, partitionDoneCards, actualModel, canRefine, canUndo } from "./img_to_md_state";
```

(b) `CardRefs` (Zeile 22–38) um Refine-Knoten ergänzen (vor `liveWas: boolean;`):

```ts
  refineRow?: HTMLElement;
  refineInput?: HTMLInputElement;
  refineSubmit?: HTMLButtonElement;
  refineUndo?: HTMLButtonElement;
  refineErrEl?: HTMLElement;
```

(c) View-Felder (nach `private cardEls: CardRefs[] = [];`, Zeile 83) ergänzen:

```ts
  /** Transiente, nicht-committete Refine-Streams je Karten-Index (Live-Anzeige; card.text bleibt
   *  bis zum Commit die alte Version). */
  private refineDrafts = new Map<number, string>();
  /** Transiente Refine-Fehlermeldung je Karten-Index (bis zum nächsten Versuch/Erfolg). */
  private refineErrors = new Map<number, string>();
```

(d) Im `updateCard` den Text-Block (Zeile 393–396) so ändern, dass ein laufender Draft angezeigt wird:

```ts
    // Transkript-Text (lazy, inkrementell) — während einer Nachbesserung der Draft (card.text bleibt
    // bis zum Commit die alte Version).
    const shownText = this.refineDrafts.has(i) ? this.refineDrafts.get(i)! : card.text;
    if (shownText) {
      if (!refs.textEl) refs.textEl = cardEl.createDiv({ cls: "img2md-text" });
      refs.textEl.setText(shownText);
    }
```

(e) Im `updateCard` die stale „written"-Zeile entfernen, sobald der Status nicht mehr `written` ist — direkt VOR dem bestehenden `if (card.status === "written" && !refs.writtenEl)`-Block (Zeile ~407) einfügen:

```ts
    // Nach einem Refine einer geschriebenen Karte (written → done) ist die „✓ created"-Zeile stale.
    if (card.status !== "written" && refs.writtenEl) { refs.writtenEl.remove(); refs.writtenEl = undefined; }
```

(f) Im `updateCard` den Refine-Zeilen-Block einfügen — direkt VOR dem Aktionen-Block `if (card.text) {` (Zeile ~439), damit „Nachbessern" über „Notiz anlegen" steht:

```ts
    // Refine-Zeile (#7): nur Transkript-Karten (done/written). Feedback-Eingabe + Nachbessern + Undo.
    if (canRefine(card)) {
      if (!refs.refineRow) {
        const row = cardEl.createDiv({ cls: "img2md-refine-row" });
        const input = row.createEl("input", { cls: "img2md-refine-input", attr: { placeholder: t("view.refinePlaceholder"), "aria-label": t("view.refine") } });
        input.type = "text";
        const submit = row.createEl("button", { cls: "img2md-refine-submit", text: t("view.refine") });
        submit.addEventListener("click", () => { const v = input.value; input.value = ""; void this.refineCard(i, v); });
        input.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") { const v = input.value; input.value = ""; void this.refineCard(i, v); } });
        const undo = row.createEl("button", { cls: "img2md-refine-undo clickable-icon", attr: { "aria-label": t("view.refineUndo"), title: t("view.refineUndo") } });
        setIcon(undo, "undo-2");
        undo.addEventListener("click", () => this.undoRefine(i));
        refs.refineRow = row; refs.refineInput = input; refs.refineSubmit = submit; refs.refineUndo = undo;
      }
      // Undo nur mit Verlauf; Eingabe/Buttons während irgendeines Laufs sperren.
      refs.refineUndo!.toggleClass("is-hidden", !canUndo(card));
      const locked = this.running;
      refs.refineInput!.disabled = locked;
      refs.refineSubmit!.disabled = locked;
      refs.refineUndo!.toggleClass("is-disabled", locked);
      // Transiente Fehlermeldung (lazy an/aus).
      const err = this.refineErrors.get(i);
      if (err) {
        if (!refs.refineErrEl) refs.refineErrEl = refs.refineRow.createDiv({ cls: "img2md-refine-error" });
        refs.refineErrEl.setText(err);
      } else if (refs.refineErrEl) { refs.refineErrEl.remove(); refs.refineErrEl = undefined; }
    }
```

(g) Neue Methoden nach `retryAll()` (Zeile ~523) einfügen:

```ts
  /** Nachbessern einer Transkript-Karte (#7): streamt die neue Version in einen Draft (card.text
   *  bleibt bis zum Commit die alte Version), committet nur bei nicht-leerem Erfolg. Bei Fehler
   *  bleibt die aktuelle Version intakt; die Meldung erscheint transient an der Karte. */
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
    const steps = (card.refine?.steps ?? []).map(s => ({ feedback: s.feedback, text: s.text }));
    this.refineDrafts.set(i, "");
    this.updateAllCards();   // Eingabe sperren, writeBtn (this.running) entfernen
    try {
      const r = await this.deps.refine(
        base, steps, fb,
        (t) => { this.refineDrafts.set(i, (this.refineDrafts.get(i) ?? "") + t); this.updateCard(i); },
        () => {},   // Reasoning während Refine bewusst nicht angezeigt (v1)
        signal,
      );
      if (!signal.aborted) {
        if (r.content.trim()) { card.model = r.model; this.state.commitRefine(i, fb, r.content); }
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

  /** Ein Schritt zurück (#7): stellt die vorige Version her (reiner State), rendert neu. */
  undoRefine(i: number): void {
    if (this.running) return;
    this.state.undoRefine(i);
    this.refineErrors.delete(i);
    this.updateAllCards();
  }
```

(h) In `styles.css` (nach den `.img2md-write*`-Regeln, ~Zeile 47) minimale Theme-treue Regeln ergänzen:

```css
.img2md-refine-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 6px; }
.img2md-refine-input { flex: 1 1 120px; min-width: 0; font-size: 12px; }
.img2md-refine-submit { font-size: 12px; }
.img2md-refine-undo.is-hidden { display: none; }
.img2md-refine-undo.is-disabled { opacity: 0.5; pointer-events: none; }
.img2md-refine-error { flex-basis: 100%; font-size: 12px; color: var(--text-error); }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/img_to_md_view.test.ts`
Expected: PASS — der `Refine-Zeile`-Block + alle bestehenden View-Tests grün.

- [ ] **Step 5: Full gate + commit**

Run: `npm test && npm run typecheck && npm run lint`
Expected: alle grün.

```bash
git add src/img_to_md_view.ts styles.css tests/img_to_md_view.test.ts
git commit -m "feat(view): Refine-Zeile mit Draft-Streaming, Undo + written→done-Cleanup für #7

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Build-Verifikation + CHANGELOG

**Files:**
- Modify: `CHANGELOG.md` (Abschnitt `[Unreleased]`)

**Interfaces:** keine.

- [ ] **Step 1: Vollständiges Gate + Build**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: alle grün; `main.js` gebaut (gitignored).

- [ ] **Step 2: CHANGELOG-Eintrag unter `[Unreleased]`**

```markdown
### Added
- **LLM-Feedback-Refinement (#7):** Transkript-Karten in der Sidebar per Prosa-Feedback iterativ nachbessern („Tabellen als GFM", „Überschriften-Ebene falsch"). Konversationeller Verlauf pro Karte (das Modell sieht Original + bisherige Runden), ein Schritt zurücknehmbar; text-only, funktioniert auch nach dem Schreiben (erneutes Schreiben via bestehendem Diff-Gate).
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): LLM-Feedback-Refinement (#7) unter [Unreleased]

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (Plan gegen Spec)

**Spec-Coverage:**
- Iterativer Verlauf → Task 1 (Messages), Task 3 (`refine.steps`). ✓
- Nur Text → Task 4 (`refineStream` text-only, kein `image_url`). ✓
- Nur Transkript-Karten → Task 3 (`canRefine` schließt `mode==="description"` aus), Task 6 (Zeile nur bei `canRefine`). ✓
- Refine auch nach dem Schreiben (written→done, Diff-Gate) → Task 3 (`commitRefine` setzt `done`, behält `writtenPath`), Task 6 (written-Cleanup + writeBtn), bestehendes `sessionOwned`-Gate ungeändert (keine neue Schreiblogik). ✓
- Ein-Schritt-Undo → Task 3 (`undoRefine`), Task 6 (Undo-Button). ✓
- „Kein Voll-Chat"-Grenze (kein editierbarer System-Prompt, kein Persist auf Disk, Dialog nicht in Notiz) → System-Prompt fix in i18n (Task 2), Verlauf nur im CardCache (In-Session), keine Notiz-Schreibung des Dialogs. ✓
- Fehler-Semantik (Temp-Puffer, Commit erst bei Erfolg) → Task 6 (`refineDrafts`, Commit nur bei `r.content.trim()`), Task-6-Test „Fehler lässt aktuelle Version intakt". ✓
- Testplan (refine.ts pur, State-Transitionen, refineStream-Spiegel, View-Backstop) → Tasks 1/3/4/6. ✓

**Placeholder-Scan:** keine TBD/TODO; alle Code-Steps mit vollständigem Code. ✓

**Typ-Konsistenz:** `RefineStep`/`ChatMessage` (Task 1) in State (Task 3, `import type`) und View-Dep (Task 5, strukturell gleiche `{feedback,text}[]`) konsistent; `refineStream(messages: unknown[], …)` (Task 4) ↔ `buildRefineMessages(): ChatMessage[]` (Task 1, `ChatMessage[]` ist `unknown[]`-zuweisbar) ↔ main.ts-Aufruf (Task 5). `canRefine`/`canUndo` in Task 3 definiert, in Task 6 importiert/genutzt. ✓
