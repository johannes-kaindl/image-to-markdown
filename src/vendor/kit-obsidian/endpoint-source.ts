// vendored from obsidian-kit@0.63.0, src/obsidian/endpoint-source.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { Notice, Setting, type App } from "obsidian";
import { resolveModelChoice, type ModelHintKey } from "../kit/model-choice";
import type { EndpointConfig } from "../kit/endpoint_config";
import {
  LLM_ENDPOINT_MANAGER_PLUGIN_ID, isLlmEndpointManagerApi,
  type Capability, type EndpointChoice, type EndpointTransport, type ImportResult, type LlmEndpointManagerApi,
} from "../kit/endpoint-source";
import { renderModelPicker } from "./model-picker";
import { hydrateLocalEndpoints } from "./endpoint-secrets";
import { readPluginApi } from "./plugin-api";

/** Bei JEDEM Aufruf frisch lesen — das Plugin kann jederzeit deaktiviert werden. */
export function findEndpointManager(app: App): LlmEndpointManagerApi | null {
  return readPluginApi(app, LLM_ENDPOINT_MANAGER_PLUGIN_ID, isLlmEndpointManagerApi);
}

/** Abonniert Änderungen am Manager und gibt die Abmeldung zurück.
 *
 *  **Manager schon da:** `api.on("changed", cb)` sofort.
 *
 *  **Manager noch nicht da (seit 0.61.0):** Obsidians Ladereihenfolge der Plugins ist nicht garantiert, und ein Nutzer kann den
 *  Manager auch erst später einschalten. Statt für die Sitzung wirkungslos zu bleiben, versucht die Funktion es erneut — bei
 *  Layout-Ready und bei jedem `layout-change` (Obsidian hat kein Ereignis „Plugin eingeschaltet“; das nächste Layout-Ereignis
 *  nach dem Einschalten ist die frühste verlässliche Stelle). Sobald der Manager da ist, hängt sich das Abo an, die
 *  Workspace-Listener werden entfernt und `cb` wird **einmal** gerufen: aus „kein Manager“ wurde „Manager“, also ist die Quelle
 *  des Konsumenten eine andere (`invalidate` und Oberfläche neu zeichnen). Danach meldet `api.on` jede Änderung.
 *
 *  **Grenze:** zwischen Einschalten und dem nächsten Layout-Ereignis bleibt das Abo still. Wer die Quelle vorher braucht, liest
 *  sie ohnehin frisch (`findEndpointManager` bei jedem `resolve`). Die Abmeldung ist idempotent und gilt auch, bevor der
 *  Manager je da war. */
export function onEndpointManagerChanged(app: App, cb: () => void): () => void {
  let off: (() => void) | null = null;
  let stopped = false;
  const refs: unknown[] = [];

  const attach = (): boolean => {
    const api = findEndpointManager(app);
    if (!api) return false;
    try { off = api.on("changed", cb); } catch { off = () => {}; }
    return true;
  };
  const unwatch = (): void => {
    const ws = app.workspace as unknown as { offref?(ref: unknown): void };
    for (const ref of refs.splice(0)) { try { ws.offref?.(ref); } catch { /* ein Fremd-Workspace ohne offref */ } }
  };
  const retry = (): void => {
    if (stopped || off !== null) return;
    if (!attach()) return;
    unwatch();
    try { cb(); } catch { /* die Meldung ist ein Hinweis; ein Fehler des Konsumenten stört das Abo nicht */ }
  };

  if (!attach()) {
    const ws = app.workspace as unknown as {
      on?(name: string, fn: () => void): unknown;
      onLayoutReady?(fn: () => void): void;
    };
    try { const ref = ws.on?.("layout-change", retry); if (ref !== undefined) refs.push(ref); } catch { /* kein Workspace-Ereignis */ }
    try { ws.onLayoutReady?.(retry); } catch { /* ebenso */ }
  }
  return () => {
    if (stopped) return;
    stopped = true;
    unwatch();
    const o = off;
    off = null;
    try { o?.(); } catch { /* schon abgemeldet */ }
  };
}

/** Texte der Modell-Zeile — nur nötig, solange der Baustein sie zeichnet (`modelRow !== false`). */
export interface EndpointSourceModelStrings {
  model: string;
  modelHint(key: ModelHintKey): string; savedSuffix: string; refreshModels: string;
}

/** Die Texte ohne die Modell-Zeile (Basis; Konsumenten mit `modelRow: false` brauchen nur diese). */
export interface EndpointSourceBaseStrings {
  managed: string; managedDesc: string; openManager: string;
  pickEndpoint: string; automatic: string;
  importLocal: string; imported(r: ImportResult): string; importFailed: string;
  /** Notice bei fehlgeschlagenem `setChoice` (Endpunkt- oder Modellwahl) — Vorbild:
   *  `EndpointListOptions.strings.saveFailed` in `endpoint-list.ts`. */
  saveFailed: string;
}

/** Alle Texte — die Form für den Default (mit Modell-Zeile). */
export interface EndpointSourceSectionStrings extends EndpointSourceBaseStrings, EndpointSourceModelStrings {}

interface EndpointSourceSectionBase {
  app: App;
  containerEl: HTMLElement;
  capability: Capability;
  /** Opt-in: welche Transporte das Dropdown zeigt. Fehlt die Option, bleibt der Manager-Default
   *  `["http"]` — ein Konsument ohne Kurzbefehl-Weg sieht nie ungefragt einen Apple-Endpunkt.
   *  Wer `"shortcuts"` anfordert, baut die `ShortcutsBridge` selbst (s. MIGRATION § 0.45.0). */
  transports?: EndpointTransport[];
  caller: string;
  choice(): EndpointChoice;
  setChoice(c: EndpointChoice): Promise<void>;
  local(): EndpointConfig[];
  /** Plugin-ID der lokalen Liste, wenn ihre Schlüssel im Schlüsselbund liegen
   *  (`buildEndpointList` mit `app` + `pluginId`): der Import an den Manager trägt dann die
   *  Schlüssel mit, nicht nur `secretId`s, die der Manager nicht auflösen kann. */
  pluginId?: string;
  /** Der heutige Listen-Editor des Konsumenten — wird NUR ohne Manager gerufen. */
  renderLocalList(): void;
  rerender(): void;
}

/** Mit Modell-Zeile (Default) braucht `strings` auch die Modell-Texte; mit `modelRow: false` nicht. */
export type EndpointSourceSectionOptions = EndpointSourceSectionBase & (
  | {
    /** Default `true`. */
    modelRow?: true;
    strings: EndpointSourceSectionStrings;
  }
  | {
    /** Opt-out: der Baustein baut die Modell-Zeile gar nicht erst und ruft `api.models` nie —
     *  für Konsumenten, deren Server das Modell bestimmt (local-image-generator); eine Zeile, die
     *  `choice.model` setzt, wäre dort eine Attrappe. Vorbild: `contextLength: false` in
     *  `llm-connection`. */
    modelRow: false;
    strings: EndpointSourceBaseStrings & Partial<EndpointSourceModelStrings>;
  }
);

/** Öffnet die Einstellungen des LLM Endpoint Managers (Obsidians Einstellungsfenster, Tab des Plugins). Ohne Einstellungsfenster
 *  (Test, Mobil ohne `app.setting`) ohne Wirkung. Der „Manager-Einstellungen öffnen“-Knopf und „Familie im Manager setzen“ nutzen sie. */
export function openEndpointManagerSettings(app: unknown): void {
  const setting = (app as { setting?: { open(): void; openTabById(id: string): void } }).setting;
  setting?.open();
  setting?.openTabById(LLM_ENDPOINT_MANAGER_PLUGIN_ID);
}

/** Settings-Baustein des Konsumenten: Manager da → „Endpunkte kommen vom Manager" + Wahl +
 *  Modell + Import; sonst der lokale Listen-Editor. Der Konsument speichert nur `choice`. */
export function buildEndpointSourceSection(opts: EndpointSourceSectionOptions): void {
  const api = findEndpointManager(opts.app);
  if (!api) { opts.renderLocalList(); return; }
  const st = opts.strings;
  const choice = opts.choice();

  const head = new Setting(opts.containerEl).setName(st.managed).setDesc(st.managedDesc);
  head.addButton((b) => b.setButtonText(st.openManager).onClick(() => { openEndpointManagerSettings(opts.app); }));

  const entries = api.list(opts.transports ? { capability: opts.capability, transports: opts.transports } : { capability: opts.capability });
  new Setting(opts.containerEl).setName(st.pickEndpoint).addDropdown((d) => {
    d.addOption("", st.automatic);
    for (const e of entries) d.addOption(e.id, e.label);
    d.setValue(choice.endpointId && entries.some((e) => e.id === choice.endpointId) ? choice.endpointId : "");
    d.selectEl.setAttribute("aria-label", st.pickEndpoint);
    d.onChange((v) => {
      // Endpunktwechsel setzt das Modell zurück: ein Modellname gilt nur auf seinem Endpunkt.
      void opts.setChoice({ endpointId: v || undefined, model: undefined })
        .then(() => opts.rerender())
        .catch(() => { new Notice(st.saveFailed); opts.rerender(); });
    });
  });

  if (opts.modelRow !== false) {
    const targetId = choice.endpointId && entries.some((e) => e.id === choice.endpointId) ? choice.endpointId : entries[0]?.id;
    if (targetId) renderModelRow(opts, opts.strings, api, entries, choice, targetId);
  }

  const local = opts.pluginId ? hydrateLocalEndpoints(opts.app, opts.pluginId, opts.local()) : opts.local();
  if (local.length > 0) {
    new Setting(opts.containerEl).addButton((b) => b.setButtonText(st.importLocal).onClick(() => {
      b.buttonEl.disabled = true;
      void api.importEndpoints(local, opts.capability)
        .then((r) => { new Notice("error" in r ? st.importFailed : st.imported(r)); opts.rerender(); })
        .catch(() => { new Notice(st.importFailed); })
        .finally(() => { b.buttonEl.disabled = false; });
    }));
  }
}

/** Die Modell-Zeile: reservierter Platz sofort, gefüllt nach `api.models`. */
function renderModelRow(
  opts: EndpointSourceSectionBase,
  st: EndpointSourceSectionStrings,
  api: LlmEndpointManagerApi,
  entries: ReturnType<LlmEndpointManagerApi["list"]>,
  choice: EndpointChoice,
  targetId: string,
): void {
  const modelRow = new Setting(opts.containerEl).setName(st.model);
  const entry = entries.find((e) => e.id === targetId);
  const draw = (models: string[], reachable: boolean): void => {
    const c = resolveModelChoice({ reachable, models, current: choice.model ?? "", allowEmpty: true });
    const labelled = { ...c, options: c.options.map((o) => (o.value === "" ? { ...o, label: entry?.defaultModel ? `${st.automatic} (${entry.defaultModel})` : st.automatic } : o)) };
    renderModelPicker({
      setting: modelRow, choice: labelled, ariaLabel: st.model, placeholder: "", hint: st.modelHint(c.hintKey), hintAs: "tooltip",
      savedSuffix: st.savedSuffix, refreshTooltip: st.refreshModels,
      onPick: (v) => {
        void opts.setChoice({ ...opts.choice(), model: v || undefined })
          .catch(() => { new Notice(st.saveFailed); opts.rerender(); });
      },
      onRefresh: () => { void api.models(targetId, { force: true }).then(() => opts.rerender()).catch(() => opts.rerender()); },
    });
  };
  void api.models(targetId).then((r) => { if ("error" in r) draw([], false); else draw(r, true); }).catch(() => draw([], false));
}
