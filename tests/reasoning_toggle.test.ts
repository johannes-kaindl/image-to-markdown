import { describe, it, expect } from "vitest";
import { thinkToggleView, effectiveSuppress } from "../src/reasoning_toggle";

describe("thinkToggleView", () => {
  it("immer-an-Modell → disabled, thinkingAlways, is-disabled (unabhängig vom Suppress-Flag)", () => {
    expect(thinkToggleView("gpt-oss:20b", false)).toEqual({ labelKey: "view.thinkingAlways", cls: "is-disabled", disabled: true });
    expect(thinkToggleView("gpt-oss:20b", true)).toEqual({ labelKey: "view.thinkingAlways", cls: "is-disabled", disabled: true });
  });
  it("normales Modell, nicht unterdrückt → thinkingOn, klickbar", () => {
    expect(thinkToggleView("qwen3:8b", false)).toEqual({ labelKey: "view.thinkingOn", cls: "", disabled: false });
  });
  it("normales Modell, unterdrückt → thinkingOff, is-off, klickbar", () => {
    expect(thinkToggleView("qwen3:8b", true)).toEqual({ labelKey: "view.thinkingOff", cls: "is-off", disabled: false });
  });
});

describe("effectiveSuppress", () => {
  it("immer-an-Modell + Suppress-Wunsch → nie unterdrücken (Request folgt dem disabled-Zustand der View)", () => {
    expect(effectiveSuppress("gpt-oss:20b", true)).toBe(false);
  });
  it("normales Modell + Suppress-Wunsch → unterdrücken", () => {
    expect(effectiveSuppress("qwen3:8b", true)).toBe(true);
  });
  it("normales Modell, kein Suppress-Wunsch → nicht unterdrücken", () => {
    expect(effectiveSuppress("qwen3:8b", false)).toBe(false);
  });
});
