// Reiner Kern: der Sampling-Modus DIESES Plugins und die Migration des Altfelds `suppressThinking`
// (geladen wird mit `loadRequestSettings` aus dem Kit). Obsidian-frei. Den Request selbst baut seit dem
// Verbindungs-Tausch die Kit-Verbindung (`createLlmConnection`, Modus `MODE`, kein `maxTokens`).
import { foldLegacyThinking, type LegacyRequestMigration, type ModeId } from "./vendor/kit/sampling-profiles";

/** Modus dieses Plugins in der Sampling-Profile-Tabelle: Bild und PDF-Seite werden treu nach
 *  Markdown umgeformt, ohne etwas zu erfinden (Spec § 4.1 „transform"). Nur EIN Modus, deshalb
 *  fest verdrahtet — auch Beschreiben und Nachbessern laufen über denselben Request. i2m sendet
 *  kein `max_tokens`: ein abgeschnittenes Transkript meldet `finish_reason: length` an die Karte. */
export const MODE: ModeId = "transform";

/** Migrationen für `loadRequestSettings` (Kit, code-kit sampling-profiles). Altfeld
 *  `suppressThinking`: `true` → Stufe „aus"; `false` (der alte Default — Denken lief) → die Ein-Stufe
 *  des Modus, damit sich für bestehende Nutzer nichts ändert. Eine schon gespeicherte Stufe gewinnt.
 *  Der Aufrufer entfernt das Altfeld danach und meldet `dropped` (Notice + console.warn). */
export const REQUEST_MIGRATIONS: readonly LegacyRequestMigration[] = [
  (raw, request) => foldLegacyThinking(request, MODE, raw.suppressThinking),
];
