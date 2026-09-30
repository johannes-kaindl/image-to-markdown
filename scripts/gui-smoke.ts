/**
 * GUI-Smoke — die Pruefpunkte aus `docs/SMOKE.md` gegen ein LAUFENDES Obsidian.
 *
 * Warum es das gibt (CORE-TEST-02): 498 gruene Unit-Tests sagen nichts darueber, ob die
 * Sidebar im echten Workspace entsteht, ob `metadataCache` die Backlinks liefert, aus
 * denen die Idempotenz-Anzeige folgt, oder ob pdf.js mit seinem als Blob-URL
 * eingebetteten Worker im Renderer laedt. Was gegen einen Mock geprueft ist, ist
 * spezifiziert — nicht getestet.
 *
 * Die CDP-Bruecke wird IMPORTIERT, nicht kopiert: sie liegt zentral im Dach
 * (`obsidian-plugins/tools/obsidian-cdp/`). Fehlt ihr etwas, wird es DORT ergaenzt.
 *
 * ## Ablauf
 *
 * ```bash
 * npm run build && npm run shots -- --setup     # Vault aus dem getrackten Fixture
 * npm run deploy                                # PFLICHT: der Lauf misst den deployten Build
 * npm run smoke:gui -- --vault image-to-markdown
 * npm run smoke:gui -- --vault image-to-markdown --with-model   # + die zwei Modell-Punkte
 * ```
 *
 * `npm run deploy` ist keine Bequemlichkeit: seit dem Herkunfts-Guard (`requireEigenerBuild`,
 * s. `main()`) bricht der Lauf ab, wenn im Vault ein anderer Build liegt als der gebaute
 * Repo-Stand — eine Store-Installation etwa, die dieselbe Versionsnummer traegt. Ein gruener
 * Lauf gegen fremden Code ist schlimmer als kein Lauf, weil ein gruener Punkt nicht
 * untersucht wird.
 *
 * Obsidian muss mit `--remote-debugging-port=9222` laufen.
 *
 * ⚠️ **Zuerst pruefen, wer sonst an Obsidian haengt.** Die laufende Instanz ist geteilte
 * Infrastruktur — ein `quit` trifft die Instanz, an der moeglicherweise eine andere Session
 * arbeitet, und zerstoert deren Zustand. Der eigene Lauf ist danach sauber gruen; der
 * Schaden entsteht woanders und faellt nicht auf.
 *
 * ```bash
 * lsof -nP -iTCP:9222 -sTCP:LISTEN >/dev/null && echo "laeuft bereits — NICHT beenden"
 * ```
 *
 * Hoert der Port schon, dann **mitnutzen statt neu starten**: ein eigenes Fenster per
 * `vault-open` ueber IPC oeffnen, dann `attachTo("workspace", port, vault)` — der Vault-Name
 * waehlt, nicht die Reihenfolge. ⚠️ Die Port-Pruefung ersetzt die Frage nicht: sie zeigt
 * aktive CDP-Treiber, aber nicht, wer ein Fenster offen haelt oder auf den Port wartet.
 * `curl -s http://127.0.0.1:9222/json/list` nennt die Vaults der offenen Fenster und
 * beantwortet damit direkt, wen ein Quit traefe.
 *
 * Zwei Ergaenzungen zum Dach-Baustein, beide am 2026-09-02 in diesem Repo gemessen:
 *
 * 1. **Der CDP-Lock ist die Eintrittskarte, nicht die Kuer.** Ohne ihn blockt der
 *    PreToolUse-Guard jeden Zugriff, auch wenn der Port frei ist:
 *    `python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label image-to-markdown
 *    --intent "GUI-Smoke" --exclusive focus` — und danach `release`. `--exclusive focus`,
 *    weil dieser Treiber das Fenster nach vorn holt und ein fremdes `activate` eine
 *    laufende Messung zerschoesse. An dem Tag war der Lock von 15:20 bis 17:04
 *    durchgehend von vier fremden Sessions gehalten; einplanen, nicht ueberrascht sein.
 * 2. **Ein Vault, den Obsidian nicht kennt, ist KEIN Neustart-Grund.**
 *    `obsidian://open?vault=<name>` tut bei einem frischen `buildVault`-Ergebnis nichts;
 *    `open "obsidian://open?path=<URL-kodierter Pfad einer DATEI im Vault>"` oeffnet ihn
 *    als zusaetzliches Fenster derselben Instanz und registriert ihn dabei.
 *
 * Erst wenn nichts laeuft — oder nach Absprache mit dem, der es benutzt — darf gequittet
 * werden. Fuer destruktive Arbeit (Absturz reproduzieren, dutzendfach neu laden) ist die
 * Zweitinstanz der richtige Ort statt einer Nachfrage: eigenes `--user-data-dir` plus
 * eigener `--remote-debugging-port`, Rezept in der Dach-`AGENTS.md`.
 *
 * ## Warum der Kernlauf kein Modell braucht
 *
 * Ein Smoke, der einen erreichbaren Vision-Endpoint voraussetzt, misst die Laune eines
 * LLM mit und ist nicht reproduzierbar gruen. Alles, was ohne Lauf entscheidbar ist —
 * Listen-Aufbau, Idempotenz, PDF-Seitenzahl, Empty-State — steht deshalb im Kernlauf;
 * die zwei Punkte, die zwingend einen Lauf brauchen, hinter `--with-model`.
 */

import { execFileSync } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { argv, cwd, exit, platform } from "node:process";

import {
  attachTo,
  Cdp,
  clickReal,
  closeExtraLeaves,
  openExisting,
  pollUntil,
} from "../../tools/obsidian-cdp/cdp.js";
import { requireEigenerBuild } from "../../tools/obsidian-cdp/vault.js";
import { MODES, familyFromName } from "../src/vendor/kit/sampling-profiles";

const PLUGIN_ID = "image-to-markdown";
const VIEW_TYPE = "image-to-markdown-view";
const SIDEBAR = `.workspace-leaf-content[data-type='${VIEW_TYPE}']`;

/** Notizen des Fixtures. Namen stehen hier EINMAL — ein Tippfehler soll ein roter Punkt
 *  mit Dateinamen sein, kein stilles "0 Zeilen gefunden". */
const NOTIZ = {
  bilder: "Field notes.md",
  transkript: "Field notes (transcript).md",
  pdf: "Trail handbook.md",
  leer: "Reading list.md",
};

interface Ergebnis {
  ok: boolean;
  /** Was gemessen wurde — bei Fehlschlag inklusive der Meldung, die der Pruefling selbst
   *  anzeigt. Ein roter Punkt, der nur Zahlen nennt, blockiert die Fehlersuche aktiv
   *  (CORE-TEST-14). */
  detail: string;
}

/** Verbindungsdaten des Laufs. Zwei Pruefpunkte brauchen ein ZWEITES Fenster (die
 *  Einstellungen sind ab Obsidian 1.13 ein eigenes CDP-Target); `run` bekommt aber nur
 *  das Workspace-`cdp`. Wird in `main()` gesetzt, bevor ein Punkt laeuft. */
let verbindung = { port: 9222, vault: "image-to-markdown" };

interface Pruefpunkt {
  key: string;
  titel: string;
  /** true = braucht einen erreichbaren Vision-Endpoint (nur mit --with-model). */
  modell?: boolean;
  run(cdp: Cdp): Promise<Ergebnis>;
}

/** Sichtbarer Meldungstext des Prueflings — fuer die Diagnose eines roten Punktes.
 *  Bewusst ueber die plugin-eigenen Anker, nicht ueber Obsidians globalen `.notice`:
 *  in den schreiben alle Plugins des Vaults. */
async function meldungen(cdp: Cdp): Promise<string> {
  return await cdp.evaluate<string>(`
    const wurzel = document.querySelector(${JSON.stringify(SIDEBAR)});
    if (!wurzel) return "(Sidebar nicht im DOM)";
    const texte = [...wurzel.querySelectorAll(".img2md-error, .img2md-error-msg, .img2md-empty")]
      .map((e) => e.textContent.trim()).filter(Boolean);
    return texte.length ? texte.join(" | ") : "(keine Meldung sichtbar)";
  `);
}

/** Notiz oeffnen und warten, bis die Sidebar sie verarbeitet hat.
 *  `openExisting`, nicht `openNote`: letzteres UEBERSCHREIBT die Datei mit dem
 *  uebergebenen Body — an Fixture-Notizen ist das fatal (gemessen 2026-08-15 in
 *  3d-codeblocks: drei Fixture-Notizen auf 0 Bytes). */
async function zeigeNotiz(cdp: Cdp, pfad: string): Promise<void> {
  await openExisting(cdp, pfad, "preview");

  // ⚠️ Nicht auf "Liste ODER Empty-State steht" warten: beides steht schon von der
  // VORHERIGEN Notiz da, die Bedingung ist also sofort erfuellt und die Messung greift
  // den alten Zustand ab. Gemessen am 2026-08-30 beim ersten Lauf — die Zeilenliste kam
  // leer zurueck, obwohl die Sidebar zwei Zeilen zeigte. Das ist die Falle "der
  // Pruefpunkt wartet auf eine andere Bedingung, als er behauptet", und sie ist teurer
  // als ein dauerhaft roter Punkt, weil sie nur manchmal zuschlaegt.
  const aktiv = await pollUntil<string>(cdp, `
    const f = app.workspace.getActiveFile();
    return f && f.path === ${JSON.stringify(pfad)} ? f.path : null;
  `, 10_000, 200);
  if (!aktiv) throw new Error(`"${pfad}" wurde nicht zur aktiven Datei`);

  // Und dann auf den Marker der VIEW warten, nicht auf einen DOM-Zustand: `aktive Datei`
  // wechselt, bevor die View reagiert hat, und ein blosses "Liste steht still" ist in
  // dieser Luecke ebenfalls erfuellt — die alte Liste steht ja still. Genau so meldete
  // B3 am 2026-08-30 "1 Zeile" fuer eine Notiz ohne Bilder: gemessen wurde die
  // Transkript-Notiz des vorherigen Punktes.
  //
  // `cardsSourcePath` ist der einzige Zustand der View, der sagt "ich habe DIESE Datei
  // verarbeitet" — deshalb wird er gefragt und nicht das DOM. Auf den erwarteten INHALT
  // zu warten waere der andere Fehler: ein Punkt, der auf sein eigenes Soll wartet, kann
  // nicht mehr rot werden.
  const verarbeitet = await pollUntil<string>(cdp, `
    const blatt = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0];
    const gesehen = blatt?.view?.cardsSourcePath ?? null;
    return gesehen === ${JSON.stringify(pfad)} ? gesehen : null;
  `, 15_000, 250);
  if (!verarbeitet) {
    const gesehen = await cdp.evaluate<string>(`
      const blatt = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0];
      return String(blatt?.view?.cardsSourcePath ?? "(keine View)");
    `);
    throw new Error(`Sidebar verarbeitete "${pfad}" nicht — sie steht auf "${gesehen}"`);
  }
}

const PRUEFPUNKTE: Pruefpunkt[] = [
  {
    key: "A1",
    titel: "Plugin geladen, deployte Version gelesen",
    async run(cdp) {
      const roh = await cdp.evaluate<string>(`
        const aktiv = app.plugins.enabledPlugins.has(${JSON.stringify(PLUGIN_ID)});
        // Die Version aus plugin.manifest ist der Stand vom APP-START, nicht der
        // deployte — Obsidian liest die Manifeste beim Start und aktualisiert sie bei
        // enablePlugin NICHT. Eine Zahl, die genau dann irrefuehrt, wenn man ihr glaubt
        // (gemessen 2026-08-22, json_viewer).
        const pfad = app.vault.configDir + "/plugins/" + ${JSON.stringify(PLUGIN_ID)} + "/manifest.json";
        let deployt = null;
        try { deployt = JSON.parse(await app.vault.adapter.read(pfad)).version; } catch (e) { deployt = "(" + e.message + ")"; }
        return JSON.stringify({ aktiv, deployt, speicher: app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.manifest?.version ?? null });
      `);
      const d = JSON.parse(roh) as { aktiv: boolean; deployt: string; speicher: string | null };
      return {
        ok: d.aktiv && /^\d+\.\d+\.\d+/.test(d.deployt),
        detail: `aktiv=${d.aktiv} · deployt=${d.deployt} · im Speicher=${d.speicher}`,
      };
    },
  },
  {
    key: "A2",
    titel: "Sidebar oeffnet beim ERSTEN Aufruf sichtbar",
    async run(cdp) {
      // Die Ausgangslage eines frisch installierten Plugins herstellen: KEINE View, und
      // der rechte Split zu (so steht ein neuer Vault da). Ohne das misst der Punkt den
      // ZWEITEN Aufruf — und der nimmt einen anderen Zweig (`revealLeaf` statt
      // `setViewState`) und ist immer gruen. Ein Punkt, der den einzigen brechenden Pfad
      // gar nicht betritt, ist gruen am Falschen.
      await cdp.evaluate(`
        app.workspace.detachLeavesOfType(${JSON.stringify(VIEW_TYPE)});
        await new Promise((r) => setTimeout(r, 400));
        app.workspace.rightSplit.collapse();
        await new Promise((r) => setTimeout(r, 400));
        return true;
      `);
      await cdp.evaluate(`
        await app.commands.executeCommandById(${JSON.stringify(PLUGIN_ID + ":open-sidebar")});
        await new Promise((r) => setTimeout(r, 900));
        return true;
      `);
      // getClientRects statt querySelector: ein Banner, das nur `hidden` ist, haengt
      // weiter im DOM — Existenz ist kein Beleg fuer Sichtbarkeit (json_viewer 2026-08-22).
      const roh = await cdp.evaluate<string>(`
        const el = document.querySelector(${JSON.stringify(SIDEBAR)});
        if (!el) return JSON.stringify({ da: false });
        const r = el.getBoundingClientRect();
        return JSON.stringify({ da: true, rects: el.getClientRects().length, w: Math.round(r.width), h: Math.round(r.height), collapsed: app.workspace.rightSplit.collapsed });
      `);
      const d = JSON.parse(roh) as { da: boolean; rects?: number; w?: number; h?: number; collapsed?: boolean };
      if (!d.da) return { ok: false, detail: "Blatt mit data-type='image-to-markdown-view' nicht im DOM" };
      const sichtbar = (d.rects ?? 0) > 0 && (d.w ?? 0) > 50 && (d.h ?? 0) > 50;
      // Fuer die FOLGENDEN Punkte ausklappen, egal wie dieser ausging: sie messen an
      // einer sichtbaren View (Empty-State ueber getClientRects), und ein zugeklappter
      // Split wuerde sie alle rot faerben — mit einer Ursache, die nicht ihre ist.
      await cdp.evaluate(`app.workspace.rightSplit.expand(); await new Promise((r) => setTimeout(r, 500)); return true;`);
      return {
        ok: sichtbar,
        detail: sichtbar
          ? `${d.w}x${d.h} px, ${d.rects} Rect(s)`
          : `View entstand (${d.w}x${d.h} px), blieb aber unsichtbar — rechter Split `
            + `${d.collapsed ? "zugeklappt" : "offen"}. Fuer den Nutzer: Klick aufs `
            + `Ribbon-Icon tut sichtbar nichts, erst der zweite Klick oeffnet.`,
      };
    },
  },
  {
    key: "B1",
    titel: "Quellen der Notiz erkannt (PNG + HEIC)",
    async run(cdp) {
      await zeigeNotiz(cdp, NOTIZ.bilder);
      const roh = await cdp.evaluate<string>(`
        const wurzel = document.querySelector(${JSON.stringify(SIDEBAR)});
        const namen = [...wurzel.querySelectorAll(".img2md-item .img2md-name")].map((e) => e.textContent.trim());
        return JSON.stringify(namen);
      `);
      const namen = JSON.parse(roh) as string[];
      const ok = namen.length === 2
        && namen.some((n) => n.includes("field-notes.png"))
        && namen.some((n) => n.includes("photo.heic"));
      return {
        ok,
        detail: ok ? namen.join(", ") : `erwartet 2 (field-notes.png, photo.heic), bekam ${namen.length}: [${namen.join(", ")}] · ${await meldungen(cdp)}`,
      };
    },
  },
  {
    key: "B2",
    titel: "HEIC angezeigt, aber nicht auswaehlbar",
    async run(cdp) {
      const roh = await cdp.evaluate<string>(`
        const wurzel = document.querySelector(${JSON.stringify(SIDEBAR)});
        const zeilen = [...wurzel.querySelectorAll(".img2md-item")].map((zeile) => ({
          name: zeile.querySelector(".img2md-name")?.textContent.trim() ?? "?",
          // :scope > erzwingt die direkte Kindschaft — ein querySelector im Container
          // findet Nachfahren beliebiger Tiefe und mischt sonst fremde Zeilen (json_viewer)
          deaktiviert: zeile.querySelector(":scope > .img2md-check")?.disabled ?? null,
        }));
        return JSON.stringify(zeilen);
      `);
      const zeilen = JSON.parse(roh) as { name: string; deaktiviert: boolean | null }[];
      const heic = zeilen.find((z) => z.name.includes(".heic"));
      const png = zeilen.find((z) => z.name.includes(".png"));
      return {
        ok: heic?.deaktiviert === true && png?.deaktiviert === false,
        detail: zeilen.map((z) => `${z.name}: ${z.deaktiviert === null ? "keine Checkbox" : z.deaktiviert ? "deaktiviert" : "aktiv"}`).join(" · "),
      };
    },
  },
  {
    key: "C1",
    titel: "Vorhandenes Transkript erkannt (Backlink + Frontmatter)",
    async run(cdp) {
      const roh = await cdp.evaluate<string>(`
        const wurzel = document.querySelector(${JSON.stringify(SIDEBAR)});
        const zeile = [...wurzel.querySelectorAll(".img2md-item")]
          .find((z) => (z.querySelector(".img2md-name")?.textContent ?? "").includes("field-notes.png"));
        if (!zeile) return JSON.stringify({ zeile: false });
        return JSON.stringify({
          zeile: true,
          badge: zeile.querySelector(".img2md-exists")?.textContent.trim() ?? null,
          link: zeile.querySelector(".img2md-exists-open")?.textContent.trim() ?? null,
        });
      `);
      const d = JSON.parse(roh) as { zeile: boolean; badge?: string | null; link?: string | null };
      if (!d.zeile) return { ok: false, detail: "keine Zeile fuer field-notes.png" };
      return {
        ok: Boolean(d.badge) && Boolean(d.link),
        detail: d.badge
          ? `Badge "${d.badge}", Link "${d.link}"`
          : `kein Badge — findExistingTranscript fand die Notiz "${NOTIZ.transkript}" nicht (Frontmatter source_image? kind?)`,
      };
    },
  },
  {
    key: "C2",
    titel: "\"open\" springt zur Transkript-Notiz",
    async run(cdp) {
      const geklickt = await clickReal(cdp, `
        [...document.querySelectorAll(${JSON.stringify(SIDEBAR)} + " .img2md-item")]
          .find((z) => (z.querySelector(".img2md-name")?.textContent ?? "").includes("field-notes.png"))
          ?.querySelector(".img2md-exists-open")
      `);
      if (!geklickt) return { ok: false, detail: "Link .img2md-exists-open nicht klickbar" };
      const aktiv = await pollUntil<string>(cdp, `
        const f = app.workspace.getActiveFile();
        return f && f.path === ${JSON.stringify(NOTIZ.transkript)} ? f.path : null;
      `, 8_000, 200);
      const jetzt = await cdp.evaluate<string>(`return app.workspace.getActiveFile()?.path ?? "(keine)";`);
      return {
        ok: aktiv === NOTIZ.transkript,
        detail: aktiv ? `aktiv: ${aktiv}` : `erwartet "${NOTIZ.transkript}", aktiv ist "${jetzt}"`,
      };
    },
  },
  {
    key: "B3",
    titel: "Empty-State bei einer Notiz ohne Bilder",
    async run(cdp) {
      await zeigeNotiz(cdp, NOTIZ.leer);
      // `zeigeNotiz` wartet nur auf `cardsSourcePath === pfad` (der Marker "ich habe DIESE
      // Datei angenommen"), nicht auf den fertigen Render. Zwischen dem Setzen des Markers
      // und dem tatsaechlichen DOM-Update (Empty-State einblenden, alte Zeilen abraeumen)
      // liegt eine eigene, unbewachte Luecke — ein einzelner `evaluate` direkt danach traf
      // deshalb mal den alten, mal den neuen Zustand (gemessen 2026-09-17, Welle 5: B3
      // wechselte identisch auf zwei Staenden die Farbe, also unabhaengig vom Toggle-Umbau).
      // Mutation (zeigeNotiz) und Wartephase (dieser Poll) sind jetzt getrennt, Muster aus
      // paperless-storage/scripts/gui-smoke.ts:201.
      const auswertung = `
        const wurzel = document.querySelector(${JSON.stringify(SIDEBAR)});
        const leer = wurzel.querySelector(".img2md-empty");
        const info = {
          text: leer?.textContent.trim() ?? null,
          sichtbar: leer ? leer.getClientRects().length > 0 : false,
          zeilen: wurzel.querySelectorAll(".img2md-item").length,
        };
        return info;
      `;
      const roh = await pollUntil<string>(cdp, `
        const info = (() => { ${auswertung} })();
        return info.sichtbar && info.zeilen === 0 && info.text ? JSON.stringify(info) : null;
      `, 8_000, 200);
      if (roh) {
        const d = JSON.parse(roh) as { text: string; sichtbar: boolean; zeilen: number };
        return { ok: true, detail: `"${d.text}" (${d.zeilen} Zeilen)` };
      }
      // Timeout: Endzustand fuer die Meldung holen, unabhaengig davon, ob der Poll ihn als
      // Erfolg gewertet haette — sonst nennt eine rote Meldung nur "null" statt des Befunds.
      const abschluss = await cdp.evaluate<string>(`
        const info = (() => { ${auswertung} })();
        return JSON.stringify(info);
      `);
      const d = JSON.parse(abschluss) as { text: string | null; sichtbar: boolean; zeilen: number };
      return {
        ok: false,
        detail: d.text ? `"${d.text}" (${d.zeilen} Zeilen)` : `kein Empty-State, ${d.zeilen} Zeilen`,
      };
    },
  },
  {
    key: "D1",
    titel: "PDF geladen, Seitenzahl aus pdf.js",
    async run(cdp) {
      await zeigeNotiz(cdp, NOTIZ.pdf);
      // Die Seitenzahl kommt aus pdfPageCount — der Punkt prueft damit die
      // Worker-Blob-Strategie mit, an der das ganze Bundling haengt.
      const roh = await pollUntil<string>(cdp, `
        const wurzel = document.querySelector(${JSON.stringify(SIDEBAR)});
        const zeile = wurzel.querySelector(".img2md-item");
        const von = zeile?.querySelector(".img2md-pdf-from");
        const bis = zeile?.querySelector(".img2md-pdf-to");
        if (!von || !bis || !bis.value) return null;
        return JSON.stringify({
          name: zeile.querySelector(".img2md-name")?.textContent.trim() ?? "?",
          von: von.value, bis: bis.value, max: bis.max || null,
        });
      `, 20_000, 400);
      if (!roh) {
        return { ok: false, detail: `kein Seitenbereich erschienen · ${await meldungen(cdp)}` };
      }
      const d = JSON.parse(roh) as { name: string; von: string; bis: string; max: string | null };
      return {
        ok: d.von === "1" && d.bis === "3",
        detail: `${d.name}: Seite ${d.von}–${d.bis} (max ${d.max ?? "—"})`,
      };
    },
  },
  {
    key: "E1",
    titel: "Einstellungen: Kit-Endpunkt-Editor rendert, inkl. seiner CSS-Haelfte",
    async run(cdp) {
      // Bis 2026-08-30 zaehlte dieser Punkt nur `input`-Felder. Das war zu grob, um etwas
      // zu bemerken: die gesamte Endpunkt-UI wurde auf den Kit-Baustein umgestellt, und
      // weder er noch ein Unit-Test schlug an — er haette weitergemessen (Stolperstelle 3
      // des koda-Umzugs). Jetzt misst er die Grammatik des Bausteins UND ob dessen
      // sichtbare Haelfte in styles.css angekommen ist. Letzteres ist der inhaltliche
      // Gegenpart zu `tools/ui_adoption_check.py`, der nur die Regelmenge vergleicht:
      // eine Regel kann in der Datei stehen und trotzdem nicht greifen.
      // ⚠️ Ab Obsidian 1.13 sind die Einstellungen ein EIGENES CDP-Target. Die frühere
      // Fassung dieses Punktes maß deshalb im Workspace-Fenster ins Leere und meldete
      // „von hier nicht messbar" — als GRUENEN Punkt. Ein gruener Punkt, der nichts misst,
      // ist schlimmer als ein roter: er wird beim Zitieren zu behaupteter Abdeckung.
      // Deshalb wird hier ans Einstellungen-Fenster angedockt (`attachTo("settings", …)`
      // aus der zentralen Bruecke) und dort gemessen.
      const tab = await cdp.evaluate<string | null>(`
        app.setting.open();
        app.setting.openTabById(${JSON.stringify(PLUGIN_ID)});
        await new Promise((r) => setTimeout(r, 900));
        return app.setting.activeTab?.id ?? null;
      `);

      // `attachTo` liefert null, wenn kein Einstellungen-Fenster am Port haengt — das ist
      // ein MESSERGEBNIS (die Einstellungen gingen nicht auf), kein Infrastrukturfehler.
      const sicht = await attachTo("settings", verbindung.port, verbindung.vault)
        .catch(() => null);
      if (!sicht) {
        await cdp.evaluate(`app.setting.close(); return true;`).catch(() => undefined);
        return {
          ok: false,
          detail: `Tab "${tab}", aber am Port haengt kein Einstellungen-Fenster — Einstellungen gingen nicht auf`,
        };
      }

      try {
        const roh = await sicht.evaluate<string>(`
          const wurzel = document.querySelector(".modal.mod-settings") ?? document.body;
          const zeile = wurzel.querySelector(".okit-ep-row");
          const info = zeile ? zeile.querySelector(".setting-item-info") : null;
          return JSON.stringify({
            zeilen: wurzel.querySelectorAll(".okit-ep-row").length,
            status: wurzel.querySelectorAll(".okit-ep-status").length,
            felder: wurzel.querySelectorAll("input[type=text], input[type=password]").length,
            // Wirkt die uebernommene CSS-Haelfte? Der Baustein blendet den Info-Block der
            // Zeile aus, damit die drei Felder die volle Breite bekommen. Fehlt die Regel
            // in styles.css, steht hier "block" — sichtbar als gequetschte Felder. Genau
            // diese Datei war im Staging-Vault nie deployt, ohne dass es auffiel.
            infoDisplay: info ? getComputedStyle(info).display : null,
          });
        `);
        const d = JSON.parse(roh) as {
          zeilen: number; status: number; felder: number; infoDisplay: string | null;
        };
        const cssGreift = d.infoDisplay === "none";
        return {
          ok: tab === PLUGIN_ID && d.zeilen > 0 && d.status > 0 && cssGreift,
          detail: `Tab "${tab}", ${d.zeilen} Kit-Zeilen (.okit-ep-row), ${d.status} Status-Icons, `
            + `${d.felder} Eingabefelder, .setting-item-info display=${d.infoDisplay ?? "—"}`
            + `${cssGreift ? "" : " — CSS-Haelfte greift NICHT (styles.css gegen ENDPOINT_LIST_CSS pruefen)"}`,
        };
      } finally {
        sicht.close?.();
        await cdp.evaluate(`app.setting.close(); return true;`).catch(() => undefined);
      }
    },
  },
  {
    key: "E2",
    titel: "Einstellungen: Hilfe-Zeile steht als erste Zeile des Tabs (UI-STANDARD §8), mit Doku-Knopf und Bug-Icon",
    async run(cdp) {
      await cdp.evaluate(`
        app.setting.open();
        app.setting.openTabById(${JSON.stringify(PLUGIN_ID)});
        await new Promise((r) => setTimeout(r, 900));
        return true;
      `);
      const sicht = await attachTo("settings", verbindung.port, verbindung.vault).catch(() => null);
      if (!sicht) {
        await cdp.evaluate(`app.setting.close(); return true;`).catch(() => undefined);
        return { ok: false, detail: "kein Einstellungen-Fenster am Port — nichts gemessen" };
      }
      try {
        const roh = await sicht.evaluate<string>(`
          const wurzel = document.querySelector(".modal.mod-settings") ?? document.body;
          const erste = wurzel.querySelector(".vertical-tab-content .setting-item");
          return JSON.stringify({
            name: erste?.querySelector(".setting-item-name")?.textContent?.trim() ?? null,
            knoepfe: erste ? [...erste.querySelectorAll("button")].map((b) => b.textContent.trim()) : [],
            bug: erste ? erste.querySelectorAll(".clickable-icon svg.lucide-bug, .clickable-icon svg.bug").length : 0,
          });
        `);
        const d = JSON.parse(roh) as { name: string | null; knoepfe: string[]; bug: number };
        const ok = (d.name === "Help" || d.name === "Hilfe") && d.knoepfe.length === 1 && d.bug === 1;
        return { ok, detail: `erste Zeile "${d.name ?? "—"}", Knoepfe ${JSON.stringify(d.knoepfe)}, Bug-Icon: ${d.bug}` };
      } finally {
        sicht.close?.();
        await cdp.evaluate(`app.setting.close(); return true;`).catch(() => undefined);
      }
    },
  },
  {
    key: "F1",
    titel: "Endpunkt-Quelle: Manager an — Settings zeigen den Baustein statt der lokalen Liste, Modell-Zeile ausgeblendet",
    async run(cdp) {
      await installiereManager(cdp);
      try {
        const m = await messeEinstellungen(cdp);
        if (!m) return { ok: false, detail: "kein Einstellungen-Fenster am Port — nichts gemessen" };
        return {
          ok: m.baustein && m.zeilen === 0 && m.ausgeblendet === 1 && m.ausgeblendetSichtbar === 0,
          detail: `Baustein ${m.baustein ? "da" : "FEHLT"} · ${m.zeilen} lokale Zeile(n) sichtbar · globale Modell-Zeile ausgeblendet: ${m.ausgeblendet} im DOM, ${m.ausgeblendetSichtbar} sichtbar (Modell-Zeilen gesamt sichtbar: ${m.modellSichtbar}, davon eine im Baustein)`,
        };
      } finally {
        await entferneManager(cdp);
      }
    },
  },
  {
    key: "F2",
    titel: "Endpunkt-Quelle: Manager an — Aufloesung nimmt Manager-Endpunkt und Default-Modell",
    async run(cdp) {
      const lokal = await aufloesung(cdp);
      await installiereManager(cdp);
      try {
        const r = await aufloesung(cdp);
        return {
          ok: r.url === MGR_URL && r.model === MGR_MODEL && lokal.url !== MGR_URL,
          detail: `${r.url} · Modell ${r.model} (ohne Manager: ${lokal.url} · ${lokal.model || "—"})`,
        };
      } finally {
        await entferneManager(cdp);
        await aufloesung(cdp);
      }
    },
  },
  {
    key: "F3",
    titel: "Endpunkt-Quelle: Manager aus — lokale Liste und Modell-Zeile zurueck (Gegenprobe zu F1/F2)",
    async run(cdp) {
      const m = await messeEinstellungen(cdp);
      if (!m) return { ok: false, detail: "kein Einstellungen-Fenster am Port — nichts gemessen" };
      const r = await aufloesung(cdp);
      return {
        ok: m.zeilen > 0 && m.ausgeblendet === 0 && m.modellSichtbar === 1 && r.url !== MGR_URL,
        detail: `${m.zeilen} lokale Zeile(n) · ausgeblendet: ${m.ausgeblendet} · Modell-Zeile sichtbar: ${m.modellSichtbar} · Aufloesung ${r.url}`,
      };
    },
  },
  // ── N: Sampling-Profil (Modus transform) — Abschnitt „Anfrage“, Denk-Steuerung, gesendeter Body ──
  // Kein Modell noetig: alles hier ist DOM-Zustand bzw. ein Fake-Server im Node-Prozess. N2 faehrt
  // ZWEI Edits hintereinander (setzen, zuruecksetzen) — der Einklapp-Fehler des Piloten war im
  // gruenen Smoke unsichtbar, weil kein Punkt zwei Edits nacheinander fuhr (Plan-Nachtrag 6).
  {
    key: "N1",
    titel: "Anfrage: Abschnitt „Anfrage“/„Request“ in den Einstellungen klappt auf und wieder zu",
    async run(cdp) {
      const sicht = await oeffneEinstellungen(cdp);
      if (!sicht) return { ok: false, detail: "kein Einstellungen-Fenster am Port — nichts gemessen" };
      try {
        // Der Auf/Zu-Zustand lebt im Prozess (Kit-Fallback ohne `collapsedStorage`) und ueberlebt
        // das Schliessen der Einstellungen — der Ausgangszustand ist also nicht vorhersagbar.
        // Gemessen wird deshalb der WECHSEL in beide Richtungen, nicht ein fester Zielzustand.
        const r = await sicht.evaluate<string>(`
          const warte = (ms) => new Promise((x) => setTimeout(x, ms));
          const wurzel = document.querySelector(".modal.mod-settings") ?? document.body;
          const kopf = [...wurzel.querySelectorAll(".okit-collapsible-header")].find((h) => /Anfrage|Request/.test(h.textContent || ""));
          if (!kopf) return JSON.stringify({ da: false });
          const body = kopf.closest(".okit-collapsible").querySelector(".okit-collapsible-body");
          const offen = () => !body.classList.contains("is-collapsed");
          const s0 = offen(); kopf.click(); await warte(150);
          const s1 = offen(); kopf.click(); await warte(150);
          const s2 = offen();
          return JSON.stringify({ da: true, s0, s1, s2 });
        `);
        const d = JSON.parse(r) as { da: boolean; s0: boolean; s1: boolean; s2: boolean };
        return { ok: d.da && d.s1 === !d.s0 && d.s2 === d.s0, detail: d.da ? `offen: ${d.s0} → ${d.s1} → ${d.s2}` : "kein .okit-collapsible-header mit „Anfrage“/„Request“ gefunden" };
      } finally { await schliesseEinstellungen(cdp, sicht); }
    },
  },
  {
    key: "N2",
    titel: "Anfrage: Wert ueberschreiben, dann zuruecksetzen — der Abschnitt bleibt dabei aufgeklappt (zwei Edits hintereinander)",
    async run(cdp) {
      const vorher = await cdp.evaluate<string>(`return JSON.stringify(app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings.request);`);
      const sicht = await oeffneEinstellungen(cdp);
      if (!sicht) return { ok: false, detail: "kein Einstellungen-Fenster am Port — nichts gemessen" };
      try {
        const r = await sicht.evaluate<string>(`
          const warte = (ms) => new Promise((x) => setTimeout(x, ms));
          const wurzel = () => document.querySelector(".modal.mod-settings") ?? document.body;
          const kopf = [...wurzel().querySelectorAll(".okit-collapsible-header")].find((h) => /Anfrage|Request/.test(h.textContent || ""));
          if (!kopf) return JSON.stringify({ da: false });
          if (kopf.closest(".okit-collapsible").querySelector(".okit-collapsible-body").classList.contains("is-collapsed")) kopf.click();
          await warte(200);
          const offen = () => {
            const k = [...wurzel().querySelectorAll(".okit-collapsible-header")].find((h) => /Anfrage|Request/.test(h.textContent || ""));
            return !!k && !k.closest(".okit-collapsible").querySelector(".okit-collapsible-body").classList.contains("is-collapsed");
          };
          const feld = () => wurzel().querySelector('input[data-field="temperature"]');
          const f1 = feld();
          if (!f1) return JSON.stringify({ da: true, feld: false });
          f1.value = "0.9"; f1.dispatchEvent(new Event("blur"));
          await warte(400);
          const nachSetzen = { eigen: !!feld() && feld().classList.contains("okit-request-own"), offen: offen(), wert: feld() ? feld().value : null };
          const reset = feld() ? feld().closest(".setting-item").querySelector(".clickable-icon") : null;
          if (reset) reset.click();
          await warte(400);
          const nachReset = { eigen: !!feld() && feld().classList.contains("okit-request-own"), offen: offen(), wert: feld() ? feld().value : null };
          return JSON.stringify({ da: true, feld: true, nachSetzen, nachReset, reset: !!reset });
        `);
        const d = JSON.parse(r) as { da: boolean; feld?: boolean; reset?: boolean; nachSetzen?: { eigen: boolean; offen: boolean; wert: string | null }; nachReset?: { eigen: boolean; offen: boolean; wert: string | null } };
        if (!d.da || !d.feld || !d.nachSetzen || !d.nachReset) return { ok: false, detail: `Abschnitt/Feld nicht gefunden: ${r}` };
        const ok = d.nachSetzen.eigen && d.nachSetzen.offen && d.nachSetzen.wert === "0.9" && d.reset === true && !d.nachReset.eigen && d.nachReset.offen;
        return { ok, detail: `nach Setzen: eigener Wert=${d.nachSetzen.eigen}, Wert=${d.nachSetzen.wert}, offen=${d.nachSetzen.offen} · nach Zuruecksetzen: eigener Wert=${d.nachReset.eigen}, offen=${d.nachReset.offen}` };
      } finally {
        await schliesseEinstellungen(cdp, sicht);
        await cdp.evaluate(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          p.settings.request = JSON.parse(${JSON.stringify(vorher)});
          await p.saveSettings();
          return true;
        `).catch(() => undefined);
      }
    },
  },
  {
    key: "N3",
    titel: "Anfrage: der Denk-Knopf in der Sidebar schaltet um (Label und aria-pressed folgen)",
    async run(cdp) {
      const vorher = await cdp.evaluate<string>(`return JSON.stringify(app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings.request);`);
      try {
        await zeigeNotiz(cdp, NOTIZ.bilder);
        const lies = `(() => { const b = document.querySelector(${JSON.stringify(SIDEBAR + " .okit-thinking-toggle")}); return b ? JSON.stringify({ text: b.textContent.trim(), pressed: b.getAttribute("aria-pressed") }) : null; })()`;
        const davor = await cdp.evaluate<string | null>(`return ${lies};`);
        if (!davor) return { ok: false, detail: "kein .okit-thinking-toggle in der Sidebar" };
        await clickReal(cdp, `document.querySelector(${JSON.stringify(SIDEBAR + " .okit-thinking-toggle")})`);
        const danach = await pollUntil<string>(cdp, `const r = ${lies}; return r && r !== ${JSON.stringify(davor)} ? r : null;`, 5000, 200);
        const a = JSON.parse(davor) as { text: string; pressed: string };
        const b = danach ? (JSON.parse(danach) as { text: string; pressed: string }) : null;
        return { ok: b !== null && b.pressed !== a.pressed && b.text !== a.text,
          detail: `vorher "${a.text}" (aria-pressed=${a.pressed}) → nachher ${b ? `"${b.text}" (aria-pressed=${b.pressed})` : "unveraendert"}` };
      } finally {
        await cdp.evaluate(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          p.settings.request = JSON.parse(${JSON.stringify(vorher)});
          await p.saveSettings();
          for (const l of app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})) if (l.view.refreshThinking) l.view.refreshThinking();
          return true;
        `).catch(() => undefined);
      }
    },
  },
  {
    key: "N4",
    titel: "Anfrage: „Stufenwahl im Chat“ an → die Sidebar zeigt ein Dropdown mit vier Stufen statt des Knopfs",
    async run(cdp) {
      const vorher = await cdp.evaluate<string>(`return JSON.stringify(app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings.request);`);
      try {
        await zeigeNotiz(cdp, NOTIZ.bilder);
        const r = await cdp.evaluate<string>(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          const wurzel = document.querySelector(${JSON.stringify(SIDEBAR)});
          const vorherDd = !!wurzel.querySelector(".okit-thinking-control select");
          const vorherKnopf = !!wurzel.querySelector(".okit-thinking-toggle");
          await p.saveRequestSettings({ ...p.settings.request, levelPickerInChat: true });
          await new Promise((x) => setTimeout(x, 300));
          const sel = wurzel.querySelector(".okit-thinking-control select");
          return JSON.stringify({ vorherDd, vorherKnopf, nachherDd: !!sel, optionen: sel ? [...sel.options].map((o) => o.textContent) : [], knopfWeg: !wurzel.querySelector(".okit-thinking-toggle") });
        `);
        const d = JSON.parse(r) as { vorherDd: boolean; vorherKnopf: boolean; nachherDd: boolean; optionen: string[]; knopfWeg: boolean };
        return { ok: !d.vorherDd && d.vorherKnopf && d.nachherDd && d.knopfWeg && d.optionen.length === 4,
          detail: `Dropdown vorher=${d.vorherDd}, nachher=${d.nachherDd} (${JSON.stringify(d.optionen)}), Knopf ersetzt=${d.knopfWeg}` };
      } finally {
        await cdp.evaluate(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          p.settings.request = JSON.parse(${JSON.stringify(vorher)});
          await p.saveSettings();
          for (const l of app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})) if (l.view.refreshThinking) l.view.refreshThinking();
          return true;
        `).catch(() => undefined);
      }
    },
  },
  {
    key: "N5",
    titel: "Anfrage: der GESENDETE Body traegt das Profil des Modus transform (Temperatur aus den Kit-Tabellen, kein max_tokens)",
    async run(cdp) {
      const erwartet = MODES.transform.temperature.value;
      const sicht = await startFakeChat();
      const vor = await cdp.evaluate<string>(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        return JSON.stringify({ eps: p.settings.visionEndpoints, model: p.settings.visionModel, request: p.settings.request, choice: p.settings.choice });
      `);
      try {
        const r = await cdp.evaluate<string>(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          p.settings.visionEndpoints = [{ url: ${JSON.stringify(sicht.url)} }];
          p.settings.visionModel = "google/gemma-4-e4b";
          p.settings.request = { overrides: {}, thinking: {}, lastOnLevel: {}, levelPickerInChat: false };
          await p.resolveAndReconnect();
          const deps = p.makeImgViewDeps();
          const items = await deps.scan(${JSON.stringify(NOTIZ.bilder)});
          const item = items.find((i) => i.supported && i.kind === "image");
          if (!item) return JSON.stringify({ fehler: "kein unterstuetztes Bild in der Fixture-Notiz" });
          try { await deps.transcribeStream(${JSON.stringify(NOTIZ.bilder)}, item, () => {}, () => {}, new AbortController().signal); }
          catch (e) { return JSON.stringify({ fehler: String(e && e.message || e) }); }
          return JSON.stringify({ ok: true });
        `);
        const d = JSON.parse(r) as { ok?: boolean; fehler?: string };
        const body = sicht.bodies.at(-1) as Record<string, unknown> | undefined;
        if (!body) return { ok: false, detail: `der Fake-Server sah keinen POST (${d.fehler ?? "kein Fehler gemeldet"})` };
        const ok = body.temperature === erwartet && !("max_tokens" in body) && !("chat_template_kwargs" in body) && !("reasoning_budget" in body);
        return { ok, detail: `Server sah temperature=${String(body.temperature)} (Erwartung aus MODES.transform: ${erwartet}), Schluessel ${JSON.stringify(Object.keys(body).filter((k) => k !== "messages"))}, Modell ${String(body.model)}, Familie aus dem Namen: ${String(familyFromName("google/gemma-4-e4b"))}` };
      } finally {
        await sicht.close();
        await cdp.evaluate(`
          const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
          const v = JSON.parse(${JSON.stringify(vor)});
          p.settings.visionEndpoints = v.eps; p.settings.visionModel = v.model; p.settings.request = v.request; p.settings.choice = v.choice;
          await p.saveSettings();
          await p.resolveAndReconnect();
          return true;
        `).catch(() => undefined);
      }
    },
  },
  // ── G: Streaming gegen einen ECHTEN Endpunkt (Welle 11, Chat-Client-Tausch) ──────────────────
  // Der Kernlauf ist absichtlich modellfrei; diese drei Punkte sind der Beleg, dass der Chat-Weg
  // (Transport, SSE, Abbruch, Fehlerkoerper) gegen einen echten Server traegt. Sie bauen einen
  // FRISCHEN Client aus dem Konstruktor des laufenden Plugins — Einstellungen bleiben unberuehrt.
  // Endpunkt/Modell per Umgebung ueberschreibbar (I2M_SMOKE_ENDPOINT / I2M_SMOKE_MODEL).
  {
    key: "G1",
    titel: "Streaming: ein Vision-Aufruf gegen den echten Endpunkt liefert Text in mehreren Stuecken",
    modell: true,
    async run(cdp) {
      await cdp.evaluate(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        const C = p.visionClient.constructor;
        const c = new C(${JSON.stringify(G_ENDPOINT)}, ${JSON.stringify(G_MODEL)});
        const cv = document.createElement("canvas"); cv.width = 320; cv.height = 96;
        const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 320, 96);
        g.fillStyle = "#000"; g.font = "bold 48px sans-serif"; g.fillText("HELLO 42", 20, 64);
        const st = { chunks: 0, text: "", fertig: false, fehler: null, model: "", t0: Date.now() };
        globalThis.__i2mG1 = st;
        c.transcribeStream(cv.toDataURL("image/png"), "Transcribe the text in the image. Reply with the text only.",
          (t) => { st.chunks++; st.text += t; }, () => {}, new AbortController().signal, { reasoning_effort: "none" })
          .then((r) => { st.model = r.model; st.fertig = true; }, (e) => { st.fehler = String(e && e.message || e); st.fertig = true; });
        return true;
      `);
      const r = await pollUntil<string>(cdp, `
        const st = globalThis.__i2mG1;
        return st && st.fertig ? JSON.stringify(st) : null;
      `, 180_000, 2000);
      if (!r) return { ok: false, detail: "Aufruf nach 180 s nicht beendet" };
      const st = JSON.parse(r) as { chunks: number; text: string; fehler: string | null; model: string; t0: number };
      return {
        ok: st.fehler === null && st.chunks > 1 && /42/.test(st.text),
        detail: `${st.chunks} Stueck(e) · Modell "${st.model}" · Text "${st.text.trim().slice(0, 60)}"${st.fehler ? ` · FEHLER ${st.fehler}` : ""}`,
      };
    },
  },
  {
    key: "G2",
    titel: "Streaming: Abbruch per Signal beendet den Aufruf zuegig, mit Fehler statt Ergebnis",
    modell: true,
    async run(cdp) {
      await cdp.evaluate(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        const C = p.visionClient.constructor;
        const c = new C(${JSON.stringify(G_ENDPOINT)}, ${JSON.stringify(G_MODEL)});
        const ctrl = new AbortController();
        const st = { fertig: false, fehler: null, ergebnis: false, dauer: 0, abgebrochenNach: 0, t0: Date.now() };
        globalThis.__i2mG2 = st;
        c.transcribeTextStream("Write the numbers from 1 to 400, one per line.", "Follow the instruction.",
          () => { if (!st.abgebrochenNach) { st.abgebrochenNach = Date.now() - st.t0; ctrl.abort(); } }, () => {}, ctrl.signal, { reasoning_effort: "none" })
          .then(() => { st.ergebnis = true; st.fertig = true; st.dauer = Date.now() - st.t0; },
                (e) => { st.fehler = String(e && (e.name + ": " + e.message) || e); st.fertig = true; st.dauer = Date.now() - st.t0; });
        return true;
      `);
      const r = await pollUntil<string>(cdp, `
        const st = globalThis.__i2mG2;
        return st && st.fertig ? JSON.stringify(st) : null;
      `, 120_000, 1000);
      if (!r) return { ok: false, detail: "Aufruf nach 120 s nicht beendet" };
      const st = JSON.parse(r) as { fehler: string | null; ergebnis: boolean; dauer: number; abgebrochenNach: number };
      return {
        ok: st.fehler !== null && !st.ergebnis && st.abgebrochenNach > 0 && st.dauer - st.abgebrochenNach < 3000,
        detail: `erstes Stueck nach ${st.abgebrochenNach} ms, Abbruch, Ende nach ${st.dauer} ms · ${st.fehler ?? "KEIN Fehler, Ergebnis geliefert"}`,
      };
    },
  },
  {
    key: "G3",
    titel: "Streaming: HTTP-Fehler (ungueltige Bild-URL → 400) → Fehler mit nicht leerer Meldung (Text wird nur berichtet)",
    modell: true,
    async run(cdp) {
      await cdp.evaluate(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        const C = p.visionClient.constructor;
        const c = new C(${JSON.stringify(G_ENDPOINT)}, ${JSON.stringify(G_MODEL)});
        const st = { fertig: false, fehler: null, ergebnis: false };
        globalThis.__i2mG3 = st;
        c.transcribeStream("nonsense", "y", () => {}, () => {}, new AbortController().signal, { reasoning_effort: "none" })
          .then(() => { st.ergebnis = true; st.fertig = true; }, (e) => { st.fehler = String(e && e.message || e); st.fertig = true; });
        return true;
      `);
      const r = await pollUntil<string>(cdp, `
        const st = globalThis.__i2mG3;
        return st && st.fertig ? JSON.stringify(st) : null;
      `, 60_000, 1000);
      if (!r) return { ok: false, detail: "Aufruf nach 60 s nicht beendet" };
      const st = JSON.parse(r) as { fehler: string | null; ergebnis: boolean };
      return { ok: st.fehler !== null && st.fehler.trim() !== "", detail: st.fehler !== null ? `Meldung: "${st.fehler}"` : "KEIN Fehler" };
    },
  },
];

// --- Endpunkt-Quelle (Welle 8): Fake-Manager im Plugin-Slot ------------------------------------
// Der Manager wird als FAKE-API in den Slot `llm-endpoint-manager` gelegt (Form-Pruefung
// `isLlmEndpointManagerApi`), mit einer URL, die die lokale Liste nicht traegt — zwei verschiedene
// Werte im Protokoll sind der Beleg, dass gemessen wurde. Zurueckgesetzt wird in `finally` UND im
// Abbruch-Handler (cleanupState): ein liegen gebliebener Fake wuerde die echte Registrierung
// eines installierten Managers ueberschreiben.
/** Oeffnet die Einstellungen des Plugins und dockt ans eigene Fenster an (ab Obsidian 1.13 ein
 *  eigenes CDP-Target). `null`, wenn kein Fenster erscheint. */
async function oeffneEinstellungen(cdp: Cdp): Promise<Cdp | null> {
  await cdp.evaluate(`
    app.setting.open();
    app.setting.openTabById(${JSON.stringify(PLUGIN_ID)});
    await new Promise((r) => setTimeout(r, 900));
    return true;
  `);
  const sicht = await attachTo("settings", verbindung.port, verbindung.vault).catch(() => null);
  if (!sicht) await cdp.evaluate(`app.setting.close(); return true;`).catch(() => undefined);
  return sicht;
}
async function schliesseEinstellungen(cdp: Cdp, sicht: Cdp): Promise<void> {
  sicht.close?.();
  await cdp.evaluate(`app.setting.close(); return true;`).catch(() => undefined);
}

/** Fake-Chat-Endpunkt im Node-Prozess: beantwortet /v1/models und /v1/chat/completions und merkt
 *  sich jeden POST-Body. Mit CORS-Freigabe, damit der Stream-Weg (XHR) durchkommt und der Body
 *  vom echten Transport stammt, nicht vom Fallback. */
async function startFakeChat(): Promise<{ url: string; bodies: unknown[]; close(): Promise<void> }> {
  const bodies: unknown[] = [];
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
    if (req.url?.includes("/v1/models")) { res.writeHead(200, { ...cors, "Content-Type": "application/json" }); res.end(JSON.stringify({ data: [{ id: "google/gemma-4-e4b", object: "model" }] })); return; }
    if (req.method === "POST" && req.url?.includes("/v1/chat/completions")) {
      let raw = "";
      req.on("data", (c: Buffer) => { raw += c.toString("utf8"); });
      req.on("end", () => {
        try { bodies.push(JSON.parse(raw)); } catch { bodies.push({ kein_json: raw.slice(0, 80) }); }
        res.writeHead(200, { ...cors, "Content-Type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ model: "google/gemma-4-e4b", choices: [{ delta: { content: "Fake-Transkript" } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
        res.end("data: [DONE]\n\n");
      });
      return;
    }
    res.writeHead(404, cors); res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    bodies,
    close: () => new Promise<void>((resolve) => { server.close(() => { resolve(); }); }),
  };
}

const MGR_SLOT = "llm-endpoint-manager";
const MGR_URL = "http://127.0.0.1:9312";
const MGR_MODEL = "i2m-fake-vl";
const G_ENDPOINT = process.env.I2M_SMOKE_ENDPOINT ?? "http://127.0.0.1:1234";
const G_MODEL = process.env.I2M_SMOKE_MODEL ?? "google/gemma-4-e4b";

const installiereManager = (cdp: Cdp): Promise<unknown> => cdp.evaluate(`
  const plugins = app.plugins.plugins;
  if (!("__i2mVorherMgr" in globalThis)) globalThis.__i2mVorherMgr = plugins[${JSON.stringify(MGR_SLOT)}];
  const eintrag = { id: "fake1", label: "Fake-Endpunkt", defaultModel: ${JSON.stringify(MGR_MODEL)} };
  const aufgeloest = { id: "fake1", label: "Fake-Endpunkt", config: { url: ${JSON.stringify(MGR_URL)} }, defaultModel: ${JSON.stringify(MGR_MODEL)} };
  plugins[${JSON.stringify(MGR_SLOT)}] = { api: {
    version: 1, list: () => [eintrag], get: () => eintrag,
    resolve: async () => aufgeloest, materialize: async () => aufgeloest,
    models: async () => [${JSON.stringify(MGR_MODEL)}],
    importEndpoints: async () => ({ added: [], merged: [], skipped: [] }), on: () => () => {},
  } };
  return true;
`);
const entferneManager = (cdp: Cdp): Promise<unknown> => cdp.evaluate(`
  if ("__i2mVorherMgr" in globalThis) {
    const vorher = globalThis.__i2mVorherMgr;
    if (vorher === undefined) delete app.plugins.plugins[${JSON.stringify(MGR_SLOT)}];
    else app.plugins.plugins[${JSON.stringify(MGR_SLOT)}] = vorher;
    delete globalThis.__i2mVorherMgr;
  }
  return true;
`);
const aufloesung = (cdp: Cdp): Promise<{ url: string | null; model: string }> => cdp.evaluate(`
  const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
  await p.resolveAndReconnect();
  return { url: p.activeEndpoint ? p.activeEndpoint.url : null, model: p.model };
`);

/** Misst den Endpunkt-Abschnitt im Einstellungen-Fenster (eigenes CDP-Target ab 1.13). */
async function messeEinstellungen(cdp: Cdp): Promise<{ baustein: boolean; zeilen: number; modellZeilen: number; modellSichtbar: number; ausgeblendet: number; ausgeblendetSichtbar: number } | null> {
  await cdp.evaluate(`
    app.setting.open();
    app.setting.openTabById(${JSON.stringify(PLUGIN_ID)});
    await new Promise((r) => setTimeout(r, 1200));
    return true;
  `);
  const sicht = await attachTo("settings", verbindung.port, verbindung.vault).catch(() => null);
  if (!sicht) { await cdp.evaluate(`app.setting.close(); return true;`).catch(() => undefined); return null; }
  try {
    return await sicht.evaluate(`
      const wurzel = document.querySelector(".modal.mod-settings") ?? document.body;
      const modell = [...wurzel.querySelectorAll(".setting-item, .img2md-setting-managed")]
        .filter((z) => /^(Vision model|Vision-Modell)/.test(z.querySelector(".setting-item-name")?.textContent?.trim() ?? ""));
      return {
        baustein: wurzel.textContent.includes("LLM Endpoint Manager"),
        zeilen: wurzel.querySelectorAll(".okit-ep-row").length,
        modellZeilen: modell.length,
        modellSichtbar: modell.filter((z) => z.offsetParent !== null).length,
        // Die Zeile, die der Manager-Modus ausblendet, traegt die Klasse — sonst waere "Vision
        // model" doppeldeutig: mit Manager steht die GLEICHNAMIGE Zeile des Bausteins sichtbar da.
        ausgeblendet: wurzel.querySelectorAll(".img2md-setting-managed").length,
        ausgeblendetSichtbar: [...wurzel.querySelectorAll(".img2md-setting-managed")].filter((z) => z.offsetParent !== null).length,
      };
    `);
  } finally {
    sicht.close?.();
    await cdp.evaluate(`app.setting.close(); return true;`).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const args = argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? undefined : args[i + 1];
  };
  const port = Number(flag("port") ?? 9222);
  const vault = flag("vault") ?? "image-to-markdown";
  const mitModell = args.includes("--with-model");

  verbindung = { port, vault };   // E1 dockt damit ans Einstellungen-Fenster an
  console.log(`GUI-Smoke ${PLUGIN_ID} — Port ${port}, Vault "${vault}"`);
  const cdp = await Cdp.attach(port, vault);

  // Ausserhalb des try: das finally muss auch nach einem Abbruch mitten im Lauf
  // zurueckschreiben koennen.
  let vorher: string | null = null;
  const ergebnisse: { punkt: Pruefpunkt; ergebnis: Ergebnis }[] = [];
  /** Der Ausgang `ungeklaert` des Herkunfts-Guards bricht nicht ab, gehoert aber in die
   *  Abschlusszeile: eine Warnung, die nur oben im Protokoll steht, liest niemand mehr,
   *  wenn unten "9/9 gruen" steht. */
  const herkunftWarnungen: string[] = [];

  // Dieselbe Aufraeumarbeit wie im `finally` unten — als eigene Funktion, damit der
  // SIGINT/SIGTERM-Handler sie aufrufen kann, ohne Code zu duplizieren. Ein Ctrl-C mitten
  // im Lauf ueberspringt das `finally` NICHT (try/catch-Semantik), sondern beendet den
  // Node-Prozess sofort — ohne eigenen Handler blieben zusaetzliche Leaves offen und der
  // CDP-Socket haengt. Dieser Treiber schreibt sonst nichts Persistentes (kein
  // `vault.create`/`modify`/`delete` — reiner Lesezugriff plus geoeffnete Notizen/Sidebar),
  // deshalb entfaellt ein Leftover-Pruefpunkt (Regel: Handler Pflicht, Pruefpunkt entfaellt,
  // wenn nichts im `finally` steckt, das ihn rechtfertigt).
  const cleanupState = async (): Promise<void> => {
    if (vorher && vorher !== "null") {
      const gleich = await cdp.evaluate<boolean>(`
        const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        return JSON.stringify(p?.settings ?? null) === ${JSON.stringify(vorher)};
      `).catch(() => false);
      console.log(`  Einstellungen nach dem Lauf: ${gleich ? "byte-gleich" : "ABWEICHUNG — von Hand pruefen"}`);
    }
    await entferneManager(cdp).catch(() => undefined);
    await closeExtraLeaves(cdp).catch(() => 0);
  };

  let signalCleanupRunning = false;
  const onAbortSignal = (signal: NodeJS.Signals) => {
    if (signalCleanupRunning) return;
    signalCleanupRunning = true;
    void (async () => {
      console.log(`\n\nAbbruch durch ${signal} — raeume Smoke-Zustand auf...`);
      await cleanupState();
      cdp.close();
      process.exit(130);
    })();
  };
  process.on("SIGINT", onAbortSignal);
  process.on("SIGTERM", onAbortSignal);

  try {
    // Ohne Fokus drosselt Chromium den Renderer, das DOM bleibt leer und JEDER Punkt
    // waere rot — die Suche begaenne dann am Plugin statt am Fenster.
    await cdp.send("Page.bringToFront");
    if (platform === "darwin") {
      try {
        execFileSync("osascript", ["-e", 'tell application "Obsidian" to activate']);
        await new Promise((r) => setTimeout(r, 1500));
      } catch {
        console.log("  (Hinweis: `osascript activate` schlug fehl — Fenster ggf. von Hand nach vorn holen)");
      }
      await cdp.send("Page.bringToFront");
      await new Promise((r) => setTimeout(r, 600));
    }
    await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => undefined);

    const bereit = await cdp.evaluate<boolean>(
      `return document.hasFocus() && document.visibilityState === "visible";`,
    );
    if (!bereit) {
      throw new Error(
        "Das Obsidian-Fenster hat keinen Fokus — Chromium drosselt dann den Renderer und "
        + "jeder Pruefpunkt waere rot, ohne dass am Plugin etwas fehlt.",
      );
    }

    // Laeuft dieser Lauf gegen den eigenen Stand? Die Frage, gegen die `manifest.version`
    // strukturell blind ist: Store-Build und Repo-Build tragen dieselbe Nummer. Am
    // 2026-08-30 standen dachweit 69 von 150 gruenen Pruefpunkten auf einem Build, der
    // nicht belegt der Repo-Stand war.
    //
    // Der Pfad kommt aus der LAUFENDEN Instanz, nicht aus `stagingVaultDir(PLUGIN_ID)` —
    // dieser Treiber dockt per `--vault` an ein beliebiges Fenster an, und `--vault
    // 10_Pallas` ist im Kopf dieser Datei ausdruecklich vorgesehen. Ein Check gegen den
    // Staging-Pfad pruefte dann eine Datei, die mit dem Lauf nichts zu tun hat.
    // Geprueft wird, was gemessen wird.
    const vaultInfo = await cdp.evaluate<{ name: string; basePath: string; configDir: string }>(`
      return {
        name: app.vault.getName(),
        basePath: app.vault.adapter.basePath,
        configDir: app.vault.configDir,
      };
    `);
    console.log(`  Vault: ${vaultInfo.name}`);
    requireEigenerBuild(
      join(vaultInfo.basePath, vaultInfo.configDir, "plugins", PLUGIN_ID, "main.js"),
      // Zweites Argument = der sha1-Beweis statt des billigen Nachweises. Es muss ein
      // FRISCHER Build sein; `npm run deploy` baut ihn direkt davor. Fehlt die Datei,
      // faellt der Guard von selbst auf `ungeklaert` zurueck (Warnung, kein Abbruch).
      join(cwd(), "main.js"),
      (meldung) => {
        herkunftWarnungen.push(meldung);
        console.log(`  ! ${meldung}`);
      },
    );

    vorher = await cdp.evaluate<string>(`
      const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      return p ? JSON.stringify(p.settings ?? null) : "null";
    `);
    await closeExtraLeaves(cdp);

    for (const punkt of PRUEFPUNKTE) {
      if (punkt.modell && !mitModell) {
        console.log(`  ○ ${punkt.key}  ${punkt.titel} — uebersprungen (--with-model)`);
        continue;
      }
      try {
        const ergebnis = await punkt.run(cdp);
        ergebnisse.push({ punkt, ergebnis });
        console.log(`  ${ergebnis.ok ? "✓" : "✗"} ${punkt.key}  ${punkt.titel}\n      ${ergebnis.detail}`);
      } catch (fehler) {
        const detail = `${(fehler as Error).message} · Pruefling meldet: ${await meldungen(cdp).catch(() => "(nicht lesbar)")}`;
        ergebnisse.push({ punkt, ergebnis: { ok: false, detail } });
        console.log(`  ✗ ${punkt.key}  ${punkt.titel}\n      ${detail}`);
      }
    }
  } finally {
    // Der Lauf oeffnet Notizen und die Sidebar, er schreibt keine. Zurueckgesetzt wird
    // trotzdem, was er anfassen KOENNTE — und das Ergebnis kommt ins Protokoll, nicht
    // ins Vertrauen. Dieselbe Funktion wie der SIGINT/SIGTERM-Handler oben — kein
    // Doppelcode.
    //
    // Was NICHT zurueckgesetzt wird: der Zustand des rechten Splits und das Blatt-Layout.
    // Beides liegt in `workspace.json` des Staging-Vaults, und die entfernt `buildVault`
    // bei jedem `--setup` ohnehin — der Vault ist Wegwerfware. Im Produktivvault waere
    // dieselbe Zeile ein Eingriff; deshalb steht sie hier begruendet und nicht beilaeufig.
    process.off("SIGINT", onAbortSignal);
    process.off("SIGTERM", onAbortSignal);
    await cleanupState();
    cdp.close();
  }

  const gruen = ergebnisse.filter((e) => e.ergebnis.ok).length;
  console.log(`\n${gruen}/${ergebnisse.length} Pruefpunkte gruen`);
  for (const meldung of herkunftWarnungen) console.log(`! ${meldung}`);
  if (gruen !== ergebnisse.length) exit(1);
}

await main();
