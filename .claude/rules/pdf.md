---
paths:
  - "src/pdf_*.ts"
  - "src/pdf-worker-src.generated.ts"
  - "scripts/build-pdf-worker.mjs"
---

# PDF-Weg und pdf.js-Worker — Gotchas

Gotchas zu `src/pdf_render.ts`, `src/pdf_to_md.ts` und dem gebündelten Worker. Aufbau: `docs/internal/architecture.md` § Build.

- **Halte `pdfjs-dist` auf 4.10.38 gepinnt.** v5/v6 externalisieren den WASM-Kern und brechen das Single-File-Bundle (die Blob-URL-Strategie funktioniert dann nicht mehr). Vor einem Upgrade die Worker-Blob-Strategie re-validieren.
- **Der Worker wird von `scripts/build-pdf-worker.mjs` in einem eigenen esbuild-Lauf vor dem Haupt-Build gebündelt** und als eingebetteter String in `pdf-worker-src.generated.ts` gespeichert; diese Datei wird im Haupt-Build mitgebundelt, ist gitignored und wird bei `npm run build` neu erzeugt. Nie von Hand editieren.
- **`pdfjs-dist` ist eine runtime-`dependency`, keine `devDependency`.** `pdf_render.ts` importiert `pdfjs-dist/legacy/build/pdf.mjs`, damit Hauptmodul und Worker in `main.js` landen; das ist der Hauptgrund für das größere Bundle (~2,2 MB).
