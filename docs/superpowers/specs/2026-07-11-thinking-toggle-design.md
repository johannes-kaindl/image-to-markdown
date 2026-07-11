# Thinking-Toggle (Minimal)

Tier-2 #8 der Feature-Roadmap. Portierung des vault-rag-Sidebar-Toggles, mit dem sich Reasoning/Thinking bei Hybrid-Reasoning-Modellen per Klick abschalten lässt — für den Fall, dass Thinking bei großen Modellen „ewig" dauert und man es gerade nicht braucht.

## Kontext

Das Plugin zeigt Reasoning bereits an: der `onReasoning`-Callback speist einen `<details>`-Block je Karte (brain-Icon, „thinking"/„thoughts"-Label, Auto-Collapse beim Streaming-Ende). Was fehlt, ist die **Sende-Seite** — die Möglichkeit, das Modell anzuweisen, gar nicht erst zu denken.

Die dafür nötigen Primitiven liegen bereits pur und getestet im obsidian-kit (`0.7.0`, `src/pure/reasoning.ts`): `suppressParams`, `isAlwaysOnThinker`, `reasoningHappened`, Typ `ThinkingSupport`. image-to-markdown vendored schon mehrere Kit-Module unter `src/vendor/kit/` — dieses Feature fügt `reasoning.ts` demselben Muster hinzu.

`suppressParams(suppress)` liefert die provider-übergreifenden Unterdrück-Params:

```ts
export function suppressParams(suppress: boolean): Record<string, unknown> {
  if (!suppress) return {};
  return {
    reasoning_effort: "none",
    chat_template_kwargs: { enable_thinking: false },
    reasoning_budget: 0,
  };
}
```

`reasoning_effort` ist bewusst der String `"none"` (nie Boolean, nie `"minimal"` — Ollama lehnt beides ab). `isAlwaysOnThinker(model)` matcht `gpt-oss`/`harmony` als Wort-Grenzen-Token (case-insensitiv) — diese Modelle lassen sich nicht abschalten.

## Scope-Entscheidung

Bewusst **Minimal-Toggle**, kein Capability-Erkennungs-Subsystem. Der vault-rag-Toggle selbst prüft ebenfalls nur `isAlwaysOnThinker`; die volle `guessThinking`-Erkennung (ALWAYS/HYBRID-Namenslisten, Metadaten-Probing) treibt in vault-rag eine **separate** Capability-Anzeige + einen „Testen"-Button, **nicht** die Toggle-Sichtbarkeit. Die Suppress-Params sind auf Nicht-Thinking-Modellen ohnehin harmlose No-ops, d.h. der Toggle funktioniert ohne Erkennung korrekt.

Die Capability-Erkennung ist ein legitimer Kit-Kandidat (image-to-markdown wäre das 2. Exemplar nach vault-rag), aber sie ist dort untrennbar mit der Vision-Erkennung verwoben. Sauber wiederverwendbar heißt: ein **generisches Capability-Modul (Vision + Thinking) ins Kit heben** und beide Repos migrieren — ein eigenständiges Infrastruktur-Vorhaben. Siehe [Follow-up](#follow-up--kit-capability-extraktion-eigener-zyklus).

## Verhalten (UX)

Ein `<button>` in der bestehenden **Model-Row** der Sidebar (neben Modell-Select · Preset-Select · Status-Icon · Refresh), mit `brain`-Icon (konsistent mit dem Reasoning-Block der Karten) + Label-Span. Drei Zustände, bestimmt aus `isAlwaysOnThinker(getModel())` und `getSuppress()`:

| Zustand | Label EN (kanonisch) | Label DE | CSS-Klasse | klickbar |
|---|---|---|---|---|
| Thinking aktiv | `Thinking: on` | `Thinking: an` | – | ✓ → schaltet aus |
| Thinking unterdrückt | `Thinking: off` | `Thinking: aus` | `is-off` | ✓ → schaltet an |
| Modell immer-an | `Thinking: always on` | `Thinking: immer an` | `is-disabled` | ✗ (Klick ist No-op) |

- Der Klick-Handler bricht bei `isAlwaysOnThinker(getModel())` früh ab (kein Flip), sonst flippt er `setSuppress(!getSuppress())` und re-rendert den Button.
- Der `change`-Handler des Modell-Selects ruft zusätzlich `renderThinkToggle()` → der immer-an-Zustand wird bei **jedem Modellwechsel** neu evaluiert.
- `aria-label` spiegelt den Zustand (redundante Kodierung Text + Icon-Zustand, nicht Farbe allein — konsistent mit der WCAG-1.4.1-Linie der übrigen Status-Elemente).
- Der Button wird **immer** gezeigt (auch bei Nicht-Thinking-Modellen) — kein Ausblenden, da keine Capability-Erkennung.

## Architektur

### Kit-Primitive vendoren

Byte-identische Kopie von `obsidian-kit@0.7.0 src/pure/reasoning.ts` → `src/vendor/kit/reasoning.ts`, mit Header-Kommentar im Stil der übrigen Vendor-Dateien (Herkunft + Tag). Genutzt werden `suppressParams` und `isAlwaysOnThinker`; `reasoningHappened`/`ThinkingSupport` kommen mit (ungenutzt, aber die verbatim-Kopie bleibt kopie-treu für spätere Kit-Sync).

### Suppress-Flag → Request-Body

Gewählter Ansatz **A** (per-Call-Parameter, exakt das vault-rag-Muster): Die drei `VisionClient`-Methoden erhalten einen optionalen Parameter `opts?: { suppressThinking?: boolean }`; im JSON-Body wird `...suppressParams(opts?.suppressThinking ?? false)` gespreadet.

Betroffene Methoden in `src/vision_client.ts`:
- `transcribe(dataUrl, prompt, opts?)` — non-streaming (Kontextmenü-/Command-Pfad via `makeImgIO.transcribe`, plus `testVision`).
- `transcribeStream(dataUrl, prompt, onContent, onReasoning, signal?, opts?)` — Bild-Streaming.
- `transcribeTextStream(text, prompt, onContent, onReasoning, signal?, opts?)` — PDF-Text-Layer-Streaming.

Der `VisionClient` bleibt **zustandslos** bzgl. Thinking — der Toggle rekonstruiert den Client nicht (der wird ohnehin nur bei Modell-/Endpoint-Wechsel neu gebaut). Verworfene Alternativen: mutierbares `suppress`-Feld am Client (führt Zustand ein, muss bei Client-Rekonstruktion re-appliziert werden) und Konstruktor-Argument (erzwingt Rekonstruktion bei jedem Toggle).

`testVision` ruft `transcribe` ohne `opts` (Vision-Test ist thinking-neutral) — kein Verhaltenswechsel.

### Verdrahtung in `main.ts`

An allen Transkriptions-Call-Sites wird `{ suppressThinking: this.settings.suppressThinking }` mitgegeben:
- `makeImgIO().transcribe` → `this.visionClient.transcribe(dataUrl, prompt, { suppressThinking: … })`.
- `makeImgViewDeps().transcribeStream` → beide Aufrufe (Erst-Versuch **und** Retry-Wrapper nach `resolveAndReconnect`) für Bild- und Text-Layer-Pfad.

Zwei neue View-Deps auf `ImgToMdViewDeps`:
```ts
getSuppress: () => boolean;   // this.settings.suppressThinking
setSuppress: (v: boolean) => void;   // setzt + saveSettings()
```

### Persistenz (Settings)

Neues Feld in `ImageToMarkdownSettings`:
```ts
suppressThinking: boolean;   // Default: false (= Thinking an)
```
`defaultSettings()` setzt `false`. Das bestehende `mergeSettings(defaultSettings(), saved)` in `onload` versorgt Alt-`data.json` ohne den Key automatisch mit dem Default (kein eigener Migrations-Helfer nötig).

- **Sticky global**, konsistent mit Modell-Picker und Preset-Picker (der Button *ist* das persistente Control).
- **Default `false`** (Thinking an) — passt zur Motivation „bei Bedarf abschalten" und zu vault-rags Default.
- **Kein Settings-Tab-Eintrag** in v1 (YAGNI — der vault-rag-Settings-Toggle + „Testen" gehören zur nicht portierten Capability-Schicht).

### i18n

Neue Keys in `src/i18n.ts` (EN kanonisch, DE gespiegelt), Parität per bestehendem EN/DE-Paritätstest:
- `view.thinkingOn` → `Thinking: on` / `Thinking: an`
- `view.thinkingOff` → `Thinking: off` / `Thinking: aus`
- `view.thinkingAlways` → `Thinking: always on` / `Thinking: immer an`

Das `aria-label` verwendet denselben Zustands-String wie das sichtbare Label (kein separater Key) — der Text trägt die Bedeutung bereits vollständig.

### Styling

Neue CSS-Hooks in `styles.css` für `.img2md-think-toggle` (+ `.is-off`, `.is-disabled`) — nur Theme-CSS-Variablen (UI-STANDARD: Obsidian-nativ, keine Farb-Literale, `clickable-icon`-Basisklasse wie die übrigen Row-Buttons). `is-disabled` visuell gedämpft + `cursor` neutral.

## Tests

- **`tests/vendor/kit/reasoning`** (neu): `suppressParams(true)` liefert exakt die drei Params, `suppressParams(false)` liefert `{}`; `isAlwaysOnThinker` — `gpt-oss`/`harmony` (auch mit Umgebungs-Tokens) → true, `qwen3`/`llava`/`""` → false. Kopie-Treue analog zu den übrigen Vendor-Tests.
- **`VisionClient`-Body-Merge** (Erweiterung `tests/vision_client*`): über den injizierten Mock-Transport für alle drei Methoden — `suppressThinking:true` → Body enthält `reasoning_effort:"none"`, `chat_template_kwargs.enable_thinking:false`, `reasoning_budget:0`; `false`/undefined → Body unverändert (keine der Keys). Der Mock-Transport-Ansatz existiert bereits (SSE-/Error-Envelope-Tests).
- **View-/main-Glue** (Toggle-Klick, `renderThinkToggle`-Zustandslogik, Settings-Persistenz) bleibt ungetesteter Glue — konsistent mit allen bisherigen View-Wirings (Modell/Endpoint/Preset). **Geräte-Abnahme** ist der Backstop.

## Bewusst außerhalb Scope

- Capability-Erkennung (`guessThinking`, ALWAYS/HYBRID-Namenslisten, Metadaten-Probing), Toggle-Ausblenden für Nicht-Thinker.
- „Testen"-Button (probt via `reasoningHappened`, ob das Modell wirklich aufgehört hat zu denken).
- Settings-Tab-Eintrag / globaler Default-Schalter.
- Per-Preset- oder per-Karte-Granularität des Toggles (ein globaler Zustand).
- Änderungen an der Reasoning-**Anzeige** (existiert bereits, bleibt unberührt).

## Follow-up — Kit-Capability-Extraktion (eigener Zyklus)

Als **eigener** brainstorm→spec→plan→SDD-Zyklus (nach diesem Release): ein generisches Capability-Modul (Vision + Thinking, `Confidence`-Merge, Metadaten-Parser) ins obsidian-kit extrahieren, dann image-to-markdowns bestehende Vision-`capabilities.ts` **und** vault-rags `capabilities.ts` darauf migrieren. Grund für die Trennung: der Thinking-Toggle braucht die Erkennung nicht (läuft mit dem schon geteilten Kit-`reasoning.ts`), und eine saubere Kit-Extraktion mit-migriert die bereits vorhandene Vision-Erkennung statt einen halben Thinking-Fetzen daneben zu bauen. Dieses Feature setzt das 2. Exemplar, das die Extraktion rechtfertigt.
