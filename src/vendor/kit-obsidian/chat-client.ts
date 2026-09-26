// vendored from obsidian-kit@0.43.0, src/obsidian/chat-client.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// ONE mechanical deviation from verbatim: kit-internal imports (../pure/ and ../vendor/code-kit/{pure,web}/) → ../kit/ (vendor layout); reproduce on every re-vendor, nothing else may differ.
/** Ein Chat-Aufruf gegen `/v1/chat/completions` (OpenAI-kompatibel) — Streaming, Tool-Calls,
 *  Abbruch, Idle-Timeout, Fehlerbody, Fallback ohne Stream. Kein `obsidian`-Import: der Transport
 *  wird injiziert (`chat-transport.ts` liefert XHR und `requestUrl`), die Uhr ebenso. Damit ist
 *  der ganze Client in Node gegen einen Fake-Transport testbar.
 *
 *  Herkunft (Welle 8, 2026-09-25): Vorlage `koda-agent/src/llm/KodaChatClient.ts` — der einzige
 *  der zehn Clients im Bestand mit Tool-Call-Runden, Abbruch und Idle-Timeout. Dazu aus
 *  `vault-crews/src/core/local-llm-client.ts` und `slide-deck/src/llm-client.ts` der Fallback ohne
 *  Stream nach `StreamNetworkError`, aus `slide-deck`/`image-to-markdown` die Prüfung auf HTTP 200
 *  mit Fehlerkörper, aus `lingotuner/src/core/llm/client.ts` die Trennung „Plugin baut `params`,
 *  Client schickt sie". Die Vergleichstabelle der zehn liegt in der Auftragsnote kit-w8.
 *
 *  ── Was der Client bewusst NICHT tut ─────────────────────────────────────────────────────────
 *  **Keine Sampling-Werte.** `params` kommt vom Plugin, üblicherweise aus
 *  `resolveRequestParams(...).params` (`code-kit` `sampling-profiles`), übergangsweise aus
 *  `suppressParams`. Nur das Plugin kennt seinen Modus; ein Client mit festem `temperature`
 *  überstimmte die Tabelle still.
 *  **Kein Gesamt-Timeout.** Die Frist misst Stille, nicht Dauer (REGISTRY „Der Timeout eines
 *  LLM-Streams muss ein IDLE-Timeout sein"). Wer ein Gesamtbudget braucht (unbeaufsichtigte
 *  Läufe), bricht über sein eigenes `signal` ab — das Ergebnis heißt dann `aborted`.
 *  **Keine Anzeigetexte.** `detail` ist die Servermeldung bzw. ein technischer Kurztext; den Satz
 *  für die Nutzerin baut der Konsument aus `kind` in seiner Sprache.
 *
 *  ── Fallback ohne Stream ─────────────────────────────────────────────────────────────────────
 *  Ein XHR-Stream im Renderer sendet `Origin: app://obsidian.md`; ein lokaler Server mit
 *  Origin-Prüfung weist ihn ab, während `requestUrl` (Hauptprozess, kein Origin) durchkommt. Mit
 *  `fallbackTransport` wiederholt der Client die Anfrage nach einem `StreamNetworkError` einmal
 *  ohne Stream und bleibt danach dabei — **je Client-Instanz**. Wer den Endpunkt wechselt, erzeugt
 *  den Client neu; sonst trägt der neue Endpunkt die Weigerung des alten. Ein Netzfehler im
 *  Fallback selbst ist `network`, es gibt keine zweite Runde. Schon gestreamter Text sperrt den
 *  Fallback (er lieferte dieselben Token noch einmal). */
import { parseSSE } from "../kit/sse";
import { ThinkSplitter } from "../kit/think-splitter";
import { normalizeEndpoint } from "../kit/endpoint";
import { authHeaders, type EndpointConfig } from "../kit/endpoint_config";
import { errorMessageFromText } from "../kit/error_body";
import { realClock, type ClockPort } from "./clock";

/** Der Transport-Vertrag der Koda-Linie (koda-agent, kuro-gamification, neurovim-obsidian):
 *  schickt `body` als JSON, reicht jeden neuen Rohtext-Abschnitt an `onChunk` und löst mit dem
 *  HTTP-Status auf — **auch bei Nicht-2xx**, der Client braucht den Fehlerkörper. Abbruch über
 *  `signal` → Ablehnung mit `name === "AbortError"`; ein Netzfehler vor jeder Antwort →
 *  `name === "StreamNetworkError"` (Auslöser des Fallbacks). */
export interface SseTransport {
  postStream(
    url: string,
    body: unknown,
    headers: Record<string, string>,
    onChunk: (raw: string) => void,
    signal: AbortSignal,
  ): Promise<number>;
}

/** Eine Nachricht, wie sie auf die Leitung geht. `content` ist `unknown`, weil multimodale
 *  Nachrichten ein Array tragen (image-to-markdown). */
export interface ChatWireMessage {
  role: string;
  content: unknown;
  tool_calls?: unknown;
  tool_call_id?: string;
  name?: string;
}

export interface ChatRequest {
  endpoint: EndpointConfig;
  /** Das Modell, wie es gesendet wird — nach `aliasOf`-Auflösung (`endpoint-source` `sentModel`). */
  model: string;
  messages: readonly ChatWireMessage[];
  /** Sampling- und Denk-Felder, flach in den Body gemischt. `model`, `messages`, `stream` und
   *  `tools` setzt der Client selbst; gleichnamige Schlüssel hier werden ignoriert. */
  params?: Record<string, unknown>;
  /** Werkzeuge in Leitungsform (`{type:"function", function:{…}}`). Leer = kein `tools`-Feld. */
  tools?: readonly unknown[];
  /** Default `true`. `false` fragt eine volle Completion ab (`stream:false`). */
  stream?: boolean;
  signal?: AbortSignal;
  onToken?: (text: string) => void;
  onReasoning?: (text: string) => void;
  /** Feuert einmal je Tool-Call, sobald sein Name feststeht — für die Statuszeile, bevor die
   *  Stille der gepufferten Argumente beginnt. */
  onToolCallHead?: (name: string) => void;
}

export interface ToolCall { id: string; name: string; arguments: string }

/** Millisekunden aus der injizierten Uhr. `firstChunkAt` fehlt, wenn kein Byte ankam — die
 *  Zeit bis zum ersten Chunk ist die Größe, die llm-lab als `ttftMs` führt (dort „time to first
 *  token"; gemessen wird hier das erste Byte, auch wenn es Reasoning ist). */
export interface ChatTiming { startedAt: number; firstChunkAt?: number; endedAt: number }

export type ChatErrorKind = "aborted" | "timeout" | "network" | "http" | "overflow" | "truncated";

export type ChatResult =
  | {
    ok: true;
    content: string;
    reasoning: string;
    toolCalls: ToolCall[];
    finishReason?: string;
    /** Das Modell, das der SERVER nennt — kann vom gesendeten abweichen (Alias, Router). */
    model?: string;
    /** `finish_reason: "length"` mit Text — gültig, aber am Token-Limit abgeschnitten. */
    truncated: boolean;
    /** `false`, wenn die Antwort als volle Completion kam (ohne Stream oder über den Fallback). */
    streamed: boolean;
    timing: ChatTiming;
  }
  | {
    ok: false;
    kind: ChatErrorKind;
    /** Servermeldung (aus dem JSON-Fehlerkörper) oder technischer Kurztext, eine Zeile. */
    detail: string;
    /** Bis zum Fehler gelieferter Text. */
    partial: string;
    reasoning: string;
    status?: number;
    /** Roher Fehlerkörper, gekürzt auf 2048 Zeichen. */
    body?: string;
    timing: ChatTiming;
  };

export interface ChatClientOptions {
  transport: SseTransport;
  /** Transport für die Wiederholung ohne Stream nach `StreamNetworkError` (üblich:
   *  `requestUrlTransport`). Ohne ihn ist ein Netzfehler sofort `network`. */
  fallbackTransport?: SseTransport;
  clock?: ClockPort;
  /** Stille seit dem letzten Chunk, nach der abgebrochen wird. Default 120 s. */
  idleTimeoutMs?: number;
  /** Frist bis zum ERSTEN Chunk (JIT-ladende Modelle brauchen Minuten). Default = `idleTimeoutMs`. */
  firstChunkTimeoutMs?: number;
  /** Frist ab dem Kopf-Chunk eines Tool-Calls. LM Studio streamt Tool-Argumente nicht, es puffert
   *  sie: nach dem Kopf kommt kein Byte, bis alle Argumente fertig sind (llm-setup `6f75737`).
   *  Default 900 s. */
  toolCallIdleTimeoutMs?: number;
  /** Frist für eine Anfrage ohne Stream — dort gibt es kein Lebenszeichen, also ist sie die
   *  ganze Wartezeit. Default 900 s. */
  nonStreamTimeoutMs?: number;
}

export interface ChatClient {
  complete(req: ChatRequest): Promise<ChatResult>;
}

export const DEFAULT_IDLE_TIMEOUT_MS = 120_000;
export const DEFAULT_TOOL_CALL_IDLE_TIMEOUT_MS = 900_000;
export const DEFAULT_NON_STREAM_TIMEOUT_MS = 900_000;
const ERROR_BODY_CAP = 2048;
const DETAIL_CAP = 200;
// übernommen aus vault-crews/src/core/chat-response.ts (via koda-agent/src/core/llm/chat-error.ts),
// 2026-09-25 — bewusst nicht in code-kit (Kopf von error_body.ts: eigene Zählung).
const OVERFLOW_RE = /context (length|window)|too many tokens|maximum context length/i;
const RESERVED = new Set(["model", "messages", "stream", "tools"]);

interface ToolCallDelta { index: number; id?: string; name?: string; argsDelta?: string }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function oneLine(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > DETAIL_CAP ? `${t.slice(0, DETAIL_CAP)}…` : t;
}

function namedErrorName(e: unknown): string {
  return e instanceof Error ? e.name : "";
}

/** tool_calls-Deltas aus KOMPLETTEN SSE-Zeilen. `parseSSE` (code-kit) kennt sie nicht; statt
 *  seine Zeilenlogik nachzubauen, bekommt diese Funktion genau den Teil, den `parseSSE` schon
 *  verbraucht hat. Der `includes`-Vorfilter hält den zweiten `JSON.parse` auf die seltenen
 *  Tool-Zeilen beschränkt. Nachfolger: `parseSSE` um `toolCalls` erweitern (code-kit). */
function toolCallDeltas(completeLines: string): ToolCallDelta[] {
  const out: ToolCallDelta[] = [];
  for (const rawLine of completeLines.split(/\r\n|\n|\r/)) {
    const t = rawLine.trim();
    if (!t.startsWith("data:") || !t.includes("tool_calls")) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(t.slice(5).trim()); } catch { continue; }
    const choices = isRecord(parsed) ? parsed.choices : undefined;
    const c0: unknown = Array.isArray(choices) ? choices[0] : undefined;
    const d = isRecord(c0) && isRecord(c0.delta) ? c0.delta : undefined;
    if (!d || !Array.isArray(d.tool_calls)) continue;
    d.tool_calls.forEach((tc: unknown, i: number) => {
      if (!isRecord(tc)) return;
      const fn = isRecord(tc.function) ? tc.function : {};
      out.push({
        index: typeof tc.index === "number" ? tc.index : i,
        ...(typeof tc.id === "string" ? { id: tc.id } : {}),
        ...(typeof fn.name === "string" ? { name: fn.name } : {}),
        ...(typeof fn.arguments === "string" ? { argsDelta: fn.arguments } : {}),
      });
    });
  }
  return out;
}

class ToolCallAssembler {
  private readonly map = new Map<number, { id: string; name: string; args: string }>();
  push(d: ToolCallDelta): void {
    const e = this.map.get(d.index) ?? { id: "", name: "", args: "" };
    if (d.id !== undefined) e.id = d.id;
    if (d.name !== undefined) e.name = d.name;
    if (d.argsDelta !== undefined) e.args += d.argsDelta;
    this.map.set(d.index, e);
  }
  finish(): ToolCall[] {
    return [...this.map.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, e]) => e.name !== "")
      .map(([index, e]) => ({ id: e.id !== "" ? e.id : `call_${index}`, name: e.name, arguments: e.args }));
  }
}

/** Volle Completion (`choices[0].message`) — ohne Stream, oder wenn ein Server `stream:true`
 *  ignoriert. `null`, wenn der Körper keine Completion ist. */
function readCompletion(body: string): { content: string; reasoning: string; toolCalls: ToolCall[]; finishReason?: string; model?: string } | null {
  let j: unknown;
  try { j = JSON.parse(body); } catch { return null; }
  if (!isRecord(j) || !Array.isArray(j.choices)) return null;
  const c0: unknown = j.choices[0];
  if (!isRecord(c0) || !isRecord(c0.message)) return null;
  const m = c0.message;
  const reasoning = [m.reasoning_content, m.reasoning, m.thinking].find((v): v is string => typeof v === "string" && v !== "") ?? "";
  const toolCalls: ToolCall[] = [];
  if (Array.isArray(m.tool_calls)) {
    m.tool_calls.forEach((tc: unknown, i: number) => {
      if (!isRecord(tc)) return;
      const fn = isRecord(tc.function) ? tc.function : {};
      if (typeof fn.name !== "string" || fn.name === "") return;
      toolCalls.push({
        id: typeof tc.id === "string" && tc.id !== "" ? tc.id : `call_${i}`,
        name: fn.name,
        arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
      });
    });
  }
  return {
    content: typeof m.content === "string" ? m.content : "",
    reasoning,
    toolCalls,
    ...(typeof c0.finish_reason === "string" && c0.finish_reason !== "" ? { finishReason: c0.finish_reason } : {}),
    ...(typeof j.model === "string" && j.model !== "" ? { model: j.model } : {}),
  };
}

export function createChatClient(opts: ChatClientOptions): ChatClient {
  const clock = opts.clock ?? realClock;
  const idleMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const firstMs = opts.firstChunkTimeoutMs ?? idleMs;
  const toolMs = opts.toolCallIdleTimeoutMs ?? DEFAULT_TOOL_CALL_IDLE_TIMEOUT_MS;
  const nonStreamMs = opts.nonStreamTimeoutMs ?? DEFAULT_NON_STREAM_TIMEOUT_MS;
  let streamRefused = false;

  async function run(req: ChatRequest, transport: SseTransport, stream: boolean): Promise<ChatResult> {
    const startedAt = clock.now();
    let firstChunkAt: number | undefined;
    const timing = (): ChatTiming => ({ startedAt, ...(firstChunkAt !== undefined ? { firstChunkAt } : {}), endedAt: clock.now() });

    let content = "";
    let reasoning = "";
    const fail = (kind: ChatErrorKind, detail: string, extra: { status?: number; body?: string } = {}): ChatResult =>
      ({ ok: false, kind, detail, partial: content, reasoning, ...extra, timing: timing() });

    if (req.signal?.aborted) return fail("aborted", "aborted before start");

    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(req.params ?? {})) if (!RESERVED.has(k)) body[k] = v;
    body.model = req.model;
    body.messages = req.messages;
    body.stream = stream;
    if (req.tools && req.tools.length > 0) body.tools = req.tools;
    const url = `${normalizeEndpoint(req.endpoint.url)}/v1/chat/completions`;
    const headers = authHeaders(req.endpoint.apiKey);

    const ctrl = new AbortController();
    const onCallerAbort = (): void => ctrl.abort();
    req.signal?.addEventListener("abort", onCallerAbort, { once: true });

    let timedOutAfter: number | null = null;
    let waitMs = stream ? firstMs : nonStreamMs;
    const fire = (): void => { timedOutAfter = waitMs; ctrl.abort(); };
    let timer = clock.setTimeout(fire, waitMs);
    const rearm = (ms: number): void => {
      waitMs = ms;
      clock.clearTimeout(timer);
      timer = clock.setTimeout(fire, ms);
    };

    const splitter = new ThinkSplitter();
    const assembler = new ToolCallAssembler();
    const heads = new Set<number>();
    let sawToolCall = false;
    let sawSse = false;
    let finishReason: string | undefined;
    let model: string | undefined;
    let rest = "";
    let raw = "";

    const emit = (c: string, r: string): void => {
      if (c !== "") { content += c; req.onToken?.(c); }
      if (r !== "") { reasoning += r; req.onReasoning?.(r); }
    };
    const drainSplitter = (): void => {
      const tail = splitter.flush();
      emit(tail.content, tail.reasoning);
    };
    const digest = (text: string): void => {
      const p = parseSSE(text);
      const complete = text.slice(0, text.length - p.rest.length);
      rest = p.rest;
      if (!sawSse && /^\s*data:/m.test(complete)) sawSse = true;
      if (model === undefined && p.model) model = p.model;
      if (finishReason === undefined && p.finishReason) finishReason = p.finishReason;
      for (const r of p.reasoning) emit("", r);
      for (const c of p.content) { const s = splitter.push(c); emit(s.content, s.reasoning); }
      for (const d of toolCallDeltas(complete)) {
        assembler.push(d);
        sawToolCall = true;
        if (d.name !== undefined && !heads.has(d.index)) {
          heads.add(d.index);
          req.onToolCallHead?.(d.name);
        }
      }
    };
    const onChunk = (chunk: string): void => {
      firstChunkAt ??= clock.now();
      raw += chunk;
      if (stream) digest(rest + chunk);
      if (stream) rearm(sawToolCall ? toolMs : idleMs);
    };

    let status: number;
    try {
      status = await transport.postStream(url, body, headers, onChunk, ctrl.signal);
    } catch (e) {
      drainSplitter();
      if (namedErrorName(e) === "AbortError") {
        return timedOutAfter !== null
          ? fail("timeout", `no data for ${timedOutAfter / 1000}s`)
          : fail("aborted", "aborted");
      }
      if (namedErrorName(e) === "StreamNetworkError" && opts.fallbackTransport && stream && raw === "") {
        streamRefused = true;
        cleanup();
        return run(req, opts.fallbackTransport, false);
      }
      return fail("network", e instanceof Error ? e.message : "network error");
    } finally {
      cleanup();
    }

    function cleanup(): void {
      clock.clearTimeout(timer);
      req.signal?.removeEventListener("abort", onCallerAbort);
    }

    // Eine letzte data-Zeile ohne abschließenden Zeilenumbruch liegt noch in `rest`.
    if (stream && rest.trim() !== "") digest(`${rest}\n`);
    drainSplitter();

    if (status < 200 || status >= 300) {
      const detail = errorMessageFromText(raw) ?? (oneLine(raw) || `HTTP ${status}`);
      return fail(OVERFLOW_RE.test(raw) ? "overflow" : "http", detail, { status, body: raw.slice(0, ERROR_BODY_CAP) });
    }

    let streamed = true;
    let toolCalls: ToolCall[];
    if (!sawSse && raw.trim() !== "") {
      const done = readCompletion(raw);
      if (done === null) {
        const envelope = errorMessageFromText(raw, { bodyMayBeSuccess: true });
        const detail = envelope ?? oneLine(raw);
        return fail(OVERFLOW_RE.test(raw) ? "overflow" : "http", detail, { status, body: raw.slice(0, ERROR_BODY_CAP) });
      }
      streamed = false;
      const s = splitter.push(done.content);
      emit(s.content, s.reasoning);
      drainSplitter();
      if (done.reasoning !== "") emit("", done.reasoning);
      toolCalls = done.toolCalls;
      finishReason = done.finishReason;
      model = done.model;
    } else {
      toolCalls = assembler.finish();
    }

    // Abgeschnitten OHNE Text (bei Reasoning-Modellen der Normalfall: das Denken verbraucht das
    // Budget) ist ein Fehler, keine leere Erfolgsmeldung — REGISTRY „Abgeschnittene LLM-Antwort".
    if (finishReason === "length" && content === "") return fail("truncated", "finish_reason: length, no text");

    return {
      ok: true,
      content,
      reasoning,
      toolCalls,
      ...(finishReason !== undefined ? { finishReason } : {}),
      ...(model !== undefined ? { model } : {}),
      truncated: finishReason === "length",
      streamed,
      timing: timing(),
    };
  }

  return {
    complete(req: ChatRequest): Promise<ChatResult> {
      const stream = req.stream ?? true;
      if (stream && streamRefused && opts.fallbackTransport) return run(req, opts.fallbackTransport, false);
      return run(req, opts.transport, stream);
    },
  };
}
