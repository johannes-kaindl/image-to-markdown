// vendored from obsidian-kit@0.95.0, src/pure/describe-provider.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Öffentlicher Vertrag des Fähigkeits-Besitzers `image-to-markdown` (Bild beschreiben) — Muster `pure/ocr-provider.ts`: EINE Quelle, der Besitzer re-exportiert sie, Konsumenten vendoren.
 *  Fehler sind Werte (`DescribeProviderError`), Methoden fangen selbst — nie werfen. Form-Guard statt Versionskopie, siehe `audio-provider.ts` (dieselbe Begründung).
 *
 *  **Vertrag v1, von Anfang an eingefroren (Kit-Master, Welle 34, 2026-11-14), wie die Sanitizer-API (`filename-sanitizer-source.ts`):** Änderungen nur ADDITIV oder als v2 mit Übergang
 *  (`version: 2`, der Guard nimmt beide). Additiv heißt je Typ: `DescribeOptions` — ein neues optionales Feld ja; `DescribeResult` — ein neues optionales Feld ja, ein neues Pflichtfeld nein;
 *  `DescribeProviderError` — ein neues optionales Feld ja, ein neuer Wert in `error` ja, weil jeder Konsument einen unbekannten Code wie `failed` behandeln muss (`describeErrorText` tut es);
 *  `DescribeProviderApi` — eine neue OPTIONALE Methode ja (`isDescribeProviderApi` prüft nur `describeImage`), eine neue Pflichtmethode, eine andere Rückgabe oder `version` ungleich 1 nein.
 *  Ein entferntes, umbenanntes oder umgetyptes Feld ist v2. Gehalten wird die Form von `tests/describe-provider.types.test.ts`: `npm run typecheck` bricht bei einer nicht additiven Änderung.
 *
 *  **Die Rückgabe ist ein Objekt, kein Text wie bei `ocr-provider.ts`** (`extractText` → `string`), aus einem Grund: der Anbieter liefert eine Einordnung (Kategorie, Schlagwörter), die er
 *  schon hat, und die Option `categories` wäre ohne eine Kategorie im Ergebnis sinnlos. Ein Backend ohne Struktur (ein Kurzbefehl mobil) liefert nur `text` und bleibt gültig. Fehler und
 *  Ergebnis trennt `"error" in r`: `DescribeResult` kann keinen Schlüssel `error` tragen (der Typ-Test hält es fest).
 *
 *  Der Vertrag nimmt nichts von einem Abnehmer an (kein Gesprächs-, kein Tool-, kein Panel-Bezug): er beantwortet „was zeigt dieses Bild“. **Prompt und Parser sind Fachinhalt des Anbieters**
 *  und stehen nicht hier: der Konsument sieht nur `DescribeResult`. Die API abstrahiert über BACKENDS (Vision-LLM, mobil gegebenenfalls ein Kurzbefehl) — ein Konsument merkt den Unterschied nie.
 *  v1 beschreibt Bilder, kein PDF (die werden erst gerendert, wie bei OCR): ein PDF ist `unsupported`.
 *
 *  Der Besitzer trägt OCR und Beschreiben auf DEMSELBEN `api`-Objekt (`extractText` und `describeImage`), beide Verträge fordern `version: 1`: ein v2 des einen muss den Guard des anderen mitbedenken. */
export const DESCRIBE_PROVIDER_API_VERSION = 1;
/** Plugin-ID des Besitzers (`image-to-markdown`): dort liegt die API unter `app.plugins.plugins[id].api`; gelesen mit `readDescribeApi`. */
export const DESCRIBE_PLUGIN_ID = "image-to-markdown";

export type DescribeProviderErrorCode = "backend-unavailable" | "not-found" | "timeout" | "busy" | "unsupported" | "aborted" | "failed";
export interface DescribeProviderError { error: DescribeProviderErrorCode; message: string }

/** Wie ausführlich: ein Hinweis an den Anbieter, keine Zusage von Zeichen oder Sätzen. */
export type DescribeLength = "short" | "normal" | "long";

export interface DescribeOptions {
  /** BCP-47-Kürzel (`"de"`, `"en-GB"`), ein WUNSCH: der Anbieter antwortet in dieser Sprache, wenn er sie kann, sonst in seiner eigenen Vorgabe (welche, ist sein Verhalten, nicht Vertrag). */
  language?: string;
  /** Hinweis auf die Ausführlichkeit (Alt-Text: `"short"`, Suchindex: `"long"`); ohne Angabe wählt der Anbieter. */
  length?: DescribeLength;
  /** Auswahl für `DescribeResult.category`. Fehlt das Feld: die Taxonomie des Anbieters. Ein leeres Array: keine Kategorie gewünscht, das Ergebnis trägt dann kein `category`. */
  categories?: readonly string[];
  /** Beendet den Aufruf. **Pflicht des Anbieters:** ein schon abgebrochenes Signal liefert `aborted`, ohne das Backend zu rufen; ein Abbruch währenddessen ebenso. */
  signal?: AbortSignal;
}

export interface DescribeResult {
  /** Die Beschreibung. **Nie leer** (Pflicht des Anbieters): ein leeres Ergebnis des Backends ist `failed`. */
  text: string;
  /** Wurde `categories` übergeben (nicht leer), ist dies **wortgleich eines seiner Elemente** oder fehlt (Zusage an den Konsumenten, Pflicht des Anbieters); ohne `categories` ein Wert der Taxonomie des Anbieters. */
  category?: string;
  /** Freie Schlagwörter zum Bild, wenn das Backend sie liefert. */
  tags?: string[];
  /** Das Modell oder Backend, das beschrieben hat (Herkunft, etwa für Frontmatter), wenn bekannt. */
  model?: string;
}

export interface DescribeProviderApi {
  version: 1;
  /** Bild (Vault-relativer Pfad) → Beschreibung. Ein Pfad zu etwas, das kein Bild ist, ist `unsupported`, ein fehlender `not-found`. */
  describeImage(vaultPath: string, opts?: DescribeOptions): Promise<DescribeResult | DescribeProviderError>;
}

const METHODS = ["describeImage"] as const;

export function isDescribeProviderApi(x: unknown): x is DescribeProviderApi {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.version !== DESCRIBE_PROVIDER_API_VERSION) return false;
  return METHODS.every((m) => typeof o[m] === "function");
}
