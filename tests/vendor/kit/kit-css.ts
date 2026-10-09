// vendored from obsidian-kit@0.51.3, src/testing/kit-css.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// uebernommen aus 3d-codeblocks/tests/kit-css.test.ts, 2026-10-09
/** Kit-Vertrag: Die `*_CSS`-Konstanten gevendorter Kit-Bausteine gehören wortgleich in die `styles.css`
 *  des Konsumenten — vendort wird nur das Verhalten, die Darstellung ist eine Kopie. Fehlt eine,
 *  sieht der Baustein ohne Fehlermeldung kaputt aus (kein Status-Icon, kein Layout).
 *
 *  Der Helfer liest die Konstanten aus dem Quelltext der gevendorten Dateien, statt sie einzeln zu
 *  importieren: Der Konsument listet nichts von Hand auf, und eine mit dem nächsten Vendoring neu
 *  dazugekommene Konstante wird von selbst mitgeprüft.
 *
 *  Konsumenten-Test (zwei Zeilen, Ordner nach dem eigenen `kit-sync.json`):
 *  ```ts
 *  expect(findVendoredCss(vendorDir).length).toBeGreaterThan(0);   // der Wächter findet überhaupt etwas
 *  expect(missingKitCss(vendorDir, readFileSync("styles.css", "utf8"))).toEqual([]);
 *  ```
 *  Eingeschränkt auf Konstanten, die als Template-Literal ohne `\` und `${` stehen (so sind alle
 *  Kit-Konstanten gebaut; ein Backtick im Kommentar bräche den String schon im Kit). */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface VendoredCss { name: string; module: string; css: string }

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []);
}

/** Alle exportierten `*_CSS`-Konstanten unter `vendorDir` (rekursiv, nur `.ts`), mit dem Wert getrimmt. */
export function findVendoredCss(vendorDir: string): VendoredCss[] {
  const out: VendoredCss[] = [];
  for (const file of tsFiles(vendorDir)) {
    for (const m of readFileSync(file, "utf8").matchAll(/export const ([A-Z][A-Z0-9_]*_CSS)(?::\s*string)? = `([^`]*)`/g)) {
      out.push({ name: m[1] ?? "", module: file, css: (m[2] ?? "").trim() });
    }
  }
  return out;
}

/** Namen der Konstanten unter `vendorDir`, die nicht wortgleich in `stylesCss` stehen. */
export function missingKitCss(vendorDir: string, stylesCss: string): string[] {
  return findVendoredCss(vendorDir).filter((h) => !stylesCss.includes(h.css)).map((h) => h.name).sort();
}
