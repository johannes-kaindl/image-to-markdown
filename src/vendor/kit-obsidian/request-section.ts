// vendored from obsidian-kit@0.45.0, src/obsidian/request-section.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { Setting, setIcon } from "obsidian";
import { collapsibleSection, type CollapsibleStorage } from "./collapsible";
import { copyToClipboard } from "./clipboard";
import type { RequestSession } from "./request-session";
import {
  FAMILY_IDS, THINKING_LEVELS, resolveRequestParams, thinkingFor, validateOverride,
  type BackendId, type FamilyId, type FamilyKey, type FieldExplain, type FieldId, type ModeId,
  type RequestSettings, type ThinkingLevel, type DeviationKind,
} from "../kit/sampling-profiles";

/** Abschnitt „Anfrage" (Spec § 5.1): zeigt je Modus, was gesendet wird und was davon wirkt,
 *  nimmt Überschreibungen je Modus × Familie an, zeigt ruhende Überschreibungen, die letzte
 *  Anfrage der Sitzung und die Abweichungen. Formuliert nichts selbst — alle Texte aus
 *  `opts.strings`. Zeilen sind native `Setting`s (UI-STANDARD §2/§5). */
export interface RequestSectionState {
  family: FamilyId | null;
  familySource: "manager" | "name" | "none";
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
  jitWarning(model: string, defaultModel: string): string;
  sentAs(model: string): string;
  modeHeading(mode: ModeId): string;
  fieldName(field: FieldId): string;
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
  /** Phase 2 (Systemprompt): der Konsument hängt hier sein Kapitel ein. */
  promptSlot?(el: HTMLElement): void;
}

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

  // 1. Kopf
  new Setting(body)
    .setName(st.head(state.family ?? "—", state.familySource, state.backend, state.backendSource))
    .setDesc(state.family ? "" : st.unknownFamily);
  // 2. JIT-Warnung und Alias
  if (state.backend === "lmstudio" && state.defaultModel && state.sentModel !== state.defaultModel) {
    body.createDiv({ cls: "okit-request-warning mod-warning", text: st.jitWarning(state.sentModel, state.defaultModel) });
  }
  if (state.sentModel !== state.model) body.createDiv({ cls: "okit-request-note", text: st.sentAs(state.sentModel) });

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
      const s = new Setting(body).setName(st.fieldName(e.field)).setDesc(st.fieldDesc(e));
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
          void opts.save(next).then(() => opts.rerender());
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
          void opts.save(next).then(() => opts.rerender());
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
        void opts.save(next).then(() => opts.rerender());
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
        void opts.save(next).then(() => opts.rerender());
      }));
    }
  }

  // 4. Stufenwahl im Chat
  new Setting(body).setName(st.levelPicker).setDesc(st.levelPickerDesc).addToggle((t) =>
    t.setValue(settings.levelPickerInChat).onChange((v) => {
      const next = clone(opts.settings());
      next.levelPickerInChat = v;
      void opts.save(next);
    }));

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
  const label = devs.length === 0 ? st.deviationsOk : st.deviationsWarn(devs.length);
  status.setAttribute("aria-label", label);
  const icon = status.createSpan();
  setIcon(icon, devs.length === 0 ? "circle-check" : "alert-triangle");
  status.createSpan({ text: label });
  for (const d of devs) body.createDiv({ cls: "okit-request-deviation", text: st.deviation(d.kind, d.count, d.detail) });

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
.okit-request-deviation { color: var(--text-muted); font-size: var(--font-ui-small); padding-left: var(--size-4-6); }
`;
