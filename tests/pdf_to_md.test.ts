import { describe, it, expect } from "vitest";
import { buildPdfNote } from "../src/pdf_to_md";

describe("buildPdfNote", () => {
  it("Frontmatter + PDF-Embed oben + Seiten-Sektionen in Reihenfolge", () => {
    const note = buildPdfNote({ pdfLink: "doc.pdf", sourceName: "Quelle", date: "2026-06-22", model: "vm", rangeFrom: 1, rangeTo: 2, pages: [{ page: 1, text: "# A" }, { page: 2, text: "# B" }] });
    expect(note).toContain('source_pdf: "[[doc.pdf]]"');
    expect(note).toContain('source_note: "[[Quelle]]"');
    expect(note).toContain('transcribed_by: "vm"');
    expect(note).toContain('pages: "1-2"');
    expect(note).toContain("![[doc.pdf]]");
    expect(note).toContain("## Page 1");
    expect(note).toContain("## Page 2");
    expect(note.indexOf("![[doc.pdf]]")).toBeLessThan(note.indexOf("## Page 1"));
    expect(note.indexOf("## Page 1")).toBeLessThan(note.indexOf("## Page 2"));
  });
  it("überspringt leere Seiten", () => {
    const note = buildPdfNote({ pdfLink: "doc.pdf", sourceName: "Q", date: "2026-06-22", model: "vm", rangeFrom: 1, rangeTo: 2, pages: [{ page: 1, text: "   " }, { page: 2, text: "X" }] });
    expect(note).not.toContain("## Page 1");
    expect(note).toContain("## Page 2");
  });
  it("escaped Anführungszeichen im Frontmatter", () => {
    const note = buildPdfNote({ pdfLink: 'd"c.pdf', sourceName: 'Q"x', date: "2026-06-22", model: 'v"m', rangeFrom: 1, rangeTo: 1, pages: [{ page: 1, text: "x" }] });
    expect(note).toContain('source_pdf: "[[d\\"c.pdf]]"');
    expect(note).toContain('transcribed_by: "v\\"m"');
  });
});
