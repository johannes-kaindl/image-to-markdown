import { describe, it, expect } from "vitest";
import { ThinkSplitter } from "../src/vendor/kit/think";

describe("ThinkSplitter", () => {
  it("Plaintext ohne Tags → alles content", () => {
    expect(new ThinkSplitter().push("hallo welt")).toEqual({ content: "hallo welt", reasoning: "" });
  });
  it("ganzer Block in einem push", () => {
    expect(new ThinkSplitter().push("a<think>b</think>c")).toEqual({ content: "ac", reasoning: "b" });
  });
  it("Text vor und zwischen Blöcken", () => {
    expect(new ThinkSplitter().push("intro<think>r</think>done")).toEqual({ content: "introdone", reasoning: "r" });
  });
  it("mehrere Blöcke", () => {
    expect(new ThinkSplitter().push("a<think>x</think>b<think>y</think>c")).toEqual({ content: "abc", reasoning: "xy" });
  });
  it("Tag über push-Grenzen gesplittet", () => {
    const s = new ThinkSplitter();
    const r1 = s.push("a<thi");
    const r2 = s.push("nk>b</thi");
    const r3 = s.push("nk>c");
    expect(r1).toEqual({ content: "a", reasoning: "" });
    expect(r2).toEqual({ content: "", reasoning: "b" });
    expect(r3).toEqual({ content: "c", reasoning: "" });
  });
  it("geöffnetes <think> ohne Close → reasoning", () => {
    expect(new ThinkSplitter().push("<think>noch am denken")).toEqual({ content: "", reasoning: "noch am denken" });
  });
  it("einzelnes < das kein Tag ist bleibt content", () => {
    const s = new ThinkSplitter();
    const r1 = s.push("a <");
    const r2 = s.push("b > c");
    expect(r1.content + r2.content).toBe("a <b > c");
    expect(r1.reasoning + r2.reasoning).toBe("");
  });
  it("flush gibt gepufferten Content-Rest am Ende zurück", () => {
    const s = new ThinkSplitter();
    expect(s.push("Ende <")).toEqual({ content: "Ende ", reasoning: "" });
    expect(s.flush()).toEqual({ content: "<", reasoning: "" });
  });
  it("flush nach offenem <think> gibt reasoning-Rest", () => {
    const s = new ThinkSplitter();
    expect(s.push("<think>denke</thi")).toEqual({ content: "", reasoning: "denke" });
    expect(s.flush()).toEqual({ content: "", reasoning: "</thi" });
  });
});
