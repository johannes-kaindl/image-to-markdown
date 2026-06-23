# Screenshots — capture guide

This folder holds the screenshots referenced by [`README.md`](https://codeberg.org/jkaindl/image-to-markdown/src/branch/main/README.md),
[`README.de.md`](https://codeberg.org/jkaindl/image-to-markdown/src/branch/main/README.de.md) and the
[manual](https://codeberg.org/jkaindl/image-to-markdown/src/branch/main/docs/manual/). The images do **not** exist
yet — this document is the contract for producing them: exact filenames, what each must show,
the recommended format, and a reproducible capture recipe so anyone can regenerate them
consistently.

> Note: the project prefers script-generated screenshots, but the subject is an interactive
> Obsidian UI plugin (sidebar view, live SSE stream, reasoning block, PDF page cards) with no
> headless render path, so these are captured **manually**. Keep the recipe below so the manual
> captures stay reproducible.

**Language: capture in English.** The UI is bilingual and follows Obsidian's language setting.
For the screenshots, set Obsidian to **English** (*Settings → About → Language → English*, then
reload) so the captures match the canonical English README. The strings you should see are listed
verbatim under "Strings visible in the UI" below. (German variants can be added later under a
`-de` suffix if desired, but the canonical set is English.)

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

Every filename below is referenced by at least one doc; together they are the complete set.
Keep this table in sync whenever a doc adds or renames an image. The README embeds images with
**absolute** Codeberg raw URLs (relative paths break on community.obsidian.md), e.g.
`https://codeberg.org/jkaindl/image-to-markdown/raw/branch/main/docs/images/hero.png`.

| Filename | Referenced by | Must show |
| --- | --- | --- |
| `hero.png` | `README.md`, `README.de.md` (top, hero) | The **"IMG → MD"** sidebar open next to a source note, **mid-transcription of a PDF** — several page cards (`… · page 1/3`, `2/3`, …), one streaming Markdown live. The money shot; shows the headline PDF feature + streaming at once. |
| `pdf-sidebar.png` | `README.md`, `README.de.md` (Features) | The sidebar list with an **embedded PDF**: the file name, **"N pages"**, and the **"Page [ ] to [ ]"** range inputs. The "pick your pages" state before pressing Transcribe. |
| `pdf-streaming.png` | `README.md`, `README.de.md` (Features) | PDF transcription in progress: **one card per page** (`<name> · page k/n`), at least one streaming live. Shows that a PDF becomes one note from many page cards. |
| `exists-open.png` | `README.md`, `README.de.md` (idempotency) | A sidebar entry whose source already has a transcript: the **"✓ transcript exists"** badge + **"open"** link, checkbox **off** (override is opt-in). |
| `sidebar-streaming.png` | `README.md`, `README.de.md` (Features) | A single transcription card with the **live stream**, the expandable **thinking block**, and the **copy button** all visible. |
| `settings.png` | `README.md`, `README.de.md` (Configuration) | The settings tab under **"Vision (Image → Markdown)"**: **"Vision endpoint"**, **"Vision model"** dropdown, **"Vision prompt"**, **and** the PDF settings — **"PDF max. pages per run"**, **"PDF render scale"** (a **slider**, 1–4), **"PDF page separator"** (dropdown). |
| `tutorial-lmstudio.png` | `docs/manual/tutorial.md` (step 1) | A local server (e.g. LM Studio) with a **vision-capable model loaded**, listening on its port (LM Studio uses `:1234`). |
| `tutorial-sidebar.png` | `docs/manual/tutorial.md` (step 5) | The sidebar's **checkbox list** of embedded images for the active note (all pre-selected), an unsupported format (e.g. `.heic`) **disabled**, and the **"Transcribe"** button. The "before you press the button" state. |
| `context-menu.png` | `docs/manual/how-to.md` (single image) | The editor **right-click context menu** open over an embedded image, with the **"Image → Markdown"** entry highlighted. |
| `thinking-block.png` | `docs/manual/how-to.md` (reasoning) | A close-up of the **expanded** thinking block of a reasoning model — summary **"💭 Thoughts"** with the reasoning content visible. |

### `hero.png`

- **Shows:** Obsidian with the **"IMG → MD"** sidebar (ribbon icon `scan-text`, label
  "Image → Markdown") open on the right, a note that embeds a **multi-page PDF** on the left, and
  the sidebar mid-run: several **page cards** (`<name> · page 1/3`, `page 2/3`, …) with at least
  one streaming Markdown live (partial text is desirable — it says "streaming"). A reasoning
  model's **"💭 thinking…"** block visible mid-stream makes it even stronger.
- **Frame:** main editor pane + the sidebar. Width ~1200 px.

### `pdf-sidebar.png`

- **Shows:** the freshly opened sidebar for a note that embeds a PDF. The row reads
  **`<name>.pdf`** followed by **"<N> pages"** (hover title) and two narrow number inputs framed
  as **"Page [1] to [N]"** — the selectable page range (default: all pages). The checkbox is
  ticked. This is the "pick your pages" state.
- **Frame:** the sidebar pane. Width ~1000–1200 px.

### `pdf-streaming.png`

- **Shows:** a PDF being transcribed — the cards area with **one card per page**, each headed
  `<name> · page k/n`, at least one filling with streamed Markdown. Communicates that one PDF
  produces many page cards that merge into a single transcript note.
- **Frame:** the sidebar cards area. Width ~1000–1200 px.

### `exists-open.png`

- **Shows:** a sidebar list entry for a source (image or PDF) that **already has a transcript**:
  the **"✓ transcript exists"** badge and a clickable **"open"** link, with the checkbox
  **unchecked** (re-transcribing/overwriting is opt-in via ticking it). Easiest to produce by
  opening the transcript note itself — its embedded source appears here as "exists".
- **Frame:** crop to the one list row. Width ~900–1200 px.

### `sidebar-streaming.png`

- **Shows:** one card in detail. All three must be legible:
  1. the streamed Markdown body (read-only, `pre-wrap` raw Markdown);
  2. the expandable thinking block — summary **"💭 Thoughts"** when collapsed after the run, or
     **"💭 thinking…"** while still streaming;
  3. the copy button (icon `copy`, tooltip/aria-label **"Copy transcript"**) and the per-card
     **"Create note"** button.
- **Tip:** expand the thinking block before capturing so the reasoning content is visible.
- **Frame:** crop tightly to the sidebar (one card + the footer **"Create all"** button is a nice
  bonus). Width ~1000–1200 px.

### `settings.png`

- **Shows:** **Settings → Community plugins → Image to Markdown**, the section under the
  **"Vision (Image → Markdown)"** heading. Scroll so the full set is visible:
  - **"Vision endpoint"** text field, **"Test connection"** button + status dot;
  - **"Vision model"** dropdown (populated from `/v1/models` when online) + **"Vision capability"**
    row with **"Test vision"**;
  - **"Vision prompt"** text area;
  - **"PDF max. pages per run"** (number), **"PDF render scale"** (a **slider** 1–4, step 0.5),
    **"PDF page separator"** (dropdown).
- **Frame:** the settings pane (two captures stitched, or one tall capture). Width ~1000–1200 px.

### `tutorial-lmstudio.png`

- **Shows:** the local inference server — LM Studio is the canonical example — with a
  **vision-capable model** (e.g. Qwen2-VL) loaded and the server running. Make the listening
  port visible if possible (LM Studio `:1234` versus the plugin default `:8080`).
- **Frame:** the server app window. Width ~1200 px.

### `tutorial-sidebar.png`

- **Shows:** the freshly opened sidebar for a note that embeds two or three **images** — the
  **checkbox list** with every supported image pre-checked, an unsupported format (e.g. a
  `.heic`) shown **disabled**, and the **"Transcribe"** button. The "before you press" state.
- **Frame:** the sidebar pane. Width ~1000–1200 px.

### `context-menu.png`

- **Shows:** the Obsidian editor with an embedded image, the **right-click context menu** open
  over that image, and the **"Image → Markdown"** item (icon `scan-text`) highlighted.
- **Frame:** editor pane with the open menu. Width ~1000–1200 px.

### `thinking-block.png`

- **Shows:** a single transcription card whose **thinking block is expanded** — the
  **"💭 Thoughts"** summary line followed by the model's reasoning text. Use a **reasoning model**
  (one that emits `reasoning_content`, or whose output contains inline `<think>` tags).
- **Frame:** crop to the card and its thinking block. Width ~1000–1200 px.

## Reproducible capture recipe

1. **Set Obsidian to English** (*Settings → About → Language → English*, reload) so the UI strings
   match this contract. Switch back to your language afterwards.

2. **Demo vault.** Create a throwaway vault (e.g. `img2md-demo`) so nothing personal appears. Add:
   - `Tutorial.md` — embeds two or three **images** (`png`/`jpg`/`webp`/`gif`); optionally one
     `.heic` for the disabled state (`tutorial-sidebar.png`).
   - `PdfDemo.md` — embeds one **multi-page PDF** (`![[doc.pdf]]`) for the PDF shots.

3. **Real content with structure.** Use an image / a PDF page that actually contains text with
   structure — headings, a paragraph, a bullet list, ideally a small table — so the streamed
   Markdown is visibly rich. Avoid anything copyrighted or private.

4. **Local vision endpoint.** Start an OpenAI-compatible server with a **vision-capable** model —
   capture `tutorial-lmstudio.png` here. In **Settings → Image to Markdown** (`settings.png`) set:
   - **"Vision endpoint"** to your server's base URL **without** a trailing `/v1` (default
     `http://localhost:8080` is the MLX default — **LM Studio listens on `:1234`**);
   - **"Vision model"** — pick the loaded vision model.
   While here, scroll to the **PDF settings** for `settings.png` (slider visible).

5. **Reasoning model** (for `hero.png`, `sidebar-streaming.png`, `thinking-block.png`): load a
   model that emits `reasoning_content` / inline `<think>` tags, otherwise the thinking block does
   not appear.

6. **Image shots.** Open the sidebar (command **"Open sidebar"** or the `scan-text` ribbon). With
   `Tutorial.md` active, capture `tutorial-sidebar.png` before pressing the button; right-click an
   embedded image for `context-menu.png`. Press **"Transcribe"** and capture a finished card with
   body + **"💭 Thoughts"** + copy button for `sidebar-streaming.png` / `thinking-block.png`.

7. **PDF shots.** With `PdfDemo.md` active, the PDF appears with **"N pages" + "Page [ ] to [ ]"**
   — capture `pdf-sidebar.png`. Press **"Transcribe"** and capture the **page cards** mid-stream
   for `pdf-streaming.png` and the **hero** (`hero.png`). After it writes the note, open that
   transcript note (it embeds the PDF) and capture the **"✓ transcript exists → open"** row for
   `exists-open.png`.

8. **Place the files.** Save each capture as PNG at ~1200 px width using the exact filenames
   above, directly into this `docs/images/` folder.

## Strings visible in the UI (English — capture verbatim)

- View title: **"IMG → MD"** · ribbon label / context-menu item: **"Image → Markdown"** · ribbon
  icon: `scan-text`
- Run button: **"Transcribe"** · select toggle: **"Deselect all"** / **"Select all"**
- Card head (image): **"Image i/n · name"** · card head (PDF page): **"name · page k/n"**
- Thinking block summary: **"💭 thinking…"** (streaming) / **"💭 Thoughts"** (done)
- Copy button tooltip: **"Copy transcript"** (icon `copy`)
- Per-card button: **"Create note"** · footer button: **"Create all"**
- Existing transcript: **"✓ transcript exists"** + **"open"**
- PDF range: **"Page [ ] to [ ]"** · PDF list row title (hover): **"name · N pages"**
- Settings heading: **"Vision (Image → Markdown)"** — **"Vision endpoint"**, **"Test connection"**,
  **"Vision model"**, **"Vision capability"** / **"Test vision"**, **"Vision prompt"**,
  **"PDF max. pages per run"**, **"PDF render scale"**, **"PDF page separator"**
- Commands: **"Open sidebar"**, **"Transcribe images in the active note"**

Once the real images land here, embed them in `README.md` / `README.de.md` (top hero + Features)
with **absolute Codeberg raw URLs** and add the relevant ones to the manual.
