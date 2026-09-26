// vendored from obsidian-kit@0.43.0, src/obsidian/chat-transport.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Die zwei Transporte für `chat-client`: XHR für den Stream, `requestUrl` für die Anfrage ohne
 *  Stream (Fallback). Beide erfüllen `SseTransport`.
 *
 *  **Warum XHR:** Obsidians `requestUrl` kann nicht streamen, und `fetch` liefert in der
 *  Desktop-Runtime keinen verlässlichen Teil-Stream (PROF-OBS-12); `XMLHttpRequest` mit
 *  `onprogress` ist der erlaubte Streaming-Primitive. Herkunft: die Koda-Linie
 *  (`kuro-gamification/src/llm/XhrSseTransport.ts` → koda-agent, neurovim-obsidian), gehärtet um
 *  das, was die Varianten einzeln hatten: Vorab-Prüfung des Signals (neurovim, vault-crews),
 *  `StreamNetworkError` als Fallback-Auslöser (vault-crews, slide-deck) und das Abräumen des
 *  `abort`-Listeners in JEDEM Ausgang (vault-rag ließ ihn nach jedem Stream hängen).
 *
 *  **Warum `requestUrl` als Fallback:** es läuft im Hauptprozess und sendet keinen `Origin` —
 *  ein Server mit Origin-/CORS-Prüfung, der den XHR abweist, beantwortet es. Es kennt weder
 *  Abbruch noch Frist: bei Abbruch lehnt der Transport sofort ab, die Anfrage läuft im
 *  Hintergrund zu Ende und ihr Ergebnis verfällt. */
import { requestUrl } from "obsidian";
import type { SseTransport } from "./chat-client";

function namedError(message: string, name: string): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

export const xhrSseTransport: SseTransport = {
  postStream(url, body, headers, onChunk, signal) {
    return new Promise<number>((resolve, reject) => {
      if (signal.aborted) { reject(namedError("aborted", "AbortError")); return; }
      const xhr = new XMLHttpRequest();
      let seen = 0;
      const pump = (): void => {
        const text = xhr.responseText;
        if (text.length > seen) {
          const next = text.slice(seen);
          seen = text.length;
          onChunk(next);
        }
      };
      const onAbort = (): void => {
        cleanup();
        xhr.abort();
        reject(namedError("aborted", "AbortError"));
      };
      const cleanup = (): void => signal.removeEventListener("abort", onAbort);

      xhr.open("POST", url, true);
      xhr.setRequestHeader("Content-Type", "application/json");
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
      xhr.onprogress = pump;
      xhr.onload = (): void => { cleanup(); pump(); resolve(xhr.status); };
      xhr.onerror = (): void => { cleanup(); reject(namedError(`network error POST ${url}`, "StreamNetworkError")); };
      xhr.onabort = (): void => { cleanup(); reject(namedError("aborted", "AbortError")); };
      signal.addEventListener("abort", onAbort, { once: true });
      xhr.send(JSON.stringify(body));
    });
  },
};

export const requestUrlTransport: SseTransport = {
  postStream(url, body, headers, onChunk, signal) {
    return new Promise<number>((resolve, reject) => {
      if (signal.aborted) { reject(namedError("aborted", "AbortError")); return; }
      let settled = false;
      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        reject(namedError("aborted", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      requestUrl({
        url,
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        throw: false,
      }).then(
        (res) => {
          signal.removeEventListener("abort", onAbort);
          if (settled) return;
          settled = true;
          onChunk(res.text);
          resolve(res.status);
        },
        (e: unknown) => {
          signal.removeEventListener("abort", onAbort);
          if (settled) return;
          settled = true;
          reject(e instanceof Error ? e : namedError(String(e), "Error"));
        },
      );
    });
  },
};
