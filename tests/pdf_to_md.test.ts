import { describe, it, expect } from "vitest";
import { buildPdfNote, writePdfTranscript, buildPdfBody, reconstructPdfText, countNonWhitespace, PDF_TEXTLAYER_MIN_CHARS } from "../src/pdf_to_md";

describe("reconstructPdfText", () => {
  it("fügt Strings zusammen, Zeilenumbruch bei hasEOL", () => {
    expect(reconstructPdfText([{ str: "Hallo " }, { str: "Welt", hasEOL: true }, { str: "Zeile 2" }])).toBe("Hallo Welt\nZeile 2");
  });
  it("kollabiert mehrere Leerzeilen + trimmt", () => {
    expect(reconstructPdfText([{ str: "A", hasEOL: true }, { str: "", hasEOL: true }, { str: "", hasEOL: true }, { str: "B", hasEOL: true }])).toBe("A\n\nB");
  });
  it("leere Item-Liste → ''", () => {
    expect(reconstructPdfText([])).toBe("");
  });
});

describe("countNonWhitespace / Schwelle", () => {
  it("zählt Nicht-Whitespace-Zeichen", () => {
    expect(countNonWhitespace("a b\nc\t")).toBe(3);
    expect(countNonWhitespace("   \n\t ")).toBe(0);
  });
  it("PDF_TEXTLAYER_MIN_CHARS ist 200", () => {
    expect(PDF_TEXTLAYER_MIN_CHARS).toBe(200);
  });
});

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
  it("ohne sourceName → keine source_note-Zeile", () => {
    const note = buildPdfNote({ pdfLink: "doc.pdf", date: "2026-06-25", model: "vm", rangeFrom: 1, rangeTo: 1, separator: "comment", pages: [{ page: 1, text: "x" }] });
    expect(note).toContain('source_pdf: "[[doc.pdf]]"');
    expect(note).not.toContain("source_note");
  });
});

function pdfIO(initial: string) {
  const notes = new Map<string, string>([["q.md", initial]]);
  const created: Record<string, string> = {};
  const io: any = {
    notes,
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
  it("mit range: fehlende Seite → sichtbarer Platzhalter (kein stiller Gap)", () => {
    const body = buildPdfBody([{ page: 1, text: "A" }, { page: 3, text: "C" }], "comment", { from: 1, to: 3 });
    expect(body).toContain("A");
    expect(body).toContain("C");
    expect(body).toContain("Page 2 — transcription failed");
    // Reihenfolge: Seite 1 vor Platzhalter 2 vor Seite 3
    expect(body.indexOf("A")).toBeLessThan(body.indexOf("Page 2 — transcription failed"));
    expect(body.indexOf("Page 2 — transcription failed")).toBeLessThan(body.indexOf("C"));
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
  it("selfSource: Notiz unter destDir, kein source_note, Quelldatei unangetastet", async () => {
    const { io, notes } = pdfIO("");   // leerer Vault, keine Quellnotiz
    const r = await writePdfTranscript(io, "Anhänge/scan.pdf", { raw: "", link: "scan.pdf" },
      [{ page: 1, content: "Seite 1", model: "vm" }], "comment", undefined, false, { selfSource: true, destDir: "Transkripte" });

    expect(r.path).toBe("Transkripte/scan (PDF transcript).md");
    const note = notes.get("Transkripte/scan (PDF transcript).md");
    expect(note).toContain('source_pdf: "[[scan.pdf]]"');
    expect(note).not.toContain("source_note");
    expect(notes.has("Anhänge/scan.pdf")).toBe(false);   // Quelldatei nie geschrieben
  });
  it("range: fehlgeschlagene Mittel-Seite → Platzhalter + ehrliche pages-Range", async () => {
    const { io, created } = pdfIO("![[doc.pdf]]");
    const r = await writePdfTranscript(io, "q.md", { raw: "![[doc.pdf]]", link: "doc.pdf" }, [
      { page: 1, content: "A", model: "vm" }, { page: 3, content: "C", model: "vm" },   // Seite 2 fehlt
    ], "comment", undefined, true, { range: { from: 1, to: 3 } });
    expect(r.path).toBe("doc (PDF transcript).md");
    const note = created["doc (PDF transcript).md"];
    expect(note).toContain('pages: "1-3"');                       // ehrliche Range, nicht "1-3" aus kept-Zufall
    expect(note).toContain("Page 2 — transcription failed");      // sichtbarer Platzhalter
    expect(note).toContain("A");
    expect(note).toContain("C");
  });
  it("range mit fehlender LETZTER Seite → pages bleibt voller Bereich (Bugfix Range-Label)", async () => {
    const { io, created } = pdfIO("![[doc.pdf]]");
    await writePdfTranscript(io, "q.md", { raw: "![[doc.pdf]]", link: "doc.pdf" }, [
      { page: 1, content: "A", model: "vm" },   // nur Seite 1 von 1-3 erfolgreich
    ], "none", undefined, true, { range: { from: 1, to: 3 } });
    const note = created["doc (PDF transcript).md"];
    expect(note).toContain('pages: "1-3"');                       // NICHT "1-1"
    expect(note).toContain("Page 2 — transcription failed");
    expect(note).toContain("Page 3 — transcription failed");
  });
  it("Override + range: erholte Seite ersetzt Platzhalter, behält created, keine Neuanlage", async () => {
    const notes = new Map<string, string>([
      ["q.md", "![[doc.pdf]]"],
      ["doc (PDF transcript).md", `---\nsource_pdf: "[[doc.pdf]]"\ncreated: 2026-01-01\ntranscribed_by: "alt"\npages: "1-3"\n---\n![[doc.pdf]]\n\n%% Page 1 %%\n\nA\n\n%% Page 2 %%\n\n**Page 2 — transcription failed**\n\n%% Page 3 %%\n\n**Page 3 — transcription failed**\n`],
    ]);
    const created: Record<string, string> = {};
    const io: any = {
      date: () => "2026-06-28",
      readNote: async (p: string) => notes.get(p) ?? "",
      writeNote: async (p: string, c: string) => { notes.set(p, c); },
      createNote: async (p: string, c: string) => { created[p] = c; notes.set(p, c); },
      noteExists: (p: string) => notes.has(p),
      resolveImage: (l: string) => ({ path: l, ext: "pdf" }),
    };
    // Seite 2 jetzt erholt (Retry), Seite 3 weiter fehlend — Produktionspfad: overwritePath UND range.
    const r = await writePdfTranscript(io, "q.md", { raw: "![[doc.pdf]]", link: "doc.pdf" }, [
      { page: 1, content: "A", model: "vm" }, { page: 2, content: "B", model: "vm" },
    ], "comment", "doc (PDF transcript).md", true, { range: { from: 1, to: 3 } });
    expect(r.path).toBe("doc (PDF transcript).md");
    expect(Object.keys(created)).toEqual([]);                       // kein createNote → keine Dublette
    const note = notes.get("doc (PDF transcript).md")!;
    expect(note).toContain("created: 2026-01-01");                  // created bleibt erhalten
    expect(note).toContain('pages: "1-3"');
    expect(note).toContain("A");
    expect(note).toContain("B");                                    // Seite 2 jetzt vorhanden
    expect(note).toContain("Page 3 — transcription failed");        // Seite 3 weiter Platzhalter
    expect(note).not.toContain("Page 2 — transcription failed");    // Platzhalter 2 ersetzt
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
