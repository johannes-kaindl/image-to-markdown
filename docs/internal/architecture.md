# Aufbau von image-to-markdown

Modul-Layout und Datenfluss. Der Kern (`AGENTS.md`) nennt nur die Trennlinie; hier steht, was in welcher Datei liegt. Wissen zur LLM-Anbindung steht in `.claude/rules/llm-verbindung.md`, zum Vendoring in `.claude/rules/vendor-kit.md`, zu pdf.js in `.claude/rules/pdf.md`.

## Trennlinie: reiner Kern und Obsidian-Schicht

Reiner Kern ohne obsidian-Imports (`img_to_md.ts`, `img_to_md_state.ts`, `vision_client.ts`, `llm_call.ts`, `capabilities.ts`, `i18n.ts`, `pdf_to_md.ts`, `backlinks.ts`, `refine.ts`, `describe.ts`, `prompts.ts`, `request_params.ts`, `card_cache.ts`, `frontmatter_map.ts`, `fm_migration.ts`, `ocr_provider.ts`, `resolve_endpoint.ts`, `vendor/kit/*`) → in Node testbar ohne DOM-Mock (PROF-OBS-03/04). Nur `main.ts`, `settings.ts`, `img_to_md_view.ts`, `http.ts`, `diff_modal.ts`, `migration_modal.ts` und die vendorte Schicht `vendor/kit-obsidian/*` importieren `obsidian`; `pdf_render.ts` nutzt DOM/Canvas. Die View bekommt alle Abhängigkeiten über injizierte Closures (`ImgToMdViewDeps`) → headless testbar.

## Module in `src/`

```
img_to_md.ts        reiner Kern: findImageEmbeds · buildTranscriptNote · replaceEmbed ·
                    writeTranscripts (batched, read-once/write-once) · runImgToMd · ImgToMdIO.
                    Etappe-3-Helfer: classifySource (Dateiext → image/pdf/null) ·
                    buildSelfSourceItem (erzeugt das einzelne ImgItem wenn die aktive Datei
                    selbst die Quelle ist); ImgItem hat dafür ein neues Feld selfSource: true.
img_to_md_state.ts  ImgToMdState — Bild-Auswahl + Ergebnis-Karten (kein DOM/I/O).
                    `card.refine` ist `Rounds<RefineRound>` (code-kit `rounds`): rounds[0] = Original, jede Runde trägt
                    `basedOn`; `refineRequest` schickt nur die Kette vom aktiven Stand zurück, nicht alle Runden.
img_to_md_view.ts   ImgToMdView (ItemView, Sidebar) — Modell-Picker, Bild-Liste, streamende Karten,
                    PDF-Seitenbereichs-Auswahl. Idempotenz-Anzeige je Liste-Zeile: bei vorhandenem
                    Transkript „✓ transcript exists" + „open"-Link (springt zur Notiz), Zeilen-Titel
                    „re-transcribing overwrites it" — erneut transkribieren überschreibt (kein Block).
                    `rescan()` trägt eine Folgenummer: eine überholte Antwort verändert die Liste nicht,
                    `refresh()` bricht dann ab (B3-Rennfall, 2026-10-23).
pdf_render.ts       Obsidian/DOM-Schicht für pdf.js: `pdfPageCount`, `renderPdfPage` (Seite auf
                    OffscreenCanvas/Canvas → PNG-Data-URL), `extractPdfPageText` (eingebetteter
                    Text-Layer einer Seite, "" ohne Layer). Importiert den gebündelten pdf.js-Worker
                    (Blob-URL aus pdf-worker-src.generated.ts). Enthält pdfSmokeTest (Dev-Util).
pdf_to_md.ts        Reiner Kern der PDF-Notiz: `reconstructPdfText` (Lauftext aus pdf.js-Items),
                    `PDF_TEXTLAYER_MIN_CHARS`/`countNonWhitespace` (born-digital ab 200
                    Nicht-Whitespace-Zeichen im Text-Layer: dessen Text wird formatiert, darunter fällt die
                    Seite auf das Vision-Modell zurück), `buildPdfBody`/`buildPdfNote` und
                    `writePdfTranscript` (eine Transkript-Notiz pro PDF, ersetzt den PDF-Embed).
                    Die Seiten rendert und streamt `main.ts` (`renderPdfPage`, `extractPdfPageText`).
                    Obsidian-frei, vollständig unit-testbar.
backlinks.ts        Reiner Kern: Backlink-Idempotenz-Lookup — `findExistingTranscript` (prüft
                    `resolvedLinks` + `frontmatterLinks` mit `source_pdf`/`source_image`-Filter;
                    der Frontmatter-Filter ist load-bearing: Body-Embeds allein reichen nicht).
                    Interface `BacklinkLookup` (von der Obsidian-Schicht injiziert, obsidian-frei
                    testbar). Aufgerufen von `main.ts` (Scan).
vision_client.ts    Schmale Hilfsklasse `VisionClient(endpoint, apiKey?)` NUR für die passive Fähigkeits-Anzeige
                    der Settings (`visionConfidence`, über HttpFetch/setHttp). Chat, Ping, Modellliste, Transport
                    und Fristen sind seit Welle 15 (Verbindungs-Tausch) die Kit-Verbindung `createLlmConnection`
                    (`plugin.llm`). Der Schlüssel kommt aus `(await llm.resolve()).config`, nicht aus den Settings:
                    er liegt im Obsidian-Schlüsselbund. Reiner Kern, obsidian-frei.
llm_call.ts         `chatOutOrThrow(LlmResult)`: übersetzt das Ergebnis der Verbindung in `ChatOut`
                    {content, reasoning, model, finishReason?} oder wirft den Fehler mit dem nutzersichtbaren Satz
                    (`t("chat.err.*")`, `error.noEndpoint`; Abbruch bleibt ein `AbortError`). Reiner Kern.
http.ts             Obsidian-Schicht: requestUrl-Adapter (obsidianHttp) → via setHttp in den Kern injiziert (nur noch
                    für die Fähigkeits-Probe der Settings).
capabilities.ts     Adapter über das vendored Kit-Modul (Vision-Achse projiziert): asJsonFetch
                    (übersetzt HttpFetch → CapabilityFetch) · fetchVisionCapability · resolveVision ·
                    visionDisplay · aktiver Vision-Test (VISION_TEST_TOKEN/VISION_TEST_PROMPT/
                    isVisionConfirmed). Reiner Kern, DOM-frei.
ocr_provider.ts     Anbieter-API v1 `extractText` (Muster lingotuner): dünner Adapter über `deps.extractText`
                    (Kurzbefehl mobil, Vision-LLM desktop) plus `shortcutResultToOcr`. Der Vertrag selbst kommt
                    aus dem Kit (`vendor/kit/ocr-provider.ts`). Reiner Kern.
resolve_endpoint.ts Konstanten rund um die Endpunkt-Quelle (`ENDPOINT_CALLER`); die Auflösung macht die
                    Kit-Verbindung.
diff_modal.ts       DiffModal (Modal): Zeilen-Diff alt↔neu mit Checkbox pro Hunk (Default: alle an),
                    liefert den gemergten Body zurück. Obsidian-abhängig.
refine.ts           Reiner Kern: buildRefineMessages — Multi-Turn-Chat-Messages für die iterative
                    Nachbesserung (Original + Feedback-Verlauf + neues Feedback).
describe.ts         Beschreiben-Modus: buildDescribePrompt (festes CATEGORY/TAGS/---/Prosa-Format,
                    Taxonomie-Auswahl) + Parsing nach ParsedDescription. Reiner Kern.
prompts.ts          Prompt-Presets (default/tables/handwriting/math/code): PROMPT_PRESETS ·
                    isPromptPreset · normalizePreset · Preset-Auflösung. Reiner Kern.
request_params.ts   `MODE` (Sampling-Modus `transform`) · `REQUEST_MIGRATIONS` (die Migration des Altfelds
                    `suppressThinking`: true → Stufe „aus“, false → Ein-Stufe; geladen wird mit `loadRequestSettings` aus dem
                    Kit, `sampling-profiles`). Den Request baut die Kit-Verbindung (kein `maxTokens`: i2m hat kein Budget). Reiner Kern.
card_cache.ts       CardCache: In-Session-Cache der Sidebar-Ergebnis-Karten pro Quelldatei
                    (Plugin-Ebene, überlebt View-Close; kein Disk-Persist). Reiner Kern.
frontmatter_map.ts  FrontmatterMap: konfigurierbare Frontmatter-Keys + Diskriminator-Werte aller
                    i2m-Notizen (Setup-Zeit-Entscheidung). Reiner Kern. Seit 0.23.0 auch
                    `truncated` (Default `truncated`) — geschrieben NUR bei `true`: Abwesenheit
                    heisst „vollstaendig ODER unbekannt", weil Alt-Notizen den Key nicht kennen.
                    `rewriteTranscript` kennt dafuer drei Zustaende (true setzt, false entfernt,
                    undefined laesst in Ruhe); writeTranscripts normalisiert beim Override auf
                    `=== true`, weil `card.truncated` nie `false` ist, sondern `undefined`.
fm_migration.ts     Frontmatter-Mapping-Migration: diffMappings + Migrationsplan
                    (MigrationPlan/NotePlan) über bestehende i2m-Notizen. Reiner Kern.
migration_modal.ts  MigrationModal (Modal): Vorschau der Frontmatter-Migration (read-only
                    Frontmatter-Diff, migrate/apply/cancel). Obsidian-abhängig.
i18n.ts             reiner Kern: UI-Lokalisierung EN/DE — STRINGS{en,de} · t() (Fallback lang→en→key,
                    {0}-Interpolation) · pickLang · setLang/getLang · defaultVisionPrompt. EN kanonisch.
settings.ts         ImageToMarkdownSettings (enthält `visionEndpoints: EndpointConfig[]` — je Eintrag
                    URL + `id`/`secretId`; der Schlüssel liegt im Schlüsselbund) · migrateEndpoints (überführt beide Alt-Stände aus
                    data.json — Einzelfeld `visionEndpoint` und String-Liste — via Kit-`migrateEndpointList`
                    auf Configs) · applyListEdit (String-Listen, Basis für applyTaxonomyEdit; Endpunkte
                    nutzen das Kit-`applyEndpointEdit` mit Feld-Diskriminator) · defaultSettings()
                    (Prompt sprachabhängig) · SettingTab: Endpunkt-Quelle, lokale Liste und Abschnitt „Anfrage“
                    zeichnet `llm.renderSettings(host, { lang })` in EINEM Host (Hatch `renderConnection`),
                    `hide()` ruft `llm.hideSettings()` · Modell (Dropdown aus `llm.models`) + „Vision-Fähigkeit"
                    (visionConfidence + aktiver „Vision testen" über `plugin.testVision`) · Prompt (große Textarea) ·
                    PDF-Einstellungen (pdfMaxPages, pdfRenderScale, pdfPageSeparator) ·
                    makeVisionTestImage (Canvas, DOM-Schicht).
main.ts             Plugin-Entry: setHttp(obsidianHttp) + Sprach-Detektion (setLang) beim onload,
                    View/Ribbon/Command/Kontextmenü/SettingTab. Hält `llm` (= `createLlmConnection`, Fähigkeit
                    `vision`, Modus `transform`, `levelPicker: true`; `persist` bildet endpoints→visionEndpoints,
                    model→aktive Zeile synchron ab, `llm.setModel`) + `callLlm` (ein Aufruf mit `messages`, optional EIN Retry nach
                    `invalidate()`, nie nach Abbruch oder bereits gestreamtem Text) + `testVision` + `reconnect`.
pdf-worker-src.generated.ts  Auto-generiert von scripts/build-pdf-worker.mjs — enthält den
                    gebündelten pdf.js-Worker als eingebetteten String (Blob-URL-Quelle). Nicht
                    manuell editieren; wird bei `npm run build` neu erzeugt.
```

## Vendorte Kit-Schicht

Geteilter Code ist vendored, nicht als Package geteilt: die mit den Schwester-Plugins gemeinsamen Teile liegen als Kopien aus `obsidian-kit` unter `src/vendor/kit/` (obsidian-frei, aus `obsidian-kit/src/pure/` und `code-kit`) und `src/vendor/kit-obsidian/` (obsidian-abhängig, aus `obsidian-kit/src/obsidian/`). Die Pins stehen in `tools/kit-sync.json`, gespiegelt in den beiden `VENDOR.json` (mit der Liste der Dateien je Quelle); die Herkunft steht zusätzlich im Kopf jeder Datei; die Regeln zum Erneuern in `.claude/rules/vendor-kit.md`.

Was in diesem Repo davon benutzt wird (ohne Anspruch auf Vollständigkeit, die `VENDOR.json` ist maßgeblich):

```
vendor/kit/
  endpoint.ts       normalizeEndpoint + Endpoint-Fallback-Auflösung.
  reasoning.ts      Reasoning-Unterdrückung (suppressParams) + isAlwaysOnThinker.
  settings.ts       mergeSettings (Defaults-Merge mit Referenz-Schutz).
  sse.ts            parseSSE (OpenAI-SSE-Delta-Parser, content + reasoning_content).
  think-splitter.ts ThinkSplitter (inline <think>-Tags; früher src/think_splitter.ts, bis Welle 11 lokal als think.ts — chat-client importiert den Kit-Namen).
  endpoint_config.ts EndpointConfig (url + optionaler apiKey/model) · authHeaders · migrateEndpointList ·
                    applyEndpointEdit (Feld-Diskriminator) · resolveActiveEndpointConfig.
  capabilities.ts   guessFromName (Namens-Heuristik Vision+Thinking) · parse* (Ollama/LM Studio
                    v0/v1) · mergeCapability/resolveCapabilities · fetchCapabilities, Typ
                    CapabilityFetch.
  diff.ts           Reiner Zeilen-Diff (LCS): diffLines · groupHunks · applySelection. Stammt aus
                    code-kit; bis 0.27.0 lokal als src/diff.ts (von hier ins Kit gewandert).
  error_body.ts     errorMessageFromBody/errorMessageFromText — Fehlermeldung aus einem
                    JSON-Fehlerkörper. Konsument ist der Kit-Chat-Client.
  clipboard.ts      writeClipboard (obsidian-frei) — Abhängigkeit von kit-obsidian/clipboard.ts.
  ocr-provider.ts   Vertrag der Anbieter-API `extractText`.
vendor/kit-obsidian/
  llm-connection.ts createLlmConnection (Welle 15): die ganze LLM-Anbindung (Quelle, gemerkte Auflösung, Modellliste, Profil, Client, Schwärzung, Antwortprüfung, Settings-Abschnitte); zieht backend-probe, endpoint-secrets, secrets, llm-connection-strings mit. Alle Module stehen auf EINER Ref (kit-sync.json).
  chat-client.ts    createChatClient: Streaming, Idle-/Erst-Chunk-Frist, Abbruch, Fehlerkörper, Fallback ohne Stream. Obsidian-frei (Transport injiziert) — von der Verbindung genutzt.
  chat-transport.ts xhrSseTransport (Stream) + requestUrlTransport (Fallback ohne Stream). Importiert `obsidian`; die Verbindung wählt sie selbst (`transportFor`).
  clock.ts          Uhr-Port für chat-client (Tests injizieren eine Fake-Uhr).
  request-section.ts / request-session.ts / thinking-control.ts / collapsible.ts  Sampling-Plan-Bausteine (Abschnitt „Anfrage“, Sitzung, Denk-Knopf der Sidebar); CSS verbatim in `styles.css`.
  clipboard.ts      copyToClipboard: Zwischenablage mit Notice-Quittung. Genutzt von main.ts (copyText in ImgToMdViewDeps).
  folder-suggest.ts FolderSuggest (Ordner-Autovervollständigung in Settings-Feldern).
  settings_walker.ts Deklarative Settings-Zeilen (Settings-Tab).
```

## Build

`scripts/build-pdf-worker.mjs` bündelt `pdfjs-dist/build/pdf.worker.mjs` via esbuild zu einem Single-File-Bundle, das als Template-Literal in `pdf-worker-src.generated.ts` eingebettet wird (separater esbuild-Lauf vor dem Haupt-Build, die Datei wird im Haupt-Build mitgebundelt). Zur Laufzeit erzeugt `pdf_render.ts` daraus eine Blob-URL — kein CDN, kein Netz, kein Import-Assertion-Trick. `pdfjs-dist` ist eine runtime-`dependency` (nicht `devDependency`): `src/pdf_render.ts` importiert `pdfjs-dist/legacy/build/pdf.mjs`, sodass Hauptmodul und Worker in `main.js` gebündelt werden — der Hauptgrund für das größere Bundle (~2,2 MB).
