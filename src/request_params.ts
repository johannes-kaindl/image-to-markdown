// Reiner Kern: die Request-Bau-Funktion DIESES Plugins (Sampling-Plan Rezept 4/8) und das Laden
// der Anfrage-Einstellungen samt Migration des Altfelds `suppressThinking`. Obsidian-frei.
import {
  onLevelFor, resolveRequestParams, sanitizeRequestSettings,
  type BackendId, type FamilyId, type FieldId, type ModeId, type RequestSettings, type ResolvedRequest, type ThinkingLevel,
} from "./vendor/kit/sampling-profiles";

/** Modus dieses Plugins in der Sampling-Profile-Tabelle: Bild und PDF-Seite werden treu nach
 *  Markdown umgeformt, ohne etwas zu erfinden (Spec § 4.1 „transform"). Nur EIN Modus, deshalb
 *  fest verdrahtet — auch Beschreiben und Nachbessern laufen über denselben Request. */
export const MODE: ModeId = "transform";

/** Die Request-Bau-Funktion DES PLUGINS: nur sie kennt den festen Modus. Die goldenen Requests
 *  (tests/request_params.test.ts) laufen dagegen, nicht gegen `resolveRequestParams` direkt —
 *  sonst prüfte der Test das Kit statt das Plugin. Kein Token-Budget: i2m sendet kein
 *  `max_tokens` (ein abgeschnittenes Transkript meldet `finish_reason: length` an die Karte). */
export function buildVisionParams(input: {
  family: FamilyId | null;
  backend: BackendId;
  thinking: ThinkingLevel;
  overrides?: Partial<Record<FieldId, number | string>>;
}): ResolvedRequest {
  return resolveRequestParams({
    family: input.family, mode: MODE, backend: input.backend, thinking: input.thinking,
    ...(input.overrides ? { overrides: input.overrides } : {}),
  });
}

/** Lädt `request` aus den gespeicherten Plugin-Daten und zieht das Altfeld nach (Rezept 2/3).
 *  `raw` sind die GANZEN Daten aus `loadData()`. Ungültiges wird nicht still behalten, sondern in
 *  `dropped` gemeldet. Altfeld `suppressThinking`: `true` → Stufe „aus"; `false` (der alte
 *  Default — Denken lief) → die Ein-Stufe des Modus, damit sich für bestehende Nutzer nichts
 *  ändert. Eine schon gespeicherte Stufe gewinnt. Der Aufrufer entfernt das Altfeld danach. */
export function loadRequestSettings(raw: unknown): { request: RequestSettings; dropped: string[] } {
  const data = raw !== null && typeof raw === "object" ? (raw as { request?: unknown; suppressThinking?: unknown }) : {};
  const { settings: request, dropped } = sanitizeRequestSettings(data.request);
  if (typeof data.suppressThinking === "boolean" && request.thinking[MODE] === undefined) {
    request.thinking[MODE] = data.suppressThinking ? "off" : onLevelFor(request, MODE);
  }
  return { request, dropped };
}
