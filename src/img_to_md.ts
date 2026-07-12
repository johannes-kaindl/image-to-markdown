import { t } from "./i18n";
import type { ImgItem } from "./img_to_md_state";
import { diffLines, type DiffLine } from "./diff";
import { DEFAULT_FM_MAP, type FrontmatterMap } from "./frontmatter_map";

export const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "heic", "heif"];
export const SUPPORTED_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];
export const PDF_EXT = "pdf";

export interface ImageEmbed { raw: string; link: string; ext: string; kind: "image" | "pdf"; page?: number; embed: boolean }

export function extOf(link: string): string {
  const clean = link.split("#")[0].split("|")[0].trim();
  const dot = clean.lastIndexOf(".");
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : "";
}

/** Kürzt einen Namen mittig auf genau max Zeichen: "anfang…ende" (Ellipsis = 1 Zeichen).
 *  name.length <= max bleibt unverändert; max <= 1 ergibt nur "…". Das Namensende
 *  (inkl. Endung) bleibt soweit erhalten, wie der Tail-Anteil reicht. */
export function truncateMiddle(name: string, max: number): string {
  if (name.length <= max) return name;
  if (max <= 1) return "…";
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return name.slice(0, head) + "…" + name.slice(name.length - tail);
}

/** Klassifiziert eine Datei-Extension als Medientyp (Bild/PDF) oder null, wenn nicht transkribierbar. */
export function classifySource(ext: string): "image" | "pdf" | null {
  const e = ext.toLowerCase();
  if (IMAGE_EXTS.includes(e)) return "image";
  if (e === PDF_EXT) return "pdf";
  return null;
}

/** #page=N aus dem rohen Linkziel (vor dem #-Strip) lesen. */
function pageOf(rawTarget: string): number | undefined {
  const m = /#page=(\d+)/i.exec(rawTarget);
  return m ? Number(m[1]) : undefined;
}

/** Entfernt einen führenden YAML-Frontmatter-Block (---\n…\n---). Ohne Frontmatter unverändert.
 *  Schützt den Link-Scan davor, source_pdf/source_note-Wikilinks als Quelle zu erkennen. */
export function stripFrontmatter(content: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(content);
  return m ? content.slice(m[0].length) : content;
}

/** Findet Bild-/PDF-Embeds UND reine Links: ![[x]] / [[x]] (Wikilink) und ![alt](p) / [t](p)
 *  (Markdown, externe http(s) aus). `embed` = true bei führendem `!`. Frontmatter wird ignoriert. */
export function findImageEmbeds(content: string): ImageEmbed[] {
  const body = stripFrontmatter(content);
  const out: ImageEmbed[] = [];
  let m: RegExpExecArray | null;
  const wiki = /(!?)\[\[([^\]]+?)\]\]/g;
  while ((m = wiki.exec(body)) !== null) {
    const embed = m[1] === "!";
    const inner = m[2];
    const link = inner.split("#")[0].split("|")[0].trim();
    const ext = extOf(link);
    if (IMAGE_EXTS.includes(ext)) out.push({ raw: m[0], link, ext, kind: "image", embed });
    else if (ext === PDF_EXT) out.push({ raw: m[0], link, ext, kind: "pdf", page: pageOf(inner), embed });
  }
  const md = /(!?)\[[^\]]*\]\(([^)]+?)\)/g;
  while ((m = md.exec(body)) !== null) {
    const embed = m[1] === "!";
    const target = m[2].trim();
    if (/^https?:\/\//i.test(target)) continue;
    const link = target.split("#")[0].trim();
    const ext = extOf(link);
    if (IMAGE_EXTS.includes(ext)) out.push({ raw: m[0], link, ext, kind: "image", embed });
    else if (ext === PDF_EXT) out.push({ raw: m[0], link, ext, kind: "pdf", page: pageOf(target), embed });
  }
  return out;
}

/** Baut die Transkript-Notiz: Frontmatter-Ref (aus `map`) + Foto-Embed oben + Transkript. Additive
 *  `kind`-Zeile (map.kindKey/map.kindTranscript) nach source_note (bzw. source_image ohne sourceName).
 *  `map` defaultet auf DEFAULT_FM_MAP — bestehende Direktaufrufer (z. B. pdf_to_md.ts via rewriteTranscript)
 *  bleiben ohne Änderung kompatibel. */
export function buildTranscriptNote(
  o: { imageLink: string; sourceName?: string; date: string; model: string; transcript: string },
  map: FrontmatterMap = DEFAULT_FM_MAP,
): string {
  const esc = (s: string) => s.replace(/"/g, '\\"');   // YAML-Doppelquote-String — schützt vor Frontmatter-Bruch
  const lines = ["---", `${map.sourceImage}: "[[${esc(o.imageLink)}]]"`];
  if (o.sourceName !== undefined) lines.push(`${map.sourceNote}: "[[${esc(o.sourceName)}]]"`);
  lines.push(`${map.kindKey}: ${map.kindTranscript}`);
  lines.push(`${map.created}: ${o.date}`, `${map.authorTranscribed}: "${esc(o.model)}"`, "---", `![[${o.imageLink}]]`, "", o.transcript, "");
  return lines.join("\n");
}

/** Baut die Beschreibungs-Notiz: Frontmatter-Ref (aus `map`) + Prosa. Embed-frei (KEIN führendes
 *  `![[…]]` — anders als buildTranscriptNote, die Beschreibung ersetzt kein Bild, sondern beschreibt
 *  es als Alt-Text-Quelle). `category` nur bei nicht-null, `tags` nur bei nicht-leerer Liste
 *  (YAML-Flow-Liste `[a, b]`). `map` defaultet auf DEFAULT_FM_MAP. */
export function buildDescriptionNote(
  o: { imageLink: string; sourceName?: string; date: string; model: string; category: string | null; tags: string[]; prose: string },
  map: FrontmatterMap = DEFAULT_FM_MAP,
): string {
  const esc = (s: string) => s.replace(/"/g, '\\"');   // YAML-Doppelquote-String — schützt vor Frontmatter-Bruch
  const lines = ["---", `${map.sourceImage}: "[[${esc(o.imageLink)}]]"`];
  if (o.sourceName !== undefined) lines.push(`${map.sourceNote}: "[[${esc(o.sourceName)}]]"`);
  lines.push(`${map.kindKey}: ${map.kindDescription}`);
  if (o.category !== null) lines.push(`${map.category}: ${o.category}`);
  if (o.tags.length > 0) lines.push(`${map.tags}: [${o.tags.join(", ")}]`);
  lines.push(`${map.authorDescribed}: "${esc(o.model)}"`, `${map.created}: ${o.date}`, "---", o.prose, "");
  return lines.join("\n");
}

/** Override: erhält das komplette Frontmatter der alten Notiz UNVERÄNDERT (ergänzt kein `kind` —
 *  minimaler Eingriff), ersetzt nur den gemappten Autor-Key (+ pages bei PDF) und den Body.
 *  Quelle/Quellnotiz/created bleiben damit unverändert. `map` defaultet auf DEFAULT_FM_MAP. */
export function rewriteTranscript(
  old: string,
  o: { model: string; sourceLink: string; body: string; pages?: string },
  map: FrontmatterMap = DEFAULT_FM_MAP,
): string {
  const esc = (s: string) => s.replace(/"/g, '\\"');
  const kEsc = (k: string) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");   // Key defensiv escapen (Regex-Metazeichen)
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(old);
  // Fallback nur theoretisch — Override wirkt ausschließlich auf unsere Transkript-Notizen, die immer Frontmatter haben.
  let frontmatter = fm ? fm[1] : `${map.authorTranscribed}: "${esc(o.model)}"`;
  frontmatter = frontmatter.replace(new RegExp(`^${kEsc(map.authorTranscribed)}:.*$`, "m"), `${map.authorTranscribed}: "${esc(o.model)}"`);
  if (o.pages !== undefined) {
    const pagesRe = new RegExp(`^${kEsc(map.pages)}:.*$`, "m");
    frontmatter = pagesRe.test(frontmatter)
      ? frontmatter.replace(pagesRe, `${map.pages}: "${o.pages}"`)
      : `${frontmatter}\n${map.pages}: "${o.pages}"`;
  }
  return `---\n${frontmatter}\n---\n![[${o.sourceLink}]]\n\n${o.body}\n`;
}

/** Extrahiert den reinen Transkript-Text: entfernt das ---…----Frontmatter und die führende
 *  ![[…]]-Embed-Zeile (samt Leerzeile). Für den Diff — Frontmatter (transcribed_by/pages) und die
 *  unveränderte Embed-Zeile sind Rauschen. */
export function extractTranscriptBody(note: string): string {
  let s = note.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  // `^\s*` toleriert Leerzeilen zwischen Frontmatter und Embed — der Obsidian-Linter fügt dort
  // eine ein, sonst bliebe das Embed im Body hängen und der Diff wäre um die Embed-Zeile verschoben.
  s = s.replace(/^\s*!\[\[[^\]]*\]\]\r?\n?/, "");
  return s.trim();
}

/** Ersetzt alle Vorkommen des Bild-Embeds (literal) durch einen Embed der neuen Notiz. */
export function replaceEmbed(content: string, raw: string, newBasename: string): string {
  return content.split(raw).join(`![[${newBasename}]]`);
}

/** Erzeugt einen kollisionsfreien Notiz-Pfad (Zähler-Suffix bei Konflikt). */
export function uniqueNotePath(io: { noteExists(p: string): boolean }, dir: string, base: string): string {
  const join = (n: string) => (dir ? `${dir}/${n}.md` : `${n}.md`);
  if (!io.noteExists(join(base))) return join(base);
  let i = 2;
  while (io.noteExists(join(`${base}-${i}`))) i++;
  return join(`${base}-${i}`);
}

function dirOf(path: string): string { const i = path.lastIndexOf("/"); return i >= 0 ? path.slice(0, i) : ""; }
export function basenameNoExt(path: string): string { const b = path.slice(path.lastIndexOf("/") + 1); const d = b.lastIndexOf("."); return d >= 0 ? b.slice(0, d) : b; }

/** Letztes Pfadsegment inkl. Extension (für Wikilink/Anzeige der Selbst-Quelle). */
export function basename(path: string): string { return path.slice(path.lastIndexOf("/") + 1); }

/** Baut das eine ImgItem für eine direkt geöffnete Medien-Datei (Selbst-Quelle).
 *  null, wenn sourcePath kein Bild/PDF ist. pageCount/existingTranscriptPath kommen
 *  von der Obsidian-Schicht (I/O); diese Funktion bleibt rein. */
export function buildSelfSourceItem(
  sourcePath: string,
  opts: { pageCount?: number; existingTranscriptPath?: string; pdfMaxPages: number },
): ImgItem | null {
  const ext = extOf(sourcePath);
  const cls = classifySource(ext);
  if (!cls) return null;
  const common = { raw: "", link: basename(sourcePath), ext, existingTranscriptPath: opts.existingTranscriptPath, embed: false, selfSource: true };
  if (cls === "pdf") {
    const pageCount = opts.pageCount ?? 0;
    const cappedTo = Math.min(pageCount, opts.pdfMaxPages);
    return { ...common, kind: "pdf", supported: pageCount > 0, pageCount, range: { from: 1, to: cappedTo > 0 ? cappedTo : 1 } };
  }
  return { ...common, kind: "image", supported: SUPPORTED_EXTS.includes(ext) };
}

function transcriptSuffix(kind: "image" | "pdf"): string {
  return t(kind === "pdf" ? "note.suffix.pdf" : "note.suffix.image");
}

/** Pfad für die Transkript-Notiz: unter `destDir` (falls gesetzt) bzw. neben der Quellnotiz,
 *  Basename des Bildes + lokalisierter Suffix, kollisionsfrei. */
export function transcriptNotePath(io: { noteExists(p: string): boolean }, sourcePath: string, imagePath: string, kind: "image" | "pdf", destDir?: string): string {
  const base = `${basenameNoExt(imagePath)} ${transcriptSuffix(kind)}`;
  return uniqueNotePath(io, destDir ?? dirOf(sourcePath), base);
}

/** Pfad für die Beschreibungs-Notiz: unter `destDir` (falls gesetzt) bzw. neben der Quellnotiz,
 *  Basename des Bildes + lokalisierter Suffix, kollisionsfrei. */
export function descriptionNotePath(io: { noteExists(p: string): boolean }, sourcePath: string, imagePath: string, destDir?: string): string {
  const base = `${basenameNoExt(imagePath)} ${t("note.suffix.description")}`;
  return uniqueNotePath(io, destDir ?? dirOf(sourcePath), base);
}

export interface ImgToMdIO {
  date: () => string;
  readNote(path: string): Promise<string>;
  writeNote(path: string, content: string): Promise<void>;
  createNote(path: string, content: string): Promise<void>;
  noteExists(path: string): boolean;
  resolveImage(link: string, sourcePath: string): { path: string; ext: string } | null;
  readImageDataUrl(path: string, ext: string): Promise<string>;
  transcribe(dataUrl: string): Promise<{ content: string; model: string }>;
  notify(msg: string): void;
  confirmOverwrite?(ctx: { path: string; diff: DiffLine[] }): Promise<string | null>;
}

/** Schreibt mehrere Transkripte gebündelt: im Nicht-selfSource-Pfad Quelle EINMAL lesen,
 *  pro Eintrag Notiz anlegen + Embed ersetzen (akkumuliert), Quelle EINMAL schreiben. Leere
 *  Transkripte werden übersprungen. Nicht-destruktiv/idempotent; keine Read-Modify-Write-Race.
 *  Override: ist `overwritePath` gesetzt, wird stattdessen die bestehende Notiz via
 *  rewriteTranscript überschrieben (kein replaceEmbed, Quelle bleibt unangetastet).
 *  selfSource: Quelle ist eine Binärdatei — kein readNote/writeNote auf sourcePath,
 *  kein replaceEmbed, keine source_note, Ablage unter opts.destDir. */
export async function writeTranscripts(
  io: ImgToMdIO, sourcePath: string,
  entries: { raw: string; link: string; content: string; model: string; overwritePath?: string; embed?: boolean; knownBody?: string }[],
  opts?: { selfSource?: boolean; destDir?: string; map?: FrontmatterMap },
): Promise<{ results: { path: string | null; body: string | null }[] }> {
  const self = opts?.selfSource === true;
  const destDir = opts?.destDir;
  const map = opts?.map ?? DEFAULT_FM_MAP;
  const before = self ? "" : await io.readNote(sourcePath);
  let content = before;
  const sourceName = self ? undefined : basenameNoExt(sourcePath);
  const results: { path: string | null; body: string | null }[] = [];
  for (const e of entries) {
    const transcript = e.content.trim();
    if (!transcript) { results.push({ path: null, body: null }); continue; }
    if (e.overwritePath) {
      const old = await io.readNote(e.overwritePath);
      const alreadyMatches = e.knownBody !== undefined && extractTranscriptBody(old) === e.knownBody;
      let bodyToWrite = transcript;
      if (!alreadyMatches && io.confirmOverwrite) {
        const diff = diffLines(extractTranscriptBody(old), transcript);
        if (diff.some(d => d.kind !== "ctx")) {
          const chosen = await io.confirmOverwrite({ path: e.overwritePath, diff });
          if (chosen === null) { io.notify(t("notice.overwriteSkipped")); results.push({ path: null, body: null }); continue; }
          bodyToWrite = chosen;
        }
      }
      await io.writeNote(e.overwritePath, rewriteTranscript(old, { model: e.model, sourceLink: e.link, body: bodyToWrite }, map));
      results.push({ path: e.overwritePath, body: bodyToWrite });
      continue;
    }
    const imagePath = self ? sourcePath : (io.resolveImage(e.link, sourcePath)?.path ?? e.link);
    const newPath = transcriptNotePath(io, sourcePath, imagePath, "image", destDir);
    await io.createNote(newPath, buildTranscriptNote({ imageLink: e.link, sourceName, date: io.date(), model: e.model, transcript }, map));
    if (!self && e.embed !== false) content = replaceEmbed(content, e.raw, basenameNoExt(newPath));
    results.push({ path: newPath, body: transcript });
  }
  if (!self && content !== before) await io.writeNote(sourcePath, content);
  return { results };
}

/** Schreibt mehrere Beschreibungen: pro Eintrag eine embed-freie Notiz anlegen (buildDescriptionNote).
 *  Embed-frei per Definition — anders als writeTranscripts KEIN readNote/writeNote auf der Quelle,
 *  KEIN replaceEmbed, KEIN Override/Diff (Beschreibungen ersetzen keinen Bild-Embed). Leere `prose`
 *  wird übersprungen. selfSource: Quelle ist eine Binärdatei — Ablage unter opts.destDir, keine
 *  source_note. */
export async function writeDescriptions(
  io: ImgToMdIO, sourcePath: string,
  entries: { link: string; category: string | null; tags: string[]; prose: string; model: string }[],
  opts?: { selfSource?: boolean; destDir?: string; map?: FrontmatterMap },
): Promise<{ results: { path: string | null }[] }> {
  const self = opts?.selfSource === true;
  const destDir = opts?.destDir;
  const map = opts?.map ?? DEFAULT_FM_MAP;
  const sourceName = self ? undefined : basenameNoExt(sourcePath);
  const results: { path: string | null }[] = [];
  for (const e of entries) {
    const prose = e.prose.trim();
    if (!prose) { results.push({ path: null }); continue; }
    const imagePath = self ? sourcePath : (io.resolveImage(e.link, sourcePath)?.path ?? e.link);
    const newPath = descriptionNotePath(io, sourcePath, imagePath, destDir);
    await io.createNote(newPath, buildDescriptionNote({ imageLink: e.link, sourceName, date: io.date(), model: e.model, category: e.category, tags: e.tags, prose }, map));
    results.push({ path: newPath });
  }
  return { results };
}

/** Transkribiert die EMBEDS einer Notiz nach Markdown (Command/Kontextmenü-Pfad), legt je Bild eine
 *  Notiz an und ersetzt den Bild-Embed durch einen Embed der neuen Notiz. Nicht-destruktiv, idempotent.
 *  Reine Links (embed:false) werden hier bewusst übersprungen — sie sind ein Sidebar-Feature mit
 *  Backlink-Idempotenz (Etappe 1); ohne diesen Schutz würde der Command Re-Transkriptions-Dubletten erzeugen. */
export async function runImgToMd(io: ImgToMdIO, sourcePath: string, opts?: { onlyRaw?: string }): Promise<{ transcribed: number; skipped: number }> {
  const content = await io.readNote(sourcePath);
  let embeds = findImageEmbeds(content).filter(e => e.embed);
  if (opts?.onlyRaw) embeds = embeds.filter(e => e.raw === opts.onlyRaw);
  // Pro Bild-Datei nur einmal: dasselbe Bild mehrfach eingebettet → eine Notiz;
  // replaceEmbed ersetzt unten ohnehin ALLE Vorkommen des raw-Strings.
  const seen = new Set<string>();
  embeds = embeds.filter(e => { if (seen.has(e.link)) return false; seen.add(e.link); return true; });
  if (!embeds.length) { io.notify(t("core.noMatchingImages")); return { transcribed: 0, skipped: 0 }; }
  let skipped = 0;
  const entries: { raw: string; link: string; content: string; model: string; embed: boolean }[] = [];
  for (let i = 0; i < embeds.length; i++) {
    const e = embeds[i];
    const resolved = io.resolveImage(e.link, sourcePath);
    if (!resolved) { io.notify(t("core.imageNotFound", e.link)); skipped++; continue; }
    if (e.kind === "pdf") { io.notify(t("core.pdfUseSidebar", e.link)); skipped++; continue; }
    if (!SUPPORTED_EXTS.includes(resolved.ext.toLowerCase())) { io.notify(t("core.unsupportedFormat", resolved.ext, e.link)); skipped++; continue; }
    io.notify(t("core.transcribing", i + 1, embeds.length));
    let res: { content: string; model: string };
    try {
      const dataUrl = await io.readImageDataUrl(resolved.path, resolved.ext);
      res = await io.transcribe(dataUrl);
    } catch (err) { io.notify(t("core.transcribeFailed", e.link, err instanceof Error ? err.message : String(err))); skipped++; continue; }
    if (!res.content.trim()) { io.notify(t("core.emptyTranscriptLink", e.link)); skipped++; continue; }
    entries.push({ raw: e.raw, link: e.link, content: res.content, model: res.model, embed: e.embed });
  }
  const { results } = await writeTranscripts(io, sourcePath, entries);
  const base = t(results.length === 1 ? "core.transcribed.one" : "core.transcribed.other", results.length);
  io.notify(`${base}${skipped ? t("core.skippedSuffix", skipped) : ""}.`);
  return { transcribed: results.length, skipped };
}
