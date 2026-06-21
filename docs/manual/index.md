# Image to Markdown — Manual

Transcribe the images in a note to Markdown with a local vision LLM — fully offline, non-destructive, streaming live into the sidebar.

This manual is organized along the four [Diátaxis](https://diataxis.fr/) quadrants. Each quadrant serves a different need: pick the one that matches what you are trying to do right now.

## The four quadrants

### [Tutorial](tutorial.md)

*Learning-oriented.* A guided, start-to-finish walkthrough that takes you from a fresh install to your first successful transcription. Start here if you have never used the plugin: it gets you to first success — point the plugin at a local vision endpoint, open the sidebar (view title "IMG → MD"), and press "Transkribieren" on a note full of images.

### [How-to guides](how-to.md)

*Task-oriented.* Short, goal-directed recipes for specific jobs once you know your way around — for example transcribing the images of the active note from the command palette ("Bilder der aktiven Notiz transkribieren"), transcribing only the image under the cursor via the editor context menu, pointing the endpoint at LM Studio (`:1234`) instead of the MLX default (`:8080`), or dealing with skipped HEIC/HEIF images from iOS.

### [Reference](reference.md)

*Information-oriented.* The dry, lookup-style facts: every setting and its default (under the "Vision (Image → Markdown)" heading), all commands and their ids, the ribbon and context-menu entries, the supported and skipped image formats, and the `transcribed_by` frontmatter written into each transcript note.

### [Explanation](explanation.md)

*Understanding-oriented.* The design and rationale behind the plugin: why transcription is non-destructive and idempotent (one transcript note per image; the source embed is replaced by an embed of the new note), why the endpoint is normalized so a trailing `/v1` does not become `…/v1/v1/…`, and why nothing ever leaves your machine. Module and source layout live in [AGENTS.md](../../AGENTS.md), not here.

## Not sure where to start?

- **New here?** Read the [Tutorial](tutorial.md) first.
- **Know what you want to do?** Jump to the matching [How-to guide](how-to.md).
- **Looking up a setting, command, or format?** Go to the [Reference](reference.md).
- **Want to understand a design decision?** See the [Explanation](explanation.md).

---

Back to the [project README](../../README.md).
