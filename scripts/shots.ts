/**
 * Aufnahme-Treiber fuer `docs/images/` — faehrt den Vertrag aus `docs/images/README.md`
 * gegen ein **laufendes** Obsidian, statt die Bilder von Hand zu klicken.
 *
 * Warum getrackt: der Aufnahme-Vertrag stand ab 2026-06-21 im Repo, ohne dass je ein Bild
 * entstand — "nur Johannes, braucht laufendes Plugin" hielt ihn ein Jahr lang zu. Ein
 * Werkzeug, das nur einmal im Scratchpad existiert, ist keine Praxis.
 *
 * **Der Umfang ist ehrlich klein:** dieser Treiber nimmt DREI Motive auf
 * (`tutorial-sidebar.png`, `settings.png`, `thinking-toggle.png` — die beiden letzten seit 2026-10-10, vorher von Hand) und stellt
 * die Aufnahme-Primitive fuer die uebrigen bereit.
 * Die restlichen 14 Assets brauchen je einen Modell-Lauf und entstehen nach der
 * Schrittfolge in `docs/images/README.md`. Das war schon in der Vorgaenger-Fassung so und
 * steht hier, weil der Name "shots" leicht mehr verspricht, als der Treiber haelt.
 *
 * ## Was sich am 2026-08-30 geaendert hat
 *
 * Die CDP-Bruecke wird **importiert statt getragen**. Bis dahin lag sie inline in
 * `scripts/shots.mjs` (uebernommen aus `3d-codeblocks/scripts/gui-smoke.ts`, 2026-08-14);
 * seit dem 2026-08-16 liegt sie zentral in `obsidian-plugins/tools/obsidian-cdp/`, und
 * eine inline getragene Kopie ist laut Dach-`AGENTS.md` ein Rueckstand, kein Sonderweg.
 * Der Migrations-Sweep vom 18.08. hat dieses Repo nicht erfasst, weil
 * `template_drift_check.py` nach `scripts/lib/cdp.ts` sucht und eine inline getragene
 * Bruecke nicht sieht.
 *
 * Mitgekommen ist der Vault: er entsteht jetzt aus dem **getrackten Fixture**
 * (`docs/images/fixture/`) an dem Ort, den `STAGING_VAULTS_DIR` vorgibt — vorher lag der
 * Demo-Vault im Scratchpad und war beim naechsten Mal weg.
 *
 * ## Ablauf
 *
 * ```bash
 * npm run build && npm run shots -- --setup     # Vault aus dem Fixture bauen
 * npm run shots -- --vault image-to-markdown    # aufnehmen (beide Motive)
 * npm run shots -- --only settings.png          # nur ein Motiv (Zweitinstanz: --port <port>)
 * ```
 *
 * ⚠️ **Vor einem Quit koordinieren — Obsidian ist geteilte Infrastruktur.** Laeuft schon
 * eine Instanz mit offenem Port, wird sie MITBENUTZT: eigenes Fenster per `vault-open`
 * ueber IPC oeffnen, dann `Cdp.attach(port, vault)` — der Vault-Name waehlt, nicht die
 * Reihenfolge. Ein `quit` trifft die Fenster anderer Sessions und zerstoert deren
 * Zustand; der eigene Lauf ist danach sauber gruen, der Schaden faellt nicht auf.
 *
 * ```bash
 * lsof -nP -iTCP:9222 -sTCP:LISTEN >/dev/null && echo "belegt — erst fragen, wem"
 * ```
 *
 * Die Pruefung ersetzt die Frage nicht: sie zeigt aktive CDP-Treiber, aber nicht, wer ein
 * Fenster offen haelt oder auf den Port wartet.
 *
 * ## Fallstricke, die Zeit kosten, wenn man sie nicht kennt
 *
 * 1. **Chromium drosselt nicht-fokussierte Fenster.** Ohne `Page.bringToFront` (auf macOS
 *    zusaetzlich `osascript activate`) bleibt die View leer und man debuggt ein Phantom.
 * 2. **Die Einstellungen sind ein EIGENES Fenster** (Obsidian 1.13) — ein Target-Filter
 *    auf `app://obsidian.md` findet sie nicht. Die Bruecke unterscheidet sie ueber
 *    `window.app`, nicht ueber den (lokalisierten) Titel.
 * 3. **Die Sidebar kann zugeklappt sein.** Dann steht sie mit 0x0 px im DOM und die
 *    Aufnahme ist ein 64x64-Kruemel, ohne dass irgendetwas scheitert — genau so lief der
 *    erste Baseline-Lauf am 2026-08-30. `--setup` klappt sie deshalb auf.
 */

import { execFileSync } from "node:child_process";
import { argv, cwd, exit } from "node:process";

import { attachTo, Cdp, openExisting, pollUntil, setPluginSetting } from "../../tools/obsidian-cdp/cdp.js";
import { boxOf, capture, withMetrics, writeShot, type Rect } from "../../tools/obsidian-cdp/shot.js";
import { buildVault, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";

const PLUGIN_ID = "image-to-markdown";
const REPO_NAME = "image-to-markdown";
const VIEW_TYPE = "image-to-markdown-view";
const SIDEBAR = `.workspace-leaf-content[data-type='${VIEW_TYPE}']`;
const CAPTURE_WIDTH = 1200;
const THUMB_WIDTH = 380;

/**
 * Zuschnitt bis zum untersten Element mit echtem Inhalt.
 *
 * Ohne das besteht eine Sidebar-Aufnahme zu zwei Dritteln aus Leerraum und faengt
 * Obsidians Statusleiste ein. Volle-Hoehe-Container (Flex-Fueller) werden uebersprungen —
 * sie zoegen den Schnitt bis zum Fensterrand.
 *
 * **Warum das hier und nicht in der Bruecke steht:** `boxOf` dort liefert die volle Box
 * eines Elements, was fuer die meisten Motive richtig ist. Dieser Zuschnitt ist eine
 * Aussage darueber, was ins Bild GEHOERT — Rezept, nicht CDP-Mechanik. Er waere ein
 * plausibler Kandidat fuer `shot.ts` (der Skill `readme-shots` kennt "toter Weissraum aus
 * dem simulierten hohen Fenster" als wiederkehrende Falle), aber bisher braucht ihn genau
 * ein Repo. Die Extraktions-Schwelle des Dachs ist ausdruecklich keine Zaehlung von eins:
 * aus einem einzigen Beispiel extrahiert man fast immer die falsche Abstraktion.
 */
async function inhaltsBox(cdp: Cdp, selektor: string, pad = 8): Promise<Rect> {
  const roh = await cdp.evaluate<string | null>(`
    const root = document.querySelector(${JSON.stringify(selektor)});
    if (!root) return null;
    const rb = root.getBoundingClientRect();
    if (rb.width < 2 || rb.height < 2) return null;
    let bottom = rb.top;
    for (const el of root.querySelectorAll("*")) {
      const b = el.getBoundingClientRect();
      if (!b.height || !b.width || b.height > rb.height * 0.6) continue;
      const hatText = (el.textContent || "").trim().length > 0;
      const istKasten = ["INPUT", "IMG", "CANVAS"].includes(el.tagName);
      if (!hatText && !istKasten) continue;
      if (b.bottom > bottom && b.bottom <= rb.bottom) bottom = b.bottom;
    }
    return JSON.stringify({ x: rb.x, y: rb.y, width: rb.width, height: Math.min(rb.height, bottom - rb.top) });
  `);
  if (!roh) {
    // Eine 0x0-Box ist der haeufigere Fall als ein fehlender Selektor, und beide sehen im
    // Ergebnis gleich aus: ein winziges Bild, kein Fehler. Deshalb hier trennen.
    throw new Error(
      `Kein aufnehmbarer Bereich fuer "${selektor}" — Element fehlt oder ist 0x0 `
      + "(zugeklappte Sidebar?). `npm run shots -- --setup` klappt sie auf.",
    );
  }
  const b = JSON.parse(roh) as Rect;
  return {
    x: Math.max(0, b.x - pad),
    y: Math.max(0, b.y - pad),
    width: b.width + 2 * pad,
    height: b.height + 2 * pad,
  };
}

/** Vault aus dem getrackten Fixture herstellen. Wegwerfware: Inhalt kommt vollstaendig
 *  aus `docs/images/fixture/`, ein Verlust kostet einen Aufruf und keine Arbeit. */
function setup(): void {
  const vaultDir = stagingVaultDir(REPO_NAME);
  const log = buildVault({
    repoRoot: cwd(),
    vaultDir,
    fixtureDir: "docs/images/fixture",
    pluginId: PLUGIN_ID,
    generator: "make-assets.mjs",
  });
  console.log(`Vault: ${vaultDir}`);
  for (const zeile of log) console.log(" ·", zeile);
  console.log(
    "\nJetzt in Obsidian oeffnen (ohne Quit, falls schon eine Instanz laeuft):\n"
    + "  im Renderer eines offenen Fensters:\n"
    + `  electron.ipcRenderer.send("vault-open", ${JSON.stringify(vaultDir)}, false)\n`
    + "Beim ersten Oeffnen fragt Obsidian einmalig nach Vertrauen (Plugins aktivieren).",
  );
}

/** Das Einstellungs-Bild. Eigenes Fenster seit Obsidian 1.13 (dort existiert `app` nicht):
 *  der Tab wird im Workspace-Fenster geoeffnet, das Fenster danach ueber `attachTo` gefasst.
 *  Vorbild: json-editor/scripts/shots.ts `settingsBild` (Hoehe messen, dann so hoch simulieren). */
async function settingsBild(cdp: Cdp, port: number, vault: string, outDir: string): Promise<void> {
  // Zustand selbst herstellen: Auslieferungs-Default ist ein Endpunkt auf :8080 (nicht
  // erreichbar → Bild mit rotem Kreuz) und eine deutsche Kategorie-Liste, das Bild ist aber
  // englisch und zeigt den erreichbaren lokalen Server (Referenz-Setup LM Studio :1234).
  // Das Modell wird nicht erfunden: es kommt aus der Modell-Liste des Endpunkts.
  // Referenz-Modell des Setups (Vision + reasoning_content) steht in der Zeile; das Plugin selbst
  // kennt keinen Modellnamen (modellagnostisch).
  await setPluginSetting(cdp, PLUGIN_ID, "visionEndpoints", [{ url: "http://localhost:1234", model: "qwen/qwen3.6-27b" }]);
  await setPluginSetting(
    cdp, PLUGIN_ID, "describeTaxonomy",
    ["Photo", "Diagram", "Screenshot", "Handwriting", "Whiteboard", "Table", "Other"],
  );
  await cdp.evaluate(`
    app.setting.open();
    app.setting.openTabById(${JSON.stringify(PLUGIN_ID)});
    await new Promise((r) => setTimeout(r, 900));
    return true;
  `);
  const fenster = await attachTo("settings", port, vault);
  if (!fenster) throw new Error("settings.png — kein Einstellungen-Fenster gefunden");
  try {
    await fenster.send("Page.bringToFront");
    await new Promise((r) => setTimeout(r, 1500));
    // „Test vision“ druecken, damit die Faehigkeits-Zeile einen Befund zeigt statt „No vision“
    // (der Ausgangszustand ohne Probe liest sich wie ein Fehler).
    await fenster.evaluate(`
      const zeile = [...document.querySelectorAll(".setting-item")]
        .find((z) => /Vision capability/.test(z.textContent || ""));
      zeile?.querySelector("button")?.click();
      return true;
    `);
    const probe = await pollUntil<boolean>(fenster, `
      const zeile = [...document.querySelectorAll(".setting-item")]
        .find((z) => /Vision capability/.test(z.textContent || ""));
      const knopf = zeile?.querySelector("button");
      const t = (zeile?.textContent || "").replace("Test vision", "");
      // fertig = der Knopf ist wieder frei (waehrend der Probe ist er gesperrt und dreht) und es steht ein Befund da
      return knopf && !knopf.disabled && /Vision/.test(t) && !/No vision/.test(t) ? true : null;
    `, 60_000, 500);
    if (!probe) throw new Error("settings.png — Vision-Probe lieferte kein Ergebnis (Modell geladen?)");
    const hoehe = await fenster.evaluate<number>(`
      const el = document.querySelector(".vertical-tab-content");
      return el ? Math.ceil(el.scrollHeight) + 80 : 0;
    `);
    if (!hoehe) throw new Error("settings.png — kein Inhaltsbereich im Einstellungen-Fenster");
    const hinweis = await withMetrics(fenster, 1000, Math.max(hoehe, 700), async () => {
      await new Promise((r) => setTimeout(r, 600));
      const box = await boxOf(fenster, ".vertical-tab-content", 0);
      if (!box) throw new Error("settings.png — Inhaltsbereich nach der Simulation weg");
      // Auf den INHALT kappen: im simulierten hohen Fenster ist der Container so hoch wie die
      // Simulation, darunter steht Leere.
      // Der Vertrag endet bei „Description categories“; „Frontmatter mapping“ ist ein eigenes
      // Bild (frontmatter-mapping.png). Unten also vor dieser Ueberschrift kappen.
      const unten = await fenster.evaluate<number>(`
        const el = document.querySelector(".vertical-tab-content");
        const kopf = [...el.querySelectorAll(".setting-item-heading")]
          .find((h) => /Frontmatter mapping/.test(h.textContent || ""));
        if (kopf) return Math.floor(kopf.getBoundingClientRect().top) - 8;
        const kinder = [...el.children].filter((k) => k.getBoundingClientRect().height > 0);
        const letztes = kinder[kinder.length - 1];
        return letztes ? Math.ceil(letztes.getBoundingClientRect().bottom) : 0;
      `);
      const geschnitten = unten > box.y ? { ...box, height: Math.round(unten - box.y) } : box;
      const png = await capture(fenster, geschnitten, 2);
      return await writeShot(fenster, "settings.png", png, {
        outDir, captureWidth: CAPTURE_WIDTH, thumbWidth: THUMB_WIDTH, thumb: true,
      });
    });
    console.log(`  ${hinweis}`);
  } finally {
    await fenster.evaluate("window.close(); return true;").catch(() => undefined);
    fenster.close();
  }
}

async function main(): Promise<void> {
  const args = argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? undefined : args[i + 1];
  };

  if (args.includes("--setup")) { setup(); return; }

  const port = Number(flag("port") ?? 9222);
  const vault = flag("vault") ?? REPO_NAME;
  const outDir = flag("out") ?? "docs/images";
  const only = flag("only");

  const cdp = await Cdp.attach(port, vault);
  try {
    await cdp.send("Page.bringToFront");
    if (process.platform === "darwin") {
      try {
        execFileSync("osascript", ["-e", 'tell application "Obsidian" to activate']);
        await new Promise((r) => setTimeout(r, 1200));
      } catch {
        console.log("  (Hinweis: `osascript activate` schlug fehl — Fenster ggf. von Hand nach vorn holen)");
      }
      await cdp.send("Page.bringToFront");
    }

    if (only === "settings.png") {
      await settingsBild(cdp, port, vault, outDir);
      return;
    }

    // Zustand selbst herstellen, nicht vorfinden: Sidebar offen, Split ausgeklappt, eine
    // Notiz mit Bildern aktiv. Ein Treiber, der den Zustand voraussetzt, nimmt beim
    // naechsten Mal etwas anderes auf.
    await cdp.evaluate(`
      await app.commands.executeCommandById(${JSON.stringify(PLUGIN_ID + ":open-sidebar")});
      app.workspace.rightSplit.expand();
      await new Promise((r) => setTimeout(r, 600));
      return true;
    `);
    await openExisting(cdp, "Field notes.md", "preview");
    const bereit = await pollUntil<string>(cdp, `
      const blatt = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0];
      return blatt?.view?.cardsSourcePath === "Field notes.md" ? "ok" : null;
    `, 15_000, 250);
    if (!bereit) throw new Error("Sidebar verarbeitete \"Field notes.md\" nicht");

    // Zuschnitt auf die Preset-Zeile mit dem Denk-Knopf (Kit-Baustein „Thinking: …“).
    const denkBild = async (): Promise<void> => {
      // Der Vertrag bevorzugt den eingeschalteten Zustand; steht er auf „off“, einmal umschalten.
      await cdp.evaluate(`
        const k = document.querySelector(${JSON.stringify(SIDEBAR + " .img2md-think .okit-thinking-toggle")});
        if (k && /off/.test(k.textContent || "")) k.click();
        await new Promise((r) => setTimeout(r, 600));
        return true;
      `);
      const zeile = await boxOf(cdp, `${SIDEBAR} .img2md-preset-row`, 4);
      if (!zeile) throw new Error("thinking-toggle.png — keine Preset-Zeile in der Sidebar");
      const png = await capture(cdp, zeile, 2);
      console.log(`  ${await writeShot(cdp, "thinking-toggle.png", png, { outDir, captureWidth: 900, thumbWidth: 450 })}`);
    };
    if (only === "thinking-toggle.png") { await denkBild(); return; }

    const box = await inhaltsBox(cdp, SIDEBAR);
    const png = await capture(cdp, box, 2);
    const hinweis = await writeShot(cdp, "tutorial-sidebar.png", png, {
      outDir,
      captureWidth: CAPTURE_WIDTH,
      thumbWidth: THUMB_WIDTH,
    });
    console.log(`  ${hinweis}`);
    if (!only) {
      await denkBild();
      await settingsBild(cdp, port, vault, outDir);
    }
    console.log(
      "\nDrei Motive aufgenommen. Die uebrigen brauchen je einen Modell-Lauf —\n"
      + "Schrittfolge in docs/images/README.md § 'Reproducible capture recipe'.",
    );
  } finally {
    cdp.close();
  }
}

await main().catch((fehler: Error) => { console.error(fehler.message); exit(1); });
