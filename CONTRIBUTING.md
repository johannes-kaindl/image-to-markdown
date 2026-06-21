# Contributing to Image to Markdown

Thanks for your interest in improving **Image to Markdown** — an Obsidian plugin that transcribes the images in a note to Markdown with a local vision LLM, fully offline and non-destructive.

Contributions of all sizes are welcome: bug reports, fixes, docs, and features. Before you start, please skim [`AGENTS.md`](AGENTS.md) in the repo root — it holds the architecture, module layout, and the detailed engineering conventions. This document is the contributor-facing summary. The conventions below follow the workspace's leading **comply-or-explain** convention: deviate when you have a good reason, and say why in the PR.

## Branch model

- `main` is always green — it must build, pass tests, and typecheck at every commit.
- Do feature work on a `feat/<name>` branch.
- Merge into `main` with `--no-ff` so the history keeps the merge structure.
- Direct pushes to `main` happen only with explicit authorization.

## Commits

- Follow [Conventional Commits](https://www.conventionalcommits.org/): `feat|fix|docs|chore|refactor|test(scope): …`. The description itself may be written in German.
- Stage **only the files you actually touched**. Never use `git add -A`.
- When an AI tool made a substantial contribution to a commit, add a trailer:

  ```
  Co-Authored-By: Claude Opus <Version> (1M context) <noreply@anthropic.com>
  ```

- Don't bypass the pre-commit hooks (no `--no-verify`).

## Tags and remotes

- Releases are tagged with [SemVer](https://semver.org/) **without** a `v` prefix — e.g. `1.2.3`, not `v1.2.3`.
- [Codeberg](https://codeberg.org/jkaindl/image-to-markdown) is the canonical, primary remote (`origin`).
- The [GitHub repository](https://github.com/johannes-kaindl/image-to-markdown) is a **mirror** only (used for BRAT and registry purposes). Open your contributions against Codeberg.

## Quality gate

Run these locally before you commit, and make sure they're green:

- **Tests:** `npm test` — the suite is test-driven and currently has 83 tests (Vitest).
- **Typecheck:** `npx tsc --noEmit` — must be clean.
- **Pre-commit hooks:** let them run; don't skip them with `--no-verify`.

The project is test-driven, so new behavior should arrive with tests.

## Where to work

- File issues and open pull requests on **Codeberg**: <https://codeberg.org/jkaindl/image-to-markdown>. (GitHub is a mirror, not the place for contributions.)
- For larger features, work through **brainstorm → spec → plan → TDD**, and keep the resulting artefacts under `docs/superpowers/`. Smaller fixes can go straight to a `feat/<name>` branch with tests.
- The detailed conventions, architecture, and module layout live in [`AGENTS.md`](AGENTS.md).

## License of contributions

This project is dual-licensed by content type:

- **Code** is licensed under **AGPL-3.0-or-later** (see [`LICENSE`](LICENSE)). By contributing code, you agree that your contribution is licensed under AGPL-3.0-or-later.
- **Documentation and other text** is licensed under **CC BY-SA 4.0** (see [`LICENSE-DOCS`](LICENSE-DOCS)). By contributing docs, you agree that your contribution is licensed under CC BY-SA 4.0.

A commercial dual-license is available on request for users for whom the AGPL copyleft is not a fit.
