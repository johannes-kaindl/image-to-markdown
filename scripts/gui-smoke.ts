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
];

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
