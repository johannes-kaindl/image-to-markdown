// vendored from obsidian-kit@0.61.0, src/obsidian/backend-probe.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Backend-Erkennung für Obsidian: der `requestUrl`-Adapter für die pure Probe aus code-kit
 *  (`vendor/code-kit/pure/backend-probe`). Die Kopier-Kette, die hier endet, hieß in zehn
 *  Konsumenten `cachedProbe(url, model)` (Herkunft lingotuner `obsidian/http.ts`); der Adapter ist
 *  die Fassung von dort, gehoben. Der Zwischenspeicher gehört der Instanz — `createLlmConnection`
 *  nimmt je Verbindung eine eigene; `cachedProbe` ist die modulweite Instanz für Plugins, die nur
 *  die Probe wollen. */
import { requestUrl } from "obsidian";
import { createBackendProbe, type BackendProbeOptions } from "../kit/backend-probe";
import type { BackendId } from "../kit/sampling-profiles";
import type { CapabilityFetch } from "../kit/capabilities";
import { authHeaders } from "../kit/endpoint_config";
import { normalizeEndpoint } from "../kit/endpoint";
import { fetchModelContext, type ModelContext } from "../kit/model-context";
import type { TimeoutTimers } from "../kit/timeout";
import { realClock } from "./clock";

/** `null`, wenn die Antwort kein 2xx mit JSON ist — der Probe-Ablauf geht dann zum nächsten Versuch. */
export const requestUrlCapabilityFetch: CapabilityFetch = async (req) => {
  const res = await requestUrl({ url: req.url, method: req.method ?? "GET", ...(req.headers ? { headers: req.headers } : {}), ...(req.body !== undefined ? { body: req.body } : {}), throw: false });
  if (res.status < 200 || res.status >= 300) return null;
  try { return { json: JSON.parse(res.text) as unknown }; } catch { return null; }
};

/** Die Probe mit optionalem Schlüssel: ein Server mit Pflicht-Auth beantwortet `GET /api/v1/models` ohne
 *  `Authorization` nicht, das Backend bliebe `unknown`. Je Schlüssel eine eigene Instanz mit eigenem
 *  Zwischenspeicher, damit ein falscher Schlüssel kein gutes Ergebnis verdrängt (und umgekehrt). */
export function createObsidianBackendProbe(opts?: BackendProbeOptions): (url: string, model: string, apiKey?: string) => Promise<BackendId | null> {
  const byKey = new Map<string, ReturnType<typeof createBackendProbe>>();
  return (url, model, apiKey) => {
    const key = apiKey?.trim() ?? "";
    let probe = byKey.get(key);
    if (!probe) {
      const auth = authHeaders(key);
      probe = createBackendProbe(key === "" ? requestUrlCapabilityFetch : (req) => requestUrlCapabilityFetch({ ...req, headers: { ...auth, ...(req.headers ?? {}) } }), opts);
      byKey.set(key, probe);
    }
    return probe(url, model);
  };
}

export const cachedProbe = createObsidianBackendProbe();

/** Kontextlänge eines Modells am Endpunkt (`fetchModelContext` aus code-kit) mit den Obsidian-Anschlüssen:
 *  `requestUrl` als Transport, der Schlüssel als `Authorization: Bearer` (sonst bleibt ein Server mit Pflicht-Auth
 *  stumm), die Fenster-Timer für die Frist (5 s je Versuch). `url` darf mit `/v1` enden (`normalizeEndpoint`).
 *  Ohne Modell `null` ohne Anfrage; wirft nie, `null` heißt „der Endpunkt nennt sie nicht“. Mit `effectiveContext`
 *  (code-kit) wird daraus die eine Zahl.
 *
 *  Herkunft: die Hülle in `endpoint-plumbing` (`modelContext.load`), gehoben, damit Plugins, die die Kontextlänge
 *  außerhalb der Endpunkt-Liste brauchen (slide-deck Generate-Ansicht, vault-crews Orchestrator), sie nicht
 *  nachbauen. Die Optionen sind für Tests und Sonderfälle; `fetch` bekommt die Header schon eingemischt.
 *  Ohne `timers` gelten die Fenster-Timer: in einem Node-Test ohne `window` `timers` übergeben oder
 *  `installWindowTimers()` (`testing/window-timers`) im Setup — sonst fängt das stille `null` den Fehler. */
export function fetchEndpointContext(
  url: string,
  model: string,
  apiKey?: string,
  opts?: { timers?: TimeoutTimers; timeoutMs?: number; fetch?: CapabilityFetch },
): Promise<ModelContext | null> {
  const base = opts?.fetch ?? requestUrlCapabilityFetch;
  const auth = authHeaders(apiKey);
  return fetchModelContext(
    (req) => base({ ...req, headers: { ...auth, ...(req.headers ?? {}) } }),
    normalizeEndpoint(url),
    model.trim(),
    { timers: opts?.timers ?? realClock, ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}) },
  );
}
