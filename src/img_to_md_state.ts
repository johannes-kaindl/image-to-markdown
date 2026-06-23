import { t } from "./i18n";

export interface ImgItem {
  raw: string;
  link: string;
  ext: string;
  supported: boolean;
  kind: "image" | "pdf";
  pageCount?: number;
  range?: { from: number; to: number };
}

export type CardStatus = "streaming" | "done" | "error" | "written";

export interface ImgCard {
  item: ImgItem;
  index: number;
  total: number;
  text: string;
  reasoning: string;
  model: string;
  status: CardStatus;
  page?: number;
  error?: string;
  writtenPath?: string;
}

/** Reine View-Buchhaltung für die IMG→MD-Sidebar: Bild-Auswahl + Ergebnis-Karten.
 *  Kein DOM, kein I/O — die View rendert daraus, das Wiring liefert die Daten. */
export class ImgToMdState {
  items: ImgItem[] = [];
  cards: ImgCard[] = [];
  private selected = new Set<string>();   // nach link

  setItems(items: ImgItem[]): void {
    this.items = items;
    this.selected = new Set(items.filter(i => i.supported).map(i => i.link));
  }

  isSelected(link: string): boolean { return this.selected.has(link); }

  toggle(link: string): void {
    const it = this.items.find(i => i.link === link);
    if (!it || !it.supported) return;
    if (this.selected.has(link)) this.selected.delete(link); else this.selected.add(link);
  }

  private supported(): ImgItem[] { return this.items.filter(i => i.supported); }

  allSelected(): boolean {
    const s = this.supported();
    return s.length > 0 && s.every(i => this.selected.has(i.link));
  }

  toggleAll(): void {
    if (this.allSelected()) this.selected.clear();
    else this.selected = new Set(this.supported().map(i => i.link));
  }

  selectedItems(): ImgItem[] { return this.supported().filter(i => this.selected.has(i.link)); }

  startCards(): ImgCard[] {
    const sel = this.selectedItems();
    const units: { item: ImgItem; page?: number }[] = [];
    for (const item of sel) {
      if (item.kind === "pdf" && item.range) {
        for (let p = item.range.from; p <= item.range.to; p++) units.push({ item, page: p });
      } else {
        units.push({ item });
      }
    }
    this.cards = units.map((u, k) => ({
      item: u.item, page: u.page, index: k + 1, total: units.length,
      text: "", reasoning: "", model: "", status: "streaming",
    }));
    return this.cards;
  }

  appendContent(i: number, t: string): void { const c = this.cards[i]; if (c) c.text += t; }
  appendReasoning(i: number, t: string): void { const c = this.cards[i]; if (c) c.reasoning += t; }

  setDone(i: number): void {
    const c = this.cards[i]; if (!c) return;
    if (c.text.trim()) c.status = "done";
    else { c.status = "error"; c.error = t("core.emptyTranscript"); }
  }

  setError(i: number, msg: string): void { const c = this.cards[i]; if (c) { c.status = "error"; c.error = msg; } }
  markWritten(i: number, path: string): void { const c = this.cards[i]; if (c) { c.status = "written"; c.writtenPath = path; } }
  doneCardIndices(): number[] { return this.cards.map((c, i) => ({ c, i })).filter(x => x.c.status === "done").map(x => x.i); }
  clearCards(): void { this.cards = []; }
}

/** Gruppiert done-Karten: Bilder einzeln, PDF-Seiten nach embed-link (raw). Behält Karten-Indizes. */
export function partitionDoneCards(cards: ImgCard[]): {
  images: { card: ImgCard; cardIndex: number }[];
  pdfs: { raw: string; link: string; item: ImgItem; cardIndices: number[]; pages: { page: number; content: string; model: string }[] }[];
} {
  const images: { card: ImgCard; cardIndex: number }[] = [];
  const pdfMap = new Map<string, { raw: string; link: string; item: ImgItem; cardIndices: number[]; pages: { page: number; content: string; model: string }[] }>();
  cards.forEach((card, cardIndex) => {
    if (card.status !== "done") return;
    if (card.item.kind === "pdf") {
      let g = pdfMap.get(card.item.raw);
      if (!g) { g = { raw: card.item.raw, link: card.item.link, item: card.item, cardIndices: [], pages: [] }; pdfMap.set(card.item.raw, g); }
      g.cardIndices.push(cardIndex);
      g.pages.push({ page: card.page ?? 1, content: card.text, model: card.model });
    } else {
      images.push({ card, cardIndex });
    }
  });
  return { images, pdfs: [...pdfMap.values()] };
}
