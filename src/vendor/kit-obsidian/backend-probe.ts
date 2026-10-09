// vendored from obsidian-kit@0.51.3, src/obsidian/backend-probe.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
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
