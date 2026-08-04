import { describe, it, expect } from "vitest";
import { thinkToggleView, effectiveSuppress } from "../src/reasoning_toggle";

describe("thinkToggleView — Label, Klasse, disabled", () => {
  it("immer-an-Modell → disabled, thinkingAlways, is-disabled (unabhängig vom Suppress-Flag)", () => {
    expect(thinkToggleView("gpt-oss:20b", false)).toEqual({ labelKey: "view.thinkingAlways", hintKey: null, cls: "is-disabled", disabled: true });
    expect(thinkToggleView("gpt-oss:20b", true)).toEqual({ labelKey: "view.thinkingAlways", hintKey: null, cls: "is-disabled", disabled: true });
  });
  it("normales Modell, nicht unterdrückt → thinkingOn, klickbar", () => {
    expect(thinkToggleView("qwen3:8b", false)).toEqual({ labelKey: "view.thinkingOn", hintKey: null, cls: "", disabled: false });
  });
  it("normales Modell, unterdrückt → thinkingOff, is-off, klickbar", () => {
    expect(thinkToggleView("qwen3:8b", true)).toEqual({ labelKey: "view.thinkingOff", hintKey: null, cls: "is-off", disabled: false });
  });
});

describe("thinkToggleView — hintKey aus der Kit-Heuristik", () => {
  it("support 'none' (erkannter Nicht-Denker) → kein Hinweis (die Heuristik kann „bekannt kein Denker“ nicht von „unbekannter Name“ unterscheiden)", () => {
    expect(thinkToggleView("llama3.1:8b", false).hintKey).toBeNull();
  });
  it("support 'hybrid' → kein Hinweis (der Toggle tut genau, was er verspricht)", () => {
    expect(thinkToggleView("qwen3:8b", false).hintKey).toBeNull();
    expect(thinkToggleView("granite3.3", true).hintKey).toBeNull();
  });
  it("support 'always' ohne Sperre → Hinweis, dass Abschalten vermutlich nicht wirkt", () => {
    expect(thinkToggleView("deepseek-r1:8b", false).hintKey).toBe("view.thinkingHintAlways");
    expect(thinkToggleView("qwq:32b", true).hintKey).toBe("view.thinkingHintAlways");
  });

  // ── Vorrang-Regel 1: disabled schlägt den Hinweis ──────────────────────────
  it("gpt-oss ist gesperrt → kein Hinweis (das Label sagt bereits „immer an\")", () => {
    const v = thinkToggleView("gpt-oss:20b", false);
    expect(v.disabled).toBe(true);
    expect(v.hintKey).toBeNull();
  });

  // ── Vorrang-Regel 2: kein Modell gewählt ──────────────────────────────────
  it("leerer Modellname → kein Hinweis (keine Aussage über ein Modell, das es nicht gibt)", () => {
    expect(thinkToggleView("", false).hintKey).toBeNull();
    expect(thinkToggleView("", true).hintKey).toBeNull();
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

// ── Die Zusicherung, die die zentrale Design-Entscheidung festzurrt ──────────
// Ohne sie ist „die reichere Erkennung fasst das Request-Verhalten nicht an" eine
// Absichtserklärung statt einer Eigenschaft. deepseek-r1 und qwq stuft die Kit-Heuristik
// als support:"always" ein — sie sind aber NICHT isAlwaysOnThinker: sie schlucken
// reasoning_effort:"none" als harmloses No-op, während gpt-oss/harmony den Request ablehnen.
describe("Nicht-Regression: die Heuristik ändert nur die Beschriftung", () => {
  for (const model of ["deepseek-r1:8b", "qwq:32b", "magistral-small", "glm-z1:9b"]) {
    it(`${model}: als 'always' erkannt, aber weder gesperrt noch vom Suppress ausgenommen`, () => {
      const v = thinkToggleView(model, true);
      expect(v.hintKey).toBe("view.thinkingHintAlways");
      expect(v.disabled).toBe(false);
      expect(v.cls).toBe("is-off");
      expect(v.labelKey).toBe("view.thinkingOff");
      expect(effectiveSuppress(model, true)).toBe(true);
    });
  }
});
