import { describe, it, expect } from "vitest";
import { ImgToMdState, ImgItem, partitionDoneCards } from "../src/img_to_md_state";

const items: ImgItem[] = [
  { raw: "![[a.png]]", link: "a.png", ext: "png", supported: true, kind: "image" },
  { raw: "![[b.jpg]]", link: "b.jpg", ext: "jpg", supported: true, kind: "image" },
  { raw: "![[c.heic]]", link: "c.heic", ext: "heic", supported: false, kind: "image" },
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
    expect(s2.cards[0].error).toBe("Empty transcript");
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

describe("ImgToMdState — vorhandenes Transkript", () => {
  const withTx: ImgItem = { raw: "![[b.png]]", link: "b.png", ext: "png", supported: true, kind: "image", existingTranscriptPath: "b (transcript).md" };
  const without: ImgItem = { raw: "![[a.png]]", link: "a.png", ext: "png", supported: true, kind: "image" };
  it("setItems wählt Items mit vorhandenem Transkript NICHT vor", () => {
    const s = new ImgToMdState(); s.setItems([without, withTx]);
    expect(s.isSelected("a.png")).toBe(true);
    expect(s.isSelected("b.png")).toBe(false);
  });
  it("toggle aktiviert ein Item mit Transkript trotzdem (Override opt-in)", () => {
    const s = new ImgToMdState(); s.setItems([withTx]);
    s.toggle("b.png");
    expect(s.isSelected("b.png")).toBe(true);
  });
});

describe("ImgToMdState — PDF-Karten", () => {
  const pdf: ImgItem = { raw: "![[doc.pdf]]", link: "doc.pdf", ext: "pdf", supported: true, kind: "pdf", pageCount: 3, range: { from: 1, to: 3 } };

  it("startCards expandiert ein PDF zu einer Karte je Seite im Bereich", () => {
    const s = new ImgToMdState(); s.setItems([pdf]);
    const cards = s.startCards();
    expect(cards.length).toBe(3);
    expect(cards.map(c => c.page)).toEqual([1, 2, 3]);
    expect(cards.map(c => c.index)).toEqual([1, 2, 3]);
    expect(cards[0].total).toBe(3);
  });

  it("Teilbereich expandiert nur die gewählten Seiten", () => {
    const s = new ImgToMdState();
    s.setItems([{ ...pdf, range: { from: 2, to: 3 } }]);
    expect(s.startCards().map(c => c.page)).toEqual([2, 3]);
  });

  it("partitionDoneCards gruppiert PDF-Seiten nach link, Bilder einzeln", () => {
    const s = new ImgToMdState();
    s.setItems([items[0], pdf]);   // a.png + doc.pdf(3 Seiten) → 4 Karten
    s.startCards();
    s.cards.forEach((_, i) => { s.appendContent(i, `t${i}`); s.setDone(i); });
    const part = partitionDoneCards(s.cards);
    expect(part.images.map(x => x.card.item.link)).toEqual(["a.png"]);
    expect(part.pdfs.length).toBe(1);
    expect(part.pdfs[0].link).toBe("doc.pdf");
    expect(part.pdfs[0].pages.map(p => p.page)).toEqual([1, 2, 3]);
    expect(part.pdfs[0].cardIndices.length).toBe(3);
  });
});
