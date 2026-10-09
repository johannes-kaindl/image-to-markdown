import { fetchVisionCapability, resolveVision, type Confidence } from "./capabilities";
import { normalizeEndpoint } from "./vendor/kit/endpoint";
import { authHeaders } from "./vendor/kit/endpoint_config";

/** Transport-Abstraktion für die Fähigkeits-Probe: hält den reinen Kern obsidian-frei
 *  (PROF-OBS-03/04). Die Obsidian-Schicht injiziert per setHttp() einen requestUrl-Adapter
 *  (src/http.ts); Tests injizieren einen Mock. */
export interface HttpResponse { ok: boolean; status: number; text: string }
export type HttpFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<HttpResponse>;

let httpFn: HttpFetch | null = null;
export function setHttp(fn: HttpFetch): void { httpFn = fn; }
function http(): HttpFetch {
  if (!httpFn) throw new Error("VisionClient: HTTP nicht konfiguriert (setHttp aufrufen)");
  return httpFn;
}

/** Die schmale Hilfsklasse, die vom Vision-Client blieb: die passive Fähigkeits-Anzeige der Settings
 *  (Modell-Metadaten des Endpunkts). Chat, Ping, Modellliste und Transport gehören seit dem
 *  Verbindungs-Tausch der Kit-Verbindung (`createLlmConnection`); der Endpunkt samt Schlüssel
 *  kommt aus `(await llm.resolve()).config`. `apiKey` gilt genau für DIESEN Endpunkt; ohne ihn
 *  geht kein Authorization-Header raus. */
export class VisionClient {
  private endpoint: string;
  constructor(endpoint: string, private apiKey?: string) {
    this.endpoint = normalizeEndpoint(endpoint);
  }

  /** Passive Vision-Erkennung: native Metadaten-Probe + Namens-Heuristik.
   *  this.endpoint ist bereits /v1-frei (normalizeEndpoint) → korrekte Basis-URL. */
  async visionConfidence(model: string): Promise<Confidence> {
    return resolveVision(await fetchVisionCapability(http(), this.endpoint, model, authHeaders(this.apiKey)), model);
  }
}
