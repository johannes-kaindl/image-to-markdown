import { t } from "./i18n";
import type { ParsedDescription } from "./describe";
import { EMPTY_ROUNDS, pushRound, selectRound, refineBase, type Rounds } from "./vendor/kit/rounds";

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

/** Eine Version der Karte. rounds[0] ist das Original (feedback "", basedOn null), rounds[k] die k-te
 *  Nachbesserung; basedOn ist der Index der Version, auf der sie aufbaut (der aktive Stand beim Absenden). */
export interface RefineRound { feedback: string; text: string; reasoning: string; basedOn: number | null; }

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
  /** Antwort endete mit finish_reason "length" — am Token-Limit abgeschnitten, also unvollständig.
   *  Kein Fehler: der Teiltext bleibt verwendbar, die Karte weist nur darauf hin. */
  truncated?: boolean;
  writtenPath?: string;
  mode?: "transcript" | "description";
  category?: string | null;
  tags?: string[];
  /** In-Session-Nachbesserungs-Chat (#7 v2). base = Original-Transkription, rounds = je Runde
   *  Feedback + Ergebnis + Reasoning; active = kanonische Version (0 = Original, k = k-te Runde),
   *  gespiegelt in card.text. Reitet auf dem CardCache. */
  refine?: Rounds<RefineRound>;
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
  /** Der bisher gezeigte Text erwies sich als Denken (Gemma 4 ohne Öffner, Kit `onContentReset`): verwerfen. */
  resetContent(i: number): void { const c = this.cards[i]; if (c) c.text = ""; }

  setDone(i: number, finishReason?: string): void {
    const c = this.cards[i]; if (!c) return;
    const truncated = finishReason === "length";
    if (truncated) c.truncated = true;
    if (c.text.trim()) c.status = "done";
    // Leer UND abgeschnitten ist der haeufige Reasoning-Fall: das Denken hat das Antwortbudget
    // aufgebraucht. "Leeres Transkript" liest sich dann wie "nichts erkannt" und schickt die
    // Fehlersuche ans Bild statt ans Limit.
    else { c.status = "error"; c.error = t(truncated ? "core.truncatedEmpty" : "core.emptyTranscript"); }
  }

  setDescribed(i: number, parsed: ParsedDescription, model: string, finishReason?: string): void {
    const c = this.cards[i]; if (!c) return;
    const truncated = finishReason === "length";
    if (truncated) c.truncated = true;
    c.text = parsed.prose;
    c.category = parsed.category;
    c.tags = parsed.tags;
    c.mode = "description";
    c.model = model;
    if (parsed.prose.trim()) c.status = "done";
    else { c.status = "error"; c.error = t(truncated ? "core.truncatedEmpty" : "core.emptyTranscript"); }
  }

  setError(i: number, msg: string): void { const c = this.cards[i]; if (c) { c.status = "error"; c.error = msg; } }
  markWritten(i: number, path: string): void { const c = this.cards[i]; if (c) { c.status = "written"; c.writtenPath = path; } }
  /** Setzt eine Karte für einen Retry zurück: leert Inhalt/Modell/Fehler, Status → streaming. */
  resetCard(i: number): void {
    const c = this.cards[i]; if (!c) return;
    c.text = ""; c.reasoning = ""; c.model = ""; c.status = "streaming"; c.error = undefined; c.truncated = undefined; c.writtenPath = undefined;
  }
  /** Committet eine erfolgreiche Nachbesserung als neue Runde: legt beim ersten Mal das Original
   *  (die vorige card.text — während des Streamens nicht mutiert) als rounds[0] ab, hängt die Runde
   *  an (basedOn = der aktive Stand) und wählt sie. Status → done (written-Karte re-schreibbar,
   *  writtenPath bleibt). */
  commitRefineRound(i: number, feedback: string, text: string, reasoning: string): void {
    const c = this.cards[i]; if (!c) return;
    const prev = c.refine ?? pushRound(EMPTY_ROUNDS as Rounds<RefineRound>, { feedback: "", text: c.text, reasoning: "", basedOn: null });
    c.refine = pushRound(prev, { feedback, text, reasoning, basedOn: refineBase(prev) });
    c.text = text;
    c.status = "done";
  }

  /** Wählt die kanonische Version (0 = Original, k = k-te Runde) und spiegelt card.text. Ein
   *  ungültiger Index wird abgelehnt (Kit-Verhalten), nicht geklemmt. Status bleibt done. */
  selectRefineVersion(i: number, index: number): void {
    const c = this.cards[i]; const r = c?.refine; if (!c || !r) return;
    const next = selectRound(r, index);
    if (next === r) return;   // ungültig oder schon aktiv → kein Status-/Text-Flip
    c.refine = next;
    c.text = next.rounds[next.active].text;
    c.status = "done";
  }

  /** Karten-Indizes mit Fehlerstatus (für „Fehlgeschlagene erneut"). */
  failedCardIndices(): number[] { return this.cards.map((c, i) => ({ c, i })).filter(x => x.c.status === "error").map(x => x.i); }
  doneCardIndices(): number[] { return this.cards.map((c, i) => ({ c, i })).filter(x => x.c.status === "done").map(x => x.i); }
  clearCards(): void { this.cards = []; }
}

/** Was ein Nachbessern an das Modell schickt: das Original und die Kette vom aktiven Stand zurück
 *  (über basedOn). Eine Runde, die beim Zurückspringen übersprungen wurde, gehört nicht dazu. */
export function refineRequest(card: ImgCard): { base: string; steps: { feedback: string; text: string }[] } {
  const r = card.refine;
  if (!r) return { base: card.text, steps: [] };
  const steps: { feedback: string; text: string }[] = [];
  for (let k: number | null = r.active; k !== null && k > 0; k = r.rounds[k]?.basedOn ?? null) {
    steps.unshift({ feedback: r.rounds[k].feedback, text: r.rounds[k].text });
  }
  return { base: r.rounds[0].text, steps };
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
