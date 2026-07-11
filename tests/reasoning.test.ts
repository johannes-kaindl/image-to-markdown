import { describe, it, expect } from "vitest";
import { suppressParams, isAlwaysOnThinker, reasoningHappened } from "../src/vendor/kit/reasoning";

describe("suppressParams", () => {
  it("suppress=true → die drei provider-übergreifenden Params", () => {
    expect(suppressParams(true)).toEqual({
      reasoning_effort: "none",
      chat_template_kwargs: { enable_thinking: false },
      reasoning_budget: 0,
    });
  });
  it("suppress=false → leeres Objekt", () => {
    expect(suppressParams(false)).toEqual({});
  });
});

describe("isAlwaysOnThinker", () => {
  it("gpt-oss / harmony (auch mit Umgebungs-Tokens) → true", () => {
    expect(isAlwaysOnThinker("gpt-oss")).toBe(true);
    expect(isAlwaysOnThinker("gpt-oss:20b")).toBe(true);
    expect(isAlwaysOnThinker("openai/harmony-v1")).toBe(true);
  });
  it("Nicht-immer-an-Modelle → false", () => {
    expect(isAlwaysOnThinker("qwen3:8b")).toBe(false);
    expect(isAlwaysOnThinker("llava")).toBe(false);
    expect(isAlwaysOnThinker("")).toBe(false);
  });
});

describe("reasoningHappened", () => {
  it("separates reasoning-Feld mit Inhalt → true", () => {
    expect(reasoningHappened("x", "hmm")).toBe(true);
  });
  it("inline <think> mit Inhalt → true, leer/kein Tag → false", () => {
    expect(reasoningHappened("<think>abc</think>ok", undefined)).toBe(true);
    expect(reasoningHappened("<think></think>ok", undefined)).toBe(false);
    expect(reasoningHappened("nur content", "")).toBe(false);
  });
});
