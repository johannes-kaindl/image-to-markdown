import { describe, it, expect } from "vitest";
import { diffLines, DiffLine } from "../src/diff";

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
