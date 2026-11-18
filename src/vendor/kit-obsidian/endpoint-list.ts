// vendored from obsidian-kit@0.95.0, src/obsidian/endpoint-list.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/* Geordneter Endpunkt-Fallback-Listen-Editor: eine Setting-Zeile je Endpunkt (URL ·
 * Schlüssel · Modell-Override · „zuerst verwenden" · entfernen) plus Adder-Zeile,
 * Status-Icon, Rollenzeile, Drittanbieter-Hinweis und Preset-Knöpfe.
 *
 * Herkunft: vault-rag/src/settings.ts (buildEndpointList, 0.19.x, 274 Zeilen, zwei
 * Aufrufstellen: Chat + Embedding). Umzug ohne Verhaltensänderung. Abweichungen zur
 * Vorlage: alle Texte kommen über `strings` aus `opts` (das Kit formuliert nicht),
 * Modell-Cache und Tab-Neuaufbau sind Callbacks statt Tab-Zustand, CSS-Präfix `okit-`. */
import { Notice, Setting, setIcon, setTooltip, type App } from "obsidian";
import { localEndpointSecrets, migrateLocalEndpoints } from "./endpoint-secrets";
import type { EndpointSecretHook } from "../kit/endpoint-secret-hook";
export type { EndpointSecretHook };
import { renderModelPicker } from "./model-picker";
import { resolveModelChoice } from "../kit/model-choice";
import type { ModelHintKey } from "../kit/model-choice";
import type { ModelListCache, ModelListClient } from "../kit/model-list-cache";
import { normalizeEndpoint } from "../kit/endpoint";
import { applyEndpointEdit, carriesApiKey, endpointRole, moveEndpointToFront } from "../kit/endpoint_config";
import type { EndpointConfig, EndpointRole } from "../kit/endpoint_config";
import { ENDPOINT_PRESETS, validateEndpointInput } from "../kit/endpoint_diagnostics";
import type { EndpointPreset, EndpointStatus, EndpointWarning } from "../kit/endpoint_diagnostics";

/** Jeder benutzersichtbare Text dieser Komponente. Das Kit formuliert nichts selbst —
 *  Sprache, Tonfall und Übersetzung gehören dem Consumer. */
export interface EndpointListStrings {
  addPlaceholder: string;
  apiKeyPlaceholder: string;
  modelPlaceholder: string;
  /** `aria-label` der URL-Felder bestehender Einträge. Stehen MEHRERE Listen auf demselben
   *  Settings-Tab (vault-rag: Chat und Embedding), braucht jede Liste ihren eigenen Text —
   *  ein gemeinsam genutztes `strings`-Objekt gäbe allen URL-Feldern beider Listen dasselbe
   *  Label, und ein Screenreader könnte sie nicht mehr auseinanderhalten. In der Vorlage war
   *  der Text aus `opts.label` abgeleitet; das Kit formuliert nicht, also entscheidet das
   *  der Consumer. */
  ariaUrl: string;
  /** `aria-label` des leeren Add-Felds am Listenende. Dieselbe Pflicht wie `ariaUrl`:
   *  je Liste unterschiedlich, wenn mehrere Listen auf einem Tab stehen. */
  ariaAdd: string;
  ariaApiKey(url: string): string;
  ariaModel(url: string): string;
  modelHint(key: ModelHintKey): string;
  savedSuffix: string;
  refreshModels: string;
  /** Beschriftung der Leer-Option im Modell-Dropdown einer Zeile: kein Modell gewählt, der Server wählt
   *  (`"model": ""` im Body; gemessen an LM Studio wie ein weggelassenes Feld: das geladene Modell antwortet).
   *  Optional, damit Konsumenten, die das Objekt selbst bauen, weiter übersetzen; Default „—“. */
  emptyModel?: string;
  /** Text der Kontextlänge unter der Zeile; ohne ihn (oder ohne `modelContext` in den Optionen) zeichnet die Liste nichts. */
  contextText?: (ctx: EndpointContextInfo) => string;
  moveToFront: string;
  remove: string;
  thirdParty: string;
  probing: string;
  statusTooltip(status: EndpointStatus): string;
  role(role: EndpointRole): string;
  warnings(warnings: EndpointWarning[]): string;
  presetTooltip(preset: EndpointPreset): string;
  presetLabel(preset: EndpointPreset): string;
  checkConnection: string;
  saveFailed: string;
  /** Nur mit `secret`-Hook: Zustandstext und Knöpfe des Schlüsselfelds. */
  secretSaved?: string;
  secretChange?: string;
  secretClear?: string;
  secretUnavailable?: string;
}

/** Kontextlänge des Zeilen-Modells in Token: was der Server GELADEN hat und was das Modell höchstens kann.
 *  Strukturell `ModelContext` aus code-kit — hier eigen, damit die Liste das Modul nicht mitzieht. */
export interface EndpointContextInfo { loadedContextLength?: number; maxContextLength?: number }

export interface EndpointListOptions<T extends EndpointConfig = EndpointConfig> {
  containerEl: HTMLElement;
  label: string;
  desc: string;
  placeholder: string;
  strings: EndpointListStrings;
  /** Modell-Listen je Endpunkt + Generationszähler. Gehört der Lebensdauer des
   *  Settings-Tabs, nicht dieser Funktion — deshalb von außen. */
  cache: ModelListCache;
  get(): T[];
  set(eps: T[]): void;
  active(): string | null;
  /** Client GENAU dieser Zeile (URL + Schlüssel der Zeile) — trägt sowohl die Erreichbarkeits-
   *  Probe (Status-Icon) als auch die Modell-Liste (Dropdown). EIN Client statt zwei getrennt
   *  parametrierten Konstruktionen, damit Status-Icon und Modell-Liste nie über dieselbe Zeile
   *  auseinanderlaufen können.
   *
   *  Reihenfolge der Intersection ist bedeutungstragend: `ModelListClient.probe()` liefert nur
   *  `{ reachable }`, diese Zeile den vollen `EndpointStatus` (Diagnose-Klartext fürs Icon).
   *  TypeScript löst eine Methoden-Intersection als Überladungsliste in Schreibreihenfolge auf —
   *  stünde `ModelListClient` vorn, käme am Aufruf die schmalere Signatur heraus. */
  clientFor(cfg: T): { probe(): Promise<EndpointStatus> } & ModelListClient;
  /** Nur Embedding-Listen: passt das (Override-)Modell dieser Zeile zum geladenen Index?
   *  Fehlt der Callback (Chat-Liste), gilt true — dort hängt kein Index am Modell. */
  modelFits?(cfg: T): boolean;
  /** Bietet das Modell-Dropdown einer Zeile die Leer-Option „Server wählt“ an? Default `true` (Chat-Listen: ohne Modell wählt der
   *  Server). Embedding-Listen setzen `false`: ein Index braucht ein benanntes Modell, eine Zeile ohne Modell zeigt dort nur den
   *  Platzhalter „—“ und sie verschwindet, sobald ein Modell gewählt ist. */
  allowEmptyModel?: boolean;
  /** Seit 0.67.0: bedient diese Zeile nur die Suche (der Consumer weiß es, die Rolle erfindet es nicht)? Dann trägt sie die Rolle `search-only`
   *  (code-kit 0.36.0) statt `skipped-model`: die Zeile, die die Suche bedient, soll nicht „übersprungen, Modell passt nicht“ zeigen. Vorrang
   *  `active` > `unreachable` > `search-only` > `skipped-model` > `standby`. Gefragt wird mit der Zeile, wie sie jetzt in der Liste steht. Fehlt die
   *  Option, bleibt jede Antwort die der Fassung davor. Der Text steht in `strings.role` (Kit-Fassung: `roleSearchOnly` in `llm-connection-strings`). */
  isSearchOnly?(cfg: T): boolean;
  /** Optional: Kontextlänge des Zeilen-Modells. Gerufen wird `load` **nach** der Status-Probe, nur für eine erreichbare
   *  Zeile mit gesetztem Modell; liefert er `null` oder nichts Messbares, bleibt die Zeile ohne Kontextzeile.
   *  `invalidate` läuft beim Knopf „Modelle neu laden“. Braucht `strings.contextText`. */
  modelContext?: { load(cfg: T): Promise<EndpointContextInfo | null>; invalidate?(cfg: T): void };
  save(): Promise<void>;
  reconnect(): Promise<void>;
  rerender(): void;
  presets?: readonly EndpointPreset[];
  secret?: EndpointSecretHook<T>;
  /** Zusammen mit `pluginId` der Default für `secret`: ohne eigenen Hook hängt die Liste an
   *  `localEndpointSecrets` (Obsidian-Schlüsselbund) und migriert vorhandene Klartext-Schlüssel
   *  beim ersten Render. Fehlt der Schlüsselbund (Obsidian < 1.11.4), ist das Schlüsselfeld
   *  gesperrt (`secretUnavailable`); bereits gespeicherte Klartext-Schlüssel bleiben bis zur
   *  Migration stehen und gelten weiter. Ohne beide Optionen gilt das bisherige Verhalten. */
  app?: App;
  pluginId?: string;
  /** Zusatz-Slot je echter Zeile (nicht am Adder): der Consumer zeichnet eigene Felder in
   *  `host` (ein `div.okit-ep-extra` unter der Rollenzeile). Für Einträge mit mehr Feldern als
   *  `EndpointConfig` — der Listen-Editor bleibt für URL/Schlüssel/Modell/Reihenfolge zuständig. */
  extraRow?(host: HTMLElement, cfg: T, index: number): void;
  /** Seit 0.83.0: Zeilen einzeln aktualisieren statt den Tab neu zu bauen. Vorgabe `false` (bisheriges Verhalten: Zeilen sperren, danach `rerender()`).
   *  Mit `true` passt die Liste nach einer Mutation sofort nur die betroffenen Zeilen an und ruft `rerender()` **nie** (auch nicht nach einem
   *  gescheiterten Speichern, dann zeichnet sie ihre Zeilen selbst neu): Adresse geändert → dieselbe Zeile, Eingabefelder bleiben, Probe, Rolle,
   *  Modell-Liste, Hinweise und `extraRow` werden neu gebildet; Eintrag hinzu (Adder, Vorlage) → neue Zeile vor dem Adder; Entfernen und
   *  „zuerst verwenden“ → die Zeilen ab der Änderung bekommen ihren neuen Platz, die davor (und bei „zuerst verwenden“ die dahinter) bleiben
   *  dieselben Elemente; Schlüssel setzen/entfernen → nur der Schlüsselbereich der Zeile. Es gibt keine Sperre (`okit-ep-busy`, `aria-busy`).
   *  Nach `reconnect()` werden die Rollenzeilen aller Zeilen aus den festgehaltenen Probe-Ergebnissen nachgezogen. „Verbindung prüfen“ ruft weiter
   *  `rerender()`. `extraRow` wird bei jeder Aktualisierung der Zeile erneut gerufen (der Host ist vorher leer) und bekommt den frischen Eintrag. */
  rowwise?: boolean;
}

/** Eine gezeichnete Zeile (Eintrag oder Adder), von außen nur über diese vier Griffe erreichbar. */
interface RowSlot {
  settingEl: HTMLElement;
  /** Abgeleitete Teile (Probe, Rolle, Modell-Liste, Hinweis-Icons, Kontext, Zusatzzeile) am Ort neu zeichnen; die Eingabefelder bleiben. */
  refresh(): void;
  /** Nur die Rollenzeile aus dem festgehaltenen Probe-Ergebnis neu bilden (kein Netz). */
  syncRole(): void;
  /** Zeile aushängen; spätere Antworten ihrer Anfragen werden verworfen. */
  dispose(): void;
}

/** Rückgabe von `buildEndpointList`. */
export interface EndpointListHandle {
  /** Mit `rowwise`: ohne Index alle Zeilen der Liste neu zeichnen, mit Index nur die abgeleiteten Teile dieser Zeile (Probe, Rolle, Modell-Liste)
   *  neu laden; die Eingabefelder bleiben stehen. Ohne `rowwise`: ruft `opts.rerender()`. */
  rerender(row?: number): void;
}

/** Rendert `[...endpoints, Adder]` (leeres Add-Feld), Label/Desc als eigene Zeile davor.
 *  Mutation NUR bei blur (nicht pro Tastendruck), via applyEndpointEdit → save → reconnect →
 *  Re-Render. Pro echtem Eintrag: Status-Icon (loader → check/x, aktiver Endpunkt markiert),
 *  URL-, Schlüssel- (maskiert) und Modell-Feld + Mülleimer.
 *
 *  Zwei Betriebsarten. **Vorgabe:** eine Mutation der Listen-Form sperrt die Zeilen und ruft `opts.rerender()`; das Plugin zeichnet den ganzen Tab neu.
 *  **`rowwise: true` (seit 0.83.0):** die Liste zeichnet selbst nur die betroffenen Zeilen neu und ruft `opts.rerender()` nie; Details bei der Option. */
export function buildEndpointList<T extends EndpointConfig = EndpointConfig>(opts: EndpointListOptions<T>): EndpointListHandle {
  const rowwise = opts.rowwise === true;
  // Default-Hook: Schlüsselbund für die lokale Liste, wenn der Konsument `app` + `pluginId` gibt
  // und keinen eigenen Hook. Die Migration läuft hier beim ersten Render — der Resolver migriert
  // ebenfalls (`prepareLocalEndpoints`), damit auch migriert, wer den Tab nie öffnet.
  const secret: EndpointSecretHook<T> | undefined = opts.secret
    ?? (opts.app && opts.pluginId
      ? localEndpointSecrets<T>({ app: opts.app, pluginId: opts.pluginId, getList: () => opts.get(), setList: (l) => { opts.set(l); } })
      : undefined);
  if (!opts.secret && secret?.available && opts.app && opts.pluginId) {
    const m = migrateLocalEndpoints(opts.app, opts.pluginId, opts.get());
    if (m.changed) { opts.set(m.list); void opts.save().catch(() => { /* Schlüssel liegt im Schlüsselbund; nächster Save zieht nach */ }); }
  }
  // Vorgabe-Betrieb: Jede Mutation, die die Listen-FORM ändert (URL-Edit, Mülleimer, Preset), macht die
  // gerenderten Zeilen-Indizes stale — bis der Re-Render kommt, wäre ein blur in einer anderen
  // Zeile auf den falschen Eintrag gebucht (im schlimmsten Fall ein Anbieter-Schlüssel am
  // falschen Host). Darum: Zeilen sofort sperren, das Re-Render entsperrt durch Neuaufbau.
  // Mit `rowwise` entfällt die Sperre: die Zeilen werden SYNCHRON nach `opts.set(…)` angepasst, ein Index ist nie stale.
  /** Sperr-ZUSTAND des Containers. Die Klasse sperrt auch die Icon-Buttons (Obsidian rendert sie
   *  als div, das kein `disabled` kennt), `aria-busy` sagt es Screenreadern. */
  const setLockState = (locked: boolean): void => {
    if (locked) opts.containerEl.addClass("okit-ep-busy");
    else opts.containerEl.removeClass("okit-ep-busy");
    opts.containerEl.setAttribute("aria-busy", locked ? "true" : "false");  // "false" = gültiger ARIA-Ruhezustand
  };
  const setRowsDisabled = (disabled: boolean): void => {
    opts.containerEl.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input, button, select")
      .forEach(el => { el.disabled = disabled; });
  };
  const lockRows = (): void => {
    opts.cache.bump();
    setLockState(true);
    setRowsDisabled(true);
  };
  // Idempotente Freigabe beim Betreten: Klasse und aria-busy überleben sonst den 1.13-Pfad —
  // rerender() geht dort über update(), und settingBodyHost leert zwar die Kinder des Containers, aber
  // nicht seine Klassen/Attribute. Ohne das bliebe die Liste dauerhaft pointer-events: none.
  // Nur der Zustand: die Zeilen entstehen erst darunter, es gibt hier noch nichts zu entsperren.
  setLockState(false);

  const slots: RowSlot[] = [];
  let actionsSetting: Setting | null = null;
  /** Unsichtbarer Ablageort: eine Zeile entsteht hier und wird dann VOR eine andere Zeile gehängt (ein `Setting` hängt sich sonst ans Ende). */
  let staging: HTMLElement | null = null;
  const stagingEl = (): HTMLElement => {
    if (!staging) { staging = opts.containerEl.createDiv(); staging.remove(); }
    return staging;
  };

  /** Rollenzeilen aller Zeilen nachziehen (nach `reconnect()` kann ein anderer Endpunkt der aktive sein). Kein Netzzugriff. */
  const syncAllRoles = (): void => { slots.forEach((sl) => { sl.syncRole(); }); };
  /** Gemeinsamer Schluss einer Listen-Mutation nach dem Speichern. */
  const settle = (chain: Promise<void>): void => {
    void (rowwise ? chain.then(syncAllRoles) : chain.then(() => opts.rerender())).catch(failSafe);
  };

  // Rettungsnetz: eine gescheiterte Kette (Speichern, reconnect) darf die UI nicht verriegelt
  // zurücklassen. Bewusst ohne Fehlerdetails in Log/Notice — hier hängen Anbieter-Schlüssel dran.
  const failSafe = (): void => {
    if (!rowwise) setLockState(false);
    if (!rowwise) setRowsDisabled(false);
    new Notice(opts.strings.saveFailed, 8000);
    // Re-Render statt bloßem Entsperren: bei einer gescheiterten Kette hat opts.set(...) die
    // Settings im Speicher bereits mutiert, bevor save()/reconnect() geworfen hat — ohne
    // Rebuild zeigt das DOM weiter die alte Reihenfolge/Indizes, und der nächste Klick auf
    // Mülleimer/„zuerst verwenden" träfe den falschen Eintrag.
    if (rowwise) reconcile(0);
    else opts.rerender();
  };
  // Beschriftung + Erklärung als EIGENE Zeile ohne Steuerelemente. Vorher hingen sie an der
  // ersten Endpunkt-Zeile — Obsidians `Setting` teilt die Zeile in Info (links) und Controls
  // (rechts), und mit drei Feldern rechts blieb der Text auf eine unlesbare Buchstabensäule
  // gequetscht (gemeldet 2026-08-04). Die Zeilen selbst tragen deshalb keinen Text mehr und
  // bekommen über `okit-ep-row` die volle Breite für ihre Felder.
  new Setting(opts.containerEl).setName(opts.label).setDesc(opts.desc);

  /** Zeichnet Zeile `i` (Adder, wenn `i` hinter dem letzten Eintrag liegt). `anchor`: die Zeile, vor der sie stehen soll; `null` hängt ans Ende. */
  const buildRow = (i: number, anchor: HTMLElement | null): RowSlot => {
    const list = opts.get();
    const isAdder = i >= list.length;
    const cfg: EndpointConfig = list[i] ?? { url: "" };
    // Der Eintrag dieser Zeile, frisch gelesen (Commits ersetzen die Liste). Nicht-Adder-Zeile: `cfg` stammt aus `list` (T), nur die Adder-Zeile ist kein T.
    const currentOf = (): T => opts.get()[i] ?? (cfg as T);
    const s = anchor === null ? new Setting(opts.containerEl) : new Setting(stagingEl());
    if (anchor !== null) opts.containerEl.insertBefore(s.settingEl, anchor);
    s.settingEl.addClass("okit-ep-row");
    /** Runde der abgeleiteten Teile: jedes Neuzeichnen zählt hoch, Antworten einer früheren Runde (Probe, Modell-Liste, Kontext) verfallen. */
    let epoch = 0;
    let dead = false;
    const alive = (round: number): boolean => !dead && round === epoch;
    const statusIcon = s.controlEl.createSpan({ cls: "okit-ep-status" });
    let actionsEl: HTMLElement | null = null;
    // Drittanbieter-Hinweis: in-place umschaltbar, NICHT nur einmal beim Zeilen-Render gebaut —
    // der apiKey-Commit unten baut den Tab bewusst nicht neu (siehe dort), also muss dieses Icon
    // sich selbst zeigen/verstecken können, sonst bleibt der Nutzer genau im Moment, in dem er den
    // Schlüssel einträgt, ohne Hinweis. Eine Wahrheit (`carriesApiKey`), zwei Aufrufzeitpunkte
    // (Erst-Render unten + apiKey-Commit) statt einer zweiten Bedingung.
    let thirdPartyIcon: HTMLSpanElement | null = null;
    const syncThirdPartyIcon = (hasKey: boolean): void => {
      if (hasKey) {
        if (thirdPartyIcon) return;   // schon da — nicht doppelt anlegen
        thirdPartyIcon = (actionsEl ?? s.controlEl).createSpan({ cls: "okit-ep-thirdparty" });
        setIcon(thirdPartyIcon, "alert-triangle");
        setTooltip(thirdPartyIcon, opts.strings.thirdParty);
      } else if (thirdPartyIcon) {
        thirdPartyIcon.remove();
        thirdPartyIcon = null;
      }
    };
    /** Festgehaltenes Probe-Ergebnis: die Rolle hängt auch am Modell-Override, ändert sich also ohne neue Probe. */
    let probed: EndpointStatus | null = null;
    let stateEl: HTMLElement | null = null;
    /** Schreibt die Rollen-Zeile neu, ohne den Tab neu aufzubauen. Wird beim Modell-Commit aufgerufen —
     *  das Modell-Override entscheidet über `skipped-model`, ändert die Listen-FORM aber
     *  nicht, löst also bewusst kein `rerender()` aus. Ohne diesen Rückruf behielte die
     *  Zeile ihre Aussage von vor der Modellwahl: ein Endpunkt, den der Guard längst
     *  überspringt, meldete weiter „erreichbar, aber Platz N" (gemeldet 2026-08-05). */
    const syncRole = (): void => {
      if (!probed || !stateEl) return;
      const c = currentOf();
      const isActive = normalizeEndpoint(c.url.trim()) === (opts.active() ?? "");
      const role = endpointRole({
        isActive,
        reachable: probed.reachable,
        // Gilt nur für Embedding-Endpunkte; für Chat hängt kein Index am Modell (immer true).
        modelFits: opts.modelFits?.(c) ?? true,
        position: i + 1,
        ...(opts.isSearchOnly ? { searchOnly: opts.isSearchOnly(c) } : {}),
      });
      stateEl.setText(opts.strings.role(role));
      stateEl.toggleClass("is-active", role.kind === "active");
    };
    // Listen-Mutation NUR bei blur, NICHT in onChange: onChange feuert pro Tastendruck und
    // würde im Add-Feld jeden Zwischenstand (h, ht, htt, …) als eigenen Eintrag anhängen.
    // Vorgabe-Betrieb: nur URL-Änderungen rendern neu (Statuszeile hängt an der URL). Schlüssel/Modell tun das
    // NICHT: rerender baut den Tab komplett neu auf, und da reconnect() jeden Endpunkt pingt
    // (bis 5 s), risse es dem Nutzer sonst mitten im Tippen des nächsten Feldes das DOM weg.
    const commit = (field: "url" | "apiKey" | "model", value: string): void => {
      const before = opts.get();
      const updated = applyEndpointEdit(before, i, field, value, isAdder) as T[];
      if (JSON.stringify(updated) === JSON.stringify(before)) return;   // unverändert → kein Re-Render
      const urlEdit = field === "url";
      // Zeilenweise: dieselbe Zeile bleibt (nur ihre URL-abhängigen Teile werden neu gebaut), solange die Zahl der Einträge gleich bleibt.
      const shapeChange = urlEdit && (isAdder || updated.length !== before.length);
      if (urlEdit && !rowwise) lockRows();
      // apiKey ändert die Listen-FORM nicht (kein Re-Render) — das Drittanbieter-Icon muss sich
      // deshalb hier selbst aktualisieren, statt auf den (bewusst ausbleibenden) Neuaufbau zu warten.
      if (field === "apiKey") {
        const edited = updated[i];
        if (edited) syncThirdPartyIcon(carriesApiKey(edited));
        // Ohne Schlüssel lieferte der Endpunkt vermutlich 401 → leere Liste → Notausgang.
        // Mit Schlüssel hat er eine Liste; der alte Eintrag wäre eine Lüge. Anders als das
        // Drittanbieter-Icon oben korrigiert sich die Modell-Zeile dadurch NICHT selbst —
        // sichtbar wird die neue Liste erst beim nächsten Zeilen-Neuaufbau (URL-Commit,
        // „Modelle abrufen", Tab-Reload), da dieser Commit bewusst kein rerender() auslöst.
        if (edited) opts.cache.invalidate(normalizeEndpoint(edited.url));
      }
      // Ein URL-Commit setzt oder entfernt den Bezug zu (mindestens) einer URL — die alte UND
      // die neue, denn beide koennen bereits eine (moeglicherweise laengst veraltete) Liste im
      // Cache tragen: die alte, weil ihr Eintrag jetzt verwaist; die neue, weil genau diese URL
      // schon einmal (unter einem anderen Eintrag) geladen wurde, z. B. nach Loeschen +
      // Neuanlage derselben Adresse (gemeldet von image-to-markdown, 2026-09-12). Ohne beide
      // Invalidierungen zeigt das Dropdown die Liste von VOR der Mutation weiter an.
      if (urlEdit) {
        const oldUrl = before[i]?.url;
        if (oldUrl) opts.cache.invalidate(normalizeEndpoint(oldUrl));
        const newUrl = value.trim();
        if (newUrl) opts.cache.invalidate(normalizeEndpoint(newUrl));
      }
      if (urlEdit && !isAdder && updated.length < before.length && before[i]) secret?.release?.(before[i]);
      opts.set(updated);
      if (rowwise) {
        // Sofort, vor dem Speichern: das DOM entspricht der Liste, kein Index ist stale. Die Sperre braucht es deshalb nicht.
        if (shapeChange) reconcile(i);
        else if (urlEdit) refresh();
      }
      const chain = opts.save().then(() => opts.reconnect());
      if (rowwise) { settle(chain); return; }
      // Das Modell-Override entscheidet mit über die Rolle der Zeile (`skipped-model`).
      // Erst NACH reconnect() nachziehen: der Resolver kann den Endpunkt wegen des neuen
      // Modells gerade fallengelassen oder übernommen haben, und die Zeile soll den
      // Zustand danach zeigen, nicht den davor.
      const withRoleSync = field === "model" ? chain.then(() => { syncRole(); }) : chain;
      void (urlEdit ? withRoleSync.then(() => opts.rerender()) : withRoleSync).catch(failSafe);
    };
    s.addText(tx => {
      tx.setPlaceholder(isAdder ? opts.strings.addPlaceholder : opts.placeholder).setValue(cfg.url);
      tx.inputEl.setAttribute("aria-label", isAdder ? opts.strings.ariaAdd : opts.strings.ariaUrl);
      tx.inputEl.addEventListener("blur", () => { commit("url", tx.getValue()); });
    });
    // Schlüssel + Modell nur an bestehenden Einträgen — am leeren Adder gäbe es nichts zu tragen.
    // aria-label statt bloßem Placeholder: der verschwindet beim Tippen, und drei unbeschriftete
    // Felder in einer Zeile sind für Screenreader nicht auseinanderzuhalten.
    /** Beschriftungen der Schlüsselfelder, die an der Adresse hängen; `refresh()` zieht sie nach einer URL-Änderung nach. */
    let keyAria: (() => void) | null = null;
    /** Die Elemente des Schlüsselbereichs (Hook-Betrieb), damit er an seinem Platz neu gezeichnet werden kann. */
    let secretEls: HTMLElement[] = [];
    let tailEl: HTMLElement | null = null;
    let drawSecret: ((t: Setting, editing: boolean) => void) | null = null;
    /** Schlüsselbereich neu zeichnen (nach Setzen/Entfernen/„ändern“), an der Stelle des alten: zwischen URL-Feld und Tail. */
    const rebuildSecret = (editing: boolean): void => {
      if (!drawSecret || !tailEl) return;
      secretEls.forEach((el) => { el.remove(); });
      const t = new Setting(stagingEl());
      drawSecret(t, editing);
      const made = Array.from(t.controlEl.children) as HTMLElement[];
      made.forEach((el) => { s.controlEl.insertBefore(el, tailEl); });
      s.components.push(...t.components);
      t.settingEl.remove();
      secretEls = made;
    };
    if (!isAdder && secret) {
      const hook = secret;
      const st = opts.strings;
      const afterSecret = (): void => {
        if (rowwise) {
          rebuildSecret(false);
          syncThirdPartyIcon(hook.has(currentOf(), i));
          settle(opts.save().then(() => opts.reconnect()));
          return;
        }
        lockRows();
        void opts.save().then(() => opts.reconnect()).then(() => opts.rerender()).catch(failSafe);
      };
      const ariaWatchers: Array<() => void> = [];
      keyAria = () => { ariaWatchers.forEach((f) => { f(); }); };
      drawSecret = (t, editing) => {
        ariaWatchers.length = 0;
        const secretInput = (): void => {
          t.addText(tx => {
            tx.setPlaceholder(st.apiKeyPlaceholder).setValue("");
            tx.inputEl.type = "password";
            tx.inputEl.setAttribute("autocomplete", "off");
            if (!hook.available) {
              tx.inputEl.disabled = true;
              const label = (): void => { tx.inputEl.setAttribute("aria-label", `${st.ariaApiKey(currentOf().url)} — ${st.secretUnavailable ?? ""}`); };
              label(); ariaWatchers.push(label);
              setTooltip(tx.inputEl, st.secretUnavailable ?? "");
              return;
            }
            const label = (): void => { tx.inputEl.setAttribute("aria-label", st.ariaApiKey(currentOf().url)); };
            label(); ariaWatchers.push(label);
            tx.inputEl.addEventListener("blur", () => {
              const v = tx.getValue();
              if (!v) return;
              // Cache-Eintrag der URL invalidieren: mit Token antwortet ein gehosteter Endpunkt anders.
              opts.cache.invalidate(normalizeEndpoint(currentOf().url));
              void hook.set(currentOf(), i, v).then(afterSecret).catch(failSafe);
            });
          });
        };
        if (!editing && hook.has(currentOf(), i)) {
          const saved = t.controlEl.createSpan({ cls: "okit-ep-secret", text: st.secretSaved ?? "" });
          const label = (): void => { saved.setAttribute("aria-label", st.ariaApiKey(currentOf().url)); };
          label(); ariaWatchers.push(label);
          // Beide Knöpfe gehören zusammen: „ändern" zeichnet ein leeres Eingabefeld an ihrer Stelle —
          // bleibt „entfernen" dabei stehen, wirkt er weiter auf den ALTEN, noch gespeicherten
          // Schlüssel, während der Nutzer gerade einen neuen einträgt (gemeldet im Review).
          t.addExtraButton(b => b.setIcon("pencil").setTooltip(st.secretChange ?? "").onClick(() => { rebuildSecret(true); }));
          t.addExtraButton(b => b.setIcon("key-round").setTooltip(st.secretClear ?? "").onClick(() => {
            opts.cache.invalidate(normalizeEndpoint(currentOf().url));
            void hook.clear(currentOf(), i).then(afterSecret).catch(failSafe);
          }));
        } else {
          secretInput();
        }
      };
      // Erstzeichnung gleich in die Zeile: die Elemente, die der Aufruf anhängt, sind der Schlüsselbereich.
      const start = s.controlEl.children.length;
      drawSecret(s, false);
      secretEls = (Array.from(s.controlEl.children) as HTMLElement[]).slice(start);
    } else if (!isAdder) {
      s.addText(tx => {   // bisheriges Passwortfeld, unverändert
        tx.setPlaceholder(opts.strings.apiKeyPlaceholder).setValue(cfg.apiKey ?? "");
        tx.inputEl.type = "password";                    // maskiert gegen Schultergucken/Screenshots
        tx.inputEl.setAttribute("autocomplete", "off");
        const label = (): void => { tx.inputEl.setAttribute("aria-label", opts.strings.ariaApiKey(currentOf().url)); };
        label(); keyAria = label;
        tx.inputEl.addEventListener("blur", () => { commit("apiKey", tx.getValue()); });
      });
    }
    // Modell-Platz und Aktionen sitzen in EINEM Block (`okit-ep-tail`): bricht die Zeile um, wandert er
    // als Ganzes in Zeile zwei, statt dass ein einzelner Knopf (bei Platz 1 nur der Papierkorb) allein steht.
    let modelSlot: HTMLElement | null = null;
    /** Modell-Liste dieser Zeile laden und das Dropdown in den reservierten Platz zeichnen. */
    const loadModels = (round: number): void => {
      if (!modelSlot) return;
      const slotEl = modelSlot;
      const now = currentOf();
      const listKey = normalizeEndpoint(now.url);
      const gen = opts.cache.generation();
      void opts.cache.load(listKey, opts.clientFor(now)).then(({ models, reachable }) => {
        if (gen !== opts.cache.generation() || !alive(round)) return;   // Liste hat sich verschoben oder die Zeile wurde neu gezeichnet
        // Das Zeilen-Modell ist die einzige Wahrheit (kein globales Modell-Feld seit 0.55.0). Die Leer-Option
        // bleibt trotzdem: sie heißt nicht „nimm das globale“, sondern „der Server wählt“ — sonst ließe sich ein
        // gewähltes Zeilen-Modell in der Oberfläche nicht mehr zurücknehmen.
        const row = currentOf();
        const resolved = resolveModelChoice({ reachable, models, current: row.model ?? "", allowEmpty: opts.allowEmptyModel ?? true });
        const emptyLabel = opts.strings.emptyModel ?? "—";
        const choice = { ...resolved, options: resolved.options.map((o) => (o.value === "" && o.label === "" ? { ...o, label: emptyLabel } : o)) };
        slotEl.empty();
        renderModelPicker({
          setting: s,
          target: slotEl,
          choice,
          ariaLabel: opts.strings.ariaModel(row.url),
          placeholder: opts.strings.modelPlaceholder,
          hint: opts.strings.modelHint(choice.hintKey),
          hintAs: "tooltip",
          savedSuffix: opts.strings.savedSuffix,
          refreshTooltip: opts.strings.refreshModels,
          onPick: (v: string) => { commit("model", v); },
          onRefresh: () => {
            opts.cache.invalidate(listKey); opts.modelContext?.invalidate?.(currentOf());
            if (rowwise) refresh(); else opts.rerender();
          },
        });
      });
    };
    if (!isAdder) {
      // Modell-Override: Dropdown mit den Modellen GENAU DIESES Endpunkts. Die Liste kommt
      // aus dem Cache, nicht vom aktiven Client — eine Zeile kann einen ganz anderen
      // Anbieter meinen als den gerade verbundenen.
      // Platz SYNCHRON reservieren: der Picker zeichnet erst nach dem geladenen Promise, der
      // Mülleimer/das Warn-Icon gleich darunter aber synchron. Ohne Reservierung hängt Obsidian
      // (das jede add*-Komponente in Aufrufreihenfolge an controlEl anhängt) das Dropdown ans
      // Ende der Zeile — hinter den Mülleimer, ein Layout-Sprung inklusive. `renderModelPicker`
      // zeichnet über `target` deshalb direkt in dieses Element statt in `s.controlEl`.
      tailEl = s.controlEl.createDiv({ cls: "okit-ep-tail" });
      modelSlot = tailEl.createSpan({ cls: "okit-model-slot" });
      loadModels(++epoch);
    }
    // „Zuerst verwenden“ und Löschen sitzen in EINEM Container (`okit-ep-actions`): ein Flex-Wrap
    // bricht einzelne Kinder um, den Container nur als Ganzes — sonst steht der Mülleimer allein
    // in Zeile zwei, sobald die Felder die Breite füllen (gemessen 2026-09-27, 900 px, vault-rag
    // und vault-crews). `addExtraButton` hängt ans Ende von controlEl, der Knopf wird umgehängt.
    actionsEl = tailEl === null ? null : tailEl.createDiv({ cls: "okit-ep-actions" });
    const addAction = (build: Parameters<Setting["addExtraButton"]>[0]): void => {
      s.addExtraButton(b => { actionsEl?.appendChild(b.extraSettingsEl); build(b); });
    };
    // „Zuerst verwenden": setzt die Zeile an die Spitze der Prioritätsliste. An Platz 1
    // bewusst GAR NICHT gezeichnet statt deaktiviert — ein setDisabled-Element trägt seinen
    // Tooltip in Electron unsichtbar (Befund aus dem Modell-Picker-Review 2026-08-05), der
    // Knopf wäre dort also stumm UND wirkungslos.
    if (!isAdder && i > 0) {
      addAction(b => b
        .setIcon("arrow-up-to-line")
        .setTooltip(opts.strings.moveToFront)
        .onClick(() => {
          if (!rowwise) lockRows();
          opts.set(moveEndpointToFront(opts.get(), i) as T[]);
          if (rowwise) reconcile(0, i);   // nur die Zeilen bis zur verschobenen: die dahinter behalten Platz und Element
          settle(opts.save().then(() => opts.reconnect()));
        }));
    }
    // Löschen: expliziter Mülleimer-Button (nicht am leeren Add-Feld). Das Status-Icon links
    // ist nur Erreichbarkeits-Anzeige, kein Lösch-Button.
    if (!isAdder) {
      addAction(b => b
        .setIcon("trash-2")
        .setTooltip(opts.strings.remove)
        .onClick(() => {
          if (!rowwise) lockRows();
          // Geht an commit() vorbei (kein blur-Feld) — die Invalidierung muss deshalb hier
          // selbst passieren, sonst ueberlebt die Modell-Liste dieser URL ihren Eintrag.
          opts.cache.invalidate(normalizeEndpoint(currentOf().url));
          const removed = opts.get()[i];
          if (removed) secret?.release?.(removed);
          opts.set(applyEndpointEdit(opts.get(), i, "url", "", false) as T[]);
          if (rowwise) reconcile(i);
          settle(opts.save().then(() => opts.reconnect()));
        }));
    }
    let warnIcon: HTMLElement | null = null;
    let contextEl: HTMLElement | null = null;
    let extraHost: HTMLElement | null = null;
    /** Alles, was von Adresse und Probe abhängt: Status, Rolle, Warn- und Drittanbieter-Hinweis, Kontextlänge. Beim Erstzeichnen und bei `refresh()`. */
    const drawDerived = (round: number): void => {
      if (isAdder) return;
      const ep = currentOf().url.trim();
      // Reste einer früheren Runde weg (beim Erstzeichnen ist nichts da).
      statusIcon.empty(); statusIcon.removeClass("is-ok"); statusIcon.removeClass("is-error");
      warnIcon?.remove(); warnIcon = null;
      contextEl?.remove(); contextEl = null;
      thirdPartyIcon?.remove(); thirdPartyIcon = null;
      probed = null;
      stateEl?.remove(); stateEl = null;
      if (ep) {
        // Pro-Feld-Status in A11y-Form (Form + Text + Farbe): loader → check/x, aktiver markiert.
        setIcon(statusIcon, "loader"); setTooltip(statusIcon, opts.strings.probing);
        // Rolle der Zeile als eigene Zeile UNTER den Feldern (flex-basis 100% im umbrechenden
        // Control-Container): horizontal ist die Zeile mit drei Feldern + bis zu drei Icons +
        // zwei Knöpfen ausgereizt (Layout-Fix 2026-08-04). Synchron angelegt, asynchron befüllt.
        stateEl = s.controlEl.createDiv({ cls: "okit-ep-state", text: opts.strings.probing });
        void opts.clientFor(currentOf()).probe().then(status => {
          if (!alive(round)) return;
          statusIcon.empty();
          setIcon(statusIcon, status.reachable ? "circle-check" : "circle-x");
          statusIcon.toggleClass("is-ok", status.reachable);
          statusIcon.toggleClass("is-error", !status.reachable);
          // Tooltip trägt nur noch die Erreichbarkeits-Diagnose; das frühere " · aktiv" entfällt,
          // weil die Rolle jetzt als Text in der Zeile steht (keine zweite Wahrheit im Hover).
          setTooltip(statusIcon, opts.strings.statusTooltip(status));
          probed = status;
          syncRole();
          // Kontextlänge: nur für eine erreichbare Zeile mit Modell, erst nach der Probe (ein toter Endpunkt wird
          // sonst ein zweites Mal angefragt), und nur, wenn der Server überhaupt eine Zahl nennt.
          const rowNow = currentOf();
          const contextText = opts.strings.contextText;
          if (opts.modelContext && contextText && status.reachable && (rowNow.model ?? "").trim() !== "") {
            void opts.modelContext.load(rowNow).then((ctx) => {
              if (!alive(round)) return;
              if (!ctx || (ctx.loadedContextLength === undefined && ctx.maxContextLength === undefined)) return;
              contextEl?.remove();
              contextEl = s.controlEl.createDiv({ cls: "okit-ep-context", text: contextText(ctx) });
            }).catch(() => { /* nur Hinweis, nie ein Fehler in den Einstellungen */ });
          }
        });
        // Eingabe-Prüfung: nicht-blockierendes Warn-Icon (WCAG-Form + Tooltip)
        const warnings = validateEndpointInput(ep);
        if (warnings.length) {
          warnIcon = (actionsEl ?? s.controlEl).createSpan({ cls: "okit-ep-warn" });
          setIcon(warnIcon, "alert-triangle");
          setTooltip(warnIcon, opts.strings.warnings(warnings));
        }
        // Drittanbieter-Hinweis (Erst-Render): der Schlüssel ist der verlässliche Indikator, nicht
        // die URL (ein eigener Server im LAN braucht keinen — eine URL-Heuristik wäre unzuverlässig).
        // Sachlicher Hinweis, keine Warnung vor einem Fehler — Form/Icon + Text, nie Farbe allein
        // (WCAG 1.4.1); NIE den Schlüssel selbst im Text/Tooltip. syncThirdPartyIcon() hält das
        // danach auch beim apiKey-Commit aktuell (siehe dort), ohne den Tab neu zu bauen.
        syncThirdPartyIcon(secret ? secret.has(currentOf(), i) : carriesApiKey(currentOf()));
      }
    };
    const drawExtra = (): void => {
      if (isAdder || !opts.extraRow) return;
      extraHost ??= s.controlEl.createDiv({ cls: "okit-ep-extra" });
      extraHost.empty();
      opts.extraRow(extraHost, currentOf(), i);
    };
    drawDerived(epoch);
    drawExtra();
    /** Abgeleitete Teile am Ort neu zeichnen (Adresse geändert, „Modelle neu laden“, `handle.rerender(i)`); Eingabefelder bleiben stehen. */
    const refresh = (): void => {
      if (isAdder || dead) return;
      const round = ++epoch;
      keyAria?.();
      loadModels(round);
      drawDerived(round);
      drawExtra();
    };
    return {
      settingEl: s.settingEl,
      refresh,
      syncRole,
      dispose: () => { dead = true; epoch++; s.settingEl.remove(); },
    };
  };

  /** Zeilen ab `from` an die Liste im Speicher angleichen. Ohne `through` (oder bei geänderter Zeilenzahl, weil dann alle Indizes dahinter rücken)
   *  bis zum Ende; mit `through` nur `from…through`, die Zeilen dahinter behalten Element und Platz. */
  const reconcile = (from: number, through?: number): void => {
    const total = opts.get().length + 1;   // Einträge plus Adder
    const bounded = through !== undefined && total === slots.length;
    const lastNew = bounded ? Math.min(through, total - 1) : total - 1;
    const lastOld = bounded ? lastNew : slots.length - 1;
    for (let k = from; k <= lastOld; k++) slots[k]?.dispose();
    const next = bounded ? slots[lastNew + 1] : undefined;
    const anchor = next ? next.settingEl : (actionsSetting ? actionsSetting.settingEl : null);
    const fresh: RowSlot[] = [];
    for (let k = from; k <= lastNew; k++) fresh.push(buildRow(k, anchor));
    slots.splice(from, lastOld - from + 1, ...fresh);
  };

  const count = opts.get().length + 1;   // leeres Zusatzfeld am Ende
  for (let i = 0; i < count; i++) slots.push(buildRow(i, null));
  actionsSetting = new Setting(opts.containerEl);
  (opts.presets ?? ENDPOINT_PRESETS).forEach(preset => {
    actionsSetting?.addButton(b => b
      .setButtonText(opts.strings.presetLabel(preset))
      .setTooltip(opts.strings.presetTooltip(preset))
      .onClick(() => {
        const cur = opts.get();
        if (cur.some(c => c.url === preset.url)) return;   // schon in der Liste — kein Duplikat anhängen
        if (!rowwise) lockRows();
        // Geht an commit() vorbei — dieselbe URL kann von einem zuvor geloeschten Eintrag noch
        // eine (veraltete) Liste im Cache tragen.
        opts.cache.invalidate(normalizeEndpoint(preset.url));
        opts.set(applyEndpointEdit(cur, cur.length, "url", preset.url, true) as T[]);
        if (rowwise) reconcile(cur.length);
        settle(opts.save().then(() => opts.reconnect()));
      }));
  });
  actionsSetting.addButton(b => b.setButtonText(opts.strings.checkConnection).onClick(() => opts.rerender()));
  return {
    rerender: (row?: number): void => {
      if (!rowwise) { opts.rerender(); return; }
      if (row === undefined) reconcile(0);
      else slots[row]?.refresh();
    },
  };
}

/** Regeln der Endpunkt-Zeile. Consumer hängen sie in ihre styles.css (kein CSS-Import im
 *  Plugin-Bundle) — dasselbe Muster wie COLLAPSIBLE_CSS. */
export const ENDPOINT_LIST_CSS = `
/* Pro-Zeile-Status der Endpunkt-Fallback-Liste: Form trägt die Bedeutung, Farbe sekundär (WCAG 1.4.1). */
.okit-ep-status { display: inline-flex; align-items: center; margin-right: 8px; vertical-align: middle; color: var(--text-muted); }
.okit-ep-status svg { width: 14px; height: 14px; }
.okit-ep-status.is-ok { color: var(--text-success); }
.okit-ep-status.is-error { color: var(--text-error); }
.okit-ep-warn { display: inline-flex; align-items: center; margin-right: 8px; vertical-align: middle; color: var(--text-warning); }
.okit-ep-warn svg { width: 14px; height: 14px; }
/* Drittanbieter-Hinweis (Schlüssel gesetzt): sachlicher Hinweis, keine Fehler-Warnung — bewusst
   gedämpfter als .okit-ep-warn, Bedeutung trägt das Dreieck + der Tooltip, nicht die Farbe. */
.okit-ep-thirdparty { display: inline-flex; align-items: center; margin-right: 8px; vertical-align: middle; color: var(--text-muted); }
.okit-ep-thirdparty svg { width: 14px; height: 14px; }
.okit-ep-secret { color: var(--text-muted); font-size: var(--font-ui-small); margin-right: 8px; }
.okit-ep-extra { flex: 0 0 100%; order: 2; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 4px; }
/* Rolle der Zeile als Text unter den Feldern: „aktiv" / „erreichbar, aber Platz N" / … .
   Erreichbarkeit trägt das Icon (Form), die Rolle dieser Text — keins von beiden über Farbe
   allein (WCAG 1.4.1). Die frühere Auszeichnung saß auf dem Icon-Container und war wirkungslos:
   font-weight greift auf einem SVG nicht.
   flex-basis: 100% erzwingt den Umbruch im ohnehin umbrechenden .setting-item-control.
   stateEl wird VOR warnIcon/thirdPartyIcon angelegt (Erst-Render-Reihenfolge in
   buildEndpointList) — ohne order würden die beiden Icons hinter die volle-Breite-Zeile
   rutschen statt in der Feldreihe zu bleiben. order:1 hält die Rolle visuell zuletzt,
   unabhängig davon, was später noch an controlEl angehängt wird. */
.okit-ep-row > .setting-item-control .okit-ep-state {
  flex: 0 0 100%;
  order: 1;
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
  margin-top: 2px;
}
/* Kontextlänge des Zeilen-Modells: eigene Zeile unter der Rolle, nur wenn der Server die Zahl nennt. */
.okit-ep-row > .setting-item-control .okit-ep-context {
  flex: 0 0 100%;
  order: 2;
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
}
.okit-ep-row > .setting-item-control .okit-ep-state.is-active {
  color: var(--text-normal);
  font-weight: var(--font-bold);
}
/* Speicher-/Lösch-Fenster: die gerenderten Zeilen-Indizes sind stale, bis der Re-Render kommt —
   Eingaben und Icon-Buttons (divs, kein disabled) sind solange gesperrt. */
.okit-ep-busy { pointer-events: none; opacity: 0.6; }
/* Endpunkt-Zeile: drei Felder (Adresse · Schlüssel · Modell) brauchen die volle Breite.
   Die Beschriftung steht als eigene Zeile darüber, deshalb ist der Info-Block hier leer und
   darf keinen Platz beanspruchen — sonst quetscht er die Felder (gemeldet 2026-08-04).
   Kindselektor (>), kein Nachkomme: der extraRow-Host sitzt in controlEl, und ein Setting
   darin verlor sonst seine Beschriftung (gemessen 2026-09-25, llm-endpoint-manager). */
.okit-ep-row > .setting-item-info {
  display: none;
}
.okit-ep-row > .setting-item-control {
  flex-wrap: wrap;
  justify-content: flex-start;
  gap: var(--size-4-2);
  width: 100%;
}
.okit-ep-row > .setting-item-control input[type="text"],
.okit-ep-row > .setting-item-control input[type="password"] {
  flex: 1 1 12em;
  min-width: 8em;
}
.okit-ep-row > .setting-item-control input[type="password"] {
  flex-basis: 6em;
  min-width: 5em;
}
/* Modell-Platz, Aktionsknöpfe (nach oben, Papierkorb) und Hinweis-Icons sitzen in einem Block
   (okit-ep-tail, darin okit-ep-actions): die Felder dürfen umbrechen, der Block bleibt zusammen
   und steht beim Umbruch rechtsbündig in Zeile zwei, auch wenn nur der Papierkorb da ist.
   Adresse und Modell-ID sind die Hauptinformation der Zeile: eine abgeschnittene Adresse oder ID
   liest sich wie ein anderer Port oder ein anderes Modell. Deshalb behält die Adresse 12em und
   der Modell-Platz mindestens 12em (Basis 14em, reicht für eine typische ID wie
   qwen/qwen3.8-27b); zuerst gibt das Schlüsselfeld nach (Basis 6em, leer zeigt es nur einen
   Platzhalter). Eine längere ID endet mit einer Ellipse, die Auswahlliste zeigt sie voll. */
.okit-ep-row > .setting-item-control > .okit-ep-tail {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  flex: 1 1 auto;
  min-width: 0;
  justify-content: flex-end;
}
.okit-ep-row > .setting-item-control > .okit-ep-tail > .okit-ep-actions {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  flex: 0 0 auto;
}
.okit-ep-row > .setting-item-control > .okit-ep-tail > .okit-ep-actions > .clickable-icon,
.okit-ep-row > .setting-item-control > .okit-ep-tail > .okit-ep-actions > .okit-ep-warn,
.okit-ep-row > .setting-item-control > .okit-ep-tail > .okit-ep-actions > .okit-ep-thirdparty {
  flex: 0 0 auto;
  margin-right: 0;
}
/* Reservierter Platz für das Modell-Dropdown (Auffüllen der Zeile erst nach dem geladenen
   Promise, siehe buildEndpointList). Selbst ein Flex-Container, damit Dropdown/Freitext + der
   „Modelle abrufen"-Knopf innerhalb genauso mitwachsen wie URL/Schlüssel daneben. */
.okit-ep-row > .setting-item-control .okit-model-slot {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  flex: 1 1 14em;
  min-width: 12em;
}
.okit-ep-row > .setting-item-control .okit-model-slot select,
.okit-ep-row > .setting-item-control .okit-model-slot input[type="text"] {
  flex: 1 1 auto;
  min-width: 0;
  text-overflow: ellipsis;
}
`;
