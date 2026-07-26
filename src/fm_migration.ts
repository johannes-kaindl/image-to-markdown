import { FrontmatterMap } from "./frontmatter_map";

export type MappingChange = { field: keyof FrontmatterMap; from: string; to: string };

export function diffMappings(oldMap: FrontmatterMap, newMap: FrontmatterMap): MappingChange[] {
  const out: MappingChange[] = [];
  (Object.keys(oldMap) as (keyof FrontmatterMap)[]).forEach((field) => {
    if (oldMap[field] !== newMap[field]) out.push({ field, from: oldMap[field], to: newMap[field] });
  });
  return out;
}

function fmBlock(content: string): string | null {
  const m = /^---\r?\n(?:([\s\S]*?)\r?\n)?---/.exec(content);
  return m ? (m[1] ?? "") : null;
}

function kEsc(key: string): string {
  return key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasKey(block: string, key: string): boolean {
  return new RegExp(`^${kEsc(key)}:`, "m").test(block);
}

function lineValue(block: string, key: string): string | null {
  const m = new RegExp(`^${kEsc(key)}:[ \\t]*(.*)$`, "m").exec(block);
  return m ? m[1].trim() : null;
}

export function isI2mNote(content: string, oldMap: FrontmatterMap): boolean {
  const block = fmBlock(content);
  if (block === null) return false;
  if (!hasKey(block, oldMap.sourceImage) && !hasKey(block, oldMap.sourcePdf)) return false;
  const kind = lineValue(block, oldMap.kindKey);
  if (kind === null) return true; // Pre-0.13-Notizen ohne kind-Zeile gehören uns
  return kind === oldMap.kindTranscript || kind === oldMap.kindDescription;
}

export interface MigrationResult { changed: boolean; next: string; conflict: boolean }

export function migrateNoteFrontmatter(content: string, oldMap: FrontmatterMap, newMap: FrontmatterMap): MigrationResult {
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(content);
  if (!m) return { changed: false, next: content, conflict: false };
  const [full, open, block, close] = m;

  // Key-Umbenennungen (die zwei reinen Wert-Felder ausgenommen).
  const rename = new Map<string, string>();
  (Object.keys(oldMap) as (keyof FrontmatterMap)[]).forEach((f) => {
    if (f === "kindTranscript" || f === "kindDescription") return;
    if (oldMap[f] !== newMap[f]) rename.set(oldMap[f], newMap[f]);
  });

  const kindValueChanged = oldMap.kindTranscript !== newMap.kindTranscript || oldMap.kindDescription !== newMap.kindDescription;
  const keyOf = (bare: string): string | null => {
    const mm = /^([^\r\n:]+):/.exec(bare);
    return mm ? mm[1] : null;
  };

  // Ketten/Swap-Verweigerung (Idempotenz-Sicherung): benennt eine Zeile ihren Key in einen Key
  // um, der selbst Umbenennungs-Quelle ist (Ziel ∈ Domain), ist die Umschrift nicht idempotent
  // (Kette → Duplikat-Key beim Re-Run = Datenverlust; Swap → Rückkippen) → Notiz als conflict
  // überspringen. Präzise per Notiz: nur Notizen, deren Key tatsächlich in die Domain wandert.
  const domain = new Set(rename.keys());
  for (const line of block.split("\n")) {
    const k = keyOf(line.endsWith("\r") ? line.slice(0, -1) : line);
    if (k !== null && rename.has(k)) {
      const to = rename.get(k)!;
      if (to !== k && domain.has(to)) return { changed: false, next: content, conflict: true };
    }
  }

  // Kollisions-Schutz: Ziel-Key kollidiert mit bestehendem fremdem Key
  // oder zwei Umbenennungs-Quellen treffen auf denselben Ziel-Key.
  const existingKeys = new Set<string>();
  for (const line of block.split("\n")) {
    const k = keyOf(line.endsWith("\r") ? line.slice(0, -1) : line);
    if (k) existingKeys.add(k);
  }
  const targets = new Set<string>();
  for (const [from, to] of rename) {
    if (!existingKeys.has(from)) continue;   // Notiz hat diesen Key nicht → nichts umzubenennen, keine Kollision (load-bearing für idempotenten Re-Scan)
    if (existingKeys.has(to) && !rename.has(to)) return { changed: false, next: content, conflict: true };
    if (targets.has(to)) return { changed: false, next: content, conflict: true };
    targets.add(to);
  }

  const outLines = block.split("\n").map((line) => {
    const cr = line.endsWith("\r") ? "\r" : "";
    const bare = cr ? line.slice(0, -1) : line;
    const k = keyOf(bare);
    if (k === null) return line;
    const newKey = rename.get(k) ?? k;
    let rest = bare.slice(k.length); // ":" + Wert
    if (k === oldMap.kindKey && kindValueChanged) {
      const vm = /^:[ \t]*(.*)$/.exec(rest);
      if (vm) {
        const val = vm[1].trim();
        const nv = val === oldMap.kindTranscript ? newMap.kindTranscript
                 : val === oldMap.kindDescription ? newMap.kindDescription
                 : val;
        if (nv !== val) rest = `: ${nv}`;
      }
    }
    return newKey + rest + cr;
  });

  const next = open + outLines.join("\n") + close + content.slice(full.length);
  return { changed: next !== content, next, conflict: false };
}
