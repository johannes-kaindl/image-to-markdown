// vendored from obsidian-kit@0.95.0, src/pure/ocr-provider.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Öffentlicher Vertrag des Fähigkeits-Besitzers `image-to-markdown` (OCR) — Muster
 *  `pure/endpoint-source.ts`: EINE Quelle, der Besitzer re-exportiert sie, Konsumenten vendoren.
 *  Fehler sind Werte (`OcrProviderError`), Methoden fangen selbst — nie werfen. Form-Guard statt
 *  Versionskopie, siehe `audio-provider.ts` (dieselbe Begründung).
 *
 *  Die API abstrahiert über BACKENDS (mobil: Apple-Kurzbefehl/Vision-Framework, desktop: der
 *  bestehende Vision-LLM-Weg) — ein Konsument merkt den Unterschied nie. v1 ohne PDF (die werden
 *  erst gerendert; Spec § Nicht-Ziele). *
 *  **Abbruch (seit 0.93.0, additiv, v1 bleibt; Muster `describe-provider.ts`):** `extractText` bekommt ein optionales `signal`, der Fehlercode `aborted` ist neu. Der Vertrag sagt, was ein Anbieter tun muss, wenn er abbricht (Feld `signal`);
 *  ob das Backend dabei wirklich anhält, ist Sache des Anbieters und nicht Vertrag: ein Backend, das nicht anzuhalten ist, liefert trotzdem `aborted`, und für den Aufrufer endet das Warten. **Ein Anbieter vor 0.93.0** kennt `signal`
 *  nicht und ignoriert es: der Aufruf läuft zu Ende und liefert sein Ergebnis. Der Aufrufer, der abbrechen will, hört dann selbst auf zu warten (`Promise.race` gegen sein Signal) und verwirft das späte Ergebnis. Das Kit hat keinen
 *  Aufruf-Helfer, der den Anbieter ruft (`obsidian/capability-apis.ts` liest nur die API), also auch keinen, der das für einen alten Anbieter tut. `aborted` ist kein Fehler des Anbieters, sondern der Wunsch des Nutzers: `ocrErrorText` zeigt dafür einen eigenen Text. */
export const OCR_PROVIDER_API_VERSION = 1;
/** Plugin-ID des Besitzers (`image-to-markdown`): dort liegt die API unter `app.plugins.plugins[id].api`; gelesen mit `readOcrApi`. */
export const OCR_PLUGIN_ID = "image-to-markdown";

export type OcrProviderErrorCode = "backend-unavailable" | "not-found" | "timeout" | "busy" | "unsupported" | "aborted" | "failed";
export interface OcrProviderError { error: OcrProviderErrorCode; message: string }

export interface OcrOptions {
  /** Beendet den Aufruf. **Pflicht des Anbieters:** ein schon abgebrochenes Signal liefert `aborted`, ohne das Backend zu rufen; ein Abbruch währenddessen ebenso. Kann der Anbieter das Backend nicht anhalten, liefert er trotzdem `aborted` und verwirft das späte Ergebnis. */
  signal?: AbortSignal;
}

export interface OcrProviderApi {
  version: 1;
  /** Bild (Vault-relativer Pfad) → erkannter Rohtext. */
  extractText(vaultPath: string, opts?: OcrOptions): Promise<string | OcrProviderError>;
}

const METHODS = ["extractText"] as const;

export function isOcrProviderApi(x: unknown): x is OcrProviderApi {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.version !== OCR_PROVIDER_API_VERSION) return false;
  return METHODS.every((m) => typeof o[m] === "function");
}
