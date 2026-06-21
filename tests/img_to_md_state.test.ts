import { describe, it, expect } from "vitest";
import { ImgToMdState, ImgItem } from "../src/img_to_md_state";

const items: ImgItem[] = [
  { raw: "![[a.png]]", link: "a.png", ext: "png", supported: true },
  { raw: "![[b.jpg]]", link: "b.jpg", ext: "jpg", supported: true },
  { raw: "![[c.heic]]", link: "c.heic", ext: "heic", supported: false },
];

describe("ImgToMdState — Auswahl", () => {
  it("setItems wählt alle unterstützten an, keine unsupported", () => {
    const s = new ImgToMdState(); s.setItems(items);
    expect(s.isSelected("a.png")).toBe(true);
    expect(s.isSelected("b.jpg")).toBe(true);
    expect(s.isSelected("c.heic")).toBe(false);
    expect(s.allSelected()).toBe(true);
  });
  it("toggle kippt unterstützte, ignoriert unsupported", () => {
    const s = new ImgToMdState(); s.setItems(items);
    s.toggle("a.png");
    expect(s.isSelected("a.png")).toBe(false);
    expect(s.allSelected()).toBe(false);
    s.toggle("c.heic");
    expect(s.isSelected("c.heic")).toBe(false);
  });
  it("toggleAll: alle an → alle aus → alle an (nur unterstützte)", () => {
    const s = new ImgToMdState(); s.setItems(items);
    s.toggleAll();
    expect(s.selectedItems()).toEqual([]);
    s.toggleAll();
    expect(s.selectedItems().map(i => i.link)).toEqual(["a.png", "b.jpg"]);
  });
});

describe("ImgToMdState — Karten", () => {
  it("startCards erzeugt Karten für die Auswahl mit index/total", () => {
    const s = new ImgToMdState(); s.setItems(items);
    s.toggle("b.jpg");   // nur a.png ausgewählt
    const cards = s.startCards();
    expect(cards.length).toBe(1);
    expect(cards[0]).toMatchObject({ index: 1, total: 1, status: "streaming", text: "", reasoning: "" });
    expect(cards[0].item.link).toBe("a.png");
  });
  it("append akkumuliert content + reasoning", () => {
    const s = new ImgToMdState(); s.setItems(items); s.startCards();
    s.appendContent(0, "Hal"); s.appendContent(0, "lo");
    s.appendReasoning(0, "weil");
    expect(s.cards[0].text).toBe("Hallo");
    expect(s.cards[0].reasoning).toBe("weil");
  });
  it("setDone: nicht-leer → done, leer → error 'Leeres Transkript'", () => {
    const s = new ImgToMdState(); s.setItems(items); s.startCards();
    s.appendContent(0, "x"); s.setDone(0);
    expect(s.cards[0].status).toBe("done");
    const s2 = new ImgToMdState(); s2.setItems(items); s2.startCards();
    s2.appendContent(0, "   "); s2.setDone(0);
    expect(s2.cards[0].status).toBe("error");
    expect(s2.cards[0].error).toBe("Leeres Transkript");
  });
  it("setError + markWritten setzen Status", () => {
    const s = new ImgToMdState(); s.setItems(items); s.startCards();
    s.setError(0, "Vision HTTP 500");
    expect(s.cards[0]).toMatchObject({ status: "error", error: "Vision HTTP 500" });
    s.markWritten(0, "foto.md");
    expect(s.cards[0]).toMatchObject({ status: "written", writtenPath: "foto.md" });
  });
  it("doneCardIndices liefert nur done-Karten", () => {
    const s = new ImgToMdState();
    // beide unterstützten Items ausgewählt → 2 Karten
    s.setItems(items); s.startCards();
    expect(s.cards.length).toBe(2);
    s.appendContent(0, "x"); s.setDone(0);
    s.appendContent(1, "y"); s.setDone(1);
    s.markWritten(1, "b.md");
    expect(s.doneCardIndices()).toEqual([0]);
  });
  it("clearCards leert die Karten", () => {
    const s = new ImgToMdState(); s.setItems(items); s.startCards();
    s.clearCards();
    expect(s.cards).toEqual([]);
  });
});
