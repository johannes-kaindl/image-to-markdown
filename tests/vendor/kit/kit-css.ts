// vendored from obsidian-kit@0.95.0, src/testing/kit-css.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
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
 *  Eingeschränkt auf Konstanten, die als Template-Literal ohne `\` stehen (so sind alle Kit-Konstanten gebaut; ein Backtick im
 *  Kommentar bräche den String schon im Kit). Eine Einsetzung `${NAME}` löst der Helfer auf (seit 0.89.0): er ersetzt sie durch den
 *  Wert der gefundenen Konstante `NAME`, auch aus einer anderen Datei und verschachtelt, und liefert den Text, den die Konstante
 *  zur Laufzeit hätte. Ein Kreis (`A` in `B` in `A`) wirft einen Fehler mit dem Kreis, statt zu schleifen. Lässt sich eine Einsetzung
 *  nicht auflösen (unbekannter Name, ein Ausdruck statt eines Namens), bleibt das `${…}` im Text stehen und `missingKitCss` meldet die
 *  Konstante als fehlend: eine `styles.css`, die den Rohtext `${…}` trägt, erfüllt den Wächter nie (svg-studio 0.1.3 trug
 *  `${COPY_BUTTON_CSS}` im Stylesheet — Store-Scorecard „Caution“ —, weil der Wächter vorher den Rohtext verlangte). Das Kit selbst
 *  setzt seit 0.89.0 nichts mehr ein (`tests/kit-css-literal.test.ts`); die Auflösung gilt Konsumenten, die ältere Module vendort haben. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface VendoredCss { name: string; module: string; css: string }

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []);
}

const SUBST = /\$\{([A-Z][A-Z0-9_]*)\}/g;

/** Alle exportierten `*_CSS`-Konstanten unter `vendorDir` (rekursiv, nur `.ts`), Einsetzungen aufgelöst, der Wert getrimmt.
 *  Wirft bei einem Kreis von Einsetzungen. */
export function findVendoredCss(vendorDir: string): VendoredCss[] {
  const found: { name: string; module: string; raw: string }[] = [];
  for (const file of tsFiles(vendorDir)) {
    for (const m of readFileSync(file, "utf8").matchAll(/export const ([A-Z][A-Z0-9_]*_CSS)(?::\s*string)? = `([^`]*)`/g)) {
      found.push({ name: m[1] ?? "", module: file, raw: m[2] ?? "" });
    }
  }
  const byName = new Map<string, string>();
  for (const f of found) if (!byName.has(f.name)) byName.set(f.name, f.raw);
  const done = new Map<string, string>();
  const resolve = (name: string, chain: string[]): string => {
    const memo = done.get(name);
    if (memo !== undefined) return memo;
    if (chain.includes(name)) throw new Error(`Kreis von Einsetzungen in *_CSS-Konstanten: ${[...chain.slice(chain.indexOf(name)), name].join(" -> ")}`);
    const raw = byName.get(name) ?? "";
    const text = raw.replace(SUBST, (whole, ref: string) => (byName.has(ref) ? resolve(ref, [...chain, name]) : whole));
    done.set(name, text);
    return text;
  };
  return found.map((f) => ({ name: f.name, module: f.module, css: resolve(f.name, []).trim() }));
}

/** Namen der Konstanten unter `vendorDir`, die nicht wortgleich (nach Auflösung der Einsetzungen) in `stylesCss` stehen.
 *  Eine Konstante mit nicht auflösbarer Einsetzung gilt immer als fehlend, auch wenn die `styles.css` denselben Rohtext trägt. */
export function missingKitCss(vendorDir: string, stylesCss: string): string[] {
  return findVendoredCss(vendorDir).filter((h) => h.css.includes("${") || !stylesCss.includes(h.css)).map((h) => h.name).sort();
}
