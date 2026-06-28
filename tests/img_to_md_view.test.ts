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
    connectionStatus: over.connectionStatus ?? (async () => ({ ok: true, endpoint: "http://localhost:1234" })),
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
    const okV = mkView({ connectionStatus: async () => ({ ok: true, endpoint: "http://localhost:1234" }) }); await okV.view.onOpen();
    expect(all(okV.view.contentEl, "img2md-status")[0].textContent).toContain("connected");
    const offV = mkView({ connectionStatus: async () => ({ ok: false, endpoint: null }) }); await offV.view.onOpen();
    expect(all(offV.view.contentEl, "img2md-status")[0].textContent).toContain("offline");
  });
  it("zeigt 'verbunden via <endpoint>' nach onOpen", async () => {
    const v = mkView({ connectionStatus: async () => ({ ok: true, endpoint: "http://localhost:1234" }) });
    await v.view.onOpen();
    expect(all(v.view.contentEl, "img2md-status")[0].textContent).toContain("http://localhost:1234");
  });
  it("zeigt 'offline' wenn nicht erreichbar", async () => {
    const v = mkView({ connectionStatus: async () => ({ ok: false, endpoint: null }) });
    await v.view.onOpen();
    expect(all(v.view.contentEl, "img2md-status")[0].textContent).toContain("offline");
  });
  it("Verbindungsstatus unterscheidet sich per Icon-Form (nicht nur Glyph/Farbe)", async () => {
    const okV = mkView({ connectionStatus: async () => ({ ok: true, endpoint: "http://localhost:1234" }) }); await okV.view.onOpen();
    const okIcon = all(okV.view.contentEl, "img2md-status-icon")[0].getAttribute("data-icon");
    const offV = mkView({ connectionStatus: async () => ({ ok: false, endpoint: null }) }); await offV.view.onOpen();
    const offIcon = all(offV.view.contentEl, "img2md-status-icon")[0].getAttribute("data-icon");
    expect(okIcon).toBeTruthy();
    expect(offIcon).toBeTruthy();
    expect(okIcon).not.toBe(offIcon);
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
  it("Fehler-Karte zeigt einen Retry-Button; Klick re-läuft genau diese Karte → done", async () => {
    let call = 0;
    const transcribeStream = async (_sp: string, _it: ImgItem, onC: any) => {
      call++;
      if (call === 1) throw new Error("Vision HTTP 500");
      onC("Zweiter Versuch"); return { content: "Zweiter Versuch", reasoning: "", model: "vm" };
    };
    const { view } = mkView({ transcribeStream });
    await view.onOpen(); await view.run();
    expect(all(view.contentEl, "img2md-error").length).toBe(1);
    const retry = all(view.contentEl, "img2md-retry");
    expect(retry.length).toBe(1);
    expect(retry[0].getAttribute("data-icon")).toBe("refresh-cw");
    retry[0].click();
    await new Promise(r => setTimeout(r, 0));
    expect(all(view.contentEl, "img2md-error").length).toBe(0);          // Fehler weg
    expect(all(view.contentEl, "img2md-text")[0].textContent).toBe("Zweiter Versuch");
    expect(all(view.contentEl, "img2md-write").length).toBe(1);          // jetzt anlegbar
  });
  it("'Fehlgeschlagene erneut' nur sichtbar bei Fehler-Karten, läuft alle Fehler erneut", async () => {
    const twoItems: ImgItem[] = [
      { raw: "![[a.png]]", link: "a.png", ext: "png", supported: true, kind: "image" },
      { raw: "![[b.png]]", link: "b.png", ext: "png", supported: true, kind: "image" },
    ];
    let call = 0;
    const transcribeStream = async (_sp: string, _it: ImgItem, onC: any) => {
      call++;
      if (call <= 2) throw new Error("Vision HTTP 500");   // beide erste Versuche scheitern
      onC("ok"); return { content: "ok", reasoning: "", model: "vm" };
    };
    const retryAllVisible = (v: any) => !all(v.contentEl, "img2md-retry-all")[0].className.split(" ").includes("is-hidden");
    const { view } = mkView({ scan: async () => twoItems, transcribeStream });
    await view.onOpen();
    expect(retryAllVisible(view)).toBe(false);   // vor dem Lauf versteckt
    await view.run();
    expect(all(view.contentEl, "img2md-error").length).toBe(2);
    expect(retryAllVisible(view)).toBe(true);     // jetzt sichtbar
    all(view.contentEl, "img2md-retry-all")[0].click();
    await new Promise(r => setTimeout(r, 0));
    expect(all(view.contentEl, "img2md-error").length).toBe(0);
    expect(all(view.contentEl, "img2md-text").length).toBe(2);
    expect(retryAllVisible(view)).toBe(false);    // wieder versteckt, keine Fehler mehr
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

  it("reasoning-Block klappt einmalig zu, sobald Content kommt", async () => {
    let viewRef: any;
    let openWhileThinking: boolean | null = null;
    const transcribeStream = async (_sp: string, _it: ImgItem, onC: any, onR: any) => {
      onR("denkt");
      openWhileThinking = all(viewRef.contentEl, "img2md-reasoning")[0].open;  // true (thinking)
      onC("Ergebnis");                                                          // live -> false
      return { content: "Ergebnis", reasoning: "denkt", model: "vm" };
    };
    const v = mkView({ transcribeStream }); viewRef = v.view;
    await v.view.onOpen();
    await v.view.run();
    expect(openWhileThinking).toBe(true);
    expect(all(v.view.contentEl, "img2md-reasoning")[0].open).toBe(false);  // nach Content zugeklappt
  });

  it("User-Toggle des reasoning-Blocks bleibt: weitere Deltas setzen .open nicht zurück", async () => {
    let viewRef: any;
    let openAfter: boolean | null = null;
    const transcribeStream = async (_sp: string, _it: ImgItem, _onC: any, onR: any) => {
      onR("a");
      all(viewRef.contentEl, "img2md-reasoning")[0].open = false;  // User klappt während Thinking zu
      onR("b");                                                     // weiteres Reasoning-Delta
      openAfter = all(viewRef.contentEl, "img2md-reasoning")[0].open;
      return { content: "ok", reasoning: "ab", model: "vm" };
    };
    const v = mkView({ transcribeStream }); viewRef = v.view;
    await v.view.onOpen();
    await v.view.run();
    expect(openAfter).toBe(false);
  });

  it("kürzt lange Dateinamen im Karten-Kopf (Ellipsis)", async () => {
    const longItem: ImgItem = { raw: "", link: "9E894F8A-1C01-4CCF-96C9-AAB2A290C2CB-2026-06-28-14.23.34.jpeg", ext: "jpeg", supported: true, kind: "image" };
    const { view } = mkView({ scan: async () => [longItem] });
    await view.onOpen(); await view.run();
    const head = all(view.contentEl, "img2md-card-head")[0].textContent ?? "";
    expect(head).toContain("…");
    expect(head).toContain("Image 1/1");
    expect(head.length).toBeLessThan(longItem.link.length);   // deutlich kürzer als der volle Name
  });

  it("Toggle einer fertigen Karte bleibt erhalten, während eine spätere Karte streamt", async () => {
    const ITEMS2: ImgItem[] = [
      { raw: "![[a.png]]", link: "a.png", ext: "png", supported: true, kind: "image" },
      { raw: "![[c.png]]", link: "c.png", ext: "png", supported: true, kind: "image" },
    ];
    let viewRef: any;
    let card0OpenDuringCard1: boolean | null = null;
    let call = 0;
    const transcribeStream = async (_sp: string, _it: ImgItem, onC: any, onR: any) => {
      call++;
      if (call === 1) { onR("r0"); onC("t0"); return { content: "t0", reasoning: "r0", model: "vm" }; }
      // Karte 0 ist fertig: User klappt deren reasoning auf, dann streamt Karte 1 (inkl. eigenem reasoning).
      // Zu diesem Zeitpunkt existiert nur das reasoning-Element von Karte 0 → [0] ist eindeutig Karte 0.
      all(viewRef.contentEl, "img2md-reasoning")[0].open = true;
      onR("r1");   // Karte 1 bekommt ihren eigenen reasoning-Block (wird auto-collapsed sobald Content kommt)
      onC("t1");
      // Jetzt gibt es zwei img2md-reasoning-Elemente (Karte 0, dann Karte 1 in DOM-Reihenfolge).
      // [0] ist weiterhin Karte 0; deren .open darf nicht durch den Auto-Collapse von Karte 1 berührt worden sein.
      card0OpenDuringCard1 = all(viewRef.contentEl, "img2md-reasoning")[0].open;
      return { content: "t1", reasoning: "r1", model: "vm" };
    };
    const v = mkView({ scan: async () => ITEMS2, transcribeStream }); viewRef = v.view;
    await v.view.onOpen();
    await v.view.run();
    expect(card0OpenDuringCard1).toBe(true);
  });

  it("rendert inkrementell: img2md-card-Knoten bleibt über Content-Deltas identisch", async () => {
    let viewRef: any;
    let sameNode: boolean | null = null;
    const transcribeStream = async (_sp: string, _it: ImgItem, onC: any) => {
      onC("Hal");
      const first = all(viewRef.contentEl, "img2md-card")[0];
      onC("lo");
      const second = all(viewRef.contentEl, "img2md-card")[0];
      sameNode = !!first && first === second;
      return { content: "Hallo", reasoning: "", model: "vm" };
    };
    const v = mkView({ transcribeStream }); viewRef = v.view;
    await v.view.onOpen();
    await v.view.run();
    expect(sameNode).toBe(true);
    expect(all(v.view.contentEl, "img2md-text")[0].textContent).toBe("Hallo");
  });

  it("reasoning-Block trägt ein brain-Icon getrennt vom Label-Text", async () => {
    const v = mkView({ transcribeStream: async (_sp: string, _it: ImgItem, onC: any, onR: any) => { onR("denkt"); onC("Text"); return { content: "Text", reasoning: "denkt", model: "vm" }; } });
    await v.view.onOpen(); await v.view.run();
    const icons = all(v.view.contentEl, "img2md-reasoning-icon");
    expect(icons.length).toBe(1);
    expect(icons[0].getAttribute("data-icon")).toBe("brain");
    const lbl = all(v.view.contentEl, "img2md-reasoning-lbl");
    expect(lbl.length).toBe(1);
    expect(lbl[0].textContent).toContain("Thoughts");   // EN-Label nach Content, ohne Emoji
    expect(lbl[0].textContent).not.toContain("💭");
  });

  it("Notiz-anlegen-Button trägt ein file-plus-Icon neben dem Label", async () => {
    const { view } = mkView(); await view.onOpen(); await view.run();
    const icon = all(view.contentEl, "img2md-write-icon");
    expect(icon.length).toBe(1);
    expect(icon[0].getAttribute("data-icon")).toBe("file-plus");
    const lbl = all(view.contentEl, "img2md-write-lbl");
    expect(lbl[0].textContent).toBe("Create note");
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

const ITEMS_EXISTS: ImgItem[] = [
  { raw: "![[b.png]]", link: "b.png", ext: "png", supported: true, kind: "image", existingTranscriptPath: "b (transcript).md" },
];

describe("ImgToMdView — selfSource-Label", () => {
  it("selfSource-Item rendert das 'diese Datei'-Label statt 'verlinkt'", async () => {
    const item: ImgItem = { raw: "", link: "scan.png", ext: "png", supported: true, kind: "image", embed: false, selfSource: true };
    const { view } = mkView({ scan: async () => [item] });
    await view.onOpen();
    const badges = all(view.contentEl, "img2md-linked");
    expect(badges.length).toBe(1);
    expect(badges[0].textContent).toBe("this file");
  });
});

describe("ImgToMdView — linked-Badge", () => {
  it("rendert 'linked'-Badge nur für reine Links (embed:false)", async () => {
    const items: ImgItem[] = [
      { raw: "![[a.png]]", link: "a.png", ext: "png", supported: true, kind: "image", embed: true },
      { raw: "[[b.png]]", link: "b.png", ext: "png", supported: true, kind: "image", embed: false },
      { raw: "[[c.pdf]]", link: "c.pdf", ext: "pdf", supported: true, kind: "pdf", pageCount: 2, range: { from: 1, to: 2 }, embed: false },
    ];
    const { view } = mkView({ scan: async () => items });
    await view.onOpen();
    const badges = all(view.contentEl, "img2md-linked");
    expect(badges.length).toBe(2);   // reiner Bild-Link + reiner PDF-Link, nicht der Embed
    expect(badges[0].textContent).toContain("linked");
  });
});

describe("ImgToMdView — vorhandenes Transkript", () => {
  it("zeigt Badge + öffnen-Link, Checkbox default aus", async () => {
    const { view, calls } = mkView({ scan: async () => ITEMS_EXISTS });
    await view.onOpen();
    expect(all(view.contentEl, "img2md-exists").length).toBe(1);
    expect(all(view.contentEl, "img2md-check")[0].checked).toBe(false);
    all(view.contentEl, "img2md-exists-open")[0].click();
    expect(calls.opened).toEqual(["b (transcript).md"]);
  });
});

const PDF_ITEMS: ImgItem[] = [
  { raw: "![[doc.pdf]]", link: "doc.pdf", ext: "pdf", supported: true, kind: "pdf", pageCount: 2, range: { from: 1, to: 2 } },
];

describe("ImgToMdView — Modell-Refresh", () => {
  it("Refresh-Icon ruft listModels erneut", async () => {
    let calls = 0;
    const { view } = mkView({ listModels: async () => { calls++; return ["vm"]; }, getModel: () => "vm" });
    await view.onOpen();
    const before = calls;
    const btn = all(view.contentEl, "img2md-model-refresh");
    expect(btn.length).toBe(1);
    btn[0].click();
    await new Promise(r => setTimeout(r, 0));
    expect(calls).toBe(before + 1);
  });
  it("refreshModels gleicht eine nicht mehr geladene Auswahl an ein geladenes Modell an", async () => {
    const setModel = vi.fn();
    const { view } = mkView({ getModel: () => "gone-model", setModel, listModels: async () => ["loaded-model"] });
    await view.onOpen();
    expect(setModel).toHaveBeenCalledWith("loaded-model");
  });
  it("run() gleicht die Auswahl an das real verwendete Modell an (Post-Sync)", async () => {
    const setModel = vi.fn();
    const { view } = mkView({
      getModel: () => "vm", setModel, listModels: async () => ["vm"],
      transcribeStream: async (_sp: string, _it: any, onC: any) => { onC("x"); return { content: "x", reasoning: "", model: "other-model" }; },
    });
    await view.onOpen();
    await view.run();
    expect(setModel).toHaveBeenCalledWith("other-model");
  });
  it("run() ohne Abweichung ruft setModel nicht (kein unnötiges Reconnect)", async () => {
    const setModel = vi.fn();
    const { view } = mkView({
      getModel: () => "vm", setModel, listModels: async () => ["vm"],
      transcribeStream: async (_sp: string, _it: any, onC: any) => { onC("x"); return { content: "x", reasoning: "", model: "vm" }; },
    });
    await view.onOpen();
    await view.run();
    expect(setModel).not.toHaveBeenCalled();
  });
  it("zeigt den grünen Haken, wenn die Auswahl im Backend geladen ist", async () => {
    const { view } = mkView({ getModel: () => "vm", listModels: async () => ["vm", "other"] });
    await view.onOpen();
    expect(all(view.contentEl, "img2md-model-status")[0].className).toContain("is-loaded");
  });
  it("kein Haken, wenn die Auswahl nicht geladen ist (offline/leere Liste)", async () => {
    const { view } = mkView({ getModel: () => "vm", listModels: async () => [] });
    await view.onOpen();
    expect(all(view.contentEl, "img2md-model-status")[0].className).not.toContain("is-loaded");
  });
  it("Modell-Status unterscheidet geladen/nicht-geladen per Icon-Form (nicht nur Farbe)", async () => {
    const okV = mkView({ getModel: () => "vm", listModels: async () => ["vm", "other"] });
    await okV.view.onOpen();
    const okIcon = all(okV.view.contentEl, "img2md-model-status")[0].getAttribute("data-icon");

    const offV = mkView({ getModel: () => "vm", listModels: async () => [] });
    await offV.view.onOpen();
    const offIcon = all(offV.view.contentEl, "img2md-model-status")[0].getAttribute("data-icon");

    expect(okIcon).toBeTruthy();
    expect(offIcon).toBeTruthy();      // nicht-geladen hat jetzt eine eigene Form statt "leer"
    expect(okIcon).not.toBe(offIcon);  // farbunabhängig unterscheidbar
  });
  it("manueller Refresh zeigt die Modell-Anzahl in der Statuszeile (Klick-Feedback)", async () => {
    const { view } = mkView({ getModel: () => "vm", listModels: async () => ["vm", "other"] });
    await view.onOpen();
    all(view.contentEl, "img2md-model-refresh")[0].click();
    await new Promise(r => setTimeout(r, 0));
    expect(all(view.contentEl, "img2md-status")[0].textContent).toContain("2");
  });
});

describe("ImgToMdView — PDF", () => {
  it("listet PDF mit Titel + Seite/bis-Labels + Bereichsfeldern", async () => {
    const { view } = mkView({ scan: async () => PDF_ITEMS });
    await view.onOpen();
    expect(all(view.contentEl, "img2md-name")[0].textContent).toContain("doc.pdf");
    expect(all(view.contentEl, "img2md-pdf-from").length).toBe(1);
    expect(all(view.contentEl, "img2md-pdf-to").length).toBe(1);
    expect(all(view.contentEl, "img2md-pdf-lbl").length).toBe(2);
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
  it("fehlgeschlagene Seite: writePdf bekommt die volle Range; done-Seite bleibt 'done' (nicht angelegt)", async () => {
    // Frisches Item (nicht das geteilte PDF_ITEMS) — writePdfGroup mutiert item.existingTranscriptPath.
    const freshPdf: ImgItem[] = [{ raw: "![[doc.pdf]]", link: "doc.pdf", ext: "pdf", supported: true, kind: "pdf", pageCount: 2, range: { from: 1, to: 2 } }];
    let call = 0;
    const transcribeStream = async (_sp: string, _it: ImgItem, onC: any) => {
      call++;
      if (call === 1) { onC("Seite eins"); return { content: "Seite eins", reasoning: "", model: "vm" }; }
      throw new Error("Vision HTTP 500");   // Seite 2 scheitert
    };
    let capturedRange: any = null; let capturedPages: any = null;
    const writePdf = async (_sp: string, _raw: string, _link: string, pages: any[], _ow?: string, _embed?: boolean, range?: any) => {
      capturedPages = pages; capturedRange = range; return "doc (PDF transcript).md";
    };
    const { view } = mkView({ scan: async () => freshPdf, writePdf, transcribeStream });
    await view.onOpen(); await view.run();
    expect(all(view.contentEl, "img2md-error").length).toBe(1);
    all(view.contentEl, "img2md-all")[0].click();
    await new Promise(r => setTimeout(r, 0));
    expect(capturedRange).toEqual({ from: 1, to: 2 });            // volle gewählte Range
    expect(capturedPages.map((p: any) => p.page)).toEqual([1]);   // nur die erfolgreiche Seite
    expect(all(view.contentEl, "img2md-written").length).toBe(0); // unvollständig → nicht als angelegt markiert
    expect(all(view.contentEl, "img2md-retry").length).toBe(1);   // Fehler-Seite weiterhin retrybar
  });
});
