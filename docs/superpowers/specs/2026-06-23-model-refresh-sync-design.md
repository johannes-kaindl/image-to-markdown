# Design: Modell-Transparenz — Refresh + Post-Sync

**Datum:** 2026-06-23
**Status:** Entwurf
**Scope:** Sichtbar machen und aktuell halten, welches Vision-Modell tatsächlich geladen ist, wenn ein externer Prozess das Backend-Modell im Hintergrund ändert. Manuelles Refresh der Modell-Liste in beiden Dropdowns (Sidebar + Settings) und automatischer Abgleich der Auswahl mit dem real verwendeten Modell nach jeder Transkription.

---

## 1. Motivation

Lokale Backends (MLX `:8080`, LM Studio `:1234`) haben in der Regel **ein** geladenes Modell, das ein externer Prozess (anderes Programm/Plugin) wechseln kann, ohne dass das Plugin es merkt. Zwei bestehende Realitäten prägen das Design:

- Das Plugin **sendet** die Auswahl (`model: this.model`) im Request, **liest** aber das tatsächlich verwendete Modell autoritativ aus der Antwort (`response.model` → `transcribe`/`transcribeStream` in `vision_client.ts:70,103`). Das `transcribed_by`-Frontmatter stimmt also bereits.
- LM Studio **ignoriert** das `model`-Feld und nutzt das geladene Modell; MLX hat ein fix geladenes Modell. Das Plugin kann das geladene Modell **nicht** clientseitig erzwingen — nur *feststellen*. (Ollama lädt das angefragte Modell on-demand → dort entsteht nie ein Mismatch.)

Daraus folgt: kein „Modell laden", sondern **Transparenz** — die Liste auf Knopfdruck aktualisieren und die UI-Auswahl dem real geladenen Modell folgen lassen.

---

## 2. Geklärte Entscheidungen

1. **Ziel = Transparenz + Refresh** (kein clientseitiges Erzwingen — backend-unabhängig nicht möglich).
2. **Refresh-Icon in beiden Dropdowns** (Sidebar + Settings).
3. **Post-Transkriptions-Sync statt Pre-flight-Check:** der Abgleich nutzt das ohnehin gelesene `response.model` (null Extra-Roundtrip); **kein** zusätzlicher `/v1/models`-Call vor jeder Transkription, **kein** Settings-Toggle.
4. **Auto-Angleichen statt nur Warnen:** weicht das real verwendete Modell von der Auswahl ab, wird die Auswahl angeglichen (`setModel` + Hinweis). Sicher, weil der Mismatch nur bei Backends auftritt, die das `model`-Feld ignorieren — dort ist die alte Auswahl ein totes Echo.
5. **Scope = Sidebar-Flow + Settings-UI.** Der Command-/Kontextmenü-Pfad (`runImgToMd`, obsidian-freier Kern ohne `setModel`-Zugriff) bekommt **kein** Post-Sync — er nutzt `settings.visionModel` direkt und hat keine sichtbare Auswahl. (YAGNI.)

---

## 3. Architektur

### Reiner Helfer: `src/img_to_md_state.ts`

```ts
/** Das tatsächlich verwendete Modell aus den Ergebnis-Karten: erstes nicht-leeres card.model.
 *  "" wenn keine Karte ein Modell meldet (z.B. alles abgebrochen). Rein, testbar. */
export function actualModel(cards: ImgCard[]): string;
```

Begründung: alle Karten eines Laufs stammen von demselben Backend → dasselbe Modell; das erste nicht-leere genügt.

### Sidebar: `src/img_to_md_view.ts`

- **Refresh-Icon:** neben `modelSel` ein `clickable-icon` (`refresh-cw`, `aria-label`/`title` = `t("view.refreshModels")`). Klick → `await this.refreshModels()` (existiert bereits, `:64`). Während des Ladens kurz deaktiviert/rotierend (CSS optional).
- **Post-Sync** in `run()` (nach der Karten-Schleife und dem Abbruch-Handling, vor dem finalen `renderCards()`): `const actual = actualModel(this.state.cards); if (actual && actual !== this.deps.getModel()) { this.deps.setModel(actual); await this.refreshModels(); this.statusEl?.setText(t("view.modelChanged", actual)); }`. `setModel` (synchron) persistiert und reconnectet den Client (siehe main-Closure); `refreshModels` zieht das Dropdown nach.
- **Hinweis-Kanal:** die View hat heute keinen `notify`-Dep — der „Modell gewechselt"-Hinweis läuft daher über die **Statuszeile** (`this.statusEl?.setText(...)`), konsistent mit dem bestehenden Verbindungsstatus und ohne neuen Dep. Er ist transient (nächster `refreshStatus()`/Fokus stellt den Verbindungsstatus wieder her).

### Sidebar Stale-Auswahl: `src/img_to_md_view.ts` `refreshModels()` (`:64`)

Nach `listModels()`: ist `cur` gesetzt, die Liste nicht leer und `cur` **nicht** enthalten (= nicht mehr geladen) → `this.deps.setModel(models[0])` und den Hinweis in der Statuszeile zeigen. Dann wie bisher das Dropdown mit der (ggf. neuen) Auswahl befüllen. So zeigt das Dropdown nie ein nicht-geladenes Modell als aktiv.

### Settings: `src/settings.ts`

Beim `modelSetting` (`:120-136`) einen **permanenten** Refresh-Button/-Icon ergänzen (heute nur Offline-`loadModels`): `modelSetting.addExtraButton(b => b.setIcon("refresh-cw").setTooltip(t("settings.refreshModels")).onClick(() => this.display()))`. `display()` re-fetcht die Liste (bestehender Mechanismus). Der Offline-`loadModels`-Button bleibt als Fallback.

### `src/main.ts`

Keine Signaturänderung nötig: `getModel`/`setModel` (`:146-147`) existieren; `setModel` persistiert + reconnectet bereits. Die View ruft sie.

---

## 4. Datenfluss

```
Refresh-Klick (Sidebar)        → refreshModels() → listModels() → Dropdown neu (+ Stale-Check)
Refresh-Klick (Settings)       → display()       → listModels() → Dropdown neu
Transkription (Sidebar run())  → card.model (= response.model) gesetzt
  nach Lauf: actual = actualModel(cards)
    actual ≠ Auswahl & nicht-leer → setModel(actual) + refreshModels() + Statuszeilen-Hinweis
```

---

## 5. i18n

Neue Keys (EN kanonisch + DE):
- `view.refreshModels` = „Refresh models" / „Modelle aktualisieren"
- `view.modelChanged` = „Model changed to {0}" / „Modell gewechselt zu {0}"
- `settings.refreshModels` = „Refresh models" / „Modelle aktualisieren"

---

## 6. Tests

**Reiner Kern (`img_to_md_state.ts`, vitest):**
- `actualModel`: erstes nicht-leeres `card.model`; `""` wenn keine Karte ein Modell hat; ignoriert leere `model`-Strings.

**View (`img_to_md_view.ts`, makeFakeApp):**
- Refresh-Icon klick → `listModels` wird (erneut) aufgerufen, Dropdown spiegelt die neue Liste.
- `run()` mit `transcribeStream`, das ein vom `getModel()` abweichendes Modell liefert → `setModel(actual)` wird aufgerufen; Statuszeile zeigt den Hinweis.
- `run()` mit übereinstimmendem Modell → `setModel` wird **nicht** aufgerufen (kein unnötiges Persistieren/Reconnect).
- `refreshModels()` mit einer Modell-Liste, die die aktuelle Auswahl **nicht** enthält → `setModel(models[0])` (Stale-Angleich).

**Settings (`settings.ts`):** Refresh-Icon ist vorhanden und ruft `display()` (so weit mit dem bestehenden Settings-Test-Stil testbar; sonst manuell verifiziert).

**Regression:** alle bestehenden Tests grün; `tsc`/`eslint` sauber.

---

## 7. Risiken & offene Detailpunkte

- **Mehrere Modelle in `/v1/models` (LM Studio kann mehrere laden):** `actualModel` nimmt das real geantwortete Modell — korrekt unabhängig von der Listenlänge. Der Stale-Angleich (`models[0]`) ist nur relevant, wenn die *Auswahl* gar nicht mehr in der Liste ist; bei mehreren geladenen Modellen bleibt eine noch vorhandene Auswahl unangetastet.
- **`refreshModels()` nach `setModel` im Post-Sync:** ein zusätzlicher `/v1/models`-Call nach der Transkription (einmalig, nicht pro Token) — akzeptabel, hält das Dropdown konsistent. Alternativ ließe sich das Dropdown lokal aktualisieren; der Re-Fetch ist robuster (zeigt zugleich neu geladene Modelle).
- **Statuszeile als Hinweis-Kanal:** überschreibt kurz den Verbindungsstatus; beim nächsten `refreshStatus()`/Fokus wird er wiederhergestellt. Akzeptabel für einen transienten Hinweis; vermeidet einen neuen View-Dep.
- **Kein Pre-flight-Check:** ändert sich das Modell genau zwischen Refresh und Transkription, fällt es erst im Post-Sync auf (nach diesem Lauf). Bewusst akzeptiert (Toggle nachrüstbar).

---

## 8. Definition of Done

- [ ] `actualModel` rein implementiert + getestet.
- [ ] Sidebar: Refresh-Icon neben dem Modell-Dropdown → re-fetch; Stale-Auswahl wird auf ein geladenes Modell angeglichen.
- [ ] Sidebar `run()`: Post-Sync gleicht die Auswahl an `response.model` an (nur bei Abweichung) + Statuszeilen-Hinweis.
- [ ] Settings: permanenter Refresh-Button beim Modell-Setting.
- [ ] i18n EN/DE; alle Alt-Tests grün, neue Tests grün, `tsc`/`eslint` sauber.
- [ ] Empirisch in Obsidian: Backend-Modell extern wechseln → Refresh zeigt das neue; nach einer Transkription folgt die Auswahl automatisch dem real verwendeten Modell.
