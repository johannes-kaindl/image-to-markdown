import type { Lang } from "./i18n";
import { buildDescribePrompt, parseDescription } from "./describe";
import type {
  DescribeProviderApi, DescribeProviderError, DescribeOptions, DescribeResult,
} from "./vendor/kit/describe-provider";
import { DESCRIBE_PROVIDER_API_VERSION } from "./vendor/kit/describe-provider";
import { isTruncated } from "./vendor/kit/sampling-profiles";
import type { OcrProviderApi } from "./vendor/kit/ocr-provider";
import { errorMessage } from "./vendor/kit/error-message";

/** Anbieter-API „Bild beschreiben“ (Kit-Vertrag `describe-provider`, obsidian-kit 0.95.0) — dünner Adapter wie `ocr_provider.ts`:
 *  der Vertrag kommt aus dem Kit, Prompt und Parser (`describe.ts`) bleiben Fachinhalt dieses Plugins. Die Datei ist rein (kein
 *  obsidian-Import); `deps.describeRaw` liest das Bild und fragt das Backend, hier wird nur geprüft, geparst und der Vertrag eingehalten. */
export interface DescribeRawOut { raw: string; model?: string; finishReason?: string }

export interface DescribeProviderDeps {
  /** Die Taxonomie der Einstellungen, Vorgabe für `DescribeOptions.categories`. */
  taxonomy(): string[];
  /** Sprache der Seitenleiste, wenn `opts.language` fehlt oder keine ist, die der Prompt kann (de, en). */
  defaultLang(): Lang;
  /** Bild lesen und das Vision-Backend fragen. Fehler als Wert (`not-found`, `unsupported`, `backend-unavailable`, …) oder Ausnahme (wird `failed`, `AbortError` wird `aborted`). */
  describeRaw(vaultPath: string, o: { prompt: string; signal?: AbortSignal }): Promise<DescribeRawOut | DescribeProviderError>;
}

/** BCP-47 → die Sprachen des Prompts; alles andere nimmt die Vorgabe des Plugins (der Vertrag erlaubt es: `language` ist ein Wunsch). */
function pickPromptLang(language: string | undefined, fallback: Lang): Lang {
  const l = language?.toLowerCase() ?? "";
  if (l === "de" || l.startsWith("de-")) return "de";
  if (l === "en" || l.startsWith("en-")) return "en";
  return fallback;
}

function isError(x: DescribeRawOut | DescribeProviderError): x is DescribeProviderError {
  return "error" in x;
}

/** Trägt `describeImage` auf demselben `api`-Objekt wie `extractText` (beide Verträge fordern `version: 1`). */
export function createDescribeProviderApi(base: OcrProviderApi, deps: DescribeProviderDeps): OcrProviderApi & DescribeProviderApi {
  const aborted = (): DescribeProviderError => ({ error: "aborted", message: "abgebrochen" });
  return {
    ...base,
    version: DESCRIBE_PROVIDER_API_VERSION,
    async describeImage(vaultPath: string, opts?: DescribeOptions): Promise<DescribeResult | DescribeProviderError> {
      const signal = opts?.signal;
      if (signal?.aborted) return aborted();
      const taxonomy = opts?.categories ? [...opts.categories] : deps.taxonomy();
      const prompt = buildDescribePrompt(taxonomy, pickPromptLang(opts?.language, deps.defaultLang()), opts?.length);
      let out: DescribeRawOut | DescribeProviderError;
      try {
        out = await deps.describeRaw(vaultPath, { prompt, ...(signal ? { signal } : {}) });
      } catch (e) {
        if (signal?.aborted || (e instanceof Error && e.name === "AbortError")) return aborted();
        return { error: "failed", message: errorMessage(e) };
      }
      if (isError(out)) return out;
      const parsed = parseDescription(out.raw, taxonomy);
      if (parsed.prose === "") {
        return { error: "failed", message: isTruncated(out.finishReason) ? "Antwort abgeschnitten, ohne Beschreibung" : "leere Beschreibung vom Modell" };
      }
      return {
        text: parsed.prose,
        ...(parsed.category ? { category: parsed.category } : {}),
        ...(parsed.tags.length > 0 ? { tags: parsed.tags } : {}),
        ...(out.model ? { model: out.model } : {}),
      };
    },
  };
}
