import { describe, it, expect } from "vitest";
import { createOcrProviderApi, shortcutResultToOcr } from "../src/ocr_provider";
import { isOcrProviderApi } from "../src/vendor/kit/ocr-provider";
import type { ShortcutResult } from "../src/vendor/kit-obsidian/shortcuts-bridge";

describe("createOcrProviderApi", () => {
  it("erfüllt den Kit-Form-Guard isOcrProviderApi", () => {
    const api = createOcrProviderApi({ extractText: async () => "x" });
    expect(isOcrProviderApi(api)).toBe(true);
  });

  it("delegiert extractText unveraendert an deps", async () => {
    const api = createOcrProviderApi({ extractText: async (p) => `text:${p}` });
    await expect(api.extractText("attachments/foo.png")).resolves.toBe("text:attachments/foo.png");
  });

  it("gibt einen OcrProviderError unveraendert durch", async () => {
    const api = createOcrProviderApi({ extractText: async () => ({ error: "timeout", message: "keine Antwort" }) });
    await expect(api.extractText("x.png")).resolves.toEqual({ error: "timeout", message: "keine Antwort" });
  });
});

describe("shortcutResultToOcr", () => {
  it("liefert den Rohtext bei ok", () => {
    const r: ShortcutResult = { ok: true, result: "Hallo Welt", durationMs: 1100 };
    expect(shortcutResultToOcr(r)).toBe("Hallo Welt");
  });

  it.each([
    ["timeout", "timeout"],
    ["busy", "busy"],
    ["error", "failed"],
    ["cancel", "failed"],
    ["file-missing", "failed"],
  ] as const)("bildet reason=%s auf error=%s ab", (reason, expected) => {
    const r: ShortcutResult = { ok: false, reason, message: "m", durationMs: 5 };
    expect(shortcutResultToOcr(r)).toEqual({ error: expected, message: "m" });
  });
});
