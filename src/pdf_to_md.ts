import { ImgToMdIO, replaceEmbed, transcriptNotePath, basenameNoExt } from "./img_to_md";
import { t } from "./i18n";

export interface PdfPageTranscript { page: number; text: string }

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

/** Baut die PDF-Transkript-Notiz: Frontmatter + PDF-Embed oben + je nicht-leere Seite ein Block,
 *  getrennt gemäß `separator`. */
export function buildPdfNote(o: {
  pdfLink: string; sourceName: string; date: string; model: string;
  pages: PdfPageTranscript[]; rangeFrom: number; rangeTo: number;
  separator: PdfPageSeparator;
}): string {
  const esc = (s: string) => s.replace(/"/g, '\\"');
  const frontmatter = [
    "---",
    `source_pdf: "[[${esc(o.pdfLink)}]]"`,
    `source_note: "[[${esc(o.sourceName)}]]"`,
    `created: ${o.date}`,
    `transcribed_by: "${esc(o.model)}"`,
    `pages: "${o.rangeFrom}-${o.rangeTo}"`,
    "---",
  ].join("\n");
  const body = o.pages
    .filter(p => p.text.trim())
    .map(p => `${pagePrefix(o.separator, p.page)}${p.text.trim()}`)
    .join(pageGap(o.separator));
  return `${frontmatter}\n![[${o.pdfLink}]]\n\n${body}\n`;
}

/** Schreibt EINE Standard-Notiz für ein PDF (alle nicht-leeren Seiten), ersetzt den PDF-Embed. */
export async function writePdfTranscript(
  io: ImgToMdIO, sourcePath: string,
  embed: { raw: string; link: string },
  pages: { page: number; content: string; model: string }[],
  separator: PdfPageSeparator,
): Promise<{ path: string | null }> {
  const kept = pages.filter(p => p.content.trim()).sort((a, b) => a.page - b.page);
  if (!kept.length) return { path: null };
  const before = await io.readNote(sourcePath);
  const sourceName = basenameNoExt(sourcePath);
  const resolved = io.resolveImage(embed.link, sourcePath);
  const pdfPath = resolved?.path ?? embed.link;
  const notePath = transcriptNotePath(io, sourcePath, pdfPath, "pdf");
  const model = kept.find(p => p.model)?.model ?? "";
  const content = buildPdfNote({
    pdfLink: embed.link, sourceName, date: io.date(), model,
    pages: kept.map(p => ({ page: p.page, text: p.content })),
    rangeFrom: kept[0].page, rangeTo: kept[kept.length - 1].page,
    separator,
  });
  await io.createNote(notePath, content);
  const replaced = replaceEmbed(before, embed.raw, basenameNoExt(notePath));
  if (replaced !== before) await io.writeNote(sourcePath, replaced);
  return { path: notePath };
}
