# AGENTS.md

Orientierung für KI-Agenten (Claude Code, Codex, …) und Mitwirkende an diesem Repository.
Workspace-weite Standards (comply-or-explain): siehe [`../_docs/CONVENTIONS.md`](../_docs/CONVENTIONS.md).

**Profil:** `ts-node` · `obsidian-plugin`.

## Project character

**Projekt:** `image-to-markdown` (Plugin-id) — Obsidian-Plugin, das die **Bilder einer Notiz**
per **lokalem Vision-LLM** nach Markdown transkribiert. Komplett offline, ohne Cloud. Autor: Johannes Kaindl.

**Warum es existiert:** Ausgegliedert aus [`vault-rag`](https://codeberg.org/jkaindl/vault-rag) 0.2.0
(2026-06-21). Bild-Transkription ist **kein RAG** — sie teilte mit vault-rag nur den SSE-Transport,
nicht den Index/Retrieval-Kern. Als eigenes Plugin bleibt vault-rag ein schlanker RAG-Kern und
`image-to-markdown` ein fokussiertes Werkzeug mit eigener Registry-/Feedback-Fläche.

**Bewusste Designentscheidungen:**
- **Nicht-destruktiv & idempotent:** pro Bild eine Transkript-Notiz; der Bild-Embed in der Quellnotiz
  wird durch einen Embed der neuen Notiz ersetzt — nie der Originaltext überschrieben.
- **Offline-first:** spricht einen konfigurierbaren OpenAI-kompatiblen Vision-Endpoint (LM Studio,
  MLX, Ollama) — keine Cloud, kein VPN.
- **Streamend:** die Transkription läuft live in die Sidebar (inkl. Reasoning-Block bei
  Reasoning-Modellen), abbrechbar.

## Architecture principles

Reiner Kern ohne obsidian-Imports (`img_to_md.ts`, `img_to_md_state.ts`, `vision_client.ts`,
`sse.ts`, `think_splitter.ts`) → in Node testbar ohne DOM-Mock (PROF-OBS-03/04). Nur `main.ts`,
`settings.ts`, `img_to_md_view.ts` importieren `obsidian`. Die View bekommt alle Abhängigkeiten
über injizierte Closures (`ImgToMdViewDeps`) → headless testbar.

### Modul-Layout (`src/`)

```
img_to_md.ts        reiner Kern: findImageEmbeds · buildTranscriptNote · replaceEmbed ·
                    writeTranscripts (batched, read-once/write-once) · runImgToMd · ImgToMdIO.
img_to_md_state.ts  ImgToMdState — Bild-Auswahl + Ergebnis-Karten (kein DOM/I/O).
img_to_md_view.ts   ImgToMdView (ItemView, Sidebar) — Modell-Picker, Bild-Liste, streamende Karten.
vision_client.ts    VisionClient → OpenAI-kompatibler /v1/chat/completions (transcribe +
                    transcribeStream) · ping/listModels · normalizeEndpoint.
sse.ts              streamSSE + parseSSE (OpenAI-SSE, content + reasoning_content). Kopiert aus vault-rag.
think_splitter.ts   ThinkSplitter (inline <think>-Tags). Kopiert aus vault-rag.
settings.ts         ImageToMarkdownSettings · DEFAULT_SETTINGS · SettingTab (Endpoint/Modell/Prompt).
main.ts             Plugin-Entry: View/Ribbon/Command/Kontextmenü/SettingTab, VisionClient.
```

**Geteilter Transport ist kopiert, nicht geteilt:** `sse.ts`/`think_splitter.ts` existieren identisch
in vault-rag und hier. Ein npm-Shared-Package wäre für ~5 KB stabilen Code Overengineering (YAGNI).

## Commands

```bash
npm install                       # Deps
npm run dev                       # esbuild watch
npm run build                     # prod-Bundle → main.js (gitignored)
npm test                          # vitest run (83 Tests)
npx vitest run tests/<datei>      # eine Test-Datei
npx tsc --noEmit                  # Typecheck
```

## Conventions

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen.
- **Tests:** vitest + happy-dom; Obsidian-Mock unter `tests/__mocks__/obsidian.ts`. Nach jeder
  Änderung müssen **alle Tests grün** bleiben. `npx tsc --noEmit` separat laufen (vitest ≠ tsc).
- **Commits:** Conventional Commits, deutsche Beschreibung erlaubt. **Nur berührte Dateien stagen.**
  Trailer bei substanziellem AI-Beitrag: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## Gotchas

- **`data.json`** ist die von Obsidian persistierte Plugin-Konfig — git-ignored, nicht committen.
- **`main.js`** ist Build-Artefakt (gitignored) — nie von Hand editieren.
- **Endpoint mit `/v1`-Suffix:** `normalizeEndpoint()` strippt ein trailing `/v1`, sonst baute der
  Client `…/v1/v1/chat/completions`. **LM Studio antwortet auf falsche Pfade mit HTTP 200 + Fehler-Body**
  (kein echter Fehler) → `res.ok` true, Stream leer → still leeres Transkript. (Genau dieser Bug beim
  ersten Smoke-Test.)
- **HEIC/HEIF** (iOS-Default) werden von Vision-Modellen abgelehnt → übersprungen + Warnung.
- **LM Studio ignoriert das `model`-Feld** → tatsächliches Modell aus `response.model` lesen.
- **Vision-Endpoint-Default `:8080`** (MLX) ≠ LM Studio `:1234`.
- **Nicht in-place** (anders als vault-rag): nach Build `main.js`/`manifest.json`/`styles.css` ins
  Vault-Plugin-Verzeichnis kopieren, dann reloaden.

## Memory

- **Projekt-Memory:** verwandtes Wissen im vault-rag-Memory
  (`~/.claude/projects/-Users-Shared-code-vault-rag/memory/`), insbesondere die Ausgliederungs-Spec/-Plan
  unter vault-rag `docs/superpowers/`.

## Abweichungen von der Leitkonvention

Stand 2026-06-21 — frisch ausgegliedert, **noch nicht released**. Bewusste, begründete Abweichungen
(comply-or-explain), aufzulösen in der submission-readiness-Session:

- **CORE-META-02/03** — keine Badge-Zeile / kein Hero-Bild. *Grund:* pre-release; mit erstem Release/Screenshots.
- **CORE-META-04** — kein Diátaxis-Manual. *Grund:* pre-release; skaliert mit Reife.
- **CORE-META-06** — `CHANGELOG.md` vorhanden; `CONTRIBUTING.md`/`SECURITY.md` fehlen. *Grund:* vor Release nachziehen.
- **CORE-META-07** — `LICENSE` (AGPL-3.0) vorhanden; Dual-License-Option (`LICENSING.md`/`CLA.md`) noch nicht. *Grund:* bei Bedarf.
- **CORE-META-09** — kein `README.de.md`. *Grund:* optional; EN-`README.md` kanonisch.
- **CORE-GIT-01** — Codeberg-`origin` + GitHub-Mirror beim Forge-Setup gesetzt (2026-06-21).
- **PROF-TS-01** — npm-Scripts ohne `lint`/`typecheck` (von vault-rag geerbt; `npx tsc --noEmit` verfügbar). *Grund:* offen.
- **PROF-TS-04** — kein `tsconfig.build.json`-Split (ein `tsconfig.json` + `vitest.config.ts` reicht). *Grund:* klein genug.
- **PROF-OBS-02** — kein `deploy`-Script. *Grund:* env-gesteuertes `npm run deploy` nachzuziehen.
