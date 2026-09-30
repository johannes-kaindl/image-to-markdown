// vendored from obsidian-kit@0.45.0, src/obsidian/thinking-control.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { DropdownComponent, setIcon } from "obsidian";
import { FAMILIES, THINKING_LEVELS, type FamilyId, type ThinkingLevel } from "../kit/sampling-profiles";

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
    const offNotPossible = level === "off" && fam !== null && !FAMILIES[fam].canTurnOff;
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
