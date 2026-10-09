// vendored from code-kit@0.15.0, src/ts/pure/backend-probe.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/* Backend-Erkennung mit Zwischenspeicher, pure — der Netzweg wird als `CapabilityFetch` injiziert
 * (Obsidians `requestUrl` läuft in einer Node-Umgebung nicht).
 *
 * Herkunft: kuro-gamification `src/llm/backendProbe.ts` (`createBackendProbe`), dort selbst
 * „uebernommen aus lingotuner/src/obsidian/http.ts (cachedProbe)". Dieselbe Bauart steht als
 * eigene Kopie in vault-crews, slide-deck, neurovim-obsidian, image-to-markdown, json-editor,
 * settings-assistant, yijing-oracle und vault-rag — eine Kopier-Kette, kein n=10 (Messung
 * kit-llm 2026-10-03, Diff des Masters).
 *
 * Drei Entscheidungen, die in den Kopien implizit waren:
 * - Das Ergebnis `"unknown"` wird mitgemerkt (so tut es kuro): ein Server, der gerade nicht
 *   antwortet, kostet höchstens eine Probe (bis zu vier Anfragen) je Frist, nicht je Aufruf.
 * - Der Schlüssel ist die URL, nicht das Modell: das Backend hängt am Server, nicht am Modell.
 *   Der Zwischenspeicher hält einen Eintrag je URL (die Kopien hielten nur den letzten — eine
 *   Failover-Liste mit zwei Endpunkten verdrängte sich dort gegenseitig und probte bei jedem
 *   Wechsel neu; Verhaltenswechsel, der nur Anfragen spart).
 * - Eine Sentinel-URL (`apple-shortcuts://on-device`) ist kein HTTP-Ziel: `null`, nie ein
 *   Netzzugriff, nichts gemerkt (lingotuner hatte den Guard, kuro nicht). */
import { probeBaseUrl, probeEndpoint, type CapabilityFetch } from "./capabilities";
import type { BackendId } from "./sampling-profiles";

export const BACKEND_CACHE_MS = 30_000;

export interface BackendProbeOptions {
  /** Gültigkeit eines Eintrags in Millisekunden. Default `BACKEND_CACHE_MS`. */
  cacheMs?: number;
  /** Uhr; Default `Date.now`. */
  now?: () => number;
}

export function createBackendProbe(
  fetchJson: CapabilityFetch,
  opts: BackendProbeOptions = {},
): (url: string, model: string) => Promise<BackendId | null> {
  const cacheMs = opts.cacheMs ?? BACKEND_CACHE_MS;
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { backend: BackendId; at: number }>();
  return async (url, model) => {
    if (!/^https?:/i.test(url)) return null;
    const t = now();
    const hit = cache.get(url);
    if (hit && t - hit.at < cacheMs) return hit.backend;
    const { backend } = await probeEndpoint(fetchJson, probeBaseUrl(url), model);
    cache.set(url, { backend, at: t });
    return backend;
  };
}
