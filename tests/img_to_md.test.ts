import { describe, it, expect } from "vitest";
import { findImageEmbeds, buildTranscriptNote, replaceEmbed, uniqueNotePath, transcriptNotePath, writeTranscripts, runImgToMd, SUPPORTED_EXTS, basenameNoExt, rewriteTranscript } from "../src/img_to_md";

describe("findImageEmbeds", () => {
  it("findet wikilink- und markdown-Bild-Embeds, filtert Extensions", () => {
    const c = "text\n![[foto.jpg]]\n![[notiz]]\n![alt](bilder/x.png)\n![web](https://e/x.png)";
    const r = findImageEmbeds(c);
    expect(r.map(e => e.link)).toEqual(["foto.jpg", "bilder/x.png"]);
    expect(r[0]).toEqual({ raw: "![[foto.jpg]]", link: "foto.jpg", ext: "jpg", kind: "image" });
  });
  it("ignoriert # und | im Wikilink", () => {
    expect(findImageEmbeds("![[foto.png|200]]")[0].link).toBe("foto.png");
  });
  it("erkennt heic (für Skip-Warnung)", () => {
    expect(findImageEmbeds("![[IMG.heic]]")[0].ext).toBe("heic");
    expect(SUPPORTED_EXTS.includes("heic")).toBe(false);
  });
  it("erkennt PDF-Embeds als kind pdf (ohne #page → page undefined)", () => {
    expect(findImageEmbeds("![[doc.pdf]]")[0]).toEqual({ raw: "![[doc.pdf]]", link: "doc.pdf", ext: "pdf", kind: "pdf", page: undefined });
  });
  it("liest #page=N aus dem PDF-Wikilink", () => {
    expect(findImageEmbeds("![[doc.pdf#page=3]]")[0]).toMatchObject({ link: "doc.pdf", kind: "pdf", page: 3 });
  });
  it("mischt Bild und PDF in Dokument-Reihenfolge", () => {
    expect(findImageEmbeds("![[a.png]] ![[doc.pdf]]").map(e => e.kind)).toEqual(["image", "pdf"]);
  });
  it("erkennt PDF auch als Markdown-Embed", () => {
    expect(findImageEmbeds("![x](files/doc.pdf)")[0]).toMatchObject({ link: "files/doc.pdf", kind: "pdf" });
  });
});

describe("buildTranscriptNote", () => {
  it("baut Frontmatter + Foto-Embed oben + Transkript", () => {
    const note = buildTranscriptNote({ imageLink: "foto.jpg", sourceName: "Notiz", date: "2026-06-20", model: "vm", transcript: "# H\nAbsatz" });
    expect(note).toContain('source_image: "[[foto.jpg]]"');
    expect(note).toContain('source_note: "[[Notiz]]"');
    expect(note).toContain("created: 2026-06-20");
    expect(note).toContain('transcribed_by: "vm"');
    expect(note).toContain("![[foto.jpg]]");
    expect(note.indexOf("![[foto.jpg]]")).toBeLessThan(note.indexOf("# H"));
  });
  it("escaped Anführungszeichen im Frontmatter", () => {
    const note = buildTranscriptNote({ imageLink: 'fo"to.jpg', sourceName: 'No"tiz', date: "2026-06-20", model: 'v"m', transcript: "x" });
    expect(note).toContain('source_image: "[[fo\\"to.jpg]]"');
    expect(note).toContain('source_note: "[[No\\"tiz]]"');
    expect(note).toContain('transcribed_by: "v\\"m"');
  });
});

describe("replaceEmbed", () => {
  it("ersetzt alle Vorkommen literal durch Notiz-Embed", () => {
    expect(replaceEmbed("a ![[foto.jpg]] b ![[foto.jpg]]", "![[foto.jpg]]", "foto")).toBe("a ![[foto]] b ![[foto]]");
  });
});

describe("uniqueNotePath", () => {
  it("hängt Zähler an bei Kollision", () => {
    const exists = new Set(["dir/foto.md", "dir/foto-2.md"]);
    const io = { noteExists: (p: string) => exists.has(p) };
    expect(uniqueNotePath(io, "dir", "foto")).toBe("dir/foto-3.md");
    expect(uniqueNotePath(io, "", "neu")).toBe("neu.md");
  });
});

describe("transcriptNotePath", () => {
  it("legt neben die Quellnotiz, Basename + lokalisierter Suffix, Kollisions-Zähler", () => {
    const exists = new Set(["dir/foto (transcript).md"]);
    const io = { noteExists: (p: string) => exists.has(p) };
    expect(transcriptNotePath(io, "dir/quelle.md", "dir/img/foto.png", "image")).toBe("dir/foto (transcript)-2.md");
    expect(transcriptNotePath(io, "quelle.md", "foto.png", "image")).toBe("foto (transcript).md");
  });
});

function fakeIO(over: any = {}) {
  const notes = new Map<string, string>(over.notes ?? []);
  const created: Record<string, string> = {};
  const notices: string[] = [];
  const io: any = {
    date: () => "2026-06-20",
    readNote: async (p: string) => notes.get(p) ?? "",
    writeNote: async (p: string, c: string) => { notes.set(p, c); },
    createNote: async (p: string, c: string) => { created[p] = c; notes.set(p, c); },
    noteExists: (p: string) => notes.has(p),
    resolveImage: over.resolveImage ?? ((link: string) => ({ path: link, ext: link.split(".").pop() })),
    readImageDataUrl: async () => "data:image/jpeg;base64,AAAA",
    transcribe: over.transcribe ?? (async () => ({ content: "# Transkript", model: "vmodel" })),
    notify: (m: string) => notices.push(m),
  };
  return { io, created, notices, notes };
}

describe("writeTranscripts", () => {
  it("batched: legt Notizen an, ersetzt Embeds, schreibt Quelle einmal", async () => {
    const { io, created, notes } = fakeIO({ notes: [["q.md", "a ![[foto.jpg]] b ![[bild.png]]"]] });
    const r = await writeTranscripts(io, "q.md", [
      { raw: "![[foto.jpg]]", link: "foto.jpg", content: "# A", model: "vm" },
      { raw: "![[bild.png]]", link: "bild.png", content: "# B", model: "vm" },
    ]);
    expect(r.paths).toEqual(["foto (transcript).md", "bild (transcript).md"]);
    expect(created["foto (transcript).md"]).toContain("# A");
    expect(created["foto (transcript).md"]).toContain('transcribed_by: "vm"');
    expect(notes.get("q.md")).toBe("a ![[foto (transcript)]] b ![[bild (transcript)]]");
  });
  it("leeres Transkript → diese Notiz wird übersprungen", async () => {
    const { io, created, notes } = fakeIO({ notes: [["q.md", "![[foto.jpg]]"]] });
    const r = await writeTranscripts(io, "q.md", [{ raw: "![[foto.jpg]]", link: "foto.jpg", content: "   ", model: "vm" }]);
    expect(r.paths).toEqual([]);
    expect(Object.keys(created)).toEqual([]);
    expect(notes.get("q.md")).toBe("![[foto.jpg]]");   // unverändert, kein Write
  });
  it("Kollision über mehrere Entries → Zähler (sequenzielle createNote sichtbar)", async () => {
    const { io } = fakeIO({ notes: [["q.md", "![[a/foto.jpg]] ![[b/foto.jpg]]"]], resolveImage: (link: string) => ({ path: link, ext: "jpg" }) });
    const r = await writeTranscripts(io, "q.md", [
      { raw: "![[a/foto.jpg]]", link: "a/foto.jpg", content: "A", model: "m" },
      { raw: "![[b/foto.jpg]]", link: "b/foto.jpg", content: "B", model: "m" },
    ]);
    expect(r.paths).toEqual(["foto (transcript).md", "foto (transcript)-2.md"]);
  });
  it("Override: überschreibt bestehende Notiz, erhält Frontmatter, Quelle unverändert", async () => {
    const { io, notes } = fakeIO({ notes: [
      ["q.md", "![[b.png]]"],
      ["b (transcript).md", `---\nsource_image: "[[b.png]]"\nsource_note: "[[Orig]]"\ncreated: 2026-01-01\ntranscribed_by: "alt"\n---\n![[b.png]]\n\nALT\n`],
    ] });
    const r = await writeTranscripts(io, "q.md", [
      { raw: "![[b.png]]", link: "b.png", content: "NEU", model: "neu", overwritePath: "b (transcript).md" },
    ]);
    expect(r.paths).toEqual(["b (transcript).md"]);
    expect(notes.get("b (transcript).md")).toContain("NEU");
    expect(notes.get("b (transcript).md")).toContain("created: 2026-01-01");
    expect(notes.get("b (transcript).md")).toContain('transcribed_by: "neu"');
    expect(notes.get("q.md")).toBe("![[b.png]]");  // kein Embed-Ersatz
  });
});

describe("runImgToMd", () => {
  it("Happy-Path: legt Notiz an, ersetzt Link, schreibt Quellnotiz", async () => {
    const { io, created, notes } = fakeIO({ notes: [["q.md", "vor\n![[foto.jpg]]\nnach"]] });
    const r = await runImgToMd(io, "q.md");
    expect(r).toEqual({ transcribed: 1, skipped: 0 });
    expect(created["foto (transcript).md"]).toContain("# Transkript");
    expect(created["foto (transcript).md"]).toContain('transcribed_by: "vmodel"');
    expect(notes.get("q.md")).toBe("vor\n![[foto (transcript)]]\nnach");
  });
  it("keine Bilder → Notice, kein Schreiben", async () => {
    const { io, created } = fakeIO({ notes: [["q.md", "nur text"]] });
    const r = await runImgToMd(io, "q.md");
    expect(r.transcribed).toBe(0);
    expect(Object.keys(created)).toEqual([]);
  });
  it("nicht unterstütztes Format → skip", async () => {
    const { io, created, notices } = fakeIO({ notes: [["q.md", "![[IMG.heic]]"]] });
    const r = await runImgToMd(io, "q.md");
    expect(r).toEqual({ transcribed: 0, skipped: 1 });
    expect(Object.keys(created)).toEqual([]);
    expect(notices.some(n => n.includes("not supported"))).toBe(true);
  });
  it("leeres Transkript → keine Notiz", async () => {
    const { io, created } = fakeIO({ notes: [["q.md", "![[foto.jpg]]"]], transcribe: async () => ({ content: "   ", model: "vmodel" }) });
    const r = await runImgToMd(io, "q.md");
    expect(r).toEqual({ transcribed: 0, skipped: 1 });
    expect(Object.keys(created)).toEqual([]);
  });
  it("Transkriptions-Fehler → skip, kein Crash", async () => {
    const { io } = fakeIO({ notes: [["q.md", "![[foto.jpg]]"]], transcribe: async () => { throw new Error("offline"); } });
    const r = await runImgToMd(io, "q.md");
    expect(r).toEqual({ transcribed: 0, skipped: 1 });
  });
  it("onlyRaw verarbeitet nur das eine Embed", async () => {
    const { io, created } = fakeIO({ notes: [["q.md", "![[a.jpg]]\n![[b.jpg]]"]] });
    await runImgToMd(io, "q.md", { onlyRaw: "![[b.jpg]]" });
    expect(Object.keys(created)).toEqual(["b (transcript).md"]);
  });
  it("Namens-Kollision → Zähler", async () => {
    const { io, created } = fakeIO({ notes: [["q.md", "![[foto.jpg]]"], ["foto (transcript).md", "alt"]] });
    await runImgToMd(io, "q.md");
    expect(created["foto (transcript)-2.md"]).toBeTruthy();
  });
  it("Duplikat-Embeds desselben Bildes → eine Transkription, alle Vorkommen ersetzt", async () => {
    const { io, created, notes } = fakeIO({ notes: [["q.md", "![[foto.jpg]]\ntext\n![[foto.jpg]]"]] });
    const r = await runImgToMd(io, "q.md");
    expect(r.transcribed).toBe(1);
    expect(Object.keys(created)).toEqual(["foto (transcript).md"]);
    expect(notes.get("q.md")).toBe("![[foto (transcript)]]\ntext\n![[foto (transcript)]]");
  });
  it("PDF-Embed → Hinweis auf Sidebar, kein Schreiben", async () => {
    const { io, created, notices } = fakeIO({ notes: [["q.md", "![[doc.pdf]]"]], resolveImage: (l: string) => ({ path: l, ext: "pdf" }) });
    const r = await runImgToMd(io, "q.md");
    expect(r).toEqual({ transcribed: 0, skipped: 1 });
    expect(Object.keys(created)).toEqual([]);
    expect(notices.some(n => n.includes("sidebar"))).toBe(true);
  });
});

describe("rewriteTranscript", () => {
  it("erhält source_*/source_note/created, ersetzt transcribed_by + Body, kein doppeltes Frontmatter", () => {
    const old = `---\nsource_image: "[[b.png]]"\nsource_note: "[[Quelle]]"\ncreated: 2026-01-01\ntranscribed_by: "alt"\n---\n![[b.png]]\n\nALTER TEXT\n`;
    const out = rewriteTranscript(old, { model: "neu", sourceLink: "b.png", body: "NEUER TEXT" });
    expect(out).toContain('source_image: "[[b.png]]"');
    expect(out).toContain('source_note: "[[Quelle]]"');
    expect(out).toContain("created: 2026-01-01");
    expect(out).toContain('transcribed_by: "neu"');
    expect(out).not.toContain('transcribed_by: "alt"');
    expect(out).toContain("![[b.png]]");
    expect(out).toContain("NEUER TEXT");
    expect(out).not.toContain("ALTER TEXT");
    expect(out.match(/^---$/gm)?.length).toBe(2);
  });
  it("ersetzt vorhandenes pages bei PDF-Override", () => {
    const old = `---\nsource_pdf: "[[d.pdf]]"\ncreated: 2026-01-01\ntranscribed_by: "alt"\npages: "1-2"\n---\n![[d.pdf]]\n\nX\n`;
    const out = rewriteTranscript(old, { model: "neu", sourceLink: "d.pdf", body: "Y", pages: "1-5" });
    expect(out).toContain('pages: "1-5"');
    expect(out).not.toContain('pages: "1-2"');
  });
});
