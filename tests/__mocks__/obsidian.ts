export function makeFakeEl(): any {
  const children: any[] = [];
  const attrs: Record<string, string> = {};
  let _ownText = "";
  const el: any = {
    children, empty: () => { children.length = 0; _ownText = ""; },
    createDiv: (o?: any) => { const c = makeFakeEl(); if (o?.cls) c.className = o.cls; if (o?.text) c.textContent = o.text; children.push(c); return c; },
    createSpan: (o?: any) => { const c = makeFakeEl(); if (o?.cls) c.className = o.cls; if (o?.text) c.textContent = o.text; children.push(c); return c; },
    createEl: (t: string, o?: any) => { const c = makeFakeEl(); c.tagName = t.toUpperCase(); if (o?.text) c.textContent = o.text; if (o?.cls) c.className = o.cls; children.push(c); return c; },
    setText: (t: string) => { _ownText = t; },
    addClass: (c: string) => { const s = String(el.className ?? "").split(" ").filter(Boolean); if (!s.includes(c)) s.push(c); el.className = s.join(" "); },
    removeClass: (c: string) => { el.className = String(el.className ?? "").split(" ").filter((x: string) => x && x !== c).join(" "); },
    _listeners: {} as Record<string, Function[]>,
    addEventListener: (event: string, cb: Function) => { if (!el._listeners[event]) el._listeners[event] = []; el._listeners[event].push(cb); },
    setAttribute: (name: string, val: string) => { attrs[name] = String(val); },
    getAttribute: (name: string) => (name in attrs ? attrs[name] : null),
    click: () => { (el._listeners["click"] ?? []).forEach((cb: Function) => cb()); },
  };
  // textContent aggregiert wie im echten DOM den eigenen Text + alle Kinder.
  Object.defineProperty(el, "textContent", {
    get: () => _ownText + children.map((c: any) => c.textContent ?? "").join(""),
    set: (v: string) => { _ownText = v; },
    enumerable: true,
    configurable: true,
  });
  return el;
}
export class Plugin { app: any; manifest: any; constructor(app: any, m: any) { this.app = app; this.manifest = m; } async loadData() { return {}; } async saveData(_: any) {} addCommand(_: any) {} registerView(_: string, __: any) {} registerEvent(_: any) {} addSettingTab(_: any) {} addRibbonIcon(_: string, __: string, ___: any) { return makeFakeEl(); } }
export class ItemView { app: any; contentEl: any; constructor(public leaf: any) { this.app = leaf?.app || {}; this.contentEl = makeFakeEl(); } getViewType() { return "unknown"; } getDisplayText() { return ""; } async onOpen() {} async onClose() {} }
export class PluginSettingTab { app: any; plugin: any; containerEl: any; constructor(app: any, plugin: any) { this.app = app; this.plugin = plugin; this.containerEl = makeFakeEl(); } display() {} }
export class Setting { constructor(public containerEl: any) {} setName(_: string) { return this; } setDesc(_: string) { return this; } addText(cb: any) { cb({ setValue: () => ({ onChange: () => {} }), setPlaceholder: () => ({}) }); return this; } addSlider(cb: any) { cb({ setLimits: () => ({ setValue: () => ({ onChange: () => {} }) }) }); return this; } }
export class TFile { path = ""; basename = ""; extension = "md"; }
export function setIcon(el: any, name: string): void { el?.setAttribute?.("data-icon", name); }
export function getLanguage(): string { return "en"; }
export class Notice { constructor(_message: string) {} }
import { vi } from "vitest";

export function makeFakeApp(): any {
  return {
    vault: {
      adapter: {
        read: vi.fn().mockResolvedValue(""),
        readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
        write: vi.fn().mockResolvedValue(undefined),
        writeBinary: vi.fn().mockResolvedValue(undefined),
        mkdir: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockResolvedValue(true),
        stat: vi.fn().mockResolvedValue({ mtime: 0 }),
      },
      on: vi.fn().mockReturnValue({ id: "mock-event" }),
    },
    workspace: {
      getActiveFile: vi.fn().mockReturnValue(null),
      getLeavesOfType: vi.fn().mockReturnValue([]),
      getRightLeaf: vi.fn().mockReturnValue({ setViewState: vi.fn() }),
      on: vi.fn(),
      revealLeaf: vi.fn(),
    },
  };
}
