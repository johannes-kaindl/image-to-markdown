# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versioning follows [SemVer](https://semver.org/).

## [Unreleased]

## [0.27.1] — 2026-10-03

### Changed

- The changelog is now written entirely in English.
- Internal design notes moved out of the repository; the user documentation is unchanged.

## [0.27.0] — 2026-09-30

### Changed

- **Sampling profiles for the `transform` mode.** Every request now sends the temperature and family-specific sampling values (top_p, top_k, …) from the shared profile tables instead of only the thinking switch. The model family comes from the LLM Endpoint Manager or is guessed from the model name; the backend (LM Studio, Open WebUI, …) is detected once per endpoint and cached for 30 s. The new section **Settings → Request** shows what is sent and what actually takes effect, lets you override single values per model family, and lists the last request and any deviations seen this session (e.g. "the model thought although thinking is off"). A hint notes that with the verdigado setup only `verdigado-think` accepts images.
- **The thinking switch is now a four-level setting.** The sidebar button is the shared Kit control (label "Thinking: off / low / …", `aria-pressed`); "Level picker in chat" turns it into a dropdown. The always-on hint and the name-based tooltip are gone — the family now decides whether thinking can be turned off. Models that cannot turn it off show "Thinking: always on".
- **Migration.** The old `suppressThinking` flag becomes the thinking level: `true` → off, `false` (the old default, thinking ran) → "low", so nothing changes for existing installs; new installs start with the profile default "off". The field is removed from `data.json` on the next save. Deviation from recipe 3 of the sampling plan: there is no legacy temperature to migrate, because this plugin never sent one.
- The request is sent under the model's resolved name (alias applied); results still show the name the server reports.

### Removed

- `reasoning_toggle.ts` (`thinkToggleView`, `effectiveSuppress`) and the `.img2md-think-toggle` styles, replaced by the Kit control. Kit modules added: `request-section`, `request-session`, `thinking-control`, `collapsible` (Kit pin unchanged at 0.45.0).

### Fixed

- Settings tab: opening it never renders empty on first open (the refresh-on-open hook rebuilds directly instead of going through the native `update()`).

## [0.26.0] — 2026-09-30

### Added

- The GitHub release now also carries a ready-to-unpack `image-to-markdown.zip` (the plugin folder with `main.js`, `manifest.json` and `styles.css`) and a `checksums.sha256` file. For a manual install, download the zip and unpack it into `.obsidian/plugins/` instead of creating the folder and saving three files by hand.

### Changed

- Kit chat client 0.44.0 (no user-visible change).
- Kit vendoring bumped to `obsidian-kit` 0.45.0 (`shortcuts-bridge` pinned to 0.45.1): pulls in `pure/ocr-provider` and `obsidian/shortcuts-bridge` for the upcoming Apple-shortcut OCR path (no user-visible change yet — not wired in). The 0.45.1 pin fixes an upstream lint violation (`obsidianmd/prefer-window-timers`) in `shortcuts-bridge` via an injectable clock port.
- Provider API v1 (`extractText(vaultPath) → Text`, Kit contract `ocr-provider`) added as a thin adapter (`src/ocr_provider.ts`), now wired to `main.ts`/`app.plugins.plugins["image-to-markdown"].api`.

### Added

- **New text recognition path alongside the vision model: Apple Shortcuts (on-device OCR)** — settings: path choice, shortcut name (default "Extract Text (Obsidian)"), timeout (default 30 s, mandatory: a deleted shortcut never answers). v1 without PDF, no streaming, no LLM endpoint. Wired into the sidebar view: with this path the result card fills at once instead of live; errors (timeout, "busy", shortcut error) appear in the existing card error state. New how-to "Use the Apple Shortcut OCR path" (docs/manual/how-to.md) + settings reference, linking to the central guide `uplink.jkaindl.de/apple-shortcuts`.

## [0.25.0] — 2026-09-26

### Changed

- **The chat path now runs through the Kit chat client** (`createChatClient` from `obsidian-kit` 0.43.0, XHR transport with `requestUrl` as fallback) instead of the plugin's own `fetch` client. Visible consequences: (1) **A silent server is cut off**: after 2 minutes without data, and 10 minutes before the first byte (model loading, large image) — previously the request hung without any deadline. (2) **Error messages carry the reason**: instead of "Vision HTTP 400" it now reads "The endpoint answered with HTTP 400: Invalid url." (server message from the body), plus dedicated sentences for "not reachable", "stopped answering" and "input too long for the context window" (English/German). (3) **An HTTP 200 response that is neither a stream nor a completion** (such as a proxy's error page) is now an error carrying the response text instead of a silently empty transcript. (4) **Origin refusal**: if a local server rejects the stream call because of the Obsidian origin, the plugin repeats the request once without a stream (`requestUrl`) and sticks with that for this endpoint — the card then fills at once instead of live. (5) The non-streaming calls (vision test, transcription without a card) also run through the Kit client. Unchanged: message shape with image part, `suppressThinking` parameter, abort (Stop), `finish_reason: length` with or without text.
- **Kit pin `obsidian-kit` 0.43.0** (previously 0.41.1): `endpoint-list` CSS in `styles.css` brought to the 0.43.0 state (child selectors for the row frame, new classes for the key hint and extra line). `chat-client`, `chat-transport` and `clock` newly vendored; the plugin's own `sse.ts` (`streamSSE`) is gone, `think.ts` is now called `think-splitter.ts` as in the Kit.

### Added

- GUI smoke G1–G3 (with `--with-model`): streaming against a real endpoint (multiple chunks, abort via signal, HTTP error with message); endpoint and model via `I2M_SMOKE_ENDPOINT` / `I2M_SMOKE_MODEL`.

## [0.24.0] — 2026-09-26

### Changed

- **Endpoints come from the LLM Endpoint Manager when it is installed** (Kit `endpoint-source`, `obsidian-kit` 0.41.1, `code-kit` 0.7.0 newly vendored, capability `vision`). The Manager takes precedence; the local endpoint list stays as a fallback and is unchanged while the Manager is missing or off. Visible consequences: (1) With the Manager, the settings tab shows the block "Endpoints come from the LLM Endpoint Manager" (endpoint choice, model choice, import of the local endpoints into the Manager) instead of the local endpoint list; the global vision model row is then hidden, while the local list and `visionModel` stay stored. (2) New setting `choice` (`endpointId`, `model`) holds the choice against the Manager; old `data.json` files without `choice` load unchanged. With the Manager, the sidebar model picker writes to `choice.model`, otherwise still to `visionModel`. (3) If the Manager reports no endpoint, there is no local fallback — the sidebar shows "not connected". (4) **Even without the Manager, the model of an endpoint row now takes effect**: it beats the global `visionModel` (Kit rule `choice.model → row model → visionModel`); previously the row selection appeared in the UI but was not read at call time.

### Added

- **Help row at the top of the settings** with links to the documentation and the issue tracker (Kit `help-setting`, `obsidian-kit` 0.43.0, only this file vendored).
- **Export folder in the settings** — new setting with folder autocomplete for the target folder of new transcript/description notes; empty = previous
  behavior (next to the
  source note).

### Fixed

- **The thinking switch now shows its state even without color** (UI-STANDARD §8,
  state button) — `aria-pressed` was missing entirely, a locked (always-on thinker)
  switch carried only `aria-disabled` instead of a native `disabled`. Now brought up to standard: `aria-pressed`
  follows the state on every render, `disabled` is now the native button property,
  the icon switches `brain` ↔ `brain-cog` (on/off instead of always `brain`). Visible button text
  is unchanged (sidebar width fix from 0.10.1).
- **"Create note" did not stay the bottommost element of the card after feedback rounds** — the
  chat input for refinement feedback was moved behind the version history,
  so the write button of the last round ended up above it instead of below.
- **A removed and re-added endpoint kept showing "not reachable" in the model field**,
  although the server was running (the status icon was correct) — the model list cache
  was not invalidated when a URL was removed/re-added.

### Internal

- **Kit pin `obsidian-kit` 0.34.1 → 0.35.0** (code-kit stays 0.6.0) via `tools/sync-kit.sh`
  — wave 2 of the plugin orchestration. Only header stamps/`VENDOR.json` changed, no
  behavior change in the vendored modules; gate before/after green (521/521 tests, 0
  lint errors/warnings).
- **Streaming answer area (UI-STANDARD §8) remains a deliberate in-house build** — the existing
  deviation declaration in `AGENTS.md` §UI-Abweichungen was switched to the key `**stream-area**`
  expected by the root check (`tools/ui_adoption_check.py`)
  (pure format fix, no change to the substance of the rationale: `img_to_md_view.ts` renders
  `N` simultaneously active cards, each with its own thought block/version history, a
  composition that `buildStreamArea` — ONE answer area per prompt — does not map).

## [0.23.0] — 2026-09-03

### Added

- **A transcript note cut off at the token limit now says so itself** —
  `truncated: true` in the frontmatter. The sidebar card has shown the hint since 0.20.0, but the
  card lives only for the session: whoever opens the note later saw an incomplete
  transcript that looks like a complete one. Like the other keys, the key can be renamed in the
  settings (frontmatter mapping) and moves along with a mapping migration.

  **The key is written only for `true`, never as `false`.** Its absence means
  "complete **or** unknown" — notes written before this version know nothing about
  their completeness, and a `false` would be a promise nobody can redeem for them.
  If a truncated note is transcribed again later and is then complete,
  the key disappears again; a leftover `true` would be worse than a gap, because
  it is a statement.

## [0.22.0] — 2026-09-02

### Changed

- **An endpoint that answers `/v1/models` with HTTP 200 but returns no model list
  is now treated as unreachable and skipped.** Previously the
  endpoint row in the settings correctly warned ("answers, but is not an OpenAI-compatible
  endpoint") — and the plugin took exactly that endpoint anyway, because the resolution used
  a weaker notion of "reachable" (only the HTTP status). The display
  thus warned about an error the plugin then committed itself: the transcription ran into a
  silently empty result. That is the documented LM Studio case (wrong path → HTTP 200
  with an error body).

  **What this means for existing configurations:** only "HTTP 200 without a
  `data` array" is affected. A server without `/v1/models` (404) already counted as unreachable before,
  and an **empty** model list stays valid — a freshly set up MLX with no models in the
  cache therefore does not drop out of the selection. Measured before the change: LM Studio, Ollama,
  MLX and llama.cpp all return a `data` array.

## [0.21.0] — 2026-09-02

### Changed

- **The endpoint list in the settings is now the shared building block from
  `obsidian-kit`** instead of a plugin-specific row UI. Visibly, this brings per endpoint a
  **model field** (override; empty = global model), **one-click presets** for LM Studio and
  Ollama, a **"try first"** button, a line with the endpoint's **role**
  ("active" / "reachable — fallback 2" / "not reachable — skipped") and
  non-blocking hints for suspicious addresses (missing port, missing scheme).

### Fixed

- **An API key could end up at the wrong endpoint.** If an entry was deleted and
  right afterwards — before the list was redrawn — a field of another row was left,
  the input was booked onto the entry that had **moved up**. The window for this was real, because
  the redraw only comes after pinging all endpoints (seconds with a dead endpoint).
  The Kit building block locks the rows in the meantime.
- **The reachability icon now says what is going on** instead of just being red or green:
  "Connection refused", "Hostname unknown", "Access denied — key missing or
  invalid" or "Answers, but is not an OpenAI-compatible endpoint". The latter is the
  documented LM Studio case (wrong path → HTTP 200 with an error body), which previously looked like a
  reachable endpoint and ran into a silently empty transcript.
- **An endpoint once measured as offline no longer stays that way for the whole session.**
  The model lists are discarded when the settings are closed; whoever starts their LLM server
  and opens the settings again sees the new state.

### Behavior note

- **When opening the settings, the plugin now queries the model list of every entered
  endpoint**, not only on click — needed for the per-row model field. If an entry
  carries an API key of a hosted provider, a
  `/v1/models` request is thereby sent there without further action. **No images and no note contents** are transmitted.
  Whoever does not want that removes the entry in question from the list.

## [0.20.0] — 2026-08-30

### Fixed

- **The first click on the ribbon icon now really opens the sidebar.** If the right
  pane was collapsed — the normal state of a freshly set-up vault — the view was created
  at 0×0 pixels: the command reported success, nothing visibly happened, and only
  a second click opened it. The cause was a missing `revealLeaf` in the first-open path
  (the branch for an already existing view had it). No unit test found this,
  but the first run of the new GUI smoke against a real Obsidian — it is not
  a statement about state, but about visibility.

- **A transcript truncated at the token limit no longer ends silently.** Reasoning models
  sometimes spend their entire response budget on thinking and then deliver a few characters
  or nothing at all — measured on 2026-08-14: 921 characters of thoughts, 15 characters of transcript. The
  card still counted as finished, without any message; to users it looked like "the plugin
  recognized nothing". The server does report it (`finish_reason: "length"`), and the
  SSE parser already read it — the transport discarded it one level above. Now
  the chain carries it all the way to the sidebar: a truncated card shows "Cut off at
  the token limit — incomplete" and can still be created (the partial text is valid), and if no
  text arrived at all, the error message names the limit instead of "Empty transcript". Applies to
  transcribing, describing, PDF pages and the command path without the sidebar.

### Changed

- **"Copied" now appears only once copying really happened.** The success message previously
  came unconditionally after the write operation. If the clipboard refuses — loss of focus or
  missing permission, the normal case on Android and in an unfocused window —,
  you read "Copied" with an empty clipboard.
- **If copying fails, the plugin now says so.** Previously nothing visibly happened in this case.
  New message "Konnte nicht in die Zwischenablage kopieren" (EN: "Could not
  copy to clipboard").

### Internal

- **`diff`, `error_body` and `clipboard` now come from `obsidian-kit` 0.27.0 instead of local
  code.** The local `src/diff.ts` is deleted (it was the canonical source of the Kit version
  and byte-identical to it), `parseErrorEnvelope` in `vision_client.ts` has become a thin adapter
  over the Kit module. New: `tools/sync-kit.sh` (renews the vendor tree) and one
  `VENDOR.json` each in `src/vendor/kit/` and `src/vendor/kit-obsidian/`, which hold the pin in one place
  instead of per file header. Not user-visible apart from the two points above; a third,
  unobservable change concerns the error-message cascade (`message` now wins over
  `detail`, visible only with an error body containing both fields).

### Documentation

- **Image standard (2026-08-16).** Both READMEs embed with `<img width>` instead of
  Markdown syntax — otherwise the container determines the width, and GitHub, Forgejo and the
  store page differ in width. `settings.png` and `refine.png` are rightly tall
  (one long page per image) and appear as a 380-px preview from `docs/images/thumbs/` with a
  link to the full resolution. Three images carried dead whitespace from the simulated tall
  capture window (in `describe-mode.png` 871 px **in the middle of the image**) and were
  cropped; four were over or near the 400-KB budget and were recompressed
  (folder 3.3 → 1.9 MB). Four figures in the manual were embedded twice. Checked with
  `npm run shots:check` (newly wired up) as well as against GitHub and Forgejo.

- **Screenshots (CORE-META-03).** `docs/images/` now contains **all 15** assets named in the capture contract;
  the READMEs (EN/DE) carry hero + gallery, the manual its figures.
  Captured against a throwaway demo vault via Obsidian's debug port, with specially created
  material (two text sheets, a schema, a three-page PDF) — nothing private, nothing
  third-party. Two assets needed a special route: `tutorial-lmstudio.png` (window outside
  Obsidian, captured by hand and retouched — the LAN address replaced by `localhost`)
  and `diff-modal.png` (the dialog could not be triggered automatically; the note was
  also **not** overwritten in the process — no silent overwriter). Both have been present since
  2026-08-14.
- **Capture contract corrected.** The editor entry "Image → Markdown" hangs on the
  `editor-menu` event: a right-click on the *rendered* image opens Obsidian's file menu and
  does not contain it. The cursor must be on the embed source line.

## [0.19.0] — 2026-08-08

### Added

- **API key per endpoint.** Each row of the endpoint list now carries its own,
  optional key (password field next to the address). This allows local and hosted
  providers to stand in **one** fallback chain — previously only local worked, because there was no way
  to set an `Authorization` header. Local servers remain untouched: without a key,
  no header goes out either. The key reaches **all** network paths, explicitly including the ping
  and the vision capability probe — otherwise a hosted endpoint would count as unreachable
  and be silently skipped.

### Fixed

- **Gemma models were wrongly shown as "No vision".** The name heuristic knew
  only the Ollama spelling `gemma3`; LM Studio's `google/gemma-3-4b-it` and the entire
  Gemma 4 series fell through, although both are multimodal. `google/gemma-3-1b-it` and
  `-270m` correctly remain text-only. The fix lives in obsidian-kit 0.25.1, newly vendored here.
- A `null` response from an endpoint made the capability probe abort with a `TypeError`,
  instead of simply meaning "no metadata" (likewise Kit 0.25.1).

### Internal

- Endpoint entries are `EndpointConfig` objects instead of bare strings (vendored
  `obsidian-kit#0.25.1` `pure/endpoint_config`). Old `data.json` states — both the ancient
  single field `visionEndpoint` and the string list — are migrated on load.
- `check-no-nul-bytes.mjs` is part of the test chain (drift-audit 2026-08-05, omitted back then because of
  a feature branch).

## [0.18.0] — 2026-08-07

### Added

- **From Obsidian 1.13 on, the settings appear in the settings search.** Anyone searching there for
  "PDF", "endpoint" or "frontmatter" now finds this plugin's rows directly,
  instead of having to scroll through the tab. On 1.13 Obsidian also renders the settings
  itself — visible in a real number field (with bounds 1–500) instead of a text field.

### Internal

- **Dual-track settings tab following the Kit pattern:** `getSettingDefinitions()` is from now on the
  only definition; for Obsidian < 1.13 (`minAppVersion` is 1.8.7) `display()` draws
  the same structure with the classic `Setting` API — via the vendored Kit walker
  `renderSettingDefinitions` (obsidian-kit 0.25.0). No second definition tree that can
  drift apart. Stateful rows (endpoint list with live reachability, asynchronously
  populated model dropdown, vision test, category list, the migration-triggering
  frontmatter fields) remain `render` hatches: one code that runs unchanged in both paths.

## [0.17.1] — 2026-08-07

### Internal

- **Store compliance: `prefer-create-el`.** Ten `createEl("span")` calls in the sidebar view
  now use `createSpan()`. The two offscreen-canvas places (PDF page render,
  vision test image) use the free function `createEl("canvas")` instead of
  `activeDocument.createElement` — the same-named *Node* method attaches the element to the node
  and throws `HierarchyRequestError` for a document, while the free function returns the required
  detached element.
- **Lint reproduces the store review completely again:** `eslint-plugin-obsidianmd` raised from 0.3.0
  to 0.4.1. The older version did not know the rule, so the local run
  looked clean while the store scan reported warnings.

## [0.17.0] — 2026-08-07

### Changed

- **The thinking toggle recognizes more models that cannot be switched off.** Previously it knew
  two name patterns, now twelve model families. If you choose a model that presumably always thinks
  (`deepseek-r1`, `qwq`, `magistral` …), the hint "This model presumably always thinks —
  turning it off probably has no effect" appears in the toggle's tooltip.
  **The button remains operable:** the detection changes only the label, never the
  behavior. Locking still happens exclusively for `gpt-oss`/`harmony` — they
  actually reject the turn-off parameters, whereas the others swallow them as ineffective. A
  name guess should not disable a working button, especially since local models carry freely
  chosen names.
  The visible label of the button is unchanged, so the sidebar stays narrow.

### Internal

- **Capability detection now comes from `obsidian-kit`** (0.21.0) instead of a
  plugin-own copy: the module lives as a vendored copy under `src/vendor/kit/capabilities.ts`,
  `src/capabilities.ts` has shrunk to an adapter that projects out the vision axis.
  The same heuristic previously lay twice under the development umbrella — in `vault-rag` in full,
  here as a vision-only fork with byte-identical lists. No behavior change to the
  vision display.

## [0.16.0] — 2026-07-27

### Added

- **Rename frontmatter keys vault-wide after the fact:** If you change a key of the frontmatter
  mapping in the settings (e.g. `kind` → `type`), the plugin offers to carry the **existing**
  transcript, PDF and description notes across the whole vault along with it. Beforehand, a dialog
  shows a **preview per affected note** (line-by-line diff) and asks for confirmation **twice**:
  "Migrate & apply", "Apply without migration" (only the setting takes effect, notes stay as they
  are) or "Cancel" (the change is discarded). Non-destructive — foreign frontmatter fields and
  the note text remain untouched, notes with a key conflict are safely skipped, and a closing
  report states "N migrated · M failed · K conflicts".
  Closes the gap open since 0.13.0, where keys changed after the fact made existing notes
  undiscoverable (duplicate risk).

## [0.15.3] — 2026-07-26

### Changed

- **Original transcription scrolls along equally:** It is now the first block in the scrollable
  refinement history (instead of being pinned at the top) — same structure as the refinements, scrolls
  together with them.
- **Footer:** "Discard results" (grey) on the left, on the right a colored **"Apply"** button that writes
  the latest version.

## [0.15.2] — 2026-07-26

### Changed

- **Refinement history unified:** Each refinement is now built exactly like the
  original transcription — version with **[Copy]** and **[Create note]** below it. You
  write the version you want directly (no separate "Select" any more); the redundant
  "Original / Use this version" row has been removed. The feedback input field now always sits
  at the **bottom** (chat style), instead of in the middle of the history.

## [0.15.1] — 2026-07-25

### Changed

- **Refinement history tidied up:** Each refinement is now a clearly delimited card
  with a title, a collapsible thinking process and a uniform font size; the original and the selection
  "Use this version" are cleanly separated instead of squeezed together. The thinking process can also be expanded **while**
  thinking; a setting lets you choose whether it starts expanded or
  collapsed by default.

### Fixed

- **View "reset" on clicks in the sidebar:** A click in the sidebar (e.g. on the
  thinking process) could make the result cards disappear. Fixed — the view is now only
  rebuilt on a **real note change**, not on every focus change.

## [0.15.0] — 2026-07-25

### Changed

- **Refining as a chat history:** Each refinement is now appended at the bottom as its own entry
  (instead of replacing the text in place) — with a visible thinking process (Thinking) and
  a scrollable history. You can compare the versions and freely choose **any** of them as the version
  to write (replaces the previous "Back").

## [0.14.1] — 2026-07-25

### Changed

- **Clearer write buttons:** The card button is named "Update note" instead of "Create note"
  when it overwrites an existing note (e.g. after a refinement). The bulk button
  "Create all" now only appears when there are actually several notes to create — with a single
  result the one card button is enough (no confusing duplication).

## [0.14.0] — 2026-07-23

### Added

- **LLM feedback refinement (#7):** Iteratively refine transcript cards in the sidebar via prose feedback ("tables as GFM", "heading level wrong"). Conversational history per card (the model sees the original + previous rounds), one step can be undone; text-only, also works after writing (writing again via the existing diff gate).

### Fixed

- **Description of a PDF:** The generated description note now carries the source key
  `source_pdf` (instead of `source_image`) — consistent with the transcript notes. The recognition of
  existing descriptions was never affected.

## [0.13.0] — 2026-07-12

### Added

- **Image description mode:** Besides "Transcribe" there is now a **"Describe"** mode
  (switch at the top of the sidebar). Instead of extracting text from an image, it produces a
  **description** — ideal for images with little text (photos, diagrams, whiteboards), so that you can **find them again** via
  search (e.g. vault-rag) even though no text is in them. The description note
  is **non-destructive** (your image in the source note stays untouched), shows **image and
  description together** (index card) and carries a **category** (from a configurable
  taxonomy) plus free **tags** — both editable in the card before you save. Transcript
  and description of the same image can **coexist** independently.
- **Configurable frontmatter mapping:** All frontmatter keys of the generated notes (and the
  type value) can be adapted in the settings to your own vault schema (e.g. `kind` →
  `type`) — applies uniformly to transcript, PDF and description notes. *(Renaming existing
  notes vault-wide after the fact follows in a later release.)*

### Changed

- The former prompt preset "Describe image" has been removed — its purpose now lives as a first-class feature in the
  new Describe mode (old setting is automatically migrated to "Default").

## [0.12.0] — 2026-07-12

### Added

- **Results survive a note change:** A finished transcribed result in the sidebar that has not yet been accepted
  is no longer lost when you switch notes in between, collapse the sidebar or open
  another view. If you return to the source in the same session, the provisional result is back
  (remembered per source file). A new button **"Discard results"** explicitly clears it away;
  transcribing the same source again replaces it. After an Obsidian restart it is gone
  (the source is available anyway → transcribe again).

## [0.11.0] — 2026-07-12

### Added

- **Selective diff apply:** The overwrite dialog now shows a checkbox in front of each changed spot.
  By default all are ticked (confirming applies everything as before) — but you can
  deliberately untick individual changes to keep the old version at that spot. This way you mix
  the good new and the proven old lines per note, instead of just "all or nothing". If you untick
  every change, the note stays unchanged (nothing is written).

### Fixed

- **Shifted comparison in the overwrite dialog:** If the Obsidian Linter had inserted a blank line between
  frontmatter and image/PDF embed, the embed line wrongly stayed in the comparison
  — which shifted the entire line comparison by one line and set the wrong
  passages against each other. The embed is now reliably hidden regardless of such blank lines,
  and the comparison aligns correctly again.

## [0.10.1] — 2026-07-11

### Fixed

- **Narrower sidebar:** Model picker, preset and the Thinking toggle crowded into one
  row and forced the sidebar unnecessarily wide. The model picker now gets its own row
  (room for long model names), preset and Thinking toggle share the row below — the
  sidebar stays narrow.

## [0.10.0] — 2026-07-11

### Added

- **Thinking toggle in the sidebar:** A switch next to the model picker turns off the
  "thinking" (reasoning) of hybrid models — handy when a large reasoning model
  otherwise thinks for a long time and you need the result faster. The state is kept
  (default: on). Models that cannot be switched off (e.g. gpt-oss/harmony) show
  "always on" and remain unchanged.

## [0.9.1] — 2026-07-07

### Fixed

- **Diff gate no longer misses manual note edits:** If an already overwritten
  transcript note is edited by hand and the same source is then overwritten again in the same session,
  the diff dialog now appears again (instead of silently discarding the changes).
  To do so, the gate compares the actual note content instead of merely remembering whether the note was already touched
  in this session.
- **CRLF notes no longer lose frontmatter on overwrite:** Notes with
  Windows line endings (`\r\n`) now keep `source_image`/`source_note`/`created` on override,
  instead of losing them through a silent fallback.

## [0.9.0] — 2026-07-07

### Added

- **Diff before overwriting:** If a transcription overwrites an already existing
  transcript note (opt-in "Override"), a dialog first shows a line-by-line diff (old ↔ new)
  and lets you confirm or cancel — a safety net for the only operation that
  replaces existing notes. Cancelling leaves the old note untouched. In-session repeats
  (e.g. filling in failed PDF pages) continue to run without a prompt. The `+`/`-` markers
  in the diff are readable independent of color (accessibility for red-green color blindness).

## [0.8.0] — 2026-06-30

### Added

- **Born-digital PDFs use the embedded text:** If a PDF page has a real text layer
  (exported slides, papers, text PDFs), its exact text is sent to the model and formatted
  to Markdown — instead of OCRing a rendered image. Faster and without OCR errors. Scan/figure pages
  automatically fall back to the vision model. Can be switched off (setting "Use embedded PDF text").

## [0.7.0] — 2026-06-30

### Added

- **Prompt presets:** Next to the model picker in the sidebar, a preset selector — "Default" (your
  editable prompt) plus fixed modes for **Tables → Markdown**, **Handwriting**, **Math → LaTeX**,
  **Source code** and **Describe image**. The choice is kept (sticky). With a local
  vision model the prompt is the most important quality lever — the presets switch the mode per run
  without a detour through the settings.

## [0.6.1] — 2026-06-28

### Fixed

- **No more silent gaps in PDF transcripts:** If a page of a multi-page PDF failed
  (e.g. because the local model aborted midway), it previously vanished without a trace from the
  merged note — the note looked complete although pages were missing, and the
  `pages` value was wrong. Now a visible notice appears at that spot
  ("Page N — transcription failed"), and the page range in the frontmatter honestly corresponds
  to the transcribed range.

### Added

- **Re-transcribe failed pages:** Every failed card now has a
  "Retry" button; in the footer "Retry failed" appears as soon as there are errors.
  A page that succeeds on retry is cleanly merged into the same note on the next create
  (no duplicate, nothing is lost).
- **Clear error messages from the vision server:** If the local server responds with an error in the body
  (e.g. LM Studio: "model X is not loaded") instead of a real HTTP error, the real
  message is now shown instead of a generic "empty transcript".

## [0.6.0] — 2026-06-28

### Changed

- **Smoother streaming in the sidebar:** The transcription cards are now only updated
  incrementally while streaming instead of being completely rebuilt on every token. No more flicker and
  no more scroll jumps — noticeable especially on mobile devices; the thought block keeps
  its open/closed state.
- **Tidied-up sidebar look (theme-faithful):** The thought block now carries a `brain` icon instead of
  an emoji, long file names are truncated in the middle in the card header, the "Create note" button
  has an icon, and the spacing in the header area is calmer. The font remains determined entirely by the
  Obsidian theme (no font override).

## [0.5.1] — 2026-06-26

### Fixed

- **Endpoint input:** Typing into the endpoint field created a separate, incomplete entry per
  keystroke (`l`, `lo`, `loc`, …) instead of a single one. List
  editing is now applied only when the field is left (blur) — one field = one entry.

### Added

- **Delete endpoint:** Every endpoint row has its own delete button (trash can). The
  reachability status icon (`circle-check`/`circle-x`) on the left remains display-only.

## [0.5.0] — 2026-06-25

### Added

- **Endpoint fallback list:** instead of a single vision endpoint, an ordered
  list can be configured — the plugin pings it in order and automatically uses the **first reachable one**
  (re-resolved on sidebar refresh and, with one retry, after a failed call). This way a single synced config works
  across several devices and networks: e.g.
  `localhost:1234` (the device running LM Studio) first, then `192.168.178.27:1234`
  (LAN IP, reachable from iPhone/iPad via WireGuard). The settings tab has a dynamic
  endpoint field per entry (an empty field at the end = "Add new"; clearing a field removes the
  entry when you leave it), each with a reachability icon per field (circle-check / circle-x /
  loading circle + title text). The active endpoint is highlighted. The sidebar shows
  **"connected via \<endpoint\>"** instead of just the status. Migration: an existing
  `visionEndpoint` field in `data.json` is automatically migrated to `visionEndpoints` —
  existing configurations keep working without manual intervention.

- **Active file as source (stage 3):** if the active file is itself an image or a PDF
  (i.e. not a note, but the media file displayed directly in Obsidian), the
  sidebar shows this file as a single entry with the label **"diese Datei"** (DE) or
  **"this file"** (EN) and treats it as a transcription source. PDFs: page range
  selectable as usual; images: a single card. The transcript note is created at the
  **"Default location for new notes"** (`app.fileManager.getNewFileParent`),
  since there is no source note next to which it could be placed. The frontmatter contains
  no `source_note` field (there is no source note); `source_pdf`/`source_image`, `created`
  and `transcribed_by` (for PDFs also `pages`) are retained. The source file is **not
  modified** (no embed replacement). Idempotency and override work as usual: an
  already transcribed file shows "✓ Transcript exists → open"; override overwrites
  the existing note. Sidebar only — the command "Transcribe images of the active note"
  and the context menu still apply only to notes with embeds.

## [0.4.2] — 2026-06-24

### Changed

Accessible status display (no change to transcription):

- Connection and model status are distinguished by icon **shape**
  (`circle-check` connected · `circle-x` offline · `circle-slash` model not loaded ·
  `loader` checking) instead of by color alone — readable even with red-green color
  blindness (WCAG 1.4.1, redundant encoding of shape + text + color).
- `minAppVersion` remains 1.8.7.

## [0.4.1] — 2026-06-24

### Changed

Maintenance release for conformance with the Obsidian community plugin review (no
user-visible functional changes):

- Settings re-render goes through a private method instead of `display()`, which has been
  deprecated since Obsidian 1.13 — `minAppVersion` remains 1.8.7, behavior unchanged.
- `authorUrl` in the manifest points to the author's homepage (jkaindl.de).
- Installation docs switched to the community plugins search (BRAT instructions removed, since
  the plugin is now listed).

## [0.4.0] — 2026-06-24

### Added

- **Model transparency:** a refresh icon next to both model pickers (sidebar + settings)
  reloads the model list — useful when an external process has switched the loaded model of the local
  backend (MLX/LM Studio). After every transcription the sidebar automatically
  aligns the selection with the model actually used (`response.model`). A green checkmark next to the
  dropdown shows whether the selection is loaded in the backend; the refresh gives visible feedback
  ("N models loaded").

- **Linked sources:** plain links to images/PDFs (`[[x.pdf]]`, `[text](x.pdf)` without `!`) are
  now also recognized as sources and transcribed; the link in the text remains unchanged
  (unlike embeds, which are replaced by the transcript). The sidebar marks such entries
  with "linked".

## [0.3.0] — 2026-06-23

### Added

- **Backlink idempotency:** The sidebar detects an already existing transcript note for
  a source (via backlink index + `source_pdf`/`source_image` frontmatter filter) and shows
  "exists → open" instead of transcribing again.
  Only notes whose frontmatter points to the source file via `source_pdf` / `source_image`
  count — a mere body embed (e.g. `![[datei.pdf]]`) is not enough (frontmatter filter is load-bearing).
- **Override option:** A checkbox in the sidebar forces a repeated transcription;
  the plugin then overwrites the existing transcript note and keeps the complete
  existing frontmatter (only `transcribed_by`/`pages` + body are replaced).

### Changed

- **PDF render scale** (`pdfRenderScale`) is now a slider (range 1.0–4.0, step 0.5)
  instead of a free text field — direct, bounded adjustment of the render resolution.

## [0.2.0] — 2026-06-22

### Added

- **PDF embed transcription:** embedded PDFs are transcribed page by page via the sidebar.
  Page range selectable (default: all), one transcript note per PDF, the PDF embed is replaced.
  Limits: `pdfMaxPages` (configurable) and `pdfRenderScale` (smaller on mobile, protects against OOM).
  Implemented via a bundled pdf.js worker (blob URL, no CDN, fully offline).
- **Configurable PDF page separator** (`pdfPageSeparator`): a dropdown selects how pages
  are separated in the merged transcript note — five options:
  "Obsidian comment %% Page N %% (hidden in reading view)" (default), "Heading ## Page N",
  "Horizontal rule ---", "Page break (HTML, for export)" and "None (seamless text)".
- **Localized title suffix** for transcript notes: "(transcript)" for images and
  "(PDF transcript)" for PDFs (follows the UI language).

## [0.1.3] — 2026-06-22

### Added

- GitHub Actions release pipeline (`.github/workflows/release.yml`): builds the plugin on a
  SemVer tag, generates **build provenance attestations** for `main.js`/`manifest.json`/`styles.css`
  and publishes the GitHub release. Runs on the GitHub mirror side (BRAT/registry).

## [0.1.2] — 2026-06-22

### Fixed

- Live streaming now uses `activeWindow.fetch` (injected stream transport) instead of the
  global `fetch` — satisfies the Obsidian lint rule `no-restricted-globals` without `eslint-disable`
  (which the community review does not allow). Behavior unchanged.
- README: "Coming soon" placeholder in the community plugins section replaced with real install instructions.

## [0.1.1] — 2026-06-22

Submission readiness for the Obsidian community registry (lint/API conformance).

### Changed

- `minAppVersion` raised to **1.8.7** (official `getLanguage()` API instead of 1.4.0 with a fallback).
- Non-streaming network calls go through Obsidian's `requestUrl` (via dependency injection;
  the pure core stays obsidian-free). Live streaming still uses `fetch` — `requestUrl`
  only returns the complete response and cannot stream token by token.

### Fixed

- Obsidian plugin lint clean: no more `no-unsupported-api` violations, `activeDocument` instead of
  `document`, no floating promises / unsafe `any` assignments / unnecessary type assertions.

### Development

- `eslint` + `eslint-plugin-obsidianmd` + `npm run lint` — reproduces the community review checks locally.

## [0.1.0] — 2026-06-21

First release. Split out of [vault-rag](https://git.jkaindl.de/jkaindl/vault-rag) 0.2.0.

### Added

- **Sidebar view** with image selection, live streaming transcription (thought block for
  reasoning models, copy button) and note creation per image or "Create all".
- **Commands** "Transcribe images of the active note" (batch) and "Open sidebar".
- **Editor context menu** "Image → Markdown" for the image under the cursor.
- Shared SSE streaming transport; `VisionClient` with `ping`/`listModels` for the model picker
  and connection status.
- Non-destructive & idempotent: one transcript note per image, the image embed is replaced.
- **Settings QoL:** large, resizable prompt textarea; connection status dot + "Test connection";
  "Vision capability" display with an active "Test vision" button; "Load models" fallback when offline.
- **Vision capability detection** (`capabilities.ts`): name heuristic + metadata probe against
  Ollama (`/api/show`) and LM Studio (`/api/v1/models`, `/api/v0/models`).
- **Bilingual interface (English/German):** all user-visible strings follow the
  language setting of Obsidian. English is canonical, German is the translation; the
  language is detected once when the plugin loads, so a change takes effect after a
  plugin reload. The bundled default vision prompt is localized too; brand
  and control strings ("Image → Markdown", "IMG → MD", "Stop") remain unchanged.
- `npm run deploy` (env-controlled via `$OBSIDIAN_PLUGIN_DIR`).

### Fixed

- Sidebar view now survives a plugin reload/update (no more leaf detach in `onunload`).
