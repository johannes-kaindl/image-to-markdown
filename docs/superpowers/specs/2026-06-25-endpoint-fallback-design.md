# Design: Endpoint-Fallback-Liste

**Datum:** 2026-06-25
**Status:** Entwurf
**Scope:** Mehrere Vision-Endpoints als geordnete Fallback-Liste; das Plugin ermittelt automatisch den ersten erreichbaren und nutzt ihn. Eine gesyncte Config funktioniert damit auf mehreren Geräten/in mehreren Netzen, ohne in den Einstellungen umzustellen.

---

## 1. Motivation

Heute trägt das Plugin **einen** `visionEndpoint`. Wer die Plugin-Config via Obsidian Sync über mehrere Geräte teilt, hat ein Problem: kein einzelner Endpoint passt überall.

- `http://localhost:1234` greift nur auf dem Gerät, auf dem der LLM-Server läuft (z.B. das MacBook) — auf iPhone/iPad gibt es kein lokales LM Studio.
- Eine feste LAN-IP `http://192.168.178.27:1234` greift nur, solange dieses Gerät unter dieser IP im erreichbaren Netz hängt. Im Hotspot/anderen Netz ist sie tot (realer Vorfall: `192.168.178.27` aus dem Hotspot unerreichbar, während `localhost:1234` einwandfrei lief).

Die Lösung ist eine **geordnete Liste** von Endpoints: das Plugin probiert sie der Reihe nach durch und nutzt den ersten erreichbaren. Eine einzige gesyncte Config — am MacBook greift `localhost`, am iPhone fällt es automatisch auf die LAN-IP zurück (die via WireGuard erreichbar ist, wenn der Host zuhause läuft). Kein manuelles Umstellen mehr.

---

## 2. Scope

### Diese Spec
- `visionEndpoint: string` → `visionEndpoints: string[]` (geordnet, Index 0 = höchste Priorität), inkl. Migration alter Configs.
- Reiner Failover-Helfer + automatische Ermittlung des aktiven Endpoints (gemerkt, Neu-Probieren bei Fehler).
- Settings-UI: dynamische Endpoint-Felder + Pro-Feld-Status + Markierung des aktiven Endpoints.
- Sidebar zeigt, über welchen Endpoint verbunden ist.

### Bewusst NICHT (YAGNI / anderer Zyklus)
- **vault-rag** teilt denselben Endpoint-Mechanismus, bekommt aber einen **eigenen Port-Zyklus** (eigenes Repo, eigene Spec) — sonst vermischt ein Plan zwei Repos.
- **Keine** Per-Endpoint-Modell-Konfiguration — das `model`-Feld wird von LM Studio ohnehin ignoriert, `response.model` ist autoritativ; die Modell-Liste kommt vom aktiven Endpoint.
- **Keine** Auth/TLS-Härtung am Endpoint — das ist eine Netz-/VPN-Sache (Tailscale/FritzBox-WireGuard), außerhalb des Plugins.
- **Kein** paralleles „schnellster gewinnt" — der Reihe nach durchprobieren (deterministische Priorität) genügt; YAGNI.

---

## 3. Architektur (Ansatz A: reiner Resolver + unveränderter `VisionClient`)

Der `VisionClient` bleibt **single-endpoint und unverändert**. Das Failover ist eine eigene kleine Verantwortung im reinen Kern; `main.ts` orchestriert.

### `src/settings.ts` — Datenmodell + Migration
- `ImageToMarkdownSettings.visionEndpoint: string` → **`visionEndpoints: string[]`**.
- `defaultSettings()`: `visionEndpoints: ["http://localhost:8080"]` (bisheriger Default-Wert, nur als Liste).
- **Reiner Migrations-Helfer** `migrateEndpoints(saved: Partial<…>): string[]`: ist im geladenen `data.json` noch `visionEndpoint` (String) und kein `visionEndpoints` vorhanden → `[visionEndpoint]`; sonst `visionEndpoints` (leere/whitespace-Einträge gefiltert); Fallback Default. Obsidian-frei, testbar. Wird in `main.onload` beim Zusammenführen der geladenen Settings angewandt; danach wird nur noch `visionEndpoints` persistiert.

### `src/vision_client.ts` — reiner Kern (neuer Helfer, Client unverändert)
```ts
/** Erster erreichbarer Endpoint aus der geordneten Liste, oder null wenn keiner antwortet.
 *  Leere/whitespace-Einträge werden übersprungen; jeder Eintrag wird normalizeEndpoint-t.
 *  ping ist injiziert (Obsidian-Schicht baut VisionClient(ep,"").ping) → app-frei testbar. */
export async function resolveActiveEndpoint(
  endpoints: string[],
  ping: (endpoint: string) => Promise<boolean>,
): Promise<string | null>;
```
Iteriert die Liste der Reihe nach; der erste Eintrag mit `ping(ep) === true` gewinnt. `VisionClient` (Konstruktor, `normalizeEndpoint`, `ping`, `listModels`, `transcribe`, `transcribeStream`) bleibt unverändert.

### `src/main.ts` — aktiver Endpoint + Failover-Orchestrierung
- Neues Feld `private activeEndpoint: string | null`.
- **`resolveAndReconnect(): Promise<void>`** — ruft `resolveActiveEndpoint(settings.visionEndpoints, ep => new VisionClient(ep, "").ping())`, setzt `activeEndpoint` und (re)konstruiert `this.visionClient` mit dem aktiven Endpoint. Sind **alle** offline: `activeEndpoint = null`, `visionClient` wird mit `visionEndpoints[0]` (bzw. `""`) konstruiert, damit Calls einen definierten Zustand haben und sauber als „offline" fehlschlagen.
- Aufgerufen bei: `onload` (nach Settings-Load), `active-leaf-change` (Sidebar-Refresh — nutzt den bereits existierenden Auto-Ping-Moment), Settings-„Verbindung testen" und Endpoint-Änderung.
- **Re-Resolve + einmaliger Retry bei Call-Fehler:** Die View-Transkriptions-Deps (`transcribeStream`, non-streaming `transcribe`) kapseln: wirft der Call (Netz-/HTTP-Fehler), wird `resolveAndReconnect()` aufgerufen; hat sich der aktive Endpoint geändert, wird der Call **einmal** wiederholt. Schlägt auch das fehl → regulärer Fehler (Karte zeigt Fehler / Status „offline"). Kein Retry-Loop.
- Die bisherige `reconnectVision()` wird zu `resolveAndReconnect()`; alle Aufrufstellen (Settings-onChange, `onload`) werden umgestellt (kein direktes `new VisionClient(settings.visionEndpoint)` mehr).

### `src/settings.ts` — dynamische Endpoint-Felder + Pro-Feld-Status
- Statt des einen `addText`-Endpoint-Felds: eine **Render-Schleife** über `settings.visionEndpoints` plus **ein leeres Zusatzfeld** am Ende.
  - Jedes Feld: `addText` mit dem Endpoint-Wert; `onChange` aktualisiert den Listen-Eintrag, filtert leere Einträge, `saveSettings()`, `resolveAndReconnect()`, und **re-rendert** die Settings (damit ein geleertes Feld verschwindet und ein neues leeres Zusatzfeld erscheint).
- **Pro-Feld-Status-Icon** in **A11y-Form** (`setIcon` `circle-check` erreichbar / `circle-x` offline / `loader` prüft, plus `title`-Text — redundante Kodierung Form+Text, nicht nur Farbe). Jedes Feld pingt seinen eigenen Endpoint (`new VisionClient(ep,"").ping()`).
- Der **aktive** Endpoint (erster erreichbarer) wird markiert (CSS-Klasse `is-active` + `title`/Badge).
- **„Verbindung testen"**: pingt alle Felder (parallel), aktualisiert Icons + Aktiv-Markierung.
- Der bisherige farbige `statusDot`/`showPing` am Einzelfeld entfällt zugunsten der Pro-Feld-Icons.

### `src/img_to_md_view.ts` — „verbunden via X"
- `deps.ping(): Promise<boolean>` wird zu **`deps.connectionStatus(): Promise<{ ok: boolean; endpoint: string | null }>`** (eine Dep, ein Call — gibt zugleich Erreichbarkeit und aktiven Endpoint). `setStatus`/`refreshStatus`: bei „verbunden" zeigt das Label `t("view.connectedVia", endpoint)`; offline/prüft wie bisher. Die A11y-Icon-Form (`circle-check`/`circle-x`/`loader`) bleibt unverändert.

---

## 4. Datenfluss

```
onload → migrateEndpoints(saved) → settings.visionEndpoints
       → resolveAndReconnect(): ping ep[0], ep[1], … → erster ok = activeEndpoint
                                                      → visionClient = VisionClient(activeEndpoint)

active-leaf-change → view.refresh() → resolveAndReconnect() → setStatus("verbunden via " + activeEndpoint)

Transkribieren → visionClient.transcribeStream(...)
   Fehler? → resolveAndReconnect() → activeEndpoint geändert? → genau ein Retry → sonst Fehler

Settings: Feld-onChange → Liste aktualisieren (leere raus) → saveSettings → resolveAndReconnect → re-render
          „Verbindung testen" → alle Felder pingen → Icons + Aktiv-Markierung
```

---

## 5. Edge-Cases

- **Alle offline:** `activeEndpoint = null`, Status „offline"; `visionClient` mit `visionEndpoints[0]` (definierter Zustand). Calls schlagen sauber fehl (wie heute bei totem Endpoint).
- **Leere Liste / nur leeres Zusatzfeld:** wie „offline"; Settings zeigt nur das leere Feld.
- **Genau ein Endpoint:** verhält sich exakt wie heute (Migration deckt das ab; Resolve gibt diesen einen zurück).
- **Netzwechsel mitten in der Session** (Heim-WLAN ↔ Hotspot): nächster Sidebar-Refresh (`active-leaf-change`) oder ein fehlgeschlagener Call löst `resolveAndReconnect()` aus → der jetzt erreichbare Endpoint wird aktiv.
- **Modell-Liste:** kommt vom **aktiven** Endpoint (`listModels` nutzt `this.visionClient`). Verschiedene Endpoints zeigen i.d.R. auf dieselbe Maschine (localhost vs. LAN-IP) → selbe Modelle; kein Sonderfall.
- **Ping-Overhead:** Resolve pingt N Endpoints — aber nur in den „Verbindungsaufbau-Momenten" (Refresh/Test/Load), **nicht** pro Bild/PDF-Seite. Transkriptionen nutzen den gemerkten aktiven Endpoint.

---

## 6. Tests

**Reiner Kern (`vision_client.ts` / Migrations-Helfer, vitest):**
- `resolveActiveEndpoint`: erster erreichbarer gewinnt (ping-Reihenfolge); überspringt offline-Einträge bis zum ersten ok; alle offline → `null`; leere/whitespace-Einträge übersprungen; `normalizeEndpoint` je Eintrag (trailing `/v1`/Slash).
- `migrateEndpoints`: alter `visionEndpoint`-String → `[string]`; vorhandene `visionEndpoints` bleiben; leere gefiltert; nichts vorhanden → Default.
- `VisionClient`-Bestand: alle bestehenden Tests grün (unverändert).

**Settings/View (gemockt):**
- Settings: Render-Schleife erzeugt ein Feld je Endpoint + ein leeres Zusatzfeld; Tippen ins leere Feld hängt einen Eintrag an; Leeren entfernt ihn; Pro-Feld-Status-Icon bekommt distinkte Form je Zustand (`data-icon`-Assert wie bei der 0.4.2-A11y); aktiver Endpoint markiert.
- View: `connectionStatus` `{ok:true, endpoint}` → Label „verbunden via {endpoint}"; `{ok:false}` → „offline"; `null` → „prüft" (Icon-Form je Zustand).

**Regression:** alle bestehenden Tests grün; `npx tsc --noEmit` + `npm run lint` (inkl. `eslint-plugin-obsidianmd`) sauber.

---

## 7. Risiken & offene Detailpunkte

- **`normalizeEndpoint` je Eintrag** ist load-bearing — sonst baut ein Eintrag mit trailing `/v1` wieder `…/v1/v1/…` (bekannter Footgun).
- **Stream-Retry genau einmal** — kein Loop; bei Dauer-Offline zeigt die Karte/der Status den Fehler.
- **`connectionStatus`-Dep-Signaturänderung** berührt die View-Tests (von `ping:boolean` auf `{ok,endpoint}`); der Status-Render-Pfad bleibt sonst gleich.
- **Settings-Re-Render bei jeder Feld-Änderung** ist akzeptabel (Settings-Tab ist kein Hot-Path); nutzt die bestehende `render()`-Methode (0.4.1).

---

## 8. Definition of Done

- [ ] `visionEndpoints: string[]` + `migrateEndpoints` implementiert + getestet; alte `data.json` (Einzel-`visionEndpoint`) lädt unverändert weiter.
- [ ] `resolveActiveEndpoint` rein implementiert + getestet (Reihenfolge, alle-offline→null, leere übersprungen, normalize).
- [ ] `main.resolveAndReconnect()` ermittelt + merkt den aktiven Endpoint; Aufruf bei Load/Refresh/Settings; Re-Resolve + einmaliger Retry bei Call-Fehler.
- [ ] Settings: dynamische Felder (+ leeres Zusatzfeld), Pro-Feld-Status (A11y-Form), aktiver markiert, „Verbindung testen" pingt alle.
- [ ] Sidebar zeigt „verbunden via {Endpoint}".
- [ ] i18n EN/DE für neue Strings; alle Alt-Tests grün; neue Tests grün; `tsc`/`lint` sauber.
- [ ] Empirisch in Obsidian: Liste `[localhost:1234, 192.168.178.27:1234]` → am MacBook „verbunden via localhost"; LM Studio stoppen → „offline"; (Mobil-Verifikation iPhone/iPad: Handover).
