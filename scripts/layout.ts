/**
 * Layout-Messung der Modellzeile in der Sidebar am Handy (Welle 29): Mobil-Emulation 390 × 844 und 390 × 508 (844 minus eine iOS-Tastatur von 336 pt),
 * Standardtheme hell und dunkel, Bild und Maße je Zustand. Misst an der Sache: sitzen Modell-Dropdown, Denkstufe und Neu laden in EINER Zeile auf einer
 * Mittellinie, überdeckt keines ein anderes, und ist die Tippfläche von Neu laden mindestens 44 × 44 px.
 * Der Treiber startet und beendet seine Zweitinstanz selbst (nur die eigene PID). Der Ort der Bilder ist `--out`.
 *
 * ```bash
 * npm run deploy            # der Lauf misst den deployten Build; für „vorher“ den Stand vor dem Pin deployen
 * lsof -nP -iTCP:<PORT> -sTCP:LISTEN
 * python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label image-to-markdown --intent "layout <tag>" --exclusive focus --port <PORT> --ttl 300
 * npm run layout -- --port <PORT> --tag vorher --out /tmp/i2m-w29
 * python3 ~/.claude/hooks/obsidian-cdp-lock.py release
 * ```
 *
 * Grenze: die Emulation ersetzt weder WKWebView noch die Schublade von Obsidian Mobile am Gerät.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { argv, exit } from "node:process";

import { Cdp, attachTo, bereiteInstanzVor, requireVisible } from "../../tools/obsidian-cdp/cdp.js";
import { startLlmStub } from "../../tools/obsidian-cdp/llm-stub.js";
import { capture } from "../../tools/obsidian-cdp/shot.js";
import { stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";

const REPO_NAME = "image-to-markdown";
const PLUGIN_ID = "image-to-markdown";
const PROFILE = "/tmp/obs-test-w29-i2m";
const OBSIDIAN_BIN = "/Applications/Obsidian.app/Contents/MacOS/Obsidian";
const FAKE_MODEL = "google/gemma-4-e4b";
const BREITE = 390;
const HOEHE = 844;
const TASTATUR = 336;

const q = (s: string): string => JSON.stringify(s);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function pgrepProfile(ud: string): string {
  try { return execFileSync("pgrep", ["-f", `user-data-dir=${ud}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; }
}
function portHalten(port: number): boolean {
  try { return execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() !== ""; } catch { return false; }
}
function neuesteAsar(): string | null {
  const dir = join(homedir(), "Library/Application Support/obsidian");
  const dateien = readdirSync(dir).filter((f) => /^obsidian-\d+\.\d+\.\d+\.asar$/.test(f));
  dateien.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const letzte = dateien[dateien.length - 1];
  return letzte ? join(dir, letzte) : null;
}

interface Instanz { child: ChildProcess; ud: string }
function startInstanz(vaultDir: string, port: number): Instanz {
  if (portHalten(port)) throw new Error(`Port ${port} ist belegt — anderen waehlen (nichts beendet).`);
  if (pgrepProfile(PROFILE) !== "") throw new Error(`Das Profil ${PROFILE} wird von einer fremden Instanz gehalten — Abbruch (nichts beendet).`);
  mkdirSync(PROFILE, { recursive: true });
  writeFileSync(join(PROFILE, "obsidian.json"), JSON.stringify({ vaults: { [REPO_NAME]: { path: vaultDir, ts: Date.now(), open: true } } }));
  for (const f of readdirSync(PROFILE)) if (/^obsidian-.*\.asar$/.test(f)) rmSync(join(PROFILE, f));
  const asar = neuesteAsar();
  if (asar) copyFileSync(asar, join(PROFILE, asar.split("/").pop() ?? "obsidian.asar"));
  const child = spawn(OBSIDIAN_BIN, [`--user-data-dir=${PROFILE}`, `--remote-debugging-port=${port}`, "--lang=en-US"], { stdio: "ignore" });
  console.log(`Zweitinstanz gestartet: PID ${child.pid ?? "?"}, Profil ${PROFILE}, Port ${port}`);
  return { child, ud: PROFILE };
}
async function stopInstanz(inst: Instanz): Promise<void> {
  const exited = new Promise<void>((resolve) => { inst.child.once("exit", () => { resolve(); }); });
  if (inst.child.exitCode === null) inst.child.kill("SIGTERM");
  await Promise.race([exited, sleep(8000)]);
  if (inst.child.exitCode === null && inst.child.signalCode === null) { inst.child.kill("SIGKILL"); await Promise.race([exited, sleep(4000)]); }
  await sleep(500);
  const rest = pgrepProfile(inst.ud);
  console.log(`Zweitinstanz beendet; verbleibende Prozesse im Profil: ${rest === "" ? "keine" : rest.replace(/\n/g, ",")}`);
}
async function warteAufFenster(port: number, timeoutMs: number): Promise<Cdp> {
  const bis = Date.now() + timeoutMs;
  let letzter = "";
  while (Date.now() < bis) {
    try { const cdp = await attachTo("workspace", port, REPO_NAME); if (cdp) return cdp; } catch (e) { letzter = (e as Error).message; }
    await sleep(1000);
  }
  throw new Error(`Kein Obsidian-Fenster fuer Vault "${REPO_NAME}" auf Port ${port}. ${letzter}`);
}

interface Box { x: number; y: number; w: number; h: number; right: number; bottom: number }
interface Messung {
  zustand: string;
  viewport: [number, number];
  isMobile: boolean;
  zeile: Box | null; auswahl: Box | null; denkstufe: Box | null; neuLaden: Box | null;
  /** Abstand der Mittellinien (px) von Modell-Dropdown, Denkstufe und Neu laden zur Mittellinie der Zeile; Soll unter 2. */
  mittellinie: number | null;
  /** Paare, deren Rechtecke sich schneiden (leer = nichts überdeckt). */
  ueberdeckt: string[];
  /** Ob Neu laden mindestens 44 × 44 px gross ist (mobil). */
  neuLadenGross: boolean | null;
  /** Ob alle drei im Sichtbereich der Zeile liegen (nichts rechts abgeschnitten). */
  imRahmen: boolean | null;
  modellname: string;
}

const MESS_JS = `
  const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); if (b.width === 0 && b.height === 0) return null; return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), right: +b.right.toFixed(1), bottom: +b.bottom.toFixed(1) }; };
  const S = ".workspace-leaf-content[data-type='image-to-markdown-view']";
  const zeile = r(S + " .okit-model-bar-row") || r(S + " .okit-model-bar"), auswahl = r(S + " .okit-model-bar-select") || r(S + " .okit-model-bar select"), denk = r(S + " .okit-thinking-control select:not(.is-measuring)") || r(S + " .okit-thinking-toggle"), neu = r(S + " .okit-model-bar-refresh");
  const teile = { Modell: auswahl, Denkstufe: denk, "Neu laden": neu };
  const mitte = (b) => b.y + b.h / 2;
  const vorhanden = Object.entries(teile).filter(([, b]) => b);
  const mz = zeile ? mitte(zeile) : null;
  const mittellinie = mz === null || !vorhanden.length ? null : +Math.max(...vorhanden.map(([, b]) => Math.abs(mitte(b) - mz))).toFixed(1);
  const ueberdeckt = [];
  for (let i = 0; i < vorhanden.length; i++) for (let j = i + 1; j < vorhanden.length; j++) {
    const a = vorhanden[i][1], b = vorhanden[j][1];
    if (a.x < b.right - 0.5 && b.x < a.right - 0.5 && a.y < b.bottom - 0.5 && b.y < a.bottom - 0.5) ueberdeckt.push(vorhanden[i][0] + " x " + vorhanden[j][0]);
  }
  const sel = document.querySelector(S + " .okit-model-bar select");
  return {
    viewport: [innerWidth, innerHeight], isMobile: document.body.classList.contains("is-mobile"),
    zeile, auswahl, denkstufe: denk, neuLaden: neu, mittellinie, ueberdeckt,
    neuLadenGross: neu ? neu.w >= 44 && neu.h >= 44 : null,
    imRahmen: zeile && vorhanden.length ? vorhanden.every(([, b]) => b.x >= zeile.x - 0.5 && b.right <= zeile.right + 0.5) : null,
    modellname: sel ? (sel.options[sel.selectedIndex]?.textContent || "") : "",
  };
`;

async function messe(cdp: Cdp, zustand: string): Promise<Messung> {
  const m = await cdp.evaluate<Omit<Messung, "zustand">>(MESS_JS);
  return { zustand, ...m };
}
const kurz = (m: Messung): string => {
  const b = (x: Box | null): string => (x ? `${x.x},${x.y} ${x.w}×${x.h}` : "—");
  return [
    `${m.zustand}: Viewport ${m.viewport.join("×")} mobil ${String(m.isMobile)}`,
    `  Zeile ${b(m.zeile)} · Modell ${b(m.auswahl)} „${m.modellname}“ · Denkstufe ${b(m.denkstufe)} · Neu laden ${b(m.neuLaden)}`,
    `  Mittellinien auseinander ${m.mittellinie ?? "—"} px (Soll < 2) · überdeckt: ${m.ueberdeckt.length ? m.ueberdeckt.join(", ") : "nichts"} · Neu laden ≥ 44 × 44: ${String(m.neuLadenGross)} · alles in der Zeile: ${String(m.imRahmen)}`,
  ].join("\n");
};

const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};

async function main(): Promise<void> {
  const port = Number(flag("--port"));
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 9222) throw new Error("--port <1024-65535> ist Pflicht (9222 gehoert der regulaeren Instanz).");
  const tag = flag("--tag") ?? "lauf";
  const out = flag("--out") ?? "/tmp/i2m-w29";
  mkdirSync(out, { recursive: true });

  const stub = await startLlmStub({ models: [FAKE_MODEL], standard: { text: "Fake-Transkript", model: FAKE_MODEL } });
  const inst = startInstanz(stagingVaultDir(REPO_NAME), port);
  let cdp: Cdp | null = null;
  const messungen: Messung[] = [];
  try {
    cdp = await warteAufFenster(port, 60_000);
    await sleep(2500);
    const vor = await bereiteInstanzVor(cdp, { pluginIds: [PLUGIN_ID], nurVault: REPO_NAME, sprache: "en" });
    console.log(`Plugins: ${vor.hinweis}`);
    const stelleEndpunkt = (c: Cdp): Promise<boolean> => c.evaluate<boolean>(`
      const p = app.plugins.plugins[${q(PLUGIN_ID)}];
      p.settings.visionEndpoints = [{ url: ${q(stub.url)}, model: ${q(FAKE_MODEL)} }];
      p.settings.choice = {};
      p.llm.invalidate();
      await p.saveSettings();
      await p.llm.resolve({ force: true });
      return true;
    `);
    await stelleEndpunkt(cdp);

    // Mobil-Emulation: laedt Obsidian neu (der Aufruf endet mit „Execution context was destroyed“), danach neu anhaengen.
    await cdp.evaluate(`app.emulateMobile(true); return true;`).catch(() => undefined);
    try { cdp.close(); } catch { /* Kontext schon weg */ }
    await sleep(4000);
    const neu = await attachTo("workspace", port, REPO_NAME);
    if (!neu) throw new Error("nach dem Neuladen kein Fenster");
    cdp = neu;
    await requireVisible(cdp);
    await bereiteInstanzVor(cdp, { pluginIds: [PLUGIN_ID], nurVault: REPO_NAME, sprache: "en" });
    await stelleEndpunkt(cdp);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: BREITE, height: HOEHE, deviceScaleFactor: 2, mobile: true });
    await sleep(1200);
    if (!(await cdp.evaluate<boolean>(`return document.body.classList.contains("is-mobile");`))) throw new Error("is-mobile nach emulateMobile(true) nicht gesetzt");

    await cdp.evaluate(`app.commands.executeCommandById(${q(PLUGIN_ID + ":open-sidebar")}); return true;`);
    const da = await cdp.evaluate<boolean>(`for (let i = 0; i < 40 && !document.querySelector(".okit-model-bar"); i++) await new Promise((r) => setTimeout(r, 250)); return !!document.querySelector(".okit-model-bar");`);
    if (!da) throw new Error("die Modellzeile erscheint nicht");
    await cdp.evaluate(`const v = app.workspace.getLeavesOfType("image-to-markdown-view")[0].view; v.reloadModels(); v.refreshThinking(); await new Promise((r) => setTimeout(r, 1200)); return true;`);

    for (const [schema, name] of [["moonstone", "hell"], ["obsidian", "dunkel"]] as const) {
      await cdp.evaluate(`app.vault.setConfig("theme", ${q(schema)}); app.updateTheme(); app.workspace.trigger("css-change"); await new Promise((r) => setTimeout(r, 600)); return true;`);
      for (const mitTastatur of [false, true]) {
        const hoehe = mitTastatur ? HOEHE - TASTATUR : HOEHE;
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: BREITE, height: hoehe, deviceScaleFactor: 2, mobile: true });
        await sleep(900);
        const zustand = `${tag}-${name}-${mitTastatur ? "508" : "844"}`;
        const m = await messe(cdp, zustand);
        messungen.push(m);
        console.log(kurz(m));
        const png = await capture(cdp, undefined, 1);
        const pfad = join(out, `${zustand}.png`);
        writeFileSync(pfad, png);
        console.log(`  Bild ${pfad}`);
      }
    }
    writeFileSync(join(out, `${tag}-messung.json`), JSON.stringify(messungen, null, 2));
  } finally {
    if (cdp) {
      await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => undefined);
      // Das Profil behaelt die Emulation (localStorage): zurueckstellen, sonst startet der naechste Lauf mobil.
      await cdp.evaluate(`app.vault.setConfig("theme", "moonstone"); app.emulateMobile(false); return true;`).catch(() => undefined);
      await sleep(1500);
      cdp.close();
    }
    await stopInstanz(inst);
    await stub.stop();
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  exit(1);
});
