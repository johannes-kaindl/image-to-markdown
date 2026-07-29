# Spec: Kit-Capability-Extraktion (Zyklus B)

**Datum:** 2026-07-30
**Status:** Design freigegeben (Brainstorming), Plan ausstehend
**Baut auf:** Thinking-Toggle 0.10.0 — `2026-07-11-thinking-toggle-design.md`, das die
Capability-Erkennung ausdrücklich ausklammerte und diesen Zyklus als Follow-up benannte.

## Problem & Motivation

Zwei Repos unter dem Dach halten heute eine eigene Capability-Erkennung für lokale
LLM-Endpoints:

| | Datei | Umfang |
|---|---|---|
| `image-to-markdown` | `src/capabilities.ts` (106 Z.) | vision-only, `Confidence`, `HttpFetch` injiziert |
| `vault-rag` | `src/capabilities.ts` (151 Z.) | vision **+** thinking, `mergeCapability` mit Live-Signalen, `httpJson` importiert |

Die i2m-Datei ist ein Fork der vault-rag-Datei; ihre **Namens-Heuristik-Listen sind
byte-gleich**. Das ist die Duplikation, die real driftet: eine neue Modellfamilie muss
an zwei Stellen eingetragen werden, und nur eine der beiden Seiten merkt es, wenn es
vergessen wird. Die drei Metadaten-Parser (Ollama `/api/show`, LM Studio `/api/v1/models`
und `/api/v0/models`) sind ebenfalls doppelt vorhanden, die Probier-Sequenz über diese
drei Endpoints ebenso.

Hinzu kommt ein Nutzer-sichtbarer Mangel: i2ms Thinking-Toggle erkennt Reasoning-Modelle
nur über `isAlwaysOnThinker` = `/\b(gpt-oss|harmony)\b/` — **zwei** Muster. Die
vault-rag-Heuristik kennt **zwölf** Always-on- und **zehn** Hybrid-Familien
(deepseek-r1, qwq, magistral, glm-z1, qwen3, …). i2m weiß also im Toggle deutlich
weniger über das Modell, als im Dach bereits bekannt ist.

**Ziel:** Die Capability-Erkennung einmal ins `obsidian-kit` heben (Vision + Thinking,
Parser, Merge, Fetch-Sequenz) und `image-to-markdown` darauf migrieren — mit dem
sichtbaren Nebeneffekt, dass der Thinking-Toggle ehrlicher beschriftet ist.

## Scope

**In Scope:**
- Neues Kit-Modul `src/pure/capabilities.ts` (Kit-Release **0.19.0**).
- i2m vendored das Modul und ersetzt seine Fork-Datei durch einen Adapter.
- i2ms `reasoning_toggle.ts` nutzt die Kit-Heuristik für einen **Hinweistext**.
- Pflege von `KIT-MATRIX.md` und `REGISTRY.md`.

**Nicht in Scope** (bewusst, kein Versehen):
- **Die vault-rag-Migration.** Sie folgt als eigener Schritt; nach der Extraktion ist
  sie nahezu eine Identitäts-Ersetzung.
- **Live-Signale in i2m.** `mergeCapability`s `live.thinking`/`live.vision` kommen mit
  dem vendorten Modul mit, i2m ruft sie nicht auf.
- **`visionDisplay`** — hängt an i2ms `t()`-Katalog und an Lucide-Icon-Namen; das ist eine
  UI-Entscheidung, kein Modell-Wissen.
- **Der aktive Vision-Test** (`VISION_TEST_TOKEN`, `VISION_TEST_PROMPT`,
  `isVisionConfirmed`) — pur und generisch, aber mit **n = 1** noch kein Kit-Kandidat.

## Entscheidungen aus dem Brainstorming

1. **i2m nutzt die Thinking-Erkennung wirklich** (nicht nur strukturell migrieren) —
   der Toggle wird ehrlicher.
2. **Eine Fehlerkennung darf nie sperren.** Bei lokalen Modellen sind selbstvergebene
   Namen und Fine-Tunes die Regel; ein falsches „kann nicht denken" würde einen
   gebrauchten Button totlegen. Die Erkennung ändert deshalb ausschließlich die
   Beschriftung.
3. **Modul-Zuschnitt: Verbatim-Lift** der vault-rag-Version statt eines Vision/Thinking-
   Splits. Die Server-Antworten tragen **beide Achsen in einer JSON**
   (Ollama: `capabilities: ["vision","thinking"]`); ein Modul-Split müsste dieselbe
   Antwort zweimal parsen oder die Achsen künstlich trennen, und `mergeCapability`
   koppelt sie ohnehin bewusst.
4. **`findById` bleibt doppelt** (5 Zeilen, auch in `pure/model-context.ts`). Vendoring
   ist im Kit datei-granular — ein gemeinsames Helfer-Modul zwänge jeden
   `model-context`-Konsumenten, ab sofort zwei Dateien zu vendoren. Selbst-enthaltene
   Module sind der teurere, aber richtige Tausch.

## Architektur

### Kit: `obsidian-kit/src/pure/capabilities.ts`

Verbatim aus `vault-rag/src/capabilities.ts` übernommen, mit genau zwei Änderungen:

**(a) `ThinkingSupport` kommt vom Nachbarn.** `import { ThinkingSupport } from "./reasoning"`
statt aus einem `vendor/kit/`-Pfad — im Kit ist `reasoning.ts` Geschwister, kein Vendor-Artefakt.

**(b) `fetchCapabilities` bekommt den Fetcher injiziert.** Das ist die einzige echte
API-Änderung und genau der Punkt, an dem die beiden Konsumenten heute auseinanderlaufen:
i2m reicht `{ok, status, text}` durch, vault-rag `{status, json}`. Das Kit lernt keine der
beiden Formen, sondern die schmalste gemeinsame — analog zum etablierten
`resolveActiveEndpoint(endpoints, ping)`:

```ts
export type CapabilityFetch = (req: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}) => Promise<{ json: unknown } | null>;      // null = nicht erreichbar / kein JSON

export async function fetchCapabilities(
  fetchJson: CapabilityFetch,
  baseUrl: string,
  model: string,
): Promise<Capabilities | null>;
```

Das Ergebnis ist bewusst `{ json: unknown } | null` und **nicht** `unknown | null`:
letzteres kollabiert in TypeScript zu `unknown` und könnte den Vertrag
„null = fehlgeschlagen" gar nicht ausdrücken. Der Wrapper macht den Fehlschlag prüfbar
(`if (!r) continue`).

Das Prüfen von `ok`/`status` und das Parsen des Textes bleiben damit im Plugin, wo das
HTTP-Wissen ohnehin sitzt — drei Zeilen je Seite. Das Kit behält sein `try`/`catch` **pro
Versuch**, damit ein werfender Adapter die Sequenz Ollama → LM Studio v1 → v0 nicht abbricht.

**Öffentliche Fläche** (unverändert gegenüber vault-rag): `Confidence`, `ThinkingState`,
`Capabilities`, `guessFromName`, `parseOllamaShow`, `parseLmStudioV1`, `parseLmStudioV0`,
`mergeCapability`, `resolveCapabilities`, `fetchCapabilities` — plus der neue Typ
`CapabilityFetch`. Dazu ein Re-Export in `src/pure/index.ts`.

**Versions-Korrektur:** `KIT_VERSION` in `src/pure/index.ts` steht auf `"0.17.1"`, obwohl
Tag und `package.json` bereits auf `0.18.0` sind — der 0.18.0-Release zog den
`package.json`-Lag ausdrücklich nach, übersah aber die Konstante, die laut Kit-`AGENTS.md`
Teil der Versions-Wahrheit ist. Der Bump auf `0.19.0` zieht das mit gerade.

### i2m: `src/capabilities.ts` wird zum Adapter

Neu: `src/vendor/kit/capabilities.ts` mit Herkunfts-Header
(`// vendored from obsidian-kit#0.19.0, src/pure/capabilities.ts`), wie die fünf
bestehenden Vendor-Module.

Die Datei **verliert** `guessVision`, `parseOllamaShow`, `parseLmStudioV1`,
`parseLmStudioV0` und die Probier-Sequenz — alles ans Kit abgegeben. Sie **behält** das
Plugin-Eigene (`visionDisplay`, aktiver Vision-Test) und bekommt zwei dünne Fassaden,
damit `vision_client.ts` und `settings.ts` **unverändert** bleiben:

```ts
fetchVisionCapability(http: HttpFetch, baseUrl: string, model: string)
  // → Kit-fetchCapabilities(asJsonFetch(http), …), projiziert .vision
resolveVision(meta: Confidence | null, model: string)
  // → Kit-resolveCapabilities, projiziert .vision
```

Dazu ein lokaler `asJsonFetch(http: HttpFetch): CapabilityFetch` (prüft `ok`, parst
`text`, gibt bei Fehlschlag `null`). `Confidence` wird aus dem Vendor-Modul re-exportiert,
damit die drei bestehenden Importstellen (`vision_client.ts`, `settings.ts`) nicht
angefasst werden müssen. Blast Radius: eine Datei.

### i2m: der Thinking-Toggle

Die neue Heuristik ändert **nur die Beschriftung, nie das Request-Verhalten**.
`effectiveSuppress` bleibt unverändert an `isAlwaysOnThinker` gebunden, und nur dieser
Fall sperrt den Button weiterhin hart. Der Grund ist ein technischer Unterschied, keine
Vorsicht:

- **gpt-oss/harmony** *lehnen* `reasoning_effort:"none"` ab — der Request schlägt fehl.
  Sperren ist Notwendigkeit; die Invariante aus dem 0.10.0-Whole-Branch-Review (UI und
  Request dürfen nicht auseinanderlaufen) hängt daran.
- **deepseek-r1, qwq, magistral & Co.** schlucken die Params als harmlose No-ops und
  denken weiter. Sie wegen einer *Namensvermutung* zu sperren wäre die Bevormundung aus
  Entscheidung 2 — und bei einem falsch erkannten Fine-Tune ein toter Button.

`thinkToggleView` bekommt deshalb ein zusätzliches Feld statt neuer Zustände:

```ts
export interface ThinkToggleView {
  labelKey: "view.thinkingOn" | "view.thinkingOff" | "view.thinkingAlways";
  hintKey: "view.thinkingHintNone" | "view.thinkingHintAlways" | null;
  cls: "" | "is-off" | "is-disabled";
  disabled: boolean;
}
```

Belegung nach `guessFromName(model).thinking.support`: `"none"` → Hinweis „Dieses Modell
denkt vermutlich nicht"; `"always"` → „Dieses Modell denkt vermutlich immer — Abschalten
wirkt wahrscheinlich nicht"; `"hybrid"` → `null`. `labelKey`, `cls` und `disabled` behalten
ihre bisherige Belegung.

Zwei Vorrang-Regeln, damit der Hinweis nie redundant oder irreführend wird:

- **`disabled` schlägt den Hinweis** — ist `isAlwaysOnThinker(model)` wahr (gpt-oss/harmony),
  gilt `hintKey: null`. Das Label sagt dort bereits „Thinking: immer an"; ein zusätzliches
  „denkt vermutlich immer" wäre doppelt gemoppelt. Der interessante Fall ist der andere:
  `deepseek-r1` ist `support: "always"`, aber **nicht** `isAlwaysOnThinker` — dort steht das
  normale an/aus-Label **mit** Hinweis.
- **Kein Modell gewählt** (leerer Modellname) → `hintKey: null`. `guessFromName("")` liefert
  `support: "none"`; daraus „dieses Modell denkt vermutlich nicht" abzuleiten, wäre eine
  Aussage über ein Modell, das es nicht gibt.

`renderThinkToggle` (in `img_to_md_view.ts`) hängt den Hinweis in `title` **und**
`aria-label` hinter das Label. **Der sichtbare Button-Text ändert sich nicht** — der
Sidebar-Breiten-Fix aus 0.10.1 bleibt unangetastet. Zwei neue i18n-Keys (EN kanonisch + DE).

Bewusst **keine** zusätzliche CSS-Markierung: eine gedimmte Variante wäre
Bedeutung-über-Farbe (WCAG 1.4.1), und die Sidebar hat keinen Platz für mehr Text.
Tooltip plus `aria-label` trägt die Information für Auge und Screenreader gleichermaßen.

## Datenfluss

**Vision (Settings-Tab, unverändert):** Modellwechsel → `VisionClient.visionConfidence`
→ `fetchVisionCapability` (Adapter → Kit-`fetchCapabilities`, drei Versuche) →
`resolveVision(meta, model)` → `visionDisplay` → Icon + Text.

**Thinking (Sidebar, neu):** Modellwechsel → `renderThinkToggle` →
`thinkToggleView(model, suppress)` → `guessFromName(model)` — **synchron, ohne Netz,
ohne Cache**. Der Toggle bekommt nur den Modellnamen, und die Namens-Heuristik ist eine
reine Funktion; ein Fetch wäre hier weder nötig noch möglich, ohne die View asynchron zu
machen.

## Fehlerbehandlung

Scheitern alle drei Metadaten-Versuche (Endpoint offline, kein JSON, Adapter wirft),
liefert das Kit `null`, und `resolveVision` fällt auf die Namens-Heuristik zurück. Ein
unerreichbarer Endpoint degradiert die Anzeige, er bricht sie nicht — bestehendes
Verhalten, unverändert.

## Tests

Baseline: **472 grüne Tests** in i2m (verifiziert vor Beginn).

**Kit** — `tests/capabilities.test.ts`: vault-rags Suite (115 Zeilen: Heuristik, Parser,
Merge) wandert **verbatim mit**; die Tests sind Teil der Extraktion, nicht ein Anhang.
Neu dazu für den injizierten Fetcher:
- Probier-Reihenfolge Ollama → LM Studio v1 → v0, Abbruch beim ersten Treffer.
- Ein **werfender** Adapter bricht die Sequenz nicht ab (nächster Versuch läuft).
- Alle drei erfolglos → `null`.

**i2m** — `tests/capabilities.test.ts` (heute 100 Z.): Parser-Tests entfallen (jetzt im
Kit), neu sind Vision-Projektion und der `HttpFetch → CapabilityFetch`-Adapter
(`ok: false` → `null`, nicht-JSON-Text → `null`). `visionDisplay` und der aktive
Vision-Test bleiben unverändert abgedeckt.

**i2m** — `tests/reasoning_toggle.test.ts` (heute 27 Z.): `hintKey`-Fälle für alle drei
`support`-Werte, plus die beiden Vorrang-Regeln (`gpt-oss` → `disabled: true` **und**
`hintKey: null`; leerer Modellname → `hintKey: null`). Dazu die
**Nicht-Regressions-Zusicherung**, die die zentrale Design-Entscheidung festzurrt:

> Für `deepseek-r1` und `qwq` — von der neuen Heuristik als `"always"` eingestuft — muss
> `effectiveSuppress(model, true)` weiterhin `true` liefern und `disabled` `false` bleiben.

Ohne diesen Test ist „die Erkennung fasst das Request-Verhalten nicht an" eine
Absichtserklärung statt einer Eigenschaft.

## Reihenfolge & Release

1. **Kit:** Modul + Tests + `index.ts`-Re-Export + `KIT_VERSION` → `0.19.0` (inkl. der
   übersehenen 0.18.0-Korrektur) + CHANGELOG-Eintrag + Tag + Dual-Forge-Push
   (Codeberg kanonisch, GitHub-Mirror).
2. **i2m:** gegen Tag `0.19.0` vendoren, Adapter, Toggle, i18n, Tests.
3. **Dach:** `KIT-MATRIX.md` + `REGISTRY.md` nachziehen — die Registry hat bisher
   **keinen** Eintrag für Capability-Erkennung.
4. Geräte-Abnahme, dann i2m-Release **0.17.0** (neues sichtbares Verhalten → Minor).

Die Reihenfolge ist bindend: ein Vendor-Header, der auf einen noch nicht existierenden
Tag zeigt, wäre eine Lüge in der Datei.

**Spec-Ablage:** diese Datei liegt in i2m, weil i2m das treibende Repo ist. Das Kit
bekommt nach eigener Konvention nur den CHANGELOG-Eintrag plus die Design-Essenz in
`AGENTS.md` — Repo-Specs sind dort eingefroren.

## Geräte-Abnahme (vier Handgriffe)

1. Settings-Tab, Modell mit Vision → Anzeige unverändert (Regression).
2. Sidebar-Toggle bei einem Nicht-Thinking-Modell → Hover zeigt den neuen Hinweis,
   Button bleibt klickbar.
3. Toggle bei `gpt-oss` → weiterhin gesperrt, „Thinking: immer an".
4. Eine Transkription mit abgeschaltetem Thinking → läuft wie zuvor.

## Nachgelagert

- **vault-rag auf das Kit-Modul migrieren** (der zweite Konsument, der die Extraktion
  rechtfertigt) — eigener Schritt, danach fast eine Identitäts-Ersetzung.
- **PDF-Szenario 7** (Mehrseiten-Refine-Datenverlust-Pfad) ist weiterhin nur
  unit-getestet, Geräte-Abnahme aus. Unabhängig von diesem Zyklus, hier nur als
  offener Punkt notiert.
