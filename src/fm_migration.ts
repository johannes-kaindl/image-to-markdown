import { FrontmatterMap } from "./frontmatter_map";

export type MappingChange = { field: keyof FrontmatterMap; from: string; to: string };

export function diffMappings(oldMap: FrontmatterMap, newMap: FrontmatterMap): MappingChange[] {
  const out: MappingChange[] = [];
  (Object.keys(oldMap) as (keyof FrontmatterMap)[]).forEach((field) => {
    if (oldMap[field] !== newMap[field]) out.push({ field, from: oldMap[field], to: newMap[field] });
  });
  return out;
}
