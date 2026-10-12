// vendored from code-kit@0.23.0, src/ts/pure/embeddings-client.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// uebernommen aus vault-rag/src/embedder.ts (nur embed()), 2026-10-11 (Änderungen: Transport injiziert statt requestUrl, Frist und Abbruch neu, Embedder-Interface; Anfrage, Batchgröße 32 und die beiden Fehlertexte unverändert)
/** Client for `POST <endpoint>/v1/embeddings` (OpenAI-compatible: Ollama, LM Studio, llama.cpp), over an injected transport.
 *
 *  Origin: vault-rag `EmbeddingClient.embed`. What stays in vault-rag: `probe`, `ping`, `listModels`, `fetchCapabilities`
 *  — they ask about the endpoint, not for vectors, and the capability probe already has its transport port in
 *  `capabilities.ts` (`CapabilityFetch`).
 *
 *  **Why a transport and not `fetch`:** this layer has no I/O. vault-rag passes Obsidian's `requestUrl` (no CORS, works
 *  on mobile), Oneiron's Node CLI passes `fetch`. A transport gets the request and returns `{ status, json }`; it
 *  throws only when nothing came back (no connection).
 *
 *  **Deadline and abort, which the old `embed()` did not have:**
 *  - `embed(texts, { signal })`: aborting rejects with `EmbeddingError` kind `aborted`. The signal is also handed to the
 *    transport, so `fetch` really stops; the client does not wait for a transport that ignores it.
 *  - `requestTimeoutMs` (with `timers`): limit per request (one batch). The OVERALL limit of a hook is the caller's:
 *    one `AbortSignal` over the whole call.
 *  - Limit of both: Obsidian's `requestUrl` can neither time out nor abort. There the client stops WAITING and the
 *    request runs to its end in the background, its answer discarded (the same as `withTimeout`).
 *
 *  Batches go one after the other (32 texts each by default), never in parallel: a local Ollama shared by several
 *  machines answers single requests in 12–23 s under load (measured 2026-10-10), and parallel requests only queue. */

import { normalizeEndpoint } from "./endpoint";
import { authHeaders } from "./endpoint_config";
import type { TimeoutTimers } from "./timeout";

/** What the index code needs from an embedding source. `LiveIndexer` and `RetrievalFacade` know only this. */
export interface Embedder {
  embed(texts: string[], opts?: { signal?: AbortSignal }): Promise<Float32Array[]>;
}

export interface EmbedRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}
export type EmbedTransport = (req: EmbedRequest) => Promise<{ status: number; json: unknown }>;

/** `http`, `schema`, `timeout` and `aborted` are made by {@link createEmbeddingClient}. `no-endpoint` is not: a client always
 *  has an endpoint. It is the kind for a HOST that wraps the client and has none to hand it (obsidian-kit's embedding
 *  connection when no endpoint is active), so that its callers catch one error class and read `kind` instead of
 *  matching the text of a loose `Error`. */
export type EmbeddingErrorKind = "http" | "schema" | "timeout" | "aborted" | "no-endpoint";

export class EmbeddingError extends Error {
  constructor(
    readonly kind: EmbeddingErrorKind,
    message: string,
    /** Only for `http`. */
    readonly status?: number,
  ) {
    super(message);
    this.name = "EmbeddingError";
  }
}

export interface EmbeddingClientOptions {
  /** Base URL; a trailing `/` and a trailing `/v1` are removed (`http://host:11434/v1` works). */
  endpoint: string;
  model: string;
  apiKey?: string;
  transport: EmbedTransport;
  /** Texts per request. Default 32 (measured on the real endpoint: 1 text 3.62 s, 32 texts 4.68 s — the call dominates). */
  batchSize?: number;
  /** Limit per request in ms. Needs `timers`. */
  requestTimeoutMs?: number;
  timers?: TimeoutTimers;
}

const DEFAULT_BATCH = 32;

export function createEmbeddingClient(opts: EmbeddingClientOptions): Embedder {
  const { model, apiKey, transport, requestTimeoutMs, timers } = opts;
  const batchSize = Math.max(1, Math.floor(opts.batchSize ?? DEFAULT_BATCH));
  if (requestTimeoutMs !== undefined && !timers) {
    throw new Error("createEmbeddingClient: requestTimeoutMs braucht timers (die Schicht ruft kein setTimeout selbst).");
  }
  const url = `${normalizeEndpoint(opts.endpoint)}/v1/embeddings`;

  /** One request, raced against the abort signal and the per-request limit. */
  function request(batch: string[], signal: AbortSignal | undefined): Promise<{ status: number; json: unknown }> {
    const ctl = new AbortController();
    return new Promise((resolve, reject) => {
      let timer: number | undefined;
      let settled = false;
      const finish = (f: () => void): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined && timers) timers.clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        f();
      };
      const onAbort = (): void => finish(() => { ctl.abort(); reject(new EmbeddingError("aborted", "Embedding abgebrochen")); });
      if (signal?.aborted) { onAbort(); return; }
      signal?.addEventListener("abort", onAbort, { once: true });
      if (requestTimeoutMs !== undefined && timers) {
        timer = timers.setTimeout(() => finish(() => { ctl.abort(); reject(new EmbeddingError("timeout", `Embedding: keine Antwort nach ${requestTimeoutMs} ms`)); }), requestTimeoutMs);
      }
      transport({
        url,
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(apiKey) },
        body: JSON.stringify({ model, input: batch }),
        signal: ctl.signal,
      }).then(
        (r) => finish(() => resolve(r)),
        (e: unknown) => finish(() => reject(e instanceof Error ? e : new Error(String(e)))),
      );
    });
  }

  return {
    async embed(texts: string[], callOpts: { signal?: AbortSignal } = {}): Promise<Float32Array[]> {
      const results: Float32Array[] = [];
      for (let i = 0; i < texts.length; i += batchSize) {
        if (callOpts.signal?.aborted) throw new EmbeddingError("aborted", "Embedding abgebrochen");
        const { status, json } = await request(texts.slice(i, i + batchSize), callOpts.signal);
        if (status < 200 || status >= 300) throw new EmbeddingError("http", `Embedding HTTP ${status}`, status);
        const data: unknown = json;
        if (!data || typeof data !== "object" || !Array.isArray((data as Record<string, unknown>).data)) {
          throw new EmbeddingError("schema", "Embedding: ungültiges Response-Schema (data fehlt)");
        }
        for (const item of (data as { data: { embedding: number[] }[] }).data) {
          results.push(new Float32Array(item.embedding));
        }
      }
      return results;
    },
  };
}
