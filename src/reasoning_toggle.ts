// Reiner Kern: mappt (Modell, Suppress-Flag) auf den Anzeige-Zustand des Thinking-Toggles.
// Obsidian-/DOM-frei (in Node testbar, PROF-OBS-03/04).
import { isAlwaysOnThinker } from "./vendor/kit/reasoning";

export interface ThinkToggleView {
  labelKey: "view.thinkingOn" | "view.thinkingOff" | "view.thinkingAlways";
  cls: "" | "is-off" | "is-disabled";
  disabled: boolean;
}

/** gpt-oss/harmony lassen sich nicht abschalten → disabled + „immer an". Sonst: an/aus je Suppress-Flag. */
export function thinkToggleView(model: string, suppress: boolean): ThinkToggleView {
  if (isAlwaysOnThinker(model)) return { labelKey: "view.thinkingAlways", cls: "is-disabled", disabled: true };
  if (suppress) return { labelKey: "view.thinkingOff", cls: "is-off", disabled: false };
  return { labelKey: "view.thinkingOn", cls: "", disabled: false };
}
