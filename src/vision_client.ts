import { streamSSE } from "./sse";

/** Normalisiert eine Endpoint-Eingabe: trailing Slashes + ein trailing `/v1` strippen.
 *  So funktioniert sowohl `http://host:1234` als auch `http://host:1234/v1` — die Client-
 *  Methoden hängen `/v1/...` selbst an, ein doppeltes `/v1` würde sonst 200+Fehler-Body geben. */
export function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "").replace(/\/v1$/, "").replace(/\/+$/, "");
}

export class VisionClient {
  private endpoint: string;
  constructor(endpoint: string, private model: string) {
    this.endpoint = normalizeEndpoint(endpoint);
  }

  /** Verbindungs-Check gegen den OpenAI-kompatiblen Endpoint (GET /v1/models). */
  async ping(): Promise<boolean> {
    try { return (await fetch(`${this.endpoint}/v1/models`)).ok; } catch { return false; }
  }

  /** Verfügbare Modelle vom Endpoint (GET /v1/models). [] bei Fehler/Offline. */
  async listModels(): Promise<string[]> {
    try {
      const r = await fetch(`${this.endpoint}/v1/models`);
      if (!r.ok) return [];
      const j = await r.json() as { data?: { id?: string }[] };
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
  async transcribe(dataUrl: string, prompt: string, signal?: AbortSignal): Promise<{ content: string; model: string }> {
    const res = await fetch(`${this.endpoint}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, messages: this.buildMessages(dataUrl, prompt), stream: false }),
      signal,
    });
    if (!res.ok) throw new Error(`Vision HTTP ${res.status}`);
    const j = await res.json() as { model?: string; choices?: { message?: { content?: string } }[] };
    return { content: j.choices?.[0]?.message?.content ?? "", model: j.model ?? this.model };
  }

  /** Streamende Variante für die Sidebar: liefert content+reasoning live, plus das Modell
   *  aus dem ersten SSE-Chunk (Fallback: Konstruktor-Modell). */
  async transcribeStream(
    dataUrl: string, prompt: string,
    onContent: (t: string) => void, onReasoning: (t: string) => void,
    signal?: AbortSignal,
  ): Promise<{ content: string; reasoning: string; model: string }> {
    const res = await fetch(`${this.endpoint}/v1/chat/completions`, {
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
