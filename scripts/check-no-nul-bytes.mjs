#!/usr/bin/env node
// check-no-nul-bytes.mjs — verbietet NUL-Bytes in tracked Textdateien.
// Kanonische Quelle: _docs/templates/scripts/check-no-nul-bytes.mjs — per Repo verbatim kopiert.
//
// Warum das ein Gate ist und kein Schoenheitsfehler: git und grep stufen eine Datei mit
// einem einzigen NUL-Byte als binaer ein. `grep -r <symbol>` findet ihren Inhalt dann nicht
// mehr — und genau davon lebt der Kit-first-Vorher-Check. Kein Test wird dabei je rot.
//
// Zwei belegte Faelle: vault-rag/src/frontmatter.ts trug vier NUL-Bytes in einem
// String-Literal ("\x00BODY\x00" statt " BODY "), json_viewer/src/core/schema.ts eines als
// Trennzeichen in einem Composite-Key. Der zweite Fall ist inhaltlich richtig — ein NUL kann
// in keinem der verbundenen Werte vorkommen, das ist sein Zweck. Falsch ist nur die
// Schreibweise als rohes Byte: die Escape-Sequenz (Backslash-u-0000) erzeugt denselben Laufzeitwert und
// haelt die Datei als Text lesbar. Der Fix ist also nie "das NUL rauswerfen", sondern
// "das NUL escapen".
//
// Exit 0 = sauber, 1 = Fund, 2 = Werkzeugfehler (git nicht verfuegbar, Datei unlesbar).
// Die Trennung ist Absicht: ein kaputtes Werkzeug darf nicht wie ein bestandener Check aussehen.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Endungen, die als Text gelten. Bewusst eine Positivliste: alles andere (Bilder, Fonts,
// PDFs, Binaerartefakte) darf und muss NUL-Bytes enthalten.
const TEXT_EXT = /\.(ts|tsx|js|mjs|cjs|mts|md|json|css|yml|yaml|html|sh|py)$/;

let files;
try {
  files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter((f) => f && TEXT_EXT.test(f));
} catch (err) {
  console.error(`check-no-nul-bytes: git ls-files schlug fehl: ${err.message}`);
  process.exit(2);
}

const hits = [];
for (const file of files) {
  let buf;
  try {
    buf = readFileSync(file);
  } catch (err) {
    console.error(`check-no-nul-bytes: ${file} nicht lesbar: ${err.message}`);
    process.exit(2);
  }
  const at = buf.indexOf(0);
  if (at !== -1) hits.push(`${file}: NUL-Byte an Offset ${at}`);
}

if (hits.length > 0) {
  console.error("check-no-nul-bytes: NUL-Bytes in tracked Textdateien:");
  for (const h of hits) console.error(`  ${h}`);
  console.error("Diese Dateien gelten als binaer — grep/git-grep finden ihren Inhalt nicht.");
  console.error("Fix: das Byte als Escape-Sequenz schreiben (\\u0000), nicht roh.");
  process.exit(1);
}

console.log(`check-no-nul-bytes: OK — ${files.length} Textdateien ohne NUL-Bytes`);
