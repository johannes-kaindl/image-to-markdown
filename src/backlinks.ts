import { FrontmatterMap } from "./frontmatter_map";

/** Schmales Lookup-Interface (von der Obsidian-Schicht injiziert), damit die Kernlogik app-frei testbar ist. */
export interface BacklinkLookup {
  /** app.metadataCache.resolvedLinks: notePath → { targetPath → count }. */
  resolvedLinks: Record<string, Record<string, number>>;
  /** Frontmatter-Links einer Notiz (getFileCache(f).frontmatterLinks): { key, link }. */
  frontmatterLinks(notePath: string): { key: string; link: string }[];
  /** Wikilink → Zielpfad relativ zur Notiz (getFirstLinkpathDest). null wenn unauflösbar. */
  resolveLink(link: string, fromPath: string): string | null;
  /** Frontmatter-Wert einer Notiz, oder null falls nicht vorhanden. */
  frontmatterValue(notePath: string, key: string): string | null;
}

/** Pfad einer existierenden Transkript-Notiz für `sourcePath`, oder null.
 *  Tragend: nur Notizen mit source_pdf/source_image-Frontmatter, das auf sourcePath auflöst,
 *  zählen — der bloße resolvedLinks-Treffer (Body-Embed) genügt NICHT.
 *  Diskriminiert nach Frontmatter kind: nur wenn kind !== description (oder nicht vorhanden). */
export function findExistingTranscript(lookup: BacklinkLookup, sourcePath: string, map: FrontmatterMap): string | null {
  return findByKind(lookup, sourcePath, map, false);
}

/** Pfad einer existierenden Beschreibungs-Notiz für `sourcePath`, oder null.
 *  Diskriminiert nach Frontmatter kind: nur wenn kind === description. */
export function findExistingDescription(lookup: BacklinkLookup, sourcePath: string, map: FrontmatterMap): string | null {
  return findByKind(lookup, sourcePath, map, true);
}

/** Private Hilfsfunktion: sucht nach Backlink-Notiz basierend auf kind-Diskriminator.
 *  wantDescription=false: findet Transkript-Notizen (kind !== description oder nicht vorhanden).
 *  wantDescription=true: findet Beschreibungs-Notizen (kind === description). */
function findByKind(lookup: BacklinkLookup, sourcePath: string, map: FrontmatterMap, wantDescription: boolean): string | null {
  const sourceKeys = [map.sourcePdf, map.sourceImage];
  for (const notePath of Object.keys(lookup.resolvedLinks)) {
    const targets = lookup.resolvedLinks[notePath];
    if (!targets || !(sourcePath in targets)) continue;

    // Prüfe kind-Diskriminator
    const kindValue = lookup.frontmatterValue(notePath, map.kindKey);
    const isDescription = kindValue === map.kindDescription;
    if (wantDescription !== isDescription) continue;

    // Prüfe source_* Frontmatter
    for (const fl of lookup.frontmatterLinks(notePath)) {
      const baseKey = fl.key.split(".")[0];
      if (!sourceKeys.includes(baseKey)) continue;
      if (lookup.resolveLink(fl.link, notePath) === sourcePath) return notePath;
    }
  }
  return null;
}
