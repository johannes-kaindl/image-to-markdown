import { describe, it, expect } from "vitest";
import { findExistingTranscript, BacklinkLookup } from "../src/backlinks";

function lookup(o: Partial<BacklinkLookup> = {}): BacklinkLookup {
  return {
    resolvedLinks: o.resolvedLinks ?? {},
    frontmatterLinks: o.frontmatterLinks ?? (() => []),
    resolveLink: o.resolveLink ?? (() => null),
  };
}

describe("findExistingTranscript", () => {
  it("findet Notiz, deren source_pdf-Frontmatter auf die Quelle zeigt", () => {
    const l = lookup({
      resolvedLinks: { "doc (PDF-Transkript).md": { "doc.pdf": 1 } },
      frontmatterLinks: (n) => n === "doc (PDF-Transkript).md" ? [{ key: "source_pdf", link: "doc.pdf" }] : [],
      resolveLink: (link) => link === "doc.pdf" ? "doc.pdf" : null,
    });
    expect(findExistingTranscript(l, "doc.pdf")).toBe("doc (PDF-Transkript).md");
  });
  it("ignoriert Notiz, die die Quelle nur im Body embeddet (kein source_*-Frontmatter)", () => {
    const l = lookup({
      resolvedLinks: { "andere.md": { "doc.pdf": 1 } },
      frontmatterLinks: () => [],
      resolveLink: () => "doc.pdf",
    });
    expect(findExistingTranscript(l, "doc.pdf")).toBe(null);
  });
  it("behandelt Array-Key source_pdf.0", () => {
    const l = lookup({
      resolvedLinks: { "t.md": { "x.pdf": 1 } },
      frontmatterLinks: () => [{ key: "source_pdf.0", link: "x.pdf" }],
      resolveLink: () => "x.pdf",
    });
    expect(findExistingTranscript(l, "x.pdf")).toBe("t.md");
  });
  it("source_image analog", () => {
    const l = lookup({
      resolvedLinks: { "t.md": { "b.png": 1 } },
      frontmatterLinks: () => [{ key: "source_image", link: "b.png" }],
      resolveLink: () => "b.png",
    });
    expect(findExistingTranscript(l, "b.png")).toBe("t.md");
  });
  it("ignoriert fremde Frontmatter-Keys (z.B. up)", () => {
    const l = lookup({
      resolvedLinks: { "t.md": { "doc.pdf": 1 } },
      frontmatterLinks: () => [{ key: "up", link: "doc.pdf" }],
      resolveLink: () => "doc.pdf",
    });
    expect(findExistingTranscript(l, "doc.pdf")).toBe(null);
  });
  it("null wenn keine Notiz auf die Quelle verlinkt", () => {
    expect(findExistingTranscript(lookup(), "doc.pdf")).toBe(null);
  });
});
