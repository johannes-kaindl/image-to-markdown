// vendored from obsidian-kit@0.72.0, src/obsidian/plugin-api.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Die öffentliche `api` eines geladenen Plugins, defensiv aus dem Plugin-Register gelesen — **bei JEDEM Aufruf frisch** (das Plugin kann
 *  zur Laufzeit an- oder abgeschaltet werden) und mit **Form-Guard statt Versionskopie**: ein halb initialisiertes oder fremdes Objekt unter
 *  demselben Schlüssel ergibt `null`. `null` auch bei jedem fehlenden Zwischenglied (kein `app`, kein Register, kein Plugin, keine `api`)
 *  statt einer Ausnahme mitten in einem Werkzeug-Lauf. Nur eigene Einträge des Registers zählen (`__proto__`, `toString`: `null`).
 *
 *  Dasselbe Muster stand als Kopie in koda-agent (`src/obsidian/image-gen.ts`, `ocr.ts`, `retrieval.ts`), yijing-oracle (`image-gen.ts`),
 *  epub-exporter und slide-deck (`image-api.ts`), mailstone (`*-bridge.ts`) und `findEndpointManager`/`readLabApi` in diesem Kit.
 *  `findEndpointManager` ruft sie seit 0.61.1 selbst; `readImageGenApi`/`readOcrApi` (`capability-apis`) sind die ersten Tauscher, die übrigen
 *  rufen `readPluginApi(app, id, guard)` mit ihrem eigenen Guard. Die Datei hat keine Importe: wer nur den Lookup vendort, braucht keinen Vertrag. `app` ist `unknown`, damit auch ein Test-Double und ein Plugin ohne `App`-Import es rufen können. */
export function readPluginApi<T>(app: unknown, pluginId: string, isApi: (x: unknown) => x is T): T | null {
  const reg = (app as { plugins?: { plugins?: unknown } } | null | undefined)?.plugins?.plugins;
  if (reg === null || reg === undefined || typeof reg !== "object") return null;
  if (!Object.prototype.hasOwnProperty.call(reg, pluginId)) return null;
  const api = ((reg as Record<string, unknown>)[pluginId] as { api?: unknown } | null | undefined)?.api;
  return isApi(api) ? api : null;
}
