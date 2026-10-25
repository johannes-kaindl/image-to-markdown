import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { PluginSettingTab } from "obsidian";
import { ImageToMarkdownSettingTab, defaultSettings } from "../src/settings";

// Kit-Vertrag `installTabRefreshOnOpen` (gemessen an Obsidian 1.14.5): das Öffnen ruft `renderTab()`, nicht `display()`. Der Haken baut den Tab
// nur dann bei JEDEM Öffnen neu auf, solange er installiert bleibt; ein Abbau in `hide()` ließ ihn nach dem ersten Schließen verschwinden.
const NATIVE = vi.fn();
type Proto = { renderTab?: () => void };

beforeEach(() => { (PluginSettingTab.prototype as Proto).renderTab = NATIVE; NATIVE.mockClear(); });
afterEach(() => { delete (PluginSettingTab.prototype as Proto).renderTab; vi.restoreAllMocks(); });

function makeTab() {
  const plugin = { settings: defaultSettings(), model: "", activeEndpoint: null, llm: { hideSettings: vi.fn() }, onSourceResolved: undefined } as never;
  const tab = new ImageToMarkdownSettingTab({} as never, plugin);
  const rebuild = vi.spyOn(tab as unknown as { renderFallback(): void }, "renderFallback").mockImplementation(() => {});
  return { tab, rebuild };
}

describe("Einstellungen-Tab: der Öffnen-Haken", () => {
  it("jedes Öffnen baut den Tab neu auf, auch nach hide()", () => {
    const { tab, rebuild } = makeTab();
    const open = (): void => { (tab as unknown as Proto).renderTab?.(); };
    open();
    tab.hide();
    open();
    tab.hide();
    open();
    expect(rebuild).toHaveBeenCalledTimes(3);
    expect(NATIVE).not.toHaveBeenCalled();
  });

  it("hide() lässt den Haken stehen: renderTab bleibt die Funktion des Hakens, nicht die native", () => {
    const { tab } = makeTab();
    const hook = (tab as unknown as Proto).renderTab;
    expect(hook).not.toBe(NATIVE);
    tab.hide();
    expect((tab as unknown as Proto).renderTab).toBe(hook);
  });

  it("dispose() (aus onunload) nimmt den Haken ab: renderTab ist wieder die native Funktion", () => {
    const { tab } = makeTab();
    tab.dispose();
    expect((tab as unknown as Proto).renderTab).toBe(NATIVE);
  });
});
