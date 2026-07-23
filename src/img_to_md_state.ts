import { t } from "./i18n";
import type { ParsedDescription } from "./describe";
import type { RefineStep } from "./refine";

export interface ImgItem {
  raw: string;
  link: string;
  ext: string;
  supported: boolean;
  kind: "image" | "pdf";
  pageCount?: number;
  range?: { from: number; to: number };
  existingTranscriptPath?: string;
  existingDescriptionPath?: string;
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
  mode?: "transcript" | "description";
  category?: string | null;
  tags?: string[];
  /** In-Session-Nachbesserungs-Verlauf (#7). base = Original-Version, steps = je Runde
   *  Feedback + Ergebnis. Aktuelle Version = card.text (Spiegel). Reitet auf dem CardCache. */
  refine?: { base: string; steps: RefineStep[] };
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

  setDescribed(i: number, parsed: ParsedDescription, model: string): void {
    const c = this.cards[i]; if (!c) return;
    c.text = parsed.prose;
    c.category = parsed.category;
    c.tags = parsed.tags;
    c.mode = "description";
    c.model = model;
    if (parsed.prose.trim()) c.status = "done";
    else { c.status = "error"; c.error = t("core.emptyTranscript"); }
  }

  setError(i: number, msg: string): void { const c = this.cards[i]; if (c) { c.status = "error"; c.error = msg; } }
  markWritten(i: number, path: string): void { const c = this.cards[i]; if (c) { c.status = "written"; c.writtenPath = path; } }
  /** Setzt eine Karte für einen Retry zurück: leert Inhalt/Modell/Fehler, Status → streaming. */
  resetCard(i: number): void {
    const c = this.cards[i]; if (!c) return;
    c.text = ""; c.reasoning = ""; c.model = ""; c.status = "streaming"; c.error = undefined; c.writtenPath = undefined;
  }
  /** Committet eine erfolgreiche Nachbesserung: setzt beim ersten Mal die Basis (die vorige
   *  Version — card.text wurde während des Streamens NICHT mutiert, siehe View-Draft), hängt
   *  {feedback, text} an und macht die neue Version zur aktuellen. Status → done, damit eine
   *  zuvor geschriebene Karte erneut geschrieben werden kann (writtenPath bleibt für Idempotenz). */
  commitRefine(i: number, feedback: string, text: string): void {
    const c = this.cards[i]; if (!c) return;
    if (!c.refine) c.refine = { base: c.text, steps: [] };
    c.refine.steps.push({ feedback, text });
    c.text = text;
    c.status = "done";
  }

  /** Ein Schritt zurück: entfernt die letzte Runde, stellt die vorige Version her. Ohne Steps
   *  wird refine ganz entfernt (Text = Basis). Status bleibt done (erneut schreibbar). */
  undoRefine(i: number): void {
    const c = this.cards[i]; const r = c?.refine; if (!c || !r || !r.steps.length) return;
    r.steps.pop();
    c.text = r.steps.length ? r.steps[r.steps.length - 1].text : r.base;
    c.status = "done";
    if (!r.steps.length) c.refine = undefined;
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

/** Ob eine Karte nachbesserbar ist (#7): Transkript-Karte (nicht Beschreiben) mit fertigem
 *  bzw. geschriebenem Ergebnis. Streaming/Fehler-Karten sind es nicht. */
export function canRefine(card: ImgCard): boolean {
  return card.mode !== "description" && (card.status === "done" || card.status === "written");
}

/** Ob ein Zurück-Schritt möglich ist: mindestens eine committete Nachbesserung. */
export function canUndo(card: ImgCard): boolean {
  return !!card.refine && card.refine.steps.length >= 1;
}

export interface PdfGroup {
  raw: string; link: string; item: ImgItem; cardIndices: number[];
  pages: { page: number; content: string; model: string }[];
  failedPages: number[];   // Seiten mit error-Status (für sichtbare Platzhalter in der Notiz)
  pending: boolean;        // mind. eine Seite streamt noch → Schreiben aufschieben
  range: { from: number; to: number };   // tatsächlich GELAUFENER Bereich (aus den Karten), NICHT item.range
}

/** Gruppiert Karten: Bilder einzeln (done), PDF-Seiten nach embed-link (raw). `pages` enthält nur
 *  done-Seiten; `failedPages`/`pending` erfassen fehlgeschlagene bzw. noch laufende Seiten, damit die
 *  zusammengeführte Notiz ehrlich bleibt (kein stiller Gap). `range` = min/max der Karten-Seiten,
 *  also der beim Lauf tatsächlich gewählte Bereich — bewusst NICHT `item.range`, das vom Range-Eingabe-
 *  feld jederzeit live mutiert wird (sonst Datenverlust bei Range-Edit nach dem Lauf). Behält Indizes.
 *  Beschreiben-Karten (`mode === "description"`) fließen NICHT ein — sie gehören zum separaten
 *  writeDescriptions-Pfad (eigene Notiz-Form, kein Transkript-Merge). */
export function partitionDoneCards(cards: ImgCard[]): {
  images: { card: ImgCard; cardIndex: number }[];
  pdfs: PdfGroup[];
} {
  const images: { card: ImgCard; cardIndex: number }[] = [];
  const pdfMap = new Map<string, PdfGroup>();
  const ensurePdf = (card: ImgCard): PdfGroup => {
    let g = pdfMap.get(card.item.raw);
    if (!g) { const pg = card.page ?? 1; g = { raw: card.item.raw, link: card.item.link, item: card.item, cardIndices: [], pages: [], failedPages: [], pending: false, range: { from: pg, to: pg } }; pdfMap.set(card.item.raw, g); }
    return g;
  };
  // Refine-Seam (#7): written Schwesterseiten einer Gruppe separat sammeln (lokales Side-Map, NICHT
  // Teil von PdfGroup) — erst nach der Schleife und nur bei mind. einer done-Seite in g.pages einspielen.
  const writtenByRaw = new Map<string, { cardIndex: number; page: number; content: string; model: string }[]>();
  cards.forEach((card, cardIndex) => {
    // Beschreiben-Karten (Bild ODER PDF-Seite) fließen gar nicht erst in pdfMap/images ein — sonst
    // entstünde für eine done-PDF-Seite im Beschreiben-Modus eine leere PdfGroup (ensurePdf legt sie
    // sonst unconditional an), die zwar nie Seiten enthält, aber unnötig in `pdfs` auftaucht.
    if (card.mode === "description") return;
    if (card.item.kind === "pdf") {
      const g = ensurePdf(card);
      const pg = card.page ?? 1;
      if (pg < g.range.from) g.range.from = pg;
      if (pg > g.range.to) g.range.to = pg;
      if (card.status === "done") { g.cardIndices.push(cardIndex); g.pages.push({ page: pg, content: card.text, model: card.model }); }
      else if (card.status === "error") g.failedPages.push(pg);
      else if (card.status === "streaming") g.pending = true;
      else if (card.status === "written") {
        const arr = writtenByRaw.get(card.item.raw) ?? [];
        arr.push({ cardIndex, page: pg, content: card.text, model: card.model });
        writtenByRaw.set(card.item.raw, arr);
      }
    } else if (card.status === "done") {
      images.push({ card, cardIndex });
    }
  });
  // Refine-Seam (#7): eine PDF-Gruppe mit >=1 nachgebesserten (done) Seite + bereits geschriebenen
  // Schwesterseiten muss beim Re-Write vollständig bleiben — sonst füllt buildPdfBody die fehlenden
  // (written) Seiten mit "Seite fehlgeschlagen"-Platzhaltern (Datenverlust). Rein written Gruppen
  // (keine done-Seite) bleiben neutral (kein spuriöser Re-Write via "Alle anlegen").
  for (const [raw, written] of writtenByRaw) {
    const g = pdfMap.get(raw);
    if (g && g.pages.length) {
      for (const w of written) { g.cardIndices.push(w.cardIndex); g.pages.push({ page: w.page, content: w.content, model: w.model }); }
    }
  }
  return { images, pdfs: [...pdfMap.values()] };
}
