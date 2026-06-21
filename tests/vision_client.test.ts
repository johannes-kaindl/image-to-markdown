import { describe, it, expect, vi, afterEach } from "vitest";
import { VisionClient } from "../src/vision_client";

function streamRes(chunks: string[], ok = true, status = 200): any {
  let i = 0;
  return { ok, status, body: { getReader: () => ({
    read: async () => i < chunks.length
      ? { done: false, value: new TextEncoder().encode(chunks[i++]) }
      : { done: true, value: undefined },
  }) } };
}

describe("VisionClient", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("transcribe schickt text+image_url, non-streaming, und parst content", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: "# Titel" } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    const out = await new VisionClient("http://x", "vm").transcribe("data:image/jpeg;base64,AAAA", "Transkribiere");
    expect(out).toEqual({ content: "# Titel", model: "vm" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("vm");
    expect(body.stream).toBe(false);
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "Transkribiere" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } },
    ]);
  });
  it("transcribe wirft bei HTTP-Fehler", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(new VisionClient("http://x", "vm").transcribe("d", "p")).rejects.toThrow("500");
  });
  it("transcribe liefert '' bei fehlendem content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [] }) }));
    expect(await new VisionClient("http://x", "vm").transcribe("d", "p")).toEqual({ content: "", model: "vm" });
  });
  it("transcribe nimmt das Modell aus der Response (autoritativ)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ model: "qwen2-vl:7b", choices: [{ message: { content: "x" } }] }) }));
    expect(await new VisionClient("http://x", "").transcribe("d", "p")).toEqual({ content: "x", model: "qwen2-vl:7b" });
  });
});

describe("VisionClient.transcribeStream", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("streamt content-Deltas und liefert {content,reasoning,model}", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamRes([
      'data: {"model":"qwen2-vl","choices":[{"delta":{"content":"# Ti"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"tel"}}]}\n\ndata: [DONE]\n\n',
    ])));
    const got: string[] = [];
    const r = await new VisionClient("http://x", "vm").transcribeStream("d", "p", t => got.push(t), () => {});
    expect(got).toEqual(["# Ti", "tel"]);
    expect(r).toEqual({ content: "# Titel", reasoning: "", model: "qwen2-vl" });
  });
  it("Fallback auf Konstruktor-Modell ohne model im Stream", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamRes([
      'data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n\n',
    ])));
    const r = await new VisionClient("http://x", "vm").transcribeStream("d", "p", () => {}, () => {});
    expect(r.model).toBe("vm");
  });
  it("schickt multimodalen Body mit stream:true", async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamRes(['data: [DONE]\n\n']));
    vi.stubGlobal("fetch", fetchMock);
    await new VisionClient("http://x", "vm").transcribeStream("data:image/png;base64,AA", "Transkribiere", () => {}, () => {});
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.stream).toBe(true);
    expect(body.model).toBe("vm");
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "Transkribiere" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AA" } },
    ]);
  });
  it("wirft bei HTTP-Fehler", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamRes([], false, 500)));
    await expect(new VisionClient("http://x", "vm").transcribeStream("d", "p", () => {}, () => {})).rejects.toThrow("500");
  });
});

describe("VisionClient.ping / listModels", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("ping() ruft /v1/models und liefert ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    expect(await new VisionClient("http://x:8080", "vm").ping()).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("http://x:8080/v1/models");
  });
  it("normalisiert einen Endpoint mit /v1-Suffix (kein doppeltes /v1)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    await new VisionClient("http://h:1234/v1", "m").ping();
    await new VisionClient("http://h:1234/v1/", "m").listModels();
    expect(fetchMock.mock.calls[0][0]).toBe("http://h:1234/v1/models");
    expect(fetchMock.mock.calls[1][0]).toBe("http://h:1234/v1/models");
  });
  it("ping() liefert false bei Netzfehler", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await new VisionClient("http://x", "vm").ping()).toBe(false);
  });
  it("listModels() liefert sortierte ids", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "b" }, { id: "a" }] }) }));
    expect(await new VisionClient("http://x", "vm").listModels()).toEqual(["a", "b"]);
  });
  it("listModels() liefert [] bei Fehler/Offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await new VisionClient("http://x", "vm").listModels()).toEqual([]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("x")));
    expect(await new VisionClient("http://x", "vm").listModels()).toEqual([]);
  });
});
