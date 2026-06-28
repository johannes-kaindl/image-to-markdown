import { t } from "./i18n";

export interface ImgItem {
  raw: string;
  link: string;
  ext: string;
  supported: boolean;
  kind: "image" | "pdf";
  pageCount?: number;
  range?: { from: number; to: number };
  existingTranscriptPath?: string;
  embed?: boolean;   // false = reiner Link (Quelltext bleibt); fehlt/true = Embed (heutiges Verhalten)
  selfSource?: boolean;   // true = die aktive Datei selbst ist die Quelle (embed dann immer false)
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
    this.selected = new Set(items.filter(i => i.supported && !i.existingTranscriptPath).map(i => i.link));
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
  /** Setzt eine Karte für einen Retry zurück: leert Inhalt/Modell/Fehler, Status → streaming. */
  resetCard(i: number): void {
    const c = this.cards[i]; if (!c) return;
    c.text = ""; c.reasoning = ""; c.model = ""; c.status = "streaming"; c.error = undefined; c.writtenPath = undefined;
  }
  /** Karten-Indizes mit Fehlerstatus (für „Fehlgeschlagene erneut"). */
  failedCardIndices(): number[] { return this.cards.map((c, i) => ({ c, i })).filter(x => x.c.status === "error").map(x => x.i); }
  doneCardIndices(): number[] { return this.cards.map((c, i) => ({ c, i })).filter(x => x.c.status === "done").map(x => x.i); }
  clearCards(): void { this.cards = []; }
}

/** Das tatsächlich verwendete Modell aus den Ergebnis-Karten: erstes nicht-leeres card.model.
 *  "" wenn keine Karte ein Modell meldet. Alle Karten eines Laufs stammen vom selben Backend. */
export function actualModel(cards: ImgCard[]): string {
  return cards.find(c => c.model)?.model ?? "";
}

export interface PdfGroup {
  raw: string; link: string; item: ImgItem; cardIndices: number[];
  pages: { page: number; content: string; model: string }[];
  failedPages: number[];   // Seiten mit error-Status (für sichtbare Platzhalter in der Notiz)
  pending: boolean;        // mind. eine Seite streamt noch → Schreiben aufschieben
}

/** Gruppiert Karten: Bilder einzeln (done), PDF-Seiten nach embed-link (raw). `pages` enthält nur
 *  done-Seiten; `failedPages`/`pending` erfassen fehlgeschlagene bzw. noch laufende Seiten, damit die
 *  zusammengeführte Notiz ehrlich bleibt (kein stiller Gap). Behält Karten-Indizes. */
export function partitionDoneCards(cards: ImgCard[]): {
  images: { card: ImgCard; cardIndex: number }[];
  pdfs: PdfGroup[];
} {
  const images: { card: ImgCard; cardIndex: number }[] = [];
  const pdfMap = new Map<string, PdfGroup>();
  const ensurePdf = (card: ImgCard): PdfGroup => {
    let g = pdfMap.get(card.item.raw);
    if (!g) { g = { raw: card.item.raw, link: card.item.link, item: card.item, cardIndices: [], pages: [], failedPages: [], pending: false }; pdfMap.set(card.item.raw, g); }
    return g;
  };
  cards.forEach((card, cardIndex) => {
    if (card.item.kind === "pdf") {
      const g = ensurePdf(card);
      if (card.status === "done") { g.cardIndices.push(cardIndex); g.pages.push({ page: card.page ?? 1, content: card.text, model: card.model }); }
      else if (card.status === "error") g.failedPages.push(card.page ?? 1);
      else if (card.status === "streaming") g.pending = true;
      // "written": bereits geschrieben → neutral (kein Re-Add, kein Fehler).
    } else if (card.status === "done") {
      images.push({ card, cardIndex });
    }
  });
  return { images, pdfs: [...pdfMap.values()] };
}
