import { ImgToMdIO, replaceEmbed, transcriptNotePath, basenameNoExt, rewriteTranscript, extractTranscriptBody } from "./img_to_md";
import { t } from "./i18n";
import { diffLines } from "./diff";
import { DEFAULT_FM_MAP, type FrontmatterMap } from "./frontmatter_map";

export interface PdfPageTranscript { page: number; text: string }

/** Mindest-Zeichen (Nicht-Whitespace) im Text-Layer, ab denen eine PDF-Seite als born-digital gilt
 *  und ihr exakter Text formatiert statt gerendert+OCR't wird. Darunter: Fallback aufs Vision-Modell. */
export const PDF_TEXTLAYER_MIN_CHARS = 200;

/** Nicht-Whitespace-Zeichen zählen (Schwellen-Check für den Text-Layer). Reine Funktion. */
export function countNonWhitespace(s: string): number { return s.replace(/\s/g, "").length; }

/** Rekonstruiert Lauftext aus pdf.js-Text-Items: Strings fügen, Zeilenumbruch bei hasEOL, Zeilen
 *  rechts-trimmen, ≥3 Newlines → Absatz, Gesamt-trim. Mehrspalten = best-effort (Item-Reihenfolge). Rein. */
export function reconstructPdfText(items: { str: string; hasEOL?: boolean }[]): string {
  let out = "";
  for (const it of items) { out += it.str ?? ""; if (it.hasEOL) out += "\n"; }
  return out.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Wie Seiten in der zusammengeführten Notiz getrennt werden. `comment` (Default) ist im
 *  Lesemodus unsichtbar und stört weder Outline noch Linter; `heading` injiziert ## Seite N. */
export type PdfPageSeparator = "comment" | "heading" | "rule" | "pagebreak" | "none";

/** Marker VOR jeder Seite (mit Seitennummer) — nur für comment/heading; sonst "". */
function pagePrefix(sep: PdfPageSeparator, page: number): string {
  if (sep === "comment") return `%% ${t("pdf.pageHeading", page)} %%\n\n`;
  if (sep === "heading") return `## ${t("pdf.pageHeading", page)}\n\n`;
  return "";
}

/** Trenner ZWISCHEN zwei Seiten — nur für rule/pagebreak; sonst nur eine Leerzeile. */
function pageGap(sep: PdfPageSeparator): string {
  if (sep === "rule") return "\n\n---\n\n";
  if (sep === "pagebreak") return "\n\n<div style=\"page-break-after:always\"></div>\n\n";
  return "\n\n";
}

/** Sichtbarer Platzhalter für eine fehlgeschlagene/fehlende Seite — markiert die Lücke ehrlich
 *  (statt sie still wegzulassen) und überlebt jeden Separator. */
function pageFailedMarker(page: number): string { return `**${t("pdf.pageFailed", page)}**`; }

/** Nur die Seiten-Blöcke (ohne Frontmatter/Embed), getrennt gemäß separator. Mit `range` wird über
 *  den **gewählten** Seitenbereich iteriert und jede fehlende Seite als sichtbarer Platzhalter
 *  eingefügt (kein stiller Gap); ohne `range` nur die Seiten mit Inhalt (Alt-Verhalten). */
export function buildPdfBody(pages: PdfPageTranscript[], separator: PdfPageSeparator, range?: { from: number; to: number }): string {
  if (range) {
    const byPage = new Map<number, string>();
    for (const p of pages) { const txt = p.text.trim(); if (txt) byPage.set(p.page, txt); }
    const blocks: string[] = [];
    for (let pg = range.from; pg <= range.to; pg++) {
      const content = byPage.get(pg) ?? pageFailedMarker(pg);
      blocks.push(`${pagePrefix(separator, pg)}${content}`);
    }
    return blocks.join(pageGap(separator));
  }
  return pages
    .filter(p => p.text.trim())
    .map(p => `${pagePrefix(separator, p.page)}${p.text.trim()}`)
    .join(pageGap(separator));
}

/** Baut die PDF-Transkript-Notiz: Frontmatter-Ref (aus `map`) + PDF-Embed oben + je nicht-leere
 *  Seite ein Block, getrennt gemäß `separator`. Additive `kind`-Zeile (map.kindKey/map.kindTranscript)
 *  nach source_note (bzw. source_pdf ohne sourceName). Mit `DEFAULT_FM_MAP` ist der Output
 *  byte-identisch zu vorher bis auf diese eine Zeile. */
export function buildPdfNote(o: {
  pdfLink: string; sourceName?: string; date: string; model: string;
  pages: PdfPageTranscript[]; rangeFrom: number; rangeTo: number;
  separator: PdfPageSeparator; range?: { from: number; to: number };
}, map: FrontmatterMap): string {
  const esc = (s: string) => s.replace(/"/g, '\\"');
  const fm = ["---", `${map.sourcePdf}: "[[${esc(o.pdfLink)}]]"`];
  if (o.sourceName !== undefined) fm.push(`${map.sourceNote}: "[[${esc(o.sourceName)}]]"`);
  fm.push(`${map.kindKey}: ${map.kindTranscript}`);
  fm.push(`${map.created}: ${o.date}`, `${map.authorTranscribed}: "${esc(o.model)}"`, `${map.pages}: "${o.rangeFrom}-${o.rangeTo}"`, "---");
  const frontmatter = fm.join("\n");
  const body = buildPdfBody(o.pages, o.separator, o.range);
  return `${frontmatter}\n![[${o.pdfLink}]]\n\n${body}\n`;
}

/** Schreibt EINE Standard-Notiz für ein PDF (alle nicht-leeren Seiten), ersetzt den PDF-Embed.
 *  Bei `overwritePath` gesetzt: überschreibt bestehende PDF-Notiz, keine Embed-Ersetzung.
 *  Bei `embed = false`: legt Notiz an, lässt aber den Quell-Link im Quelltext unverändert.
 *  Bei `opts.selfSource`: kein source_note, Ablage unter opts.destDir, pdfPath = sourcePath,
 *  kein replaceEmbed/Quell-Read. */
export async function writePdfTranscript(
  io: ImgToMdIO, sourcePath: string,
  source: { raw: string; link: string },
  pages: { page: number; content: string; model: string }[],
  separator: PdfPageSeparator,
  overwritePath?: string,
  embed = true,
  opts?: { selfSource?: boolean; destDir?: string; range?: { from: number; to: number }; knownBody?: string; map?: FrontmatterMap },
): Promise<{ path: string | null; body: string | null }> {
  const self = opts?.selfSource === true;
  const range = opts?.range;
  const map = opts?.map ?? DEFAULT_FM_MAP;
  const withContent = pages.filter(p => p.content.trim()).sort((a, b) => a.page - b.page);
  if (!withContent.length) return { path: null, body: null };   // alles leer/fehlgeschlagen → keine reine Platzhalter-Notiz
  const model = withContent.find(p => p.model)?.model ?? "";
  // pages:-Frontmatter aus der GEWÄHLTEN Range (ehrlich), sonst aus den vorhandenen Seiten (Alt-Verhalten).
  const rangeFrom = range ? range.from : withContent[0].page;
  const rangeTo = range ? range.to : withContent[withContent.length - 1].page;
  const pagesStr = `${rangeFrom}-${rangeTo}`;
  // Bei range alle Seiten durchreichen (buildPdfBody füllt Lücken mit Platzhaltern); sonst nur Inhalt.
  const bodyPages = (range ? pages : withContent).map(p => ({ page: p.page, text: p.content }));
  const body = buildPdfBody(bodyPages, separator, range);
  if (overwritePath) {
    const old = await io.readNote(overwritePath);
    const alreadyMatches = opts?.knownBody !== undefined && extractTranscriptBody(old) === opts.knownBody;
    let bodyToWrite = body.trim();
    if (!alreadyMatches && io.confirmOverwrite) {
      const diff = diffLines(extractTranscriptBody(old), body.trim());
      if (diff.some(d => d.kind !== "ctx")) {
        const chosen = await io.confirmOverwrite({ path: overwritePath, diff });
        if (chosen === null) { io.notify(t("notice.overwriteSkipped")); return { path: null, body: null }; }
        bodyToWrite = chosen;
      }
    }
    await io.writeNote(overwritePath, rewriteTranscript(old, { model, sourceLink: source.link, body: bodyToWrite, pages: pagesStr }, map));
    return { path: overwritePath, body: bodyToWrite };
  }
  const sourceName = self ? undefined : basenameNoExt(sourcePath);
  const pdfPath = self ? sourcePath : (io.resolveImage(source.link, sourcePath)?.path ?? source.link);
  const notePath = transcriptNotePath(io, sourcePath, pdfPath, "pdf", opts?.destDir);
  const content = buildPdfNote({
    pdfLink: source.link, sourceName, date: io.date(), model,
    pages: bodyPages, rangeFrom, rangeTo, separator, range,
  }, map);
  await io.createNote(notePath, content);
  if (embed && !self) {
    const before = await io.readNote(sourcePath);
    const replaced = replaceEmbed(before, source.raw, basenameNoExt(notePath));
    if (replaced !== before) await io.writeNote(sourcePath, replaced);
  }
  return { path: notePath, body: body.trim() };
}
