import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDF_WORKER_SRC } from "./pdf-worker-src.generated";
import { reconstructPdfText } from "./pdf_to_md";

let workerReady = false;

function ensureWorker(): void {
  if (workerReady) return;
  const blob = new Blob([PDF_WORKER_SRC], { type: "text/javascript" });
  pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
  workerReady = true;
}

/** Seitenzahl eines PDF. */
export async function pdfPageCount(bytes: ArrayBuffer): Promise<number> {
  ensureWorker();
  // Kopie: getDocument transferiert den Buffer in den Worker und detached das Original.
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
  try { return doc.numPages; } finally { await doc.destroy(); }
}

/** Rendert Seite (1-basiert) zu PNG als data:image/png;base64,... */
export async function renderPdfPage(bytes: ArrayBuffer, page: number, scale: number): Promise<string> {
  ensureWorker();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
  try {
    const pdfPage = await doc.getPage(page);
    const viewport = pdfPage.getViewport({ scale });
    const canvas = activeDocument.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D-Canvas-Context nicht verfügbar");
    await pdfPage.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL("image/png");
  } finally { await doc.destroy(); }
}

/** Extrahiert den eingebetteten Text-Layer einer Seite (1-basiert) als rekonstruierten Lauftext.
 *  "" wenn kein Text-Layer. DOM/pdf.js-Schicht; die Rekonstruktion ist rein (pdf_to_md). */
export async function extractPdfPageText(bytes: ArrayBuffer, page: number): Promise<string> {
  ensureWorker();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
  try {
    const pdfPage = await doc.getPage(page);
    const tc = await pdfPage.getTextContent();
    const items: { str: string; hasEOL?: boolean }[] = [];
    for (const it of tc.items) {
      const o = it as { str?: unknown; hasEOL?: unknown };
      if (typeof o.str === "string") items.push({ str: o.str, hasEOL: o.hasEOL === true });
    }
    return reconstructPdfText(items);
  } finally { await doc.destroy(); }
}

/** Smoke: minimal-PDF rendern; true bei Erfolg. */
export async function pdfSmokeTest(): Promise<boolean> {
  const MINIMAL_PDF_BASE64 =
    "JVBERi0xLjEKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBv" +
    "Ymo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlw" +
    "ZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgOTkgOTldPj5lbmRvYmoKdHJhaWxlcjw8" +
    "L1Jvb3QgMSAwIFI+Pg==";
  const bin = atob(MINIMAL_PDF_BASE64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const pages = await pdfPageCount(buf.buffer);
  const png = await renderPdfPage(buf.buffer, 1, 1.0);
  return pages === 1 && png.startsWith("data:image/png;base64,");
}
