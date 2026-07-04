import { parseSSE } from "./vendor/kit/sse";
import { ThinkSplitter } from "./vendor/kit/think";

/** Liest einen OpenAI-kompatiblen SSE-Stream aus einer bereits geprüften Response (res.ok).
 *  Ruft onContent/onReasoning pro Delta; trennt inline <think> via ThinkSplitter; drained am
 *  Ende TextDecoder-Multibyte + Splitter-Rest. Gibt das Akkumulat + das erste Chunk-model zurück. */
export async function streamSSE(
  res: Response,
  onContent: (t: string) => void,
  onReasoning: (t: string) => void,
): Promise<{ content: string; reasoning: string; model: string; raw: string }> {
  const reader = (res as unknown as { body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } } }).body.getReader();
  const dec = new TextDecoder();
  const splitter = new ThinkSplitter();
  // raw = kompletter dekodierter Body — erlaubt dem Aufrufer, einen 200-Fehler-Body (kein SSE) zu erkennen.
  let buffer = "", content = "", reasoning = "", model = "", raw = "";
  const emit = (c: string, r: string) => {
    if (c) { content += c; onContent(c); }
    if (r) { reasoning += r; onReasoning(r); }
  };
  const drain = (p: { content: string[]; reasoning: string[]; model?: string }) => {
    if (!model && p.model) model = p.model;
    for (const r of p.reasoning) emit("", r);
    for (const c of p.content) { const s = splitter.push(c); emit(s.content, s.reasoning); }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = dec.decode(value, { stream: true });
    buffer += chunk; raw += chunk;
    const p = parseSSE(buffer);
    buffer = p.rest;
    drain(p);
    if (p.done) break;
  }
  // Stream-Ende drainen: TextDecoder leeren (Multibyte über die letzte Chunk-Grenze)
  // + ThinkSplitter-Rest flushen — sonst gingen letzte Zeichen/ein angefangenes Tag verloren.
  const tailChunk = dec.decode();
  buffer += tailChunk; raw += tailChunk;
  drain(parseSSE(buffer));
  const tail = splitter.flush();
  emit(tail.content, tail.reasoning);
  return { content, reasoning, model, raw };
}
