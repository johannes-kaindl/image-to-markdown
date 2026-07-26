import { describe, it, expect } from "vitest";
import { diffMappings } from "../src/fm_migration";
import { DEFAULT_FM_MAP } from "../src/frontmatter_map";

describe("diffMappings", () => {
  it("leer wenn identisch", () => {
    expect(diffMappings(DEFAULT_FM_MAP, { ...DEFAULT_FM_MAP })).toEqual([]);
  });
  it("erkennt Key-Änderung", () => {
    const next = { ...DEFAULT_FM_MAP, kindKey: "type" };
    expect(diffMappings(DEFAULT_FM_MAP, next)).toEqual([{ field: "kindKey", from: "kind", to: "type" }]);
  });
  it("erkennt Wert-Änderung (kindTranscript)", () => {
    const next = { ...DEFAULT_FM_MAP, kindTranscript: "Transkript" };
    expect(diffMappings(DEFAULT_FM_MAP, next)).toEqual([{ field: "kindTranscript", from: "transcript", to: "Transkript" }]);
  });
  it("mehrere Änderungen", () => {
    const next = { ...DEFAULT_FM_MAP, kindKey: "type", created: "erstellt" };
    expect(diffMappings(DEFAULT_FM_MAP, next)).toHaveLength(2);
  });
});
