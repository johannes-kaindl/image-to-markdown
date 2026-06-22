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
