import { describe, it, expect } from "vitest";
import { buildVisionParams, loadRequestSettings, MODE } from "../src/request_params";
import type { BackendId, FamilyId } from "../src/vendor/kit/sampling-profiles";

// Goldene Requests (Sampling-Plan Rezept 8): erzeugt ueber die Request-Bau-Funktion DES PLUGINS
// (buildVisionParams, fester Modus "transform") — nicht ueber resolveRequestParams direkt, sonst
// pruefte der Test das Kit statt das Plugin. i2m sendet kein max_tokens (kein Budget), die
// Tabelle enthaelt es deshalb nie; die Denkstufe ist die Modus-Vorgabe "off".
describe("goldene Requests — transform, Denkstufe aus, ohne Ueberschreibung", () => {
  const families: (FamilyId | null)[] = ["qwen3.8", "qwen3.6", "gemma4", "gpt-oss", null];
  const backends: BackendId[] = ["lmstudio", "openwebui", "unknown"];

  const EXPECTED: Record<string, Record<string, Record<string, number | string>>> = {
    "qwen3.8": {
      lmstudio: { temperature: 0.2, top_p: 0.8, top_k: 20, min_p: 0, reasoning_effort: "none" },
      openwebui: { temperature: 0.2, top_p: 0.8, top_k: 20, min_p: 0, presence_penalty: 1.5, reasoning_effort: "none" },
      unknown: { temperature: 0.2, top_p: 0.8, reasoning_effort: "none" },
    },
    "qwen3.6": {
      lmstudio: { temperature: 0.2, top_p: 0.95, top_k: 20, reasoning_effort: "none" },
      openwebui: { temperature: 0.2, top_p: 0.95, top_k: 20, reasoning_effort: "none" },
      unknown: { temperature: 0.2, top_p: 0.95, reasoning_effort: "none" },
    },
    "gemma4": {
      lmstudio: { temperature: 0.2, top_p: 0.95, top_k: 64, reasoning_effort: "none" },
      openwebui: { temperature: 0.2, top_p: 0.95, top_k: 64, reasoning_effort: "none" },
      unknown: { temperature: 0.2, top_p: 0.95, reasoning_effort: "none" },
    },
    "gpt-oss": {
      lmstudio: { temperature: 0.2, top_p: 1.0, reasoning_effort: "minimal" },
      openwebui: { temperature: 0.2, top_p: 1.0, reasoning_effort: "minimal" },
      unknown: { temperature: 0.2, top_p: 1.0, reasoning_effort: "minimal" },
    },
    "null": {
      lmstudio: { temperature: 0.2, reasoning_effort: "none" },
      openwebui: { temperature: 0.2, reasoning_effort: "none" },
      unknown: { temperature: 0.2 },
    },
  };

  for (const family of families) {
    for (const backend of backends) {
      it(`${family ?? "unbekannt"} × ${backend}`, () => {
        const { params } = buildVisionParams({ family, backend, thinking: "off" });
        expect(params).toEqual(EXPECTED[family ?? "null"][backend]);
      });
    }
  }

  it("sendet nie max_tokens, chat_template_kwargs oder reasoning_budget", () => {
    for (const family of families) for (const backend of backends) {
      const { params } = buildVisionParams({ family, backend, thinking: "off" });
      expect(params).not.toHaveProperty("max_tokens");
      expect(params).not.toHaveProperty("chat_template_kwargs");
      expect(params).not.toHaveProperty("reasoning_budget");
    }
  });

  it("der Modus ist transform", () => { expect(MODE).toBe("transform"); });

  it("eine Ueberschreibung der Temperatur gewinnt", () => {
    const { params } = buildVisionParams({ family: "gemma4", backend: "lmstudio", thinking: "off", overrides: { temperature: 0 } });
    expect(params.temperature).toBe(0);
  });

  it("Denkstufe low sendet auf gemma4 eine andere reasoning_effort als aus", () => {
    const on = buildVisionParams({ family: "gemma4", backend: "lmstudio", thinking: "low" }).params;
    const off = buildVisionParams({ family: "gemma4", backend: "lmstudio", thinking: "off" }).params;
    expect(on.reasoning_effort).not.toBe(off.reasoning_effort);
  });
});

describe("loadRequestSettings — Legacy suppressThinking → request.thinking.transform", () => {
  it("suppressThinking: true → Stufe aus", () => {
    const { request } = loadRequestSettings({ suppressThinking: true });
    expect(request.thinking.transform).toBe("off");
  });

  it("suppressThinking: false (alter Default, Denken an) → die Ein-Stufe des Modus", () => {
    const { request } = loadRequestSettings({ suppressThinking: false });
    expect(request.thinking.transform).toBe("low");
  });

  it("eine schon gespeicherte Stufe gewinnt gegen das Altfeld", () => {
    const { request } = loadRequestSettings({ suppressThinking: true, request: { thinking: { transform: "high" } } });
    expect(request.thinking.transform).toBe("high");
  });

  it("ohne Altfeld und ohne request: Profilwert, nichts gesetzt", () => {
    const { request, dropped } = loadRequestSettings({});
    expect(request.thinking.transform).toBeUndefined();
    expect(dropped).toEqual([]);
  });

  it("null/Nicht-Objekt wie leer", () => {
    expect(loadRequestSettings(null).request.thinking).toEqual({});
    expect(loadRequestSettings("x").request.thinking).toEqual({});
  });

  it("ungueltige gespeicherte Werte werden gemeldet, nicht still behalten", () => {
    const { dropped } = loadRequestSettings({ request: { overrides: { transform: { unknown: { temperature: 99 } } } } });
    expect(dropped.length).toBeGreaterThan(0);
  });
});
