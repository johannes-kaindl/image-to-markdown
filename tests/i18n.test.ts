import { describe, it, expect, beforeEach } from "vitest";
import { t, setLang, getLang, pickLang, defaultVisionPrompt } from "../src/i18n";

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
});
