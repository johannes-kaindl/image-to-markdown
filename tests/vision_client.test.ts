import { describe, it, expect } from "vitest";
import { VisionClient, setHttp, setStreamFetch, parseErrorEnvelope, type HttpResponse } from "../src/vision_client";

// Mock-Transport für nicht-streamende Calls (ping/listModels/transcribe/visionConfidence/testVision).
function mockHttp(impl: (url: string, init?: { method?: string; body?: string }) => HttpResponse): { url: string; body?: string }[] {
  const calls: { url: string; body?: string }[] = [];
  setHttp((url, init) => { calls.push({ url, body: init?.body }); return Promise.resolve(impl(url, init)); });
  return calls;
}
const ok = (obj: unknown): HttpResponse => ({ ok: true, status: 200, text: JSON.stringify(obj) });

// Streaming nutzt weiterhin fetch (requestUrl streamt nicht) → wird hier gestubbt.
function streamRes(chunks: string[], okFlag = true, status = 200): any {
  let i = 0;
  return { ok: okFlag, status, body: { getReader: () => ({
    read: async () => i < chunks.length
      ? { done: false, value: new TextEncoder().encode(chunks[i++]) }
      : { done: true, value: undefined },
  }) } };
}

describe("parseErrorEnvelope", () => {
  it("{error:{message}} → message", () => {
    expect(parseErrorEnvelope('{"error":{"message":"model X is not loaded"}}')).toBe("model X is not loaded");
  });
  it("{error:'…'} → string", () => {
    expect(parseErrorEnvelope('{"error":"bad request"}')).toBe("bad request");
  });
  it("{detail} (ohne choices) → detail", () => {
    expect(parseErrorEnvelope('{"detail":"not found"}')).toBe("not found");
  });
  it("{message} (ohne choices) → message", () => {
    expect(parseErrorEnvelope('{"message":"server busy"}')).toBe("server busy");
  });
  it("valide Completion (auch leer) → null", () => {
    expect(parseErrorEnvelope('{"choices":[{"message":{"content":"x"}}]}')).toBeNull();
    expect(parseErrorEnvelope('{"choices":[]}')).toBeNull();
  });
  it("leer / Nicht-JSON / HTML → null", () => {
    expect(parseErrorEnvelope("")).toBeNull();
    expect(parseErrorEnvelope("   ")).toBeNull();
    expect(parseErrorEnvelope("<html>oops</html>")).toBeNull();
    expect(parseErrorEnvelope("not json")).toBeNull();
  });
});

describe("VisionClient (non-streaming, injizierter http)", () => {
  it("transcribe schickt text+image_url, non-streaming, und parst content", async () => {
    const calls = mockHttp(() => ok({ choices: [{ message: { content: "# Titel" } }] }));
    const out = await new VisionClient("http://x", "vm").transcribe("data:image/jpeg;base64,AAAA", "Transkribiere");
    expect(out).toEqual({ content: "# Titel", model: "vm" });
    const body = JSON.parse(calls[0].body!) as { model: string; stream: boolean; messages: { content: unknown }[] };
    expect(body.model).toBe("vm");
    expect(body.stream).toBe(false);
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "Transkribiere" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } },
    ]);
  });
  it("transcribe wirft bei HTTP-Fehler", async () => {
    mockHttp(() => ({ ok: false, status: 500, text: "" }));
    await expect(new VisionClient("http://x", "vm").transcribe("d", "p")).rejects.toThrow("500");
  });
  it("transcribe liefert '' bei fehlendem content", async () => {
    mockHttp(() => ok({ choices: [] }));
    expect(await new VisionClient("http://x", "vm").transcribe("d", "p")).toEqual({ content: "", model: "vm" });
  });
  it("transcribe nimmt das Modell aus der Response (autoritativ)", async () => {
    mockHttp(() => ok({ model: "qwen2-vl:7b", choices: [{ message: { content: "x" } }] }));
    expect(await new VisionClient("http://x", "").transcribe("d", "p")).toEqual({ content: "x", model: "qwen2-vl:7b" });
  });
  it("wirft die Servermeldung bei HTTP 200 + Error-Body (LM-Studio-Footgun)", async () => {
    mockHttp(() => ok({ error: { message: "model X is not loaded" } }));
    await expect(new VisionClient("http://x", "vm").transcribe("d", "p")).rejects.toThrow("model X is not loaded");
  });
  it("hängt die Servermeldung an den HTTP-Fehler (!ok mit Error-Body)", async () => {
    mockHttp(() => ({ ok: false, status: 400, text: JSON.stringify({ error: { message: "bad image" } }) }));
    await expect(new VisionClient("http://x", "vm").transcribe("d", "p")).rejects.toThrow("bad image");
  });
});

describe("VisionClient.transcribeStream (injizierter Stream-Transport)", () => {
  it("streamt content-Deltas und liefert {content,reasoning,model}", async () => {
    setStreamFetch(() => Promise.resolve(streamRes([
      'data: {"model":"qwen2-vl","choices":[{"delta":{"content":"# Ti"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"tel"}}]}\n\ndata: [DONE]\n\n',
    ])));
    const got: string[] = [];
    const r = await new VisionClient("http://x", "vm").transcribeStream("d", "p", t => got.push(t), () => {});
    expect(got).toEqual(["# Ti", "tel"]);
    expect(r).toEqual({ content: "# Titel", reasoning: "", model: "qwen2-vl" });
  });
  it("Fallback auf Konstruktor-Modell ohne model im Stream", async () => {
    setStreamFetch(() => Promise.resolve(streamRes([
      'data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n\n',
    ])));
    const r = await new VisionClient("http://x", "vm").transcribeStream("d", "p", () => {}, () => {});
    expect(r.model).toBe("vm");
  });
  it("schickt multimodalen Body mit stream:true", async () => {
    const calls: { body?: string }[] = [];
    setStreamFetch((_url, init) => { calls.push({ body: init?.body as string | undefined }); return Promise.resolve(streamRes(['data: [DONE]\n\n'])); });
    await new VisionClient("http://x", "vm").transcribeStream("data:image/png;base64,AA", "Transkribiere", () => {}, () => {});
    const body = JSON.parse(calls[0].body!) as { model: string; stream: boolean; messages: { content: unknown }[] };
    expect(body.stream).toBe(true);
    expect(body.model).toBe("vm");
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "Transkribiere" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AA" } },
    ]);
  });
  it("wirft bei HTTP-Fehler", async () => {
    setStreamFetch(() => Promise.resolve(streamRes([], false, 500)));
    await expect(new VisionClient("http://x", "vm").transcribeStream("d", "p", () => {}, () => {})).rejects.toThrow("500");
  });
  it("wirft die Servermeldung bei 200-Stream mit Error-Body (kein SSE)", async () => {
    setStreamFetch(() => Promise.resolve(streamRes(['{"error":{"message":"boom"}}'])));
    await expect(new VisionClient("http://x", "vm").transcribeStream("d", "p", () => {}, () => {})).rejects.toThrow("boom");
  });
  it("leerer SSE-Stream ([DONE]) wirft NICHT, liefert leeren content", async () => {
    setStreamFetch(() => Promise.resolve(streamRes(['data: [DONE]\n\n'])));
    const r = await new VisionClient("http://x", "vm").transcribeStream("d", "p", () => {}, () => {});
    expect(r.content).toBe("");
  });
});

describe("VisionClient.visionConfidence", () => {
  it("liefert 'confirmed' aus Ollama-Metadaten", async () => {
    mockHttp(() => ok({ capabilities: ["vision"] }));
    expect(await new VisionClient("http://h:1234", "").visionConfidence("m")).toBe("confirmed");
  });
  it("fällt ohne Metadaten auf die Namens-Heuristik zurück", async () => {
    mockHttp(() => ({ ok: false, status: 404, text: "" }));
    expect(await new VisionClient("http://h:1234", "").visionConfidence("qwen2-vl")).toBe("likely");
    expect(await new VisionClient("http://h:1234", "").visionConfidence("qwen3:8b")).toBe("no");
  });
});

describe("VisionClient.testVision", () => {
  it("true wenn die Antwort das Token enthält", async () => {
    mockHttp(() => ok({ choices: [{ message: { content: "VX7" } }] }));
    expect(await new VisionClient("http://h", "m").testVision("data:image/png;base64,AA")).toBe(true);
  });
  it("false wenn das Token fehlt", async () => {
    mockHttp(() => ok({ choices: [{ message: { content: "eine Katze" } }] }));
    expect(await new VisionClient("http://h", "m").testVision("data:image/png;base64,AA")).toBe(false);
  });
  it("wirft bei HTTP-/Netzfehler", async () => {
    mockHttp(() => ({ ok: false, status: 500, text: "" }));
    await expect(new VisionClient("http://h", "m").testVision("d")).rejects.toThrow("500");
  });
});

describe("VisionClient.ping / listModels", () => {
  it("ping() ruft /v1/models und liefert ok", async () => {
    const calls = mockHttp(() => ({ ok: true, status: 200, text: "" }));
    expect(await new VisionClient("http://x:8080", "vm").ping()).toBe(true);
    expect(calls[0].url).toBe("http://x:8080/v1/models");
  });
  it("normalisiert einen Endpoint mit /v1-Suffix (kein doppeltes /v1)", async () => {
    const calls = mockHttp(() => ok({ data: [] }));
    await new VisionClient("http://h:1234/v1", "m").ping();
    await new VisionClient("http://h:1234/v1/", "m").listModels();
    expect(calls[0].url).toBe("http://h:1234/v1/models");
    expect(calls[1].url).toBe("http://h:1234/v1/models");
  });
  it("ping() liefert false bei Netzfehler", async () => {
    setHttp(() => Promise.reject(new Error("offline")));
    expect(await new VisionClient("http://x", "vm").ping()).toBe(false);
  });
  it("listModels() liefert sortierte ids", async () => {
    mockHttp(() => ok({ data: [{ id: "b" }, { id: "a" }] }));
    expect(await new VisionClient("http://x", "vm").listModels()).toEqual(["a", "b"]);
  });
  it("listModels() liefert [] bei Fehler/Offline", async () => {
    mockHttp(() => ({ ok: false, status: 500, text: "" }));
    expect(await new VisionClient("http://x", "vm").listModels()).toEqual([]);
    setHttp(() => Promise.reject(new Error("x")));
    expect(await new VisionClient("http://x", "vm").listModels()).toEqual([]);
  });
});
