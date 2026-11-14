// vendored from obsidian-kit@0.89.0, src/obsidian/model-bar.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/**
 * Modellzeile (UI-STANDARD § 8, neu in 0.67.0): eine Zeile, in der man sieht, welches Modell eine Aufgabe benutzt, und es wechselt — Dropdown mit den Modellen
 * des aktiven Endpunkts (seit 0.87.0 aller Endpunkte, gruppiert), „Endpunkte verwalten …“, Neu-laden-Knopf und optional die Denk-Steuerung. Läuft eigenständig in jeder Seitenleiste und im
 * Einschub `composer` des Kit-Chatfensters (`ChatWindowOptions.composer`, über dem Textfeld; bis 0.72.0 stand sie im Kopf).
 *
 * ## Aufbau seit 0.73.0
 *
 * Reihenfolge `[Modell][Warnzeichen][Denkstufe][Neu laden]`, **ohne sichtbare Beschriftung** (`label` steht im `aria-label`, `showLabel` holt sie zurück) und **einzeilig**:
 * die Wurzel ist ein Container (`container-type: inline-size`), die Elemente liegen in einer inneren Flex-Zeile ohne Umbruch. Bei Enge schrumpft zuerst die Denkstufe auf ihr Zeichen
 * (Container unter 340 px, seit 0.77.1), danach kürzt nur der Modellname. Die Denk-Steuerung ist in der Zeile immer das Dropdown mit den Stufen des Modells (`inModelBar`).
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
 * ## Gruppen nach Endpunkt (seit 0.87.0, Welle 33)
 *
 * Liefert die Verbindung Endpunkte (`llm.endpoints()` nicht leer: eine `LlmConnection` mit Manager), zeigt das Dropdown **alle Modelle aller Endpunkte**, gruppiert nach Endpunkt: oben „Automatisch“ (Wert `""`, mit Endpunkt und
 * Standard-Modell, solange die Wahl leer oder verwaist ist), je Endpunkt eine `<optgroup>` („Standard (…)“ legt nur den Endpunkt fest, die Modelle, gesperrte Hinweise in Text), zuletzt „Endpunkte verwalten …“. Natives `<select>`:
 * Tastatur, Tippsuche und die Auswahlliste am Handy kommen von Obsidian und dem System. Ohne Endpunkte (Adapter ohne Manager) bleibt die Zeile eine Liste ohne Gruppen wie vor 0.87.0.
 *
 * - **Eine Wahl legt Endpunkt UND Modell für dieses Plugin fest** (`llm.setChoice({ endpointId, model })`), nie das Modell eines anderen Plugins; der Endpunkt wechselt nur, weil der Nutzer ein Modell unter einem anderen Endpunkt gewählt hat. Der Wert eines
 *   Eintrags trägt Endpunkt und Modell (ein Modellname ist nur je Endpunkt eindeutig; die Kennung steht URI-kodiert, das Trennzeichen kann in keinem Namen vorkommen).
 * - **Ein Endpunkt, der nicht antwortet, verschwindet nicht:** seine Gruppe bleibt mit einem gesperrten Eintrag („nicht erreichbar“, bei leerer Liste „keine Modelle gemeldet“, solange der Manager Offline nicht von „keine Liste“ trennt; ein Manager mit `modelList` trennt es: dann zeigt ein gestoppter Endpunkt „nicht erreichbar“ statt einer leeren Liste), „Standard (…)“ bleibt wählbar.
 *   Ein gewähltes, nicht gelistetes Modell bleibt gewählt, markiert „(gespeichert)“.
 * - **Laden:** der aktive Endpunkt zuerst (`llm.models()`, wie bisher), danach die übrigen parallel im Hintergrund (`llm.modelsOf(id)`); jede Gruppe zeichnet, sobald ihre Liste da ist, ein hängender Host hält nur seine Gruppe auf „lädt …“. Neu laden holt alle mit `force`.
 *   `onRefreshed` meldet weiter einmal je Laden das Ergebnis des aktiven Endpunkts.
 * - **Verwaiste Wahl** (der festgelegte Endpunkt ist abgeschaltet, gelöscht oder ohne Schlüssel): die Zeile zeigt „Automatisch“ mit Warnzeichen und dem Grund im Tooltip; die gespeicherte Wahl bleibt unangetastet. Eine **Alt-Wahl** `{ model }` ohne Endpunkt steht in der Gruppe des automatischen Endpunkts
 *   („gilt für den automatischen Endpunkt“) und wird nie still umgeschrieben; jede neue Wahl bindet den Endpunkt.
 * - **Der geschlossene Zustand** zeigt nur den Modellnamen (bei „Standard“ „Standard (<Modell>)“); Endpunkt und voller Name stehen im Tooltip („<Modell> — <Endpunkt>“).
 * - **Kein Nachzeichnen in die offene Liste:** trifft etwas ein, während das Dropdown Fokus hat, zeichnet die Zeile erst bei `blur` oder bei `pointerdown` (nach einer Wahl behält das Dropdown den Fokus). Die Wahl des Nutzers und `update()` zeichnen sofort.
 *
 * ## „Endpunkte verwalten …“ (bis 0.86.0 „Anderer Endpunkt …“)
 *
 * Der letzte Eintrag der Liste öffnet die Einstellungen des Managers (Anlegen, Token, Reparieren), **wählt nichts** und ändert den Endpunkt nie: nach der Wahl springt das Dropdown auf die geltende Wahl zurück. `onOtherEndpoint` fehlt → Default `openEndpointManagerSettings(app)`,
 * solange der Manager erreichbar ist (ohne Manager gäbe es nichts zu öffnen, der Eintrag fehlt dann); eine Funktion ersetzt ihn; `null` blendet ihn immer aus.
 *
 * ## Fallen beim Übernehmen
 *
 * 1. **Das Kit injiziert kein CSS.** `MODEL_BAR_CSS` (und `THINKING_CONTROL_CSS`, wenn `thinking` gesetzt ist) gehört in die `styles.css` des Consumers.
 * 2. **Mehrere Aufgaben mit eigenem Modell = mehrere Zeilen.** `llm` ist das eigene Interface `ModelBarConnection` (eine `LlmConnection` passt hinein, die Zeile braucht sie nicht); eine Aufgabe, deren
 *    Modell anderswo gespeichert wird (vault-rag Smart Apply: `smartApplyModel`), reicht einen Adapter mit denselben zehn Methoden (ohne Manager-Anbindung `endpoints()` mit `[]`). Jede Zeile bekommt
 *    ein `label` (sichtbarer Aufgabenname, auch Teil des `aria-label`).
 *    **Wer die Liste nach einem Laden braucht, baut keinen Adapter um `llm.models()` mehr:** `onRefreshed(result)` (seit 0.71.0) meldet jedes abgeschlossene Laden (das erste beim Bauen, den Neu-laden-Knopf, `refresh()`).
 * 3. **Die Zeile folgt Änderungen selbst (seit 0.87.0).** Sie abonniert `llm.subscribe` (an denselben Stellen wie `onResolved`: nach `resolve()`, `setModel()`, `setChoice()`; bei `models()` nur nach einer Änderung) und den Manager (`onEndpointManagerChanged`), zeichnet ohne Netz neu (auch die Stufenwahl)
 *    und lädt Listen nur für einen neuen aktiven oder neuen Endpunkt; `destroy()` meldet beide ab. **Beide Rückrufe rufen nie `resolve()`** (Kreis, Befund settings-assistant). Eine `onResolved`-Anbindung des Plugins, die nur die Zeile neu zeichnet, ist damit entbehrlich (vorher prüfen, ob sie anderes zeichnet).
 *    Bis 0.86.0 musste das Plugin `update()` oder `refresh()` selbst rufen (Befund lingotuner, 0.77.1); das bleibt möglich (`update()` zeichnet sofort, auch bei Fokus).
 * 4. **Im Einschub des Chatfensters** (`composer`, früher `header`) zeichnen `win.refresh()` und `win.refreshComposer()` die Zeile neu: der Einschub baut dann eine neue Zeile. Die alte gibt der
 *    Einschub über seine Rückgabe frei (seit 0.70.0: `composer: (el) => { const bar = buildModelBar(…); return () => { bar.destroy(); }; }`, das Fenster ruft sie vor
 *    der nächsten Zeichnung und bei `destroy()`); `disabled: () => win.running()` mit `onRunChange: () => { bar.update(); }` sperrt die Zeile während eines Laufs.
 *    **Der Einschub `composer` ist im Leerzustand des Wirts (`empty.when()`) unsichtbar**, der Kopf war es nie: ein Wirt, der die Zeile dort braucht, setzt `empty` entsprechend.
 * 5. **Die Zeile braucht Breite.** Ein Container ohne eigene Breite fällt in einem Eltern-Element mit `display: flex` (Reihe) auf null: die Wurzel trägt `width: 100%` (`MODEL_BAR_CSS`).
 */

import { setIcon, type App } from "obsidian";
import { resolveModelChoice } from "../kit/model-choice";
import type { ModelListResult } from "../kit/model-list-cache";
import { errorMessage } from "../kit/error-message";
import type { ApiErrorCode, EndpointChoice } from "../kit/endpoint-source";
import { findEndpointManager, onEndpointManagerChanged, openEndpointManagerSettings } from "./endpoint-source";
import { resolveModelBarStrings, type ModelBarStringsOverride } from "./model-bar-strings";
import { buildThinkingControl, type ThinkingControlOptions } from "./thinking-control";

/** Ein wählbarer Endpunkt in der Modellzeile (seit 0.87.0): `id` und `label` des Managers, `defaultModel` für „Standard (…)“ in seiner Gruppe. */
export interface ModelBarEndpoint { id: string; label: string; defaultModel?: string }

/** Die zehn Methoden, die die Zeile braucht (vier seit 0.67.0, sechs seit 0.87.0 für die Gruppen). Ein eigenes Interface, kein `Pick` von `LlmConnection` (seit 0.70.0): eine `LlmConnection` ist dem Typ zuweisbar, ein
 *  Adapter genügt (andere Einstellung, gleiche Form), und wer die Zeile vendort, nimmt die Kette von `llm-connection` nicht mit (zehn statt 28 Kit-Module).
 *  **Die sechs neuen Methoden sind Pflicht für jede Verbindung** (Entscheidung Johannes, Spec § 4.8): `tsc` meldet jeden Adapter, der sie nicht liefert. Ein Adapter ohne Manager-Anbindung
 *  antwortet `endpoints()` mit `[]`, dann zeichnet die Zeile eine Liste ohne Gruppen wie vor 0.87.0; `[]` bei einem Plugin, das den Manager nutzt, ist eine Umgehung, keine Migration. */
export interface ModelBarConnection {
  /** Die Modelle des aktiven Endpunkts; `force` lädt neu. */
  models(opts?: { force?: boolean }): Promise<ModelListResult>;
  /** Wählt das Modell (`""` = automatisch); wirft, wenn es sich nicht übernehmen lässt. */
  setModel(model: string): Promise<void>;
  /** Das Modell, das jetzt gilt. */
  modelInUse(): string;
  /** Vom Endpunkt gemeldet: das Standard-Modell (für „Automatisch (qwen …)“). Seit 0.73.0 liest die Zeile für die Stufenliste der Denk-Steuerung auch `model` (der Auswahlname) und `sentModel`
   *  (der Name auf dem Draht, nach Alias): die Tabelle von code-kit kennt Namen, keine Aliase des Managers. Eine `LlmConnection` liefert beides; ein Adapter darf sie weglassen. */
  source(): { defaultModel?: string; model?: string; sentModel?: string; reason?: ApiErrorCode };
  /** Die wählbaren Endpunkte in Listenreihenfolge; leer = keine Gruppen (Spec § 5). */
  endpoints(): ModelBarEndpoint[];
  /** Der Endpunkt, den die Verbindung gerade wirklich benutzt; `undefined` vor der ersten Auflösung. */
  activeEndpointId(): string | undefined;
  /** Die Liste eines bestimmten Endpunkts; wirft nie (Fehler als `{ models: [], reachable: false }`). */
  modelsOf(endpointId: string, opts?: { force?: boolean }): Promise<ModelListResult>;
  /** Die gespeicherte Wahl des Plugins. */
  choice(): EndpointChoice;
  /** Schreibt die Wahl, löst neu auf und meldet über `subscribe`; wirft, wenn es sich nicht übernehmen lässt. */
  setChoice(c: EndpointChoice): Promise<void>;
  /** Mehrfach-Abo auf jede Änderung von Auflösung und Wahl; gibt die Abmeldung zurück. Der Rückruf darf nie `resolve()` rufen. */
  subscribe(cb: () => void): () => void;
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

/** Wert eines Modell-Eintrags in einer Gruppe: ein Modellname ist nur je Endpunkt eindeutig, der Wert trägt beide (Spec § 6). Die Kennung steht URI-kodiert (kann das Trennzeichen
 *  nicht enthalten), das Modell danach unverändert; der Präfix unterscheidet den Wert von `OTHER_ENDPOINT` und von `""` (Automatisch). */
const ENTRY_PREFIX = "\u0001okit-entry:";
const ENTRY_SEP = "\u0001";
const encodeEntry = (endpointId: string, model: string): string => `${ENTRY_PREFIX}${encodeURIComponent(endpointId)}${ENTRY_SEP}${model}`;
function decodeEntry(value: string): { endpointId: string; model: string } | null {
  if (!value.startsWith(ENTRY_PREFIX)) return null;
  const rest = value.slice(ENTRY_PREFIX.length);
  const i = rest.indexOf(ENTRY_SEP);
  if (i < 0) return null;
  try { return { endpointId: decodeURIComponent(rest.slice(0, i)), model: rest.slice(i + ENTRY_SEP.length) }; } catch { return null; }
}
const ORPHAN_REASONS: ReadonlySet<string> = new Set(["disabled", "not-found", "secret-missing"]);

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
  // Mit Gruppen (seit 0.87.0): die Listen je Endpunkt (fehlt ein Eintrag, lädt er noch), die Wahl, die gerade gespeichert wird (die Anzeige zeigt sie sofort), und der Wert der Anzeige.
  const lists = new Map<string, ModelListResult>();
  let pendingChoice: EndpointChoice | null = null;
  let pickSeq = 0;
  let shownValue = "";
  let grouped = false;

  const report = (error: unknown): void => { try { opts.onError?.(error); } catch { /* ein Fehler des Konsumenten stört die Zeile nicht */ } };
  const message = errorMessage;
  const endpointsNow = (): ModelBarEndpoint[] => { try { return llm.endpoints(); } catch (e) { report(e); return []; } };

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

  const drawPlain = (): void => {
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

  /** Mit Gruppen: „Automatisch“, je Endpunkt eine `optgroup` („Standard“, die Modelle, gesperrte Hinweise), „Endpunkte verwalten …“. Gezeichnet wird nur aus Zustand, nie mit Netz. */
  const drawGrouped = (eps: ModelBarEndpoint[]): void => {
    const choice = pendingChoice ?? llm.choice();
    const active = llm.activeEndpointId();
    const src = llm.source();
    const labelOf = (e: ModelBarEndpoint | undefined, fallback: string): string => (e && e.label !== "" ? e.label : fallback);
    const reason = src.reason !== undefined && ORPHAN_REASONS.has(src.reason) ? src.reason as "disabled" | "not-found" | "secret-missing" : undefined;
    // Verwaist: der festgelegte Endpunkt gilt nicht mehr, die Auflösung ist auf „Automatisch“ zurückgefallen (Spec § 4.9). Während eines Wechsels (`pendingChoice`) ist die neue Wahl noch nicht aufgelöst.
    const orphan = pendingChoice === null && choice.endpointId !== undefined && (reason !== undefined || (active !== undefined && choice.endpointId !== active));

    let selected = "";
    let selEp: ModelBarEndpoint | undefined;
    let selModel = "";
    let legacy = false;
    if (choice.endpointId !== undefined && !orphan) {
      selEp = eps.find((e) => e.id === choice.endpointId);
      if (selEp) { selModel = choice.model ?? ""; selected = encodeEntry(selEp.id, selModel); }
    } else if (choice.endpointId === undefined && choice.model !== undefined && active !== undefined) {
      // Alt-Wahl `{ model }`: gilt für den automatischen Endpunkt und bleibt, wie sie ist (Spec § 4.10).
      selEp = eps.find((e) => e.id === active);
      if (selEp) { selModel = choice.model; selected = encodeEntry(selEp.id, selModel); legacy = true; }
    }

    const autoEp = selected === "" ? eps.find((e) => e.id === active) : undefined;
    const autoModel = src.defaultModel ?? autoEp?.defaultModel ?? "";
    const autoLabel = autoEp ? (autoModel !== "" ? st.automaticAt(labelOf(autoEp, autoEp.id), autoModel) : st.automaticWith(labelOf(autoEp, autoEp.id))) : st.automatic;

    select.empty();
    select.createEl("option", { text: autoLabel, attr: { value: "" } });
    for (const ep of eps) {
      const group = select.createEl("optgroup", { attr: { label: labelOf(ep, ep.id) } });
      group.createEl("option", { text: ep.defaultModel ? st.defaultWith(ep.defaultModel) : st.defaultServer, attr: { value: encodeEntry(ep.id, "") } });
      const result = lists.get(ep.id);
      const names = result?.models ?? [];
      for (const m of names) group.createEl("option", { text: m, attr: { value: encodeEntry(ep.id, m) } });
      // Ein gewähltes, nicht gelistetes Modell bleibt gewählt und ist markiert; der Baustein ändert nie ein Modell, das der Nutzer nicht gewählt hat.
      if (selEp?.id === ep.id && selModel !== "" && !names.includes(selModel)) group.createEl("option", { text: `${selModel} ${st.savedSuffix}`, attr: { value: encodeEntry(ep.id, selModel) } });
      // Die Gruppe bleibt stehen und sagt in Text, warum sie nichts anbietet (nicht nur Farbe, CORE-META-20); gesperrt, damit sie sich nicht wählen lässt.
      const note = result === undefined ? st.loading : !result.reachable ? st.unreachable : names.length === 0 ? st.noModels : "";
      if (note !== "") group.createEl("option", { text: note, attr: { value: "", disabled: "" } });
    }
    if (otherEndpoint() !== null) select.createEl("option", { text: st.otherEndpoint, attr: { value: OTHER_ENDPOINT } });
    select.value = selected;
    shownValue = selected;

    const hintEp = selEp ?? autoEp;
    const result = hintEp ? lists.get(hintEp.id) : undefined;
    const hint = orphan && choice.endpointId !== undefined
      ? st.orphaned(reason ?? "not-found", labelOf(eps.find((e) => e.id === choice.endpointId), choice.endpointId))
      : result === undefined ? "" : !result.reachable ? st.hintUnreachable : result.models.length === 0 ? st.hintNoList : "";
    let tip = hint;
    if (tip === "") {
      if (selEp) {
        const model = selModel !== "" ? selModel : (selEp.defaultModel ?? "");
        const base = model !== "" ? st.tooltipModelAt(model, labelOf(selEp, selEp.id)) : labelOf(selEp, selEp.id);
        tip = legacy ? `${base} · ${st.legacyAuto}` : base;
      } else tip = autoLabel;
    }
    select.setAttribute("title", tip);
    warnEl.toggleClass("is-hidden", hint === "");
    if (hint !== "") { warnEl.setAttribute("aria-label", hint); warnEl.setAttribute("title", hint); } else { warnEl.removeAttribute("aria-label"); warnEl.removeAttribute("title"); }
    applyDisabled();
  };

  const draw = (): void => {
    const eps = endpointsNow();
    grouped = eps.length > 0;
    if (grouped) drawGrouped(eps); else drawPlain();
  };

  const redraw = (): void => { draw(); thinkCtl?.refresh(); applyDisabled(); };

  // Aufschub bei Fokus (Spec § 6): ein natives Dropdown ergänzt sich nicht, während es offen ist — Chromium schlösse die Liste, oder sie spränge. Was NICHT vom Nutzer kommt (eine Liste
  // trifft ein, die Verbindung meldet eine Änderung), zeichnet deshalb erst, wenn das Dropdown den Fokus abgibt (`blur`) oder bevor der Nutzer es das nächste Mal öffnet (`pointerdown`: nach
  // einer Wahl behält das Dropdown den Fokus, sonst bliebe die Liste bis zu einem Klick daneben veraltet). Die Wahl des Nutzers selbst und `update()` zeichnen sofort.
  let deferred = false;
  const hasFocus = (): boolean => typeof activeDocument !== "undefined" && activeDocument.activeElement === (select as unknown as Element);
  const scheduleRedraw = (): void => { if (hasFocus()) { deferred = true; return; } deferred = false; redraw(); };
  const flushDeferred = (): void => { if (deferred) { deferred = false; redraw(); } };
  select.addEventListener("blur", flushDeferred);
  select.addEventListener("pointerdown", flushDeferred);

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
    const activeId = llm.activeEndpointId();
    if (result !== null && activeId !== undefined) lists.set(activeId, result);
    scheduleRedraw();   // nach der Auflösung kennt die Verbindung Familie und Backend: auch der Denk-Knopf zeichnet neu
    const eps = endpointsNow();
    if (force && result !== null && eps.length === 0) statusEl.setText(result.reachable ? st.loaded(result.models.length) : st.notReachable);
    if (result !== null) { try { opts.onRefreshed?.(result); } catch (e) { report(e); } }
    // Die übrigen Endpunkte laden erst nach dem aktiven, parallel und ohne dass die Zeile auf sie wartet (ein stummer Host kostet bis ~10 s).
    const loads = eps.filter((ep) => ep.id !== activeId).map((ep) => loadEndpoint(ep.id, force));
    if (force && eps.length > 0) {
      // Neu laden mit Gruppen: die Ansage nennt alle Modelle aller Endpunkte, die antworten — sie kommt, wenn alle Ergebnisse da sind (ein neueres refresh() übernimmt sie).
      void Promise.all(loads).then(() => {
        if (destroyed || mine !== seq) return;
        let models = 0;
        let answering = 0;
        for (const ep of endpointsNow()) { const r = lists.get(ep.id); if (r?.reachable) { models += r.models.length; answering++; } }
        statusEl.setText(answering === 0 ? st.notReachable : st.loadedAll(models, answering));
      });
    }
  }

  const loadSeq = new Map<string, number>();
  /** Lädt die Liste eines Endpunkts; ein überholtes Ergebnis (neueres Laden desselben Endpunkts) zeichnet nichts. */
  async function loadEndpoint(id: string, force: boolean): Promise<void> {
    const mine = (loadSeq.get(id) ?? 0) + 1;
    loadSeq.set(id, mine);
    let result: ModelListResult;
    try { result = await llm.modelsOf(id, force ? { force: true } : undefined); } catch (e) { report(e); result = { models: [], reachable: false }; }
    if (destroyed || loadSeq.get(id) !== mine) return;
    lists.set(id, result);
    scheduleRedraw();
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

  /** Mit Gruppen: die Wahl legt Endpunkt und Modell für DIESES Plugin fest (`setChoice`), nie das Modell eines anderen Plugins (Spec § 4.4). */
  async function pickGrouped(value: string): Promise<void> {
    let choice: EndpointChoice = {};
    if (value !== "") {
      const d = decodeEntry(value);
      if (d === null) return;
      choice = d.model === "" ? { endpointId: d.endpointId } : { endpointId: d.endpointId, model: d.model };
    }
    const mine = ++pickSeq;
    pendingChoice = choice;
    redraw();   // die Anzeige zeigt die neue Wahl sofort
    let ok = false;
    try {
      await llm.setChoice(choice);
      ok = true;
    } catch (e) {
      if (!destroyed) { statusEl.setText(st.setFailed(message(e))); report(e); }
    }
    if (mine === pickSeq) pendingChoice = null;
    if (destroyed) return;
    redraw();
    if (ok) { try { opts.onChange?.(choice.model ?? ""); } catch (e) { report(e); } }
  }

  select.addEventListener("change", () => {
    const value = select.value;
    if (value === OTHER_ENDPOINT) {
      select.value = grouped ? shownValue : llm.modelInUse();   // der Eintrag wählt nichts: die Anzeige bleibt beim Geltenden
      try { otherEndpoint()?.(); } catch (e) { report(e); }
      return;
    }
    if (grouped) void pickGrouped(value); else void pick(value);
  });
  refreshBtn.addEventListener("click", () => { void refresh({ force: true }); });

  // Die Zeile abonniert ihre Verbindung und den Manager selbst (0.87.0, Spec § 4.6, § 4.7a): sie zeichnet sich nach jedem Wechsel neu, auch wenn er im Einstellungs-Tab des Plugins geschah.
  // **Beide Rückrufe rufen nie `resolve()`** (kein Kreis, Befund settings-assistant): sie zeichnen aus dem Zustand und laden höchstens Listen.
  let lastActive = llm.activeEndpointId();
  const onConnection = (): void => {
    if (destroyed) return;
    const id = llm.activeEndpointId();
    if (id !== lastActive) { lastActive = id; if (id !== undefined) void loadEndpoint(id, false); }
    scheduleRedraw();
  };
  const onManagerChanged = (): void => {
    if (destroyed) return;
    const eps = endpointsNow();
    const known = new Set(eps.map((e) => e.id));
    for (const id of [...lists.keys()]) if (!known.has(id)) lists.delete(id);
    for (const ep of eps) if (!lists.has(ep.id)) void loadEndpoint(ep.id, false);
    scheduleRedraw();
  };
  const offConnection = llm.subscribe(onConnection);
  const offManager = onEndpointManagerChanged(opts.app, onManagerChanged);

  redraw();
  void refresh();

  return {
    rootEl: root,
    refresh,
    update: redraw,
    destroy(): void {
      destroyed = true;
      try { offConnection(); } catch { /* schon abgemeldet */ }
      offManager();
      root.remove();
    },
  };
}

/** Gehört in die `styles.css` des Consumers — das Kit injiziert kein CSS (Muster `THINKING_CONTROL_CSS`). Nur Theme-Variablen.
 *
 *  Seit 0.73.0 bleibt die Zeile einzeilig. Die Wurzel ist ein benannter Container (`container-type: inline-size`, `width: 100%`: ohne eigene Breite fiele sie in einer
 *  Flex-Reihe auf null), die Elemente liegen in der inneren Zeile `okit-model-bar-row` (eine Container-Abfrage stylt nie den Container selbst). Rangfolge bei Enge (seit 0.76.0, Schwelle 340 px seit 0.77.1; gemessen mit dem Pilot `model-bar-breite`: bei 296 px Containerbreite zeigt das offene Dropdown von `google/gemma-4-e4b` 9 von 18 Zeichen, gefaltet 17; ab 340 px zeigt es 11, `qwen3.8-27b` ganz): unter 340 px
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
@container okit-model-bar (width < 340px) { .okit-model-bar .okit-thinking-control select { width: calc(var(--size-2-3) + var(--size-4-6) + 1.2em); min-width: 0; padding-inline: var(--size-2-3) var(--size-4-6); text-overflow: clip; } }
@container okit-model-bar (width < 200px) { .okit-model-bar-row { flex-wrap: wrap; } }
.okit-model-bar-status { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; overflow: hidden; white-space: nowrap; }
`;
