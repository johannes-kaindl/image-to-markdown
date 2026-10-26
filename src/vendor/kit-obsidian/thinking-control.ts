// vendored from obsidian-kit@0.72.0, src/obsidian/thinking-control.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { DropdownComponent, setIcon } from "obsidian";
import { THINKING_LEVELS, familyThinking, type BackendId, type FamilyId, type ThinkingLevel } from "../kit/sampling-profiles";

/** Denk-Steuerung im Chat. Standard: Zustands-Knopf nach UI-STANDARD §8 (Ist-Zustand im
 *  Label, `aria-pressed`, Icon `brain` ↔ `brain-cog`), schaltet zwischen `off` und `onLevel()`.
 *  Mit `levelPicker()` ein natives `<select>` mit vier Stufen — kein Knopf mit vier Zuständen,
 *  weil `aria-pressed` nur zwei kennt (Spec § 5.2). */
export interface ThinkingControlStrings {
  button(level: ThinkingLevel, offNotPossible: boolean): string;
  /** Seit 0.63.0, optional: Beschriftung und Hinweis für „aus“, wenn „aus“ hier nicht möglich ist (die niedrigste Stufe wird gesendet).
   *  Gesetzt, ersetzt es `button(…, true)` — lingotuner zeigte „Thinking: off (can't fully turn off)“, settings-assistant „Thinking: lowest level“,
   *  beides für denselben Zustand (gemma4 × LM Studio). Die Kit-Fassung ist `thinkingOffTexts(lang)`. */
  offNotPossible?: ThinkingOffTexts;
  level(l: ThinkingLevel): string;
  pickerLabel: string;
}
/** Text des Knopfs im Zustand „aus nicht möglich“: kurze Beschriftung, dazu der Grund als Hinweis (Tooltip und Screenreader). */
export interface ThinkingOffTexts { label: string; hint: string }
export const THINKING_OFF_TEXTS_EN: ThinkingOffTexts = {
  label: "Thinking: lowest level",
  hint: "Thinking can't be fully turned off here; the lowest available level is sent.",
};
export const THINKING_OFF_TEXTS_DE: ThinkingOffTexts = {
  label: "Denken: niedrigste Stufe",
  hint: "Das Denken lässt sich hier nicht ganz abschalten; die niedrigste verfügbare Stufe wird gesendet.",
};
/** Die Kit-Fassung für `ThinkingControlStrings.offNotPossible`; `lang` beginnt mit `de` → Deutsch, sonst Englisch. */
export function thinkingOffTexts(lang: string): ThinkingOffTexts {
  return lang.toLowerCase().startsWith("de") ? THINKING_OFF_TEXTS_DE : THINKING_OFF_TEXTS_EN;
}

/** Kit-Text für den gesperrten Zustand „immer an“ (`ThinkingControlOptions.locked`), seit 0.70.1: das Modell denkt immer (gpt-oss), der Knopf kann nichts umschalten. */
export const THINKING_LOCKED_TEXTS_EN: ThinkingOffTexts = {
  label: "Thinking: always on",
  hint: "This model always thinks; thinking can't be turned off here.",
};
export const THINKING_LOCKED_TEXTS_DE: ThinkingOffTexts = {
  label: "Denken: immer an",
  hint: "Dieses Modell denkt immer; das Denken lässt sich hier nicht abschalten.",
};
/** Die Kit-Fassung für `ThinkingControlOptions.locked`; `lang` beginnt mit `de` → Deutsch, sonst Englisch. */
export function thinkingLockedTexts(lang: string): ThinkingOffTexts {
  return lang.toLowerCase().startsWith("de") ? THINKING_LOCKED_TEXTS_DE : THINKING_LOCKED_TEXTS_EN;
}

/** Kit-Text für den Hinweis „denkt vermutlich immer“ (`ThinkingControlOptions.hint`), seit 0.71.0: die Namens-Heuristik von code-kit (`thinkToggleState(model, suppress).hint === "alwaysGuess"`,
 *  deepseek-r1, qwq, magistral, glm-z1 …) rät, dass das Modell immer denkt, ohne dass die Anfrage das Abschalten verwehrt; der Knopf bleibt bedienbar, der Hinweis sagt, dass „aus“ dort
 *  wahrscheinlich nichts bewirkt. Wortlaut von koda-agent (`view.thinkingHintAlways`). Die Entscheidung („rät der Name?“) liegt in code-kit, der Text hier (Muster `thinkingLockedTexts`). */
export const THINKING_ALWAYS_GUESS_HINT_EN = "This model probably always thinks — turning it off likely has no effect";
export const THINKING_ALWAYS_GUESS_HINT_DE = "Dieses Modell denkt vermutlich immer — Abschalten wirkt wahrscheinlich nicht";
/** Die Kit-Fassung für `ThinkingControlOptions.hint`; `lang` beginnt mit `de` → Deutsch, sonst Englisch. */
export function thinkingAlwaysGuessHint(lang: string): string {
  return lang.toLowerCase().startsWith("de") ? THINKING_ALWAYS_GUESS_HINT_DE : THINKING_ALWAYS_GUESS_HINT_EN;
}

export interface ThinkingControlOptions {
  containerEl: HTMLElement;
  family(): FamilyId | null;
  /** Seit 0.61.0, optional: das Backend der Quelle. Ob „aus“ möglich ist, hängt an Familie UND Backend (gemma 4 lässt sich auf LM Studio nicht
   *  abschalten, anderswo schon). Fehlt es, gilt die Familie als solche. */
  backend?(): BackendId | undefined;
  current(): ThinkingLevel;
  onLevel(): ThinkingLevel;
  setLevel(l: ThinkingLevel): Promise<void>;
  levelPicker(): boolean;
  strings: ThinkingControlStrings;
  /** Seit 0.70.1, optional: der gesperrte Zustand „immer an“ (das Modell denkt immer, gpt-oss; koda-agent). Liefert es einen Text, zeigt der Knopf `label`, ist `disabled`,
   *  trägt `aria-pressed="true"` und `label. hint` als `aria-label`, und ein Klick schreibt nichts (`setLevel` wird nie gerufen); mit `levelPicker()` ist das Dropdown gesperrt
   *  und trägt den Grund im `aria-label`. Gilt unabhängig von `current()` und gewinnt gegen `strings.offNotPossible`. Wird bei jedem Zeichnen gelesen (`refresh()` nach einem
   *  Modellwechsel). Der Wirt liefert den Grund (gpt-oss, anderes Backend); der Kit-Text ist `thinkingLockedTexts(lang)`. Ohne das Feld ändert sich nichts. */
  locked?(): ThinkingOffTexts | undefined;
  /** Seit 0.71.0, optional: ein Hinweis am **bedienbaren** Knopf, im Zustand an wie aus (Tooltip und `aria-label`, hinter der Beschriftung), zum Beispiel „Dieses Modell denkt vermutlich immer“
   *  (`thinkingAlwaysGuessHint(lang)`, die Entscheidung trifft der Wirt mit `thinkToggleState` aus code-kit). Der Knopf bleibt bedienbar und schreibt wie bisher. Der Name trägt höchstens einen
   *  Grund (seit 0.72.0): trägt er schon einen (`locked`, oder „aus nicht möglich“ mit gesetztem `strings.offNotPossible`: Claude im Zustand aus), entfällt der Hinweis, denn das Modell denkt dann
   *  sicher oder der Name sagt schon, warum „aus“ nichts bewirkt. Fehlt `strings.offNotPossible`, bleibt der Hinweis (sonst stünde gar kein Grund im Namen). Mit `levelPicker()` steht er im
   *  `aria-label` des Dropdowns (es zeigt `offNotPossible` nicht). Leer oder `undefined`: kein Hinweis. Wird bei jedem Zeichnen gelesen. Ohne das Feld ändert sich nichts. */
  hint?(): string | undefined;
}

export function buildThinkingControl(opts: ThinkingControlOptions): { refresh(): void } {
  const root = opts.containerEl.createDiv({ cls: "okit-thinking-control" });
  const render = (): void => {
    root.empty();
    const level = opts.current();
    const fam = opts.family();
    const offNotPossible = level === "off" && fam !== null && !familyThinking(fam, opts.backend?.()).canTurnOff;
    const locked = opts.locked?.();
    // Mit `levelPicker()` zeigt das Dropdown „aus nicht möglich“ nicht: der Hinweis ist dort der einzige Grund und bleibt. Am Knopf entfällt er, sobald der Name selbst einen Grund trägt.
    const offText = locked ?? (offNotPossible && !opts.levelPicker() ? opts.strings.offNotPossible : undefined);
    const hintText = offText === undefined ? (opts.hint?.() ?? "") : "";
    if (opts.levelPicker()) {
      const dd = new DropdownComponent(root);
      dd.selectEl.setAttribute("aria-label", locked !== undefined ? `${opts.strings.pickerLabel}. ${locked.label}. ${locked.hint}` : hintText !== "" ? `${opts.strings.pickerLabel}. ${hintText}` : opts.strings.pickerLabel);
      if (locked !== undefined) dd.setDisabled(true);
      for (const l of THINKING_LEVELS) dd.addOption(l, opts.strings.level(l));
      dd.setValue(level).onChange((v) => { void opts.setLevel(v as ThinkingLevel).then(render); });
      return;
    }
    const on = locked !== undefined || level !== "off";
    const btn = root.createEl("button", { cls: "clickable-icon okit-thinking-toggle" });
    if (locked !== undefined) { btn.disabled = true; btn.addClass("is-locked"); }
    btn.setAttribute("aria-pressed", String(on));
    btn.toggleClass("is-off", !on);
    const icon = btn.createSpan();
    setIcon(icon, on ? "brain-cog" : "brain");
    const label = offText !== undefined ? offText.label : opts.strings.button(level, offNotPossible);
    btn.createSpan({ text: label });
    // Der Grund steht im Namen des Knopfs (Obsidian zeigt `aria-label` als Tooltip); die sichtbare Beschriftung bleibt sein Anfang. Es ist immer höchstens EIN Grund: der von
    // `offText` (gesperrt, „aus nicht möglich“) oder der Hinweis des Wirts, nie beide (zwei Sätze, die dasselbe sagen, und ein doppelter Punkt am Ende des ersten).
    const reason = offText?.hint ?? hintText;
    if (reason !== "") btn.setAttribute("aria-label", `${label}. ${reason}`);
    if (locked === undefined) btn.addEventListener("click", () => { void opts.setLevel(on ? "off" : opts.onLevel()).then(render); });
  };
  render();
  return { refresh: render };
}

/** Gehört in die `styles.css` des Consumers — das Kit injiziert kein CSS (Muster `STREAM_AREA_CSS`).
 *  Nur Theme-Variablen (UI-STANDARD), keine festen Größen.
 *
 *  Herkunft: lingotuner `styles.css:203, 208-209` (Ursprung), vault-rag `styles.css:472-477` (Kopie mit Herkunftsstempel,
 *  plus `:disabled` und Icon-Größe), image-to-markdown `styles.css:81-83` (Abstand `0.25em`, feste Größen `12px`/`14px`,
 *  eigener Rahmen aus `padding` und `height: auto`). settings-assistant hatte gar keine Regel: Icon und Beschriftung
 *  klebten aneinander (Task „Chat-Kopfzeile Thinking-Knopf ohne Abstand zwischen Icon und Label“).
 *
 *  Unterschiede und was daraus wurde: Abstand `var(--size-2-1)` (zwei Träger; `0.25em` ist keine Theme-Größe), Schrift
 *  `var(--font-ui-small)` (statt `12px`), Icon `var(--icon-xs)` (statt `14px`; auf Mobil skaliert Obsidian die Variable auf 18 px,
 *  das ist gewollt). `padding` und `width: auto` aus image-to-markdown entfallen: `.clickable-icon` bringt Rahmen und Höhe selbst mit
 *  (gemessen an Obsidians `app.css` 1.14.4; `height: auto` steht dort bereits, die Regel hier ist nur ein Netz für Themes). Der
 *  Aus-Zustand setzt `--text-muted`. **Im Standard-Theme ist das dieselbe Farbe wie der An-Zustand** (`--icon-color` ist dort
 *  `--text-muted`): die Farbe trägt den Zustand dort also nicht. Das ist nach UI-STANDARD §8 zulässig, weil die Farbe nur ein Kanal ist —
 *  das Label nennt den Ist-Zustand, `aria-pressed` trägt ihn, das Icon wechselt (`brain` / `brain-cog`). Die Regel greift in Themes, die `--icon-color`
 *  anders setzen; image-to-markdown hatte als Einziger eine echte Differenz (an muted, aus faint), `--text-faint` ist als
 *  Beschriftung zu blass. Die Träger-Klassen der Consumer (`.lt-think`, `.vault-rag-chat-think`, `.img2md-think`)
 *  entfallen, wo sie nur `inline-flex` setzten: `.okit-thinking-control` ist selbst `inline-flex`. */
export const THINKING_CONTROL_CSS = `
.okit-thinking-control { display: inline-flex; align-items: center; }
.okit-thinking-toggle {
  display: inline-flex; align-items: center; gap: var(--size-2-1);
  height: auto; font-size: var(--font-ui-small); white-space: nowrap;
}
.okit-thinking-toggle.is-off { color: var(--text-muted); }
.okit-thinking-toggle:disabled { opacity: 0.4; cursor: not-allowed; }
/* Gesperrt „immer an“ (Option locked): lesbarer als ein gewöhnlich deaktivierter Knopf, denn die Beschriftung trägt die Aussage, aber erkennbar nicht bedienbar (kein Zeiger, kein Hover). */
.okit-thinking-toggle.is-locked:disabled { opacity: 0.85; cursor: default; }
.okit-thinking-toggle svg { width: var(--icon-xs); height: var(--icon-xs); }
.okit-thinking-control select { font-size: var(--font-ui-small); }
`;
