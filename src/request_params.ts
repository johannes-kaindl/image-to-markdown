// Reiner Kern: der Sampling-Modus DIESES Plugins und das Laden der Anfrage-Einstellungen samt
// Migration des Altfelds `suppressThinking`. Obsidian-frei. Den Request selbst baut seit dem
// Verbindungs-Tausch die Kit-Verbindung (`createLlmConnection`, Modus `MODE`, kein `maxTokens`).
import { onLevelFor, sanitizeRequestSettings, type ModeId, type RequestSettings } from "./vendor/kit/sampling-profiles";

/** Modus dieses Plugins in der Sampling-Profile-Tabelle: Bild und PDF-Seite werden treu nach
 *  Markdown umgeformt, ohne etwas zu erfinden (Spec § 4.1 „transform"). Nur EIN Modus, deshalb
 *  fest verdrahtet — auch Beschreiben und Nachbessern laufen über denselben Request. i2m sendet
 *  kein `max_tokens`: ein abgeschnittenes Transkript meldet `finish_reason: length` an die Karte. */
export const MODE: ModeId = "transform";

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
