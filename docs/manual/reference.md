# Reference

Dry, exhaustive reference for **Image to Markdown** (plugin id `image-to-markdown`, version 0.1.0, minimum Obsidian 1.4.0, Desktop and Mobile). For the source-level architecture and module layout, see [AGENTS.md](../../AGENTS.md).

User-facing strings in Obsidian are partly German and partly English; this reference quotes them verbatim, exactly as they appear in the app. Optional English glosses are given in parentheses.

## Commands

Registered under Obsidian's command palette (`Cmd/Ctrl-P`).

| Command id | Name (verbatim) | Gloss | Behaviour |
| --- | --- | --- | --- |
| `transcribe-active-note` | "Bilder der aktiven Notiz transkribieren" | Transcribe the images of the active note | Batch-transcribes every supported embedded image of the active note without opening the sidebar. With no active note, shows a notice ("Keine aktive Notiz."). |
| `open-sidebar` | "Sidebar öffnen" | Open sidebar | Reveals the "IMG → MD" sidebar view (creates it in the right leaf if not already open). |

## Ribbon & context menu

| Element | Value | Notes |
| --- | --- | --- |
| Ribbon icon | `scan-text` | Activates the sidebar view. |
| Ribbon label | "Image → Markdown" | Tooltip on the ribbon icon. |
| Editor context menu item | "Image → Markdown" (icon `scan-text`) | Appears when the cursor is on a line containing an image embed. Transcribes only the image under the cursor (falls back to the first image on the line). |
| View title | "IMG → MD" | Display text of the sidebar view. |
| View type | `image-to-markdown-view` | Internal Obsidian view-type identifier. |

The sidebar view lists every embedded image of the active note as a checkbox list (all pre-selected; unsupported formats disabled). The "Transkribieren" (Transcribe) button streams the vision response live into one card per image — with a collapsible thinking block for reasoning models and a copy button. Each card has a "Notiz anlegen" (Create note) button; there is also an "Alle anlegen" (Create all) button. Cards are read-only and render the raw Markdown as pre-wrapped text. After a transcript note is written, the handled image drops out of the list on the next re-scan.

## Settings

Settings tab heading in Obsidian: "Vision (Image → Markdown)".

| Name (verbatim) | Description | Default |
| --- | --- | --- |
| "Vision Endpoint" | OpenAI-compatible server hosting a vision model. Enter the base URL. | `http://localhost:8080` |
| "Vision Modell" | Vision-capable model (examples: Qwen2-VL, Llama-3.2-Vision). Dropdown populated from the endpoint's `/v1/models`; falls back to a free-text field when the endpoint is offline. | `""` (empty) |
| "Vision Prompt" | Instruction sent to the vision model (free-text area). | "Transkribiere den Text im Bild exakt nach Markdown. Erhalte die Struktur: Überschriften, Absätze, \*\*Hervorhebungen\*\*, Listen und Tabellen. Gib nur das Markdown aus, keine Kommentare." |

Notes:

- The default endpoint `http://localhost:8080` is the MLX default. LM Studio listens on `:1234` — this is the most common misconfiguration.
- "Vision Modell" defaults to empty; the model actually used is read from `response.model`. LM Studio ignores the `model` field in the request and uses the loaded model, so the effective model name comes back in the response.

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

HEIC/HEIF is the iOS default and is rejected by vision models. Set iOS to "Maximal kompatibel" / "Most Compatible", or convert the images beforehand. On skip, a notice appears, e.g. `Format .heic nicht unterstützt (HEIC? iOS auf „Maximal kompatibel")`.

## Transcript note

For every transcribed image, the plugin writes exactly one transcript note (bundled, read-once / write-once, no race). The note carries front matter, including:

| Front-matter key | Value |
| --- | --- |
| `transcribed_by` | The model name read from `response.model`. |

Behaviour:

- One transcript note per image. Re-running produces no duplicates (idempotent).
- The image embed in the source note is replaced by an embed of the new transcript note. The original text is never overwritten (non-destructive).
- Because the embed is replaced, the handled image no longer appears in the sidebar list on the next scan.

---

For the architecture, module layout, and contribution conventions, see [AGENTS.md](../../AGENTS.md). Licensing: code under [AGPL-3.0-or-later](../../LICENSE), documentation under [CC BY-SA 4.0](../../LICENSE-DOCS).
