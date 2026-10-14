// vendored from obsidian-kit@0.60.1, src/obsidian/embedding-connection.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Die Embedding-Anbindung eines Fachplugins (`createLlmConnection({ capability: "embedding" })`): Endpunkt-Quelle (Manager oder
 *  lokale Liste mit Schlüsselbund), gemerkte Auflösung mit Index-Passung, Modellliste, ein `Embedder` (code-kit) und der
 *  Settings-Abschnitt für Quelle und Liste. Schmaler als die Chat-Verbindung: kein Modus, kein Anfrage-Abschnitt, kein Streaming,
 *  kein Sampling.
 *
 *  **Auswahl der lokalen Liste in Durchgängen** (Zustand der Auflösung in Klammern):
 *  1. erste Zeile, die erreichbar ist, ein Modell trägt und `accept` besteht → `active`;
 *  2. sonst die erste erreichbare mit Modell — der bewusste Modellwechsel gewinnt (`skipped-model`, `skipped` nennt jede
 *     erreichbare Zeile, die `accept` abgelehnt hat);
 *  3. sonst die erste erreichbare ohne Modell (`no-model`; sie ist nie `active`, ein leeres Modell würde `embedding_model: ""`
 *     stempeln und den Modell-Guard abschalten);
 *  4. sonst keine (`no-endpoint`).
 *  Mit Manager entscheidet der Manager auch über „kein Endpunkt“ (kein Rückfall auf die lokale Liste); `accept` wirkt dort
 *  nur als Zustand, nicht als Kandidatenwahl (ein Eintrag).
 *
 *  `accept(cfg, model)` ist eine Closure des Plugins über den Index-Stand (`manifest.embedding_model`): das Kit kennt den
 *  Index nicht. `model` ist das Modell der Zeile bzw. beim Manager die aufgelöste Schreibweise (`sentModel`, nie `config.model`
 *  des Managers). Ein leeres Modell fragt `accept` nicht.
 *
 *  `embedder()` liefert EINE stabile Fassade (der `LiveIndexer` hält sie per Referenz): jeder `embed`-Aufruf nimmt die gemerkte
 *  Auflösung, baut den Client neu, sobald sich Endpunkt, Schlüssel oder Modell geändert haben, und WIRFT `EmbeddingError`
 *  Kind `no-endpoint` ohne nutzbaren Endpunkt (kein leeres Ergebnis: der Aufrufer läse `[]` als leere Antwort). Der Client
 *  entsteht nie ohne aufgelösten Endpunkt (code-kit schickte sonst eine relative URL an den Transport).
 *
 *  Grenze von `requestUrl`: weder Frist noch Abbruch. Der Client hört auf zu WARTEN, die Anfrage läuft im Hintergrund zu Ende
 *  und ihre Antwort verfällt. Schlüssel: nur im Schlüsselbund (`hydrateLocalEndpoints`); hydrierte Kopien gehen nie in `persist`.
 *
 *  Vertrag an `persist`: es übernimmt den Patch SYNCHRON in die Settings (wie bei der Chat-Verbindung). */
import { requestUrl, Setting, type App } from "obsidian";
import { normalizeEndpoint } from "../kit/endpoint";
import type { EndpointConfig } from "../kit/endpoint_config";
import { createModelListCache, type ModelListResult } from "../kit/model-list-cache";
import { createEmbeddingClient, EmbeddingError, type EmbedTransport, type Embedder } from "../kit/embeddings-client";
import type { TimeoutTimers } from "../kit/timeout";
import { resolveEndpointSource, type EndpointChoice, type EndpointSourceResult, type LlmEndpointManagerApi } from "../kit/endpoint-source";
import { realClock, type ClockPort } from "./clock";
import { buildEndpointList } from "./endpoint-list";
import { prepareLocalEndpoints } from "./endpoint-secrets";
import { createEndpointPlumbing } from "./endpoint-plumbing";
import { buildEndpointSourceSection, findEndpointManager } from "./endpoint-source";
import { LLM_CONNECTION_STRINGS_DE, LLM_CONNECTION_STRINGS_EN, resolveLlmConnectionStrings, type LlmConnectionStringsOverride } from "./llm-connection-strings";
import type { LlmConnectionStrings } from "./llm-connection";

export interface EmbeddingConnectionSettings { endpoints: EndpointConfig[]; choice?: EndpointChoice }

/** `true` = die Zeile passt zum Index; sonst der Text für die Anzeige („Index: <modell>“). */
export type EmbeddingAccept = true | { skip: string };

export interface EmbeddingConnectionOptions {
  app: App;
  pluginId: string;
  caller: string;
  capability: "embedding";
  getSettings(): EmbeddingConnectionSettings;
  persist(patch: Partial<EmbeddingConnectionSettings>): Promise<void>;
  /** Erreichbarkeit einer lokalen Zeile (Default: `GET /v1/models`, 5 s). Wird nur ohne Manager gerufen. */
  probe?: (cfg: EndpointConfig) => Promise<boolean>;
  /** Modell-Ids einer lokalen Zeile (Default: `GET /v1/models`). */
  listModels?: (cfg: EndpointConfig) => Promise<string[]>;
  /** Zeigt in der lokalen Endpunkt-Liste unter jeder erreichbaren Zeile mit Modell die Kontextlänge („geladen N · max M“),
   *  wenn der Server sie nennt (LM Studio, Ollama). Default an; `false` schaltet sie ab. */
  contextLength?: boolean;
  managerOnly?: boolean;
  /** Index-Passung (Closure über den Index-Stand des Plugins). Fehlt sie, passt jede Zeile mit Modell. */
  accept?: (cfg: EndpointConfig, model: string) => EmbeddingAccept;
  embed?: {
    /** Texte je Anfrage (Default 32). */
    batchSize?: number;
    /** Frist je Anfrage in ms (nur mit Timern wirksam; `clock` ist der Default-Timer). */
    requestTimeoutMs?: number;
    /** Default: `requestUrl` (kein Abbruch, siehe Modulkopf). */
    transport?: EmbedTransport;
    timers?: TimeoutTimers;
  };
  lang?: "en" | "de" | (() => "en" | "de");
  /** Nach jeder abgeschlossenen Auflösung (wie bei der Chat-Verbindung). */
  onResolved?: (result: EmbeddingResolution) => void;
  clock?: ClockPort;
}

export type EmbeddingRowState = "active" | "standby" | "unreachable" | "skipped-model" | "no-model";

export interface EmbeddingSkipped { cfg: EndpointConfig; model: string; reason: string }

export interface EmbeddingResolution {
  /** `source.sentModel` ist, was gesendet wird. */
  source: EndpointSourceResult;
  state: "active" | "skipped-model" | "no-model" | "no-endpoint";
  /** Erreichbare Zeilen, die `accept` abgelehnt hat (in Listenreihenfolge), mit seinem Text. */
  skipped: EmbeddingSkipped[];
}

export interface EmbeddingConnection {
  resolve(opts?: { force?: boolean }): Promise<EmbeddingResolution>;
  invalidate(): void;
  models(opts?: { force?: boolean }): Promise<ModelListResult>;
  /** Zustand je Zeile der lokalen Liste (Reihenfolge der Liste). Sondiert jede Zeile; ohne Manager. */
  rowStates(): Promise<EmbeddingRowState[]>;
  /** Stabile Fassade; wirft `EmbeddingError` Kind `no-endpoint` ohne nutzbaren Endpunkt. */
  embedder(): Embedder;
  setModel(model: string): Promise<void>;
  modelInUse(): string;
  renderSettings(containerEl: HTMLElement, strings?: LlmConnectionStrings | LlmConnectionStringsOverride): void;
  hideSettings(): void;
}

const requestUrlEmbedTransport: EmbedTransport = async (req) => {
  const res = await requestUrl({ url: req.url, method: req.method, headers: req.headers, body: req.body, throw: false });
  let json: unknown = null;
  try { json = res.json; } catch { json = null; }
  return { status: res.status, json };
};

const NEUTRAL_SOURCE = (): EndpointSourceResult => ({
  kind: "local", config: null, model: "", family: null, familySource: "none", backend: "unknown", backendSource: "none", sentModel: "",
});

export function createEmbeddingConnection(o: EmbeddingConnectionOptions): EmbeddingConnection {
  const clock = o.clock ?? realClock;
  const plumbing = createEndpointPlumbing<EmbeddingConnectionSettings>({
    app: o.app, pluginId: o.pluginId, clock, getSettings: () => o.getSettings(), persist: (patch) => o.persist(patch),
    ...(o.probe ? { probe: o.probe } : {}), ...(o.listModels ? { listModels: o.listModels } : {}),
  });
  const { persist, probeOf, listOf, clientFor } = plumbing;
  const modelCache = createModelListCache();
  const settingsCache = createModelListCache();
  const modelOfRow = (cfg: EndpointConfig): string => cfg.model?.trim() ?? "";
  const accepts = (cfg: EndpointConfig, model: string): EmbeddingAccept => (o.accept ? o.accept(cfg, model) : true);

  // ── Auflösung ──────────────────────────────────────────────────────────────────────────────
  let pending: Promise<EmbeddingResolution> | null = null;
  let last: EmbeddingResolution | null = null;
  let shown: EmbeddingResolution | null = null;
  let freshSinceInvalidate = false;
  let lastManagerEntry: string | undefined;
  let pendingModel: string | null = null;

  async function resolveManager(manager: LlmEndpointManagerApi, s: EmbeddingConnectionSettings): Promise<EmbeddingResolution> {
    const src = await resolveEndpointSource({
      manager, local: [], capability: "embedding", caller: o.caller, ...(s.choice ? { choice: s.choice } : {}),
    }, () => Promise.resolve(false));
    const entries = manager.list({ capability: "embedding" });
    lastManagerEntry = s.choice?.endpointId && entries.some((e) => e.id === s.choice?.endpointId) ? s.choice.endpointId : entries[0]?.id;
    if (!src.config) return { source: src, state: "no-endpoint", skipped: [] };
    const model = (src.sentModel || src.model).trim();
    if (model === "") return { source: src, state: "no-model", skipped: [] };
    if (!(await probeOf(src.config).catch(() => false))) {
      return { source: { ...src, config: null, reason: "unreachable" }, state: "no-endpoint", skipped: [] };
    }
    const verdict = accepts(src.config, model);
    return verdict === true
      ? { source: src, state: "active", skipped: [] }
      : { source: src, state: "skipped-model", skipped: [{ cfg: src.config, model, reason: verdict.skip }] };
  }

  async function resolveLocal(s: EmbeddingConnectionSettings): Promise<EmbeddingResolution> {
    const local = o.managerOnly ? [] : prepareLocalEndpoints({
      app: o.app, pluginId: o.pluginId, list: s.endpoints, persist: (list) => persist({ endpoints: list }),
    });
    // Je Auflösung einmal sondieren, auch über die Durchgänge hinweg.
    const probed = new Map<string, Promise<boolean>>();
    const reachable = (cfg: EndpointConfig): Promise<boolean> => {
      const key = `${cfg.id ?? ""}\n${normalizeEndpoint(cfg.url)}`;
      let p = probed.get(key);
      if (!p) { p = probeOf(cfg).catch(() => false); probed.set(key, p); }
      return p;
    };
    const skipped: EmbeddingSkipped[] = [];
    const pass = (accept: (cfg: EndpointConfig) => Promise<boolean>): Promise<EndpointSourceResult> => resolveEndpointSource(
      { local, capability: "embedding", caller: o.caller }, accept);

    const first = await pass(async (cfg) => {
      const model = modelOfRow(cfg);
      if (!(await reachable(cfg))) return false;
      if (model === "") return false;
      const verdict = accepts(cfg, model);
      if (verdict === true) return true;
      skipped.push({ cfg, model, reason: verdict.skip });
      return false;
    });
    if (first.config) return { source: first, state: "active", skipped };

    const second = await pass(async (cfg) => modelOfRow(cfg) !== "" && (await reachable(cfg)));
    if (second.config) {
      // `skipped` hat aus dem ersten Durchgang nur die Zeilen VOR einem Treffer; hier gab es keinen — alle erreichbaren mit Modell.
      return { source: second, state: "skipped-model", skipped };
    }
    const third = await pass(reachable);
    if (third.config) return { source: third, state: "no-model", skipped };
    return { source: third, state: "no-endpoint", skipped };
  }

  async function resolveNow(): Promise<EmbeddingResolution> {
    const s = o.getSettings();
    const manager = findEndpointManager(o.app);
    return manager ? resolveManager(manager, s) : resolveLocal(s);
  }

  function resolve(opts?: { force?: boolean }): Promise<EmbeddingResolution> {
    const manager = findEndpointManager(o.app);
    // Der Manager wird nie gemerkt (er kann jederzeit deaktiviert werden); „kein Endpunkt“ ebenso nicht.
    if (!opts?.force && !manager && last !== null && last.source.kind !== "manager") return Promise.resolve(last);
    if (!opts?.force && pending !== null) return pending;
    const p = resolveNow().then((r) => {
      if (pending === p) {
        pending = null;
        last = r.source.config !== null ? r : null;
        shown = r;
        freshSinceInvalidate = true;
        try { o.onResolved?.(r); } catch { /* ein Fehler im UI-Callback darf die Auflösung nicht scheitern lassen */ }
      }
      return r;
    }, (e: unknown) => { if (pending === p) pending = null; throw e; });
    pending = p;
    return p;
  }
  function invalidate(): void {
    pending = null; last = null; freshSinceInvalidate = false; modelCache.clear(); settingsCache.clear();
  }

  // ── Modellliste und Zustände ───────────────────────────────────────────────────────────────
  async function models(opts?: { force?: boolean }): Promise<ModelListResult> {
    const r = (await resolve()).source;
    if (r.kind === "manager") {
      const api = findEndpointManager(o.app);
      const id = lastManagerEntry;
      if (!api || !id) return { models: [], reachable: false };
      try {
        const list = await api.models(id, opts?.force ? { force: true } : undefined);
        return "error" in list ? { models: [], reachable: false } : { models: list, reachable: true };
      } catch { return { models: [], reachable: false }; }
    }
    if (!r.config) return { models: [], reachable: false };
    const key = normalizeEndpoint(r.config.url);
    if (opts?.force) modelCache.invalidate(key);
    const cfg = r.config;
    return modelCache.load(key, { listModels: () => listOf(cfg), probe: async () => ({ reachable: await probeOf(cfg) }) });
  }

  async function rowStates(): Promise<EmbeddingRowState[]> {
    const rows = o.managerOnly || findEndpointManager(o.app) ? [] : o.getSettings().endpoints;
    const r = await resolve();
    const active = r.state === "active" ? r.source.config : null;
    return Promise.all(rows.map(async (row): Promise<EmbeddingRowState> => {
      const model = modelOfRow(row);
      if (!(await probeOf(row).catch(() => false))) return "unreachable";
      if (model === "") return "no-model";
      if (accepts(row, model) !== true) return "skipped-model";
      const isActive = active !== null && (active.id !== undefined ? active.id === row.id : normalizeEndpoint(active.url) === normalizeEndpoint(row.url));
      return isActive ? "active" : "standby";
    }));
  }

  // ── Embedder ───────────────────────────────────────────────────────────────────────────────
  let client: { key: string; embedder: Embedder } | null = null;
  const embedder: Embedder = {
    async embed(texts, opts) {
      const r = await resolve();
      const cfg = r.source.config;
      const model = (pendingModel ?? (r.source.sentModel || r.source.model)).trim();
      if (!cfg || r.state === "no-endpoint") throw new EmbeddingError("no-endpoint", `Embedding: no endpoint (${r.source.reason ?? "no-endpoint"})`);
      if (model === "") throw new EmbeddingError("no-endpoint", "Embedding: no model chosen");
      const key = `${normalizeEndpoint(cfg.url)}\n${cfg.apiKey ?? ""}\n${model}`;
      if (!client || client.key !== key) {
        const e = o.embed ?? {};
        client = {
          key,
          embedder: createEmbeddingClient({
            endpoint: cfg.url, model, ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}),
            transport: e.transport ?? requestUrlEmbedTransport,
            ...(e.batchSize !== undefined ? { batchSize: e.batchSize } : {}),
            ...(e.requestTimeoutMs !== undefined ? { requestTimeoutMs: e.requestTimeoutMs, timers: e.timers ?? clock } : {}),
          }),
        };
      }
      return client.embedder.embed(texts, opts);
    },
  };

  async function setModel(m: string): Promise<void> {
    pendingModel = m;
    try { await plumbing.applyModel(m, async (opts) => (await resolve(opts)).source); }
    finally { if (pendingModel === m) pendingModel = null; }
  }
  const modelInUse = (): string => pendingModel ?? (shown ?? { source: NEUTRAL_SOURCE() }).source.model;

  // ── Settings ───────────────────────────────────────────────────────────────────────────────
  function renderSettings(containerEl: HTMLElement, input?: LlmConnectionStrings | LlmConnectionStringsOverride): void {
    const strings = resolveLlmConnectionStrings(input);
    const rerender = (): void => { containerEl.empty(); renderSettings(containerEl, input); };
    const isKitDefault = (t: string): boolean => t === LLM_CONNECTION_STRINGS_EN.endpointSource.managedDesc || t === LLM_CONNECTION_STRINGS_DE.endpointSource.managedDesc;
    const sourceStrings = o.managerOnly && isKitDefault(strings.endpointSource.managedDesc)
      ? { ...strings.endpointSource, managedDesc: strings.managedDescManagerOnly }
      : strings.endpointSource;
    if (!freshSinceInvalidate && pending === null) void resolve().then(rerender).catch(() => { /* bleibt neutral */ });
    let saved: Promise<void> = Promise.resolve();
    buildEndpointSourceSection({
      app: o.app, containerEl, capability: "embedding", caller: o.caller, pluginId: o.pluginId,
      choice: () => o.getSettings().choice ?? {},
      setChoice: async (c) => { await persist({ choice: c }); invalidate(); },
      local: () => (o.managerOnly ? [] : o.getSettings().endpoints),
      strings: sourceStrings,
      renderLocalList: () => {
        if (o.managerOnly) { new Setting(containerEl).setDesc(strings.noManager); return; }
        buildEndpointList({
          containerEl, label: strings.listLabel, desc: strings.listDesc, placeholder: strings.listPlaceholder,
          strings: strings.endpointList, cache: settingsCache,
          get: () => o.getSettings().endpoints,
          set: (eps) => { saved = persist({ endpoints: eps }); },
          active: () => (shown?.state === "active" ? shown.source.config?.url ?? null : null),
          clientFor,
          modelFits: (cfg) => { const m = modelOfRow(cfg); return m !== "" && accepts(cfg, m) === true; },
          save: () => saved,
          reconnect: async () => { invalidate(); await resolve().catch(() => undefined); },
          rerender, app: o.app, pluginId: o.pluginId,
          allowEmptyModel: false,   // ein Index braucht ein benanntes Modell: ohne Modell ist die Anbindung `no-model`
          ...(o.contextLength === false ? {} : { modelContext: plumbing.modelContext }),
        });
      },
      rerender,
    });
  }

  return {
    resolve, invalidate, models, rowStates, embedder: () => embedder, setModel, modelInUse, renderSettings,
    hideSettings: () => { settingsCache.clear(); plumbing.modelContext.clear(); },
  };
}
