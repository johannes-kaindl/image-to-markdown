import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { findVendoredCss, missingKitCss } from "./vendor/kit/kit-css";

// Kit-Vertrag: die `*_CSS`-Konstanten gevendorter Bausteine stehen wortgleich in der styles.css.
describe("Kit-CSS (Wächter)", () => {
  it("die gevendorten Bausteine tragen CSS-Konstanten, und styles.css führt sie wortgleich", () => {
    expect(findVendoredCss("src/vendor/kit-obsidian").length).toBeGreaterThan(0);
    expect(missingKitCss("src/vendor/kit-obsidian", readFileSync("styles.css", "utf8"))).toEqual([]);
  });

  // Seit obsidian-kit 0.89.0 setzen die Kit-CSS-Konstanten einander ein (`${COPY_BUTTON_CSS}`): ein Einsetzungs-Rest in styles.css wäre ungültiges CSS.
  it("styles.css enthält keine ${…}-Einsetzung", () => {
    expect(readFileSync("styles.css", "utf8")).not.toContain("${");
  });
});
