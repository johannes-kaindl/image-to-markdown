# Settings-QoL + Vision-Capability + Lifecycle-Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 1 des Obsidian-Audits umsetzen — Lifecycle-Blocker beheben, Vision-Capability-Detektion einführen und die Settings-QoL (große Prompt-Textarea, Verbindungs-Status + Test, Vision-Fähigkeit + aktiver Test) liefern.

**Architecture:** Reine, DOM-freie Detektions-/Transport-Module (`capabilities.ts`, `vision_client.ts`) bleiben in Node testbar (PROF-OBS-03/04); die DOM-Schicht (`settings.ts`) konsumiert sie und stellt die UI. Vision-only-Adaptation von vault-rags `capabilities.ts` (Thinking-Zweig gestrichen).

**Tech Stack:** TypeScript (strict), esbuild, vitest + happy-dom, Obsidian Plugin API.

## Global Constraints

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen.
- **Alle Tests grün** nach jeder Task (`npm test`) **und** `npx tsc --noEmit` sauber (vitest ≠ tsc).
- **Nur CSS-Klassen** für Styling — **nie `inputEl.style.*`** in `settings.ts`.
- **Klassen-Präfix `img2md-`** durchgängig (nicht `vault-rag-`).
- **Vision-only** — kein Thinking/`reasoning.ts`-Zweig portieren. `Capabilities` = `Confidence` für Vision.
- **Conventional Commits**, deutsche Beschreibung erlaubt; **nur berührte Dateien stagen** (nie `git add -A`); Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Mobile-safe** (isDesktopOnly:false): keine Node-APIs; Canvas/`document` sind in Obsidian (Electron + Mobile-WebView) verfügbar.

### Verfeinerungen ggü. Spec (`docs/superpowers/specs/2026-06-21-settings-vision-qol-design.md`)

- `VisionClient.testVision(dataUrl)` nimmt das Test-Bild als **Parameter**; die Canvas-`makeVisionTestImage()` lebt in `settings.ts` (DOM-Schicht) — hält `capabilities.ts`/`vision_client.ts` DOM-frei.
- `resolveVision(meta, model)` **ohne** `live`-Param; die Live-Bestätigung („Vision testen") wird über das `confirmedModels`-Set in `settings.ts` modelliert (UI-Schicht), nicht im reinen Kern.

---

### Task 1: Lifecycle-Blocker beheben (`main.ts`)

**Files:**
- Modify: `src/main.ts:48-50` (onunload entfernen), `src/main.ts:109-113` (instanceof-Guard)

**Interfaces:**
- Consumes: `ImgToMdView` (bereits importiert), `VIEW_TYPE_IMGMD`.
- Produces: nichts Neues (Verhaltens-Fix).

Kein neuer automatisierter Test möglich (Obsidian-Lifecycle). Verifikation = `tsc` + bestehende Suite grün + manueller Reload-Check.

- [ ] **Step 1: `onunload` entfernen**

Lösche in `src/main.ts` die komplette Methode (Z.48–50):

```ts
  onunload() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_IMGMD).forEach(l => l.detach());
  }
```

(Ersatzlos streichen — Obsidian räumt Leaves selbst auf; `ImgToMdView.onClose()` macht das Ressourcen-Cleanup. vault-rag hat bewusst kein `onunload`.)

- [ ] **Step 2: instanceof-Guard in `refreshImgViews`**

Ersetze in `src/main.ts` (Z.109–113):

```ts
  private refreshImgViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_IMGMD)) {
      void (leaf.view as ImgToMdView).refresh();
    }
  }
```

durch:

```ts
  private refreshImgViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_IMGMD)) {
      if (leaf.view instanceof ImgToMdView) void leaf.view.refresh();
    }
  }
```

- [ ] **Step 3: Typecheck + Tests grün**

Run: `npx tsc --noEmit && npm test`
Expected: tsc ohne Fehler; alle 83 Tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "fix: onunload entfernt (View überlebt Plugin-Reload) + instanceof-Guard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Vision-Capability-Kern (`src/capabilities.ts`)

**Files:**
- Create: `src/capabilities.ts`
- Test: `tests/capabilities.test.ts`

**Interfaces:**
- Produces:
  - `type Confidence = "no" | "likely" | "confirmed"`
  - `guessVision(model: string): Confidence`
  - `parseOllamaShow(json: unknown): Confidence | null`
  - `parseLmStudioV1(json: unknown, model: string): Confidence | null`
  - `parseLmStudioV0(json: unknown, model: string): Confidence | null`
  - `fetchVisionCapability(baseUrl: string, model: string): Promise<Confidence | null>`
  - `resolveVision(meta: Confidence | null, model: string): Confidence`
  - `visionDisplay(c: Confidence): { icon: string; text: string; state: "ok" | "likely" | "error" }`
  - `isVisionConfirmed(response: string, token?: string): boolean`
  - `const VISION_TEST_TOKEN: string`, `const VISION_TEST_PROMPT: string`

- [ ] **Step 1: Failing-Tests schreiben**

Create `tests/capabilities.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  guessVision, parseOllamaShow, parseLmStudioV1, parseLmStudioV0,
  fetchVisionCapability, resolveVision, visionDisplay, isVisionConfirmed,
  VISION_TEST_TOKEN,
} from "../src/capabilities";

describe("guessVision (Namens-Heuristik)", () => {
  it("erkennt klare Vision-Modelle als 'likely'", () => {
    for (const m of ["llava:13b", "qwen2-vl-7b", "pixtral-12b", "moondream", "glm-4v", "gemma3:4b"]) {
      expect(guessVision(m)).toBe("likely");
    }
  });
  it("erkennt mistral-small 3.1/3.2 als 'likely', ältere als 'no'", () => {
    expect(guessVision("mistral-small-3.1-24b")).toBe("likely");
    expect(guessVision("mistral-small-2409")).toBe("no");
  });
  it("gemma3:1b/270m sind text-only → 'no'", () => {
    expect(guessVision("gemma3:1b")).toBe("no");
    expect(guessVision("gemma3:270m")).toBe("no");
  });
  it("Text-Modelle → 'no'", () => {
    for (const m of ["qwen3:8b", "llama3.1:8b", "deepseek-r1"]) expect(guessVision(m)).toBe("no");
  });
});

describe("L1-Metadaten-Parser (vision-only)", () => {
  it("parseOllamaShow: 'vision' in capabilities[] → confirmed, sonst no, fehlend → null", () => {
    expect(parseOllamaShow({ capabilities: ["completion", "vision"] })).toBe("confirmed");
    expect(parseOllamaShow({ capabilities: ["completion"] })).toBe("no");
    expect(parseOllamaShow({})).toBeNull();
  });
  it("parseLmStudioV1: caps.vision===true → confirmed", () => {
    const j = { data: [{ id: "m", capabilities: { vision: true } }] };
    expect(parseLmStudioV1(j, "m")).toBe("confirmed");
    expect(parseLmStudioV1({ data: [{ id: "m", capabilities: {} }] }, "m")).toBe("no");
    expect(parseLmStudioV1({ data: [] }, "m")).toBeNull();
  });
  it("parseLmStudioV0: type==='vlm' → confirmed", () => {
    expect(parseLmStudioV0({ data: [{ id: "m", type: "vlm" }] }, "m")).toBe("confirmed");
    expect(parseLmStudioV0({ data: [{ id: "m", type: "llm" }] }, "m")).toBe("no");
    expect(parseLmStudioV0({ data: [] }, "m")).toBeNull();
  });
});

describe("fetchVisionCapability (Probe-Reihenfolge)", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("nimmt Ollama /api/show wenn vorhanden", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ capabilities: ["vision"] }) });
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchVisionCapability("http://h:1234", "m")).toBe("confirmed");
    expect(fetchMock.mock.calls[0][0]).toBe("http://h:1234/api/show");
  });
  it("fällt auf LM Studio /api/v1/models zurück", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: "m", capabilities: { vision: true } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchVisionCapability("http://h:1234", "m")).toBe("confirmed");
    expect(fetchMock.mock.calls[1][0]).toBe("http://h:1234/api/v1/models");
  });
  it("liefert null wenn keine Metadaten-Quelle antwortet", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await fetchVisionCapability("http://h:1234", "m")).toBeNull();
  });
  it("überlebt Netzfehler (alle throw) → null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await fetchVisionCapability("http://h:1234", "m")).toBeNull();
  });
});

describe("resolveVision (Merge meta + Name)", () => {
  it("Metadaten 'confirmed' schlägt Namens-Heuristik", () => {
    expect(resolveVision("confirmed", "irgendwas")).toBe("confirmed");
  });
  it("ohne Metadaten greift die Namens-Heuristik", () => {
    expect(resolveVision(null, "qwen2-vl")).toBe("likely");
    expect(resolveVision(null, "qwen3:8b")).toBe("no");
  });
  it("nimmt die stärkere Confidence", () => {
    expect(resolveVision("no", "llava")).toBe("likely");
  });
});

describe("visionDisplay", () => {
  it("liefert Icon/Text/State je Confidence", () => {
    expect(visionDisplay("confirmed")).toEqual({ icon: "eye", text: "Vision", state: "ok" });
    expect(visionDisplay("likely")).toEqual({ icon: "help-circle", text: "Vision unbestätigt", state: "likely" });
    expect(visionDisplay("no")).toEqual({ icon: "alert-triangle", text: "Kein Vision", state: "error" });
  });
});

describe("isVisionConfirmed", () => {
  it("true wenn die Antwort das Token enthält (case-insensitive, robust gegen Zeichen)", () => {
    expect(isVisionConfirmed(`Der Text lautet ${VISION_TEST_TOKEN}.`)).toBe(true);
    expect(isVisionConfirmed(VISION_TEST_TOKEN.toLowerCase())).toBe(true);
    expect(isVisionConfirmed("V X 7")).toBe(true);
  });
  it("false bei leerer/falscher Antwort", () => {
    expect(isVisionConfirmed("")).toBe(false);
    expect(isVisionConfirmed("Ich sehe eine Katze.")).toBe(false);
  });
});
```

- [ ] **Step 2: Tests laufen lassen (müssen fehlschlagen)**

Run: `npx vitest run tests/capabilities.test.ts`
Expected: FAIL — `Cannot find module '../src/capabilities'`.

- [ ] **Step 3: `src/capabilities.ts` implementieren**

Create `src/capabilities.ts`:

```ts
// Vision-Capability-Detektion — vision-only-Adaptation von vault-rag/src/capabilities.ts.
// Reiner Kern: keine obsidian-/DOM-Imports (in Node testbar, PROF-OBS-03/04).

export type Confidence = "no" | "likely" | "confirmed";

const RANK: Record<Confidence, number> = { no: 0, likely: 1, confirmed: 2 };
const stronger = (a: Confidence, b: Confidence): Confidence => (RANK[a] >= RANK[b] ? a : b);
const norm = (m: string): string => m.toLowerCase();

// ── L2: Namens-Heuristik ──────────────────────────────────────────────
const VISION = [
  "llava", "bakllava", "vision", "pixtral", "moondream", "minicpm-v", "internvl",
  "smolvlm", "cogvlm", "molmo", "nvlm", "aya-vision", "kimi-vl", "ovis", "multimodal",
];
const VISION_TOKEN = /(^|[-_:/. ])vl([-_:/. ]|$)/;   // qwen2-vl, qwen3-vl
const GLM_V = /glm-4(\.\d+)?v/;                       // glm-4v, glm-4.1v, glm-4.5v
const GEMMA3_VISION = /gemma3/;                       // ≥4B; 1b/270m sind text-only
const GEMMA3_TEXT = /gemma3:(1b|270m)/;
const MISTRAL_VISION = /mistral-small.*(3\.1|3\.2)/;

export function guessVision(model: string): Confidence {
  const m = norm(model);
  if (GEMMA3_TEXT.test(m)) return "no";
  if (GEMMA3_VISION.test(m)) return "likely";
  if (MISTRAL_VISION.test(m)) return "likely";
  if (/mistral-small/.test(m)) return "no";
  if (GLM_V.test(m)) return "likely";
  if (VISION_TOKEN.test(m)) return "likely";
  if (VISION.some(v => m.includes(v))) return "likely";
  return "no";
}

// ── L1: Metadaten-Parser (vision-only) ────────────────────────────────
export function parseOllamaShow(json: unknown): Confidence | null {
  const caps = (json as { capabilities?: unknown })?.capabilities;
  if (!Array.isArray(caps)) return null;
  const arr = caps.filter((x): x is string => typeof x === "string");
  return arr.includes("vision") ? "confirmed" : "no";
}

function findModel(json: unknown, model: string): Record<string, unknown> | null {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return null;
  const hit = data.find(x => (x as { id?: unknown })?.id === model);
  return (hit as Record<string, unknown>) ?? null;
}

export function parseLmStudioV1(json: unknown, model: string): Confidence | null {
  const m = findModel(json, model);
  if (!m) return null;
  const caps = (m.capabilities ?? {}) as { vision?: unknown };
  return caps.vision === true ? "confirmed" : "no";
}

export function parseLmStudioV0(json: unknown, model: string): Confidence | null {
  const m = findModel(json, model);
  if (!m) return null;
  return m.type === "vlm" ? "confirmed" : "no";
}

/** Probiert native Capability-Endpoints gegen eine Basis-URL (OHNE /v1). */
export async function fetchVisionCapability(baseUrl: string, model: string): Promise<Confidence | null> {
  try {
    const r = await fetch(`${baseUrl}/api/show`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model }),
    });
    if (r.ok) { const c = parseOllamaShow(await r.json()); if (c) return c; }
  } catch { /* weiter */ }
  try {
    const r = await fetch(`${baseUrl}/api/v1/models`);
    if (r.ok) { const c = parseLmStudioV1(await r.json(), model); if (c) return c; }
  } catch { /* weiter */ }
  try {
    const r = await fetch(`${baseUrl}/api/v0/models`);
    if (r.ok) { const c = parseLmStudioV0(await r.json(), model); if (c) return c; }
  } catch { /* weiter */ }
  return null;
}

/** Merge: Metadaten (falls vorhanden) gegen Namens-Heuristik, stärkere Confidence gewinnt. */
export function resolveVision(meta: Confidence | null, model: string): Confidence {
  return stronger(meta ?? "no", guessVision(model));
}

/** UI-Display: Lucide-Icon-Name + Kurz-Text + State-Klasse. */
export function visionDisplay(c: Confidence): { icon: string; text: string; state: "ok" | "likely" | "error" } {
  if (c === "confirmed") return { icon: "eye", text: "Vision", state: "ok" };
  if (c === "likely") return { icon: "help-circle", text: "Vision unbestätigt", state: "likely" };
  return { icon: "alert-triangle", text: "Kein Vision", state: "error" };
}

// ── Aktiver Vision-Test (Bild-Erzeugung lebt in der DOM-Schicht settings.ts) ──
export const VISION_TEST_TOKEN = "VX7";
export const VISION_TEST_PROMPT = "Gib nur den Text im Bild aus.";

/** true, wenn die Modell-Antwort das Token enthält (alphanumerisch normalisiert, case-insensitive). */
export function isVisionConfirmed(response: string, token: string = VISION_TEST_TOKEN): boolean {
  const n = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const t = n(token);
  return t.length > 0 && n(response).includes(t);
}
```

- [ ] **Step 4: Tests grün**

Run: `npx vitest run tests/capabilities.test.ts && npx tsc --noEmit`
Expected: alle PASS, tsc sauber.

- [ ] **Step 5: Commit**

```bash
git add src/capabilities.ts tests/capabilities.test.ts
git commit -m "feat: Vision-Capability-Detektion (vision-only Port aus vault-rag)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: VisionClient — `visionConfidence` + `testVision` (`src/vision_client.ts`)

**Files:**
- Modify: `src/vision_client.ts` (Import + zwei Methoden)
- Test: `tests/vision_client.test.ts` (neue describe-Blöcke)

**Interfaces:**
- Consumes: `fetchVisionCapability`, `resolveVision`, `isVisionConfirmed`, `VISION_TEST_PROMPT`, `Confidence` aus `./capabilities`; bestehendes `this.transcribe`, `this.endpoint`.
- Produces:
  - `VisionClient.visionConfidence(model: string): Promise<Confidence>`
  - `VisionClient.testVision(dataUrl: string): Promise<boolean>`

- [ ] **Step 1: Failing-Tests schreiben**

Ergänze in `tests/vision_client.test.ts` am Dateiende:

```ts
describe("VisionClient.visionConfidence", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("liefert 'confirmed' aus Ollama-Metadaten", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ capabilities: ["vision"] }) }));
    expect(await new VisionClient("http://h:1234", "").visionConfidence("m")).toBe("confirmed");
  });
  it("fällt ohne Metadaten auf die Namens-Heuristik zurück", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await new VisionClient("http://h:1234", "").visionConfidence("qwen2-vl")).toBe("likely");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await new VisionClient("http://h:1234", "").visionConfidence("qwen3:8b")).toBe("no");
  });
});

describe("VisionClient.testVision", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("true wenn die Antwort das Token enthält", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: "VX7" } }] }) }));
    expect(await new VisionClient("http://h", "m").testVision("data:image/png;base64,AA")).toBe(true);
  });
  it("false wenn das Token fehlt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: "eine Katze" } }] }) }));
    expect(await new VisionClient("http://h", "m").testVision("data:image/png;base64,AA")).toBe(false);
  });
  it("wirft bei HTTP-/Netzfehler (→ 'Endpoint nicht erreichbar')", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(new VisionClient("http://h", "m").testVision("d")).rejects.toThrow("500");
  });
});
```

- [ ] **Step 2: Tests laufen lassen (müssen fehlschlagen)**

Run: `npx vitest run tests/vision_client.test.ts`
Expected: FAIL — `visionConfidence`/`testVision` is not a function.

- [ ] **Step 3: Methoden implementieren**

In `src/vision_client.ts` den Import (Z.1) erweitern:

```ts
import { streamSSE } from "./sse";
import { fetchVisionCapability, resolveVision, isVisionConfirmed, VISION_TEST_PROMPT, type Confidence } from "./capabilities";
```

Und innerhalb der Klasse `VisionClient` (nach `transcribeStream`) ergänzen:

```ts
  /** Passive Vision-Erkennung: native Metadaten-Probe + Namens-Heuristik.
   *  this.endpoint ist bereits /v1-frei (normalizeEndpoint) → korrekte Basis-URL. */
  async visionConfidence(model: string): Promise<Confidence> {
    return resolveVision(await fetchVisionCapability(this.endpoint, model), model);
  }

  /** Aktiver Vision-Test: schickt das übergebene Test-Bild und prüft, ob die Antwort
   *  das erwartete Token enthält. Throws bei Netz-/HTTP-Fehler (Endpoint nicht erreichbar). */
  async testVision(dataUrl: string): Promise<boolean> {
    const { content } = await this.transcribe(dataUrl, VISION_TEST_PROMPT);
    return isVisionConfirmed(content);
  }
```

- [ ] **Step 4: Tests grün**

Run: `npx vitest run tests/vision_client.test.ts && npx tsc --noEmit`
Expected: alle PASS, tsc sauber.

- [ ] **Step 5: Commit**

```bash
git add src/vision_client.ts tests/vision_client.test.ts
git commit -m "feat: VisionClient.visionConfidence + testVision

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Settings-QoL + CSS (`src/settings.ts`, `styles.css`)

**Files:**
- Modify: `src/settings.ts` (komplette Datei — siehe Step 1)
- Modify: `styles.css` (vier Regeln anhängen)

**Interfaces:**
- Consumes: `VisionClient.ping/listModels/visionConfidence/testVision`; `visionDisplay`, `VISION_TEST_TOKEN`, `type Confidence` aus `./capabilities`; `setIcon`, `Notice` aus `obsidian`.
- Produces: `makeVisionTestImage(token?: string): string` (export, für View-Slice 7 wiederverwendbar).

Settings-DOM ist über happy-dom nur begrenzt testbar (keine bestehende `settings.test.ts`). Verifikation = `tsc` + Suite grün + manueller Settings-Smoke (Step 4).

- [ ] **Step 1: `src/settings.ts` ersetzen**

Ersetze den **kompletten** Inhalt von `src/settings.ts` durch:

```ts
import { App, PluginSettingTab, Setting, setIcon, Notice } from "obsidian";
import type ImageToMarkdownPlugin from "./main";
import { VisionClient } from "./vision_client";
import { visionDisplay, VISION_TEST_TOKEN, type Confidence } from "./capabilities";

export interface ImageToMarkdownSettings {
  visionEndpoint: string;
  visionModel: string;
  visionPrompt: string;
}

export const DEFAULT_VISION_PROMPT =
  "Transkribiere den Text im Bild exakt nach Markdown. Erhalte die Struktur: Überschriften, Absätze, " +
  "**Hervorhebungen**, Listen und Tabellen. Gib nur das Markdown aus, keine Kommentare.";

export const DEFAULT_SETTINGS: ImageToMarkdownSettings = {
  visionEndpoint: "http://localhost:8080",
  visionModel: "",
  visionPrompt: DEFAULT_VISION_PROMPT,
};

// 1x1-PNG-Fallback, falls Canvas/DOM nicht verfügbar (z.B. Test-Umgebung ohne 2d-Context).
const FALLBACK_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** Kleines PNG mit dem Token (für den aktiven Vision-Test). Canvas → Data-URL; Fallback bei fehlendem DOM. */
export function makeVisionTestImage(token: string = VISION_TEST_TOKEN): string {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 160; canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (!ctx) return FALLBACK_PNG;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000000"; ctx.font = "bold 40px sans-serif"; ctx.textBaseline = "middle";
    ctx.fillText(token, 16, 34);
    return canvas.toDataURL("image/png");
  } catch {
    return FALLBACK_PNG;
  }
}

export class ImageToMarkdownSettingTab extends PluginSettingTab {
  private confirmedModels = new Set<string>();

  constructor(app: App, private plugin: ImageToMarkdownPlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const endpoint = (): string => this.plugin.settings.visionEndpoint;

    // ── Status-Dot-Helfer ──
    const statusDot = (setting: Setting): HTMLElement => {
      const dot = setting.controlEl.createSpan({ cls: "img2md-status-dot" });
      dot.setText("·");
      return dot;
    };
    const showPing = (dot: HTMLElement, ok: boolean): void => {
      dot.toggleClass("is-ok", ok);
      dot.toggleClass("is-error", !ok);
      dot.setText(ok ? "● verbunden" : "○ offline");
    };

    new Setting(containerEl).setName("Vision (Image → Markdown)").setHeading();

    // ── Endpoint + Status-Dot + Test ──
    const epSetting = new Setting(containerEl)
      .setName("Vision-Endpunkt")
      .setDesc("OpenAI-kompatibler Server mit Vision-Modell (z.B. LM Studio)")
      .addText(t => t.setPlaceholder("http://localhost:8080").setValue(this.plugin.settings.visionEndpoint)
        .onChange(async (v: string) => { this.plugin.settings.visionEndpoint = v.trim(); await this.plugin.saveSettings(); this.plugin.reconnectVision(); }))
      .addButton(b => b.setButtonText("Verbindung testen").onClick(async () => {
        b.setDisabled(true);
        const ok = await new VisionClient(endpoint(), "").ping();
        showPing(dot, ok);
        b.setDisabled(false);
      }));
    const dot = statusDot(epSetting);
    void new VisionClient(endpoint(), "").ping().then(ok => showPing(dot, ok));

    // ── Modell ──
    const modelSetting = new Setting(containerEl).setName("Vision-Modell").setDesc("Vision-fähiges Modell (Qwen2-VL, Llama-3.2-Vision …)");

    // ── Vision-Fähigkeit (Icon + Text) + aktiver Test ──
    const capSetting = new Setting(containerEl).setName("Vision-Fähigkeit");
    const capEl = capSetting.descEl.createSpan({ cls: "img2md-cap" });
    const capIcon = capEl.createSpan();
    const capText = capEl.createSpan();
    const renderCap = (c: Confidence): void => {
      const d = visionDisplay(c);
      capIcon.empty(); setIcon(capIcon, d.icon);
      capText.setText(" " + d.text);
      capEl.toggleClass("is-ok", d.state === "ok");
      capEl.toggleClass("is-error", d.state === "error");
    };
    const showCaps = (model: string): void => {
      if (this.confirmedModels.has(model)) { renderCap("confirmed"); return; }
      void new VisionClient(endpoint(), "").visionConfidence(model).then(renderCap);
    };
    capSetting.addButton(b => b.setButtonText("Vision testen").onClick(async () => {
      const model = this.plugin.settings.visionModel;
      b.setDisabled(true);
      try {
        const ok = await new VisionClient(endpoint(), model).testVision(makeVisionTestImage());
        if (ok) { this.confirmedModels.add(model); renderCap("confirmed"); } else { renderCap("no"); }
      } catch {
        new Notice("Endpoint nicht erreichbar");
      } finally {
        b.setDisabled(false);
      }
    }));

    // Modell-Dropdown asynchron befüllen (+ Offline-Fallback mit „Modelle laden")
    void new VisionClient(endpoint(), "").listModels().then((models: string[]) => {
      const cur = this.plugin.settings.visionModel;
      const list = models.includes(cur) || !cur ? models : [cur, ...models];
      if (list.length) {
        modelSetting.addDropdown(d => {
          for (const m of list) d.addOption(m, m);
          d.setValue(cur);
          d.onChange(async (v: string) => { this.plugin.settings.visionModel = v; await this.plugin.saveSettings(); this.plugin.reconnectVision(); showCaps(v); });
        });
      } else {
        modelSetting.addText(t => t.setPlaceholder("(Endpoint offline)").setValue(cur)
          .onChange(async (v: string) => { this.plugin.settings.visionModel = v.trim(); await this.plugin.saveSettings(); this.plugin.reconnectVision(); }));
        modelSetting.addButton(b => b.setButtonText("Modelle laden").onClick(() => this.display()));
      }
      showCaps(this.plugin.settings.visionModel);
    });

    // ── Prompt (große Textarea) ──
    new Setting(containerEl)
      .setName("Vision-Prompt")
      .setDesc("Anweisung an das Vision-Modell. Der Bild-Inhalt wird mitgeschickt.")
      .addTextArea(t => {
        t.setValue(this.plugin.settings.visionPrompt)
          .onChange(async (v: string) => { this.plugin.settings.visionPrompt = v; await this.plugin.saveSettings(); });
        t.inputEl.rows = 8;
        t.inputEl.addClass("img2md-prompt-textarea");
      });
  }
}
```

- [ ] **Step 2: `styles.css` ergänzen**

Hänge an `styles.css` an:

```css
/* Settings-QoL */
.img2md-prompt-textarea { width: 100%; min-height: 8rem; resize: vertical; }
.img2md-status-dot { margin-left: 8px; color: var(--text-muted); }
.img2md-status-dot.is-ok { color: var(--text-success); }
.img2md-status-dot.is-error { color: var(--text-error); }
.img2md-cap { display: inline-flex; align-items: center; gap: 4px; color: var(--text-muted); }
.img2md-cap .svg-icon { width: var(--icon-s); height: var(--icon-s); }
.img2md-cap.is-ok { color: var(--text-success); }
.img2md-cap.is-error { color: var(--text-error); }
```

- [ ] **Step 3: Typecheck + Tests grün**

Run: `npx tsc --noEmit && npm test`
Expected: tsc sauber; alle Tests PASS (Settings hat keine Unit-Tests — Regression-Gate für die übrigen 83+).

- [ ] **Step 4: Manueller Settings-Smoke**

`npm run build`, Artefakte ins Vault-Plugin-Verzeichnis kopieren, Obsidian neu laden, Plugin-Settings öffnen und prüfen:
- Prompt-Textarea ist groß (8 Zeilen) und vertikal resizebar.
- Endpoint-Zeile zeigt nach kurzem Moment „● verbunden"/„○ offline"; „Verbindung testen" aktualisiert.
- „Vision-Fähigkeit" zeigt ein Lucide-Icon + Text (z.B. „👁 Vision unbestätigt"); „Vision testen" gegen ein Vision-Modell setzt „Vision".
- Bei Offline-Endpoint erscheint „Modelle laden".
- **Icon-Check:** Erscheinen `eye`/`help-circle`/`alert-triangle`? Falls ein Icon leer bleibt, in `visionDisplay` (capabilities.ts) auf `circle-help`/`triangle-alert` ausweichen und Task-2-Test entsprechend anpassen.

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts styles.css
git commit -m "feat: Settings-QoL — große Prompt-Textarea, Verbindungs-Status + Test, Vision-Fähigkeit + aktiver Test

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Doc-Sync der Setting-Namen

**Files:**
- Modify: `README.md`, `README.de.md`, `docs/manual/reference.md`, `docs/manual/tutorial.md`, `docs/manual/how-to.md`, `docs/images/README.md`

**Interfaces:** keine (Doku). Die UI-Strings änderten sich in Task 4: „Vision Endpoint" → „Vision-Endpunkt", „Vision Modell" → „Vision-Modell", „Vision Prompt" → „Vision-Prompt". Das Heading „Vision (Image → Markdown)" bleibt.

- [ ] **Step 1: Alt-Vorkommen finden**

Run:
```bash
grep -rno 'Vision Endpoint\|Vision Modell\|Vision Prompt' README.md README.de.md docs/manual docs/images/README.md
```
Expected: mehrere Treffer (Config-Tabellen, Reference-Settings-Tabelle, Tutorial/How-to, Strings-Appendix).

- [ ] **Step 2: Ersetzen (exakte Strings, je Datei)**

In allen sechs Dateien ersetzen — exakt diese drei Strings (Reihenfolge egal):
- `Vision Endpoint` → `Vision-Endpunkt`
- `Vision Modell` → `Vision-Modell`
- `Vision Prompt` → `Vision-Prompt`

Nicht anfassen: das Heading `Vision (Image → Markdown)` und die Wörter „endpoint"/„model" in Fließtext-Glossen.

- [ ] **Step 3: Verifizieren**

Run:
```bash
grep -rn 'Vision Endpoint\|Vision Modell\|Vision Prompt' README.md README.de.md docs/manual docs/images/README.md; echo "exit=$?"
```
Expected: **keine** Treffer (grep `exit=1`). Gegencheck der neuen Namen:
```bash
grep -rno 'Vision-Endpunkt\|Vision-Modell\|Vision-Prompt' README.md docs/manual/reference.md | head
```
Expected: Treffer vorhanden.

- [ ] **Step 4: Commit**

```bash
git add README.md README.de.md docs/manual/reference.md docs/manual/tutorial.md docs/manual/how-to.md docs/images/README.md
git commit -m "docs: Setting-Namen auf DE-sentence-case angeglichen (Vision-Endpunkt/-Modell/-Prompt)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec-Coverage:** Slice 1 → Task 1. Slice 2 (`capabilities.ts`, `VisionClient`-Methoden, Tests) → Tasks 2+3. Slice 3 (Textarea, Status+Test, Vision-Fähigkeit+Test, „Modelle laden", DE-Naming, CSS) → Task 4. Doc-Sync → Task 5. `modelInfo` bewusst weggelassen (Spec-Entscheidung). Aktiver Vision-Test (Spec-Refinement) → Tasks 2+3+4. Alle DoD-Punkte abgedeckt.

**Type-Consistency:** `Confidence`, `visionConfidence`, `testVision(dataUrl)`, `resolveVision(meta, model)` (kein `live`), `visionDisplay`, `isVisionConfirmed`, `makeVisionTestImage`, `confirmedModels` durchgängig identisch in Tasks 2–4.

**Placeholder-Scan:** keine TBD/TODO; jeder Code-Step enthält vollständigen Code; Manual-Smoke ist explizit als nicht-automatisierbar markiert.
