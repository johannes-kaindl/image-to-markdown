// Konstanten rund um die Endpunkt-Quelle. Die Auflösung selbst (Manager zuerst, sonst die lokale
// Liste) macht seit dem Verbindungs-Tausch die Kit-Verbindung (`createLlmConnection`); die
// Bereinigung der gespeicherten Wahl (`sanitizeChoice`) kommt seit Welle 19 aus dem Kit.
export const ENDPOINT_CALLER = "image-to-markdown";
