# Design: Settings-QoL + Vision-Capability-Fundament + Lifecycle-Fix (Phase 1)

**Datum:** 2026-06-21
**Status:** Design (zur Review)
**Scope:** Phase 1 von 9 Audit-Slices (siehe Audit 2026-06-21). Slices 1+2+3.

## Kontext & Ziel

Aus einem Obsidian-Best-Practices-Audit (5 Achsen, 37 Befunde) wurde image-to-markdown in
9 Implementierungs-Slices zerlegt. **Phase 1** bündelt die drei vom User explizit gewünschten
Quality-of-Life-Verbesserungen plus den einzigen harten Submission-Blocker:

1. **Lifecycle-Blocker** — `onunload()` detacht die eigenen Leaves; die Sidebar überlebt ein
   Plugin-Reload/-Update nicht und verschwindet aus dem gespeicherten Layout.
2. **Große Prompt-Textarea** — das `Vision Prompt`-Eingabefeld ist zu klein (User-Hauptschmerz).
3. **Verbindungs-Status** — keine Rückmeldung in den Settings, ob der Vision-Endpoint erreichbar ist.
4. **Vision-Capability** — keine Anzeige, ob das gewählte Modell überhaupt vision-fähig ist
   (für ein Vision-Transkriptions-Plugin ein zentrales Signal — Text-only-Modell → leere/kaputte
   Transkripte ohne Vorwarnung).

QoL-Vorlage ist das Schwester-Plugin **vault-rag** (`/Users/Shared/code/vault-rag`), dessen
`src/capabilities.ts` + `src/settings.ts` die erprobten Muster liefern. Ansatz: **portieren,
vision-fokussiert, „kopieren statt teilen"** (etablierter Präzedenzfall für `sse.ts`/`think_splitter.ts`).

### Nicht in diesem Scope (spätere Slices)

Slice 4 Transport-Hygiene (`requestUrl` für ping/listModels) · Slice 5 View-Performance
(inkrementelles Karten-Rendering) · Slice 6 View-A11y & Icons (inkl. Status-**Farbe** in der View) ·
Slice 7 Sidebar Vision-Badge · Slice 8 CSS-Politur & Mobile · Slice 9 Manifest-Politur.
**Phase 1 fasst die Sidebar-View nicht an** (außer dem `instanceof`-Guard in `main.ts`).

## Architektur & Komponenten

### Slice 1 — Lifecycle & API-Hygiene

**`src/main.ts`**
- `onunload()` (Z.48–50) **vollständig entfernen**. Es ruft nur
  `getLeavesOfType(VIEW_TYPE_IMGMD).forEach(l => l.detach())` — genau das Anti-Pattern. Obsidian
  persistiert/zerstört Leaves selbst; die View-eigene `onClose()` (`img_to_md_view.ts:195`,
  `controller?.abort()`) erledigt das Ressourcen-Cleanup. vault-rag/`src/main.ts` hat bewusst kein
  `onunload`.
- `refreshImgViews()` (Z.109–113): den ungeguardeten Cast absichern:
  `if (leaf.view instanceof ImgToMdView) void leaf.view.refresh();` (`ImgToMdView` ist bereits
  importiert).

### Slice 2 — Vision-Capability-Fundament

**Neue Datei `src/capabilities.ts`** — vision-only-Adaptation von `vault-rag/src/capabilities.ts`.
Der Thinking-/`reasoning.ts`-Zweig wird **gestrichen** → keine Fremd-Abhängigkeit. Bewusster,
dokumentierter Fork (vault-rags Version bleibt vision+thinking).

```ts
export type Confidence = "no" | "likely" | "confirmed";

// L2 — Namens-Heuristik (llava, *-vl, pixtral, glm-4v, gemma3≥4B, mistral-small 3.1/3.2, …)
export function guessVision(model: string): Confidence;

// L1 — Metadaten-Parser (vision-only; Thinking-Extraktion entfällt)
export function parseOllamaShow(json: unknown): Confidence | null;        // capabilities[] enthält "vision"
export function parseLmStudioV1(json: unknown, model: string): Confidence | null; // caps.vision === true
export function parseLmStudioV0(json: unknown, model: string): Confidence | null; // type === "vlm"

// Probe gegen native Endpoints — Basis-URL OHNE /v1
export async function fetchVisionCapability(baseUrl: string, model: string): Promise<Confidence | null>;

// Merge Metadaten + Namens-Heuristik + optionale Live-Bestätigung (Monotonie: confirmed > likely > no)
export function resolveVision(meta: Confidence | null, model: string, live?: boolean): Confidence;

// UI-Display (Lucide-Icon-Name + Kurz-Text + State-Klasse) — geteilt von Settings jetzt + View in Slice 7
export function visionDisplay(c: Confidence): { icon: string; text: string; state: "ok" | "likely" | "error" };

// Aktiver Vision-Test: kleines Bild mit bekanntem Token + Prüf-Funktion
export const VISION_TEST_IMAGE: string;   // data:image/png;base64,… (kleines PNG mit Token "OK")
export const VISION_TEST_PROMPT: string;  // "Gib nur den Text im Bild aus."
export function isVisionConfirmed(response: string): boolean;  // Antwort enthält das Token (case-insensitive)
```

- `fetchVisionCapability` probt der Reihe nach `POST {base}/api/show` (Ollama),
  `GET {base}/api/v1/models` (LM Studio v1), `GET {base}/api/v0/models` (LM Studio v0); erste
  Antwort gewinnt, sonst `null`.
- `resolveVision(meta, model, live)` = `live ? "confirmed" : stronger(meta ?? "no", guessVision(model))`.
- `visionDisplay`: `confirmed` → `{ icon: "eye", text: "Vision", state: "ok" }`,
  `likely` → `{ icon: "help-circle", text: "Vision unbestätigt", state: "likely" }`,
  `no` → `{ icon: "alert-triangle", text: "Kein Vision", state: "error" }`. **Hinweis:** Icon-Namen
  gegen das in Obsidian 1.4 gebündelte Lucide-Set verifizieren (`setIcon` macht bei unbekanntem Namen
  still nichts) — Fallback ggf. `circle-help`/`triangle-alert`.

**`src/vision_client.ts`** — zwei Methoden ergänzen (nutzen das bereits `/v1`-freie private
`this.endpoint`, daher kein Basis-URL-Bug):

```ts
// Passiv: Metadaten-Probe + Namens-Heuristik
async visionConfidence(model: string): Promise<Confidence> {
  return resolveVision(await fetchVisionCapability(this.endpoint, model), model);
}

// Aktiv: schickt das Test-Bild und prüft die Antwort. Throws bei Netz-/HTTP-Fehler
// (→ "Endpoint nicht erreichbar"), false bei 200-aber-kein-Token (→ "Kein Vision").
async testVision(): Promise<boolean> {
  const { content } = await this.transcribe(VISION_TEST_IMAGE, VISION_TEST_PROMPT);
  return isVisionConfirmed(content);
}
```

`modelInfo` (Context-Length/Quantisierung) wird **nicht** portiert (YAGNI — Phase 1 zeigt Vision,
keine Modell-Details).

### Slice 3 — Settings-QoL

**`src/settings.ts`** — rein additiv. Harte Leitplanke: **ausschließlich CSS-Klassen +
legitime Attribute** (`inputEl.rows`, `addClass`, `toggleClass`), **nie `inputEl.style.*`**
(settings.ts ist heute inline-style-frei und konform — das bleibt so).

1. **Große Prompt-Textarea** — im `addTextArea`-Callback ergänzen:
   `t.inputEl.rows = 8; t.inputEl.addClass("img2md-prompt-textarea");`
2. **Status-Dot + Test-Button** — Helper `statusDot(setting)` / `showPing(dot, ok)` (img2md-Präfix,
   aus vault-rag), `.addButton("Verbindung testen")` am Endpoint-Setting:
   `new VisionClient(this.plugin.settings.visionEndpoint, "").ping()` → `showPing(dot, ok)`.
   Frische Client-Instanz (spiegelt das bestehende `listModels`-Muster, Z.37). **Auto-Ping beim
   Öffnen** der Settings setzt den Dot sofort.
3. **Vision-Fähigkeit** — eigene Setting-Zeile „Vision-Fähigkeit":
   - Anzeige: ein Icon-Span (`setIcon(span, d.icon)`) + Kurz-Text aus `visionDisplay(c)`, Zustand
     via Klasse `img2md-cap is-<state>`. Passiv befüllt durch `showCaps(model)` →
     `new VisionClient(endpoint, "").visionConfidence(model)`. Trigger: Dropdown-`onChange` **und** initial.
   - **`.addButton("Vision testen")`** → `new VisionClient(endpoint, model).testVision()`:
     `true` → Zeile auf `confirmed` (eye, is-ok) setzen **und** Modell in `confirmedModels` cachen ·
     `false` → `no` (alert-triangle, is-error) · **Throw** (Netzfehler) → Notice „Endpoint nicht
     erreichbar", Zeile unverändert. Button während des Tests `setDisabled(true)`.
   - **Live-Cache:** `confirmedModels: Set<string>` am SettingTab. `showCaps` rendert
     `resolveVision(meta, model, confirmedModels.has(model))` → ein einmal bestätigtes Modell bleibt
     in der Settings-Session bestätigt, auch nach Modell-Wechsel und zurück.
4. **Offline-Fallback** — im Text-Fallback (Endpoint offline) `.addButton("Modelle laden")` →
   `this.display()` (Re-Render, holt das Dropdown sobald der Server läuft).
5. **Naming (DE sentence-case)** — `"Vision Endpoint"` → **„Vision-Endpunkt"**, `"Vision Modell"` →
   **„Vision-Modell"**, `"Vision Prompt"` → **„Vision-Prompt"**. Heading „Vision (Image → Markdown)"
   bleibt (Eigenname). Button „Verbindung testen", Cap-Zeile „Vision-Fähigkeit". Präjudiziert die
   offene DE/EN-Lokalisierungs-Entscheidung nicht.

**`styles.css`** — additiv:

```css
.img2md-prompt-textarea { width: 100%; min-height: 8rem; resize: vertical; }
.img2md-status-dot { margin-left: 8px; color: var(--text-muted); }
.img2md-status-dot.is-ok { color: var(--text-success); }
.img2md-status-dot.is-error { color: var(--text-error); }
.img2md-cap { display: inline-flex; align-items: center; gap: 4px; color: var(--text-muted); }
.img2md-cap .svg-icon { width: var(--icon-s); height: var(--icon-s); }
.img2md-cap.is-ok { color: var(--text-success); }
.img2md-cap.is-error { color: var(--text-error); }
```

### Slice 3 (Folge) — Doc-Sync

Die Setting-Namen sind **wörtlich** in den 2026-06-21 geschriebenen Docs zitiert. Mit dem
Renaming müssen folgende Referenzen mitgezogen werden (sonst desynchronisieren Docs ↔ UI):
`README.md` (Config-Tabelle + Usage), `README.de.md`, `docs/manual/reference.md` (Settings-Tabelle),
`docs/manual/tutorial.md`, `docs/manual/how-to.md`, `docs/images/README.md` (Strings-Appendix).
Betrifft nur die drei Namen; das Heading „Vision (Image → Markdown)" bleibt unverändert.

## Datenfluss

- **Settings öffnen** → Auto-Ping (`ping()`) setzt Status-Dot · `listModels()` füllt Dropdown ·
  `visionConfidence(cur)` setzt die Fähigkeits-Zeile.
- **Modell wechseln** → `setModel` (save) · `visionConfidence(neu)` aktualisiert die Fähigkeits-Zeile.
- **„Verbindung testen"** → `ping()` → Dot.
- **`visionConfidence(model)`** → `fetchVisionCapability(endpoint, model)` (native Probe, `Confidence|null`)
  → `resolveVision(meta, model)` (merge mit Namens-Heuristik) → `visionLabel`.

## Fehlerbehandlung

- `ping()`/`listModels()`/`fetchVisionCapability()` fangen Netzwerkfehler bereits ab und liefern
  `false`/`[]`/`null` (kein Throw in die UI). Offline → Dot `○ offline`, Dropdown-Fallback +
  „Modelle laden", Fähigkeits-Zeile fällt auf die Namens-Heuristik zurück (`resolveVision(null, model)`).
- Capability-Probe gegen einen Endpoint ohne `/api/*` (reines `/v1`) → alle Probes `null` →
  `resolveVision` nutzt nur die Namens-Heuristik (`likely`/`no`), nie ein falsches `confirmed`.

## Testing

image-to-markdown hat ein **bestehendes** Test-Setup (vitest + happy-dom, `tests/__mocks__/obsidian.ts`,
83 Tests in 7 Dateien). Phase 1 ergänzt:

- **`tests/capabilities.test.ts`** (neu) — reine Funktionen unit-getestet (Vorlage
  `vault-rag/src/capabilities.test.ts`, vision-only): `guessVision` (positive/negative Modellnamen,
  Versions-Gates gemma3:1b vs gemma3, mistral-small 3.1), `parseOllamaShow`/`parseLmStudioV1/V0`
  (vision true/false/fehlend), `resolveVision` (Monotonie meta vs name; `live=true` → `confirmed`),
  `visionDisplay` (Icon/Text/State je Confidence), `isVisionConfirmed` (Token-Match case-insensitive,
  leere/falsche Antwort → false).
- **`tests/vision_client.test.ts`** (erweitern) — mit gemocktem `fetch` (Muster existiert bereits):
  `visionConfidence` (Probe-Reihenfolge, Fallback auf Namens-Heuristik bei allen-`null`); `testVision`
  (200 + Token → true · 200 ohne Token → false · HTTP-/Netzfehler → throw).
- **Slice 1:** `instanceof`-Guard ist logisch trivial; die `onunload`-Entfernung ist **nicht
  automatisiert testbar** → **manueller Reload-Check** (View überlebt Plugin-Reload im Layout) in der DoD.
- **Slice 3 (UI):** Settings-DOM ist über happy-dom begrenzt testbar; primär `npx tsc --noEmit` +
  manueller Settings-Smoke (Textarea-Größe, Test-Button, Fähigkeits-Zeile, Offline-Fallback).

Nach jeder Änderung: **alle Tests grün** + `npx tsc --noEmit` sauber (vitest ≠ tsc).

## Entscheidungs-Log

- **Vision-only-Port** — Thinking/`reasoning.ts`-Zweig gestrichen; `Capabilities` reduziert auf
  `Confidence` für Vision. Begründung: image-to-markdown gated nicht auf Thinking (zeigt Reasoning
  nur an, wenn es streamt). Bewusster Fork von vault-rags `capabilities.ts`.
- **`modelInfo` weggelassen** (YAGNI) — keine Context/Quant-Anzeige in Phase 1.
- **Aktiver Vision-Test** (User-Wunsch) — Button „Vision testen" probt das Modell mit einem
  gebündelten Token-Bild und hebt auf `confirmed` (vault-rags `live.vision`-Pfad). Ergänzt die
  passive Metadaten/Namens-Erkennung, ersetzt sie nicht. Live-Bestätigung pro Settings-Session
  gecacht (`confirmedModels`).
- **Lucide-Icons statt Emoji** (User-Wunsch) — Capability-Anzeige via `setIcon` (`eye`/`help-circle`/
  `alert-triangle`), Icon-Namen gegen das gebündelte Lucide-Set verifizieren.
- **Frische `VisionClient`-Instanzen** in den Settings (ping/listModels/visionConfidence) statt
  `this.plugin.visionClient` — spiegelt das vorhandene Muster, vermeidet Stale-Endpoint nach Tippen.
- **`visionConfidence` als Client-Methode** (statt freistehend in settings.ts) — kapselt das
  `/v1`-freie `this.endpoint`, bricht die Endpoint-Encapsulation nicht.
- **DE sentence-case** Naming (User-Entscheidung) + zugehöriger Doc-Sync.
- **View bleibt unangetastet** in Phase 1 (Status-Farbe/Badge/Perf/A11y sind Slices 5–7).

## Cross-Cutting / Folge-Slices

- **`status`-Farbe in der View** (is-ok/is-error) ist das Gegenstück zum Settings-Status-Dot, gehört
  aber in Slice 6 (View-A11y) — gemeinsames CSS `.img2md-status-dot.is-ok/.is-error` wird hier
  schon angelegt und in Slice 6 wiederverwendet (Drift vermeiden).
- **`requestUrl`-Migration** (ping/listModels mobil/CORS-fest) bewusst auf Slice 4 verschoben;
  `fetchVisionCapability` nutzt vorerst `fetch` wie die übrigen Non-Streaming-Calls.
- **Capability-Badge in der View** (Slice 7) konsumiert dasselbe `capabilities.ts` + `visionLabel`.

## Definition of Done (Phase 1)

- [ ] `onunload` entfernt; `refreshImgViews` mit `instanceof`-Guard; View überlebt Plugin-Reload (manuell verifiziert).
- [ ] `src/capabilities.ts` (vision-only) + `tests/capabilities.test.ts` grün.
- [ ] `VisionClient.visionConfidence` + `testVision` + erweiterte `vision_client.test.ts` grün.
- [ ] Settings: große Textarea · Status-Dot + „Verbindung testen" + Auto-Ping · „Vision-Fähigkeit"-Zeile (Lucide-Icon + Kurz-Text) + „Vision testen"-Button (→ confirmed-Cache) · „Modelle laden"-Fallback · DE-sentence-case-Namen.
- [ ] `styles.css`-Ergänzungen (nur CSS-Klassen, keine Inline-Styles).
- [ ] Doc-Sync der Setting-Namen in README/README.de/manual/docs-images.
- [ ] Alle Tests grün · `npx tsc --noEmit` sauber.
