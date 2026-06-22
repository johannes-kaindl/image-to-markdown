import { ImgToMdIO, replaceEmbed, transcriptNotePath, basenameNoExt } from "./img_to_md";
import { t } from "./i18n";

export interface PdfPageTranscript { page: number; text: string }

/** Baut die PDF-Transkript-Notiz: Frontmatter + PDF-Embed oben + ## Seite N je nicht-leerer Seite. */
export function buildPdfNote(o: {
  pdfLink: string; sourceName: string; date: string; model: string;
  pages: PdfPageTranscript[]; rangeFrom: number; rangeTo: number;
}): string {
  const esc = (s: string) => s.replace(/"/g, '\\"');
  const head = [
    "---",
    `source_pdf: "[[${esc(o.pdfLink)}]]"`,
    `source_note: "[[${esc(o.sourceName)}]]"`,
    `created: ${o.date}`,
    `transcribed_by: "${esc(o.model)}"`,
    `pages: "${o.rangeFrom}-${o.rangeTo}"`,
    "---",
    `![[${o.pdfLink}]]`,
    "",
  ];
  const body = o.pages
    .filter(p => p.text.trim())
    .map(p => `## ${t("pdf.pageHeading", p.page)}\n\n${p.text.trim()}\n`);
  return head.concat(body).join("\n");
}

/** Schreibt EINE Standard-Notiz für ein PDF (alle nicht-leeren Seiten), ersetzt den PDF-Embed. */
export async function writePdfTranscript(
  io: ImgToMdIO, sourcePath: string,
  embed: { raw: string; link: string },
  pages: { page: number; content: string; model: string }[],
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
  });
  await io.createNote(notePath, content);
  const replaced = replaceEmbed(before, embed.raw, basenameNoExt(notePath));
  if (replaced !== before) await io.writeNote(sourcePath, replaced);
  return { path: notePath };
}
