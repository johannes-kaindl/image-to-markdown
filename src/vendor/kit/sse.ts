// vendored from code-kit@0.8.0, src/ts/pure/sse.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Ein `tool_calls`-Delta aus einem SSE-Chunk; `id`/`name` stehen nur im ersten Chunk eines Aufrufs. */
export interface ToolCallDelta { index: number; id?: string; name?: string; argsDelta?: string }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Akkumuliert OpenAI-SSE-Deltas (content + Reasoning) aus einem (Teil-)Buffer;
 *  unvollständige letzte Zeile → rest. `model` = erstes im Buffer gesehenes Chunk-`model`-Feld.
 *  `finishReason` = erstes non-empty `choices[0].finish_reason` (OpenAI sendet in Zwischen-Chunks
 *  `null`, im letzten Chunk den String) — erlaubt dem Aufrufer, eine Token-Limit-Truncation zu
 *  erkennen (`finishReason === "length"`). Reine Funktion — kein Zustand.
 *
 *  Reasoning speist sich aus drei Delta-Feld-Varianten — pro Delta zählt genau eine, in dieser
 *  Rangfolge: `reasoning_content` (DeepSeek-Stil) → `reasoning` (MLX mlx_lm.server) → `thinking`
 *  (manche Forks). Fehlt `delta`, wird `choices[0].message` gelesen (Server, die trotz
 *  `stream: true` volle Message-Objekte schicken).
 *
 *  `toolCalls` = die `delta.tool_calls`-Einträge aller kompletten Zeilen, je Eintrag ein Delta in
 *  Stream-Reihenfolge (`index`, `id`/`name` nur im Kopf-Chunk, `argsDelta` = das
 *  `function.arguments`-Fragment). Zusammensetzen über mehrere Aufrufe (Argumente nach `index`
 *  konkatenieren) bleibt Sache des Aufrufers — diese Funktion hat keinen Zustand. Fehlt `index`,
 *  gilt die Position im Array. Anders als content/Reasoning wird hier NUR `delta` gelesen, nie der
 *  `message`-Fallback: ein volles Message-Objekt ist keine Delta-Folge. Leeres Array, wenn keins da ist.
 *
 *  Der Transport (`streamSSE`) bleibt bewusst plugin-lokal: er divergiert je nach Runtime
 *  (fetch ReadableStream vs. XMLHttpRequest, PROF-OBS-12) und ist nicht teilbar.
 *
 *  @example
 *  parseSSE('data: {"choices":[{"delta":{"content":"Hi"}}]}\n')
 *  // → { content: ["Hi"], reasoning: [], toolCalls: [], model: undefined, finishReason: undefined, rest: "", done: false } */
export function parseSSE(buffer: string): { content: string[]; reasoning: string[]; toolCalls: ToolCallDelta[]; model?: string; finishReason?: string; rest: string; done: boolean } {
  const content: string[] = [];
  const toolCalls: ToolCallDelta[] = [];
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
      type Delta = { content?: string; tool_calls?: unknown; reasoning_content?: string; reasoning?: string; thinking?: string };
      const j = JSON.parse(data) as { model?: string; choices?: { delta?: Delta; message?: Delta; finish_reason?: string | null }[] };
      if (model === undefined && typeof j.model === "string") model = j.model;
      const c0 = j.choices?.[0];
      if (finishReason === undefined && typeof c0?.finish_reason === "string" && c0.finish_reason) finishReason = c0.finish_reason;
      const d = c0?.delta ?? c0?.message;
      if (typeof d?.content === "string") content.push(d.content);
      const tcs: unknown = c0?.delta?.tool_calls;
      if (Array.isArray(tcs)) {
        tcs.forEach((tc: unknown, i: number) => {
          if (!isRecord(tc)) return;
          const fn = isRecord(tc.function) ? tc.function : {};
          toolCalls.push({
            index: typeof tc.index === "number" ? tc.index : i,
            ...(typeof tc.id === "string" ? { id: tc.id } : {}),
            ...(typeof fn.name === "string" ? { name: fn.name } : {}),
            ...(typeof fn.arguments === "string" ? { argsDelta: fn.arguments } : {}),
          });
        });
      }
      const reason = [d?.reasoning_content, d?.reasoning, d?.thinking].find((v) => typeof v === "string" && v);
      if (reason !== undefined) reasoning.push(reason);
    } catch { /* unvollständig — sollte bei kompletten Zeilen nicht passieren */ }
  }
  return { content, reasoning, toolCalls, model, finishReason, rest, done };
}
