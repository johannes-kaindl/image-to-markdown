# Design: UI-Lokalisierung EN/DE (i18n) + Workspace-Standard

- **Datum:** 2026-06-21
- **Status:** Design (freigegeben)
- **Repos:** `image-to-markdown` (Referenz-Implementierung) + `_docs` (Standard-Codifizierung)
- **Vorbild:** `obsidian-letterhead` (handgeschriebenes `t()`/`STRINGS`-Muster)

## Problem

Alle ~35 nutzersichtbaren Strings des Plugins sind hartkodiertes Deutsch. Das Plugin
soll **EN/DE nach Obsidian-Sprach-Einstellung** sprechen (wie `obsidian-letterhead`).
Zusätzlich soll das Muster als **wiederverwendbarer Standard in `_docs`** verankert werden,
damit künftige Obsidian-Plugins es konsistent übernehmen.

## Ziele / Nicht-Ziele

**Ziele**
- Nutzersichtbare Plugin-Texte (Settings, Buttons, Notices, View, Kern-Meldungen) EN/DE
  automatisch nach `getLanguage()`.
- Mitgelieferter **Default-Vision-Prompt** EN/DE (frische Installs sprachrichtig).
- **EN kanonisch** + dreistufiger Fallback (`currentLang → en → key`).
- Reiner Kern (`img_to_md.ts`, `capabilities.ts`, `img_to_md_state.ts`) bleibt **obsidian-/DOM-frei**
  und in Node testbar (PROF-OBS-03/04 gewahrt).
- Standard als **`PROF-OBS-07`** + Detail-Datei `_docs/docs/obsidian-i18n.md`; image-to-markdown
  als Referenz-Implementierung; Audit (`scorecard`/`adjudication`) nachgezogen.
- 105 Tests bleiben grün, `tsc --noEmit` clean.

**Nicht-Ziele (YAGNI)**
- Keine externe i18n-Library (i18next o. ä.) — Overhead für 2 Sprachen/~35 Strings.
- Keine Runtime-Sprachumschaltung ohne Reload (wie letterhead: `currentLang` einmalig beim Load).
- Keine zweite manuelle „Inhaltssprache"-Achse (Prompt ist user-editierbar).
- Keine Lokalisierung von Marken-/Steuer-Strings, die EN==DE sind (`Image → Markdown`,
  `IMG → MD`, `Stop`) und keiner der generierten **Transkript-Frontmatter-Keys**
  (`source_image`, `created`, `transcribed_by` …) — die sind Daten, kein Chrome.
- `VISION_TEST_PROMPT` bleibt **eine** kanonische Sprache (EN) — interne Vision-Probe,
  nicht nutzersichtbar.

## Architektur (Ansatz A: pures i18n-Modul mit modul-lokaler Sprache)

Neues, reines Modul `src/i18n.ts` ohne `obsidian`/DOM-Import. Sowohl Kern- als auch
Obsidian-Schicht importieren `t`. Die **Detektion** lebt in der Obsidian-Schicht (`main.ts`)
und setzt die Sprache einmalig beim `onload`.

```
src/i18n.ts            REIN (kein obsidian/DOM):
                       type Lang = 'en' | 'de'
                       currentLang: Lang = 'en'   (modul-lokal)
                       setLang(l) / getLang()
                       pickLang(raw?: string): Lang   — raw startet mit 'de' → 'de', sonst 'en' (rein, testbar)
                       STRINGS: Record<Lang, Record<string,string>>   — en + de
                       t(key, ...args): string   — Fallback currentLang→en→key, dann {0}/{1}-Interpolation
                       defaultVisionPrompt(): string  — t('prompt.default') zur Aufrufzeit

main.ts (onload)       setLang(pickLang(getLanguage()))  ALS ERSTES (vor View/Command/Settings).
                       Fallback: window.moment?.locale() wenn getLanguage() leer.
                       Settings-Default-Prompt zur Load-Zeit: defaultSettings() nutzt defaultVisionPrompt().
```

**Warum modul-lokaler State statt DI:** Der Kern injiziert bereits `io.notify`/Closures;
`t` zusätzlich durch jedes Interface zu fädeln wäre spürbarer Churn ohne Mehrwert.
`currentLang` ist reines TS (kein obsidian/DOM) → Node-Tests bleiben gültig (Default `en`,
oder `setLang('de')` im Test). Singleton-Modul → alle Importeure sehen denselben Wert.

**Interpolation:** Positions-Platzhalter `{0}`, `{1}` … werden aus `...args` ersetzt.
Beispiel: `t('core.transcribing', i + 1, total)` mit `"Transcribing image {0}/{1}…"`.

**Plural** (`Bild(er)`): zwei Keys `core.transcribed.one` / `core.transcribed.other`,
Auswahl per `count === 1`. Kein Plural-Framework.

**Laufzeit-Sprachwechsel-Caveat:** Ribbon/Command-Namen werden beim `onload` einmal gesetzt;
ein Wechsel der Obsidian-Sprache greift erst nach Plugin-Reload. Dokumentiert (wie letterhead).

## Key-Map (vollständig)

Gruppierte Keys, eine `STRINGS`-Tabelle. DE-Werte = aktueller Text; EN-Werte neu.

| Key | Datei (Quelle) | DE (heute) |
|---|---|---|
| `cmd.openSidebar` | main.ts:24 | Sidebar öffnen |
| `cmd.transcribeActive` | main.ts:25 | Bilder der aktiven Notiz transkribieren |
| `notice.noActiveNote` | main.ts:27 | Keine aktive Notiz. |
| `notice.copied` | main.ts:101 | Kopiert |
| `settings.heading` | settings.ts:64 | Vision (Image → Markdown) |
| `settings.endpoint.name` | settings.ts:68 | Vision-Endpunkt |
| `settings.endpoint.desc` | settings.ts:69 | OpenAI-kompatibler Server mit Vision-Modell (z.B. LM Studio) |
| `settings.testConnection` | settings.ts:72 | Verbindung testen |
| `settings.connected` | settings.ts:61 | ● verbunden |
| `settings.offline` | settings.ts:61 | ○ offline |
| `settings.model.name` | settings.ts:82 | Vision-Modell |
| `settings.model.desc` | settings.ts:82 | Vision-fähiges Modell (Qwen2-VL, Llama-3.2-Vision …) |
| `settings.capability.name` | settings.ts:85 | Vision-Fähigkeit |
| `settings.testVision` | settings.ts:100 | Vision testen |
| `settings.endpointUnreachable` | settings.ts:107 | Endpoint nicht erreichbar |
| `settings.endpointOfflinePlaceholder` | settings.ts:124 | (Endpoint offline) |
| `settings.loadModels` | settings.ts:126 | Modelle laden |
| `settings.prompt.name` | settings.ts:133 | Vision-Prompt |
| `settings.prompt.desc` | settings.ts:134 | Anweisung an das Vision-Modell. Der Bild-Inhalt wird mitgeschickt. |
| `prompt.default` | settings.ts:12-14 | Transkribiere den Text … keine Kommentare. |
| `view.deselectAll` | view:42,91 | Alle abwählen |
| `view.selectAll` | view:91 | Alle auswählen |
| `view.transcribe` | view:44 | Transkribieren |
| `view.createAll` | view:49 | Alle anlegen |
| `view.checking` | view:57 | Vision-LLM: prüfe… |
| `view.connected` | view:59 | ● Vision-LLM verbunden |
| `view.offline` | view:59 | ○ Vision-LLM offline — in den Settings prüfen |
| `view.noImages` | view:92 | Keine Bilder in dieser Notiz. |
| `view.unsupportedSuffix` | view:100 | {0} — nicht unterstützt |
| `view.cardHead` | view:110 | Bild {0}/{1} · {2} |
| `view.thinking` | view:115 | 💭 denkt nach… |
| `view.thoughts` | view:115 | 💭 Gedanken |
| `view.error` | view:119 | Fehler |
| `view.created` | view:121 | ✓ angelegt: {0} |
| `view.copyTranscript` | view:126 | Transkript kopieren |
| `view.createNote` | view:130 | Notiz anlegen |
| `view.aborted` | view:168 | Abgebrochen |
| `core.noMatchingImages` | img_to_md.ts:118 | Keine (passenden) Bilder in dieser Notiz. |
| `core.imageNotFound` | img_to_md.ts:124, main.ts:88 | Bild nicht gefunden: {0} |
| `core.unsupportedFormat` | img_to_md.ts:125 | Format .{0} nicht unterstützt (HEIC? iOS auf „Maximal kompatibel"): {1} |
| `core.transcribing` | img_to_md.ts:126 | Transkribiere Bild {0}/{1}… |
| `core.transcribeFailed` | img_to_md.ts:131 | Transkription fehlgeschlagen ({0}): {1} |
| `core.emptyTranscriptLink` | img_to_md.ts:132 | Leeres Transkript: {0} |
| `core.transcribed.one` | img_to_md.ts:136 | {0} Bild transkribiert |
| `core.transcribed.other` | img_to_md.ts:136 | {0} Bilder transkribiert |
| `core.skippedSuffix` | img_to_md.ts:136 | , {0} übersprungen |
| `core.emptyTranscript` | img_to_md_state.ts:66 | Leeres Transkript |
| `cap.confirmed` | capabilities.ts:87 | Vision |
| `cap.likely` | capabilities.ts:88 | Vision unbestätigt |
| `cap.none` | capabilities.ts:89 | Kein Vision |

Marken-/Steuer-Strings bleiben literal: `main.ts:23/43` `Image → Markdown`,
`view:32` `IMG → MD`, `view:148/169` `Stop`.

## Daten-/Sprachfluss

1. `onload` → `setLang(pickLang(getLanguage()))` (Fallback `moment.locale()`).
2. `defaultSettings()` baut `visionPrompt: defaultVisionPrompt()` → sprachrichtiger Default
   für frische Installs; gespeicherte Prompts (`loadData`) überschreiben ihn.
3. Alle Schichten rufen `t('key', …args)`; Kern bezieht `t` per purem Import.

## Tests

- **`tests/i18n.test.ts` (neu):** Fallback-Kette (`de`→`en`→`key`), Interpolation `{0}/{1}`,
  `pickLang('de-DE')==='de'` / `pickLang('en')==='en'` / `pickLang(undefined)==='en'`,
  `setLang`/`getLang`, `defaultVisionPrompt()` wechselt mit der Sprache.
- **Migration bestehender Assertions auf EN-kanonisch** (Test-Default-Sprache `en`):
  - `capabilities.test.ts:87-89` → EN-Texte (`Vision` / `Vision (unconfirmed)` / `No vision`).
  - `img_to_md_state.test.ts:58` `Leeres Transkript` → EN (`Empty transcript`).
  - `img_to_md_view.test.ts:42/44` `verbunden`/`offline` → `connected`/`offline`.
  - `img_to_md_view.test.ts:90` `Bild 1/1` → `Image 1/1`.
  - `img_to_md_view.test.ts:114` `Leeres Transkript` → `Empty transcript`.
  - `img_to_md_view.test.ts:140` `Abgebrochen` → `Aborted`.
- **`tests/__mocks__/obsidian.ts`:** `getLanguage()` ergänzen (Default `"en"`), damit
  ein evtl. künftiger main-Import nicht bricht. (Detektion selbst wird über `pickLang` rein getestet.)
- `core.*`-Notify-Assertions (falls vorhanden) gegen `t('key', …)` prüfen, nicht gegen Copy.

## `_docs`-Standard

- **`CONVENTIONS.md`** — neue Regel im PROF-OBS-Block:
  `**PROF-OBS-07** — UI-Lokalisierung: nutzersichtbare Plugin-Strings EN/DE nach `obsidian.getLanguage()`,
  EN kanonisch + dreistufiger `t()`-Fallback; Detektion in der obsidian-Schicht, Strings pur.
  Detail: docs/obsidian-i18n.md. _Quelle: obsidian-letterhead, image-to-markdown._`
- **`_docs/docs/obsidian-i18n.md`** (neu, spiegelt `obsidian-settings-layout.md`):
  Muster (`i18n.ts`-Modul, `pickLang`/Detektion, `t()`, `STRINGS`, EN-kanonisch, Fallback,
  Plural-Konvention, Interpolation, Reload-Caveat, Core-/Obsidian-Boundary, Testansatz),
  Referenz = image-to-markdown.
- **Audit nachziehen:** `audit/scorecard.md` (Regel-Zeile PROF-OBS-07; image-to-markdown = PASS),
  `audit/adjudication.md` (Rationale + Quelle). Ggf. `_docs/AGENTS.md` falls es Regeln listet.
- **image-to-markdown `AGENTS.md`:** Modul-Layout um `i18n.ts` ergänzen; `CORE-META-09`/PROF-OBS-07-Konformität.

## Sequencing

1. image-to-markdown implementieren (Referenz, TDD, grün + Build).
2. `_docs`-Standard codifizieren (Regel + Detail-Datei + Audit).
3. Build + Deploy nach Pallas.

Beides in dieser einen Spec; der Implementierungsplan phast es.

## Risiken / offene Punkte

- **Test-Default-Sprache:** Tests laufen mit `en`. Vor Migration kurz prüfen, ob ein Testfile
  `core.*`-Notify-Strings direkt assertet (img_to_md.test.ts) — dann auf `t()`/EN umstellen.
- **`DEFAULT_SETTINGS`-Timing:** Default-Prompt muss zur Load-Zeit (nach `setLang`) aufgelöst
  werden, nicht bei Modul-Init → `defaultSettings()`-Funktion statt const-Feld für `visionPrompt`.
- **Cross-Repo-Commit:** image-to-markdown und `_docs` sind getrennte Repos → getrennte Commits.
