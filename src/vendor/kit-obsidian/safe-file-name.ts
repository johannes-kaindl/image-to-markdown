// vendored from obsidian-kit@0.111.0, src/obsidian/safe-file-name.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { applyPolicy, DEFAULT_FILENAME_POLICY, type FilenameHit, type SegmentKind } from "../kit/filename-policy";
import { FILENAME_SANITIZER_PLUGIN_ID, isFilenameSanitizerApi } from "../kit/filename-sanitizer-source";
import { readPluginApi } from "./plugin-api";

export interface SafeFileNameResult { name: string; changed: boolean; hits: FilenameHit[]; source: "plugin" | "kit" }

/**
 * Bringt einen einzelnen Dateinamen (ein Segment, kein Pfad) in die Richtlinie des Nutzers: über die API des Plugins
 * `filename-sanitizer`, wenn es läuft und ein brauchbares Ergebnis liefert, sonst mit den Kit-Regeln (`applyPolicy` mit
 * `DEFAULT_FILENAME_POLICY`). Die API wird bei jedem Aufruf frisch gelesen. Wirft die API, antwortet sie mit `ApiError` oder fehlt dem
 * Ergebnis ein nichtleerer String `name`, gilt der Rückfall. Kollisionen löst der Aufrufer (`numberedName` aus `filename-policy`);
 * der Name ist nie leer. `source` sagt, wer geantwortet hat.
 *
 * @example
 * const r = safeFileName(app, "Plan: Q1?.md", { caller: "mein-plugin" }); // r.name === "Plan — Q1.md", r.source === "kit" ohne Plugin
 */
export function safeFileName(app: unknown, name: string, opts: { caller: string; kind?: SegmentKind }): SafeFileNameResult {
  const kind: SegmentKind = opts.kind ?? "file";
  const api = readPluginApi(app, FILENAME_SANITIZER_PLUGIN_ID, isFilenameSanitizerApi);
  if (api !== null) {
    try {
      const r: unknown = api.sanitizeName(name, opts.kind === undefined ? { caller: opts.caller } : { caller: opts.caller, kind });
      if (r !== null && typeof r === "object") {
        const o = r as { name?: unknown; changed?: unknown; hits?: unknown };
        if (typeof o.name === "string" && o.name !== "") {
          return {
            name: o.name,
            changed: typeof o.changed === "boolean" ? o.changed : o.name !== name,
            hits: Array.isArray(o.hits) ? (o.hits as FilenameHit[]) : [],
            source: "plugin",
          };
        }
      }
    } catch { /* ein Fremdplugin darf den Schreibweg nicht stören */ }
  }
  const k = applyPolicy(name, DEFAULT_FILENAME_POLICY, kind);
  return { name: k.name, changed: k.changed, hits: k.hits, source: "kit" };
}
