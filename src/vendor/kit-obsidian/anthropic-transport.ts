// vendored from obsidian-kit@0.72.0, src/obsidian/anthropic-transport.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Transport für die native Messages-API von Anthropic (`transport: "anthropic"` am Endpunkt): ein `SseTransport`
 *  wie `createShortcutsChatTransport`, der den OpenAI-Körper des `chat-client` übersetzt, an `POST /v1/messages`
 *  schickt und die Antwort in OpenAI-SSE zurückübersetzt. `chat-client`, Schwärzung, Idle-Frist, Denkzerlegung und
 *  Fehlerklassen laufen unverändert; die Übersetzung steht in `pure/anthropic-wire.ts`.
 *
 *  **Rohes HTTP statt `@anthropic-ai/sdk`** (Entscheidung Johannes' Master 2026-10-16, gemessen in Welle 23):
 *  PROF-OBS-12 verbietet globales `fetch`, auf dem das SDK streamt; der kleinste Client kostet als Bündel 314 KB
 *  (72 KB gzip, 258 Module, darunter `@opentelemetry/api`) — mehr, als `koda-agent` insgesamt wiegt. XHR und
 *  `requestUrl` tragen schon jedes Plugin, auch mobil.
 *
 *  **Der Browser-Header.** Aus dem Renderer (XHR, `Origin: app://obsidian.md`) beantwortet die API den Preflight nur mit
 *  `anthropic-dangerous-direct-browser-access: true`. Der Schlüssel ist der des Nutzers und die Anfrage geht direkt vom
 *  Gerät an Anthropic, kein Server des Plugin-Autors steht dazwischen; deshalb ist das Senden des Headers vertretbar.
 *  Der echte Preflight ist in Welle 23 nur gegen den Stub und nicht gegen die API gemessen (kein echter Aufruf).
 *  Fällt der XHR aus (`StreamNetworkError`), wiederholt `chat-client` über `requestUrl` (Hauptprozess, kein Origin).
 *
 *  **Ablauf je Aufruf:** (1) einmal je Endpunkt `GET /v1/models?limit=1000` (zehn Minuten Zwischenspeicher) — daraus
 *  kommt, ob das Modell `effort` und adaptives Denken annimmt (ein falsches Feld ist auf Sonnet 4.5 / Haiku 4.5 ein
 *  400) und seine Ausgabegrenze; fehlt die Auskunft, gehen beide Felder nicht mit. (2) `POST /v1/messages`. (3) Ein
 *  400 „Invalid signature in thinking block“ (die Doku nennt ihn für Verläufe, die der Aufrufer neu aufgebaut hat)
 *  löst GENAU EINE Wiederholung ohne Denkblöcke aus — der dokumentierte Weg ohne Beta-Header.
 *  **Fehler:** eine Antwort ohne Strom (HTTP-Fehler, `{"type":"error",…}`) geht unverändert an `chat-client`, dessen
 *  Meldung liest `error.message`; ein `event: error` mitten im Strom wird zum Status des Fehlertyps (429, 529, 500 …)
 *  mit dem Fehlerkörper als letzter Zeile. */
import { requestUrl } from "obsidian";
import {
  ANTHROPIC_VERSION, anthropicErrorStatus, createStreamTranslator, createThinkingStash, hasThinkingBlocks,
  isThinkingSignatureError, modelCapsFromList, toAnthropicBody, translateMessage,
  type AnthropicModelCaps, type ThinkingStash,
} from "../kit/anthropic-wire";
import type { SseTransport } from "./chat-client";
import { realClock, type ClockPort } from "./clock";

const CAPS_TTL_MS = 10 * 60_000;

function namedError(message: string, name: string): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

export interface AnthropicState {
  readonly stash: ThinkingStash;
  /** `GET /v1/models` je Endpunkt und Schlüssel. */
  readonly lists: Map<string, { at: number; list: unknown }>;
  readonly inflight: Map<string, Promise<unknown>>;
}

/** Zustand, den ein Transport und sein Rückfall-Transport TEILEN müssen (Denkblöcke, Modell-Liste). */
export function createAnthropicState(): AnthropicState {
  return { stash: createThinkingStash(), lists: new Map(), inflight: new Map() };
}

export interface AnthropicTransportOptions {
  /** Der Transport, der die Bytes bewegt: `xhrSseTransport` (Stream) oder `requestUrlTransport` (Rückfall). */
  http: SseTransport;
  state?: AnthropicState;
  /** `GET` für die Modell-Liste; Default `requestUrl`. Tests und Sonderfälle injizieren. */
  getJson?: (url: string, headers: Record<string, string>) => Promise<{ status: number; text: string }>;
  clock?: ClockPort;
}

async function requestUrlGet(url: string, headers: Record<string, string>): Promise<{ status: number; text: string }> {
  const r = await requestUrl({ url, method: "GET", headers, throw: false });
  return { status: r.status, text: r.text };
}

function trimSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47) end--;   // keine Regex `\/+$`: quadratisch auf langen Slash-Ketten
  return s.slice(0, end);
}

/** `…/v1/chat/completions` (so baut `chat-client` die URL) → Wurzel des Servers. */
export function anthropicBaseOf(url: string): string {
  const u = trimSlashes(url);
  for (const suffix of ["/v1/chat/completions", "/chat/completions"]) {
    if (u.endsWith(suffix)) return trimSlashes(u.slice(0, u.length - suffix.length));
  }
  return u;
}

function tokenOf(headers: Record<string, string>): string {
  const key = headers["x-api-key"];
  if (typeof key === "string" && key !== "") return key;
  const auth = headers.Authorization ?? headers.authorization ?? "";
  return auth.replace(/^Bearer\s+/i, "").trim();
}

export function createAnthropicChatTransport(opts: AnthropicTransportOptions): SseTransport {
  const state = opts.state ?? createAnthropicState();
  const getJson = opts.getJson ?? requestUrlGet;
  const clock = opts.clock ?? realClock;

  async function modelList(base: string, token: string): Promise<unknown> {
    const key = `${base}\n${token}`;
    const hit = state.lists.get(key);
    if (hit && clock.now() - hit.at < CAPS_TTL_MS) return hit.list;
    const pending = state.inflight.get(key);
    if (pending) return pending;
    const p = (async (): Promise<unknown> => {
      try {
        const r = await getJson(`${base}/v1/models?limit=1000`, {
          ...(token !== "" ? { "x-api-key": token } : {}),
          "anthropic-version": ANTHROPIC_VERSION,
          "anthropic-dangerous-direct-browser-access": "true",
        });
        if (r.status < 200 || r.status >= 300) return null;
        const list: unknown = JSON.parse(r.text);
        state.lists.set(key, { at: clock.now(), list });
        return list;
      } catch { return null; }   // ohne Auskunft gehen effort und thinking nicht mit — gültig auf jedem Modell
    })().finally(() => { state.inflight.delete(key); });
    state.inflight.set(key, p);
    return p;
  }

  return {
    async postStream(url, body, headers, onChunk, signal) {
      if (signal.aborted) throw namedError("aborted", "AbortError");
      const base = anthropicBaseOf(url);
      const token = tokenOf(headers);
      const model = typeof (body as { model?: unknown } | null)?.model === "string" ? (body as { model: string }).model : "";
      const caps: AnthropicModelCaps | null = modelCapsFromList(await modelList(base, token), model);
      if (signal.aborted) throw namedError("aborted", "AbortError");
      const wireHeaders: Record<string, string> = {
        ...(token !== "" ? { "x-api-key": token } : {}),
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
      };

      async function attempt(withThinkingBlocks: boolean): Promise<number> {
        const wire = toAnthropicBody(body, { caps, stash: state.stash, withThinkingBlocks });
        const translator = wire.stream === true ? createStreamTranslator() : null;
        // Der erste Byte entscheidet: SSE beginnt mit `event:`/`data:`/`:`, ein JSON-Körper (Fehler, Nachricht ohne Strom) mit `{`.
        let mode = "unknown" as "unknown" | "sse" | "plain";   // von onRaw gesetzt, TS sieht die Zuweisung im Rückruf nicht
        let lead = "";
        let plain = "";
        const onRaw = (text: string): void => {
          if (mode === "unknown") {
            lead += text;
            const t = lead.trimStart();
            if (t === "") return;
            mode = t.startsWith("{") ? "plain" : "sse";
            text = lead;
            lead = "";
          }
          if (mode === "plain") { plain += text; return; }
          const out = translator?.push(text) ?? "";
          if (out !== "") onChunk(out);
        };
        const status = await opts.http.postStream(`${base}/v1/messages`, wire, wireHeaders, onRaw, signal);

        if (mode === "sse" && translator) {
          const tail = translator.finish();
          const err = translator.error;
          if (err) {
            if (tail !== "") onChunk(tail);
            onChunk(`\n${JSON.stringify({ type: "error", error: { type: err.type, message: err.message } })}\n`);
            return anthropicErrorStatus(err.type);
          }
          if (tail !== "") onChunk(tail);
          const turn = translator.turn;
          if (turn.toolUseIds.length > 0 && turn.anchors.length > 0) state.stash.set(turn.toolUseIds, turn.anchors);
          return status;
        }
        if (mode === "plain") {
          if (status >= 200 && status < 300) {
            let parsed: unknown = null;
            try { parsed = JSON.parse(plain); } catch { /* kein JSON: unten unverändert weiter */ }
            const msg = translateMessage(parsed);
            if (msg) {
              if (msg.toolUseIds.length > 0 && msg.anchors.length > 0) state.stash.set(msg.toolUseIds, msg.anchors);
              onChunk(JSON.stringify(msg.completion));
              return status;
            }
          } else if (status === 400 && withThinkingBlocks && hasThinkingBlocks(wire.messages) && isThinkingSignatureError(plain)) {
            return attempt(false);
          }
          onChunk(plain);
          return status;
        }
        return status;
      }

      return attempt(true);
    },
  };
}
