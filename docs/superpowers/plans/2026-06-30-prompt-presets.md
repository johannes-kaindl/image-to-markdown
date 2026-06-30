# Named Prompt-Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Statt eines einzigen globalen Vision-Prompts eine per-Lauf wählbare Preset-Auswahl (feste Built-ins + editierbarer „Default") mit stickyem Sidebar-Dropdown.

**Architecture:** Reiner Kern `prompts.ts` (Registry + Resolver, obsidian-frei). `settings.ts` bekommt `promptPreset`. `main.ts` löst den effektiven Prompt an den Call-Sites auf und liefert der View `listPresets/getPreset/setPreset`-Deps. Die View rendert ein zweites Dropdown neben dem Modell-Picker. Folgt exakt dem etablierten Modell-Picker-Muster.

**Tech Stack:** TypeScript (strict), esbuild, vitest + happy-dom, Obsidian Plugin API, i18n via `t()`.

Spec: `../specs/2026-06-30-prompt-presets-design.md`.

## Global Constraints

- TS strict + `noImplicitAny` — keine `any`-Casts für neue Typen.
- `prompts.ts` bleibt **obsidian-frei** (nur `./i18n`-Import) — in Node testbar ohne DOM-Mock (PROF-OBS-03/04).
- i18n: alle nutzersichtbaren Strings via `t()`, **EN kanonisch**, EN+DE parität.
- Keine restricted globals (eslint-plugin-obsidianmd); `minAppVersion` bleibt 1.8.7.
- Nach jeder Änderung **alle Tests grün**; `tsc --noEmit` + `eslint src` + `npm run build` sauber.
- Conventional Commits (deutsch ok), nur berührte Dateien stagen, Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## File Structure

- **Create** `src/prompts.ts` — reine Preset-Registry: `PROMPT_PRESETS`, `isPromptPreset`, `promptPresetLabel`, `builtinPromptText`, `resolvePromptText`.
- **Create** `tests/prompts.test.ts`.
- **Modify** `src/i18n.ts` — `preset.label.*` + `preset.prompt.*` (EN+DE); `settings.prompt.desc` schärfen.
- **Modify** `src/settings.ts` — Feld `promptPreset` im Interface + `defaultSettings()`.
- **Modify** `tests/settings.test.ts`.
- **Modify** `src/img_to_md_view.ts` — `ImgToMdViewDeps` um `listPresets/getPreset/setPreset`; Preset-Dropdown in der Model-Row.
- **Modify** `tests/img_to_md_view.test.ts` — Mock-Deps + Dropdown-Test.
- **Modify** `styles.css` — `.img2md-preset`.
- **Modify** `src/main.ts` — Prompt-Auflösung an den Call-Sites + `onload`-Guard + Deps-Implementierung (Glue, kein Unit-Test; via tsc/build/Suite verifiziert).

---

### Task 1: Reiner Kern `prompts.ts` + i18n-Keys

**Files:**
- Create: `src/prompts.ts`
- Create: `tests/prompts.test.ts`
- Modify: `src/i18n.ts` (EN-Dict nach `"prompt.default": …` einfügen; DE-Dict analog; `settings.prompt.desc` in EN+DE schärfen)

**Interfaces:**
- Produces: `PROMPT_PRESETS: readonly string[]` (`["default","tables","handwriting","math","code","describe"]`); `isPromptPreset(id: string): boolean`; `promptPresetLabel(id: string): string`; `builtinPromptText(id: string): string`; `resolvePromptText(id: string, customDefault: string): string`.

- [ ] **Step 1: i18n-Keys einfügen.** In `src/i18n.ts` im **EN**-Dict direkt nach dem `"prompt.default": …`-Eintrag einfügen:

```ts
  "preset.label.default": "Default",
  "preset.label.tables": "Tables → Markdown",
  "preset.label.handwriting": "Handwriting",
  "preset.label.math": "Math → LaTeX",
  "preset.label.code": "Source code",
  "preset.label.describe": "Describe image",
  "preset.prompt.tables":
    "Transcribe the image to Markdown. Render every table as a GitHub-Flavored Markdown table " +
    "(pipes with a header separator row), preserving all rows, columns and cell text exactly. " +
    "Output only the Markdown, no comments.",
  "preset.prompt.handwriting":
    "Transcribe the handwritten text in the image to Markdown as accurately as possible. Preserve " +
    "line breaks, lists and structure. Mark an illegible word as [?]. Output only the Markdown, no comments.",
  "preset.prompt.math":
    "Transcribe the image to Markdown. Render mathematical formulas as LaTeX: inline math as $…$ and " +
    "display equations as $$…$$. Preserve the surrounding text and structure. Output only the Markdown, no comments.",
  "preset.prompt.code":
    "Transcribe the image to Markdown. Put source code into fenced code blocks (```), preserving " +
    "indentation, line breaks and symbols exactly. Output only the Markdown, no comments.",
  "preset.prompt.describe":
    "Describe the image in clear prose suitable as alt text: what it shows, its key elements and any " +
    "visible text. Summarize rather than transcribe verbatim. Output only the description, no comments.",
```

  Im **DE**-Dict direkt nach `"prompt.default": …` einfügen:

```ts
  "preset.label.default": "Standard",
  "preset.label.tables": "Tabellen → Markdown",
  "preset.label.handwriting": "Handschrift",
  "preset.label.math": "Mathe → LaTeX",
  "preset.label.code": "Quellcode",
  "preset.label.describe": "Bild beschreiben",
  "preset.prompt.tables":
    "Transkribiere das Bild nach Markdown. Gib jede Tabelle als GitHub-Flavored-Markdown-Tabelle aus " +
    "(Pipes mit Trennzeile nach dem Kopf) und erhalte alle Zeilen, Spalten und Zellinhalte exakt. " +
    "Gib nur das Markdown aus, keine Kommentare.",
  "preset.prompt.handwriting":
    "Transkribiere den handschriftlichen Text im Bild so genau wie möglich nach Markdown. Erhalte " +
    "Zeilenumbrüche, Listen und Struktur. Markiere ein unleserliches Wort als [?]. Gib nur das Markdown aus, keine Kommentare.",
  "preset.prompt.math":
    "Transkribiere das Bild nach Markdown. Gib mathematische Formeln als LaTeX aus: Inline-Mathe als $…$ " +
    "und abgesetzte Gleichungen als $$…$$. Erhalte den umgebenden Text und die Struktur. Gib nur das Markdown aus, keine Kommentare.",
  "preset.prompt.code":
    "Transkribiere das Bild nach Markdown. Setze Quellcode in umzäunte Codeblöcke (```) und erhalte " +
    "Einrückung, Zeilenumbrüche und Symbole exakt. Gib nur das Markdown aus, keine Kommentare.",
  "preset.prompt.describe":
    "Beschreibe das Bild in klarer Prosa, geeignet als Alt-Text: was es zeigt, seine Kernelemente und " +
    "sichtbaren Text. Fasse zusammen, statt wörtlich zu transkribieren. Gib nur die Beschreibung aus, keine Kommentare.",
```

  `settings.prompt.desc` schärfen — EN: `"Text of the “Default” preset. The image content is sent along; other presets are chosen in the sidebar."` · DE: `"Text des „Standard\"-Presets. Der Bild-Inhalt wird mitgeschickt; weitere Presets wählst du in der Sidebar."`

- [ ] **Step 2: Failing test schreiben.** `tests/prompts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PROMPT_PRESETS, isPromptPreset, promptPresetLabel, builtinPromptText, resolvePromptText } from "../src/prompts";
import { setLang, defaultVisionPrompt } from "../src/i18n";

describe("prompts — Registry", () => {
  it("PROMPT_PRESETS beginnt mit default, enthält die 5 Built-ins", () => {
    expect(PROMPT_PRESETS[0]).toBe("default");
    expect([...PROMPT_PRESETS]).toEqual(["default", "tables", "handwriting", "math", "code", "describe"]);
  });
  it("isPromptPreset erkennt bekannte/unbekannte ids", () => {
    expect(isPromptPreset("math")).toBe(true);
    expect(isPromptPreset("nope")).toBe(false);
  });
});

describe("prompts — Labels & Built-in-Texte (EN+DE)", () => {
  it("promptPresetLabel liefert lokalisierte Labels, Fallback = id", () => {
    setLang("en"); expect(promptPresetLabel("tables")).toBe("Tables → Markdown");
    setLang("de"); expect(promptPresetLabel("tables")).toBe("Tabellen → Markdown");
    expect(promptPresetLabel("nope")).toBe("nope");
    setLang("en");
  });
  it("builtinPromptText: default → '', Built-ins nicht-leer in EN+DE", () => {
    expect(builtinPromptText("default")).toBe("");
    for (const lang of ["en", "de"] as const) {
      setLang(lang);
      for (const id of ["tables", "handwriting", "math", "code", "describe"]) {
        expect(builtinPromptText(id).length).toBeGreaterThan(10);
        expect(builtinPromptText(id)).not.toContain("preset.prompt.");   // kein fehlender Key
      }
    }
    setLang("en");
  });
});

describe("prompts — resolvePromptText", () => {
  it("default → customDefault", () => {
    expect(resolvePromptText("default", "MEIN PROMPT")).toBe("MEIN PROMPT");
  });
  it("default mit leerem customDefault → defaultVisionPrompt()", () => {
    setLang("en");
    expect(resolvePromptText("default", "   ")).toBe(defaultVisionPrompt());
  });
  it("Built-in → dessen Text (nicht customDefault)", () => {
    setLang("en");
    expect(resolvePromptText("math", "MEIN PROMPT")).toBe(builtinPromptText("math"));
  });
  it("unbekannte id → wie default (customDefault)", () => {
    expect(resolvePromptText("nope", "MEIN PROMPT")).toBe("MEIN PROMPT");
  });
});
```

- [ ] **Step 3: Test laufen → fehlschlägt.** Run: `npx vitest run tests/prompts.test.ts` · Expected: FAIL (`Cannot find module '../src/prompts'`).

- [ ] **Step 4: `src/prompts.ts` implementieren.**

```ts
import { t, defaultVisionPrompt } from "./i18n";

/** Verfügbare Prompt-Presets. Reihenfolge = Dropdown-Reihenfolge; "default" zuerst. */
export const PROMPT_PRESETS = ["default", "tables", "handwriting", "math", "code", "describe"] as const;

export function isPromptPreset(id: string): boolean {
  return (PROMPT_PRESETS as readonly string[]).includes(id);
}

/** Lokalisiertes Label fürs Dropdown; Fallback = id (unbekannt). */
export function promptPresetLabel(id: string): string {
  return isPromptPreset(id) ? t(`preset.label.${id}`) : id;
}

/** Lokalisierter Built-in-Prompt-Text. "" für "default" (nutzt den editierbaren Default-Text). */
export function builtinPromptText(id: string): string {
  if (id === "default") return "";
  return t(`preset.prompt.${id}`);
}

/** Effektiver Prompt-Text: "default" (oder unbekannt) → editierbarer customDefault
 *  (Fallback defaultVisionPrompt() bei leer); sonst der lokalisierte Built-in-Text. Reine Funktion. */
export function resolvePromptText(id: string, customDefault: string): string {
  if (id !== "default" && isPromptPreset(id)) return builtinPromptText(id);
  return customDefault.trim() ? customDefault : defaultVisionPrompt();
}
```

- [ ] **Step 5: Tests laufen → grün.** Run: `npx vitest run tests/prompts.test.ts tests/i18n.test.ts` · Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/prompts.ts tests/prompts.test.ts src/i18n.ts
git commit -m "feat(prompts): reine Preset-Registry + i18n (EN/DE)"
```

---

### Task 2: `settings.ts` — Feld `promptPreset`

**Files:**
- Modify: `src/settings.ts:33-40` (Interface), `:43-52` (defaultSettings)
- Modify: `tests/settings.test.ts`

**Interfaces:**
- Consumes: nichts.
- Produces: `ImageToMarkdownSettings.promptPreset: string`; `defaultSettings().promptPreset === "default"`.

- [ ] **Step 1: Failing test.** In `tests/settings.test.ts` ergänzen:

```ts
it("defaultSettings: promptPreset ist 'default', visionPrompt unverändert vorhanden", () => {
  const s = defaultSettings();
  expect(s.promptPreset).toBe("default");
  expect(typeof s.visionPrompt).toBe("string");
  expect(s.visionPrompt.length).toBeGreaterThan(0);
});
```

  (Falls `defaultSettings` noch nicht importiert ist, Import aus `"../src/settings"` ergänzen.)

- [ ] **Step 2: Test laufen → fehlschlägt.** Run: `npx vitest run tests/settings.test.ts` · Expected: FAIL (`promptPreset` ist `undefined`).

- [ ] **Step 3: Implementieren.** Interface (`src/settings.ts`) um eine Zeile erweitern:

```ts
export interface ImageToMarkdownSettings {
  visionEndpoints: string[];
  visionModel: string;
  visionPrompt: string;
  promptPreset: string;
  pdfMaxPages: number;
  pdfRenderScale: number;
  pdfPageSeparator: PdfPageSeparator;
}
```

  `defaultSettings()` um eine Zeile erweitern (nach `visionPrompt`):

```ts
    visionPrompt: defaultVisionPrompt(),
    promptPreset: "default",
```

- [ ] **Step 4: Tests laufen → grün.** Run: `npx vitest run tests/settings.test.ts` · Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/settings.ts tests/settings.test.ts
git commit -m "feat(settings): promptPreset-Feld (Default 'default')"
```

---

### Task 3: View — Preset-Dropdown + Deps

**Files:**
- Modify: `src/img_to_md_view.ts` (`ImgToMdViewDeps` ~`:23-35`; `onOpen` Model-Row ~`:64-70`; neues Feld `presetSel`)
- Modify: `styles.css`
- Modify: `tests/img_to_md_view.test.ts` (Mock-Deps in `mkView` + Test)

**Interfaces:**
- Consumes: `ImgToMdViewDeps.listPresets: () => { id: string; label: string }[]`, `.getPreset: () => string`, `.setPreset: (id: string) => void`.
- Produces: ein `<select class="img2md-preset dropdown">` in der `img2md-model-row`.

- [ ] **Step 1: Failing test.** In `tests/img_to_md_view.test.ts` zuerst die `mkView`-Deps um Defaults erweitern (im `deps`-Objekt ergänzen):

```ts
    listPresets: over.listPresets ?? (() => [{ id: "default", label: "Default" }, { id: "math", label: "Math → LaTeX" }]),
    getPreset: over.getPreset ?? (() => "default"),
    setPreset: over.setPreset ?? vi.fn(),
```

  Dann den Test ergänzen (z.B. nach dem „Modell-Switcher"-Test):

```ts
  it("Preset-Dropdown rendert die Presets, Wert = getPreset, change ruft setPreset", async () => {
    const setPreset = vi.fn();
    const { view } = mkView({
      getPreset: () => "math",
      setPreset,
      listPresets: () => [{ id: "default", label: "Default" }, { id: "math", label: "Math → LaTeX" }],
    });
    await view.onOpen();
    const sel = all(view.contentEl, "img2md-preset")[0];
    expect(sel).toBeTruthy();
    expect((sel.children ?? []).map((o: any) => o.textContent)).toEqual(["Default", "Math → LaTeX"]);
    expect(sel.value).toBe("math");
    sel.value = "default";
    (sel._listeners["change"] ?? []).forEach((cb: any) => cb());
    expect(setPreset).toHaveBeenCalledWith("default");
  });
```

- [ ] **Step 2: Test laufen → fehlschlägt.** Run: `npx vitest run tests/img_to_md_view.test.ts` · Expected: FAIL (kein `img2md-preset`).

- [ ] **Step 3: Deps-Interface erweitern.** In `ImgToMdViewDeps` (nach `setModel`) ergänzen:

```ts
  listPresets: () => { id: string; label: string }[];
  getPreset: () => string;
  setPreset: (id: string) => void;
```

- [ ] **Step 4: Feld + Dropdown.** Feld neben `modelSel` ergänzen:

```ts
  private presetSel: HTMLSelectElement | null = null;
```

  In `onOpen`, in der `modelRow`, **direkt nach** dem `modelSel`-`change`-Listener und **vor** `this.modelStatusEl = …`:

```ts
    this.presetSel = modelRow.createEl("select", { cls: "img2md-preset dropdown" });
    for (const p of this.deps.listPresets()) { const o = this.presetSel.createEl("option", { text: p.label }); o.value = p.id; }
    this.presetSel.value = this.deps.getPreset();
    this.presetSel.addEventListener("change", () => this.deps.setPreset(this.presetSel?.value ?? "default"));
```

- [ ] **Step 5: styles.css.** Nach `.img2md-model-row .img2md-model { flex: 1; }` ergänzen:

```css
.img2md-preset { font-size: 12px; }
.img2md-model-row .img2md-preset { flex: 1; }
```

- [ ] **Step 6: Tests laufen → grün.** Run: `npx vitest run tests/img_to_md_view.test.ts` · Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add src/img_to_md_view.ts styles.css tests/img_to_md_view.test.ts
git commit -m "feat(view): Preset-Dropdown neben dem Modell-Picker"
```

---

### Task 4: `main.ts` — Auflösung + Deps-Verdrahtung (Glue)

**Files:**
- Modify: `src/main.ts` (Import; `onload`-Guard ~`:29-31`; `makeImgIO.transcribe` `:82`; `makeImgViewDeps.transcribeStream` `:156/159`; Deps-Objekt ~`:177`)

**Interfaces:**
- Consumes: `resolvePromptText`, `isPromptPreset`, `PROMPT_PRESETS`, `promptPresetLabel` aus `./prompts`.
- Produces: implementiert `listPresets/getPreset/setPreset` für die View.

*Glue ohne eigenen Unit-Test (main.ts ist ungetesteter Glue) — verifiziert über `tsc`/`build` + grüne Gesamt-Suite.*

- [ ] **Step 1: Import ergänzen.** In `src/main.ts` bei den Imports:

```ts
import { resolvePromptText, isPromptPreset, PROMPT_PRESETS, promptPresetLabel } from "./prompts";
```

- [ ] **Step 2: onload-Guard.** Nach dem Settings-Merge (nach `this.settings.visionEndpoints = …`) ergänzen:

```ts
    if (!isPromptPreset(this.settings.promptPreset)) this.settings.promptPreset = "default";
```

- [ ] **Step 3: transcribe-Call-Site (`makeImgIO`).** Zeile `:82` ersetzen:

```ts
      transcribe: (dataUrl) => this.visionClient.transcribe(dataUrl, resolvePromptText(this.settings.promptPreset, this.settings.visionPrompt)),
```

- [ ] **Step 4: transcribeStream-Call-Sites (`makeImgViewDeps`).** Beide `this.settings.visionPrompt`-Vorkommen in `transcribeStream` (`:156` und `:159`) ersetzen durch:

```ts
resolvePromptText(this.settings.promptPreset, this.settings.visionPrompt)
```

  (Tipp: einmal lokal `const prompt = resolvePromptText(this.settings.promptPreset, this.settings.visionPrompt);` am Anfang des `try`/vor dem ersten Aufruf, dann `…transcribeStream(dataUrl, prompt, …)` an beiden Stellen.)

- [ ] **Step 5: Deps implementieren.** Im von `makeImgViewDeps` zurückgegebenen Objekt (z.B. nach `setModel`) ergänzen:

```ts
      listPresets: () => PROMPT_PRESETS.map(id => ({ id, label: promptPresetLabel(id) })),
      getPreset: () => this.settings.promptPreset,
      setPreset: (id: string) => { this.settings.promptPreset = id; void this.saveSettings(); },
```

- [ ] **Step 6: Voll verifizieren.** Run: `npx vitest run && npm run typecheck && npm run lint && npm run build` · Expected: alle grün/sauber.

- [ ] **Step 7: Commit.**

```bash
git add src/main.ts
git commit -m "feat(main): Preset-Auflösung an den Call-Sites + View-Deps"
```

---

### Task 5: Doku (README EN/DE · Manual · CHANGELOG)

**Files:**
- Modify: `README.md`, `README.de.md` (Feature-Liste: Prompt-Presets erwähnen)
- Modify: `docs/manual/` (passende how-to/reference-Seite — die existierende Prompt-Erwähnung um Presets ergänzen)
- Modify: `CHANGELOG.md` (`## [Unreleased]` → `### Hinzugefügt`-Eintrag)

*Reine Doku — kein Test; Vollständigkeit per Review.*

- [ ] **Step 1: CHANGELOG `[Unreleased]`-Eintrag.**

```markdown
### Hinzugefügt

- **Prompt-Presets:** Neben dem Modell-Picker in der Sidebar ein Preset-Wähler — „Standard" (dein
  editierbarer Prompt) plus feste Modi für Tabellen → Markdown, Handschrift, Mathe → LaTeX, Quellcode
  und Bildbeschreibung. Die Wahl bleibt erhalten (sticky). Der Prompt ist bei einem lokalen
  Vision-Modell der wichtigste Qualitätshebel.
```

- [ ] **Step 2: README EN + DE** — in der Feature-Liste einen Punkt zu Prompt-Presets ergänzen (analoger Stil zu den Nachbarpunkten; absolute Links beibehalten).

- [ ] **Step 3: Manual** — die bestehende Prompt-Erwähnung in `docs/manual/` um die Preset-Auswahl ergänzen (1–3 Sätze, EN; DE-Pendant falls vorhanden).

- [ ] **Step 4: Commit.**

```bash
git add README.md README.de.md docs/manual CHANGELOG.md
git commit -m "docs: Prompt-Presets (README EN/DE, Manual, CHANGELOG)"
```

---

## Nach dem Plan (außerhalb der Tasks)

Adversarieller Whole-Branch-Review → `version-bump 0.7.0` → Merge `main` (`--no-ff`) → Deploy Pallas → **Geräte-Abnahme (User)** → Release 0.7.0 (Codeberg kanonisch + GitHub-Mirror; bei manuellem Bump Resume-Pfad von `release.mjs`, s. Memory `codeberg-release-gotcha`).

## Self-Review (durchgeführt)
- **Spec-Coverage:** prompts.ts (Task 1) · settings (Task 2) · View-Dropdown (Task 3) · main-Wiring + Auflösung + onload-Guard + Deps (Task 4) · i18n EN/DE (Task 1) · Doku (Task 5). `prompt_preset`-Frontmatter bewusst out-of-scope (Spec). ✓
- **Placeholder-Scan:** keine TBD/TODO; jeder Code-Step zeigt echten Code. ✓
- **Typ-Konsistenz:** `resolvePromptText(id, customDefault)` · `listPresets(): {id,label}[]` · `getPreset(): string` · `setPreset(id: string)` durchgängig identisch in Task 3 (Interface) + Task 4 (Impl) + Tests. ✓
