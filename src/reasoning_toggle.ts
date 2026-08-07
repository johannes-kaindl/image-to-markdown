// Reiner Kern: mappt (Modell, Suppress-Flag) auf den Anzeige-Zustand des Thinking-Toggles.
// Obsidian-/DOM-frei (in Node testbar, PROF-OBS-03/04).
import { isAlwaysOnThinker } from "./vendor/kit/reasoning";
import { guessFromName } from "./vendor/kit/capabilities";

export interface ThinkToggleView {
  labelKey: "view.thinkingOn" | "view.thinkingOff" | "view.thinkingAlways";
  /** Zusatz für Tooltip + aria-label; null = kein Hinweis. Ändert NIE den sichtbaren Button-Text
   *  (der Sidebar-Breiten-Fix aus 0.10.1 hängt daran) und NIE das Request-Verhalten. */
  hintKey: "view.thinkingHintAlways" | null;
  cls: "" | "is-off" | "is-disabled";
  disabled: boolean;
}

/** Hinweis aus der Kit-Namens-Heuristik — nur für support:"always". Es gibt bewusst KEIN
 *  Gegenstück für support:"none": guessThinking liefert {support:"none", confidence:"no"}
 *  sowohl für bekannte Nicht-Denker als auch für jeden nicht erkannten Namen — bei frei
 *  benannten lokalen Modellen der Mehrheitsfall. Ein Hinweis „denkt vermutlich nicht" wäre
 *  dort eine Aussage, die die Heuristik nicht stützen kann (Abwesenheit von Evidenz ist keine
 *  Evidenz für Abwesenheit). Ein Confidence-Gate hilft nicht: support==="none" und
 *  confidence==="no" treten in guessFromName immer zusammen auf, ein Gate darauf würde den
 *  Hinweis in 100% der Fälle unterdrücken — also stattdessen ganz weglassen. */
function hintFor(model: string): ThinkToggleView["hintKey"] {
  if (model === "") return null;   // kein Modell gewählt → keine Aussage über ein Modell, das es nicht gibt
  return guessFromName(model).thinking.support === "always" ? "view.thinkingHintAlways" : null;
}

/** gpt-oss/harmony lassen sich nicht abschalten → disabled + „immer an". Sonst: an/aus je Suppress-Flag. */
export function thinkToggleView(model: string, suppress: boolean): ThinkToggleView {
  if (isAlwaysOnThinker(model)) {
    return { labelKey: "view.thinkingAlways", hintKey: null, cls: "is-disabled", disabled: true };
  }
  const hintKey = hintFor(model);
  if (suppress) return { labelKey: "view.thinkingOff", hintKey, cls: "is-off", disabled: false };
  return { labelKey: "view.thinkingOn", hintKey, cls: "", disabled: false };
}

/** Effektiver Suppress-Wert für den Request: unterdrücke NUR, wenn der Nutzer es will UND das
 *  Modell abschaltbar ist. Always-on-Modelle (gpt-oss/harmony) akzeptieren reasoning_effort:"none"
 *  nicht — dort nie unterdrücken (spiegelt den disabled-Zustand des Toggles auf der Request-Seite).
 *
 *  ABSICHTLICH an isAlwaysOnThinker gebunden, NICHT an die reichere Kit-Heuristik: deepseek-r1,
 *  qwq & Co. schlucken die Suppress-Params als harmloses No-op und denken weiter, gpt-oss/harmony
 *  lehnen sie ab und der Request schlägt fehl. Nur der zweite Fall rechtfertigt eine Sperre —
 *  der erste wäre Bevormundung auf Basis einer Namensvermutung. Per Test fixiert. */
export function effectiveSuppress(model: string, suppress: boolean): boolean {
  return suppress && !isAlwaysOnThinker(model);
}
