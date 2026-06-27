// scripts/lib/codeberg-release.mjs
// Reiner Helfer: erzeugt/aktualisiert ein Codeberg-(Forgejo-)Release + Assets über die Forgejo-API.
// `fetch` wird injiziert → ohne Netz testbar. Kein Prozess-/Datei-Zugriff hier; der Orchestrator
// (release.mjs) liest Token/Assets und reicht sie herein.
//
//   createCodebergRelease({ fetch, token, repo, tag, notes, assets }) → { id, htmlUrl }
//   repo   = "owner/name" (z.B. "jkaindl/image-to-markdown")
//   assets = [{ name, body }]   body = Uint8Array/Buffer des Datei-Inhalts

const API = "https://codeberg.org/api/v1";

export async function createCodebergRelease({ fetch, token, repo, tag, notes, assets }) {
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
    const created = await fetch(`${API}/repos/${repo}/releases`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ tag_name: tag, name: tag, body: notes, draft: false, prerelease: false }),
    });
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
