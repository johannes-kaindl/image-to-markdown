// vendored from obsidian-kit#0.27.0, src/pure/diff.ts
/** Zeilen-Diff (LCS) + Hunk-Gruppierung + selektives Übernehmen — obsidian-frei,
 *  in Node testbar (PROF-OBS-03/04).
 *
 *  Kanonische Quelle: `image-to-markdown/src/diff.ts` (2026-07-07). Von koda-agent
 *  (2026-08-05) und wikijs-maintainer (2026-08-09) mit Herkunftsstempel übernommen;
 *  beim Heben ins Kit (2026-08-19) waren alle drei Fassungen ab `export type DiffLine`
 *  byte-identisch — 71 Zeilen, md5 `ae62db0c8b75d81135348989f3993487`. Der Code ist
 *  deshalb unverändert übernommen, keine Signatur wurde angefasst.
 *
 *  ⚠️ Die Literale `"ctx" | "add" | "del"` sind load-bearing: alle drei Konsumenten bauen
 *  daraus per Template-String CSS-Klassen (`img2md-diff-${kind}`, `koda-diff-${kind}`,
 *  `wikijs-diff-${kind}`) gegen Klassen in ihrer jeweiligen `styles.css`. Eine Umbenennung
 *  bricht das Styling **still** — kein Typfehler, kein Testfehler, nur ungestylter Diff.
 *
 *  Konsumenten nutzen bewusst verschiedene Teilmengen: image-to-markdown alle fünf Exporte
 *  (Hunk-Auswahl im Modal), koda-agent und wikijs-maintainer nur `diffLines` (Vorschau).
 *  Das ist kein Grund zum Aufteilen — benannte Exporte lassen sich tree-shaken. */
export type DiffLine = { kind: "ctx" | "add" | "del"; text: string };

function toLines(text: string): string[] {
  return text === "" ? [] : text.split("\n");
}

/** Klassischer LCS-Zeilen-Diff. Bodies sind klein → O(n·m) unkritisch.
 *  Reihenfolge bei Ersetzung: erst die gelöschten (alt), dann die hinzugefügten (neu). */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = toLines(oldText);
  const b = toLines(newText);
  const n = a.length, m = b.length;
  // lcs[i][j] = Länge der LCS von a[i..] und b[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ kind: "ctx", text: a[i] }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { out.push({ kind: "del", text: a[i] }); i++; }
    else { out.push({ kind: "add", text: b[j] }); j++; }
  }
  while (i < n) { out.push({ kind: "del", text: a[i] }); i++; }
  while (j < m) { out.push({ kind: "add", text: b[j] }); j++; }
  return out;
}

export type Hunk = { lines: DiffLine[]; startIndex: number };

/** Gruppiert die flache Diff-Liste in Hunks: jeder maximale Block zusammenhängender
 *  add/del-Zeilen (durch ctx getrennt) wird EIN Hunk. ctx-Zeilen gehören keinem Hunk.
 *  startIndex = Index der ersten Hunk-Zeile in `diff`. */
export function groupHunks(diff: DiffLine[]): Hunk[] {
  const hunks: Hunk[] = [];
  let cur: DiffLine[] | null = null;
  let start = 0;
  for (let i = 0; i < diff.length; i++) {
    if (diff[i].kind === "ctx") {
      if (cur) { hunks.push({ lines: cur, startIndex: start }); cur = null; }
    } else {
      if (!cur) { cur = []; start = i; }
      cur.push(diff[i]);
    }
  }
  if (cur) hunks.push({ lines: cur, startIndex: start });
  return hunks;
}

/** Baut den Body aus Diff + Hunk-Auswahl: ctx immer; Hunk selektiert → add-Zeilen (neu),
 *  deselektiert → del-Zeilen (alt). `selected[k]` gehört zum k-ten Hunk (groupHunks-Reihenfolge);
 *  fehlt der Eintrag, gilt true (= übernehmen). Rückgabe join("\n"). */
export function applySelection(diff: DiffLine[], selected: boolean[]): string {
  const takeAdd = new Set<number>();
  groupHunks(diff).forEach((h, k) => { if (selected[k] !== false) takeAdd.add(h.startIndex); });
  const out: string[] = [];
  let i = 0;
  while (i < diff.length) {
    if (diff[i].kind === "ctx") { out.push(diff[i].text); i++; continue; }
    const take = takeAdd.has(i); // i ist ein Hunk-Start (startIndex)
    while (i < diff.length && diff[i].kind !== "ctx") {
      if (take && diff[i].kind === "add") out.push(diff[i].text);
      if (!take && diff[i].kind === "del") out.push(diff[i].text);
      i++;
    }
  }
  return out.join("\n");
}
