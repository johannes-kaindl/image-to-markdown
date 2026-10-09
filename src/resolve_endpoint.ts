// Konstanten und Bereinigung rund um die Endpunkt-Quelle. Die Auflösung selbst (Manager zuerst,
// sonst die lokale Liste) macht seit dem Verbindungs-Tausch die Kit-Verbindung (`createLlmConnection`).
import type { EndpointChoice } from "./vendor/kit/endpoint-source";

export const ENDPOINT_CALLER = "image-to-markdown";

/** `choice` kommt aus einer data.json und ist damit untrusted: nur nicht-leere Strings bleiben. */
export function sanitizeChoice(raw: unknown): EndpointChoice {
  if (raw === null || typeof raw !== "object") return {};
  const { endpointId, model } = raw as EndpointChoice;
  return {
    ...(typeof endpointId === "string" && endpointId ? { endpointId } : {}),
    ...(typeof model === "string" && model ? { model } : {}),
  };
}
