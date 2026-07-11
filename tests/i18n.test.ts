import { describe, it, expect, beforeEach } from "vitest";
import { t, setLang, getLang, pickLang, defaultVisionPrompt, STRINGS } from "../src/i18n";

describe("i18n", () => {
  beforeEach(() => setLang("en"));

  it("pickLang erkennt Deutsch, sonst Englisch", () => {
    expect(pickLang("de")).toBe("de");
    expect(pickLang("de-DE")).toBe("de");
    expect(pickLang("en")).toBe("en");
    expect(pickLang("en-US")).toBe("en");
    expect(pickLang(undefined)).toBe("en");
    expect(pickLang(null)).toBe("en");
    expect(pickLang("")).toBe("en");
  });

  it("setLang/getLang", () => {
    setLang("de");
    expect(getLang()).toBe("de");
  });

  it("t liefert die Sprache, Fallback en, dann key", () => {
    setLang("de");
    expect(t("notice.copied")).toBe("Kopiert");
    setLang("en");
    expect(t("notice.copied")).toBe("Copied");
    expect(t("does.not.exist")).toBe("does.not.exist");
  });

  it("t interpoliert {0}/{1}", () => {
    setLang("en");
    expect(t("core.imageNotFound", "a.png")).toBe("Image not found: a.png");
    expect(t("view.cardHead", 1, 2, "a.png")).toBe("Image 1/2 · a.png");
  });

  it("t lässt unbesetzte Platzhalter stehen", () => {
    setLang("en");
    expect(t("view.cardHead", 1)).toBe("Image 1/{1} · {2}");
  });

  it("defaultVisionPrompt wechselt mit der Sprache", () => {
    setLang("de");
    expect(defaultVisionPrompt()).toContain("Markdown");
    expect(defaultVisionPrompt()).toContain("Überschriften");
    setLang("en");
    expect(defaultVisionPrompt()).toContain("headings");
  });

  it("view.thisFile EN/DE", () => {
    setLang("en"); expect(t("view.thisFile")).toBe("this file");
    setLang("de"); expect(t("view.thisFile")).toBe("diese Datei");
  });

  it("pdf.textLayerPrompt schärft den Wortlaut-Erhalt (EN/DE)", () => {
    setLang("en"); expect(t("pdf.textLayerPrompt")).toContain("exact");
    setLang("de"); expect(t("pdf.textLayerPrompt")).toContain("exakt");
    setLang("en");
  });

  it("EN/DE-Schlüssel sind deckungsgleich (keine fehlende Übersetzung)", () => {
    const en = Object.keys(STRINGS.en).sort();
    const de = Object.keys(STRINGS.de).sort();
    expect(de).toEqual(en);
  });

  it("thinking-toggle Keys EN/DE", () => {
    setLang("en");
    expect(t("view.thinkingOn")).toBe("Thinking: on");
    expect(t("view.thinkingOff")).toBe("Thinking: off");
    expect(t("view.thinkingAlways")).toBe("Thinking: always on");
    setLang("de");
    expect(t("view.thinkingOn")).toBe("Thinking: an");
    expect(t("view.thinkingOff")).toBe("Thinking: aus");
    expect(t("view.thinkingAlways")).toBe("Thinking: immer an");
    setLang("en");
  });

  it("Diff-Keys vorhanden (EN)", () => {
    setLang("en");
    expect(t("diff.overwrite")).toBe("Overwrite");
    expect(t("diff.modal.title", "note")).toContain("note");
  });
});
