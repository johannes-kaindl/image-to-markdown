// vendored from obsidian-kit@0.45.0, src/obsidian/collapsible.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { setIcon } from "obsidian";

/** Optionaler Persistenz-Callback für den Auf-/Zu-Zustand. Der Consumer verdrahtet ihn
 *  an seinen eigenen Speicher (z. B. data.json); das Kit bleibt storage-agnostisch. */
export interface CollapsibleStorage {
  /** Persistierter Zustand, oder `undefined` wenn für den Key noch nichts gespeichert ist
   *  (dann greift `defaultCollapsed`). */
  getCollapsed(key: string): boolean | undefined;
  setCollapsed(key: string, collapsed: boolean): void;
}

export interface CollapsibleOptions {
  /** Sichtbarer Sektions-Titel (im setHeading-Look). */
  title: string;
  /** Startzustand ohne persistierten Wert. Default: true (eingeklappt). */
  defaultCollapsed?: boolean;
  /** Stabiler Schlüssel für die Persistenz (nur mit storage wirksam). */
  key?: string;
  storage?: CollapsibleStorage;
}

/** Löst den initialen Collapsed-Zustand auf: persistierter Wert falls gesetzt, sonst
 *  defaultCollapsed (so wirkt ein per-Sektion-Default beim ersten Mal und wird danach vom
 *  gespeicherten User-Zustand abgelöst). Pure — kein DOM.
 *  @example resolveCollapsed("chat", true, undefined) // → true (kein storage)
 *  @example resolveCollapsed("chat", true, { getCollapsed: () => false, setCollapsed(){} }) // → false
 *  @example resolveCollapsed("chat", false, { getCollapsed: () => undefined, setCollapsed(){} }) // → false (kein gespeicherter Wert → default) */
export function resolveCollapsed(key: string | undefined, defaultCollapsed: boolean, storage?: CollapsibleStorage): boolean {
  const stored = key && storage ? storage.getCollapsed(key) : undefined;
  return stored ?? defaultCollapsed;
}

/** Rendert eine einklappbare Sektion (klickbarer Header + Body) in containerEl und gibt den
 *  Body-Container zurück — der Consumer baut seine Inhalte dort hinein. Startet eingeklappt
 *  (bzw. gemäß storage). Erstes obsidian-gekoppeltes Kit-UI-Modul.
 *  @example const body = collapsibleSection(el, { title: "Chat" }); body.createEl("input"); */
export function collapsibleSection(containerEl: HTMLElement, opts: CollapsibleOptions): HTMLElement {
  const defaultCollapsed = opts.defaultCollapsed ?? true;
  let collapsed = resolveCollapsed(opts.key, defaultCollapsed, opts.storage);

  const section = containerEl.createDiv({ cls: "okit-collapsible" });
  const header = section.createDiv({ cls: "okit-collapsible-header" });
  // a11y: der Header ist funktional ein Aufklapp-Schalter — fokussierbar + rollen-/
  // zustands-annotiert, damit er per Tastatur und von Screenreadern bedienbar ist.
  header.setAttribute("role", "button");
  header.setAttribute("tabindex", "0");
  const chevron = header.createSpan({ cls: "okit-collapsible-chevron" });
  header.createSpan({ cls: "okit-collapsible-title", text: opts.title });
  const body = section.createDiv({ cls: "okit-collapsible-body" });

  const apply = (): void => {
    setIcon(chevron, collapsed ? "chevron-right" : "chevron-down");
    header.setAttribute("aria-expanded", String(!collapsed));
    body.toggleClass("is-collapsed", collapsed);
    section.toggleClass("is-collapsed", collapsed);
  };
  apply();

  const toggle = (): void => {
    collapsed = !collapsed;
    if (opts.key && opts.storage) opts.storage.setCollapsed(opts.key, collapsed);
    apply();
  };

  header.addEventListener("click", () => { toggle(); });
  header.addEventListener("keydown", (evt: KeyboardEvent) => {
    // Enter/Leertaste sind die Standard-Aktivierung eines role="button"; bei der Leertaste
    // sonst scrollt die Seite, daher preventDefault (bei Enter unschädlich).
    if (evt.key === "Enter" || evt.key === " ") {
      evt.preventDefault();
      toggle();
    }
  });

  return body;
}

/** CSS-Snippet (nur Theme-Variablen) — der Consumer übernimmt es in seine styles.css.
 *  Das Kit injiziert bewusst kein CSS selbst (asset-/seiteneffektfrei). */
export const COLLAPSIBLE_CSS = `
.okit-collapsible-header {
  display: flex; align-items: center; gap: var(--size-4-2);
  cursor: pointer; padding: var(--size-4-2) 0;
  font-weight: var(--font-semibold); color: var(--text-normal);
  border-bottom: 1px solid var(--background-modifier-border);
}
.okit-collapsible-header:hover { color: var(--text-accent); }
.okit-collapsible-header:focus-visible {
  outline: 2px solid var(--interactive-accent);
  outline-offset: 2px;
  border-radius: var(--radius-s);
}
.okit-collapsible-chevron { display: inline-flex; color: var(--text-muted); }
.okit-collapsible-body { padding-top: var(--size-4-2); }
.okit-collapsible-body.is-collapsed { display: none; }
`.trim();
