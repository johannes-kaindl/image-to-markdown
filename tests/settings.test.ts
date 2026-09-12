import { describe, it, expect } from "vitest";
import { defaultSettings, migrateEndpoints, applyListEdit, applyTaxonomyEdit, fmMapFromSettings } from "../src/settings";
import { DEFAULT_FM_MAP } from "../src/frontmatter_map";
import { createModelListCache } from "../src/vendor/kit/model-list-cache";

// ⚠️ ÜBERSPRUNGEN — Fix gehört ins Kit, nicht hierher (Quicktask 2026-09-12, "LM-Endpunkt nach
// Entfernen+Neu-Hinzufügen nicht mehr erkannt"). Root Cause: src/vendor/kit-obsidian/endpoint-list.ts
// (vendored, "Never hand-edit") invalidiert den ModelListCache nicht beim Löschen eines Endpunkts
// und nicht beim URL-Commit (nur apiKey-Edits invalidieren, Zeile ~195) — eine wiederverwendete URL
// bekommt das alte gecachte Ergebnis statt einer frischen Probe. Gemeldet an obsidian-plugins-e8
// mit Fix-Vorschlag (invalidate bei jeder URL-Mutation: trash/URL-Commit/Preset). Sobald die
// Kit-Version den Fix trägt und hier re-vendored ist: entskippen — der Test beweist dann, dass der
// (behobene) Cache bei erneutem `load()` derselben URL nicht mehr das alte Ergebnis liefert.
describe.skip("ModelListCache — Regression, sobald Kit-Fix vendored ist", () => {
  it("dieselbe URL nach 'Entfernen' liefert nicht mehr das alte gecachte Ergebnis", async () => {
    const cache = createModelListCache();
    const url = "http://localhost:1234";
    const offline = { listModels: async () => [], probe: async () => ({ reachable: false }) };
    await cache.load(url, offline);   // Server war beim Entfernen kurz down → gecacht als unreachable
    // Hier müsste ein Fix im Kit-Modul beim Entfernen/erneuten Hinzufügen der URL
    // `cache.invalidate(url)` rufen — das fehlt heute.
    const online = { listModels: async () => ["qwen-vl"], probe: async () => ({ reachable: true }) };
    const result = await cache.load(url, online);   // "erneut hinzugefügt" → sollte frisch proben
    expect(result).toEqual({ models: ["qwen-vl"], reachable: true });
  });
});

describe("migrateEndpoints", () => {
  it("alter Einzel-Endpoint → Config-Liste", () => {
    expect(migrateEndpoints({ visionEndpoint: "http://localhost:8080" })).toEqual([{ url: "http://localhost:8080" }]);
  });
  it("alte String-Liste → Configs, leere gefiltert", () => {
    expect(migrateEndpoints({ visionEndpoints: ["http://a:1234", "", "  ", "http://b:1234"] }))
      .toEqual([{ url: "http://a:1234" }, { url: "http://b:1234" }]);
  });
  it("bereits migrierte Configs bleiben unverändert, inklusive Schlüssel", () => {
    const eps = [{ url: "https://openrouter.ai/api", apiKey: "sk-x" }];
    expect(migrateEndpoints({ visionEndpoints: eps })).toEqual(eps);
  });
  it("Liste hat Vorrang vor altem Einzelfeld", () => {
    expect(migrateEndpoints({ visionEndpoint: "http://old", visionEndpoints: ["http://new"] })).toEqual([{ url: "http://new" }]);
  });
  it("nichts vorhanden → leere Liste", () => {
    expect(migrateEndpoints(null)).toEqual([]);
    expect(migrateEndpoints({})).toEqual([]);
  });
});

describe("applyListEdit", () => {
  it("Add-Feld: nicht-leerer Wert wird EINMAL angehängt", () => {
    expect(applyListEdit([], 0, "http://localhost:1234", true)).toEqual(["http://localhost:1234"]);
    expect(applyListEdit(["http://a:1234"], 1, "http://b:1234", true)).toEqual(["http://a:1234", "http://b:1234"]);
  });
  it("Add-Feld: leerer Wert → Liste unverändert", () => {
    expect(applyListEdit(["http://a:1234"], 1, "   ", true)).toEqual(["http://a:1234"]);
  });
  it("bestehendes Feld: Wert wird ersetzt (nicht angehängt)", () => {
    expect(applyListEdit(["http://a:1234", "http://b:1234"], 0, "http://c:1234", false)).toEqual(["http://c:1234", "http://b:1234"]);
  });
  it("bestehendes Feld geleert → Eintrag entfernt", () => {
    expect(applyListEdit(["http://a:1234", "http://b:1234"], 0, "", false)).toEqual(["http://b:1234"]);
  });
  it("Mülleimer-Löschen: entfernt den Eintrag an Index i (auch mittig)", () => {
    expect(applyListEdit(["http://a:1234", "http://b:1234", "http://c:1234"], 1, "", false)).toEqual(["http://a:1234", "http://c:1234"]);
  });
  it("trimmt Eingabe + filtert leere Einträge", () => {
    expect(applyListEdit(["http://a:1234"], 1, "  http://b:1234  ", true)).toEqual(["http://a:1234", "http://b:1234"]);
  });
  it("Regression (localhost-Akkumulation): das Add-Feld bildet EINEN Eintrag, nicht einen je Zwischenstand", () => {
    // Korrektes Verhalten: nur der finale (blur-)Wert wird angewandt — kein Akkumulieren von l, lo, loc, …
    const result = applyListEdit([], 0, "http://localhost:1234/v1", true);
    expect(result).toEqual(["http://localhost:1234/v1"]);
    expect(result.length).toBe(1);
  });
});

describe("defaultSettings", () => {
  it("enthält PDF-Defaults", () => {
    const s = defaultSettings();
    expect(s.pdfMaxPages).toBe(25);
    expect(s.pdfRenderScale).toBe(2.0);
    expect(s.pdfPageSeparator).toBe("comment");
  });
  it("promptPreset ist 'default', visionPrompt unverändert vorhanden", () => {
    const s = defaultSettings();
    expect(s.promptPreset).toBe("default");
    expect(typeof s.visionPrompt).toBe("string");
    expect(s.visionPrompt.length).toBeGreaterThan(0);
  });
  it("pdfUseTextLayer ist default true", () => {
    expect(defaultSettings().pdfUseTextLayer).toBe(true);
  });
  it("Default ist false (Thinking an)", () => {
    expect(defaultSettings().suppressThinking).toBe(false);
  });
  it("liefert eine sinnvolle Taxonomie und das Standard-Frontmatter-Mapping", () => {
    const s = defaultSettings();
    expect(s.describeTaxonomy).toContain("Diagramm");
    expect(s.describeTaxonomy).toEqual(["Foto", "Diagramm", "Screenshot", "Handschrift", "Whiteboard", "Tabelle", "Sonstiges"]);
    expect(s.frontmatterMap).toEqual(DEFAULT_FM_MAP);
  });
});

describe("applyTaxonomyEdit", () => {
  it("fügt hinzu, bearbeitet und entfernt Einträge (analog applyEndpointEdit)", () => {
    expect(applyTaxonomyEdit(["Foto"], 0, "", false)).toEqual([]);
    expect(applyTaxonomyEdit(["Foto"], 1, "Neu", true)).toEqual(["Foto", "Neu"]);
    expect(applyTaxonomyEdit(["Foto", "Diagramm"], 0, "Bild", false)).toEqual(["Bild", "Diagramm"]);
  });
});

describe("fmMapFromSettings", () => {
  it("füllt fehlende Keys aus DEFAULT_FM_MAP auf (Shallow-Merge-Vorwärtskompatibilität)", () => {
    const merged = fmMapFromSettings({ frontmatterMap: { sourceImage: "x" } } as any);
    // Vollständige Assertion: der Override greift genau für sourceImage, alle 11 übrigen Keys
    // kommen unverändert aus DEFAULT_FM_MAP (fängt auch versehentlich fallengelassene Keys).
    expect(merged).toEqual({ ...DEFAULT_FM_MAP, sourceImage: "x" });
  });
  it("ohne frontmatterMap → komplettes DEFAULT_FM_MAP", () => {
    expect(fmMapFromSettings({} as any)).toEqual(DEFAULT_FM_MAP);
  });
});
