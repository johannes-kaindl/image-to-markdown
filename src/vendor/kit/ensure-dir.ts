// vendored from code-kit@0.91.1, src/ts/pure/ensure-dir.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Create a folder together with every missing parent, through the two calls every file adapter has. No I/O of its own: the store is injected, so the
 *  module runs against Obsidian's `DataAdapter`, a Node `fs.promises` wrapper, a Capacitor filesystem or a test double alike.
 *
 *  Origin: lifted from `ensureDir` of obsidian-kit `src/obsidian/file-snapshot.ts` (the version `device-files` reused) and compared with the six other
 *  private copies in the plugins (diachronic `stand-store`, koda-agent `main`, obsidian-transmute `snapshot-io`, protocol-droid `meeting-folder`,
 *  settings-assistant `config-io`, vault-crews `snapshot-store`; Welle 37, kit-a). Where they differed, this file takes the better behaviour:
 *
 *  - **Parents are made top-down and one at a time**, because an adapter's `mkdir` is not recursive on every platform (koda-agent and the one-level
 *    `ensureDir` of diachronic call `mkdir` on the whole path, obsidian-transmute never asks for the top-level folder: each fails where a parent is
 *    missing). The loop is iterative, the depth of a path does not become the depth of the call stack.
 *  - **The deepest folder that exists is looked up from the bottom**, so a folder that exists costs one `exists` call and a missing leaf under an existing
 *    parent two (the copies that walk from the top ask once per level whatever is missing).
 *  - **A leading slash is kept** (`/a/b` stays absolute: `/a`, `/a/b`), an empty segment from a trailing or doubled slash is skipped (`a/b/` and `a//b`
 *    are `a/b`: four copies made a folder literally named `a/b/`), and `""` or `"/"` do nothing and ask nothing (six of the eight functions called
 *    `mkdir("")` or made a folder named `/`). A vault path has no leading slash (`normalizeVaultDir` strips it); a caller that wants that passes it first.
 *  - **A parallel call that wins the race is not an error.** When `mkdir` throws, `exists` is asked once more; if the folder is there now, the throw is
 *    swallowed, otherwise the original error goes on. The effect is checked, not the error text (it differs between Obsidian versions and platforms).
 *    Only mailstone's private `ensureFolder` did this before (on `createFolder`); none of the seven `ensureDir` copies did.
 *
 *  Not covered: `.` and `..` are segments like any other (the caller normalises the path first, e.g. `normalizePath`), and a *file* in the way looks like
 *  an existing folder, because `exists` cannot tell them apart; the next write names the problem. */

/** What `ensureDir` needs from a file store: Obsidian's `DataAdapter` has it, so has `BinaryStore` of `chunk-journal`. */
export interface DirStore {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
}

/** The folder `path` and each missing parent exist afterwards (see the header for what counts as a path). Rejects with the store's error when a folder
 *  cannot be created and is not there either. */
export async function ensureDir(store: DirStore, path: string): Promise<void> {
  const parts = path.split("/").filter((part) => part !== "");
  const prefix = path.startsWith("/") ? "/" : "";
  const full = prefix + parts.join("/");
  // `ends[i]` is where the name of the folder at depth i + 1 ends in `full`: the prefixes are cut on demand, not built (a deep path stays linear)
  const ends: number[] = [];
  let at = prefix.length;
  for (const part of parts) { at += part.length; ends.push(at); at += 1; }
  const dirAt = (i: number): string => full.slice(0, ends[i] ?? 0);
  let have = ends.length; // the deepest folder that exists, as a depth (0: none), found from the bottom: a missing leaf under an existing parent is two calls
  while (have > 0 && !(await store.exists(dirAt(have - 1)))) have--;
  for (let i = have; i < ends.length; i++) {
    const dir = dirAt(i);
    try {
      await store.mkdir(dir);
    } catch (error) {
      if (!(await store.exists(dir))) throw error;
    }
  }
}
