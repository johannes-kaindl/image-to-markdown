# Image to Markdown

> 🇬🇧 English · [🇩🇪 Deutsch](https://codeberg.org/jkaindl/image-to-markdown/src/branch/main/README.de.md)

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](https://codeberg.org/jkaindl/image-to-markdown/src/branch/main/LICENSE)
[![Docs: CC BY-SA 4.0](https://img.shields.io/badge/docs-CC%20BY--SA%204.0-lightgrey.svg)](https://codeberg.org/jkaindl/image-to-markdown/src/branch/main/LICENSE-DOCS)
[![Release](https://img.shields.io/gitea/v/release/jkaindl/image-to-markdown?gitea_url=https%3A%2F%2Fcodeberg.org&label=release)](https://codeberg.org/jkaindl/image-to-markdown/releases)
![Platform](https://img.shields.io/badge/platform-Obsidian%201.8.7%2B%20·%20desktop%20%26%20mobile-7c3aed)

**Transcribe images and PDFs in a note to Markdown with a local vision LLM — fully offline, non-destructive, streaming live into the sidebar.**

## Features

- Transcribes **images and PDFs** embedded in a note via any OpenAI-compatible local vision model
- **Streaming live** into a sidebar — watch the Markdown appear as the model generates
- **PDF page ranges** — pick which pages to transcribe; pdf.js is bundled, fully offline
- **Idempotent** — one transcript note per source, no duplicates; re-transcribe is opt-in
- **Bilingual** — Obsidian's language setting (English / Deutsch) drives the UI automatically
- **Non-destructive** — source notes are never overwritten; embeds are replaced, originals untouched
- **Standalone files** — open a PDF or image directly in Obsidian and the sidebar treats *that file* as the source, no surrounding note required
- **Prompt presets** — a sidebar picker next to the model: a "Default" preset (your editable prompt) plus fixed modes for tables → Markdown, handwriting, math → LaTeX, source code and image description; the choice is sticky. With a local vision model the prompt is the main quality lever
- **Endpoint fallback list** — configure an ordered list of Vision endpoints; the plugin pings them in order and uses the first reachable one automatically, so a single synced config works across devices and networks

### In detail

Image to Markdown turns the embedded images and PDFs of an Obsidian note — scans, screenshots, photographed pages — into editable Markdown using an OpenAI-compatible vision model that runs on your own machine. Nothing leaves your computer, and your source note is never overwritten: each image or PDF gets its own transcript note, and the original embed is simply replaced by an embed of that new note.

- **Sidebar view.** A ribbon icon (`scan-text`, label "Image → Markdown") opens the "IMG → MD" view. It lists every embedded image of the active note as a checkbox list — all preselected, with unsupported formats disabled. The **"Transcribe"** button streams the vision model's answer **live** into one card per image, including an expandable thinking block for reasoning models and a copy button. Each card has a **"Create note"** button, plus **"Create all"**. Cards are read-only and show the raw Markdown pre-wrapped. After a transcript is written, the handled image drops out of the list on the next scan.
- **PDF transcription (sidebar).** Embedded PDFs appear in the same sidebar alongside images. Select the page range you want (default: all pages), then click **"Transcribe"** — each page is rendered via the bundled pdf.js and transcribed page-by-page. One transcript note is created per PDF and the PDF embed is replaced, exactly like an image. Page limits (`pdfMaxPages`) and a mobile-friendly render scale (`pdfRenderScale`, a 1.0–4.0 slider) keep memory usage in check, and the page separator in the merged note (`pdfPageSeparator`) is configurable. No external CDN — pdf.js is bundled fully offline.
- **Standalone file as source.** When the active file *is itself* a PDF or image — opened directly in Obsidian, not embedded in a note — the sidebar lists it as a single entry labelled **"this file"** and treats it as the transcription source. The page-range picker works as usual for PDFs; images show a single card. The transcript note is placed at Obsidian's **"Default location for new notes"** (via `app.fileManager.getNewFileParent`) because there is no source note to sit next to. The frontmatter contains no `source_note` field; `source_pdf`/`source_image`, `created`, `transcribed_by` (and `pages` for PDFs) are still written. The source file is never modified. Idempotency and override apply as usual.
- **Backlink-based idempotency.** Already-transcribed sources are detected automatically via the vault's backlink index: if a note already carries a `source_pdf` or `source_image` frontmatter field that resolves to the source file, the sidebar shows **"✓ transcript exists"** with an **"open"** link for that entry instead of re-transcribing. Such entries start unchecked; re-tick the row's checkbox and transcribe to force a new transcription (the row's tooltip reads "re-transcribing overwrites it") — the existing note is overwritten while its full frontmatter (except `transcribed_by`/`pages`) is preserved.
- **Endpoint fallback list.** Instead of a single Vision endpoint, the plugin accepts an ordered list. On each resolve (sidebar refresh, or after a failed call with one automatic retry) it pings the endpoints in order and picks the first reachable one. The active endpoint is marked in the settings and shown in the sidebar status line as **"connected via \<endpoint\>"**. The settings tab renders a dynamic field per entry — an empty trailing field acts as "add new"; clearing a field and leaving it removes the entry. Each field shows its own reachability icon (circle-check / circle-x / loader) plus accessible title text. A single synced `data.json` therefore works on all your devices: put `localhost:1234` first (the machine running LM Studio), then a LAN IP as fallback (reachable from phone/tablet via WireGuard). Migration is automatic: an existing `visionEndpoint` key in `data.json` is silently promoted to `visionEndpoints` — no manual action needed.
- **Bilingual UI (English / Deutsch)** — every user-facing string follows Obsidian's language setting; English is canonical, German is provided automatically. The language is detected once when the plugin loads (reload to switch).
- **Command "Transcribe images in the active note"** (id `transcribe-active-note`) — batch transcription without opening the sidebar.
- **Command "Open sidebar"** (id `open-sidebar`) — opens the sidebar view.
- **Editor context-menu entry "Image → Markdown"** (icon `scan-text`) — transcribes only the image under the cursor. (PDFs are not supported via context menu — use the sidebar.)

Reasoning models that emit `reasoning_content` in the stream, or inline `<think>` tags, get their thoughts collected into the expandable thinking block. Reasoning is ephemeral — it is shown to you but **never** added to the LLM history.

## Requirements

- **Obsidian 1.8.7+** (desktop or mobile).
- **An OpenAI-compatible local server running a vision-capable model** (e.g. [LM Studio](https://lmstudio.ai)). New to local LLMs? The **[local LLM setup guide](https://uplink.jkaindl.de/llm-setup)** walks you through server, model and mobile access end to end. The endpoint and model are configured in the plugin settings. Nothing leaves your machine: offline-first, no cloud, no VPN required.

## Install

### Community plugins (recommended)

Search for **Image to Markdown** in **Settings → Community plugins → Browse**, then click **Install** and **Enable**.

### Manual

Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://codeberg.org/jkaindl/image-to-markdown/releases) and place them in `<vault>/.obsidian/plugins/image-to-markdown/`, then enable the plugin under **Settings → Community plugins**.

### From source

```bash
git clone https://codeberg.org/jkaindl/image-to-markdown
cd image-to-markdown
npm install
npm run build   # produces main.js
```

Then copy `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/image-to-markdown/` and reload Obsidian.

## Usage

1. Point the plugin at your local vision server (see [Configuration](#configuration) below) and make sure the model is loaded.
2. Open a note that contains embedded images or PDFs.
3. Click the ribbon icon **"Image → Markdown"** (or run the command **"Open sidebar"**) to open the **"IMG → MD"** sidebar. The embedded images and PDFs appear as a preselected checkbox list; unsupported formats are disabled.
4. Click **"Transcribe"**. Each selected image or PDF gets a card that fills live with the streamed Markdown. For reasoning models, expand the thinking block to watch the model reason; use the copy button to grab the raw Markdown.
5. Click **"Create note"** on a single card, or **"Create all"** to write every transcript at once. Each image or PDF becomes one transcript note, and its embed in the source note is replaced by an embed of the new note.

Prefer to skip the sidebar? Run the command **"Transcribe images in the active note"** to batch-transcribe the active note. Or right-click an image in the editor and choose **"Image → Markdown"** to transcribe only the image under the cursor.

### Configuration

Open **Settings → Community plugins → Image to Markdown**. The settings live under the heading **"Vision (Image → Markdown)"**.

| Setting | What it does | Default |
|---|---|---|
| **Vision endpoints** | Ordered list of OpenAI-compatible servers. The plugin pings them in order and uses the first reachable one. | `["http://localhost:8080"]` (the MLX default — note that LM Studio uses `:1234`) |
| **Vision model** | The vision-capable model to use (e.g. Qwen2-VL, Llama-3.2-Vision). A dropdown filled from the endpoint's `/v1/models`; if the endpoint is offline it becomes a free-text field. | `""` (empty) — the model actually used is read from `response.model` |
| **Vision prompt** | The instruction sent to the vision model; freely editable text area. The shipped default is localized (English or German, following Obsidian). | "Transcribe the text in the image exactly to Markdown. Preserve the structure: headings, paragraphs, **emphasis**, lists and tables. Output only the Markdown, no comments." |
| **PDF max. pages per run** | Safety cap on the number of transcribed PDF pages per run — larger PDFs must be narrowed via the page range. Hard-capped at 500. | `25` |
| **PDF render scale** | Render resolution of PDF pages before OCR (1.0–4.0 slider, step 0.5). Low = faster, less memory; high = sharper page images & better OCR on small text (2.0 ≈ 144 dpi). On mobile it is clamped to 1.5 to protect against OOM. | `2.0` |
| **PDF page separator** | How pages are separated in the merged transcript note. Five options: Obsidian comment `%% Page N %%` (hidden in reading view), heading `## Page N`, horizontal rule `---`, page break (HTML, for export), or none (seamless text). | Obsidian comment `%% Page N %%` |

**Endpoint tip:** enter the base URL **without** a trailing `/v1` — the client appends `/v1` itself. (`normalizeEndpoint` strips a trailing `/v1` and slashes, so both forms are accepted; a doubled `…/v1/v1/…` path would otherwise silently return an empty transcript.)

Next to the input fields the settings tab shows a **connection status** indicator with a **"Test connection"** button, and a **"Vision capability"** row with a **"Test vision"** button that confirms whether the selected model can actually read images — see the [manual reference](https://codeberg.org/jkaindl/image-to-markdown/src/branch/main/docs/manual/reference.md#vision-capability-detection).

## How it works

For each selected image, the plugin builds a multimodal chat-completions request — the image lives in the `content` array — to the configured OpenAI-compatible vision endpoint, and streams the Markdown back over SSE (`content` plus `reasoning_content`). It then writes one transcript note per image with a `transcribed_by` frontmatter field (the model name taken from `response.model`, because some servers such as LM Studio ignore the request's `model` field and use the loaded model instead) and replaces the image embed in the source note with an embed of the new note. The result is non-destructive and idempotent.

For PDFs, each page is rendered to a canvas by the bundled pdf.js (offline, no CDN; worker embedded as a Blob URL), converted to a PNG data URL, and sent to the same vision endpoint as a regular image. Pages stream as individual cards in the sidebar, and one transcript note is produced for the whole PDF.

The architecture and module layout are documented in [AGENTS.md](https://codeberg.org/jkaindl/image-to-markdown/src/branch/main/AGENTS.md).

## Manual

The full documentation follows the [Diátaxis](https://diataxis.fr) framework — see [docs/manual/index.md](https://codeberg.org/jkaindl/image-to-markdown/src/branch/main/docs/manual/index.md):

- **Tutorial** — get from zero to your first transcript.
- **How-to guides** — task-focused recipes (configuring LM Studio, handling HEIC, batch transcription).
- **Reference** — settings, commands, supported formats.
- **Explanation** — the non-destructive/idempotent design and the streaming mechanism.

See the [changelog](https://codeberg.org/jkaindl/image-to-markdown/src/branch/main/CHANGELOG.md) for release notes.

### Supported image formats

Sent to the model: **PNG, JPG, JPEG, WebP, GIF.** Recognized but **skipped** (with a notice): **BMP, HEIC, HEIF.** HEIC/HEIF is the iOS default and is rejected by vision models — set iOS to "Most Compatible" ("Maximal kompatibel") or convert the image first. When an image is skipped you'll see a notice such as: *Format .heic nicht unterstützt (HEIC? iOS auf „Maximal kompatibel")*.

## Related

**[vault-rag](https://codeberg.org/jkaindl/vault-rag)** — the sister plugin, home of the RAG core (related notes, semantic search, chat). Image to Markdown was split out of vault-rag 0.2.0 on 2026-06-21 because image transcription is not RAG; the two only ever shared the SSE transport.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](https://codeberg.org/jkaindl/image-to-markdown/src/branch/main/CONTRIBUTING.md) for the workflow (test-driven, `main` always green, feature work in `feat/<name>`, Conventional Commits) and [AGENTS.md](https://codeberg.org/jkaindl/image-to-markdown/src/branch/main/AGENTS.md) for the architecture and module conventions. The canonical repository lives on [Codeberg](https://codeberg.org/jkaindl/image-to-markdown); GitHub (`johannes-kaindl/image-to-markdown`) is a mirror.

## License

- **Code:** [AGPL-3.0-or-later](https://codeberg.org/jkaindl/image-to-markdown/src/branch/main/LICENSE). A commercial dual-license is available on request if the AGPL copyleft does not fit your use case.
- **Documentation and text:** [CC BY-SA 4.0](https://codeberg.org/jkaindl/image-to-markdown/src/branch/main/LICENSE-DOCS).

Copyright © 2026 Johannes Kaindl.
