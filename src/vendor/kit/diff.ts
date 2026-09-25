// vendored from code-kit@0.7.0, src/ts/pure/diff.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
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
  // lcs(i,j) = Länge der LCS von a[i..] und b[j..]. Flach statt verschachtelt: der
  // Zeilenzugriff einer number[][] ist unter --noUncheckedIndexedAccess `| undefined`
  // und müsste an jeder der acht Stellen einzeln entschärft werden. Hier trägt der
  // Default `?? 0` den Rand des Algorithmus — außerhalb der Matrix IST die LCS-Länge 0,
  // genau dafür ist sie (n+1)×(m+1) mit Nullrand. Kein `!`, keine Behauptung.
  const w = m + 1;
  const lcs = new Array<number>((n + 1) * w).fill(0);
  const at = (i: number, j: number): number => lcs[i * w + j] ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    // i < n === a.length und j < m === b.length — beide Zugriffe liegen im Feld. Einmal
    // hier gebunden, statt in jedem der fünf Zweige erneut indiziert.
    const ai = a[i], bj = b[j];
    if (ai === undefined || bj === undefined) break;
    if (ai === bj) { out.push({ kind: "ctx", text: ai }); i++; j++; }
    else if (at(i + 1, j) >= at(i, j + 1)) { out.push({ kind: "del", text: ai }); i++; }
    else { out.push({ kind: "add", text: bj }); j++; }
  }
  for (; i < n; i++) { const ai = a[i]; if (ai !== undefined) out.push({ kind: "del", text: ai }); }
  for (; j < m; j++) { const bj = b[j]; if (bj !== undefined) out.push({ kind: "add", text: bj }); }
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
  // Iteration statt Index: `entries()` liefert das Element als `DiffLine`, während
  // `diff[i]` unter --noUncheckedIndexedAccess `DiffLine | undefined` wäre.
  for (const [i, line] of diff.entries()) {
    if (line.kind === "ctx") {
      if (cur) { hunks.push({ lines: cur, startIndex: start }); cur = null; }
    } else {
      if (!cur) { cur = []; start = i; }
      cur.push(line);
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
    const line = diff[i];
    if (line === undefined) break; // i < diff.length — unerreichbar, aber belegt statt behauptet
    if (line.kind === "ctx") { out.push(line.text); i++; continue; }
    const take = takeAdd.has(i); // i ist ein Hunk-Start (startIndex)
    for (let cur = diff[i]; i < diff.length && cur !== undefined && cur.kind !== "ctx"; cur = diff[++i]) {
      if (take && cur.kind === "add") out.push(cur.text);
      if (!take && cur.kind === "del") out.push(cur.text);
    }
  }
  return out.join("\n");
}
