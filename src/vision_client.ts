import { streamSSE } from "./sse";
import { fetchVisionCapability, resolveVision, isVisionConfirmed, VISION_TEST_PROMPT, type Confidence } from "./capabilities";
import { normalizeEndpoint, resolveActiveEndpoint } from "obsidian-kit/pure";

// normalizeEndpoint + resolveActiveEndpoint stammen aus obsidian-kit (entdoppelt) — hier
// re-exportiert, damit main.ts/settings.ts/Tests sie weiterhin aus ./vision_client beziehen.
export { normalizeEndpoint, resolveActiveEndpoint };

/** Transport-Abstraktion: hält den reinen Kern obsidian-frei (PROF-OBS-03/04). Die Obsidian-Schicht
 *  injiziert per setHttp() einen requestUrl-Adapter (src/http.ts); Tests injizieren einen Mock.
 *  Nicht-streamende Calls laufen über http(); nur das Live-Streaming nutzt fetch (requestUrl streamt nicht). */
export interface HttpResponse { ok: boolean; status: number; text: string }
export type HttpFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<HttpResponse>;
/** Streamender Transport — liefert eine fetch-Response (für streamSSE). Wird aus der Obsidian-
 *  Schicht über activeWindow.fetch injiziert; der Kern referenziert nie das globale fetch. */
export type StreamFetch = (url: string, init?: RequestInit) => Promise<Response>;

let httpFn: HttpFetch | null = null;
let streamFn: StreamFetch | null = null;
export function setHttp(fn: HttpFetch): void { httpFn = fn; }
export function setStreamFetch(fn: StreamFetch): void { streamFn = fn; }
function http(): HttpFetch {
  if (!httpFn) throw new Error("VisionClient: HTTP nicht konfiguriert (setHttp aufrufen)");
  return httpFn;
}

export class VisionClient {
  private endpoint: string;
  constructor(endpoint: string, private model: string) {
    this.endpoint = normalizeEndpoint(endpoint);
  }

  /** Verbindungs-Check gegen den OpenAI-kompatiblen Endpoint (GET /v1/models). */
  async ping(): Promise<boolean> {
    try { return (await http()(`${this.endpoint}/v1/models`)).ok; } catch { return false; }
  }

  /** Verfügbare Modelle vom Endpoint (GET /v1/models). [] bei Fehler/Offline. */
  async listModels(): Promise<string[]> {
    try {
      const r = await http()(`${this.endpoint}/v1/models`);
      if (!r.ok) return [];
      const j = JSON.parse(r.text) as { data?: { id?: string }[] };
      return (j.data ?? []).map(m => m.id).filter((x): x is string => typeof x === "string").sort();
    } catch { return []; }
  }

  /** Multimodale Nachricht (Text-Prompt + Bild als image_url-Data-URL). */
  private buildMessages(dataUrl: string, prompt: string) {
    return [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    }];
  }

  /** Non-streaming /v1/chat/completions-Call. Modell autoritativ aus der Response. */
  async transcribe(dataUrl: string, prompt: string): Promise<{ content: string; model: string }> {
    const res = await http()(`${this.endpoint}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, messages: this.buildMessages(dataUrl, prompt), stream: false }),
    });
    if (!res.ok) throw new Error(`Vision HTTP ${res.status}`);
    const j = JSON.parse(res.text) as { model?: string; choices?: { message?: { content?: string } }[] };
    return { content: j.choices?.[0]?.message?.content ?? "", model: j.model ?? this.model };
  }

  /** Passive Vision-Erkennung: native Metadaten-Probe + Namens-Heuristik.
   *  this.endpoint ist bereits /v1-frei (normalizeEndpoint) → korrekte Basis-URL. */
  async visionConfidence(model: string): Promise<Confidence> {
    return resolveVision(await fetchVisionCapability(http(), this.endpoint, model), model);
  }

  /** Aktiver Vision-Test: schickt das übergebene Test-Bild und prüft, ob die Antwort
   *  das erwartete Token enthält. Throws bei Netz-/HTTP-Fehler (Endpoint nicht erreichbar). */
  async testVision(dataUrl: string): Promise<boolean> {
    const { content } = await this.transcribe(dataUrl, VISION_TEST_PROMPT);
    return isVisionConfirmed(content);
  }

  /** Streamende Variante für die Sidebar: liefert content+reasoning live, plus das Modell
   *  aus dem ersten SSE-Chunk (Fallback: Konstruktor-Modell). Nutzt bewusst fetch — requestUrl
   *  liefert nur die vollständige Antwort, kann also nicht token-weise streamen. */
  async transcribeStream(
    dataUrl: string, prompt: string,
    onContent: (t: string) => void, onReasoning: (t: string) => void,
    signal?: AbortSignal,
  ): Promise<{ content: string; reasoning: string; model: string }> {
    if (!streamFn) throw new Error("VisionClient: Stream-Transport nicht konfiguriert (setStreamFetch aufrufen)");
    const res = await streamFn(`${this.endpoint}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, messages: this.buildMessages(dataUrl, prompt), stream: true }),
      signal,
    });
    if (!res.ok) throw new Error(`Vision HTTP ${res.status}`);
    const r = await streamSSE(res, onContent, onReasoning);
    return { content: r.content, reasoning: r.reasoning, model: r.model || this.model };
  }
}
