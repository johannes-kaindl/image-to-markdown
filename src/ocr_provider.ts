import { OCR_PROVIDER_API_VERSION, type OcrOptions, type OcrProviderApi, type OcrProviderError, type OcrProviderErrorCode } from "./vendor/kit/ocr-provider";
import type { ShortcutResult } from "./vendor/kit-obsidian/shortcuts-bridge";

/** Anbieter-API v1 (Spec Baustein 4/D) — dünner Adapter über `deps.extractText`, Muster
 *  `lingotuner/src/core/api.ts` (Anbieter-Muster der REGISTRY): der Vertrag selbst kommt aus
 *  dem Kit (`vendor/kit/ocr-provider.ts`), diese Datei füllt ihn nur. `deps.extractText`
 *  wählt das Backend (Kurzbefehl mobil, Vision-LLM desktop) — die API merkt den Unterschied nie. */
export interface OcrProviderDeps {
  extractText(vaultPath: string, opts?: OcrOptions): Promise<string | OcrProviderError>;
}

const ABORTED: OcrProviderError = { error: "aborted", message: "abgebrochen" };

/** Abbruch nach Kit-Vertrag 0.93.0 (Muster `createDescribeProviderApi`): ein schon abgebrochenes Signal liefert `aborted` OHNE Backend-Aufruf; ein Abbruch währenddessen
 *  ebenso, und das Warten endet sofort, auch wenn das Backend sich nicht anhalten lässt (der Kurzbefehl läuft zu Ende, sein spätes Ergebnis wird verworfen). */
export function createOcrProviderApi(deps: OcrProviderDeps): OcrProviderApi {
  return {
    version: OCR_PROVIDER_API_VERSION,
    async extractText(vaultPath, opts) {
      const signal = opts?.signal;
      if (signal?.aborted) return ABORTED;
      const call = deps.extractText(vaultPath, signal ? { signal } : undefined);
      if (!signal) return call;
      let onAbort: (() => void) | undefined;
      const gone = new Promise<OcrProviderError>((resolve) => {
        onAbort = () => resolve(ABORTED);
        signal.addEventListener("abort", onAbort, { once: true });
      });
      try {
        const out = await Promise.race([call, gone]);
        return signal.aborted ? ABORTED : out;
      } catch (e) {
        if (signal.aborted || (e instanceof Error && e.name === "AbortError")) return ABORTED;
        throw e;
      } finally {
        if (onAbort) signal.removeEventListener("abort", onAbort);
        // Verlor der Wettlauf, darf ein spät abgelehnter Backend-Aufruf nicht unbehandelt bleiben.
        call.catch(() => undefined);
      }
    },
  };
}

/** Bildet ein `ShortcutResult` der Brücke auf den Anbieter-Vertrag ab. Reine Funktion, damit die
 *  Fehlersemantik ohne Obsidian-Mock testbar ist. `file-missing` kommt für OCR nicht vor (kein
 *  `expectFile` im Request) — falls doch, ist es ein Bridge-Defekt, kein Nutzerfehler, deshalb
 *  "failed" statt eines eigenen Codes. */
export function shortcutResultToOcr(r: ShortcutResult): string | OcrProviderError {
  if (r.ok) return r.result;
  const codes: Record<Exclude<ShortcutResult, { ok: true }>["reason"], OcrProviderErrorCode> = {
    timeout: "timeout",
    busy: "busy",
    error: "failed",
    cancel: "failed",
    "file-missing": "failed",
  };
  return { error: codes[r.reason], message: r.message };
}
