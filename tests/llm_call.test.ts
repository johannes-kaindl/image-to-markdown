import { describe, it, expect } from "vitest";
import { chatOutOrThrow } from "../src/llm_call";
import type { LlmResult } from "../src/vendor/kit-obsidian/llm-connection";
import { setLang } from "../src/i18n";

setLang("en");
const source = { kind: "local", config: { url: "http://x" }, model: "anzeige-modell", sentModel: "wire-modell", family: null, familySource: "none", backend: "unknown", backendSource: "none" } as unknown as LlmResult["source"];
const timing = { startedAt: 0, endedAt: 1 };
const okResult = (over: Record<string, unknown> = {}): LlmResult =>
  ({ ok: true, content: "# Titel", reasoning: "denkt", toolCalls: [], truncated: false, streamed: true, timing, facts: null, deviations: [], source, ...over }) as unknown as LlmResult;
const fail = (kind: string, over: Record<string, unknown> = {}): LlmResult =>
  ({ ok: false, kind, detail: "d", partial: "", reasoning: "", timing, facts: null, deviations: [], source, ...over }) as unknown as LlmResult;

describe("chatOutOrThrow — Ergebnis", () => {
  it("liefert Inhalt, Reasoning und das Modell, das der SERVER nennt", () => {
    expect(chatOutOrThrow(okResult({ model: "server-modell", finishReason: "stop" })))
      .toEqual({ content: "# Titel", reasoning: "denkt", model: "server-modell", finishReason: "stop" });
  });
  it("ohne Modell der Antwort: das aufgelöste Modell der Quelle", () => {
    expect(chatOutOrThrow(okResult()).model).toBe("anzeige-modell");
  });
  it("finishReason 'length' kommt als Ergebnis an, nicht als Ausnahme (Token-Limit, Teiltext gültig)", () => {
    const r = chatOutOrThrow(okResult({ content: "", finishReason: "length", truncated: true }));
    expect(r.finishReason).toBe("length");
    expect(r.content).toBe("");
  });
  it("kein finishReason: der Schlüssel fehlt (exactOptionalPropertyTypes)", () => {
    expect("finishReason" in chatOutOrThrow(okResult())).toBe(false);
  });
});

describe("chatOutOrThrow — Fehler mit nutzersichtbarem Satz", () => {
  it("Abbruch bleibt ein AbortError (die Namen-Prüfung der Aufrufer hängt daran)", () => {
    try { chatOutOrThrow(fail("aborted")); expect.unreachable(); } catch (e) { expect((e as Error).name).toBe("AbortError"); }
  });
  it("kein Endpunkt in der lokalen Liste: eigener Satz mit der Konfigurationsmeldung", () => {
    expect(() => chatOutOrThrow(fail("no-endpoint", { detail: "disabled" }))).toThrow("No vision endpoint is available (disabled).");
  });
  it("kein Endpunkt beim Manager: der Kit-Text zum gemeldeten Code (Schluessel fehlt, abgeschaltet)", () => {
    const manager = { ...(source as object), kind: "manager" } as unknown as LlmResult["source"];
    expect(() => chatOutOrThrow(fail("no-endpoint", { detail: "secret-missing", source: manager }))).toThrow("needs an API key that isn't stored yet");
    expect(() => chatOutOrThrow(fail("no-endpoint", { detail: "disabled", source: manager }))).toThrow("switched off in the LLM Endpoint Manager");
  });
  it("kein Endpunkt beim Manager mit unbekanntem Code: der Text zu „no-endpoint“, nie ein leerer Satz", () => {
    const manager = { ...(source as object), kind: "manager" } as unknown as LlmResult["source"];
    expect(() => chatOutOrThrow(fail("no-endpoint", { detail: "irgendwas Neues", source: manager }))).toThrow("has no usable endpoint");
  });
  it("Timeout nennt die Kit-Meldung, keine einstellbare Sekundenzahl des Plugins", () => {
    expect(() => chatOutOrThrow(fail("timeout", { detail: "no chunk for 120 s" }))).toThrow("stopped responding (no chunk for 120 s)");
  });
  it("Netzfehler", () => { expect(() => chatOutOrThrow(fail("network", { detail: "ECONNREFUSED" }))).toThrow("not reachable: ECONNREFUSED"); });
  it("Kontext-Überlauf", () => { expect(() => chatOutOrThrow(fail("overflow"))).toThrow("too long"); });
  it("HTTP-Fehler trägt Status und Servermeldung", () => {
    expect(() => chatOutOrThrow(fail("http", { status: 500, detail: "boom" }))).toThrow("HTTP 500: boom");
  });
  it("Fehler ohne Status: unbrauchbare Antwort (LM-Studio-Footgun: 200 + Fehlerkörper)", () => {
    expect(() => chatOutOrThrow(fail("http", { detail: "Unexpected endpoint" }))).toThrow("unusable response: Unexpected endpoint");
  });
});
