// uebernommen aus lingotuner/src/obsidian/http.ts (fetchJsonAdapter/cachedProbe), 2026-09-30
import { requestUrl } from "obsidian";
import type { HttpFetch } from "./vision_client";
import { type CapabilityFetch, probeEndpoint as probeBackend, probeBaseUrl } from "./vendor/kit/capabilities";
import type { BackendId } from "./vendor/kit/sampling-profiles";

/** Obsidian-Transport-Adapter: erfüllt HttpFetch über requestUrl (CORS-/Mobil-tauglich, keine
 *  no-restricted-globals-Verstöße). Wird in main.ts via setHttp() in den reinen Kern injiziert. */
export const obsidianHttp: HttpFetch = async (url, init) => {
  const r = await requestUrl({
    url,
    method: init?.method ?? "GET",
    headers: init?.headers,
    body: init?.body,
    throw: false,
  });
  return { ok: r.status >= 200 && r.status < 300, status: r.status, text: r.text };
};

/** `CapabilityFetch` (Kit) über `requestUrl`: Status ≠ 2xx oder nicht parsebares JSON → `null`,
 *  damit ein Probe-Schritt „kein Treffer" meldet statt zu werfen. */
export const fetchJsonAdapter: CapabilityFetch = async (req) => {
  const res = await requestUrl({ url: req.url, method: req.method ?? "GET", headers: req.headers, body: req.body, throw: false });
  if (res.status < 200 || res.status >= 300) return null;
  try { return { json: JSON.parse(res.text) as unknown }; } catch { return null; }
};

const BACKEND_CACHE_MS = 30_000;
let backendCache: { url: string; backend: BackendId; at: number } | null = null;

/** Welches Backend hinter einer URL steckt — 30 s je URL zwischengespeichert (dieselbe Regel wie der
 *  Modelllisten-Cache), bei Änderung der URL verworfen. Spec Sampling-Profile § 3.1. */
export async function cachedProbe(url: string, model: string): Promise<BackendId | null> {
  const now = Date.now();
  if (backendCache && backendCache.url === url && now - backendCache.at < BACKEND_CACHE_MS) return backendCache.backend;
  const { backend } = await probeBackend(fetchJsonAdapter, probeBaseUrl(url), model);
  backendCache = { url, backend, at: now };
  return backend;
}
