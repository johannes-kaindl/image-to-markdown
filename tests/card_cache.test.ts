import { describe, it, expect } from "vitest";
import { CardCache } from "../src/card_cache";
import type { ImgCard } from "../src/img_to_md_state";

function card(text: string): ImgCard {
  return { item: { raw: "![[a.png]]", link: "a.png", ext: "png", supported: true, kind: "image" }, index: 0, total: 1, text, reasoning: "", model: "vm", status: "done" };
}

describe("CardCache", () => {
  it("save + load round-trip", () => {
    const c = new CardCache(); const cs = [card("A")];
    c.save("a.md", cs);
    expect(c.load("a.md")).toBe(cs);
  });
  it("save mit leerem Array entfernt den Eintrag", () => {
    const c = new CardCache();
    c.save("a.md", [card("A")]);
    c.save("a.md", []);
    expect(c.load("a.md")).toBeUndefined();
  });
  it("clear entfernt den Eintrag", () => {
    const c = new CardCache();
    c.save("a.md", [card("A")]);
    c.clear("a.md");
    expect(c.load("a.md")).toBeUndefined();
  });
  it("unbekannter Pfad → undefined", () => {
    expect(new CardCache().load("x.md")).toBeUndefined();
  });
  it("verschiedene Pfade sind unabhängig", () => {
    const c = new CardCache();
    c.save("a.md", [card("A")]); c.save("b.md", [card("B")]);
    expect(c.load("a.md")?.[0].text).toBe("A");
    expect(c.load("b.md")?.[0].text).toBe("B");
  });
});
