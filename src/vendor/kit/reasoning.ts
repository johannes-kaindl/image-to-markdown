// vendored from obsidian-kit#0.7.0, src/pure/reasoning.ts
export type ThinkingSupport = "none" | "hybrid" | "always";

/** Union-Params zum Abschalten von Reasoning über viele lokale Server hinweg.
 *  Leeres Objekt, wenn nicht unterdrückt werden soll.
 *  - reasoning_effort:"none"         → Ollama, vLLM, OpenAI-Standard
 *  - chat_template_kwargs.enable_*   → llama.cpp, MLX, LM Studio (passthrough), Qwen3
 *  - reasoning_budget:0              → llama.cpp belt-and-suspenders
 *  WICHTIG: reasoning_effort nie als Boolean / nie "minimal" (Ollama lehnt beides ab). */
export function suppressParams(suppress: boolean): Record<string, unknown> {
  if (!suppress) return {};
  return {
    reasoning_effort: "none",
    chat_template_kwargs: { enable_thinking: false },
    reasoning_budget: 0,
  };
}

const THINK_TAG = /<think>([\s\S]*?)<\/think>/;

/** Hat das Modell real gedacht? (separates reasoning-Feld ODER inline <think> mit Inhalt).
 *  Dient dazu, „Suppress hat nicht gegriffen" ehrlich zu erkennen. */
export function reasoningHappened(content: string, reasoning: string | undefined): boolean {
  if (reasoning && reasoning.trim() !== "") return true;
  const m = THINK_TAG.exec(content);
  return !!m && m[1].trim() !== "";
}

const ALWAYS_ON = /\b(gpt-oss|harmony)\b/i;

/** Modelle, die sich prinzipiell nicht vollständig abschalten lassen (nur low/medium/high). */
export function isAlwaysOnThinker(model: string): boolean {
  return ALWAYS_ON.test(model);
}
