// vendored from obsidian-kit@0.111.0, src/pure/filename-sanitizer-source.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/* VERTRAG v1, EINGEFROREN am 2026-11-14 (Entscheidung Johannes): `SanitizeResult`, `NameCheck`, `FilenameSanitizerApi` und `ApiError` (im Index `FilenameSanitizerApiError`) gelten
 * wie gebaut als Vertrag der Plugin-API v1; geändert werden sie nur ADDITIV oder als v2 mit Übergang (`version: 2`, `isFilenameSanitizerApi` nimmt beide, das Kit bedient beide, bis das
 * Plugin v1 abkündigt). Additiv heißt je Typ: `SanitizeResult` und `NameCheck` — ein neues OPTIONALES Feld ja, ein neuer Wert nein (`changed` und `valid` sind boolean, `hits` ist eine Liste);
 * `FilenameSanitizerApi` — eine neue OPTIONALE Methode ja (`isFilenameSanitizerApi` prüft nur `sanitizeName` und `checkName`), ein neues optionales Feld in `opts` ja, eine neue Pflichtmethode,
 * eine andere Rückgabe oder `version` ungleich 1 nein; `ApiError` — ein neues optionales Feld ja, ein neuer Wert in `error` ja, weil jeder Konsument einen unbekannten Fehler wie `not-ready`
 * behandeln muss (`safeFileName` fällt bei jedem `ApiError` auf die Kit-Regeln zurück und liest `error` gar nicht). Ein neues PFLICHTfeld, ein entferntes, umbenanntes oder umgetyptes Feld ist v2.
 * `FilenameHit` und `SegmentKind` gehören code-kit (`filename-policy`) und stehen außerhalb dieses Vertrags. Gehalten wird die Form von `tests/filename-sanitizer-source.types.test.ts`:
 * `npm run typecheck` bricht bei einer nicht additiven Änderung. */
import type { FilenameHit, SegmentKind } from "./filename-policy";

/** Vertrag der Plugin-API v1 des Plugins `filename-sanitizer` (Spec 2026-11-08, § 7), so wie ein schreibendes Plugin ihn braucht.
 *  Das Plugin besitzt die Dateinamen-Richtlinie (zulässige Zeichen, Ersetzungen, Ausnahmen); wer einen Namen schreibt, fragt zuerst
 *  `sanitizeName` und fällt ohne das Plugin auf `applyPolicy` mit `DEFAULT_FILENAME_POLICY` zurück (`safeFileName`, `src/obsidian/`).
 *  Alle Methoden sind synchron; Fehler sind Werte (`ApiError`), keine Ausnahmen. Die Datei hat keinen Import außer den Typen aus
 *  `filename-policy` (code-kit 0.62.0).
 *
 *  @example
 *  isFilenameSanitizerApi({ version: 1, sanitizeName() {}, checkName() {} }); // true */
export const FILENAME_SANITIZER_PLUGIN_ID = "filename-sanitizer";
export const FILENAME_SANITIZER_API_VERSION = 1;

export interface ApiError { error: "invalid-input" | "not-ready"; message: string }
export interface SanitizeResult { name: string; changed: boolean; hits: FilenameHit[] }
export interface NameCheck { valid: boolean; hits: FilenameHit[] }

export interface FilenameSanitizerApi {
  version: 1;
  /** `name` ist ein einzelnes Segment (nie ein Pfad); `caller` ist eine Selbstauskunft fürs Protokoll. */
  sanitizeName(name: string, opts: { caller: string; kind?: SegmentKind }): SanitizeResult | ApiError;
  checkName(name: string, opts?: { kind?: SegmentKind }): NameCheck | ApiError;
}

const METHODS = ["sanitizeName", "checkName"] as const;

/** Form-Prüfung statt Vertrauen: ein Fremdplugin bekommt kein TS-Vertrauen geschenkt. */
export function isFilenameSanitizerApi(x: unknown): x is FilenameSanitizerApi {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.version !== FILENAME_SANITIZER_API_VERSION) return false;
  return METHODS.every((m) => typeof o[m] === "function");
}
