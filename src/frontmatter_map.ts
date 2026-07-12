/** Konfigurierbare Frontmatter-Keys (und Diskriminator-Werte) für alle i2m-Notizen.
 *  Setup-Zeit-Entscheidung: nachträgliches Ändern von sourceImage/kind* kann die
 *  Idempotenz bestehender Notizen brechen (Phase 1b liefert die vaultweite Migration). */
export interface FrontmatterMap {
  sourceImage: string;
  sourcePdf: string;
  sourceNote: string;
  category: string;
  tags: string;
  authorTranscribed: string;
  authorDescribed: string;
  created: string;
  pages: string;
  kindKey: string;
  kindTranscript: string;
  kindDescription: string;
}

export const DEFAULT_FM_MAP: FrontmatterMap = {
  sourceImage: "source_image",
  sourcePdf: "source_pdf",
  sourceNote: "source_note",
  category: "category",
  tags: "tags",
  authorTranscribed: "transcribed_by",
  authorDescribed: "described_by",
  created: "created",
  pages: "pages",
  kindKey: "kind",
  kindTranscript: "transcript",
  kindDescription: "description",
};
