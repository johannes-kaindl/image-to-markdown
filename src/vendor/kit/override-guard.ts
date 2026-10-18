// vendored from obsidian-kit@0.63.0, src/pure/override-guard.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Werte je Aufruf, die das Profil nicht annimmt, werden NICHT gesendet (Welle 23, Entscheidung des Masters 2026-10-16).
 *
 *  `createLlmConnection` mischt die Überschreibungen eines Aufrufs (`CompleteHandlers.overrides`, z. B. transmute
 *  `temperature: 0`) NACH dem Profil in die Anfrage; `resolveRequestParams` sieht sie nie, und `unsupportedFields` der
 *  Familie und `BACKENDS[b].fields` schützen sie deshalb nicht. Auf Claude 4.7 und neuer ist ein `temperature` unter 1 ein
 *  HTTP 400. Diese Funktion legt dieselbe Regel auf die Werte je Aufruf, die das Profil für die Werte aus den Settings
 *  schon anwendet: ein Feld, das die Familie als nicht angenommen führt oder das das Backend als `unsupported` führt, fällt
 *  weg. Felder ohne Profil-Eintrag (`stop`, `seed`, …) bleiben, das Profil kennt sie nicht.
 *
 *  Ausnahme Backend `unknown`: dort führt die Tabelle nur „Standardfelder“, ohne Beleg; ein Server, den wir nicht kennen, soll
 *  nicht auf Verdacht Werte verlieren. Eine Familie mit einem Eintrag in `unsupportedFields` (belegt) gilt auf jedem Backend. */
import { BACKENDS, FAMILIES, type BackendId, type FamilyId, type FieldId } from "./sampling-profiles";

const FIELDS: readonly FieldId[] = ["temperature", "top_p", "top_k", "min_p", "presence_penalty", "reasoning_effort", "max_tokens"];

export function splitCallOverrides(
  overrides: Record<string, unknown> | undefined,
  ctx: { family: FamilyId | null; backend: BackendId },
): { kept: Record<string, unknown>; dropped: string[] } {
  const kept: Record<string, unknown> = {};
  const dropped: string[] = [];
  const family = ctx.family !== null && Object.hasOwn(FAMILIES, ctx.family) ? FAMILIES[ctx.family] : null;
  const backend = Object.hasOwn(BACKENDS, ctx.backend) && ctx.backend !== "unknown" ? BACKENDS[ctx.backend] : null;
  for (const [key, value] of Object.entries(overrides ?? {})) {
    const field = (FIELDS as readonly string[]).includes(key) ? (key as FieldId) : null;
    const refused = field !== null && (
      (family?.unsupportedFields !== undefined && Object.hasOwn(family.unsupportedFields, field))
      || backend?.fields[field] === "unsupported"
    );
    if (refused) dropped.push(key);
    else kept[key] = value;
  }
  return { kept, dropped };
}
