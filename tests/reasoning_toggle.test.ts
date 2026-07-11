import { describe, it, expect } from "vitest";
import { thinkToggleView } from "../src/reasoning_toggle";

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
