# Reference

Dry, exhaustive reference for **Image to Markdown** (plugin id `image-to-markdown`, version 0.3.0, minimum Obsidian 1.8.7, Desktop and Mobile). For the source-level architecture and module layout, see [AGENTS.md](../../AGENTS.md).

The plugin's user-facing strings follow Obsidian's display language: **English is canonical**, with a **German** translation. This reference quotes the English strings verbatim, with the German equivalent in parentheses where it helps. A small set of brand and control strings ("Image → Markdown", "IMG → MD", "Stop") is intentionally left unlocalized. See [UI language & localization](#ui-language--localization) for how the language is detected and what is and is not translated.

## Commands

Registered under Obsidian's command palette (`Cmd/Ctrl-P`). The displayed command names follow Obsidian's display language — both variants are listed below.

| Command id | Name (EN) | Name (DE) | Behaviour |
| --- | --- | --- | --- |
| `transcribe-active-note` | "Transcribe images in the active note" | "Bilder der aktiven Notiz transkribieren" | Batch-transcribes every supported embedded image of the active note without opening the sidebar. PDFs are skipped here (a notice points to the sidebar). With no active note, shows a notice ("No active note." / "Keine aktive Notiz."). |
| `open-sidebar` | "Open sidebar" | "Sidebar öffnen" | Reveals the "IMG → MD" sidebar view (creates it in the right leaf if not already open). |

## Ribbon & context menu

| Element | Value | Notes |
| --- | --- | --- |
| Ribbon icon | `scan-text` | Activates the sidebar view. |
| Ribbon label | "Image → Markdown" | Tooltip on the ribbon icon. |
| Editor context menu item | "Image → Markdown" (icon `scan-text`) | Appears when the cursor is on a line containing an image embed. Transcribes only the image under the cursor (falls back to the first image on the line). |
| View title | "IMG → MD" | Display text of the sidebar view. |
| View type | `image-to-markdown-view` | Internal Obsidian view-type identifier. |

The sidebar view lists every embedded image and PDF of the active note as a checkbox list. Supported images with no existing transcript are pre-selected; unsupported formats are disabled, and rows that already have a transcript are left **unchecked by default** (see [Re-transcribing & override](#re-transcribing--override)). A "Deselect all" / "Select all" ("Alle abwählen" / "Alle auswählen") toggle flips the whole supported set. The "Transcribe" ("Transkribieren") button streams the vision response live into one card per unit — with a collapsible thinking block for reasoning models and a copy button. While a run is in progress the button becomes "Stop" (unlocalized). Each card has a "Create note" ("Notiz anlegen") button; there is also a "Create all" ("Alle anlegen") button. Cards are read-only and render the raw Markdown as pre-wrapped text. After a transcript note is written, the handled image drops out of the list on the next re-scan.

A row that already has a transcript shows a "✓ transcript exists" ("✓ Transkript vorhanden") marker with an "open" ("öffnen") link to that note, and a row tooltip "re-transcribing overwrites it" ("erneut transkribieren überschreibt").

Pure links (non-embed references) on images and PDFs — `[[x.pdf]]` or `[text](x.pdf)` **without** a leading `!` — are also recognised as sources and appear in the sidebar. Such rows are marked with a **"linked"** ("verlinkt") badge. When the transcript note is written for a linked source, the link in the source note is left untouched (unlike embeds, which are replaced by an embed of the transcript note).

### PDFs in the sidebar

PDFs embedded in a note are transcribed **page-by-page** via the sidebar and merged into **one transcript note per PDF**. Each PDF row carries a **page range** selector — a "Page" ("Seite") label, a numeric *from* input, a "to" ("bis") separator, and a numeric *to* input. The range defaults to the whole document, capped to the "PDF max. pages per run" setting (`{ from: 1, to: min(pageCount, pdfMaxPages) }`); the inputs are clamped to `1…pageCount`. The row title shows `name · N pages` ("… Seiten"). One streaming card is produced per page (head `name · page i/N` / "… Seite i/N"). The transcript note's title uses the localized PDF suffix "(PDF transcript)" ("(PDF-Transkript)"); how its pages are joined is controlled by [PDF page separator](#settings) and the render resolution by [PDF render scale](#settings). If the selected range exceeds the cap, transcription stops with the notice "PDF has {0} pages (limit {1}) — narrow the page range."

### Re-transcribing & override

Re-running is opt-in for content that already has a transcript. Because rows with an existing transcript start **unchecked**, a re-run skips them unless you check them back on. When you do, the existing transcript note is **overwritten in place** (no new file, the source note is not touched): the note's existing front matter is preserved and only `transcribed_by` (and, for PDFs, `pages`) plus the body are rewritten. So `source_image` / `source_pdf`, `source_note`, and `created` survive a re-transcription unchanged.

## Settings

Settings tab heading in Obsidian: "Vision (Image → Markdown)". The leading word follows Obsidian's language ("Vision" in both English and German here), while the bracketed "Image → Markdown" is the unlocalized plugin name.

| Name (verbatim) | Description | Default |
| --- | --- | --- |
| "Vision endpoint" ("Vision-Endpunkt") | OpenAI-compatible server hosting a vision model. Enter the base URL. | `http://localhost:8080` |
| "Vision model" ("Vision-Modell") | Vision-capable model (examples: Qwen2-VL, Llama-3.2-Vision). Dropdown populated from the endpoint's `/v1/models`; falls back to a free-text field when the endpoint is offline. | `""` (empty) |
| "Vision prompt" ("Vision-Prompt") | Instruction sent to the vision model (large free-text area). The shipped default is itself localized — see note below. | English: "Transcribe the text in the image exactly to Markdown. Preserve the structure: headings, paragraphs, \*\*emphasis\*\*, lists and tables. Output only the Markdown, no comments." German: "Transkribiere den Text im Bild exakt nach Markdown. Erhalte die Struktur: Überschriften, Absätze, \*\*Hervorhebungen\*\*, Listen und Tabellen. Gib nur das Markdown aus, keine Kommentare." |
| "PDF max. pages per run" ("PDF max. Seiten pro Lauf") | Safety cap — PDFs with more pages than this limit must be narrowed via the page range selector in the sidebar. | `25` |
| "PDF render scale" ("PDF-Render-Auflösung") | Controls the render resolution for PDF pages before they are sent to the vision model. Shown as a slider from `1.0` to `4.0` in steps of `0.5`. `2.0` ≈ 144 dpi; higher values produce sharper images but use more memory. On mobile the scale is automatically capped at `1.5` regardless of this setting. | `2.0` |
| "PDF page separator" ("PDF-Seitentrenner") | How pages are separated in the merged PDF transcript note. Dropdown with five options: "Obsidian comment %% Page N %% (hidden in reading view)" (`comment`), "Heading ## Page N" (`heading`), "Horizontal rule ---" (`rule`), "Page break (HTML, for export)" (`pagebreak`), "None (seamless text)" (`none`). | `comment` (the Obsidian comment `%% Page N %%`) |

Notes:

- The default endpoint `http://localhost:8080` is the MLX default. LM Studio listens on `:1234` — this is the most common misconfiguration.
- "Vision-Modell" defaults to empty; the model actually used is read from `response.model`. LM Studio ignores the `model` field in the request and uses the loaded model, so the effective model name comes back in the response.

### Connection & model controls

Alongside the settings listed above, the tab shows:

- A **connection status dot** next to the "Vision endpoint" field (auto-pinged when the tab opens) plus a **"Test connection"** ("Verbindung testen") button — both call the endpoint's `/v1/models` and report connected / offline (`● verbunden` / `○ offline` in German).
- A **"Vision capability"** ("Vision-Fähigkeit") row for the selected model, plus a **"Test vision"** ("Vision testen") button — see [Vision capability detection](#vision-capability-detection).
- A **"Load models"** ("Modelle laden") button that appears when the endpoint is offline, to refresh the model dropdown once the server is up.
- A **"Refresh models"** ("Modelle aktualisieren") icon button (`refresh-cw`) next to the "Vision model" dropdown — re-fetches `/v1/models` at any time. If the previously selected model is no longer in the list (e.g. because an external process swapped the loaded model), the selection is automatically aligned to the first available model. The same icon also appears next to the model dropdown in **Settings**. After every transcription run the sidebar additionally performs an automatic post-sync: if `response.model` differs from the current selection, the selection is updated and a notice "Model changed to {0}" ("Modell gewechselt zu {0}") is shown in the status line.

## Vision capability detection

The "Vision capability" row reports one of three states for the selected model (labels shown in English, with the German equivalent in parentheses):

| Display | Confidence | Meaning |
| --- | --- | --- |
| 👁 "Vision" | confirmed | Server metadata or an active test confirmed vision. |
| "Vision (unconfirmed)" ("Vision (unbestätigt)") | likely | The model name looks vision-capable, but it is unconfirmed. |
| "No vision" ("Keine Vision") | no | No vision signal found. |

It is computed passively from two sources, taking the stronger signal: a **name heuristic** (e.g. `llava`, `*-vl`, `pixtral`, `glm-4v`, `gemma3` ≥ 4B) and a **metadata probe** of the endpoint (Ollama `/api/show`, LM Studio `/api/v1/models` / `/api/v0/models`).

The **"Test vision"** button confirms vision **actively**: it sends a small generated image containing a known token to the model and checks whether the reply contains that token. On success the model is marked `confirmed` for the rest of the settings session. This is the reliable check when an endpoint exposes no capability metadata (a plain `/v1` server).

## Endpoint normalization

The client appends `/v1/...` to the configured endpoint itself. To stay robust against a trailing `/v1` in the input, the endpoint is normalized before use:

- Trailing slashes are stripped.
- A single trailing `/v1` is stripped.
- Both forms are therefore accepted: `http://host:1234` and `http://host:1234/v1` resolve to the same base.

Footgun: without normalization, an endpoint ending in `/v1` produced `…/v1/v1/chat/completions`. LM Studio answers wrong paths with HTTP 200 and an error body (not a real error), so the response is "ok", the stream is empty, and the transcript silently comes back blank. Normalization removes the trailing `/v1` (and slashes) to prevent this.

## Supported image formats

Ground truth from the embed scanner.

| Category | Extensions | Behaviour |
| --- | --- | --- |
| Sent to the model | `png`, `jpg`, `jpeg`, `webp`, `gif` | Transcribed. |
| Recognized but skipped | `bmp`, `heic`, `heif` | Detected as image embeds but skipped, with a notice. |

HEIC/HEIF is the iOS default and is rejected by vision models. Set iOS to "Most Compatible" ("Maximal kompatibel"), or convert the images beforehand. On skip, a localized notice appears, e.g. `Format .heic not supported (HEIC? Set iOS to "Most Compatible")` / `Format .heic nicht unterstützt (HEIC? iOS auf „Maximal kompatibel")`.

## Transcript note

For every transcribed image (or PDF), the plugin writes exactly one transcript note (bundled, read-once / write-once, no race). The note carries front matter:

| Front-matter key | Value |
| --- | --- |
| `source_image` | (Image transcripts only) Wikilink to the transcribed image, e.g. `"[[scan.png]]"`. This link is the basis of idempotency — see [Idempotency & the backlink index](#idempotency--the-backlink-index). |
| `source_pdf` | (PDF transcripts only) Wikilink to the transcribed PDF, e.g. `"[[doc.pdf]]"`. Same role as `source_image`. |
| `source_note` | Wikilink to the source note the embed lived in. |
| `created` | The creation date (`YYYY-MM-DD`). |
| `transcribed_by` | The model name read from `response.model`. |
| `pages` | (PDF transcripts only) The transcribed page range, e.g. `"1-12"`. |

Behaviour:

- One transcript note per image (one per PDF). Re-running produces no duplicates (idempotent).
- For **embeds** (`![[x]]`): the image/PDF embed in the source note is replaced by an embed of the new transcript note. The original text is never overwritten (non-destructive). Because the embed is replaced, the handled image no longer appears in the sidebar list on the next scan.
- For **pure links** (`[[x]]` / `[text](x)`, shown with the "linked" badge in the sidebar): the transcript note is written, but the link in the source note is **left unchanged**. The source note is not modified.

### Idempotency & the backlink index

Existing transcripts are detected before a re-run so they are not duplicated. Detection does **not** rely on the body embed alone: the plugin walks Obsidian's backlink index (`metadataCache.resolvedLinks`) for notes that link to the source, and then keeps only those whose `source_pdf` / `source_image` **front-matter** link resolves back to that source. A plain body embed that happens to point at the source is intentionally **not** enough — the front-matter filter is load-bearing, so an unrelated note that merely embeds the image is never mistaken for its transcript. A matched transcript is what the sidebar surfaces as "✓ transcript exists" with the "open" link, and what an opt-in re-transcription overwrites in place.

## UI language & localization

The plugin's interface is bilingual. **English is the canonical language; German is the translation.** Strings are not tied to the operating-system locale but to **Obsidian's own display language**.

### Language detection

- The display language is read from Obsidian via `getLanguage()` (available in Obsidian 1.8 and newer). On older versions the plugin falls back to `moment.locale()`.
- A locale starting with `de` selects German; every other value selects English.
- Detection happens **once, when the plugin loads**. Changing Obsidian's language afterwards does **not** retranslate a running session — **reload the plugin (or restart Obsidian) to switch languages.**

### What is localized

- **Settings** — the tab body labels and descriptions ("Vision endpoint", "Vision model", "Vision prompt", "Test connection", "Vision capability", "Test vision", "Load models") and the capability states.
- **Buttons** — the sidebar controls "Transcribe", "Create note", "Create all".
- **Notices** — status and error messages, including the unsupported-format notice and "No active note." ("Keine aktive Notiz.").
- **View** — the in-view prompts and helper text of the sidebar.
- **Commands** — the displayed command names (see [Commands](#commands)).
- **Default Vision prompt** — the shipped default instruction is localized (EN/DE), so a new user sees a sensible instruction in their own language out of the box.

### What is not localized

- **Brand and control strings**: the plugin name "Image → Markdown", the sidebar view title "IMG → MD", and the in-progress "Stop" label stay fixed in every language.
- **Transcript front matter**: the keys (`source_image` / `source_pdf`, `source_note`, `created`, `transcribed_by`, `pages`) and their values are data, not UI, and are written verbatim regardless of language.

---

For the architecture, module layout, and contribution conventions, see [AGENTS.md](../../AGENTS.md). Licensing: code under [AGPL-3.0-or-later](../../LICENSE), documentation under [CC BY-SA 4.0](../../LICENSE-DOCS).
