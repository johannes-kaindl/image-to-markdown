import { describe, it, expect } from "vitest";
import { diffLines, groupHunks, applySelection, DiffLine } from "../src/diff";

describe("diffLines", () => {
  it("identischer Text → nur ctx", () => {
    expect(diffLines("a\nb", "a\nb")).toEqual<DiffLine[]>([
      { kind: "ctx", text: "a" }, { kind: "ctx", text: "b" },
    ]);
  });
  it("reine Addition am Ende", () => {
    expect(diffLines("a", "a\nb")).toEqual<DiffLine[]>([
      { kind: "ctx", text: "a" }, { kind: "add", text: "b" },
    ]);
  });
  it("reine Löschung", () => {
    expect(diffLines("a\nb", "a")).toEqual<DiffLine[]>([
      { kind: "ctx", text: "a" }, { kind: "del", text: "b" },
    ]);
  });
  it("Ersetzung = del + add", () => {
    expect(diffLines("a\nX\nc", "a\nY\nc")).toEqual<DiffLine[]>([
      { kind: "ctx", text: "a" }, { kind: "del", text: "X" }, { kind: "add", text: "Y" }, { kind: "ctx", text: "c" },
    ]);
  });
  it("leerer alter Text → alles add", () => {
    expect(diffLines("", "a\nb")).toEqual<DiffLine[]>([
      { kind: "add", text: "a" }, { kind: "add", text: "b" },
    ]);
  });
  it("leerer neuer Text → alles del", () => {
    expect(diffLines("a\nb", "")).toEqual<DiffLine[]>([
      { kind: "del", text: "a" }, { kind: "del", text: "b" },
    ]);
  });
});

describe("groupHunks", () => {
  it("leerer Diff → keine Hunks", () => {
    expect(groupHunks([])).toEqual([]);
  });
  it("nur ctx → keine Hunks", () => {
    expect(groupHunks(diffLines("a\nb", "a\nb"))).toEqual([]);
  });
  it("ein Replace-Block (del+add zusammenhängend) → 1 Hunk", () => {
    const d = diffLines("a\nX\nc", "a\nY\nc"); // ctx a, del X, add Y, ctx c
    const h = groupHunks(d);
    expect(h.length).toBe(1);
    expect(h[0].startIndex).toBe(1);
    expect(h[0].lines).toEqual([{ kind: "del", text: "X" }, { kind: "add", text: "Y" }]);
  });
  it("zwei durch ctx getrennte Hunks → 2", () => {
    const d = diffLines("a\nX\nc\nZ", "a\nY\nc\nW"); // del X/add Y, ctx c, del Z/add W
    expect(groupHunks(d).length).toBe(2);
  });
});

describe("applySelection", () => {
  it("alle true → neuer Body", () => {
    const d = diffLines("a\nX\nc", "a\nY\nc");
    expect(applySelection(d, [true])).toBe("a\nY\nc");
  });
  it("alle false → alter Body", () => {
    const d = diffLines("a\nX\nc", "a\nY\nc");
    expect(applySelection(d, [false])).toBe("a\nX\nc");
  });
  it("fehlende Auswahl gilt als true", () => {
    const d = diffLines("a\nX\nc", "a\nY\nc");
    expect(applySelection(d, [])).toBe("a\nY\nc");
  });
  it("gemischte Auswahl: Hunk 1 an, Hunk 2 ab", () => {
    const d = diffLines("a\nX\nc\nZ", "a\nY\nc\nW");
    // Hunk1 (X→Y) an → Y; Hunk2 (Z→W) ab → Z behalten
    expect(applySelection(d, [true, false])).toBe("a\nY\nc\nZ");
  });
  it("reiner Add-Hunk: an → rein, ab → weg", () => {
    const d = diffLines("a", "a\nb"); // ctx a, add b
    expect(applySelection(d, [true])).toBe("a\nb");
    expect(applySelection(d, [false])).toBe("a");
  });
  it("reiner Del-Hunk: an → weg, ab → behalten", () => {
    const d = diffLines("a\nb", "a"); // ctx a, del b
    expect(applySelection(d, [true])).toBe("a");
    expect(applySelection(d, [false])).toBe("a\nb");
  });
  it("leerer Diff → leerer String", () => {
    expect(applySelection([], [])).toBe("");
  });
});
