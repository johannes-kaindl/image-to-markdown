# How-to guides

Task-focused recipes for getting things done with **Image to Markdown**. Each
section is a self-contained recipe with steps. They assume the plugin is
installed and a local vision endpoint is already configured — if not, start with
the setup notes in the [README](../../README.md).

> The plugin's UI follows **Obsidian's display language** (English is canonical,
> German is the translation). This guide is written in English and quotes the
> English labels, with the German equivalent in parentheses where it helps. The
> language is detected once when the plugin loads — reload the plugin to switch.
> See [Reference → UI language & localization](reference.md#ui-language--localization).

## Recipes

1. [Transcribe a single image from the editor context menu](#transcribe-a-single-image-from-the-editor-context-menu)
2. [Batch-transcribe all images of a note without the sidebar](#batch-transcribe-all-images-of-a-note-without-the-sidebar)
3. [Reuse an existing transcript instead of re-transcribing](#reuse-an-existing-transcript-instead-of-re-transcribing)
4. [Read the model's thinking](#read-the-models-thinking)
5. [Change the transcription prompt](#change-the-transcription-prompt)
6. [Switch the prompt preset](#switch-the-prompt-preset)
7. [Point at LM Studio instead of MLX](#point-at-lm-studio-instead-of-mlx)
8. [Handle iPhone / HEIC images](#handle-iphone--heic-images)
9. [Pick or pin a specific model](#pick-or-pin-a-specific-model)
10. [Check whether your model supports vision](#check-whether-your-model-supports-vision)
11. [Transcribe a PDF](#transcribe-a-pdf)
12. [Transcribe a linked image or PDF (without an embed)](#transcribe-a-linked-image-or-pdf-without-an-embed)
13. [Transcribe a standalone PDF or image file](#transcribe-a-standalone-pdf-or-image-file)
14. [Configure multiple endpoints (home + on the road)](#configure-multiple-endpoints-home--on-the-road)

---

## Transcribe a single image from the editor context menu

Use this when a note holds several images but you only want to transcribe one —
the image under your cursor — without opening the sidebar.

1. Open the note in the editor and place the cursor on the line that embeds the
   image you want.
2. Right-click to open the editor context menu.
3. Choose **"Image → Markdown"** (icon: `scan-text`).

The plugin transcribes only that one image, writes a transcript note, and
replaces the image embed in the source note with an embed of the new note. The
original text is never overwritten, and running it again on an
already-transcribed image creates no duplicate.

![Editor context menu with the Image → Markdown entry](../images/context-menu.png)
<!-- TODO(submission): editor context menu opened on an image embed, "Image → Markdown" entry highlighted — CORE-META-03 -->

---

## Batch-transcribe all images of a note without the sidebar

Use this when you want every supported image in the active note transcribed in
one go and you don't need the live streaming view.

1. Open the note whose images you want to transcribe.
2. Open the command palette and run the command
   **"Transcribe images in the active note"** ("Bilder der aktiven Notiz
   transkribieren").

Every supported image is transcribed, one transcript note is written per image,
and each image embed is replaced by an embed of its transcript note.
Unsupported formats are skipped with a notice (see
[Handle iPhone / HEIC images](#handle-iphone--heic-images)). The run is
non-destructive and idempotent, so already-transcribed images are not processed
again.

> Tip: there is also a command **"Sidebar öffnen"** (Open sidebar) if you would
> rather pick images individually and watch the transcription stream live.

---

## Reuse an existing transcript instead of re-transcribing

Transcription is idempotent: once a source has a transcript note, the plugin
recognises it and will not silently re-do the work or create a duplicate.

In the sidebar, an already-transcribed source is shown with its row marked
**"✓ transcript exists"** ("✓ Transkript vorhanden") followed by an **"open"**
("öffnen") link. Clicking that link jumps straight to the existing transcript
note — it does not transcribe anything. Such rows are left **unticked** by
default, so a plain **"Transcribe"** run skips them.

**To overwrite an existing transcript**, re-tick that row's checkbox and run
**"Transcribe"** again. The note is then rewritten: only the body and the
`transcribed_by` entry (plus `pages` for a PDF) are replaced — any other
frontmatter you added to the transcript note is preserved. Hovering the row
shows the hint **"re-transcribing overwrites it"** ("erneut transkribieren
überschreibt") as a reminder.

---

## Read the model's thinking

Reasoning ("thinking") models emit their chain of thought separately from the
final answer. Image to Markdown surfaces that as a collapsible thinking block so
you can see how the model arrived at a transcription.

1. Configure a reasoning-capable vision model as your **Vision-Modell** (see
   [Pick or pin a specific model](#pick-or-pin-a-specific-model)).
2. Open the sidebar (ribbon **"Image → Markdown"**, view title **"IMG → MD"**)
   and click **"Transkribieren"** (Transcribe).
3. As each card streams, click the thinking block at the top of the card to
   expand or collapse the model's reasoning.

The thinking content comes from the stream's `reasoning_content` plus any inline
`<think>` tags in the output. It is shown for your insight only: reasoning is
ephemeral and never enters the model's conversation history, and it is not part
of the written transcript.

![A transcription card with an expanded thinking block](../images/thinking-block.png)
<!-- TODO(submission): a sidebar card mid-stream with the thinking/reasoning block expanded — CORE-META-03 -->

---

## Change the transcription prompt

Adjust the instruction sent to the vision model — for example to transcribe into
a specific language, or to change the formatting style.

1. Open **Settings → Community plugins**, then open the Image to Markdown
   settings (heading **"Vision (Image → Markdown)"**).
2. Edit the **"Vision-Prompt"** text area.

The shipped default prompt is localized — you start from the variant matching
Obsidian's language. The English default is:

> Transcribe the text in the image exactly to Markdown. Preserve the structure:
> headings, paragraphs, **emphasis**, lists and tables. Output only the Markdown,
> no comments.

and the German default is:

> Transkribiere den Text im Bild exakt nach Markdown. Erhalte die Struktur:
> Überschriften, Absätze, **Hervorhebungen**, Listen und Tabellen. Gib nur das
> Markdown aus, keine Kommentare.

Some examples of how you might change it:

- **Output language**: append an instruction such as `Output in English.` to get
  English Markdown instead of the source language.
- **Keep it terse**: keep the closing instruction (`Output only the Markdown, no
  comments.` / `Gib nur das Markdown aus, keine Kommentare.`) so the model does
  not wrap the result in prose.
- **Style**: ask for a particular table or heading style, or to preserve line
  breaks exactly.

Changes take effect on the next transcription run. The text area edits the
**"Default"** preset — see the next section for the fixed built-in presets.

---

## Switch the prompt preset

The sidebar has a preset picker next to the model dropdown. With a local vision
model the prompt is the main quality lever, so switching the preset switches the
transcription mode without editing any text.

1. Open the **"IMG → MD"** sidebar (`scan-text` ribbon icon).
2. Use the **preset dropdown** next to the model dropdown to pick a mode:
   - **Default** — your editable prompt (the text area in settings, see above).
   - **Tables → Markdown** — render tables as GitHub-Flavored Markdown tables.
   - **Handwriting** — transcribe handwritten notes; illegible words marked `[?]`.
   - **Math → LaTeX** — formulas as `$…$` / `$$…$$`.
   - **Source code** — code in fenced code blocks, indentation preserved.
   - **Describe image** — a prose description (alt text) instead of a verbatim transcript.
3. Transcribe as usual. The choice is remembered (sticky) across runs and sessions.

The built-in presets are fixed; only the **Default** preset's text is editable
(in settings). The selection takes effect on the next transcription run.

---

## Point at LM Studio instead of MLX

The default endpoint targets a local MLX server on port `8080`. LM Studio's
local server listens on a different port (`1234`) — pointing at the wrong port
is the most common misconfiguration.

1. Start the LM Studio local server with a vision model loaded.
2. Open the Image to Markdown settings (heading **"Vision (Image → Markdown)"**).
3. Set **"Vision-Endpunkt"** to `http://localhost:1234`.

Notes:

- Enter the base URL **without** a trailing `/v1`. The client appends `/v1`
  itself; a trailing `/v1` is stripped automatically, and both forms are
  accepted.
- A wrong path used to produce a silently empty transcript, because LM Studio
  answers wrong paths with HTTP 200 and an error body rather than a real error.
  Using the correct base URL avoids this.

---

## Handle iPhone / HEIC images

Photos taken on iPhone are often `.heic` / `.heif`, which is the iOS default
container. Vision models reject it, so Image to Markdown does not send it.

**What you'll see:** unsupported images are recognised but skipped, with a notice
similar to:

> Format .heic nicht unterstützt (HEIC? iOS auf „Maximal kompatibel")

In the sidebar list, unsupported formats appear disabled (not pre-selected).

**Supported formats (sent to the model):** PNG, JPG, JPEG, WebP, GIF.
**Recognised but skipped:** BMP, HEIC, HEIF.

To get iPhone photos transcribed, do one of the following:

- On iPhone, go to **Settings → Camera → Formats** and choose
  **"Most Compatible"** (iOS: „Maximal kompatibel"). New photos are then
  captured as JPEG.
- Or convert existing `.heic` / `.heif` files to PNG or JPG before adding them to
  the note.

---

## Pick or pin a specific model

Choose exactly which vision model runs, or pin one when you have several loaded.

1. Open the Image to Markdown settings (heading **"Vision (Image → Markdown)"**).
2. Use the **"Vision-Modell"** setting:
   - When the endpoint is reachable, this is a **dropdown** populated from the
     endpoint's `/v1/models`. Pick the model you want (examples: Qwen2-VL,
     Llama-3.2-Vision).
   - When the endpoint is offline, the same setting becomes a **free-text field**
     so you can type a model name, with a **"Modelle laden"** (Load models) button
     to refresh the dropdown once the server is back up.

Good to know:

- The default is empty (`""`). With an empty value, the actually-used model is
  read from the server's `response.model`.
- **LM Studio ignores the `model` field** in the request and uses whichever
  model is currently loaded. Either way, the model that actually ran is recorded
  in the `transcribed_by` frontmatter of each transcript note, taken from
  `response.model` — so the note always reflects the real model, not just what
  you selected.
- If an external process swaps the model your backend has loaded, click the
  **"Refresh models"** ("Modelle aktualisieren") icon (`refresh-cw`) next to
  the model dropdown — in both the sidebar and Settings — to re-fetch the model
  list. If the previously selected model is no longer loaded, the selection is
  automatically aligned to the first available model. After each transcription
  run, the sidebar also performs an automatic post-sync: if `response.model`
  differs from the current selection, the selection follows the real model and
  a notice naming the new model ("Model changed to …" / "Modell gewechselt zu …") is shown.

---

## Check whether your model supports vision

Image to Markdown only works with **vision-capable** models. Picking a text-only
model leads to empty or garbage transcripts, so the settings tab surfaces a
capability hint and an active test.

1. Open the Image to Markdown settings (heading **"Vision (Image → Markdown)"**).
2. Look at the **"Vision-Fähigkeit"** (Vision capability) row for the selected
   model:
   - **"Vision"** (eye icon) — confirmed vision, from server metadata or a
     previous test.
   - **"Vision (unbestätigt)"** (Vision unconfirmed) — the model *name* looks
     vision-capable, but nothing has confirmed it.
   - **"Keine Vision"** (No vision) — no vision signal found.
3. To confirm for sure, click **"Vision testen"** (Test vision). It sends a small
   generated image with a known word to the model and checks the reply; on
   success the row switches to **"Vision"**.

Good to know:

- The passive hint combines a model-name heuristic with a metadata probe of your
  endpoint (Ollama `/api/show`, LM Studio `/api/v1/models` / `/api/v0/models`).
- The active **"Vision testen"** button is the reliable check when your endpoint
  exposes no capability metadata (a plain `/v1` server) — it actually runs the
  model on an image.

---

---

## Transcribe a PDF

Use this when a note contains an embedded PDF and you want a Markdown transcript of its text,
page by page, as a single transcript note.

> **Note:** PDFs are handled exclusively through the sidebar. The editor context menu and the
> "Transcribe images" batch command do not process PDFs — open the sidebar first.

1. Open the note that embeds the PDF you want to transcribe.
2. Click the ribbon icon **"Image → Markdown"** (or run the command **"Open sidebar"**) to open
   the **"IMG → MD"** sidebar. The PDF appears in the list alongside any images, with a page-range
   widget — **"Page" [from] "to" [to]** ("Seite" [von] "bis" [bis]) — built from two number
   fields. (The total page count itself is shown in the row's tooltip on hover.)
3. *(Optional)* Adjust the **page range** in those two fields if you only need a subset of pages.
   The default covers all pages. On mobile, keep the range short to stay within memory limits.
4. Make sure the PDF checkbox is selected and click **"Transcribe"** ("Transkribieren"). The
   sidebar streams one card per page as the vision model works through them.
5. Click **"Create note"** ("Notiz anlegen") on the finished card, or **"Create all"** ("Alle
   anlegen") if you transcribed both images and a PDF in the same run. One transcript note is
   written for the whole PDF, and the PDF embed in the source note is replaced by an embed of
   the new note.

The transcript note is non-destructive and idempotent: running it again on an already-transcribed
PDF creates no duplicate.

**Page limits:** the plugin enforces a configurable `pdfMaxPages` cap (see Settings). If your PDF
is very large, raise the cap in **Settings → Image to Markdown** or split the run into smaller
page ranges. On mobile the render scale is automatically reduced (`pdfRenderScale`) to keep
memory usage low — very large pages may still be limited; if a page fails to render it is skipped
with a notice.

**Page layout in the transcript:** the **"PDF page separator"** ("PDF-Seitentrenner") setting
controls how the per-page transcripts are joined into the single note. Choose between five
options (default is the first):

- **"Obsidian comment %% Page N %% (hidden in reading view)"** — an Obsidian comment marking each
  page, invisible in reading view. *(Default.)*
- **"Heading ## Page N"** — a visible level-2 heading per page.
- **"Horizontal rule ---"** — a horizontal rule between pages.
- **"Page break (HTML, for export)"** — an HTML page break, useful when you later export the note.
- **"None (seamless text)"** — no separator; the pages run together as continuous text.

Pick the one that suits how you want to read or export the merged PDF transcript.

---

## Transcribe a linked image or PDF (without an embed)

Use this when your note references an image or PDF as a plain link — `[[scan.pdf]]` or
`[Vertrag](akten/doc.pdf)` — rather than an embed (`![[scan.pdf]]`), and you still want a
transcript note without touching the original link.

The plugin recognises both embed syntax (`![[x]]` / `![alt](x)`) and plain link syntax
(`[[x]]` / `[text](x)`) for images and PDFs. Plain links appear in the sidebar with a
**"linked"** ("verlinkt") badge next to the file name.

1. Open the note containing the plain link.
2. Open the sidebar (**"Image → Markdown"** ribbon icon or **"Open sidebar"** command).
   The linked image or PDF appears in the list with the **"linked"** badge.
3. Select its checkbox and click **"Transcribe"** ("Transkribieren"). Transcription proceeds
   exactly as for an embed.
4. Click **"Create note"** ("Notiz anlegen") to write the transcript note.

**Key difference from embeds:** the plain link in the source note is **left unchanged**. Only the
transcript note is created — the source text is never modified. On the next scan the source still
shows the same link, and the row will display **"✓ transcript exists"** ("✓ Transkript vorhanden")
to indicate the transcript has already been written.

---

## Transcribe a standalone PDF or image file

Use this when you have opened a PDF or image file **directly** in Obsidian — not embedded
in a note, but as the active file itself — and you want to transcribe it without first
embedding it in a note.

1. Open the PDF or image directly in Obsidian (for example via the file explorer or a link
   that resolves to the media file itself).
2. Click the ribbon icon **"Image → Markdown"** (or run the command **"Open sidebar"**) to
   open the **"IMG → MD"** sidebar. Because the active file is itself the source, the sidebar
   shows a single entry labelled **"this file"** ("diese Datei") instead of scanning a
   note's embeds.
3. *(PDF only)* Adjust the page range if needed. The default covers all pages.
4. Click **"Transcribe"** ("Transkribieren"). Transcription streams exactly as for an
   embedded source.
5. Click **"Create note"** ("Notiz anlegen") to write the transcript note.

The transcript note is placed at Obsidian's **"Default location for new notes"** (the
same place Obsidian would create a new note) because there is no source note to sit next to.

Key differences from the note-embedded workflow:

- The transcript's frontmatter has no `source_note` field — there is no source note.
- The source file is **never modified** — there is no embed to replace.
- Idempotency and override work as usual: re-opening the same file shows
  **"✓ transcript exists"** with an "open" link; re-selecting and transcribing again
  overwrites the existing transcript note in place.

> **Note:** this only applies to the sidebar. The command "Transcribe images in the
> active note" and the editor context menu operate on notes with embedded media, not
> on standalone media files.

---

## Configure multiple endpoints (home + on the road)

Use this when you sync your vault across devices (desktop, iPhone, iPad) and the local server
runs on a machine that is not always the active device — so a single hard-coded endpoint address
does not work everywhere.

**The idea:** put `localhost:1234` first (works on the machine that runs LM Studio) and a LAN IP
second (works from your phone or tablet via WireGuard when you are at home). The plugin picks
the first reachable one automatically, so the same config file works on every device.

1. Open **Settings → Community plugins → Image to Markdown** (heading
   **"Vision (Image → Markdown)"**).
2. You will see an **endpoint list** — one input field per endpoint, with an empty field at the
   bottom as the "add new" slot.
3. In the **first field**, enter `http://localhost:1234` (the address of your local LM Studio).
4. Click into the **empty field** at the bottom and enter the LAN IP of the machine running LM
   Studio, e.g. `http://192.168.178.27:1234`.
5. Press Tab or click away. Each field immediately shows its reachability status:
   - Circle-check (green) — reachable right now.
   - Circle-x (red) — not reachable from this device / network.
   - Loader — checking.
   The **active** endpoint (the first reachable one) is labelled "active".
6. In the sidebar, the connection status reads **"connected via \<endpoint\>"** so you always
   know which server is in use.

Notes:

- **Order = priority.** The plugin tries endpoints from top to bottom and uses the first one
  that responds. Reorder by editing the fields: clear a lower field and re-enter it higher up.
- **Removing an endpoint:** clear the field and click away (blur). The empty slot disappears.
- **All offline:** if no endpoint responds the plugin reports offline and falls back to the first
  entry for display. Check the per-field icons to see which addresses are reachable.
- **Re-resolution:** the active endpoint is re-checked each time you open or refresh the sidebar,
  and automatically after a failed transcription call (one retry). No manual step needed when
  you switch networks.
- **One device, one endpoint:** if you only ever use one machine, a single endpoint is enough —
  the list with one entry behaves exactly like the old single-field mode.
- **Migration:** if you are upgrading from a version with a single endpoint field, your existing
  value is automatically converted to a one-item list — no action needed.

---

For the architecture and module layout behind all of this, see
[AGENTS.md](../../AGENTS.md) in the repository root.
