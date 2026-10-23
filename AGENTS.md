# AGENTS.md

Orientierung für KI-Agenten (Claude Code, Codex, …) und Mitwirkende an diesem Repository.

> **Workspace-Standards (maintainer-lokal):** Die verbindliche Leitkonvention steht in `_docs/CONVENTIONS.md` im Multi-Projekt-Workspace des Maintainers, `../../workspace/_docs` relativ zu diesem Repo — nicht Teil dieses Repos, ignorieren falls im Klon nicht vorhanden. Modell comply-or-explain.

**Profil:** `ts-node` · `obsidian-plugin`.

## Project character

**Projekt:** `image-to-markdown` (Plugin-id) — Obsidian-Plugin, das die **Bilder einer Notiz** (und PDFs) per **lokalem Vision-LLM** nach Markdown transkribiert. Komplett offline, ohne Cloud. Autor: Johannes Kaindl. Ausgegliedert aus `vault-rag` 0.2.0 (2026-06-21): Bild-Transkription ist kein RAG. Das Warum: `docs/internal/decisions.md`.

- **Nicht-destruktiv und idempotent:** pro Bild eine Transkript-Notiz; der Bild-Embed in der Quellnotiz wird durch einen Embed der neuen Notiz ersetzt — nie der Originaltext überschrieben.
- **Offline-first:** spricht einen konfigurierbaren OpenAI-kompatiblen Vision-Endpoint (LM Studio, MLX, Ollama).
- **Streamend:** die Transkription läuft live in die Sidebar (inkl. Reasoning-Block), abbrechbar.

## Architecture principles

- **Reiner Kern ohne `obsidian`-Imports, testbar in Node ohne DOM-Mock (PROF-OBS-03/04).** Nur `main.ts`, `settings.ts`, `img_to_md_view.ts`, `http.ts`, `diff_modal.ts`, `migration_modal.ts` und `vendor/kit-obsidian/*` importieren `obsidian`; `pdf_render.ts` nutzt DOM/Canvas. Die View bekommt alle Abhängigkeiten über injizierte Closures (`ImgToMdViewDeps`) → headless testbar. Das Modul-Layout: `docs/internal/architecture.md`.
- **Geteilter Code ist vendored, nicht als Package geteilt** (Kit-first-Regel des Dachs): `src/vendor/kit/` (obsidian-frei) und `src/vendor/kit-obsidian/` (obsidian-abhängig), Pin in den `VENDOR.json`. Erneuert wird nur mit `sh tools/sync-kit.sh`, nie von Hand.
- **Die LLM-Anbindung ist die Kit-Verbindung `createLlmConnection` (`plugin.llm`);** die Endpunkt-Quelle gehört dem LLM Endpoint Manager, sobald er installiert ist. Details: `.claude/rules/llm-verbindung.md`.

## Commands

```bash
npm install                       # Deps
npm run dev                       # esbuild watch
npm run build                     # prod-Bundle → main.js (gitignored)
npm run deploy                    # build + nach $OBSIDIAN_PLUGIN_DIR ins Vault-Plugin-Verzeichnis kopieren
npm run lint                      # eslint src (reproduziert die Obsidian-Community-Review-Checks)
npm test                          # vitest run
npx vitest run tests/<datei>      # eine Test-Datei
npm run typecheck                 # tsc --noEmit (separat von vitest)
npm run gate                      # typecheck + typecheck:scripts + test + lint + build (die Abnahme-Schleife)
npm run shots -- --setup          # Staging-Vault aus dem getrackten Fixture bauen (docs/images/fixture/)
npm run shots -- --port <port> --vault image-to-markdown      # Aufnahme in einer Zweitinstanz (Port Pflicht)
npm run smoke:gui -- --port <port>  # GUI-Smoke in einer Zweitinstanz (Port Pflicht), Pruefpunkte in docs/SMOKE.md
sh tools/sync-kit.sh              # Vendor-Baum aus ../obsidian-kit erneuern (bzw. $KIT_DIR)
npm run version-bump 0.3.0        # Version synct package.json/manifest.json/versions.json
```

## Conventions

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen.
- **Tests:** vitest + happy-dom; Obsidian-Mock unter `tests/__mocks__/obsidian.ts`. Nach jeder Änderung müssen **alle Tests grün** bleiben. `npx tsc --noEmit` separat laufen (vitest ≠ tsc).
- **Commits:** Conventional Commits, deutsche Beschreibung erlaubt. **Nur berührte Dateien stagen.** Trailer bei substanziellem AI-Beitrag: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **i18n:** nutzersichtbare Strings via `t()` aus `i18n.ts` (EN kanonisch, EN/DE nach App-Sprache) — Workspace-Standard PROF-OBS-07 (`_docs/docs/obsidian-i18n.md`). Keine Muttersprachen-Literale in der UI; Marken-/Steuer-Strings (`Image → Markdown`, `Stop`) bleiben literal.

## Gotchas

- **`data.json`** ist die von Obsidian persistierte Plugin-Konfig — git-ignored, nicht committen. **`main.js`** ist Build-Artefakt (gitignored) — nie von Hand editieren.
- **Das Plugin läuft nicht in-place** (anders als vault-rag): nach dem Build `main.js`/`manifest.json`/`styles.css` ins Vault-Plugin-Verzeichnis kopieren (`npm run deploy`), dann reloaden.
- **`pdfjs-dist` bleibt auf 4.10.38 gepinnt** (v5/v6 brechen das Single-File-Bundle) und ist eine runtime-`dependency`. Vor einem Upgrade: `.claude/rules/pdf.md`.
- **Nie im Repo: absolute Pfade außerhalb des Repos** (`/Users/…`, Vault-Pfade) — Platzhalter nutzen (`$VAULT/…`, `~/…`, repo-relativ). Herkunftsnachweise als Repo-Name + `Datei:Zeile` sind erwünscht. Gate: `scripts/check-no-abs-paths.mjs` (Teil von `npm test`).
- **Ein Release fährt der Master** (CORE-AGENT-14), über `npm run release` im Dach-Tooling; Regeln: `../.claude/rules/release-und-store.md`.

## Context index

- Bevor du `src/main.ts`, `src/settings.ts`, `src/img_to_md.ts` oder eine andere Datei der LLM-Anbindung (`vision_client.ts`, `llm_call.ts`, `capabilities.ts`, `request_params.ts`) liest oder änderst: `.claude/rules/llm-verbindung.md` (Endpunkt-Quelle, Verbindung, Server-Eigenheiten).
- Bevor du unter `src/vendor/` liest oder änderst oder das Kit neu vendorst: `.claude/rules/vendor-kit.md`.
- Bevor du den PDF-Weg (`src/pdf_*.ts`) oder `scripts/build-pdf-worker.mjs` änderst: `.claude/rules/pdf.md`.
- Vor Änderungen an Modulstruktur oder Dateinamen: `docs/internal/architecture.md`.
- Bevor du eine Entscheidung „bewusst so“ übernimmst: `docs/internal/decisions.md`.
- Bevor du den GUI-Smoke fährst oder änderst: `docs/SMOKE.md`, `../.claude/rules/gui-smoke-treiber.md`, `../.claude/rules/obsidian-instanz.md`, `../.claude/rules/cdp-lock.md`, `../.claude/rules/staging-vaults.md`.
- Bevor du README-Bilder aufnimmst: `../.claude/rules/readme-shots.md`, Skill `readme-shots`.
- Bevor du `styles.css` oder UI änderst: `../.claude/rules/store-css.md`, `../.claude/rules/ui-bausteine.md`, `../UI-STANDARD.md`.
- Vor einem Release oder einer Store-Einreichung: `../.claude/rules/release-und-store.md`, Skills `plugin-release-setup` und `store-rescan`.

## Memory

- **SDD-Artefakte (seit 2026-07-16): Cockpit, nicht Repo** — Specs/Plans/Task-Reports leben im Coding-Cockpit des Maintainers (`$VAULT/25_Coding/image-to-markdown/_SDD/`, CORE-META-14, maintainer-lokal). Sie tragen Arbeitskontext (Vault-Pfade, Schwester-Repo-Interna), der in einem public Repo niemandem nützt. Das Repo behält die Design-Essenz in `docs/internal/decisions.md` und `CHANGELOG.md`.
- **Projekt-Memory** liegt unter `~/.claude/projects/<slug>/memory/` mit `MEMORY.md`-Index.

## Abweichungen von der Leitkonvention

Stand: siehe `CHANGELOG.md` / `manifest.json` (dort steht die maßgebliche Version — hier bewusst keine, damit dieser Block nicht durch Zeitablauf falsch wird). Verbleibende bewusste, begründete Abweichungen (comply-or-explain):

- **PROF-TS-04** — kein `tsconfig.build.json`-Split (`tsconfig.json`, `tsconfig.test.json` und `tsconfig.scripts.json` reichen). *Grund:* klein genug.

## UI-Abweichungen

- **stream-area** — Grund: (Streaming-Antwortbereich, UI-STANDARD §8, verbindlich seit 2026-09-07)
  `buildStreamArea` aus dem Kit baut EINEN Antwortbereich für einen Anstrich; `img_to_md_view.ts` rendert dagegen
  `N` gleichzeitig aktive Karten (eine je Bild/PDF-Seite/Refine-Runde), jede mit eigenem
  Gedankenblock, Trunkierungs-Hinweis, Versions-Verlauf (`syncRefineLog`) und eigenem
  "Notiz anlegen" je Version — eine Komposition, die das Kit-Modul nicht abbildet (dessen
  Vertrag ist EIN Gedankenblock + EIN Tail + EINE Statuszeile). Ein Vendoring würde die
  Push-Mechanik (Bauart 2 laut Kit-Dateikopf) aufnehmen, aber die Mehrkarten-/Versions-Struktur
  daneben nachbauen müssen — kein Baustein spart dann Code, nur Vokabular.
  — gilt-solange: `src/img_to_md_view.ts` enthaelt `cardEls: CardRefs[]`

- **strings-location** — Grund: (UI-STANDARD §10 nennt `src/i18n/strings.ts` als Ablageort)
  Die Texte dieses Plugins liegen in `src/i18n.ts` (EN kanonisch, EN/DE); ein Umzug würde nur Dateipfade
  ändern, keinen Text und keine Auflösung von Fachbegriffen. Entscheidung Master Welle 14, 2026-09-30.
  — gilt-solange: `src/i18n.ts` die einzige Textquelle des Plugins ist

## Dach-Kontext (obsidian-plugins)

Dieses Repo liegt unter dem Koordinations-Dach `obsidian-plugins/` (Parent-Verzeichnis `../` im Maintainer-Workspace).
**Vor dem Lösen eines Problems:** `../AGENTS.md` (Kit-first-Regel) und `../REGISTRY.md`
(Lösungs-Registry) prüfen — viele Probleme sind in Nachbar-Plugins oder im
`obsidian-kit` bereits gelöst.

**Vor jeder UI-Arbeit** (Views, Modals, Settings-Tabs, CSS): `../UI-STANDARD.md` ist
verbindlich (Obsidian-nativ first, ein Frontend pro Plugin, nur Theme-CSS-Variablen).
