import { describe, it, expect, vi } from "vitest";
import { ImgToMdView, VIEW_TYPE_IMGMD } from "../src/img_to_md_view";
import { ImgItem } from "../src/img_to_md_state";
import { makeFakeApp } from "./__mocks__/obsidian";

function all(el: any, cls: string): any[] {
  const out: any[] = [];
  const has = (c: any) => String(c.className ?? "").split(" ").includes(cls);
  const walk = (n: any) => (n.children ?? []).forEach((c: any) => { if (has(c)) out.push(c); walk(c); });
  walk(el); return out;
}

const ITEMS: ImgItem[] = [
  { raw: "![[a.png]]", link: "a.png", ext: "png", supported: true, kind: "image" },
  { raw: "![[b.heic]]", link: "b.heic", ext: "heic", supported: false, kind: "image" },
];

function mkView(over: any = {}) {
  const calls: any = { written: [], copied: [], opened: [] };
  const deps = {
    getActivePath: over.getActivePath ?? (() => "q.md"),
    scan: over.scan ?? (async () => ITEMS),
    transcribeStream: over.transcribeStream ?? (async (_sp: string, _it: ImgItem, onContent: any) => { onContent("Hal"); onContent("lo"); return { content: "Hallo", reasoning: "", model: "vm" }; }),
    writeTranscripts: over.writeTranscripts ?? (async (_sp: string, entries: any[]) => { calls.written.push(entries); return entries.map((_: any, i: number) => `note-${i}.md`); }),
    writePdf: over.writePdf ?? (async (_sp: string, _raw: string, _link: string, _pages: any[]) => { calls.written.push(_pages); return "doc (PDF transcript).md"; }),
    ping: over.ping ?? (async () => true),
    listModels: over.listModels ?? (async () => []),
    getModel: over.getModel ?? (() => "vm"),
    setModel: over.setModel ?? vi.fn(),
    openPath: (p: string) => calls.opened.push(p),
    copyText: over.copyText ?? ((t: string) => calls.copied.push(t)),
  };
  const view = new ImgToMdView({ app: makeFakeApp() } as any, deps);
  return { view, calls, deps };
}

describe("ImgToMdView — Gerüst + Liste", () => {
  it("getViewType ist VIEW_TYPE_IMGMD", () => {
    expect(mkView().view.getViewType()).toBe(VIEW_TYPE_IMGMD);
  });
  it("zeigt Verbindungsstatus nach onOpen", async () => {
    const okV = mkView({ ping: async () => true }); await okV.view.onOpen();
    expect(all(okV.view.contentEl, "img2md-status")[0].textContent).toContain("connected");
    const offV = mkView({ ping: async () => false }); await offV.view.onOpen();
    expect(all(offV.view.contentEl, "img2md-status")[0].textContent).toContain("offline");
  });
  it("listet erkannte Bilder mit Checkbox; unsupported ist disabled", async () => {
    const { view } = mkView(); await view.onOpen();
    const checks = all(view.contentEl, "img2md-check");
    expect(checks.length).toBe(2);
    expect(checks[0].checked).toBe(true);     // a.png unterstützt + default an
    expect(checks[1].disabled).toBe(true);    // b.heic nicht unterstützt
    expect(checks[1].checked).toBe(false);
  });
  it("Toggle-Button: alle an → 'Alle abwählen', nach Klick 'Alle auswählen'", async () => {
    const { view } = mkView(); await view.onOpen();
    const btn = () => all(view.contentEl, "img2md-toggle")[0];
    expect(btn().textContent).toBe("Deselect all");
    btn().click();
    expect(btn().textContent).toBe("Select all");
    expect(all(view.contentEl, "img2md-check")[0].checked).toBe(false);
  });
  it("Modell-Switcher ruft setModel bei Auswahl", async () => {
    const setModel = vi.fn();
    const { view } = mkView({ setModel, listModels: async () => ["x", "y"] });
    await view.onOpen();
    const sel = all(view.contentEl, "img2md-model")[0];
    sel.value = "y";
    (sel._listeners["change"] ?? []).forEach((cb: any) => cb());
    expect(setModel).toHaveBeenCalledWith("y");
  });
  it("ohne aktive Notiz: leere Liste, Hinweis", async () => {
    const { view } = mkView({ getActivePath: () => null });
    await view.onOpen();
    expect(all(view.contentEl, "img2md-check").length).toBe(0);
    expect(all(view.contentEl, "img2md-empty").length).toBe(1);
  });
});

describe("ImgToMdView — Transkribieren", () => {
  it("run streamt in eine Karte, Status done, 'Notiz anlegen' erscheint", async () => {
    const { view } = mkView(); await view.onOpen();
    await view.run();
    const cards = all(view.contentEl, "img2md-card");
    expect(cards.length).toBe(1);   // nur a.png (b.heic unsupported)
    expect(all(view.contentEl, "img2md-text")[0].textContent).toBe("Hallo");
    expect(all(view.contentEl, "img2md-write").length).toBe(1);
  });
  it("Karten-Kopf zeigt 'Bild i/n · name'", async () => {
    const { view } = mkView(); await view.onOpen(); await view.run();
    expect(all(view.contentEl, "img2md-card-head")[0].textContent).toContain("Image 1/1");
    expect(all(view.contentEl, "img2md-card-head")[0].textContent).toContain("a.png");
  });
  it("Kopier-Button kopiert den Transkript-Text", async () => {
    const { view, calls } = mkView(); await view.onOpen(); await view.run();
    all(view.contentEl, "img2md-copy")[0].click();
    expect(calls.copied).toEqual(["Hallo"]);
  });
  it("Gedanken-Block nur bei reasoning", async () => {
    const noReason = mkView(); await noReason.view.onOpen(); await noReason.view.run();
    expect(all(noReason.view.contentEl, "img2md-reasoning").length).toBe(0);
    const withReason = mkView({ transcribeStream: async (_sp: string, _it: ImgItem, onC: any, onR: any) => { onR("weil"); onC("Text"); return { content: "Text", reasoning: "weil", model: "vm" }; } });
    await withReason.view.onOpen(); await withReason.view.run();
    expect(all(withReason.view.contentEl, "img2md-reasoning").length).toBe(1);
  });
  it("Transkriptionsfehler → Karte mit Fehler, kein 'Notiz anlegen'", async () => {
    const { view } = mkView({ transcribeStream: async () => { throw new Error("Vision HTTP 500"); } });
    await view.onOpen(); await view.run();
    expect(all(view.contentEl, "img2md-error")[0].textContent).toContain("500");
    expect(all(view.contentEl, "img2md-write").length).toBe(0);
  });
  it("leeres Transkript → Fehler 'Empty transcript', kein 'Notiz anlegen'", async () => {
    const { view } = mkView({ transcribeStream: async () => ({ content: "   ", reasoning: "", model: "vm" }) });
    await view.onOpen(); await view.run();
    expect(all(view.contentEl, "img2md-error")[0].textContent).toContain("Empty transcript");
    expect(all(view.contentEl, "img2md-write").length).toBe(0);
  });
  it("Run-Button wird während des Laufs zu 'Stop'", async () => {
    let release: () => void = () => {};
    const transcribeStream = vi.fn(() => new Promise<{ content: string; reasoning: string; model: string }>(r => { release = () => r({ content: "x", reasoning: "", model: "vm" }); }));
    const { view } = mkView({ transcribeStream });
    await view.onOpen();
    const p = view.run();
    const btn = () => all(view.contentEl, "img2md-run")[0];
    expect(btn().textContent).toBe("Stop");
    release(); await p;
    expect(btn().textContent).toBe("Transcribe");
  });
  it("Stop markiert die laufende Karte als abgebrochen, ohne 'Notiz anlegen'", async () => {
    const transcribeStream = vi.fn((_sp: string, _it: any, _oc: any, _or: any, signal: AbortSignal) =>
      new Promise<{ content: string; reasoning: string; model: string }>((_res, rej) => {
        signal.addEventListener("abort", () => rej(new Error("aborted")));
      }));
    const { view } = mkView({ transcribeStream });
    await view.onOpen();
    const p = view.run();          // startet die (hängende) Transkription
    view.onRunClick();             // läuft → Stop → controller.abort()
    await p;
    const errs = all(view.contentEl, "img2md-error");
    expect(errs.length).toBe(1);
    expect(errs[0].textContent).toContain("Aborted");
    expect(all(view.contentEl, "img2md-write").length).toBe(0);
  });
});

describe("ImgToMdView — Notiz anlegen", () => {
  it("'Notiz anlegen' ruft writeTranscripts mit einem Eintrag, Karte → angelegt", async () => {
    const { view, calls } = mkView({ writeTranscripts: async (_sp: string, entries: any[]) => { calls.written.push(entries); return ["foto.md"]; } });
    await view.onOpen(); await view.run();
    all(view.contentEl, "img2md-write")[0].click();
    await Promise.resolve(); await Promise.resolve();
    expect(calls.written.length).toBe(1);
    expect(calls.written[0]).toEqual([{ item: ITEMS[0], content: "Hallo", model: "vm" }]);
    expect(all(view.contentEl, "img2md-written")[0].textContent).toContain("foto.md");
  });
  it("'angelegt'-Zeile öffnet die Notiz per Klick", async () => {
    const { view, calls } = mkView({ writeTranscripts: async () => ["foto.md"] });
    await view.onOpen(); await view.run();
    await view.writeOne(0);
    all(view.contentEl, "img2md-written")[0].click();
    expect(calls.opened).toEqual(["foto.md"]);
  });
  it("'Alle anlegen' schreibt alle fertigen Karten in einem Batch", async () => {
    const twoItems: ImgItem[] = [
      { raw: "![[a.png]]", link: "a.png", ext: "png", supported: true, kind: "image" },
      { raw: "![[b.png]]", link: "b.png", ext: "png", supported: true, kind: "image" },
    ];
    const { view, calls } = mkView({ scan: async () => twoItems, writeTranscripts: async (_sp: string, entries: any[]) => { calls.written.push(entries); return entries.map((_: any, i: number) => `n-${i}.md`); } });
    await view.onOpen(); await view.run();
    all(view.contentEl, "img2md-all")[0].click();
    await Promise.resolve(); await Promise.resolve();
    expect(calls.written.length).toBe(1);
    expect(calls.written[0].length).toBe(2);
    expect(all(view.contentEl, "img2md-written").length).toBe(2);
  });
  it("nach Schreiben wird neu gescannt (scan erneut aufgerufen)", async () => {
    const scan = vi.fn(async () => ITEMS);
    const { view } = mkView({ scan, writeTranscripts: async () => ["foto.md"] });
    await view.onOpen();          // scan #1
    await view.run();
    await view.writeOne(0);       // scan #2 (rescan nach Schreiben)
    expect(scan.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

const PDF_ITEMS: ImgItem[] = [
  { raw: "![[doc.pdf]]", link: "doc.pdf", ext: "pdf", supported: true, kind: "pdf", pageCount: 2, range: { from: 1, to: 2 } },
];

describe("ImgToMdView — PDF", () => {
  it("listet PDF mit Seitenzahl + Bereichsfeldern", async () => {
    const { view } = mkView({ scan: async () => PDF_ITEMS });
    await view.onOpen();
    expect(all(view.contentEl, "img2md-name")[0].textContent).toContain("2");
    expect(all(view.contentEl, "img2md-pdf-from").length).toBe(1);
    expect(all(view.contentEl, "img2md-pdf-to").length).toBe(1);
  });
  it("run erzeugt eine Karte je Seite mit Seiten-Kopf", async () => {
    const { view } = mkView({ scan: async () => PDF_ITEMS });
    await view.onOpen(); await view.run();
    const cards = all(view.contentEl, "img2md-card");
    expect(cards.length).toBe(2);
    expect(all(view.contentEl, "img2md-card-head")[0].textContent).toContain("page 1/2");
  });
  it("Alle anlegen ruft writePdf einmal mit beiden Seiten", async () => {
    const { view, calls } = mkView({ scan: async () => PDF_ITEMS });
    await view.onOpen(); await view.run();
    all(view.contentEl, "img2md-all")[0].click();
    await Promise.resolve(); await Promise.resolve();
    expect(calls.written.length).toBe(1);
    expect(calls.written[0].map((p: any) => p.page)).toEqual([1, 2]);
    // beide Seiten-Karten als „angelegt" markiert (eine Notiz):
    expect(all(view.contentEl, "img2md-written").length).toBe(2);
  });
});
