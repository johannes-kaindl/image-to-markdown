// obsidian-Modul-Mock für Vitest (via resolve.alias in vitest.config.ts).
// Re-export des geteilten obsidian-kit-Mocks — entdoppelt die zuvor lokale
// Implementierung (makeFakeEl/Plugin/ItemView/PluginSettingTab/Setting/TFile/
// setIcon/getLanguage/Notice/makeFakeApp + Superset). Plugin-eigene Stubs ggf.
// hier als Override ergänzen.
export * from "obsidian-kit/testing";
