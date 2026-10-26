// vendored from obsidian-kit@0.72.0, src/obsidian/dom-guard.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { MarkdownRenderer, type App, type Component } from "obsidian";
import { realClock, type ClockPort } from "./clock";
import { neutralizeRemoteResourcesInTree, type RemovedResource, type RemoteResourcesOptions } from "../kit/remote-resources";
import { neutralizeUnsafeLinksInTree } from "../kit/link-guard";

/**
 * Zweite Schicht gegen Fernquellen in gerenderten Antworten: ein `MutationObserver` am Container, der
 * `neutralizeRemoteResourcesInTree` (code-kit `web/remote-resources`) **synchron im Callback** laufen lässt.
 *
 * ## Ein Netz, keine Grenze
 *
 * **Die Grenze für Modell-Ausgabe in einer lebenden Ansicht ist die Regex-Schicht davor** (`neutralizeModelMarkdown`,
 * der Default von `createStableWriter`): sie läuft vor dem Parser. Der Observer fängt auf, was sie nicht kennt oder
 * wo sie fehlt (`raw: true`); er ist dicht für Bild-Quellen und Dokument-Tags und undicht bei allem, was erst bei der
 * Stil-Berechnung oder der Erzeugung des Elements lädt. Wer `raw` mit `neutralizeRemoteResources` rendert, hat in
 * einer lebenden Ansicht **keine Grenze** gegen Fernquellen. Eine Grenze ist nur der inerte Weg (Durchgang auf einem
 * Baum ohne Browsing-Kontext vor dem Anhängen, slide-deck 0.15.0).
 *
 * Gemessen im echten Renderer (Obsidian 1.14.4, Zweitinstanz, sichtbares Fenster, 402 Angriffsfälle aus code-kit
 * `tests/fixtures/remote-sources.json`, Welle 16, Cockpit-Task „Fernquellen-Entschärfung DOM-basiert statt Regex“,
 * Abschnitt „Messung 2026-10-10“): mit `raw: true` ohne Wächter laden 139 Fälle, mit Wächter (code-kit 0.19.1) 65, mit
 * der Regex-Schicht allein (Standard des Writers) 0 und mit Regex-Schicht plus Wächter 0; 30 `keep`-Fälle bleiben
 * unverändert. Die 65 Reste nach Elementart: `style`-Attribut in HTML 42 von 42, SVG-Präsentationsattribute (`fill`,
 * `mask`, `clip-path`, `marker-*`, `stroke`) 13 von 24, `background`-Attribut an `table`/`td`/`th` 4 von 4, `style`
 * in SVG/MathML 3 von 3, SVG `feImage` 2 von 2, `video poster` 1 von 2. Kein `img`, `source`/`picture`, `srcset`,
 * `iframe`, `link`, `object` oder `embed` mehr.
 *
 * ## Warum ein Observer und kein Durchgang nach `render()`
 *
 * Ein Durchgang direkt nach `await MarkdownRenderer.render` kam bei 50 von 96 ladenden Fällen zu spät (ungehängt 45):
 * Bilder, `srcset`, `<picture>`, `video poster`, SVG `image`/`feImage` und Mermaid sind beim Auflösen des Versprechens
 * unterwegs. Ein inertes Dokument kam nicht in Frage: Mermaid rendert dort nicht, `video poster` lädt trotzdem, und
 * das Versprechen von `render()` hängt bei Bildern.
 *
 * ## Wirkung hängt an der Engine
 *
 * Für `<img>` entscheidet das Entfernen von `src` vor dem Ersetzen (code-kit 0.19.1 macht es im Durchgang). In
 * Obsidian 1.14.4 (Chromium 142) bringt das im Observer-Callback nach `innerHTML` 0 von 12 Anfragen, mit Ersetzen
 * ohne Entfernen 12 von 12, ohne Wächter 12 von 12. In Chrome 154 headless (code-kit-Messung) kamen im Observer 15 von
 * 15 durch, mit und ohne Abräumen; die Abweichung ist ungeklärt. Mit dem nächsten Electron-Sprung kann sich das ändern.
 *
 * ## `render()` wird nie blind abgewartet
 *
 * Entfernt der Observer ein `src`, bekommt das Bild nie ein `load`-Ereignis, und `MarkdownRenderer.render`
 * löst bei Bildern nicht auf, solange sie nicht geladen haben (gemessen: 33 von 70 Fällen laufen in die Frist).
 * Das DOM steht trotzdem. Deshalb läuft jedes Rendern hier gegen eine Frist (`DOM_GUARD_DEADLINE_MS`); danach
 * gilt es als fertig.
 *
 * ## Restgrenzen
 *
 * - Die Reste oben. Ursache gemessen (Welle 17, 2026-10-11, n=1 Lauf): ein erzwungenes Layout im Writer (`followTail`
 *   liest die Höhe) startete die CSS-Abrufe, bevor der Observer-Callback als Mikroaufgabe lief. Seit 0.54.0 ruft
 *   `createStableWriter` vor dem Layout-Lesen `flush()` (`takeRecords()` plus Durchgang, synchron): von 139 ladenden
 *   Fällen lecken 66 (0.53.0) → 3 bis 4 (`video poster` ×2, SVG `feImage` ×1 bis ×2; `feImage` in einem `filter` flackert
 *   zwischen Läufen und leckt auch in 0.53.0). Sie laden bei der Elementerzeugung, dafür ist der Observer in jedem Arm zu spät,
 *   und die Regex-Schicht deckt sie. `style`-Attribut, SVG-Paint und `background` sind zu. 30 `keep` unverändert. Nicht
 *   auswertbar: `iframe relative`, `iframe app scheme` (lassen den Renderer hängen) und `frame in frameset` (wirft im
 *   Renderer), in allen Armen.
 * - Der Durchgang im Observer und in `flush()` läuft **inkrementell** über die berührten Teilbäume (hinzugefügte Elemente,
 *   Elemente mit geändertem Attribut, das Eltern-Element eines geänderten Textes), nicht über den ganzen Container: ein
 *   Durchgang je Batch über den ganzen Body wäre über eine Antwort hinweg quadratisch. Gemessen (Renderer, 2 000 `push`
 *   mit einer Mikroaufgabe dazwischen, wachsendes Markdown): Gesamtzeit 20 KB 490 → 153 ms und 100 KB 3,2 → 1,3 s gegenüber
 *   0.53.0, Summe der `push`-Zeiten 115 → 115 ms (20 KB) und 530 → 480 ms (100 KB). Der volle Durchgang bleibt nach jedem
 *   gerenderten Block (`run()`), als Rückfall.
 - Mermaid zeichnet in einem Zwischenelement am Dokument, das ein Observer am Container nicht sieht; die Bildform
 *   `A@{ img: "https://…" }` lädt Mermaid 11 per `new Image()` außerhalb jedes Baums. **Mermaid ist deshalb nur
 *   gedeckt, wenn die erste Schicht `neutralizeModelMarkdown` ist** (sie lässt keine Fences stehen). Wer im
 *   `raw`-Pfad selbst `neutralizeRemoteResources` nimmt, lässt Mermaid-Fences durch (`A@{ img: … }` und
 *   `classDef … background:url(https://…)` kommen unverändert heraus, Probe gegen code-kit 0.18.0) und hat dort
 *   bis zur code-kit-Task „neutralizeRemoteResources — Mermaid fences with remote sources“ keine Deckung. Der
 *   Default des `createStableWriter` (`neutralizeModelMarkdown`) ist nicht betroffen.
 * - Obsidians eigener Sanitizer entfernt 43 von 137 Fällen der ersten Fassung der Liste vorab (u. a. jedes `<style>`);
 *   SMIL-`href` und `cursor` laden in Chromium im Kurzlauf nicht, der Durchgang entfernt sie trotzdem.
 * - `renderMarkdownGuarded` trennt den Observer nach der Frist; was danach asynchron entsteht, sieht er nicht.
 *   Der Observer des `createStableWriter` lebt dagegen so lange wie der Schreiber.
 * - Links: seit 0.70.0 schneidet der zweite Durchgang gefährliche Link-Ziele ab (siehe unten); ein Link mit erlaubtem Ziel bleibt klickbar. Der Durchgang läuft hier auf dem angehängten
 *   Baum; serialisiert und neu geparst wird nirgends (Vertrag von `remote-resources`).
 *
 * ## Zweiter Durchgang: Link-Ziele und aktive Tags (seit 0.70.0, Linkschutz)
 *
 * `neutralizeRemoteResourcesInTree` meldet selbst: „No script defence“ (Ereignis-Attribute und `javascript:` im Link sind nicht sein Gegenstand). Dafür läuft hinter ihm, über denselben Teilbaum, im Observer, in `run()` und in
 * `flush()`, `neutralizeUnsafeLinksInTree` (code-kit `web/link-guard`, die Klassifikation aus settings-assistant): `http`, `https`, `mailto` und Ziele ohne Schema bleiben; `javascript:`, `data:`, `vbscript:`, `file:` und `app:`
 * gehen **nie** (auch nicht an einem inneren Link und auch nicht mit einem Schalter); `obsidian:` geht, solange `allowObsidianLinks` nicht `true` ist (Default aus: eine Antwort soll keine Obsidian-Aktion auslösen, etwa einen
 * anderen Vault öffnen); jedes andere Schema geht, außer an einem inneren Link (`data-href`, dort ist ein Doppelpunkt im Notiznamen kein Schema). `img`, `iframe`, `embed`, `video`, `audio`, `object`, `link`, `style`, `script`,
 * `source` und weitere aktive Tags gehen mit ihrem Teilbaum; mit `allowLocalImages` (Default aus) bleibt ein `img` mit lokaler Quelle (relativ, `app:`, `capacitor:`), auf `src`, `srcset`, `alt`, `title`, `width`, `height`, `class`
 * gekürzt. Entfernte Bilder und `data:` bleiben mit und ohne Schalter gesperrt. Die Optionen stehen in `DomGuardOptions`; `onRemoved` bekommt das Entfernte beider Durchgänge in einem Aufruf.
 *
 * Gemessen im echten Renderer (Obsidian 1.14.5, `pilot/link-schutz.ts`): Obsidian entfernt `javascript:`, `data:` und `vbscript:` als `href` selbst, behält aber `file:`, `app:` und `obsidian:`; der Wächter kappt diese. Lokale
 * Bilder (`![](bild.png)`, `![[bild.png]]`) kommen ohne Wächter als `app://…`-`img` an. **Im Chat-Fenster mit dem Standard-Schreiber erreichen Bilder und HTML den Wächter nie:** `neutralizeModelMarkdown` macht jedes Markdown-Bild
 * zu Text und escaped `<`; `allowLocalImages` und ein gefälschtes `<a data-href>` gibt es dort nicht. Beides gilt für `raw`-Schreiber und `renderMarkdownGuarded`. Ein gekappter Link behält seine Klasse, nur das `href` fehlt; `STREAM_AREA_CSS` (seit 0.72.0, `.okit-stream-body a:not([href])`) nimmt ihm
 * Farbe, Unterstrich, Zeiger und Pfeil, er sieht aus wie Text (ein Wirt ohne `.okit-stream-body` kopiert die Regel). Ein `svg` bleibt (code-kit 0.37.4), wenn sein Teilbaum nur Formen trägt (`SVG_TAGS`), gekürzt auf Geometrie- und Darstellungsattribute: das Icon eines Callouts und der Kopier-Knopf eines Codeblocks bleiben (gemessen 1→1); mit 0.37.0 bis 0.37.2 gingen sie mit.
 *
 * Gebraucht wird ein DOM mit `MutationObserver`. Ohne einen wirft `attachDomGuard`, statt still ungeschützt zu
 * bleiben: ein Test mit dem Fake-DOM (`makeFakeEl`) übergibt `domGuard: false`.
 */
export const DOM_GUARD_DEADLINE_MS = 1500;

export interface DomGuardOptions extends RemoteResourcesOptions {
  /** `obsidian://`-Links in Antworten behalten (Default aus, seit 0.70.0): eine Antwort soll keine Obsidian-Aktion auslösen können (einen anderen Vault öffnen). `javascript:`, `data:`,
   *  `vbscript:`, `file:` und `app:` als Link-Ziel gehen nie, mit und ohne Schalter; `http`, `https`, `mailto` und Ziele ohne Schema bleiben immer. Die Einstellungszeile dazu: `buildLinkSettings`. */
  allowObsidianLinks?: boolean;
  /** Bilder mit lokaler Quelle (relativ, `app:`, `capacitor:`) behalten (Default aus, seit 0.70.0): `img` bleibt dann auf `src`, `srcset`, `alt`, `title`, `width`, `height`, `class` gekürzt.
   *  Entfernte Bilder bleiben immer gesperrt, `data:` auch als Bildquelle; `iframe`, `embed`, `video`, `audio`, `object`, `link`, `style`, `script` und `source` gehen (ebenso ein `svg` mit einem Element außerhalb von `SVG_TAGS`) auch mit
   *  dem Schalter. Ohne ihn verliert jedes Bild seine Quelle. */
  allowLocalImages?: boolean;
  /** Wird mit dem Entfernten gerufen, wenn ein Durchgang etwas herausgenommen hat (Diagnose, Zähler): erst das der Fernquellen, dann das der Link-Ziele, in einem Aufruf. */
  onRemoved?: (removed: RemovedResource[]) => void;
  /** Konstruktor des Observers; Default der `MutationObserver` des Fensters von `el`. Für Tests ohne DOM. */
  observer?: typeof MutationObserver;
}

export interface DomGuard {
  /** Ein Durchgang über den ganzen Container jetzt (zusätzlich zu den inkrementellen im Observer), z. B. nach dem Rendern. */
  run(): void;
  /** Holt die wartenden Mutationen ab (`observer.takeRecords()`) und fährt jetzt, SYNCHRON, einen Durchgang über die berührten Teilbäume (nicht über den ganzen Container). Vor jedes
   *  Layout-Lesen (`followTail`, `setTail`) legen: der Observer-Callback läuft als Mikroaufgabe erst danach, und das Layout
   *  stößt die Abrufe der Stil-Quellen an (gemessen in Obsidian 1.14.4, Task „dom-guard — takeRecords …“: 66 → 3 bis 4 von 139). */
  flush(): void;
  /** Trennt den Observer. Danach tut `run()` nichts mehr. */
  disconnect(): void;
}

/** Hängt den Observer an `el` — **vor** dem Rendern aufrufen. Sofort wird ein erster Durchgang gefahren,
 *  damit schon vorhandener Inhalt nicht auf die erste Änderung wartet. */
export function attachDomGuard(el: HTMLElement, opts: DomGuardOptions = {}): DomGuard {
  const MO = opts.observer ?? el.ownerDocument?.defaultView?.MutationObserver ?? (typeof window === "undefined" ? undefined : window.MutationObserver);
  if (!MO) throw new Error("domGuard braucht ein DOM mit MutationObserver — in Tests mit dem Fake-DOM `domGuard: false` übergeben.");
  let active = true;
  // Zwei Durchgänge über denselben Teilbaum: erst die Fernquellen (code-kit `remote-resources`), dann die Link-Ziele und aktiven Tags (code-kit `link-guard`).
  // Nur ein echtes `true` schaltet; ein Wurf in einem der beiden ist ein Wurf des Durchgangs (der Schreiber fällt dann auf `setText`, fail-closed).
  const links = { allowObsidianLinks: opts.allowObsidianLinks === true, allowLocalImages: opts.allowLocalImages === true };
  const neutralize = (root: ParentNode): void => {
    const remote = neutralizeRemoteResourcesInTree(root, opts.localSchemes ? { localSchemes: opts.localSchemes } : {}).removed;
    const unsafe = neutralizeUnsafeLinksInTree(root, links).removed;
    if (remote.length > 0 || unsafe.length > 0) opts.onRemoved?.([...remote, ...unsafe]);
  };
  const pass = (): void => {
    if (!active) return;
    neutralize(el);
  };
  // Inkrementell: nur die Teilbäume, die die Mutationen berührt haben. Ein Durchgang über den ganzen Body je Batch wäre über eine
  // Antwort hinweg quadratisch (jeder `push` ändert den Tail). Wurzeln: hinzugefügte Elemente, Elemente mit geänderten Attributen,
  // der Eltern-Knoten eines geänderten/hinzugefügten Textes (ein `<style>` liest den Text) — außer dem Container selbst.
  const passRecords = (records: readonly MutationRecord[]): void => {
    if (!active || records.length === 0) return;
    const roots = new Set<Element>();
    const addParent = (n: Node | null): void => { const pe = n?.parentElement; if (pe && pe !== el) roots.add(pe); };
    for (const r of records) {
      if (r.type === "attributes") { if (r.target.nodeType === 1 && r.target !== el) roots.add(r.target as Element); else if (r.target === el) { pass(); return; } }
      else if (r.type === "characterData") addParent(r.target);
      else for (const n of Array.from(r.addedNodes)) { if (n.nodeType === 1) roots.add(n as Element); else addParent(n); }
    }
    for (const root of roots) {
      if (!el.contains(root)) continue;   // schon entfernt
      let covered = false;
      for (let a = root.parentElement; a && a !== el; a = a.parentElement) if (roots.has(a)) { covered = true; break; }
      if (!covered) neutralize(root);
    }
  };
  const observer = new MO((records: MutationRecord[]) => passRecords(records));
  observer.observe(el, { childList: true, subtree: true, attributes: true, characterData: true });
  pass();
  return {
    run: pass,
    flush(): void { passRecords(observer.takeRecords()); },
    disconnect(): void { active = false; observer.disconnect(); },
  };
}

/** `p` gegen eine Frist: gibt nach `ms` auf, ohne zu werfen. Ein Fehler von `p` wird weitergereicht. */
export function settleWithin(p: Promise<unknown>, ms: number, clock: ClockPort = realClock): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = clock.setTimeout(resolve, ms);
    p.then(() => { clock.clearTimeout(timer); resolve(); }, (e: unknown) => { clock.clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))); });
  });
}

export interface RenderGuardedOptions extends DomGuardOptions {
  /** Frist für `render()`; Default `DOM_GUARD_DEADLINE_MS`. */
  deadlineMs?: number;
  clock?: ClockPort;
}

/**
 * `MarkdownRenderer.render` mit Observer: für Konsumenten, die Modell-Markdown selbst rendern und die
 * zweite Schicht brauchen (Hauptansicht, Verlauf, Notiz-Vorschau). Die Regex-Neutralisierung davor bleibt
 * Sache des Aufrufers (`neutralizeModelMarkdown`). Ein Fehler des Renderers wird weitergereicht; Observer
 * und Frist-Timer sind dann schon aufgeräumt.
 */
export async function renderMarkdownGuarded(
  app: App, markdown: string, el: HTMLElement, sourcePath: string, component: Component, opts: RenderGuardedOptions = {},
): Promise<void> {
  const guard = attachDomGuard(el, opts);
  try {
    await settleWithin(MarkdownRenderer.render(app, markdown, el, sourcePath, component), opts.deadlineMs ?? DOM_GUARD_DEADLINE_MS, opts.clock);
    guard.run();
  } finally {
    guard.disconnect();
  }
}
