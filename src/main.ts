import { Plugin, WorkspaceLeaf, TFile, Notice, Editor, Menu, arrayBufferToBase64, getLanguage, Platform } from "obsidian";
import { defaultSettings, ImageToMarkdownSettings, ImageToMarkdownSettingTab } from "./settings";
import { VisionClient, setHttp, setStreamFetch } from "./vision_client";
import { obsidianHttp, obsidianStreamFetch } from "./http";
import { runImgToMd, findImageEmbeds, ImgToMdIO, writeTranscripts, SUPPORTED_EXTS } from "./img_to_md";
import { ImgToMdView, VIEW_TYPE_IMGMD, ImgToMdViewDeps } from "./img_to_md_view";
import { ImgItem } from "./img_to_md_state";
import { setLang, pickLang, t } from "./i18n";
import { pdfPageCount, renderPdfPage } from "./pdf_render";
import { writePdfTranscript } from "./pdf_to_md";

export default class ImageToMarkdownPlugin extends Plugin {
  settings!: ImageToMarkdownSettings;
  visionClient!: VisionClient;

  private openPath = (p: string): void => {
    const f = this.app.vault.getAbstractFileByPath(p);
    if (f instanceof TFile) void this.app.workspace.getLeaf(false).openFile(f);
  };

  async onload() {
    setHttp(obsidianHttp);
    setStreamFetch(obsidianStreamFetch);
    setLang(pickLang(getLanguage()));
    const saved = (await this.loadData()) as Partial<ImageToMarkdownSettings> | null;
    this.settings = Object.assign({}, defaultSettings(), saved ?? {});
    this.visionClient = new VisionClient(this.settings.visionEndpoint, this.settings.visionModel);

    this.addSettingTab(new ImageToMarkdownSettingTab(this.app, this));
    this.registerView(VIEW_TYPE_IMGMD, (leaf: WorkspaceLeaf) => new ImgToMdView(leaf, this.makeImgViewDeps()));
    this.addRibbonIcon("scan-text", "Image → Markdown", () => this.activateImgMdView());
    this.addCommand({ id: "open-sidebar", name: t("cmd.openSidebar"), callback: () => this.activateImgMdView() });
    this.addCommand({ id: "transcribe-active-note", name: t("cmd.transcribeActive"), callback: () => {
      const f = this.app.workspace.getActiveFile();
      if (!f) { new Notice(t("notice.noActiveNote")); return; }
      void runImgToMd(this.makeImgIO(), f.path);
    } });
    this.registerEvent(this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor) => {
      const cur = editor.getCursor();
      const line = editor.getLine(cur.line);
      const embeds = findImageEmbeds(line);
      const f = this.app.workspace.getActiveFile();
      if (!embeds.length || !f) return;
      // Bild unter dem Cursor wählen (sonst das erste der Zeile)
      let chosen = embeds[0];
      for (const e of embeds) {
        const start = line.indexOf(e.raw);
        if (start >= 0 && cur.ch >= start && cur.ch <= start + e.raw.length) { chosen = e; break; }
      }
      const raw = chosen.raw;
      menu.addItem(item => item.setTitle("Image → Markdown").setIcon("scan-text").onClick(() => void runImgToMd(this.makeImgIO(), f.path, { onlyRaw: raw })));
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refreshImgViews()));
  }

  reconnectVision(): void {
    this.visionClient = new VisionClient(this.settings.visionEndpoint, this.settings.visionModel);
  }

  private mimeOf(ext: string): string { const e = ext.toLowerCase(); return e === "jpg" ? "jpeg" : e; }

  private makeImgIO(): ImgToMdIO {
    return {
      date: () => new Date().toISOString().slice(0, 10),
      readNote: (p) => this.app.vault.adapter.read(p),
      writeNote: async (p, c) => {
        const f = this.app.vault.getAbstractFileByPath(p);
        if (f instanceof TFile) await this.app.vault.modify(f, c); else await this.app.vault.adapter.write(p, c);
      },
      createNote: async (p, c) => { await this.app.vault.create(p, c); },
      noteExists: (p) => this.app.vault.getAbstractFileByPath(p) != null,
      resolveImage: (link, src) => { const f = this.app.metadataCache.getFirstLinkpathDest(link, src); return f ? { path: f.path, ext: f.extension } : null; },
      readImageDataUrl: async (p, ext) => `data:image/${this.mimeOf(ext)};base64,${arrayBufferToBase64(await this.app.vault.adapter.readBinary(p))}`,
      transcribe: (dataUrl) => this.visionClient.transcribe(dataUrl, this.settings.visionPrompt),
      notify: (m) => { new Notice(m); },
    };
  }

  private makeImgViewDeps(): ImgToMdViewDeps {
    const visionEndpoint = () => this.settings.visionEndpoint;
    return {
      getActivePath: () => this.app.workspace.getActiveFile()?.path ?? null,
      scan: async (sourcePath: string): Promise<ImgItem[]> => {
        let content: string;
        try { content = await this.app.vault.adapter.read(sourcePath); } catch { return []; }
        const seen = new Set<string>();
        const items: ImgItem[] = [];
        for (const e of findImageEmbeds(content)) {
          if (seen.has(e.link)) continue; seen.add(e.link);
          if (e.kind === "pdf") {
            const resolved = this.app.metadataCache.getFirstLinkpathDest(e.link, sourcePath);
            let pageCount = 0;
            if (resolved) {
              try { pageCount = await pdfPageCount(await this.app.vault.adapter.readBinary(resolved.path)); } catch { pageCount = 0; }
            }
            const supported = pageCount > 0;
            const cappedTo = Math.min(pageCount, this.settings.pdfMaxPages);
            items.push({ raw: e.raw, link: e.link, ext: e.ext, supported, kind: "pdf", pageCount, range: { from: 1, to: cappedTo > 0 ? cappedTo : 1 } });
          } else {
            items.push({ raw: e.raw, link: e.link, ext: e.ext, supported: SUPPORTED_EXTS.includes(e.ext.toLowerCase()), kind: "image" });
          }
        }
        return items;
      },
      transcribeStream: async (sourcePath, item, onContent, onReasoning, signal, page) => {
        const resolved = this.app.metadataCache.getFirstLinkpathDest(item.link, sourcePath);
        if (!resolved) throw new Error(t("core.imageNotFound", item.link));
        let dataUrl: string;
        if (item.kind === "pdf") {
          if ((item.range?.to ?? 1) - (item.range?.from ?? 1) + 1 > this.settings.pdfMaxPages) {
            throw new Error(t("core.pdfTooManyPages", item.pageCount ?? 0, this.settings.pdfMaxPages));
          }
          const scale = Platform.isMobile ? Math.min(this.settings.pdfRenderScale, 1.5) : this.settings.pdfRenderScale;
          const bytes = await this.app.vault.adapter.readBinary(resolved.path);
          dataUrl = await renderPdfPage(bytes, page ?? 1, scale);
        } else {
          dataUrl = `data:image/${this.mimeOf(resolved.extension)};base64,${arrayBufferToBase64(await this.app.vault.adapter.readBinary(resolved.path))}`;
        }
        return this.visionClient.transcribeStream(dataUrl, this.settings.visionPrompt, onContent, onReasoning, signal);
      },
      writeTranscripts: async (sourcePath, entries) => {
        const { paths } = await writeTranscripts(this.makeImgIO(), sourcePath, entries.map(e => ({ raw: e.item.raw, link: e.item.link, content: e.content, model: e.model })));
        return paths;
      },
      writePdf: async (sourcePath, raw, link, pages) => {
        const { path } = await writePdfTranscript(this.makeImgIO(), sourcePath, { raw, link }, pages);
        return path;
      },
      ping: () => new VisionClient(visionEndpoint(), "").ping(),
      listModels: () => new VisionClient(visionEndpoint(), "").listModels(),
      getModel: () => this.settings.visionModel,
      setModel: (m: string) => { this.settings.visionModel = m; void this.saveSettings(); this.reconnectVision(); },
      openPath: this.openPath,
      copyText: (text: string) => { void navigator.clipboard.writeText(text); new Notice(t("notice.copied")); },
    };
  }

  private refreshImgViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_IMGMD)) {
      if (leaf.view instanceof ImgToMdView) void leaf.view.refresh();
    }
  }

  async activateImgMdView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_IMGMD);
    if (existing.length) { await this.app.workspace.revealLeaf(existing[0]); return; }
    const leaf = this.app.workspace.getRightLeaf(false);
    await leaf?.setViewState({ type: VIEW_TYPE_IMGMD, active: true });
  }

  async saveSettings() { await this.saveData(this.settings); }
}
