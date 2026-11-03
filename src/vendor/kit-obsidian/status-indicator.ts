// vendored from obsidian-kit@0.77.1, src/obsidian/status-indicator.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { setIcon } from "obsidian";

/** §8-Baustein Status-Indikator (UI-STANDARD, `.claude/rules/ui-bausteine.md`): Form (Symbol) UND Farbe UND Klasse UND `aria-label` — nie Farbe allein.
 *  Vorlage ist die Fassung von lingotuner (`src/obsidian/view-render.ts`, `paintStatus`), nicht die von 3d-codeblocks (`prompt-panel.ts`: ohne `aria-label`).
 *  Phasen: `idle` (neutral, ein leerer Ausgangszustand ist kein Erfolg), `checking` (dreht), `ok`, `error`, `warning`. Fassungen mit anderen Phasennamen bilden ab:
 *  lingotuner `streaming` → `checking`, `aborted` → `warning` (MIGRATION 0.76.0). */
export type StatusPhase = "idle" | "checking" | "ok" | "error" | "warning";

export interface StatusOptions {
  /** Symbol für `idle`: ein Obsidian-Symbolname (Vorgabe `circle`, der leere Kreis) oder `null` für kein Symbol. */
  idleIcon?: string | null;
}

export interface StatusParts {
  /** Wurzel: trägt die Zustandsklasse `is-*` und das `aria-label`. */
  statusEl: HTMLElement;
  /** Symbol-Spanne (hier steht das Obsidian-Symbol). */
  iconEl: HTMLElement;
  /** Beschriftung (sichtbarer Text). */
  labelEl: HTMLElement;
  /** Symbol für `idle` (aus `StatusOptions`). */
  idleIcon: string | null;
}

const PHASE_ICON: Record<Exclude<StatusPhase, "idle">, string> = {
  checking: "loader",
  ok: "circle-check",
  error: "circle-x",
  warning: "alert-triangle",
};
const PHASE_CLASSES = ["is-checking", "is-ok", "is-error", "is-warning"];

/** Baut die Zeile unter `parent`: Wurzel `okit-status` (plus `cls` des Plugins), darin `okit-status-icon` und `okit-status-label`. Gezeichnet wird mit `paintStatus`. */
export function buildStatus(parent: HTMLElement, cls?: string, opts: StatusOptions = {}): StatusParts {
  const statusEl = parent.createDiv({ cls: cls === undefined ? "okit-status" : `okit-status ${cls}` });
  const iconEl = statusEl.createSpan({ cls: "okit-status-icon" });
  const labelEl = statusEl.createSpan({ cls: "okit-status-label" });
  return { statusEl, iconEl, labelEl, idleIcon: opts.idleIcon === undefined ? "circle" : opts.idleIcon };
}

/** Setzt Zustandsklasse, Symbol, Text und `aria-label` (derselbe Text). Idempotent; jeder Aufruf räumt die Klasse der vorigen Phase weg. */
export function paintStatus(parts: StatusParts, phase: StatusPhase, text: string): void {
  parts.statusEl.removeClass(...PHASE_CLASSES);
  parts.iconEl.empty();
  if (phase === "idle") {
    if (parts.idleIcon !== null) setIcon(parts.iconEl, parts.idleIcon);
  } else {
    parts.statusEl.addClass(`is-${phase}`);
    setIcon(parts.iconEl, PHASE_ICON[phase]);
  }
  parts.labelEl.setText(text);
  parts.statusEl.setAttribute("aria-label", text);
}

/** Styles des Bausteins; Konsumenten kopieren die Konstante wortgleich in ihre `styles.css` (Kit-Vertrag). Nur Theme-Variablen; das Symbol trägt die Farbe, der Text bleibt gedämpft. */
export const STATUS_INDICATOR_CSS = `
.okit-status { display: flex; gap: var(--size-2-2); align-items: center; font-size: var(--font-ui-small); color: var(--text-muted); }
.okit-status-icon { display: inline-flex; align-items: center; }
.okit-status-icon svg { width: 14px; height: 14px; }
.okit-status.is-ok .okit-status-icon { color: var(--text-success); }
.okit-status.is-error .okit-status-icon { color: var(--text-error); }
.okit-status.is-warning .okit-status-icon { color: var(--text-warning); }
.okit-status.is-checking .okit-status-icon svg { animation: okit-status-spin 1.2s linear infinite; }
@keyframes okit-status-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .okit-status.is-checking .okit-status-icon svg { animation: none; } }
`;
