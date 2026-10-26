// vendored from code-kit@0.38.0, src/ts/web/remote-resources.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Removes every resource from a DOM subtree that the browser would load without a click and that is not
 *  on the positive list. The tree-shaped sibling of `neutralizeRemoteResources` in `pure/safe-markdown`
 *  (the regex pass over Markdown text), and the reason it exists: that pass is a partial protection by
 *  construction. Markdown and HTML have more spellings than a block list holds (entities, escapes,
 *  reference definitions, containers, open quotes), and each hardening round of 0.15.1 to 0.15.5 was
 *  followed by a review that found new bypasses. A DOM has no spellings left — the parser has already
 *  decided what an element, an attribute and a value are — so this pass classifies the OUTCOME.
 *
 *  ── The contract the caller must keep ───────────────────────────────────────────────────
 *  **Run it on an inert tree, before the tree is attached to the page.** An `<img>` starts to load as
 *  soon as it exists in a document that has a browsing context, attached or not. Parse into a document
 *  that has none (`new DOMParser().parseFromString(…)`, `document.implementation.createHTMLDocument()`,
 *  or the `content` of a `<template>`), run the pass, then adopt the nodes.
 *
 *  **If the tree has to be in the live document already** (a renderer such as Mermaid needs layout and cannot render
 *  in an inert one), the pass is a race against the browser, and WHERE it runs decides the outcome. Measured in Chrome 154
 *  with a logging server, 12 repetitions per form (`<img src>`, `<img srcset>`, `<video poster>`, `<iframe src>`):
 *  - **Synchronously in the same task as the insertion, before the next microtask checkpoint:** images are called
 *    off — `<img src>` and `<img srcset>` 0 of 12 requests with the pass, 12 of 12 without its strip-before-remove step
 *    (`<video poster>` made no request in either build). An `<iframe>` still navigates when it is inserted into an attached
 *    tree (12 of 12 in both); on a tree that is NOT attached yet it does not (0 of 12).
 *  - **In a `MutationObserver` callback (a microtask) after `innerHTML` on an attached element, the outcome for `<img>`
 *    depends on the engine — two measurements disagree and the cause is not known:**
 *    - Chrome 154 headless (kitcc-w16, 15 repetitions): too late, the fetch is already issued — 15 of 15 requests with the
 *      pass, 15 of 15 without the strip. Stripping first lowered the count in some shapes (strip then remove: 3 of 12
 *      against 12 of 12 for remove alone) and not in others.
 *    - Obsidian 1.14.4, Chromium 142 (kitok-w16, second instance, visible window, 12 repetitions per arm, a unique URL per
 *      run, counted at the server): no guard 12 of 12; in the observer replace only 12 of 12, strip `src` then replace
 *      0 of 12, strip `src` only 0 of 12; synchronously strip and replace 0 of 12, synchronously replace only 12 of 12.
 *    What loads while styles are computed or while an element is created (a `style` attribute, SVG paint, `background`,
 *    `poster`, `feImage`) escaped the observer in Obsidian anyway: 66 of 402 cases.
 *  - A tree built in the live document but never attached still fetches its images (12 of 12), only its frames wait.
 *  So: parse inert; failing that, run the pass in the same task as the insertion and on a tree that is not attached; a
 *  `MutationObserver` is a net for what slipped through, not a boundary — for styles and paint in every engine measured,
 *  for `<img>` at least in Chrome 154.
 *
 *  **Because of that race, the pass strips before it removes:** before an element is removed or replaced it takes every
 *  attribute this module knows as loading (`src`, `srcset`, `imagesrcset`, `href`, `xlink:href`, `poster`, `data`,
 *  `background`, `lowsrc`, `dynsrc`, `srcdoc`) off the element AND off its whole subtree, local ones included, whatever
 *  the element kind (a removed `<object>`, `<picture>` or `<svg>` carries its loading children with it). The pass itself uses
 *  `root.ownerDocument` and `nodeType` / `localName` (no `instanceof`, no global `document`), so it works
 *  on nodes of such a document and on nodes from another realm (an iframe, a pop-out window).
 *
 *  ── What it removes ─────────────────────────────────────────────────────────────────────
 *  One classification with the regex pass: {@link isLocalRef} and the attribute tables are exported from
 *  `pure/safe-markdown` and imported here, not copied. A source is local when it is relative, a
 *  `#fragment`, or has one of `localSchemes` (default `app`, `data`, `capacitor`).
 *  - `src`, `poster`, `data`, `background`, `lowsrc`, `dynsrc` and the candidates of `srcset` /
 *    `imagesrcset` with a non-local value. An `<img>` that loses its source is REPLACED by the text
 *    `<alt> (<url>)`, as in the regex version, so nothing disappears silently; inside SVG (where text
 *    does not render) and for every other element the attribute is removed.
 *  - `href` by local name (`attr.localName === "href"`, so `xlink:href` and any prefix), also the literal
 *    `xlink:href` of an HTML element, on every element except `<a>` and `<area>` (SVG `<image>`, `<use>`,
 *    `<feImage>`, gradients, `<textPath>`, `<filter>`, `<mpath>` load without a click).
 *  - Document tags, UNCONDITIONALLY: `iframe`, `frame`, `frameset`, `object`, `embed`, `applet`, `script`,
 *    `link`, `base`, `portal`, `fencedframe`, `bgsound`, `webview` (Electron's guest view; Obsidian's windows enable it, so a `<webview>`
 *    is not a harmless unknown tag there) and `<meta http-equiv="refresh">`. Not by their
 *    source: `<iframe srcdoc>` has none, and a local frame can still run a document.
 *  - CSS, fail closed and blunt — the whole attribute or element goes, nothing is repaired and nothing is
 *    judged by its target: a `style` attribute, an SVG presentation attribute (`fill`, `stroke`, `filter`, `mask`,
 *    `clip-path`, `marker-*`, `cursor`, …) or a `<style>` element is removed as soon as its value, after escapes are
 *    resolved, contains `url(`, `src(`, `image-set(`, `image(`, `cross-fade(`, `attr(`, `@import`, `@function`, a
 *    backslash or a comment — local or remote alike (`cssLoadsRemote`). The one exception is the exact value
 *    `url(#id)` (Mermaid's markers and filters). **The price, on purpose:** a background image, a font or an
 *    `@import` that model output or a deck sets through CSS disappears even when it points at a vault file; an image
 *    belongs in an `<img>`. Why not judge the target: CSS was read as text (bypassed 43 times with real requests in
 *    Chromium), then by a hand-written token scanner (bypassed once more, by `@function --f(){result:"https://…"}`,
 *    whose string never stands at the call site) — a reader of CSS is always one feature behind CSS. For a `<style>`
 *    element the direct text nodes (what the browser uses) are scanned; a `<style>` that holds ELEMENTS (SVG only)
 *    goes unread. ANY other attribute with a `url(` / `src(` / `image-set(` / `@import` goes too (SMIL `to`, `from`,
 *    `values`, `by`, custom ones).
 *  - SMIL: `<set>` / `<animate>` with `attributeName` `href`, `xlink:href` or `src` — they would set the
 *    target AFTER this pass has run.
 *  - `template.content` is walked as well, nested.
 *  What stays: relative, `#fragment`, `app:`, `data:` and `capacitor:` sources in non-document tags (HTML attributes, not
 *  CSS), and `url(#marker)` references (Mermaid emits `url(#arrowhead)`, `url(#<id>-pointEnd)`; its `xmlns` /
 *  `xmlns:xlink` values are `http://` namespace names and are no sources).
 *
 *  ── Limits ──────────────────────────────────────────────────────────────────────────────
 *  (1) **A clickable link stays** (`<a href>`, `<area href>`, SVG `<a>`): it loads nothing without a
 *  click; a restored secret in its URL is a documented residual risk, as in the regex version. (2) **No
 *  script defence.** Event-handler attributes (`onerror`, `onload`) and `javascript:` in a link are not
 *  touched; this pass is about resources, not about code. (3) Shadow roots are not entered: never parse the input with
 *  `Document.parseHTMLUnsafe` / `setHTMLUnsafe` (declarative shadow DOM would hide an `<img>` from this walk — measured);
 *  `DOMParser.parseFromString` and `innerHTML` create none. (3b) **Never serialise the result and parse it again**
 *  (`outerHTML`, `innerHTML` read back, a template round trip): HTML serialisation does not round-trip for every tree
 *  (`<form><math><mtext></form><form><mglyph><style></math><img src=…>` re-parses with the `<img>` live — measured in
 *  Chrome, WebKit and Firefox), so a pass over the first tree says nothing about the second. Adopt the nodes. (4) The classification is lexical, not a URL parse: a value is local if it
 *  is relative or has a listed scheme after entities, backslashes, control characters and case are
 *  resolved, and remote otherwise — an unparsable value with a foreign scheme is therefore removed.
 *  (5) `capacitor:` is measured on iOS only (letterhead, on the device); Android is not measured, so a
 *  scheme the Android renderer uses for local files may be removed until it is added to `localSchemes`.
 *  (6) Written against the HTML parsers of Chromium and happy-dom; whether Chromium loads SMIL `href` or
 *  `cursor` without a click is a question for the real renderer, the removal does not wait for the answer.
 *  (7) A new URL-loading attribute this list does not know is not covered; the list is about what a
 *  browser loads on its own. Iterative (no recursion), linear in the number of elements and attributes.
 *
 *  ── Vendoring ───────────────────────────────────────────────────────────────────────────
 *  This module imports `../pure/safe-markdown`. A consumer that flattens `pure/` and `web/` into one
 *  directory (e.g. slide-deck `src/vendor/kit`) rewrites the import at the web target in its kit-sync
 *  config: `rewrite: [["../pure/", "./"]]`. */

import { CLICK_HREF_TAGS, DOCUMENT_TAGS, LOADING_ATTRS, SRCSET_ATTRS, cssLoadsRemote, isLocalRef } from "./safe-markdown";

/** Schemes that count as local for sources in a DOM: the app's own (`app:`), inline (`data:`) and the
 *  iOS Capacitor file scheme Obsidian resolves vault images to. */
export const DEFAULT_DOM_LOCAL_SCHEMES: readonly string[] = ["app", "data", "capacitor"];

export interface RemoteResourcesOptions {
  /** Replaces {@link DEFAULT_DOM_LOCAL_SCHEMES}. Names are compared case-insensitively, a trailing `:`
   *  is accepted. `data` / `app` / `capacitor` are never local in a document tag. */
  localSchemes?: readonly string[];
}

/** What the pass took out. `attr` is the attribute name as written, or `""` when the whole element went. */
export interface RemovedResource {
  tag: string;
  attr: string;
  ref: string;
}

const SVG_NS = "http://www.w3.org/2000/svg";
/** The tags that go as a whole; {@link DOCUMENT_TAGS} is the shared part, the rest only exist in a DOM. */
const REMOVED_TAGS: ReadonlySet<string> = new Set([...DOCUMENT_TAGS, "frameset", "applet", "bgsound", "fencedframe", "webview"]);
/** Attributes of an `<img>` that make it load: with one of them remote the element becomes text. */
const IMG_SOURCE_ATTRS: ReadonlySet<string> = new Set(["src", "srcset", "lowsrc", "dynsrc"]);
/** Presentation attributes read as CSS values. For these, and `style`, `attr()` / `image()` / `cross-fade()` count. */
const CSS_VALUED_ATTRS: ReadonlySet<string> = new Set([
  "style", "fill", "stroke", "filter", "mask", "mask-image", "clip-path", "clip", "marker", "marker-start", "marker-mid",
  "marker-end", "cursor", "shape-outside", "list-style-image", "border-image-source", "background-image",
]);
const SMIL_TARGETS: ReadonlySet<string> = new Set(["href", "xlink:href", "src"]);
const REF_CAP = 500;

const cap = (s: string): string => (s.length > REF_CAP ? `${s.slice(0, REF_CAP)}…` : s);

/** Walks `root` (an element, a fragment or a document) and removes what loads on its own and is not local.
 *  See the module header for the rules and the contract (inert tree). `removed` lists everything taken out,
 *  in document order; an element removed as a whole is reported once, not once per descendant. */
export function neutralizeRemoteResourcesInTree(root: ParentNode, opts: RemoteResourcesOptions = {}): { removed: RemovedResource[] } {
  const schemes = (opts.localSchemes ?? DEFAULT_DOM_LOCAL_SCHEMES).map((s) => s.replace(/:$/, "").toLowerCase());
  const removed: RemovedResource[] = [];
  const local = (value: string): boolean => isLocalRef(value, false, false, schemes);

  /** The remote reference an attribute carries, or null. */
  const remoteRef = (tag: string, a: Attr): string | null => {
    const name = a.name.toLowerCase();
    const n = a.localName.toLowerCase();
    const v = a.value;
    if (LOADING_ATTRS.has(n)) return local(v) ? null : v;
    if (SRCSET_ATTRS.has(n)) {
      // Every whitespace/comma separated token, not only the first of each "candidate": splitting on commas
      // alone cuts a data: URL in two, and a token that is only a descriptor (`2x`, `100w`) is relative.
      return v.split(/[\s,]+/).find((t) => t !== "" && !local(t)) ?? null;
    }
    if ((n === "href" || name === "xlink:href") && !CLICK_HREF_TAGS.has(tag)) return local(v) ? null : v;
    if (CSS_VALUED_ATTRS.has(n)) return cssLoadsRemote(v) ? v : null;
    // Any other attribute: only an explicit remote url()/src()/image-set()/@import counts (a free text may say "image(s)").
    return v.length > 4 && (v.includes("(") || v.includes("\\") || v.includes("@")) && cssLoadsRemote(v, false) ? v : null;
  };

  const report = (tag: string, attr: string, ref: string): void => {
    removed.push({ tag, attr, ref: cap(ref) });
  };

  /** Takes every attribute the pass knows as loading off `el` and off its whole subtree (`template.content` is another
   *  document and loads nothing). Run BEFORE an element leaves the tree: on a tree that is already attached, an `<img>`
   *  or `<iframe>` has its fetch scheduled the moment the attribute is set, and taking the element out does not call it
   *  off — removing the attribute does (measured in Obsidian 1.14.4: replace without strip 1 request, strip then replace 0).
   *  Linear: a removed subtree is not visited by the main walk again. */
  const defuse = (el: Element): void => {
    const strip = (node: Element): void => {
      for (const a of Array.from(node.attributes)) {
        const n = a.localName.toLowerCase();
        if (LOADING_ATTRS.has(n) || SRCSET_ATTRS.has(n) || n === "href" || n === "srcdoc" || a.name.toLowerCase() === "xlink:href") node.removeAttributeNode(a);
      }
    };
    strip(el);
    for (const d of Array.from(el.querySelectorAll("*"))) strip(d);
  };

  /** Takes `el` out of the tree. A root without a parent cannot be removed: it is stripped instead. */
  const dropElement = (el: Element, tag: string, ref: string): void => {
    defuse(el);
    const parent = el.parentNode;
    if (parent) parent.removeChild(el);
    else {
      for (const a of Array.from(el.attributes)) el.removeAttributeNode(a);
      while (el.firstChild) el.removeChild(el.firstChild);   // a root <style> keeps its rules otherwise
    }
    report(tag, "", ref);
  };

  /** Returns true when `el` is gone (its descendants are not visited). */
  const inspect = (el: Element): boolean => {
    const tag = el.localName.toLowerCase();
    const attrs = Array.from(el.attributes);   // a snapshot: removing while iterating the live map skips the next one
    const find = (...names: string[]): string => {
      for (const n of names) for (const a of attrs) if (a.localName.toLowerCase() === n) return a.value;
      return "";
    };

    if (REMOVED_TAGS.has(tag)) { dropElement(el, tag, find("src", "data", "href", "srcdoc")); return true; }
    if (tag === "meta" && /refresh/i.test(find("http-equiv"))) { dropElement(el, tag, find("content")); return true; }
    if (tag === "style") {
      // The browser reads the direct text nodes only. An SVG <style> can also hold ELEMENTS, whose text `textContent` adds
      // and the browser ignores: nobody writes such a style sheet, so it goes without being read (and nested ones cannot
      // make the pass rescan the same text once per level — measured: 50 MB of nested <style> took 9.5 s).
      let direct = "";
      for (const node of Array.from(el.childNodes)) if (node.nodeType === 3 || node.nodeType === 4) direct += node.nodeValue ?? "";
      if (el.children.length > 0 || cssLoadsRemote(direct)) { dropElement(el, tag, direct); return true; }
    }
    if (tag === "set" || tag === "animate") {
      const target = find("attributename").trim().toLowerCase();
      if (SMIL_TARGETS.has(target)) { dropElement(el, tag, find("to", "values", "from")); return true; }
    }

    const hits: { a: Attr; ref: string }[] = [];
    for (const a of attrs) {
      const ref = remoteRef(tag, a);
      if (ref !== null) hits.push({ a, ref });
    }
    if (hits.length === 0) return false;

    const parent = el.parentNode;
    const source = tag === "img" && el.namespaceURI !== SVG_NS ? hits.find((h) => IMG_SOURCE_ATTRS.has(h.a.localName.toLowerCase())) : undefined;
    if (source && parent) {
      const text = el.ownerDocument.createTextNode(`${el.getAttribute("alt") ?? ""} (${source.ref})`);
      defuse(el);
      parent.replaceChild(text, el);
      report(tag, source.a.name, source.ref);
      return true;
    }
    for (const { a, ref } of hits) {
      el.removeAttributeNode(a);
      report(tag, a.name, ref);
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
