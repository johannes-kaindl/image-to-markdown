# Screenshots — capture guide

This folder holds the screenshots referenced by [`README.md`](https://git.jkaindl.de/jkaindl/image-to-markdown/src/branch/main/README.md),
[`README.de.md`](https://git.jkaindl.de/jkaindl/image-to-markdown/src/branch/main/README.de.md) and the
[manual](https://git.jkaindl.de/jkaindl/image-to-markdown/src/branch/main/docs/manual/). The images do **not** exist
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
  Forgejo and GitHub. Optionally provide a dark-mode variant later, but the names below are
  the canonical light-mode set.
- **Chrome:** show just enough Obsidian window to give context (sidebar + the relevant pane).
  Trim OS window decorations and unrelated panes.
- **Privacy:** use the throwaway demo vault described below — never a real vault. No personal
  note titles, no file paths that leak a username.
- **Filenames:** lowercase, exactly as listed. Do not add suffixes or change the extension.

## Required assets

Every filename below is referenced by at least one doc; together they are the complete set.
Keep this table in sync whenever a doc adds or renames an image. The README embeds images with
**absolute** Forgejo raw URLs (relative paths break on community.obsidian.md), e.g.
`https://git.jkaindl.de/jkaindl/image-to-markdown/raw/branch/main/docs/images/hero.png`.

| Filename | Referenced by | Must show |
| --- | --- | --- |
| `hero.png` | `README.md`, `README.de.md` (top, hero) | The **"IMG → MD"** sidebar open next to a source note, **mid-transcription of a PDF** — several page cards (`… · page 1/3`, `2/3`, …), one streaming Markdown live. The money shot; shows the headline PDF feature + streaming at once. |
| `pdf-sidebar.png` | `README.md`, `README.de.md` (Features) | The sidebar list with an **embedded PDF**: the file name, **"N pages"**, and the **"Page [ ] to [ ]"** range inputs. The "pick your pages" state before pressing Transcribe. |
| `pdf-streaming.png` | `README.md`, `README.de.md` (Features) | PDF transcription in progress: **one card per page** (`<name> · page k/n`), at least one streaming live. Shows that a PDF becomes one note from many page cards. |
| `exists-open.png` | `README.md`, `README.de.md` (idempotency) | A sidebar entry whose source already has a transcript: the **"✓ transcript exists"** badge + **"open"** link, checkbox **off** (override is opt-in). |
| `diff-modal.png` | `README.md`, `README.de.md` (non-destructive / idempotency) | The **"Overwrite `<file>`?"** diff modal shown before an opt-in re-transcribe overwrites an existing transcript note: a line-by-line diff with a **checkbox per changed hunk** (selective apply, all ticked by default) and the **"Cancel"** / **"Apply"** buttons. |
| `sidebar-streaming.png` | `README.md`, `README.de.md` (Features) | A single transcription card with the **live stream**, the expandable **thinking block**, and the **copy button** all visible. |
| `describe-mode.png` | `README.md`, `README.de.md` (Features) | The sidebar's mode switch **"Transcribe"** / **"Describe"** (with **"Describe"** active) plus a finished description card: image + description text, an editable **Category** field (with taxonomy suggestions) and free-form **Tags**, and the **"Save description"** button. |
| `refine.png` | `README.md`, `README.de.md` (Features) | A transcript card mid-refinement: the **"Refine"** feedback field, a scrollable history with the original transcription plus at least one refinement round, a per-round expandable **thinking** block, a **[Copy] [Create note]** action pair on each version, and the sidebar footer's **"Discard results"** / **"Apply"** buttons. |
| `thinking-toggle.png` | `README.md`, `README.de.md` (Features) | The sidebar's preset row with the **Thinking toggle** (brain icon) visible, showing one of **"Thinking: on"**, **"Thinking: off"**, or **"Thinking: always on"**. |
| `settings.png` | `README.md`, `README.de.md` (Configuration) | The settings tab under **"Vision (Image → Markdown)"**: the **"Vision endpoints"** list (per-entry reachability icon, active endpoint marked, **"Test connection"**), **"Vision model"** dropdown + **"Vision capability"** / **"Test vision"**, **"Vision prompt"**, the PDF settings — **"PDF max. pages per run"**, **"PDF render scale"** (a **slider**, 1–4), **"PDF page separator"** (dropdown), **"Use embedded PDF text"** toggle, **"Expand thinking by default"** toggle — and, further down the same page, the **"Description categories"** section (taxonomy fields). |
| `frontmatter-mapping.png` | `README.md`, `README.de.md` (Configuration / Features) | The settings tab's **"Frontmatter mapping"** section: the per-key text fields (source image/PDF/note key, category key, tags key, transcribed-by key, described-by key, created key, pages key, kind key, and the two kind values for transcript/description). |
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

### `diff-modal.png`

- **Shows:** the diff-confirm modal that gates the plugin's one destructive operation — re-transcribing
  a source whose transcript note already exists, with **override ticked**. Title reads
  **"Overwrite `<file>`?"**. Below it, a line-by-line diff of old vs. new content, grouped into
  **hunks**: each changed hunk has its own **checkbox** (ticked by default — this is the selective-apply
  feature, so untick at least one to show that it is possible), unchanged context lines have none.
  `+`/`-` markers should be visible on the changed lines. Footer has **"Cancel"** and a highlighted
  **"Apply"** button (`mod-warning`).
- **Tip:** produce it by re-transcribing (with the row checkbox ticked) a source that already has a
  transcript note, ideally one you hand-edited slightly first so the diff has a few hunks to show off
  the per-hunk checkboxes.
- **Frame:** the modal only. Width ~800–1100 px.

### `sidebar-streaming.png`

- **Shows:** one card in detail. All three must be legible:
  1. the streamed Markdown body (read-only, `pre-wrap` raw Markdown);
  2. the expandable thinking block — summary **"💭 Thoughts"** when collapsed after the run, or
     **"💭 thinking…"** while still streaming;
  3. the copy button (icon `copy`, tooltip/aria-label **"Copy transcript"**) and the per-card
     **"Create note"** button.
- **Tip:** expand the thinking block before capturing so the reasoning content is visible.
- **Frame:** crop tightly to the sidebar (one card + the footer **"Apply"** button, visible once at
  least one card is done, is a nice bonus). Width ~1000–1200 px.

### `describe-mode.png`

- **Shows:** the sidebar's mode switch — two buttons **"Transcribe"** / **"Describe"** — with
  **"Describe"** active (`is-active` / `aria-pressed="true"`), and below it a finished description
  card: the source image's name, the generated description text, an editable **Category** input
  (its datalist of taxonomy suggestions is a nice bonus if it can be shown open) and a **Tags** input
  with a couple of comma-separated tags typed in, plus the **"Save description"** button.
- **Tip:** run a describe pass on an image that is more photo/diagram than text so the point of the
  mode — findable via search despite having no OCR-able text — reads clearly.
- **Frame:** the mode row + one description card. Width ~1000–1200 px.

### `refine.png`

- **Shows:** a transcript card that has been refined at least once:
  1. the original transcription as the log's first entry (labelled **"Original"**);
  2. one or more refinement rounds below it, each headed **"You: `<feedback>`"**, with a per-round
     expandable thinking block and a **[Copy] [Create note]** action pair;
  3. the **"Refine"** input at the bottom of the card (placeholder **"Feedback, e.g. tables as
     GFM"**);
  4. the sidebar footer with **"Discard results"** (left) and the colored **"Apply"** button
     (right).
- **Tip:** submit one round of feedback, wait for it to finish, expand its thinking block, then
  capture — this shows the conversational/chat-style history at its clearest.
- **Frame:** the full card (log + refine input) plus the footer. Width ~1000–1200 px.

### `thinking-toggle.png`

- **Shows:** the sidebar's preset row (preset dropdown + the Thinking toggle button side by side) with
  the toggle clearly showing its brain icon and one of its three label states — **"Thinking: on"**
  (default), **"Thinking: off"**, or (with a model that cannot be suppressed, e.g. gpt-oss/harmony)
  **"Thinking: always on"**. Prefer capturing the "on" state, optionally a second close-up for "off".
- **Frame:** crop to the preset row. Width ~600–900 px.

### `settings.png`

- **Shows:** **Settings → Community plugins → Image to Markdown**, the section under the
  **"Vision (Image → Markdown)"** heading. Scroll so the full set is visible:
  - **"Vision endpoints"** — the dynamic list (one field per endpoint, empty trailing field = add
    new), each with its own reachability icon (circle-check / circle-x / loader), the active
    endpoint marked, and the **"Test connection"** button;
  - **"Vision model"** dropdown (populated from `/v1/models` when online) + **"Vision capability"**
    row with **"Test vision"**;
  - **"Vision prompt"** text area;
  - **"PDF max. pages per run"** (number), **"PDF render scale"** (a **slider** 1–4, step 0.5),
    **"PDF page separator"** (dropdown);
  - **"Use embedded PDF text"** toggle (pdfUseTextLayer);
  - **"Expand thinking by default"** toggle (reasoningExpanded);
  - further down the same settings page, the **"Description categories"** heading with its dynamic
    **Categories** list (one field per category, same add/remove pattern as the endpoints list).
  The **"Frontmatter mapping"** section that follows is covered by its own screenshot, see
  `frontmatter-mapping.png` below — no need to scroll that far for this capture.
- **Frame:** the settings pane (several captures stitched, or one tall capture). Width ~1000–1200 px.

### `frontmatter-mapping.png`

- **Shows:** the settings tab's **"Frontmatter mapping"** section (the heading plus its intro text),
  and every per-key text field below it: source image key, source PDF key, source note key,
  category key, tags key, transcribed-by key, described-by key, created key, pages key, kind key,
  and the two kind *values* (for transcript notes and description notes respectively).
- **Tip:** this section is long — a tall capture or two stitched captures are fine, as long as every
  field label and its current value are legible.
- **Frame:** the "Frontmatter mapping" section only. Width ~1000–1200 px.

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
   - **"Vision endpoints"** — add your server's base URL **without** a trailing `/v1` (default
     `http://localhost:8080` is the MLX default — **LM Studio listens on `:1234`**); add a second
     row to show the list is dynamic/ordered if convenient;
   - **"Vision model"** — pick the loaded vision model.
   While here, scroll through the **PDF settings** (slider visible, plus the **"Use embedded PDF
   text"** and **"Expand thinking by default"** toggles) and the **"Description categories"**
   section for `settings.png`; scroll further to the **"Frontmatter mapping"** section separately
   for `frontmatter-mapping.png`.

5. **Reasoning model** (for `hero.png`, `sidebar-streaming.png`, `thinking-block.png`,
   `refine.png`, `thinking-toggle.png`): load a model that emits `reasoning_content` / inline
   `<think>` tags, otherwise the thinking block does not appear. Capture `thinking-toggle.png` in
   the sidebar's preset row once this model is selected (its default **"Thinking: on"** state);
   optionally toggle it off for a second close-up.

6. **Image shots.** Open the sidebar (command **"Open sidebar"** or the `scan-text` ribbon). With
   `Tutorial.md` active, capture `tutorial-sidebar.png` before pressing the button; right-click an
   embedded image for `context-menu.png`. Press **"Transcribe"** and capture a finished card with
   body + **"💭 Thoughts"** + copy button for `sidebar-streaming.png` / `thinking-block.png`.

7. **Describe-mode shot.** Switch the mode row to **"Describe"**, select an image that is more
   photo/diagram than text, and run it. Once the description card is done, type a category (or pick
   one from the taxonomy suggestions) and a couple of tags, then capture `describe-mode.png`
   (mode switch + the finished card) before clicking **"Save description"**.

8. **Refine shot.** Back in **"Transcribe"** mode, finish a transcription, then type feedback into
   the card's **"Refine"** field (e.g. "tables as GFM") and submit. Once the round finishes, expand
   its thinking block and capture `refine.png` — the log (original + at least one round), the
   refine input, and the sidebar footer's **"Discard results"** / **"Apply"** buttons.

9. **Diff-modal shot.** Pick a source that already has a transcript note (from step 6/7 above);
   optionally hand-edit that note slightly first so the diff has more than one hunk. Tick the row's
   checkbox to force override and press **"Transcribe"** again — capture the resulting
   **"Overwrite `<file>`?"** modal (with its per-hunk checkboxes) for `diff-modal.png` before
   confirming or cancelling.

10. **PDF shots.** With `PdfDemo.md` active, the PDF appears with **"N pages" + "Page [ ] to [ ]"**
    — capture `pdf-sidebar.png`. Press **"Transcribe"** and capture the **page cards** mid-stream
    for `pdf-streaming.png` and the **hero** (`hero.png`). After it writes the note, open that
    transcript note (it embeds the PDF) and capture the **"✓ transcript exists → open"** row for
    `exists-open.png`.

11. **Place the files.** Save each capture as PNG at ~1200 px width using the exact filenames
    above, directly into this `docs/images/` folder.

## Strings visible in the UI (English — capture verbatim)

Verified against `src/i18n.ts` (`STRINGS.en`) — do not guess these, quote them verbatim.

- View title: **"IMG → MD"** · ribbon label / context-menu item: **"Image → Markdown"** · ribbon
  icon: `scan-text`
- Run button: **"Transcribe"** (mode: transcribe) or **"Describe"** (mode: describe) · select
  toggle: **"Deselect all"** / **"Select all"**
- Mode switch (segmented control): **"Transcribe"** / **"Describe"**
- Card head (image): **"Image i/n · name"** · card head (PDF page): **"name · page k/n"**
- Thinking block summary: **"💭 thinking…"** (streaming) / **"💭 Thoughts"** (done)
- Copy button tooltip: **"Copy transcript"** (icon `copy`)
- Per-card button: **"Create note"** (new note) / **"Update note"** (overwrites an existing one) ·
  sidebar footer buttons: **"Discard results"** (left, shown once there are cards to clear) /
  **"Apply"** (right, `mod-cta`, shown once ≥1 card is done — writes every done card's latest
  version) · **"Retry failed"** (shown once there is at least one error)
- Existing transcript: **"✓ transcript exists"** + **"open"** · row tooltip when already
  transcribed: **"re-transcribing overwrites it"**
- PDF range: **"Page [ ] to [ ]"** · PDF list row title (hover): **"name · N pages"**
- Describe-mode card: **"Category"** / **"Tags"** input labels (aria-label only, no visible text
  next to the inputs) · **"Save description"** button · existing description badge:
  **"✓ description exists"**
- Refine: input placeholder **"Feedback, e.g. tables as GFM"** · submit button **"Refine"** ·
  history entry headings: **"Original"** (first block) and **"You: `<feedback>`"** (each round,
  `{0}` is the feedback text verbatim) · empty-result notice: **"No revision returned"**
- Thinking toggle (brain icon, next to the preset dropdown): **"Thinking: on"** /
  **"Thinking: off"** / **"Thinking: always on"** (models that cannot suppress reasoning)
- Diff modal (shown before the plugin's one destructive operation, an opt-in overwrite of an
  existing transcript note): title **"Overwrite `<file>`?"** · per-hunk checkbox aria-label
  **"Apply change `<n>`"** · buttons **"Cancel"** / **"Apply"** (`mod-warning`)
- Settings heading: **"Vision (Image → Markdown)"** — **"Vision endpoints"** (plural — an ordered,
  dynamic list, not a single field), **"Test connection"**, **"Vision model"**,
  **"Vision capability"** / **"Test vision"**, **"Vision prompt"**, **"PDF max. pages per run"**,
  **"PDF render scale"**, **"PDF page separator"**, **"Use embedded PDF text"** (pdfUseTextLayer),
  **"Expand thinking by default"** (reasoningExpanded)
- Settings — describe-mode taxonomy: heading **"Description categories"**, field group
  **"Categories"**
- Settings — frontmatter mapping: heading **"Frontmatter mapping"**; field labels **"Source image
  key"**, **"Source PDF key"**, **"Source note key"**, **"Category key"**, **"Tags key"**,
  **"Transcribed-by key"**, **"Described-by key"**, **"Created key"**, **"Pages key"**,
  **"Kind key"**, **"Kind value: transcript"**, **"Kind value: description"**
- Commands: **"Open sidebar"**, **"Transcribe images in the active note"**

Once the real images land here, embed them in `README.md` / `README.de.md` (top hero + Features)
with **absolute Forgejo raw URLs** and add the relevant ones to the manual.
