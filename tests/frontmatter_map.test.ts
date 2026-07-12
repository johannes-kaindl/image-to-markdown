import { describe, it, expect } from "vitest";
import { DEFAULT_FM_MAP, type FrontmatterMap } from "../src/frontmatter_map";

describe("DEFAULT_FM_MAP", () => {
  it("matches today's hard-coded frontmatter keys (regression anchor)", () => {
    expect(DEFAULT_FM_MAP).toEqual({
      sourceImage: "source_image",
      sourcePdf: "source_pdf",
      sourceNote: "source_note",
      category: "category",
      tags: "tags",
      authorTranscribed: "transcribed_by",
      authorDescribed: "described_by",
      created: "created",
      pages: "pages",
      kindKey: "kind",
      kindTranscript: "transcript",
      kindDescription: "description",
    } satisfies FrontmatterMap);
  });
});
