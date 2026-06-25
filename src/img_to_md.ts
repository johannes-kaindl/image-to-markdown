import { t } from "./i18n";

export const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "heic", "heif"];
export const SUPPORTED_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];
export const PDF_EXT = "pdf";

export interface ImageEmbed { raw: string; link: string; ext: string; kind: "image" | "pdf"; page?: number; embed: boolean }

export function extOf(link: string): string {
  const clean = link.split("#")[0].split("|")[0].trim();
  const dot = clean.lastIndexOf(".");
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : "";
}

/** Klassifiziert eine Datei-Extension als transkribierbare Selbst-Quelle. */
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

/** Baut die Transkript-Notiz: Frontmatter-Ref + Foto-Embed oben + Transkript. */
export function buildTranscriptNote(o: { imageLink: string; sourceName?: string; date: string; model: string; transcript: string }): string {
  const esc = (s: string) => s.replace(/"/g, '\\"');   // YAML-Doppelquote-String — schützt vor Frontmatter-Bruch
  const lines = ["---", `source_image: "[[${esc(o.imageLink)}]]"`];
  if (o.sourceName !== undefined) lines.push(`source_note: "[[${esc(o.sourceName)}]]"`);
  lines.push(`created: ${o.date}`, `transcribed_by: "${esc(o.model)}"`, "---", `![[${o.imageLink}]]`, "", o.transcript, "");
  return lines.join("\n");
}

/** Override: erhält das komplette Frontmatter der alten Notiz, ersetzt transcribed_by (+ pages bei PDF)
 *  und den Body. Quelle/Quellnotiz/created bleiben damit unverändert. */
export function rewriteTranscript(old: string, o: { model: string; sourceLink: string; body: string; pages?: string }): string {
  const esc = (s: string) => s.replace(/"/g, '\\"');
  const fm = /^---\n([\s\S]*?)\n---/.exec(old);
  // Fallback nur theoretisch — Override wirkt ausschließlich auf unsere Transkript-Notizen, die immer Frontmatter haben.
  let frontmatter = fm ? fm[1] : `transcribed_by: "${esc(o.model)}"`;
  frontmatter = frontmatter.replace(/^transcribed_by:.*$/m, `transcribed_by: "${esc(o.model)}"`);
  if (o.pages !== undefined) {
    frontmatter = /^pages:.*$/m.test(frontmatter)
      ? frontmatter.replace(/^pages:.*$/m, `pages: "${o.pages}"`)
      : `${frontmatter}\npages: "${o.pages}"`;
  }
  return `---\n${frontmatter}\n---\n![[${o.sourceLink}]]\n\n${o.body}\n`;
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

function transcriptSuffix(kind: "image" | "pdf"): string {
  return t(kind === "pdf" ? "note.suffix.pdf" : "note.suffix.image");
}

/** Pfad für die Transkript-Notiz: unter `destDir` (falls gesetzt) bzw. neben der Quellnotiz,
 *  Basename des Bildes + lokalisierter Suffix, kollisionsfrei. */
export function transcriptNotePath(io: { noteExists(p: string): boolean }, sourcePath: string, imagePath: string, kind: "image" | "pdf", destDir?: string): string {
  const base = `${basenameNoExt(imagePath)} ${transcriptSuffix(kind)}`;
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
  entries: { raw: string; link: string; content: string; model: string; overwritePath?: string; embed?: boolean }[],
  opts?: { selfSource?: boolean; destDir?: string },
): Promise<{ paths: string[] }> {
  const self = opts?.selfSource === true;
  const destDir = opts?.destDir;
  const before = self ? "" : await io.readNote(sourcePath);
  let content = before;
  const sourceName = self ? undefined : basenameNoExt(sourcePath);
  const paths: string[] = [];
  for (const e of entries) {
    const transcript = e.content.trim();
    if (!transcript) continue;
    if (e.overwritePath) {
      const old = await io.readNote(e.overwritePath);
      await io.writeNote(e.overwritePath, rewriteTranscript(old, { model: e.model, sourceLink: e.link, body: transcript }));
      paths.push(e.overwritePath);
      continue;
    }
    const imagePath = self ? sourcePath : (io.resolveImage(e.link, sourcePath)?.path ?? e.link);
    const newPath = transcriptNotePath(io, sourcePath, imagePath, "image", destDir);
    await io.createNote(newPath, buildTranscriptNote({ imageLink: e.link, sourceName, date: io.date(), model: e.model, transcript }));
    if (!self && e.embed !== false) content = replaceEmbed(content, e.raw, basenameNoExt(newPath));
    paths.push(newPath);
  }
  if (!self && content !== before) await io.writeNote(sourcePath, content);
  return { paths };
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
  const { paths } = await writeTranscripts(io, sourcePath, entries);
  const base = t(paths.length === 1 ? "core.transcribed.one" : "core.transcribed.other", paths.length);
  io.notify(`${base}${skipped ? t("core.skippedSuffix", skipped) : ""}.`);
  return { transcribed: paths.length, skipped };
}
