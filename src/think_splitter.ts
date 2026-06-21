const OPEN = "<think>";
const CLOSE = "</think>";

/** Zustandsbehafteter Splitter: zieht <think>…</think> aus einem Token-Strom (Content-Kanal).
 *  Tags dürfen über push-Grenzen gesplittet sein — ein angefangenes Tag wird gepuffert. */
export class ThinkSplitter {
  private inside = false;
  private buf = "";

  push(text: string): { content: string; reasoning: string } {
    let s = this.buf + text;
    this.buf = "";
    let content = "";
    let reasoning = "";
    while (s.length > 0) {
      const tag = this.inside ? CLOSE : OPEN;
      const idx = s.indexOf(tag);
      if (idx >= 0) {
        const before = s.slice(0, idx);
        if (this.inside) reasoning += before; else content += before;
        this.inside = !this.inside;
        s = s.slice(idx + tag.length);
        continue;
      }
      // Kein vollständiges Tag: ein evtl. angefangenes Tag am Ende puffern.
      const partial = partialSuffixLen(s, tag);
      const safe = s.length - partial;
      const emit = s.slice(0, safe);
      if (this.inside) reasoning += emit; else content += emit;
      this.buf = s.slice(safe);
      s = "";
    }
    return { content, reasoning };
  }

  /** Stream-Ende: gibt den noch gepufferten (Tag-)Rest zurück — er hat sich nie zu einem
   *  vollständigen Tag ergänzt und gehört in den aktuell aktiven Kanal. */
  flush(): { content: string; reasoning: string } {
    const out = { content: this.inside ? "" : this.buf, reasoning: this.inside ? this.buf : "" };
    this.buf = "";
    return out;
  }
}

/** Länge des längsten Suffixes von `s`, das ein echter Präfix von `tag` ist. */
function partialSuffixLen(s: string, tag: string): number {
  const max = Math.min(s.length, tag.length - 1);
  for (let n = max; n > 0; n--) {
    if (s.slice(s.length - n) === tag.slice(0, n)) return n;
  }
  return 0;
}
