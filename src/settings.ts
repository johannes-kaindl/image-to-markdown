import { App, PluginSettingTab, Setting, setIcon, Notice } from "obsidian";
import type ImageToMarkdownPlugin from "./main";
import { VisionClient, normalizeEndpoint } from "./vision_client";
import { visionDisplay, VISION_TEST_TOKEN, type Confidence } from "./capabilities";
import { t, defaultVisionPrompt } from "./i18n";
import type { PdfPageSeparator } from "./pdf_to_md";
import { DEFAULT_FM_MAP, type FrontmatterMap } from "./frontmatter_map";

/** Endpoint-Liste aus geladenen Settings: vorhandene visionEndpoints (leere gefiltert),
 *  sonst der alte Einzel-visionEndpoint als 1-Element-Liste, sonst leer. Reiner Helfer. */
export function migrateEndpoints(saved: { visionEndpoint?: string; visionEndpoints?: string[] } | null | undefined): string[] {
  if (saved?.visionEndpoints) return saved.visionEndpoints.filter(e => e && e.trim());
  if (saved?.visionEndpoint && saved.visionEndpoint.trim()) return [saved.visionEndpoint];
  return [];
}

/** Wendet die Bearbeitung eines Endpoint-Felds auf die Liste an — bewusst EINMAL bei `blur`,
 *  nicht pro `onChange`/Tastendruck (sonst hängt das Add-Feld jeden Zwischenstand `l`,`lo`,`loc`,…
 *  als eigenen Eintrag an). `isAdder=true`: nicht-leerer Wert wird angehängt, leer → unverändert.
 *  `isAdder=false`: Index wird gesetzt (leer → Eintrag entfernt). Ergebnis getrimmt + leer-gefiltert. Reiner Helfer. */
export function applyEndpointEdit(endpoints: string[], index: number, value: string, isAdder: boolean): string[] {
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
  visionEndpoints: string[];
  visionModel: string;
  visionPrompt: string;
  promptPreset: string;
  pdfMaxPages: number;
  pdfRenderScale: number;
  pdfPageSeparator: PdfPageSeparator;
  pdfUseTextLayer: boolean;
  suppressThinking: boolean;
  describeTaxonomy: string[];
  frontmatterMap: FrontmatterMap;
  describeDestDir?: string;
  mode: "transcribe" | "describe";
}

/** Default-Settings zur Aufrufzeit (nach setLang) — der Default-Prompt folgt der UI-Sprache. */
export function defaultSettings(): ImageToMarkdownSettings {
  return {
    visionEndpoints: ["http://localhost:8080"],
    visionModel: "",
    visionPrompt: defaultVisionPrompt(),
    promptPreset: "default",
    pdfMaxPages: 25,
    pdfRenderScale: 2.0,
    pdfPageSeparator: "comment",
    pdfUseTextLayer: true,
    suppressThinking: false,
    describeTaxonomy: ["Foto", "Diagramm", "Screenshot", "Handschrift", "Whiteboard", "Tabelle", "Sonstiges"],
    frontmatterMap: DEFAULT_FM_MAP,
    mode: "transcribe",
  };
}

/** Wendet die Bearbeitung eines Taxonomie-Felds auf die Liste an — analog `applyEndpointEdit`
 *  (siehe dort für die blur-statt-onChange-Begründung). Reiner Helfer. */
export function applyTaxonomyEdit(list: string[], index: number, value: string, isAdder: boolean): string[] {
  return applyEndpointEdit(list, index, value, isAdder);
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
    const canvas = activeDocument.createElement("canvas");
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

export class ImageToMarkdownSettingTab extends PluginSettingTab {
  private confirmedModels = new Set<string>();

  constructor(app: App, private plugin: ImageToMarkdownPlugin) { super(app, plugin); }

  // display() ist seit Obsidian 1.13 deprecated, bleibt aber der Fallback-Override für
  // minAppVersion < 1.13. Es delegiert an render(); interne Re-Renders rufen render() direkt,
  // damit kein deprecated this.display()-Aufruf entsteht (Community-Review SOURCE-CODE-Check).
  display(): void { this.render(); }

  private render(): void {
    const { containerEl } = this;
    containerEl.empty();
    const endpoint = (): string => this.plugin.activeEndpoint ?? this.plugin.settings.visionEndpoints[0] ?? "";

    new Setting(containerEl).setName(t("settings.heading")).setHeading();

    // ── Vision-Endpunkte (geordnete Fallback-Liste) ──
    const eps = this.plugin.settings.visionEndpoints;
    const rows = [...eps, ""];   // leeres Zusatzfeld am Ende
    rows.forEach((value, i) => {
      const isAdder = i >= eps.length;
      const s = new Setting(containerEl);
      if (i === 0) s.setName(t("settings.endpoints.name")).setDesc(t("settings.endpoints.desc"));
      const statusIcon = s.controlEl.createSpan({ cls: "img2md-ep-status" });
      s.addText(tx => {
        tx
          .setPlaceholder(isAdder ? t("settings.endpoints.addPlaceholder") : "http://localhost:1234")
          .setValue(value);
        // Listen-Mutation NUR bei blur, NICHT in onChange: onChange feuert pro Tastendruck und
        // würde im Add-Feld jeden Zwischenstand (l, lo, loc, …) als eigenen Eintrag anhängen.
        // Bei blur einmal den finalen Feldwert anwenden, dann Struktur-Re-Render + Auflösen.
        tx.inputEl.addEventListener("blur", () => {
          const before = this.plugin.settings.visionEndpoints;
          const updated = applyEndpointEdit(before, i, tx.getValue(), isAdder);
          if (updated.length === before.length && updated.every((e, k) => e === before[k])) return;   // unverändert → kein Re-Render
          this.plugin.settings.visionEndpoints = updated;
          void this.plugin.saveSettings()
            .then(() => this.plugin.resolveAndReconnect())
            .then(() => this.render());
        });
      });
      // Löschen: expliziter Mülleimer-Button (nicht am leeren Add-Feld) — entfernt den Eintrag.
      // Das circle-x links ist nur Erreichbarkeits-Status, kein Lösch-Button (häufiges Missverständnis).
      if (!isAdder) {
        s.addExtraButton(b => b
          .setIcon("trash-2")
          .setTooltip(t("settings.endpoints.remove"))
          .onClick(() => {
            this.plugin.settings.visionEndpoints = applyEndpointEdit(this.plugin.settings.visionEndpoints, i, "", false);
            void this.plugin.saveSettings()
              .then(() => this.plugin.resolveAndReconnect())
              .then(() => this.render());
          }));
      }
      // Pro-Feld-Status in A11y-Form (Form + Text + Farbe)
      const ep = value.trim();
      if (!isAdder && ep) {
        setIcon(statusIcon, "loader"); statusIcon.setAttribute("title", t("view.checking"));
        void new VisionClient(ep, "").ping().then(ok => {
          statusIcon.empty();
          setIcon(statusIcon, ok ? "circle-check" : "circle-x");
          statusIcon.toggleClass("is-ok", ok); statusIcon.toggleClass("is-error", !ok);
          const active = normalizeEndpoint(ep) === (this.plugin.activeEndpoint ?? "");
          statusIcon.toggleClass("is-active", active);
          statusIcon.setAttribute("title", (ok ? t("settings.connected") : t("settings.offline")) + (active ? " · " + t("settings.endpoints.active") : ""));
        });
      }
    });
    new Setting(containerEl).addButton(b => b.setButtonText(t("settings.testConnection")).onClick(() => this.render()));

    // ── Modell ──
    const modelSetting = new Setting(containerEl).setName(t("settings.model.name")).setDesc(t("settings.model.desc"));
    modelSetting.addExtraButton(b => b.setIcon("refresh-cw").setTooltip(t("settings.refreshModels")).onClick(() => this.render()));

    // ── Vision-Fähigkeit (Icon + Text) + aktiver Test ──
    const capSetting = new Setting(containerEl).setName(t("settings.capability.name"));
    const capEl = capSetting.descEl.createSpan({ cls: "img2md-cap" });
    const capIcon = capEl.createSpan();
    const capText = capEl.createSpan();
    const renderCap = (c: Confidence): void => {
      const d = visionDisplay(c);
      capIcon.empty(); setIcon(capIcon, d.icon);
      capText.setText(" " + d.text);
      capEl.toggleClass("is-ok", d.state === "ok");
      capEl.toggleClass("is-error", d.state === "error");
    };
    const showCaps = (model: string): void => {
      if (this.confirmedModels.has(model)) { renderCap("confirmed"); return; }
      void new VisionClient(endpoint(), "").visionConfidence(model).then(renderCap);
    };
    capSetting.addButton(b => b.setButtonText(t("settings.testVision")).onClick(async () => {
      const model = this.plugin.settings.visionModel;
      b.setDisabled(true);
      try {
        const ok = await new VisionClient(endpoint(), model).testVision(makeVisionTestImage());
        if (ok) { this.confirmedModels.add(model); renderCap("confirmed"); } else { renderCap("no"); }
      } catch {
        new Notice(t("settings.endpointUnreachable"));
      } finally {
        b.setDisabled(false);
      }
    }));

    // Modell-Dropdown asynchron befüllen (+ Offline-Fallback mit „Modelle laden")
    void new VisionClient(endpoint(), "").listModels().then((models: string[]) => {
      const cur = this.plugin.settings.visionModel;
      const list = models.includes(cur) || !cur ? models : [cur, ...models];
      if (list.length) {
        modelSetting.addDropdown(d => {
          for (const m of list) d.addOption(m, m);
          d.setValue(cur);
          d.onChange(async (v: string) => { this.plugin.settings.visionModel = v; await this.plugin.saveSettings(); void this.plugin.resolveAndReconnect(); showCaps(v); });
        });
      } else {
        modelSetting.addText(tx => tx.setPlaceholder(t("settings.endpointOfflinePlaceholder")).setValue(cur)
          .onChange(async (v: string) => { this.plugin.settings.visionModel = v.trim(); await this.plugin.saveSettings(); void this.plugin.resolveAndReconnect(); }));
        modelSetting.addButton(b => b.setButtonText(t("settings.loadModels")).onClick(() => this.render()));
      }
      showCaps(this.plugin.settings.visionModel);
    });

    // ── Prompt (große Textarea) ──
    new Setting(containerEl)
      .setName(t("settings.prompt.name"))
      .setDesc(t("settings.prompt.desc"))
      .addTextArea(ta => {
        ta.setValue(this.plugin.settings.visionPrompt)
          .onChange(async (v: string) => { this.plugin.settings.visionPrompt = v; await this.plugin.saveSettings(); });
        ta.inputEl.rows = 8;
        ta.inputEl.addClass("img2md-prompt-textarea");
      });

    // ── PDF Max Pages ──
    new Setting(containerEl)
      .setName(t("settings.pdfMaxPages.name")).setDesc(t("settings.pdfMaxPages.desc"))
      .addText(tx => tx.setValue(String(this.plugin.settings.pdfMaxPages))
        .onChange(async (v: string) => {
          const n = Number(v); if (Number.isFinite(n) && n > 0) { this.plugin.settings.pdfMaxPages = Math.min(Math.floor(n), 500); await this.plugin.saveSettings(); }
        }));

    // ── PDF Render Scale ──
    new Setting(containerEl)
      .setName(t("settings.pdfRenderScale.name")).setDesc(t("settings.pdfRenderScale.desc"))
      .addSlider(sl => sl
        .setLimits(1, 4, 0.5)
        .setValue(this.plugin.settings.pdfRenderScale)
        .onChange(async (v: number) => { this.plugin.settings.pdfRenderScale = v; await this.plugin.saveSettings(); }));

    // ── PDF Page Separator ──
    new Setting(containerEl)
      .setName(t("settings.pdfPageSep.name")).setDesc(t("settings.pdfPageSep.desc"))
      .addDropdown(d => {
        d.addOption("comment", t("settings.pdfPageSep.comment"));
        d.addOption("heading", t("settings.pdfPageSep.heading"));
        d.addOption("rule", t("settings.pdfPageSep.rule"));
        d.addOption("pagebreak", t("settings.pdfPageSep.pagebreak"));
        d.addOption("none", t("settings.pdfPageSep.none"));
        d.setValue(this.plugin.settings.pdfPageSeparator);
        d.onChange(async (v: string) => { this.plugin.settings.pdfPageSeparator = v as PdfPageSeparator; await this.plugin.saveSettings(); });
      });

    // ── PDF Text-Layer ──
    new Setting(containerEl)
      .setName(t("settings.pdfUseTextLayer.name")).setDesc(t("settings.pdfUseTextLayer.desc"))
      .addToggle(tg => tg.setValue(this.plugin.settings.pdfUseTextLayer)
        .onChange(async (v: boolean) => { this.plugin.settings.pdfUseTextLayer = v; await this.plugin.saveSettings(); }));

    // ── Beschreibungs-Taxonomie (geordnete Kategorie-Liste, gleiches blur-Muster wie Endpunkte) ──
    new Setting(containerEl).setName(t("settings.taxonomy.heading")).setHeading();
    const taxonomy = this.plugin.settings.describeTaxonomy;
    const taxonomyRows = [...taxonomy, ""];   // leeres Zusatzfeld am Ende
    taxonomyRows.forEach((value, i) => {
      const isAdder = i >= taxonomy.length;
      const s = new Setting(containerEl);
      if (i === 0) s.setName(t("settings.taxonomy.name")).setDesc(t("settings.taxonomy.desc"));
      s.addText(tx => {
        tx.setPlaceholder(isAdder ? t("settings.taxonomy.addPlaceholder") : "").setValue(value);
        // Listen-Mutation NUR bei blur — siehe applyEndpointEdit-Kommentar oben.
        tx.inputEl.addEventListener("blur", () => {
          const before = this.plugin.settings.describeTaxonomy;
          const updated = applyTaxonomyEdit(before, i, tx.getValue(), isAdder);
          if (updated.length === before.length && updated.every((e, k) => e === before[k])) return;   // unverändert → kein Re-Render
          this.plugin.settings.describeTaxonomy = updated;
          void this.plugin.saveSettings().then(() => this.render());
        });
      });
      if (!isAdder) {
        s.addExtraButton(b => b
          .setIcon("trash-2")
          .setTooltip(t("settings.taxonomy.remove"))
          .onClick(() => {
            this.plugin.settings.describeTaxonomy = applyTaxonomyEdit(this.plugin.settings.describeTaxonomy, i, "", false);
            void this.plugin.saveSettings().then(() => this.render());
          }));
      }
    });

    // ── Frontmatter-Mapping (ein Textfeld je Key + die zwei Diskriminator-Wertfelder) ──
    new Setting(containerEl).setName(t("settings.fmMap.heading")).setHeading();
    new Setting(containerEl).setDesc(t("settings.fmMap.desc"));
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
      ["kindKey", "settings.fmMap.kindKey"],
      ["kindTranscript", "settings.fmMap.kindTranscript"],
      ["kindDescription", "settings.fmMap.kindDescription"],
    ];
    // Über fmMapFromSettings lesen, nicht direkt this.plugin.settings.frontmatterMap: nach dem
    // Shallow-Merge-Laden (mergeSettings) kann Letzteres bei älterem/unvollständigem data.json
    // noch Lücken haben, bis der erste Edit sie schließt — sonst zeigt das Feld "undefined".
    const currentFmMap = fmMapFromSettings(this.plugin.settings);
    for (const [field, labelKey] of fmFields) {
      new Setting(containerEl)
        .setName(t(labelKey))
        .addText(tx => tx
          .setPlaceholder(DEFAULT_FM_MAP[field])
          .setValue(currentFmMap[field])
          .onChange(async (v: string) => {
            const trimmed = v.trim();
            this.plugin.settings.frontmatterMap = {
              ...fmMapFromSettings(this.plugin.settings),
              [field]: trimmed || DEFAULT_FM_MAP[field],
            };
            await this.plugin.saveSettings();
          }));
    }
  }
}
