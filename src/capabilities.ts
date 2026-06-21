// Vision-Capability-Detektion — vision-only-Adaptation von vault-rag/src/capabilities.ts.
// Reiner Kern: keine obsidian-/DOM-Imports (in Node testbar, PROF-OBS-03/04).

import { t } from "./i18n";

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
  if (c === "confirmed") return { icon: "eye", text: t("cap.confirmed"), state: "ok" };
  if (c === "likely") return { icon: "help-circle", text: t("cap.likely"), state: "likely" };
  return { icon: "alert-triangle", text: t("cap.none"), state: "error" };
}

// ── Aktiver Vision-Test (Bild-Erzeugung lebt in der DOM-Schicht settings.ts) ──
export const VISION_TEST_TOKEN = "VX7";
// Interne Vision-Probe (nicht nutzersichtbar) — bewusst EN-kanonisch, keine Lokalisierung.
export const VISION_TEST_PROMPT = "Output only the text in the image.";

/** true, wenn die Modell-Antwort das Token enthält (alphanumerisch normalisiert, case-insensitive). */
export function isVisionConfirmed(response: string, token: string = VISION_TEST_TOKEN): boolean {
  const n = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const t = n(token);
  return t.length > 0 && n(response).includes(t);
}
