// vendored from obsidian-kit@0.95.0, src/obsidian/endpoint-source.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
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
import { realClock, type ClockPort } from "./clock";

/** Bei JEDEM Aufruf frisch lesen — das Plugin kann jederzeit deaktiviert werden. */
export function findEndpointManager(app: App): LlmEndpointManagerApi | null {
  return readPluginApi(app, LLM_ENDPOINT_MANAGER_PLUGIN_ID, isLlmEndpointManagerApi);
}

/** Prüf-Zeitgeber in Millisekunden (nur der Identitätsvergleich `findEndpointManager(app) !== angehängtes`). Obsidian meldet das Ein- und Ausschalten eines Plugins mit keinem Workspace-Ereignis (Messung im Kopf von `onEndpointManagerChanged`), also trägt der Zeitgeber allein. */
const POLL_MS = 2000;

/** Abonniert die Quelle „Endpunkt-Manager“ und gibt die Abmeldung zurück. Das Abo meldet über seine ganze Lebensdauer **jeden Wechsel der Quelle, je Wechsel genau einmal** (`cb`):
 *
 *  1. kein Manager → Manager da: `api.on("changed", cb)` wird gehängt, `cb` einmal.
 *  2. Der Manager meldet `changed`: `cb` (das Abo des Managers selbst, `cb` direkt).
 *  3. Manager da → Manager weg (Plugin ausgeschaltet oder entladen, seit Welle 34): das alte `off` wird gerufen, `cb` einmal, das Abo wartet wieder.
 *  4. Der Manager kommt wieder (ein **neues** API-Objekt): wie 1, das Abo hängt am neuen Objekt, nie am alten. Wechselt das API-Objekt zwischen zwei Prüfungen direkt (aus- und eingeschaltet), ist das ein Wechsel: `cb` einmal.
 *
 *  Erkannt wird der Wechsel an der Identität des API-Objekts, geprüft bei Layout-Ready (Ladereihenfolge beim Start) und danach alle `POLL_MS` ms über den `ClockPort` (`./clock`); es gibt genau EINEN Zeitgeber, die Abmeldung löscht ihn.
 *  Die Meldung kommt also spätestens `POLL_MS` ms nach dem Ein- oder Ausschalten. Wer im `cb` `invalidate()` ruft und neu zeichnet, braucht für Meldung 3 nichts zu ändern.
 *
 *  **Warum ein Zeitgeber und keine Workspace-Ereignisse (gemessen 2026-11-14, Obsidian 1.15.1, Pilot `pilot/manager-wechsel.ts`, Gastplugin `llm-endpoint-manager` mit der API-Form, je drei Durchläufe über `enablePlugin`/`disablePlugin` und
 *  `enablePluginAndSave`/`disablePluginAndSave`, zwei Sekunden Beobachtung nach jedem Wechsel):** `layout-change`, `css-change`, `active-leaf-change`, `resize` und `window-open` feuerten in keiner der 12 Richtungen und auch nicht in den Kontrollfenstern ohne Eingriff
 *  (0 von 12 je Ereignis). Die Modellzeile (`buildModelBar`) folgt damit binnen 2 Sekunden: Gruppen des Managers nach 608 und 759 ms beim Einschalten, weg nach 1980 und 1982 ms beim Ausschalten. Nebenbefund: `enablePlugin` trägt das Plugin nicht in
 *  `app.plugins.enabledPlugins` ein, nur `enablePluginAndSave`; die API steht trotzdem in `app.plugins.plugins[id].api`. Es gibt keinen Monkeypatch an `app.plugins`.
 *
 *  Beim Abonnieren ist ein vorhandener Manager schon angehängt, ohne `cb` (der Konsument liest die Quelle ohnehin frisch). Die Abmeldung ist idempotent, entfernt Listener und Zeitgeber und gilt in jedem Zustand; ein Fehler in `cb` stört das Abo nicht,
 *  ein Fehler von `api.on` ebenso wenig (das Abo bleibt dann ohne Manager-Meldungen an diesem Objekt, bis ein neues erscheint). `clock` ist für Tests; die Voreinstellung ist die echte Uhr, eine Umgebung ohne Zeitgeber (Test ohne `window`) bleibt ohne Prüfung. */
export function onEndpointManagerChanged(app: App, cb: () => void, clock: ClockPort = realClock): () => void {
  let attached: LlmEndpointManagerApi | null = null;
  let off: (() => void) | null = null;
  let stopped = false;
  let timer: number | null = null;

  const attach = (api: LlmEndpointManagerApi): void => {
    attached = api;
    try { off = api.on("changed", cb); } catch { off = () => {}; }
  };
  const detach = (): void => {
    const o = off;
    off = null;
    attached = null;
    try { o?.(); } catch { /* schon abgemeldet oder entladen */ }
  };
  const check = (): void => {
    if (stopped) return;
    const cur = findEndpointManager(app);
    if (cur === attached) return;
    detach();
    if (cur) attach(cur);
    try { cb(); } catch { /* die Meldung ist ein Hinweis; ein Fehler des Konsumenten stört das Abo nicht */ }
  };
  const arm = (): void => {
    if (stopped) return;
    try { timer = clock.setTimeout(() => { timer = null; check(); arm(); }, POLL_MS); } catch { timer = null; /* eine Umgebung ohne Zeitgeber (Test ohne window) */ }
  };

  const first = findEndpointManager(app);
  if (first) attach(first);
  const ws = app.workspace as unknown as { onLayoutReady?(fn: () => void): void };
  try { ws.onLayoutReady?.(check); } catch { /* kein Workspace-Ereignis */ }
  arm();

  return () => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) { try { clock.clearTimeout(timer); } catch { /* ebenso */ } timer = null; }
    detach();
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
  /** Seit 0.73.0, optional: die Transporte des AUTOMATISCHEN Wegs. Die Modell-Zeile unter „Automatisch“ gehört dem ersten Eintrag dieser Liste, nicht dem ersten der
   *  wählbaren (`transports`): sonst zeigte sie die Modelle eines Endpunkts, den „Automatisch“ nie nimmt. Fehlt die Option, gilt `transports`. */
  autoTransports?: EndpointTransport[];
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
    const autoEntries = opts.autoTransports ? api.list({ capability: opts.capability, transports: opts.autoTransports }) : entries;
    const targetId = choice.endpointId && entries.some((e) => e.id === choice.endpointId) ? choice.endpointId : autoEntries[0]?.id;
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
        // Die Wahl bindet den Endpunkt, dessen Modelle diese Zeile zeigt (`targetId`: der gewählte, bei „Automatisch“ oder verwaister Wahl der automatische): ein Modellname
        // gilt nur auf seinem Endpunkt (0.87.0, Spec § 4.10).
        void opts.setChoice({ ...opts.choice(), endpointId: targetId, model: v || undefined })
          .catch(() => { new Notice(st.saveFailed); opts.rerender(); });
      },
      onRefresh: () => { void api.models(targetId, { force: true }).then(() => opts.rerender()).catch(() => opts.rerender()); },
    });
  };
  void api.models(targetId).then((r) => { if ("error" in r) draw([], false); else draw(r, true); }).catch(() => draw([], false));
}
