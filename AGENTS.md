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
`capabilities.ts`, `i18n.ts`, `sse.ts`, `think_splitter.ts`, `pdf_to_md.ts`, `backlinks.ts`) → in Node testbar ohne DOM-Mock (PROF-OBS-03/04). Nur `main.ts`,
`settings.ts`, `img_to_md_view.ts`, `http.ts`, `pdf_render.ts` importieren `obsidian` (bzw. DOM/Canvas). Die View bekommt alle Abhängigkeiten
über injizierte Closures (`ImgToMdViewDeps`) → headless testbar.

### Modul-Layout (`src/`)

```
img_to_md.ts        reiner Kern: findImageEmbeds · buildTranscriptNote · replaceEmbed ·
                    writeTranscripts (batched, read-once/write-once) · runImgToMd · ImgToMdIO.
                    Etappe-3-Helfer: classifySource (Dateiext → image/pdf/null) ·
                    buildSelfSourceItem (erzeugt das einzelne ImgItem wenn die aktive Datei
                    selbst die Quelle ist); ImgItem hat dafür ein neues Feld selfSource: true.
img_to_md_state.ts  ImgToMdState — Bild-Auswahl + Ergebnis-Karten (kein DOM/I/O).
img_to_md_view.ts   ImgToMdView (ItemView, Sidebar) — Modell-Picker, Bild-Liste, streamende Karten,
                    PDF-Seitenbereichs-Auswahl. Idempotenz-Anzeige je Liste-Zeile: bei vorhandenem
                    Transkript „✓ transcript exists" + „open"-Link (springt zur Notiz), Zeilen-Titel
                    „re-transcribing overwrites it" — erneut transkribieren überschreibt (kein Block).
pdf_render.ts       Obsidian/DOM-Schicht für pdf.js: lädt PDF per Vault-Adapter, rendert Seiten auf
                    OffscreenCanvas/Canvas → PNG-Data-URL. Importiert den gebündelten pdf.js-Worker
                    (Blob-URL aus pdf-worker-src.generated.ts). Enthält pdfSmokeTest (Dev-Util).
pdf_to_md.ts        Reiner Kern: seitenweise PDF-Transkription — nimmt RenderPage-Callback + VisionClient,
                    streamt Karten je Seite, schreibt eine Transkript-Notiz pro PDF, ersetzt den
                    PDF-Embed. Obsidian-frei, vollständig unit-testbar.
backlinks.ts        Reiner Kern: Backlink-Idempotenz-Lookup — `findExistingTranscript` (prüft
                    `resolvedLinks` + `frontmatterLinks` mit `source_pdf`/`source_image`-Filter;
                    der Frontmatter-Filter ist load-bearing: Body-Embeds allein reichen nicht).
                    Interface `BacklinkLookup` (von der Obsidian-Schicht injiziert, obsidian-frei
                    testbar). Verwendet von `img_to_md_state.ts` via Scan.
vision_client.ts    VisionClient → OpenAI-kompatibler /v1/chat/completions (transcribe +
                    transcribeStream) · ping/listModels · visionConfidence/testVision · normalizeEndpoint ·
                    resolveActiveEndpoint (pingt Endpoint-Liste der Reihe nach, gibt den ersten
                    erreichbaren zurück oder null wenn alle offline).
                    Transport injiziert (HttpFetch/setHttp): non-streaming via requestUrl-Adapter,
                    Streaming via fetch (requestUrl streamt nicht). Reiner Kern, obsidian-frei.
http.ts             Obsidian-Schicht: requestUrl-Adapter (obsidianHttp) → via setHttp in den Kern injiziert.
capabilities.ts     Vision-Capability-Detektion (vision-only, Fork aus vault-rag): guessVision (Namens-
                    Heuristik) · parse* (Ollama/LM Studio v0/v1) · fetchVisionCapability · resolveVision ·
                    visionDisplay · isVisionConfirmed. Reiner Kern, DOM-frei.
sse.ts              streamSSE + parseSSE (OpenAI-SSE, content + reasoning_content). Kopiert aus vault-rag.
think_splitter.ts   ThinkSplitter (inline <think>-Tags). Kopiert aus vault-rag.
i18n.ts             reiner Kern: UI-Lokalisierung EN/DE — STRINGS{en,de} · t() (Fallback lang→en→key,
                    {0}-Interpolation) · pickLang · setLang/getLang · defaultVisionPrompt. EN kanonisch.
settings.ts         ImageToMarkdownSettings (enthält `visionEndpoints: string[]` statt eines einzelnen
                    Endpunkts) · migrateEndpoints (liest altes `visionEndpoint`-Feld aus data.json und
                    überführt es nach `visionEndpoints`) · defaultSettings() (Prompt sprachabhängig) ·
                    SettingTab: dynamische Endpunkt-Felder (ein Feld pro Eintrag + leeres „Neu"-Feld;
                    Pro-Feld-Erreichbarkeits-Icon circle-check/circle-x/loader + title-Text; aktiver
                    Endpoint markiert; „Verbindung testen") · Modell + „Vision-Fähigkeit"
                    (visionConfidence + aktiver „Vision testen") · Prompt (große Textarea) ·
                    PDF-Einstellungen (pdfMaxPages, pdfRenderScale, pdfPageSeparator) ·
                    makeVisionTestImage (Canvas, DOM-Schicht).
main.ts             Plugin-Entry: setHttp(obsidianHttp) + Sprach-Detektion (setLang) beim onload,
                    View/Ribbon/Command/Kontextmenü/SettingTab, VisionClient. Hält `activeEndpoint`
                    (zuletzt aufgelöster Endpunkt) + `resolveAndReconnect` (ruft
                    resolveActiveEndpoint auf, speichert Ergebnis, informiert View).
pdf-worker-src.generated.ts  Auto-generiert von scripts/build-pdf-worker.mjs — enthält den
                    gebündelten pdf.js-Worker als eingebetteten String (Blob-URL-Quelle). Nicht
                    manuell editieren; wird bei `npm run build` neu erzeugt.
```

**pdf.js-Worker-Build:** `scripts/build-pdf-worker.mjs` bündelt `pdfjs-dist/build/pdf.worker.mjs`
via esbuild zu einem Single-File-Bundle, das als Template-Literal in
`pdf-worker-src.generated.ts` eingebettet wird. Zur Laufzeit erzeugt `pdf_render.ts` daraus
eine Blob-URL — kein CDN, kein Netz, kein Import-Assertion-Trick.

**Geteilter Transport ist kopiert, nicht geteilt:** `sse.ts`/`think_splitter.ts` existieren identisch
in vault-rag und hier. Ein npm-Shared-Package wäre für ~5 KB stabilen Code Overengineering (YAGNI).

## Commands

```bash
npm install                       # Deps
npm run dev                       # esbuild watch
npm run build                     # prod-Bundle → main.js (gitignored)
npm run deploy                    # build + nach $OBSIDIAN_PLUGIN_DIR ins Vault-Plugin-Verzeichnis kopieren
npm run lint                      # eslint src (reproduziert die Obsidian-Community-Review-Checks)
npm test                          # vitest run (145 Tests)
npx vitest run tests/<datei>      # eine Test-Datei
npm run typecheck                 # tsc --noEmit (separat von vitest)
npm run version-bump 0.3.0        # Version synct package.json/manifest.json/versions.json
```

## Conventions

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen.
- **Tests:** vitest + happy-dom; Obsidian-Mock unter `tests/__mocks__/obsidian.ts`. Nach jeder
  Änderung müssen **alle Tests grün** bleiben. `npx tsc --noEmit` separat laufen (vitest ≠ tsc).
- **Commits:** Conventional Commits, deutsche Beschreibung erlaubt. **Nur berührte Dateien stagen.**
  Trailer bei substanziellem AI-Beitrag: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **i18n:** nutzersichtbare Strings via `t()` aus `i18n.ts` (EN kanonisch, EN/DE nach App-Sprache) — Workspace-Standard
  PROF-OBS-07 (`_docs/docs/obsidian-i18n.md`). Keine Muttersprachen-Literale in der UI; Marken-/Steuer-Strings (`Image → Markdown`, `Stop`) bleiben literal.

## Gotchas

- **pdf.js-Worker-Bundling:** `pdfjs-dist` ist auf **4.10.38** gepinnt. v5/v6 externalisieren den
  WASM-Kern und brechen das Single-File-Bundle (Blob-URL-Strategie funktioniert dann nicht mehr).
  Vor einem Upgrade die Worker-Blob-Strategie re-validieren. Der Worker wird via
  `scripts/build-pdf-worker.mjs` (separater esbuild-Lauf, vor dem Haupt-Build) gebündelt und als
  eingebetteter String in `pdf-worker-src.generated.ts` gespeichert — diese Datei wird im Haupt-Build
  mitgebundelt. `pdfjs-dist` ist eine **runtime-`dependency`** (nicht `devDependency`): `src/pdf_render.ts` importiert `pdfjs-dist/legacy/build/pdf.mjs`, sodass sowohl das pdf.js-Hauptmodul als auch der Worker in `main.js` gebündelt werden — das ist der Hauptgrund für das größere Bundle (~2,2 MB).
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
- **Release-CI ist GitHub-only:** `.github/workflows/release.yml` läuft auf dem **GitHub-Mirror**
  (Codeberg/Forgejo ignoriert `.github/`). SemVer-Tag pushen → Mirror trägt ihn zu GitHub → Pipeline
  baut + attestiert (`actions/attest-build-provenance`) + legt das GitHub-Release an. Das **Codeberg**-Release
  (kanonisch) bleibt manuell via Forgejo-API (siehe Memory `codeberg-release-gotcha`).

## Memory

- **Projekt-Memory:** verwandtes Wissen im vault-rag-Memory
  (`~/.claude/projects/-Users-Shared-code-vault-rag/memory/`), insbesondere die Ausgliederungs-Spec/-Plan
  unter vault-rag `docs/superpowers/`.

## Abweichungen von der Leitkonvention

Stand 2026-06-23 — **Release 0.3.0**. Verbleibende bewusste, begründete Abweichungen (comply-or-explain):

- **CORE-META-07** — `LICENSE` (AGPL-3.0) + `LICENSE-DOCS` (CC BY-SA 4.0) vorhanden; separate `LICENSING.md`/`CLA.md` (Dual-License-Option) noch nicht. *Grund:* rechtliche Entscheidung, bei Bedarf — CONTRIBUTING nennt „commercial dual-license on request".
- **PROF-OBS-06** — Settings-Tab nutzt noch `display()` (deklarative `getSettingDefinitions`-API ist 1.13-Enhancement). *Grund:* Recommendation, kein Blocker; eigener Zyklus.
- **PROF-TS-04** — kein `tsconfig.build.json`-Split (ein `tsconfig.json` + `vitest.config.ts` reicht). *Grund:* klein genug.

Erfüllt seit der Doku-/Release-Readiness-Session (2026-06-21): CORE-META-04 (Diátaxis-Manual `docs/manual/`), CORE-META-06 (`CONTRIBUTING.md`/`SECURITY.md`), CORE-META-09 (`README.de.md`), PROF-OBS-02 (`npm run deploy`), PROF-OBS-07 (UI-Lokalisierung EN/DE). Codeberg-`origin` + GitHub-Push-Mirror aktiv (CORE-GIT-01).

Erfüllt mit 0.3.0 (2026-06-23): CORE-META-02/03 (Badge-Zeile/Hero + Feature-Screenshots) — README mit Badge 1.8.7, Aufnahme-Vertrag (Screenshots) auf aktuellen Stand (PDF-/Idempotenz-Shots, EN-UI, Slider).

## Dach-Kontext (obsidian-plugins)

Dieses Repo liegt unter dem Koordinations-Dach `/Users/Shared/code/obsidian-plugins/`.
**Vor dem Lösen eines Problems:** `../AGENTS.md` (Kit-first-Regel) und `../REGISTRY.md`
(Lösungs-Registry) prüfen — viele Probleme sind in Nachbar-Plugins oder im
`obsidian-kit` bereits gelöst.
