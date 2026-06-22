import { App, PluginSettingTab, Setting, setIcon, Notice } from "obsidian";
import type ImageToMarkdownPlugin from "./main";
import { VisionClient } from "./vision_client";
import { visionDisplay, VISION_TEST_TOKEN, type Confidence } from "./capabilities";
import { t, defaultVisionPrompt } from "./i18n";

export interface ImageToMarkdownSettings {
  visionEndpoint: string;
  visionModel: string;
  visionPrompt: string;
}

/** Default-Settings zur Aufrufzeit (nach setLang) — der Default-Prompt folgt der UI-Sprache. */
export function defaultSettings(): ImageToMarkdownSettings {
  return {
    visionEndpoint: "http://localhost:8080",
    visionModel: "",
    visionPrompt: defaultVisionPrompt(),
  };
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

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const endpoint = (): string => this.plugin.settings.visionEndpoint;

    // ── Status-Dot-Helfer ──
    const statusDot = (setting: Setting): HTMLElement => {
      const dot = setting.controlEl.createSpan({ cls: "img2md-status-dot" });
      dot.setText("·");
      return dot;
    };
    const showPing = (dot: HTMLElement, ok: boolean): void => {
      dot.toggleClass("is-ok", ok);
      dot.toggleClass("is-error", !ok);
      dot.setText(ok ? t("settings.connected") : t("settings.offline"));
    };

    new Setting(containerEl).setName(t("settings.heading")).setHeading();

    // ── Endpoint + Status-Dot + Test ──
    const epSetting = new Setting(containerEl)
      .setName(t("settings.endpoint.name"))
      .setDesc(t("settings.endpoint.desc"))
      .addText(tx => tx.setPlaceholder("http://localhost:8080").setValue(this.plugin.settings.visionEndpoint)
        .onChange(async (v: string) => { this.plugin.settings.visionEndpoint = v.trim(); await this.plugin.saveSettings(); this.plugin.reconnectVision(); }))
      .addButton(b => b.setButtonText(t("settings.testConnection")).onClick(async () => {
        b.setDisabled(true);
        const ok = await new VisionClient(endpoint(), "").ping();
        showPing(dot, ok);
        b.setDisabled(false);
      }));
    const dot = statusDot(epSetting);
    void new VisionClient(endpoint(), "").ping().then(ok => showPing(dot, ok));

    // ── Modell ──
    const modelSetting = new Setting(containerEl).setName(t("settings.model.name")).setDesc(t("settings.model.desc"));

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
          d.onChange(async (v: string) => { this.plugin.settings.visionModel = v; await this.plugin.saveSettings(); this.plugin.reconnectVision(); showCaps(v); });
        });
      } else {
        modelSetting.addText(tx => tx.setPlaceholder(t("settings.endpointOfflinePlaceholder")).setValue(cur)
          .onChange(async (v: string) => { this.plugin.settings.visionModel = v.trim(); await this.plugin.saveSettings(); this.plugin.reconnectVision(); }));
        modelSetting.addButton(b => b.setButtonText(t("settings.loadModels")).onClick(() => this.display()));
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
  }
}
