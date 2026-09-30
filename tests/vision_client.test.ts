import { describe, it, expect } from "vitest";
import { VisionClient, setHttp, setChatTransports, parseErrorEnvelope, type HttpResponse } from "../src/vision_client";
import type { SseTransport } from "../src/vendor/kit-obsidian/chat-client";
import { resolveActiveEndpointConfig } from "../src/vendor/kit/endpoint_config";

// Mock-Transport für nicht-streamende Calls (ping/listModels/transcribe/visionConfidence/testVision).
function mockHttp(impl: (url: string, init?: { method?: string; body?: string }) => HttpResponse): { url: string; body?: string; headers?: Record<string, string> }[] {
  const calls: { url: string; body?: string; headers?: Record<string, string> }[] = [];
  setHttp((url, init) => { calls.push({ url, body: init?.body, headers: init?.headers }); return Promise.resolve(impl(url, init)); });
  return calls;
}
const ok = (obj: unknown): HttpResponse => ({ ok: true, status: 200, text: JSON.stringify(obj) });

// Chat-Weg (Streaming UND transcribe ohne Stream) läuft über den Kit-Chat-Client; hier ein Fake-Transport
// statt XHR: er ruft `onChunk` mit den Rohtext-Stücken und löst mit dem HTTP-Status auf.
interface ChatCall { url: string; body: string; headers: Record<string, string> }
function fakeChat(chunks: string[], status = 200, fallback?: SseTransport): ChatCall[] {
  const calls: ChatCall[] = [];
  setChatTransports({
    transport: {
      postStream: async (url, body, headers, onChunk) => {
        calls.push({ url, body: JSON.stringify(body), headers });
        for (const c of chunks) onChunk(c);
        return status;
      },
    },
    ...(fallback ? { fallbackTransport: fallback } : {}),
  });
  return calls;
}
/** Eine volle Completion (ohne Stream) als einziger Körper. */
const fakeCompletion = (obj: unknown, status = 200): ChatCall[] => fakeChat([JSON.stringify(obj)], status);

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
  it("ignoriert top-level message/detail bei vorhandenen choices (kein Transkript-Verlust)", () => {
    expect(parseErrorEnvelope('{"choices":[{"message":{"content":"x"}}],"message":"stray"}')).toBeNull();
    expect(parseErrorEnvelope('{"choices":[],"detail":"stray"}')).toBeNull();
  });
  it("{error} gewinnt auch mit vorhandenen choices", () => {
    expect(parseErrorEnvelope('{"choices":[],"error":{"message":"real error"}}')).toBe("real error");
  });
});

describe("VisionClient.transcribe (ohne Stream, Kit-Chat-Client mit Fake-Transport)", () => {
  it("transcribe meldet finish_reason 'length' — der Fall mit leerem content", async () => {
    fakeCompletion({ model: "m", choices: [{ message: { content: "" }, finish_reason: "length" }] });
    const r = await new VisionClient("http://x", "vm").transcribe("d", "p");
    expect(r.content).toBe("");
    expect(r.finishReason).toBe("length");
  });

  it("transcribe schickt text+image_url, non-streaming, und parst content", async () => {
    const calls = fakeCompletion({ choices: [{ message: { content: "# Titel" } }] });
    const out = await new VisionClient("http://x", "vm").transcribe("data:image/jpeg;base64,AAAA", "Transkribiere");
    expect(out).toEqual({ content: "# Titel", model: "vm" });
    expect(calls[0].url).toBe("http://x/v1/chat/completions");
    const body = JSON.parse(calls[0].body) as { model: string; stream: boolean; messages: { content: unknown }[] };
    expect(body.model).toBe("vm");
    expect(body.stream).toBe(false);
    // Die Nachrichtenform mit Bildteil geht UNVERÄNDERT durch den Kit-Client (ChatWireMessage.content: unknown).
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "Transkribiere" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } },
    ]);
  });
  it("transcribe wirft bei HTTP-Fehler ohne Körper — mit dem Status", async () => {
    fakeChat([], 500);
    await expect(new VisionClient("http://x", "vm").transcribe("d", "p")).rejects.toThrow("HTTP 500");
  });
  it("transcribe liefert '' bei einer Completion ohne content", async () => {
    fakeCompletion({ choices: [{ message: {} }] });
    expect(await new VisionClient("http://x", "vm").transcribe("d", "p")).toEqual({ content: "", model: "vm" });
  });
  it("transcribe nimmt das Modell aus der Response (autoritativ)", async () => {
    fakeCompletion({ model: "qwen2-vl:7b", choices: [{ message: { content: "x" } }] });
    expect(await new VisionClient("http://x", "").transcribe("d", "p")).toEqual({ content: "x", model: "qwen2-vl:7b" });
  });
  it("wirft die Servermeldung bei HTTP 200 + Error-Body (LM-Studio-Footgun)", async () => {
    fakeCompletion({ error: { message: "model X is not loaded" } });
    await expect(new VisionClient("http://x", "vm").transcribe("d", "p")).rejects.toThrow("model X is not loaded");
  });
  it("hängt die Servermeldung an den HTTP-Fehler (!ok mit Error-Body)", async () => {
    fakeCompletion({ error: { message: "bad image" } }, 400);
    await expect(new VisionClient("http://x", "vm").transcribe("d", "p")).rejects.toThrow(/HTTP 400.*bad image/);
  });
});

describe("VisionClient.transcribeStream (injizierter Stream-Transport)", () => {
  it("meldet finishReason 'length' an den Aufrufer (Token-Limit erreicht)", async () => {
    fakeChat([
      'data: {"model":"m","choices":[{"delta":{"content":"Kapitel"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n',
    ]);
    const r = await new VisionClient("http://x", "vm").transcribeStream("d", "p", () => {}, () => {});
    expect(r.content).toBe("Kapitel");
    expect(r.finishReason).toBe("length");
  });
  it("meldet finishReason 'stop' bei regulaerem Ende", async () => {
    fakeChat([
      'data: {"model":"m","choices":[{"delta":{"content":"fertig"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    ]);
    const r = await new VisionClient("http://x", "vm").transcribeStream("d", "p", () => {}, () => {});
    expect(r.finishReason).toBe("stop");
  });

  it("streamt content-Deltas und liefert {content,reasoning,model}", async () => {
    fakeChat([
      'data: {"model":"qwen2-vl","choices":[{"delta":{"content":"# Ti"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"tel"}}]}\n\ndata: [DONE]\n\n',
    ]);
    const got: string[] = [];
    const r = await new VisionClient("http://x", "vm").transcribeStream("d", "p", t => got.push(t), () => {});
    expect(got).toEqual(["# Ti", "tel"]);
    expect(r).toEqual({ content: "# Titel", reasoning: "", model: "qwen2-vl" });
  });
  it("Fallback auf Konstruktor-Modell ohne model im Stream", async () => {
    fakeChat([
      'data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n\n',
    ]);
    const r = await new VisionClient("http://x", "vm").transcribeStream("d", "p", () => {}, () => {});
    expect(r.model).toBe("vm");
  });
  it("schickt multimodalen Body mit stream:true", async () => {
    const calls = fakeChat(['data: [DONE]\n\n']);
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
    fakeChat([], 500);
    await expect(new VisionClient("http://x", "vm").transcribeStream("d", "p", () => {}, () => {})).rejects.toThrow("500");
  });
  it("wirft die Servermeldung bei 200-Stream mit Error-Body (kein SSE)", async () => {
    fakeChat(['{"error":{"message":"boom"}}']);
    await expect(new VisionClient("http://x", "vm").transcribeStream("d", "p", () => {}, () => {})).rejects.toThrow("boom");
  });
  it("leerer SSE-Stream ([DONE]) wirft NICHT, liefert leeren content", async () => {
    fakeChat(['data: [DONE]\n\n']);
    const r = await new VisionClient("http://x", "vm").transcribeStream("d", "p", () => {}, () => {});
    expect(r.content).toBe("");
  });
});

describe("VisionClient.transcribeTextStream (text-only)", () => {
  it("meldet finishReason 'length' (text-only-Pfad)", async () => {
    fakeChat([
      'data: {"model":"m","choices":[{"delta":{"content":"# A"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n',
    ]);
    const r = await new VisionClient("http://x", "vm").transcribeTextStream("txt", "p", () => {}, () => {});
    expect(r.finishReason).toBe("length");
  });

  it("streamt content, Body ist text-only (String-content, kein image_url)", async () => {
    const calls = fakeChat(['data: {"model":"m","choices":[{"delta":{"content":"# A"}}]}\n\ndata: [DONE]\n\n']);
    const got: string[] = [];
    const r = await new VisionClient("http://x", "vm").transcribeTextStream("ROHTEXT", "Formatiere", t => got.push(t), () => {});
    expect(got).toEqual(["# A"]);
    expect(r).toEqual({ content: "# A", reasoning: "", model: "m" });
    const body = JSON.parse(calls[0].body!) as { messages: { content: unknown }[]; stream: boolean };
    expect(body.stream).toBe(true);
    expect(body.messages[0].content).toBe("Formatiere\n\nROHTEXT");
  });
  it("wirft Servermeldung bei 200-Error-Body", async () => {
    fakeChat(['{"error":{"message":"boom"}}']);
    await expect(new VisionClient("http://x", "vm").transcribeTextStream("t", "p", () => {}, () => {})).rejects.toThrow("boom");
  });
  it("wirft bei HTTP-Fehler", async () => {
    fakeChat([], 500);
    await expect(new VisionClient("http://x", "vm").transcribeTextStream("t", "p", () => {}, () => {})).rejects.toThrow("500");
  });
  it("Fallback auf Konstruktor-Modell ohne model im Stream", async () => {
    fakeChat(['data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n\n']);
    const r = await new VisionClient("http://x", "vm").transcribeTextStream("t", "p", () => {}, () => {});
    expect(r.model).toBe("vm");
  });
  it("leerer [DONE]-Stream wirft NICHT, liefert leeren content", async () => {
    fakeChat(['data: [DONE]\n\n']);
    const r = await new VisionClient("http://x", "vm").transcribeTextStream("t", "p", () => {}, () => {});
    expect(r.content).toBe("");
  });
});

describe("VisionClient.refineStream (text-only Multi-Turn)", () => {
  it("schickt das übergebene Messages-Array unverändert, stream:true, kein image_url", async () => {
    const calls = fakeChat(['data: {"model":"m","choices":[{"delta":{"content":"# A"}}]}\n\ndata: [DONE]\n\n']);
    const msgs = [
      { role: "system", content: "SYS" },
      { role: "user", content: "f1\n\n---\n\nBASIS" },
    ];
    const got: string[] = [];
    const r = await new VisionClient("http://x", "vm").refineStream(msgs, t => got.push(t), () => {});
    expect(got).toEqual(["# A"]);
    expect(r).toEqual({ content: "# A", reasoning: "", model: "m" });
    const body = JSON.parse(calls[0].body!) as { messages: unknown; stream: boolean };
    expect(body.stream).toBe(true);
    expect(body.messages).toEqual(msgs);
  });
  it("wirft Servermeldung bei 200-Error-Body", async () => {
    fakeChat(['{"error":{"message":"boom"}}']);
    await expect(new VisionClient("http://x", "vm").refineStream([{ role: "user", content: "x" }], () => {}, () => {})).rejects.toThrow("boom");
  });
  it("wirft bei HTTP-Fehler", async () => {
    fakeChat([], 500);
    await expect(new VisionClient("http://x", "vm").refineStream([{ role: "user", content: "x" }], () => {}, () => {})).rejects.toThrow("500");
  });
  it("Fallback auf Konstruktor-Modell ohne model im Stream", async () => {
    fakeChat(['data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n\n']);
    const r = await new VisionClient("http://x", "vm").refineStream([{ role: "user", content: "x" }], () => {}, () => {});
    expect(r.model).toBe("vm");
  });
  it("params landen im Body", async () => {
    const calls = fakeChat(['data: [DONE]\n\n']);
    await new VisionClient("http://x", "vm").refineStream([{ role: "user", content: "x" }], () => {}, () => {}, undefined, { temperature: 0.2, reasoning_effort: "none" });
    expect(JSON.parse(calls[0].body!)).toMatchObject({ temperature: 0.2, reasoning_effort: "none" });
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
    fakeCompletion({ choices: [{ message: { content: "VX7" } }] });
    expect(await new VisionClient("http://h", "m").testVision("data:image/png;base64,AA")).toBe(true);
  });
  it("false wenn das Token fehlt", async () => {
    fakeCompletion({ choices: [{ message: { content: "eine Katze" } }] });
    expect(await new VisionClient("http://h", "m").testVision("data:image/png;base64,AA")).toBe(false);
  });
  it("wirft bei HTTP-/Netzfehler", async () => {
    fakeChat([], 500);
    await expect(new VisionClient("http://h", "m").testVision("d")).rejects.toThrow("500");
  });
});

describe("VisionClient.ping / listModels", () => {
  it("ping() ruft /v1/models und liefert true bei einer Modell-Liste", async () => {
    // Der Body ist seit 0.22.0 Teil der Zusage: ein leerer 200er (den dieser Test bis dahin
    // schickte) gilt nicht mehr als erreichbar — siehe den ping-Block weiter unten.
    const calls = mockHttp(() => ok({ object: "list", data: [{ id: "vm" }] }));
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

describe("VisionClient — Sampling-Params im Body", () => {
  const PARAMS = { temperature: 0.2, top_p: 0.95, reasoning_effort: "none" };

  it("transcribe: params landen im Body", async () => {
    const calls = fakeCompletion({ choices: [{ message: { content: "x" } }] });
    await new VisionClient("http://x", "vm").transcribe("d", "p", PARAMS);
    expect(JSON.parse(calls[0].body)).toMatchObject(PARAMS);
  });
  it("transcribe: ohne params geht nichts ausser Modell und Nachrichten raus", async () => {
    const calls = fakeCompletion({ choices: [{ message: { content: "x" } }] });
    await new VisionClient("http://x", "vm").transcribe("d", "p");
    const body = JSON.parse(calls[0].body) as Record<string, unknown>;
    for (const k of ["temperature", "top_p", "reasoning_effort", "chat_template_kwargs", "reasoning_budget", "max_tokens"]) expect(k in body).toBe(false);
  });
  it("transcribeStream: params landen im Body", async () => {
    const calls = fakeChat(['data: [DONE]\n\n']);
    await new VisionClient("http://x", "vm").transcribeStream("d", "p", () => {}, () => {}, undefined, PARAMS);
    expect(JSON.parse(calls[0].body!)).toMatchObject(PARAMS);
  });
  it("transcribeStream: ohne params keine Sampling-Felder", async () => {
    const calls = fakeChat(['data: [DONE]\n\n']);
    await new VisionClient("http://x", "vm").transcribeStream("d", "p", () => {}, () => {});
    expect("reasoning_effort" in JSON.parse(calls[0].body!)).toBe(false);
  });
  it("transcribeTextStream: params landen im Body", async () => {
    const calls = fakeChat(['data: [DONE]\n\n']);
    await new VisionClient("http://x", "vm").transcribeTextStream("t", "p", () => {}, () => {}, undefined, PARAMS);
    expect(JSON.parse(calls[0].body!)).toMatchObject(PARAMS);
  });
  it("transcribeTextStream: ohne params keine Sampling-Felder", async () => {
    const calls = fakeChat(['data: [DONE]\n\n']);
    await new VisionClient("http://x", "vm").transcribeTextStream("t", "p", () => {}, () => {});
    expect("reasoning_effort" in JSON.parse(calls[0].body!)).toBe(false);
  });
});

describe("VisionClient — Antwort-Listener (checkResponse-Anschluss)", () => {
  it("erfolgreiche Antwort: Status 200, Inhalt, Reasoning, Modell des Servers", async () => {
    fakeChat(['data: {"model":"srv","choices":[{"delta":{"content":"Hallo","reasoning_content":"denk"}}]}\n\ndata: [DONE]\n\n']);
    const seen: any[] = [];
    await new VisionClient("http://x", "vm", undefined, (f) => seen.push(f)).transcribeStream("d", "p", () => {}, () => {});
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ status: 200, content: "Hallo", reasoning: "denk", responseModel: "srv" });
  });
  it("HTTP-Fehler: Status und Fehlertext gehen an den Listener, der Aufruf wirft weiter", async () => {
    fakeChat([], 400);
    const seen: any[] = [];
    await expect(new VisionClient("http://x", "vm", undefined, (f) => seen.push(f)).transcribeStream("d", "p", () => {}, () => {})).rejects.toThrow("400");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ status: 400, content: "" });
  });
  it("kein Listener: nichts geht kaputt", async () => {
    fakeChat(['data: [DONE]\n\n']);
    await expect(new VisionClient("http://x", "vm").transcribeStream("d", "p", () => {}, () => {})).resolves.toBeDefined();
  });
});
