import { describe, it, expect } from "vitest";
import { findImageEmbeds, buildTranscriptNote, replaceEmbed, uniqueNotePath, transcriptNotePath, writeTranscripts, runImgToMd, SUPPORTED_EXTS, basenameNoExt, rewriteTranscript, stripFrontmatter, classifySource, buildSelfSourceItem, basename, truncateMiddle, extractTranscriptBody, buildDescriptionNote, descriptionNotePath, writeDescriptions } from "../src/img_to_md";
import { applySelection } from "../src/diff";
import { DEFAULT_FM_MAP } from "../src/frontmatter_map";

describe("stripFrontmatter", () => {
  it("entfernt führenden YAML-Block", () => {
    expect(stripFrontmatter("---\nsource_pdf: \"[[x.pdf]]\"\n---\nBody [[y.png]]")).toBe("Body [[y.png]]");
  });
  it("lässt Inhalt ohne Frontmatter unverändert", () => {
    expect(stripFrontmatter("kein FM [[a.png]]")).toBe("kein FM [[a.png]]");
  });
  it("greift nur am Anfang (--- mitten im Text bleibt)", () => {
    expect(stripFrontmatter("text\n---\na: 1\n---\n")).toBe("text\n---\na: 1\n---\n");
  });
  it("entfernt auch CRLF-Frontmatter (Loop-Schutz robust)", () => {
    expect(stripFrontmatter("---\r\nsource_pdf: \"[[x.pdf]]\"\r\n---\r\nBody")).toBe("Body");
  });
});

describe("findImageEmbeds", () => {
  it("findet wikilink- und markdown-Bild-Embeds, filtert Extensions", () => {
    const c = "text\n![[foto.jpg]]\n![[notiz]]\n![alt](bilder/x.png)\n![web](https://e/x.png)";
    const r = findImageEmbeds(c);
    expect(r.map(e => e.link)).toEqual(["foto.jpg", "bilder/x.png"]);
    expect(r[0]).toEqual({ raw: "![[foto.jpg]]", link: "foto.jpg", ext: "jpg", kind: "image", embed: true });
  });
  it("ignoriert # und | im Wikilink", () => {
    expect(findImageEmbeds("![[foto.png|200]]")[0].link).toBe("foto.png");
  });
  it("erkennt heic (für Skip-Warnung)", () => {
    expect(findImageEmbeds("![[IMG.heic]]")[0].ext).toBe("heic");
    expect(SUPPORTED_EXTS.includes("heic")).toBe(false);
  });
  it("erkennt PDF-Embeds als kind pdf (ohne #page → page undefined)", () => {
    expect(findImageEmbeds("![[doc.pdf]]")[0]).toEqual({ raw: "![[doc.pdf]]", link: "doc.pdf", ext: "pdf", kind: "pdf", page: undefined, embed: true });
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
  it("erkennt reinen Wikilink (ohne !) als embed:false", () => {
    expect(findImageEmbeds("siehe [[scan.pdf]] dazu")[0]).toMatchObject({ link: "scan.pdf", kind: "pdf", embed: false });
  });
  it("erkennt reinen Markdown-Link (ohne !) als embed:false", () => {
    expect(findImageEmbeds("[Vertrag](akten/scan.png)")[0]).toMatchObject({ link: "akten/scan.png", kind: "image", embed: false });
  });
  it("liest #page=N auch aus reinem PDF-Wikilink", () => {
    expect(findImageEmbeds("[[doc.pdf#page=3]]")[0]).toMatchObject({ kind: "pdf", page: 3, embed: false });
  });
  it("Embed und reiner Link derselben Datei → zwei Treffer mit korrektem embed", () => {
    const r = findImageEmbeds("![[a.png]] und [[a.png]]");
    expect(r.map(e => e.embed)).toEqual([true, false]);
  });
  it("ignoriert externe URL auch als reinen Link", () => {
    expect(findImageEmbeds("[x](https://e.com/a.pdf)")).toEqual([]);
  });
  it("findet Bild/PDF-Links nicht im Frontmatter (Loop-Schutz)", () => {
    expect(findImageEmbeds("---\nsource_pdf: \"[[scan.pdf]]\"\n---\nText ohne Quelle")).toEqual([]);
  });
});

describe("buildTranscriptNote", () => {
  it("baut Frontmatter + Foto-Embed oben + Transkript", () => {
    const note = buildTranscriptNote({ imageLink: "foto.jpg", sourceName: "Notiz", date: "2026-06-20", model: "vm", transcript: "# H\nAbsatz" }, DEFAULT_FM_MAP);
    expect(note).toContain('source_image: "[[foto.jpg]]"');
    expect(note).toContain('source_note: "[[Notiz]]"');
    expect(note).toContain("kind: transcript");
    expect(note).toContain("created: 2026-06-20");
    expect(note).toContain('transcribed_by: "vm"');
    expect(note).toContain("![[foto.jpg]]");
    expect(note.indexOf("![[foto.jpg]]")).toBeLessThan(note.indexOf("# H"));
  });
  it("escaped Anführungszeichen im Frontmatter", () => {
    const note = buildTranscriptNote({ imageLink: 'fo"to.jpg', sourceName: 'No"tiz', date: "2026-06-20", model: 'v"m', transcript: "x" }, DEFAULT_FM_MAP);
    expect(note).toContain('source_image: "[[fo\\"to.jpg]]"');
    expect(note).toContain('source_note: "[[No\\"tiz]]"');
    expect(note).toContain('transcribed_by: "v\\"m"');
  });
  it("ohne sourceName → keine source_note-Zeile", () => {
    const note = buildTranscriptNote({ imageLink: "scan.png", date: "2026-06-25", model: "vm", transcript: "x" }, DEFAULT_FM_MAP);
    expect(note).toContain('source_image: "[[scan.png]]"');
    expect(note).not.toContain("source_note");
  });
  it("mit DEFAULT_FM_MAP byte-identisch zu heute bis auf additive kind-Zeile (nach source_note, vor created)", () => {
    const note = buildTranscriptNote(
      { imageLink: "img.png", sourceName: "Quelle", date: "2026-07-12", model: "m", transcript: "Hallo" },
      DEFAULT_FM_MAP,
    );
    expect(note).toBe(
      `---\nsource_image: "[[img.png]]"\nsource_note: "[[Quelle]]"\nkind: transcript\ncreated: 2026-07-12\ntranscribed_by: "m"\n---\n![[img.png]]\n\nHallo\n`,
    );
  });
  it("honors a custom mapping (key + kind value)", () => {
    const map = { ...DEFAULT_FM_MAP, sourceImage: "quelle_bild", kindKey: "type", kindTranscript: "📄 Transkript" };
    const note = buildTranscriptNote({ imageLink: "img.png", date: "2026-07-12", model: "m", transcript: "x" }, map);
    expect(note).toContain(`quelle_bild: "[[img.png]]"`);
    expect(note).toContain(`type: 📄 Transkript`);
  });
  it("ohne sourceName → kind-Zeile nach source_image (statt source_note)", () => {
    const note = buildTranscriptNote({ imageLink: "scan.png", date: "2026-06-25", model: "vm", transcript: "x" }, DEFAULT_FM_MAP);
    const lines = note.split("\n");
    expect(lines[1]).toBe('source_image: "[[scan.png]]"');
    expect(lines[2]).toBe("kind: transcript");
  });
});

describe("buildDescriptionNote", () => {
  it("buildDescriptionNote: image embed in body, kind description, category + tags", () => {
    const note = buildDescriptionNote(
      { imageLink: "img.png", sourceName: "Quelle", date: "2026-07-12", model: "m", category: "Diagramm", tags: ["arch", "x"], prose: "Ein Diagramm." },
      DEFAULT_FM_MAP,
    );
    expect(note).toBe(
      `---\nsource_image: "[[img.png]]"\nsource_note: "[[Quelle]]"\nkind: description\ncategory: Diagramm\ntags: [arch, x]\ndescribed_by: "m"\ncreated: 2026-07-12\n---\n![[img.png]]\n\nEin Diagramm.\n`,
    );
    // Bild-Embed im Body: die Beschreibungs-Notiz zeigt das Bild („Karteikarte"). Die Prosa bleibt
    // im Body (nicht im Frontmatter), weil vault-rag nur den Body indexiert (chunker strippt Frontmatter).
    expect(note).toContain("![[img.png]]");
  });
  it("buildDescriptionNote: omits category/tags when empty", () => {
    const note = buildDescriptionNote({ imageLink: "i.png", date: "2026-07-12", model: "m", category: null, tags: [], prose: "x" }, DEFAULT_FM_MAP);
    expect(note).not.toContain("category:");
    expect(note).not.toContain("tags:");
  });
  it("ohne sourceName → keine source_note-Zeile", () => {
    const note = buildDescriptionNote({ imageLink: "scan.png", date: "2026-06-25", model: "vm", category: null, tags: [], prose: "x" }, DEFAULT_FM_MAP);
    expect(note).not.toContain("source_note");
  });
  it("honors a custom mapping (key + kind value)", () => {
    const map = { ...DEFAULT_FM_MAP, sourceImage: "quelle_bild", kindKey: "type", kindDescription: "📝 Beschreibung" };
    const note = buildDescriptionNote({ imageLink: "img.png", date: "2026-07-12", model: "m", category: null, tags: [], prose: "x" }, map);
    expect(note).toContain(`quelle_bild: "[[img.png]]"`);
    expect(note).toContain(`type: 📝 Beschreibung`);
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

  it("destDir überschreibt das Verzeichnis der Quellnotiz", () => {
    const io = { noteExists: () => false };
    expect(transcriptNotePath(io, "Anhänge/scan.pdf", "Anhänge/scan.pdf", "pdf", "Transkripte")).toBe("Transkripte/scan (PDF transcript).md");
    expect(transcriptNotePath(io, "Anhänge/scan.pdf", "Anhänge/scan.pdf", "pdf", "")).toBe("scan (PDF transcript).md");
  });
});

describe("descriptionNotePath", () => {
  it("legt neben die Quellnotiz, Basename + lokalisierter Suffix, Kollisions-Zähler", () => {
    const exists = new Set(["dir/foto (description).md"]);
    const io = { noteExists: (p: string) => exists.has(p) };
    expect(descriptionNotePath(io, "dir/quelle.md", "dir/img/foto.png")).toBe("dir/foto (description)-2.md");
    expect(descriptionNotePath(io, "quelle.md", "foto.png")).toBe("foto (description).md");
  });

  it("destDir überschreibt das Verzeichnis der Quellnotiz", () => {
    const io = { noteExists: () => false };
    expect(descriptionNotePath(io, "Anhänge/scan.png", "Anhänge/scan.png", "Beschreibungen")).toBe("Beschreibungen/scan (description).md");
  });
});

function fakeIO(over: any = {}) {
  const notes = new Map<string, string>(over.notes ?? []);
  const created: Record<string, string> = {};
  const notices: string[] = [];
  const io: any = {
    notes,
    date: () => "2026-06-20",
    readNote: over.readNote ?? (async (p: string) => notes.get(p) ?? ""),
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
    expect(r.results.map(x => x.path)).toEqual(["foto (transcript).md", "bild (transcript).md"]);
    expect(created["foto (transcript).md"]).toContain("# A");
    expect(created["foto (transcript).md"]).toContain('transcribed_by: "vm"');
    expect(notes.get("q.md")).toBe("a ![[foto (transcript)]] b ![[bild (transcript)]]");
  });
  it("leeres Transkript → diese Notiz wird übersprungen", async () => {
    const { io, created, notes } = fakeIO({ notes: [["q.md", "![[foto.jpg]]"]] });
    const r = await writeTranscripts(io, "q.md", [{ raw: "![[foto.jpg]]", link: "foto.jpg", content: "   ", model: "vm" }]);
    expect(r.results.map(x => x.path)).toEqual([null]);
    expect(Object.keys(created)).toEqual([]);
    expect(notes.get("q.md")).toBe("![[foto.jpg]]");   // unverändert, kein Write
  });
  it("Kollision über mehrere Entries → Zähler (sequenzielle createNote sichtbar)", async () => {
    const { io } = fakeIO({ notes: [["q.md", "![[a/foto.jpg]] ![[b/foto.jpg]]"]], resolveImage: (link: string) => ({ path: link, ext: "jpg" }) });
    const r = await writeTranscripts(io, "q.md", [
      { raw: "![[a/foto.jpg]]", link: "a/foto.jpg", content: "A", model: "m" },
      { raw: "![[b/foto.jpg]]", link: "b/foto.jpg", content: "B", model: "m" },
    ]);
    expect(r.results.map(x => x.path)).toEqual(["foto (transcript).md", "foto (transcript)-2.md"]);
  });
  it("embed:false legt Notiz an, lässt den Quell-Link aber unverändert", async () => {
    const { io, created, notes } = fakeIO({ notes: [["q.md", "siehe [[scan.png]] dazu"]] });
    const r = await writeTranscripts(io, "q.md", [
      { raw: "[[scan.png]]", link: "scan.png", content: "# T", model: "vm", embed: false },
    ]);
    expect(r.results.map(x => x.path)).toEqual(["scan (transcript).md"]);
    expect(created["scan (transcript).md"]).toContain("# T");
    expect(notes.get("q.md")).toBe("siehe [[scan.png]] dazu");   // Quelle unangetastet
  });
  it("Override: überschreibt bestehende Notiz, erhält Frontmatter, Quelle unverändert", async () => {
    const { io, notes } = fakeIO({ notes: [
      ["q.md", "![[b.png]]"],
      ["b (transcript).md", `---\nsource_image: "[[b.png]]"\nsource_note: "[[Orig]]"\ncreated: 2026-01-01\ntranscribed_by: "alt"\n---\n![[b.png]]\n\nALT\n`],
    ] });
    const r = await writeTranscripts(io, "q.md", [
      { raw: "![[b.png]]", link: "b.png", content: "NEU", model: "neu", overwritePath: "b (transcript).md" },
    ]);
    expect(r.results.map(x => x.path)).toEqual(["b (transcript).md"]);
    expect(notes.get("b (transcript).md")).toContain("NEU");
    expect(notes.get("b (transcript).md")).toContain("created: 2026-01-01");
    expect(notes.get("b (transcript).md")).toContain('transcribed_by: "neu"');
    expect(notes.get("q.md")).toBe("![[b.png]]");  // kein Embed-Ersatz
  });

  it("Override ohne knownBody (Erstberührung), confirmOverwrite liefert Body (accept-all) → schreibt", async () => {
    const { io, notes } = fakeIO({ notes: [
      ["b (transcript).md", `---\ntranscribed_by: "alt"\n---\n![[b.png]]\n\nALT`],
    ] });
    let seen: any = null;
    io.confirmOverwrite = async (ctx: any) => { seen = ctx; return applySelection(ctx.diff, []); };
    const r = await writeTranscripts(io, "q.md", [
      { raw: "![[b.png]]", link: "b.png", content: "NEU", model: "neu", overwritePath: "b (transcript).md" },
    ]);
    expect(r.results.map(x => x.path)).toEqual(["b (transcript).md"]);
    expect(seen.path).toBe("b (transcript).md");
    expect(seen.diff).toEqual([{ kind: "del", text: "ALT" }, { kind: "add", text: "NEU" }]);
    expect(notes.get("b (transcript).md")).toContain("NEU");
  });
  it("Override ohne knownBody, confirmOverwrite liefert null → schreibt NICHT, paths[i]=null", async () => {
    const { io, notes } = fakeIO({ notes: [
      ["b (transcript).md", `---\ntranscribed_by: "alt"\n---\n![[b.png]]\n\nALT`],
    ] });
    io.confirmOverwrite = async () => null;
    const r = await writeTranscripts(io, "q.md", [
      { raw: "![[b.png]]", link: "b.png", content: "NEU", model: "neu", overwritePath: "b (transcript).md" },
    ]);
    expect(r.results.map(x => x.path)).toEqual([null]);
    expect(notes.get("b (transcript).md")).toContain("ALT");
  });
  it("Override mit knownBody === on-disk-Body (Retry-Continuation) → kein Callback, schreibt direkt", async () => {
    const { io, notes } = fakeIO({ notes: [
      ["b (transcript).md", `---\ntranscribed_by: "alt"\n---\n![[b.png]]\n\nALT`],
    ] });
    let called = false;
    io.confirmOverwrite = async () => { called = true; return null; };
    const r = await writeTranscripts(io, "q.md", [
      { raw: "![[b.png]]", link: "b.png", content: "NEU", model: "neu", overwritePath: "b (transcript).md", knownBody: "ALT" },
    ]);
    expect(called).toBe(false);
    expect(r.results.map(x => x.path)).toEqual(["b (transcript).md"]);
    expect(notes.get("b (transcript).md")).toContain("NEU");
  });
  it("Override mit knownBody ≠ on-disk-Body (manueller Edit dazwischen) → re-gated, Callback aufgerufen", async () => {
    const { io, notes } = fakeIO({ notes: [
      ["b (transcript).md", `---\ntranscribed_by: "alt"\n---\n![[b.png]]\n\nMANUELL BEARBEITET`],
    ] });
    let seen: any = null;
    io.confirmOverwrite = async (ctx: any) => { seen = ctx; return applySelection(ctx.diff, []); };
    const r = await writeTranscripts(io, "q.md", [
      // knownBody "ALT" = was das Plugin zuletzt geschrieben hat; on-disk weicht ab (User hat editiert)
      { raw: "![[b.png]]", link: "b.png", content: "NEU", model: "neu", overwritePath: "b (transcript).md", knownBody: "ALT" },
    ]);
    expect(seen).not.toBeNull();
    expect(seen.diff).toEqual([{ kind: "del", text: "MANUELL BEARBEITET" }, { kind: "add", text: "NEU" }]);
    expect(r.results.map(x => x.path)).toEqual(["b (transcript).md"]);
    expect(notes.get("b (transcript).md")).toContain("NEU");
  });
  it("identischer Body (Erstberührung) → kein Callback, schreibt", async () => {
    const { io, notes } = fakeIO({ notes: [
      ["b (transcript).md", `---\ntranscribed_by: "alt"\n---\n![[b.png]]\n\nGLEICH`],
    ] });
    let called = false;
    io.confirmOverwrite = async () => { called = true; return "GLEICH"; };
    const r = await writeTranscripts(io, "q.md", [
      { raw: "![[b.png]]", link: "b.png", content: "GLEICH", model: "neu", overwritePath: "b (transcript).md" },
    ]);
    expect(called).toBe(false);
    expect(r.results.map(x => x.path)).toEqual(["b (transcript).md"]);
  });

  it("confirmOverwrite liefert gemergten Body → genau der wird geschrieben + zurückgegeben", async () => {
    const { io, notes } = fakeIO({ notes: [
      ["b (transcript).md", `---\ntranscribed_by: "alt"\n---\n![[b.png]]\n\nalt\nX\nc`],
    ] });
    io.confirmOverwrite = async () => "MERGED";
    const r = await writeTranscripts(io, "q.md", [
      { raw: "![[b.jpg]]", link: "b.jpg", content: "neu", model: "vm", overwritePath: "b (transcript).md" },
    ]);
    expect(r.results[0].path).toBe("b (transcript).md");
    expect(r.results[0].body).toBe("MERGED");
    expect(notes.get("b (transcript).md")).toContain("MERGED"); // rewriteTranscript hat MERGED als Body geschrieben
  });

  it("selfSource: schreibt unter destDir, kein source_note, kein Quell-Read/-Write", async () => {
    const reads: string[] = [];
    const { io, notes } = fakeIO({
      readNote: async (p: string) => { reads.push(p); return ""; },
    });
    const r = await writeTranscripts(io, "Anhänge/scan.png", [
      { raw: "", link: "scan.png", content: "Hallo", model: "vm", embed: false },
    ], { selfSource: true, destDir: "Transkripte" });

    expect(r.results.map(x => x.path)).toEqual(["Transkripte/scan (transcript).md"]);
    const note = notes.get("Transkripte/scan (transcript).md");
    expect(note).toContain('source_image: "[[scan.png]]"');
    expect(note).not.toContain("source_note");
    expect(reads).not.toContain("Anhänge/scan.png");   // Quelldatei nie gelesen
    expect(notes.has("Anhänge/scan.png")).toBe(false); // und nie geschrieben
  });
});

describe("writeDescriptions", () => {
  it("legt pro Eintrag eine Notiz an, kein Read/Write auf der Quelle, kein replaceEmbed", async () => {
    const { io, created, notes } = fakeIO({ notes: [["q.md", "a ![[foto.jpg]] b"]] });
    const r = await writeDescriptions(io, "q.md", [
      { link: "foto.jpg", category: "Diagramm", tags: ["arch"], prose: "Ein Diagramm.", model: "vm" },
    ]);
    expect(r.results.map(x => x.path)).toEqual(["foto (description).md"]);
    expect(created["foto (description).md"]).toContain("Ein Diagramm.");
    expect(created["foto (description).md"]).toContain('described_by: "vm"');
    expect(created["foto (description).md"]).toContain("![[foto.jpg]]");   // Bild-Embed in der Notiz (Karteikarte)
    expect(notes.get("q.md")).toBe("a ![[foto.jpg]] b");   // Quelle unangetastet (kein replaceEmbed)
  });
  it("leere prose → { path: null }, keine Notiz angelegt", async () => {
    const { io, created } = fakeIO({ notes: [["q.md", "![[foto.jpg]]"]] });
    const r = await writeDescriptions(io, "q.md", [
      { link: "foto.jpg", category: null, tags: [], prose: "   ", model: "vm" },
    ]);
    expect(r.results).toEqual([{ path: null }]);
    expect(Object.keys(created)).toEqual([]);
  });
  it("selfSource: schreibt unter destDir, kein source_note, kein Quell-Read/-Write", async () => {
    const reads: string[] = [];
    const { io, notes } = fakeIO({
      readNote: async (p: string) => { reads.push(p); return ""; },
    });
    const r = await writeDescriptions(io, "Anhänge/scan.png", [
      { link: "scan.png", category: null, tags: [], prose: "Hallo", model: "vm" },
    ], { selfSource: true, destDir: "Beschreibungen" });

    expect(r.results.map(x => x.path)).toEqual(["Beschreibungen/scan (description).md"]);
    const note = notes.get("Beschreibungen/scan (description).md");
    expect(note).toContain('source_image: "[[scan.png]]"');
    expect(note).not.toContain("source_note");
    expect(reads).not.toContain("Anhänge/scan.png");
    expect(notes.has("Anhänge/scan.png")).toBe(false);
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
  it("transkribiert nur Embeds, überspringt reine Links (Command/Kontextmenü ohne Idempotenz-Schutz)", async () => {
    const { io, created, notes } = fakeIO({ notes: [["q.md", "![[a.png]] siehe [[b.png]]"]] });
    const r = await runImgToMd(io, "q.md");
    expect(r.transcribed).toBe(1);
    expect(created["a (transcript).md"]).toBeDefined();
    expect(created["b (transcript).md"]).toBeUndefined();
    expect(notes.get("q.md")).toBe("![[a (transcript)]] siehe [[b.png]]");   // Embed ersetzt, reiner Link bleibt
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
  it("threadet opts.map: eigene Frontmatter-Keys statt DEFAULT_FM_MAP", async () => {
    const map = { ...DEFAULT_FM_MAP, sourceImage: "quelle_bild", kindKey: "type", kindTranscript: "📄 T" };
    const { io, created } = fakeIO({ notes: [["q.md", "![[foto.jpg]]"]] });
    await runImgToMd(io, "q.md", { map });
    const note = created["foto (transcript).md"];
    expect(note).toContain("quelle_bild:");
    expect(note).toContain("type: 📄 T");
    expect(note).not.toContain(`${DEFAULT_FM_MAP.sourceImage}:`);
  });
});

describe("classifySource", () => {
  it("Bild-Extensions → image", () => {
    expect(classifySource("png")).toBe("image");
    expect(classifySource("JPG")).toBe("image");
    expect(classifySource("heic")).toBe("image");
  });
  it("pdf → pdf", () => {
    expect(classifySource("pdf")).toBe("pdf");
    expect(classifySource("PDF")).toBe("pdf");
  });
  it("md/canvas/leer → null", () => {
    expect(classifySource("md")).toBeNull();
    expect(classifySource("canvas")).toBeNull();
    expect(classifySource("")).toBeNull();
  });
});

describe("rewriteTranscript", () => {
  it("erhält source_*/source_note/created, ersetzt transcribed_by + Body, kein doppeltes Frontmatter", () => {
    const old = `---\nsource_image: "[[b.png]]"\nsource_note: "[[Quelle]]"\ncreated: 2026-01-01\ntranscribed_by: "alt"\n---\n![[b.png]]\n\nALTER TEXT\n`;
    const out = rewriteTranscript(old, { model: "neu", sourceLink: "b.png", body: "NEUER TEXT" }, DEFAULT_FM_MAP);
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
  it("fügt KEIN kind hinzu (minimaler Eingriff, altes Frontmatter bleibt sonst unverändert)", () => {
    const old = `---\nsource_image: "[[b.png]]"\ncreated: 2026-01-01\ntranscribed_by: "alt"\n---\n![[b.png]]\n\nALT\n`;
    const out = rewriteTranscript(old, { model: "neu", sourceLink: "b.png", body: "NEU" }, DEFAULT_FM_MAP);
    expect(out).not.toContain("kind:");
  });
  it("ersetzt vorhandenes pages bei PDF-Override", () => {
    const old = `---\nsource_pdf: "[[d.pdf]]"\ncreated: 2026-01-01\ntranscribed_by: "alt"\npages: "1-2"\n---\n![[d.pdf]]\n\nX\n`;
    const out = rewriteTranscript(old, { model: "neu", sourceLink: "d.pdf", body: "Y", pages: "1-5" }, DEFAULT_FM_MAP);
    expect(out).toContain('pages: "1-5"');
    expect(out).not.toContain('pages: "1-2"');
  });
  it("CRLF-Notiz: erhält Frontmatter trotz \\r\\n (kein Datenverlust)", () => {
    const old = `---\r\nsource_image: "[[b.png]]"\r\nsource_note: "[[Quelle]]"\r\ncreated: 2026-01-01\r\ntranscribed_by: "alt"\r\n---\r\n![[b.png]]\r\n\r\nALTER TEXT\r\n`;
    const out = rewriteTranscript(old, { model: "neu", sourceLink: "b.png", body: "NEUER TEXT" }, DEFAULT_FM_MAP);
    expect(out).toContain('source_image: "[[b.png]]"');
    expect(out).toContain('source_note: "[[Quelle]]"');
    expect(out).toContain("created: 2026-01-01");
    expect(out).toContain('transcribed_by: "neu"');
    expect(out).not.toContain('transcribed_by: "alt"');
  });
  it("replaces the mapped author key (CRLF preserved)", () => {
    const old = `---\r\nsource_image: "[[i.png]]"\r\ntranscribed_by: "old"\r\n---\r\n![[i.png]]\r\n\r\nAlt`;
    const out = rewriteTranscript(old, { model: "new", sourceLink: "i.png", body: "Neu" }, DEFAULT_FM_MAP);
    expect(out).toContain(`transcribed_by: "new"`);
    expect(out).not.toContain(`"old"`);
  });
  it("honors a custom author key mapping", () => {
    const map = { ...DEFAULT_FM_MAP, authorTranscribed: "erfasst_von" };
    const old = `---\nsource_image: "[[i.png]]"\nerfasst_von: "old"\n---\n![[i.png]]\n\nAlt`;
    const out = rewriteTranscript(old, { model: "new", sourceLink: "i.png", body: "Neu" }, map);
    expect(out).toContain(`erfasst_von: "new"`);
    expect(out).not.toContain(`"old"`);
  });
});

describe("extractTranscriptBody", () => {
  it("strippt Frontmatter + Embed-Zeile, gibt reinen Body", () => {
    const note = `---\nsource_image: "[[b.png]]"\ntranscribed_by: "vm"\n---\n![[b.png]]\n\nZeile 1\nZeile 2\n`;
    expect(extractTranscriptBody(note)).toBe("Zeile 1\nZeile 2");
  });
  it("ohne Frontmatter → nur Embed-Zeile strippen", () => {
    expect(extractTranscriptBody(`![[b.png]]\n\nNur Text`)).toBe("Nur Text");
  });
  it("ohne Embed-Zeile → Body unverändert (getrimmt)", () => {
    expect(extractTranscriptBody(`Kein Embed hier\n`)).toBe("Kein Embed hier");
  });
  it("CRLF-Notiz: strippt Frontmatter + Embed-Zeile trotz \\r\\n", () => {
    const note = `---\r\nsource_image: "[[b.png]]"\r\ntranscribed_by: "vm"\r\n---\r\n![[b.png]]\r\n\r\nZeile 1\r\nZeile 2\r\n`;
    expect(extractTranscriptBody(note)).toBe("Zeile 1\r\nZeile 2");
  });
  it("Linter-Leerzeile zwischen Frontmatter und Embed → Embed trotzdem strippen", () => {
    // Obsidian-Linter fügt eine Leerzeile nach dem Frontmatter ein → Embed steht nicht mehr direkt danach.
    const note = `---\ntitle: X\nsource_pdf: "[[a/b/Safari.pdf]]"\n---\n\n![[a/b/Safari.pdf]]\n\n%% Seite 1 %%\n# V-MARKT\n`;
    expect(extractTranscriptBody(note)).toBe("%% Seite 1 %%\n# V-MARKT");
  });
  it("Linter-Leerzeile (CRLF) zwischen Frontmatter und Embed → Embed trotzdem strippen", () => {
    const note = `---\r\ntitle: X\r\nsource_pdf: "[[a/b/Safari.pdf]]"\r\n---\r\n\r\n![[a/b/Safari.pdf]]\r\n\r\n%% Seite 1 %%\r\n# V-MARKT\r\n`;
    expect(extractTranscriptBody(note)).toBe("%% Seite 1 %%\r\n# V-MARKT");
  });
});

describe("buildSelfSourceItem", () => {
  it("Bild → image-Item, supported, embed:false, selfSource:true", () => {
    const it = buildSelfSourceItem("Anhänge/scan.png", { pdfMaxPages: 20 });
    expect(it).toMatchObject({ kind: "image", link: "scan.png", ext: "png", supported: true, embed: false, selfSource: true, raw: "" });
  });
  it("HEIC → image-Item, supported:false", () => {
    expect(buildSelfSourceItem("foto.heic", { pdfMaxPages: 20 })?.supported).toBe(false);
  });
  it("PDF → pdf-Item mit pageCount/range, range to auf pdfMaxPages gekappt", () => {
    const it = buildSelfSourceItem("doc.pdf", { pageCount: 50, pdfMaxPages: 20 });
    expect(it).toMatchObject({ kind: "pdf", supported: true, pageCount: 50, range: { from: 1, to: 20 }, selfSource: true });
  });
  it("PDF ohne lesbare Seiten → supported:false, range to:1", () => {
    const it = buildSelfSourceItem("doc.pdf", { pageCount: 0, pdfMaxPages: 20 });
    expect(it).toMatchObject({ supported: false, range: { from: 1, to: 1 } });
  });
  it("existingTranscriptPath wird durchgereicht", () => {
    const it = buildSelfSourceItem("scan.png", { pdfMaxPages: 20, existingTranscriptPath: "scan (transcript).md" });
    expect(it?.existingTranscriptPath).toBe("scan (transcript).md");
  });
  it("Nicht-Medien-Datei → null", () => {
    expect(buildSelfSourceItem("note.md", { pdfMaxPages: 20 })).toBeNull();
    expect(buildSelfSourceItem("board.canvas", { pdfMaxPages: 20 })).toBeNull();
  });
});

describe("basename", () => {
  it("letztes Segment mit Extension", () => {
    expect(basename("a/b/scan.png")).toBe("scan.png");
    expect(basename("scan.pdf")).toBe("scan.pdf");
  });
});

describe("truncateMiddle", () => {
  it("lässt Namen <= max unverändert", () => {
    expect(truncateMiddle("foto.png", 20)).toBe("foto.png");
    expect(truncateMiddle("foto.png", 8)).toBe("foto.png");   // genau max
  });
  it("kürzt lange Namen mittig: Gesamtlänge = max, Ellipsis enthalten, Endung bleibt", () => {
    const long = "9E894F8A-1C01-4CCF-96C9-AAB2A290C2CB.jpeg";   // 42 Zeichen
    const r = truncateMiddle(long, 24);
    expect(r.length).toBe(24);
    expect(r).toContain("…");
    expect(r.startsWith("9E894F8A")).toBe(true);
    expect(r.endsWith(".jpeg")).toBe(true);
  });
  it("Edge: max <= 1 ergibt nur die Ellipsis", () => {
    expect(truncateMiddle("abcdef", 1)).toBe("…");
  });
});
