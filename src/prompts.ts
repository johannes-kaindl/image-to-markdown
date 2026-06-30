import { t, defaultVisionPrompt } from "./i18n";

/** Verfügbare Prompt-Presets. Reihenfolge = Dropdown-Reihenfolge; "default" zuerst.
 *  "default" nutzt den editierbaren settings.visionPrompt; die übrigen sind feste Built-ins. */
export const PROMPT_PRESETS = ["default", "tables", "handwriting", "math", "code", "describe"] as const;

export function isPromptPreset(id: string): boolean {
  return (PROMPT_PRESETS as readonly string[]).includes(id);
}

/** Lokalisiertes Label fürs Dropdown; Fallback = id (unbekannt). */
export function promptPresetLabel(id: string): string {
  return isPromptPreset(id) ? t(`preset.label.${id}`) : id;
}

/** Lokalisierter Built-in-Prompt-Text. "" für "default" (der nutzt den editierbaren Default-Text). */
export function builtinPromptText(id: string): string {
  if (id === "default") return "";
  return t(`preset.prompt.${id}`);
}

/** Effektiver Prompt-Text: "default" (oder unbekannte id) → editierbarer customDefault
 *  (Fallback defaultVisionPrompt() bei leer); sonst der lokalisierte Built-in-Text. Reine Funktion. */
export function resolvePromptText(id: string, customDefault: string): string {
  if (id !== "default" && isPromptPreset(id)) return builtinPromptText(id);
  return customDefault.trim() ? customDefault : defaultVisionPrompt();
}
