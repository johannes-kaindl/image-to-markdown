// vendored from code-kit@0.37.5, src/ts/pure/data-url.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Origin: koda-agent `src/core/tools/images.ts` (header: "taken over from slide-deck/src/adapter.ts, 2026-09-30") and
// slide-deck `src/adapter.ts` — the same 8 lines twice, differing only in the table (koda-agent leaves out SVG). Also
// replaces the inline versions in obsidian-letterhead (`src/obsidian/main.ts:238`), local-image-generator
// (`src/main.ts:385`) and image-to-markdown (`src/main.ts:240,313,418,454`). The inverse direction (`dataUrlToBytes`,
// `base64ToBytes`) is local-image-generator's `src/obsidian/png.ts:22` (`atob`), added on the master's word. Welle 22, 2026-10-14.

/** The image types every caller handles. SVG is in the table (slide-deck, letterhead). koda-agent leaves it out of its
 *  *vision* list on purpose ("it is text, no vision endpoint takes it as `image_url`") — that is a rule about what to
 *  send to a model, not about what the extension means, so it stays with koda-agent: `ext !== "svg"` before calling.
 *  A `Map`, not an object literal: `mimeForExtension("constructor")` must not find a prototype member. */
const MIME_BY_EXTENSION: ReadonlyMap<string, string> = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["svg", "image/svg+xml"],
]);

/** MIME type for a file extension (`"png"`, `".PNG"`), or `null` when the extension is not one of the six above.
 *  Case-insensitive; one leading dot is ignored. */
export function mimeForExtension(ext: string): string | null {
  const key = (ext.startsWith(".") ? ext.slice(1) : ext).toLowerCase();
  return MIME_BY_EXTENSION.get(key) ?? null;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Standard Base64 (RFC 4648 §4, with `=` padding) of the bytes in `bytes`. Linear time and no `btoa`/`Buffer`: the
 *  `pure/` layer promises to run anywhere, and the old `String.fromCharCode(...chunk)` + `btoa` pair needed a chunk
 *  size to stay under the argument limit and built a second, binary string as large as the input.
 *  A view (`subarray`) is encoded as the view, not as the buffer behind it. */
export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  const n = bytes.length;
  // 3 bytes → 4 characters. Flushed in blocks so the array of parts stays small for multi-MB inputs.
  let block = "";
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const v = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    block += ALPHABET.charAt((v >> 18) & 63) + ALPHABET.charAt((v >> 12) & 63) + ALPHABET.charAt((v >> 6) & 63) + ALPHABET.charAt(v & 63);
    if (block.length >= 0x10000) {
      parts.push(block);
      block = "";
    }
  }
  const rest = n - i;
  if (rest === 1) {
    const v = (bytes[i] ?? 0) << 16;
    block += `${ALPHABET.charAt((v >> 18) & 63)}${ALPHABET.charAt((v >> 12) & 63)}==`;
  } else if (rest === 2) {
    const v = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
    block += `${ALPHABET.charAt((v >> 18) & 63)}${ALPHABET.charAt((v >> 12) & 63)}${ALPHABET.charAt((v >> 6) & 63)}=`;
  }
  parts.push(block);
  return parts.join("");
}

/** Character → 6-bit value, `-1` for anything outside the standard alphabet (`=` included). */
const DECODE: Int8Array = (() => {
  const t = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) t[ALPHABET.charCodeAt(i)] = i;
  return t;
})();

/** Decodes standard Base64 (RFC 4648 §4) the way the platform's `atob` does — the "forgiving" rule of the WHATWG spec:
 *  ASCII whitespace anywhere is ignored, padding is optional, one or two `=` are allowed at the end of a length that is a
 *  multiple of four. Everything else is an error (`Error`, message starts with "invalid base64"): a character outside
 *  `A-Za-z0-9+/`, `=` anywhere but the end, a length that leaves one character over. The URL-safe alphabet (`-`, `_`) is a
 *  different encoding and is refused.
 *
 *  The result owns its buffer — `out.buffer.byteLength === out.length` — so `out.buffer` can be handed to an API that wants
 *  an `ArrayBuffer` (`vault.createBinary`). Linear time. */
export function base64ToBytes(text: string): Uint8Array {
  let s = text.replace(/[\t\n\f\r ]+/g, "");
  if (s.length % 4 === 0) {
    if (s.endsWith("==")) s = s.slice(0, -2);
    else if (s.endsWith("=")) s = s.slice(0, -1);
  }
  const n = s.length;
  if (n % 4 === 1) throw new Error("invalid base64: a length of 4k + 1 characters cannot be decoded");
  const out = new Uint8Array(Math.floor((n * 3) / 4));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? (DECODE[c] ?? -1) : -1;
    if (v < 0) throw new Error(`invalid base64: unexpected character at position ${i}`);
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
      acc &= (1 << bits) - 1;
    }
  }
  return out;
}

/** The bytes of a `data:<media type>;base64,<payload>` URL — the inverse of {@link binaryToDataUrl}. The media type and its
 *  parameters (`;charset=utf-8`) are not looked at; `data:` and `;base64` match in any case.
 *
 *  Throws (`Error`) when the text is no data URL, when it is not the Base64 form (`data:text/plain,hello%20world`), or when
 *  the payload is broken ({@link base64ToBytes}). local-image-generator's version (`src/obsidian/png.ts`) decoded whatever
 *  stood behind the first comma and so turned any string into some bytes or an `atob` exception; this one says which of the
 *  three it was. */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const m = /^data:([^,]*),/i.exec(dataUrl);
  if (m === null) throw new Error("not a data URL: expected `data:<media type>;base64,<payload>`");
  if (!/;base64$/i.test(m[1] ?? "")) throw new Error("unsupported data URL: only the base64 form can be decoded");
  return base64ToBytes(dataUrl.slice(m[0].length));
}

/** `data:<mime>;base64,<payload>` for a binary file's contents, the MIME type taken from `ext`.
 *
 *  An extension outside the table gives `application/octet-stream` (koda-agent, slide-deck). That differs from two other
 *  versions: local-image-generator and image-to-markdown build `image/<ext>`, but both sit behind an extension filter that
 *  lets only the six above through (image-to-markdown `SUPPORTED_EXTS`, local-image-generator's picker), so no reachable
 *  input differs. **obsidian-letterhead differs for real:** its `logoPath` is free text without a filter, and it answers
 *  `image/jpeg` for `logo.bmp`, `logo.jpe` or a name without an extension. To keep that, letterhead writes
 *  `` `data:${mimeForExtension(ext) ?? "image/jpeg"};base64,${bytesToBase64(bytes)}` ``; whether a browser renders an
 *  `<img>` with `application/octet-stream` is not measured, so the old answer is not assumed to be wrong.
 *
 *  @example binaryToDataUrl(new Uint8Array([1, 2, 3]), "png") // → "data:image/png;base64,AQID" */
export function binaryToDataUrl(buf: ArrayBuffer | Uint8Array, ext: string): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return `data:${mimeForExtension(ext) ?? "application/octet-stream"};base64,${bytesToBase64(bytes)}`;
}
