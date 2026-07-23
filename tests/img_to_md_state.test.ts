import { describe, it, expect } from "vitest";
import { ImgToMdState, ImgItem, ImgCard, partitionDoneCards, actualModel, canRefine, canUndo } from "../src/img_to_md_state";

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
    expect(part.pdfs[0].failedPages).toEqual([]);
    expect(part.pdfs[0].pending).toBe(false);
  });

  it("partitionDoneCards erfasst fehlgeschlagene Seiten als failedPages (kein stiller Gap)", () => {
    const s = new ImgToMdState(); s.setItems([pdf]); s.startCards();   // 3 Seiten
    s.appendContent(0, "A"); s.setDone(0);
    s.setError(1, "Vision HTTP 500");        // Seite 2 fehlgeschlagen
    s.appendContent(2, "C"); s.setDone(2);
    const part = partitionDoneCards(s.cards);
    expect(part.pdfs[0].pages.map(p => p.page)).toEqual([1, 3]);   // nur done
    expect(part.pdfs[0].failedPages).toEqual([2]);
    expect(part.pdfs[0].pending).toBe(false);
    expect(part.pdfs[0].range).toEqual({ from: 1, to: 3 });        // GELAUFENER Bereich aus den Karten
  });

  it("partitionDoneCards markiert pending bei noch streamender Seite", () => {
    const s = new ImgToMdState(); s.setItems([pdf]); s.startCards();
    s.appendContent(0, "A"); s.setDone(0);   // Seite 1 done, 2+3 noch streaming
    const part = partitionDoneCards(s.cards);
    expect(part.pdfs[0].pending).toBe(true);
  });

  it("resetCard leert Inhalt/Fehler und setzt Status auf streaming", () => {
    const s = new ImgToMdState(); s.setItems(items); s.startCards();
    s.appendContent(0, "x"); s.setError(0, "boom");
    s.resetCard(0);
    expect(s.cards[0]).toMatchObject({ text: "", reasoning: "", model: "", status: "streaming" });
    expect(s.cards[0].error).toBeUndefined();
  });

  it("failedCardIndices liefert nur Fehler-Karten", () => {
    const s = new ImgToMdState(); s.setItems(items); s.startCards();   // a.png + b.jpg
    s.appendContent(0, "x"); s.setDone(0);
    s.setError(1, "boom");
    expect(s.failedCardIndices()).toEqual([1]);
  });
  it("setDescribed fills prose/category/tags and marks done", () => {
    const s = new ImgToMdState();
    s.setItems([{ raw: "", link: "i.png", ext: "png", supported: true, kind: "image" }]);
    s.startCards();
    s.setDescribed(0, { category: "Diagramm", tags: ["a"], prose: "Ein Diagramm." }, "m");
    expect(s.cards[0]).toMatchObject({ text: "Ein Diagramm.", category: "Diagramm", tags: ["a"], mode: "description", status: "done", model: "m" });
  });
  it("setDescribed with empty prose marks error", () => {
    const s = new ImgToMdState();
    s.setItems([{ raw: "", link: "i.png", ext: "png", supported: true, kind: "image" }]);
    s.startCards();
    s.setDescribed(0, { category: null, tags: [], prose: "  " }, "m");
    expect(s.cards[0].status).toBe("error");
  });
});

describe("ImgToMdState — PDF-Karten im Beschreiben-Modus", () => {
  const descPdf: ImgItem = { raw: "![[desc.pdf]]", link: "desc.pdf", ext: "pdf", supported: true, kind: "pdf", pageCount: 1, range: { from: 1, to: 1 } };
  const txPdf: ImgItem = { raw: "![[doc.pdf]]", link: "doc.pdf", ext: "pdf", supported: true, kind: "pdf", pageCount: 1, range: { from: 1, to: 1 } };

  it("partitionDoneCards schließt done PDF-Karten mit mode 'description' aus (kein Transkript-Merge); normale PDF-Karten laufen weiter über den Transkript-Pfad", () => {
    const cards: ImgCard[] = [
      { item: descPdf, index: 1, total: 2, page: 1, text: "Ein Foto in einem PDF.", reasoning: "", model: "m", status: "done", mode: "description", category: "Foto", tags: ["x"] },
      { item: txPdf, index: 2, total: 2, page: 1, text: "Transkribierter Text", reasoning: "", model: "m", status: "done" },
    ];
    const part = partitionDoneCards(cards);
    // Beschreiben-Karte darf keine PdfGroup erzeugen (separater writeDescriptions-Pfad, siehe Correctness-Fix).
    expect(part.pdfs.some(g => g.link === "desc.pdf")).toBe(false);
    // Normale PDF-Karte routet unverändert über den Transkript-Pfad.
    expect(part.pdfs.length).toBe(1);
    expect(part.pdfs[0].link).toBe("doc.pdf");
    expect(part.pdfs[0].pages.map(p => p.content)).toEqual(["Transkribierter Text"]);
    expect(part.images).toEqual([]);
  });
});

function mkCard(model: string): ImgCard {
  return { item: items[0], index: 1, total: 1, text: "x", reasoning: "", model, status: "done" };
}
describe("actualModel", () => {
  it("liefert das erste nicht-leere card.model", () => {
    expect(actualModel([mkCard(""), mkCard("mlx-vlm"), mkCard("other")])).toBe("mlx-vlm");
  });
  it("liefert \"\" wenn keine Karte ein Modell hat", () => {
    expect(actualModel([mkCard(""), mkCard("")])).toBe("");
  });
  it("liefert \"\" für leere Kartenliste", () => {
    expect(actualModel([])).toBe("");
  });
});

describe("ImgToMdState — Refine (#7)", () => {
  function doneCard(): ImgToMdState {
    const s = new ImgToMdState();
    s.setItems([{ raw: "![[a.png]]", link: "a.png", ext: "png", supported: true, kind: "image" }]);
    s.startCards();
    s.appendContent(0, "v0");
    s.setDone(0);   // status "done", text "v0", mode undefined (Transkript)
    return s;
  }

  it("commitRefine erste Runde: base=vorige Version, ein Step, text=neu, Status done", () => {
    const s = doneCard();
    s.commitRefine(0, "f1", "v1");
    expect(s.cards[0].refine).toEqual({ base: "v0", steps: [{ feedback: "f1", text: "v1" }] });
    expect(s.cards[0].text).toBe("v1");
    expect(s.cards[0].status).toBe("done");
  });

  it("commitRefine zweite Runde: base bleibt Original, Steps akkumulieren", () => {
    const s = doneCard();
    s.commitRefine(0, "f1", "v1");
    s.commitRefine(0, "f2", "v2");
    expect(s.cards[0].refine!.base).toBe("v0");
    expect(s.cards[0].refine!.steps).toEqual([{ feedback: "f1", text: "v1" }, { feedback: "f2", text: "v2" }]);
    expect(s.cards[0].text).toBe("v2");
  });

  it("undoRefine: ein Schritt zurück auf vorige Version", () => {
    const s = doneCard();
    s.commitRefine(0, "f1", "v1");
    s.commitRefine(0, "f2", "v2");
    s.undoRefine(0);
    expect(s.cards[0].text).toBe("v1");
    expect(s.cards[0].refine!.steps).toEqual([{ feedback: "f1", text: "v1" }]);
  });

  it("undoRefine bis zum Original: Text=base, refine entfernt", () => {
    const s = doneCard();
    s.commitRefine(0, "f1", "v1");
    s.undoRefine(0);
    expect(s.cards[0].text).toBe("v0");
    expect(s.cards[0].refine).toBeUndefined();
  });

  it("commitRefine auf written-Karte setzt Status zurück auf done (erneut schreibbar)", () => {
    const s = doneCard();
    s.markWritten(0, "note.md");
    expect(s.cards[0].status).toBe("written");
    s.commitRefine(0, "f1", "v1");
    expect(s.cards[0].status).toBe("done");
    expect(s.cards[0].writtenPath).toBe("note.md");   // Pfad bleibt für idempotentes Re-Write
  });

  it("canRefine: done/written-Transkript ja, Beschreiben-Karte nein, streaming nein", () => {
    const s = doneCard();
    expect(canRefine(s.cards[0])).toBe(true);
    s.markWritten(0, "n.md");
    expect(canRefine(s.cards[0])).toBe(true);
    const desc: ImgCard = { ...s.cards[0], status: "done", mode: "description" };
    expect(canRefine(desc)).toBe(false);
    const streaming: ImgCard = { ...s.cards[0], status: "streaming" };
    expect(canRefine(streaming)).toBe(false);
  });

  it("canUndo: nur mit mindestens einem Step", () => {
    const s = doneCard();
    expect(canUndo(s.cards[0])).toBe(false);
    s.commitRefine(0, "f1", "v1");
    expect(canUndo(s.cards[0])).toBe(true);
  });
});
