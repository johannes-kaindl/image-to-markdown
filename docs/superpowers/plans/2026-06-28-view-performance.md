# View-Performance (inkrementelles Karten-Rendering) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Sidebar-View aktualisiert beim Streaming nur die aktive Ergebnis-Karte inkrementell, statt bei jedem Token alle Karten via `el.empty()` neu aufzubauen.

**Architecture:** `renderCards()` (Voll-Render mit `el.empty()`) wird durch zwei Begriffe ersetzt: `resetCards()` (einziger Ort mit `empty()`, beim Neuaufbau/Clear eines Laufs) und das idempotente `updateCard(i)` (synchronisiert den DOM-Teilbaum *einer* Karte auf ihren State; legt Knoten lazy an, setzt Texte via `setText`). Ein `cardEls: CardRefs[]`-Array hält pro Karte die DOM-Referenzen. Der Streaming-Hot-Path ruft nur noch `updateCard(i)`. Weil das Karten-DOM nicht mehr zerstört wird, bleiben reasoning-`<details>`-Toggle und Scroll-Position stabil.

**Tech Stack:** TypeScript (strict), Obsidian Plugin API (`ItemView`), vitest + happy-dom + `obsidian-kit/testing`-Mock, esbuild.

## Global Constraints

- **Reiner View-Schicht-Eingriff:** nur `src/img_to_md_view.ts` + `tests/img_to_md_view.test.ts`. `src/img_to_md.ts`, `src/img_to_md_state.ts`, `styles.css` bleiben **unberührt**.
- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen (`CardRefs` ist voll typisiert).
- **Keine neuen nutzersichtbaren Strings** — `view.thinking` / `view.thoughts` / `view.created` / `view.copyTranscript` / `view.createNote` / `view.error` existieren bereits in `src/i18n.ts`.
- **`minAppVersion` bleibt 1.8.7** — keine neuen Obsidian-APIs.
- **Tests nach jeder Änderung grün:** `npm test`. `npm run typecheck` separat (vitest ≠ tsc). `npm run lint`, `npm run build` müssen sauber bleiben.
- **Commits:** Conventional Commits (deutsche Beschreibung erlaubt), **nur berührte Dateien stagen**, Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Verhaltenserhalt:** das finale DOM nach Streaming/Schreiben ist identisch zu heute (gleiche Klassen, gleiche `textContent`, gleiche Knoten-Existenz) — alle bestehenden View-Tests bleiben unverändert grün.

---

### Task 1: Inkrementelle Render-Architektur (`resetCards` / `updateCard` / `updateAllCards`)

Ersetzt den Voll-Render durch idempotenten Per-Karte-Sync. Reasoning-`<details>.open` wird in diesem Task **nur beim Anlegen** gesetzt (`= live`) und danach nicht mehr angefasst (der einmalige Auto-Collapse beim Übergang zu Content folgt in Task 2). Treiber-Test: die `img2md-card`-Knotenreferenz bleibt über mehrere Content-Deltas identisch (heute baut jeder Token sie neu).

**Files:**
- Modify: `src/img_to_md_view.ts` (ersetzt `renderCards` Z. 179-211; stellt die 8 Aufrufstellen um; fügt `cardEls`-Feld + `CardRefs`-Interface hinzu)
- Test: `tests/img_to_md_view.test.ts` (neuer Test im `describe("ImgToMdView — Transkribieren")`-Block)

**Interfaces:**
- Consumes: `ImgToMdState.cards: ImgCard[]` (Felder `item, index, total, page, text, reasoning, status, error, writtenPath`), `this.deps` (`copyText`, `openPath`), `t()`, `setIcon()`.
- Produces:
  - `interface CardRefs { cardEl: HTMLElement; headEl: HTMLElement; reasoningDet?: HTMLDetailsElement; reasoningSum?: HTMLElement; reasoningBody?: HTMLElement; textEl?: HTMLElement; errorEl?: HTMLElement; writtenEl?: HTMLElement; actionsEl?: HTMLElement; writeBtn?: HTMLElement; }`
  - `private cardEls: CardRefs[]`
  - `private resetCards(): void` — `cardsEl.empty()` + `cardEls = []` + `updateCard(i)` für alle Karten
  - `private updateCard(i: number): void` — idempotenter Per-Karte-Sync
  - `private updateAllCards(): void` — `updateCard(i)` für alle Karten (kein `empty`)

- [ ] **Step 1: Failing test schreiben** — fügt am Ende des `describe("ImgToMdView — Transkribieren")`-Blocks (nach dem letzten `it`, vor der schließenden `});`) ein:

```ts
  it("rendert inkrementell: img2md-card-Knoten bleibt über Content-Deltas identisch", async () => {
    let viewRef: any;
    let sameNode: boolean | null = null;
    const transcribeStream = async (_sp: string, _it: ImgItem, onC: any) => {
      onC("Hal");
      const first = all(viewRef.contentEl, "img2md-card")[0];
      onC("lo");
      const second = all(viewRef.contentEl, "img2md-card")[0];
      sameNode = !!first && first === second;
      return { content: "Hallo", reasoning: "", model: "vm" };
    };
    const v = mkView({ transcribeStream }); viewRef = v.view;
    await v.view.onOpen();
    await v.view.run();
    expect(sameNode).toBe(true);
    expect(all(v.view.contentEl, "img2md-text")[0].textContent).toBe("Hallo");
  });
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npx vitest run tests/img_to_md_view.test.ts -t "rendert inkrementell"`
Expected: FAIL — `expected false to be true` (heutiges `renderCards()` ruft `el.empty()` pro Token → bei `onC("lo")` ist die Karte ein neuer Knoten, `first !== second`).

- [ ] **Step 3: `CardRefs`-Interface + `cardEls`-Feld hinzufügen**

In `src/img_to_md_view.ts` direkt vor `export class ImgToMdView` einfügen:

```ts
interface CardRefs {
  cardEl: HTMLElement;
  headEl: HTMLElement;
  reasoningDet?: HTMLDetailsElement;
  reasoningSum?: HTMLElement;
  reasoningBody?: HTMLElement;
  textEl?: HTMLElement;
  errorEl?: HTMLElement;
  writtenEl?: HTMLElement;
  actionsEl?: HTMLElement;
  writeBtn?: HTMLElement;
}
```

In der Klasse, bei den übrigen `private … = null;`-Feldern (nach `private cardsEl: HTMLElement | null = null;`), ergänzen:

```ts
  private cardEls: CardRefs[] = [];
```

- [ ] **Step 4: `renderCards()` durch `resetCards` / `updateCard` / `updateAllCards` ersetzen**

Den gesamten `private renderCards(): void { … }`-Block (Z. 179-211) ersetzen durch:

```ts
  /** Voll-Reset: einziger Ort mit empty(). Legt die Teilbäume aller Karten neu an. */
  private resetCards(): void {
    const el = this.cardsEl; if (!el) return;
    el.empty();
    this.cardEls = [];
    for (let i = 0; i < this.state.cards.length; i++) this.updateCard(i);
  }

  private updateAllCards(): void {
    for (let i = 0; i < this.state.cards.length; i++) this.updateCard(i);
  }

  /** Idempotenter Sync EINER Karte auf ihren State: legt fehlende Knoten lazy an,
   *  aktualisiert Texte via setText. Mehrfachaufruf mit gleichem State ist ein No-op. */
  private updateCard(i: number): void {
    const el = this.cardsEl; if (!el) return;
    const card = this.state.cards[i]; if (!card) return;
    let refs = this.cardEls[i];
    if (!refs) {
      const cardEl = el.createDiv({ cls: "img2md-card" });
      const head = card.page != null
        ? t("view.cardHeadPage", this.basename(card.item.link), card.page, card.total)
        : t("view.cardHead", card.index, card.total, this.basename(card.item.link));
      const headEl = cardEl.createDiv({ cls: "img2md-card-head", text: head });
      refs = this.cardEls[i] = { cardEl, headEl };
    }
    const { cardEl } = refs;
    const live = card.status === "streaming" && card.text === "";
    // Reasoning-Block (lazy). open wird hier NUR beim Anlegen gesetzt (Task 2 ergänzt den Auto-Collapse).
    if (card.reasoning) {
      if (!refs.reasoningDet) {
        const det = cardEl.createEl("details", { cls: "img2md-reasoning" });
        det.open = live;
        const sum = det.createEl("summary", { cls: "img2md-reasoning-sum" });
        const body = det.createDiv({ cls: "img2md-reasoning-body" });
        refs.reasoningDet = det; refs.reasoningSum = sum; refs.reasoningBody = body;
      }
      refs.reasoningSum!.setText(live ? t("view.thinking") : t("view.thoughts"));
      refs.reasoningBody!.setText(card.reasoning);
    }
    // Transkript-Text (lazy, inkrementell).
    if (card.text) {
      if (!refs.textEl) refs.textEl = cardEl.createDiv({ cls: "img2md-text" });
      refs.textEl.setText(card.text);
    }
    // Fehlerzeile (lazy, bei error).
    if (card.status === "error" && !refs.errorEl) {
      refs.errorEl = cardEl.createDiv({ cls: "img2md-error", text: card.error ?? t("view.error") });
    }
    // „angelegt"-Zeile (lazy, bei written).
    if (card.status === "written" && !refs.writtenEl) {
      const w = cardEl.createDiv({ cls: "img2md-written", text: t("view.created", card.writtenPath ?? "") });
      w.addEventListener("click", () => { const c = this.state.cards[i]; if (c?.writtenPath) this.deps.openPath(c.writtenPath); });
      refs.writtenEl = w;
    }
    // Aktionen (lazy, sobald Text da): Kopieren immer; „Notiz anlegen" nur bei done.
    if (card.text) {
      if (!refs.actionsEl) {
        const actions = cardEl.createDiv({ cls: "img2md-card-actions" });
        const copyBtn = actions.createEl("button", { cls: "img2md-copy clickable-icon", attr: { "aria-label": t("view.copyTranscript") } });
        setIcon(copyBtn, "copy");
        copyBtn.addEventListener("click", () => this.deps.copyText(this.state.cards[i].text));
        refs.actionsEl = actions;
      }
      if (card.status === "done" && !refs.writeBtn) {
        const wb = refs.actionsEl.createEl("button", { cls: "img2md-write", text: t("view.createNote") });
        wb.addEventListener("click", () => void this.writeOne(i));
        refs.writeBtn = wb;
      } else if (card.status !== "done" && refs.writeBtn) {
        refs.actionsEl.removeChild(refs.writeBtn);
        refs.writeBtn = undefined;
      }
    }
  }
```

- [ ] **Step 5: Die 8 `renderCards()`-Aufrufstellen umstellen**

Jede Stelle einzeln ersetzen (die Methodennamen sind eindeutig genug für gezielte Edits):

| Methode / Kontext | alt | neu |
|---|---|---|
| `refresh()` (nach `clearCards()`) | `this.renderCards();` | `this.resetCards();` |
| `run()` direkt nach `const cards = this.state.startCards();` | `this.renderCards();` | `this.resetCards();` |
| `run()` Content-Callback | `(t) => { this.state.appendContent(i, t); this.renderCards(); }` | `(t) => { this.state.appendContent(i, t); this.updateCard(i); }` |
| `run()` Reasoning-Callback | `(t) => { this.state.appendReasoning(i, t); this.renderCards(); }` | `(t) => { this.state.appendReasoning(i, t); this.updateCard(i); }` |
| `run()` am Ende des `for`-Schleifenkörpers (nach `catch`) | `this.renderCards();` | `this.updateCard(i);` |
| `run()` allerletzte Zeile (nach Modell-Post-Sync) | `this.renderCards();` | `this.updateAllCards();` |
| `writeOne()` (vor `await this.rescan();`) | `this.renderCards();` | `this.updateAllCards();` |
| `writeAll()` (vor `await this.rescan();`) | `this.renderCards();` | `this.updateAllCards();` |

- [ ] **Step 6: Verifizieren, dass kein `renderCards` mehr existiert**

Run: `grep -n "renderCards" src/img_to_md_view.ts`
Expected: keine Ausgabe (0 Treffer).

- [ ] **Step 7: Neuen Test + gesamte View-Suite ausführen**

Run: `npx vitest run tests/img_to_md_view.test.ts`
Expected: PASS — alle bestehenden Tests **und** „rendert inkrementell …" grün.

- [ ] **Step 8: Volle Test-/Typecheck-/Lint-/Build-Gates**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: alle grün/ohne Fehler.

- [ ] **Step 9: Commit**

```bash
git add src/img_to_md_view.ts tests/img_to_md_view.test.ts
git commit -m "perf(view): inkrementelles Karten-Rendering statt Voll-Rebuild pro Token

renderCards() -> resetCards() (einziger empty()-Ort) + idempotentes
updateCard(i); Streaming-Hot-Path aktualisiert nur die aktive Karte.
Karten-DOM wird nicht mehr pro Token zerstört.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Reasoning-Auto-Collapse (einmalig) + Toggle-Stabilität

Heute (Task 1) bleibt der reasoning-`<details>` offen, sobald er angelegt wurde. Dieser Task ergänzt die einmalige Collapse-Regel: Sobald `live` von true→false kippt (erster Content **oder** done/error), wird der Block **genau einmal** zugeklappt; danach fasst `updateCard` `.open` nie wieder an → der User-Toggle bleibt stabil, auch über mehrere Karten.

**Files:**
- Modify: `src/img_to_md_view.ts` (erweitert `CardRefs` um zwei Felder; ergänzt den Reasoning-Block in `updateCard`)
- Test: `tests/img_to_md_view.test.ts` (drei neue `it`s)

**Interfaces:**
- Consumes: `CardRefs`, `updateCard(i)` aus Task 1.
- Produces: `CardRefs` zusätzlich mit `liveWas: boolean; autoCollapsed: boolean;`.

- [ ] **Step 1: Failing-Treiber-Test „Auto-Collapse genau einmal" schreiben** — am Ende des `describe("ImgToMdView — Transkribieren")`-Blocks ergänzen:

```ts
  it("reasoning-Block klappt einmalig zu, sobald Content kommt", async () => {
    let viewRef: any;
    let openWhileThinking: boolean | null = null;
    const transcribeStream = async (_sp: string, _it: ImgItem, onC: any, onR: any) => {
      onR("denkt");
      openWhileThinking = all(viewRef.contentEl, "img2md-reasoning")[0].open;  // true (thinking)
      onC("Ergebnis");                                                          // live -> false
      return { content: "Ergebnis", reasoning: "denkt", model: "vm" };
    };
    const v = mkView({ transcribeStream }); viewRef = v.view;
    await v.view.onOpen();
    await v.view.run();
    expect(openWhileThinking).toBe(true);
    expect(all(v.view.contentEl, "img2md-reasoning")[0].open).toBe(false);  // nach Content zugeklappt
  });
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npx vitest run tests/img_to_md_view.test.ts -t "klappt einmalig zu"`
Expected: FAIL — `expected true to be false` (Task-1-`updateCard` setzt `.open` nach dem Anlegen nie wieder → bleibt `true`).

- [ ] **Step 3: `CardRefs` um Lebenszyklus-Felder erweitern**

Im `interface CardRefs` zwei Felder ergänzen:

```ts
  liveWas: boolean;
  autoCollapsed: boolean;
```

In `updateCard`, bei der `refs`-Initialisierung, die beiden Felder mit-initialisieren:

```ts
      refs = this.cardEls[i] = { cardEl, headEl, liveWas: false, autoCollapsed: false };
```

- [ ] **Step 4: Reasoning-Block in `updateCard` um die Einmal-Collapse-Regel ergänzen**

Den `if (card.reasoning) { … }`-Block in `updateCard` ersetzen durch:

```ts
    if (card.reasoning) {
      if (!refs.reasoningDet) {
        const det = cardEl.createEl("details", { cls: "img2md-reasoning" });
        det.open = live;
        const sum = det.createEl("summary", { cls: "img2md-reasoning-sum" });
        const body = det.createDiv({ cls: "img2md-reasoning-body" });
        refs.reasoningDet = det; refs.reasoningSum = sum; refs.reasoningBody = body;
        refs.liveWas = live;
      }
      refs.reasoningSum!.setText(live ? t("view.thinking") : t("view.thoughts"));
      refs.reasoningBody!.setText(card.reasoning);
      // Einmaliger Auto-Collapse beim Übergang live -> nicht-live; danach gehört .open dem User.
      if (refs.liveWas && !live && !refs.autoCollapsed) {
        refs.reasoningDet!.open = false;
        refs.autoCollapsed = true;
      }
      refs.liveWas = live;
    }
```

- [ ] **Step 5: Treiber-Test ausführen, Erfolg bestätigen**

Run: `npx vitest run tests/img_to_md_view.test.ts -t "klappt einmalig zu"`
Expected: PASS.

- [ ] **Step 6: Regressionstests „User-Toggle bleibt" + „Toggle bleibt über Karten" schreiben** — beide am Ende des `describe`-Blocks ergänzen:

```ts
  it("User-Toggle des reasoning-Blocks bleibt: weitere Deltas setzen .open nicht zurück", async () => {
    let viewRef: any;
    let openAfter: boolean | null = null;
    const transcribeStream = async (_sp: string, _it: ImgItem, _onC: any, onR: any) => {
      onR("a");
      all(viewRef.contentEl, "img2md-reasoning")[0].open = false;  // User klappt während Thinking zu
      onR("b");                                                     // weiteres Reasoning-Delta
      openAfter = all(viewRef.contentEl, "img2md-reasoning")[0].open;
      return { content: "ok", reasoning: "ab", model: "vm" };
    };
    const v = mkView({ transcribeStream }); viewRef = v.view;
    await v.view.onOpen();
    await v.view.run();
    expect(openAfter).toBe(false);
  });

  it("Toggle einer fertigen Karte bleibt erhalten, während eine spätere Karte streamt", async () => {
    const ITEMS2: ImgItem[] = [
      { raw: "![[a.png]]", link: "a.png", ext: "png", supported: true, kind: "image" },
      { raw: "![[c.png]]", link: "c.png", ext: "png", supported: true, kind: "image" },
    ];
    let viewRef: any;
    let card0OpenDuringCard1: boolean | null = null;
    let call = 0;
    const transcribeStream = async (_sp: string, _it: ImgItem, onC: any, onR: any) => {
      call++;
      if (call === 1) { onR("r0"); onC("t0"); return { content: "t0", reasoning: "r0", model: "vm" }; }
      // Karte 0 ist fertig: User klappt deren reasoning auf, dann streamt Karte 1.
      all(viewRef.contentEl, "img2md-reasoning")[0].open = true;
      onC("t1");
      card0OpenDuringCard1 = all(viewRef.contentEl, "img2md-reasoning")[0].open;
      return { content: "t1", reasoning: "", model: "vm" };
    };
    const v = mkView({ scan: async () => ITEMS2, transcribeStream }); viewRef = v.view;
    await v.view.onOpen();
    await v.view.run();
    expect(card0OpenDuringCard1).toBe(true);
  });
```

- [ ] **Step 7: Gesamte View-Suite ausführen**

Run: `npx vitest run tests/img_to_md_view.test.ts`
Expected: PASS — alle bestehenden + 4 neuen (1 aus Task 1, 3 aus Task 2) grün.

- [ ] **Step 8: Volle Gates**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: alle grün/ohne Fehler.

- [ ] **Step 9: Commit**

```bash
git add src/img_to_md_view.ts tests/img_to_md_view.test.ts
git commit -m "feat(view): reasoning-Block klappt einmalig zu, danach user-stabil

Beim Uebergang live->nicht-live (erster Content oder done/error) wird der
reasoning-<details> genau einmal zugeklappt; danach bleibt der User-Toggle
ueber den ganzen Lauf erhalten, auch ueber mehrere Karten.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Verifikation am Gerät (nach beiden Tasks)

Nicht automatisierbar, daher als manuelle Abnahme (Deploy via `npm run deploy`, Obsidian-Plugin neu laden):
- Langes Streaming (z.B. Reasoning-Modell wie `gemma-4-e2b`): **kein Flackern**, Scroll-Position springt nicht.
- reasoning-Block ist während des Denkens offen, klappt mit dem ersten Transkript-Text zu; manuelles Auf/Zuklappen bleibt erhalten (springt nicht zurück).
- Multi-Bild-/PDF-Lauf: Toggle-Zustände der Karten bleiben unabhängig erhalten.
