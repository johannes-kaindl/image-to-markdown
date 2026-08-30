/**
 * Screenshot-Treiber fuer docs/images/ — faehrt die Aufnahmen aus `docs/images/README.md`
 * gegen ein **laufendes** Obsidian, statt sie von Hand zu klicken.
 *
 * Warum getrackt: der Aufnahme-Vertrag stand ab 2026-06-21 im Repo, ohne dass je ein Bild
 * entstand — "nur Johannes, braucht laufendes Plugin" hielt ihn ein Jahr lang zu. Mit diesem
 * Treiber ist die Aufnahme reproduzierbar; ein Werkzeug, das nur einmal im Scratchpad
 * existiert, ist keine Praxis (dieselbe Begruendung wie 3d-codeblocks/scripts/gui-smoke.ts,
 * von dem die CDP-Bruecke uebernommen ist).
 *
 * // uebernommen aus 3d-codeblocks/scripts/gui-smoke.ts, 2026-08-14 (nur die CDP-Bruecke)
 *
 * ## Voraussetzung
 *
 * ⚠️ **Vor dem Quit koordinieren — Obsidian ist geteilte Infrastruktur.** Dieses Rezept
 * braucht den frischen Start (ein Bild pro Start, jeder Lauf hinterlaesst Zustand); Mitnutzen ist
 * hier keine Alternative. Aber Obsidian ist Single-Instance: der Quit trifft die Instanz, an der
 * moeglicherweise eine andere Session arbeitet, und zerstoert deren Zustand. Der eigene Lauf ist
 * danach sauber gruen; der Schaden faellt nicht auf.
 *
 * ```bash
 * lsof -nP -iTCP:9222 -sTCP:LISTEN >/dev/null && echo "belegt — erst fragen, wem"
 * ```
 *
 * Hoert der Port, haengt jemand dran: **erst fragen, dann quitten.** ⚠️ Und die Pruefung ersetzt die
 * Frage nicht — sie zeigt aktive CDP-Treiber, aber nicht, wer ein Fenster offen haelt oder auf den
 * Port wartet; am 2026-08-30 haette sie einen zwei Stunden alten Reindex nicht gezeigt, denn der
 * hing an Ollama, nicht am Port.
 *
 * Obsidian mit offenem Debug-Port (die App muss dafuer neu gestartet werden):
 *
 * ```bash
 * osascript -e 'quit app "Obsidian"'
 * open -a Obsidian --args --remote-debugging-port=9222
 * ```
 *
 * Dazu ein Demo-Vault nach `docs/images/README.md` § "Reproducible capture recipe" und ein
 * erreichbarer Vision-Endpoint. Aufruf:
 *
 * ```bash
 * node scripts/shots.mjs --vault img2md-demo --out docs/images
 * ```
 *
 * ## Drei Fallstricke, die Zeit kosten, wenn man sie nicht kennt
 *
 * 1. **Chromium drosselt nicht-fokussierte Fenster.** Ohne `Page.bringToFront` bleibt die
 *    View leer und man debuggt ein Phantom.
 * 2. **Die Einstellungen sind ein EIGENES Fenster** (Obsidian 1.13) mit URL `about:blank` —
 *    ein Target-Filter auf `app://obsidian.md` findet sie nicht. Und sie schliessen sich,
 *    sobald ein anderes Fenster den Fokus bekommt: alles in EINEM Lauf erledigen.
 * 3. **Lange Inhalte** (Settings, Refine-Log) passen nicht ins Fenster. Statt zu stueckeln
 *    ein hohes Fenster simulieren: `Emulation.setDeviceMetricsOverride` + danach
 *    `clearDeviceMetricsOverride`.
 */

const PORT = Number(process.argv[find("--port")] ?? 9222);
const VAULT = process.argv[find("--vault")] ?? "img2md-demo";
const OUT = process.argv[find("--out")] ?? "docs/images";
function find(flag) { const i = process.argv.indexOf(flag); return i === -1 ? -1 : i + 1; }

export class Cdp {
  #next = 1; #pending = new Map(); #sock;
  constructor(sock) {
    this.#sock = sock;
    sock.addEventListener("message", (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id === undefined) return;
      const w = this.#pending.get(m.id);
      if (!w) return;
      this.#pending.delete(m.id);
      m.error ? w.fail(new Error(m.error.message)) : w.ok(m);
    });
  }
  /** `anyUrl` schliesst das Einstellungen-Fenster mit ein (about:blank, siehe Fallstrick 2). */
  static async targets(port = PORT, { anyUrl = false } = {}) {
    const r = await fetch(`http://127.0.0.1:${port}/json/list`);
    return (await r.json()).filter(
      (t) => t.type === "page" && t.webSocketDebuggerUrl &&
        (anyUrl ? /obsidian/i.test(t.title) : t.url.startsWith("app://obsidian.md")),
    );
  }
  static async attach(title, port = PORT, opts = {}) {
    const pages = await Cdp.targets(port, opts);
    const hit = pages.filter((t) => t.title.toLowerCase().includes(title.toLowerCase()));
    if (!hit.length) throw new Error(`Kein Fenster fuer "${title}". Offen:\n  ` + pages.map((t) => t.title).join("\n  "));
    if (hit.length > 1) throw new Error(`Mehrdeutig "${title}":\n  ` + hit.map((t) => t.title).join("\n  "));
    const sock = new WebSocket(hit[0].webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      sock.addEventListener("open", res, { once: true });
      sock.addEventListener("error", () => rej(new Error("WebSocket-Verbindung fehlgeschlagen")), { once: true });
    });
    const cdp = new Cdp(sock);
    cdp.title = hit[0].title;
    return cdp;
  }
  send(method, params = {}, timeoutMs = 120_000) {
    const id = this.#next++;
    this.#sock.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, fail) => {
      this.#pending.set(id, { ok, fail });
      setTimeout(() => { if (this.#pending.delete(id)) fail(new Error(`Zeitueberschreitung: ${method}`)); }, timeoutMs);
    });
  }
  async eval(expr, timeoutMs = 120_000) {
    const r = await this.send("Runtime.evaluate",
      { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }, timeoutMs);
    const ex = r.result?.exceptionDetails;
    if (ex) throw new Error("Renderer: " + (ex.exception?.description || ex.text));
    return r.result?.result?.value;
  }
  async front() { await this.send("Page.bringToFront"); }   // Fallstrick 1
  async shot(path, clip) {
    await this.front();
    const p = { format: "png", captureBeyondViewport: false };
    if (clip) p.clip = { ...clip, scale: clip.scale ?? 2 };
    const r = await this.send("Page.captureScreenshot", p);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path, Buffer.from(r.result.data, "base64"));
  }
  close() { this.#sock.close(); }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Zuschnitt bis zum untersten Element mit echtem Inhalt. Ohne das besteht eine
 * Sidebar-Aufnahme zu zwei Dritteln aus Leerraum und faengt Obsidians Statusleiste ein.
 * Volle-Hoehe-Container (Flex-Fueller) werden uebersprungen — sie zoegen den Schnitt
 * bis zum Fensterrand.
 */
export async function contentBox(c, sel, pad = 8) {
  const raw = await c.eval(`
    const root = document.querySelector(${JSON.stringify(sel)});
    if (!root) return null;
    const rb = root.getBoundingClientRect();
    let bottom = rb.top;
    for (const el of root.querySelectorAll("*")) {
      const b = el.getBoundingClientRect();
      if (!b.height || !b.width || b.height > rb.height * 0.6) continue;
      const hasText = (el.textContent || "").trim().length > 0;
      const isBox = ["INPUT", "IMG", "CANVAS"].includes(el.tagName);
      if (!hasText && !isBox) continue;
      if (b.bottom > bottom && b.bottom <= rb.bottom) bottom = b.bottom;
    }
    return JSON.stringify({ x: rb.x, y: rb.y, width: rb.width, height: Math.min(rb.height, bottom - rb.top) });
  `);
  if (!raw) throw new Error("Selektor nicht gefunden: " + sel);
  const b = JSON.parse(raw);
  return { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + 2 * pad, height: b.height + 2 * pad };
}

/** Aufnahme eines Selektors, danach auf `targetW` heruntergerechnet (nie hochskaliert). */
export async function shotContent(c, sel, out, { pad = 8, targetW = 1200 } = {}) {
  await c.shot(out, await contentBox(c, sel, pad));
  const { execFileSync } = await import("node:child_process");
  execFileSync("python3", ["-c",
    "import sys\nfrom PIL import Image\np,tw=sys.argv[1],int(sys.argv[2])\nim=Image.open(p)\n" +
    "if im.width>tw:\n    im=im.resize((tw,round(im.height*tw/im.width)),Image.LANCZOS); im.save(p)\n" +
    "print(f'  {p.split(chr(47))[-1]}: {im.width}x{im.height}')", out, String(targetW)], { stdio: "inherit" });
}

export const SIDEBAR = ".workspace-leaf-content[data-type='image-to-markdown-view']";

if (import.meta.url === `file://${process.argv[1]}`) {
  const c = await Cdp.attach(VAULT, PORT);
  console.log("Fenster:", c.title, "· Ausgabe:", OUT);
  await shotContent(c, SIDEBAR, `${OUT}/tutorial-sidebar.png`);
  console.log("Ein Beispielaufruf gelaufen. Die uebrigen Motive brauchen je einen Modell-Lauf —");
  console.log("Schrittfolge in docs/images/README.md § 'Reproducible capture recipe'.");
  c.close();
  process.exit(0);
}
