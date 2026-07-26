import { describe, it, expect } from "vitest";
import { diffMappings, isI2mNote } from "../src/fm_migration";
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

const T = (fm: string) => `---\n${fm}\n---\n![[a.png]]\n\nBody\n`;

describe("isI2mNote", () => {
  it("Transkript-Notiz erkannt (source_image + kind: transcript)", () => {
    expect(isI2mNote(T(`source_image: "[[a.png]]"\nkind: transcript`), DEFAULT_FM_MAP)).toBe(true);
  });
  it("Beschreibungs-Notiz erkannt (source_image + kind: description)", () => {
    expect(isI2mNote(T(`source_image: "[[a.png]]"\nkind: description`), DEFAULT_FM_MAP)).toBe(true);
  });
  it("PDF-Notiz erkannt (source_pdf)", () => {
    expect(isI2mNote(T(`source_pdf: "[[a.pdf]]"\nkind: transcript`), DEFAULT_FM_MAP)).toBe(true);
  });
  it("Pre-0.13-Notiz ohne kind-Zeile erkannt", () => {
    expect(isI2mNote(T(`source_image: "[[a.png]]"\ncreated: 2026-01-01`), DEFAULT_FM_MAP)).toBe(true);
  });
  it("Fremdnotiz ohne source-Key abgelehnt", () => {
    expect(isI2mNote(T(`title: Foo\nkind: transcript`), DEFAULT_FM_MAP)).toBe(false);
  });
  it("source-Key aber fremder kind-Wert abgelehnt", () => {
    expect(isI2mNote(T(`source_image: "[[a.png]]"\nkind: note`), DEFAULT_FM_MAP)).toBe(false);
  });
  it("Notiz ohne Frontmatter abgelehnt", () => {
    expect(isI2mNote("kein FM\n![[a.png]]", DEFAULT_FM_MAP)).toBe(false);
  });
  it("Notiz mit leerem Frontmatter abgelehnt", () => {
    expect(isI2mNote("---\n---\n![[a.png]]\n", DEFAULT_FM_MAP)).toBe(false);
  });
});
