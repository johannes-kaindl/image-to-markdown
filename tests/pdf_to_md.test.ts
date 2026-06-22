import { describe, it, expect } from "vitest";
import { buildPdfNote, writePdfTranscript } from "../src/pdf_to_md";

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

function pdfIO(initial: string) {
  const notes = new Map<string, string>([["q.md", initial]]);
  const created: Record<string, string> = {};
  const io: any = {
    date: () => "2026-06-22",
    readNote: async (p: string) => notes.get(p) ?? "",
    writeNote: async (p: string, c: string) => { notes.set(p, c); },
    createNote: async (p: string, c: string) => { created[p] = c; notes.set(p, c); },
    noteExists: (p: string) => notes.has(p),
    resolveImage: (l: string) => ({ path: l, ext: "pdf" }),
  };
  return { io, created, notes };
}

describe("writePdfTranscript", () => {
  it("eine Notiz für alle Seiten, PDF-Suffix, Embed ersetzt", async () => {
    const { io, created, notes } = pdfIO("vor ![[doc.pdf]] nach");
    const r = await writePdfTranscript(io, "q.md", { raw: "![[doc.pdf]]", link: "doc.pdf" }, [
      { page: 1, content: "# A", model: "vm" }, { page: 2, content: "# B", model: "vm" },
    ]);
    expect(r.path).toBe("doc (PDF transcript).md");
    expect(created["doc (PDF transcript).md"]).toContain("## Page 1");
    expect(created["doc (PDF transcript).md"]).toContain("## Page 2");
    expect(notes.get("q.md")).toBe("vor ![[doc (PDF transcript)]] nach");
  });
  it("alle Seiten leer → keine Notiz, Quelle unverändert", async () => {
    const { io, created, notes } = pdfIO("![[doc.pdf]]");
    const r = await writePdfTranscript(io, "q.md", { raw: "![[doc.pdf]]", link: "doc.pdf" }, [
      { page: 1, content: "   ", model: "vm" },
    ]);
    expect(r.path).toBe(null);
    expect(Object.keys(created)).toEqual([]);
    expect(notes.get("q.md")).toBe("![[doc.pdf]]");
  });
});
