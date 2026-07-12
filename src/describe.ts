import type { Lang } from "./i18n";

export interface ParsedDescription { category: string | null; tags: string[]; prose: string; }

/** Beschreiben-Prompt: fordert festes, sprach-unabhängiges Kopf-Format (literale Marker) + Prosa. */
export function buildDescribePrompt(taxonomy: string[], lang: Lang): string {
  const list = taxonomy.join(", ");
  const proseLang = lang === "de" ? "auf Deutsch" : "in English";
  return [
    "Describe the image so it can be found later by semantic search.",
    `Respond in EXACTLY this format:`,
    `CATEGORY: <choose exactly one of: ${list}>`,
    `TAGS: <2-6 comma-separated free-form topic keywords>`,
    `---`,
    `<a concise prose description ${proseLang}: what it shows, key elements, any visible text>`,
    "Output only that. No extra commentary.",
  ].join("\n");
}

function splitHead(raw: string): { head: string[]; prose: string } {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const sep = lines.findIndex(l => l.trim() === "---");
  if (sep >= 0) return { head: lines.slice(0, sep), prose: lines.slice(sep + 1).join("\n") };
  let i = 0;
  while (i < lines.length && /^\s*(CATEGORY|TAGS)\s*:/i.test(lines[i])) i++;
  return { head: lines.slice(0, i), prose: lines.slice(i).join("\n") };
}

export function parseDescription(raw: string, taxonomy: string[]): ParsedDescription {
  const { head, prose } = splitHead(raw);
  let candidate: string | null = null;
  let tags: string[] = [];
  for (const line of head) {
    const cat = /^\s*CATEGORY\s*:(.*)$/i.exec(line);
    if (cat) { candidate = cat[1].trim() || null; continue; }
    const tg = /^\s*TAGS\s*:(.*)$/i.exec(line);
    if (tg) tags = tg[1].split(",").map(s => s.trim()).filter(Boolean);
  }
  let category: string | null = null;
  if (candidate) {
    const hit = taxonomy.find(x => x.toLowerCase() === candidate.toLowerCase().trim());
    if (hit) category = hit;
    else tags = [candidate, ...tags];
  }
  return { category, tags, prose: prose.trim() };
}
