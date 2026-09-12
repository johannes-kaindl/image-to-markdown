// vendored from obsidian-kit@0.34.1, src/obsidian/clipboard.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// ONE mechanical deviation from verbatim: kit-internal imports (../pure/ and ../vendor/code-kit/{pure,web}/) → ../kit/ (vendor layout); reproduce on every re-vendor, nothing else may differ.
/** Zwischenablage **mit Quittung**: bindet `writeClipboard` aus `pure/clipboard` an Obsidians
 *  `Notice`. Der Kopiervorgang selbst steht vollständig dort — hier liegt nur die Entscheidung,
 *  wann welche Meldung erscheint. Wer gar keine Notice will (Quittung am Knopf, stiller
 *  Fallback), ruft `writeClipboard` direkt; dieses Modul ist die Bequemlichkeit für die neun
 *  der zwölf gemessenen Aufrufstellen, die eine Notice zeigen.
 *
 *  Kanonische Quelle: `json_viewer/src/obsidian/clipboard.ts` (`copyToClipboard`, 2026-06-13),
 *  übernommen mit Herkunftsstempel nach `apple-health/src/obsidian/clipboard.ts` (2026-07-28).
 *  Zusammengeführt sind (a) diese beiden — sie unterschieden sich NUR im Meldungs-Ausdruck
 *  (`"Copy failed"` vs. `t("export.copyFailed")`), also einer Kopier-Kette, kein Zweitbeleg —
 *  und (b) die vier Inline-Fassungen mit unbedingter Erfolgs-Notice:
 *  `image-to-markdown/src/main.ts:349`, `vault-rag/src/main.ts:415`, `vault-rag/src/settings.ts:659`,
 *  `finance-ledger-plugin/26-011-finanzplan-plugin/src/views/TBCPanel.ts:42`. Aus
 *  `obsidian-transmute/src/obsidian/view.ts:430` kommt der Fall „Fehlermeldung aus dem Fehler
 *  bauen", aus `kuro-gamification` (3 Stellen) der Fall „Fehlschlag ohne jede Notice".
 *
 *  ⚠️ Beim Übernehmen zu beachten — fünf Punkte:
 *
 *  1. **Die Erfolgs-Notice erscheint erst NACH erfolgreichem Schreiben. Das ist eine bewusste
 *     Verhaltensänderung.** Die vier oben genannten Stellen zeigen sie heute unbedingt
 *     (`void navigator.clipboard.writeText(text); new Notice(t("copied"))`). Lehnt `writeText`
 *     ab — Fokusverlust oder Permission, der Normalfall auf Android und im unfokussierten
 *     Electron-Fenster —, liest der Nutzer dort „Kopiert" bei leerer Zwischenablage. Wer dieses
 *     Modul vendoriert und die Notice daneben unbedingt stehen lässt, hat es umsonst vendoriert.
 *  2. **`copiedMessage` und `failedMessage` sind asymmetrisch — Absicht, kein Versehen.** Für den
 *     Erfolg gibt es keinen Kit-Default: `undefined` heißt „keine Notice". „Kopiert" ist ein Satz
 *     in der Sprache des Consumers, und drei Aufrufstellen quittieren am Knopf oder gar nicht
 *     (`apple-health`, `json_viewer`, `markdown-presentation`) — ein Default wäre dort eine neue,
 *     ungewollte Notice. Für den Fehlschlag gibt es einen (`"Copy failed"`, Präzedenz
 *     `ConfirmOptions.confirmLabel ?? "Confirm"`): beide Vorlagen hatten genau diesen Text
 *     hartkodiert, und `json_viewer/tests/obsidian/clipboard.test.ts:27` prüft ihn per
 *     `/copy failed/i`. Stumm im Fehlerfall ist deshalb `failedMessage: null`, nicht `undefined`.
 *  3. **Das Kit ruft nie ein `t()`.** Beide Meldungen sind fertige Strings. Erzwungen, nicht
 *     kosmetisch: `json_viewer` hat gar keine i18n, `apple-health`/`vault-rag` nutzen `t(key)`,
 *     `kuro-gamification` ein `t(key, lang)` mit anderer Arität als die Kit-Fassung
 *     (`kuro-gamification/src/i18n/index.ts:12`).
 *  4. **Auf dem `unavailable`-Pfad erscheint die Notice SYNCHRON**, noch vor der Rückgabe —
 *     `writeClipboard` ruft `onFailed` dort synchron. Das ist load-bearing:
 *     `json_viewer/tests/obsidian/CopyButton.test.ts` prüft die Fehler-Notice unmittelbar nach
 *     `btn.click()`, ohne Microtask-Flush. Diese Schicht fügt keinen Tick hinzu; wer das ändert,
 *     bricht den Test still.
 *  5. **Notice zuerst, Callback danach.** `onCopied`/`onFailed` sind Consumer-Code und werden —
 *     wie in `pure/clipboard` — nicht abgeschirmt: wirft ein Callback, propagiert das (auf dem
 *     `unavailable`-Pfad synchron, sonst als Rejection). Die Quittung steht dann trotzdem schon,
 *     weil sie vor dem Callback ausgelöst wird. Die „wirft nie"-Zusage gilt dem Kopiervorgang,
 *     nicht fremdem Code — und auch `failedMessage` als Funktion ist fremder Code. */
import { Notice } from "obsidian";
import { writeClipboard } from "../kit/clipboard";
import type { ClipboardOptions, CopyFailure } from "../kit/clipboard";

/** Meldung, wenn nicht kopiert werden konnte — der Kit-Default, wenn `failedMessage` fehlt.
 *  Wortgleich mit beiden Vorlagen; `json_viewer` testet gegen `/copy failed/i`. */
const DEFAULT_FAILED_MESSAGE = "Copy failed";

/** Optionen von `copyToClipboard` — die Rückmeldungs-Ports aus `pure/clipboard` plus die
 *  beiden Notice-Texte. Callbacks und Notices sind unabhängig: `onCopied` quittiert am Knopf,
 *  `copiedMessage` am Bildschirmrand, beides zusammen ist erlaubt (aber selten sinnvoll). */
export interface CopyToClipboardOptions extends ClipboardOptions {
  /** Erfolgs-Notice. **Kein Default** — weggelassen heißt „keine Notice" (s. Modulkopf, Punkt 2).
   *  Der leere String erzeugt eine leere Notice und ist damit fast immer ein fehlender
   *  Übersetzungs-Key; das Kit deutet ihn NICHT in „keine Notice" um, sonst verschwände der
   *  Fehler lautlos. */
  copiedMessage?: string;
  /** Fehlschlag-Notice. Vier Formen:
   *  - weggelassen → `"Copy failed"` (Kit-Default, s. Modulkopf Punkt 2),
   *  - `string` → dieser Text,
   *  - Funktion → bekommt Grund und Fehler und baut den Text (`obsidian-transmute`:
   *    `(_r, err) => t("view.copyFailed", err instanceof Error ? err.message : String(err))`);
   *    `error` ist dabei IMMER gesetzt, nie `undefined` — dafür sorgt `pure/clipboard`,
   *  - `null` → **keine** Notice; der Consumer meldet selbst über `onFailed` oder gar nicht
   *    (`kuro-gamification`: `ta.select()`; `markdown-presentation`: still). */
  failedMessage?: string | ((reason: CopyFailure, error: unknown) => string) | null;
}

/** Löst `failedMessage` zu einem Text auf — oder zu `null` für „keine Notice". */
function failureText(
  spec: CopyToClipboardOptions["failedMessage"],
  reason: CopyFailure,
  error: unknown,
): string | null {
  if (spec === null) return null;
  if (spec === undefined) return DEFAULT_FAILED_MESSAGE;
  return typeof spec === "function" ? spec(reason, error) : spec;
}

/** Schreibt `text` in die Zwischenablage und quittiert per `Notice`.
 *
 *  Genau eine Notice pro Aufruf, nie beide — Erfolg und Fehlschlag schließen einander aus.
 *  Das Promise resolved `true` bei Erfolg, `false` bei jedem Fehlschlag, und rejectet nie
 *  (Ausnahme: Consumer-Code wirft selbst, s. Modulkopf Punkt 5). `void` genügt an den elf
 *  synchronen Klick-Handlern, `await` nur dort, wo das Ergebnis den weiteren Ablauf steuert.
 *
 *  @example void copyToClipboard(text, { copiedMessage: t("main.copied") });
 *  @example void copyToClipboard(text, { onCopied: () => flashCopied(btn) }); // Quittung am Knopf
 *  @example void copyToClipboard(ta.value, { failedMessage: null, onFailed: () => ta.select() }); */
export function copyToClipboard(text: string, opts: CopyToClipboardOptions = {}): Promise<boolean> {
  return writeClipboard(text, {
    onCopied: () => {
      if (opts.copiedMessage !== undefined) new Notice(opts.copiedMessage);
      opts.onCopied?.();
    },
    onFailed: (reason, error) => {
      const message = failureText(opts.failedMessage, reason, error);
      if (message !== null) new Notice(message);
      opts.onFailed?.(reason, error);
    },
  });
}
