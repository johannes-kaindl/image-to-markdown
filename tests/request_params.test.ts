import { describe, it, expect } from "vitest";
import { REQUEST_MIGRATIONS, MODE } from "../src/request_params";
import { loadRequestSettings as kitLoad } from "../src/vendor/kit/sampling-profiles";

const loadRequestSettings = (raw: unknown) => kitLoad(raw, REQUEST_MIGRATIONS);

// Den Request selbst baut seit dem Verbindungs-Tausch die Kit-Verbindung (Modus MODE, kein maxTokens);
// die goldenen Requests der Profil-Tabelle liegen im Kit, der GESENDETE Body ist im GUI-Smoke (N5) belegt.
it("der Modus ist transform", () => { expect(MODE).toBe("transform"); });

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
