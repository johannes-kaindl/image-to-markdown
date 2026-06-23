import esbuild from "esbuild";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const workerEntry = require.resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs");

const result = await esbuild.build({
  entryPoints: [workerEntry],
  bundle: true, format: "iife", target: "es2020",
  minify: true, write: false, legalComments: "none", logLevel: "info",
});

const code = result.outputFiles[0].text;
writeFileSync(
  "src/pdf-worker-src.generated.ts",
  "// AUTO-GENERATED – nicht editieren. Quelle: pdfjs-dist legacy worker.\n" +
    "export const PDF_WORKER_SRC = " + JSON.stringify(code) + ";\n",
);
console.log("[pdf-worker] eingebettet:", (code.length / 1024).toFixed(0), "KB");
