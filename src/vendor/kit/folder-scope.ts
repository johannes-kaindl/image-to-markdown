// vendored from code-kit@0.91.1, src/ts/pure/folder-scope.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { foldCase } from "./fold-case";
import { normalizeRelPath } from "./rel-path";

/** Which paths lie inside a folder, and the entries of a list that mean "this note" or "all notes in this folder". The same few
 *  lines stood in a dozen places, each with its own answer to four questions; the options below are those four questions, with
 *  the safe answer as the default. Pure string logic: it never reads a vault, and the paths come from the caller.
 *
 *  Origin, measured 2026-10-18 (all `startsWith(folder + "/")` underneath):
 *  - **koda-agent** `core/tools/write-policy.ts` (`inKoda`: both sides normalised, lower case, the folder itself counts),
 *    `core/tools/list.ts` `collectFolderNotes` (NFC, an empty folder is the root, direct children optional, sorted),
 *    `src/main.ts` `addContextFolder` and `expandNotizen` (an entry with `/` at the end is a folder, the rest a single path);
 *  - **obsidian-transmute** `core/vault/scope.ts` `inFolder` (slashes trimmed, an empty folder holds everything, direct children
 *    optional), **vault-crews** `obsidian/vault-port.ts` `listMarkdownFiles` (root holds everything, sorted) and `main.ts`
 *    (an empty root holds nothing), **llm-lab** `core/settings.ts` `pathsExcluded` (an empty folder is dropped first — "an
 *    empty string would be a prefix of every path and turn a typo into a silent plugin" — the folder itself counts),
 *    **mailstone** `import-eml.ts` (the folder itself counts), **paperless-storage** `cache-store.ts` and
 *    **kuro-gamification** `main.ts` (no normalising at all).
 *
 *  The four questions and the default:
 *  - *Does the folder itself count?* (`self`) Three versions said yes, six no. Default **no**: the paths asked about are notes.
 *  - *Does `Inbox` hold `inbox/a.md`?* (`ignoreCase`) Only write-policy compared lower case. Default **no**, as the vault does.
 *  - *Direct children only?* (`recursive`) transmute and koda's `list_notes` have both. Default **all depths**.
 *  - *Does an empty folder hold everything?* (`root`) Four versions said yes, five no or dropped the entry first. Default **no**:
 *    an empty setting that silently becomes "every file" is how `clear()` in paperless-storage would delete the whole vault; a
 *    caller that means the root says `root: true`. The same goes for `/`, `.` and `./`, which are the root spelled out.
 *
 *  What every call does on top, where the local versions differed: names are compared in Unicode normal form C — also a single
 *  entry of {@link expandPathEntries} (koda's `list` did; APFS and Obsidian's `normalizePath` treat a precomposed and a decomposed
 *  umlaut alike, the others did not); `ignoreCase` is `toLowerCase`, not case folding (dotted capital I, sharp s and a final sigma
 *  are not folded); both sides go through
 *  {@link normalizeRelPath} with a leading `/` stripped, so `/Inbox//./a.md` and `Inbox\a.md` are the same path; and a path or
 *  folder with a `..` segment or a NUL byte is **in no folder** (the local versions compared the text, so `a/../b` was "in `a`") —
 *  in the text reading; under `reading: "filesystem"` such a *path* is in every usable folder instead (below, "fail-closed").
 *  The paths that come back are the strings the caller gave, not the normalised ones. Sorting is by UTF-16 code unit, not by
 *  locale, so the order does not depend on the ICU version (koda's reason, stated in `list.ts`).
 *
 *  **No trimming of whitespace**: a name may start or end with a blank. A folder a user typed into a setting is trimmed by the
 *  caller first — llm-lab's `normalizePath` did, and without it `Privat ` no longer holds `Privat/x.md`, so an exclusion would
 *  silently stop excluding. A folder with a `/` at the end is the same folder here; llm-lab compared it against `Privat//` and
 *  matched nothing.
 *
 *  **`reading: "filesystem"` — the path as the strictest file system reads it.** The text reading above compares what was typed; a
 *  disk does not. Measured in the commit review of koda-agent (2026-10-18, `8f14f5b`, `4439e22`, task "folder-scope — Dateisystem-Lesart"):
 *  Windows drops blanks and dots at the end of a name (`Skills `, `Skills.` and `Skills . ` are `Skills`; a no-break space U+00A0 or
 *  U+202F counts as a blank) and reads everything from a `:` on as a data-stream suffix of the name before it (`Skills:x`,
 *  `Skills::$INDEX_ALLOCATION`); case-insensitive volumes fold by Unicode, not by ASCII (long s U+017F is `s`, the Kelvin sign U+212A
 *  is `k`, sharp s is `ss`). A path that passes the text reading as "not in `Skills`" can land in `Skills` on disk. Everyone who uses
 *  this module as a **write boundary** (a protected folder, an exclusion list, a delete scope) takes the filesystem reading for the
 *  folders it guards. Per segment, on both sides: `U+00A0`/`U+202F` to a blank, cut at the first `:`, strip blanks and dots at the
 *  end, NFKC, then upper and lower case in turn (which is full case folding: `ß` → `SS` → `ss`). `ignoreCase` is implied and
 *  ignored; `self`, `recursive` and `root` mean what they mean in the text reading, and a folder with `..` or NUL is unusable just the same
 *  (it holds nothing). A segment
 *  with nothing left after this (`...`, a lone blank, `:x`) drops out of the path like a `.` segment: whether a disk reads `...` as
 *  the folder itself or as a name of its own is **not measured here** (the .NET path rules recalled, not checked on Windows say it is
 *  a valid name), and the wider side is the safe one for a guarded folder. A folder
 *  that is nothing but such segments (`...`) is not the root: only the text reading places anything inside it.
 *  NFKC can turn a character into a dot or a separator (U+2025 into `..`, U+FF0F into `/`); a name for which it does is only
 *  case-folded, never read through NFKC. Patterns: only `*` and `**` wildcards are read correctly ({@link filesystemPath}); `:`, `{}` and `[]` in a pattern take the same rules as in a name.
 *
 *  **Fail-closed (0.36.0, a change of behaviour).** A *path* that cannot be read at all — a `..` segment or a NUL byte — is **inside every
 *  usable folder** under `reading: "filesystem"`, whatever `self` and `recursive` say, in {@link isInFolder}, {@link pathsInFolder} and
 *  {@link countInFolders} alike. Until 0.35.0 it was "in no folder", which is fail-open for a guard: `Privat/../x` slipped past an exclusion
 *  of `Privat`. A guard cannot tell where such a path would land, so it treats it as inside. Unchanged: a folder with `..` or NUL is
 *  unusable and stays empty (an unreadable path is not in it either); an empty folder without `root: true` holds nothing, the unreadable
 *  path included (an empty setting guards nothing — it does not turn into "everything"); the text reading answers `false` for an unreadable
 *  path as before, so an *allowed* zone (text reading) never takes one in. A caller that hands over paths from outside may still refuse
 *  `..` itself before the check; it no longer has to for the guard to hold.
 *
 *  **Which way to read depends on which way the boundary protects.** `reading: "filesystem"` answers "inside" if the filesystem
 *  reading OR the text reading (case-folded) says so, so it is the *wider* answer by construction — nothing the text puts inside a
 *  folder falls out — and it adds the spellings above. So: for a folder that is **guarded** (protected, excluded, never written
 *  without asking), a path is inside if `reading: "filesystem"` says so. For a zone that is **allowed** ("free to write here"), keep
 *  the text reading, the narrower one — `Koda /x.md` is not in `Koda`, even if Windows would put it there — and still ask the
 *  filesystem reading for each guarded subfolder, as koda's `writePolicy` does. Not covered: 8.3 short names (`PROGRA~1`), HFS+
 *  ignorable code points, and a volume that normalises differently from NFKC — NFKC is wider than any of them, which errs towards
 *  "inside".
 *  A boundary that is a list of **glob patterns** rather than folders (a deny list like `_crews/**`) uses {@link filesystemPath}: match each
 *  pattern against the path as given and against its filesystem reading, and read the patterns by the same segment rules, or the
 *  two sides are different spellings and nothing matches. The filesystem reading of a path can be its parent (`Koda/Skills/:x` is
 *  `Koda/Skills`): `Koda/Skills/**` does not match it, the path as given does — which is why both are matched.
 *
 *  Linear in the total length of the paths (plus the sort); {@link expandPathEntries} splits the list of known paths once, not
 *  once per entry, and {@link countInFolders} counts many folders in one pass over the paths. */
export interface FolderScopeOptions {
  /** Default `true`. `false`: only the direct children of the folder. */
  recursive?: boolean;
  /** Default `false`. `true`: the folder itself is inside (`Inbox` in `Inbox`). */
  self?: boolean;
  /** Default `false`. `true`: compare lower case. Ignored under `reading: "filesystem"`, which always folds. */
  ignoreCase?: boolean;
  /** Default `"text"`: names as typed, NFC (and `toLowerCase` with `ignoreCase`). `"filesystem"`: names as the strictest file
   *  system reads them — blanks and dots at the end dropped, `:` suffix cut, Unicode case folding. Use it for every folder a
   *  write boundary guards; see the module comment for which direction each reading protects. */
  reading?: "text" | "filesystem";
  /** Default `false`. `true`: an empty folder is the vault root and holds every path. */
  root?: boolean;
}

/** One name as the strictest file system reads it (see the module comment), or null if nothing is left of it — `...`, a lone blank,
 *  `:x`: the name drops out of the path like a `.` segment, which is the *wider* side (`Koda/.../Skills` is then `Koda/Skills`). NFKC
 *  can write a separator or a dot where the name had none (U+2025 is `..`, U+FF0E `.`, U+FF0F `/`): such a name is not read through
 *  NFKC but only case-folded, so no reading of a name ever yields a `.`, a `..` or a `/` inside a segment. */
function filesystemName(segment: string): string | null {
  const cut = (segment.replace(/[\u00a0\u202f]/g, " ").split(":")[0] ?? "").replace(/[ .]+$/, "");
  if (cut === "") return null;
  const read = foldCase(cut.normalize("NFKC"));
  if (read === "." || read === ".." || read.includes("/") || read.includes("\\")) return foldCase(cut);
  return read;
}

type Reading = Pick<FolderScopeOptions, "ignoreCase" | "reading">;

function textSegments(segments: readonly string[], ignoreCase: boolean): string[] {
  return segments.map((s) => {
    const n = s.normalize("NFC");
    return ignoreCase ? n.toLowerCase() : n;
  });
}

function segmentsOf(path: string, reading: Reading): string[] | null {
  const r = normalizeRelPath(path, { absolute: "strip", allowEmpty: true });
  if (!r.ok) return null;
  if (reading.reading === "filesystem") return r.segments.flatMap((seg) => filesystemName(seg) ?? []);
  return textSegments(r.segments, reading.ignoreCase === true);
}

/** A path split for the test of a folder: as typed (`text`) and, under `reading: "filesystem"`, as the file system reads it. */
interface Parts { text: readonly string[]; fs: readonly string[] | null }

function partsOf(path: string, options: FolderScopeOptions): Parts | null {
  const r = normalizeRelPath(path, { absolute: "strip", allowEmpty: true });
  if (!r.ok) return null;
  if (options.reading !== "filesystem") return { text: textSegments(r.segments, options.ignoreCase === true), fs: null };
  return { text: textSegments(r.segments, true), fs: r.segments.flatMap((seg) => filesystemName(seg) ?? []) };
}

function underBase(base: readonly string[], p: readonly string[], recursive: boolean, self: boolean): boolean {
  if (p.length < base.length) return false;
  for (let i = 0; i < base.length; i++) if (p[i] !== base[i]) return false;
  const below = p.length - base.length;
  if (below === 0) return self;
  return recursive || below === 1;
}

/** What a folder asks of a path, worked out once: the folder split in the text reading (`text`, null if it holds nothing there — an
 *  empty folder without `root`) and in the file system reading (`fs`, null if it holds nothing there or the text reading is in use),
 *  the shape of the match, and `unreadable`: whether a path that cannot be read at all (a `..`, a NUL) is inside. {@link scopeOf} and
 *  {@link countInFolders} both read this, so a rule changes in one place. */
interface Plan {
  text: readonly string[] | null;
  fs: readonly string[] | null;
  recursive: boolean;
  self: boolean;
  unreadable: boolean;
}

/** The plan of one folder, or null if the folder is unusable (a `..` or a NUL in it) — then nothing is inside, an unreadable path
 *  included. */
function planOf(folder: string, options: FolderScopeOptions): Plan | null {
  const base = partsOf(folder, options);
  if (base === null) return null;
  // An empty folder holds nothing unless it is declared the root. In the file system reading the folder must be empty in the
  // text too: `...` is not the root.
  const textIsEmpty = base.text.length === 0;
  const textActive = !textIsEmpty || options.root === true;
  // `...` or `:x` as a folder: empty here, not in the text — only the text reading can place anything inside it.
  const fsUsable = base.fs !== null && (textIsEmpty ? options.root === true : base.fs.length > 0);
  return {
    text: textActive ? base.text : null,
    fs: fsUsable ? base.fs : null,
    recursive: options.recursive !== false,
    self: options.self === true,
    // Fail-closed: the file system reading is the reading for guards, and a path nobody can read is not "in no folder" there. An
    // empty folder without `root` still holds nothing (an empty setting guards nothing, as in the text reading).
    unreadable: base.fs !== null && textActive,
  };
}

/** The test of one folder on a path that is already split ({@link partsOf}; null for a path that cannot be read), or null if the
 *  folder is unusable (a `..` or a NUL in it) — then nothing is inside. Under `reading: "filesystem"` a path is inside if EITHER
 *  reading puts it inside: the result is the wider one by construction, whatever a name does in the file system reading (a segment
 *  that drops out, a folder that is nothing there) — a guard never protects less than the text reading did. A path that cannot be
 *  read at all is inside every usable folder there (see {@link Plan}); in the text reading it is in none. */
function scopeOf(folder: string, options: FolderScopeOptions): ((parts: Parts | null) => boolean) | null {
  const plan = planOf(folder, options);
  if (plan === null) return null;
  return (parts) => {
    if (parts === null) return plan.unreadable;
    if (plan.text !== null && underBase(plan.text, parts.text, plan.recursive, plan.self)) return true;
    return plan.fs !== null && parts.fs !== null && underBase(plan.fs, parts.fs, plan.recursive, plan.self);
  };
}

/** The path as the strictest file system reads it (the `filesystem` reading, see the module comment), segments joined with `/`,
 *  or null for a path with a `..` segment or a NUL. For a boundary that is not a folder test: a deny list of glob patterns
 *  (`_crews/**`) is matched against **both** the path as given and `filesystemPath(path)`, and the patterns must be read by the
 *  same segment rules (`filesystemPath("_crews /**")` is `_crews/**`; a wildcard segment such as `*.md` or `**` is unchanged), or
 *  the comparison compares two different spellings. Leading and doubled slashes, `.` segments and `\` are gone, as in
 *  {@link normalizeRelPath}; the vault root is `""`. */
export function filesystemPath(path: string): string | null {
  const segments = segmentsOf(path, { reading: "filesystem" });
  return segments === null ? null : segments.join("/");
}

/** Whether `path` lies inside `folder` (whole segments: `Inbox` does not hold `Inbox-Archiv/x.md`). */
export function isInFolder(path: string, folder: string, options: FolderScopeOptions = {}): boolean {
  const inside = scopeOf(folder, options);
  return inside !== null && inside(partsOf(path, options));
}

/** The paths of `paths` that lie inside `folder`, as given, sorted by UTF-16 code unit. A new array. */
export function pathsInFolder(paths: readonly string[], folder: string, options: FolderScopeOptions = {}): string[] {
  const inside = scopeOf(folder, options);
  if (inside === null) return [];
  return paths.filter((path) => inside(partsOf(path, options))).sort();
}

/** A folder base per node, the paths walked down it: {@link countInFolders} looks up the folders along the path instead of asking each
 *  folder about each path. */
interface TrieNode { next: Map<string, TrieNode>; scopes: number[] }

function trieInsert(root: TrieNode, base: readonly string[], scope: number): void {
  let node = root;
  for (const seg of base) {
    let child = node.next.get(seg);
    if (child === undefined) {
      child = { next: new Map(), scopes: [] };
      node.next.set(seg, child);
    }
    node = child;
  }
  node.scopes.push(scope);
}

/** How many of `paths` lie inside each of `folders` — for every folder `pathsInFolder(paths, folder, options).length`, in one pass over
 *  the paths instead of one per folder (a tree of 1 500 folders over 5 000 notes took about 4 s with a call per folder). The key is
 *  the folder as it was given, in the order of `folders` (given twice, it is one key); an unusable folder (a `..` or a NUL in it) counts
 *  0. Same options and readings as {@link isInFolder}, an unreadable path included (under `reading: "filesystem"` it counts in every
 *  usable folder); a path counts once per folder, also when both readings put it inside; a path given twice counts twice. Linear in the
 *  total length of the paths and folders. */
export function countInFolders(paths: readonly string[], folders: readonly string[], options: FolderScopeOptions = {}): Map<string, number> {
  // Folders that read the same share one scope, so the work does not grow with the spellings of one folder.
  const scopeIds = new Map<string, number>();
  const scopes: Plan[] = [];
  const scopeOfFolder = new Map<string, number | null>();
  const textTrie: TrieNode = { next: new Map(), scopes: [] };
  const fsTrie: TrieNode = { next: new Map(), scopes: [] };
  for (const folder of folders) {
    if (scopeOfFolder.has(folder)) continue;
    const plan = planOf(folder, options);
    if (plan === null) {
      scopeOfFolder.set(folder, null);
      continue;
    }
    const key = JSON.stringify([plan.text, plan.fs, plan.unreadable]);
    let id = scopeIds.get(key);
    if (id === undefined) {
      id = scopes.length;
      scopeIds.set(key, id);
      scopes.push(plan);
      if (plan.text !== null) trieInsert(textTrie, plan.text, id);
      if (plan.fs !== null) trieInsert(fsTrie, plan.fs, id);
    }
    scopeOfFolder.set(folder, id);
  }

  const recursive = options.recursive !== false;
  const self = options.self === true;
  const counts = new Array<number>(scopes.length).fill(0);
  const stamp = new Array<number>(scopes.length).fill(-1);
  let unreadable = 0;
  const walk = (root: TrieNode, segments: readonly string[], pathIndex: number): void => {
    let node = root;
    for (let depth = 0; ; depth++) {
      if (node.scopes.length > 0) {
        const below = segments.length - depth;
        if (below === 0 ? self : recursive || below === 1) {
          for (const id of node.scopes) {
            if (stamp[id] === pathIndex) continue;
            stamp[id] = pathIndex;
            counts[id] = (counts[id] ?? 0) + 1;
          }
        }
      }
      const seg = segments[depth];
      const child = seg === undefined ? undefined : node.next.get(seg);
      if (child === undefined) return;
      node = child;
    }
  };
  paths.forEach((path, index) => {
    const parts = partsOf(path, options);
    if (parts === null) {
      unreadable++;
      return;
    }
    walk(textTrie, parts.text, index);
    if (parts.fs !== null) walk(fsTrie, parts.fs, index);
  });

  const result = new Map<string, number>();
  for (const [folder, id] of scopeOfFolder) {
    const plan = id === null ? undefined : scopes[id];
    result.set(folder, id === null || plan === undefined ? 0 : (counts[id] ?? 0) + (plan.unreadable ? unreadable : 0));
  }
  return result;
}

export interface ExpandedEntries {
  /** The notes the entries name, each once, in the order of the entries; the notes of one folder sorted. */
  paths: string[];
  /** The entries that point at nothing, word for word as they were given (so the caller can say which). */
  missing: string[];
}

/** Resolves a list of entries against the notes that exist. An entry with a `/` at the end is a folder and becomes all notes
 *  below it, at any depth; any other entry is one note and stays if `knownPaths` holds it — case as in the vault, but a name in
 *  another Unicode normal form or with a doubled slash is the same note — and comes back spelled as `knownPaths` spells it. An
 *  entry is `missing` if it names no note (an unknown note, a folder without a note), if it is empty after normalising (`""`,
 *  `.`, `/` — the root is **not** a way to select every note), or if it has a `..` or a NUL. A trailing `\` does not make a
 *  folder: only `/` does. The list of known paths is split once, however many entries there are. */
export function expandPathEntries(entries: readonly string[], knownPaths: readonly string[]): ExpandedEntries {
  const known: Array<{ path: string; segments: string[] }> = [];
  const byKey = new Map<string, string>();
  for (const path of knownPaths) {
    const segments = segmentsOf(path, {});
    if (segments === null) continue;
    known.push({ path, segments });
    const key = segments.join("/");
    if (!byKey.has(key)) byKey.set(key, path);
  }
  const seen = new Set<string>();
  const paths: string[] = [];
  const missing: string[] = [];
  const add = (p: string): void => {
    if (seen.has(p)) return;
    seen.add(p);
    paths.push(p);
  };
  for (const entry of entries) {
    const segments = segmentsOf(entry, {});
    if (segments === null || segments.length === 0) {
      missing.push(entry);
      continue;
    }
    if (entry.endsWith("/")) {
      const inside = scopeOf(entry, {});
      const hits = known.filter((k) => inside?.({ text: k.segments, fs: null }) === true).map((k) => k.path).sort();
      if (hits.length === 0) missing.push(entry);
      else hits.forEach(add);
    } else {
      const hit = byKey.get(segments.join("/"));
      if (hit === undefined) missing.push(entry);
      else add(hit);
    }
  }
  return { paths, missing };
}
