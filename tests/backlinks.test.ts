import { describe, it, expect } from "vitest";
import { findExistingTranscript, findExistingDescription, BacklinkLookup } from "../src/backlinks";
import { DEFAULT_FM_MAP } from "../src/frontmatter_map";

function makeLookup(notePath: string, sourcePath: string, kind: string | null, sourceKey = "source_image"): BacklinkLookup {
  return {
    resolvedLinks: { [notePath]: { [sourcePath]: 1 } },
    frontmatterLinks: (n) => n === notePath ? [{ key: sourceKey, link: "img.png" }] : [],
    resolveLink: () => sourcePath,
    frontmatterValue: (n, k) => (n === notePath && k === "kind") ? kind : null,
  };
}

function lookup(o: Partial<BacklinkLookup> = {}): BacklinkLookup {
  return {
    resolvedLinks: o.resolvedLinks ?? {},
    frontmatterLinks: o.frontmatterLinks ?? (() => []),
    resolveLink: o.resolveLink ?? (() => null),
    frontmatterValue: o.frontmatterValue ?? (() => null),
  };
}

describe("findExistingTranscript", () => {
  it("findet Notiz, deren source_pdf-Frontmatter auf die Quelle zeigt", () => {
    const l = lookup({
      resolvedLinks: { "doc (PDF-Transkript).md": { "doc.pdf": 1 } },
      frontmatterLinks: (n) => n === "doc (PDF-Transkript).md" ? [{ key: "source_pdf", link: "doc.pdf" }] : [],
      resolveLink: (link) => link === "doc.pdf" ? "doc.pdf" : null,
      frontmatterValue: () => null,
    });
    expect(findExistingTranscript(l, "doc.pdf", DEFAULT_FM_MAP)).toBe("doc (PDF-Transkript).md");
  });
  it("ignoriert Notiz, die die Quelle nur im Body embeddet (kein source_*-Frontmatter)", () => {
    const l = lookup({
      resolvedLinks: { "andere.md": { "doc.pdf": 1 } },
      frontmatterLinks: () => [],
      resolveLink: () => "doc.pdf",
      frontmatterValue: () => null,
    });
    expect(findExistingTranscript(l, "doc.pdf", DEFAULT_FM_MAP)).toBe(null);
  });
  it("behandelt Array-Key source_pdf.0", () => {
    const l = lookup({
      resolvedLinks: { "t.md": { "x.pdf": 1 } },
      frontmatterLinks: () => [{ key: "source_pdf.0", link: "x.pdf" }],
      resolveLink: () => "x.pdf",
      frontmatterValue: () => null,
    });
    expect(findExistingTranscript(l, "x.pdf", DEFAULT_FM_MAP)).toBe("t.md");
  });
  it("source_image analog", () => {
    const l = lookup({
      resolvedLinks: { "t.md": { "b.png": 1 } },
      frontmatterLinks: () => [{ key: "source_image", link: "b.png" }],
      resolveLink: () => "b.png",
      frontmatterValue: () => null,
    });
    expect(findExistingTranscript(l, "b.png", DEFAULT_FM_MAP)).toBe("t.md");
  });
  it("ignoriert fremde Frontmatter-Keys (z.B. up)", () => {
    const l = lookup({
      resolvedLinks: { "t.md": { "doc.pdf": 1 } },
      frontmatterLinks: () => [{ key: "up", link: "doc.pdf" }],
      resolveLink: () => "doc.pdf",
      frontmatterValue: () => null,
    });
    expect(findExistingTranscript(l, "doc.pdf", DEFAULT_FM_MAP)).toBe(null);
  });
  it("null wenn keine Notiz auf die Quelle verlinkt", () => {
    expect(findExistingTranscript(lookup(), "doc.pdf", DEFAULT_FM_MAP)).toBe(null);
  });

  it("findExistingTranscript ignores description notes; findExistingDescription finds them", () => {
    const lk = makeLookup("Desc.md", "img.png", "description");
    expect(findExistingTranscript(lk, "img.png", DEFAULT_FM_MAP)).toBeNull();
    expect(findExistingDescription(lk, "img.png", DEFAULT_FM_MAP)).toBe("Desc.md");
  });

  it("a note without kind counts as transcript", () => {
    const lk = makeLookup("T.md", "img.png", null);
    expect(findExistingTranscript(lk, "img.png", DEFAULT_FM_MAP)).toBe("T.md");
    expect(findExistingDescription(lk, "img.png", DEFAULT_FM_MAP)).toBeNull();
  });
});
