// Reine UI-Lokalisierung (EN/DE) — keine obsidian-/DOM-Imports (in Node testbar, PROF-OBS-03/04).
// Muster aus obsidian-letterhead, adaptiert an die reine-Kern-Architektur: die Strings sind pur,
// die Sprach-Detektion lebt in der obsidian-Schicht (main.ts) und ruft setLang() beim onload.
// EN ist kanonisch und universeller Fallback. Standard: siehe _docs PROF-OBS-07 / obsidian-i18n.md.

export type Lang = "en" | "de";

let currentLang: Lang = "en";

/** Wählt die Sprache aus einem rohen Locale-String (z.B. von obsidian.getLanguage()). */
export function pickLang(raw?: string | null): Lang {
  return raw && raw.toLowerCase().startsWith("de") ? "de" : "en";
}

export function setLang(lang: Lang): void { currentLang = lang; }
export function getLang(): Lang { return currentLang; }

type Dict = Record<string, string>;

const EN: Dict = {
  "cmd.openSidebar": "Open sidebar",
  "cmd.transcribeActive": "Transcribe images in the active note",
  "notice.noActiveNote": "No active note.",
  "notice.copied": "Copied",
  "settings.heading": "Vision (Image → Markdown)",
  "settings.endpoint.name": "Vision endpoint",
  "settings.endpoint.desc": "OpenAI-compatible server with a vision model (e.g. LM Studio)",
  "settings.testConnection": "Test connection",
  "settings.connected": "● connected",
  "settings.offline": "○ offline",
  "settings.model.name": "Vision model",
  "settings.model.desc": "Vision-capable model (Qwen2-VL, Llama-3.2-Vision …)",
  "settings.capability.name": "Vision capability",
  "settings.testVision": "Test vision",
  "settings.endpointUnreachable": "Endpoint unreachable",
  "settings.endpointOfflinePlaceholder": "(endpoint offline)",
  "settings.loadModels": "Load models",
  "settings.refreshModels": "Refresh models",
  "settings.prompt.name": "Vision prompt",
  "settings.prompt.desc": "Instruction for the vision model. The image content is sent along.",
  "settings.pdfMaxPages.name": "PDF max. pages per run",
  "settings.pdfMaxPages.desc": "Safety cap — larger PDFs must be narrowed via the page range.",
  "settings.pdfRenderScale.name": "PDF render scale",
  "settings.pdfRenderScale.desc": "Low = faster, less memory; high = sharper page images & better OCR on small text (2.0 ≈ 144 dpi).",
  "settings.pdfPageSep.name": "PDF page separator",
  "settings.pdfPageSep.desc": "How pages are separated in the merged transcript note.",
  "settings.pdfPageSep.comment": "Obsidian comment %% Page N %% (hidden in reading view)",
  "settings.pdfPageSep.heading": "Heading ## Page N",
  "settings.pdfPageSep.rule": "Horizontal rule ---",
  "settings.pdfPageSep.pagebreak": "Page break (HTML, for export)",
  "settings.pdfPageSep.none": "None (seamless text)",
  "prompt.default":
    "Transcribe the text in the image exactly to Markdown. Preserve the structure: headings, paragraphs, " +
    "**emphasis**, lists and tables. Output only the Markdown, no comments.",
  "view.deselectAll": "Deselect all",
  "view.selectAll": "Select all",
  "view.transcribe": "Transcribe",
  "view.createAll": "Create all",
  "view.checking": "Vision LLM: checking…",
  "view.connected": "Vision LLM connected",
  "view.offline": "Vision LLM offline — check the settings",
  "view.noImages": "No transcribable content in this note.",
  "view.unsupportedSuffix": "{0} — unsupported",
  "view.cardHead": "Image {0}/{1} · {2}",
  "view.thinking": "💭 thinking…",
  "view.thoughts": "💭 Thoughts",
  "view.error": "Error",
  "view.created": "✓ created: {0}",
  "view.copyTranscript": "Copy transcript",
  "view.createNote": "Create note",
  "view.aborted": "Aborted",
  "view.pdfPages": "{0} · {1} pages",
  "view.pdfRangeFrom": "from page",
  "view.pdfRangeTo": "to page",
  "view.pdfRangePrefix": "Page",
  "view.pdfRangeMid": "to",
  "view.cardHeadPage": "{0} · page {1}/{2}",
  "view.transcriptExists": "✓ transcript exists",
  "view.open": "open",
  "view.overwriteHint": "re-transcribing overwrites it",
  "view.refreshModels": "Refresh models",
  "view.modelChanged": "Model changed to {0}",
  "view.modelLoaded": "Selected model is loaded",
  "view.modelNotLoaded": "Selected model is not loaded",
  "view.modelsLoaded": "{0} models loaded",
  "view.linked": "linked",
  "view.thisFile": "this file",
  "core.noMatchingImages": "No (matching) images in this note.",
  "core.imageNotFound": "Image not found: {0}",
  "core.pdfTooManyPages": "PDF has {0} pages (limit {1}) — narrow the page range.",
  "core.pdfUseSidebar": "PDF detected ({0}) — transcribe PDFs in the sidebar.",
  "core.unsupportedFormat": "Format .{0} not supported (HEIC? iOS set to “Most Compatible”): {1}",
  "core.transcribing": "Transcribing image {0}/{1}…",
  "core.transcribeFailed": "Transcription failed ({0}): {1}",
  "core.emptyTranscriptLink": "Empty transcript: {0}",
  "core.transcribed.one": "{0} image transcribed",
  "core.transcribed.other": "{0} images transcribed",
  "core.skippedSuffix": ", {0} skipped",
  "core.emptyTranscript": "Empty transcript",
  "cap.confirmed": "Vision",
  "cap.likely": "Vision (unconfirmed)",
  "cap.none": "No vision",
  "note.suffix.image": "(transcript)",
  "note.suffix.pdf": "(PDF transcript)",
  "pdf.pageHeading": "Page {0}",
};

const DE: Dict = {
  "cmd.openSidebar": "Sidebar öffnen",
  "cmd.transcribeActive": "Bilder der aktiven Notiz transkribieren",
  "notice.noActiveNote": "Keine aktive Notiz.",
  "notice.copied": "Kopiert",
  "settings.heading": "Vision (Image → Markdown)",
  "settings.endpoint.name": "Vision-Endpunkt",
  "settings.endpoint.desc": "OpenAI-kompatibler Server mit Vision-Modell (z.B. LM Studio)",
  "settings.testConnection": "Verbindung testen",
  "settings.connected": "● verbunden",
  "settings.offline": "○ offline",
  "settings.model.name": "Vision-Modell",
  "settings.model.desc": "Vision-fähiges Modell (Qwen2-VL, Llama-3.2-Vision …)",
  "settings.capability.name": "Vision-Fähigkeit",
  "settings.testVision": "Vision testen",
  "settings.endpointUnreachable": "Endpunkt nicht erreichbar",
  "settings.endpointOfflinePlaceholder": "(Endpunkt offline)",
  "settings.loadModels": "Modelle laden",
  "settings.refreshModels": "Modelle aktualisieren",
  "settings.prompt.name": "Vision-Prompt",
  "settings.prompt.desc": "Anweisung an das Vision-Modell. Der Bild-Inhalt wird mitgeschickt.",
  "settings.pdfMaxPages.name": "PDF max. Seiten pro Lauf",
  "settings.pdfMaxPages.desc": "Schutzgrenze — größere PDFs über den Seitenbereich einschränken.",
  "settings.pdfRenderScale.name": "PDF-Render-Auflösung",
  "settings.pdfRenderScale.desc": "Niedrig = schneller, weniger Speicher; hoch = schärfere Seitenbilder & bessere OCR bei kleinem Text (2.0 ≈ 144 dpi).",
  "settings.pdfPageSep.name": "PDF-Seitentrenner",
  "settings.pdfPageSep.desc": "Wie Seiten in der zusammengeführten Transkript-Notiz getrennt werden.",
  "settings.pdfPageSep.comment": "Obsidian-Kommentar %% Seite N %% (im Lesemodus unsichtbar)",
  "settings.pdfPageSep.heading": "Überschrift ## Seite N",
  "settings.pdfPageSep.rule": "Trennlinie ---",
  "settings.pdfPageSep.pagebreak": "Seitenumbruch (HTML, für Export)",
  "settings.pdfPageSep.none": "Keiner (nahtloser Text)",
  "prompt.default":
    "Transkribiere den Text im Bild exakt nach Markdown. Erhalte die Struktur: Überschriften, Absätze, " +
    "**Hervorhebungen**, Listen und Tabellen. Gib nur das Markdown aus, keine Kommentare.",
  "view.deselectAll": "Alle abwählen",
  "view.selectAll": "Alle auswählen",
  "view.transcribe": "Transkribieren",
  "view.createAll": "Alle anlegen",
  "view.checking": "Vision-LLM: prüfe…",
  "view.connected": "Vision-LLM verbunden",
  "view.offline": "Vision-LLM offline — in den Settings prüfen",
  "view.noImages": "Keine transkribierbaren Inhalte in dieser Notiz.",
  "view.unsupportedSuffix": "{0} — nicht unterstützt",
  "view.cardHead": "Bild {0}/{1} · {2}",
  "view.thinking": "💭 denkt nach…",
  "view.thoughts": "💭 Gedanken",
  "view.error": "Fehler",
  "view.created": "✓ angelegt: {0}",
  "view.copyTranscript": "Transkript kopieren",
  "view.createNote": "Notiz anlegen",
  "view.aborted": "Abgebrochen",
  "view.pdfPages": "{0} · {1} Seiten",
  "view.pdfRangeFrom": "von Seite",
  "view.pdfRangeTo": "bis Seite",
  "view.pdfRangePrefix": "Seite",
  "view.pdfRangeMid": "bis",
  "view.cardHeadPage": "{0} · Seite {1}/{2}",
  "view.transcriptExists": "✓ Transkript vorhanden",
  "view.open": "öffnen",
  "view.overwriteHint": "erneut transkribieren überschreibt",
  "view.refreshModels": "Modelle aktualisieren",
  "view.modelChanged": "Modell gewechselt zu {0}",
  "view.modelLoaded": "Ausgewähltes Modell ist geladen",
  "view.modelNotLoaded": "Ausgewähltes Modell ist nicht geladen",
  "view.modelsLoaded": "{0} Modelle geladen",
  "view.linked": "verlinkt",
  "view.thisFile": "diese Datei",
  "core.noMatchingImages": "Keine (passenden) Bilder in dieser Notiz.",
  "core.imageNotFound": "Bild nicht gefunden: {0}",
  "core.pdfTooManyPages": "PDF hat {0} Seiten (Limit {1}) — Seitenbereich einschränken.",
  "core.unsupportedFormat": "Format .{0} nicht unterstützt (HEIC? iOS auf „Maximal kompatibel”): {1}",
  "core.pdfUseSidebar": "PDF erkannt ({0}) — PDFs in der Sidebar transkribieren.",
  "core.transcribing": "Transkribiere Bild {0}/{1}…",
  "core.transcribeFailed": "Transkription fehlgeschlagen ({0}): {1}",
  "core.emptyTranscriptLink": "Leeres Transkript: {0}",
  "core.transcribed.one": "{0} Bild transkribiert",
  "core.transcribed.other": "{0} Bilder transkribiert",
  "core.skippedSuffix": ", {0} übersprungen",
  "core.emptyTranscript": "Leeres Transkript",
  "cap.confirmed": "Vision",
  "cap.likely": "Vision (unbestätigt)",
  "cap.none": "Keine Vision",
  "note.suffix.image": "(Transkript)",
  "note.suffix.pdf": "(PDF-Transkript)",
  "pdf.pageHeading": "Seite {0}",
};

const STRINGS: Record<Lang, Dict> = { en: EN, de: DE };

/** Übersetzt key in der aktuellen Sprache; Fallback currentLang → en → key. {0},{1}… aus args. */
export function t(key: string, ...args: (string | number)[]): string {
  const raw = STRINGS[currentLang][key] ?? STRINGS.en[key] ?? key;
  return raw.replace(/\{(\d+)\}/g, (_m, i) => {
    const v = args[Number(i)];
    return v === undefined ? `{${i}}` : String(v);
  });
}

/** Default-Vision-Prompt in der aktuellen Sprache (zur Aufrufzeit, nach setLang). */
export function defaultVisionPrompt(): string { return t("prompt.default"); }
