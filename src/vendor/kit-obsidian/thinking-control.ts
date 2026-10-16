// vendored from obsidian-kit@0.61.0, src/obsidian/thinking-control.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { DropdownComponent, setIcon } from "obsidian";
import { THINKING_LEVELS, familyThinking, type BackendId, type FamilyId, type ThinkingLevel } from "../kit/sampling-profiles";

/** Denk-Steuerung im Chat. Standard: Zustands-Knopf nach UI-STANDARD §8 (Ist-Zustand im
 *  Label, `aria-pressed`, Icon `brain` ↔ `brain-cog`), schaltet zwischen `off` und `onLevel()`.
 *  Mit `levelPicker()` ein natives `<select>` mit vier Stufen — kein Knopf mit vier Zuständen,
 *  weil `aria-pressed` nur zwei kennt (Spec § 5.2). */
export interface ThinkingControlStrings {
  button(level: ThinkingLevel, offNotPossible: boolean): string;
  level(l: ThinkingLevel): string;
  pickerLabel: string;
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
}

export function buildThinkingControl(opts: ThinkingControlOptions): { refresh(): void } {
  const root = opts.containerEl.createDiv({ cls: "okit-thinking-control" });
  const render = (): void => {
    root.empty();
    const level = opts.current();
    const fam = opts.family();
    const offNotPossible = level === "off" && fam !== null && !familyThinking(fam, opts.backend?.()).canTurnOff;
    if (opts.levelPicker()) {
      const dd = new DropdownComponent(root);
      dd.selectEl.setAttribute("aria-label", opts.strings.pickerLabel);
      for (const l of THINKING_LEVELS) dd.addOption(l, opts.strings.level(l));
      dd.setValue(level).onChange((v) => { void opts.setLevel(v as ThinkingLevel).then(render); });
      return;
    }
    const on = level !== "off";
    const btn = root.createEl("button", { cls: "clickable-icon okit-thinking-toggle" });
    btn.setAttribute("aria-pressed", String(on));
    btn.toggleClass("is-off", !on);
    const icon = btn.createSpan();
    setIcon(icon, on ? "brain-cog" : "brain");
    btn.createSpan({ text: opts.strings.button(level, offNotPossible) });
    btn.addEventListener("click", () => { void opts.setLevel(on ? "off" : opts.onLevel()).then(render); });
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
.okit-thinking-toggle svg { width: var(--icon-xs); height: var(--icon-xs); }
.okit-thinking-control select { font-size: var(--font-ui-small); }
`;
