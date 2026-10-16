// vendored from code-kit@0.28.0, src/ts/pure/safe-markdown.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// uebernommen aus settings-assistant/src/core/chat-markdown.ts, 2026-10-09
/** Neutralises Markdown from an untrusted source (a model answer) BEFORE it is handed to a
 *  Markdown renderer. Pure, no dependencies.
 *
 *  Why: Obsidian's `MarkdownRenderer.render` runs everything registered in the vault, not only
 *  the core. A model answer that contains a fenced block with a language tag
 *  (```` ```dataviewjs ````, `~~~dataview`, …) starts that plugin's code-block processor — for
 *  Dataview JS that is arbitrary code in the renderer. Inline code such as `` `$= dv.pages()` ``
 *  is executed the same way, and remote images and embeds (`![…](url)`, `![[…]]`) load on their
 *  own and can carry context out. Raw HTML (`<img>`, `<iframe>`, `<script>`) is the third door.
 *
 *  Where it applies: obsidian-kit's stable-writer calls it by default on the text it renders;
 *  a consumer that renders model output through another path calls it before the renderer.
 *  The function is idempotent, so applying it in addition to that default is safe.
 *
 *  Strategy: REMOVE instead of RECOGNISE. Any version that detects fences or code spans and
 *  rewrites them selectively eventually reads line endings (`\r`, `\r\n`), indents, backtick
 *  lengths and multi-line spans differently from the renderer. So the ability to produce code
 *  elements is removed:
 *  1. EVERY backtick (U+0060) becomes U+02CB "ˋ" — no backtick fences, no inline code spans.
 *  2. EVERY run of three or more tildes becomes as many U+02DC "˜" — no tilde fences, whatever
 *     the indent, quote or list prefix and whatever the line ending. (`~~` strikethrough stays.)
 *  3. Images become text, `![[…]]` becomes literal `[[…]]` (escaped, no link), every `<` becomes
 *     `&lt;`.
 *  4. Blocks indented by four spaces stay: they carry no language tag and start no processor.
 *  Links stay (a click is a user action). Code formatting in chat answers is lost by this —
 *  accepted; a consumer that needs code rendering extracts and renders those blocks itself,
 *  before this function, from the raw text.
 *
 *  Residual risk: (1) post-processors that handle plain text or links (link previews, cards, tag
 *  plugins) keep running; a second line after rendering stays necessary. (2) A plugin that runs
 *  code on plain-text patterns without any code element is not covered (none known). Templater
 *  syntax `<% … %>` is broken by the HTML escape; `{{ … }}` is run by no known processor while
 *  rendering. */

const BACKTICK = /`/g;
const TILDE_RUN = /~{3,}/g;

/** Macht Modell-Markdown unschädlich für Renderer und Prozessoren (s. Kopfkommentar). */
export function neutralizeModelMarkdown(text: string): string {
  // The `{0,N}` bounds keep every rule linear (an unbounded `[^\]]*` rescans to the end from each `![`, quadratic
  // on `![![![…`); anything longer than the bound still loses its `!` in the last image rule below.
  return text
    .replace(/!\[\[([^\]\n\r]{0,1000})\]\]/g, (_m, inner: string) => `\\[\\[${inner}\\]\\]`)
    .replace(/!\[([^\]]{0,1000})\]\(([^)\n\r]{0,2000})\)/g, (_m, alt: string, url: string) => `${alt} (${url})`)
    .replace(/!\[([^\]]{0,1000})\](?:\[[^\]]{0,1000}\])?/g, "[$1]")
    .replace(/!\[/g, "[")
    .replace(/</g, "&lt;")
    .replace(BACKTICK, "ˋ")
    .replace(TILDE_RUN, (run) => "˜".repeat(run.length));
}

// ---- gezielte Variante: nur Fernquellen und Prozessor-Fences ----------------------------------------------

const PROCESSOR_FENCE = /^([ \t>]*(?:(?:[-*+]|\d+[.)])[ \t]+)?(?:`{3,}|~{3,})[ \t]*)(?:dataview(?:js)?|js-engine)(?![\w-])/gim;
/** A reference definition. The label may span lines and the destination may follow on the next line; a lone `\r` is a
 *  line ending (CommonMark). Measured 2026-10-10 against markdown-it 14.3.2: a label over a line break and a destination
 *  after a lone `\r` kept a remote image alive until 0.20.0. Labels are capped at 999 characters (CommonMark's limit),
 *  which keeps the scan from each line start bounded. */
const REF_DEF = /^[ \t>]*(?:(?:[-*+]|\d+[.)])[ \t]+)*\[((?:[^\]\\]|\\[\s\S]){1,999})\]:[ \t]*(?:(?:\r\n?|\n)[ \t]*)?(<[^>\r\n]*>|\S+)/gim;
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+)))?/g;
const BRACKET_CAP = 4000;
/** Attributes the browser loads on its own (not `href` of `<a>`: that needs a click).
 *  Exported (0.18.0) so the DOM pass in `web/remote-resources` classifies with the same lists. */
export const LOADING_ATTRS: ReadonlySet<string> = new Set(["src", "poster", "data", "background", "lowsrc", "dynsrc"]);
export const SRCSET_ATTRS: ReadonlySet<string> = new Set(["srcset", "imagesrcset"]);
/** Tags whose `href` is a link that needs a click; on every other tag (`link`, `base`, `script`, SVG `image`/`use`/
 *  `feImage`/`pattern`/gradients, ...) `href` and `xlink:href` load or apply without one. */
export const CLICK_HREF_TAGS: ReadonlySet<string> = new Set(["a", "area"]);
/** Tags that run or embed a document: for them `data:` and `app:` are NOT local (a `data:text/html` frame runs
 *  script), only a plain relative path is. */
export const DOCUMENT_TAGS: ReadonlySet<string> = new Set(["iframe", "frame", "object", "embed", "script", "link", "base", "portal"]);

/** The schemes that count as local for sources in Markdown text. A consumer that classifies RESOLVED urls
 *  (the DOM pass) passes its own list, e.g. with `capacitor` for iOS. */
export const MARKDOWN_LOCAL_SCHEMES: readonly string[] = ["data", "app"];

const ENTITIES: Record<string, string> = {
  colon: ":", sol: "/", bsol: "\\", tab: "\t", newline: "\n", lpar: "(", rpar: ")", amp: "&", quot: '"', apos: "'",
  lt: "<", gt: ">", period: ".", comma: ",", semi: ";", num: "#", percnt: "%", excl: "!", quest: "?", equals: "=",
  lbrack: "[", rbrack: "]", lowbar: "_", hyphen: "-", dash: "-", plus: "+", ast: "*", commat: "@", dollar: "$",
};

/** Characters the browser drops or ignores inside a URL: controls, spaces, zero-width and line separators. */
const IGNORED_IN_URL = new RegExp("[" + [[0, 0x20], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x2029], [0xfeff, 0xfeff]]
  .map(([a, b]) => String.fromCharCode(a ?? 0) + "-" + String.fromCharCode(b ?? 0)).join("") + "]", "g");

function codePoint(n: number): string {
  try { return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ""; } catch { return ""; }
}

/** HTML entities, decoded BEFORE any check (`&#104;ttps://` is `https://` to the renderer). */
function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d{1,8})|#x([0-9a-f]{1,6})|([a-z][a-z0-9]{1,10}));?/gi, (m, d: string | undefined, h: string | undefined, n: string | undefined) =>
    d !== undefined ? codePoint(Number(d)) : h !== undefined ? codePoint(parseInt(h, 16)) : (ENTITIES[(n ?? "").toLowerCase()] ?? m));
}

/** True when `raw` is clearly local: relative, or one of `localSchemes` (default `data:` and `app:`).
 *  Everything with another scheme or a protocol-relative start counts as remote. Entities, Markdown backslash
 *  escapes, backslash-as-slash, tabs, newlines and control characters (the browser drops them inside a URL) are
 *  resolved first. `relativeOnly` (document tags): only a plain relative path is local. Exported in 0.18.0 for the
 *  DOM pass, so there is one classification. */
export function isLocalRef(raw: string, markdown: boolean, relativeOnly = false, localSchemes: readonly string[] = MARKDOWN_LOCAL_SCHEMES): boolean {
  let v = decodeEntities(raw);
  if (markdown) v = v.replace(/\\([!-/:-@[-`{-~])/g, "$1");

  v = v.replace(/\\/g, "/").replace(IGNORED_IN_URL, "").toLowerCase();
  if (v === "") return true;
  if (v.startsWith("//")) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(v);
  return scheme === null || (!relativeOnly && localSchemes.includes(scheme[1] ?? ""));
}

const normLabel = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();

function remoteReferenceLabels(md: string): Set<string> {
  const out = new Set<string>();
  for (const m of md.matchAll(REF_DEF)) {
    const dest = (m[2] ?? "").replace(/^<|>$/g, "");
    if (!isLocalRef(dest, true)) out.add(normLabel(m[1] ?? ""));
  }
  return out;
}

/** Index of the `]` that closes the `[` at `open` (nesting and backslash escapes respected); -1 = never
 *  closed, -2 = longer than the cap (treated as hostile by the caller). */
function matchBracket(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (i - open > BRACKET_CAP) return -2;
    const c = s[i];
    if (c === "\\") { i++; continue; }
    if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return i;
  }
  return -1;
}

const DEST_CAP = 2048;

/** Parses the destination of an inline link starting right after `(`; null if it is not one. `rest` is where
 *  the optional title and the closing `)` start. A destination longer than `DEST_CAP` is `truncated`, and the
 *  caller treats it as REMOTE (fail closed): judged by its start it could hide a scheme behind padding that the
 *  URL parser ignores (entities that decode to nothing). */
function inlineDestination(s: string, from: number): { dest: string; rest: number; truncated: boolean } | null {
  let p = from;
  while (p < s.length && /\s/.test(s[p] ?? "")) p++;
  if (s[p] === "<") {
    const limit = Math.min(s.length, p + DEST_CAP);
    for (let q = p + 1; q < limit; q++) {
      if (s[q] === ">") return { dest: s.slice(p + 1, q), rest: q + 1, truncated: false };
      if (s[q] === "\n") return null;
    }
    return limit === s.length ? null : { dest: s.slice(p + 1, limit), rest: limit, truncated: true };
  }
  let depth = 0;
  const start = p;
  const limit = Math.min(s.length, p + DEST_CAP);
  while (p < limit) {
    const c = s[p];
    if (c === "\\") { p += 2; continue; }
    if (c === undefined || /\s/.test(c)) break;
    if (c === "(") depth++;
    else if (c === ")") { if (depth === 0) break; depth--; }
    p++;
  }
  return { dest: s.slice(start, Math.min(p, limit)), rest: Math.min(p, limit), truncated: p >= limit && limit < s.length };
}

const MAX_NESTING = 50;

/** One pass over Markdown images, linear in the input. An image inside the alt text of a replaced one is handled
 *  by recursion on the alt text (nesting beyond `MAX_NESTING` loses its `![`). */
function neutralizeImages(s: string, remoteRefs: ReadonlySet<string>, depth = 0): string {
  let out = "";
  let i = 0;
  // `)` search that remembers "there is none from here on": many unclosed `![a](https://…` stay linear.
  let noCloseFrom = Infinity;
  const findClose = (from: number): number => {
    if (from >= noCloseFrom) return -1;
    const e = s.indexOf(")", from);
    if (e < 0) noCloseFrom = from;
    return e;
  };
  const altOf = (alt: string): string => (depth < MAX_NESTING ? neutralizeImages(alt, remoteRefs, depth + 1) : alt.replace(/!\[/g, "["));
  for (;;) {
    const k = s.indexOf("![", i);
    if (k < 0) return out + s.slice(i);
    out += s.slice(i, k);
    const close = matchBracket(s, k + 1);
    if (close === -1) { out += "!["; i = k + 2; continue; }
    if (close === -2) { out += "["; i = k + 2; continue; }   // too long to judge: no longer an image
    const alt = s.slice(k + 2, close);
    const after = s[close + 1];
    if (after === "(") {
      const d = inlineDestination(s, close + 2);
      if (d && (d.truncated || !isLocalRef(d.dest, true))) {
        const end = findClose(d.rest);
        if (end >= 0) { out += `${altOf(alt)} (${d.dest.trim().replace(/^<|>$/g, "")})`; i = end + 1; continue; }
      }
    } else if (after === "[") {
      const end = s.indexOf("]", close + 2);
      if (end >= 0) {
        const label = s.slice(close + 2, end);
        if (remoteRefs.has(normLabel(label === "" ? alt : label))) { out += `[${altOf(alt)}]`; i = end + 1; continue; }
      }
    } else if (remoteRefs.has(normLabel(alt))) { out += `[${altOf(alt)}]`; i = close + 1; continue; }
    out += "![";
    i = k + 2;
  }
}

/** Calls `name(…)` found in `css` (case-insensitive): `fn` gets the text between the parentheses and whether that
 *  text holds another call of the same name, and returns the replacement or null to keep it. Nested parentheses end at
 *  the FIRST `)`; use `matchParen` where they matter. **Linear only because a same-name call inside is never kept:**
 *  `fn` must replace it (fail closed). Kept, the scan would enter it and read its text again for every level — measured
 *  2026-10-10: 64 KB of `url(` took 0.6 s, 152 KB of local `image-set(` 5 s, four times the input sixteen times the time. */
function mapCalls(css: string, names: RegExp, fn: (inner: string, sameInside: boolean) => string | null, nested = false): string {
  const inside = new RegExp(names.source, names.flags.replace("g", ""));
  let out = "";
  let i = 0;
  names.lastIndex = 0;
  for (let m = names.exec(css); m; m = names.exec(css)) {
    const open = m.index + m[0].length;
    const close = nested ? matchParen(css, open) : css.indexOf(")", open);
    if (close < 0) break;
    const inner = css.slice(open, close);
    const rep = fn(inner, inside.test(inner));
    if (rep === null) continue;
    out += css.slice(i, m.index) + rep;
    i = close + 1;
    names.lastIndex = close + 1;
  }
  return out + css.slice(i);
}

/** Index of the `)` that closes a call whose arguments start at `from`; -1 if never closed. */
function matchParen(s: string, from: number): number {
  let depth = 1;
  for (let p = from; p < s.length; p++) {
    const c = s[p];
    if (c === "\\") { p++; continue; }
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return p;
  }
  return -1;
}

const unquote = (v: string): string => v.trim().replace(/^(["'])([\s\S]*)\1$/, "$2");

/** CSS escapes resolved in ONE pass (`u\72l(` is `url(`, a backslash before a line break is a continuation and
 *  disappears). One pass on purpose: `\5c` becomes a backslash, and a second pass would take it for the start of the
 *  next escape and eat it (measured 2026-10-10: `url(\5c/evil…)` read as a relative path, the browser reads `//evil…`). */
function unescapeCss(css: string): string {
  return css.replace(/\\(?:([0-9a-fA-F]{1,6})(?:\r\n|[ \t\r\n\f])?|(\r\n|[\n\r\f])|([\s\S]))/g, (_m, hex: string | undefined, nl: string | undefined, ch: string | undefined) =>
    hex !== undefined ? codePoint(parseInt(hex, 16)) : nl !== undefined ? "" : (ch ?? ""));
}

// ---- a CSS gate for the DOM pass ---------------------------------------------------------------------------------
//
// CSS used to be judged here by what its URLs are (local or remote). Two adversarial reviews of the DOM pass, with real
// requests in Chromium, WebKit and Firefox, broke every version of that: a text search 43 times, a hand-written token
// scanner once more (`@function --f(){result:"https://…"}` hands its string over at computation time, so it never stands
// at the call site). A CSS reader that has to understand CSS keeps being one feature behind CSS. So the gate does not
// try: a value that CONTAINS anything which can name or build a resource is not read at all, it is removed.

/** What can name or build a resource in CSS, or hide that: functions that take a URL or build an image, `@import`,
 *  author-defined functions, any backslash (escapes, line continuations) and any comment. `attr()` hands over a URL from
 *  another attribute. Case-insensitive; checked after escapes are resolved. A backslash is checked on the raw text
 *  (`cssLoadsRemote`): after the escapes are resolved none is left. */
const CSS_RISKY = /url\(|src\(|image-set\(|image\(|cross-fade\(|attr\(|@import|@function|@mixin|@apply|\/\*/i;
/** For an attribute that is not CSS (a free text may say "image(s)" or carry a `\`): only what names a resource. */
const CSS_RISKY_PLAIN = /url\(|src\(|image-set\(|@import/i;
/** The one thing CSS may hold: a reference to an element of the same document (Mermaid's markers and filters). */
const CSS_FRAGMENT_ONLY = /^\s*url\(\s*#[A-Za-z0-9_-]+\s*\)\s*$/i;

/** For the DOM pass (0.18.0): true when `css` (a `style` attribute, an SVG presentation attribute or the text of a
 *  `<style>`) must be removed as a whole. Fail closed and deliberately blunt: it is true for anything that contains `url(`,
 *  `src(`, `image-set(`, `image(`, `cross-fade(`, `attr(`, `@import`, `@function`/`@mixin`/`@apply`, a backslash or a comment,
 *  whether the target is remote or local — the only exception is a value that is exactly `url(#id)`. **The price:**
 *  a background image or font that model output or a deck sets through CSS disappears, local or not; an image belongs in
 *  an `<img>`. `indirect: false` is for attributes that are not CSS: only `url(`, `src(`, `image-set(` and `@import` count. */
export function cssLoadsRemote(css: string, indirect = true): boolean {
  const resolved = unescapeCss(css);
  if (CSS_FRAGMENT_ONLY.test(resolved)) return false;
  return indirect ? CSS_RISKY.test(resolved) || css.includes("\\") : CSS_RISKY_PLAIN.test(resolved);
}

/** CSS: remote `url()`, `src()`, `image-set()` and `@import` are removed. Entities are the caller's job
 *  (attribute values), CSS escapes (`u\72l(`) are resolved here. Returns the input unchanged if nothing was found.
 *  Linear in the input (no regex with a trailing optional part after an open-ended class). */
function neutralizeCss(css: string, localSchemes: readonly string[] = MARKDOWN_LOCAL_SCHEMES): { css: string; changed: boolean } {
  const unescaped = unescapeCss(css);
  let changed = false;
  let out = unescaped.replace(/@import\b[^;{}]*;?/gi, (m) => {
    const t = /"([^"]*)"|'([^']*)'|url\(([^)]*)\)/i.exec(m);
    const target = t ? unquote(t[1] ?? t[2] ?? t[3] ?? "") : "";
    if (isLocalRef(target, false, false, localSchemes)) return m;
    changed = true;
    return "";
  });
  out = mapCalls(out, /(?:-webkit-)?image-set\(/gi, (inner, sameInside) => {
    const remote = sameInside || [...inner.matchAll(/["']([^"']*)["']/g)].some((q) => !isLocalRef(q[1] ?? "", false, false, localSchemes));
    if (!remote) return null;
    changed = true;
    return "none";
  }, true);
  out = mapCalls(out, /\b(?:url|src)\(/gi, (inner, sameInside) => {
    if (!sameInside && isLocalRef(unquote(inner), false, false, localSchemes)) return null;
    changed = true;
    return "url()";
  });
  return changed ? { css: out, changed } : { css, changed };
}

function tagLoadsRemote(name: string, attrs: string): boolean {
  const strict = DOCUMENT_TAGS.has(name);
  let refresh = false;
  let remote = false;
  for (const a of attrs.matchAll(ATTR)) {
    const attr = (a[1] ?? "").toLowerCase();
    const value = decodeEntities(a[2] ?? a[3] ?? a[4] ?? "");
    if (LOADING_ATTRS.has(attr) && !isLocalRef(value, false, strict)) remote = true;
    else if (SRCSET_ATTRS.has(attr) && value.split(",").some((part) => !isLocalRef(part.trim().split(/\s+/)[0] ?? "", false))) remote = true;
    else if ((attr === "href" || attr === "xlink:href") && !CLICK_HREF_TAGS.has(name) && !isLocalRef(value, false, strict)) remote = true;
    else if (attr === "http-equiv" && /refresh/i.test(value)) refresh = true;
  }
  return remote || (name === "meta" && refresh);
}

/** End (exclusive) of the tag whose attributes start at `from`: after the next `>`, quote-aware or not; a quote-aware
 *  scan with an unclosed quote or no `>` runs to the end of the text (a browser would not render it, but the second,
 *  naive pass reads what is behind it). -1 = no `>` at all (naive scan). */
function tagEnd(s: string, from: number, quoteAware: boolean): number {
  if (!quoteAware) {
    const g = s.indexOf(">", from);
    return g < 0 ? -1 : g + 1;
  }
  let q = "";
  for (let p = from; p < s.length; p++) {
    const c = s[p];
    if (q !== "") { if (c === q) q = ""; }
    else if (c === '"' || c === "'") q = c ?? "";
    else if (c === ">") return p + 1;
  }
  return s.length;
}

/** Linear walk over the tags of `s`; `fn(name, attrs, tag)` returns the replacement text of each. */
function mapTags(s: string, quoteAware: boolean, fn: (name: string, attrs: string, tag: string) => string): string {
  const re = /<([a-zA-Z][a-zA-Z0-9:_-]*)/g;
  let out = "";
  let i = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const attrsFrom = m.index + m[0].length;
    const end = tagEnd(s, attrsFrom, quoteAware);
    if (end < 0) break;
    const tag = s.slice(m.index, end);
    const attrs = s.slice(attrsFrom, tag.endsWith(">") ? end - 1 : end);
    out += s.slice(i, m.index) + fn(m[1] ?? "", attrs, tag);
    i = end;
    re.lastIndex = end;
  }
  return out + s.slice(i);
}

/** Tags: a tag that loads a remote source on its own has its `<` escaped (the tag stays readable as text);
 *  a remote `url()` in a `style` attribute is cut out and the tag stays. Read twice: quote-aware, and with quotes
 *  as plain characters (parsers differ on an unclosed quote). */
function neutralizeTags(s: string): string {
  const escapeIfRemote = (name: string, attrs: string, tag: string): string =>
    (tagLoadsRemote(name.toLowerCase(), attrs) ? tag.replace(/</g, "&lt;") : tag);
  const naive = mapTags(s, false, escapeIfRemote);
  return mapTags(naive, true, (name, attrs, tag) => {
    const escaped = escapeIfRemote(name, attrs, tag);
    if (escaped !== tag || !/\bstyle\b/i.test(attrs)) return escaped;
    const fixed = attrs.replace(ATTR, (full, attr: string, dq: string | undefined, sq: string | undefined, uq: string | undefined) => {
      if (attr.toLowerCase() !== "style") return full;
      const css = neutralizeCss(decodeEntities(dq ?? sq ?? uq ?? ""));
      if (!css.changed) return full;
      const q = sq !== undefined ? "'" : '"';
      return `${attr}=${q}${css.css.split(q).join(q === '"' ? "&quot;" : "&#39;")}${q}`;
    });
    return `<${name}${fixed}${tag.slice(1 + name.length + attrs.length)}`;
  });
}

/** `<style>` blocks, linear: the css between `<style…>` and the next `</style>`. */
function neutralizeStyleBlocks(s: string): string {
  const open = /<style\b[^>]*>/gi;
  const close = /<\/style\s*>/gi;
  let out = "";
  let i = 0;
  for (let m = open.exec(s); m; m = open.exec(s)) {
    const from = m.index + m[0].length;
    close.lastIndex = from;
    const c = close.exec(s);
    if (!c) break;
    const fixed = neutralizeCss(s.slice(from, c.index));
    if (fixed.changed) { out += s.slice(i, from) + fixed.css; i = c.index; }
    open.lastIndex = c.index + c[0].length;
  }
  return out + s.slice(i);
}

// ---- Mermaid: a diagram language that loads on its own ------------------------------------------------------------
//
// Mermaid loads outside any tree a DOM pass could see: `A@{ img: "…" }` (Mermaid ≥ 11.3) runs `new Image().src`,
// `classDef … background:url(…)` and `themeCSS` become CSS, an HTML label becomes markup. Its syntax grows with every
// release, so the predicate does not enumerate forms: a source is a find as soon as it carries anything that can name a
// resource. The price is a diagram shown as text, never a request. Template: slide-deck `mermaidLoads` (0.15.0).

/** CSS functions and imports (also with whitespace before the parenthesis), comments, any backslash (CSS escapes, `\\host`),
 *  `//`, a scheme that fetches, and an HTML attribute that loads — whatever its value says (entities can build any value). */
const MERMAID_RISKY = /(?:url|src|image-set|image|cross-fade)\s*\(|@import|\/\*|\\|\/\/|\b(?:https?|ftp|wss?|file|blob):|\b(?:src|srcset|imagesrcset|srcdoc|href|poster|data|background|lowsrc|dynsrc)\s*=/i;
const MERMAID_IMG = /\bimg\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\s,}]+))/gi;

/** True when a Mermaid source may load something from outside — fail closed (see above). An `img:` value counts as local
 *  only by the module's positive list ({@link isLocalRef}: relative, `data:`, `app:`, after entities, backslashes, tabs and
 *  control characters are resolved). Exported so a consumer that renders Mermaid itself (slide-deck's second pass) asks
 *  the same question as {@link neutralizeRemoteResources}. Linear in the input. */
export function mermaidLoadsRemote(source: string): boolean {
  if (MERMAID_RISKY.test(source)) return true;
  for (const m of source.matchAll(MERMAID_IMG)) if (!isLocalRef(m[1] ?? m[2] ?? m[3] ?? "", false)) return true;
  return false;
}

/** Opening line of a Mermaid fence: any run of indentation, `>` and list markers, then the fence and the info `mermaid`
 *  (case-insensitive, nothing word-like after it). Each prefix character matches exactly one alternative: linear per line. */
const MERMAID_OPEN = /^((?:[ \t>]|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t]))*)(`{3,}|~{3,})([ \t]*)(mermaid)(?![\w-])/i;
const FENCE_LINE = /^([ \t>]*)(`{3,}|~{3,})[ \t]*$/;
/** CommonMark line endings: `\n`, `\r\n` and a lone `\r` (markdown-it and Obsidian treat a lone `\r` as a break too;
 *  measured 2026-10-10 against markdown-it 14.3.2: splitting at `\n` only missed every fence after the first line). */
const LINE_END = /\r\n?|\n/g;

/** [end of the line's content, start of the next line] for the line starting at `from`. */
function lineAt(md: string, from: number): [number, number] {
  LINE_END.lastIndex = from;
  const m = LINE_END.exec(md);
  return m ? [m.index, m.index + m[0].length] : [md.length, md.length];
}

const countQuotes = (prefix: string): number => prefix.split(">").length - 1;

/** A closing line for a fence opened with `quotes` levels of `>`, fence character `ch` and length `len`. Strict on
 *  purpose: a line that closes here closes in every CommonMark reading (same quote depth, at most three spaces after the
 *  last `>` plus its optional space, no tab, the same character at least as often, nothing after it). A renderer that
 *  closes LATER than this would show content the predicate never read; one that closes earlier only costs a diagram. */
function closesFence(line: string, quotes: number, ch: string, len: number): boolean {
  const m = FENCE_LINE.exec(line);
  if (!m || (m[2] ?? "")[0] !== ch || (m[2] ?? "").length < len) return false;
  const prefix = m[1] ?? "";
  if (countQuotes(prefix) !== quotes) return false;
  const tail = prefix.slice(prefix.lastIndexOf(">") + 1);
  return !tail.includes("\t") && tail.length <= (quotes > 0 ? 4 : 3);
}

/** Mermaid fences whose source may load something get the info `text`: the source stays readable, the diagram goes.
 *  One pass over the lines; an unclosed fence runs to the end of the text (CommonMark), so the scan stops there. */
function disarmMermaidFences(md: string): string {
  let out = "";
  let i = 0;
  let pos = 0;
  while (pos < md.length) {
    const [eol, next] = lineAt(md, pos);
    const m = MERMAID_OPEN.exec(md.slice(pos, eol));
    if (!m) { pos = next; continue; }
    const fence = m[2] ?? "";
    const quotes = countQuotes(m[1] ?? "");
    const infoAt = pos + (m[1] ?? "").length + fence.length + (m[3] ?? "").length;
    let close = md.length;
    let after = md.length;
    for (let p = next; p < md.length;) {
      const [e, n] = lineAt(md, p);
      if (closesFence(md.slice(p, e), quotes, fence[0] ?? "", fence.length)) { close = p; after = n; break; }
      p = n;
    }
    if (mermaidLoadsRemote(md.slice(infoAt + 7, close))) { out += md.slice(i, infoAt) + "text"; i = infoAt + 7; }
    pos = after;
  }
  return out + md.slice(i);
}

/** Narrower variant of {@link neutralizeModelMarkdown} for consumers that render model Markdown WITH
 *  fences, HTML comments and directives (slide decks: Mermaid and code fences, `<!-- layout -->`) and so
 *  cannot take the removal strategy. It disarms what loads a remote source or runs an external processor
 *  without a click, and it works from a POSITIVE list for sources: only relative paths, `data:` and `app:`
 *  count as local; any other scheme or a protocol-relative `//` is remote. Entities, Markdown backslash
 *  escapes, backslash-as-slash, tabs/newlines/control characters and CSS escapes are resolved BEFORE the check.
 *  - Markdown images `![alt](dest)` with a remote destination become text (`alt (dest)`); reference images
 *    whose definition is remote become `[alt]`; nested and bracket-heavy alt texts are scanned, an alt text
 *    longer than 4000 characters is no longer treated as an image.
 *  - Any HTML tag with a remote `src`, `srcset`, `poster`, `data`, `background`, or a remote `href` on
 *    `link`/`image`/`use`/`feImage`/`base`/`script`, or a `meta` refresh, has its `<` escaped to `&lt;`.
 *    For tags that embed or run a document (`iframe`, `frame`, `object`, `embed`, `script`, `link`, `base`) even
 *    `data:` and `app:` are not local (a `data:text/html` frame runs script), only a plain relative path is. Tags are
 *    read twice, once quote-aware and once treating quotes as plain characters, because parsers differ on an
 *    unclosed quote. Reference definitions inside quotes and lists count (CommonMark allows them there).
 *  - Remote `url()`, `src()`, `image-set()` and `@import` in `style` attributes and `<style>` blocks are cut out.
 *  - Fences with the language `dataview`, `dataviewjs` or `js-engine` (indented, quoted, in lists, backtick
 *    or tilde) get the language `text`.
 *  - Mermaid fences whose source may load something ({@link mermaidLoadsRemote}: an `img:` that is not local, CSS
 *    functions, `@import`, a comment, a backslash, `//`, a fetching scheme, an HTML attribute that loads) get the language
 *    `text`: the source stays readable, the diagram is not drawn. Mermaid loads outside any tree (`new Image()` for
 *    `A@{ img: … }`), so no pass over the rendered DOM can catch it — this is the only layer that sees it.
 *  Left alone: every other fence, HTML comments and directives, `![[…]]` embeds, `data:`/`app:` and relative
 *  sources, links, plain `<…>` text — a deck stays byte-identical. Idempotent.
 *
 *  Limits: (1) **A clickable link stays** (`[x](https://…)`, `<a href>`); a restored secret in a link URL is
 *  a documented residual risk, not an automatic leak. (2) Fences are parsed only to find Mermaid diagrams, and strictly:
 *  a line closes a Mermaid fence only where every CommonMark reading closes it (same `>` depth, at most three spaces, no
 *  tab, the same character at least as often, nothing after it); a renderer that closes later than CommonMark would draw
 *  lines the predicate never read. All other rules also apply inside code fences, which only changes example text; a
 *  Mermaid example inside a longer fence is judged too. (3) Inline `$=` Dataview expressions and other plugin syntaxes
 *  are not handled. (4) A renderer quirk this list does not know (a new URL-loading attribute) is not
 *  covered; the list is deliberately about what a browser loads on its own. (5) **CSS is read as text here, and
 *  a CSS parser reads tokens.** The review of the DOM pass (2026-10-10, real requests in Chromium) found 43 places where
 *  the two readings differ for `style` attributes and `<style>` blocks: an unclosed `url(` at the end, `)` inside a quoted
 *  url, a comment after the string, a backslash before a line break, an escaped quote, a custom property that holds
 *  the string, an `@import` string with `;` or `}` or a `data:` target. The DOM pass does not repair
 *  them, it removes any CSS that names a resource (`cssLoadsRemote`); this regex pass does not. For anything that is
 *  rendered, use `neutralizeRemoteResourcesInTree` from `web/remote-resources` on a parsed, inert tree. */
export function neutralizeRemoteResources(markdown: string): string {
  let s = disarmMermaidFences(markdown).replace(PROCESSOR_FENCE, "$1text");
  const refs = remoteReferenceLabels(s);
  for (let pass = 0; pass < 8; pass++) {
    const next = neutralizeImages(s, refs);
    if (next === s) break;
    s = next;
  }
  return neutralizeStyleBlocks(neutralizeTags(s));
}
