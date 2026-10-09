// vendored from obsidian-kit@0.51.2, src/obsidian/llm-connection.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Die LLM-Anbindung eines Fachplugins als EINE Komposition: Endpunkt-Quelle (Manager oder lokale
 *  Liste mit Schlüsselbund), gemerkte Auflösung, Modellliste, Anfrage-Parameter je Modus, Client mit
 *  Transport und Fristen, Prüfung der Antwort und beide Settings-Abschnitte.
 *
 *  Warum es das gibt: die Bausteine lagen im Kit, ihre Zusammensetzung nicht. Die Messung
 *  `_SDD/2026-10-03-llm-anbindung-messung.md` (kit-llm) fand sie in 16 Resolve-Stellen und 12
 *  Client-Wrappern je neu verdrahtet — eine Kopier-Kette für das Merken der Auflösung, sieben
 *  Bauten des `ResponseFacts`, drei Kopien der Fristen. Was dort OHNE Grund verschieden war, ist
 *  hier eine Regel; was einen fachlichen Grund hat, ist eine Option oder ein Hook:
 *
 *  - zweite Liste (Embedding, Bild): zwei Verbindungen je Fähigkeit, nicht eine mit zwei Listen —
 *    `capability` "embedding" und "image" sind deshalb RESERVIERT und werfen (noch nicht gebaut);
 *  - Bildteile und Prompts: `buildMessages` ist ein Parameter von `complete`, nicht Logik hier;
 *  - Tool-Calls (koda) und ein Gesamt-Timer (vault-crews) bleiben beim Plugin: koda nimmt
 *    `createChatClient` direkt, `totalMs` ist Sache des Aufrufers (`signal`);
 *  - Manager-only (ghostline): `managerOnly`; kein Fallback-Transport (koda): `fallback: "none"`;
 *    Kurzbefehl-Transport (transmute, lingotuner): `transports.shortcuts`;
 *  - Ping (`probe`) und Backend-Erkennung (`backendOf`, Default `createObsidianBackendProbe`) sind
 *    überschreibbar.
 *
 *  Vereinheitlicht (ohne Grund verschieden gewesen): `choice` gilt NUR mit Manager — ohne ihn
 *  übersteuerte eine alte Manager-Wahl das lokale Modell (nur transmute, neurovim und
 *  image-to-markdown hatten das gefiltert); der Manager wird nie gemerkt, die lokale Auflösung bis
 *  `invalidate()`; der erste Chunk bekommt die JIT-Frist; `truncated` ist standardmäßig ein
 *  Ergebnis mit `finishReason: "length"`; `errorText = body ?? detail`.
 *
 *  Transport-Verdrahtung: ohne Angabe wählt `transportFor` selbst — `xhrSseTransport` (Stream) mit
 *  `requestUrlTransport` als Rückfall ohne Stream (CORS-freier Weg über den Hauptprozess). Ein Plugin
 *  übergibt `transports` nur, wenn es davon abweichen muss: `fallback: "none"` (koda), `shortcuts`
 *  für Apple Intelligence (transmute, lingotuner) oder eigene Transporte in Tests.
 *
 *  Vertrag an `persist`: es übernimmt den Patch in die Settings des Plugins SYNCHRON (bevor es
 *  speichert) — die Endpunkt-Liste liest ihre Zeilen danach über `getSettings()` zurück. */
import { requestUrl, Setting, type App } from "obsidian";
import { normalizeEndpoint } from "../kit/endpoint";
import type { RedactRules } from "../kit/redact";
import { authHeaders, type EndpointConfig } from "../kit/endpoint_config";
import { classifyEndpointStatus, extractModelIds, type EndpointStatus } from "../kit/endpoint_diagnostics";
import { createModelListCache, type ModelListClient, type ModelListResult } from "../kit/model-list-cache";
import {
  checkResponse, mapTruncated, resolveRequestParams, responseFactsOf, thinkingFor, DEFAULT_REQUEST_SETTINGS,
  type BackendId, type Deviation, type FamilyKey, type ModeId, type RequestSettings, type ResponseFacts, type ThinkingLevel, type TruncatedPolicy,
} from "../kit/sampling-profiles";
import {
  resolveEndpointSource, describeModel,
  type Capability, type EndpointChoice, type EndpointSourceResult, type LlmEndpointManagerApi, type ShortcutTransportConfig,
} from "../kit/endpoint-source";
import {
  createChatClient, JIT_FIRST_CHUNK_TIMEOUT_MS, DEFAULT_IDLE_TIMEOUT_MS,
  type ChatClient, type ChatResult, type ChatTiming, type ChatWireMessage, type SseTransport,
} from "./chat-client";
import { requestUrlTransport, transportFor, xhrSseTransport } from "./chat-transport";
import { realClock, type ClockPort } from "./clock";
import { createObsidianBackendProbe } from "./backend-probe";
import { buildEndpointList, type EndpointListStrings } from "./endpoint-list";
import { hydrateLocalEndpoints, prepareLocalEndpoints } from "./endpoint-secrets";
import { buildEndpointSourceSection, findEndpointManager, type EndpointSourceSectionStrings } from "./endpoint-source";
import { buildRequestSection, type RequestSectionState, type RequestSectionStrings } from "./request-section";
import { createRequestSession, type RequestSession } from "./request-session";
import { resolveLlmConnectionStrings, type LlmConnectionStringsOverride } from "./llm-connection-strings";

export interface LlmConnectionSettings {
  endpoints: EndpointConfig[];
  /** Wahl am Manager; ohne Manager ohne Wirkung. */
  choice?: EndpointChoice;
  /** Globales Modell der lokalen Liste (Rückfall nach dem Zeilen-Modell). */
  model?: string;
  request?: RequestSettings;
}

export interface LlmConnectionTimeouts {
  idleMs?: number;
  /** Default `JIT_FIRST_CHUNK_TIMEOUT_MS`. */
  firstChunkMs?: number;
  toolIdleMs?: number;
  nonStreamMs?: number;
}

export interface LlmConnectionTransports {
  /** Default `xhrSseTransport`; Tests und Sonderfälle injizieren. */
  http?: SseTransport;
  /** Default `requestUrlTransport`; nur mit `fallback: "auto"` wirksam. */
  httpFallback?: SseTransport;
  /** Transport für Endpunkte mit `transport: "shortcuts"` — fertig oder aus der Kurzbefehl-Konfiguration gebaut. */
  shortcuts?: SseTransport | ((shortcut: ShortcutTransportConfig) => SseTransport);
  /** `"auto"` (Default): nach einem Netzfehler im Stream einmal ohne Stream wiederholen; `"none"` (koda):
   *  ein CORS-Block soll sichtbar bleiben. */
  fallback?: "auto" | "none";
}

export interface LlmConnectionOptions {
  app: App;
  pluginId: string;
  caller: string;
  /** Nur "chat" und "vision" sind gebaut; "embedding" und "image" reservieren den Namen und werfen. */
  capability: Capability;
  getSettings(): LlmConnectionSettings;
  persist(patch: Partial<LlmConnectionSettings>): Promise<void>;
  /** Erreichbarkeit einer lokalen Zeile (Default: `GET /v1/models`, 5 s). Wird nur ohne Manager gerufen. */
  probe?: (cfg: EndpointConfig) => Promise<boolean>;
  /** Modell-Ids einer lokalen Zeile (Default: `GET /v1/models`). */
  listModels?: (cfg: EndpointConfig) => Promise<string[]>;
  /** Backend des Endpunkts, wenn der Manager es nicht nennt. Default: `createObsidianBackendProbe()`
   *  (je Verbindung ein eigener 30-s-Zwischenspeicher); überschreibbar. */
  backendOf?: (cfg: EndpointConfig) => Promise<BackendId | null>;
  managerOnly?: boolean;
  transports?: LlmConnectionTransports;
  timeouts?: LlmConnectionTimeouts;
  /** Sampling-Modus; je Aufruf überschreibbar. */
  mode: ModeId;
  /** Budget des Plugins (`max_tokens`); Funktion je Modus oder fester Wert. */
  maxTokens?: number | ((mode: ModeId) => number | undefined);
  /** Default `"result"`. */
  truncated?: TruncatedPolicy;
  /** Text einer Abweichung für die Notice. Default (seit 0.50.0): `deviationNotice` der Kit-Texte in
   *  der Sprache `lang`; `null` schaltet die Notice ab. Bis 0.49.x gab es ohne ihn keine Notice. */
  deviationMessage?: ((d: Deviation) => string) | null;
  /** Sprache des Default-Notice-Texts; eine Funktion wird je Notice gefragt. Default `"en"`. */
  lang?: "en" | "de" | (() => "en" | "de");
  /** Zeigt im Anfrage-Abschnitt den Schalter „Stufenwahl im Chat“ (`levelPickerInChat`). Default `false`:
   *  `true` nur, wenn das Plugin den Wert an `buildThinkingControl` (`levelPicker`) reicht, sonst wirkt der
   *  Schalter nicht. Ist die Einstellung schon `true`, bleibt er sichtbar (sonst unabschaltbar). */
  levelPicker?: boolean;
  /** Antwort als Stream (Default `true`). `false` fragt eine volle Completion ab (`stream: false`), mit
   *  `timeouts.nonStreamMs` als Frist; je Aufruf überschreibbar (`CompleteHandlers.stream`). Für Plugins,
   *  die bisher ohne Stream fragten (transmute, lingotuner): ohne die Option liefen sie still auf dem
   *  XHR-Stream, `requestUrl` wäre nur der Rückfall. */
  stream?: boolean;
  /** Wie `content` im Ergebnis restauriert wird (`chat-client` `restoreContent`): `"text"` (Default) oder `"json"` für
   *  Konsumenten, die JSON aus `content` parsen (ein mehrzeiliger PEM bliebe sonst ein ungültiger JSON-String). Je Aufruf überschreibbar. */
  restoreContent?: "text" | "json";
  /** Modi, die der Anfrage-Abschnitt in `renderSettings` zeigt (Default `[mode]`). */
  modes?: ModeId[];
  /** Schwärzung der gesendeten Nachrichten (Default an, nur Geheimnisse; `chat-client` Kopfkommentar):
   *  `{ rules }` ersetzt den Regelsatz, `false` schaltet sie ab. Das Ergebnis meldet `redactions`;
   *  `redactMessages(messages, rules)` liefert dieselbe Schwärzung für eine Vorschau, und
   *  `strings.redactedNote(n)` die Hinweiszeile dazu („N Stellen geschwärzt“). */
  redact?: false | { rules?: RedactRules };
  /** Notice-Ausgabe der Sitzung (Default: Obsidian `Notice`). */
  notice?: (text: string) => void;
  clock?: ClockPort;
}

export interface LlmConnectionStrings {
  endpointSource: EndpointSourceSectionStrings;
  endpointList: EndpointListStrings;
  listLabel: string;
  listDesc: string;
  listPlaceholder: string;
  /** Notice-Text einer Abweichung, die das Ergebnis ändert (Satz plus Verweis auf den Abschnitt). */
  deviationNotice: (d: Deviation) => string;
  /** Hinweiszeile unter einer Vorschau des GESENDETEN Textes: „N Stellen geschwärzt“ (`redactions`). */
  redactedNote: (n: number) => string;
  /** Hinweis in den Einstellungen mit `managerOnly`, wenn der Manager fehlt. */
  noManager: string;
  request: RequestSectionStrings;
}

export interface NoEndpointResult {
  ok: false;
  kind: "no-endpoint";
  /** Grund des Managers (`no-endpoint`, `disabled`, …) oder die Konfigurationsmeldung. */
  detail: string;
  partial: string;
  reasoning: string;
  timing: ChatTiming;
  /** Immer 0: vor dem Senden gab es nichts zu schwärzen. */
  redactions?: number;
}
export type LlmResult = (ChatResult | NoEndpointResult) & {
  /** Tatsachen für `checkResponse`; `null`, wenn keine Server-Antwort vorlag. */
  facts: ResponseFacts | null;
  deviations: Deviation[];
  source: EndpointSourceResult;
};

export interface CompleteRequest {
  messages?: readonly ChatWireMessage[];
  /** Baut die Nachrichten aus der aufgelösten Quelle (Familie, gesendetes Modell) — Bildteile und
   *  Prompts bleiben Sache des Plugins. */
  buildMessages?: (source: EndpointSourceResult) => readonly ChatWireMessage[];
}
export interface CompleteHandlers {
  onToken?: (text: string) => void;
  onReasoning?: (text: string) => void;
  signal?: AbortSignal;
  /** Überschreibt `createLlmConnection({ stream })` für diesen Aufruf. */
  stream?: boolean;
  /** Überschreibt `createLlmConnection({ restoreContent })` für diesen Aufruf. */
  restoreContent?: "text" | "json";
  /** Sendet für diesen Aufruf ein anderes Modell als das aufgelöste. Alias (`aliasOf`), Familie, Profil und `facts`
   *  werden für dieses Modell bestimmt (Manager-Tabelle, sonst Namensrater); `result.source` nennt es. */
  model?: string;
  /** Überschreibt die Denkstufe aus den Settings für diesen Aufruf. */
  thinking?: ThinkingLevel;
  mode?: ModeId;
  /** Felder, die über die Profil-Parameter gemischt werden (z. B. `stop`). */
  overrides?: Record<string, unknown>;
}

export interface LlmConnection {
  resolve(opts?: { force?: boolean }): Promise<EndpointSourceResult>;
  invalidate(): void;
  models(opts?: { force?: boolean }): Promise<ModelListResult>;
  source(): RequestSectionState;
  complete(req: CompleteRequest, handlers?: CompleteHandlers): Promise<LlmResult>;
  /** Ohne `strings` gelten die englischen Default-Texte; `{ lang: "de" }` die deutschen, ein Teil-Bündel
   *  überlagert den Default Feld für Feld (`LLM_CONNECTION_STRINGS_EN/DE`). */
  renderSettings(containerEl: HTMLElement, strings?: LlmConnectionStrings | LlmConnectionStringsOverride): void;
  /** Beim Schließen des Settings-Tabs rufen (`hide()`): verwirft die Modell-Listen des Tabs. */
  hideSettings(): void;
  readonly session: RequestSession;
}

const PROBE_TIMEOUT_MS = 5_000;
const NEUTRAL_SOURCE = (): RequestSectionState => ({
  family: null, familySource: "none", backend: "unknown", backendSource: "none", model: "", sentModel: "",
});

export function createLlmConnection(o: LlmConnectionOptions): LlmConnection {
  if (o.capability === "embedding" || o.capability === "image") {
    throw new Error(
      `createLlmConnection: capability "${o.capability}" ist reserviert und noch nicht gebaut — vorgesehen ist eine zweite Verbindung je Fähigkeit `
      + "(statt einer Verbindung mit zwei Listen). Bis dahin: createChatClient bzw. die Endpunkt-Quelle direkt verdrahten (vault-rag Embedding, local-image-generator Bild).",
    );
  }
  const clock = o.clock ?? realClock;

  /** `persist` MUSS den Patch synchron übernehmen, bevor es speichert: die Endpunkt-Liste liest ihre
   *  Zeilen gleich danach über `getSettings()` zurück. Ein asynchron patchendes `persist` ließe sie
   *  alte Zeilen rendern — still falsch. Deshalb prüft diese Hülle, ob der Patch sofort sichtbar ist,
   *  und wirft sonst einen Hinweis an den Entwickler. */
  function persist(patch: Partial<LlmConnectionSettings>): Promise<void> {
    const p = o.persist(patch);
    const now = o.getSettings();
    for (const key of Object.keys(patch) as (keyof LlmConnectionSettings)[]) {
      if (JSON.stringify(now[key]) !== JSON.stringify(patch[key])) {
        void p.catch(() => undefined);
        throw new Error(
          `createLlmConnection: persist() hat „${key}“ nicht synchron übernommen — getSettings() liefert nach dem Aufruf noch den alten Wert. `
          + "Den Patch in die Settings schreiben, BEVOR gespeichert wird (await erst danach).",
        );
      }
    }
    return p;
  }
  const policy: TruncatedPolicy = o.truncated ?? "result";
  const fallback = o.transports?.fallback ?? "auto";
  const langNow = (): "en" | "de" => (typeof o.lang === "function" ? o.lang() : o.lang) ?? "en";
  const message = o.deviationMessage === null ? null
    : (o.deviationMessage ?? ((d: Deviation) => resolveLlmConnectionStrings({ lang: langNow() }).deviationNotice(d)));
  const session = createRequestSession({
    message: message ?? (() => ""),
    ...(message ? (o.notice ? { notice: o.notice } : {}) : { notice: () => {} }),
  });
  const backendProbe = createObsidianBackendProbe();
  const backendOf = o.backendOf ?? ((cfg: EndpointConfig) => backendProbe(cfg.url, cfg.model ?? o.getSettings().model ?? ""));
  const modelCache = createModelListCache();
  const settingsCache = createModelListCache();

  // ── lokale Endpunkt-Zeile: Erreichbarkeit und Modellliste ──────────────────────────────────
  async function fetchStatus(cfg: EndpointConfig): Promise<{ status: EndpointStatus; ids: string[] }> {
    // `normalizeEndpoint` streicht ein `/v1` am Ende — die OpenAI-kompatible Liste liegt aber unter `/v1/models`.
    // Ohne das Präfix antwortet LM Studio mit 200 und einem Fehlerkörper, Ollama mit 404; beides las
    // `classifyEndpointStatus` als „not-an-llm-api“ und jede lokale Zeile galt als unerreichbar (3d-codeblocks, 2026-10-04).
    const request = requestUrl({ url: `${normalizeEndpoint(cfg.url)}/v1/models`, headers: authHeaders(cfg.apiKey), throw: false });
    const timeout = new Promise<"timeout">((resolve) => { clock.setTimeout(() => resolve("timeout"), PROBE_TIMEOUT_MS); });
    try {
      const res = await Promise.race([request, timeout]);
      if (res === "timeout") return { status: classifyEndpointStatus({ kind: "timeout" }), ids: [] };
      let body: unknown = null;
      try { body = res.json; } catch { body = null; }
      const status = classifyEndpointStatus({ kind: "response", status: res.status, body });
      return { status, ids: status.reachable ? extractModelIds(body) : [] };
    } catch (e) {
      return { status: classifyEndpointStatus({ kind: "error", message: e instanceof Error ? e.message : String(e) }), ids: [] };
    }
  }
  const probeOf = o.probe ?? (async (cfg) => (await fetchStatus(cfg)).status.reachable);
  const listOf = o.listModels ?? (async (cfg) => (await fetchStatus(cfg)).ids);
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

  // ── Auflösung ──────────────────────────────────────────────────────────────────────────────
  let pending: Promise<EndpointSourceResult> | null = null;
  let last: EndpointSourceResult | null = null;
  let lastManagerEntry: string | undefined;

  async function resolveNow(): Promise<EndpointSourceResult> {
    const s = o.getSettings();
    const manager = findEndpointManager(o.app);
    const local = o.managerOnly || manager
      ? []
      : prepareLocalEndpoints({
        app: o.app, pluginId: o.pluginId, list: s.endpoints,
        persist: (list) => persist({ endpoints: list }),
      });
    const r = await resolveEndpointSource({
      manager, local, capability: o.capability, caller: o.caller,
      ...(s.model !== undefined ? { localModel: s.model } : {}),
      ...(manager && s.choice ? { choice: s.choice } : {}),
      backendOf,
    }, async (cfg) => (o.managerOnly ? false : probeOf(cfg)));
    lastManagerEntry = manager ? managerEntryId(manager, s.choice) : undefined;
    return r;
  }

  function managerEntryId(api: LlmEndpointManagerApi, choice: EndpointChoice | undefined): string | undefined {
    const entries = api.list({ capability: o.capability });
    return choice?.endpointId && entries.some((e) => e.id === choice.endpointId) ? choice.endpointId : entries[0]?.id;
  }

  function resolve(opts?: { force?: boolean }): Promise<EndpointSourceResult> {
    const manager = findEndpointManager(o.app);
    // Der Manager kann jederzeit deaktiviert werden: seine Quelle wird nie gemerkt.
    if (!opts?.force && !manager && last !== null) return Promise.resolve(last);
    if (!opts?.force && pending !== null) return pending;
    const p = resolveNow().then((r) => { if (pending === p) { pending = null; last = r; } return r; },
      (e: unknown) => { if (pending === p) pending = null; throw e; });
    pending = p;
    return p;
  }
  // `pending` hält die Auflösung nur, solange sie läuft; danach bewahrt `last` die lokale.
  function invalidate(): void { pending = null; last = null; modelCache.clear(); settingsCache.clear(); }

  // ── Modellliste ────────────────────────────────────────────────────────────────────────────
  async function models(opts?: { force?: boolean }): Promise<ModelListResult> {
    const r = await resolve();
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

  // ── Anzeige ────────────────────────────────────────────────────────────────────────────────
  function source(): RequestSectionState {
    if (!last) return NEUTRAL_SOURCE();
    return {
      family: last.family, familySource: last.familySource, backend: last.backend, backendSource: last.backendSource,
      model: last.model, sentModel: last.sentModel,
      ...(last.displayFamily ? { displayFamily: last.displayFamily } : {}),
      ...(last.defaultModel ? { defaultModel: last.defaultModel } : {}),
    };
  }

  // ── Anfrage ────────────────────────────────────────────────────────────────────────────────
  let client: { key: string; chat: ChatClient } | null = null;

  function chatClientFor(src: EndpointSourceResult): ChatClient {
    const cfg = src.config as EndpointConfig;
    const key = `${normalizeEndpoint(cfg.url)}\n${cfg.apiKey ?? ""}\n${src.transport ?? "http"}\n${src.shortcut?.name ?? ""}`;
    if (client && client.key === key) return client.chat;
    const t = o.transports ?? {};
    const shortcuts = typeof t.shortcuts === "function" ? (src.shortcut ? t.shortcuts(src.shortcut) : undefined) : t.shortcuts;
    const choice = transportFor(src, {
      http: t.http ?? xhrSseTransport,
      ...(fallback === "auto" ? { httpFallback: t.httpFallback ?? requestUrlTransport } : {}),
      ...(shortcuts ? { shortcuts } : {}),
    });
    const to = o.timeouts ?? {};
    // Ein Kurzbefehl braucht seine eigene Frist (+10 s Luft), sonst bricht der Client vor ihm ab.
    const floor = src.shortcut ? src.shortcut.timeoutMs + 10_000 : 0;
    const chat = createChatClient({
      transport: choice.primary,
      ...(choice.fallback ? { fallbackTransport: choice.fallback } : {}),
      clock,
      ...(o.redact !== undefined ? { redact: o.redact } : {}),
      idleTimeoutMs: to.idleMs ?? DEFAULT_IDLE_TIMEOUT_MS,
      firstChunkTimeoutMs: Math.max(to.firstChunkMs ?? JIT_FIRST_CHUNK_TIMEOUT_MS, floor),
      ...(to.toolIdleMs !== undefined ? { toolCallIdleTimeoutMs: to.toolIdleMs } : {}),
      ...(to.nonStreamMs !== undefined || floor > 0 ? { nonStreamTimeoutMs: Math.max(to.nonStreamMs ?? 0, floor) } : {}),
    });
    client = { key, chat };
    return chat;
  }

  function maxTokensFor(mode: ModeId): number | undefined {
    return typeof o.maxTokens === "function" ? o.maxTokens(mode) : o.maxTokens;
  }

  async function complete(req: CompleteRequest, h: CompleteHandlers = {}): Promise<LlmResult> {
    const resolved0 = await resolve();
    // Anderes Modell je Aufruf: Alias und Familie für DIESES Modell (Manager-Tabelle, sonst Name).
    let src = resolved0;
    if (h.model !== undefined && h.model !== "") {
      const d = describeModel(h.model, resolved0.models);
      const { displayFamily: _drop, ...rest } = resolved0;
      src = { ...rest, model: h.model, family: d.family, familySource: d.familySource, sentModel: d.sentModel, ...(d.displayFamily ? { displayFamily: d.displayFamily } : {}) };
    }
    const fail = (kind: "no-endpoint", detail: string): LlmResult => {
      const now = clock.now();
      return { ok: false, kind, detail, partial: "", reasoning: "", timing: { startedAt: now, endedAt: now }, redactions: 0, facts: null, deviations: [], source: src };
    };
    if (!src.config) return fail("no-endpoint", src.reason ?? "no-endpoint");

    let chat: ChatClient;
    try { chat = chatClientFor(src); }
    catch (e) { return fail("no-endpoint", e instanceof Error ? e.message : String(e)); }

    const mode = h.mode ?? o.mode;
    const settings = o.getSettings().request ?? DEFAULT_REQUEST_SETTINGS;
    const thinking = h.thinking ?? thinkingFor(settings, mode);
    const famKey: FamilyKey = src.family ?? "unknown";
    const budget = maxTokensFor(mode);
    const resolved = resolveRequestParams({
      family: src.family, mode, backend: src.backend, thinking,
      ...(budget !== undefined ? { maxTokens: budget } : {}),
      overrides: settings.overrides[mode]?.[famKey] ?? {},
    });
    const params: Record<string, unknown> = { ...resolved.params, ...(h.overrides ?? {}) };
    session.recordRequest(params);

    const messages = req.messages ?? req.buildMessages?.(src) ?? [];
    const wantStream = h.stream ?? o.stream;
    const raw = await chat.complete({
      endpoint: src.config, model: src.sentModel || src.model, messages, params,
      ...(wantStream !== undefined ? { stream: wantStream } : {}),
      ...((h.restoreContent ?? o.restoreContent) !== undefined ? { restoreContent: h.restoreContent ?? o.restoreContent } : {}),
      ...(h.signal ? { signal: h.signal } : {}),
      ...(h.onToken ? { onToken: h.onToken } : {}),
      ...(h.onReasoning ? { onReasoning: h.onReasoning } : {}),
    });

    const facts = responseFactsOf(raw);
    const deviations = facts ? checkResponse({ family: src.family, thinking }, facts) : [];
    session.report(deviations);

    const mapped = mapTruncated(raw, policy);
    const result: ChatResult = mapped === raw ? raw : {
      ok: true, content: mapped.ok ? mapped.content : "", reasoning: mapped.reasoning, toolCalls: [],
      finishReason: "length", truncated: true, streamed: true, timing: raw.timing,
      ...(raw.redactions !== undefined ? { redactions: raw.redactions } : {}),
    };
    return { ...result, facts, deviations, source: src };
  }

  // ── Settings ───────────────────────────────────────────────────────────────────────────────
  function renderSettings(containerEl: HTMLElement, input?: LlmConnectionStrings | LlmConnectionStringsOverride): void {
    const strings = resolveLlmConnectionStrings(input);
    const rerender = (): void => { containerEl.empty(); renderSettings(containerEl, input); };
    // Noch nie aufgelöst (Tab als Erstes geöffnet): im Hintergrund auflösen und einmal neu zeichnen.
    if (last === null && pending === null) void resolve().then(rerender).catch(() => { /* source() bleibt neutral */ });
    let saved: Promise<void> = Promise.resolve();
    buildEndpointSourceSection({
      app: o.app, containerEl, capability: o.capability, caller: o.caller, pluginId: o.pluginId,
      ...(o.transports?.shortcuts ? { transports: ["http", "shortcuts"] as ("http" | "shortcuts")[] } : {}),
      choice: () => o.getSettings().choice ?? {},
      setChoice: async (c) => { await persist({ choice: c }); invalidate(); },
      local: () => (o.managerOnly ? [] : o.getSettings().endpoints),
      strings: strings.endpointSource,
      renderLocalList: () => {
        // Manager-only: es gibt keine lokale Liste, nur den Hinweis; `endpoints` wird nie geschrieben.
        if (o.managerOnly) { new Setting(containerEl).setDesc(strings.noManager); return; }
        buildEndpointList({
          containerEl, label: strings.listLabel, desc: strings.listDesc, placeholder: strings.listPlaceholder,
          strings: strings.endpointList, cache: settingsCache,
          get: () => o.getSettings().endpoints,
          set: (eps) => { saved = persist({ endpoints: eps }); },
          active: () => last?.config?.url ?? null,
          clientFor,
          ...(o.getSettings().model !== undefined ? { globalModel: () => o.getSettings().model ?? "" } : {}),
          save: () => saved,
          reconnect: async () => { invalidate(); await resolve().catch(() => undefined); },
          rerender, app: o.app, pluginId: o.pluginId,
        });
      },
      rerender,
    });
    buildRequestSection({
      containerEl, modes: o.modes ?? [o.mode],
      state: source,
      settings: () => o.getSettings().request ?? DEFAULT_REQUEST_SETTINGS,
      save: (s) => persist({ request: s }),
      maxTokens: maxTokensFor,
      session, strings: strings.request, rerender,
      ...(o.levelPicker !== undefined ? { levelPicker: o.levelPicker } : {}),
    });
  }

  return {
    resolve, invalidate, models, source, complete, renderSettings,
    hideSettings: () => settingsCache.clear(),
    session,
  };
}
