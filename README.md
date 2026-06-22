# Image to Markdown

> 🇬🇧 English · [🇩🇪 Deutsch](README.de.md)

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Docs: CC BY-SA 4.0](https://img.shields.io/badge/docs-CC%20BY--SA%204.0-lightgrey.svg)](LICENSE-DOCS)
[![Release](https://img.shields.io/gitea/v/release/jkaindl/image-to-markdown?gitea_url=https%3A%2F%2Fcodeberg.org&label=release)](https://codeberg.org/jkaindl/image-to-markdown/releases)
![Platform](https://img.shields.io/badge/platform-Obsidian%201.4%2B%20·%20desktop%20%26%20mobile-7c3aed)

**Transcribe the images in a note to Markdown with a local vision LLM — fully offline, non-destructive, streaming live into the sidebar.**

Image to Markdown turns the embedded images of an Obsidian note — scans, screenshots, photographed pages — into editable Markdown using an OpenAI-compatible vision model that runs on your own machine. Nothing leaves your computer, and your source note is never overwritten: each image gets its own transcript note, and the original embed is simply replaced by an embed of that new note.

## Features

- **Sidebar view.** A ribbon icon (`scan-text`, label "Image → Markdown") opens the "IMG → MD" view. It lists every embedded image of the active note as a checkbox list — all preselected, with unsupported formats disabled. The **"Transcribe"** button streams the vision model's answer **live** into one card per image, including an expandable thinking block for reasoning models and a copy button. Each card has a **"Create note"** button, plus **"Create all"**. Cards are read-only and show the raw Markdown pre-wrapped. After a transcript is written, the handled image drops out of the list on the next scan.
- **Bilingual UI (English / Deutsch)** — every user-facing string follows Obsidian's language setting; English is canonical, German is provided automatically. The language is detected once when the plugin loads (reload to switch).
- **Command "Transcribe images in the active note"** (id `transcribe-active-note`) — batch transcription without opening the sidebar.
- **Command "Open sidebar"** (id `open-sidebar`) — opens the sidebar view.
- **Editor context-menu entry "Image → Markdown"** (icon `scan-text`) — transcribes only the image under the cursor.

Reasoning models that emit `reasoning_content` in the stream, or inline `<think>` tags, get their thoughts collected into the expandable thinking block. Reasoning is ephemeral — it is shown to you but **never** added to the LLM history.

Everything is **non-destructive and idempotent**: there is exactly one transcript note per image, the image embed in the source note is replaced by an embed of the new note, and running the transcription again creates no duplicates.

## Requirements

- **Obsidian 1.8.7+** (desktop or mobile).
- **An OpenAI-compatible local server running a vision-capable model** — for example [LM Studio](https://lmstudio.ai), [Ollama](https://ollama.com), or an MLX server. The endpoint and model are configured in the plugin settings. Nothing leaves your machine: offline-first, no cloud, no VPN required.

## Install

### Community Plugins

**Coming soon.** Image to Markdown is being prepared for the Obsidian community plugin directory.

### Manual

Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://codeberg.org/jkaindl/image-to-markdown/releases) and place them in `<vault>/.obsidian/plugins/image-to-markdown/`, then enable the plugin under **Settings → Community plugins**.

### BRAT (beta)

Add the GitHub mirror `johannes-kaindl/image-to-markdown` to [BRAT](https://github.com/TfTHacker/obsidian42-brat).

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
2. Open a note that contains embedded images.
3. Click the ribbon icon **"Image → Markdown"** (or run the command **"Open sidebar"**) to open the **"IMG → MD"** sidebar. The embedded images appear as a preselected checkbox list; unsupported formats are disabled.
4. Click **"Transcribe"**. Each selected image gets a card that fills live with the streamed Markdown. For reasoning models, expand the thinking block to watch the model reason; use the copy button to grab the raw Markdown.
5. Click **"Create note"** on a single card, or **"Create all"** to write every transcript at once. Each image becomes one transcript note, and its embed in the source note is replaced by an embed of the new note.

Prefer to skip the sidebar? Run the command **"Transcribe images in the active note"** to batch-transcribe the active note. Or right-click an image in the editor and choose **"Image → Markdown"** to transcribe only the image under the cursor.

### Configuration

Open **Settings → Community plugins → Image to Markdown**. The settings live under the heading **"Vision (Image → Markdown)"**.

| Setting | What it does | Default |
|---|---|---|
| **Vision endpoint** | OpenAI-compatible server hosting your vision model. | `http://localhost:8080` (the MLX default — note that LM Studio uses `:1234`) |
| **Vision model** | The vision-capable model to use (e.g. Qwen2-VL, Llama-3.2-Vision). A dropdown filled from the endpoint's `/v1/models`; if the endpoint is offline it becomes a free-text field. | `""` (empty) — the model actually used is read from `response.model` |
| **Vision prompt** | The instruction sent to the vision model; freely editable text area. The shipped default is localized (English or German, following Obsidian). | "Transcribe the text in the image exactly to Markdown. Preserve the structure: headings, paragraphs, **emphasis**, lists and tables. Output only the Markdown, no comments." |

**Endpoint tip:** enter the base URL **without** a trailing `/v1` — the client appends `/v1` itself. (`normalizeEndpoint` strips a trailing `/v1` and slashes, so both forms are accepted; a doubled `…/v1/v1/…` path would otherwise silently return an empty transcript.)

Next to the input fields the settings tab shows a **connection status** indicator with a **"Test connection"** button, and a **"Vision capability"** row with a **"Test vision"** button that confirms whether the selected model can actually read images — see the [manual reference](docs/manual/reference.md#vision-capability-detection).

## How it works

For each selected image, the plugin builds a multimodal chat-completions request — the image lives in the `content` array — to the configured OpenAI-compatible vision endpoint, and streams the Markdown back over SSE (`content` plus `reasoning_content`). It then writes one transcript note per image with a `transcribed_by` frontmatter field (the model name taken from `response.model`, because some servers such as LM Studio ignore the request's `model` field and use the loaded model instead) and replaces the image embed in the source note with an embed of the new note. The result is non-destructive and idempotent.

The architecture and module layout are documented in [AGENTS.md](AGENTS.md).

## Manual

The full documentation follows the [Diátaxis](https://diataxis.fr) framework — see [docs/manual/index.md](docs/manual/index.md):

- **Tutorial** — get from zero to your first transcript.
- **How-to guides** — task-focused recipes (configuring LM Studio, handling HEIC, batch transcription).
- **Reference** — settings, commands, supported formats.
- **Explanation** — the non-destructive/idempotent design and the streaming mechanism.

See the [changelog](CHANGELOG.md) for release notes.

### Supported image formats

Sent to the model: **PNG, JPG, JPEG, WebP, GIF.** Recognized but **skipped** (with a notice): **BMP, HEIC, HEIF.** HEIC/HEIF is the iOS default and is rejected by vision models — set iOS to "Most Compatible" ("Maximal kompatibel") or convert the image first. When an image is skipped you'll see a notice such as: *Format .heic nicht unterstützt (HEIC? iOS auf „Maximal kompatibel")*.

## Related

**[vault-rag](https://codeberg.org/jkaindl/vault-rag)** — the sister plugin, home of the RAG core (related notes, semantic search, chat). Image to Markdown was split out of vault-rag 0.2.0 on 2026-06-21 because image transcription is not RAG; the two only ever shared the SSE transport.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow (test-driven, `main` always green, feature work in `feat/<name>`, Conventional Commits) and [AGENTS.md](AGENTS.md) for the architecture and module conventions. The canonical repository lives on [Codeberg](https://codeberg.org/jkaindl/image-to-markdown); GitHub (`johannes-kaindl/image-to-markdown`) is a mirror.

## License

- **Code:** [AGPL-3.0-or-later](LICENSE). A commercial dual-license is available on request if the AGPL copyleft does not fit your use case.
- **Documentation and text:** [CC BY-SA 4.0](LICENSE-DOCS).

Copyright © 2026 Johannes Kaindl.
