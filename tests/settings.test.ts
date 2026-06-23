import { describe, it, expect } from "vitest";
import { defaultSettings } from "../src/settings";

describe("defaultSettings", () => {
  it("enthält PDF-Defaults", () => {
    const s = defaultSettings();
    expect(s.pdfMaxPages).toBe(25);
    expect(s.pdfRenderScale).toBe(2.0);
    expect(s.pdfPageSeparator).toBe("comment");
  });
});
