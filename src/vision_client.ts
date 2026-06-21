import { streamSSE } from "./sse";

export class VisionClient {
  constructor(private endpoint: string, private model: string) {}

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
