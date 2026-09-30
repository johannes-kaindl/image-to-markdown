// Textbausteine fuer Abweichungen (Sampling-Plan § 5.3): eine Zuordnung, von der Session-Notice
// UND dem Abschnitt „Anfrage" (Statuszeile) genutzt — nie zweimal formuliert. Obsidian-frei.
import { t } from "./i18n";
import type { Deviation, DeviationKind } from "./vendor/kit/sampling-profiles";

const KEY: Record<DeviationKind, string> = {
  "thinking-despite-off": "request.dev.thinkingDespiteOff",
  "empty-by-budget": "request.dev.emptyByBudget",
  "family-mismatch": "request.dev.familyMismatch",
  "family-detected": "request.dev.familyDetected",
  "rejected": "request.dev.rejected",
};

export function deviationDetail(kind: DeviationKind, detail?: string): string {
  return detail !== undefined ? t(KEY[kind], detail) : t(KEY[kind]);
}

/** Notice-Text: nur fuer Abweichungen mit `affectsResult` aufgerufen (Vertrag von
 *  `createRequestSession`). */
export function deviationNotice(d: Deviation): string {
  return `${deviationDetail(d.kind, d.detail)} ${t("request.dev.seeSettings")}`;
}
