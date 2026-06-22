import { requestUrl } from "obsidian";
import type { HttpFetch, StreamFetch } from "./vision_client";

/** Obsidian-Transport-Adapter: erfüllt HttpFetch über requestUrl (CORS-/Mobil-tauglich, keine
 *  no-restricted-globals-Verstöße). Wird in main.ts via setHttp() in den reinen Kern injiziert. */
export const obsidianHttp: HttpFetch = async (url, init) => {
  const r = await requestUrl({
    url,
    method: init?.method ?? "GET",
    headers: init?.headers,
    body: init?.body,
    throw: false,
  });
  return { ok: r.status >= 200 && r.status < 300, status: r.status, text: r.text };
};

/** Streamender Transport für die Sidebar: nutzt activeWindow.fetch (Member-Zugriff statt globalem
 *  fetch → kein no-restricted-globals; popout-fenster-tauglich). requestUrl kann nicht streamen. */
export const obsidianStreamFetch: StreamFetch = (url, init) => activeWindow.fetch(url, init);
