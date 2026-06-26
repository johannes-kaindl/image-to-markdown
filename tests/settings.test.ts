import { describe, it, expect } from "vitest";
import { defaultSettings, migrateEndpoints, applyEndpointEdit } from "../src/settings";

describe("migrateEndpoints", () => {
  it("alter Einzel-Endpoint → Liste", () => {
    expect(migrateEndpoints({ visionEndpoint: "http://localhost:8080" })).toEqual(["http://localhost:8080"]);
  });
  it("vorhandene Liste bleibt, leere gefiltert", () => {
    expect(migrateEndpoints({ visionEndpoints: ["http://a:1234", "", "  ", "http://b:1234"] })).toEqual(["http://a:1234", "http://b:1234"]);
  });
  it("Liste hat Vorrang vor altem Einzelfeld", () => {
    expect(migrateEndpoints({ visionEndpoint: "http://old", visionEndpoints: ["http://new"] })).toEqual(["http://new"]);
  });
  it("nichts vorhanden → leere Liste", () => {
    expect(migrateEndpoints(null)).toEqual([]);
    expect(migrateEndpoints({})).toEqual([]);
  });
});

describe("applyEndpointEdit", () => {
  it("Add-Feld: nicht-leerer Wert wird EINMAL angehängt", () => {
    expect(applyEndpointEdit([], 0, "http://localhost:1234", true)).toEqual(["http://localhost:1234"]);
    expect(applyEndpointEdit(["http://a:1234"], 1, "http://b:1234", true)).toEqual(["http://a:1234", "http://b:1234"]);
  });
  it("Add-Feld: leerer Wert → Liste unverändert", () => {
    expect(applyEndpointEdit(["http://a:1234"], 1, "   ", true)).toEqual(["http://a:1234"]);
  });
  it("bestehendes Feld: Wert wird ersetzt (nicht angehängt)", () => {
    expect(applyEndpointEdit(["http://a:1234", "http://b:1234"], 0, "http://c:1234", false)).toEqual(["http://c:1234", "http://b:1234"]);
  });
  it("bestehendes Feld geleert → Eintrag entfernt", () => {
    expect(applyEndpointEdit(["http://a:1234", "http://b:1234"], 0, "", false)).toEqual(["http://b:1234"]);
  });
  it("trimmt Eingabe + filtert leere Einträge", () => {
    expect(applyEndpointEdit(["http://a:1234"], 1, "  http://b:1234  ", true)).toEqual(["http://a:1234", "http://b:1234"]);
  });
  it("Regression (localhost-Akkumulation): das Add-Feld bildet EINEN Eintrag, nicht einen je Zwischenstand", () => {
    // Korrektes Verhalten: nur der finale (blur-)Wert wird angewandt — kein Akkumulieren von l, lo, loc, …
    const result = applyEndpointEdit([], 0, "http://localhost:1234/v1", true);
    expect(result).toEqual(["http://localhost:1234/v1"]);
    expect(result.length).toBe(1);
  });
});

describe("defaultSettings", () => {
  it("enthält PDF-Defaults", () => {
    const s = defaultSettings();
    expect(s.pdfMaxPages).toBe(25);
    expect(s.pdfRenderScale).toBe(2.0);
    expect(s.pdfPageSeparator).toBe("comment");
  });
});
