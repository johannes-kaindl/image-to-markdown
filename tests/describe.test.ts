import { describe, it, expect } from "vitest";
import { buildDescribePrompt, parseDescription } from "../src/describe";

const TAX = ["Foto", "Diagramm", "Screenshot"];

describe("buildDescribePrompt", () => {
  it("injects the taxonomy and the literal CATEGORY/TAGS markers", () => {
    const p = buildDescribePrompt(TAX, "en");
    expect(p).toContain("CATEGORY:");
    expect(p).toContain("TAGS:");
    expect(p).toContain("Diagramm");
  });
});

describe("parseDescription", () => {
  it("splits a well-formed head with --- separator", () => {
    const r = parseDescription("CATEGORY: Diagramm\nTAGS: arch, projekt-x\n---\nEin Flussdiagramm.", TAX);
    expect(r.category).toBe("Diagramm");
    expect(r.tags).toEqual(["arch", "projekt-x"]);
    expect(r.prose).toBe("Ein Flussdiagramm.");
  });
  it("matches the taxonomy case-insensitively and returns canonical spelling", () => {
    expect(parseDescription("CATEGORY: diagramm\n---\nx", TAX).category).toBe("Diagramm");
  });
  it("moves an unknown category into tags and leaves category null", () => {
    const r = parseDescription("CATEGORY: chart\nTAGS: a\n---\nx", TAX);
    expect(r.category).toBeNull();
    expect(r.tags).toEqual(["chart", "a"]);
  });
  it("treats input without markers as pure prose", () => {
    const r = parseDescription("Just a plain description.", TAX);
    expect(r.category).toBeNull();
    expect(r.tags).toEqual([]);
    expect(r.prose).toBe("Just a plain description.");
  });
  it("is CRLF-tolerant", () => {
    const r = parseDescription("CATEGORY: Foto\r\n---\r\nHallo", TAX);
    expect(r.category).toBe("Foto");
    expect(r.prose).toBe("Hallo");
  });
  it("returns empty fields for empty input", () => {
    expect(parseDescription("   ", TAX)).toEqual({ category: null, tags: [], prose: "" });
  });
});
