// vendored from obsidian-kit@0.89.0, src/obsidian/endpoint-plumbing.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Die Verdrahtung der lokalen Endpunkt-Liste, die `createLlmConnection` (Chat) und `createLlmConnection` mit
 *  `capability: "embedding"` gemeinsam brauchen: der synchrone `persist`-Wächter, Erreichbarkeit und Modellliste einer Zeile
 *  (`GET /v1/models`, 5 s), die hydrierte Kopie mit Schlüssel und die Modellwahl eines Panels. Eigenes Modul statt zwei
 *  Kopien (Bibliothek ab Eins). Origin: der Block in `llm-connection.ts` bis 0.53.0. */
import { requestUrl, type App } from "obsidian";
import { normalizeEndpoint } from "../kit/endpoint";
import { errorMessage } from "../kit/error-message";
import { applyEndpointEdit, authHeaders, type EndpointConfig } from "../kit/endpoint_config";
import { classifyEndpointStatus, extractModelIds, type EndpointStatus } from "../kit/endpoint_diagnostics";
import type { ModelListClient, ModelListResult } from "../kit/model-list-cache";
import type { CapabilityFetch } from "../kit/capabilities";
import type { ModelContext } from "../kit/model-context";
import type { EndpointChoice, EndpointSourceResult, LlmEndpointManagerApi } from "../kit/endpoint-source";
import type { ClockPort } from "./clock";
import { fetchEndpointContext } from "./backend-probe";
import { hydrateLocalEndpoints } from "./endpoint-secrets";
import { findEndpointManager } from "./endpoint-source";

const PROBE_TIMEOUT_MS = 5_000;

/** Die Modelle eines Manager-Endpunkts mit Erreichbarkeit, wirft nie. Mit `api.modelList` (additiv in API v1, optional) kommt `reachable` vom Manager: ein gestoppter Server ist `{ models: [], reachable: false }`, ein Server
 *  ohne Liste `{ models: [], reachable: true }`. Die Antwort wird der Form nach geprüft (`models` ein Array aus Strings, `reachable` ein Boolean); alles andere, ein `ApiError` und ein Wurf sind `{ models: [], reachable: false }`.
 *  Ohne `modelList` der Rückfall wie bisher: `api.models(id)`, jede Liste gilt als `reachable: true` (der Manager trennt Offline dort nicht von „keine Liste“, Spec § 4.7). `force` geht in beiden Fällen mit. */
export async function managerModelList(api: LlmEndpointManagerApi, id: string, opts?: { force?: boolean }): Promise<ModelListResult> {
  const args = opts?.force ? { force: true } : undefined;
  try {
    if (typeof api.modelList === "function") {
      const r: unknown = await api.modelList(id, args);
      const o = r !== null && typeof r === "object" ? r as { models?: unknown; reachable?: unknown } : null;
      if (o && Array.isArray(o.models) && o.models.every((m) => typeof m === "string") && typeof o.reachable === "boolean") return { models: [...o.models], reachable: o.reachable };
      return { models: [], reachable: false };
    }
    const list = await api.models(id, args);
    return "error" in list ? { models: [], reachable: false } : { models: list, reachable: true };
  } catch { return { models: [], reachable: false }; }
}

/** Was die Verdrahtung von den Settings des Plugins braucht (Chat und Embedding tragen beide diese Felder). */
export interface PlumbingSettings { endpoints: EndpointConfig[]; choice?: EndpointChoice }

export interface EndpointPlumbingOptions<S extends PlumbingSettings> {
  app: App;
  pluginId: string;
  clock: ClockPort;
  getSettings(): S;
  persist(patch: Partial<S>): Promise<void>;
  probe?: (cfg: EndpointConfig) => Promise<boolean>;
  listModels?: (cfg: EndpointConfig) => Promise<string[]>;
  /** Transport für die Kontextlänge (Default: `requestUrlCapabilityFetch`; die Header der Zeile mischt die Hülle ein). */
  contextFetch?: CapabilityFetch;
}

/** Kontextlänge je Zeile, gemerkt je (URL, Modell) — ein Zwischenspeicher der Verbindung, nicht des Zeichnens
 *  (`renderSettings` leert seinen Container und ruft die Liste neu). */
export interface EndpointContextSource {
  /** `opts.provider: "anthropic"` (seit 0.70.0) fragt die Models-API von Anthropic (`x-api-key`, eine Anfrage; siehe `fetchEndpointContext`). Wer `source.transport === "anthropic"`
   *  aus dem Verbindungsmanager kennt, reicht es durch; die Endpunkt-Liste ruft `load(cfg)` ohne Optionen (LM Studio, Ollama) und zeigt bei Claude keine Zahl. Der Anbieter steht im
   *  Zwischenspeicher-Schlüssel: derselbe Endpunkt mit und ohne Anbieter teilt keinen Eintrag. */
  load(cfg: EndpointConfig, opts?: { provider?: "anthropic" | undefined }): Promise<ModelContext | null>;
  /** Vergisst alle Einträge der URL (Knopf „Modelle neu laden“). */
  invalidate(cfg: EndpointConfig): void;
  clear(): void;
}

export interface EndpointPlumbing<S extends PlumbingSettings> {
  /** `persist` MUSS den Patch synchron übernehmen, bevor es speichert: die Endpunkt-Liste liest ihre Zeilen gleich danach
   *  über `getSettings()` zurück. Diese Hülle prüft, ob der Patch sofort sichtbar ist, und wirft sonst einen Hinweis. */
  persist: (patch: Partial<S>) => Promise<void>;
  probeOf: (cfg: EndpointConfig) => Promise<boolean>;
  listOf: (cfg: EndpointConfig) => Promise<string[]>;
  clientFor: (cfg: EndpointConfig) => { probe(): Promise<EndpointStatus> } & ModelListClient;
  /** Modellwahl eines Panels (`setModel`): Manager → nur `choice.model` (bindet den aktiven Endpunkt; bei `orphaned` auch eine verwaiste Wahl um); lokal → Modell der aktiven Zeile. */
  applyModel: (m: string, resolve: (opts?: { force?: boolean }) => Promise<EndpointSourceResult>, activeId?: string, orphaned?: boolean) => Promise<void>;
  /** Kontextlänge des Zeilen-Modells (`model-context`): mit dem Schlüssel der Zeile, 5 s je Versuch, nie ein Fehler. */
  modelContext: EndpointContextSource;
}

export function createEndpointPlumbing<S extends PlumbingSettings>(o: EndpointPlumbingOptions<S>): EndpointPlumbing<S> {
  function persist(patch: Partial<S>): Promise<void> {
    const p = o.persist(patch);
    const now = o.getSettings();
    for (const key of Object.keys(patch) as (keyof S)[]) {
      if (JSON.stringify(now[key]) !== JSON.stringify(patch[key])) {
        void p.catch(() => undefined);
        throw new Error(
          `createLlmConnection: persist() hat „${String(key)}“ nicht synchron übernommen — getSettings() liefert nach dem Aufruf noch den alten Wert. `
          + "Den Patch in die Settings schreiben, BEVOR gespeichert wird (await erst danach).",
        );
      }
    }
    return p;
  }

  async function fetchStatus(cfg: EndpointConfig): Promise<{ status: EndpointStatus; ids: string[] }> {
    // `normalizeEndpoint` streicht ein `/v1` am Ende — die OpenAI-kompatible Liste liegt aber unter `/v1/models`.
    // Ohne das Präfix antwortet LM Studio mit 200 und einem Fehlerkörper, Ollama mit 404; beides las
    // `classifyEndpointStatus` als „not-an-llm-api“ und jede lokale Zeile galt als unerreichbar (3d-codeblocks, 2026-10-04).
    const request = requestUrl({ url: `${normalizeEndpoint(cfg.url)}/v1/models`, headers: authHeaders(cfg.apiKey), throw: false });
    const timeout = new Promise<"timeout">((resolve) => { o.clock.setTimeout(() => resolve("timeout"), PROBE_TIMEOUT_MS); });
    try {
      const res = await Promise.race([request, timeout]);
      if (res === "timeout") return { status: classifyEndpointStatus({ kind: "timeout" }), ids: [] };
      let body: unknown = null;
      try { body = res.json; } catch { body = null; }
      const status = classifyEndpointStatus({ kind: "response", status: res.status, body });
      return { status, ids: status.reachable ? extractModelIds(body) : [] };
    } catch (e) {
      return { status: classifyEndpointStatus({ kind: "error", message: errorMessage(e) }), ids: [] };
    }
  }
  const probeOf = o.probe ?? (async (cfg: EndpointConfig) => (await fetchStatus(cfg)).status.reachable);
  const listOf = o.listModels ?? (async (cfg: EndpointConfig) => (await fetchStatus(cfg)).ids);
  const hydrated = (cfg: EndpointConfig): EndpointConfig => hydrateLocalEndpoints(o.app, o.pluginId, [cfg])[0] ?? cfg;
  const clientFor = (cfg: EndpointConfig): { probe(): Promise<EndpointStatus> } & ModelListClient => {
    const h = hydrated(cfg);
    return {
      listModels: () => listOf(h),
      probe: async (): Promise<EndpointStatus> => (o.probe
        ? ((await o.probe(h))
          ? { reachable: true, kind: "ok", klartext: "" }
          : { reachable: false, kind: "unknown", klartext: "" })
        : (await fetchStatus(h)).status),
    };
  };

  /** `activeId` (seit 0.87.0): der Endpunkt, den die Verbindung gerade benutzt. Mit Manager bindet die Modellwahl ihn, wenn die Wahl noch keinen Endpunkt trägt:
   *  ein Modellname gilt nur auf seinem Endpunkt (Spec § 4.10). Eine gespeicherte Wahl mit Endpunkt behält ihn; eine Alt-Wahl `{ model }` wird nur durch eine NEUE Wahl
   *  umgeschrieben, nie beim Laden. Ist der aktive Endpunkt unbekannt (vor der ersten Auflösung, ohne `config`, ohne brauchbare `id`), bleibt es bei der Wahl, wie sie ist.
   *  `orphaned` (Welle 34, Paket 11): die zuletzt gezeigte Auflösung trug einen `reason` UND ein `config` — die Wahl nannte einen Endpunkt, den der Manager nicht mehr liefert (abgeschaltet, gelöscht,
   *  ohne Schlüssel), und er hat automatisch einen anderen aufgelöst. Dann schreibt die NEUE Wahl des Nutzers auf den aktiven um (`endpointId: activeId`), dieselbe Regel wie das Binden einer Wahl
   *  ohne Endpunkt: das Modell wurde aus der Liste des aktiven gewählt, und ein Modellname gilt nur dort. Vorher blieb die tote Kennung stehen und die Wahl wirkte nie. */
  async function applyModel(m: string, resolve: (opts?: { force?: boolean }) => Promise<EndpointSourceResult>, activeId?: string, orphaned = false): Promise<void> {
    if (findEndpointManager(o.app)) {
      const { model: _old, ...rest } = o.getSettings().choice ?? {};
      const bound = activeId !== undefined && (rest.endpointId === undefined || orphaned) ? { ...rest, endpointId: activeId } : rest;
      await persist({ choice: m ? { ...bound, model: m } : bound } as Partial<S>);
      await resolve({ force: true });
      return;
    }
    const active = (await resolve()).config;
    if (!active) return;
    // Zeilen erst NACH dem Auflösen lesen und im selben synchronen Zug schreiben (`persist`-Vertrag).
    const eps = o.getSettings().endpoints;
    const i = active.id !== undefined
      ? eps.findIndex((e) => e.id === active.id)
      : eps.findIndex((e) => normalizeEndpoint(e.url) === normalizeEndpoint(active.url));
    if (i < 0) return;
    await persist({ endpoints: applyEndpointEdit(eps, i, "model", m, false) } as Partial<S>);
    await resolve({ force: true });
  }

  // Die Hülle (Schlüssel als Header, Timer) liegt in `backend-probe.fetchEndpointContext`; hier nur Cache und `invalidate`.
  const contextCache = new Map<string, Promise<ModelContext | null>>();
  // URL zuerst: `invalidate` löscht nach dem Präfix `URL\n`, auch die Einträge je Anbieter.
  const contextKey = (cfg: EndpointConfig, provider?: "anthropic"): string => `${normalizeEndpoint(cfg.url)}\n${cfg.model?.trim() ?? ""}\n${provider ?? ""}`;
  const modelContext: EndpointContextSource = {
    load: (cfg, loadOpts) => {
      const provider = loadOpts?.provider === "anthropic" ? "anthropic" as const : undefined;
      const key = contextKey(cfg, provider);
      let hit = contextCache.get(key);
      if (!hit) {
        hit = fetchEndpointContext(cfg.url, cfg.model ?? "", hydrated(cfg).apiKey, { timers: o.clock, ...(o.contextFetch ? { fetch: o.contextFetch } : {}), ...(provider ? { provider } : {}) });
        contextCache.set(key, hit);
      }
      return hit;
    },
    invalidate: (cfg) => {
      const prefix = `${normalizeEndpoint(cfg.url)}\n`;
      for (const k of [...contextCache.keys()]) if (k.startsWith(prefix)) contextCache.delete(k);
    },
    clear: () => { contextCache.clear(); },
  };

  return { persist, probeOf, listOf, clientFor, applyModel, modelContext };
}
