# Modell-Transparenz (Refresh + Post-Sync) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sichtbar und aktuell halten, welches Vision-Modell tatsächlich geladen ist — Refresh-Icon in beiden Modell-Dropdowns plus automatischer Angleich der Auswahl an `response.model` nach jeder Transkription.

**Architecture:** Ein reiner Helfer `actualModel(cards)` liest das real verwendete Modell aus den Ergebnis-Karten. Die Sidebar bekommt ein Refresh-Icon (re-fetch `/v1/models` via bestehendes `refreshModels()`), einen Stale-Angleich (Auswahl nicht mehr geladen → auf geladenes umstellen) und einen Post-Sync in `run()` (Auswahl ≠ real → `setModel` + Statuszeilen-Hinweis). Die Settings bekommen einen permanenten Refresh-Button. Kein Pre-flight-Check, kein clientseitiges Modell-Laden.

**Tech Stack:** TypeScript (strict), esbuild, vitest + happy-dom, Obsidian Plugin API.

## Global Constraints

- TS strict + `noImplicitAny` — keine `any`-Casts für neue Typen.
- Nach jeder Task: `npm test` grün **und** `npx tsc --noEmit` sauber.
- Nutzersichtbare Strings via `t()` aus `i18n.ts`; EN kanonisch, DE gepflegt.
- Commits: Conventional Commits (deutsch ok), **nur berührte Dateien stagen**, Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- `eslint` (`npm run lint`) sauber.

## File Structure

- `src/img_to_md_state.ts` — `actualModel(cards)` (neuer reiner Helfer).
- `src/img_to_md_view.ts` — Refresh-Icon (onOpen), Stale-Angleich (`refreshModels`), Post-Sync (`run`), `actualModel`-Import.
- `src/settings.ts` — permanenter Refresh-Button beim Modell-Setting.
- `src/i18n.ts` — `view.refreshModels`, `view.modelChanged`, `settings.refreshModels` (EN+DE).
- `styles.css` — `.img2md-model-row` (Layout select + Icon).
- Tests: `tests/img_to_md_state.test.ts`, `tests/img_to_md_view.test.ts`.

---

### Task 1: `actualModel`-Helfer

**Files:**
- Modify: `src/img_to_md_state.ts` (neue exportierte Funktion, nach `partitionDoneCards`)
- Test: `tests/img_to_md_state.test.ts`

**Interfaces:**
- Produces: `export function actualModel(cards: ImgCard[]): string` — erstes nicht-leeres `card.model`, sonst `""`.

- [ ] **Step 1: Failing test** — in `tests/img_to_md_state.test.ts` `actualModel` zum Import (Zeile 2) hinzufügen und Block ergänzen. Helfer-Funktion baut eine vollständige `ImgCard`:

```ts
function mkCard(model: string): ImgCard {
  return { item: items[0], index: 1, total: 1, text: "x", reasoning: "", model, status: "done" };
}
describe("actualModel", () => {
  it("liefert das erste nicht-leere card.model", () => {
    expect(actualModel([mkCard(""), mkCard("mlx-vlm"), mkCard("other")])).toBe("mlx-vlm");
  });
  it("liefert \"\" wenn keine Karte ein Modell hat", () => {
    expect(actualModel([mkCard(""), mkCard("")])).toBe("");
  });
  it("liefert \"\" für leere Kartenliste", () => {
    expect(actualModel([])).toBe("");
  });
});
```

(`ImgCard` zum Import ergänzen: `import { ImgToMdState, ImgItem, ImgCard, partitionDoneCards, actualModel } from "../src/img_to_md_state";`)

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run tests/img_to_md_state.test.ts -t actualModel`
Expected: FAIL (`actualModel is not a function`).

- [ ] **Step 3: Implement** — in `src/img_to_md_state.ts` nach `partitionDoneCards` (Dateiende) ergänzen:

```ts
/** Das tatsächlich verwendete Modell aus den Ergebnis-Karten: erstes nicht-leeres card.model.
 *  "" wenn keine Karte ein Modell meldet. Alle Karten eines Laufs stammen vom selben Backend. */
export function actualModel(cards: ImgCard[]): string {
  return cards.find(c => c.model)?.model ?? "";
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run tests/img_to_md_state.test.ts && npx tsc --noEmit`
Expected: PASS; tsc sauber.

- [ ] **Step 5: Commit**

```bash
git add src/img_to_md_state.ts tests/img_to_md_state.test.ts
git commit -m "feat(model): actualModel-Helfer (real verwendetes Modell aus Karten)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Sidebar Refresh-Icon + Stale-Angleich

**Files:**
- Modify: `src/img_to_md_view.ts:41-42` (onOpen modelSel), `src/img_to_md_view.ts:64-72` (`refreshModels`)
- Modify: `src/i18n.ts` (`view.refreshModels`, `view.modelChanged` EN+DE)
- Modify: `styles.css` (`.img2md-model-row`)
- Test: `tests/img_to_md_view.test.ts`

**Interfaces:**
- Consumes: `ViewDeps.listModels`, `getModel`, `setModel` (bestehend)
- Produces: Refresh-Icon `.img2md-model-refresh`; `refreshModels()` gleicht eine nicht mehr geladene Auswahl auf `models[0]` an.

- [ ] **Step 1: i18n-Keys** — in `src/i18n.ts` im EN-Block nach `"view.overwriteHint"` (Zeile 79):

```ts
  "view.refreshModels": "Refresh models",
  "view.modelChanged": "Model changed to {0}",
```
und im DE-Block nach `"view.overwriteHint"` (Zeile 160):

```ts
  "view.refreshModels": "Modelle aktualisieren",
  "view.modelChanged": "Modell gewechselt zu {0}",
```

- [ ] **Step 2: Failing tests** — in `tests/img_to_md_view.test.ts` ergänzen (nutzt `mkView`/`all`, `vi`):

```ts
describe("ImgToMdView — Modell-Refresh", () => {
  it("Refresh-Icon ruft listModels erneut", async () => {
    let calls = 0;
    const { view } = mkView({ listModels: async () => { calls++; return ["vm"]; }, getModel: () => "vm" });
    await view.onOpen();
    const before = calls;
    const btn = all(view.contentEl, "img2md-model-refresh");
    expect(btn.length).toBe(1);
    btn[0].click();
    await new Promise(r => setTimeout(r, 0));
    expect(calls).toBe(before + 1);
  });
  it("refreshModels gleicht eine nicht mehr geladene Auswahl an ein geladenes Modell an", async () => {
    const setModel = vi.fn();
    const { view } = mkView({ getModel: () => "gone-model", setModel, listModels: async () => ["loaded-model"] });
    await view.onOpen();
    expect(setModel).toHaveBeenCalledWith("loaded-model");
  });
});
```

- [ ] **Step 3: Run, verify fail**

Run: `npx vitest run tests/img_to_md_view.test.ts -t "Modell-Refresh"`
Expected: FAIL (kein `img2md-model-refresh`; `setModel` nicht aufgerufen).

- [ ] **Step 4: Implement onOpen** — in `src/img_to_md_view.ts` die `modelSel`-Erstellung (Zeile 41-42) ersetzen:

```ts
    const modelRow = c.createDiv({ cls: "img2md-model-row" });
    this.modelSel = modelRow.createEl("select", { cls: "img2md-model dropdown" });
    this.modelSel.addEventListener("change", () => this.deps.setModel(this.modelSel?.value ?? ""));
    const refreshBtn = modelRow.createEl("button", { cls: "img2md-model-refresh clickable-icon", attr: { "aria-label": t("view.refreshModels"), title: t("view.refreshModels") } });
    setIcon(refreshBtn, "refresh-cw");
    refreshBtn.addEventListener("click", () => void this.refreshModels());
```

- [ ] **Step 5: Implement Stale-Angleich** — `refreshModels()` (Zeile 64-72) ersetzen:

```ts
  private async refreshModels(): Promise<void> {
    const sel = this.modelSel; if (!sel) return;
    let cur = this.deps.getModel();
    const models = await this.deps.listModels();
    if (cur && models.length && !models.includes(cur)) {   // Auswahl nicht mehr geladen → angleichen
      cur = models[0];
      this.deps.setModel(cur);
      this.statusEl?.setText(t("view.modelChanged", cur));
    }
    sel.empty();
    const list = models.includes(cur) || !cur ? models : [cur, ...models];
    for (const m of list) { const o = sel.createEl("option", { text: m }); o.value = m; }
    sel.value = cur;
  }
```

- [ ] **Step 6: CSS** — in `styles.css` ergänzen:

```css
.img2md-model-row { display: flex; align-items: center; gap: 0.4em; }
.img2md-model-row .img2md-model { flex: 1; }
```

- [ ] **Step 7: Run, verify pass**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: alle PASS; tsc + eslint sauber. (Bestehende View-Tests bleiben grün — `modelSel` existiert weiterhin, nur in einem Wrapper.)

- [ ] **Step 8: Commit**

```bash
git add src/img_to_md_view.ts src/i18n.ts styles.css tests/img_to_md_view.test.ts
git commit -m "feat(model): Sidebar Refresh-Icon + Stale-Auswahl-Angleich

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Sidebar Post-Sync in `run()`

**Files:**
- Modify: `src/img_to_md_view.ts:2` (Import), `src/img_to_md_view.ts:198-203` (Ende von `run()`)
- Test: `tests/img_to_md_view.test.ts`

**Interfaces:**
- Consumes: `actualModel` (Task 1), `refreshModels` (Task 2), `ViewDeps.getModel`/`setModel`
- Produces: nach einem Lauf gleicht `run()` die Auswahl an das real verwendete Modell an (nur bei Abweichung).

- [ ] **Step 1: Failing tests** — im `describe("ImgToMdView — Modell-Refresh")` ergänzen:

```ts
  it("run() gleicht die Auswahl an das real verwendete Modell an (Post-Sync)", async () => {
    const setModel = vi.fn();
    const { view } = mkView({
      getModel: () => "vm", setModel, listModels: async () => ["vm"],
      transcribeStream: async (_sp: string, _it: any, onC: any) => { onC("x"); return { content: "x", reasoning: "", model: "other-model" }; },
    });
    await view.onOpen();
    await view.run();
    expect(setModel).toHaveBeenCalledWith("other-model");
  });
  it("run() ohne Abweichung ruft setModel nicht (kein unnötiges Reconnect)", async () => {
    const setModel = vi.fn();
    const { view } = mkView({
      getModel: () => "vm", setModel, listModels: async () => ["vm"],
      transcribeStream: async (_sp: string, _it: any, onC: any) => { onC("x"); return { content: "x", reasoning: "", model: "vm" }; },
    });
    await view.onOpen();
    await view.run();
    expect(setModel).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run tests/img_to_md_view.test.ts -t "Post-Sync"`
Expected: FAIL (`setModel` nicht mit `"other-model"` aufgerufen).

- [ ] **Step 3: Implement** — Import (Zeile 2) um `actualModel` erweitern:

```ts
import { ImgToMdState, ImgItem, partitionDoneCards, actualModel } from "./img_to_md_state";
```

In `run()` das Ende (Zeile 198-203) ersetzen:

```ts
    // Nach Abbruch: noch nicht verarbeitete Karten kennzeichnen.
    for (let i = 0; i < cards.length; i++) if (cards[i].status === "streaming") this.state.setError(i, t("view.aborted"));
    this.running = false; this.runBtn?.setText(t("view.transcribe"));
    this.controller = null;
    // Post-Sync: das real verwendete Modell (response.model) → Auswahl angleichen
    const actual = actualModel(this.state.cards);
    if (actual && actual !== this.deps.getModel()) {
      this.deps.setModel(actual);
      await this.refreshModels();
      this.statusEl?.setText(t("view.modelChanged", actual));
    }
    this.renderCards();
  }
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test && npx tsc --noEmit`
Expected: alle PASS; tsc sauber.

- [ ] **Step 5: Commit**

```bash
git add src/img_to_md_view.ts tests/img_to_md_view.test.ts
git commit -m "feat(model): Post-Sync — Auswahl folgt response.model nach run()

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Settings Refresh-Button

**Files:**
- Modify: `src/settings.ts:89` (modelSetting), `src/i18n.ts` (`settings.refreshModels` EN+DE)
- Test: keine neue Unit-Test (Settings-DOM-Schicht); Gate = `npx tsc --noEmit` + `npm run lint` + manuell.

**Interfaces:**
- Consumes: `this.display()` (re-fetch, bestehend)
- Produces: permanenter Refresh-Button beim Modell-Setting.

- [ ] **Step 1: i18n-Keys** — in `src/i18n.ts` im EN-Block nach `"settings.loadModels"` (Zeile 37):

```ts
  "settings.refreshModels": "Refresh models",
```
und im DE-Block nach `"settings.loadModels"` (Zeile 118):

```ts
  "settings.refreshModels": "Modelle aktualisieren",
```

- [ ] **Step 2: Implement** — in `src/settings.ts` direkt nach der `modelSetting`-Definition (Zeile 89) einen Refresh-`ExtraButton` ergänzen:

```ts
    const modelSetting = new Setting(containerEl).setName(t("settings.model.name")).setDesc(t("settings.model.desc"));
    modelSetting.addExtraButton(b => b.setIcon("refresh-cw").setTooltip(t("settings.refreshModels")).onClick(() => this.display()));
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc + eslint sauber; alle Tests grün (Settings-Test unverändert).

- [ ] **Step 4: Commit**

```bash
git add src/settings.ts src/i18n.ts
git commit -m "feat(model): permanenter Refresh-Button im Settings-Modell-Setting

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: CHANGELOG + Manual

**Files:**
- Modify: `CHANGELOG.md`, `docs/manual/reference.md`, `docs/manual/how-to.md`
- Test: keine (Doku)

- [ ] **Step 1: CHANGELOG** — unter `## [Unreleased]` (anlegen falls fehlt, über `## [0.3.0]`) ergänzen:

```markdown
### Hinzugefügt

- **Modell-Transparenz:** ein Refresh-Icon neben beiden Modell-Auswahlen (Sidebar + Einstellungen)
  lädt die Modell-Liste neu — nützlich, wenn ein externer Prozess das geladene Modell des lokalen
  Backends (MLX/LM Studio) gewechselt hat. Nach jeder Transkription gleicht die Sidebar die Auswahl
  automatisch an das tatsächlich verwendete Modell (`response.model`) an.
```

- [ ] **Step 2: Manual** — in `docs/manual/reference.md` (Connection/model-controls-Abschnitt) und `docs/manual/how-to.md` je einen Satz ergänzen: Refresh-Icon neben dem Modell-Dropdown lädt die Liste neu; die Auswahl folgt nach einer Transkription dem real verwendeten Modell. Exakte Label aus `i18n.ts` (`view.refreshModels`).

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: Build ok.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md docs/manual/reference.md docs/manual/how-to.md
git commit -m "docs(model): CHANGELOG + Manual — Modell-Refresh/Post-Sync

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Definition of Done (aus der Spec)

- [ ] `actualModel` rein implementiert + getestet. *(Task 1)*
- [ ] Sidebar: Refresh-Icon → re-fetch; Stale-Auswahl wird auf ein geladenes Modell angeglichen. *(Task 2)*
- [ ] Sidebar `run()`: Post-Sync gleicht die Auswahl an `response.model` an (nur bei Abweichung) + Statuszeilen-Hinweis. *(Task 3)*
- [ ] Settings: permanenter Refresh-Button. *(Task 4)*
- [ ] i18n EN/DE; alle Alt-Tests grün, neue Tests grün, `tsc`/`eslint` sauber. *(jede Task)*
- [ ] Empirisch in Obsidian: Backend-Modell extern wechseln → Refresh zeigt das neue; nach einer Transkription folgt die Auswahl dem real verwendeten Modell. *(nach Merge, Handover)*
