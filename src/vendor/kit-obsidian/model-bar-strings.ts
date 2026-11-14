// vendored from obsidian-kit@0.89.0, src/obsidian/model-bar-strings.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Default-Texte (EN/DE) für `buildModelBar` — nach dem Muster von `chat-window-strings.ts`: das Kit formuliert nichts fest, aber jedes Plugin soll
 *  „Modell“, „Modelle neu laden“ oder „Endpunkte verwalten …“ nicht selbst erfinden.
 *
 *  Herkunft des Wortlauts (UI-STANDARD § 10, die reichste Fassung je Text): vault-rag `src/i18n/strings.ts` und lingotuner `src/i18n/` (Modell-Feld,
 *  Neu-laden-Tooltip), obsidian-transmute (`set.modelAuto` „Automatisch“), `endpoint-source.ts` (`EndpointSourceModelStrings`: Hinweise zu
 *  „nicht erreichbar“ und „keine Liste“, Zusatz „gespeichert“). Eigene Formulierung, in keiner Fassung belegt: „Endpunkte verwalten …“ (bis 0.86.0 „Anderer Endpunkt …“), die Gruppen-Texte (0.87.0), die Ansage nach dem
 *  Neu-laden (`loaded`, `notReachable`: image-to-markdown zeigte „N Modelle geladen“ in einer Statuszeile, die anderen Eigenbauten quittierten den Klick nicht)
 *  und `setFailed`.
 *
 *  Überschreiben: `strings: { lang: "de", otherEndpoint: "Endpunkte verwalten …" }` — Teil-Merge über dem Default der Sprache. */

export interface ModelBarStrings {
  /** `aria-label` des Dropdowns, wenn die Zeile keine Aufgabe nennt („Modell“). */
  model: string;
  /** `aria-label` des Dropdowns und Beschriftung der Zeile, wenn `label` gesetzt ist (z. B. „Modell für Smart Apply“). */
  modelFor: (task: string) => string;
  /** `aria-label` und Tooltip des Neu-laden-Knopfs. */
  refresh: string;
  /** Eintrag „kein Modell gewählt, der Endpunkt entscheidet“ (Wert `""`). */
  automatic: string;
  /** Derselbe Eintrag, wenn der Endpunkt sein Standard-Modell nennt (`source().defaultModel`). */
  automaticWith: (defaultModel: string) => string;
  /** Zusatz an einem gewählten Modell, das der Endpunkt nicht (mehr) listet. */
  savedSuffix: string;
  /** Aktionseintrag am Ende der Liste (seit 0.87.0 „Endpunkte verwalten …“): öffnet die Einstellungen des Managers, wählt nichts. */
  otherEndpoint: string;
  /** Seit 0.87.0 (Modellzeile mit Gruppen): „Automatisch“ mit dem Endpunkt, den die Auflösung nimmt, und dessen Standard-Modell — nur, wenn die Wahl leer ist oder verwaist. */
  automaticAt: (endpoint: string, model: string) => string;
  /** Erster Eintrag jeder Gruppe, wenn der Endpunkt ein Standard-Modell nennt: legt nur den Endpunkt fest. */
  defaultWith: (model: string) => string;
  /** Derselbe Eintrag ohne Standard-Modell: der Server wählt. */
  defaultServer: string;
  /** Gesperrter Eintrag einer Gruppe, deren Liste noch unterwegs ist. */
  loading: string;
  /** Gesperrter Eintrag einer Gruppe, deren Endpunkt nicht antwortet. */
  unreachable: string;
  /** Gesperrter Eintrag einer Gruppe, deren Endpunkt antwortet, aber nichts meldet (der Manager unterscheidet das von „aus“ noch nicht, Spec § 4.7). */
  noModels: string;
  /** Tooltip des geschlossenen Dropdowns: Modell und Endpunkt. */
  tooltipModelAt: (model: string, endpoint: string) => string;
  /** Tooltip und Warnzeichen, wenn der festgelegte Endpunkt nicht mehr gilt und „Automatisch“ einspringt. */
  orphaned: (reason: "disabled" | "not-found" | "secret-missing", endpoint: string) => string;
  /** Tooltip einer Alt-Wahl, die nur ein Modell trägt (kein Endpunkt). */
  legacyAuto: string;
  /** Ansage nach „Neu laden“ mit Gruppen: alle Modelle aller Endpunkte. */
  loadedAll: (models: number, endpoints: number) => string;
  /** Hinweis (Tooltip) am Dropdown, wenn der Endpunkt nicht antwortet. */
  hintUnreachable: string;
  /** Hinweis (Tooltip) am Dropdown, wenn der Endpunkt antwortet, aber keine Modell-Liste herausgibt. */
  hintNoList: string;
  /** Ansage (`aria-live`) nach dem Neu-laden. */
  loaded: (count: number) => string;
  notReachable: string;
  /** Ansage, wenn `setModel` geworfen hat. */
  setFailed: (message: string) => string;
}

export interface ModelBarStringsOverride extends Partial<ModelBarStrings> {
  lang?: "en" | "de";
}

export const MODEL_BAR_STRINGS_EN: ModelBarStrings = {
  model: "Model",
  modelFor: (task) => `Model for ${task}`,
  refresh: "Reload models",
  automatic: "Automatic",
  automaticWith: (m) => `Automatic (${m})`,
  savedSuffix: "(saved)",
  otherEndpoint: "Manage endpoints …",
  automaticAt: (e, m) => `Automatic (${e} · ${m})`,
  defaultWith: (m) => `Default (${m})`,
  defaultServer: "Default (server decides)",
  loading: "loading …",
  unreachable: "not reachable",
  noModels: "no models reported",
  tooltipModelAt: (m, e) => `${m} — ${e}`,
  orphaned: (r, e) => (r === "disabled" ? `${e} is switched off` : r === "secret-missing" ? `${e} has no key` : `${e} no longer exists`),
  legacyAuto: "applies to the automatic endpoint",
  loadedAll: (n, e) => `${n === 1 ? "1 model" : `${n} models`} in ${e === 1 ? "1 endpoint" : `${e} endpoints`} loaded`,
  hintUnreachable: "The endpoint does not answer; the saved model stays selected.",
  hintNoList: "The endpoint returns no model list; the saved model stays selected.",
  loaded: (n) => (n === 1 ? "1 model loaded" : `${n} models loaded`),
  notReachable: "Endpoint not reachable",
  setFailed: (m) => `Could not change the model: ${m}`,
};

export const MODEL_BAR_STRINGS_DE: ModelBarStrings = {
  model: "Modell",
  modelFor: (task) => `Modell für ${task}`,
  refresh: "Modelle neu laden",
  automatic: "Automatisch",
  automaticWith: (m) => `Automatisch (${m})`,
  savedSuffix: "(gespeichert)",
  otherEndpoint: "Endpunkte verwalten …",
  automaticAt: (e, m) => `Automatisch (${e} · ${m})`,
  defaultWith: (m) => `Standard (${m})`,
  defaultServer: "Standard (Server wählt)",
  loading: "lädt …",
  unreachable: "nicht erreichbar",
  noModels: "keine Modelle gemeldet",
  tooltipModelAt: (m, e) => `${m} — ${e}`,
  orphaned: (r, e) => (r === "disabled" ? `${e} ist abgeschaltet` : r === "secret-missing" ? `${e} hat keinen Schlüssel` : `${e} ist nicht mehr da`),
  legacyAuto: "gilt für den automatischen Endpunkt",
  loadedAll: (n, e) => `${n === 1 ? "1 Modell" : `${n} Modelle`} in ${e === 1 ? "1 Endpunkt" : `${e} Endpunkten`} geladen`,
  hintUnreachable: "Der Endpunkt antwortet nicht; das gespeicherte Modell bleibt gewählt.",
  hintNoList: "Der Endpunkt gibt keine Modell-Liste heraus; das gespeicherte Modell bleibt gewählt.",
  loaded: (n) => (n === 1 ? "1 Modell geladen" : `${n} Modelle geladen`),
  notReachable: "Endpunkt nicht erreichbar",
  setFailed: (m) => `Das Modell ließ sich nicht wechseln: ${m}`,
};

/** Nur die gesetzten Felder: ein ausdrückliches `undefined` im Override überschriebe sonst den Default. */
function definedOnly<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Default der Sprache (EN ohne Angabe), Feld für Feld von `override` überlagert. */
export function resolveModelBarStrings(override?: ModelBarStringsOverride): ModelBarStrings {
  const base = override?.lang === "de" ? MODEL_BAR_STRINGS_DE : MODEL_BAR_STRINGS_EN;
  if (!override) return base;
  const { lang: _lang, ...fields } = override;
  return { ...base, ...definedOnly(fields) };
}
