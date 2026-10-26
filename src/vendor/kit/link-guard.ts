// vendored from code-kit@0.38.0, src/ts/web/link-guard.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Link guard for rendered model answers: the second line of defence after `MarkdownRenderer.render`. It cuts link targets that
 *  would run or open something (`javascript:`, `data:`, `vbscript:`, `file:`, `app:`, and `obsidian:` unless the caller allows it),
 *  removes the active elements, and removes `src` / `srcset` — except for local images, when the caller allows them.
 *
 *  ── What it is for ──────────────────────────────────────────────────────────────────────
 *  `remote-resources` (and obsidian-kit's `domGuard` on top of it) neutralise what loads from far away and say so themselves:
 *  "No script defence … `javascript:` in a link … not touched". A chat window built on the kit therefore had no link protection;
 *  settings-assistant carried its own (`stripActiveContent`, `src/obsidian/dom-safety.ts`, 30 cases) and was the only one that did.
 *  This module is that function moved into the library (Welle 27; the Dach task "Linkschutz in Modellantworten"), split in two
 *  parts so that the decision can be tested without a DOM: {@link linkScheme} and {@link isSafeHref} are pure string functions,
 *  {@link neutralizeUnsafeLinksInTree} applies them to a tree.
 *
 *  ── The rules ───────────────────────────────────────────────────────────────────────────
 *  Link targets (`href` of `<a>` and `<area>`):
 *  - No scheme (a relative path, `#heading`, `?q=1`, an internal note name) → kept.
 *  - `http`, `https`, `mailto` → kept.
 *  - `obsidian:` → kept **only with `allowObsidianLinks`** (decision Johannes 2026-10-24: an answer is not trustworthy text, and any
 *    app can call `obsidian://`; a link can open another vault). Default off.
 *  - `javascript`, `data`, `vbscript`, `file`, `app` → **never**, whatever the options say, and whether or not the link is internal.
 *  - Any other scheme (`ftp:`, `tel:`, `x-foo:`) → removed, except on an internal link (below).
 *  - An **internal link** (it carries `data-href`, Obsidian's marker for a wiki link) may hold a colon in the name ("Titel: Untertitel"),
 *    so a scheme that is only a name stays; the never-schemes and `obsidian:` rule still apply to it. The `data-href` attribute itself
 *    is not touched: Obsidian navigates by it, so a removed `href` costs the hover preview at most.
 *  A removed target loses the attribute only; the link text stays.
 *
 *  Elements and sources:
 *  - {@link ACTIVE_TAGS} (`img iframe embed video audio object link style script source`, plus `base frame frameset portal fencedframe
 *    webview applet bgsound`) and a `<meta http-equiv="refresh">` are removed with their subtree,
 *    **except** an `<img>` with `allowLocalImages` whose `src` is local (relative, `app:` or `capacitor:`; `data:` is NOT local here).
 *    A kept image keeps only `src`, `srcset` (when every candidate is local, else the attribute goes), `alt`, `title`, `width`,
 *    `height`, `class`: an `onerror` or any other attribute would run code from an element this module lets through.
 *  - **An `<svg>` stays when it is an icon (0.37.4):** every element in its subtree is one of {@link SVG_TAGS} (`svg g path circle ellipse line
 *    polyline polygon rect`). Then every element of it keeps only geometry and plain presentation attributes (event handlers, `href`,
 *    `style`, `id`, `data-*`, `clip-path`, `mask`, `filter` and anything unknown go and are reported), and `fill` / `stroke` keep only a plain
 *    colour. One element outside the list, however deep, takes the whole `<svg>` out as before. Why: before 0.37.4 every `<svg>` went, and
 *    with it the icon of an Obsidian callout and the one on the copy button of a code block (measured in Obsidian 1.14.5 by the pilot in
 *    obsidian-kit: svg 1 → 0 on both). A shape-only `<svg>` loads nothing and runs nothing once its attributes are plain.
 *  - `src` and `srcset` are removed from every other element.
 *  - A remote image never stays, with or without the option: that is `remote-resources`' job on top, this pass does not load anything
 *    from far away either way.
 *
 *  ── Scheme detection ────────────────────────────────────────────────────────────────────
 *  The browser drops tabs, newlines and leading control characters before it reads a scheme, and a renderer may add more. So {@link linkScheme}
 *  ignores every control character and space (`<= U+0020`, `U+007F..U+009F`), the zero-width characters `U+200B..U+200F`, the line and
 *  paragraph separators and the byte order mark anywhere in the value, compares without regard to case, and reads the scheme from what is
 *  left. That is stricter than the browser (`java` + U+200B + `script:` is no scheme to a browser, it is one here) on purpose: the cost of a
 *  false alarm is a link without target. **Percent-encoding is not decoded**: `%6Aavascript:` is a relative path to every browser, so it
 *  has no scheme here either. The input is an attribute VALUE, i.e. the parser has already decoded character references.
 *
 *  ── Limits ──────────────────────────────────────────────────────────────────────────────
 *  (1) Only `href` of `<a>` / `<area>` is a link target here. `<form action>`, `formaction`, `<a ping>`, MathML `href` and event-handler
 *  attributes on elements other than a kept `<img>` are not touched; this pass is about link targets and sources. **Measured 2026-10-25
 *  (kitok2-w27, Obsidian 1.14.5, pilot `pilot/link-schutz.ts` of obsidian-kit, point P11, 13 of 13 points green, no click): none of the five
 *  carriers (`form action`, `formaction`, `<a ping>`, MathML `href`, `onclick` on a `<p>`) is left in the DOM after `MarkdownRenderer.render`
 *  and this guard.** Which of the two removes them is not recorded: the pilot prints the column "without the guard" on the console and does
 *  not store it, so this comment does not claim that the renderer does it alone. (1b) **`data-href` is read from the tree and may come from the answer.** The internal-link exception (a
 *  colon in a note name is no scheme) therefore also lets a forged `<a data-href=… href="ms-excel:…">` keep a scheme that is not on the
 *  never-list; it takes a click. **Measured 2026-10-25 (kitok2-w27, Obsidian 1.14.5): the exception cannot be narrowed.** The renderer writes the wiki link
 *  `[[ms-excel:foo]]` in the same attribute form as a forged `<a data-href="ms-excel:foo" href="ms-excel:foo">` (`class="internal-link"`, `data-href` equal to
 *  `href`), and it is plain Markdown that passes any regex layer, so no test tells the two apart; a click on an `internal-link` is a note link in Obsidian, not a
 *  protocol handler. Only a path without that layer (`raw`) lets the forged `<a>` reach a click handler. The exception stays (Master, 2026-10-25).
 *  (2) Shadow roots are not entered (do not parse with `setHTMLUnsafe`, see `remote-resources`);
 *  `template.content` is. (3) Run it on an inert tree or before the nodes go live: removing an attribute from a tree that is already
 *  attached cannot call off a fetch that the browser scheduled when the attribute was set; this pass removes the loading attributes
 *  before it removes an element (as `remote-resources` does), which is all it can do. (4) The renderer run is one measurement, not a
 *  guarantee: the pilot ran `MarkdownRenderer.render` plus this guard in Obsidian 1.14.5 (points P11 and P12, the carriers above and the
 *  `<svg>` cases), once, without a click. Not measured: other Obsidian versions, and the path without the regex layer in front (`raw` /
 *  `renderMarkdownGuarded`, where limit (1b) stays). The cascade after the renderer is the consumer's to test (Fake DOM sees no cascade).
 *
 *  Origin: settings-assistant `src/obsidian/dom-safety.ts` (`stripActiveContent`, `schemeOf`), n = 1; Welle 27. **Behaviour that differs
 *  from the source:** `file:` and `app:` targets are refused on an internal link too (the source kept them with `data-href`);
 *  `obsidian:` is refused unless allowed, with `data-href` too (the source kept it, and noted "not recommended"); `<area>` is checked
 *  like `<a>`; the root element itself is looked at; the list of active tags is longer (`base`, `frame`, `frameset`, `portal`, `fencedframe`, `webview`, `applet`,
 *  `bgsound`) and a `<meta http-equiv="refresh">` goes; `U+200E`, `U+200F`, `U+2028`, `U+2029` count as ignorable; a kept image is
 *  reduced to the attribute list above.
 *
 *  ── Vendoring ───────────────────────────────────────────────────────────────────────────
 *  Imports `../pure/safe-markdown` (`isLocalRef`), like `remote-resources`. A consumer that flattens `pure/` and `web/` into one
 *  directory rewrites the import in its kit-sync config: `rewrite: [["../pure/", "./"]]`. */

import { isLocalRef } from "./safe-markdown";

/** Elements that run, embed, draw or redirect something: removed with their subtree. The ten of the eleven settings-assistant used that stay on the list (`img iframe embed
 *  video audio object link style script source`; its eleventh, `svg`, is judged by {@link SVG_TAGS} since 0.37.4), plus the document-level ones `remote-resources` removes too (`base` would send every
 *  relative target elsewhere; `frame`, `frameset`, `portal`, `fencedframe`, `webview`, `applet`, `bgsound` embed a document or a plug-in).
 *  A `<meta http-equiv="refresh">` goes as well (it navigates), checked in the walk: another `<meta>` stays. */
export const ACTIVE_TAGS: ReadonlySet<string> = new Set([
  "img", "iframe", "embed", "video", "audio", "object", "link", "style", "script", "source",
  "base", "frame", "frameset", "portal", "fencedframe", "webview", "applet", "bgsound",
]);

/** The only elements an `<svg>` may hold and still stay (0.37.4): shapes, nothing that loads, runs, styles, animates, references or
 *  embeds. This is the markup of Obsidian's lucide icons (callout icon, copy button of a code block). Closed on purpose: a list of the
 *  bad ones (`script use foreignObject image a animate set`) misses `feImage`, `discard`, `mpath`, the next one a spec adds. */
export const SVG_TAGS: ReadonlySet<string> = new Set(["svg", "g", "path", "circle", "ellipse", "line", "polyline", "polygon", "rect"]);
/** The attributes (lower case) an `<svg>` and its shapes keep: geometry and plain presentation. No `style`, no `id`, no `href`, no
 *  `on*`, no `clip-path` / `mask` / `filter` (they take a `url(…)`), no `data-*`. */
const SVG_ATTRS: ReadonlySet<string> = new Set([
  "xmlns", "width", "height", "viewbox", "preserveaspectratio", "class", "transform", "aria-hidden", "role", "focusable",
  "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset",
  "fill-rule", "clip-rule", "fill-opacity", "stroke-opacity", "opacity",
  "d", "points", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1", "x2", "y2",
]);
/** What `fill` and `stroke` may be: a colour word, a hex colour, `rgb()` / `hsl()` of numbers. Not `url(…)` in any spelling (a CSS escape
 *  such as `\75rl(` is no letter here), not `var()`. */
const PLAIN_PAINT = /^(?:[a-z]+|#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([0-9 ,.%/]*\))$/i;

/** Targets a link may keep without a switch. */
const SAFE_SCHEMES: ReadonlySet<string> = new Set(["http", "https", "mailto"]);
/** Targets no switch lets through, on any link. */
const NEVER_SCHEMES: ReadonlySet<string> = new Set(["javascript", "data", "vbscript", "file", "app"]);
/** Schemes that count as local for an image the caller allows: the app's own resource scheme and the iOS Capacitor one. */
const LOCAL_IMAGE_SCHEMES: readonly string[] = ["app", "capacitor"];
/** What a kept `<img>` may still carry. */
const IMG_KEEP_ATTRS: ReadonlySet<string> = new Set(["src", "srcset", "alt", "title", "width", "height", "class"]);
const REF_CAP = 500;

export interface LinkGuardOptions {
  /** Keep `obsidian://` link targets. Default off: an answer should not be able to run an Obsidian action (open another vault). */
  allowObsidianLinks?: boolean | undefined;
  /** Keep `<img>` elements whose `src` is local (relative, `app:`, `capacitor:`). Default off: a chat has no reason to load files. */
  allowLocalImages?: boolean | undefined;
}

export interface IsSafeHrefOptions {
  /** `obsidian:` is allowed. Default `false`. */
  allowObsidianLinks?: boolean | undefined;
  /** The link is an internal (wiki) link: its target is a note name, not a URL, so a colon in it is no scheme. Default `false`. */
  internal?: boolean | undefined;
}

/** What the pass took out. `attr` is the attribute name as written, or `""` when the whole element went. Same shape as the report of
 *  `neutralizeRemoteResourcesInTree`. */
export interface RemovedLink {
  tag: string;
  attr: string;
  ref: string;
}

/** Characters the browser drops or ignores around and inside a URL, plus the invisible ones a renderer may let through. */
function isIgnored(n: number): boolean {
  return n <= 0x20 || (n >= 0x7f && n <= 0x9f) || (n >= 0x200b && n <= 0x200f) || n === 0x2028 || n === 0x2029 || n === 0xfeff;
}

/** The scheme of a link target as a browser would read it, lower case, or `null` when there is none (a relative target).
 *  Ignorable characters anywhere in the value are skipped first; see the module header. `javascript:alert(1)` → `"javascript"`,
 *  `"\tJaVa\nScRiPt:x"` → `"javascript"`, `"#h"` → `null`, `"%6Aavascript:x"` → `null`. */
export function linkScheme(href: string): string | null {
  let clean = "";
  for (let i = 0; i < href.length; i++) {
    if (!isIgnored(href.charCodeAt(i))) clean += href.charAt(i);
  }
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(clean);
  return m?.[1] !== undefined ? m[1].toLowerCase() : null;
}

/** May a link keep this target? The decision for one `href`, without a DOM; the rules are in the module header. */
export function isSafeHref(href: string, opts: IsSafeHrefOptions = {}): boolean {
  const scheme = linkScheme(href);
  if (scheme === null) return true;
  if (scheme === "obsidian") return opts.allowObsidianLinks === true;
  if (NEVER_SCHEMES.has(scheme)) return false;
  if (opts.internal === true) return true;
  return SAFE_SCHEMES.has(scheme);
}

const cap = (s: string): string => (s.length > REF_CAP ? `${s.slice(0, REF_CAP)}…` : s);

/** Walks `root` (an element, a fragment or a document) and applies the rules of the module header. `removed` lists everything taken
 *  out, in document order; an element removed as a whole is reported once, not once per descendant. Iterative, linear in the number
 *  of elements and attributes. */
export function neutralizeUnsafeLinksInTree(root: ParentNode, opts: LinkGuardOptions = {}): { removed: RemovedLink[] } {
  const removed: RemovedLink[] = [];
  const report = (tag: string, attr: string, ref: string): void => { removed.push({ tag, attr, ref: cap(ref) }); };
  const localImage = (value: string): boolean => isLocalRef(value, false, false, LOCAL_IMAGE_SCHEMES);

  /** Takes the attributes that load or navigate off `el` and its subtree BEFORE it leaves the tree (see limit 3). */
  const defuse = (el: Element): void => {
    const strip = (node: Element): void => {
      for (const a of Array.from(node.attributes)) {
        const n = a.localName.toLowerCase();
        if (n === "src" || n === "srcset" || n === "data" || n === "poster" || n === "href" || n === "srcdoc") node.removeAttributeNode(a);
      }
    };
    strip(el);
    for (const d of Array.from(el.querySelectorAll("*"))) strip(d);
  };

  /** Takes `el` out of the tree; a root without a parent is emptied instead. */
  const dropElement = (el: Element, tag: string, ref: string): void => {
    defuse(el);
    const parent = el.parentNode;
    if (parent) parent.removeChild(el);
    else {
      for (const a of Array.from(el.attributes)) el.removeAttributeNode(a);
      while (el.firstChild) el.removeChild(el.firstChild);
    }
    report(tag, "", ref);
  };

  /** A local `<img>` the caller allowed: reduced to the attribute list, `srcset` kept only when every candidate is local. */
  const reduceImage = (el: Element, tag: string): void => {
    for (const a of Array.from(el.attributes)) {
      const n = a.name.toLowerCase();
      if (!IMG_KEEP_ATTRS.has(n)) { el.removeAttributeNode(a); report(tag, a.name, a.value); continue; }
      if (n === "srcset" && a.value.split(/[\s,]+/).some((t) => t !== "" && !localImage(t))) { el.removeAttributeNode(a); report(tag, a.name, a.value); }
    }
  };

  /** An `<svg>` whose whole subtree is shapes stays, reduced to plain attributes; any other element in it takes the whole `<svg>` out.
   *  Returns true: the subtree is handled here, in one pass, so a deep chain of nested `<svg>` is not walked again for each level. */
  const inspectSvg = (el: Element): boolean => {
    // an explicit stack, in document order: `querySelectorAll("*")` recurses in some DOMs and a hostile answer can nest deep
    const all: Element[] = [];
    const todo: Element[] = [el];
    for (let e = todo.pop(); e; e = todo.pop()) {
      if (!SVG_TAGS.has(e.localName.toLowerCase())) {
        dropElement(el, "svg", el.getAttribute("src") ?? el.getAttribute("href") ?? el.getAttribute("data") ?? "");
        return true;
      }
      all.push(e);
      for (let i = e.children.length - 1; i >= 0; i--) { const kid = e.children[i]; if (kid) todo.push(kid); }
    }
    for (const e of all) {
      for (const a of Array.from(e.attributes)) {
        const n = a.name.toLowerCase();
        if (SVG_ATTRS.has(n) && ((n !== "fill" && n !== "stroke") || PLAIN_PAINT.test(a.value))) continue;
        e.removeAttributeNode(a);
        report(e.localName.toLowerCase(), a.name, a.value);
      }
    }
    return true;
  };

  /** Returns true when `el` is gone (its descendants are not visited). */
  const inspect = (el: Element): boolean => {
    const tag = el.localName.toLowerCase();
    if (tag === "svg") return inspectSvg(el);
    if (ACTIVE_TAGS.has(tag)) {
      if (tag === "img" && opts.allowLocalImages === true) {
        const src = el.getAttribute("src");
        if (src !== null && localImage(src)) { reduceImage(el, tag); return false; }
        dropElement(el, tag, src ?? "");
        return true;
      }
      dropElement(el, tag, el.getAttribute("src") ?? el.getAttribute("href") ?? el.getAttribute("data") ?? "");
      return true;
    }
    if (tag === "meta" && /refresh/i.test(el.getAttribute("http-equiv") ?? "")) {
      dropElement(el, tag, el.getAttribute("content") ?? "");
      return true;
    }
    for (const a of Array.from(el.attributes)) {
      const n = a.localName.toLowerCase();
      if (n === "src" || n === "srcset") { el.removeAttributeNode(a); report(tag, a.name, a.value); continue; }
      if (n === "href" && (tag === "a" || tag === "area")
        && !isSafeHref(a.value, { allowObsidianLinks: opts.allowObsidianLinks === true, internal: el.hasAttribute("data-href") })) {
        el.removeAttributeNode(a);
        report(tag, a.name, a.value);
      }
    }
    return false;
  };

  const stack: Element[] = [];
  const pushChildren = (parent: ParentNode): void => {
    const kids = parent.children;
    for (let i = kids.length - 1; i >= 0; i--) {
      const kid = kids[i];
      if (kid) stack.push(kid);
    }
  };

  if ((root as Node).nodeType === 1) stack.push(root as Element);
  else pushChildren(root);

  for (let el = stack.pop(); el; el = stack.pop()) {
    if (inspect(el)) continue;
    pushChildren(el);
    const content = el.localName.toLowerCase() === "template" ? (el as unknown as { content?: ParentNode }).content : undefined;
    if (content) pushChildren(content);
  }
  return { removed };
}
