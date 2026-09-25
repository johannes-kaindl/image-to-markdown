import { describe, it, expect, vi } from "vitest";
import { resolveVisionEndpoint, sanitizeChoice } from "../src/resolve_endpoint";
import type { LlmEndpointManagerApi } from "../src/vendor/kit/endpoint-source";

function fakeManager(over: Partial<LlmEndpointManagerApi> = {}): LlmEndpointManagerApi {
  return {
    version: 1,
    list: () => [],
    get: () => null,
    resolve: vi.fn(async () => ({ id: "m1", label: "M", config: { url: "http://manager:1234" }, defaultModel: "qwen-vl" })),
    materialize: vi.fn(async (id: string) => ({ id, label: id, config: { url: `http://${id}:1234` }, defaultModel: "gemma-vl" })),
    models: vi.fn(async () => []),
    importEndpoints: vi.fn(async () => ({ added: [], merged: [], skipped: [] })),
    on: () => () => {},
    ...over,
  } as unknown as LlmEndpointManagerApi;
}

const up = async (): Promise<boolean> => true;
const base = { visionEndpoints: [{ url: "http://local:8080" }], visionModel: "lokal-vl", choice: {} };

describe("resolveVisionEndpoint", () => {
  it("ohne Manager: lokale Liste, Modell = visionModel", async () => {
    const r = await resolveVisionEndpoint(base, null, up);
    expect(r.kind).toBe("local");
    expect(r.config?.url).toBe("http://local:8080");
    expect(r.model).toBe("lokal-vl");
  });

  it("ohne Manager: eine gespeicherte Wahl (choice) wird ignoriert — Modellnamen gelten je Endpunkt", async () => {
    const r = await resolveVisionEndpoint({ ...base, choice: { endpointId: "x", model: "fremd" } }, null, up);
    expect(r.model).toBe("lokal-vl");
  });

  it("ohne Manager: das Modell der Zeile schlaegt das globale visionModel", async () => {
    const r = await resolveVisionEndpoint({ ...base, visionEndpoints: [{ url: "http://local:8080", model: "zeilen-vl" }] }, null, up);
    expect(r.model).toBe("zeilen-vl");
  });

  it("mit Manager: Vorrang, capability vision, Default-Modell des Endpunkts", async () => {
    const m = fakeManager();
    const r = await resolveVisionEndpoint(base, m, up);
    expect(r.kind).toBe("manager");
    expect(r.config?.url).toBe("http://manager:1234");
    expect(r.model).toBe("qwen-vl");
    expect(m.resolve).toHaveBeenCalledWith("vision", { caller: "image-to-markdown" });
  });

  it("mit Manager: choice haelt Endpunkt und Modell", async () => {
    const m = fakeManager();
    const r = await resolveVisionEndpoint({ ...base, choice: { endpointId: "ep7", model: "mein-vl" } }, m, up);
    expect(m.materialize).toHaveBeenCalledWith("ep7", { caller: "image-to-markdown" });
    expect(r.config?.url).toBe("http://ep7:1234");
    expect(r.model).toBe("mein-vl");
  });

  it("Manager ohne Endpunkt: kein lokaler Rueckfall, Grund durchgereicht", async () => {
    const m = fakeManager({ resolve: vi.fn(async () => ({ error: "no-endpoint" as const })) });
    const r = await resolveVisionEndpoint(base, m, up);
    expect(r.kind).toBe("manager");
    expect(r.config).toBeNull();
    expect(r.reason).toBe("no-endpoint");
  });
});

describe("sanitizeChoice", () => {
  it("fehlt oder kaputt → leere Wahl", () => {
    expect(sanitizeChoice(undefined)).toEqual({});
    expect(sanitizeChoice("quatsch")).toEqual({});
    expect(sanitizeChoice(null)).toEqual({});
  });
  it("nur nicht-leere Strings bleiben", () => {
    expect(sanitizeChoice({ endpointId: "a", model: 5 })).toEqual({ endpointId: "a" });
    expect(sanitizeChoice({ endpointId: "", model: "m" })).toEqual({ model: "m" });
  });
});
