import { describe, it, expect } from "vitest";
import { buildPdfNote, writePdfTranscript, buildPdfBody } from "../src/pdf_to_md";

describe("buildPdfNote", () => {
  it("Frontmatter + PDF-Embed oben + Heading-Sektionen in Reihenfolge", () => {
    const note = buildPdfNote({ pdfLink: "doc.pdf", sourceName: "Quelle", date: "2026-06-22", model: "vm", rangeFrom: 1, rangeTo: 2, separator: "heading", pages: [{ page: 1, text: "# A" }, { page: 2, text: "# B" }] });
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
  it("comment-Separator (Default): %% Page N %%, keine Überschrift", () => {
    const note = buildPdfNote({ pdfLink: "doc.pdf", sourceName: "Q", date: "2026-06-22", model: "vm", rangeFrom: 1, rangeTo: 2, separator: "comment", pages: [{ page: 1, text: "A" }, { page: 2, text: "B" }] });
    expect(note).toContain("%% Page 1 %%");
    expect(note).toContain("%% Page 2 %%");
    expect(note).not.toContain("## Page");
  });
  it("rule-Separator: --- zwischen Seiten, keine Marker", () => {
    const note = buildPdfNote({ pdfLink: "doc.pdf", sourceName: "Q", date: "2026-06-22", model: "vm", rangeFrom: 1, rangeTo: 2, separator: "rule", pages: [{ page: 1, text: "A" }, { page: 2, text: "B" }] });
    expect(note).toContain("\n\n---\n\n");
    expect(note).not.toContain("## Page");
    expect(note).not.toContain("%%");
  });
  it("none-Separator: nahtlos, keine Marker/Trenner", () => {
    const note = buildPdfNote({ pdfLink: "doc.pdf", sourceName: "Q", date: "2026-06-22", model: "vm", rangeFrom: 1, rangeTo: 2, separator: "none", pages: [{ page: 1, text: "A" }, { page: 2, text: "B" }] });
    expect(note).toContain("A\n\nB");
    expect(note).not.toContain("## Page");
    expect(note).not.toContain("%%");
  });
  it("überspringt leere Seiten", () => {
    const note = buildPdfNote({ pdfLink: "doc.pdf", sourceName: "Q", date: "2026-06-22", model: "vm", rangeFrom: 1, rangeTo: 2, separator: "heading", pages: [{ page: 1, text: "   " }, { page: 2, text: "X" }] });
    expect(note).not.toContain("## Page 1");
    expect(note).toContain("## Page 2");
  });
  it("escaped Anführungszeichen im Frontmatter", () => {
    const note = buildPdfNote({ pdfLink: 'd"c.pdf', sourceName: 'Q"x', date: "2026-06-22", model: 'v"m', rangeFrom: 1, rangeTo: 1, separator: "comment", pages: [{ page: 1, text: "x" }] });
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

describe("buildPdfBody", () => {
  it("baut nur die Seiten-Blöcke (ohne Frontmatter/Embed)", () => {
    const body = buildPdfBody([{ page: 1, text: "A" }, { page: 2, text: "B" }], "comment");
    expect(body).toContain("%% Page 1 %%");
    expect(body).toContain("A");
    expect(body).toContain("%% Page 2 %%");
    expect(body).not.toContain("source_pdf");
    expect(body).not.toContain("![[");
  });
});

describe("writePdfTranscript", () => {
  it("eine Notiz für alle Seiten (comment-Default), PDF-Suffix, Embed ersetzt", async () => {
    const { io, created, notes } = pdfIO("vor ![[doc.pdf]] nach");
    const r = await writePdfTranscript(io, "q.md", { raw: "![[doc.pdf]]", link: "doc.pdf" }, [
      { page: 1, content: "# A", model: "vm" }, { page: 2, content: "# B", model: "vm" },
    ], "comment");
    expect(r.path).toBe("doc (PDF transcript).md");
    expect(created["doc (PDF transcript).md"]).toContain("%% Page 1 %%");
    expect(created["doc (PDF transcript).md"]).toContain("%% Page 2 %%");
    expect(notes.get("q.md")).toBe("vor ![[doc (PDF transcript)]] nach");
  });
  it("alle Seiten leer → keine Notiz, Quelle unverändert", async () => {
    const { io, created, notes } = pdfIO("![[doc.pdf]]");
    const r = await writePdfTranscript(io, "q.md", { raw: "![[doc.pdf]]", link: "doc.pdf" }, [
      { page: 1, content: "   ", model: "vm" },
    ], "none");
    expect(r.path).toBe(null);
    expect(Object.keys(created)).toEqual([]);
    expect(notes.get("q.md")).toBe("![[doc.pdf]]");
  });
  it("embed:false legt PDF-Notiz an, lässt den Quell-Link unverändert", async () => {
    const { io, created, notes } = pdfIO("siehe [[doc.pdf]] dazu");
    const r = await writePdfTranscript(io, "q.md", { raw: "[[doc.pdf]]", link: "doc.pdf" },
      [{ page: 1, content: "A", model: "m" }], "comment", undefined, false);
    expect(r.path).toBe("doc (PDF transcript).md");
    expect(created["doc (PDF transcript).md"]).toBeDefined();
    expect(notes.get("q.md")).toBe("siehe [[doc.pdf]] dazu");   // Quelle unangetastet
  });
  it("Override: überschreibt bestehende PDF-Notiz, neue pages, Quelle unverändert", async () => {
    const notes = new Map<string, string>([
      ["q.md", "![[doc.pdf]]"],
      ["doc (PDF transcript).md", `---\nsource_pdf: "[[doc.pdf]]"\ncreated: 2026-01-01\ntranscribed_by: "alt"\npages: "1-1"\n---\n![[doc.pdf]]\n\nALT\n`],
    ]);
    const created: Record<string, string> = {};
    const io: any = {
      date: () => "2026-06-23",
      readNote: async (p: string) => notes.get(p) ?? "",
      writeNote: async (p: string, c: string) => { notes.set(p, c); },
      createNote: async (p: string, c: string) => { created[p] = c; notes.set(p, c); },
      noteExists: (p: string) => notes.has(p),
      resolveImage: (l: string) => ({ path: l, ext: "pdf" }),
    };
    const r = await writePdfTranscript(io, "q.md", { raw: "![[doc.pdf]]", link: "doc.pdf" }, [
      { page: 1, content: "A", model: "neu" }, { page: 2, content: "B", model: "neu" },
    ], "comment", "doc (PDF transcript).md");
    expect(r.path).toBe("doc (PDF transcript).md");
    expect(Object.keys(created)).toEqual([]);                       // kein createNote
    expect(notes.get("doc (PDF transcript).md")).toContain("created: 2026-01-01");
    expect(notes.get("doc (PDF transcript).md")).toContain('pages: "1-2"');
    expect(notes.get("doc (PDF transcript).md")).toContain("%% Page 1 %%");
    expect(notes.get("q.md")).toBe("![[doc.pdf]]");                 // kein Embed-Ersatz
  });
});
