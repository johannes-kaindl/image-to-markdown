import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

// Reproduziert die Obsidian-Community-Review-Checks lokal (eslint-plugin-obsidianmd)
// plus typescript-eslint type-checked. Gelintet wird nur src/ (das gebündelte Plugin).
export default tseslint.config(
  {
    ignores: [
      "main.js",
      "esbuild.config.mjs",
      "eslint.config.mjs",
      "scripts/**",
      "tests/**",
      "vitest.config.ts",
    ],
  },
  ...tseslint.configs.recommendedTypeChecked,
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // ui/sentence-case meldet False-Positives auf Marken-/URL-Strings ("IMG → MD",
      // "http://localhost:8080") und wird vom offiziellen Community-Review nicht erzwungen.
      "obsidianmd/ui/sentence-case": "off",
      "obsidianmd/ui/sentence-case-json": "off",
      "obsidianmd/ui/sentence-case-locale-module": "off",
      // display() ist seit 1.13 deprecated (Recommendation); getSettingDefinitions-Migration
      // ist als bewusste Abweichung deferred → Warnung statt Fehler.
      "@typescript-eslint/no-deprecated": "warn",
    },
  },
);
