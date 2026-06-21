import { describe, it, expect, vi, afterEach } from "vitest";
import {
  guessVision, parseOllamaShow, parseLmStudioV1, parseLmStudioV0,
  fetchVisionCapability, resolveVision, visionDisplay, isVisionConfirmed,
  VISION_TEST_TOKEN,
} from "../src/capabilities";

describe("guessVision (Namens-Heuristik)", () => {
  it("erkennt klare Vision-Modelle als 'likely'", () => {
    for (const m of ["llava:13b", "qwen2-vl-7b", "pixtral-12b", "moondream", "glm-4v", "gemma3:4b"]) {
      expect(guessVision(m)).toBe("likely");
    }
  });
  it("erkennt mistral-small 3.1/3.2 als 'likely', ältere als 'no'", () => {
    expect(guessVision("mistral-small-3.1-24b")).toBe("likely");
    expect(guessVision("mistral-small-2409")).toBe("no");
  });
  it("gemma3:1b/270m sind text-only → 'no'", () => {
    expect(guessVision("gemma3:1b")).toBe("no");
    expect(guessVision("gemma3:270m")).toBe("no");
  });
  it("Text-Modelle → 'no'", () => {
    for (const m of ["qwen3:8b", "llama3.1:8b", "deepseek-r1"]) expect(guessVision(m)).toBe("no");
  });
});

describe("L1-Metadaten-Parser (vision-only)", () => {
  it("parseOllamaShow: 'vision' in capabilities[] → confirmed, sonst no, fehlend → null", () => {
    expect(parseOllamaShow({ capabilities: ["completion", "vision"] })).toBe("confirmed");
    expect(parseOllamaShow({ capabilities: ["completion"] })).toBe("no");
    expect(parseOllamaShow({})).toBeNull();
  });
  it("parseLmStudioV1: caps.vision===true → confirmed", () => {
    const j = { data: [{ id: "m", capabilities: { vision: true } }] };
    expect(parseLmStudioV1(j, "m")).toBe("confirmed");
    expect(parseLmStudioV1({ data: [{ id: "m", capabilities: {} }] }, "m")).toBe("no");
    expect(parseLmStudioV1({ data: [] }, "m")).toBeNull();
  });
  it("parseLmStudioV0: type==='vlm' → confirmed", () => {
    expect(parseLmStudioV0({ data: [{ id: "m", type: "vlm" }] }, "m")).toBe("confirmed");
    expect(parseLmStudioV0({ data: [{ id: "m", type: "llm" }] }, "m")).toBe("no");
    expect(parseLmStudioV0({ data: [] }, "m")).toBeNull();
  });
});

describe("fetchVisionCapability (Probe-Reihenfolge)", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("nimmt Ollama /api/show wenn vorhanden", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ capabilities: ["vision"] }) });
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchVisionCapability("http://h:1234", "m")).toBe("confirmed");
    expect(fetchMock.mock.calls[0][0]).toBe("http://h:1234/api/show");
  });
  it("fällt auf LM Studio /api/v1/models zurück", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: "m", capabilities: { vision: true } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchVisionCapability("http://h:1234", "m")).toBe("confirmed");
    expect(fetchMock.mock.calls[1][0]).toBe("http://h:1234/api/v1/models");
  });
  it("liefert null wenn keine Metadaten-Quelle antwortet", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await fetchVisionCapability("http://h:1234", "m")).toBeNull();
  });
  it("überlebt Netzfehler (alle throw) → null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await fetchVisionCapability("http://h:1234", "m")).toBeNull();
  });
});

describe("resolveVision (Merge meta + Name)", () => {
  it("Metadaten 'confirmed' schlägt Namens-Heuristik", () => {
    expect(resolveVision("confirmed", "irgendwas")).toBe("confirmed");
  });
  it("ohne Metadaten greift die Namens-Heuristik", () => {
    expect(resolveVision(null, "qwen2-vl")).toBe("likely");
    expect(resolveVision(null, "qwen3:8b")).toBe("no");
  });
  it("nimmt die stärkere Confidence", () => {
    expect(resolveVision("no", "llava")).toBe("likely");
  });
});

describe("visionDisplay", () => {
  it("liefert Icon/Text/State je Confidence", () => {
    expect(visionDisplay("confirmed")).toEqual({ icon: "eye", text: "Vision", state: "ok" });
    expect(visionDisplay("likely")).toEqual({ icon: "help-circle", text: "Vision unbestätigt", state: "likely" });
    expect(visionDisplay("no")).toEqual({ icon: "alert-triangle", text: "Kein Vision", state: "error" });
  });
});

describe("isVisionConfirmed", () => {
  it("true wenn die Antwort das Token enthält (case-insensitive, robust gegen Zeichen)", () => {
    expect(isVisionConfirmed(`Der Text lautet ${VISION_TEST_TOKEN}.`)).toBe(true);
    expect(isVisionConfirmed(VISION_TEST_TOKEN.toLowerCase())).toBe(true);
    expect(isVisionConfirmed("V X 7")).toBe(true);
  });
  it("false bei leerer/falscher Antwort", () => {
    expect(isVisionConfirmed("")).toBe(false);
    expect(isVisionConfirmed("Ich sehe eine Katze.")).toBe(false);
  });
});
