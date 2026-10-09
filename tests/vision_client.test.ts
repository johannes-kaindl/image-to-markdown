import { describe, it, expect } from "vitest";
import { VisionClient, setHttp, type HttpResponse } from "../src/vision_client";

// Die Fähigkeits-Probe läuft über den injizierten HttpFetch (requestUrl-Adapter in Obsidian). Chat, Ping
// und Modellliste gehören seit dem Verbindungs-Tausch der Kit-Verbindung (Kit-Tests, GUI-Smoke).
function mockHttp(impl: (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => HttpResponse): { url: string; headers?: Record<string, string> }[] {
  const calls: { url: string; headers?: Record<string, string> }[] = [];
  setHttp((url, init) => { calls.push({ url, headers: init?.headers }); return Promise.resolve(impl(url, init)); });
  return calls;
}
const ok = (obj: unknown): HttpResponse => ({ ok: true, status: 200, text: JSON.stringify(obj) });

describe("VisionClient.visionConfidence", () => {
  it("liefert 'confirmed' aus Ollama-Metadaten", async () => {
    mockHttp(() => ok({ capabilities: ["vision"] }));
    expect(await new VisionClient("http://h:1234").visionConfidence("m")).toBe("confirmed");
  });
  it("fällt ohne Metadaten auf die Namens-Heuristik zurück", async () => {
    mockHttp(() => ({ ok: false, status: 404, text: "" }));
    expect(await new VisionClient("http://h:1234").visionConfidence("qwen2-vl")).toBe("likely");
    expect(await new VisionClient("http://h:1234").visionConfidence("qwen3:8b")).toBe("no");
  });
});

describe("VisionClient — Schlüssel", () => {
  it("der Schlüssel des aufgelösten Endpunkts geht als Authorization-Header an die Probe", async () => {
    const calls = mockHttp(() => ok({ capabilities: ["vision"] }));
    await new VisionClient("http://h:1234", "sk-geheim").visionConfidence("m");
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.headers?.Authorization === "Bearer sk-geheim")).toBe(true);
  });
  it("ohne Schlüssel kein Authorization-Header (lokale Server lehnen einen leeren Bearer teils ab)", async () => {
    const calls = mockHttp(() => ok({ capabilities: ["vision"] }));
    await new VisionClient("http://h:1234").visionConfidence("m");
    expect(calls.every((c) => !c.headers || !("Authorization" in c.headers))).toBe(true);
  });
});
