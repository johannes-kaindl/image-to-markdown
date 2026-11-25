// vendored from obsidian-kit@0.111.0, src/obsidian/choice-modal.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { App, ButtonComponent, Modal } from "obsidian";

export interface ChoiceOption<T extends string> {
  /** Was `askChoice` bei dieser Wahl liefert. */
  value: T;
  /** Beschriftung des Knopfs (i18n-Plugins reichen `t(...)` durch, das Kit bleibt i18n-frei). */
  label: string;
  /** Hauptknopf (`setCta`). Höchstens einer je Dialog sinnvoll, das Kit erzwingt es nicht. */
  cta?: boolean;
}

export interface ChoiceOptions<T extends string> {
  /** Titelzeile des Dialogs. */
  title: string;
  /** Optionaler Text unter dem Titel: ein Absatz oder eine Zeile je Array-Element. */
  message?: string | string[];
  /** Die Antworten, in dieser Reihenfolge von links nach rechts. */
  options: ChoiceOption<T>[];
  /** Gesetzt → zusätzlicher Abbrechen-Knopf links (liefert `null`). Ohne ihn bricht man mit Esc oder Klick daneben ab. */
  cancelLabel?: string;
  /** Optionaler Körper-Hook: zeichnet eigenes DOM (Diff, Zusammenfassung, Liste) zwischen `message` und die Knopfzeile.
   *  Bekommt das `contentEl` des Dialogs und hängt seine Kinder dort an; Knöpfe, Esc und Auflösung bleiben beim Dialog. */
  render?: (contentEl: HTMLElement) => void;
}

/** Auswahl-Dialog mit drei und mehr Antworten (das Kit-`confirmAction` ist zweiwertig).
 *  Wie `confirmAction`: `finish()` nullt den Callback VOR dem Auflösen (Knopfklick plus nachlaufendes `onClose` lösen sonst doppelt auf),
 *  und `onClose()` löst mit `null` auf (sonst hängt das Promise bei Esc oder Klick daneben).
 *  Knopf-Reihenfolge und Container folgen UI-STANDARD § 2: nativer `modal-button-container`, Abbrechen links, die Antworten rechts davon. */
class ChoiceModal<T extends string> extends Modal {
  private done: ((value: T | null) => void) | null;

  constructor(app: App, private readonly opts: ChoiceOptions<T>, done: (value: T | null) => void) {
    super(app);
    this.done = done;
  }

  onOpen(): void {
    this.titleEl.setText(this.opts.title);
    const message = this.opts.message;
    if (message !== undefined) {
      for (const line of Array.isArray(message) ? message : [message]) this.contentEl.createEl("p", { text: line });
    }
    this.opts.render?.(this.contentEl);
    const btns = this.contentEl.createDiv({ cls: "modal-button-container" });
    if (this.opts.cancelLabel !== undefined) {
      new ButtonComponent(btns).setButtonText(this.opts.cancelLabel).onClick(() => { this.finish(null); });
    }
    for (const option of this.opts.options) {
      const b = new ButtonComponent(btns).setButtonText(option.label).onClick(() => { this.finish(option.value); });
      if (option.cta === true) b.setCta();
    }
  }

  onClose(): void {
    this.finish(null);
    this.contentEl.empty();
  }

  private finish(value: T | null): void {
    if (!this.done) return;
    const cb = this.done;
    this.done = null;
    cb(value);
    this.close();
  }
}

/** Öffnet den Dialog; löst mit dem Wert der gewählten Option auf, mit `null` bei Esc, Klick daneben, Schließen oder dem Abbrechen-Knopf.
 *  @example const wahl = await askChoice(app, { title: "Wohin?", options: [{ value: "neu", label: "Neue Datei", cta: true }, { value: "ersetzen", label: "Ersetzen" }, { value: "anhaengen", label: "Anhängen" }] }); */
export function askChoice<T extends string>(app: App, opts: ChoiceOptions<T>): Promise<T | null> {
  return new Promise((resolve) => {
    new ChoiceModal<T>(app, opts, resolve).open();
  });
}
