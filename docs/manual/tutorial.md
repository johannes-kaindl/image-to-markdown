# Tutorial: Your first image transcription

This is a hands-on, learning-oriented walkthrough. By the end you will have taken a
single note containing a scanned or photographed page and turned that image into a
real, editable Markdown note — entirely on your own machine, with nothing leaving it.

We will do this together, one step at a time, with a concrete example. This is not a
catalogue of every option; it is one path from nothing to your first success. Once you
have felt how the pieces fit, the [How-to guides](how-to.md) and the
[Reference](reference.md) will show you the rest.

What you need before we start:

- Obsidian 1.4 or newer (Desktop or Mobile).
- A few minutes and one note with an embedded image of some text — a scanned page, a
  whiteboard photo, a screenshot of a document. Anything readable.

Let's go.

## Step 1 — Start a local vision server

Image to Markdown does not include an AI model. It talks to an OpenAI-compatible server
that *you* run on your own machine, and that server does the actual reading of the image.
For this tutorial we will use [LM Studio](https://lmstudio.ai), because it has a friendly
interface and a built-in model browser — but [Ollama](https://ollama.com) or an MLX
server work just as well.

1. Download and open LM Studio.
2. Search for and download a **vision-capable** model. The vision capability is the part
   that matters — a normal text model cannot see your image. Good starting points are
   **Qwen2-VL** or **Llama-3.2-Vision**.
3. Load that model, then start the local server.

Now note the address LM Studio is serving on. **LM Studio listens on port `1234`** — so
its address is `http://localhost:1234`. Keep this in mind: the plugin's default is
`http://localhost:8080` (that is the default for an MLX server), so with LM Studio you
will need to change it. Mixing these two ports up is the single most common reason a
first run produces nothing, so we will get it right in Step 3.

<!-- TODO(submission): screenshot of LM Studio with a vision model loaded and the local server running, port 1234 visible — CORE-META-03 -->
![LM Studio serving a vision model on port 1234](../images/tutorial-lmstudio.png)

## Step 2 — Install and enable the plugin

Install Image to Markdown using any of the install paths in the
[README](../../README.md) — for a first try, the manual install (copy `main.js`,
`manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/image-to-markdown/`)
is the quickest. Then open **Settings → Community plugins** and enable **Image to
Markdown**.

When it is enabled you will see a new icon in the left ribbon labelled **"Image →
Markdown"** (a small scan-text icon). We will use it in Step 5.

## Step 3 — Point the plugin at your server

This is the one piece of configuration we must get right, and it is quick.

1. Open **Settings** and find the heading **"Vision (Image → Markdown)"**.
2. In **"Vision-Endpunkt"**, enter the address of your server. Since we are using LM
   Studio, that is:

   ```
   http://localhost:1234
   ```

   Replace the default `http://localhost:8080` with this. (If you had chosen an MLX
   server on the default port, you could have left it as-is — but with LM Studio, this
   change is what makes the whole thing work.)

A small but important detail: **enter the base URL only — do not add a trailing
`/v1`.** The plugin appends `/v1` itself when it calls the server. Writing
`http://localhost:1234/v1` here would lead to a doubled `/v1/v1/...` path, and LM Studio
answers a wrong path with an empty success rather than a visible error — which looks
like the transcription silently did nothing. So: base URL, no `/v1`. The plugin handles
the rest.

You can leave **"Vision-Modell"** and **"Vision-Prompt"** at their defaults for now.
With the server running, the model field will offer your loaded model in a dropdown; if
the server is offline it becomes a free-text field instead. Either way, the model that
actually does the work is read back from the server's response, so you do not need to
fuss over it today.

## Step 4 — Open a note with an embedded image

Open (or create) a note in your vault that embeds one image of some text. For example,
a note whose body contains:

```markdown
# Meeting notes

![[scanned-page.png]]
```

The image should be a format the model can read: PNG, JPG/JPEG, WebP, or GIF. If your
image is a HEIC/HEIF file (the iOS default), convert it first or set your iPhone camera
to "Most Compatible" / "Maximal kompatibel" — vision models reject HEIC, and the plugin
will skip it with a notice. For this tutorial, a plain PNG or JPG is the easy path.

Make sure this note is the **active** note — the one you are looking at — before the next
step. The plugin always works on the note you have open.

## Step 5 — Open the sidebar; your image is already selected

> A note on language: the plugin's interface follows **Obsidian's display language**
> automatically — English here, German if your Obsidian is set to German. This manual is
> written in English and quotes the English labels; the German names are shown in
> parentheses where they help. The language is picked up when the plugin loads, so if you
> ever switch Obsidian's language, reload the plugin (or restart Obsidian) to see the
> change.

Click the ribbon icon **"Image → Markdown"** on the left. A sidebar opens with the title
**"IMG → MD"**.

Look at what it shows: a checkbox list of every image embedded in your active note. Your
scanned page is there, and it is **already ticked** — everything supported is
pre-selected, so you do not have to hunt for checkboxes on your first run. (If a note
contained an unsupported format like HEIC, that entry would appear greyed out and
disabled, which is your cue to convert it.)

<!-- TODO(submission): screenshot of the "IMG → MD" sidebar listing one pre-selected image with the "Transkribieren" button — CORE-META-03 -->
![The IMG → MD sidebar with the image pre-selected](../images/tutorial-sidebar.png)

## Step 6 — Click "Transcribe" and watch it stream

Click the **"Transcribe"** button (**"Transkribieren"** in German).

Now watch the sidebar rather than waiting for a final result. The plugin sends your image
to your local server and **streams the answer back live**, filling a card for the image
word by word as the model reads it. This is the moment the tutorial is built around — you
can literally watch the Markdown appear.

If you loaded a reasoning model, you will also see an **expandable thoughts block** above
the transcript: this is the model thinking out loud before it commits to an answer.
Click it open if you are curious. (This reasoning is shown for transparency only and is
never written into your note.)

The card is read-only and shows the raw Markdown as plain text, and there is a copy
button if you want to grab the result by hand. Wait until the stream finishes.

## Step 7 — Click "Create note" and see the result

When the transcript is complete, click **"Create note"** (**"Notiz anlegen"** in German) on the card.

Here is what just happened, and why it is safe:

- A **new transcript note** was created for your image, containing the transcribed
  Markdown. It carries a `transcribed_by` entry in its frontmatter recording which model
  actually produced it (read back from the server's response).
- In your **original note**, the image embed was **replaced by an embed of the new
  transcript note**. So where you previously saw the picture, you now see the
  transcribed, searchable, editable text — embedded from its own note.

Crucially, this is **non-destructive**: your original text was never overwritten, only
the one image embed was swapped for the new note's embed. And it is **idempotent** — if
you run the plugin again, that image is already handled, so it simply drops out of the
list on the next scan and you get no duplicate notes.

Open your original note again and look: the scanned page is now living text. You have
done it.

(If you had several images, **"Create all"** (**"Alle anlegen"** in German) would do the
same for every card at once — but one image was all we needed for your first success.)

## What you learned

In this tutorial you:

- Started a **local vision server** (LM Studio with a vision model such as Qwen2-VL), and
  learned that LM Studio uses port `:1234` while the plugin default is `:8080`.
- **Installed and enabled** Image to Markdown.
- Set the **"Vision-Endpunkt"** correctly — base URL only, no trailing `/v1`.
- Opened a note with an embedded image and saw it **pre-selected** in the **"IMG → MD"**
  sidebar.
- Clicked **"Transcribe"** ("Transkribieren") and watched the transcript **stream in
  live**, including a reasoning model's thoughts block.
- Clicked **"Create note"** ("Notiz anlegen") and ended up with a new transcript note, with
  the original image embed **non-destructively replaced** by an embed of that note.

Most importantly, you now have a feel for the rhythm of the tool: open a note, open the
sidebar, transcribe, create the note.

## Where to go next

- For task-focused recipes — transcribing a whole note at once, using the editor
  context-menu entry **"Image → Markdown"** on a single image under the cursor, or
  running the batch command **"Transcribe the images of the active note"** ("Bilder der
  aktiven Notiz transkribieren") without the sidebar — see the [How-to guides](how-to.md).
- For the exact list of settings, defaults, supported formats, and commands, see the
  [Reference](reference.md).

This tutorial and the rest of the documentation are licensed under
[CC BY-SA 4.0](../../LICENSE-DOCS).
