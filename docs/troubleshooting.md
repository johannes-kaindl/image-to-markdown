# Troubleshooting

Each entry starts with what you see — the wording is the plugin's own English text — then the cause and what to do. If yours is not here, see [Getting help](#getting-help).

## Vision LLM offline

> Vision LLM offline — check the settings

**Cause:** the sidebar could not reach any address under **Vision endpoints**. In the settings each row shows its own status; the wording says why:

| Row status | Meaning |
|---|---|
| Connection refused — server not running or wrong port. | The server is off, or the port in the address is wrong. |
| Unknown host — typo in the address? | The host name does not resolve. |
| Timed out — network unreachable (wrong network / VPN off?). | The machine is not reachable from here. |
| Answers, but is not an OpenAI-compatible endpoint — wrong path or service? | Something answers, but it does not return a model list. Check the address — LM Studio listens on `:1234`, an MLX server on `:8080` (the default). |
| Access denied — API key missing or invalid. | The server wants an API key. Enter it on that row. |

**Fix:** start the server and load a vision model, then press **Test connection** under **Settings → Image to Markdown**. Enter the base address only, for example `http://localhost:1234`, without a trailing `/v1`. A row that says "Address needs http:// or https://" or "Local LLM servers almost always need a port (e.g. :1234)" is telling you what is missing.

## Empty transcript

> Empty transcript

or, when you transcribed from the command palette: `Empty transcript: <image>`

**Cause:** the server answered, but returned no text — usually because the loaded model cannot read images.

**Fix:** under **Vision capability** press **Test vision**. "No vision" means the model cannot see; load a vision-capable model (for example Qwen2-VL) and press **Refresh models**.

## The model spent its budget on thinking

> Token limit reached before any text — the model spent its budget on thinking

**Cause:** a reasoning model used its whole token budget on thinking before it wrote the first character.

**Fix:** switch thinking off with the **Thinking: on** toggle next to the model picker in the sidebar. A model that shows **Thinking: always on** cannot be switched off — use another model or raise its token limit in the server.

## The transcript is cut off

> Cut off at the token limit — incomplete

**Cause:** the model hit its token limit mid-answer. The partial text is kept and marked; the note it creates carries a `truncated` frontmatter key.

**Fix:** raise the token or context limit in the server, or transcribe a smaller page range.

## Format not supported (HEIC)

> Format .heic not supported (HEIC? iOS set to “Most Compatible”): photo.heic

**Cause:** vision models reject HEIC/HEIF, the iOS default. BMP is skipped for the same reason. The sidebar shows such a row greyed out with "— unsupported".

**Fix:** set the iPhone camera to **Most Compatible** or convert the image to PNG or JPG first.

## No images in the sidebar

> No transcribable content in this note.

**Cause:** the active note embeds no supported image or PDF. The sidebar always works on the note you have open.

**Fix:** open a note with an embedded image or PDF, or open the image or PDF file itself — then the sidebar treats *this file* as the source.

## PDF messages

> PDF has 84 pages (limit 50) — narrow the page range.

**Fix:** set the **from page** and **to page** fields on the PDF row, or raise **PDF max. pages per run** in the settings.

> PDF detected (scan.pdf) — transcribe PDFs in the sidebar.

**Cause:** the command **Transcribe images in the active note** handles images only.

**Fix:** open the sidebar (**Open sidebar**) and transcribe the PDF there.

> Page 7 — transcription failed

**Cause:** one page failed while the others succeeded; the marker sits in the merged note in the page's place.

**Fix:** transcribe that page again with the page range.

## Transcription failed

> Transcription failed (photo.png): Vision HTTP 404

**Cause:** the server answered with an error. A wrong model name or a wrong address usually shows up here. The message after the colon is the server's own.

**Fix:** press **Test connection**, check the model under **Vision model**, and use the retry button on the card.

> Image not found: photo.png

**Cause:** the embed points at a file that no longer exists in the vault.

## Nothing was overwritten

> Skipped — existing note kept

**Cause:** you re-transcribed an image that already has a transcript note and cancelled the diff dialog (**Overwrite …?**). Re-transcribing never overwrites without that confirmation.

**Fix:** transcribe again and choose **Apply** in the dialog, ticking the changes you want.

## Notes are not recognised after changing frontmatter keys

> Mapping applied. 12 existing notes keep the old keys and won't be recognized (duplicate risk).

**Cause:** you renamed frontmatter keys under **Frontmatter mapping** and chose **Apply without migrating**. Existing transcripts are no longer found, so the row does not show "✓ transcript exists".

**Fix:** change the mapping again and choose **Migrate & apply** to rewrite the existing notes.

## Getting help

Open an issue at [github.com/johannes-kaindl/image-to-markdown/issues](https://github.com/johannes-kaindl/image-to-markdown/issues). Include the exact message, the Obsidian version, which server and model you use, and whether **Test connection** passes.
