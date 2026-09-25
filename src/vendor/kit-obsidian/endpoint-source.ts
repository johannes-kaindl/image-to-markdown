// vendored from obsidian-kit@0.41.1, src/obsidian/endpoint-source.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// ONE mechanical deviation from verbatim: kit-internal imports (../pure/ and ../vendor/code-kit/{pure,web}/) → ../kit/ (vendor layout); reproduce on every re-vendor, nothing else may differ.
import { Notice, Setting, type App } from "obsidian";
import { resolveModelChoice, type ModelHintKey } from "../kit/model-choice";
import type { EndpointConfig } from "../kit/endpoint_config";
import {
  LLM_ENDPOINT_MANAGER_PLUGIN_ID, isLlmEndpointManagerApi,
  type Capability, type EndpointChoice, type ImportResult, type LlmEndpointManagerApi,
} from "../kit/endpoint-source";
import { renderModelPicker } from "./model-picker";

/** Bei JEDEM Aufruf frisch lesen — das Plugin kann jederzeit deaktiviert werden. */
export function findEndpointManager(app: App): LlmEndpointManagerApi | null {
  const a = app as unknown as { plugins?: { plugins?: Record<string, { api?: unknown }> } };
  const api = a.plugins?.plugins?.[LLM_ENDPOINT_MANAGER_PLUGIN_ID]?.api;
  return isLlmEndpointManagerApi(api) ? api : null;
}

/** Abonniert Änderungen am Manager; ohne Manager ein dauerhaftes No-op (Plan-konform — lädt der
 *  Manager erst NACH dem Konsumenten, bleibt das Abo für die gesamte Session wirkungslos, weil
 *  Obsidians Plugin-Ladereihenfolge nicht garantiert ist). Konsumenten sollten das Abo deshalb
 *  idealerweise erst nach `app.workspace.onLayoutReady(...)` setzen, nicht direkt in `onload()` —
 *  das verringert (behebt aber nicht) das Risiko, den Manager zu verpassen. */
export function onEndpointManagerChanged(app: App, cb: () => void): () => void {
  const api = findEndpointManager(app);
  if (!api) return () => {};
  try { return api.on("changed", cb); } catch { return () => {}; }
}

export interface EndpointSourceSectionStrings {
  managed: string; managedDesc: string; openManager: string;
  pickEndpoint: string; automatic: string; model: string;
  importLocal: string; imported(r: ImportResult): string; importFailed: string;
  modelHint(key: ModelHintKey): string; savedSuffix: string; refreshModels: string;
  /** Notice bei fehlgeschlagenem `setChoice` (Endpunkt- oder Modellwahl) — Vorbild:
   *  `EndpointListOptions.strings.saveFailed` in `endpoint-list.ts`. */
  saveFailed: string;
}

export interface EndpointSourceSectionOptions {
  app: App;
  containerEl: HTMLElement;
  capability: Capability;
  caller: string;
  choice(): EndpointChoice;
  setChoice(c: EndpointChoice): Promise<void>;
  local(): EndpointConfig[];
  strings: EndpointSourceSectionStrings;
  /** Der heutige Listen-Editor des Konsumenten — wird NUR ohne Manager gerufen. */
  renderLocalList(): void;
  rerender(): void;
}

/** Settings-Baustein des Konsumenten: Manager da → „Endpunkte kommen vom Manager" + Wahl +
 *  Modell + Import; sonst der lokale Listen-Editor. Der Konsument speichert nur `choice`. */
export function buildEndpointSourceSection(opts: EndpointSourceSectionOptions): void {
  const api = findEndpointManager(opts.app);
  if (!api) { opts.renderLocalList(); return; }
  const st = opts.strings;
  const choice = opts.choice();

  const head = new Setting(opts.containerEl).setName(st.managed).setDesc(st.managedDesc);
  head.addButton((b) => b.setButtonText(st.openManager).onClick(() => {
    const setting = (opts.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
    setting?.open(); setting?.openTabById(LLM_ENDPOINT_MANAGER_PLUGIN_ID);
  }));

  const entries = api.list({ capability: opts.capability });
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

  const modelRow = new Setting(opts.containerEl).setName(st.model);
  const targetId = choice.endpointId && entries.some((e) => e.id === choice.endpointId) ? choice.endpointId : entries[0]?.id;
  if (targetId) {
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

  const local = opts.local();
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
