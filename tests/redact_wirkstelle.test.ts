import { describe, it, expect } from "vitest";
import { redactMessages } from "../src/vendor/kit-obsidian/chat-client";
import { createPiiRedactor, redactText } from "../src/vendor/kit/redact";

/** Sicherheitsfix code-kit 0.79.1 (Geheimnis hinter Wortzeichen) und 0.82.0 (IBAN hinter `_`). Die Wirkstelle ist die Schwärzung der gesendeten
 *  Nachrichten (`redactMessages`, dieselbe Sitzung, die `createLlmConnection` vor jeder Anfrage fährt): ein Geheimnis, das ein Modell oder eine OCR-Zeile
 *  an ein Wort klebt, bleibt sonst im Klartext. Mit dem alten Stand (code-kit 0.60.0) stehen diese Fälle rot. */
describe("redact an der Wirkstelle (code-kit 0.87.0)", () => {
  const KEY = "sk-proj-abcdefghijklmnop1234";

  it("schwärzt ein Geheimnis hinter einem Unterstrich (key_sk-proj-…) in gesendeten Nachrichten", () => {
    const r = redactMessages([{ role: "user", content: `Transkript: key_${KEY} und AKIAABCDEFGHIJKLMNOP` }]);
    const out = JSON.stringify(r.messages);
    expect(out).not.toContain(KEY);
    expect(out).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(r.count).toBeGreaterThanOrEqual(2);
  });

  it("schwärzt das Geheimnis auch ohne Wortzeichen davor (Kontrolle: die Regel greift überhaupt)", () => {
    expect(redactText(`Token ${KEY}`).text).not.toContain(KEY);
  });

  it("lässt gewöhnliche Wörter auf -sk- unberührt (Grenze des Fixes)", () => {
    expect(redactText("task-abcdefghijklmnop1234").count).toBe(0);
  });

  it("liest eine IBAN hinter `_` als IBAN (iban_DE89…)", () => {
    const out = createPiiRedactor().text("Konto iban_DE89370400440532013000 bitte");
    expect(out).toContain("[IBAN_1]");
    expect(out).not.toContain("DE89");
  });
});
