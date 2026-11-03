// vendored from obsidian-kit@0.76.1, src/obsidian/model-bar.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/**
 * Modellzeile (UI-STANDARD § 8, neu in 0.67.0): eine Zeile, in der man sieht, welches Modell eine Aufgabe benutzt, und es wechselt — Dropdown mit den Modellen
 * des aktiven Endpunkts, „Anderer Endpunkt …“, Neu-laden-Knopf und optional die Denk-Steuerung. Läuft eigenständig in jeder Seitenleiste und im
 * Einschub `composer` des Kit-Chatfensters (`ChatWindowOptions.composer`, über dem Textfeld; bis 0.72.0 stand sie im Kopf).
 *
 * ## Aufbau seit 0.73.0
 *
 * Reihenfolge `[Modell][Warnzeichen][Denkstufe][Neu laden]`, **ohne sichtbare Beschriftung** (`label` steht im `aria-label`, `showLabel` holt sie zurück) und **einzeilig**:
 * die Wurzel ist ein Container (`container-type: inline-size`), die Elemente liegen in einer inneren Flex-Zeile ohne Umbruch. Bei Enge fällt zuerst das Gehirn-Symbol vor der
 * Denkstufe weg (Container unter 260 px), danach kürzt nur der Modellname. Die Denk-Steuerung ist in der Zeile immer das Dropdown mit den Stufen des Modells (`inModelBar`).
 *
 * ## Woher
 *
 * vault-rag `src/chat_view.ts` (Ursprung: Dropdown + Denk-Knopf in einer Zeile, ruft nur `deps.setModel`) mit der Datenseite aus `LlmConnection`
 * (`models()`, `setModel()`, `modelInUse()`; Ursprung `applyChatModel`/`chatModelInUse` in vault-rag `src/main.ts`). Sieben Plugins bauten die Zeile
 * selbst (vault-rag zweimal: Chat und Smart Apply, image-to-markdown, lingotuner, obsidian-transmute, 3d-codeblocks, slide-deck als Modal); jeder
 * Unterschied zwischen ihnen ist unten entschieden oder hat seinen Grund:
 *
 * - **Die Liste kommt aus `llm.models()`**, nicht aus einem Plugin-eigenen Client (vault-rag-Chat sprach den Client direkt an; Grund entfallen).
 * - **„Automatisch“ steht immer da** (Wert `""`, Text mit dem Standard-Modell, wenn der Endpunkt eines nennt). Nur lingotuner und transmute hatten den
 *   Eintrag; `setModel("")` leert die Wahl ohnehin, ein Weg zurück zum Default darf nicht davon abhängen, ob schon etwas gewählt ist.
 * - **Ein gewähltes, nicht gelistetes Modell wird markiert und bleibt** (`resolveModelChoice`, Zusatz „gespeichert“). image-to-markdown glich es still
 *   an (`models[0]`); das war Drift ohne Grund und fällt weg: der Baustein ändert nie ein Modell, das der Nutzer nicht gewählt hat.
 * - **Neu laden gibt es immer** (vault-rag und slide-deck hatten ihn nicht) und quittiert den Klick: Ladezustand am Knopf, Ansage der Zahl
 *   (`aria-live`, image-to-markdown zeigte sie in einer Statuszeile, die anderen Eigenbauten quittierten gar nicht).
 * - **Name am Dropdown ist Pflicht** (`aria-label`, CORE-META-20): fünf der sieben Eigenbauten hatten keinen.
 * - **`disabled()` sperrt die Zeile während eines Laufs** (lingotuner tat es allein, ein Wechsel mitten im Stream ist überall sinnlos).
 * - **Ein Wurf aus `setModel` ist nie still** (`onError`, Ansage, Dropdown zeigt wieder das Modell, das wirklich gilt); nur 3d-codeblocks fing ihn.
 * - **Der Denk-Knopf zeichnet sich nach einem Modellwechsel selbst neu** (die Familie, und damit „aus nicht möglich“, hängt am Modell).
 * - **Eigene Klassen `okit-model-bar*` und eine `MODEL_BAR_CSS`** statt je Plugin ein Präfix und eine Regelgruppe.
 *
 * ## „Anderer Endpunkt …“
 *
 * Der letzte Eintrag der Liste öffnet die Endpunkt-Auswahl, **wählt kein Modell** und ändert den Endpunkt nie still: nach der Wahl springt das
 * Dropdown auf das Modell zurück, das gilt. `onOtherEndpoint` fehlt → Default `openEndpointManagerSettings(app)`, solange der Manager erreichbar ist
 * (ohne Manager gäbe es nichts zu öffnen, der Eintrag fehlt dann); eine Funktion ersetzt ihn (etwa den eigenen Settings-Tab); `null` blendet ihn immer
 * aus. **Heute öffnet der Eintrag also den Manager-Tab und keinen eigenen Dialog:** `LlmConnection` hat keinen Endpunkt-Setter und kein Modal listet
 * `api.list()`; ein Auswahl-Dialog im Kit ist ein eigener Auftrag.
 *
 * ## Fallen beim Übernehmen
 *
 * 1. **Das Kit injiziert kein CSS.** `MODEL_BAR_CSS` (und `THINKING_CONTROL_CSS`, wenn `thinking` gesetzt ist) gehört in die `styles.css` des Consumers.
 * 2. **Mehrere Aufgaben mit eigenem Modell = mehrere Zeilen.** `llm` ist das eigene Interface `ModelBarConnection` (eine `LlmConnection` passt hinein, die Zeile braucht sie nicht); eine Aufgabe, deren
 *    Modell anderswo gespeichert wird (vault-rag Smart Apply: `smartApplyModel`), reicht einen Adapter mit denselben vier Methoden. Jede Zeile bekommt
 *    ein `label` (sichtbarer Aufgabenname, auch Teil des `aria-label`).
 *    **Wer die Liste nach einem Laden braucht, baut keinen Adapter um `llm.models()` mehr:** `onRefreshed(result)` (seit 0.71.0) meldet jedes abgeschlossene Laden (das erste beim Bauen, den Neu-laden-Knopf, `refresh()`).
 * 3. **Das Kit weiß nicht, wann sich die Einstellungen ändern.** Ändert sich Modell oder Endpunkt außerhalb der Zeile (Settings-Tab, Manager),
 *    ruft das Plugin `update()` (zeichnet aus dem Zustand neu) oder `refresh()` (lädt die Liste neu). Hängt es das an `onResolved` der
 *    Verbindung, gilt seit 0.70.0: `llm.models()` (und damit `refresh()`) meldet über `onResolved` nur noch eine Änderung, ein Rückruf, der
 *    `models()` ruft, läuft nicht mehr im Kreis. Trotzdem nur neu zeichnen, wenn sich das Ergebnis geändert hat.
 * 4. **Im Einschub des Chatfensters** (`composer`, früher `header`) zeichnen `win.refresh()` und `win.refreshComposer()` die Zeile neu: der Einschub baut dann eine neue Zeile. Die alte gibt der
 *    Einschub über seine Rückgabe frei (seit 0.70.0: `composer: (el) => { const bar = buildModelBar(…); return () => { bar.destroy(); }; }`, das Fenster ruft sie vor
 *    der nächsten Zeichnung und bei `destroy()`); `disabled: () => win.running()` mit `onRunChange: () => { bar.update(); }` sperrt die Zeile während eines Laufs.
 *    **Der Einschub `composer` ist im Leerzustand des Wirts (`empty.when()`) unsichtbar**, der Kopf war es nie: ein Wirt, der die Zeile dort braucht, setzt `empty` entsprechend.
 * 5. **Die Zeile braucht Breite.** Ein Container ohne eigene Breite fällt in einem Eltern-Element mit `display: flex` (Reihe) auf null: die Wurzel trägt `width: 100%` (`MODEL_BAR_CSS`).
 */

import { setIcon, type App } from "obsidian";
import { resolveModelChoice } from "../kit/model-choice";
import type { ModelListResult } from "../kit/model-list-cache";
import { findEndpointManager, openEndpointManagerSettings } from "./endpoint-source";
import { resolveModelBarStrings, type ModelBarStringsOverride } from "./model-bar-strings";
import { buildThinkingControl, type ThinkingControlOptions } from "./thinking-control";

/** Die vier Methoden, die die Zeile braucht. Ein eigenes Interface, kein `Pick` von `LlmConnection` (seit 0.70.0): eine `LlmConnection` ist dem Typ zuweisbar, ein
 *  Adapter genügt (andere Einstellung, gleiche Form), und wer die Zeile vendort, nimmt die Kette von `llm-connection` nicht mit (zehn statt 28 Kit-Module). */
export interface ModelBarConnection {
  /** Die Modelle des aktiven Endpunkts; `force` lädt neu. */
  models(opts?: { force?: boolean }): Promise<ModelListResult>;
  /** Wählt das Modell (`""` = automatisch); wirft, wenn es sich nicht übernehmen lässt. */
  setModel(model: string): Promise<void>;
  /** Das Modell, das jetzt gilt. */
  modelInUse(): string;
  /** Vom Endpunkt gemeldet: das Standard-Modell (für „Automatisch (qwen …)“). Seit 0.73.0 liest die Zeile für die Stufenliste der Denk-Steuerung auch `model` (der Auswahlname) und `sentModel`
   *  (der Name auf dem Draht, nach Alias): die Tabelle von code-kit kennt Namen, keine Aliase des Managers. Eine `LlmConnection` liefert beides; ein Adapter darf sie weglassen. */
  source(): { defaultModel?: string; model?: string; sentModel?: string };
}

export interface ModelBarOptions {
  app: App;
  containerEl: HTMLElement;
  llm: ModelBarConnection;
  /** Name der Aufgabe („Chat“, „Smart Apply“): im `aria-label` des Dropdowns („Modell für Chat“), seit 0.73.0 nur noch dort. Ohne: nur „Modell“. */
  label?: string;
  /** Seit 0.73.0, Standard `false`: zeigt `label` zusätzlich sichtbar vor dem Dropdown. Für Ansichten mit mehreren Modellzeilen, deren Zeilen sich sichtbar unterscheiden müssen
   *  (UI-STANDARD § 8: jede Aufgabe eine eigene Zeile). Ohne `label` zeichnet es nichts. */
  showLabel?: boolean;
  strings?: ModelBarStringsOverride;
  /** Öffnet die Endpunkt-Auswahl. Fehlt sie: `openEndpointManagerSettings(app)`, solange ein Manager erreichbar ist, sonst kein Eintrag. `null`: nie ein Eintrag. */
  onOtherEndpoint?: (() => void) | null;
  /** Die Denk-Steuerung in derselben Zeile (kein zweiter Knopf): dieselben Optionen wie `buildThinkingControl`, ohne `containerEl`. Seit 0.73.0 immer als Dropdown mit den Stufen des Modells
   *  (`levelPicker` gilt hier nicht, die Zeile setzt `inModelBar`); `model` setzt die Zeile selbst (gesendetes Modell), ein Wert des Wirts gewinnt. */
  thinking?: Omit<ThinkingControlOptions, "containerEl">;
  /** `true` sperrt Dropdown, Neu-laden-Knopf und die Bedienelemente der Denk-Steuerung (während eines Laufs). Wirkt beim Zeichnen und bei `update()`. */
  disabled?: () => boolean;
  /** Nach einem erfolgreichen Wechsel. */
  onChange?: (model: string) => void;
  /** Nach jedem abgeschlossenen `refresh()` mit einem Ergebnis (seit 0.71.0): dem ersten Laden beim Bauen, dem Neu-laden-Knopf und `bar.refresh()`, auch bei einem nicht erreichbaren
   *  Endpunkt (`reachable: false`). Die Zeile ist dann schon gezeichnet und angesagt. Kommt **nicht**, wenn `models()` wirft (es gibt kein Ergebnis, der Wurf geht an `onError`), nicht für
   *  einen überholten Lauf (nur der neueste meldet, nie eine veraltete Liste) und nicht nach `destroy()`. Ein Wurf des Rückrufs geht an `onError`. Für Wirte, die neben der Zeile etwas
   *  aus der Liste zeichnen (image-to-markdown: das Status-Icon „Modell geladen“) und dafür bisher einen Adapter um `llm.models()` bauten. Ohne die Option ändert sich nichts. */
  onRefreshed?: (result: ModelListResult) => void;
  /** Würfe aus `models()`, `setModel` und `onOtherEndpoint`. Ohne: die Zeile bleibt stehen, die Ansage nennt nur den Wechsel-Fehler. */
  onError?: (error: unknown) => void;
  /** Zusätzliche Klasse an der Wurzel. */
  cls?: string;
}

export interface ModelBar {
  readonly rootEl: HTMLElement;
  /** Lädt die Modell-Liste neu und zeichnet sie. `force` fragt den Endpunkt (nicht den Cache) und sagt das Ergebnis an. */
  refresh(opts?: { force?: boolean }): Promise<void>;
  /** Zeichnet Dropdown, Sperre und Denk-Steuerung aus dem Zustand neu (ohne Abruf). */
  update(): void;
  /** Meldet die Zeile ab: spätere Ergebnisse zeichnen nichts mehr, die Wurzel wird entfernt. */
  destroy(): void;
}

/** Wert des Aktionseintrags. Kein Modellname kann so heißen (Steuerzeichen). */
const OTHER_ENDPOINT = "\u0001okit-other-endpoint";

export function buildModelBar(opts: ModelBarOptions): ModelBar {
  const st = resolveModelBarStrings(opts.strings);
  const { llm } = opts;
  const root = opts.containerEl.createDiv({ cls: opts.cls ? `okit-model-bar ${opts.cls}` : "okit-model-bar" });
  // Die Elemente liegen in einer inneren Zeile: ein `@container` stylt nie den Container selbst (MODEL_BAR_CSS).
  const rowEl = root.createDiv({ cls: "okit-model-bar-row" });
  if (opts.showLabel === true && opts.label !== undefined) rowEl.createSpan({ cls: "okit-model-bar-label", text: opts.label });
  const select = rowEl.createEl("select", { cls: "dropdown okit-model-bar-select" });
  select.setAttribute("aria-label", opts.label !== undefined ? st.modelFor(opts.label) : st.model);
  // Das Zeichen für „Endpunkt antwortet nicht“ / „keine Liste“: Form und Text, nicht nur Farbe (CORE-META-20); der Hinweis steht auch am Dropdown.
  const warnEl = rowEl.createSpan({ cls: "okit-model-bar-warn is-hidden", attr: { role: "img" } });
  setIcon(warnEl, "alert-triangle");
  /** Das Modell, dessen Stufen die Denk-Steuerung anbietet: das gesendete, sonst der Auswahlname. `sentModel` und `model` der Quelle gehören zusammen; hat die Wahl der Zeile sie überholt
   *  (`setModel` läuft noch, oder ein Adapter wählt anderswo), gilt `modelInUse()`. „Automatisch“ (leer) heißt: das Standard-Modell des Endpunkts. */
  const modelForLevels = (): string => {
    const src = llm.source();
    const inUse = llm.modelInUse();
    const sameChoice = inUse === "" || inUse === src.model;
    return ((sameChoice ? src.sentModel : "") || inUse || src.model || src.defaultModel || "").trim();
  };
  const thinkCtl = opts.thinking ? buildThinkingControl({ model: modelForLevels, ...opts.thinking, containerEl: rowEl, inModelBar: true }) : null;
  const refreshBtn = rowEl.createEl("button", { cls: "clickable-icon okit-model-bar-refresh", attr: { type: "button", "aria-label": st.refresh } });
  setIcon(refreshBtn, "refresh-cw");
  const statusEl = root.createSpan({ cls: "okit-model-bar-status", attr: { role: "status", "aria-live": "polite" } });

  let list: ModelListResult | null = null;
  let seq = 0;
  let destroyed = false;

  const report = (error: unknown): void => { try { opts.onError?.(error); } catch { /* ein Fehler des Konsumenten stört die Zeile nicht */ } };
  const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

  /** Der Aktionseintrag: Funktion → sie; `undefined` → Manager-Tab, wenn ein Manager da ist (jedes Zeichnen frisch gelesen); sonst keiner. */
  const otherEndpoint = (): (() => void) | null => {
    if (opts.onOtherEndpoint === null) return null;
    if (opts.onOtherEndpoint !== undefined) return opts.onOtherEndpoint;
    return findEndpointManager(opts.app) ? () => { openEndpointManagerSettings(opts.app); } : null;
  };

  const entries = (current: string): Array<{ value: string; label: string }> => {
    const auto = opts.llm.source().defaultModel ? st.automaticWith(opts.llm.source().defaultModel as string) : st.automatic;
    const text = (value: string, label: string, saved: boolean): string => (value === "" ? auto : saved ? `${label} ${st.savedSuffix}` : label);
    if (list === null) return [{ value: current, label: text(current, current, false) }];
    const c = resolveModelChoice({ reachable: list.reachable, models: list.models, current, allowEmpty: true });
    if (c.mode === "freetext") {
      // Der Endpunkt antwortet, gibt aber keine Liste heraus: Automatisch und das gespeicherte Modell.
      return [{ value: "", label: auto }, ...(c.value !== "" ? [{ value: c.value, label: c.value }] : [])];
    }
    return c.options.map((o) => ({ value: o.value, label: text(o.value, o.label, o.suffix === "saved") }));
  };

  const applyDisabled = (): void => {
    const off = opts.disabled?.() === true;
    select.disabled = off;
    refreshBtn.disabled = off;
    if (off) root.querySelectorAll("button, select").forEach((el) => { (el as HTMLButtonElement | HTMLSelectElement).disabled = true; });
  };

  const draw = (): void => {
    const current = llm.modelInUse();
    select.empty();
    for (const e of entries(current)) select.createEl("option", { text: e.label, attr: { value: e.value } });
    if (otherEndpoint() !== null) select.createEl("option", { text: st.otherEndpoint, attr: { value: OTHER_ENDPOINT } });
    select.value = current;
    const hint = list === null ? "" : !list.reachable ? st.hintUnreachable : list.models.length === 0 ? st.hintNoList : "";
    // Der Tooltip trägt den Hinweis, sonst seit 0.74.0 den vollen Namen des gewählten Modells: im kompakten Composer ist das Dropdown schmal und kürzt den Namen mit Auslassung.
    const shown = entries(current).find((e) => e.value === current)?.label ?? "";
    const tip = hint !== "" ? hint : shown;
    if (tip !== "") select.setAttribute("title", tip); else select.removeAttribute("title");
    warnEl.toggleClass("is-hidden", hint === "");
    if (hint !== "") { warnEl.setAttribute("aria-label", hint); warnEl.setAttribute("title", hint); } else { warnEl.removeAttribute("aria-label"); warnEl.removeAttribute("title"); }
    applyDisabled();
  };

  const redraw = (): void => { draw(); thinkCtl?.refresh(); applyDisabled(); };

  const setLoading = (on: boolean): void => {
    refreshBtn.toggleClass("is-loading", on);
    if (on) refreshBtn.setAttribute("aria-busy", "true"); else refreshBtn.removeAttribute("aria-busy");
  };

  async function refresh(o?: { force?: boolean }): Promise<void> {
    const mine = ++seq;
    const force = o?.force === true;
    setLoading(true);
    let result: ModelListResult | null = null;
    try {
      result = await llm.models(force ? { force: true } : undefined);
    } catch (e) {
      if (destroyed || mine !== seq) return;
      report(e);
    }
    if (destroyed || mine !== seq) return;
    setLoading(false);
    if (result !== null) list = result;
    redraw();   // nach der Auflösung kennt die Verbindung Familie und Backend: auch der Denk-Knopf zeichnet neu
    if (force && result !== null) statusEl.setText(result.reachable ? st.loaded(result.models.length) : st.notReachable);
    if (result !== null) { try { opts.onRefreshed?.(result); } catch (e) { report(e); } }
  }

  async function pick(value: string): Promise<void> {
    let ok = false;
    try {
      await llm.setModel(value);
      ok = true;
    } catch (e) {
      if (!destroyed) { statusEl.setText(st.setFailed(message(e))); report(e); }
    }
    if (destroyed) return;
    redraw();
    if (ok) { try { opts.onChange?.(value); } catch (e) { report(e); } }
  }

  select.addEventListener("change", () => {
    const value = select.value;
    if (value === OTHER_ENDPOINT) {
      select.value = llm.modelInUse();   // der Eintrag wählt kein Modell: die Anzeige bleibt beim geltenden
      try { otherEndpoint()?.(); } catch (e) { report(e); }
      return;
    }
    void pick(value);
  });
  refreshBtn.addEventListener("click", () => { void refresh({ force: true }); });

  redraw();
  void refresh();

  return {
    rootEl: root,
    refresh,
    update: redraw,
    destroy(): void { destroyed = true; root.remove(); },
  };
}

/** Gehört in die `styles.css` des Consumers — das Kit injiziert kein CSS (Muster `THINKING_CONTROL_CSS`). Nur Theme-Variablen.
 *
 *  Seit 0.73.0 bleibt die Zeile einzeilig. Die Wurzel ist ein benannter Container (`container-type: inline-size`, `width: 100%`: ohne eigene Breite fiele sie in einer
 *  Flex-Reihe auf null), die Elemente liegen in der inneren Zeile `okit-model-bar-row` (eine Container-Abfrage stylt nie den Container selbst). Rangfolge bei Enge (seit 0.76.0): unter 260 px
 *  Containerbreite schrumpft die Denkstufe auf ihr Zeichen (der Eintrag beginnt mit ihm, das geschlossene Dropdown wird beschnitten; Liste und Name tragen den vollen Namen, `thinkingLevelGlyph`), das Symbol davor bleibt (mit `.okit-model-bar` und `select` davor: die Regel muss `.okit-thinking-control select` aus `THINKING_CONTROL_CSS` schlagen, die Reihenfolge der kopierten Konstanten ist egal), danach kürzt nur der Modellname (Mindestbreite 6 em, Auslassung); Warnzeichen und Neu laden behalten ihre Breite.
 *  Erst unter dem Soll-Bereich bricht die Zeile um, als Netz, damit nie ein Bedienelement überläuft. Die Bereichssyntax trifft auch gebrochene Breiten (259,5 px).
 *  Die Ansage ist für Augen unsichtbar, aber nicht `display: none` (ein Screenreader läse sie sonst nicht). Der Ladezustand dreht das Symbol; `prefers-reduced-motion`
 *  hält es an. Herkunft der Maße: vault-rag `styles.css` (`vault-rag-chat-model-row`), lingotuner (`lt-model`, `lt-model-refresh`). */
export const MODEL_BAR_CSS = `
.okit-model-bar { position: relative; width: 100%; min-width: 0; container-type: inline-size; container-name: okit-model-bar; }
.okit-model-bar-row { display: flex; flex-wrap: nowrap; align-items: center; gap: var(--size-2-2) var(--size-4-1); min-width: 0; }
.okit-model-bar-label { flex: 0 0 auto; color: var(--text-muted); font-size: var(--font-ui-small); white-space: nowrap; }
.okit-model-bar-select { flex: 1 1 auto; min-width: 6em; max-width: 100%; font-size: var(--font-ui-small); text-overflow: ellipsis; }
.okit-model-bar select:disabled { opacity: 0.6; cursor: not-allowed; }
.okit-model-bar-warn { flex: 0 0 auto; display: inline-flex; color: var(--text-warning); }
.okit-model-bar-warn.is-hidden { display: none; }
.okit-model-bar-warn svg { width: var(--icon-xs); height: var(--icon-xs); }
.okit-model-bar-refresh { flex: 0 0 auto; }
/* Tippfläche auf Mobil (44 px, das Symbol bleibt klein): gemessen 30 × 26 ohne diese Regel. */
.is-mobile button.clickable-icon.okit-model-bar-refresh { min-width: calc(var(--size-4-10) + var(--size-4-1)); min-height: calc(var(--size-4-10) + var(--size-4-1)); display: inline-flex; align-items: center; justify-content: center; }
.okit-model-bar-refresh:disabled { opacity: 0.4; cursor: not-allowed; }
.okit-model-bar-refresh svg { width: var(--icon-xs); height: var(--icon-xs); }
.okit-model-bar-refresh.is-loading svg { animation: okit-model-bar-spin 1s linear infinite; }
@keyframes okit-model-bar-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .okit-model-bar-refresh.is-loading svg { animation: none; } .okit-model-bar-refresh.is-loading { opacity: 0.5; } }
.okit-model-bar .okit-thinking-control { flex: 0 0 auto; }
@container okit-model-bar (width < 260px) { .okit-model-bar .okit-thinking-control select { width: calc(var(--size-2-3) + var(--size-4-6) + 1.2em); min-width: 0; padding-inline: var(--size-2-3) var(--size-4-6); text-overflow: clip; } }
@container okit-model-bar (width < 200px) { .okit-model-bar-row { flex-wrap: wrap; } }
.okit-model-bar-status { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; overflow: hidden; white-space: nowrap; }
`;
