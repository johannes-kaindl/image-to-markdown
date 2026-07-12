// scripts/lib/codeberg-release.mjs
// Reiner Helfer: erzeugt/aktualisiert ein Codeberg-(Forgejo-)Release + Assets über die Forgejo-API.
// `fetch` wird injiziert → ohne Netz testbar. Kein Prozess-/Datei-Zugriff hier; der Orchestrator
// (release.mjs) liest Token/Assets und reicht sie herein.
//
//   createCodebergRelease({ fetch, token, repo, tag, notes, assets }) → { id, htmlUrl }
//   repo   = "owner/name" (z.B. "jkaindl/image-to-markdown")
//   assets = [{ name, body }]   body = Uint8Array/Buffer des Datei-Inhalts

const API = "https://codeberg.org/api/v1";

/** Standard-Backoff: exponentiell 1s,2s,4s,8s… gedeckelt bei 8s. */
const defaultSleep = (attempt) => new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** (attempt - 1), 8000)));

/** Ruft `doFetch()` und wiederholt bei transientem 5xx ODER geworfenem Netzfehler — der
 *  Codeberg-Release-POST-Endpoint liefert sporadisch HTTP 500 (belegt: 0.10.0/0.10.1/0.11.0),
 *  ist beim nächsten Versuch aber ok. 4xx (echte Fehler) werden NICHT wiederholt. Nach `retries`
 *  Versuchen fällt die letzte Antwort/der letzte Fehler durch → der Resume-Pfad in release.mjs greift. */
async function fetchWithRetry(doFetch, retries, sleep) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await doFetch();
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(attempt);
      continue;
    }
    if (res.status < 500 || attempt >= retries) return res;
    await sleep(attempt);
  }
}

export async function createCodebergRelease({ fetch, token, repo, tag, notes, assets, retries = 5, sleep = defaultSleep }) {
  const auth = { Authorization: `token ${token}` };
  const jsonHeaders = { ...auth, "Content-Type": "application/json" };

  // 1. has_releases-Unit sicherstellen (Default oft false → 404 beim Release-POST).
  await fetch(`${API}/repos/${repo}`, {
    method: "PATCH",
    headers: jsonHeaders,
    body: JSON.stringify({ has_releases: true }),
  });

  // 2. Release per Tag finden (Update-Pfad) oder neu anlegen. Der Tag wurde im scripted Flow bereits
  //    gepusht, daher tritt kein „Release has no Tag"-409 auf; ein unerwarteter Fehler wird geworfen.
  let release;
  const existing = await fetch(`${API}/repos/${repo}/releases/tags/${tag}`, { headers: auth });
  if (existing.ok) {
    release = await existing.json();
  } else {
    const created = await fetchWithRetry(() => fetch(`${API}/repos/${repo}/releases`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ tag_name: tag, name: tag, body: notes, draft: false, prerelease: false }),
    }), retries, sleep);
    if (!created.ok) {
      throw new Error(`Codeberg-Release anlegen fehlgeschlagen (${created.status}): ${await created.text()}`);
    }
    release = await created.json();
  }

  // 3. Assets hochladen (Re-Run-sicher: gleichnamiges Asset vorher löschen).
  const existingAssets = release.assets ?? [];
  for (const asset of assets) {
    const dup = existingAssets.find((a) => a.name === asset.name);
    if (dup) {
      await fetch(`${API}/repos/${repo}/releases/${release.id}/assets/${dup.id}`, {
        method: "DELETE",
        headers: auth,
      });
    }
    const form = new FormData();
    form.append("attachment", new Blob([asset.body]), asset.name);
    const up = await fetch(
      `${API}/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(asset.name)}`,
      { method: "POST", headers: auth, body: form },
    );
    if (!up.ok) {
      throw new Error(`Asset-Upload ${asset.name} fehlgeschlagen (${up.status}): ${await up.text()}`);
    }
  }

  return { id: release.id, htmlUrl: release.html_url };
}
