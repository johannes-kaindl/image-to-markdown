// Übersetzt das Ergebnis der Kit-Verbindung (`llm.complete`) in die Form, die die View seit jeher
// bekommt: Ergebnis oder Fehler mit nutzersichtbarem Satz. Der Kit-Client liefert nur `kind` + Servermeldung;
// den Satz baut das Plugin (UI-STANDARD §10). Reiner Kern ohne obsidian-Import.
import type { LlmResult } from "./vendor/kit-obsidian/llm-connection";
import { managerErrorText, resolveLlmConnectionStrings } from "./vendor/kit-obsidian/llm-connection-strings";
import { getLang, t } from "./i18n";

export interface ChatOut { content: string; reasoning: string; model: string; finishReason?: string }

/** Ergebnis oder Fehler. „Abgeschnitten ohne Text“ ist im Kit ein Ergebnis mit `finishReason:
 *  "length"` (Default-Richtlinie `truncated: "result"`) — der Aufrufer zeigt dafür die eigene
 *  Meldung (Reasoning-Modelle: das Denken frisst das Budget). */
export function chatOutOrThrow(r: LlmResult): ChatOut {
  if (r.ok) {
    return {
      content: r.content, reasoning: r.reasoning, model: r.model ?? r.source.model,
      ...(r.finishReason !== undefined ? { finishReason: r.finishReason } : {}),
    };
  }
  // Abbruch bleibt ein `AbortError`: die View unterscheidet ihn über `signal.aborted`, aber ein Nutzer
  // von `transcribeStream` darf sich weiter auf den Namen verlassen.
  if (r.kind === "aborted") { const e = new Error(r.detail); e.name = "AbortError"; throw e; }
  // Mit Manager nennt die Meldung den Grund, den der Manager meldet (Kit-Text je Code: Schluessel fehlt, abgeschaltet, Wahl weg, …);
  // ohne ihn der eigene Satz mit der Konfigurationsmeldung der lokalen Liste.
  if (r.kind === "no-endpoint") {
    throw new Error(r.source.kind === "manager" ? managerErrorText(resolveLlmConnectionStrings({ lang: getLang() }), r.detail) : t("error.noEndpoint", r.detail));
  }
  if (r.kind === "timeout") throw new Error(t("chat.err.timeout", r.detail));
  if (r.kind === "network") throw new Error(t("chat.err.network", r.detail));
  if (r.kind === "overflow") throw new Error(t("chat.err.overflow", r.detail));
  throw new Error("status" in r && r.status !== undefined ? t("chat.err.http", r.status, r.detail) : t("chat.err.response", r.detail));
}
