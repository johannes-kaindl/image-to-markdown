/** Schmales Lookup-Interface (von der Obsidian-Schicht injiziert), damit die Kernlogik app-frei testbar ist. */
export interface BacklinkLookup {
  /** app.metadataCache.resolvedLinks: notePath → { targetPath → count }. */
  resolvedLinks: Record<string, Record<string, number>>;
  /** Frontmatter-Links einer Notiz (getFileCache(f).frontmatterLinks): { key, link }. */
  frontmatterLinks(notePath: string): { key: string; link: string }[];
  /** Wikilink → Zielpfad relativ zur Notiz (getFirstLinkpathDest). null wenn unauflösbar. */
  resolveLink(link: string, fromPath: string): string | null;
}

const SOURCE_KEYS = ["source_pdf", "source_image"];

/** Pfad einer existierenden Transkript-Notiz für `sourcePath`, oder null.
 *  Tragend: nur Notizen mit source_pdf/source_image-Frontmatter, das auf sourcePath auflöst,
 *  zählen — der bloße resolvedLinks-Treffer (Body-Embed) genügt NICHT. */
export function findExistingTranscript(lookup: BacklinkLookup, sourcePath: string): string | null {
  for (const notePath of Object.keys(lookup.resolvedLinks)) {
    const targets = lookup.resolvedLinks[notePath];
    if (!targets || !(sourcePath in targets)) continue;
    for (const fl of lookup.frontmatterLinks(notePath)) {
      const baseKey = fl.key.split(".")[0];
      if (!SOURCE_KEYS.includes(baseKey)) continue;
      if (lookup.resolveLink(fl.link, notePath) === sourcePath) return notePath;
    }
  }
  return null;
}
