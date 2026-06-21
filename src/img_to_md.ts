import { t } from "./i18n";

export const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "heic", "heif"];
export const SUPPORTED_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];

export interface ImageEmbed { raw: string; link: string; ext: string }

function extOf(link: string): string {
  const clean = link.split("#")[0].split("|")[0].trim();
  const dot = clean.lastIndexOf(".");
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : "";
}

/** Findet eingebettete Bilder: ![[link.ext]] (Wikilink) und ![alt](pfad) (Markdown, externe http(s) aus). */
export function findImageEmbeds(content: string): ImageEmbed[] {
  const out: ImageEmbed[] = [];
  let m: RegExpExecArray | null;
  const wiki = /!\[\[([^\]]+?)\]\]/g;
  while ((m = wiki.exec(content)) !== null) {
    const link = m[1].split("#")[0].split("|")[0].trim();
    const ext = extOf(link);
    if (IMAGE_EXTS.includes(ext)) out.push({ raw: m[0], link, ext });
  }
  const md = /!\[[^\]]*\]\(([^)]+?)\)/g;
  while ((m = md.exec(content)) !== null) {
    const link = m[1].trim();
    if (/^https?:\/\//i.test(link)) continue;
    const ext = extOf(link);
    if (IMAGE_EXTS.includes(ext)) out.push({ raw: m[0], link, ext });
  }
  return out;
}

/** Baut die Transkript-Notiz: Frontmatter-Ref + Foto-Embed oben + Transkript. */
export function buildTranscriptNote(o: { imageLink: string; sourceName: string; date: string; model: string; transcript: string }): string {
  const esc = (s: string) => s.replace(/"/g, '\\"');   // YAML-Doppelquote-String — schützt vor Frontmatter-Bruch
  return [
    "---",
    `source_image: "[[${esc(o.imageLink)}]]"`,
    `source_note: "[[${esc(o.sourceName)}]]"`,
    `created: ${o.date}`,
    `transcribed_by: "${esc(o.model)}"`,
    "---",
    `![[${o.imageLink}]]`,
    "",
    o.transcript,
    "",
  ].join("\n");
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
function basenameNoExt(path: string): string { const b = path.slice(path.lastIndexOf("/") + 1); const d = b.lastIndexOf("."); return d >= 0 ? b.slice(0, d) : b; }

/** Pfad für die Transkript-Notiz: neben der Quellnotiz, Basename des Bildes, kollisionsfrei. */
export function transcriptNotePath(io: { noteExists(p: string): boolean }, sourcePath: string, imagePath: string): string {
  return uniqueNotePath(io, dirOf(sourcePath), basenameNoExt(imagePath));
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

/** Schreibt mehrere Transkripte gebündelt: Quelle EINMAL lesen, pro Eintrag Notiz anlegen
 *  + Embed ersetzen (akkumuliert), Quelle EINMAL schreiben. Leere Transkripte werden
 *  übersprungen. Nicht-destruktiv/idempotent; keine Read-Modify-Write-Race. */
export async function writeTranscripts(
  io: ImgToMdIO, sourcePath: string,
  entries: { raw: string; link: string; content: string; model: string }[],
): Promise<{ paths: string[] }> {
  const before = await io.readNote(sourcePath);
  let content = before;
  const sourceName = basenameNoExt(sourcePath);
  const paths: string[] = [];
  for (const e of entries) {
    const transcript = e.content.trim();
    if (!transcript) continue;
    const resolved = io.resolveImage(e.link, sourcePath);
    const imagePath = resolved?.path ?? e.link;
    const newPath = transcriptNotePath(io, sourcePath, imagePath);
    await io.createNote(newPath, buildTranscriptNote({ imageLink: e.link, sourceName, date: io.date(), model: e.model, transcript }));
    content = replaceEmbed(content, e.raw, basenameNoExt(newPath));
    paths.push(newPath);
  }
  if (content !== before) await io.writeNote(sourcePath, content);
  return { paths };
}

/** Transkribiert die Bilder einer Notiz nach Markdown, legt je Bild eine Notiz an und
 *  ersetzt den Bild-Link durch einen Embed der neuen Notiz. Nicht-destruktiv, idempotent. */
export async function runImgToMd(io: ImgToMdIO, sourcePath: string, opts?: { onlyRaw?: string }): Promise<{ transcribed: number; skipped: number }> {
  const content = await io.readNote(sourcePath);
  let embeds = findImageEmbeds(content);
  if (opts?.onlyRaw) embeds = embeds.filter(e => e.raw === opts.onlyRaw);
  // Pro Bild-Datei nur einmal: dasselbe Bild mehrfach eingebettet → eine Notiz;
  // replaceEmbed ersetzt unten ohnehin ALLE Vorkommen des raw-Strings.
  const seen = new Set<string>();
  embeds = embeds.filter(e => { if (seen.has(e.link)) return false; seen.add(e.link); return true; });
  if (!embeds.length) { io.notify(t("core.noMatchingImages")); return { transcribed: 0, skipped: 0 }; }
  let skipped = 0;
  const entries: { raw: string; link: string; content: string; model: string }[] = [];
  for (let i = 0; i < embeds.length; i++) {
    const e = embeds[i];
    const resolved = io.resolveImage(e.link, sourcePath);
    if (!resolved) { io.notify(t("core.imageNotFound", e.link)); skipped++; continue; }
    if (!SUPPORTED_EXTS.includes(resolved.ext.toLowerCase())) { io.notify(t("core.unsupportedFormat", resolved.ext, e.link)); skipped++; continue; }
    io.notify(t("core.transcribing", i + 1, embeds.length));
    let res: { content: string; model: string };
    try {
      const dataUrl = await io.readImageDataUrl(resolved.path, resolved.ext);
      res = await io.transcribe(dataUrl);
    } catch (err) { io.notify(t("core.transcribeFailed", e.link, err instanceof Error ? err.message : String(err))); skipped++; continue; }
    if (!res.content.trim()) { io.notify(t("core.emptyTranscriptLink", e.link)); skipped++; continue; }
    entries.push({ raw: e.raw, link: e.link, content: res.content, model: res.model });
  }
  const { paths } = await writeTranscripts(io, sourcePath, entries);
  const base = t(paths.length === 1 ? "core.transcribed.one" : "core.transcribed.other", paths.length);
  io.notify(`${base}${skipped ? t("core.skippedSuffix", skipped) : ""}.`);
  return { transcribed: paths.length, skipped };
}
