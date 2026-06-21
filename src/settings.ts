import { App, PluginSettingTab, Setting } from "obsidian";
import type ImageToMarkdownPlugin from "./main";
import { VisionClient } from "./vision_client";

export interface ImageToMarkdownSettings {
  visionEndpoint: string;
  visionModel: string;
  visionPrompt: string;
}

export const DEFAULT_VISION_PROMPT =
  "Transkribiere den Text im Bild exakt nach Markdown. Erhalte die Struktur: Überschriften, Absätze, " +
  "**Hervorhebungen**, Listen und Tabellen. Gib nur das Markdown aus, keine Kommentare.";

export const DEFAULT_SETTINGS: ImageToMarkdownSettings = {
  visionEndpoint: "http://localhost:8080",
  visionModel: "",
  visionPrompt: DEFAULT_VISION_PROMPT,
};

export class ImageToMarkdownSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ImageToMarkdownPlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Vision (Image → Markdown)").setHeading();

    new Setting(containerEl)
      .setName("Vision Endpoint")
      .setDesc("OpenAI-kompatibler Server mit Vision-Modell (z.B. LM Studio)")
      .addText(t => t.setPlaceholder("http://localhost:8080").setValue(this.plugin.settings.visionEndpoint)
        .onChange(async (v: string) => { this.plugin.settings.visionEndpoint = v.trim(); await this.plugin.saveSettings(); this.plugin.reconnectVision(); }));

    const visModelSetting = new Setting(containerEl).setName("Vision Modell").setDesc("Vision-fähiges Modell (Qwen2-VL, Llama-3.2-Vision …)");
    void new VisionClient(this.plugin.settings.visionEndpoint, "").listModels().then((models: string[]) => {
      const cur = this.plugin.settings.visionModel;
      const list = models.includes(cur) || !cur ? models : [cur, ...models];
      if (list.length) {
        visModelSetting.addDropdown(d => {
          for (const m of list) d.addOption(m, m);
          d.setValue(cur);
          d.onChange(async (v: string) => { this.plugin.settings.visionModel = v; await this.plugin.saveSettings(); this.plugin.reconnectVision(); });
        });
      } else {
        visModelSetting.addText(t => t.setPlaceholder("(Endpoint offline)").setValue(cur)
          .onChange(async (v: string) => { this.plugin.settings.visionModel = v.trim(); await this.plugin.saveSettings(); this.plugin.reconnectVision(); }));
      }
    });

    new Setting(containerEl)
      .setName("Vision Prompt")
      .setDesc("Anweisung an das Vision-Modell. Der Bild-Inhalt wird mitgeschickt.")
      .addTextArea(t => t.setValue(this.plugin.settings.visionPrompt)
        .onChange(async (v: string) => { this.plugin.settings.visionPrompt = v; await this.plugin.saveSettings(); }));
  }
}
