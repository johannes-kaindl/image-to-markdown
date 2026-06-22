import { describe, it, expect } from "vitest";
import { findImageEmbeds, buildTranscriptNote, replaceEmbed, uniqueNotePath, transcriptNotePath, writeTranscripts, runImgToMd, SUPPORTED_EXTS } from "../src/img_to_md";

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
  it("legt neben die Quellnotiz, Basename des Bildes, Kollisions-Suffix", () => {
    const exists = new Set(["dir/foto.md"]);
    const io = { noteExists: (p: string) => exists.has(p) };
    expect(transcriptNotePath(io, "dir/quelle.md", "dir/img/foto.png")).toBe("dir/foto-2.md");
    expect(transcriptNotePath(io, "quelle.md", "foto.png")).toBe("foto.md");
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
    expect(r.paths).toEqual(["foto.md", "bild.md"]);
    expect(created["foto.md"]).toContain("# A");
    expect(created["foto.md"]).toContain('transcribed_by: "vm"');
    expect(notes.get("q.md")).toBe("a ![[foto]] b ![[bild]]");
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
    expect(r.paths).toEqual(["foto.md", "foto-2.md"]);
  });
});

describe("runImgToMd", () => {
  it("Happy-Path: legt Notiz an, ersetzt Link, schreibt Quellnotiz", async () => {
    const { io, created, notes } = fakeIO({ notes: [["q.md", "vor\n![[foto.jpg]]\nnach"]] });
    const r = await runImgToMd(io, "q.md");
    expect(r).toEqual({ transcribed: 1, skipped: 0 });
    expect(created["foto.md"]).toContain("# Transkript");
    expect(created["foto.md"]).toContain('transcribed_by: "vmodel"');
    expect(notes.get("q.md")).toBe("vor\n![[foto]]\nnach");
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
    expect(Object.keys(created)).toEqual(["b.md"]);
  });
  it("Namens-Kollision → Zähler", async () => {
    const { io, created } = fakeIO({ notes: [["q.md", "![[foto.jpg]]"], ["foto.md", "alt"]] });
    await runImgToMd(io, "q.md");
    expect(created["foto-2.md"]).toBeTruthy();
  });
  it("Duplikat-Embeds desselben Bildes → eine Transkription, alle Vorkommen ersetzt", async () => {
    const { io, created, notes } = fakeIO({ notes: [["q.md", "![[foto.jpg]]\ntext\n![[foto.jpg]]"]] });
    const r = await runImgToMd(io, "q.md");
    expect(r.transcribed).toBe(1);
    expect(Object.keys(created)).toEqual(["foto.md"]);
    expect(notes.get("q.md")).toBe("![[foto]]\ntext\n![[foto]]");
  });
  it("PDF-Embed → Hinweis auf Sidebar, kein Schreiben", async () => {
    const { io, created, notices } = fakeIO({ notes: [["q.md", "![[doc.pdf]]"]], resolveImage: (l: string) => ({ path: l, ext: "pdf" }) });
    const r = await runImgToMd(io, "q.md");
    expect(r).toEqual({ transcribed: 0, skipped: 1 });
    expect(Object.keys(created)).toEqual([]);
    expect(notices.some(n => n.includes("sidebar"))).toBe(true);
  });
});
