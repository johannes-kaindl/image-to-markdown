import { describe, it, expect, vi } from "vitest";
import { ImgToMdView, VIEW_TYPE_IMGMD, ViewMode, isDescribingCard } from "../src/img_to_md_view";
import { ImgItem } from "../src/img_to_md_state";
import { CardCache } from "../src/card_cache";
import { makeFakeApp } from "./__mocks__/obsidian";
import { setLang } from "../src/i18n";

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
  let mode: ViewMode = over.initialMode ?? "transcribe";
  const deps = {
    getActivePath: over.getActivePath ?? (() => "q.md"),
    scan: over.scan ?? (async () => ITEMS),
    transcribeStream: over.transcribeStream ?? (async (_sp: string, _it: ImgItem, onContent: any) => { onContent("Hal"); onContent("lo"); return { content: "Hallo", reasoning: "", model: "vm" }; }),
    writeTranscripts: over.writeTranscripts ?? (async (_sp: string, entries: any[]) => { calls.written.push(entries); return entries.map((e: any, i: number) => ({ path: `note-${i}.md`, body: e.content })); }),
    writePdf: over.writePdf ?? (async (_sp: string, _raw: string, _link: string, _pages: any[]) => { calls.written.push(_pages); return { path: "doc (PDF transcript).md", body: "body" }; }),
    getMode: over.getMode ?? (() => mode),
    setMode: over.setMode ?? ((m: ViewMode) => { mode = m; }),
    describeStream: over.describeStream ?? (async (_sp: string, _it: ImgItem, onContent: any) => { onContent("CATEGORY: Foto\nTAGS: a, b\n---\nEin Foto."); return { raw: "CATEGORY: Foto\nTAGS: a, b\n---\nEin Foto.", reasoning: "", model: "vm" }; }),
    refine: over.refine ?? (async (_base: string, _steps: any[], _fb: string, onContent: any) => { onContent("VERBESSERT"); return { content: "VERBESSERT", reasoning: "", model: "vm" }; }),
    getTaxonomy: over.getTaxonomy ?? (() => ["Foto", "Diagramm"]),
    writeDescriptions: over.writeDescriptions ?? (async (_sp: string, entries: any[]) => { calls.written.push(entries); return entries.map((_e: any, i: number) => ({ path: `desc-${i}.md` })); }),
    connectionStatus: over.connectionStatus ?? (async () => ({ ok: true, endpoint: "http://localhost:1234" })),
    listModels: over.listModels ?? (async () => []),
    getModel: over.getModel ?? (() => "vm"),
    setModel: over.setModel ?? vi.fn(),
    listPresets: over.listPresets ?? (() => [{ id: "default", label: "Default" }, { id: "math", label: "Math → LaTeX" }]),
    getPreset: over.getPreset ?? (() => "default"),
    setPreset: over.setPreset ?? vi.fn(),
    getSuppress: over.getSuppress ?? (() => false),
    setSuppress: over.setSuppress ?? vi.fn(),
    openPath: (p: string) => calls.opened.push(p),
    copyText: over.copyText ?? ((t: string) => calls.copied.push(t)),
    cardCache: over.cardCache ?? new CardCache(),
  };
  const view = new ImgToMdView({ app: makeFakeApp() } as any, deps);
  return { view, calls, deps };
}

describe("isDescribingCard", () => {
  it("bereits gelaufene Karte behält ihren Modus (Retry-Routing), ignoriert den Default", () => {
    expect(isDescribingCard("description", false)).toBe(true);
    expect(isDescribingCard("transcript", true)).toBe(false);
  });
  it("frische Karte (mode undefined) folgt dem globalen Default", () => {
    expect(isDescribingCard(undefined, true)).toBe(true);
    expect(isDescribingCard(undefined, false)).toBe(false);
  });
});

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
  it("Preset-Dropdown rendert die Presets, Wert = getPreset, change ruft setPreset", async () => {
    const setPreset = vi.fn();
    const { view } = mkView({
      getPreset: () => "math",
      setPreset,
      listPresets: () => [{ id: "default", label: "Default" }, { id: "math", label: "Math → LaTeX" }],
    });
    await view.onOpen();
    const sel = all(view.contentEl, "img2md-preset")[0];
    expect(sel).toBeTruthy();
    expect((sel.children ?? []).map((o: any) => o.textContent)).toEqual(["Default", "Math → LaTeX"]);
    expect(sel.value).toBe("math");
    sel.value = "default";
    (sel._listeners["change"] ?? []).forEach((cb: any) => cb());
    expect(setPreset).toHaveBeenCalledWith("default");
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
    const { view, calls } = mkView({ writeTranscripts: async (_sp: string, entries: any[]) => { calls.written.push(entries); return [{ path: "foto.md", body: entries[0].content }]; } });
    await view.onOpen(); await view.run();
    all(view.contentEl, "img2md-write")[0].click();
    await Promise.resolve(); await Promise.resolve();
    expect(calls.written.length).toBe(1);
    expect(calls.written[0]).toEqual([{ item: ITEMS[0], content: "Hallo", model: "vm", knownBody: undefined }]);
    expect(all(view.contentEl, "img2md-written")[0].textContent).toContain("foto.md");
  });
  it("'angelegt'-Zeile öffnet die Notiz per Klick", async () => {
    const { view, calls } = mkView({ writeTranscripts: async () => [{ path: "foto.md", body: null }] });
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
    const { view, calls } = mkView({ scan: async () => twoItems, writeTranscripts: async (_sp: string, entries: any[]) => { calls.written.push(entries); return entries.map((e: any, i: number) => ({ path: `n-${i}.md`, body: e.content })); } });
    await view.onOpen(); await view.run();
    all(view.contentEl, "img2md-all")[0].click();
    await Promise.resolve(); await Promise.resolve();
    expect(calls.written.length).toBe(1);
    expect(calls.written[0].length).toBe(2);
    expect(all(view.contentEl, "img2md-written").length).toBe(2);
  });
  it("nach Schreiben wird neu gescannt (scan erneut aufgerufen)", async () => {
    const scan = vi.fn(async () => ITEMS);
    const { view } = mkView({ scan, writeTranscripts: async () => [{ path: "foto.md", body: null }] });
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
      capturedPages = pages; capturedRange = range; return { path: "doc (PDF transcript).md", body: "body" };
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

  it("Range-Edit NACH dem Lauf ändert die Schreib-Range nicht (kein Datenverlust)", async () => {
    const freshPdf: ImgItem[] = [{ raw: "![[doc.pdf]]", link: "doc.pdf", ext: "pdf", supported: true, kind: "pdf", pageCount: 5, range: { from: 1, to: 2 } }];
    const transcribeStream = async (_sp: string, _it: ImgItem, onC: any) => { onC("seite"); return { content: "seite", reasoning: "", model: "vm" }; };
    let capturedRange: any = null; let capturedPages: any = null;
    const writePdf = async (_sp: string, _raw: string, _link: string, pages: any[], _ow?: string, _embed?: boolean, range?: any) => { capturedRange = range; capturedPages = pages; return { path: "doc (PDF transcript).md", body: "body" }; };
    const { view } = mkView({ scan: async () => freshPdf, writePdf, transcribeStream });
    await view.onOpen(); await view.run();          // läuft mit Range 1-2 → 2 Karten done
    freshPdf[0].range = { from: 1, to: 1 };          // User verengt die Range NACH dem Lauf (live-mutables Item)
    await view.writeAll();
    expect(capturedRange).toEqual({ from: 1, to: 2 });            // Schreib-Range aus den Karten, NICHT item.range
    expect(capturedPages.map((p: any) => p.page)).toEqual([1, 2]); // beide transkribierten Seiten erhalten
  });

  it("Retry-nach-Teil-Write: Override derselben Notiz, keine Dublette, am Ende vollständig", async () => {
    const freshPdf: ImgItem[] = [{ raw: "![[doc.pdf]]", link: "doc.pdf", ext: "pdf", supported: true, kind: "pdf", pageCount: 2, range: { from: 1, to: 2 } }];
    let call = 0;
    const transcribeStream = async (_sp: string, _it: ImgItem, onC: any) => {
      call++;
      if (call === 2) throw new Error("Vision HTTP 500");   // Seite 2 scheitert beim ersten Mal
      onC("seite"); return { content: "seite", reasoning: "", model: "vm" };
    };
    const writeCalls: any[] = [];
    const writePdf = async (_sp: string, _raw: string, _link: string, pages: any[], overwritePath?: string, _embed?: boolean, range?: any) => {
      writeCalls.push({ pages: pages.map((p: any) => p.page), overwritePath, range });
      return { path: "doc (PDF transcript).md", body: "body" };
    };
    const { view } = mkView({ scan: async () => freshPdf, writePdf, transcribeStream });
    await view.onOpen(); await view.run();
    await view.writeAll();                                       // Teil-Write (Seite 2 fehlt)
    expect(writeCalls[0]).toMatchObject({ pages: [1], overwritePath: undefined, range: { from: 1, to: 2 } });
    expect(all(view.contentEl, "img2md-written").length).toBe(0);
    expect(all(view.contentEl, "img2md-retry").length).toBe(1);
    await view.retryOne(1);                                     // Seite 2 erneut → done
    await view.writeAll();                                      // kompletter Override
    expect(writeCalls[1]).toMatchObject({ pages: [1, 2], overwritePath: "doc (PDF transcript).md", range: { from: 1, to: 2 } });
    expect(writeCalls.filter(c => !c.overwritePath).length).toBe(1);   // genau EINE Neuanlage → keine Dublette
    expect(all(view.contentEl, "img2md-written").length).toBe(2);     // jetzt vollständig
    expect(all(view.contentEl, "img2md-retry").length).toBe(0);
  });

  it("alle Seiten fehlgeschlagen: keine Notiz (writePdf 0×), beide Seiten retrybar", async () => {
    const freshPdf: ImgItem[] = [{ raw: "![[doc.pdf]]", link: "doc.pdf", ext: "pdf", supported: true, kind: "pdf", pageCount: 2, range: { from: 1, to: 2 } }];
    const transcribeStream = async () => { throw new Error("Vision HTTP 500"); };
    let writeCount = 0;
    const writePdf = async () => { writeCount++; return { path: "x.md", body: "body" }; };
    const { view } = mkView({ scan: async () => freshPdf, writePdf, transcribeStream });
    await view.onOpen(); await view.run();
    await view.writeAll();
    expect(writeCount).toBe(0);                                  // alles leer → keine reine Platzhalter-Notiz
    expect(all(view.contentEl, "img2md-written").length).toBe(0);
    expect(all(view.contentEl, "img2md-error").length).toBe(2);
    expect(all(view.contentEl, "img2md-retry").length).toBe(2);
  });
});

describe("ImgToMdView — Diff-Confirm + Content-aware Gate (v1.1)", () => {
  it("Override-Erst-Write: kein knownBody; Folge-Retry: knownBody = zuletzt geschriebener Body", async () => {
    const item: ImgItem = { raw: "![[b.png]]", link: "b.png", ext: "png", supported: true, kind: "image", existingTranscriptPath: "b (transcript).md" };
    const knownBodies: (string | undefined)[] = [];
    const { view } = mkView({
      scan: async () => [item],
      writeTranscripts: async (_sp: string, entries: any[]) => { knownBodies.push(entries[0].knownBody); return [{ path: "b (transcript).md", body: entries[0].content }]; },
    });
    await view.onOpen();
    // Override-Item: default abgewählt (existingTranscriptPath) → wie im bestehenden "vorhandenes
    // Transkript"-Test erst selektieren (Checkbox-change), bevor run() die Karte erzeugt.
    const cb = all(view.contentEl, "img2md-check")[0];
    (cb._listeners["change"] ?? []).forEach((h: any) => h());
    await view.run();
    await view.writeOne(0);
    (view as any).state.cards[0].status = "done";   // simulierter zweiter Write derselben Notiz
    await view.writeOne(0);
    expect(knownBodies).toEqual([undefined, "Hallo"]);   // "Hallo" = card.text aus dem transcribeStream-Default
  });

  it("PDF-Override: kein knownBody beim ersten Write; Retry bekommt den von writePdf zurückgegebenen body", async () => {
    const item: ImgItem = { raw: "![[doc.pdf]]", link: "doc.pdf", ext: "pdf", supported: true, kind: "pdf", pageCount: 1, range: { from: 1, to: 1 }, existingTranscriptPath: "doc (PDF transcript).md" };
    const knownBodies: (string | undefined)[] = [];
    const writePdf = async (_sp: string, _raw: string, _link: string, _pages: any[], _ow?: string, _embed?: boolean, _range?: any, knownBody?: string) => {
      knownBodies.push(knownBody);
      return { path: "doc (PDF transcript).md", body: "PDF-BODY" };
    };
    const { view } = mkView({ scan: async () => [item], writePdf });
    await view.onOpen();
    const cb = all(view.contentEl, "img2md-check")[0];
    (cb._listeners["change"] ?? []).forEach((h: any) => h());
    await view.run();
    await view.writeAll();
    (view as any).state.cards[0].status = "done";   // simulierter zweiter Write derselben Notiz
    await view.writeAll();
    expect(knownBodies).toEqual([undefined, "PDF-BODY"]);
  });
});

describe("ImgToMdView — Thinking-Toggle", () => {
  it("normales Modell, nicht unterdrückt → Label 'Thinking: on', klickbar", async () => {
    setLang("en");
    const { view } = mkView({ getModel: () => "qwen3:8b", getSuppress: () => false });
    await view.onOpen();
    const [btn] = all(view.contentEl, "img2md-think-toggle");
    expect(btn.textContent).toContain("Thinking: on");
    expect(String(btn.className)).not.toContain("is-off");
  });

  it("Klick flippt Suppress und re-rendert das Label", async () => {
    setLang("en");
    let sup = false;
    const setSuppress = vi.fn((v: boolean) => { sup = v; });
    const { view } = mkView({ getModel: () => "qwen3:8b", getSuppress: () => sup, setSuppress });
    await view.onOpen();
    const [btn] = all(view.contentEl, "img2md-think-toggle");
    btn.click();
    expect(setSuppress).toHaveBeenCalledWith(true);
    expect(btn.textContent).toContain("Thinking: off");
    expect(String(btn.className)).toContain("is-off");
  });

  it("immer-an-Modell → 'Thinking: always on', Klick ändert nichts", async () => {
    setLang("en");
    const setSuppress = vi.fn();
    const { view } = mkView({ getModel: () => "gpt-oss:20b", getSuppress: () => false, setSuppress });
    await view.onOpen();
    const [btn] = all(view.contentEl, "img2md-think-toggle");
    expect(btn.textContent).toContain("Thinking: always on");
    expect(String(btn.className)).toContain("is-disabled");
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    btn.click();
    expect(setSuppress).not.toHaveBeenCalled();
  });
});

describe("ImgToMdView — Pending-Ergebnis-Persistenz", () => {
  it("Notiz wechseln und zurück → Karten wieder da", async () => {
    let active = "q.md";
    const cache = new CardCache();
    const { view } = mkView({ getActivePath: () => active, cardCache: cache });
    await view.onOpen();
    await view.run();                                   // erzeugt Karten für q.md ("Hallo")
    expect(all(view.contentEl, "img2md-card").length).toBeGreaterThan(0);
    active = "other.md"; await view.refresh();          // Notizwechsel → sichern + leer scannen
    expect(cache.load("q.md")?.length).toBeGreaterThan(0);
    expect(all(view.contentEl, "img2md-card").length).toBe(0);
    active = "q.md"; await view.refresh();              // zurück → wiederherstellen
    expect(all(view.contentEl, "img2md-card").length).toBeGreaterThan(0);
  });
  it("View schließen/öffnen → Karten wieder da (gleicher Cache)", async () => {
    const cache = new CardCache();
    const first = mkView({ cardCache: cache });
    await first.view.onOpen(); await first.view.run();
    await first.view.onClose();
    expect(cache.load("q.md")?.length).toBeGreaterThan(0);
    const second = mkView({ cardCache: cache });        // neue View-Instanz, gleicher Plugin-Cache
    await second.view.onOpen();
    expect(all(second.view.contentEl, "img2md-card").length).toBeGreaterThan(0);
  });
  it("Clear-Button leert Karten + Cache-Eintrag", async () => {
    const cache = new CardCache();
    const { view } = mkView({ cardCache: cache });
    await view.onOpen(); await view.run();
    expect(all(view.contentEl, "img2md-card").length).toBeGreaterThan(0);
    const clearBtn = all(view.contentEl, "img2md-clear")[0];
    expect(clearBtn).toBeTruthy();
    clearBtn.dispatchEvent(new Event("click"));
    expect(all(view.contentEl, "img2md-card").length).toBe(0);
    expect(cache.load("q.md")).toBeUndefined();
    expect(String(clearBtn.className).split(" ")).toContain("is-hidden");
  });

  // Zurrt die Referenz-Kopplung fest (CardCache.save/restore ohne Copy): persistiert onClose mitten
  // im Lauf eine „streaming"-Karte, heilt die laufende Abort-Cleanup dieselben Objekte in-place zu
  // „error" — beim Reopen darf keine dauerhaft „streaming"-hängende Karte auftauchen. Ein defensiver
  // Deep-Copy in CardCache.save würde diesen Test brechen (bewusst).
  it("onClose während eines Laufs: gecachte Karte heilt zu 'error' (kein hängendes 'streaming')", async () => {
    const cache = new CardCache();
    const oneItem: ImgItem[] = [{ raw: "![[a.png]]", link: "a.png", ext: "png", supported: true, kind: "image" }];
    const { view } = mkView({
      cardCache: cache,
      scan: async () => oneItem,
      // hängt bis zum Abort, wirft dann → runIndices-catch/Post-Loop markiert die Karte als „error"
      transcribeStream: (_sp: string, _it: ImgItem, _oc: any, _or: any, signal: AbortSignal) =>
        new Promise((_res, rej) => { signal.addEventListener("abort", () => rej(new Error("aborted"))); }),
    });
    await view.onOpen();
    const runP = view.run();       // hängt im Streaming (kein await)
    await Promise.resolve();       // Lauf anlaufen lassen (running=true, Karte streaming)
    await view.onClose();          // persistCards (streaming) + abort()
    await runP;                    // Rejection settlen lassen → Self-Heal
    const cached = cache.load("q.md");
    expect(cached?.length).toBe(1);
    expect(cached?.[0].status).toBe("error");
  });
});

describe("ImgToMdView — Modus-Umschalter", () => {
  it("Transkribieren ist initial aktiv, Run-Label 'Transcribe'", async () => {
    const { view } = mkView(); await view.onOpen();
    const btns = all(view.contentEl, "img2md-mode-btn");
    expect(btns.length).toBe(2);
    expect(btns[0].className).toContain("is-active");
    expect(btns[0].getAttribute("aria-pressed")).toBe("true");
    expect(btns[1].getAttribute("aria-pressed")).toBe("false");
    expect(all(view.contentEl, "img2md-run")[0].textContent).toBe("Transcribe");
  });

  it("Klick auf 'Describe' ruft setMode('describe')", async () => {
    const setMode = vi.fn();
    const { view } = mkView({ setMode });
    await view.onOpen();
    all(view.contentEl, "img2md-mode-btn")[1].click();
    expect(setMode).toHaveBeenCalledWith("describe");
  });

  it("initialMode 'describe' rendert den Describe-Button aktiv + Run-Label 'Describe'", async () => {
    const { view } = mkView({ initialMode: "describe" }); await view.onOpen();
    const btns = all(view.contentEl, "img2md-mode-btn");
    expect(btns[1].className).toContain("is-active");
    expect(all(view.contentEl, "img2md-run")[0].textContent).toBe("Describe");
  });

  it("Moduswechsel während eines Laufs wird ignoriert", async () => {
    let release: () => void = () => {};
    const transcribeStream = vi.fn(() => new Promise<{ content: string; reasoning: string; model: string }>(r => { release = () => r({ content: "x", reasoning: "", model: "vm" }); }));
    const { view } = mkView({ transcribeStream });
    await view.onOpen();
    const p = view.run();
    all(view.contentEl, "img2md-mode-btn")[1].click();   // während des Laufs → no-op
    expect(all(view.contentEl, "img2md-mode-btn")[0].className).toContain("is-active");
    release(); await p;
  });
});

const DESCRIBE_RAW = "CATEGORY: Foto\nTAGS: a, b\n---\nEin Foto.";

describe("ImgToMdView — Beschreiben-Modus: Lauf + Karte", () => {
  it("run() ruft im Beschreiben-Modus describeStream (nicht transcribeStream), Karte zeigt geparste Prosa", async () => {
    const transcribeStream = vi.fn();
    const describeStream = async (_sp: string, _it: ImgItem, onContent: any) => { onContent(DESCRIBE_RAW); return { raw: DESCRIBE_RAW, reasoning: "", model: "vm" }; };
    const { view } = mkView({ initialMode: "describe", transcribeStream, describeStream });
    await view.onOpen(); await view.run();
    expect(transcribeStream).not.toHaveBeenCalled();
    expect(all(view.contentEl, "img2md-text")[0].textContent).toBe("Ein Foto.");
  });

  it("fertige Beschreiben-Karte zeigt Kategorie-Input (Taxonomie als Datalist-Vorschlag) + Tags-Input, keine 'Create note'-Beschriftung", async () => {
    const { view } = mkView({ initialMode: "describe" });
    await view.onOpen(); await view.run();
    const input = all(view.contentEl, "img2md-category");
    expect(input.length).toBe(1);
    expect((input[0] as any).tagName).toBe("INPUT");
    expect((input[0] as any).value).toBe("Foto");
    // Taxonomie ist über eine <datalist> verknüpft (Vorschlag, keine Beschränkung — Spec §2).
    expect((input[0] as any).getAttribute("list")).toBeTruthy();
    const dl = all(view.contentEl, "img2md-category-list");
    expect(dl.length).toBe(1);
    const options = (dl[0] as any).children.map((o: any) => o.value);
    expect(options).toEqual(["Foto", "Diagramm"]);
    const tags = all(view.contentEl, "img2md-tags");
    expect(tags.length).toBe(1);
    expect((tags[0] as any).value).toBe("a, b");
    const lbl = all(view.contentEl, "img2md-write-lbl");
    expect(lbl[0].textContent).toBe("Save description");
  });

  it("unbekannte Modell-Kategorie landet in tags, Kategorie-Feld bleibt leer (parseDescription-Verhalten unverändert)", async () => {
    const raw = "CATEGORY: Unbekannt\nTAGS: x\n---\nText.";
    const describeStream = async (_sp: string, _it: ImgItem, onContent: any) => { onContent(raw); return { raw, reasoning: "", model: "vm" }; };
    const { view } = mkView({ initialMode: "describe", describeStream });
    await view.onOpen(); await view.run();
    const input = all(view.contentEl, "img2md-category")[0] as any;
    // parseDescription: unbekannte Kategorie → category=null, landet in tags — Feld bleibt leer (kein Treffer).
    expect(input.value).toBe("");
    const tags = all(view.contentEl, "img2md-tags")[0] as any;
    expect(tags.value).toContain("Unbekannt");
  });

  it("Kategorie-Eingabe akzeptiert freien Text außerhalb der Taxonomie und schreibt ihn in card.category (Spec §2: Dropdown der Taxonomie + freie Eingabe)", async () => {
    const { view } = mkView({ initialMode: "describe" });
    await view.onOpen(); await view.run();
    const input = all(view.contentEl, "img2md-category")[0] as any;
    input.value = "Handschriftliche Notiz";   // NICHT in der Taxonomie ["Foto", "Diagramm"]
    input.dispatchEvent(new Event("change"));
    expect((view as any).state.cards[0].category).toBe("Handschriftliche Notiz");
    const tags = all(view.contentEl, "img2md-tags")[0] as any;
    tags.value = "x, y, z";
    tags.dispatchEvent(new Event("change"));
    expect((view as any).state.cards[0].tags).toEqual(["x", "y", "z"]);
  });

  it("leere Kategorie-Eingabe setzt card.category auf null (nicht leerer String)", async () => {
    const { view } = mkView({ initialMode: "describe" });
    await view.onOpen(); await view.run();
    const input = all(view.contentEl, "img2md-category")[0] as any;
    input.value = "";
    input.dispatchEvent(new Event("change"));
    expect((view as any).state.cards[0].category).toBeNull();
  });

  it("'Beschreibung speichern' ruft writeDescriptions mit einer taxonomie-fremden, frei eingegebenen Kategorie, Karte → angelegt", async () => {
    const { view, calls } = mkView({ initialMode: "describe" });
    await view.onOpen(); await view.run();
    const input = all(view.contentEl, "img2md-category")[0] as any;
    input.value = "Handschriftliche Notiz"; input.dispatchEvent(new Event("change"));
    all(view.contentEl, "img2md-write")[0].click();
    await Promise.resolve(); await Promise.resolve();
    expect(calls.written.length).toBe(1);
    expect(calls.written[0]).toEqual([{ item: ITEMS[0], category: "Handschriftliche Notiz", tags: ["a", "b"], prose: "Ein Foto.", model: "vm" }]);
    expect(all(view.contentEl, "img2md-written")[0].textContent).toContain("desc-0.md");
  });

  it("'Alle anlegen' schreibt Beschreiben-Karten via writeDescriptions, nicht writeTranscripts", async () => {
    const twoItems: ImgItem[] = [
      { raw: "![[a.png]]", link: "a.png", ext: "png", supported: true, kind: "image" },
      { raw: "![[b.png]]", link: "b.png", ext: "png", supported: true, kind: "image" },
    ];
    const writeTranscripts = vi.fn();
    const { view, calls } = mkView({ initialMode: "describe", scan: async () => twoItems, writeTranscripts });
    await view.onOpen(); await view.run();
    all(view.contentEl, "img2md-all")[0].click();
    await Promise.resolve(); await Promise.resolve();
    expect(writeTranscripts).not.toHaveBeenCalled();
    expect(calls.written.length).toBe(1);
    expect(calls.written[0].length).toBe(2);
    expect(all(view.contentEl, "img2md-written").length).toBe(2);
  });

  it("leere Prosa → Fehler-Karte, kein 'Beschreibung speichern'", async () => {
    const describeStream = async () => ({ raw: "CATEGORY: Foto\nTAGS: a\n---\n   ", reasoning: "", model: "vm" });
    const { view } = mkView({ initialMode: "describe", describeStream });
    await view.onOpen(); await view.run();
    expect(all(view.contentEl, "img2md-error")[0].textContent).toContain("Empty transcript");
    expect(all(view.contentEl, "img2md-write").length).toBe(0);
  });
});

describe("ImgToMdView — Retry nach Moduswechsel (Karte behält ihren ursprünglichen Lauf-Modus)", () => {
  it("Beschreiben-Karte scheitert, Moduswechsel zu Transkribieren, Retry läuft weiterhin als Beschreiben (nicht die stale globale Auswahl)", async () => {
    let describeCalls = 0;
    const describeStream = async (_sp: string, _it: ImgItem, onContent: any) => {
      describeCalls++;
      if (describeCalls === 1) throw new Error("Vision HTTP 500");
      onContent(DESCRIBE_RAW); return { raw: DESCRIBE_RAW, reasoning: "", model: "vm" };
    };
    const transcribeStream = vi.fn();
    const { view } = mkView({ initialMode: "describe", describeStream, transcribeStream });
    await view.onOpen(); await view.run();          // erster Versuch (Beschreiben) scheitert
    expect(all(view.contentEl, "img2md-error").length).toBe(1);
    all(view.contentEl, "img2md-mode-btn")[0].click();   // globaler Umschalter zurück zu Transkribieren
    expect(all(view.contentEl, "img2md-run")[0].textContent).toBe("Transcribe");
    await view.retryOne(0);
    expect(describeCalls).toBe(2);                  // Retry lief erneut über describeStream
    expect(transcribeStream).not.toHaveBeenCalled(); // NICHT über die inzwischen umgeschaltete globale Auswahl
    expect(all(view.contentEl, "img2md-error").length).toBe(0);
    expect(all(view.contentEl, "img2md-text")[0].textContent).toBe("Ein Foto.");
  });
});

const ITEMS_DESC_EXISTS: ImgItem[] = [
  { raw: "![[b.png]]", link: "b.png", ext: "png", supported: true, kind: "image", existingDescriptionPath: "b (description).md" },
];

describe("ImgToMdView — Beschreiben-Modus: Idempotenz-Anzeige", () => {
  it("zeigt 'description exists' + öffnen-Link, nicht die Transkript-Badge", async () => {
    const { view, calls } = mkView({ initialMode: "describe", scan: async () => ITEMS_DESC_EXISTS });
    await view.onOpen();
    const badges = all(view.contentEl, "img2md-exists");
    expect(badges.length).toBe(1);
    expect(badges[0].textContent).toContain("description exists");
    all(view.contentEl, "img2md-exists-open")[0].click();
    expect(calls.opened).toEqual(["b (description).md"]);
  });

  it("im Transkribieren-Modus bleibt die Transkript-Badge maßgeblich (unabhängige Achsen)", async () => {
    const both: ImgItem[] = [{ raw: "![[b.png]]", link: "b.png", ext: "png", supported: true, kind: "image", existingTranscriptPath: "b (transcript).md", existingDescriptionPath: "b (description).md" }];
    const { view } = mkView({ scan: async () => both });
    await view.onOpen();
    expect(all(view.contentEl, "img2md-exists")[0].textContent).toContain("transcript exists");
  });
});
