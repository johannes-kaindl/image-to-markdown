# Spec — Named Prompt-Presets (0.7.0)

Tier-2-Feature aus der Best-Practice/SOTA-Gap-Analyse (Roadmap §🗺️ im Cockpit). Bei einem fixen
lokalen Vision-Modell ist der **Prompt der dominante Qualitätshebel** — derselbe Modellpfad macht OCR,
Tabellen-Extraktion, Mathe oder Bildbeschreibung allein als Funktion der Instruktion. Statt eines
einzigen globalen Prompts bekommt der Nutzer eine **per-Lauf wählbare Preset-Auswahl**.

## Entscheidungen (Brainstorming 2026-06-30)

- **Modell:** feste, read-only Built-in-Presets **+** der bestehende editierbare `visionPrompt` als
  „Default"-Preset. Kein CRUD, keine editierbaren Built-ins.
- **Auswahl:** Dropdown in der Sidebar neben dem Modell-Picker; die Wahl wird persistiert (sticky über
  Runs + Sessions, genau wie der Modell-Picker).
- **Satz:** `default` (editierbar) + 5 Built-ins: `tables` · `handwriting` · `math` · `code` · `describe`.
- **Frontmatter-Provenienz (`prompt_preset`): bewusst NICHT in 0.7.0** — sauber gemacht (Erfassung zur
  Transkriptionszeit) müsste der Wert durch Karte → Partition → Schreib-Kette → `buildTranscriptNote`/
  `buildPdfNote` + Override gefädelt werden. Der Kernnutzen steht ohne; spätere kleine Iteration.

## Architektur

Reiner Kern bleibt obsidian-frei (PROF-OBS-03/04). Folgt exakt dem etablierten Modell-Picker-Muster
(Persistenz via `setModel`→`saveSettings`).

### `src/prompts.ts` (NEU, rein, unit-getestet)
- `PROMPT_PRESETS: readonly string[]` = `["default","tables","handwriting","math","code","describe"]`
  (Reihenfolge = Dropdown-Reihenfolge; `default` zuerst).
- `promptPresetLabel(id: string): string` → `t("preset.label.<id>")` (Fallback unbekannt → id).
- `builtinPromptText(id: string): string` → `id === "default"` ⇒ `""` (Guard); sonst `t("preset.prompt.<id>")`.
- `resolvePromptText(id: string, customDefault: string): string`
  - `id === "default"` → `customDefault.trim() ? customDefault : defaultVisionPrompt()`
  - sonst → `builtinPromptText(id)`; unbekannte id → wie `default`.
- `isPromptPreset(id: string): boolean` (für Settings-Validierung / Migrations-Robustheit).

### `src/settings.ts`
- Interface `ImageToMarkdownSettings`: neues Feld `promptPreset: string`.
- `defaultSettings()`: `promptPreset: "default"`. `visionPrompt` bleibt unverändert (= Default-Text).
- Keine eigene Migrationsfunktion: fehlt `promptPreset` in `data.json`, greift der `Object.assign`-Merge
  in `main.onload` (`defaultSettings()` liefert `"default"`). Defensive Normalisierung beim Laden:
  ist `promptPreset` kein gültiger Preset (Tippfehler/alt) → auf `"default"` zurückfallen
  (`isPromptPreset`-Guard in `main.onload`).
- Settings-Tab: die bestehende Prompt-Textarea (`settings.prompt.*`) als **Default-Prompt** kennzeichnen
  (Desc-Text ergänzen: „Text des ‚Default'-Presets; weitere Presets wählst du in der Sidebar"). Keine
  weitere Settings-UI (Built-ins read-only).

### `src/main.ts`
- Beide `this.settings.visionPrompt`-Aufrufe (`transcribe` in `makeImgIO` `:82`, `transcribeStream` in
  `makeImgViewDeps` `:156/159`) → `resolvePromptText(this.settings.promptPreset, this.settings.visionPrompt)`.
  (Auch der Command-/Kontextmenü-Pfad über `makeImgIO().transcribe` profitiert damit automatisch.)
- `onload`: nach dem Settings-Merge `if (!isPromptPreset(this.settings.promptPreset)) this.settings.promptPreset = "default"`.
- Neue View-Deps:
  - `listPresets: () => { id: string; label: string }[]`
  - `getPreset: () => string`
  - `setPreset: (id: string) => void` → setzt `settings.promptPreset` + `saveSettings()` (kein Reconnect).

### `src/img_to_md_view.ts`
- In `img2md-model-row`, **direkt nach dem Modell-`select`** (vor `modelStatus`/`refreshBtn`), ein
  zweites `select.dropdown` (`img2md-preset`): Optionen aus `deps.listPresets()` (`option.value = id`,
  Text = `label`), Wert = `deps.getPreset()`, `change` → `deps.setPreset(select.value)`.
- Reihenfolge in der Zeile: `[Modell ▾] [Preset ▾] [status] [↻]` — beide `select` teilen sich die Breite.
- Rein additiv; kein Einfluss auf Run-/Karten-Logik. Persistenz trägt der Dep (sticky).
- `styles.css`: `.img2md-preset { flex: 1; font-size: 12px; }` und `.img2md-model-row .img2md-preset { flex: 1; }`
  (analog `.img2md-model`, beide Dropdowns gleich breit; kompakt auch mobil).

## i18n (EN kanonisch + DE)

Labels:
- `preset.label.default` = „Default" / „Standard"
- `preset.label.tables` = „Tables → Markdown" / „Tabellen → Markdown"
- `preset.label.handwriting` = „Handwriting" / „Handschrift"
- `preset.label.math` = „Math → LaTeX" / „Mathe → LaTeX"
- `preset.label.code` = „Source code" / „Quellcode"
- `preset.label.describe` = „Describe image" / „Bild beschreiben"

Built-in-Prompt-Texte (`preset.prompt.<id>`), EN kanonisch (DE-Übersetzung sinngemäß):
- `tables`: „Transcribe the image to Markdown. Render every table as a GitHub-Flavored Markdown table
  (pipes with a header separator row), preserving all rows, columns and cell text exactly. Output only
  the Markdown, no comments."
- `handwriting`: „Transcribe the handwritten text in the image to Markdown as accurately as possible.
  Preserve line breaks, lists and structure. Mark an illegible word as [?]. Output only the Markdown,
  no comments."
- `math`: „Transcribe the image to Markdown. Render mathematical formulas as LaTeX: inline math as
  $…$ and display equations as $$…$$. Preserve the surrounding text and structure. Output only the
  Markdown, no comments."
- `code`: „Transcribe the image to Markdown. Put source code into fenced code blocks (```), preserving
  indentation, line breaks and symbols exactly. Output only the Markdown, no comments."
- `describe`: „Describe the image in clear prose suitable as alt text: what it shows, its key elements
  and any visible text. Summarize rather than transcribe verbatim. Output only the description, no
  comments."

(`default` hat keinen Built-in-Text — er nutzt `settings.visionPrompt` bzw. `defaultVisionPrompt()`.)

## Testing
- `tests/prompts.test.ts`: `resolvePromptText` (`default`→customDefault; leerer customDefault→
  `defaultVisionPrompt()`; jede Built-in-id→nicht-leerer Text; unbekannte id→default-Verhalten);
  `promptPresetLabel` (bekannt/unbekannt); `isPromptPreset`; `PROMPT_PRESETS`-Reihenfolge.
- `tests/settings.test.ts`: `defaultSettings().promptPreset === "default"`; `visionPrompt` unverändert.
- `tests/img_to_md_view.test.ts`: Dropdown `img2md-preset` rendert alle Presets mit Labels; Wert =
  `getPreset()`; `change` ruft `setPreset(value)`. (View-Mock-Deps um listPresets/getPreset/setPreset
  erweitern.)
- i18n-Vollständigkeit (EN/DE-Parität) deckt der bestehende `i18n.test.ts`-Paritätstest ab, falls
  vorhanden; sonst eine gezielte Assertion je neuem Key.
- Alle bestehenden Tests bleiben grün; `tsc`/`eslint`/`build` sauber.

## Out of scope (bewusst)
- `prompt_preset`-Frontmatter-Provenienz (s. o.).
- Per-Karte/-Seite-Preset, editierbare/CRUD-Presets, Per-Ordner-Mapping.
- Chart→Mermaid- und Reiner-Text-Presets (später nachrüstbar — reine i18n+Registry-Erweiterung).
- `{pageInfo}`/Prompt-Variablen-Interpolation (eigener Tier-3-Roadmap-Punkt).

## DoD
Alle Tests grün, `tsc`/`eslint`/`build` sauber, adversarieller Whole-Branch-Review, nach Pallas deployed,
Geräte-Abnahme, Release 0.7.0 (Codeberg kanonisch + GitHub-Mirror).
