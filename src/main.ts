import { Plugin, WorkspaceLeaf, TFile, Notice, Editor, Menu, getLanguage, Platform } from "obsidian";
import { migrateVisionModel, defaultSettings, ImageToMarkdownSettings, ImageToMarkdownSettingTab, migrateEndpoints, fmMapFromSettings } from "./settings";
import { mergeSettings } from "./vendor/kit/settings";
import { setHttp } from "./vision_client";
import { ENDPOINT_CALLER } from "./resolve_endpoint";
import { sanitizeChoice } from "./vendor/kit/endpoint-source";
import { findEndpointManager } from "./vendor/kit-obsidian/endpoint-source";
import { createLlmConnection, type CompleteHandlers, type LlmConnection, type LlmConnectionSettings } from "./vendor/kit-obsidian/llm-connection";
import type { ChatWireMessage } from "./vendor/kit-obsidian/chat-client";
import { loadRequestSettings, onLevelFor, thinkingFor, type FamilyId, type RequestSettings, type ThinkingLevel } from "./vendor/kit/sampling-profiles";
import { MODE, REQUEST_MIGRATIONS } from "./request_params";
import { chatOutOrThrow, type ChatOut } from "./llm_call";
import { VISION_TEST_PROMPT, isVisionConfirmed } from "./capabilities";
import { obsidianHttp } from "./http";
import { runImgToMd, findImageEmbeds, ImgToMdIO, writeTranscripts, writeDescriptions, SUPPORTED_EXTS, classifySource, extOf, buildSelfSourceItem, resolveDestDir } from "./img_to_md";
import { findExistingTranscript, findExistingDescription, BacklinkLookup } from "./backlinks";
import { resolvePromptText, isPromptPreset, PROMPT_PRESETS, promptPresetLabel, normalizePreset } from "./prompts";
import { ImgToMdView, VIEW_TYPE_IMGMD, ImgToMdViewDeps } from "./img_to_md_view";
import { ImgItem } from "./img_to_md_state";
import { buildDescribePrompt } from "./describe";
import { buildRefineMessages } from "./refine";
import { setLang, pickLang, t, getLang } from "./i18n";
import { binaryToDataUrl } from "./vendor/kit/data-url";
import { localDate } from "./vendor/kit/local-stamp";
import { pdfPageCount, renderPdfPage, extractPdfPageText } from "./pdf_render";
import { writePdfTranscript, countNonWhitespace, PDF_TEXTLAYER_MIN_CHARS } from "./pdf_to_md";
import { DiffModal } from "./diff_modal";
import { CardCache } from "./card_cache";
import { diffMappings, planMigration } from "./fm_migration";
import { MigrationModal } from "./migration_modal";
import type { FrontmatterMap } from "./frontmatter_map";
import { copyToClipboard } from "./vendor/kit-obsidian/clipboard";
import { createShortcutsBridge, type ShortcutsBridge } from "./vendor/kit-obsidian/shortcuts-bridge";
import type { OcrProviderApi, OcrProviderError } from "./vendor/kit/ocr-provider";
import { createOcrProviderApi, shortcutResultToOcr } from "./ocr_provider";

/** Die Handler eines Stream-Aufrufs der View. */
function streamHandlers(onToken: (t: string) => void, onReasoning: (t: string) => void, signal?: AbortSignal, onContentReset?: () => void): CompleteHandlers {
  return { onToken, onReasoning, ...(signal ? { signal } : {}), ...(onContentReset ? { onContentReset } : {}) };
}

export default class ImageToMarkdownPlugin extends Plugin {
  settings!: ImageToMarkdownSettings;
  /** Die ganze LLM-Anbindung (Kit `createLlmConnection`): Endpunkt-Quelle (Manager zuerst, sonst die
   *  lokale Liste mit Schlüsselbund), gemerkte Auflösung, Modellliste, Anfrage-Profil, Client mit
   *  Transport und Fristen, Schwärzung, Prüfung der Antwort und die Settings-Abschnitte. */
  llm!: LlmConnection;
  /** Das Modell für jeden Vision-Aufruf: die Quelle entscheidet (Zeilen-Modell bzw. Wahl beim Manager). */
  get model(): string {
    // Nach `invalidate()` ist die Auflösung bis zur nächsten neutral: mit Manager steht die Wahl dann in
    // `choice.model`, nicht in der Zeile. `modelInUse()` nennt auch eine noch ausstehende Wahl von `setModel`.
    return this.llm.modelInUse() || (findEndpointManager(this.app) ? this.settings.choice.model : undefined) || "";
  }
  /** Der offene Settings-Tab hängt hier die Fähigkeits-Anzeige ein: sie folgt dem Modell der Zeile. */
  onSourceResolved?: () => void;
  private pendingCards = new CardCache();
  /** Anbieter-API v1 (Spec Baustein 4/D, Kit-Vertrag `ocr-provider`) — Konsumenten fragen
   *  `app.plugins.plugins["image-to-markdown"].api`, nie die Brücke direkt. Sofort in onload
   *  gesetzt (Muster lingotuner): sobald das Plugin-Objekt sichtbar ist, soll `api` da sein. */
  api!: OcrProviderApi;
  private shortcutsBridge!: ShortcutsBridge;

  private openPath = (p: string): void => {
    const f = this.app.vault.getAbstractFileByPath(p);
    if (f instanceof TFile) void this.app.workspace.getLeaf(false).openFile(f);
  };

  async onload() {
    setHttp(obsidianHttp);   // nur noch für die Fähigkeits-Probe der Settings
    setLang(pickLang(getLanguage()));
    const saved = (await this.loadData()) as Partial<ImageToMarkdownSettings> | null;
    this.settings = mergeSettings(defaultSettings(), saved);
    // Anfrage-Einstellungen: laden, Altfeld `suppressThinking` nachziehen und danach entfernen.
    const { request, dropped } = loadRequestSettings(saved, REQUEST_MIGRATIONS);
    this.settings.request = request;
    delete (this.settings as { suppressThinking?: unknown }).suppressThinking;
    if (dropped.length > 0) {
      new Notice(t("request.dropped", String(dropped.length)));
      console.warn("image-to-markdown: request settings dropped", dropped);
    }
    const migratedEps = migrateEndpoints(saved);
    const folded = migrateVisionModel(saved as { visionModel?: unknown } | null, migratedEps.length ? migratedEps : defaultSettings().visionEndpoints);
    this.settings.visionEndpoints = folded.endpoints;
    delete (this.settings as { visionModel?: unknown }).visionModel;
    this.settings.choice = sanitizeChoice(this.settings.choice);
    this.settings.promptPreset = normalizePreset(this.settings.promptPreset);
    this.llm = createLlmConnection({
      app: this.app,
      pluginId: this.manifest.id,
      caller: ENDPOINT_CALLER,
      capability: "vision",
      mode: MODE,   // kein maxTokens: i2m sendet kein Budget, ein abgeschnittenes Transkript meldet finish_reason length
      lang: () => getLang(),
      levelPicker: true,   // die Sidebar zeigt die Stufenwahl (buildThinkingControl, ImgToMdView)
      onResolved: () => { this.onSourceResolved?.(); },
      getSettings: () => ({
        endpoints: this.settings.visionEndpoints,
        choice: this.settings.choice,
        request: this.settings.request,
      }),
      // Erst in die Settings schreiben, dann speichern: die Endpunkt-Liste liest ihre Zeilen danach zurück.
      persist: (patch: Partial<LlmConnectionSettings>) => {
        if (patch.endpoints !== undefined) this.settings.visionEndpoints = patch.endpoints;
        if (patch.choice !== undefined) this.settings.choice = patch.choice;
        if (patch.request !== undefined) this.settings.request = patch.request;
        const saved = this.saveSettings();
        if (patch.request !== undefined) this.refreshThinkingControls();
        return saved;
      },
    });
    if (folded.changed) await this.saveSettings();
    void this.llm.resolve().then(() => { this.refreshThinkingControls(); }).catch(() => { /* source() bleibt neutral */ });

    this.shortcutsBridge = createShortcutsBridge(this, { protocolAction: "image-to-markdown-shortcut" });
    this.api = createOcrProviderApi({ extractText: (p) => this.extractTextViaOcr(p) });

    this.addSettingTab(new ImageToMarkdownSettingTab(this.app, this));
    this.registerView(VIEW_TYPE_IMGMD, (leaf: WorkspaceLeaf) => new ImgToMdView(leaf, this.makeImgViewDeps()));
    this.addRibbonIcon("scan-text", "Image → Markdown", () => this.activateImgMdView());
    this.addCommand({ id: "open-sidebar", name: t("cmd.openSidebar"), callback: () => this.activateImgMdView() });
    this.addCommand({ id: "transcribe-active-note", name: t("cmd.transcribeActive"), callback: () => {
      const f = this.app.workspace.getActiveFile();
      if (!f) { new Notice(t("notice.noActiveNote")); return; }
      void runImgToMd(this.makeImgIO(), f.path, { map: this.fmMap() });
    } });
    this.registerEvent(this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor) => {
      const cur = editor.getCursor();
      const line = editor.getLine(cur.line);
      const embeds = findImageEmbeds(line).filter(e => e.embed);   // Kontextmenü nur über Embeds (reine Links = Sidebar)
      const f = this.app.workspace.getActiveFile();
      if (!embeds.length || !f) return;
      // Bild unter dem Cursor wählen (sonst das erste der Zeile)
      let chosen = embeds[0];
      for (const e of embeds) {
        const start = line.indexOf(e.raw);
        if (start >= 0 && cur.ch >= start && cur.ch <= start + e.raw.length) { chosen = e; break; }
      }
      const raw = chosen.raw;
      menu.addItem(item => item.setTitle("Image → Markdown").setIcon("scan-text").onClick(() => void runImgToMd(this.makeImgIO(), f.path, { onlyRaw: raw, map: this.fmMap() })));
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refreshImgViews()));
  }

  /** Nachrichten für ein Bild (Text-Prompt + Bild als image_url-Data-URL). Bildteile baut das Plugin
   *  selbst — die Verbindung nimmt fertige `messages`. */
  private imageMessages(dataUrl: string, prompt: string): ChatWireMessage[] {
    return [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    }];
  }

  /** EIN Aufruf der Verbindung mit Ergebnis oder Fehler im Format der View. Mit `retry`: schlägt er
   *  fehl (und wurde nicht abgebrochen), löst die Verbindung neu auf — ein anderer Endpunkt der Liste
   *  kann inzwischen erreichbar sein — und versucht es einmal erneut. */
  private async callLlm(messages: readonly ChatWireMessage[], h: CompleteHandlers, retry = false): Promise<ChatOut> {
    // Kam schon Text an (die Karte hängt ihn an), würde ein zweiter Lauf ihn doppeln: dann kein Retry.
    let received = false;
    const run = async (): Promise<ChatOut> => chatOutOrThrow(await this.llm.complete({ messages }, {
      ...h, onToken: (text: string) => { received = true; h.onToken?.(text); },
    }));
    if (!retry) return run();
    try {
      return await run();
    } catch (err) {
      if (received || h.signal?.aborted || (err instanceof Error && err.name === "AbortError")) throw err;
      this.llm.invalidate();
      const src = await this.llm.resolve({ force: true }).catch(() => null);
      this.refreshThinkingControls();
      if (src?.config) return run();
      throw err;
    }
  }

  /** Nach einer Änderung an Modell oder Liste: gemerkte Auflösung verwerfen, neu auflösen und die
   *  Denk-Knöpfe der Sidebar nachziehen (Familie kann sich geändert haben). */
  async reconnect(): Promise<void> {
    this.llm.invalidate();
    await this.llm.resolve().catch(() => undefined);
    this.refreshThinkingControls();
  }

  /** Aktiver Vision-Test der Settings: schickt das Test-Bild und prüft, ob die Antwort das erwartete
   *  Token enthält. Wirft bei Netz-/HTTP-Fehler (Endpunkt nicht erreichbar). */
  async testVision(model: string, dataUrl: string): Promise<boolean> {
    const r = await this.llm.complete({ messages: this.imageMessages(dataUrl, VISION_TEST_PROMPT) }, { model, stream: false });
    return isVisionConfirmed(chatOutOrThrow(r).content);
  }

  async saveRequestSettings(next: RequestSettings): Promise<void> {
    this.settings.request = next;
    await this.saveSettings();
    this.refreshThinkingControls();
  }

  /** Stellt die Denkstufe aus der Sidebar. Bei `≠ off` merkt sich `lastOnLevel`, auf welche Stufe
   *  der Zwei-Zustands-Knopf beim Wiedereinschalten springt. */
  async setThinkingLevel(level: ThinkingLevel): Promise<void> {
    const r = this.settings.request;
    const next: RequestSettings = {
      ...r,
      thinking: { ...r.thinking, [MODE]: level },
      lastOnLevel: level === "off" ? r.lastOnLevel : { ...r.lastOnLevel, [MODE]: level },
    };
    await this.saveRequestSettings(next);
  }

  thinkingState(): { family: FamilyId | null; level: ThinkingLevel; onLevel: ThinkingLevel; levelPicker: boolean } {
    const r = this.settings.request;
    return { family: this.llm.source().family, level: thinkingFor(r, MODE), onLevel: onLevelFor(r, MODE), levelPicker: r.levelPickerInChat };
  }

  private refreshThinkingControls(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_IMGMD)) {
      if (leaf.view instanceof ImgToMdView) leaf.view.refreshThinking();
    }
  }

  /** Backend-Auswahl der Anbieter-API (Spec Baustein 4/D): abstrahiert über die WEGE
   *  (Kurzbefehl mobil, Vision-LLM desktop), nie über die Brücke — ein Konsument des `api`
   *  merkt den Unterschied nie. v1 ohne PDF (Spec § Nicht-Ziele): eine PDF-Quelle ist "unsupported". */
  private async extractTextViaOcr(vaultPath: string): Promise<string | OcrProviderError> {
    if (this.settings.ocrMethod === "shortcut") {
      const r = await this.shortcutsBridge.run({
        shortcut: this.settings.ocrShortcutName,
        input: vaultPath,
        timeoutMs: this.settings.ocrTimeoutMs,
      });
      return shortcutResultToOcr(r);
    }
    const f = this.app.vault.getAbstractFileByPath(vaultPath);
    if (!(f instanceof TFile)) return { error: "not-found", message: `Datei nicht gefunden: ${vaultPath}` };
    const ext = f.extension.toLowerCase();
    if (!SUPPORTED_EXTS.includes(ext)) return { error: "unsupported", message: `Dateityp nicht unterstützt: .${ext}` };
    if (!(await this.llm.resolve()).config) return { error: "backend-unavailable", message: "kein Vision-Endpunkt erreichbar" };
    try {
      const dataUrl = binaryToDataUrl(await this.app.vault.adapter.readBinary(vaultPath), ext);
      const prompt = resolvePromptText(this.settings.promptPreset, this.settings.visionPrompt);
      // Ohne Denken: ein Konsument (Koda read_image) will den Text, nicht den Gedankengang — manche Backends (gemma-4 unter LM Studio)
      // schreiben ihn sonst in den Inhalt. Die Stufe der Sidebar bleibt unberuehrt (nur dieser Aufruf).
      const { content } = await this.callLlm(this.imageMessages(dataUrl, prompt), { stream: false, thinking: "off" });
      return content;
    } catch (e) {
      return { error: "failed", message: e instanceof Error ? e.message : String(e) };
    }
  }

  // Kein Caching: die Settings-UI mutiert this.settings live, jeder Aufruf muss den aktuellen Stand lesen.
  private fmMap() { return fmMapFromSettings(this.settings); }

  /** Bietet vor dem Übernehmen eines geänderten Frontmatter-Mappings die Vault-weite Migration an.
   *  Ohne Diff (keine Vault-Notiz betroffen) wird `newMap` still übernommen — sonst entscheidet
   *  der Nutzer per MigrationModal zwischen "migrieren+anwenden", "nur anwenden" und "abbrechen".
   *  `frontmatterMap` wird ausschließlich hier persistiert (settings.ts committet nur bei blur
   *  und ruft diese Methode auf; bei "cancel" bleibt der gespeicherte Stand unverändert). */
  async offerFmMigration(oldMap: FrontmatterMap, newMap: FrontmatterMap): Promise<void> {
    const changes = diffMappings(oldMap, newMap);
    if (changes.length === 0) return;

    const files = this.app.vault.getMarkdownFiles();
    const withContent = await Promise.all(files.map(async f => ({ path: f.path, content: await this.app.vault.read(f) })));
    const plan = planMigration(withContent, oldMap, newMap);

    if (plan.migrations.length === 0 && plan.conflicts.length === 0) {
      this.settings.frontmatterMap = newMap;
      await this.saveSettings();
      return;
    }

    return new Promise<void>((resolve) => {
      new MigrationModal(this.app, plan, changes, (choice) => {
        void (async () => {
          try {
            if (choice === "migrate") {
              this.settings.frontmatterMap = newMap;
              await this.saveSettings();
              let ok = 0, fail = 0;
              for (const p of plan.migrations) {
                const file = this.app.vault.getAbstractFileByPath(p.path);
                if (!(file instanceof TFile)) { fail++; continue; }
                try { await this.app.vault.modify(file, p.next); ok++; }
                catch (e) { fail++; console.error("[i2m-migration]", p.path, e); }
              }
              new Notice(t("migration.reportDone", String(ok), String(fail), String(plan.conflicts.length)));
            } else if (choice === "apply") {
              this.settings.frontmatterMap = newMap;
              await this.saveSettings();
              new Notice(t("migration.appliedNoMigrate", String(plan.migrations.length + plan.conflicts.length)));
            }
            // "cancel": nichts speichern — settings.ts rendert das Feld aus dem unveränderten settings neu.
          } catch (e) {
            console.error("[i2m-migration]", e);
          } finally {
            resolve();
          }
        })();
      }).open();
    });
  }

  private makeImgIO(): ImgToMdIO {
    return {
      date: () => localDate(new Date()),
      readNote: (p) => this.app.vault.adapter.read(p),
      writeNote: async (p, c) => {
        const f = this.app.vault.getAbstractFileByPath(p);
        if (f instanceof TFile) await this.app.vault.modify(f, c); else await this.app.vault.adapter.write(p, c);
      },
      createNote: async (p, c) => { await this.app.vault.create(p, c); },
      noteExists: (p) => this.app.vault.getAbstractFileByPath(p) != null,
      resolveImage: (link, src) => { const f = this.app.metadataCache.getFirstLinkpathDest(link, src); return f ? { path: f.path, ext: f.extension } : null; },
      readImageDataUrl: async (p, ext) => binaryToDataUrl(await this.app.vault.adapter.readBinary(p), ext),
      // Ohne Stream (Befehl „Transcribe active note“, Kontextmenü): die Fristen bleiben die der Volltext-Antwort.
      transcribe: (dataUrl) => this.callLlm(this.imageMessages(dataUrl, resolvePromptText(this.settings.promptPreset, this.settings.visionPrompt)), { stream: false }),
      notify: (m) => { new Notice(m); },
      confirmOverwrite: (ctx) => new Promise<string | null>((resolve) => new DiffModal(this.app, ctx.path, ctx.diff, resolve).open()),
    };
  }

  private backlinkLookup(): BacklinkLookup {
    return {
      resolvedLinks: this.app.metadataCache.resolvedLinks,
      frontmatterLinks: (notePath) => {
        const f = this.app.vault.getAbstractFileByPath(notePath);
        const cache = f instanceof TFile ? this.app.metadataCache.getFileCache(f) : null;
        return (cache?.frontmatterLinks ?? []).map(fl => ({ key: fl.key, link: fl.link }));
      },
      resolveLink: (link, fromPath) => this.app.metadataCache.getFirstLinkpathDest(link, fromPath)?.path ?? null,
      frontmatterValue: (notePath, key) => {
        const f = this.app.vault.getAbstractFileByPath(notePath);
        if (!(f instanceof TFile)) return null;
        const cache = this.app.metadataCache.getFileCache(f);
        if (!cache?.frontmatter) return null;
        const value: unknown = cache.frontmatter[key];
        return typeof value === "string" ? value : null;
      },
    };
  }

  private makeImgViewDeps(): ImgToMdViewDeps {
    return {
      getActivePath: () => this.app.workspace.getActiveFile()?.path ?? null,
      scan: async (sourcePath: string): Promise<ImgItem[]> => {
        const lookup = this.backlinkLookup();
        const cls = classifySource(extOf(sourcePath));
        if (cls) {   // aktive Datei IST ein Bild/PDF → Selbst-Quelle
          const existingTranscriptPath = findExistingTranscript(lookup, sourcePath, this.fmMap()) ?? undefined;
          const existingDescriptionPath = findExistingDescription(lookup, sourcePath, this.fmMap()) ?? undefined;
          let pageCount: number | undefined;
          if (cls === "pdf") {
            try { pageCount = await pdfPageCount(await this.app.vault.adapter.readBinary(sourcePath)); } catch { pageCount = 0; }
          }
          const item = buildSelfSourceItem(sourcePath, { pageCount, existingTranscriptPath, pdfMaxPages: this.settings.pdfMaxPages });
          if (item) item.existingDescriptionPath = existingDescriptionPath;
          return item ? [item] : [];
        }
        let content: string;
        try { content = await this.app.vault.adapter.read(sourcePath); } catch { return []; }
        const seen = new Set<string>();
        const items: ImgItem[] = [];
        for (const e of findImageEmbeds(content)) {
          if (seen.has(e.link)) continue; seen.add(e.link);
          const resolved = this.app.metadataCache.getFirstLinkpathDest(e.link, sourcePath);
          const existingTranscriptPath = resolved ? (findExistingTranscript(lookup, resolved.path, this.fmMap()) ?? undefined) : undefined;
          const existingDescriptionPath = resolved ? (findExistingDescription(lookup, resolved.path, this.fmMap()) ?? undefined) : undefined;
          if (e.kind === "pdf") {
            let pageCount = 0;
            if (resolved) {
              try { pageCount = await pdfPageCount(await this.app.vault.adapter.readBinary(resolved.path)); } catch { pageCount = 0; }
            }
            const supported = pageCount > 0;
            const cappedTo = Math.min(pageCount, this.settings.pdfMaxPages);
            items.push({ raw: e.raw, link: e.link, ext: e.ext, supported, kind: "pdf", pageCount, range: { from: 1, to: cappedTo > 0 ? cappedTo : 1 }, existingTranscriptPath, existingDescriptionPath, embed: e.embed });
          } else {
            items.push({ raw: e.raw, link: e.link, ext: e.ext, supported: SUPPORTED_EXTS.includes(e.ext.toLowerCase()), kind: "image", existingTranscriptPath, existingDescriptionPath, embed: e.embed });
          }
        }
        return items;
      },
      transcribeStream: async (sourcePath, item, onContent, onReasoning, signal, page, onContentReset) => {
        let filePath: string; let ext: string;
        if (item.selfSource) { filePath = sourcePath; ext = item.ext; }
        else {
          const resolved = this.app.metadataCache.getFirstLinkpathDest(item.link, sourcePath);
          if (!resolved) throw new Error(t("core.imageNotFound", item.link));
          filePath = resolved.path; ext = resolved.extension;
        }
        // Apple-Kurzbefehl-Weg (Spec Baustein 4): nur fuer Bilder, v1 ohne PDF — eine PDF-Quelle
        // laeuft unveraendert ueber den Vision-Weg unten. Kein Streaming: einmalige Lieferung
        // ueber denselben onContent-Callback, den auch der Vision-Weg nutzt (Karten-UI bleibt
        // unveraendert). Ein Fehler wirft, der bestehende Karten-Fehlerzustand faengt ihn auf.
        if (this.settings.ocrMethod === "shortcut" && item.kind !== "pdf") {
          const r = await this.extractTextViaOcr(filePath);
          if (typeof r !== "string") throw new Error(r.message);
          onContent(r);
          return { content: r, reasoning: "", model: "apple-shortcut" };
        }
        let dataUrl: string;
        if (item.kind === "pdf") {
          if ((item.range?.to ?? 1) - (item.range?.from ?? 1) + 1 > this.settings.pdfMaxPages) {
            throw new Error(t("core.pdfTooManyPages", item.pageCount ?? 0, this.settings.pdfMaxPages));
          }
          const scale = Platform.isMobile ? Math.min(this.settings.pdfRenderScale, 1.5) : this.settings.pdfRenderScale;
          const bytes = await this.app.vault.adapter.readBinary(filePath);
          if (this.settings.pdfUseTextLayer) {
            // Extraktions-Fehler (kaputter/partieller Text-Layer) → "" → Fallback auf Render+OCR,
            // statt die Seite scheitern zu lassen (die das Vision-Modell evtl. gerettet hätte).
            let layerText = "";
            try { layerText = await extractPdfPageText(bytes, page ?? 1); } catch { layerText = ""; }
            if (countNonWhitespace(layerText) >= PDF_TEXTLAYER_MIN_CHARS) {
              const fmt = t("pdf.textLayerPrompt");
              return this.callLlm([{ role: "user", content: `${fmt}\n\n${layerText}` }], streamHandlers(onContent, onReasoning, signal, onContentReset), true);
            }
          }
          dataUrl = await renderPdfPage(bytes, page ?? 1, scale);
        } else {
          dataUrl = binaryToDataUrl(await this.app.vault.adapter.readBinary(filePath), ext);
        }
        const prompt = resolvePromptText(this.settings.promptPreset, this.settings.visionPrompt);
        return this.callLlm(this.imageMessages(dataUrl, prompt), streamHandlers(onContent, onReasoning, signal, onContentReset), true);
      },
      writeTranscripts: async (sourcePath, entries) => {
        const self = classifySource(extOf(sourcePath)) !== null;
        const selfDir = self ? this.app.fileManager.getNewFileParent(sourcePath).path : undefined;
        const destDir = resolveDestDir(this.settings.exportFolder, selfDir);
        const { results } = await writeTranscripts(this.makeImgIO(), sourcePath, entries.map(e => ({ raw: e.item.raw, link: e.item.link, content: e.content, model: e.model, overwritePath: e.item.existingTranscriptPath, embed: e.item.embed, knownBody: e.knownBody, truncated: e.truncated })), { selfSource: self, destDir, map: this.fmMap() });
        return results;
      },
      writePdf: async (sourcePath, raw, link, pages, overwritePath, embed, range, knownBody) => {
        const self = classifySource(extOf(sourcePath)) !== null;
        const selfDir = self ? this.app.fileManager.getNewFileParent(sourcePath).path : undefined;
        const destDir = resolveDestDir(this.settings.exportFolder, selfDir);
        const { path, body } = await writePdfTranscript(this.makeImgIO(), sourcePath, { raw, link }, pages, this.settings.pdfPageSeparator, overwritePath, embed, { selfSource: self, destDir, range, knownBody, map: this.fmMap() });
        return { path, body };
      },
      describeStream: async (sourcePath, item, onContent, onReasoning, signal, onContentReset) => {
        let filePath: string; let ext: string;
        if (item.selfSource) { filePath = sourcePath; ext = item.ext; }
        else {
          const resolved = this.app.metadataCache.getFirstLinkpathDest(item.link, sourcePath);
          if (!resolved) throw new Error(t("core.imageNotFound", item.link));
          filePath = resolved.path; ext = resolved.extension;
        }
        let dataUrl: string;
        if (item.kind === "pdf") {
          // Beschreiben-Modus kennt (anders als transcribeStream) keine einzelne Karten-Seite in der
          // Deps-Signatur — pragmatisch: erste Seite der gewählten Range (typischer Anwendungsfall
          // von "beschreiben" sind Einzelbilder, nicht mehrseitige Dokumente).
          const scale = Platform.isMobile ? Math.min(this.settings.pdfRenderScale, 1.5) : this.settings.pdfRenderScale;
          const bytes = await this.app.vault.adapter.readBinary(filePath);
          dataUrl = await renderPdfPage(bytes, item.range?.from ?? 1, scale);
        } else {
          dataUrl = binaryToDataUrl(await this.app.vault.adapter.readBinary(filePath), ext);
        }
        const prompt = buildDescribePrompt(this.settings.describeTaxonomy, getLang());
        const r = await this.callLlm(this.imageMessages(dataUrl, prompt), streamHandlers(onContent, onReasoning, signal, onContentReset), true);
        return { raw: r.content, reasoning: r.reasoning, model: r.model, finishReason: r.finishReason };
      },
      refine: async (base, steps, feedback, onContent, onReasoning, signal, onContentReset) => {
        const messages = buildRefineMessages(base, steps, feedback, t("refine.systemPrompt"));
        return this.callLlm(messages, streamHandlers(onContent, onReasoning, signal, onContentReset), true);
      },
      getTaxonomy: () => this.settings.describeTaxonomy,
      writeDescriptions: async (sourcePath, entries) => {
        const self = classifySource(extOf(sourcePath)) !== null;
        const selfDir = self ? this.app.fileManager.getNewFileParent(sourcePath).path : undefined;
        const destDir = resolveDestDir(this.settings.exportFolder, selfDir);
        const { results } = await writeDescriptions(
          this.makeImgIO(), sourcePath,
          entries.map(e => ({ link: e.item.link, category: e.category, tags: e.tags, prose: e.prose, model: e.model })),
          { selfSource: self, destDir, map: this.fmMap() },
        );
        return results;
      },
      getMode: () => this.settings.mode,
      setMode: (m) => { this.settings.mode = m; void this.saveSettings(); },
      connectionStatus: async () => {
        const src = await this.llm.resolve({ force: true });
        this.refreshThinkingControls();
        return { ok: src.config !== null, endpoint: src.config?.url ?? null };
      },
      // Mit Manager gibt es keinen lokalen Rückfall — ohne aufgelösten Endpunkt bleibt die Liste leer.
      listModels: async () => (await this.llm.models({ force: true })).models,
      getModel: () => this.model,
      // Mit Manager gehört das Modell zur Wahl (choice.model), ohne Manager zur aktiven Zeile — beides macht die Verbindung.
      setModel: (m: string) => { void this.llm.setModel(m).then(() => { this.refreshThinkingControls(); }); },
      listPresets: () => PROMPT_PRESETS.map(id => ({ id, label: promptPresetLabel(id) })),
      getPreset: () => this.settings.promptPreset,
      setPreset: (id: string) => { this.settings.promptPreset = isPromptPreset(id) ? id : "default"; void this.saveSettings(); },
      thinkingState: () => this.thinkingState(),
      getReasoningExpanded: () => this.settings.reasoningExpanded,
      setThinkingLevel: (l: ThinkingLevel) => this.setThinkingLevel(l),
      openPath: this.openPath,
      copyText: (text: string) => { void copyToClipboard(text, { copiedMessage: t("notice.copied"), failedMessage: t("notice.copyFailed") }); },
      cardCache: this.pendingCards,
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
    if (!leaf) return;
    await leaf.setViewState({ type: VIEW_TYPE_IMGMD, active: true });
    // revealLeaf auch hier — nicht nur im Zweig darueber. setViewState ERZEUGT das Blatt,
    // klappt aber den rechten Split nicht auf: ist er zu (der Normalzustand eines frischen
    // Vaults), entsteht die View mit 0x0 px und der erste Klick aufs Ribbon-Icon tut
    // sichtbar nichts. Erst der zweite nahm den Zweig oben und oeffnete sie. Gemessen am
    // 2026-08-30 im GUI-Smoke (Pruefpunkt A2) — 498 Unit-Tests sehen das nicht, weil es
    // keine Aussage ueber Zustand ist, sondern ueber Sichtbarkeit.
    await this.app.workspace.revealLeaf(leaf);
  }

  async saveSettings() { await this.saveData(this.settings); }
}
