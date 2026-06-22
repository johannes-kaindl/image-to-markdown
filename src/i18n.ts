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
  "cmd.pdfSmoke": "PDF render self-test",
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
  "settings.prompt.name": "Vision prompt",
  "settings.prompt.desc": "Instruction for the vision model. The image content is sent along.",
  "prompt.default":
    "Transcribe the text in the image exactly to Markdown. Preserve the structure: headings, paragraphs, " +
    "**emphasis**, lists and tables. Output only the Markdown, no comments.",
  "view.deselectAll": "Deselect all",
  "view.selectAll": "Select all",
  "view.transcribe": "Transcribe",
  "view.createAll": "Create all",
  "view.checking": "Vision LLM: checking…",
  "view.connected": "● Vision LLM connected",
  "view.offline": "○ Vision LLM offline — check the settings",
  "view.noImages": "No images in this note.",
  "view.unsupportedSuffix": "{0} — unsupported",
  "view.cardHead": "Image {0}/{1} · {2}",
  "view.thinking": "💭 thinking…",
  "view.thoughts": "💭 Thoughts",
  "view.error": "Error",
  "view.created": "✓ created: {0}",
  "view.copyTranscript": "Copy transcript",
  "view.createNote": "Create note",
  "view.aborted": "Aborted",
  "core.noMatchingImages": "No (matching) images in this note.",
  "core.imageNotFound": "Image not found: {0}",
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
  "cmd.pdfSmoke": "PDF-Render-Selbsttest",
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
  "settings.prompt.name": "Vision-Prompt",
  "settings.prompt.desc": "Anweisung an das Vision-Modell. Der Bild-Inhalt wird mitgeschickt.",
  "prompt.default":
    "Transkribiere den Text im Bild exakt nach Markdown. Erhalte die Struktur: Überschriften, Absätze, " +
    "**Hervorhebungen**, Listen und Tabellen. Gib nur das Markdown aus, keine Kommentare.",
  "view.deselectAll": "Alle abwählen",
  "view.selectAll": "Alle auswählen",
  "view.transcribe": "Transkribieren",
  "view.createAll": "Alle anlegen",
  "view.checking": "Vision-LLM: prüfe…",
  "view.connected": "● Vision-LLM verbunden",
  "view.offline": "○ Vision-LLM offline — in den Settings prüfen",
  "view.noImages": "Keine Bilder in dieser Notiz.",
  "view.unsupportedSuffix": "{0} — nicht unterstützt",
  "view.cardHead": "Bild {0}/{1} · {2}",
  "view.thinking": "💭 denkt nach…",
  "view.thoughts": "💭 Gedanken",
  "view.error": "Fehler",
  "view.created": "✓ angelegt: {0}",
  "view.copyTranscript": "Transkript kopieren",
  "view.createNote": "Notiz anlegen",
  "view.aborted": "Abgebrochen",
  "core.noMatchingImages": "Keine (passenden) Bilder in dieser Notiz.",
  "core.imageNotFound": "Bild nicht gefunden: {0}",
  "core.unsupportedFormat": "Format .{0} nicht unterstützt (HEIC? iOS auf „Maximal kompatibel“): {1}",
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
