// vendored from obsidian-kit#0.3.0, src/pure/sse.ts
/** Akkumuliert OpenAI-SSE-Deltas (content + reasoning_content) aus einem (Teil-)Buffer;
 *  unvollständige letzte Zeile → rest. `model` = erstes im Buffer gesehenes Chunk-`model`-Feld.
 *  `finishReason` = erstes non-empty `choices[0].finish_reason` (OpenAI sendet in Zwischen-Chunks
 *  `null`, im letzten Chunk den String) — erlaubt dem Aufrufer, eine Token-Limit-Truncation zu
 *  erkennen (`finishReason === "length"`). Reine Funktion — kein Zustand.
 *
 *  Der Transport (`streamSSE`) bleibt bewusst plugin-lokal: er divergiert je nach Runtime
 *  (fetch ReadableStream vs. XMLHttpRequest, PROF-OBS-12) und ist nicht teilbar.
 *
 *  @example
 *  parseSSE('data: {"choices":[{"delta":{"content":"Hi"}}]}\n')
 *  // → { content: ["Hi"], reasoning: [], model: undefined, finishReason: undefined, rest: "", done: false } */
export function parseSSE(buffer: string): { content: string[]; reasoning: string[]; model?: string; finishReason?: string; rest: string; done: boolean } {
  const content: string[] = [];
  const reasoning: string[] = [];
  let model: string | undefined;
  let finishReason: string | undefined;
  let done = false;
  const lines = buffer.split(/\r\n|\n|\r/);
  const rest = lines.pop() ?? "";
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const data = t.slice(5).trim();
    if (data === "[DONE]") { done = true; continue; }
    try {
      const j = JSON.parse(data) as { model?: string; choices?: { delta?: { content?: string; reasoning_content?: string }; finish_reason?: string | null }[] };
      if (model === undefined && typeof j.model === "string") model = j.model;
      const c0 = j.choices?.[0];
      if (finishReason === undefined && typeof c0?.finish_reason === "string" && c0.finish_reason) finishReason = c0.finish_reason;
      const d = c0?.delta;
      if (typeof d?.content === "string") content.push(d.content);
      if (typeof d?.reasoning_content === "string") reasoning.push(d.reasoning_content);
    } catch { /* unvollständig — sollte bei kompletten Zeilen nicht passieren */ }
  }
  return { content, reasoning, model, finishReason, rest, done };
}
