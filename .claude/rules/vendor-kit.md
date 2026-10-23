---
paths:
  - "src/vendor/**"
  - "tools/sync-kit.sh"
  - "tools/kit-sync.json"
---

# Vendorte Kit-Schicht — Gotchas

Gotchas zu `src/vendor/kit/` (obsidian-frei) und `src/vendor/kit-obsidian/` (obsidian-abhängig). Aufbau: `docs/internal/architecture.md`.

- **Erneuere den Vendor-Baum nur mit `sh tools/sync-kit.sh`, nie von Hand.** Das Skript liest `../obsidian-kit` bzw. `$KIT_DIR`; die Pins (`obsidian-kit`, `code-kit`, je ein fester Tag) stehen in `tools/kit-sync.json` und sind in `src/vendor/kit/VENDOR.json` und `src/vendor/kit-obsidian/VENDOR.json` gespiegelt, die Herkunft zusätzlich im Kopf jeder Datei; das Dach-Werkzeug dahinter: `../tools/kit-sync/README.md`. Nie den Kit-Arbeitsstand vendoren, nur feste Tags.
- **Ein obsidian-importierendes Modul gehört nach `vendor/kit-obsidian/`, nie nach `vendor/kit/`.** Die Trennung ist Vertrag: ein Modul mit `obsidian`-Import unter `vendor/kit/` fällt in den Nachbar-Repos durch deren `check:pure`.
- **Die Literale `"ctx"|"add"|"del"` in `vendor/kit/diff.ts` sind load-bearing.** `diff_modal.ts` und `migration_modal.ts` bauen daraus die CSS-Klasse `img2md-diff-${kind}` gegen `styles.css`; eine Umbenennung im Kit bräche das Styling still. Die Datei stammt heute aus code-kit (bis 0.27.0 lokal als `src/diff.ts`).
- **Die Module in `vendor/kit-obsidian/` sind nicht verbatim, sondern umgeschrieben:** die kit-internen Importe `../pure/` heißen hier `../kit/` (Vendor-Layout), ebenso die Querimporte auf code-kit. Der Umschrieb steht als `rewrite` in `tools/kit-sync.json`, ist mechanisch und wird von `sync-kit.sh` reproduziert.
- **`vendor/kit/think-splitter.ts` heißt hier wie im Kit, der Chat-Client importiert diesen Namen.** Die Datei lag bis Welle 11 lokal als `think.ts`, davor als `src/think_splitter.ts`.
- **Kit-CSS-Konstanten kopierst du laut Kit-Vertrag verbatim in `styles.css`, du importierst sie nicht** (Abschnitt „Anfrage“, Sitzung, Denk-Knopf der Sidebar).
