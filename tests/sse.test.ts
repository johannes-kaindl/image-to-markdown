import { describe, it, expect } from "vitest";
import { parseSSE, streamSSE } from "../src/sse";

function streamRes(chunks: string[]): any {
  let i = 0;
  return { ok: true, status: 200, body: { getReader: () => ({
    read: async () => i < chunks.length
      ? { done: false, value: new TextEncoder().encode(chunks[i++]) }
      : { done: true, value: undefined },
  }) } };
}

describe("parseSSE", () => {
  it("extrahiert content-Deltas aus data-Zeilen", () => {
    const r = parseSSE('data: {"choices":[{"delta":{"content":"Hal"}}]}\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n');
    expect(r.content).toEqual(["Hal", "lo"]);
    expect(r.reasoning).toEqual([]);
    expect(r.done).toBe(false);
    expect(r.rest).toBe("");
  });
  it("extrahiert reasoning_content-Deltas", () => {
    const r = parseSSE('data: {"choices":[{"delta":{"reasoning_content":"den"}}]}\ndata: {"choices":[{"delta":{"reasoning_content":"ke"}}]}\n');
    expect(r.reasoning).toEqual(["den", "ke"]);
    expect(r.content).toEqual([]);
  });
  it("trennt content und reasoning im selben Buffer", () => {
    const r = parseSSE('data: {"choices":[{"delta":{"reasoning_content":"r"}}]}\ndata: {"choices":[{"delta":{"content":"c"}}]}\n');
    expect(r.reasoning).toEqual(["r"]);
    expect(r.content).toEqual(["c"]);
  });
  it("setzt done bei [DONE]", () => {
    expect(parseSSE("data: [DONE]\n").done).toBe(true);
  });
  it("verarbeitet \\r\\n-Zeilenenden", () => {
    const r = parseSSE('data: {"choices":[{"delta":{"content":"a"}}]}\r\ndata: {"choices":[{"delta":{"content":"b"}}]}\r\n');
    expect(r.content).toEqual(["a", "b"]);
  });
  it("unvollständige letzte Zeile bleibt in rest", () => {
    const r = parseSSE('data: {"choices":[{"delta":{"content":"x"}}]}\ndata: {"cho');
    expect(r.content).toEqual(["x"]);
    expect(r.rest).toBe('data: {"cho');
  });
  it("liest model aus dem Chunk (erstes Vorkommen)", () => {
    const r = parseSSE('data: {"model":"qwen2-vl","choices":[{"delta":{"content":"a"}}]}\ndata: {"model":"andere","choices":[{"delta":{"content":"b"}}]}\n');
    expect(r.model).toBe("qwen2-vl");
  });
  it("model ist undefined ohne model-Feld", () => {
    expect(parseSSE('data: {"choices":[{"delta":{"content":"a"}}]}\n').model).toBeUndefined();
  });
});

describe("streamSSE", () => {
  it("akkumuliert content + ruft onContent pro Delta", async () => {
    const got: string[] = [];
    const r = await streamSSE(streamRes([
      'data: {"choices":[{"delta":{"content":"Hal"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n',
    ]), t => got.push(t), () => {});
    expect(got).toEqual(["Hal", "lo"]);
    expect(r.content).toBe("Hallo");
    expect(r.reasoning).toBe("");
  });
  it("routet reasoning_content an onReasoning", async () => {
    const reasoning: string[] = [];
    const r = await streamSSE(streamRes([
      'data: {"choices":[{"delta":{"reasoning_content":"den"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"A"}}]}\n\ndata: [DONE]\n\n',
    ]), () => {}, t => reasoning.push(t));
    expect(reasoning.join("")).toBe("den");
    expect(r).toMatchObject({ content: "A", reasoning: "den" });
  });
  it("zieht inline <think> in den reasoning-Kanal", async () => {
    const r = await streamSSE(streamRes([
      'data: {"choices":[{"delta":{"content":"<think>weil</think>"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Antwort"}}]}\n\ndata: [DONE]\n\n',
    ]), () => {}, () => {});
    expect(r).toMatchObject({ content: "Antwort", reasoning: "weil" });
  });
  it("verliert keinen Tag-Rest am Stream-Ende (flush)", async () => {
    const r = await streamSSE(streamRes([
      'data: {"choices":[{"delta":{"content":"Ende <"}}]}\n\ndata: [DONE]\n\n',
    ]), () => {}, () => {});
    expect(r.content).toBe("Ende <");
  });
  it("liefert model aus dem ersten Chunk", async () => {
    const r = await streamSSE(streamRes([
      'data: {"model":"qwen2-vl","choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n\n',
    ]), () => {}, () => {});
    expect(r.model).toBe("qwen2-vl");
  });
  it("model ist '' ohne model-Feld", async () => {
    const r = await streamSSE(streamRes([
      'data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n\n',
    ]), () => {}, () => {});
    expect(r.model).toBe("");
  });
});
