// vendored from obsidian-kit@0.70.0, src/obsidian/model-bar.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/**
 * Modellzeile (UI-STANDARD § 8, neu in 0.67.0): eine Zeile, in der man sieht, welches Modell eine Aufgabe benutzt, und es wechselt — Dropdown mit den Modellen
 * des aktiven Endpunkts, „Anderer Endpunkt …“, Neu-laden-Knopf und optional die Denk-Steuerung. Läuft eigenständig in jeder Seitenleiste und im
 * Kopfzeilen-Einschub des Kit-Chatfensters (`ChatWindowOptions.header`).
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
 * 3. **Das Kit weiß nicht, wann sich die Einstellungen ändern.** Ändert sich Modell oder Endpunkt außerhalb der Zeile (Settings-Tab, Manager),
 *    ruft das Plugin `update()` (zeichnet aus dem Zustand neu) oder `refresh()` (lädt die Liste neu). Hängt es das an `onResolved` der
 *    Verbindung, gilt seit 0.70.0: `llm.models()` (und damit `refresh()`) meldet über `onResolved` nur noch eine Änderung, ein Rückruf, der
 *    `models()` ruft, läuft nicht mehr im Kreis. Trotzdem nur neu zeichnen, wenn sich das Ergebnis geändert hat.
 * 4. **Im Kopf des Chatfensters** zeichnen `win.refresh()` und `win.refreshHeader()` die Kopfzeile neu: der Einschub baut dann eine neue Zeile. Die alte gibt der
 *    Einschub über seine Rückgabe frei (seit 0.70.0: `header: (el) => { const bar = buildModelBar(…); return () => { bar.destroy(); }; }`, das Fenster ruft sie vor
 *    der nächsten Zeichnung und bei `destroy()`); `disabled: () => win.running()` mit `onRunChange: () => { bar.update(); }` sperrt die Zeile während eines Laufs.
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
  /** Vom Endpunkt gemeldet: das Standard-Modell (für „Automatisch (qwen …)“). Mehr liest die Zeile nicht. */
  source(): { defaultModel?: string };
}

export interface ModelBarOptions {
  app: App;
  containerEl: HTMLElement;
  llm: ModelBarConnection;
  /** Name der Aufgabe („Chat“, „Smart Apply“): sichtbar vor dem Dropdown und im `aria-label` („Modell für Chat“). Ohne: nur „Modell“. */
  label?: string;
  strings?: ModelBarStringsOverride;
  /** Öffnet die Endpunkt-Auswahl. Fehlt sie: `openEndpointManagerSettings(app)`, solange ein Manager erreichbar ist, sonst kein Eintrag. `null`: nie ein Eintrag. */
  onOtherEndpoint?: (() => void) | null;
  /** Die Denk-Steuerung in derselben Zeile (kein zweiter Knopf): dieselben Optionen wie `buildThinkingControl`, ohne `containerEl`. */
  thinking?: Omit<ThinkingControlOptions, "containerEl">;
  /** `true` sperrt Dropdown, Neu-laden-Knopf und die Bedienelemente der Denk-Steuerung (während eines Laufs). Wirkt beim Zeichnen und bei `update()`. */
  disabled?: () => boolean;
  /** Nach einem erfolgreichen Wechsel. */
  onChange?: (model: string) => void;
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
  if (opts.label !== undefined) root.createSpan({ cls: "okit-model-bar-label", text: opts.label });
  const select = root.createEl("select", { cls: "dropdown okit-model-bar-select" });
  select.setAttribute("aria-label", opts.label !== undefined ? st.modelFor(opts.label) : st.model);
  // Das Zeichen für „Endpunkt antwortet nicht“ / „keine Liste“: Form und Text, nicht nur Farbe (CORE-META-20); der Hinweis steht auch am Dropdown.
  const warnEl = root.createSpan({ cls: "okit-model-bar-warn is-hidden", attr: { role: "img" } });
  setIcon(warnEl, "alert-triangle");
  const refreshBtn = root.createEl("button", { cls: "clickable-icon okit-model-bar-refresh", attr: { type: "button", "aria-label": st.refresh } });
  setIcon(refreshBtn, "refresh-cw");
  const thinkCtl = opts.thinking ? buildThinkingControl({ containerEl: root, ...opts.thinking }) : null;
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
    if (off) root.querySelectorAll(".okit-thinking-control button, .okit-thinking-control select").forEach((el) => { (el as HTMLButtonElement | HTMLSelectElement).disabled = true; });
  };

  const draw = (): void => {
    const current = llm.modelInUse();
    select.empty();
    for (const e of entries(current)) select.createEl("option", { text: e.label, attr: { value: e.value } });
    if (otherEndpoint() !== null) select.createEl("option", { text: st.otherEndpoint, attr: { value: OTHER_ENDPOINT } });
    select.value = current;
    const hint = list === null ? "" : !list.reachable ? st.hintUnreachable : list.models.length === 0 ? st.hintNoList : "";
    if (hint !== "") select.setAttribute("title", hint); else select.removeAttribute("title");
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
 *  Die Zeile bricht um (`flex-wrap`), damit der Denk-Knopf in einer schmalen Seitenleiste unter das Dropdown rutscht, statt es auf null zu drücken; das
 *  Dropdown darf schrumpfen (`min-width: 0`) und kürzt einen langen Modellnamen mit Auslassung. Die Ansage ist für Augen unsichtbar, aber nicht
 *  `display: none` (ein Screenreader läse sie sonst nicht). Der Ladezustand dreht das Symbol; `prefers-reduced-motion` hält es an. Herkunft der
 *  Maße: vault-rag `styles.css` (`vault-rag-chat-model-row`), lingotuner (`lt-model`, `lt-model-refresh`). */
export const MODEL_BAR_CSS = `
.okit-model-bar { position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: var(--size-2-2) var(--size-4-1); min-width: 0; }
.okit-model-bar-label { flex: 0 0 auto; color: var(--text-muted); font-size: var(--font-ui-small); white-space: nowrap; }
.okit-model-bar select { flex: 1 1 12em; min-width: 0; max-width: 100%; font-size: var(--font-ui-small); text-overflow: ellipsis; }
.okit-model-bar select:disabled { opacity: 0.6; cursor: not-allowed; }
.okit-model-bar-warn { flex: 0 0 auto; display: inline-flex; color: var(--text-warning); }
.okit-model-bar-warn.is-hidden { display: none; }
.okit-model-bar-warn svg { width: var(--icon-xs); height: var(--icon-xs); }
.okit-model-bar-refresh { flex: 0 0 auto; }
.okit-model-bar-refresh:disabled { opacity: 0.4; cursor: not-allowed; }
.okit-model-bar-refresh svg { width: var(--icon-xs); height: var(--icon-xs); }
.okit-model-bar-refresh.is-loading svg { animation: okit-model-bar-spin 1s linear infinite; }
@keyframes okit-model-bar-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .okit-model-bar-refresh.is-loading svg { animation: none; } .okit-model-bar-refresh.is-loading { opacity: 0.5; } }
.okit-model-bar .okit-thinking-control { flex: 0 0 auto; }
.okit-model-bar-status { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; overflow: hidden; white-space: nowrap; }
`;
