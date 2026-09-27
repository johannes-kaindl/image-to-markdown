// vendored from obsidian-kit@0.45.0, src/obsidian/chat-transport.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
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
import type { SseTransport, ChatWireMessage } from "./chat-client";
import type { ShortcutsBridge } from "./shortcuts-bridge";

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

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part !== null && typeof part === "object" && (part as { type?: unknown }).type === "text") {
          const t = (part as { text?: unknown }).text;
          return typeof t === "string" ? t : "";
        }
        return "";
      })
      .filter((t) => t !== "")
      .join("\n");
  }
  return "";
}

/** Faltet System + Gesprächsverlauf zu EINEM Prompt-Text — die Brücke ist one-shot und kennt kein
 *  Nachrichten-Array. Vorbild: `apps/yijing/scripts/ios-app/Sources/FoundationModelsEngine.swift`
 *  (nur gelesen, nicht verändert) — System zuerst, dann der Rest mit Leerzeile getrennt. */
export function foldMessagesToPrompt(messages: readonly ChatWireMessage[]): string {
  const system = messages.find((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  const systemText = system ? contentToText(system.content) : "";
  const historyText = rest.map((m) => contentToText(m.content)).filter((t) => t !== "").join("\n\n");
  if (systemText === "") return historyText;
  return historyText === "" ? systemText : `${systemText}\n\n${historyText}`;
}

export interface ShortcutsChatTransportOptions {
  bridge: Pick<ShortcutsBridge, "run">;
  /** Kurzbefehl-Name und Timeout kommen aus dem `ResolvedEndpoint` des Konsumenten. */
  shortcut: { name: string; timeoutMs: number };
}

/** Dritter Transport neben XHR/`requestUrl`: erfüllt dieselbe `SseTransport`-Signatur, fährt aber
 *  über die Kurzbefehl-Brücke (`shortcuts-bridge.ts`) statt HTTP — one-shot, kein Streaming.
 *  `url`/`headers` werden ignoriert (die Brücke kennt nur den Kurzbefehl-Namen aus
 *  `opts.shortcut`). Die Antwort geht als komplettes, OpenAI-kompatibles JSON-Envelope
 *  (`choices[0].message.content`) an `onChunk` — der `chat-client` erkennt es an der fehlenden
 *  SSE-Form und parst es über seinen bestehenden No-Stream-Pfad, null Änderung dort nötig.
 *
 *  **Fähigkeitsgrenze statt stillem Schlucken:** Werkzeuge (`body.tools`) kennt die Aktion
 *  „Modell verwenden" nicht — ein Aufruf mit Tool-Definitionen schlägt sichtbar fehl (Status 501,
 *  Fehlerkörper), statt sie zu ignorieren.
 *  **`signal` verwirft nur das Ergebnis:** x-callback kann einen laufenden Kurzbefehl nicht
 *  abbrechen — der Bridge-Lauf läuft im Hintergrund weiter, nur diese Promise lehnt vorzeitig ab. */
export function createShortcutsChatTransport(opts: ShortcutsChatTransportOptions): SseTransport {
  return {
    postStream(_url, body, _headers, onChunk, signal) {
      return new Promise<number>((resolve, reject) => {
        if (signal.aborted) { reject(namedError("aborted", "AbortError")); return; }
        const b = body as { messages?: unknown; tools?: unknown };
        const messages: ChatWireMessage[] = Array.isArray(b.messages) ? (b.messages as ChatWireMessage[]) : [];
        if (Array.isArray(b.tools) && b.tools.length > 0) {
          onChunk(JSON.stringify({ error: { message: "apple-shortcuts transport: tool calls are not supported (capability boundary)" } }));
          resolve(501);
          return;
        }
        const prompt = foldMessagesToPrompt(messages);
        let settled = false;
        const onAbort = (): void => {
          if (settled) return;
          settled = true;
          reject(namedError("aborted", "AbortError"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        opts.bridge
          .run({ shortcut: opts.shortcut.name, input: prompt, timeoutMs: opts.shortcut.timeoutMs })
          .then((res) => {
            signal.removeEventListener("abort", onAbort);
            if (settled) return;
            settled = true;
            if (res.ok) {
              onChunk(JSON.stringify({ choices: [{ message: { role: "assistant", content: res.result }, finish_reason: "stop" }] }));
              resolve(200);
              return;
            }
            const status = res.reason === "timeout" ? 408 : res.reason === "cancel" ? 499 : res.reason === "busy" ? 429 : 502;
            onChunk(JSON.stringify({ error: { message: res.message, reason: res.reason } }));
            resolve(status);
          })
          .catch((e: unknown) => {
            signal.removeEventListener("abort", onAbort);
            if (settled) return;
            settled = true;
            reject(e instanceof Error ? e : namedError(String(e), "Error"));
          });
      });
    },
  };
}

export interface TransportChoice { primary: SseTransport; fallback?: SseTransport }

/** Wählt den Transport (samt HTTP-Fallback) für einen aufgelösten Endpunkt — kein Konsument baut
 *  die `if (resolved.transport === "shortcuts")`-Kette selbst. Ein `"shortcuts"`-Endpunkt ohne
 *  bereitgestellten Shortcuts-Transport ist ein Konfigurationsfehler des Konsumenten (Bridge nicht
 *  verbaut) und wirft — das ist ehrlicher als still auf HTTP zurückzufallen und gegen die falsche
 *  URL zu feuern (Spec § Baustein 2, Vertragsentscheidung). */
export function transportFor(
  resolved: { transport?: "http" | "shortcuts" },
  opts: { http: SseTransport; httpFallback?: SseTransport; shortcuts?: SseTransport },
): TransportChoice {
  if (resolved.transport === "shortcuts") {
    if (!opts.shortcuts) throw new Error("resolved endpoint requires transport \"shortcuts\", but none was provided");
    return { primary: opts.shortcuts };
  }
  return opts.httpFallback ? { primary: opts.http, fallback: opts.httpFallback } : { primary: opts.http };
}
