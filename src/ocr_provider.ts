import { OCR_PROVIDER_API_VERSION, type OcrProviderApi, type OcrProviderError, type OcrProviderErrorCode } from "./vendor/kit/ocr-provider";
import type { ShortcutResult } from "./vendor/kit-obsidian/shortcuts-bridge";

/** Anbieter-API v1 (Spec Baustein 4/D) — dünner Adapter über `deps.extractText`, Muster
 *  `lingotuner/src/core/api.ts` (Anbieter-Muster der REGISTRY): der Vertrag selbst kommt aus
 *  dem Kit (`vendor/kit/ocr-provider.ts`), diese Datei füllt ihn nur. `deps.extractText`
 *  wählt das Backend (Kurzbefehl mobil, Vision-LLM desktop) — die API merkt den Unterschied nie. */
export interface OcrProviderDeps {
  extractText(vaultPath: string): Promise<string | OcrProviderError>;
}

export function createOcrProviderApi(deps: OcrProviderDeps): OcrProviderApi {
  return {
    version: OCR_PROVIDER_API_VERSION,
    extractText: (vaultPath) => deps.extractText(vaultPath),
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
