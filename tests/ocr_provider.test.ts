import { describe, it, expect, vi } from "vitest";
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

describe("createOcrProviderApi — Abbruch nach Kit-Vertrag 0.93.0", () => {
  it("ein schon abgebrochenes Signal liefert aborted ohne Backend-Aufruf", async () => {
    const extractText = vi.fn(async () => "x");
    const ac = new AbortController(); ac.abort();
    await expect(createOcrProviderApi({ extractText }).extractText("a.png", { signal: ac.signal })).resolves.toMatchObject({ error: "aborted" });
    expect(extractText).not.toHaveBeenCalled();
  });

  it("ein Abbruch währenddessen liefert aborted, auch wenn das Backend nie antwortet (Kurzbefehl)", async () => {
    const api = createOcrProviderApi({ extractText: () => new Promise(() => undefined) });
    const ac = new AbortController();
    const p = api.extractText("a.png", { signal: ac.signal });
    ac.abort();
    await expect(p).resolves.toMatchObject({ error: "aborted" });
  });

  it("ein spätes Ergebnis nach dem Abbruch wird verworfen", async () => {
    let finish: (v: string) => void = () => undefined;
    const api = createOcrProviderApi({ extractText: () => new Promise<string>((r) => { finish = r; }) });
    const ac = new AbortController();
    const p = api.extractText("a.png", { signal: ac.signal });
    ac.abort(); finish("zu spät");
    await expect(p).resolves.toMatchObject({ error: "aborted" });
  });

  it("ein AbortError des Backends ist aborted, kein Wurf", async () => {
    const api = createOcrProviderApi({ extractText: async () => { const e = new Error("x"); e.name = "AbortError"; throw e; } });
    await expect(api.extractText("a.png", { signal: new AbortController().signal })).resolves.toMatchObject({ error: "aborted" });
  });

  it("reicht das Signal an das Backend durch", async () => {
    const extractText = vi.fn(async (_p: string, _o?: { signal?: AbortSignal }) => "x");
    const ac = new AbortController();
    await createOcrProviderApi({ extractText }).extractText("a.png", { signal: ac.signal });
    expect(extractText.mock.calls[0]?.[1]?.signal).toBe(ac.signal);
  });

  it("Gegenprobe: ohne Abbruch bleibt Ergebnis und Fehlerwert unverändert; ein anderer Fehler wirft weiter", async () => {
    const ac = new AbortController();
    await expect(createOcrProviderApi({ extractText: async () => "text" }).extractText("a.png", { signal: ac.signal })).resolves.toBe("text");
    await expect(createOcrProviderApi({ extractText: async () => ({ error: "timeout", message: "t" }) }).extractText("a.png", { signal: ac.signal })).resolves.toEqual({ error: "timeout", message: "t" });
    await expect(createOcrProviderApi({ extractText: async () => { throw new Error("boom"); } }).extractText("a.png", { signal: ac.signal })).rejects.toThrow("boom");
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
