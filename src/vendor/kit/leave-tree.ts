// vendored from code-kit@0.91.1, src/ts/web/leave-tree.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Takes an element out of a DOM tree — at once where that is safe, a moment later where the element holds a frame
 *  the host is still asking about. Written here for `web/remote-resources` and `web/link-guard` (code-kit, 2026-11-15);
 *  both passes drop elements through {@link leaveTree}, so one element is handled once whichever pass meets it first.
 *
 *  ── Why a frame may not leave in the task it arrived in ─────────────────────────────────
 *  Measured in Obsidian 1.15.1 (Chrome 142, Electron) by obsidian-kit, Welle 34, 2026-11-14 (33 fresh starts): an
 *  `<iframe>` with an `app:`, a relative or a `file:` target that is inserted into the live document and removed in the
 *  same task makes Obsidian's MAIN process throw. Its `webRequest.onBeforeRequest` handler for `app://` reads
 *  `details.frame.origin`; the request is already under way, the frame is gone, `frame` is `undefined`. Obsidian shows
 *  the modal box "A JavaScript error occurred in the main process" and answers nothing until it is clicked (10 of 13
 *  starts with the guard, 20 of 20 with a bare `innerHTML` + `remove()` and no plugin loaded). The cause is in the host,
 *  the trigger was this library: it removed the frame in the task of the insertion.
 *
 *  ── How long ────────────────────────────────────────────────────────────────────────────
 *  One task later is not enough. Measured on 2026-11-15 in Obsidian 1.15.1 with obsidian-kit's `pilot/haenger.ts`, a fresh
 *  process per start, load 2 to 7:
 *  - removal in the task of the pass (the old code): the exception in 4 of 5 starts, one frame each;
 *  - `setTimeout(…, 0)`: in 1 of 21 starts over the guard (six frames with an `app:`, relative or `file:` target per start;
 *    the removal ran 1 ms after the source was taken off), and in 5 of 5 starts of a burst (40 frames 25 ms apart, the pass
 *    in the task of each insertion), each time within the first 40 frames;
 *  - the same burst with 50 ms, 250 ms and 1 000 ms: no exception in 5 starts each (600 frames per delay).
 *  {@link FRAME_REMOVAL_DELAY_MS} is 250: five times the shortest delay that held. It is a margin, see limit (1).
 *
 *  ── The rule ────────────────────────────────────────────────────────────────────────────
 *  An element leaves LATER when both hold: (1) it is in a live document — `isConnected`, and its `ownerDocument` has a
 *  `defaultView` — and (2) it is, or its subtree holds, a frame owner (`iframe`, `frame`, `object`, `embed`, by local
 *  name in any namespace; a wrong hit only delays a removal). Then, in the task of the call, the element is cut down to
 *  a skeleton: it keeps the frame owners in its subtree and the elements on the way to them, and nothing else. Every
 *  other node of the subtree — an element that holds no frame, every text, comment and CDATA node, also the ones directly
 *  under a kept element — leaves at once; the kept elements lose ALL attributes, the element itself gets `hidden`, and
 *  its removal is handed to `defer` (default: the `setTimeout` of the element's own window,
 *  {@link FRAME_REMOVAL_DELAY_MS}). What waits is a chain of bare elements under a hidden one: nothing on it loads,
 *  navigates, fires or styles. Everything else leaves at once, as before: an inert document (`DOMParser`,
 *  `createHTMLDocument`, `template.content`) has no `defaultView` and a tree that is not attached creates no frame.
 *
 *  Why the cut and not only the attributes (0.72.1; found by obsidian-kit when it vendored 0.72.0, Welle 35, 2026-11-15):
 *  a `<style>` acts by its TEXT and applies to the whole page from inside a hidden subtree. Up to 0.72.0 the skeleton
 *  kept its descendants, so `<object data="x"><style>body{background:url(https://…)}</style></object>` left the rule
 *  in the live document for the whole delay — measured in Chromium 153 (`npm run check:link-guard-chromium`, the cases
 *  `frame-skeleton-style-…`): the rule applied and its `url()` was fetched in the arms `sync` and `observer`, where the
 *  code before `leave-tree` held (the subtree left in the task of the pass). Text goes for the same reason and because
 *  a host that reads `textContent` (a copy button) must not find the fallback text of something that is being removed.
 *
 *  A waiting element is remembered (a `WeakSet`, so nothing a document writes can forge or clear the mark). A pass that
 *  meets it again calls {@link stillLeaving}: attributes that came back are taken off, nodes that were put into the
 *  skeleton are cut out again, nothing is reported or scheduled twice, and a skeleton that is already bare is not
 *  touched — a `MutationObserver` that runs the pass on every record comes to rest.
 *
 *  ── Limits ──────────────────────────────────────────────────────────────────────────────
 *  (1) The delay is a margin against a race in another process, not a handshake: nothing in a renderer tells when the
 *  host has finished with the request (the `load` event of the emptied frame is raised by the renderer alone). A main
 *  process that stands still for longer than the delay loses the race again; 600 frames without a hit bound the rate
 *  below about 0.5 %, they do not make it zero. A caller with a better signal passes its own `defer`. (2) The caller that takes
 *  the PARENT out in the same task removes the frame with it; this module only decides about the element it is given.
 *  (3) Until the deferred removal ran, `querySelector("iframe")` still finds the skeleton (its elements, without
 *  attributes and without text). A frame owner that is nested in another one (`<object><embed>`) waits with it. (4) The mark lives in this module: two bundled copies of it (two plugins) do not see each other's marks,
 *  which costs a second report, not a second request. (5) What `<object>` and `<embed>` do to their frame when `data` /
 *  `src` and their box go is the engine's business; they are deferred with the frames because they can own one. */
export type DeferRemoval = (remove: () => void) => void;

/** How long a frame that leaves the live document waits before the default removal, in milliseconds. See the module header
 *  ("How long") for the measurement behind the number. */
export const FRAME_REMOVAL_DELAY_MS = 250;

/** Elements that can own a nested browsing context. */
export const FRAME_OWNER_TAGS: ReadonlySet<string> = new Set(["iframe", "frame", "object", "embed"]);
const FRAME_OWNER_SELECTOR = "iframe,frame,object,embed";
const KEPT_ATTR = "hidden";

const leaving = new WeakSet<Element>();

/** Takes every attribute off `el`; with `keepHidden` the `hidden` attribute stays. Removes only what is there. */
function strip(el: Element, keepHidden: boolean): void {
  for (const a of Array.from(el.attributes)) {
    if (keepHidden && a.name.toLowerCase() === KEPT_ATTR) continue;
    el.removeAttributeNode(a);
  }
}

/** Cuts `el` down to its skeleton: `el` keeps `hidden` and nothing else; below it only the frame owners and the elements
 *  on the way to them stay, without attributes; every other node (element, text, comment) is removed now. Writes only
 *  where something has to change. Linear in the subtree: one `querySelectorAll`, each ancestor chain walked until it
 *  meets one that is known, each node looked at once (no recursion, a DOM built through the API has no depth limit). */
function bare(el: Element): void {
  strip(el, true);
  if (!el.hasAttribute(KEPT_ATTR)) el.setAttribute(KEPT_ATTR, "");
  const keep = new Set<Element>([el]);
  for (const owner of Array.from(el.querySelectorAll(FRAME_OWNER_SELECTOR))) {
    for (let n: Element | null = owner; n !== null && !keep.has(n); n = n.parentElement) keep.add(n);
  }
  const stack: Element[] = [el];
  for (let cur = stack.pop(); cur; cur = stack.pop()) {
    for (const child of Array.from(cur.childNodes)) {
      if (child.nodeType === 1 && keep.has(child as Element)) {
        strip(child as Element, false);
        stack.push(child as Element);
      } else cur.removeChild(child);
    }
  }
}

/** Is `el` waiting for its deferred removal? */
export function isLeavingTree(el: Element): boolean {
  return leaving.has(el);
}

/** For a pass that walks a tree: `false` when `el` is an ordinary element. `true` when it waits for its deferred
 *  removal — it is cut down to its skeleton again if something put attributes or nodes back, and the pass skips it and
 *  its subtree. */
export function stillLeaving(el: Element): boolean {
  if (!leaving.has(el)) return false;
  bare(el);
  return true;
}

/** Takes `el` out of its parent: `"removed"` at once, `"deferred"` when it holds a frame in a live document (see the
 *  module header; the element is a bare, hidden skeleton from now on and `defer` got the removal), `"rootless"` when it has no
 *  parent and nothing was done. `defer` replaces the default `setTimeout(remove, FRAME_REMOVAL_DELAY_MS)` of the element's window. */
export function leaveTree(el: Element, defer?: DeferRemoval): "removed" | "deferred" | "rootless" {
  const parent = el.parentNode;
  if (!parent) return "rootless";
  const view = el.ownerDocument.defaultView;
  const holdsFrame = FRAME_OWNER_TAGS.has(el.localName.toLowerCase()) || el.querySelector(FRAME_OWNER_SELECTOR) !== null;
  if (view === null || !el.isConnected || !holdsFrame) {
    parent.removeChild(el);
    return "removed";
  }
  bare(el);
  leaving.add(el);
  const remove = (): void => {
    const now = el.parentNode;   // the tree may be gone or rebuilt by then: remove from wherever the element is
    if (now) now.removeChild(el);
  };
  if (defer) defer(remove);
  else view.setTimeout(remove, FRAME_REMOVAL_DELAY_MS);
  return "deferred";
}
