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
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  return m ? m[1] : null;
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
  if (!block) return false;
  if (!hasKey(block, oldMap.sourceImage) && !hasKey(block, oldMap.sourcePdf)) return false;
  const kind = lineValue(block, oldMap.kindKey);
  if (kind === null) return true; // Pre-0.13-Notizen ohne kind-Zeile gehören uns
  return kind === oldMap.kindTranscript || kind === oldMap.kindDescription;
}
