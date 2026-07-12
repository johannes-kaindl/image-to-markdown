import type { ImgCard } from "./img_to_md_state";

/** In-Session-Cache der Sidebar-Ergebnis-Karten pro Quelldatei (Plugin-Ebene → überlebt View-Close).
 *  Rein/obsidian-frei. Kein Disk-Persist: bei Obsidian-Neustart leer. */
export class CardCache {
  private m = new Map<string, ImgCard[]>();
  /** Karten einer Quelle merken. Leeres Array → Eintrag entfernen (keine leeren Einträge horten).
   *  BEWUSST per Referenz (kein Deep-Copy): Persistiert die View bei onClose mitten im Lauf, heilt
   *  die laufende Abort-Cleanup dieselben Objekte in-place (streaming→error), bevor die View wieder
   *  geöffnet wird. Ein defensiver Deep-Copy hier würde eine dauerhaft „streaming"-hängende Karte
   *  beim Reopen wieder einführen — nicht ohne Not ändern. */
  save(sourcePath: string, cards: ImgCard[]): void {
    if (cards.length === 0) { this.m.delete(sourcePath); return; }
    this.m.set(sourcePath, cards);
  }
  /** Gemerkte Karten oder undefined. */
  load(sourcePath: string): ImgCard[] | undefined {
    return this.m.get(sourcePath);
  }
  /** Eintrag entfernen (Clear). */
  clear(sourcePath: string): void {
    this.m.delete(sourcePath);
  }
}
