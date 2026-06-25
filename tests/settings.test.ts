import { describe, it, expect } from "vitest";
import { defaultSettings, migrateEndpoints } from "../src/settings";

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

describe("defaultSettings", () => {
  it("enthält PDF-Defaults", () => {
    const s = defaultSettings();
    expect(s.pdfMaxPages).toBe(25);
    expect(s.pdfRenderScale).toBe(2.0);
    expect(s.pdfPageSeparator).toBe("comment");
  });
});
