// vendored from code-kit@0.7.0, src/ts/pure/error_body.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Lesbare Fehlermeldung aus einem JSON-Fehlerkörper eines OpenAI-kompatiblen bzw.
 *  FastAPI-/DRF-artigen Servers. Eine Kaskade über vier Quellen, mehr nicht — kein
 *  Transport, kein Status-Wissen, keine Übersetzung. Wer nichts findet, bekommt `null`
 *  und nimmt seinen eigenen Rohtext-Fallback.
 *
 *  Kanonische Quelle: `image-to-markdown/src/vision_client.ts` → `parseErrorEnvelope`
 *  (2026-06-28) — die älteste UND vollständigste der sieben gemessenen Fassungen.
 *  Zusammengeführt wurden (Stand 2026-08-19, sieben Instanzen in drei Bauformen):
 *    - `parseErrorEnvelope`  — image-to-markdown (2026-06-28), markdown-presentation
 *      `src/llm/error-envelope.ts` (2026-07-02); Funktionskörper byte-identisch, es
 *      unterscheidet sich nur der Doc-Kommentar (deutsch/englisch).
 *    - `extractErrorMessage` — vault-crews `src/core/chat-response.ts` (2026-07-12),
 *      vault-rag `src/chat_error.ts` (2026-08-05), koda-agent
 *      `src/core/llm/chat-error.ts` (2026-08-05); letztere beide byte-identisch.
 *    - `extractErrorMessage` — paperless-storage `src/core/errors.ts` (2026-08-06),
 *      dieselbe Kaskade, aber mit eigenem `JSON.parse` und `string`-Eingang.
 *    - private `errorMessage`  — obsidian-transmute `src/core/llm/client.ts` (2026-07-25),
 *      string-in/string-out, kannte nur `error` und `error.message`.
 *
 *  ⚠️ Zwei Bugs, die diese Zusammenführung schliesst — beim Übernehmen ändert sich also
 *  Verhalten, und zwar in Fix-Richtung:
 *  1. **`detail` fehlte in zwei Fassungen.** vault-crews kennt die FastAPI-Form
 *     `{"detail":"Not authenticated"}` bis heute nicht (vault-rag hat sie am 2026-08-05
 *     genau deswegen nachgerüstet), obsidian-transmute kennt weder `detail` noch
 *     `message`. Dort zeigte das UI rohes JSON statt der Servermeldung.
 *  2. **Leerer String galt als Treffer.** Vier Fassungen gaben für
 *     `{"error":"","message":"model not found"}` den leeren String zurück. `""` ist nicht
 *     nullish — der `?? rawBody`-Fallback der Aufrufer griff also NICHT, und der Nutzer
 *     sah `HTTP 400: ` ohne Fehlertext. Hier fallen leere/Whitespace-Werte durch, und
 *     jeder Treffer wird getrimmt.
 *
 *  Bewusste Entscheidungen ohne Option, damit sie nicht still verloren gehen:
 *  - **`message` vor `detail`** (Mehrheit 4:2; `parseErrorEnvelope` prüfte `detail`
 *    zuerst). Beobachtbar nur bei einem Körper, der BEIDE Felder als String trägt — kein
 *    Test in keinem der sieben Repos deckt den Fall ab, kein realer Dialekt schickt beides.
 *  - **`error.message` vor `error`-als-String** (`parseErrorEnvelope` prüfte umgekehrt).
 *    Wirkungslos: ein Wert kann nicht gleichzeitig Objekt und String sein.
 *  - **Arrays sind kein Record** (strenge vault-*-Form). Für jede beobachtete Eingabe
 *    wirkungsgleich zur lockeren Form: `[].error` ist ohnehin `undefined`.
 *
 *  NICHT mitgenommen, obwohl es in denselben Dateien wohnt: `isContextOverflow`,
 *  `extractChatContent`, `ChatHttpError`/`PaperlessHttpError`, `chatErrorMessage`.
 *  Eigene Kandidaten mit eigener Zählung und teils offener Bauform-Frage. */

/** Steuert, wie viel der Aufrufer über den Körper schon weiss. */
export interface ErrorBodyOptions {
  /** `true`, wenn der Aufrufer NOCH NICHT weiss, ob der Körper überhaupt ein Fehler ist —
   *  LM Studio & Co. beantworten Fehler mit **HTTP 200 + `{error:{message}}`**, und ein
   *  SSE-Stream ohne `data:`-Zeile sieht genauso aus. Dann werden die Top-Level-Felder
   *  `message`/`detail` ignoriert, sobald der Körper ein `choices`-Feld trägt: sonst liest
   *  man ein Streufeld neben einer gültigen Completion als Fehler.
   *
   *  ⚠️ Der Wächter umfasst NUR `message`/`detail`. `error`/`error.message` gelten
   *  weiterhin, auch neben `choices` — genau dafür existiert der HTTP-200-Fehlerpfad.
   *
   *  Default `false`: der Aufrufer kam bereits über einen Fehlerpfad (Status != 2xx, oder
   *  die Content-Extraktion hat schon `null` geliefert) und darf jedes Feld lesen. */
  bodyMayBeSuccess?: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Getrimmter String oder null — leer und nur-Whitespace zählen als „nicht vorhanden". */
function trimmedString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s === "" ? null : s;
}

/** Lesbare Meldung aus einem BEREITS GEPARSTEN JSON-Fehlerkörper.
 *
 *  Reihenfolge: `error.message` → `error` (String) → `message` → `detail`.
 *  Leere und nur-Whitespace-Werte fallen durch, jeder Treffer wird getrimmt.
 *
 *  @param body beliebiger `unknown` — Nicht-Objekte, `null` und Arrays ergeben `null`.
 *  @param opts s. {@link ErrorBodyOptions}; ohne Optionen wird jedes Feld gelesen.
 *  @returns die Meldung, oder `null` wenn kein Feld greift. Der Aufrufer nimmt dann
 *    seinen Rohtext (`errorMessageFromBody(x) ?? raw.slice(0, 300)`).
 *
 *  @example errorMessageFromBody({ error: { message: "model not found" } }) // → "model not found"
 *  @example errorMessageFromBody({ detail: "Not authenticated" }) // → "Not authenticated"
 *  @example errorMessageFromBody({ choices: [], detail: "stray" }, { bodyMayBeSuccess: true }) // → null */
export function errorMessageFromBody(body: unknown, opts?: ErrorBodyOptions): string | null {
  if (!isRecord(body)) return null;

  const err = body.error;
  if (isRecord(err)) {
    const nested = trimmedString(err.message);
    if (nested !== null) return nested;
  }
  const flat = trimmedString(err);
  if (flat !== null) return flat;

  // Ab hier nur noch Felder, die auch in einer gültigen Completion vorkommen können.
  if (opts?.bodyMayBeSuccess === true && "choices" in body) return null;

  return trimmedString(body.message) ?? trimmedString(body.detail);
}

/** Wie {@link errorMessageFromBody}, parst den Rohtext aber selbst.
 *
 *  Existiert, damit KEIN Aufrufer den `try/catch`-JSON.parse noch einmal schreibt — vier
 *  der sieben Quell-Fassungen taten genau das, jede mit leicht anderem Leerwert-Guard.
 *
 *  @param text Rohbody der Antwort. Leer/nur-Whitespace, kaputtes JSON und JSON, das kein
 *    Objekt ergibt (HTML-Fehlerseite, `"null"`, `"[]"`, `"123"`), ergeben `null`.
 *  @param opts s. {@link ErrorBodyOptions}.
 *
 *  @example errorMessageFromText('{"error":"bad request"}') // → "bad request"
 *  @example errorMessageFromText("<html>502</html>") // → null */
export function errorMessageFromText(text: string, opts?: ErrorBodyOptions): string | null {
  if (text.trim() === "") return null;
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    // Kein JSON — der Rohtext ist die beste verfügbare Meldung, aber das entscheidet
    // der Aufrufer (er kennt sein Kürzungsmass), nicht diese Funktion.
    return null;
  }
  return errorMessageFromBody(body, opts);
}
