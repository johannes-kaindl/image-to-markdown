import { describe, it, expect } from "vitest";
import { PROMPT_PRESETS, isPromptPreset, promptPresetLabel, builtinPromptText, resolvePromptText } from "../src/prompts";
import { setLang, defaultVisionPrompt } from "../src/i18n";

describe("prompts — Registry", () => {
  it("PROMPT_PRESETS beginnt mit default, enthält die 5 Built-ins", () => {
    expect(PROMPT_PRESETS[0]).toBe("default");
    expect([...PROMPT_PRESETS]).toEqual(["default", "tables", "handwriting", "math", "code", "describe"]);
  });
  it("isPromptPreset erkennt bekannte/unbekannte ids", () => {
    expect(isPromptPreset("math")).toBe(true);
    expect(isPromptPreset("nope")).toBe(false);
  });
});

describe("prompts — Labels & Built-in-Texte (EN+DE)", () => {
  it("promptPresetLabel liefert lokalisierte Labels, Fallback = id", () => {
    setLang("en"); expect(promptPresetLabel("tables")).toBe("Tables → Markdown");
    setLang("de"); expect(promptPresetLabel("tables")).toBe("Tabellen → Markdown");
    expect(promptPresetLabel("nope")).toBe("nope");
    setLang("en");
  });
  it("builtinPromptText: default → '', Built-ins nicht-leer in EN+DE", () => {
    expect(builtinPromptText("default")).toBe("");
    for (const lang of ["en", "de"] as const) {
      setLang(lang);
      for (const id of ["tables", "handwriting", "math", "code", "describe"]) {
        expect(builtinPromptText(id).length).toBeGreaterThan(10);
        expect(builtinPromptText(id)).not.toContain("preset.prompt.");   // kein fehlender Key
      }
    }
    setLang("en");
  });
});

describe("prompts — resolvePromptText", () => {
  it("default → customDefault", () => {
    expect(resolvePromptText("default", "MEIN PROMPT")).toBe("MEIN PROMPT");
  });
  it("default mit leerem customDefault → defaultVisionPrompt()", () => {
    setLang("en");
    expect(resolvePromptText("default", "   ")).toBe(defaultVisionPrompt());
  });
  it("Built-in → dessen Text (nicht customDefault)", () => {
    setLang("en");
    expect(resolvePromptText("math", "MEIN PROMPT")).toBe(builtinPromptText("math"));
  });
  it("unbekannte id → wie default (customDefault)", () => {
    expect(resolvePromptText("nope", "MEIN PROMPT")).toBe("MEIN PROMPT");
  });
});
