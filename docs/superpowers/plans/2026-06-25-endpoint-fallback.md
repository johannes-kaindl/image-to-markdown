# Endpoint-Fallback-Liste — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mehrere Vision-Endpoints als geordnete Fallback-Liste; das Plugin nutzt automatisch den ersten erreichbaren — eine gesyncte Config funktioniert auf mehreren Geräten/Netzen ohne Umstellen.

**Architecture:** Ansatz A — reiner `resolveActiveEndpoint`-Helfer im Kern (`VisionClient` bleibt single-endpoint, unverändert); `main.ts` ermittelt + merkt den aktiven Endpoint (`resolveAndReconnect`), mit Neu-Probieren + einem Retry bei Call-Fehler. Settings bekommen dynamische Endpoint-Felder mit Pro-Feld-Status; die Sidebar zeigt „verbunden via X".

**Tech Stack:** TypeScript (strict), esbuild, vitest + happy-dom, Obsidian Plugin API.

## Global Constraints

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen (bestehender `any`-Test-Stil ok).
- **Reiner Kern ohne `obsidian`-Imports:** `vision_client.ts` bleibt obsidian-/DOM-frei. `main.ts`, `settings.ts`, `img_to_md_view.ts` sind die Obsidian-Schichten.
- **`normalizeEndpoint` je Endpoint-Eintrag** — sonst baut ein trailing `/v1` wieder `…/v1/v1/…` (bekannter Footgun).
- **i18n:** neue nutzersichtbare Strings via `t()`, **EN kanonisch + DE**, flache Punkt-Keys.
- **A11y:** Pro-Feld-Status + Verbindungsstatus redundant kodiert (Icon-**Form** `circle-check`/`circle-x`/`loader` + Text, nicht nur Farbe).
- **`minAppVersion` bleibt 1.8.7.**
- **Tests:** nach jedem Task **alle** Tests grün (`npm test`); `npx tsc --noEmit` + `npm run lint` (inkl. `eslint-plugin-obsidianmd`) am Ende sauber.
- **Commits:** Conventional Commits (deutsche Beschreibung erlaubt), **nur berührte Dateien stagen**, Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Baseline:** 188 Tests grün vor Beginn.
- **Hinweis zu Glue/UI-Tasks:** `main.ts` und die `settings.ts`-`render()`-UI werden im Repo **nicht** unit-getestet (sie laden `obsidian`); ihre Verifikation ist `tsc`/`lint`/`npm test` (Bestandstests grün) + Build + empirisch. Nur die reinen Kern-Helfer und die View werden mit neuen Unit-Tests abgesichert. **Keine** erfundenen main/settings-UI-Unit-Tests schreiben.

---

### Task 1: `resolveActiveEndpoint` (reiner Kern)

**Files:**
- Modify: `src/vision_client.ts` (neue exportierte Funktion, additiv)
- Test: `tests/vision_client.test.ts`

**Interfaces:**
- Consumes: `normalizeEndpoint` (bestehend in `vision_client.ts`).
- Produces: `export async function resolveActiveEndpoint(endpoints: string[], ping: (endpoint: string) => Promise<boolean>): Promise<string | null>` — der erste nicht-leere Endpoint (normalisiert), dessen `ping` `true` liefert; `null` wenn keiner antwortet.

- [ ] **Step 1: Failing test**

In `tests/vision_client.test.ts` ergänzen (Import um `resolveActiveEndpoint` erweitern):

```ts
import { /* …bestehende… */ resolveActiveEndpoint } from "../src/vision_client";

describe("resolveActiveEndpoint", () => {
  it("nimmt den ersten erreichbaren in Reihenfolge", async () => {
    const seen: string[] = [];
    const ping = async (ep: string) => { seen.push(ep); return ep === "http://b:1234"; };
    const r = await resolveActiveEndpoint(["http://a:1234", "http://b:1234", "http://c:1234"], ping);
    expect(r).toBe("http://b:1234");
    expect(seen).toEqual(["http://a:1234", "http://b:1234"]);   // c nicht mehr gepingt
  });
  it("null wenn keiner erreichbar", async () => {
    expect(await resolveActiveEndpoint(["http://a:1234", "http://b:1234"], async () => false)).toBeNull();
  });
  it("überspringt leere/whitespace-Einträge", async () => {
    const ping = async () => true;
    expect(await resolveActiveEndpoint(["", "   ", "http://a:1234"], ping)).toBe("http://a:1234");
  });
  it("normalisiert je Eintrag (trailing /v1 und Slash)", async () => {
    const ping = async () => true;
    expect(await resolveActiveEndpoint(["http://a:1234/v1/"], ping)).toBe("http://a:1234");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run tests/vision_client.test.ts -t resolveActiveEndpoint`
Expected: FAIL (`resolveActiveEndpoint is not a function`).

- [ ] **Step 3: Implementieren**

In `src/vision_client.ts` direkt unter `normalizeEndpoint` ergänzen:

```ts
/** Erster erreichbarer Endpoint aus der geordneten Liste, oder null. Leere/whitespace-Einträge
 *  werden übersprungen; jeder Eintrag wird normalizeEndpoint-t. ping ist injiziert → app-frei. */
export async function resolveActiveEndpoint(
  endpoints: string[],
  ping: (endpoint: string) => Promise<boolean>,
): Promise<string | null> {
  for (const raw of endpoints) {
    if (!raw || !raw.trim()) continue;
    const ep = normalizeEndpoint(raw);
    if (await ping(ep)) return ep;
  }
  return null;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run tests/vision_client.test.ts`
Expected: PASS (neue + alle bestehenden VisionClient-Tests grün).

- [ ] **Step 5: Commit**

```bash
git add src/vision_client.ts tests/vision_client.test.ts
git commit -m "feat(core): resolveActiveEndpoint — erster erreichbarer Endpoint aus geordneter Liste

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `migrateEndpoints` (reiner Helfer)

**Files:**
- Modify: `src/settings.ts` (neue exportierte Funktion, additiv — ändert noch NICHT den Settings-Typ)
- Test: `tests/settings.test.ts`

**Interfaces:**
- Produces: `export function migrateEndpoints(saved: { visionEndpoint?: string; visionEndpoints?: string[] } | null | undefined): string[]` — liefert die Endpoint-Liste aus geladenen Settings: vorhandene `visionEndpoints` (leere gefiltert), sonst `[visionEndpoint]` (alte Einzel-Config), sonst `[]`.

- [ ] **Step 1: Failing test**

In `tests/settings.test.ts` ergänzen:

```ts
import { migrateEndpoints } from "../src/settings";

describe("migrateEndpoints", () => {
  it("alter Einzel-Endpoint → Liste", () => {
    expect(migrateEndpoints({ visionEndpoint: "http://localhost:8080" })).toEqual(["http://localhost:8080"]);
  });
  it("vorhandene Liste bleibt, leere gefiltert", () => {
    expect(migrateEndpoints({ visionEndpoints: ["http://a:1234", "", "  ", "http://b:1234"] })).toEqual(["http://a:1234", "http://b:1234"]);
  });
  it("Liste hat Vorrang vor altem Einzelfeld", () => {
    expect(migrateEndpoints({ visionEndpoint: "http://old", visionEndpoints: ["http://new"] })).toEqual(["http://new"]);
  });
  it("nichts vorhanden → leere Liste", () => {
    expect(migrateEndpoints(null)).toEqual([]);
    expect(migrateEndpoints({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run tests/settings.test.ts -t migrateEndpoints`
Expected: FAIL (`migrateEndpoints is not a function`).

- [ ] **Step 3: Implementieren**

In `src/settings.ts` (oben, nach den Imports / vor der Klasse) ergänzen:

```ts
/** Endpoint-Liste aus geladenen Settings: vorhandene visionEndpoints (leere gefiltert),
 *  sonst der alte Einzel-visionEndpoint als 1-Element-Liste, sonst leer. Reiner Helfer. */
export function migrateEndpoints(saved: { visionEndpoint?: string; visionEndpoints?: string[] } | null | undefined): string[] {
  if (saved?.visionEndpoints) return saved.visionEndpoints.filter(e => e && e.trim());
  if (saved?.visionEndpoint && saved.visionEndpoint.trim()) return [saved.visionEndpoint];
  return [];
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run tests/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts tests/settings.test.ts
git commit -m "feat(settings): migrateEndpoints — alte Einzel-Config zu Endpoint-Liste migrieren

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Datenmodell-Umstieg + Failover-Orchestrierung (Glue)

**Files:**
- Modify: `src/settings.ts` (Typ, `defaultSettings`, `endpoint()`-Closure, Endpoint-Feld liest `[0]`)
- Modify: `src/main.ts` (`activeEndpoint`, `resolveAndReconnect`, onload-Migration, `ping`-Dep, Re-Resolve+Retry)

**Interfaces:**
- Consumes: `resolveActiveEndpoint` (Task 1), `migrateEndpoints` (Task 2).
- Produces: `ImageToMarkdownSettings.visionEndpoints: string[]` (ersetzt `visionEndpoint`); `ImageToMarkdownPlugin.activeEndpoint: string | null`; `ImageToMarkdownPlugin.resolveAndReconnect(): Promise<void>` (ersetzt `reconnectVision`).
- **Kein Unit-Test** (main + settings-UI sind Obsidian-Glue, im Repo nicht unit-getestet). Verifikation: `tsc` + `lint` + `npm test` (Bestand grün) + `build`.

- [ ] **Step 1: Settings-Typ + defaultSettings**

In `src/settings.ts`:
- `ImageToMarkdownSettings`: `visionEndpoint: string;` → `visionEndpoints: string[];`.
- `defaultSettings()`: `visionEndpoint: "http://localhost:8080",` → `visionEndpoints: ["http://localhost:8080"],`.

- [ ] **Step 2: `endpoint()`-Closure auf aktiven Endpoint umstellen**

In `src/settings.ts` `render()` die Closure (aktuell `const endpoint = (): string => this.plugin.settings.visionEndpoint;`) ersetzen durch:

```ts
const endpoint = (): string => this.plugin.activeEndpoint ?? this.plugin.settings.visionEndpoints[0] ?? "";
```

Das Endpoint-`addText`-Feld (im `epSetting`-Block) liest/schreibt vorerst weiterhin **einen** Wert — `visionEndpoints[0]`:

```ts
.addText(tx => tx.setPlaceholder("http://localhost:8080").setValue(this.plugin.settings.visionEndpoints[0] ?? "")
  .onChange(async (v: string) => { this.plugin.settings.visionEndpoints[0] = v.trim(); await this.plugin.saveSettings(); await this.plugin.resolveAndReconnect(); }))
```

(Die dynamische Mehrfeld-UI kommt in Task 4 — hier nur kompilierbar halten.) Die `showPing`/`statusDot`-Logik und der „Verbindung testen"-Button bleiben unverändert (nutzen `endpoint()`), ebenso `reconnectVision`-Aufrufe → in Step 4 zu `resolveAndReconnect` umbenennen.

- [ ] **Step 3: `main.ts` — activeEndpoint + resolveAndReconnect + Migration**

In `src/main.ts`:
- Import ergänzen: `import { VisionClient, setHttp, setStreamFetch, resolveActiveEndpoint } from "./vision_client";` und `migrateEndpoints` aus `./settings`.
- Feld ergänzen: `activeEndpoint: string | null = null;`
- `onload`: nach `this.settings = Object.assign({}, defaultSettings(), saved ?? {});` die Migration einschieben (überschreibt das per Object.assign gesetzte `visionEndpoints` mit dem migrierten Wert):
  ```ts
  const migratedEps = migrateEndpoints(saved as { visionEndpoint?: string; visionEndpoints?: string[] } | null);
  this.settings.visionEndpoints = migratedEps.length ? migratedEps : defaultSettings().visionEndpoints;
  ```
- `onload`: den initialen `new VisionClient(...)` durch `void this.resolveAndReconnect();` ersetzen (nach `this.settings`-Aufbau), aber `this.visionClient` zunächst definiert lassen (siehe resolveAndReconnect baut ihn).
- Neue Methode (ersetzt `reconnectVision`):
  ```ts
  async resolveAndReconnect(): Promise<void> {
    const active = await resolveActiveEndpoint(this.settings.visionEndpoints, ep => new VisionClient(ep, "").ping());
    this.activeEndpoint = active;
    const ep = active ?? this.settings.visionEndpoints[0] ?? "";
    this.visionClient = new VisionClient(ep, this.settings.visionModel);
  }
  ```
- Alle bisherigen `reconnectVision()`-Aufrufe (in `main.ts` und `settings.ts`) auf `void this.resolveAndReconnect()` / `await this.plugin.resolveAndReconnect()` umstellen; `reconnectVision` entfernen.
- `visionClient` initial: damit der Typ vor dem ersten `resolveAndReconnect` definiert ist, in `onload` direkt nach dem Settings-Aufbau einmal `this.visionClient = new VisionClient(this.settings.visionEndpoints[0] ?? "", this.settings.visionModel);` setzen, dann `void this.resolveAndReconnect();`.

- [ ] **Step 4: `ping`-Dep + Re-Resolve+Retry in `makeImgViewDeps`**

In `src/main.ts` `makeImgViewDeps()`:
- `ping`-Dep so umstellen, dass sie zuerst (neu) auflöst und Erreichbarkeit liefert:
  ```ts
  ping: async () => { await this.resolveAndReconnect(); return this.activeEndpoint !== null; },
  ```
- `listModels`-Dep auf den aktiven Endpoint:
  ```ts
  listModels: () => new VisionClient(this.activeEndpoint ?? this.settings.visionEndpoints[0] ?? "", "").listModels(),
  ```
- `transcribeStream`-Dep mit Re-Resolve + einem Retry umhüllen: schlägt `this.visionClient.transcribeStream(...)` mit Netz-/HTTP-Fehler fehl, einmal `await this.resolveAndReconnect()` und — wenn `this.activeEndpoint` jetzt gesetzt ist — den Call **einmal** wiederholen; sonst Fehler weiterwerfen. (Konkret: try/catch um den finalen `return this.visionClient.transcribeStream(...)`; im catch `await this.resolveAndReconnect(); if (this.activeEndpoint) return this.visionClient.transcribeStream(...); throw err;`.)

- [ ] **Step 5: Verifizieren**

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build
```
Expected: `tsc` 0 Fehler · `lint` 0/0 · **alle Tests grün** (Baseline 188; keine neuen, da Glue) · Build erzeugt `main.js`. Falls ein bestehender Test `settings.visionEndpoint` referenziert, auf `visionEndpoints` anpassen (Teil dieses Tasks).

- [ ] **Step 6: Commit**

```bash
git add src/main.ts src/settings.ts
git commit -m "feat: Endpoint-Liste + Failover-Orchestrierung (activeEndpoint, resolveAndReconnect, Retry)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Settings — dynamische Endpoint-Felder + Pro-Feld-Status

**Files:**
- Modify: `src/settings.ts` (`render()`: Endpoint-Block zu dynamischen Feldern)
- Modify: `src/i18n.ts` (neue Strings EN/DE)

**Interfaces:**
- Consumes: `settings.visionEndpoints` (Task 3), `plugin.activeEndpoint`, `plugin.resolveAndReconnect`, `VisionClient(ep,"").ping()`.
- Produces: keine neuen Code-Interfaces — UI-Ausbau. **Kein Unit-Test** (Settings-UI ist Obsidian-Glue). Verifikation: `tsc`/`lint`/`build` + manuell.

- [ ] **Step 1: i18n-Strings**

In `src/i18n.ts` in der **EN**-Map (bei den `settings.*`-Keys) ergänzen, und passend in der **DE**-Map:

```ts
// EN
"settings.endpoints.name": "Vision endpoints",
"settings.endpoints.desc": "Tried in order — the first reachable one is used. One per field. The active endpoint is marked.",
"settings.endpoints.addPlaceholder": "add another endpoint…",
"settings.endpoints.active": "active",
// DE
"settings.endpoints.name": "Vision-Endpunkte",
"settings.endpoints.desc": "Werden der Reihe nach probiert — der erste erreichbare wird genutzt. Ein Feld pro Endpunkt. Der aktive ist markiert.",
"settings.endpoints.addPlaceholder": "weiterer Endpunkt…",
"settings.endpoints.active": "aktiv",
```

Die alten `settings.endpoint.name`/`settings.endpoint.desc` bleiben vorerst (werden nicht mehr referenziert; in Task 6/Doku-Phase optional entfernen).

- [ ] **Step 2: Endpoint-Block in `render()` zu dynamischen Feldern umbauen**

In `src/settings.ts` den `epSetting`-Block (das einzelne Endpoint-`Setting` aus Task 3 inkl. `statusDot`/`showPing`/Test-Button) ersetzen durch eine Render-Schleife. Vollständige Logik:

```ts
// ── Vision-Endpunkte (geordnete Fallback-Liste) ──
const eps = this.plugin.settings.visionEndpoints;
const rows = [...eps, ""];   // leeres Zusatzfeld am Ende
rows.forEach((value, i) => {
  const isAdder = i >= eps.length;
  const s = new Setting(containerEl);
  if (i === 0) s.setName(t("settings.endpoints.name")).setDesc(t("settings.endpoints.desc"));
  const statusIcon = s.controlEl.createSpan({ cls: "img2md-ep-status" });
  s.addText(tx => tx
    .setPlaceholder(isAdder ? t("settings.endpoints.addPlaceholder") : "http://localhost:1234")
    .setValue(value)
    .onChange(async (v: string) => {
      const next = [...this.plugin.settings.visionEndpoints];
      if (isAdder) { if (v.trim()) next.push(v.trim()); }
      else { next[i] = v.trim(); }
      this.plugin.settings.visionEndpoints = next.filter(e => e);
      await this.plugin.saveSettings();
      await this.plugin.resolveAndReconnect();
      this.render();   // re-render: leeres Feld verschwindet, neues Zusatzfeld erscheint
    }));
  // Pro-Feld-Status in A11y-Form (Form + Text + Farbe)
  const ep = value.trim();
  if (!isAdder && ep) {
    setIcon(statusIcon, "loader"); statusIcon.setAttribute("title", t("view.checking"));
    void new VisionClient(ep, "").ping().then(ok => {
      statusIcon.empty();
      setIcon(statusIcon, ok ? "circle-check" : "circle-x");
      statusIcon.toggleClass("is-ok", ok); statusIcon.toggleClass("is-error", !ok);
      const active = normalizeEndpoint(ep) === (this.plugin.activeEndpoint ?? "");
      statusIcon.toggleClass("is-active", active);
      statusIcon.setAttribute("title", (ok ? t("settings.connected") : t("settings.offline")) + (active ? " · " + t("settings.endpoints.active") : ""));
    });
  }
});
new Setting(containerEl).addButton(b => b.setButtonText(t("settings.testConnection")).onClick(() => this.render()));
```

- `normalizeEndpoint` aus `./vision_client` importieren (Import in `settings.ts` ergänzen: `import { VisionClient, normalizeEndpoint } from "./vision_client";`).
- Die alten `statusDot`/`showPing`-Helfer entfernen (nicht mehr genutzt).
- „Verbindung testen" ist jetzt ein Re-Render (pingt alle Felder neu).

- [ ] **Step 3: Verifizieren**

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build
```
Expected: alles grün, Build ok. (Keine neuen Unit-Tests — UI-Glue.)

- [ ] **Step 4: Commit**

```bash
git add src/settings.ts src/i18n.ts
git commit -m "feat(settings): dynamische Endpoint-Felder + Pro-Feld-Status (A11y-Form), aktiver markiert

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: View — `connectionStatus` + „verbunden via X"

**Files:**
- Modify: `src/img_to_md_view.ts` (`ImgToMdViewDeps.ping` → `connectionStatus`, `refreshStatus`, `setConnState`)
- Modify: `src/main.ts` (`makeImgViewDeps`: `ping` → `connectionStatus`)
- Modify: `src/i18n.ts` (`view.connectedVia`)
- Test: `tests/img_to_md_view.test.ts`

**Interfaces:**
- Consumes: `plugin.resolveAndReconnect`, `plugin.activeEndpoint`.
- Produces: `ImgToMdViewDeps.connectionStatus: () => Promise<{ ok: boolean; endpoint: string | null }>` (ersetzt `ping: () => Promise<boolean>`).

- [ ] **Step 1: i18n + Failing test**

In `src/i18n.ts` ergänzen (EN/DE): `"view.connectedVia": "connected via {0}"` / `"verbunden via {0}"`.

In `tests/img_to_md_view.test.ts` den `mkView`-Helfer (Default-Dep) von `ping` auf `connectionStatus` umstellen und die bestehenden Status-Tests anpassen + einen neuen ergänzen:

```ts
// im Default-deps-Objekt: ping-Zeile ersetzen durch
connectionStatus: over.connectionStatus ?? (async () => ({ ok: true, endpoint: "http://localhost:1234" })),
```

```ts
it("zeigt 'verbunden via <endpoint>' nach onOpen", async () => {
  const v = mkView({ connectionStatus: async () => ({ ok: true, endpoint: "http://localhost:1234" }) });
  await v.view.onOpen();
  expect(all(v.view.contentEl, "img2md-status")[0].textContent).toContain("http://localhost:1234");
});
it("zeigt 'offline' wenn nicht erreichbar", async () => {
  const v = mkView({ connectionStatus: async () => ({ ok: false, endpoint: null }) });
  await v.view.onOpen();
  expect(all(v.view.contentEl, "img2md-status")[0].textContent).toContain("offline");
});
```

Die bestehenden Status-Tests (die `ping: async () => true/false` nutzten) auf `connectionStatus: async () => ({ ok: …, endpoint: … })` umstellen; die Icon-Form-Assertions (`data-icon` `circle-check`/`circle-x`) bleiben gültig.

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run tests/img_to_md_view.test.ts -t "verbunden via"`
Expected: FAIL (`connectionStatus` nicht in Deps / Label zeigt den Endpoint nicht).

- [ ] **Step 3: Implementieren (View)**

In `src/img_to_md_view.ts`:
- `ImgToMdViewDeps`: `ping: () => Promise<boolean>;` → `connectionStatus: () => Promise<{ ok: boolean; endpoint: string | null }>;`
- `refreshStatus()`:
  ```ts
  async refreshStatus(): Promise<void> {
    if (!this.statusEl) return;
    this.setConnState(null, null);
    const { ok, endpoint } = await this.deps.connectionStatus();
    this.setConnState(ok, endpoint);
  }
  ```
- `setConnState(state: boolean | null, endpoint: string | null)`:
  ```ts
  private setConnState(state: boolean | null, endpoint: string | null): void {
    const root = this.statusEl, icon = this.statusIconEl, label = this.statusLabelEl;
    if (!root || !icon || !label) return;
    root.removeClass("is-ok"); root.removeClass("is-error"); root.removeClass("is-checking");
    if (state === null) { root.addClass("is-checking"); setIcon(icon, "loader"); label.setText(t("view.checking")); }
    else if (state) { root.addClass("is-ok"); setIcon(icon, "circle-check"); label.setText(endpoint ? t("view.connectedVia", endpoint) : t("view.connected")); }
    else { root.addClass("is-error"); setIcon(icon, "circle-x"); label.setText(t("view.offline")); }
  }
  ```

- [ ] **Step 4: Implementieren (main-Dep)**

In `src/main.ts` `makeImgViewDeps()` die `ping`-Dep ersetzen durch:

```ts
connectionStatus: async () => { await this.resolveAndReconnect(); return { ok: this.activeEndpoint !== null, endpoint: this.activeEndpoint }; },
```

- [ ] **Step 5: Run, verify pass**

Run: `npx vitest run tests/img_to_md_view.test.ts` und `npx tsc --noEmit`
Expected: PASS (neue + angepasste View-Tests grün); `tsc` 0 Fehler.

- [ ] **Step 6: Commit**

```bash
git add src/img_to_md_view.ts src/main.ts src/i18n.ts tests/img_to_md_view.test.ts
git commit -m "feat(view): Verbindungsstatus zeigt aktiven Endpoint ('verbunden via X')

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Doku + Abschluss

**Files:**
- Modify: `CHANGELOG.md`, `README.md`, `README.de.md`, `docs/manual/reference.md`, `docs/manual/how-to.md`, `AGENTS.md`

**Interfaces:** keine — Dokumentation.

- [ ] **Step 1: Doku schreiben**

- `CHANGELOG.md`: unter `## [Unreleased]` / `### Hinzugefügt` einen Eintrag „Endpoint-Fallback-Liste" (mehrere Vision-Endpoints, erster erreichbarer; eine gesyncte Config für mehrere Geräte/Netze; Pro-Feld-Status; „verbunden via X").
- `README.md` + `README.de.md`: eine Features-Bullet + eine „In detail"-Bullet (EN/DE-Parität), Stil wie bestehende Bullets.
- `docs/manual/reference.md`: Endpoint-Einstellung als Liste dokumentieren (Reihenfolge = Priorität, erster erreichbarer, Pro-Feld-Status).
- `docs/manual/how-to.md`: kurze Recipe „Configure multiple endpoints (home + on the road)".
- `AGENTS.md`: `vision_client.ts`-Modulzeile um `resolveActiveEndpoint` ergänzen; `settings.ts`-Zeile um `migrateEndpoints` + Endpoint-Liste.

- [ ] **Step 2: Verifizieren + Commit**

```bash
npm test && npx tsc --noEmit && npm run lint
git add CHANGELOG.md README.md README.de.md docs/manual/reference.md docs/manual/how-to.md AGENTS.md
git commit -m "docs: Endpoint-Fallback-Liste (README/Manual/CHANGELOG/AGENTS)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (vom Plan-Autor durchgeführt)

- **Spec-Coverage:** §3 Datenmodell+Migration → Tasks 2/3; `resolveActiveEndpoint` → Task 1; main-Orchestrierung+Retry → Task 3; Settings dynamische Felder+Pro-Feld-Status → Task 4; „verbunden via X" → Task 5; i18n → Tasks 4/5; Tests (Kern+View) → Tasks 1/2/5; Doku → Task 6. Edge-Cases (alle offline → null/visionEndpoints[0]; leere Liste; ein Endpoint; Netzwechsel via Refresh/Retry; Ping nur bei Resolve) durch Task-3-Orchestrierung + Task-1-Tests abgedeckt.
- **Placeholder-Scan:** keine TBD/TODO. Glue/UI-Tasks (3,4) bewusst ohne Unit-Test, mit konkreten tsc/lint/build-Verifikationsschritten (kein erfundener Test) — explizit in Global Constraints begründet.
- **Type-Konsistenz:** `visionEndpoints: string[]` (Task 3) == Nutzung in Tasks 4/5; `resolveActiveEndpoint(endpoints, ping)` (Task 1) == Aufruf in Task 3; `migrateEndpoints(saved)` (Task 2) == Aufruf in Task 3; `connectionStatus: () => Promise<{ok, endpoint}>` (Task 5) identisch in View-Dep + main-Dep + Test; `resolveAndReconnect`/`activeEndpoint` (Task 3) == Nutzung in Tasks 4/5.
