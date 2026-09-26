import { App, PluginSettingTab, Setting, setIcon, Notice, type SettingDefinitionItem } from "obsidian";
import type ImageToMarkdownPlugin from "./main";
import { VisionClient } from "./vision_client";
import { visionDisplay, VISION_TEST_TOKEN, type Confidence } from "./capabilities";
import { t, defaultVisionPrompt } from "./i18n";
import type { PdfPageSeparator } from "./pdf_to_md";
import { DEFAULT_FM_MAP, type FrontmatterMap } from "./frontmatter_map";
import { helpSettingDefinition, githubHelpUrls } from "./vendor/kit-obsidian/help-setting";
import { renderSettingDefinitions, settingBodyHost, refreshSettingsTab } from "./vendor/kit-obsidian/settings_walker";
import { buildEndpointList, type EndpointListStrings } from "./vendor/kit-obsidian/endpoint-list";
import { createModelListCache, type ModelListCache } from "./vendor/kit/model-list-cache";
import { ENDPOINT_PRESETS, type EndpointStatusKind, type EndpointWarning } from "./vendor/kit/endpoint_diagnostics";
import type { EndpointRole } from "./vendor/kit/endpoint_config";
import { migrateEndpointList, type EndpointConfig } from "./vendor/kit/endpoint_config";
import { FolderSuggest } from "./vendor/kit-obsidian/folder-suggest";
import type { EndpointChoice } from "./vendor/kit/endpoint-source";
import { buildEndpointSourceSection, findEndpointManager } from "./vendor/kit-obsidian/endpoint-source";
import { ENDPOINT_CALLER } from "./resolve_endpoint";

export type { EndpointConfig };

/** Endpoint-Liste aus geladenen Settings → `EndpointConfig[]`. Deckt drei Alt-Stände ab:
 *  das ur-alte Einzelfeld `visionEndpoint`, die String-Liste `visionEndpoints` (bis 0.18.x)
 *  und bereits migrierte Configs. Delegiert an das Kit; hier bleibt nur die Feld-Zuordnung. */
export function migrateEndpoints(
  saved: { visionEndpoint?: string; visionEndpoints?: (string | EndpointConfig)[] } | null | undefined,
): EndpointConfig[] {
  return migrateEndpointList(saved?.visionEndpoint, saved?.visionEndpoints);
}

/** Wendet die Bearbeitung eines Listen-Felds auf die Liste an — bewusst EINMAL bei `blur`,
 *  nicht pro `onChange`/Tastendruck (sonst hängt das Add-Feld jeden Zwischenstand `l`,`lo`,`loc`,…
 *  als eigenen Eintrag an). `isAdder=true`: nicht-leerer Wert wird angehängt, leer → unverändert.
 *  `isAdder=false`: Index wird gesetzt (leer → Eintrag entfernt). Ergebnis getrimmt + leer-gefiltert.
 *  Reiner Helfer für die Taxonomie-Liste; Endpunkte nutzen das Kit-`applyEndpointEdit` (Configs). */
export function applyListEdit(endpoints: string[], index: number, value: string, isAdder: boolean): string[] {
  const v = value.trim();
  const next = [...endpoints];
  if (isAdder) {
    if (v) next.push(v);
  } else if (v) {
    next[index] = v;
  } else {
    next.splice(index, 1);
  }
  return next.map(e => e.trim()).filter(e => e);
}

export interface ImageToMarkdownSettings {
  visionEndpoints: EndpointConfig[];
  /** Wahl gegenüber dem LLM Endpoint Manager (Endpunkt + Modell). Leer = automatisch. Nur
   *  relevant, solange der Manager installiert ist; sonst gilt `visionEndpoints` + `visionModel`. */
  choice: EndpointChoice;
  visionModel: string;
  visionPrompt: string;
  promptPreset: string;
  pdfMaxPages: number;
  pdfRenderScale: number;
  pdfPageSeparator: PdfPageSeparator;
  pdfUseTextLayer: boolean;
  suppressThinking: boolean;
  reasoningExpanded: boolean;
  describeTaxonomy: string[];
  frontmatterMap: FrontmatterMap;
  /** Zielordner für neue Transkript-/Beschreibungs-Notizen; leer = neben der Quellnotiz
   *  (Default-Verhalten, s. `resolveDestDir` in img_to_md.ts). */
  exportFolder: string;
  mode: "transcribe" | "describe";
}

/** Default-Settings zur Aufrufzeit (nach setLang) — der Default-Prompt folgt der UI-Sprache. */
export function defaultSettings(): ImageToMarkdownSettings {
  return {
    visionEndpoints: [{ url: "http://localhost:8080" }],
    choice: {},
    visionModel: "",
    visionPrompt: defaultVisionPrompt(),
    promptPreset: "default",
    pdfMaxPages: 25,
    pdfRenderScale: 2.0,
    pdfPageSeparator: "comment",
    pdfUseTextLayer: true,
    suppressThinking: false,
    reasoningExpanded: false,
    describeTaxonomy: ["Foto", "Diagramm", "Screenshot", "Handschrift", "Whiteboard", "Tabelle", "Sonstiges"],
    frontmatterMap: { ...DEFAULT_FM_MAP },
    exportFolder: "",
    mode: "transcribe",
  };
}

/** Wendet die Bearbeitung eines Taxonomie-Felds auf die Liste an — analog `applyListEdit`
 *  (siehe dort für die blur-statt-onChange-Begründung). Reiner Helfer. */
export function applyTaxonomyEdit(list: string[], index: number, value: string, isAdder: boolean): string[] {
  return applyListEdit(list, index, value, isAdder);
}

/** Frontmatter-Mapping aus geladenen Settings: fehlende Keys werden aus DEFAULT_FM_MAP
 *  aufgefüllt. Load-bearing wegen des Shallow-Merges in mergeSettings() (vendor/kit/settings.ts):
 *  ein gespeichertes Teil-`frontmatterMap` ersetzt per Object.assign das GESAMTE Default-Objekt,
 *  nicht nur die vorhandenen Keys — ohne diesen Backfill blieben neu hinzugekommene Keys
 *  `undefined`, sobald data.json ein älteres/unvollständiges Mapping enthält. */
export function fmMapFromSettings(s: { frontmatterMap?: Partial<FrontmatterMap> }): FrontmatterMap {
  return { ...DEFAULT_FM_MAP, ...(s.frontmatterMap ?? {}) };
}

// 1x1-PNG-Fallback, falls Canvas/DOM nicht verfügbar (z.B. Test-Umgebung ohne 2d-Context).
const FALLBACK_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** Kleines PNG mit dem Token (für den aktiven Vision-Test). Canvas → Data-URL; Fallback bei fehlendem DOM. */
export function makeVisionTestImage(token: string = VISION_TEST_TOKEN): string {
  try {
    // Globales createEl (nicht node.createEl): die Node-Methode HÄNGT das Element an
    // ("append it to this node") — activeDocument.createEl("canvas") wirft dadurch
    // HierarchyRequestError. Die freie Funktion liefert ein detached Element, und genau
    // das braucht ein Offscreen-Canvas, das nie ins DOM soll.
    const canvas = createEl("canvas");
    canvas.width = 160; canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (!ctx) return FALLBACK_PNG;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000000"; ctx.font = "bold 40px sans-serif"; ctx.textBaseline = "middle";
    ctx.fillText(token, 16, 34);
    return canvas.toDataURL("image/png");
  } catch {
    return FALLBACK_PNG;
  }
}

/** Kit-Vokabel → eigener i18n-Key. Das Kit reicht `kind`/`rule` heraus und formuliert
 *  bewusst nicht; sein eingebauter Klartext ist deutsch, EN ist hier aber kanonisch. */
const STATUS_KEY: Record<Exclude<EndpointStatusKind, "unknown">, string> = {
  "ok": "settings.endpoints.status.ok",
  "refused": "settings.endpoints.status.refused",
  "unknown-host": "settings.endpoints.status.unknownHost",
  "timeout": "settings.endpoints.status.timeout",
  "not-an-llm-api": "settings.endpoints.status.notAnLlmApi",
  "unauthorized": "settings.endpoints.status.unauthorized",
};
const WARN_KEY: Record<string, string> = {
  "scheme": "settings.endpoints.warn.scheme",
  "malformed": "settings.endpoints.warn.malformed",
  "port": "settings.endpoints.warn.port",
  "placeholder-ip": "settings.endpoints.warn.placeholderIp",
};

export class ImageToMarkdownSettingTab extends PluginSettingTab {
  private confirmedModels = new Set<string>();
  /** Modell-Listen je Endpunkt. Gehoert der Lebensdauer des TABS, nicht eines Renders —
   *  deshalb Feld und nicht lokale Variable (Kit-Vertrag von ModelListCache). */
  private modelLists: ModelListCache = createModelListCache();
  /** Cleanups der render-Hatches aus dem Fallback-Pfad — vor jedem Rebuild ausführen. */
  private cleanupPrevious: () => void = () => { /* erster Lauf: nichts aufzuräumen */ };
  /** Von der Capability-Hatch gesetzt; das Modell-Dropdown ruft sie nach einem Wechsel. */
  private showCaps: (model: string) => void = () => { /* bis die Capability-Zeile gerendert ist */ };

  constructor(app: App, private plugin: ImageToMarkdownPlugin) { super(app, plugin); }

  /** Vertragspflicht des Kit-Modell-Cache, und sein Fehlen waere UNSICHTBAR: der Cache haelt
   *  Promises absichtlich ueber jeden Tab-Neuaufbau hinweg. Ohne dieses clear() bliebe ein
   *  einmal als „nicht erreichbar“ gemessener Endpunkt die restliche Sitzung so stehen — wer
   *  seinen LLM-Server danach startet und die Einstellungen neu oeffnet, saehe dauerhaft den
   *  alten Zustand, und kein Test schluege an. */
  hide(): void {
    this.modelLists.clear();
    super.hide();
  }

  /** Der Endpunkt, gegen den die Settings-UI arbeitet (Modell-Liste, Vision-Test): der aktive,
   *  sonst der erste konfigurierte. GANZE Config, weil jeder dieser Calls den Schlüssel braucht. */
  private endpointCfg(): EndpointConfig | undefined {
    return this.plugin.activeEndpoint ?? (findEndpointManager(this.app) ? undefined : this.plugin.settings.visionEndpoints[0]);
  }

  /** VisionClient für die Settings-UI — immer über endpointCfg(), damit der Schlüssel mitgeht. */
  private client(model: string): VisionClient {
    const cfg = this.endpointCfg();
    return new VisionClient(cfg?.url ?? "", model, cfg?.apiKey);
  }

  // ── Die eine Wahrheit ──────────────────────────────────────────────────────
  // Ab Obsidian 1.13 fragt der Host diese Struktur ab und ruft display() nie; nur so
  // erscheinen die Einstellungen in der Settings-Suche. minAppVersion ist 1.8.7, dort
  // gibt es die deklarative API noch nicht — deshalb zeichnet display() DIESELBE
  // Struktur mit der klassischen Setting-API nach (Kit-Walker). Kein zweiter
  // Definitionsbaum, der auseinanderlaufen kann.
  //
  // Zeilen mit generischem Control sind deklarativ; alles Stateful (Endpunkt-Liste mit
  // Live-Erreichbarkeit, asynchron befülltes Modell-Dropdown, Taxonomie-Liste, die
  // migrationsauslösenden Frontmatter-Felder) sind `render`-Hatches: EIN Code, der in
  // beiden Pfaden unverändert läuft.
  getSettingDefinitions(): SettingDefinitionItem[] {
    const fmFields: Array<[keyof FrontmatterMap, string]> = [
      ["sourceImage", "settings.fmMap.sourceImage"],
      ["sourcePdf", "settings.fmMap.sourcePdf"],
      ["sourceNote", "settings.fmMap.sourceNote"],
      ["category", "settings.fmMap.category"],
      ["tags", "settings.fmMap.tags"],
      ["authorTranscribed", "settings.fmMap.authorTranscribed"],
      ["authorDescribed", "settings.fmMap.authorDescribed"],
      ["created", "settings.fmMap.created"],
      ["pages", "settings.fmMap.pages"],
      ["truncated", "settings.fmMap.truncated"],
      ["kindKey", "settings.fmMap.kindKey"],
      ["kindTranscript", "settings.fmMap.kindTranscript"],
      ["kindDescription", "settings.fmMap.kindDescription"],
    ];
    return [
      // §8 Hilfe-Zeile: erstes Element, vor jeder Überschrift. Der Walker-Fallback zeichnet sie
      // für ältere Obsidian-Versionen von selbst, kein zweiter Aufruf in display().
      helpSettingDefinition({
        ...githubHelpUrls("image-to-markdown"),
        texts: {
          name: t("settings.help.name"), desc: t("settings.help.desc"),
          openDocs: t("settings.help.openDocs"), reportIssue: t("settings.help.reportIssue"),
        },
      }),
      {
        type: "group",
        heading: t("settings.heading"),
        items: [
          { name: t("settings.endpoints.name"), desc: t("settings.endpoints.desc"),
            render: (s: Setting) => { this.renderEndpoints(s); } },
          { name: t("settings.model.name"), desc: t("settings.model.desc"),
            render: (s: Setting) => { this.renderModel(s); } },
          { name: t("settings.capability.name"),
            render: (s: Setting) => { this.renderCapability(s); } },
          { name: t("settings.prompt.name"), desc: t("settings.prompt.desc"),
            render: (s: Setting) => { this.renderPrompt(s); } },
          // min/max sind die UI-Seite derselben Grenze, die setControlValue erzwingt: das
          // native 1.13-Zahlenfeld zeigt sie an, der Fallback (Textfeld) kennt sie nicht —
          // deshalb bleibt die Prüfung in setControlValue die verbindliche.
          { name: t("settings.pdfMaxPages.name"), desc: t("settings.pdfMaxPages.desc"),
            control: { type: "number", key: "pdfMaxPages", min: 1, max: 500 } },
          { name: t("settings.pdfRenderScale.name"), desc: t("settings.pdfRenderScale.desc"),
            control: { type: "slider", key: "pdfRenderScale", min: 1, max: 4, step: 0.5 } },
          { name: t("settings.pdfPageSep.name"), desc: t("settings.pdfPageSep.desc"),
            control: { type: "dropdown", key: "pdfPageSeparator", options: {
              comment: t("settings.pdfPageSep.comment"),
              heading: t("settings.pdfPageSep.heading"),
              rule: t("settings.pdfPageSep.rule"),
              pagebreak: t("settings.pdfPageSep.pagebreak"),
              none: t("settings.pdfPageSep.none"),
            } } },
          { name: t("settings.pdfUseTextLayer.name"), desc: t("settings.pdfUseTextLayer.desc"),
            control: { type: "toggle", key: "pdfUseTextLayer" } },
          { name: t("settings.reasoningExpanded.name"), desc: t("settings.reasoningExpanded.desc"),
            control: { type: "toggle", key: "reasoningExpanded" } },
          { name: t("settings.exportFolder.name"), desc: t("settings.exportFolder.desc"),
            render: (s: Setting) => { this.renderExportFolder(s); } },
        ],
      },
      {
        type: "group",
        heading: t("settings.taxonomy.heading"),
        items: [
          { name: t("settings.taxonomy.name"), desc: t("settings.taxonomy.desc"),
            render: (s: Setting) => { this.renderTaxonomy(s); } },
        ],
      },
      {
        type: "group",
        heading: t("settings.fmMap.heading"),
        items: [
          // Reine Beschreibungszeile ohne eigenen Namen (wie zuvor `new Setting().setDesc()`):
          // der Walker setzt den Namen nur, wenn er nicht leer ist.
          { name: "", desc: t("settings.fmMap.desc"), render: () => { /* nur Text */ } },
          ...fmFields.map(([field, labelKey]) => ({
            name: t(labelKey),
            render: (s: Setting) => { this.renderFmField(s, field); },
          })),
        ],
      },
    ];
  }

  // ── Werte-Brücke für die deklarativen Controls ────────────────────────────
  getControlValue(key: string): unknown {
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const settings = this.plugin.settings as unknown as Record<string, unknown>;
    // pdfMaxPages kommt aus einem Textfeld (die klassische API kennt kein Zahlenfeld) —
    // ungültige oder unsinnige Eingaben werden verworfen statt gespeichert, sonst landet
    // NaN in den Settings und die PDF-Schleife läuft ins Leere.
    if (key === "pdfMaxPages") {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return;
      settings[key] = Math.min(Math.floor(n), 500);
    } else {
      settings[key] = value;
    }
    await this.plugin.saveSettings();
  }

  // ── Render-Hatches (ein Code, beide Pfade) ────────────────────────────────

  /** Endpunkt-Liste — der verbindliche §8-Baustein aus dem Kit
   *  (`vendor/kit-obsidian/endpoint-list.ts`), nicht mehr die eigene Zeilen-UI.
   *
   *  Der Eigenbau davor konnte weniger (kein Modell-Override je Zeile, keine Presets, keine
   *  Rollen-/Diagnose-Zeile) und hatte einen Fehlbuchungs-Pfad: die Zeilen-Indizes wurden erst
   *  beim Re-Render neu vergeben, waehrend `resolveAndReconnect()` noch pingte — ein blur in
   *  dem Fenster schrieb auf den NACHRUECKENDEN Eintrag, im schlimmsten Fall einen
   *  API-Schluessel an den falschen Host. Der Kit-Baustein sperrt die Zeilen dafuer. */
  private renderEndpoints(setting: Setting): void {
    const host = settingBodyHost(setting);
    buildEndpointSourceSection({
      app: this.app, containerEl: host, capability: "vision", caller: ENDPOINT_CALLER,
      choice: () => this.plugin.settings.choice,
      setChoice: async c => { this.plugin.settings.choice = c; await this.plugin.saveSettings(); await this.plugin.resolveAndReconnect(); },
      local: () => this.plugin.settings.visionEndpoints,
      strings: {
        managed: t("settings.source.managed"), managedDesc: t("settings.source.managedDesc"),
        openManager: t("settings.source.openManager"), pickEndpoint: t("settings.source.pickEndpoint"),
        automatic: t("settings.source.automatic"), model: t("settings.model.name"),
        importLocal: t("settings.source.importLocal"),
        imported: r => t("settings.source.imported", String(r.added.length), String(r.merged.length)),
        importFailed: t("settings.source.importFailed"),
        modelHint: key => key === "unreachable" ? t("settings.endpoints.hint.unreachable")
          : key === "no-list" ? t("settings.endpoints.hint.noList")
          : "",
        savedSuffix: t("settings.endpoints.saved"), refreshModels: t("settings.refreshModels"),
        saveFailed: t("settings.endpoints.saveFailed"),
      },
      renderLocalList: () => { this.renderLocalEndpointList(host); },
      rerender: () => { this.refresh(); },
    });
  }

  /** Der lokale Listen-Editor — nur ohne installierten LLM Endpoint Manager sichtbar. */
  private renderLocalEndpointList(host: HTMLElement): void {
    buildEndpointList({
      containerEl: host,
      label: t("settings.endpoints.name"),
      desc: t("settings.endpoints.desc"),
      placeholder: "http://localhost:1234",
      strings: this.endpointStrings(),
      cache: this.modelLists,
      get: () => this.plugin.settings.visionEndpoints,
      set: eps => { this.plugin.settings.visionEndpoints = eps; },
      active: () => this.plugin.activeEndpoint?.url ?? null,
      // EIN Client je Zeile traegt Status-Icon UND Modell-Liste — so koennen die beiden nie
      // ueber dieselbe Zeile auseinanderlaufen (Kit-Vertrag). probeStatus() statt ping():
      // die Zeile zeigt den GRUND, nicht nur rot/gruen.
      clientFor: cfg => {
        const c = new VisionClient(cfg.url, cfg.model ?? "", cfg.apiKey);
        return { probe: () => c.probeStatus(), listModels: () => c.listModels() };
      },
      globalModel: () => this.plugin.settings.visionModel,
      save: () => this.plugin.saveSettings(),
      reconnect: () => this.plugin.resolveAndReconnect(),
      rerender: () => { this.refresh(); },
      presets: ENDPOINT_PRESETS,
    });
  }

  /** Jeder Text des Endpunkt-Editors. Gemappt ueber `kind`/`rule`, nicht der Kit-Klartext. */
  private endpointStrings(): EndpointListStrings {
    return {
      addPlaceholder: t("settings.endpoints.addPlaceholder"),
      apiKeyPlaceholder: t("settings.endpoints.apiKeyPlaceholder"),
      modelPlaceholder: t("settings.endpoints.modelPlaceholder"),
      ariaUrl: t("settings.endpoints.ariaUrl"),
      ariaAdd: t("settings.endpoints.ariaAdd"),
      ariaApiKey: (url: string) => t("settings.endpoints.ariaApiKey", url),
      ariaModel: (url: string) => t("settings.endpoints.ariaModel", url),
      emptyModelLabel: (globalModel: string) => globalModel
        ? t("settings.endpoints.globalModel", globalModel)
        : t("settings.endpoints.globalModelUnset"),
      modelHint: key => key === "unreachable" ? t("settings.endpoints.hint.unreachable")
        : key === "no-list" ? t("settings.endpoints.hint.noList")
        : "",
      savedSuffix: t("settings.endpoints.saved"),
      refreshModels: t("settings.refreshModels"),
      moveToFront: t("settings.endpoints.moveToFront"),
      remove: t("settings.endpoints.remove"),
      thirdParty: t("settings.endpoints.thirdParty"),
      probing: t("view.checking"),
      statusTooltip: status => status.kind === "unknown"
        ? t("settings.endpoints.status.unknown", status.raw ?? "")
        : t(STATUS_KEY[status.kind]),
      role: (role: EndpointRole) => role.kind === "active" ? t("settings.endpoints.role.active")
        : role.kind === "standby" ? t("settings.endpoints.role.standby", String(role.position))
        : role.kind === "unreachable" ? t("settings.endpoints.role.unreachable")
        : t("settings.endpoints.role.skippedModel"),
      warnings: (warnings: EndpointWarning[]) => warnings
        .map(w => WARN_KEY[w.rule] ? t(WARN_KEY[w.rule]) : w.message)
        .join(" · "),
      presetTooltip: preset => t("settings.endpoints.preset", preset.label),
      presetLabel: preset => preset.label,
      checkConnection: t("settings.testConnection"),
      saveFailed: t("settings.endpoints.saveFailed"),
    };
  }

  /** Modell: Dropdown wird asynchron aus dem Endpunkt befüllt; offline stattdessen ein
   *  Textfeld + „Modelle laden". */
  private renderModel(setting: Setting): void {
    // Mit Manager waehlt der Endpunkt-Baustein das Modell (choice.model). Hier entschieden, nicht
    // beim Bau der Definitionsliste: Obsidian >= 1.13 kann diese Liste ueber das Erscheinen des
    // Managers hinweg zwischenspeichern, render() laeuft bei jedem Oeffnen des Tabs.
    if (findEndpointManager(this.app)) { setting.settingEl.addClass("img2md-setting-managed"); return; }
    setting.addExtraButton(b => b.setIcon("refresh-cw").setTooltip(t("settings.refreshModels")).onClick(() => { this.refresh(); }));
    void this.client("").listModels().then((models: string[]) => {
      const cur = this.plugin.settings.visionModel;
      const list = models.includes(cur) || !cur ? models : [cur, ...models];
      if (list.length) {
        setting.addDropdown(d => {
          for (const m of list) d.addOption(m, m);
          d.setValue(cur);
          d.onChange(async (v: string) => {
            this.plugin.settings.visionModel = v;
            await this.plugin.saveSettings();
            void this.plugin.resolveAndReconnect();
            this.showCaps(v);
          });
        });
      } else {
        setting.addText(tx => tx.setPlaceholder(t("settings.endpointOfflinePlaceholder")).setValue(cur)
          .onChange(async (v: string) => { this.plugin.settings.visionModel = v.trim(); await this.plugin.saveSettings(); void this.plugin.resolveAndReconnect(); }));
        setting.addButton(b => b.setButtonText(t("settings.loadModels")).onClick(() => { this.refresh(); }));
      }
      this.showCaps(this.plugin.settings.visionModel);
    });
  }

  /** Export-Ordner: Textfeld mit Ordner-Autocomplete (Kit-`FolderSuggest`), leer = neben der
   *  Quellnotiz. */
  private renderExportFolder(setting: Setting): void {
    setting.addText(tx => {
      tx.setPlaceholder(t("settings.exportFolder.placeholder")).setValue(this.plugin.settings.exportFolder);
      new FolderSuggest(this.app, tx.inputEl);   // FolderSuggest.selectSuggestion() feuert "input" selbst (s. dortiger Kopfkommentar)
      tx.onChange(async (v: string) => { this.plugin.settings.exportFolder = v.trim(); await this.plugin.saveSettings(); });
    });
  }

  /** Vision-Fähigkeit: Icon + Text (Bedeutung nie über Farbe allein) + aktiver Test. */
  private renderCapability(setting: Setting): void {
    const capEl = setting.descEl.createSpan({ cls: "img2md-cap" });
    const capIcon = capEl.createSpan();
    const capText = capEl.createSpan();
    const renderCap = (c: Confidence): void => {
      const d = visionDisplay(c);
      capIcon.empty(); setIcon(capIcon, d.icon);
      capText.setText(" " + d.text);
      capEl.toggleClass("is-ok", d.state === "ok");
      capEl.toggleClass("is-error", d.state === "error");
    };
    this.showCaps = (model: string): void => {
      if (this.confirmedModels.has(model)) { renderCap("confirmed"); return; }
      void this.client("").visionConfidence(model).then(renderCap);
    };
    setting.addButton(b => b.setButtonText(t("settings.testVision")).onClick(async () => {
      const model = this.plugin.model;
      b.setDisabled(true);
      try {
        const ok = await this.client(model).testVision(makeVisionTestImage());
        if (ok) { this.confirmedModels.add(model); renderCap("confirmed"); } else { renderCap("no"); }
      } catch {
        new Notice(t("settings.endpointUnreachable"));
      } finally {
        b.setDisabled(false);
      }
    }));
    this.showCaps(this.plugin.model);
  }

  /** Prompt-Textarea — Hatch statt `textarea`-Control, weil sie zusätzlich die
   *  Layout-Klasse `img2md-prompt-textarea` braucht (der Walker setzt nur `rows`). */
  private renderPrompt(setting: Setting): void {
    setting.addTextArea(ta => {
      ta.setValue(this.plugin.settings.visionPrompt)
        .onChange(async (v: string) => { this.plugin.settings.visionPrompt = v; await this.plugin.saveSettings(); });
      ta.inputEl.rows = 8;
      ta.inputEl.addClass("img2md-prompt-textarea");
    });
  }

  /** Beschreibungs-Taxonomie: geordnete Kategorie-Liste, gleiches blur-Muster wie die Endpunkte. */
  private renderTaxonomy(setting: Setting): void {
    const host = settingBodyHost(setting);
    const taxonomy = this.plugin.settings.describeTaxonomy;
    const rows = [...taxonomy, ""];   // leeres Zusatzfeld am Ende
    rows.forEach((value, i) => {
      const isAdder = i >= taxonomy.length;
      const s = new Setting(host);
      if (i === 0) s.setName(t("settings.taxonomy.name")).setDesc(t("settings.taxonomy.desc"));
      s.addText(tx => {
        tx.setPlaceholder(isAdder ? t("settings.taxonomy.addPlaceholder") : "").setValue(value);
        // Listen-Mutation NUR bei blur — siehe applyEndpointEdit-Kommentar oben.
        tx.inputEl.addEventListener("blur", () => {
          const before = this.plugin.settings.describeTaxonomy;
          const updated = applyTaxonomyEdit(before, i, tx.getValue(), isAdder);
          if (updated.length === before.length && updated.every((e, k) => e === before[k])) return;   // unverändert → kein Re-Render
          this.plugin.settings.describeTaxonomy = updated;
          void this.plugin.saveSettings().then(() => { this.refresh(); });
        });
      });
      if (!isAdder) {
        s.addExtraButton(b => b
          .setIcon("trash-2")
          .setTooltip(t("settings.taxonomy.remove"))
          .onClick(() => {
            this.plugin.settings.describeTaxonomy = applyTaxonomyEdit(this.plugin.settings.describeTaxonomy, i, "", false);
            void this.plugin.saveSettings().then(() => { this.refresh(); });
          }));
      }
    });
  }

  /** Ein Frontmatter-Key-Feld. Hatch, weil ein geänderter Key eine vaultweite Migration
   *  auslösen kann (offerFmMigration fragt per Modal) — das darf nicht pro Tastendruck feuern. */
  private renderFmField(setting: Setting, field: keyof FrontmatterMap): void {
    // Über fmMapFromSettings lesen, nicht direkt this.plugin.settings.frontmatterMap: nach dem
    // Shallow-Merge-Laden (mergeSettings) kann Letzteres bei älterem/unvollständigem data.json
    // noch Lücken haben, bis der erste Edit sie schließt — sonst zeigt das Feld "undefined".
    const currentFmMap = fmMapFromSettings(this.plugin.settings);
    setting.addText(tx => {
      tx.setPlaceholder(DEFAULT_FM_MAP[field]).setValue(currentFmMap[field]);
      // Mutation NUR bei blur, NICHT in onChange: ein geänderter Key kann Vault-weit migriert
      // werden müssen (offerFmMigration fragt vorher per Modal nach) — pro Tastendruck wäre
      // das weder sinnvoll noch performant. Bei "cancel" speichert offerFmMigration nichts;
      // der Re-Render zeichnet das Feld dann unverändert aus den gespeicherten settings neu.
      tx.inputEl.addEventListener("blur", () => {
        const oldMap = fmMapFromSettings(this.plugin.settings);
        const candidate: FrontmatterMap = { ...oldMap, [field]: tx.getValue().trim() || DEFAULT_FM_MAP[field] };
        if (candidate[field] === oldMap[field]) return;   // unverändert → kein Diff, kein Re-Render
        void this.plugin.offerFmMigration(oldMap, candidate)
          .then(() => { this.refresh(); })
          .catch((e: unknown) => { console.error("[i2m-migration]", e); this.refresh(); });
      });
    });
  }

  // ── Imperativer Fallback (Obsidian < 1.13) ────────────────────────────────

  // display() ist seit Obsidian 1.13 deprecated, bleibt aber der Fallback-Override für
  // minAppVersion < 1.13. Interne Re-Renders gehen über refresh(), damit kein deprecated
  // this.display()-Aufruf entsteht (Community-Review SOURCE-CODE-Check).
  display(): void { this.renderFallback(); }

  /** Zeichnet die Definitionen mit der klassischen Setting-API nach. Eigene Methode, damit
   *  interne Re-Renders sie direkt aufrufen können, statt über das deprecated display(). */
  private renderFallback(): void {
    this.cleanupPrevious();
    this.containerEl.empty();
    this.cleanupPrevious = renderSettingDefinitions(
      this.containerEl,
      this.getSettingDefinitions(),
      this,
      this.app,
    );
  }

  /** Re-Render nach einer Struktur-Änderung: nutzt die native 1.13-update()-API, wenn der
   *  Host sie mitbringt, sonst den vollen Rebuild über den Fallback-Pfad. */
  private refresh(): void {
    refreshSettingsTab(this, () => { this.renderFallback(); });
  }
}
