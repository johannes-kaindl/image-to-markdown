// vendored from obsidian-kit@0.63.0, src/obsidian/request-section.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { Notice, Setting, setIcon } from "obsidian";
import { collapsibleSection, type CollapsibleStorage } from "./collapsible";
import { copyToClipboard } from "./clipboard";
import type { RequestSession } from "./request-session";
import { isModelLoaded, type LoadedModel } from "../kit/capabilities";
import {
  FAMILY_IDS, THINKING_LEVELS, resolveRequestParams, thinkingFor, validateOverride,
  type BackendId, type FamilyId, type FamilyKey, type FieldExplain, type FieldId, type ModeId, type ModelFamilyId,
  type RequestSettings, type ThinkingLevel, type DeviationKind,
} from "../kit/sampling-profiles";

/** Abschnitt „Anfrage" (Spec § 5.1): zeigt je Modus, was gesendet wird und was davon wirkt,
 *  nimmt Überschreibungen je Modus × Familie an, zeigt ruhende Überschreibungen, die letzte
 *  Anfrage der Sitzung und die Abweichungen. Formuliert nichts selbst — alle Texte aus
 *  `opts.strings`. Zeilen sind native `Setting`s (UI-STANDARD §2/§5). */
export interface RequestSectionState {
  family: FamilyId | null;
  familySource: "manager" | "name" | "none";
  /** Anzeige-Familie (`EndpointSourceResult.displayFamily`); der Kopf fällt darauf zurück, wenn
   *  `family` fehlt — als ID, das Plugin übersetzt sie selbst in `strings.head`. */
  displayFamily?: ModelFamilyId;
  backend: BackendId;
  backendSource: "manager" | "probe" | "none";
  model: string;
  sentModel: string;
  defaultModel?: string;
}
export interface RequestSectionStrings {
  title: string;
  head(family: string, familySource: string, backend: string, backendSource: string): string;
  unknownFamily: string;
  /** Seit 0.61.0, optional: Hinweis, wenn die Tabelle Backend oder Familie nicht kennt (`ResolvedRequest.unrecognised`, ein neuerer Manager als das
   *  Plugin). Fehlt er, bleibt die Ansicht stumm, die Anfrage ist dieselbe. */
  unrecognised?(u: { backend?: string; family?: string }): string;
  jitWarning(model: string, defaultModel: string): string;
  /** Seit 0.63.0, optional: Warnung zur Laufzeit — das gesendete Modell ist nicht geladen, aber andere sind (`loaded` = deren Schlüssel). Die Anfrage
   *  lädt es per JIT und kann ein geladenes verdrängen. Fehlt der Text, bleibt die Zeile weg. */
  jitRuntimeWarning?: (model: string, loaded: string[]) => string;
  sentAs(model: string): string;
  modeHeading(mode: ModeId): string;
  /** `backend` (seit 0.63.0): der Wire-Name in der Klammer hängt am Backend — die Messages-API kennt `effort`, nicht `reasoning_effort`. */
  fieldName(field: FieldId, backend?: BackendId): string;
  fieldDesc(e: FieldExplain): string;
  reset: string;
  thinkingLevel: string;
  level(l: ThinkingLevel): string;
  levelPicker: string;
  levelPickerDesc: string;
  dormant(family: FamilyKey): string;
  deleteDormant: string;
  lastRequest: string;
  lastRequestNone: string;
  copy: string;
  copied: string;
  deviationsOk: string;
  deviationsWarn(n: number): string;
  deviation(kind: DeviationKind, count: number, detail?: string): string;
  /** Seit 0.63.0, optional: Beschriftung des Knopfs am Hinweis „Familie erkannt“ (`family-detected`), der die Einstellungen des
   *  Managers öffnet. Der Knopf erscheint nur mit diesem Text UND `openManager`. */
  setFamily?: string;
  /** Notice und Status-Text, wenn `save` zurückweist. Optional, damit Konsumenten mit eigenen
   *  `strings` nicht brechen; fehlt es, gilt `SAVE_FAILED_FALLBACK`. */
  saveFailed?: string;
}
export interface RequestSectionOptions {
  containerEl: HTMLElement;
  modes: ModeId[];
  state(): RequestSectionState;
  settings(): RequestSettings;
  save(s: RequestSettings): Promise<void>;
  maxTokens(mode: ModeId): number | undefined;
  session: RequestSession;
  strings: RequestSectionStrings;
  collapsedStorage?: CollapsibleStorage;
  rerender(): void;
  /** Öffnet die Einstellungen des LLM Endpoint Managers — für den Knopf „Familie im Manager setzen“ am Hinweis `family-detected`.
   *  `createLlmConnection` reicht `openEndpointManagerSettings(app)`. Die Familie wird nicht aus der Antwort gelernt und nicht gesetzt: der Knopf
   *  führt nur an die Stelle, an der der Nutzer sie einträgt (Entscheidung 2026-10-17, Manager schickt keine Anfragen). */
  openManager?: () => void;
  /** Seit 0.63.0: was der Endpunkt gerade geladen hat (`fetchLoadedModelsAt`); `null` = unbekannt (anderes Backend, altes Schema, Fehler). Gerufen
   *  nur bei Backend `lmstudio`, einmal je Aufbau des Abschnitts; die Warnzeile erscheint, wenn es antwortet, ohne den Aufbau aufzuhalten. */
  loadedModels?: () => Promise<readonly LoadedModel[] | null>;
  /** Phase 2 (Systemprompt): der Konsument hängt hier sein Kapitel ein. */
  promptSlot?(el: HTMLElement): void;
  /** Zeigt den Schalter „Stufenwahl im Chat“. Default `false`: er wirkt nur dort, wo das Plugin
   *  `settings.levelPickerInChat` an `buildThinkingControl` (`levelPicker`) reicht. Ist die
   *  Einstellung schon `true`, bleibt der Schalter sichtbar, sonst ließe sie sich nicht mehr abschalten. */
  levelPicker?: boolean;
}

const SAVE_FAILED_FALLBACK = "Could not save the request settings.";

/** Fallback, wenn der Konsument kein `collapsedStorage` übergibt: Das Modul merkt sich den
 *  Auf/Zu-Zustand für die Laufzeit selbst. Ohne ihn klappte der Abschnitt nach jeder
 *  Überschreibung und jedem Zurücksetzen wieder zu, weil `rerender()` ihn neu aufbaut und
 *  `collapsibleSection` dann auf `defaultCollapsed` zurückfällt (Pilot lingotuner,
 *  2026-09-23, gefunden am Screenshot, nicht am Smoke). Jedes Plugin vendort eine eigene
 *  Kopie, der Zustand ist also je Plugin getrennt. */
const memoryStorage: CollapsibleStorage = (() => {
  const m = new Map<string, boolean>();
  return { getCollapsed: (k) => m.get(k), setCollapsed: (k, c) => { m.set(k, c); } };
})();

const famKey = (f: FamilyId | null): FamilyKey => f ?? "unknown";
const clone = (s: RequestSettings): RequestSettings => structuredClone(s);

function parseInput(field: FieldId, raw: string): number | string | null {
  const t = raw.trim();
  if (field === "reasoning_effort") return validateOverride(field, t);
  if (t === "") return null;
  return validateOverride(field, Number(t.replace(",", ".")));
}

export function buildRequestSection(opts: RequestSectionOptions): void {
  const st = opts.strings;
  const sectionOpts: Parameters<typeof collapsibleSection>[1] = {
    title: st.title, defaultCollapsed: true, key: "request", storage: opts.collapsedStorage ?? memoryStorage,
  };
  const body = collapsibleSection(opts.containerEl, sectionOpts);
  const state = opts.state();
  const settings = opts.settings();
  const key = famKey(state.family);

  // Speichern: ein Fehler wird zur Notice und färbt den Status-Indikator (entsteht erst weiter unten).
  const ui: { status?: HTMLElement } = {};
  const failed = (): void => {
    const msg = st.saveFailed ?? SAVE_FAILED_FALLBACK;
    new Notice(msg);
    const statusEl = ui.status;
    if (!statusEl) return;
    statusEl.removeClass("is-ok", "is-warning");
    statusEl.addClass("is-error");
    statusEl.setAttribute("aria-label", msg);
    statusEl.empty();
    setIcon(statusEl.createSpan(), "circle-x");
    statusEl.createSpan({ text: msg });
  };
  const persist = (next: RequestSettings, then?: () => void): void => {
    void opts.save(next).then(then, failed);
  };

  // 1. Kopf
  new Setting(body)
    .setName(st.head(state.family ?? state.displayFamily ?? "—", state.familySource, state.backend, state.backendSource))
    .setDesc(state.family ? "" : st.unknownFamily);
  // 2. JIT-Warnung und Alias
  if (state.backend === "lmstudio" && state.defaultModel && state.sentModel !== state.defaultModel) {
    body.createDiv({ cls: "okit-request-warning mod-warning", text: st.jitWarning(state.sentModel, state.defaultModel) });
  }
  if (state.sentModel !== state.model) body.createDiv({ cls: "okit-request-note", text: st.sentAs(state.sentModel) });
  // 2a. Laufzeitwarnung: das gesendete Modell ist nicht geladen, andere sind — die Anfrage verdrängt dann eines (JIT). Unbekannt (`null`) und
  // „nichts geladen“ warnen nicht: im ersten Fall wüsste die Zeile nichts, im zweiten wird nichts verdrängt.
  if (state.backend === "lmstudio" && opts.loadedModels !== undefined && st.jitRuntimeWarning !== undefined && state.sentModel !== "") {
    // Ein leerer Platzhalter hält die Stelle im Abschnitt; die Zeile entsteht erst, wenn die Antwort da ist (ein leeres Div hat keine Höhe).
    const slot = body.createDiv({ cls: "okit-request-jit-slot" });
    const text = st.jitRuntimeWarning;
    void opts.loadedModels().then((loaded) => {
      if (loaded === null || loaded.length === 0 || isModelLoaded(loaded, state.sentModel)) return;
      slot.createDiv({ cls: "okit-request-warning mod-warning", text: text(state.sentModel, [...new Set(loaded.map((l) => l.model))]) });
    }, () => { /* unbekannt: keine Warnung */ });
  }

  // 2b. Backend oder Familie unbekannt (neuerer Manager als diese Tabelle): ehrlich zeigen, was daraus wurde.
  const firstMode = opts.modes[0];
  if (firstMode !== undefined && st.unrecognised) {
    const probe = resolveRequestParams({ family: state.family, mode: firstMode, backend: state.backend, thinking: thinkingFor(settings, firstMode) });
    if (probe.unrecognised) body.createDiv({ cls: "okit-request-warning mod-warning", text: st.unrecognised(probe.unrecognised) });
  }

  // 3. Je Modus
  for (const mode of opts.modes) {
    new Setting(body).setName(st.modeHeading(mode)).setHeading();
    const ov = settings.overrides[mode]?.[key] ?? {};
    const level = thinkingFor(settings, mode);
    const resolved = resolveRequestParams({
      family: state.family, mode, backend: state.backend, thinking: level,
      ...(opts.maxTokens(mode) !== undefined ? { maxTokens: opts.maxTokens(mode) } : {}),
      overrides: ov,
    });
    for (const e of resolved.explain) {
      const s = new Setting(body).setName(st.fieldName(e.field, state.backend)).setDesc(st.fieldDesc(e));
      const own = ov[e.field];
      const notSent = e.state.startsWith("not-sent") && own === undefined;
      s.addText((t) => {
        t.inputEl.dataset.field = e.field;
        t.setPlaceholder(e.value !== undefined ? String(e.value) : "");
        t.setValue(own !== undefined ? String(own) : "");
        t.setDisabled(notSent);
        if (own !== undefined) t.inputEl.addClass("okit-request-own");
        t.inputEl.addEventListener("blur", () => {
          const raw = t.getValue();
          if (raw.trim() === "") return;
          const v = parseInput(e.field, raw);
          if (v === null) { t.inputEl.addClass("is-invalid"); return; }
          const next = clone(opts.settings());
          ((next.overrides[mode] ??= {})[key] ??= {})[e.field] = v;
          persist(next, () => opts.rerender());
        });
      });
      if (own !== undefined) {
        s.addExtraButton((b) => b.setIcon("rotate-ccw").setTooltip(st.reset).onClick(() => {
          const next = clone(opts.settings());
          const byFam = next.overrides[mode]?.[key];
          if (byFam) {
            delete byFam[e.field];
            if (Object.keys(byFam).length === 0) delete next.overrides[mode]![key];
            if (Object.keys(next.overrides[mode] ?? {}).length === 0) delete next.overrides[mode];
          }
          persist(next, () => opts.rerender());
        }));
      }
    }
    // Denkstufe je Modus
    new Setting(body).setName(st.thinkingLevel).addDropdown((d) => {
      for (const l of THINKING_LEVELS) d.addOption(l, st.level(l));
      d.setValue(level).onChange((v) => {
        const next = clone(opts.settings());
        next.thinking[mode] = v as ThinkingLevel;
        if (v !== "off") next.lastOnLevel[mode] = v as ThinkingLevel;
        persist(next, () => opts.rerender());
      });
    });
    // Ruhende Überschreibungen
    for (const fam of [...FAMILY_IDS, "unknown"] as FamilyKey[]) {
      if (fam === key) continue;
      const other = settings.overrides[mode]?.[fam];
      if (!other || Object.keys(other).length === 0) continue;
      new Setting(body).setDesc(st.dormant(fam)).addExtraButton((b) => b.setIcon("trash-2").setTooltip(st.deleteDormant).onClick(() => {
        const next = clone(opts.settings());
        delete next.overrides[mode]![fam];
        if (Object.keys(next.overrides[mode] ?? {}).length === 0) delete next.overrides[mode];
        persist(next, () => opts.rerender());
      }));
    }
  }

  // 4. Stufenwahl im Chat
  if (opts.levelPicker === true || settings.levelPickerInChat) {
    new Setting(body).setName(st.levelPicker).setDesc(st.levelPickerDesc).addToggle((t) =>
      t.setValue(settings.levelPickerInChat).onChange((v) => {
        const next = clone(opts.settings());
        next.levelPickerInChat = v;
        persist(next);
      }));
  }

  // 5. Letzte Anfrage
  const last = opts.session.lastRequest();
  const lastSetting = new Setting(body).setName(st.lastRequest);
  if (!last) {
    lastSetting.setDesc(st.lastRequestNone);
  } else {
    const json = JSON.stringify(last.params, null, 2);
    body.createEl("pre", { cls: "okit-request-last", text: json });
    lastSetting.addExtraButton((b) => b.setIcon("copy").setTooltip(st.copy).onClick(() => {
      void copyToClipboard(json, { copiedMessage: st.copied });
    }));
  }

  // 6. Abweichungen (Status-Indikator, UI-STANDARD §8)
  const devs = opts.session.deviations();
  const status = body.createDiv({ cls: `okit-request-status ${devs.length === 0 ? "is-ok" : "is-warning"}` });
  ui.status = status;
  const label = devs.length === 0 ? st.deviationsOk : st.deviationsWarn(devs.length);
  status.setAttribute("aria-label", label);
  const icon = status.createSpan();
  setIcon(icon, devs.length === 0 ? "circle-check" : "alert-triangle");
  status.createSpan({ text: label });
  for (const d of devs) {
    const line = body.createDiv({ cls: "okit-request-deviation", text: st.deviation(d.kind, d.count, d.detail) });
    if (d.kind === "family-detected" && opts.openManager !== undefined && st.setFamily !== undefined) {
      const open = opts.openManager;
      line.createEl("button", { cls: "okit-request-deviation-action", text: st.setFamily, attr: { type: "button" } })
        .addEventListener("click", () => { open(); });
    }
  }

  // 7. Platz für den Systemprompt (Phase 2)
  if (opts.promptSlot) opts.promptSlot(body.createDiv({ cls: "okit-request-prompt" }));
}

export const REQUEST_SECTION_CSS = `
.okit-request-warning { color: var(--text-warning); margin: var(--size-4-2) 0; }
.okit-request-note { color: var(--text-muted); font-size: var(--font-ui-small); }
.okit-request-own { border-color: var(--interactive-accent); }
.okit-request-last { font-size: var(--font-ui-smaller); background: var(--background-secondary); padding: var(--size-4-2); border-radius: var(--radius-s); white-space: pre-wrap; }
.okit-request-status { display: flex; gap: var(--size-4-2); align-items: center; margin-top: var(--size-4-2); }
.okit-request-status.is-ok { color: var(--text-success); }
.okit-request-status.is-warning { color: var(--text-warning); }
.okit-request-status.is-error { color: var(--text-error); }
.okit-request-deviation-action { margin-inline-start: var(--size-4-2); }
.okit-request-deviation { color: var(--text-muted); font-size: var(--font-ui-small); padding-left: var(--size-4-6); }
`;
