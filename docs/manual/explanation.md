# Understanding Image to Markdown

This is the *why* behind Image to Markdown — the reasoning that shaped its design.
It is meant to be read, not followed step by step. If you want to *do* something,
the how-to and tutorial pages are the better starting points; this page explains the
thinking those pages quietly rely on.

Image to Markdown transcribes the images embedded in a note into Markdown using a
**local** vision-capable LLM. Every design decision below follows from a small set of
convictions: your notes are yours, a transcription should never put your existing text
at risk, and you should be able to *see* the model working. The sections that follow
unpack each of those.

## Why local and offline

The plugin talks only to an OpenAI-compatible vision endpoint that **you** configure
and run — for example [LM Studio](https://lmstudio.ai), [Ollama](https://ollama.com),
or an MLX server on your own machine. Image data goes to that endpoint and nowhere else.
There is no cloud service in the loop, no telemetry, and no VPN to stand up; the plugin
works fully offline.

This is a deliberate stance rather than a missing feature. The images you are most likely
to transcribe — scanned letters, photographed pages of a notebook, screenshots of private
documents — are exactly the material you would least want to hand to a third-party API.
Keeping the work local means the question *"where did my data go?"* has a single, boring,
trustworthy answer: to the server you started, on hardware you control.

That local server is the **trust anchor** of the whole design. The plugin does not ask you
to trust Anthropic, a model host, or the plugin author with your image content; it asks you
to trust the endpoint you already decided to run. Everything else — the requests, the
streamed responses, the notes that get written — is downstream of that one decision, and you
made it. The security posture is covered more formally in
[`../../SECURITY.md`](../../SECURITY.md), but the short version is: the vault is the only
place your transcripts live, and the local endpoint is the only place your images travel.

A practical consequence worth internalising: because *you* choose the endpoint and model,
quality and behaviour are yours to tune. A small model on a laptop and a large model on a
workstation produce different transcripts from the same page, and neither is the plugin's
"opinion" — they are your model's. More on that in *On choosing models and endpoints* below.

## Why non-destructive and idempotent

The single most important promise the plugin makes is that **your original note is never
overwritten**. When you transcribe an image, the plugin does two distinct things:

1. It writes **one transcript note per image** — a new file containing the Markdown the
   model produced, with a `transcribed_by` frontmatter field recording the model that
   actually did the work.
2. It **replaces the image embed** in the source note with an embed of that new transcript
   note. The surrounding text you wrote by hand is left exactly as it was.

The reason for the embed *replacement* — rather than, say, pasting the transcribed text
inline — is that it keeps the source note readable while preserving a clean separation
between *your* prose and the *model's* output. The transcript lives in its own file, where
it can be edited, linked, or searched on its own terms, and the source note simply points
at it. Nothing the model generated ever lands in the middle of a paragraph you wrote.

This is also why the operation is **idempotent**. Running a transcription a second time is
safe: there is one transcript note per image, so a re-run does not spawn duplicates, and
once an image's embed has already been replaced by a transcript embed, that image drops out
of the re-scan list entirely — there is simply nothing left to do for it. You can re-scan a
note as often as you like without fear of accumulating copies or clobbering earlier work.
The cards shown in the sidebar are themselves read-only and present the raw Markdown
verbatim, reinforcing the same principle: the plugin shows you what it produced and lets
*you* decide when it becomes a note.

How the plugin *recognises* an existing transcript is itself a deliberate design choice.
The naïve approach — "does any note embed this image?" — would be wrong, because an unrelated
note might legitimately embed the same image without being its transcript. So the plugin uses
Obsidian's backlink index only as a fast first pass, then **filters by front matter**: a note
counts as the transcript for a source *only* if its `source_image` / `source_pdf` front-matter
field resolves back to that exact source. That front-matter filter is the load-bearing part.
A bare body embed deliberately does **not** qualify; the explicit, machine-checkable link in the
front matter is what makes "this is the transcript of that image" a fact the plugin can trust
rather than a guess. It is the difference between recognising a transcript by what it *claims
about itself* and guessing from incidental layout.

That recognition then powers a second 0.3.0 decision: **override is opt-in, and it preserves the
front matter**. When a transcript already exists, its sidebar row starts *unchecked* — the safe
default is to leave finished work alone. If you deliberately re-select it and transcribe again,
the plugin overwrites that one note in place instead of spawning a duplicate, and it rewrites only
`transcribed_by` (plus `pages` for a PDF) and the body. The provenance fields — `source_image` /
`source_pdf`, `source_note`, `created` — are carried through untouched. This keeps the
non-destructive promise intact even on the path that *does* replace content: the only thing that
can change is the transcript you explicitly asked to redo, and even then its identity and origin
survive. Re-running to try a better model is a normal, low-stakes act, not a destructive one.

Taken together, non-destructive plus idempotent means the cost of experimenting is low.
You can transcribe, look at the result, change the prompt or the model, and run again,
knowing that the worst case is a transcript note you choose not to keep — never a damaged
source note.

## Why PDFs render locally

A PDF is not something a vision model reads directly — it has to become an image first. The plugin
does that rasterisation **on your machine**, in the client, using a bundled
[pdf.js](https://mozilla.github.io/pdf.js/) worker. Each page is rendered to a PNG and then handed
to the same transcription path an ordinary image takes; from the model's point of view a PDF page
*is* an image. There is one transcript note per PDF, with its pages merged in order.

The detail worth dwelling on is the word *bundled*. The pdf.js worker ships **inside the plugin**
and is loaded from a `Blob` URL — it is never fetched from a CDN at runtime. That is not an
accident; it is the same offline stance the rest of the plugin takes, applied to PDF rendering.
A plugin that promises "your data goes only to the endpoint you run" would quietly break that
promise if it reached out to a content-delivery network to fetch its own machinery the first time
you opened a PDF. Bundling the worker keeps the offline guarantee whole: open a PDF on a machine
with no internet at all, and it still rasterises.

Rendering locally does cost memory, which is why **render scale** is a setting rather than a fixed
value. A higher scale produces a sharper page image and better OCR on small text, but a large page
at high scale is a large canvas in memory. On the desktop that trade is yours to make; on mobile,
where memory is tighter and an oversized canvas can crash the app, the plugin **clamps the scale**
to a safe ceiling regardless of your setting. The default sits at a deliberately middling resolution
— enough for clean text, cheap enough to run page after page — and the slider lets you spend more
memory for sharpness only when a particular document needs it.

## Why a separate plugin from vault-rag

Image to Markdown was split out of [vault-rag](https://codeberg.org/jkaindl/vault-rag) 0.2.0
on 2026-06-21. It is worth understanding *why* it became its own plugin rather than staying
a feature of its sibling.

The honest reason is that **image transcription is not RAG**. vault-rag's job is retrieval —
related notes, semantic search, chat over your vault. Turning a photographed page into
Markdown shares none of that machinery: there is no index, no embedding store, no retrieval
step. The only thing the two plugins ever genuinely shared was the **SSE transport** — the
plumbing that streams tokens back from an OpenAI-compatible endpoint. Sharing a pipe is a
weak reason to share a plugin.

Keeping them separate keeps each plugin's **message sharp**. vault-rag stays a lean RAG core;
Image to Markdown stays a focused tool for one job, with its own settings, its own commands,
and its own place in the plugin registry and feedback channels. A user who wants to
transcribe images does not have to reason about retrieval, and a user who wants semantic
search does not carry transcription code they never run.

There is one design decision here that can look like a mistake until you see the reasoning:
the shared transport (`sse.ts` and the inline-`<think>` splitter) is **copied, not shared**.
Both plugins carry their own identical copy. Factoring roughly five kilobytes of stable code
into a shared npm package would buy versioning overhead, a release coordination burden, and a
new failure mode — for code that essentially never changes. That is overengineering
([YAGNI](https://en.wikipedia.org/wiki/You_aren%27t_gonna_need_it)): the cost of the
abstraction would exceed the cost of the duplication it removes. Copying keeps each plugin
self-contained and independently releasable, which matters far more for two small tools than
DRY does.

## Why streaming with visible thinking

When you press the transcribe button, the model's answer streams **live** into a card,
one card per image — and, for a PDF, one card per page — rather than appearing all at once
when the page is finished. There are two reasons this is more than a cosmetic flourish.

The first is **feedback**. Transcribing a dense page can take a while, and a vision model that
is working is indistinguishable from a vision model that has stalled — unless you can watch it
produce text. Streaming turns a black box into a progress indicator you can read: you see the
transcription forming, you can tell early whether the model has understood the page, and you
can stop wasting time on a bad run instead of waiting for it to finish.

The second is **visible thinking**. Reasoning-capable models emit a stream of intermediate
reasoning alongside their answer — delivered both as a dedicated `reasoning_content` channel
and, for some models, as inline `<think>` tags in the text. The plugin gathers both into a
collapsible thoughts block on the card, so you can open it up and see *how* the model arrived
at its transcription. That is genuinely useful when a transcript surprises you: the reasoning
often explains a misread word or an ambiguous layout.

Crucially, that reasoning is treated as **ephemeral**. It is shown to you, and then it is
gone — it never enters the LLM history and is never fed back into a later request. This is a
deliberate boundary: reasoning is a window into a single transcription, not part of the
model's memory or context. Keeping it out of the history means each image is transcribed on
its own merits, and the thoughts block stays an inspection tool rather than something that
silently changes later results.

## On choosing models and endpoints

Because the plugin is endpoint-agnostic, the model is a knob you turn, not a fixed part of the
product. A vision-capable model is the only hard requirement; beyond that, larger models tend
to read messy handwriting and complex tables more faithfully, while smaller ones are faster and
lighter on memory. The endpoint default (`http://localhost:8080`) targets a local MLX server;
LM Studio commonly listens on `:1234` instead, which is the single most frequent
misconfiguration. The how-to and reference pages cover the exact settings and the well-known
endpoint footguns; the point for *understanding* is simply that transcription quality is a
property of the model and prompt you chose, both of which are fully in your hands.

## Why the interface speaks your language

The plugin's interface is bilingual, and the choice of which language you see is not arbitrary:
it follows **Obsidian's own display language**, not the operating system. **English is the
canonical language and German is its translation** — the English strings are written first and
the German ones track them, which keeps a single source of truth and avoids two interfaces
drifting apart.

The language is detected **once, when the plugin loads**, and then stays fixed for that session.
This is a deliberate trade rather than a limitation. A live language switch would mean rebuilding
every label, notice, and view the moment Obsidian's setting changed — extra machinery to maintain
for an action almost nobody performs mid-task. Tying detection to load instead keeps the code
small and the behaviour predictable; the only cost is that switching languages asks for a plugin
reload (or an Obsidian restart), which is a fair price for a setting you change once and forget.

One detail is worth calling out because it is easy to overlook: the **shipped default prompt is
itself localized**. A first-time German user does not open the settings to find an English
instruction they must mentally translate before trusting it — they see a sensible, idiomatic
instruction in their own language from the very first run. The default is meant to be usable as-is,
and "usable as-is" only holds if it reads naturally to the person reading it.

A small set of strings stays the same in every language on purpose: the plugin name
"Image → Markdown", the sidebar title "IMG → MD", and the "Stop" control. These are brand and
control marks rather than prose; translating them would buy nothing and would make the tool harder
to talk about across languages.

## Where to go deeper

This page deliberately stays out of the code. If you want the module layout — which files are
pure and testable, which touch Obsidian, how the transport and the view fit together — that
lives in [`../../AGENTS.md`](../../AGENTS.md) at the repository root, written for contributors
and AI agents rather than end users.

---

*This documentation is licensed under [CC BY-SA 4.0](../../LICENSE-DOCS). The plugin code is
licensed under [AGPL-3.0-or-later](../../LICENSE).*
