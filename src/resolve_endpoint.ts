// Quellenwahl fuer die Vision-Aufrufe: zuerst der LLM Endpoint Manager (falls installiert),
// sonst die lokale Liste dieses Plugins. Kein obsidian-Import — das Finden des Managers braucht
// `app` und bleibt beim Aufrufer (main.ts). Muster: yijing-oracle/src/core/llm/resolve-endpoint.ts.
import type { EndpointConfig } from "./vendor/kit/endpoint_config";
import {
  resolveEndpointSource,
  type EndpointChoice,
  type EndpointSourceResult,
  type LlmEndpointManagerApi,
} from "./vendor/kit/endpoint-source";

export const ENDPOINT_CALLER = "image-to-markdown";

export interface VisionSourceSettings {
  visionEndpoints: EndpointConfig[];
  visionModel: string;
  choice: EndpointChoice;
}

/** Ein Durchlauf. `choice` gilt NUR mit Manager: ein Modellname ist an seinen Endpunkt
 *  gebunden, und ohne Manager waere eine dort gewaehlte Wahl fuer die lokale Liste fremd. */
export function resolveVisionEndpoint(
  settings: VisionSourceSettings,
  manager: LlmEndpointManagerApi | null,
  ping: (cfg: EndpointConfig) => Promise<boolean>,
): Promise<EndpointSourceResult> {
  return resolveEndpointSource(
    {
      manager,
      local: settings.visionEndpoints,
      localModel: settings.visionModel,
      capability: "vision",
      ...(manager ? { choice: settings.choice } : {}),
      caller: ENDPOINT_CALLER,
    },
    ping,
  );
}

/** `choice` kommt aus einer data.json und ist damit untrusted: nur nicht-leere Strings bleiben. */
export function sanitizeChoice(raw: unknown): EndpointChoice {
  if (raw === null || typeof raw !== "object") return {};
  const { endpointId, model } = raw as EndpointChoice;
  return {
    ...(typeof endpointId === "string" && endpointId ? { endpointId } : {}),
    ...(typeof model === "string" && model ? { model } : {}),
  };
}
