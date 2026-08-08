import { describe, it, expect } from "vitest";
import {
  fetchVisionCapability, resolveVision, visionDisplay, isVisionConfirmed,
  VISION_TEST_TOKEN,
} from "../src/capabilities";

// Die Namens-Heuristik und die drei Metadaten-Parser leben seit Kit 0.21.0 im Kit und werden
// dort getestet (obsidian-kit/tests/capabilities.test.ts). Hier bleibt, was i2m eigen ist:
// die Vision-Projektion, der HttpFetch→CapabilityFetch-Adapter, visionDisplay, der aktive Test.

describe("fetchVisionCapability (Projektion + HttpFetch-Adapter)", () => {
  const ok = (obj: unknown) => ({ ok: true, status: 200, text: JSON.stringify(obj) });
  const off = { ok: false, status: 404, text: "" };

  it("nimmt Ollama /api/show wenn vorhanden und projiziert .vision", async () => {
    const calls: string[] = [];
    const http = (url: string) => { calls.push(url); return Promise.resolve(ok({ capabilities: ["vision"] })); };
    expect(await fetchVisionCapability(http, "http://h:1234", "m")).toBe("confirmed");
    expect(calls[0]).toBe("http://h:1234/api/show");
  });

  it("reicht Methode und Body der Ollama-Probe unverändert durch", async () => {
    let seen: { method?: string; body?: string } = {};
    const http = (_url: string, init?: { method?: string; body?: string }) => {
      seen = { method: init?.method, body: init?.body };
      return Promise.resolve(ok({ capabilities: ["vision"] }));
    };
    await fetchVisionCapability(http, "http://h:1234", "m");
    expect(seen.method).toBe("POST");
    expect(JSON.parse(seen.body ?? "{}")).toEqual({ model: "m" });
  });

  it("fällt auf LM Studio /api/v1/models zurück", async () => {
    const calls: string[] = [];
    const http = (url: string) => {
      calls.push(url);
      return Promise.resolve(calls.length === 1 ? off : ok({ data: [{ id: "m", capabilities: { vision: true } }] }));
    };
    expect(await fetchVisionCapability(http, "http://h:1234", "m")).toBe("confirmed");
    expect(calls[1]).toBe("http://h:1234/api/v1/models");
  });

  it("erkennt LM Studio v0 (type vlm)", async () => {
    const http = (url: string) =>
      Promise.resolve(url.endsWith("/api/v0/models") ? ok({ data: [{ id: "m", type: "vlm" }] }) : off);
    expect(await fetchVisionCapability(http, "http://h:1234", "m")).toBe("confirmed");
  });

  it("ok:false zählt als Fehlschlag → weiter zur nächsten Quelle, am Ende null", async () => {
    expect(await fetchVisionCapability(() => Promise.resolve(off), "http://h:1234", "m")).toBeNull();
  });

  it("HTTP 200 mit nicht-JSON-Text zählt als Fehlschlag → null", async () => {
    const garbage = { ok: true, status: 200, text: "<html>not json</html>" };
    expect(await fetchVisionCapability(() => Promise.resolve(garbage), "http://h:1234", "m")).toBeNull();
  });

  it("überlebt Netzfehler (alle throw) → null", async () => {
    expect(await fetchVisionCapability(() => Promise.reject(new Error("offline")), "http://h:1234", "m")).toBeNull();
  });

  it("liefert 'no', wenn der Server antwortet, das Modell aber keine Vision meldet", async () => {
    const http = () => Promise.resolve(ok({ capabilities: ["completion"] }));
    expect(await fetchVisionCapability(http, "http://h:1234", "m")).toBe("no");
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
  it("erkennt Gemma in beiden Schreibweisen und Gemma 4", () => {
    expect(resolveVision(null, "google/gemma-3-4b-it")).toBe("likely");
    expect(resolveVision(null, "google/gemma-3-1b-it")).toBe("no");
    expect(resolveVision(null, "google/gemma-4-31b-qat")).toBe("likely");
  });
  it("behält die version-gegateten Ausnahmen der Kit-Heuristik", () => {
    expect(resolveVision(null, "gemma3:4b")).toBe("likely");
    expect(resolveVision(null, "gemma3:1b")).toBe("no");
    expect(resolveVision(null, "mistral-small-3.1-24b")).toBe("likely");
    expect(resolveVision(null, "mistral-small-2409")).toBe("no");
  });
});

describe("visionDisplay", () => {
  it("liefert Icon/Text/State je Confidence", () => {
    expect(visionDisplay("confirmed")).toEqual({ icon: "eye", text: "Vision", state: "ok" });
    expect(visionDisplay("likely")).toEqual({ icon: "help-circle", text: "Vision (unconfirmed)", state: "likely" });
    expect(visionDisplay("no")).toEqual({ icon: "alert-triangle", text: "No vision", state: "error" });
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
