// vendored from code-kit@0.7.0, src/ts/web/clipboard.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Text in die Zwischenablage schreiben — obsidian-frei, in Node testbar (PROF-OBS-03/04).
 *  Das Kit formuliert **keine** Meldung und kennt weder `Notice` noch `t()`: Erfolg und
 *  Fehlschlag kommen als Callbacks zurück, die Quittung baut der Consumer. Das ist keine
 *  Reinheits-Kosmetik, sondern erzwungen — die Konsumenten haben drei unvereinbare
 *  Meldungsquellen (Literal in `json_viewer`, `t(key)` in `apple-health`/`vault-rag`,
 *  `t(key, lang)` mit anderer Arität in `kuro-gamification`).
 *
 *  Kanonische Quelle: `json_viewer/src/obsidian/clipboard.ts` (`copyToClipboard`, 2026-06-13).
 *  `apple-health/src/obsidian/clipboard.ts` (2026-07-28) hat sie mit Herkunftsstempel
 *  übernommen; beide waren beim Heben ins Kit (2026-08-19) bis auf den Meldungs-Ausdruck
 *  zeichengleich — eine **Kopier-Kette, kein unabhängiger Zweitbeleg**. Den Zähler liefern
 *  die zehn ungeschützten Inline-Fassungen in `image-to-markdown`, `vault-rag` (2×),
 *  `finance-ledger-plugin`, `markdown-presentation`, `kuro-gamification` (3×),
 *  `obsidian-transmute` und `json_viewer/src/obsidian/CodeblockProcessor.ts`.
 *
 *  ⚠️ Beim Übernehmen zu beachten — fünf Fallen, jede davon in mindestens einem Repo gemessen:
 *
 *  1. **Der Property-READ ist die gefährliche Stelle, nicht der Aufruf.** `navigator.clipboard`
 *     steht in allen heutigen Fassungen nackt da. Die Kommentare dort behaupten, das Lesen
 *     werfe in non-secure Contexts synchron; belegt ist das nicht — `Clipboard` ist
 *     `[SecureContext]`-gated, dann ist das Property schlicht `undefined`. Beide Lesarten sind
 *     hier abgedeckt (try + Falsy-Guard), weil der try drei Zeilen kostet und die Antwort auf
 *     die Frage nicht braucht. Er fängt zusätzlich den realen Fall, dass `navigator` global
 *     gar nicht existiert (ReferenceError).
 *  2. **Die Erfolgsmeldung gehört in `onCopied`, nicht hinter den Aufruf.** Vier Aufrufstellen
 *     setzen heute `new Notice("Kopiert")` unmittelbar hinter ein `void …writeText(…)`. Lehnt
 *     `writeText` ab (Fokusverlust, Permission — der Normalfall auf Android und im
 *     unfokussierten Electron-Fenster), sieht der Nutzer „Kopiert" bei leerer Zwischenablage.
 *  3. **Das zurückgegebene Promise rejectet nie** und resolved `true`/`false`. Elf Aufrufstellen
 *     sind synchrone Klick-Handler → `void writeClipboard(…)`; die eine, die das Ergebnis
 *     braucht (`obsidian-transmute/src/obsidian/view.ts`), `await`et es. Ein `catch` ist an
 *     keiner Stelle nötig — und wäre auch nutzlos.
 *  4. **`error` in `onFailed` ist IMMER gesetzt.** Ein Consumer, der die Meldung aus dem Fehler
 *     baut (`t("view.copyFailed", err.message)`), darf nie „undefined" rendern; fehlt ein
 *     Plattform-Fehler, liefert das Kit einen eigenen `Error`.
 *  5. **Callbacks sind Consumer-Code und werden nicht abgeschirmt.** Wirft `onCopied`/`onFailed`
 *     selbst, propagiert das (auf dem `unavailable`-Pfad synchron, sonst als Rejection) — ein
 *     Kit, das Consumer-Bugs schluckt, macht sie unauffindbar. Die „wirft nie"-Zusage gilt dem
 *     Kopiervorgang, nicht fremdem Code.
 *
 *  Der `unavailable`-Pfad ruft `onFailed` **synchron**, noch vor der Rückgabe. Das ist
 *  load-bearing: `json_viewer/tests/obsidian/CopyButton.test.ts` prüft die Fehler-Notice
 *  unmittelbar nach `btn.click()`, ohne Microtask-Flush. Ein Deferred-Aufruf bräche diesen
 *  Test still. */

/** Grund eines Fehlschlags. Bewusst zwei Werte, weil sie verschiedene Meldungen verdienen:
 *  - `"unavailable"` — es gibt hier keine Clipboard-API (Property fehlt/wirft, `writeText`
 *    fehlt, `navigator` existiert nicht). Retry hilft nicht, die Umgebung kann es nicht.
 *  - `"denied"` — die API war da, der Schreibvorgang schlug fehl (abgelehntes Promise oder
 *    synchroner Wurf aus `writeText`). Deckt Permission-Verweigerung **und** transiente
 *    Gründe wie fehlenden Dokument-Fokus ab; ein Retry kann hier durchaus klappen.
 *
 *  Die Literale sind öffentlich: ein Consumer darf auf ihnen verzweigen (z. B. „unavailable"
 *  still schlucken, „denied" melden). Umbenennen bricht solche Stellen still. */
export type CopyFailure = "unavailable" | "denied";

/** Rückmeldungs-Ports für `writeClipboard`. Beide optional — `writeClipboard(text)` ohne
 *  Optionen ist ein legitimer Fire-and-forget-Aufruf (`markdown-presentation/src/settings.ts`
 *  kopiert so einen Theme-Namen ohne jede Quittung). */
export interface ClipboardOptions {
  /** Erfolg. Hier gehört die Quittung hin — Notice, Knopf-Flash, was auch immer.
   *  Wird höchstens einmal gerufen und nie zusammen mit `onFailed`. */
  onCopied?: () => void;
  /** Fehlschlag. `error` ist immer gesetzt: der geworfene bzw. abgelehnte Grund der
   *  Plattform, oder — wenn die Plattform keinen liefert — ein vom Kit erzeugter
   *  `Error("Clipboard API unavailable")`. Wird höchstens einmal gerufen. */
  onFailed?: (reason: CopyFailure, error: unknown) => void;
}

/** Ersatz-Fehler für den Fall, dass die API schlicht fehlt und die Plattform selbst
 *  nichts wirft — damit `onFailed` seine `error`-Zusage auch dort halten kann. */
const UNAVAILABLE_MESSAGE = "Clipboard API unavailable";

/** Schreibt `text` in die Zwischenablage.
 *
 *  Wirft nie — weder synchron noch als Rejection (Ausnahme: ein Callback des Consumers wirft
 *  selbst, s. Modulkopf). Das Promise resolved `true` genau dann, wenn `writeText` erfolgreich
 *  war und `onCopied` gerufen wurde, sonst `false`.
 *
 *  `text` wird unverändert durchgereicht, auch der leere String — „nichts kopieren" ist eine
 *  gültige Absicht (Feld leeren) und wird nicht zu einem Fehlschlag umgedeutet.
 *
 *  @example void writeClipboard(text, { onCopied: () => new Notice(t("copied")) });
 *  @example if (await writeClipboard(text)) markDone(); */
export function writeClipboard(text: string, opts: ClipboardOptions = {}): Promise<boolean> {
  let clipboard: Clipboard | undefined;
  try {
    clipboard = navigator.clipboard;
  } catch (err) {
    // Property-Read selbst geworfen (non-secure Context laut Quell-Kommentaren; real
    // reproduzierbar, wenn `navigator` global fehlt). Genau die Zeile, die keine der
    // beiden Vorlagen abgesichert hat.
    opts.onFailed?.("unavailable", err);
    return Promise.resolve(false);
  }
  if (!clipboard || typeof clipboard.writeText !== "function") {
    opts.onFailed?.("unavailable", new Error(UNAVAILABLE_MESSAGE));
    return Promise.resolve(false);
  }

  let pending: Promise<void>;
  try {
    pending = clipboard.writeText(text);
  } catch (err) {
    // Manche WebView-Shims werfen synchron statt abzulehnen.
    opts.onFailed?.("denied", err);
    return Promise.resolve(false);
  }
  // `Promise.resolve` reicht ein echtes Promise identisch durch (kein zusätzlicher Tick) und
  // fängt Shims ab, die statt eines Promise `undefined` liefern — dort wäre `.then` ein
  // synchroner TypeError, also genau der Wurf, den diese Funktion ausschließen soll.
  return Promise.resolve(pending).then(
    () => { opts.onCopied?.(); return true; },
    (err: unknown) => { opts.onFailed?.("denied", err); return false; },
  );
}
