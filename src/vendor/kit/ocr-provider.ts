// vendored from obsidian-kit@0.45.0, src/pure/ocr-provider.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Öffentlicher Vertrag des Fähigkeits-Besitzers `image-to-markdown` (OCR) — Muster
 *  `pure/endpoint-source.ts`: EINE Quelle, der Besitzer re-exportiert sie, Konsumenten vendoren.
 *  Fehler sind Werte (`OcrProviderError`), Methoden fangen selbst — nie werfen. Form-Guard statt
 *  Versionskopie, siehe `audio-provider.ts` (dieselbe Begründung).
 *
 *  Die API abstrahiert über BACKENDS (mobil: Apple-Kurzbefehl/Vision-Framework, desktop: der
 *  bestehende Vision-LLM-Weg) — ein Konsument merkt den Unterschied nie. v1 ohne PDF (die werden
 *  erst gerendert; Spec § Nicht-Ziele). */
export const OCR_PROVIDER_API_VERSION = 1;

export type OcrProviderErrorCode = "backend-unavailable" | "not-found" | "timeout" | "busy" | "unsupported" | "failed";
export interface OcrProviderError { error: OcrProviderErrorCode; message: string }

export interface OcrProviderApi {
  version: 1;
  /** Bild (Vault-relativer Pfad) → erkannter Rohtext. */
  extractText(vaultPath: string): Promise<string | OcrProviderError>;
}

const METHODS = ["extractText"] as const;

export function isOcrProviderApi(x: unknown): x is OcrProviderApi {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.version !== OCR_PROVIDER_API_VERSION) return false;
  return METHODS.every((m) => typeof o[m] === "function");
}
