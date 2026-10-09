// vendored from obsidian-kit@0.51.2, src/obsidian/llm-connection-strings.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
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
 *  Überschreiben: `renderSettings(el, { lang: "de", request: { title: "…" } })` — ein Teil-Merge
 *  über dem Default, je Abschnitt ein Feld genau. */
import { BACKENDS, FAMILIES, type FamilyId, type BackendId, type Deviation } from "../kit/sampling-profiles";
import type { LlmConnectionStrings } from "./llm-connection";

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
  // Endpunkt-Liste
  addPlaceholder: string; apiKeyPlaceholder: string; modelPlaceholder: string; ariaUrl: string; ariaAdd: string;
  ariaApiKey: string; ariaModel: string; globalModel: string; globalModelUnset: string;
  moveToFront: string; remove: string; thirdParty: string; probing: string;
  statusOk: string; statusRefused: string; statusUnknownHost: string; statusTimeout: string; statusNotAnLlmApi: string;
  statusUnauthorized: string; statusUnknown: string;
  roleActive: string; roleStandby: string; roleUnreachable: string; roleSkippedModel: string;
  warnScheme: string; warnMalformed: string; warnPort: string; warnPlaceholderIp: string;
  preset: string; checkConnection: string;
  secretSaved: string; secretChange: string; secretClear: string; secretUnavailable: string;
  // Anfrage-Abschnitt
  requestTitle: string; requestHead: string; familyManager: string; familyName: string; familyNone: string;
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
}

const familyLabel = (f: string): string => (f === "—" ? "—" : (FAMILIES[f as FamilyId]?.label ?? f));
const backendLabel = (b: string, none: string): string => (b === "unknown" ? none : (BACKENDS[b as BackendId]?.label ?? b));

function build(x: Texts): LlmConnectionStrings {
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
      emptyModelLabel: (g) => (g ? fmt(x.globalModel, g) : x.globalModelUnset),
      modelHint: hint, savedSuffix: x.saved, refreshModels: x.refreshModels, moveToFront: x.moveToFront,
      remove: x.remove, thirdParty: x.thirdParty, probing: x.probing,
      statusTooltip: (s) => {
        switch (s.kind) {
          case "ok": return x.statusOk;
          case "refused": return x.statusRefused;
          case "unknown-host": return x.statusUnknownHost;
          case "timeout": return x.statusTimeout;
          case "not-an-llm-api": return x.statusNotAnLlmApi;
          case "unauthorized": return x.statusUnauthorized;
          default: return fmt(x.statusUnknown, s.raw ?? "");
        }
      },
      role: (r) => (r.kind === "active" ? x.roleActive
        : r.kind === "standby" ? fmt(x.roleStandby, String(r.position))
        : r.kind === "unreachable" ? x.roleUnreachable
        : x.roleSkippedModel),
      warnings: (ws) => ws.map((w) => (
        w.rule === "scheme" ? x.warnScheme : w.rule === "malformed" ? x.warnMalformed
        : w.rule === "port" ? x.warnPort : w.rule === "placeholder-ip" ? x.warnPlaceholderIp : w.message
      )).join(" · "),
      presetTooltip: (p) => fmt(x.preset, p.label), presetLabel: (p) => p.label,
      checkConnection: x.checkConnection, saveFailed: x.saveFailed,
      secretSaved: x.secretSaved, secretChange: x.secretChange, secretClear: x.secretClear, secretUnavailable: x.secretUnavailable,
    },
    request: {
      title: x.requestTitle,
      head: (family, fSource, backend, bSource) =>
        fmt(x.requestHead, familyLabel(family), familySource(fSource), backendLabel(backend, x.backendNone), backendSource(bSource)),
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
  addPlaceholder: "add another endpoint…", apiKeyPlaceholder: "API key (optional)", modelPlaceholder: "model (optional)",
  ariaUrl: "Endpoint address", ariaAdd: "Add another endpoint", ariaApiKey: "API key for {0}", ariaModel: "Model override for {0}",
  globalModel: "global model ({0})", globalModelUnset: "global model (none set)",
  moveToFront: "Try this endpoint first", remove: "Remove endpoint",
  thirdParty: "Carries an API key — your text goes to this provider, not to a local server.", probing: "Checking…",
  statusOk: "Connected", statusRefused: "Connection refused — server not running or wrong port.",
  statusUnknownHost: "Unknown host — typo in the address?", statusTimeout: "Timed out — network unreachable.",
  statusNotAnLlmApi: "Answers, but is not an OpenAI-compatible endpoint.", statusUnauthorized: "Access denied — API key missing or invalid.",
  statusUnknown: "Not reachable — {0}",
  roleActive: "active — this one is used", roleStandby: "reachable — fallback {0}", roleUnreachable: "not reachable — skipped",
  roleSkippedModel: "skipped — model does not fit",
  warnScheme: "Address needs http:// or https://", warnMalformed: "Address is not a valid URL",
  warnPort: "Local LLM servers almost always need a port (e.g. :1234)", warnPlaceholderIp: "Looks like an example or placeholder address",
  preset: "Insert the {0} address", checkConnection: "Test connection",
  secretSaved: "saved", secretChange: "Change key", secretClear: "Remove key",
  secretUnavailable: "Secret storage is not available in this Obsidian version.",
  requestTitle: "Request", requestHead: "Family: {0} ({1}) · Backend: {2} ({3})",
  familyManager: "from the LLM Endpoint Manager", familyName: "estimated from the name", familyNone: "unknown",
  backendManager: "from the LLM Endpoint Manager", backendProbe: "detected", backendNone: "unknown",
  unknownFamily: "Model family unknown — only the mode's temperature is sent, the rest comes from the server default.",
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
    "not-sent-unknown-family": "Not sent — the model family is unknown.",
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
  addPlaceholder: "weiterer Endpunkt…", apiKeyPlaceholder: "API-Schlüssel (optional)", modelPlaceholder: "Modell (optional)",
  ariaUrl: "Adresse des Endpunkts", ariaAdd: "Weiteren Endpunkt hinzufügen", ariaApiKey: "API-Schlüssel für {0}",
  ariaModel: "Modell-Override für {0}", globalModel: "globales Modell ({0})", globalModelUnset: "globales Modell (keines gesetzt)",
  moveToFront: "Diesen Endpunkt zuerst versuchen", remove: "Endpunkt entfernen",
  thirdParty: "Trägt einen API-Schlüssel — dein Text geht an diesen Anbieter, nicht an einen lokalen Server.", probing: "Wird geprüft…",
  statusOk: "Verbunden", statusRefused: "Verbindung abgelehnt — Server läuft nicht oder Port falsch.",
  statusUnknownHost: "Hostname unbekannt — Tippfehler in der Adresse?", statusTimeout: "Zeitüberschreitung — Netz nicht erreichbar.",
  statusNotAnLlmApi: "Antwortet, ist aber kein OpenAI-kompatibler Endpunkt.",
  statusUnauthorized: "Zugriff verweigert — Schlüssel fehlt oder ist ungültig.", statusUnknown: "Nicht erreichbar — {0}",
  roleActive: "aktiv — dieser wird genutzt", roleStandby: "erreichbar — Reserve {0}", roleUnreachable: "nicht erreichbar — wird übersprungen",
  roleSkippedModel: "übersprungen — Modell passt nicht",
  warnScheme: "Adresse braucht http:// oder https://", warnMalformed: "Adresse ist keine gültige URL",
  warnPort: "Lokale LLM-Server brauchen fast immer einen Port (z. B. :1234)",
  warnPlaceholderIp: "Sieht aus wie eine Beispiel- oder Platzhalter-Adresse",
  preset: "Adresse von {0} eintragen", checkConnection: "Verbindung prüfen",
  secretSaved: "gespeichert", secretChange: "Schlüssel ändern", secretClear: "Schlüssel entfernen",
  secretUnavailable: "Der Schlüsselbund ist in dieser Obsidian-Version nicht verfügbar.",
  requestTitle: "Anfrage", requestHead: "Familie: {0} ({1}) · Backend: {2} ({3})",
  familyManager: "vom LLM Endpoint Manager", familyName: "geschätzt aus dem Namen", familyNone: "unbekannt",
  backendManager: "vom LLM Endpoint Manager", backendProbe: "erkannt", backendNone: "unbekannt",
  unknownFamily: "Modellfamilie unbekannt — es wird nur die Temperatur des Modus gesendet, der Rest kommt vom Server-Standard.",
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
    "not-sent-unknown-family": "Nicht gesendet — die Modellfamilie ist unbekannt.",
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
};

export const LLM_CONNECTION_STRINGS_EN: LlmConnectionStrings = build(EN);
export const LLM_CONNECTION_STRINGS_DE: LlmConnectionStrings = build(DE);

/** Teil-Überschreibung: je Abschnitt einzelne Felder, dazu die Sprache des Defaults. */
export interface LlmConnectionStringsOverride {
  lang?: "en" | "de";
  listLabel?: string;
  listDesc?: string;
  listPlaceholder?: string;
  deviationNotice?: (d: Deviation) => string;
  redactedNote?: (n: number) => string;
  noManager?: string;
  endpointSource?: Partial<LlmConnectionStrings["endpointSource"]>;
  endpointList?: Partial<LlmConnectionStrings["endpointList"]>;
  request?: Partial<LlmConnectionStrings["request"]>;
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
    endpointSource: { ...base.endpointSource, ...override.endpointSource },
    endpointList: { ...base.endpointList, ...override.endpointList },
    request: { ...base.request, ...override.request },
  };
}
