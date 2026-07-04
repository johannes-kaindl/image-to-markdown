// obsidian-Modul-Mock für Vitest (via resolve.alias in vitest.config.ts).
// Re-export des vendorten obsidian-kit-Mocks (tests/vendor/kit/obsidian-mock.ts,
// byte-identisch #0.3.0 — makeFakeEl/Plugin/ItemView/PluginSettingTab/Setting/TFile/
// setIcon/getLanguage/Notice/makeFakeApp + Superset). Plugin-eigene Stubs ggf.
// hier als Override ergänzen.
export * from "../vendor/kit/obsidian-mock";
