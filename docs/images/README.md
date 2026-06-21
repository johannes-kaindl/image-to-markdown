# Screenshots — capture guide

This folder holds the screenshots referenced by [`README.md`](../../README.md),
[`README.de.md`](../../README.de.md) and the [manual](../manual/). The images do **not** exist
yet — this document is the contract for producing them: exact filenames, what each must show,
the recommended format, and a reproducible capture recipe so anyone can regenerate them
consistently.

> Note (CORE-META-03): the project prefers script-generated screenshots. These are captured
> **manually** because the subject is an interactive Obsidian UI plugin (sidebar view, live
> SSE stream, reasoning block) that has no headless render path. Keep the recipe below so the
> manual captures stay reproducible.

The UI of Image → Markdown is partly German and partly English (see the
[manual](../manual/)). When a screenshot contains a label, expect to see it **verbatim** as
listed under "Strings visible in the UI" — do not localise the running app before capturing.

## Conventions for every image

- **Format:** PNG.
- **Width:** ~1200 px (retina/2x capture downscaled to ~1200 px CSS width is ideal; never
  upscale a small grab).
- **Theme:** capture in Obsidian's default theme, light mode, so the images read well on both
  Codeberg and GitHub. Optionally provide a dark-mode variant later, but the names below are
  the canonical light-mode set.
- **Chrome:** show just enough Obsidian window to give context (sidebar + the relevant pane).
  Trim OS window decorations and unrelated panes.
- **Privacy:** use the throwaway demo vault described below — never a real vault. No personal
  note titles, no file paths that leak a username.
- **Filenames:** lowercase, exactly as listed. Do not add suffixes or change the extension.

## Required assets

Every filename below is referenced by at least one doc; together they are the complete set of
placeholders to resolve. Keep this table in sync whenever a doc adds or renames an image.

| Filename | Referenced by | Must show |
| --- | --- | --- |
| `hero.png` | `README.md`, `README.de.md` (hero) | The **"IMG → MD"** sidebar open next to a source note, mid-transcription — a card streaming Markdown live. The money shot. |
| `sidebar-streaming.png` | `README.md`, `README.de.md` (Features) | A single transcription card with the **live stream**, the expandable **thinking block**, and the **copy button** all visible. |
| `settings.png` | `README.md`, `README.de.md` (Configuration) | The settings tab under the **"Vision (Image → Markdown)"** heading: **"Vision Endpoint"**, the **"Vision Modell"** dropdown, and the **"Vision Prompt"** text area. |
| `tutorial-lmstudio.png` | `docs/manual/tutorial.md` (step 1) | A local server (e.g. LM Studio) with a **vision-capable model loaded**, listening on its port (LM Studio uses `:1234`). |
| `tutorial-sidebar.png` | `docs/manual/tutorial.md` (step 5) | The sidebar's **checkbox list** of embedded images for the active note (all pre-selected), with the **"Transkribieren"** button. The "before you press the button" state. |
| `context-menu.png` | `docs/manual/how-to.md` (single image) | The editor **right-click context menu** open over an embedded image, with the **"Image → Markdown"** entry highlighted. |
| `thinking-block.png` | `docs/manual/how-to.md` (reasoning) | A close-up of the **expanded** thinking block (`<details>`) of a reasoning model — summary **"💭 Gedanken"** with the reasoning content visible. |

### `hero.png`

- **Shows:** Obsidian with the **"IMG → MD"** sidebar (ribbon icon `scan-text`, ribbon label
  "Image → Markdown") open on the right, a note with an embedded scanned image on the left,
  and at least one card streaming Markdown live (partial text is fine and actually desirable —
  it communicates "streaming"). If a reasoning model is loaded, having the **"💭 denkt nach…"**
  thinking block visible mid-stream makes the hero stronger.
- **Frame:** main editor pane + the sidebar. Width ~1200 px.

### `sidebar-streaming.png`

- **Shows:** one card in detail. All three must be legible:
  1. the streamed Markdown body (read-only, `pre-wrap` raw Markdown);
  2. the expandable thinking block — summary reads **"💭 Gedanken"** when collapsed after the
     run, or **"💭 denkt nach…"** while still streaming;
  3. the copy button (icon `copy`, tooltip/aria-label **"Transkript kopieren"**) and the
     per-card **"Notiz anlegen"** button.
- **Tip:** expand the thinking block (`<details>`) before capturing so the reasoning content is
  visible, not just the summary line.
- **Frame:** crop tightly to the sidebar (one card + the footer **"Alle anlegen"** button is a
  nice bonus). Width ~1000–1200 px.

### `settings.png`

- **Shows:** **Settings → Community plugins → Image to Markdown**, the section under the
  **"Vision (Image → Markdown)"** heading: the **"Vision Endpoint"** text field, the
  **"Vision Modell"** dropdown (populated from `/v1/models` when the endpoint is online), and
  the **"Vision Prompt"** text area with the default prompt.
- **Frame:** the settings pane. Width ~1000–1200 px.

### `tutorial-lmstudio.png`

- **Shows:** the local inference server — LM Studio is the canonical example — with a
  **vision-capable model** (e.g. Qwen2-VL) loaded and the server running. Make the listening
  port visible if possible, since the tutorial calls out LM Studio's `:1234` versus the plugin
  default `:8080`.
- **Frame:** the server app window. Width ~1200 px.

### `tutorial-sidebar.png`

- **Shows:** the freshly opened sidebar for a note that embeds two or three images — the
  **checkbox list** with every supported image pre-checked, an unsupported format (e.g. a
  `.heic`) shown **disabled**, and the **"Transkribieren"** button. This is the "before you
  press the button" state.
- **Frame:** the sidebar pane. Width ~1000–1200 px.

### `context-menu.png`

- **Shows:** the Obsidian editor with an embedded image, the **right-click context menu** open
  over that image, and the **"Image → Markdown"** item (icon `scan-text`) highlighted. This is
  the single-image entry point that transcribes only the image under the cursor.
- **Frame:** editor pane with the open menu. Width ~1000–1200 px.

### `thinking-block.png`

- **Shows:** a single transcription card whose **thinking block is expanded** — the
  **"💭 Gedanken"** summary line followed by the model's reasoning text. Use a **reasoning
  model** (one that emits `reasoning_content`, or whose output contains inline `<think>` tags),
  otherwise the block does not appear.
- **Frame:** crop to the card and its thinking block. Width ~1000–1200 px.

## Reproducible capture recipe

1. **Demo vault.** Create a throwaway vault (e.g. `img2md-demo`) so nothing personal appears.
   Add one note, `Tutorial.md`, that embeds two or three images. Use **supported** formats
   (`png`, `jpg`/`jpeg`, `webp`, `gif`) for the ones you want transcribed; optionally add one
   `.heic` to demonstrate the disabled / skipped state in `tutorial-sidebar.png`.

2. **A real scanned image.** Use an image that actually contains text with structure —
   headings, a short paragraph, a bullet list, ideally a small table — so the streamed
   Markdown is visibly rich (good for `hero.png` and `sidebar-streaming.png`). Avoid anything
   copyrighted or private; a screenshot of your own plain-text scan works.

3. **Local vision endpoint.** Start an OpenAI-compatible server with a **vision-capable** model
   (e.g. LM Studio, Ollama, or an MLX server) — capture `tutorial-lmstudio.png` here. In
   **Settings → Image → Markdown**, under the **"Vision (Image → Markdown)"** heading
   (`settings.png`), set:
   - **"Vision Endpoint"** to your server's base URL **without** a trailing `/v1` (the client
     appends `/v1` itself). Remember the default `http://localhost:8080` is the MLX default —
     **LM Studio listens on `:1234`**.
   - **"Vision Modell"** — pick the loaded vision model from the dropdown.

4. **For the thinking block** (`hero.png`, `sidebar-streaming.png`, `thinking-block.png`): load
   a **reasoning model** (one that emits `reasoning_content`, or whose output contains inline
   `<think>` tags). Without a reasoning model the thinking block does not appear, so these shots
   specifically need one.

5. **Open the sidebar.** Run the command **"Sidebar öffnen"** (or click the `scan-text` ribbon
   icon labelled "Image → Markdown"). With `Tutorial.md` active you now have the
   `tutorial-sidebar.png` state — capture it before pressing the button. For `context-menu.png`,
   right-click an embedded image in the editor and capture the open menu instead.

6. **Transcribe.** Press **"Transkribieren"**. Capture **mid-stream** for `hero.png` (partial,
   streaming text is the point). For `sidebar-streaming.png` and `thinking-block.png`, let one
   card finish, expand its thinking block, and capture the card with the body + **"💭 Gedanken"**
   block + copy button.

7. **Place the files.** Save each capture as PNG at ~1200 px width using the exact filenames
   above, directly into this `docs/images/` folder. Re-run the README/manual to confirm the
   placeholders resolve.

## Strings visible in the UI (capture verbatim — do not localise)

- View title: **"IMG → MD"** · ribbon label: **"Image → Markdown"** · ribbon icon: `scan-text`
- Run button: **"Transkribieren"**
- Thinking block summary: **"💭 denkt nach…"** (while streaming) / **"💭 Gedanken"** (done)
- Copy button tooltip: **"Transkript kopieren"** (icon `copy`)
- Per-card button: **"Notiz anlegen"** · footer button: **"Alle anlegen"**
- Settings heading: **"Vision (Image → Markdown)"** with settings **"Vision Endpoint"**,
  **"Vision Modell"**, **"Vision Prompt"**
- Commands: **"Sidebar öffnen"**, **"Bilder der aktiven Notiz transkribieren"**
- Editor context-menu item: **"Image → Markdown"**

Once the real images land here, delete the corresponding `<!-- TODO(submission): … -->`
placeholders in `README.md`, `README.de.md` and the [manual](../manual/).
