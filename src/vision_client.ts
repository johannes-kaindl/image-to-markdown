import { fetchVisionCapability, resolveVision, isVisionConfirmed, VISION_TEST_PROMPT, type Confidence } from "./capabilities";
import { normalizeEndpoint, resolveActiveEndpoint } from "./vendor/kit/endpoint";
import { suppressParams } from "./vendor/kit/reasoning";
import { authHeaders } from "./vendor/kit/endpoint_config";
import { classifyEndpointStatus, type EndpointStatus } from "./vendor/kit/endpoint_diagnostics";
import { errorMessageFromText } from "./vendor/kit/error_body";
import { createChatClient, type ChatClient, type ChatResult, type ChatWireMessage, type SseTransport } from "./vendor/kit-obsidian/chat-client";
import { t } from "./i18n";

// normalizeEndpoint + resolveActiveEndpoint sind aus obsidian-kit#0.3.0 vendored — hier
// re-exportiert, damit main.ts/settings.ts/Tests sie weiterhin aus ./vision_client beziehen.
export { normalizeEndpoint, resolveActiveEndpoint };

/** Transport-Abstraktion: hält den reinen Kern obsidian-frei (PROF-OBS-03/04). Die Obsidian-Schicht
 *  injiziert per setHttp() einen requestUrl-Adapter (src/http.ts); Tests injizieren einen Mock.
 *  Nicht-streamende Calls laufen über http(); nur das Live-Streaming nutzt fetch (requestUrl streamt nicht). */
export interface HttpResponse { ok: boolean; status: number; text: string }
export type HttpFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<HttpResponse>;
/** Die Transporte für den Chat-Weg (Stream + Fallback ohne Stream). Der reine Kern importiert
 *  weder XHR noch `requestUrl`; `main.ts` injiziert `xhrSseTransport`/`requestUrlTransport` aus
 *  `vendor/kit-obsidian/chat-transport.ts`, Tests einen Fake. */
export interface ChatTransports { transport: SseTransport; fallbackTransport?: SseTransport }

/** Fristen des Chat-Clients. Idle (Stille seit dem letzten Chunk) gilt seit 0.25.0 überhaupt;
 *  die Frist bis zum ERSTEN Chunk ist großzügiger, weil ein JIT ladendes Modell (LM Studio) und ein
 *  großes Bild vor dem ersten Token Minuten brauchen können. */
export const IDLE_TIMEOUT_MS = 120_000;
export const FIRST_CHUNK_TIMEOUT_MS = 600_000;

/** Erkennt einen OpenAI-kompatiblen Fehler-Envelope in einem Antwort-Body. Lokale Server (LM Studio)
 *  antworten auf Fehler oft mit **HTTP 200 + `{error:{message}}`** → der Aufrufer kann die echte
 *  Servermeldung statt eines generischen Fehlers zeigen. Gibt `null` zurück, wenn der Body eine (auch
 *  leere) Completion ist oder kein erkennbarer Fehler/kein JSON.
 *
 *  Adapter über das vendorte Kit-Modul (wie `src/capabilities.ts`): die Kaskade selbst steht seit
 *  0.27.0 in `vendor/kit/error_body.ts` — dieses Repo ist laut Kit-Dateikopf ihre kanonische Quelle.
 *  `bodyMayBeSuccess: true` ist hier **Pflicht, nicht Geschmack**: im Kit ist der `choices`-Wächter
 *  optional, alle drei Aufrufstellen unten reichen aber einen Body herein, von dem sie noch nicht
 *  wissen, ob er überhaupt ein Fehler ist. Ohne die Option läse `{"choices":[],"detail":"stray"}`
 *  als Fehler (geprüft in tests/vision_client.test.ts). Die Option steht deshalb genau einmal —
 *  hier — statt dreimal an den Aufrufstellen. */
export const parseErrorEnvelope = (text: string): string | null =>
  errorMessageFromText(text, { bodyMayBeSuccess: true });

let httpFn: HttpFetch | null = null;
let chatTransports: ChatTransports | null = null;
export function setHttp(fn: HttpFetch): void { httpFn = fn; }
export function setChatTransports(tr: ChatTransports): void { chatTransports = tr; }
function http(): HttpFetch {
  if (!httpFn) throw new Error("VisionClient: HTTP nicht konfiguriert (setHttp aufrufen)");
  return httpFn;
}

/** Übersetzt ein gescheitertes Chat-Ergebnis in den Fehler, den die Aufrufer anzeigen. Der Kit-Client
 *  liefert nur `kind` + Servermeldung; den Satz baut das Plugin (UI-STANDARD §10). Abbruch bleibt
 *  ein `AbortError` — die View unterscheidet ihn über `signal.aborted`, aber ein Nutzer von
 *  `transcribeStream` darf sich weiter auf den Namen verlassen. */
function chatError(r: Extract<ChatResult, { ok: false }>): Error {
  if (r.kind === "aborted") { const e = new Error(r.detail); e.name = "AbortError"; return e; }
  if (r.kind === "timeout") return new Error(t("chat.err.timeout", r.detail));
  if (r.kind === "network") return new Error(t("chat.err.network", r.detail));
  if (r.kind === "overflow") return new Error(t("chat.err.overflow", r.detail));
  return new Error(r.status !== undefined ? t("chat.err.http", r.status, r.detail) : t("chat.err.response", r.detail));
}

interface ChatOut { content: string; reasoning: string; model: string; finishReason?: string }

export class VisionClient {
  private endpoint: string;
  /** Der Kit-Chat-Client — EINER je VisionClient, und der wird bei jedem Endpunktwechsel neu gebaut
   *  (`main.ts::resolveAndReconnect`): die Weigerung, ohne Stream weiterzumachen, hängt an der Instanz
   *  und dürfte sonst den nächsten Endpunkt treffen. */
  private chat: ChatClient | null = null;
  /** `apiKey` gilt genau für DIESEN Endpunkt (eine Fallback-Liste darf lokale und gehostete
   *  Anbieter mischen). Fehlt er, geht kein Authorization-Header raus — lokale Server lehnen
   *  einen leeren Bearer teils ab. */
  constructor(endpoint: string, private model: string, private apiKey?: string) {
    this.endpoint = normalizeEndpoint(endpoint);
  }

  /** Header für jeden ausgehenden Call: Auth (falls Schlüssel) plus die übergebenen. */
  private headers(extra?: Record<string, string>): Record<string, string> {
    return { ...extra, ...authHeaders(this.apiKey) };
  }

  /** Diagnostische Probe gegen GET /v1/models — benannter Status statt true/false.
   *
   *  Braucht der Kit-Endpunkt-Editor (`vendor/kit-obsidian/endpoint-list.ts`), der im Tooltip
   *  den GRUND zeigt: eine HTTP-200-Antwort gilt nur dann als erreichbar, wenn sie die
   *  Modell-Listen-Form (`data`-Array) hat. Genau das trennt den dokumentierten
   *  LM-Studio-Footgun (falscher Pfad → 200 + Fehler-Body → still leeres Transkript) von
   *  einem echten Endpunkt.
   *
   *  Seit 0.22.0 ist das der EINZIGE Erreichbarkeits-Begriff im Repo: `ping()` delegiert
   *  hierher, damit die Anzeige nicht vor einem Fehler warnt, den die Auflösung gleich darauf
   *  begeht. Vorher standen hier zwei Begriffe nebeneinander (hier streng, dort `res.ok`) —
   *  bewusst, aber nur bis zu dem Gate-Lauf, der die Auflösung mit ändern durfte. */
  async probeStatus(): Promise<EndpointStatus> {
    try {
      const r = await http()(`${this.endpoint}/v1/models`, { headers: this.headers() });
      let body: unknown = null;
      try { body = JSON.parse(r.text); } catch { /* kein JSON → classify entscheidet über den Status */ }
      return classifyEndpointStatus({ kind: "response", status: r.status, body });
    } catch (e) {
      return classifyEndpointStatus({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Verbindungs-Check gegen den OpenAI-kompatiblen Endpoint (GET /v1/models).
   *
   *  Delegiert bewusst an `probeStatus()`: bis 0.21.0 fragte diese Methode nur `res.ok` und
   *  hatte damit einen ANDEREN Erreichbarkeits-Begriff als die Anzeige. Sichtbare Folge war
   *  der in AGENTS.md dokumentierte LM-Studio-Footgun — falscher Pfad, HTTP 200 mit
   *  Fehler-Body: die Endpunkt-Zeile warnte „antwortet, ist aber kein OpenAI-kompatibler
   *  Endpunkt", und `resolveActiveEndpointConfig` nahm genau diesen Endpunkt trotzdem. Die
   *  Transkription lief danach in ein still leeres Ergebnis.
   *
   *  Die Verhaltensänderung ist eng: betroffen ist allein „HTTP 200, aber kein `data`-Array".
   *  Ein fehlendes `/v1/models` (404) galt schon vorher als nicht erreichbar, und ein LEERES
   *  `data`-Array zählt weiterhin als gültig — sonst fiele ein frisch aufgesetztes MLX ohne
   *  Modelle im Cache aus der Auswahl. */
  async ping(): Promise<boolean> {
    return (await this.probeStatus()).reachable;
  }

  /** Verfügbare Modelle vom Endpoint (GET /v1/models). [] bei Fehler/Offline. */
  async listModels(): Promise<string[]> {
    try {
      const r = await http()(`${this.endpoint}/v1/models`, { headers: this.headers() });
      if (!r.ok) return [];
      const j = JSON.parse(r.text) as { data?: { id?: string }[] };
      return (j.data ?? []).map(m => m.id).filter((x): x is string => typeof x === "string").sort();
    } catch { return []; }
  }

  private chatClient(): ChatClient {
    if (!chatTransports) throw new Error("VisionClient: Chat-Transport nicht konfiguriert (setChatTransports aufrufen)");
    this.chat ??= createChatClient({
      transport: chatTransports.transport,
      ...(chatTransports.fallbackTransport ? { fallbackTransport: chatTransports.fallbackTransport } : {}),
      idleTimeoutMs: IDLE_TIMEOUT_MS,
      firstChunkTimeoutMs: FIRST_CHUNK_TIMEOUT_MS,
    });
    return this.chat;
  }

  /** Ein Chat-Aufruf über den Kit-Client. `params` bleibt übergangsweise `suppressParams` (Rezept
   *  0.42.0 Schritt 3); eigene feste Sampling-Werte gab es hier nie. */
  private async run(
    messages: readonly ChatWireMessage[], stream: boolean,
    onContent?: (t: string) => void, onReasoning?: (t: string) => void,
    signal?: AbortSignal, opts?: { suppressThinking?: boolean },
  ): Promise<ChatOut> {
    const r = await this.chatClient().complete({
      endpoint: { url: this.endpoint, ...(this.apiKey ? { apiKey: this.apiKey } : {}) },
      model: this.model,
      messages,
      params: suppressParams(opts?.suppressThinking ?? false),
      stream,
      ...(signal ? { signal } : {}),
      ...(onContent ? { onToken: onContent } : {}),
      ...(onReasoning ? { onReasoning } : {}),
    });
    if (r.ok) return { content: r.content, reasoning: r.reasoning, model: r.model ?? this.model, ...(r.finishReason !== undefined ? { finishReason: r.finishReason } : {}) };
    // „Abgeschnitten ohne Text“ ist im Kit ein Fehler, hier der Fall, den der Aufrufer über
    // finishReason "length" kennt und mit eigener Meldung zeigt (Reasoning-Modelle: das Denken
    // frisst das Budget) — also wie bisher als Ergebnis liefern, nicht als Ausnahme.
    if (r.kind === "truncated") return { content: "", reasoning: r.reasoning, model: this.model, finishReason: "length" };
    throw chatError(r);
  }

  /** Multimodale Nachricht (Text-Prompt + Bild als image_url-Data-URL). `content` geht als
   *  Array durch den Kit-Client (`ChatWireMessage.content: unknown`). */
  private buildMessages(dataUrl: string, prompt: string): ChatWireMessage[] {
    return [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    }];
  }

  /** Non-streaming /v1/chat/completions-Call. Modell autoritativ aus der Response. */
  async transcribe(dataUrl: string, prompt: string, opts?: { suppressThinking?: boolean }): Promise<{ content: string; model: string; finishReason?: string }> {
    const { content, model, finishReason } = await this.run(this.buildMessages(dataUrl, prompt), false, undefined, undefined, undefined, opts);
    // finish_reason === "length" heisst: am Token-Limit abgeschnitten. Kein Fehler (der Teiltext ist
    // gueltig), aber der Aufrufer muss es sagen koennen — sonst sieht ein leeres Transkript wie
    // "nichts erkannt" aus.
    return { content, model, ...(finishReason !== undefined ? { finishReason } : {}) };
  }

  /** Passive Vision-Erkennung: native Metadaten-Probe + Namens-Heuristik.
   *  this.endpoint ist bereits /v1-frei (normalizeEndpoint) → korrekte Basis-URL. */
  async visionConfidence(model: string): Promise<Confidence> {
    return resolveVision(await fetchVisionCapability(http(), this.endpoint, model, this.headers()), model);
  }

  /** Aktiver Vision-Test: schickt das übergebene Test-Bild und prüft, ob die Antwort
   *  das erwartete Token enthält. Throws bei Netz-/HTTP-Fehler (Endpoint nicht erreichbar). */
  async testVision(dataUrl: string): Promise<boolean> {
    const { content } = await this.transcribe(dataUrl, VISION_TEST_PROMPT);
    return isVisionConfirmed(content);
  }

  /** Streamende Variante für die Sidebar: liefert content+reasoning live, plus das Modell
   *  aus dem ersten SSE-Chunk (Fallback: Konstruktor-Modell). Transport ist XHR (Kit `chat-transport`),
   *  weil `requestUrl` nicht streamt und `fetch` in der Desktop-Runtime keinen verlässlichen Teil-Stream liefert. */
  async transcribeStream(
    dataUrl: string, prompt: string,
    onContent: (t: string) => void, onReasoning: (t: string) => void,
    signal?: AbortSignal, opts?: { suppressThinking?: boolean },
  ): Promise<ChatOut> {
    return this.run(this.buildMessages(dataUrl, prompt), true, onContent, onReasoning, signal, opts);
  }

  /** Wie transcribeStream, aber sendet reinen TEXT (kein Bild) — für born-digital PDF-Seiten, deren
   *  exakter Text-Layer extrahiert und vom Modell nur nach Markdown formatiert wird. */
  async transcribeTextStream(
    text: string, prompt: string,
    onContent: (t: string) => void, onReasoning: (t: string) => void,
    signal?: AbortSignal, opts?: { suppressThinking?: boolean },
  ): Promise<ChatOut> {
    return this.run([{ role: "user", content: `${prompt}\n\n${text}` }], true, onContent, onReasoning, signal, opts);
  }

  /** Iterative Nachbesserung (#7): streamt ein fertig gebautes Multi-Turn-Messages-Array (System +
   *  Original/Feedback-Verlauf), text-only. Das Array baut der reine refine.ts::buildRefineMessages. */
  async refineStream(
    messages: unknown[],
    onContent: (t: string) => void, onReasoning: (t: string) => void,
    signal?: AbortSignal, opts?: { suppressThinking?: boolean },
  ): Promise<ChatOut> {
    return this.run(messages as ChatWireMessage[], true, onContent, onReasoning, signal, opts);
  }
}
