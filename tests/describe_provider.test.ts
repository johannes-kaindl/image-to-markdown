import { describe, it, expect, vi } from "vitest";
import { createDescribeProviderApi, type DescribeProviderDeps, type DescribeRawOut } from "../src/describe_provider";
import type { DescribeProviderError } from "../src/vendor/kit/describe-provider";
import { createOcrProviderApi } from "../src/ocr_provider";
import { isDescribeProviderApi } from "../src/vendor/kit/describe-provider";
import { isOcrProviderApi } from "../src/vendor/kit/ocr-provider";
import { buildDescribePrompt } from "../src/describe";

const TAX = ["Foto", "Diagramm", "Screenshot"];
const RAW = "CATEGORY: diagramm\nTAGS: arch, projekt-x\n---\nEin Flussdiagramm.";

function make(over: Partial<DescribeProviderDeps> = {}) {
  const describeRaw = vi.fn(async (_p: string, _o: { prompt: string; signal?: AbortSignal }): Promise<DescribeRawOut | DescribeProviderError> => ({ raw: RAW, model: "qwen-vl" }));
  const deps: DescribeProviderDeps = { taxonomy: () => TAX, defaultLang: () => "de", describeRaw, ...over };
  const api = createDescribeProviderApi(createOcrProviderApi({ extractText: async (p) => `ocr:${p}` }), deps);
  return { api, describeRaw };
}

describe("createDescribeProviderApi", () => {
  it("trägt OCR und Beschreiben auf demselben api-Objekt, beide Guards grün", () => {
    const { api } = make();
    expect(isDescribeProviderApi(api)).toBe(true);
    expect(isOcrProviderApi(api)).toBe(true);
  });

  it("lässt extractText unverändert durch", async () => {
    const { api } = make();
    await expect(api.extractText("a.png")).resolves.toBe("ocr:a.png");
  });

  it("liefert text/category/tags/model; die Kategorie steht wortgleich in der Taxonomie", async () => {
    const { api } = make();
    const r = await api.describeImage("a.png");
    expect(r).toEqual({ text: "Ein Flussdiagramm.", category: "Diagramm", tags: ["arch", "projekt-x"], model: "qwen-vl" });
  });

  it("nimmt ohne categories die Taxonomie des Plugins, mit categories genau diese", async () => {
    const { api, describeRaw } = make();
    await api.describeImage("a.png");
    expect(describeRaw.mock.calls[0][1].prompt).toBe(buildDescribePrompt(TAX, "de"));
    await api.describeImage("a.png", { categories: ["Foto", "Karte"] });
    expect(describeRaw.mock.calls[1][1].prompt).toBe(buildDescribePrompt(["Foto", "Karte"], "de"));
  });

  it("lässt die Kategorie weg, wenn das Modell eine Kategorie außerhalb von categories nennt", async () => {
    const { api } = make();
    const r = await api.describeImage("a.png", { categories: ["Foto"] });
    expect(r).not.toHaveProperty("error");
    expect((r as { category?: string }).category).toBeUndefined();
    expect((r as { tags?: string[] }).tags).toEqual(["diagramm", "arch", "projekt-x"]);
  });

  it("categories: [] fragt keine Kategorie ab und liefert keine", async () => {
    const { api, describeRaw } = make({ describeRaw: vi.fn(async () => ({ raw: "CATEGORY: Foto\n---\nText" })) });
    void describeRaw;
    const r = await api.describeImage("a.png", { categories: [] });
    expect(r).toEqual({ text: "Text", tags: ["Foto"] });
  });

  it("language wählt de/en (auch als BCP-47), sonst die Vorgabe des Plugins", async () => {
    const { api, describeRaw } = make();
    await api.describeImage("a.png", { language: "en-GB" });
    await api.describeImage("a.png", { language: "de-AT" });
    await api.describeImage("a.png", { language: "fr" });
    const p = describeRaw.mock.calls.map((c) => c[1].prompt);
    expect(p[0]).toBe(buildDescribePrompt(TAX, "en"));
    expect(p[1]).toBe(buildDescribePrompt(TAX, "de"));
    expect(p[2]).toBe(buildDescribePrompt(TAX, "de"));
  });

  it("length bildet sich im Prompt ab, ohne length bleibt der Prompt der Seitenleiste unverändert", async () => {
    const { api, describeRaw } = make();
    await api.describeImage("a.png", { length: "short" });
    await api.describeImage("a.png", { length: "long" });
    const [s, l] = describeRaw.mock.calls.map((c) => c[1].prompt);
    expect(s).not.toBe(l);
    expect(s).not.toBe(buildDescribePrompt(TAX, "de"));
  });

  it("leere Prosa ist failed, nie ein leerer text", async () => {
    const { api } = make({ describeRaw: async () => ({ raw: "CATEGORY: Foto\nTAGS: a\n---\n   " }) });
    expect(await api.describeImage("a.png")).toMatchObject({ error: "failed" });
    const { api: api2 } = make({ describeRaw: async () => ({ raw: "" }) });
    expect(await api2.describeImage("a.png")).toMatchObject({ error: "failed" });
  });

  it("leere Prosa am Token-Limit (finishReason length) nennt das Abschneiden, sonst die leere Beschreibung", async () => {
    const { api } = make({ describeRaw: async () => ({ raw: "", finishReason: "length" }) });
    expect(await api.describeImage("a.png")).toMatchObject({ error: "failed", message: "Antwort abgeschnitten, ohne Beschreibung" });
    const { api: api2 } = make({ describeRaw: async () => ({ raw: "", finishReason: "stop" }) });
    expect(await api2.describeImage("a.png")).toMatchObject({ error: "failed", message: "leere Beschreibung vom Modell" });
  });

  it("ein schon abgebrochenes Signal liefert aborted ohne Backend-Aufruf", async () => {
    const { api, describeRaw } = make();
    const ac = new AbortController(); ac.abort();
    expect(await api.describeImage("a.png", { signal: ac.signal })).toMatchObject({ error: "aborted" });
    expect(describeRaw).not.toHaveBeenCalled();
  });

  it("ein Abbruch währenddessen (AbortError) ist aborted", async () => {
    const { api } = make({ describeRaw: async () => { const e = new Error("x"); e.name = "AbortError"; throw e; } });
    expect(await api.describeImage("a.png")).toMatchObject({ error: "aborted" });
  });

  it("gibt einen Fehlerwert des Backends unverändert durch", async () => {
    const err = { error: "not-found", message: "weg" } as const;
    const { api } = make({ describeRaw: async () => err });
    expect(await api.describeImage("a.png")).toEqual(err);
  });

  it("fängt eine Ausnahme des Backends als failed (nie werfen)", async () => {
    const { api } = make({ describeRaw: async () => { throw new Error("kaputt"); } });
    expect(await api.describeImage("a.png")).toEqual({ error: "failed", message: "kaputt" });
  });

  it("ohne model im Backend-Ergebnis fehlt das Feld", async () => {
    const { api } = make({ describeRaw: async () => ({ raw: "Nur Text." }) });
    expect(await api.describeImage("a.png")).toEqual({ text: "Nur Text." });
  });
});

describe("buildDescribePrompt (Erweiterung)", () => {
  it("ohne Taxonomie fehlt die CATEGORY-Zeile", () => {
    const p = buildDescribePrompt([], "en");
    expect(p).not.toContain("CATEGORY:");
    expect(p).toContain("TAGS:");
  });
});
