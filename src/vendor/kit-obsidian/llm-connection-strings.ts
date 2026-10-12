// vendored from obsidian-kit@0.59.0, src/obsidian/llm-connection-strings.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Default-Texte (EN/DE) für `LlmConnection.renderSettings` — nach dem Muster von
 *  `HELP_SETTING_TEXTS_EN/DE`. Ohne sie formulierte jeder Konsument rund 60 Texte selbst, obwohl
 *  „Reset“ oder „Open manager settings“ je Plugin nichts anderes heißen soll.
 *
 *  Herkunft: lingotuner `src/i18n/strings.ts` (Schlüssel `src.*`, `ep.*`, `request.*`, `set.*`) und
 *  `src/obsidian/settings-tab.ts` — die reichste Fassung (UI-STANDARD § 10). Nicht in lingotuner und
 *  deshalb aus settings-assistant `src/i18n/strings.ts` gelesen: die vier Schlüsselbund-Texte
 *  (`ep.secret*`). Eigene Formulierung, in keinem Konsumenten belegt: die Überschrift des Modus
 *  `complete` (lingotuner kennt ihn nicht). Die Plugin-Namen aus den Quellen sind entfernt; der
 *  Name „LLM Endpoint Manager“ ist der Produktname des Nachbarplugins, kein Plugin-Name des Konsumenten.
 *
 *  Bewusst nicht im Bündel: der Hinweis zum Apple-Kurzbefehl (`src.appleHint`) und `src.modelManaged`
 *  hängen an Plugin-Eigenheiten und bleiben beim Konsumenten. Familie und Backend in der Kopfzeile des
 *  Anfrage-Abschnitts tragen die Labels der Kit-Tabellen (`FAMILIES`/`BACKENDS`).
 *
 *  Seit 0.50.0 trägt das Bündel auch den Notice-Text einer Abweichung (`deviationNotice`), den
 *  `createLlmConnection` als Default nimmt. Er stand bis dahin in elf Plugins als Kopie
 *  (`deviationNotice` in `request-text.ts`, Herkunft lingotuner), die Satzteile lagen hier schon.
 *
 *  Seit 0.52.0: `noEndpoint` (Text für das lokale `kind: "no-endpoint"`, Herkunft koda-agent
 *  `src/i18n/strings.ts` `error.noEndpoint`, die reichste Fassung), die reicheren Statustexte
 *  `timeout`/`not-an-llm-api` aus vault-rag (`endpointStatus.*`), `unknown` ohne Strich, wenn kein
 *  Rohtext da ist, und das optionale Listen-Label `listAriaLabel` für `ariaUrl`/`ariaAdd`.
 *  Die heutigen Kit-Texte lagen daneben; übernommen wurde nur, was reicher ist (UI-STANDARD § 10).
 *
 *  Überschreiben: `renderSettings(el, { lang: "de", request: { title: "…" } })` — ein Teil-Merge
 *  über dem Default, je Abschnitt ein Feld genau. */
import { BACKENDS, FAMILIES, type FamilyId, type BackendId, type Deviation } from "../kit/sampling-profiles";
import type { EndpointSourceSectionStrings } from "./endpoint-source";
import type { EndpointListStrings } from "./endpoint-list";
import type { RequestSectionStrings } from "./request-section";
import { endpointStatusText, endpointWarningText } from "./endpoint-status-text";

/** Das volle Text-Bündel von `LlmConnection.renderSettings` (liegt hier, damit dieses Modul nicht von
 *  `llm-connection` abhängt; `llm-connection` exportiert den Typ weiter). */
export interface LlmConnectionStrings {
  endpointSource: EndpointSourceSectionStrings;
  endpointList: EndpointListStrings;
  listLabel: string;
  listDesc: string;
  listPlaceholder: string;
  /** Notice-Text einer Abweichung, die das Ergebnis ändert (Satz plus Verweis auf den Abschnitt). */
  deviationNotice: (d: Deviation) => string;
  /** Hinweiszeile unter einer Vorschau des GESENDETEN Textes: „N Stellen geschwärzt“ (`redactions`). */
  redactedNote: (n: number) => string;
  /** Hinweis in den Einstellungen mit `managerOnly`, wenn der Manager fehlt. */
  noManager: string;
  /** Text für ein lokales `kind: "no-endpoint"`. Optional, damit ein volles Bündel ohne dieses Feld
   *  weiter übersetzt; das Default-Bündel trägt es immer. */
  noEndpoint?: string;
  /** `endpointSource.managedDesc` für `managerOnly`, ohne den Satz über die lokale Liste. */
  managedDescManagerOnly: string;
  request: RequestSectionStrings;
}

/** `{0}`, `{1}` … ersetzen. */
const fmt = (tpl: string, ...args: string[]): string => tpl.replace(/\{(\d+)\}/g, (_, i: string) => args[Number(i)] ?? "");

/** Die Texte einer Sprache als flache Tabelle; `build` macht daraus das Bündel. Beide Sprachen
 *  tragen dieselbe Schlüsselmenge — der Typ erzwingt es. */
interface Texts {
  listLabel: string; listDesc: string; listPlaceholder: string;
  // Endpunkt-Quelle (Manager da)
  managed: string; managedDesc: string; openManager: string; pickEndpoint: string; automatic: string; model: string;
  importLocal: string; imported: string; importFailed: string;
  // gemeinsam (Quelle und Liste)
  hintUnreachable: string; hintNoList: string; saved: string; refreshModels: string; saveFailed: string;
  emptyModel: string;
  contextLoaded: string; contextMax: string; contextLoadedOnly: string;
  // Endpunkt-Liste
  addPlaceholder: string; apiKeyPlaceholder: string; modelPlaceholder: string; ariaUrl: string; ariaAdd: string;
  ariaApiKey: string; ariaModel: string;
  moveToFront: string; remove: string; thirdParty: string; probing: string;
  roleActive: string; roleStandby: string; roleUnreachable: string; roleSkippedModel: string;
  preset: string; checkConnection: string;
  secretSaved: string; secretChange: string; secretClear: string; secretUnavailable: string;
  // Anfrage-Abschnitt
  requestTitle: string; requestFamily: string; requestFamilyNone: string; requestBackend: string; requestBackendNone: string; familyManager: string; familyName: string; familyNone: string;
  backendManager: string; backendProbe: string; backendNone: string; unknownFamily: string; jitWarning: string; sentAs: string;
  modes: Record<"agent" | "structured" | "transform" | "grounded" | "companion" | "creative" | "complete", string>;
  fields: Record<"temperature" | "top_p" | "top_k" | "min_p" | "presence_penalty" | "reasoning_effort" | "max_tokens", string>;
  states: Record<"sent-effective" | "sent-unproven" | "not-sent-ignored" | "not-sent-unsupported" | "not-sent-unknown-family" | "not-sent-no-value", string>;
  notes: Record<"raised-to-reserve" | "raised-to-thinking-floor" | "below-thinking-floor" | "off-not-possible", string>;
  topPHint: string;
  reset: string; thinkingLevel: string; levels: Record<"off" | "low" | "medium" | "high", string>;
  levelPicker: string; levelPickerDesc: string; requestSaveFailed: string; dormant: string; deleteDormant: string;
  lastRequest: string; lastRequestNone: string; copy: string; copied: string; deviationsOk: string; deviationsWarn: string;
  deviations: Record<"thinking-despite-off" | "empty-by-budget" | "family-mismatch" | "family-detected" | "rejected", string>;
  /** Zweiter Satz der Abweichungs-Notice; `{0}` = Titel des Abschnitts „Anfrage“. */
  seeSettings: string;
  /** Hinweiszeile unter einer Vorschau des gesendeten Textes; `{0}` = Zahl der geschwärzten Werte. */
  redactedOne: string; redactedMany: string;
  /** Hinweis in den Einstellungen eines Manager-only-Plugins, wenn der Manager fehlt. */
  noManager: string;
  /** Text für ein lokales `kind: "no-endpoint"` (kein Endpunkt erreichbar). */
  noEndpoint: string;
  /** `managedDesc` für `managerOnly`: ohne den Satz über die lokale Liste. */
  managedDescManagerOnly: string;
}

const familyLabel = (f: string): string => (f === "—" ? "—" : (FAMILIES[f as FamilyId]?.label ?? f));
const backendLabel = (b: string, none: string): string => (b === "unknown" ? none : (BACKENDS[b as BackendId]?.label ?? b));

function build(x: Texts, lang: "en" | "de"): LlmConnectionStrings {
  const pick = (map: Record<string, string>, key: string): string => map[key] ?? key;
  const source = (map: Record<string, string>) => (key: string): string => map[key] ?? key;
  const familySource = source({ manager: x.familyManager, name: x.familyName, none: x.familyNone });
  const backendSource = source({ manager: x.backendManager, probe: x.backendProbe, none: x.backendNone });
  const hint = (key: string): string => (key === "unreachable" ? x.hintUnreachable : key === "no-list" ? x.hintNoList : "");
  return {
    listLabel: x.listLabel, listDesc: x.listDesc, listPlaceholder: x.listPlaceholder,
    deviationNotice: (d) => `${fmt(pick(x.deviations, d.kind), d.detail ?? "")} ${fmt(x.seeSettings, x.requestTitle)}`,
    redactedNote: (n) => fmt(n === 1 ? x.redactedOne : x.redactedMany, String(n)),
    noManager: x.noManager,
    noEndpoint: x.noEndpoint,
    managedDescManagerOnly: x.managedDescManagerOnly,
    endpointSource: {
      managed: x.managed, managedDesc: x.managedDesc, openManager: x.openManager, pickEndpoint: x.pickEndpoint,
      automatic: x.automatic, model: x.model, importLocal: x.importLocal,
      imported: (r) => fmt(x.imported, String(r.added.length), String(r.merged.length)), importFailed: x.importFailed,
      modelHint: hint, savedSuffix: x.saved, refreshModels: x.refreshModels, saveFailed: x.saveFailed,
    },
    endpointList: {
      addPlaceholder: x.addPlaceholder, apiKeyPlaceholder: x.apiKeyPlaceholder, modelPlaceholder: x.modelPlaceholder,
      ariaUrl: x.ariaUrl, ariaAdd: x.ariaAdd,
      ariaApiKey: (url) => fmt(x.ariaApiKey, url), ariaModel: (url) => fmt(x.ariaModel, url),
      modelHint: hint, savedSuffix: x.saved, refreshModels: x.refreshModels, emptyModel: x.emptyModel,
      contextText: (c) => (c.loadedContextLength !== undefined && c.maxContextLength !== undefined
        ? fmt(x.contextLoaded, c.loadedContextLength.toLocaleString(lang), c.maxContextLength.toLocaleString(lang))
        : c.loadedContextLength !== undefined ? fmt(x.contextLoadedOnly, c.loadedContextLength.toLocaleString(lang))
        : fmt(x.contextMax, (c.maxContextLength ?? 0).toLocaleString(lang))), moveToFront: x.moveToFront,
      remove: x.remove, thirdParty: x.thirdParty, probing: x.probing,
      statusTooltip: (s) => endpointStatusText(s.kind, { lang, raw: s.raw }),
      role: (r) => (r.kind === "active" ? x.roleActive
        : r.kind === "standby" ? fmt(x.roleStandby, String(r.position))
        : r.kind === "unreachable" ? x.roleUnreachable
        : x.roleSkippedModel),
      warnings: (ws) => ws.map((w) => endpointWarningText(w.rule, { lang, fallback: w.message })).join(" · "),
      presetTooltip: (p) => fmt(x.preset, p.label), presetLabel: (p) => p.label,
      checkConnection: x.checkConnection, saveFailed: x.saveFailed,
      secretSaved: x.secretSaved, secretChange: x.secretChange, secretClear: x.secretClear, secretUnavailable: x.secretUnavailable,
    },
    request: {
      title: x.requestTitle,
      // Unbekannt ist bei einem frisch eingetragenen Endpunkt der Normalfall: kein „— (unknown)“, sondern
      // „noch nicht erkannt“ ohne Klammer (die Quelle gibt es dann nicht).
      head: (family, fSource, backend, bSource) => [
        family === "—" ? x.requestFamilyNone : fmt(x.requestFamily, familyLabel(family), familySource(fSource)),
        backend === "unknown" ? x.requestBackendNone : fmt(x.requestBackend, backendLabel(backend, x.backendNone), backendSource(bSource)),
      ].join(" · "),
      unknownFamily: x.unknownFamily,
      jitWarning: (model, def) => fmt(x.jitWarning, model, def),
      sentAs: (model) => fmt(x.sentAs, model),
      modeHeading: (m) => x.modes[m],
      fieldName: (f) => x.fields[f],
      fieldDesc: (e) => {
        let s = x.states[e.state];
        if (e.note) s += ` ${x.notes[e.note]}`;
        if (e.field === "top_p") s += x.topPHint;
        return s;
      },
      reset: x.reset, thinkingLevel: x.thinkingLevel, level: (l) => x.levels[l],
      levelPicker: x.levelPicker, levelPickerDesc: x.levelPickerDesc, saveFailed: x.requestSaveFailed,
      dormant: (fam) => fmt(x.dormant, fam === "unknown" ? x.familyNone : (FAMILIES[fam]?.label ?? fam)),
      deleteDormant: x.deleteDormant, lastRequest: x.lastRequest, lastRequestNone: x.lastRequestNone,
      copy: x.copy, copied: x.copied, deviationsOk: x.deviationsOk,
      deviationsWarn: (n) => fmt(x.deviationsWarn, String(n)),
      deviation: (kind, count, detail) => `${fmt(pick(x.deviations, kind), detail ?? "")} (${count}×)`,
    },
  };
}

const EN: Texts = {
  listLabel: "Endpoints",
  listDesc: "Tried in order — the first reachable one is used. Local servers first; a hosted provider can carry its own API key.",
  listPlaceholder: "http://127.0.0.1:1234",
  managed: "Endpoints come from the LLM Endpoint Manager",
  managedDesc: "This plugin uses the endpoints configured in the LLM Endpoint Manager plugin. Your local list stays as a fallback.",
  openManager: "Open manager settings", pickEndpoint: "Endpoint", automatic: "automatic (first reachable)", model: "Model",
  importLocal: "Copy local endpoints into the manager", imported: "Copied: {0} new, {1} merged.", importFailed: "Copying failed.",
  hintUnreachable: "endpoint unreachable — no model list", hintNoList: "endpoint returns no model list — type the name",
  saved: "saved", refreshModels: "Refresh models", saveFailed: "Could not save the endpoint list.",
  emptyModel: "— (server picks)",
  contextLoaded: "Context: loaded {0} · max {1} tokens", contextMax: "Context: max {0} tokens", contextLoadedOnly: "Context: loaded {0} tokens",
  addPlaceholder: "add another endpoint…", apiKeyPlaceholder: "API key (optional)", modelPlaceholder: "model (optional)",
  ariaUrl: "Endpoint address", ariaAdd: "Add another endpoint", ariaApiKey: "API key for {0}", ariaModel: "Model override for {0}",
 
  moveToFront: "Try this endpoint first", remove: "Remove endpoint",
  thirdParty: "Carries an API key — your text goes to this provider, not to a local server.", probing: "Checking…",
  roleActive: "active — this one is used", roleStandby: "reachable — fallback {0}", roleUnreachable: "not reachable — skipped",
  roleSkippedModel: "skipped — model does not fit",
  preset: "Insert the {0} address", checkConnection: "Test connection",
  secretSaved: "saved", secretChange: "Change key", secretClear: "Remove key",
  secretUnavailable: "Secret storage is not available in this Obsidian version.",
  requestTitle: "Request", requestFamily: "Family: {0} ({1})", requestFamilyNone: "Family: not detected yet",
  requestBackend: "Backend: {0} ({1})", requestBackendNone: "Backend: not detected yet",
  familyManager: "from the LLM Endpoint Manager", familyName: "estimated from the name", familyNone: "unknown",
  backendManager: "from the LLM Endpoint Manager", backendProbe: "detected", backendNone: "unknown",
  unknownFamily: "Normal for a freshly added endpoint. Until the model family (the model line, e.g. Qwen or gpt-oss) is known, only the mode's temperature is sent and the rest comes from the server defaults. The LLM Endpoint Manager records family and backend per model — add them there.",
  jitWarning: "This plugin sends model {0}, the endpoint's default is {1}. On LM Studio, every request unloads the other plugins' model.",
  sentAs: "Sent as {0}",
  modes: {
    transform: "Transform", agent: "Agent", structured: "Structured", grounded: "Grounded chat", companion: "Companion",
    creative: "Creative", complete: "Completion",
  },
  fields: {
    temperature: "Temperature (temperature)", top_p: "Nucleus sampling (top_p)", top_k: "Top-k sampling (top_k)",
    min_p: "Minimum probability (min_p)", presence_penalty: "Presence penalty (presence_penalty)",
    reasoning_effort: "Thinking effort (reasoning_effort)", max_tokens: "Token budget (max_tokens)",
  },
  states: {
    "sent-effective": "Sent — measured to work on this backend.",
    "sent-unproven": "Sent — effect on this backend not proven yet.",
    "not-sent-ignored": "Not sent — measured to have no effect on this backend.",
    "not-sent-unsupported": "Not sent — this backend doesn't support it, or it's unmeasured.",
    "not-sent-unknown-family": "Not sent yet — waits for the model family (see above).",
    "not-sent-no-value": "Not sent — no value is set for this field.",
  },
  notes: {
    "raised-to-reserve": "Raised to the family's reserve so thinking can't eat the whole budget.",
    "raised-to-thinking-floor": "Raised to the family's floor while thinking (the vendor warns against greedy decoding).",
    "below-thinking-floor": "Below the family's thinking floor — your value wins anyway.",
    "off-not-possible": "This family can't fully turn thinking off; the lowest available level is sent.",
  },
  topPHint: " For near-deterministic answers use temperature 0 or top_k 1 instead of a very small top_p.",
  reset: "Reset", thinkingLevel: "Thinking level", levels: { off: "off", low: "low", medium: "medium", high: "high" },
  levelPicker: "Level picker in chat",
  levelPickerDesc: "Shows a dropdown with all four levels in the panel instead of the two-state button.",
  requestSaveFailed: "Could not save the request settings.",
  dormant: "Own values for {0}, not active right now", deleteDormant: "Delete",
  lastRequest: "Last request", lastRequestNone: "No request sent yet this session.", copy: "Copy", copied: "Copied",
  deviationsOk: "No deviations this session.", deviationsWarn: "{0} deviation(s) this session.",
  deviations: {
    "thinking-despite-off": "The model thought even though thinking is off.",
    "empty-by-budget": "Empty answer: thinking used up the token budget.",
    "family-mismatch": "The answer came from a different model family ({0}).",
    "family-detected": "Model family detected: {0}. Set it in the LLM Endpoint Manager.",
    "rejected": "The server rejected the request: {0}",
  },
  seeSettings: "Details in the settings under “{0}”.",
  redactedOne: "{0} passage redacted", redactedMany: "{0} passages redacted",
  noManager: "No LLM Endpoint Manager found. Install and enable it to choose an endpoint.",
  noEndpoint: "No endpoint reachable. Check the endpoint list in the settings — the test button says which one answers.",
  managedDescManagerOnly: "This plugin uses the endpoints configured in the LLM Endpoint Manager plugin.",
};

const DE: Texts = {
  listLabel: "Endpunkte",
  listDesc: "Werden der Reihe nach probiert — der erste erreichbare wird genutzt. Lokale Server zuerst; ein gehosteter Anbieter kann einen eigenen API-Schlüssel tragen.",
  listPlaceholder: "http://127.0.0.1:1234",
  managed: "Endpunkte kommen vom LLM Endpoint Manager",
  managedDesc: "Dieses Plugin nutzt die Endpunkte aus dem Plugin LLM Endpoint Manager. Die lokale Liste bleibt als Rückfall erhalten.",
  openManager: "Manager-Einstellungen öffnen", pickEndpoint: "Endpunkt", automatic: "automatisch (erster erreichbarer)", model: "Modell",
  importLocal: "Lokale Endpunkte in den Manager übernehmen", imported: "Übernommen: {0} neu, {1} zusammengeführt.",
  importFailed: "Übernahme fehlgeschlagen.",
  hintUnreachable: "Endpunkt nicht erreichbar — keine Modell-Liste", hintNoList: "Endpunkt gibt keine Modell-Liste heraus — Namen eintippen",
  saved: "gespeichert", refreshModels: "Modelle neu laden", saveFailed: "Die Endpunkt-Liste konnte nicht gespeichert werden.",
  emptyModel: "— (Server wählt)",
  contextLoaded: "Kontext: geladen {0} · max {1} Token", contextMax: "Kontext: max {0} Token", contextLoadedOnly: "Kontext: geladen {0} Token",
  addPlaceholder: "weiterer Endpunkt…", apiKeyPlaceholder: "API-Schlüssel (optional)", modelPlaceholder: "Modell (optional)",
  ariaUrl: "Adresse des Endpunkts", ariaAdd: "Weiteren Endpunkt hinzufügen", ariaApiKey: "API-Schlüssel für {0}",
  ariaModel: "Modell-Override für {0}",
  moveToFront: "Diesen Endpunkt zuerst versuchen", remove: "Endpunkt entfernen",
  thirdParty: "Trägt einen API-Schlüssel — dein Text geht an diesen Anbieter, nicht an einen lokalen Server.", probing: "Wird geprüft…",
  roleActive: "aktiv — dieser wird genutzt", roleStandby: "erreichbar — Reserve {0}", roleUnreachable: "nicht erreichbar — wird übersprungen",
  roleSkippedModel: "übersprungen — Modell passt nicht",
  preset: "Adresse von {0} eintragen", checkConnection: "Verbindung prüfen",
  secretSaved: "gespeichert", secretChange: "Schlüssel ändern", secretClear: "Schlüssel entfernen",
  secretUnavailable: "Der Schlüsselbund ist in dieser Obsidian-Version nicht verfügbar.",
  requestTitle: "Anfrage", requestFamily: "Familie: {0} ({1})", requestFamilyNone: "Familie: noch nicht erkannt",
  requestBackend: "Backend: {0} ({1})", requestBackendNone: "Backend: noch nicht erkannt",
  familyManager: "vom LLM Endpoint Manager", familyName: "geschätzt aus dem Namen", familyNone: "unbekannt",
  backendManager: "vom LLM Endpoint Manager", backendProbe: "erkannt", backendNone: "unbekannt",
  unknownFamily: "Bei einem frisch eingetragenen Endpunkt ist das normal. Solange die Modellfamilie (die Modellreihe, z. B. Qwen oder gpt-oss) unbekannt ist, wird nur die Temperatur des Modus gesendet, der Rest kommt vom Server-Standard. Familie und Backend hält der LLM Endpoint Manager je Modell fest — trag sie dort ein.",
  jitWarning: "Dieses Plugin sendet Modell {0}, der Standard des Endpunkts ist {1}. Auf LM Studio entlädt jede Anfrage das Modell der anderen Plugins.",
  sentAs: "Gesendet als {0}",
  modes: {
    transform: "Umformen", agent: "Agent", structured: "Strukturiert", grounded: "Chat mit Quellen", companion: "Begleiter",
    creative: "Kreativ", complete: "Vervollständigung",
  },
  fields: {
    temperature: "Temperatur (temperature)", top_p: "Nucleus-Sampling (top_p)", top_k: "Top-k-Sampling (top_k)",
    min_p: "Mindestwahrscheinlichkeit (min_p)", presence_penalty: "Präsenz-Strafe (presence_penalty)",
    reasoning_effort: "Denkaufwand (reasoning_effort)", max_tokens: "Token-Budget (max_tokens)",
  },
  states: {
    "sent-effective": "Gesendet — gemessen wirksam auf diesem Backend.",
    "sent-unproven": "Gesendet — Wirkung auf diesem Backend noch nicht belegt.",
    "not-sent-ignored": "Nicht gesendet — gemessen wirkungslos auf diesem Backend.",
    "not-sent-unsupported": "Nicht gesendet — dieses Backend kennt es nicht, oder es ist ungemessen.",
    "not-sent-unknown-family": "Noch nicht gesendet — wartet auf die Modellfamilie (siehe oben).",
    "not-sent-no-value": "Nicht gesendet — für dieses Feld ist kein Wert gesetzt.",
  },
  notes: {
    "raised-to-reserve": "Angehoben auf die Reserve der Familie, damit das Denken nicht das ganze Budget aufbraucht.",
    "raised-to-thinking-floor": "Beim Denken auf die Untergrenze der Familie angehoben (der Hersteller warnt vor Greedy Decoding).",
    "below-thinking-floor": "Unter der Denk-Untergrenze der Familie — dein Wert gewinnt trotzdem.",
    "off-not-possible": "Diese Familie lässt sich nicht ganz abschalten; die niedrigste verfügbare Stufe wird gesendet.",
  },
  topPHint: " Für fast feste Antworten Temperatur 0 oder top_k 1 statt sehr kleinem top_p verwenden.",
  reset: "Zurücksetzen", thinkingLevel: "Denkstufe", levels: { off: "aus", low: "niedrig", medium: "mittel", high: "hoch" },
  levelPicker: "Stufenwahl im Chat",
  levelPickerDesc: "Zeigt im Panel ein Dropdown mit allen vier Stufen statt des Zwei-Zustands-Knopfs.",
  requestSaveFailed: "Die Anfrage-Einstellungen konnten nicht gespeichert werden.",
  dormant: "Eigene Werte für {0}, gerade nicht aktiv", deleteDormant: "Löschen",
  lastRequest: "Letzte Anfrage", lastRequestNone: "In dieser Sitzung noch keine Anfrage gesendet.", copy: "Kopieren", copied: "Kopiert",
  deviationsOk: "Keine Abweichungen in dieser Sitzung.", deviationsWarn: "{0} Abweichung(en) in dieser Sitzung.",
  deviations: {
    "thinking-despite-off": "Das Modell hat gedacht, obwohl Denken aus war.",
    "empty-by-budget": "Leere Antwort: das Denken hat das Tokenbudget verbraucht.",
    "family-mismatch": "Die Antwort kam von einer anderen Modellfamilie ({0}).",
    "family-detected": "Modellfamilie erkannt: {0}. Im LLM Endpoint Manager setzen.",
    "rejected": "Der Server hat die Anfrage abgelehnt: {0}",
  },
  seeSettings: "Details in den Einstellungen unter „{0}“.",
  redactedOne: "{0} Stelle geschwärzt", redactedMany: "{0} Stellen geschwärzt",
  noManager: "Kein LLM Endpoint Manager gefunden. Installiere und aktiviere ihn, um einen Endpunkt zu wählen.",
  noEndpoint: "Kein Endpunkt erreichbar. Prüf die Endpunkt-Liste in den Einstellungen — der Testknopf sagt, welcher antwortet.",
  managedDescManagerOnly: "Dieses Plugin nutzt die Endpunkte aus dem Plugin LLM Endpoint Manager.",
};

export const LLM_CONNECTION_STRINGS_EN: LlmConnectionStrings = build(EN, "en");
export const LLM_CONNECTION_STRINGS_DE: LlmConnectionStrings = build(DE, "de");

/** Teil-Überschreibung: je Abschnitt einzelne Felder, dazu die Sprache des Defaults. */
export interface LlmConnectionStringsOverride {
  lang?: "en" | "de";
  listLabel?: string;
  listDesc?: string;
  listPlaceholder?: string;
  deviationNotice?: (d: Deviation) => string;
  redactedNote?: (n: number) => string;
  noManager?: string;
  noEndpoint?: string;
  /** Label dieser Liste für `ariaUrl`/`ariaAdd` („Chat endpoints: Endpoint address“) — nötig, sobald zwei
   *  Listen auf einem Tab stehen und die Beschriftungen sonst gleich lauten. Ohne Angabe wie bisher. */
  listAriaLabel?: string;
  managedDescManagerOnly?: string;
  endpointSource?: Partial<LlmConnectionStrings["endpointSource"]>;
  endpointList?: Partial<LlmConnectionStrings["endpointList"]>;
  request?: Partial<LlmConnectionStrings["request"]>;
}

/** `ariaUrl`/`ariaAdd` mit vorangestelltem Listen-Label; ohne Label nichts. */
function labelled(list: LlmConnectionStrings["endpointList"], label: string | undefined): Partial<LlmConnectionStrings["endpointList"]> {
  return label ? { ariaUrl: `${label}: ${list.ariaUrl}`, ariaAdd: `${label}: ${list.ariaAdd}` } : {};
}

/** Default der Sprache (EN ohne Angabe), Abschnitt für Abschnitt von `override` überlagert. */
export function resolveLlmConnectionStrings(override?: LlmConnectionStringsOverride): LlmConnectionStrings {
  const base = override?.lang === "de" ? LLM_CONNECTION_STRINGS_DE : LLM_CONNECTION_STRINGS_EN;
  if (!override) return base;
  return {
    listLabel: override.listLabel ?? base.listLabel,
    listDesc: override.listDesc ?? base.listDesc,
    listPlaceholder: override.listPlaceholder ?? base.listPlaceholder,
    deviationNotice: override.deviationNotice ?? base.deviationNotice,
    redactedNote: override.redactedNote ?? base.redactedNote,
    noManager: override.noManager ?? base.noManager,
    noEndpoint: override.noEndpoint ?? base.noEndpoint,
    managedDescManagerOnly: override.managedDescManagerOnly ?? base.managedDescManagerOnly,
    endpointSource: { ...base.endpointSource, ...override.endpointSource },
    endpointList: { ...base.endpointList, ...labelled(base.endpointList, override.listAriaLabel), ...override.endpointList },
    request: { ...base.request, ...override.request },
  };
}
