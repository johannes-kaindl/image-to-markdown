# Design: Sidebar-UI-Politur (theme-treu)

**Datum:** 2026-06-28
**Status:** Entwurf
**Scope:** Rein optische Aufräum-Politur der IMG→MD-Sidebar — Lucide-Icon statt Emoji, gekürzte Dateinamen, konsistente Action-Buttons, ruhigere Abstände. Keine Funktionsänderung.

---

## 1. Motivation

Die Sidebar wirkt im Betrieb roh/„hacky" (User-Feedback am Gerät, Screenshot 2026-06-28). Analyse der Ursachen:

- **Der Terminal-/Monospace-Eindruck kommt vom Theme des Nutzers, nicht vom Plugin.** `styles.css` enthält **keine** `font-family`-Regel; das Plugin erbt die Theme-Schrift, und auch die nativen Obsidian-Buttons sind beim Nutzer Monospace. Ein `font-family`-Override im Plugin wäre falsch: er bräche bei anderen Themes und der Obsidian-Community-Review-Bot flaggt solche Overrides. **Schrift bleibt theme-geerbt — ausdrücklich kein Eingriff.**
- Was das Plugin **theme-treu** verbessern kann, sind vier konkrete Rohheiten: das 💭-Emoji am Reasoning-Block, die voll ausgeschriebenen (umbrechenden) iOS-UUID-Dateinamen im Karten-Kopf, die Stil-Inkonsistenz zwischen Icon-only-Copy und Text-Button „Notiz anlegen", und gedrängte Abstände im Kopfbereich.

## 2. Scope

### Diese Spec
1. **Reasoning-Icon:** 💭-Emoji → Lucide-`brain`-Icon.
2. **Dateinamen-Kürzung:** lange Namen im Karten-Kopf mittig kürzen.
3. **Action-Button-Konsistenz:** „Notiz anlegen" bekommt ein führendes Lucide-Icon.
4. **Abstände/Hierarchie:** ruhigeres Spacing im Kopfbereich über Theme-Variablen.

### Bewusst NICHT (YAGNI / kein Plugin-Thema)
- **Kein `font-family`-Override** — der Monospace ist das Theme des Nutzers; Schriftwechsel ist eine Obsidian-Appearance-Einstellung, kein Plugin-Code.
- **Kein gerendertes Markdown** statt Rohtext-Transkript, kein Karten-Layout-Redesign, keine Umstrukturierung — das wäre der separat abgewählte „größere Redesign"-Strang.
- **Keine** Änderung an `renderList()` über das hinaus, was Punkt 4 (Spacing) berührt.

## 3. Architektur / Umsetzung

Reiner View-/Präsentations-Eingriff. Betroffene Dateien: `src/img_to_md_view.ts`, `src/i18n.ts`, `styles.css`, plus ein neuer reiner Helfer in `src/img_to_md.ts` (+ Test).

### 3.1 Reasoning-Icon (💭 → `brain`)

Heute trägt der `<summary>` reinen Text inkl. Emoji (`view.thinking` = „💭 thinking…"). Künftig:

- **i18n:** Emoji aus `view.thinking`/`view.thoughts` entfernen (EN + DE), z.B. „thinking…"/„Thoughts" bzw. „denkt nach…"/„Gedanken". Reiner Text.
- **Summary-Struktur:** Beim Anlegen des `<details>` bekommt die `<summary>` zwei Kinder: einen Icon-Span (`img2md-reasoning-icon`, via `setIcon(span, "brain")`) und einen Text-Span (`img2md-reasoning-lbl`). Die `CardRefs.reasoningSum`-Referenz zeigt künftig auf den **Text-Span**, nicht auf die ganze `<summary>`.
- **Lebenszyklus-Verträglichkeit (load-bearing):** Der in der View-Performance-Arbeit gebaute `updateCard` ruft `refs.reasoningSum.setText(live ? thinking : thoughts)` bei jedem Update. Indem `reasoningSum` auf den Text-Span zeigt, ersetzt `setText` nur den Text — der Icon-Span bleibt unangetastet und stabil über den ganzen Lebenszyklus.
- **CSS:** `.img2md-reasoning-icon svg { width: 14px; height: 14px; }` + `color: var(--text-muted)`, vertikal zentriert mit dem Text (analog zu `.img2md-status-icon`). Der `<summary>` wird zu einem inline-flex mit kleinem Gap.

### 3.2 Dateinamen mittig kürzen

Neuer reiner Helfer in `src/img_to_md.ts`:

```ts
/** Kürzt einen Namen mittig auf höchstens max Zeichen: "anfang…endung".
 *  Ist der Name kürzer/gleich, bleibt er unverändert. */
export function truncateMiddle(name: string, max: number): string
```

- Regel: bei `name.length <= max` unverändert; sonst Anfang + „…" + Ende so verteilen, dass die Gesamtlänge `max` ist und das Dateiende (inkl. Endung) erhalten bleibt. Genaue Aufteilung und der Edge-Fall sehr kleiner `max` werden im Plan mit Tests fixiert.
- **Anwendung:** im Karten-Kopf (`view.cardHead`/`view.cardHeadPage` bekommen den gekürzten `basename`). Die Bild-Liste (`.img2md-name`) hat bereits CSS-Ellipsis und bleibt unverändert.

### 3.3 Action-Button-Konsistenz

„Notiz anlegen" (`img2md-write`) bekommt ein führendes Lucide-Icon (`file-plus`) vor dem Text, sodass beide Action-Buttons (Copy-Icon + Notiz) ein Icon tragen. Die Hierarchie bleibt bewusst erhalten: „Notiz anlegen" ist der prominente Text-Button (Primäraktion), Copy der dezente Icon-Button (Sekundäraktion). CSS richtet beide auf gleicher Grundlinie aus (inline-flex, Gap, gleiche Höhe).

### 3.4 Abstände / Hierarchie

Feintuning in `styles.css` mit Obsidian-Spacing-Variablen (z.B. `var(--size-4-2)`): etwas mehr Luft zwischen Status-, Modell-, Listen- und Karten-Block; konsistente Gaps; der Karten-Kopf dezenter. Keine Struktur-, nur Abstandsänderungen. Exakte Werte im Plan.

## 4. Tests

- **`truncateMiddle`** (reiner Kern): unverändert bei kurzem Namen; mittige Kürzung bei langem Namen; Endung bleibt erhalten; Gesamtlänge ≤ `max`. Unit-Tests in `tests/img_to_md.test.ts`.
- **Reasoning-Icon (View):** nach einem Lauf mit Reasoning hat die Summary einen Icon-Span mit `data-icon="brain"` **und** einen Text-Span mit dem Label; ein Folge-`updateCard` (Status-/Text-Wechsel) lässt den Icon-Span bestehen (Icon nicht verloren).
- **Notiz-Button-Icon (View):** der `img2md-write`-Button trägt `data-icon="file-plus"`.
- **Karten-Kopf (View):** bei langem Dateinamen erscheint die gekürzte Form (`…`) im `img2md-card-head`.
- **Bestehende Tests bleiben grün:** keiner prüft die Emoji-Strings oder den Summary-Text exakt (verifiziert: i18n-Tests prüfen andere Keys; View-Tests prüfen `img2md-reasoning`-Existenz und `.open`). Spacing/Button-CSS ist nicht unit-testbar → Geräte-Abnahme.

## 5. Definition of Done

- `npm test` grün (inkl. neue Tests), `npm run typecheck`/`lint`/`build` sauber.
- **Kein `font-family` in `styles.css`** (Theme-Treue bewahrt); `minAppVersion` unverändert 1.8.7; keine neuen Obsidian-APIs außer `setIcon` (bereits genutzt).
- Geräte-Abnahme in Obsidian: `brain`-Icon am Reasoning-Block, gekürzte Dateinamen, beide Action-Buttons mit Icon, ruhigere Abstände — und das Streaming-/Toggle-Verhalten aus der View-Performance-Arbeit unverändert.
