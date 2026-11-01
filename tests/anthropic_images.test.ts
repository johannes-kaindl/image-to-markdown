import { describe, it, expect } from "vitest";
import { toAnthropicBody } from "../src/vendor/kit/anthropic-wire";
import { binaryToDataUrl } from "../src/vendor/kit/data-url";
import { SUPPORTED_EXTS } from "../src/img_to_md";

// Claude (Anthropic-API) ist ein Opt-in über den LLM Endpoint Manager (`transports.anthropic: "explicit"`, Kit 0.73.0).
// Die Wire (`anthropic-wire`) lässt ein Bild mit einem Typ außerhalb von JPEG, PNG, GIF und WebP STILL weg: die Anfrage geht dann
// ohne Bild hinaus, ohne Fehler (gemessen am Code, `imageBlock` gibt `null` zurück). Diese Tests sichern, dass kein Bild, das dieses
// Plugin sendet, auf diesem Weg verschwindet — und dass die Wire ihn weiter so beschreibt, damit eine Änderung dort auffällt.

const BYTES = new Uint8Array([1, 2, 3, 4]);

/** Die Nutzernachricht, wie `imageMessages` in `main.ts` sie baut (Text plus ein `image_url`-Teil). */
const body = (url: string) => ({
  model: "claude-sonnet-5-5",
  messages: [{ role: "user", content: [{ type: "text", text: "Transcribe." }, { type: "image_url", image_url: { url } }] }],
});

const userBlocks = (url: string): Array<Record<string, unknown>> => {
  const out = toAnthropicBody(body(url), { caps: null });
  const msgs = out.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>;
  return msgs[0]?.content ?? [];
};

const images = (blocks: Array<Record<string, unknown>>) => blocks.filter((b) => b.type === "image");

describe("Claude-Wire — Bilder", () => {
  it.each(SUPPORTED_EXTS)("jedes vom Plugin gesendete Format (.%s) kommt als Bildblock an, mit erlaubtem Typ", (ext) => {
    const imgs = images(userBlocks(binaryToDataUrl(BYTES, ext)));
    expect(imgs).toHaveLength(1);
    const source = imgs[0]?.source as { type: string; media_type: string; data: string };
    expect(source.type).toBe("base64");
    expect(["image/jpeg", "image/png", "image/gif", "image/webp"]).toContain(source.media_type);
    expect(source.data).toBe("AQIDBA==");
  });

  it("PDF-Seiten und das Testbild der Einstellungen sind PNG und kommen an", () => {
    expect(images(userBlocks("data:image/png;base64,AQID"))).toHaveLength(1);
  });

  it("Gegenprobe: ein Typ außerhalb der vier wird von der Wire STILL weggelassen (kein Bildblock, kein Fehler)", () => {
    // Genau das darf diesem Plugin nie passieren; deshalb prüft der Test oben jede Endung aus SUPPORTED_EXTS.
    for (const ext of ["svg", "bmp", "heic", "tiff"]) {
      const url = binaryToDataUrl(BYTES, ext);
      expect(images(userBlocks(url)), `.${ext}`).toHaveLength(0);
    }
    // Der Text der Nachricht bleibt: die Anfrage geht ohne Bild hinaus.
    expect(userBlocks(binaryToDataUrl(BYTES, "svg")).map((b) => b.type)).toEqual(["text"]);
  });

  it("die unterstützten Endungen sind genau die vier Typen der API (jpg und jpeg teilen sich einen)", () => {
    const typen = new Set(SUPPORTED_EXTS.map((e) => binaryToDataUrl(BYTES, e).slice(5, binaryToDataUrl(BYTES, e).indexOf(";"))));
    expect([...typen].sort()).toEqual(["image/gif", "image/jpeg", "image/png", "image/webp"]);
  });
});
