// vendored from obsidian-kit@0.111.0, src/obsidian/create-note.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { normalizePath, type App, type TFile } from "obsidian";
import { ensureDir } from "../kit/ensure-dir";
import { errorMessage } from "../kit/error-message";
import { firstFreeNameAsync } from "../kit/filename-policy";
import { safeFileName } from "./safe-file-name";

/** Eine neue Markdown-Notiz in einem Ordner anlegen, ohne etwas zu überschreiben (seit 0.111.0, Welle 37 Nachlauf, n-kit, B2; Bestellung von lingotuner für den Schreibweg
 *  „Neue Notiz“ im Auftrags-Fenster, `acceptPanel(…, "note")`). Bis dahin rief jedes Plugin `vault.create` selbst (gemessen: 18 Plugins) und nummerierte mit eigener Schleife
 *  (lingotuner `createTunedNote`: ` 2`, ` 3` …; paperless-storage `uniqueStubPath`: ` 2`; image-to-markdown `uniqueNotePath` und protocol-droid: `-2`). Hier aus Bestehendem
 *  zusammengesetzt:
 *  - **Ordner:** vault-relativ, über `normalizePath`; `""` und `"/"` heißen Wurzel. Ein fehlender Ordner wird samt Eltern angelegt (`ensureDir`, code-kit).
 *  - **Name:** ohne `.md`; durch `safeFileName` (Richtlinie des Plugins `filename-sanitizer`, sonst die Kit-Regeln), also nie leer und ohne Zeichen, die Links brechen.
 *  - **Kollision:** der erste freie Name der Form `Name.md`, `Name 2.md`, `Name 3.md` … (`firstFreeNameAsync`, Stil `space`, wie lingotuner und paperless-storage; Obsidians eigene
 *    Duplikatform `Name 1.md` zählt ab 1 und ist eine andere). Belegt heißt: der Vault kennt den Pfad oder der Adapter meldet ihn (auch eine Datei, die der Vault nicht listet,
 *    und auf einem Dateisystem ohne Groß-/Kleinschreibung eine andere Schreibweise), wie bei `createAttachmentFile`.
 *  - **Ordner mit `.` oder `..` als Abschnitt** wird abgelehnt (`ok: false`), ohne etwas anzulegen.
 *  - **Wirft nie.** Ein Fehler (Ordner nicht anlegbar, ein zweiter Schreiber legt denselben Pfad zwischen Prüfung und Anlegen an) kommt als `{ ok: false }` mit Pfad und Meldung.
 *  Kein Öffnen: das entscheidet der Aufrufer (lingotuner öffnet in einem neuen Tab). */
export type CreateNoteResult =
  | { ok: true; file: TFile; path: string }
  | { ok: false; path: string; message: string };

export interface CreateNoteOptions {
  /** Vault-relativer Ordner; `""` oder `"/"` = Wurzel. */
  folder: string;
  /** Name ohne `.md`. */
  name: string;
  content: string;
  /** Kennung des aufrufenden Plugins für `filename-sanitizer` (dessen Protokoll nennt sie). */
  caller: string;
}

export async function createNote(app: App, o: CreateNoteOptions): Promise<CreateNoteResult> {
  let path = "";
  try {
    const folder = normalizePath(o.folder.trim());
    const atRoot = folder === "" || folder === "/";
    // `normalizePath` löst `.` und `..` nicht auf, `ensureDir` nimmt sie als gewöhnlichen Abschnitt: ein Ordner aus einer Einstellung darf nicht aus dem Vault zeigen (Gegenlesung B2, Befund 6).
    // Geprüft am Rohwert (auch `\\` als Trenner): ob `normalizePath` ein `./` verschluckt, soll hier nichts entscheiden.
    if (o.folder.trim().split(/[\\/]/).some((part) => part === "." || part === "..")) return { ok: false, path: o.folder, message: `invalid folder: ${o.folder}` };
    const name = safeFileName(app, `${o.name}.md`, { caller: o.caller }).name;
    const want = atRoot ? name : `${folder}/${name}`;
    path = want;
    if (!atRoot) await ensureDir(app.vault.adapter, folder);
    path = await firstFreeNameAsync(want, "file", async (p) => app.vault.getAbstractFileByPath(p) !== null || (await app.vault.adapter.exists(p)));
    const file = await app.vault.create(path, o.content);
    return { ok: true, file, path };
  } catch (error) {
    return { ok: false, path, message: errorMessage(error) };
  }
}
