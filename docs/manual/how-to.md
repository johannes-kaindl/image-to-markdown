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
3. [Read the model's thinking](#read-the-models-thinking)
4. [Change the transcription prompt](#change-the-transcription-prompt)
5. [Point at LM Studio instead of MLX](#point-at-lm-studio-instead-of-mlx)
6. [Handle iPhone / HEIC images](#handle-iphone--heic-images)
7. [Pick or pin a specific model](#pick-or-pin-a-specific-model)
8. [Check whether your model supports vision](#check-whether-your-model-supports-vision)

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
   **"Bilder der aktiven Notiz transkribieren"** (Transcribe the images of the
   active note).

Every supported image is transcribed, one transcript note is written per image,
and each image embed is replaced by an embed of its transcript note.
Unsupported formats are skipped with a notice (see
[Handle iPhone / HEIC images](#handle-iphone--heic-images)). The run is
non-destructive and idempotent, so already-transcribed images are not processed
again.

> Tip: there is also a command **"Sidebar öffnen"** (Open sidebar) if you would
> rather pick images individually and watch the transcription stream live.

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

Changes take effect on the next transcription run.

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

For the architecture and module layout behind all of this, see
[AGENTS.md](../../AGENTS.md) in the repository root.
