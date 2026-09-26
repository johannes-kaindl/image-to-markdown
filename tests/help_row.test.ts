import { describe, it, expect, vi, afterEach } from "vitest";
import { Setting } from "obsidian";
import { ImageToMarkdownSettingTab, defaultSettings } from "../src/settings";
import { setLang } from "../src/i18n";

// UI-STANDARD §8 „Hilfe-Zeile (Settings)": erstes Element des Tabs, „Open documentation" auf
// den Doku-Index, `bug`-Knopf auf die Issues dieses Repos.
const DOCS = "https://github.com/johannes-kaindl/image-to-markdown/blob/main/docs/README.md";
const ISSUES = "https://github.com/johannes-kaindl/image-to-markdown/issues";

function makeTab(): ImageToMarkdownSettingTab {
  const plugin = { settings: defaultSettings(), model: "", activeEndpoint: null } as never;
  return new ImageToMarkdownSettingTab({} as never, plugin);
}

afterEach(() => { vi.restoreAllMocks(); setLang("en"); });

describe("Hilfe-Zeile in den Settings", () => {
  it("ist das ERSTE Element von getSettingDefinitions()", () => {
    const first = makeTab().getSettingDefinitions()[0] as { name?: string; render?: unknown; type?: string };
    expect(first.type).not.toBe("group");
    expect(first.name).toBe("Help");
    expect(typeof first.render).toBe("function");
  });

  it("öffnet Doku-Index und Issues dieses Repos", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const first = makeTab().getSettingDefinitions()[0] as { render: (s: Setting) => void };
    const setting = new Setting({ createDiv: () => ({}) } as never);
    first.render(setting);
    const [docsBtn, bugBtn] = (setting as unknown as { components: Array<{ textValue?: string; iconName?: string; tooltip?: string; clickCB: () => void }> }).components;
    expect(docsBtn.textValue).toBe("Open documentation");
    expect(bugBtn.iconName).toBe("bug");
    expect(bugBtn.tooltip).toBe("Report an issue");
    docsBtn.clickCB();
    bugBtn.clickCB();
    expect(open.mock.calls.map((c) => c[0])).toEqual([DOCS, ISSUES]);
  });

  it("spricht Deutsch, wenn die Oberfläche Deutsch ist", () => {
    setLang("de");
    const first = makeTab().getSettingDefinitions()[0] as { name?: string; desc?: string };
    expect(first.name).toBe("Hilfe");
    expect(first.desc).toBe("Erste Schritte, Anleitungen und Fehlersuche");
  });
});
