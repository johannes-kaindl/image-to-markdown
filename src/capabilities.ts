// i2m-Adapter über das vendored Kit-Modul: projiziert die Vision-Achse heraus und übersetzt
// den plugin-eigenen HttpFetch in den vom Kit erwarteten CapabilityFetch.
// Reiner Kern: keine obsidian-/DOM-Imports (in Node testbar, PROF-OBS-03/04).

import { t } from "./i18n";
import type { HttpFetch } from "./vision_client";
import {
  type Capabilities, type CapabilityFetch, type Confidence,
  fetchCapabilities, resolveCapabilities,
} from "./vendor/kit/capabilities";

// Re-Export, damit vision_client.ts und settings.ts ihren Import nicht ändern müssen.
export type { Confidence };

/** Übersetzt den plugin-eigenen HttpFetch in die schmale Kit-Form: Status prüfen, Text parsen,
 *  bei allem anderen `null`. Das HTTP-Wissen bleibt damit im Plugin, wo es ohnehin sitzt. */
function asJsonFetch(http: HttpFetch, extraHeaders?: Record<string, string>): CapabilityFetch {
  return async (req) => {
    const r = await http(req.url, { method: req.method, headers: { ...req.headers, ...extraHeaders }, body: req.body });
    if (!r.ok) return null;
    try {
      return { json: JSON.parse(r.text) as unknown };
    } catch {
      return null;   // HTTP 200 mit nicht-JSON-Body (LM Studio antwortet so auf falsche Pfade)
    }
  };
}

/** Probiert native Capability-Endpoints gegen eine Basis-URL (OHNE /v1) und gibt nur die
 *  Vision-Achse zurück. http wird injiziert (Obsidian: requestUrl-Adapter; Tests: Mock). */
export async function fetchVisionCapability(
  http: HttpFetch, baseUrl: string, model: string, extraHeaders?: Record<string, string>,
): Promise<Confidence | null> {
  const caps = await fetchCapabilities(asJsonFetch(http, extraHeaders), baseUrl, model);
  return caps ? caps.vision : null;
}

/** Merge: Metadaten (falls vorhanden) gegen Namens-Heuristik, stärkere Confidence gewinnt.
 *  Hebt die Vision-Confidence in die Kit-Form und projiziert das Ergebnis zurück — der
 *  Thinking-Teil ist dabei belanglos, weil mergeCapability für Vision nur base.vision liest. */
export function resolveVision(meta: Confidence | null, model: string): Confidence {
  const base: Capabilities | null =
    meta === null ? null : { vision: meta, thinking: { support: "none", confidence: "no" } };
  return resolveCapabilities(base, model).vision;
}

/** UI-Display: Lucide-Icon-Name + Kurz-Text + State-Klasse. Bleibt plugin-lokal — hängt an
 *  i2ms t()-Katalog und an Lucide-Icon-Namen, ist also UI-Entscheidung, nicht Modell-Wissen. */
export function visionDisplay(c: Confidence): { icon: string; text: string; state: "ok" | "likely" | "error" } {
  if (c === "confirmed") return { icon: "eye", text: t("cap.confirmed"), state: "ok" };
  if (c === "likely") return { icon: "help-circle", text: t("cap.likely"), state: "likely" };
  return { icon: "alert-triangle", text: t("cap.none"), state: "error" };
}

// ── Aktiver Vision-Test (Bild-Erzeugung lebt in der DOM-Schicht settings.ts) ──
// Bewusst plugin-lokal: pur und generisch, aber mit n=1 noch kein Kit-Kandidat.
export const VISION_TEST_TOKEN = "VX7";
// Interne Vision-Probe (nicht nutzersichtbar) — bewusst EN-kanonisch, keine Lokalisierung.
export const VISION_TEST_PROMPT = "Output only the text in the image.";

/** true, wenn die Modell-Antwort das Token enthält (alphanumerisch normalisiert, case-insensitive). */
export function isVisionConfirmed(response: string, token: string = VISION_TEST_TOKEN): boolean {
  const n = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const t = n(token);
  return t.length > 0 && n(response).includes(t);
}
