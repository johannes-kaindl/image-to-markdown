# Sidebar-UI-Politur Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vier theme-treue optische Aufräum-Punkte in der IMG→MD-Sidebar — Lucide-`brain`-Icon statt 💭-Emoji, mittig gekürzte Dateinamen, `file-plus`-Icon am „Notiz anlegen"-Button, ruhigere Abstände — ohne Funktionsänderung.

**Architecture:** Reiner Präsentations-Eingriff. Ein neuer reiner Helfer `truncateMiddle` in `src/img_to_md.ts`; der Rest sind Icon-/Struktur-/CSS-Änderungen in `src/img_to_md_view.ts`, `src/i18n.ts`, `styles.css`. Die nach der View-Performance-Arbeit gebaute idempotente `updateCard`-Methode wird verträglich erweitert: Icons leben in eigenen Spans, sodass das pro-Token-`setText` nur Text-Spans trifft und Icons stabil bleiben.

**Tech Stack:** TypeScript (strict), Obsidian Plugin API (`setIcon`), vitest + happy-dom + `obsidian-kit/testing`-Mock, esbuild.

## Global Constraints

- **Kein `font-family` in `styles.css`** — der Monospace ist das Theme des Nutzers; das Plugin erbt die Schrift (Override bräche andere Themes + Community-Review-Bot). Diese Datei darf nach der Arbeit weiterhin **keine** `font-family`-Regel enthalten.
- **Reiner Präsentations-Eingriff:** nur `src/img_to_md_view.ts`, `src/i18n.ts`, `styles.css`, `src/img_to_md.ts` (additiver Helfer), plus `tests/img_to_md.test.ts` und `tests/img_to_md_view.test.ts`. `src/img_to_md_state.ts` und der übrige Kern bleiben unberührt. Keine Funktionsänderung.
- **i18n via `t()`:** `view.thinking`/`view.thoughts` verlieren nur das Emoji (EN + DE), bleiben reine Strings; keine neuen UI-Strings.
- **Keine neuen Obsidian-APIs** außer `setIcon` (in `img_to_md_view.ts` bereits importiert/genutzt). `minAppVersion` bleibt 1.8.7.
- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen.
- **Tests grün:** `npm test`; `npm run typecheck`/`lint`/`build` sauber. Bestehende Tests bleiben unverändert grün (keiner prüft die Emoji-Strings, den Summary-Text oder den Button-Text exakt — verifiziert).
- **Commits:** Conventional Commits (deutsche Beschreibung erlaubt), **nur berührte Dateien stagen**, Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Zeilennummern sind Stand vor Task 1.** Alle drei Tasks editieren dieselbe Methode `updateCard` in `img_to_md_view.ts`, sodass sich Zeilen durch frühere Tasks verschieben. Finde den jeweiligen Block immer per **Inhalt** (Kartenkopf-Aufbau / `if (card.reasoning)`-Block / `done`-Zweig des Write-Buttons), nicht per fixer Zeile.

---

### Task 1: `truncateMiddle`-Helfer + gekürzte Dateinamen im Karten-Kopf

**Files:**
- Modify: `src/img_to_md.ts` (neuer Export `truncateMiddle`, nach `extOf`/`classifySource`)
- Modify: `src/img_to_md_view.ts` (Import + Anwendung in `updateCard`-Kartenkopf, ~Z. 215-218)
- Test: `tests/img_to_md.test.ts` (neuer `describe`-Block), `tests/img_to_md_view.test.ts` (neuer `it`)

**Interfaces:**
- Produces: `export function truncateMiddle(name: string, max: number): string`

- [ ] **Step 1: Failing-Test für `truncateMiddle`** — am Ende von `tests/img_to_md.test.ts` ergänzen (Import von `truncateMiddle` aus `../src/img_to_md` zur bestehenden Import-Zeile hinzufügen):

```ts
describe("truncateMiddle", () => {
  it("lässt Namen <= max unverändert", () => {
    expect(truncateMiddle("foto.png", 20)).toBe("foto.png");
    expect(truncateMiddle("foto.png", 8)).toBe("foto.png");   // genau max
  });
  it("kürzt lange Namen mittig: Gesamtlänge = max, Ellipsis enthalten, Endung bleibt", () => {
    const long = "9E894F8A-1C01-4CCF-96C9-AAB2A290C2CB.jpeg";   // 42 Zeichen
    const r = truncateMiddle(long, 24);
    expect(r.length).toBe(24);
    expect(r).toContain("…");
    expect(r.startsWith("9E894F8A")).toBe(true);
    expect(r.endsWith(".jpeg")).toBe(true);
  });
  it("Edge: max <= 1 ergibt nur die Ellipsis", () => {
    expect(truncateMiddle("abcdef", 1)).toBe("…");
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npx vitest run tests/img_to_md.test.ts -t "truncateMiddle"`
Expected: FAIL — `truncateMiddle is not a function` / `is not exported`.

- [ ] **Step 3: `truncateMiddle` implementieren** — in `src/img_to_md.ts` nach der `classifySource`-Funktion (nach Z. 22) einfügen:

```ts
/** Kürzt einen Namen mittig auf genau max Zeichen: "anfang…ende" (Ellipsis = 1 Zeichen).
 *  name.length <= max bleibt unverändert; max <= 1 ergibt nur "…". Das Namensende
 *  (inkl. Endung) bleibt soweit erhalten, wie der Tail-Anteil reicht. */
export function truncateMiddle(name: string, max: number): string {
  if (name.length <= max) return name;
  if (max <= 1) return "…";
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return name.slice(0, head) + "…" + name.slice(name.length - tail);
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npx vitest run tests/img_to_md.test.ts -t "truncateMiddle"`
Expected: PASS (3 Tests).

- [ ] **Step 5: Failing-Test für die Karten-Kopf-Anwendung** — am Ende des `describe("ImgToMdView — Transkribieren")`-Blocks in `tests/img_to_md_view.test.ts` ergänzen:

```ts
  it("kürzt lange Dateinamen im Karten-Kopf (Ellipsis)", async () => {
    const longItem: ImgItem = { raw: "", link: "9E894F8A-1C01-4CCF-96C9-AAB2A290C2CB-2026-06-28-14.23.34.jpeg", ext: "jpeg", supported: true, kind: "image" };
    const { view } = mkView({ scan: async () => [longItem] });
    await view.onOpen(); await view.run();
    const head = all(view.contentEl, "img2md-card-head")[0].textContent ?? "";
    expect(head).toContain("…");
    expect(head).toContain("Image 1/1");
    expect(head.length).toBeLessThan(longItem.link.length);   // deutlich kürzer als der volle Name
  });
```

- [ ] **Step 6: Test ausführen, Fehlschlag bestätigen**

Run: `npx vitest run tests/img_to_md_view.test.ts -t "kürzt lange Dateinamen"`
Expected: FAIL — kein „…" im Kopf (heute steht der volle Name).

- [ ] **Step 7: `truncateMiddle` im Karten-Kopf anwenden**

In `src/img_to_md_view.ts` die Import-Zeile für den Kern ergänzen (nach der bestehenden `img_to_md_state`-Import-Zeile):

```ts
import { truncateMiddle } from "./img_to_md";
```

Den Kartenkopf-Aufbau in `updateCard` (aktuell Z. 215-218) ersetzen durch:

```ts
      const name = truncateMiddle(this.basename(card.item.link), 32);
      const head = card.page != null
        ? t("view.cardHeadPage", name, card.page, card.total)
        : t("view.cardHead", card.index, card.total, name);
      const headEl = cardEl.createDiv({ cls: "img2md-card-head", text: head });
```

- [ ] **Step 8: Tests ausführen, Erfolg bestätigen**

Run: `npx vitest run tests/img_to_md_view.test.ts`
Expected: PASS — neuer Test grün, bestehende (`a.png`-Kopf: „Image 1/1" + „a.png", da `truncateMiddle("a.png",32)==="a.png"`) unverändert grün.

- [ ] **Step 9: Volle Gates + Commit**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: alle grün.

```bash
git add src/img_to_md.ts src/img_to_md_view.ts tests/img_to_md.test.ts tests/img_to_md_view.test.ts
git commit -m "feat(view): lange Dateinamen im Karten-Kopf mittig kürzen (truncateMiddle)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `brain`-Icon am Reasoning-Block (statt 💭-Emoji)

Entfernt das Emoji aus den i18n-Strings und baut die `<summary>` so um, dass ein eigenes Icon-Span (`brain`) neben einem Text-Span steht. Die `CardRefs`-Referenz für den Summary-Text wird von `reasoningSum` (ganze Summary) auf `reasoningLbl` (nur Text-Span) umgestellt, damit das pro-Token-`setText` das Icon nicht überschreibt.

**Files:**
- Modify: `src/i18n.ts` (Emoji aus `view.thinking`/`view.thoughts`, EN + DE)
- Modify: `src/img_to_md_view.ts` (`CardRefs.reasoningSum` → `reasoningLbl`; Summary-Aufbau + `setText`-Ziel in `updateCard`)
- Modify: `styles.css` (Icon im Summary)
- Test: `tests/img_to_md_view.test.ts` (neuer `it`)

**Interfaces:**
- Consumes: `setIcon` (bereits importiert), `CardRefs` aus der View-Performance-Arbeit.
- Produces: `CardRefs.reasoningLbl?: HTMLElement` (ersetzt `reasoningSum`).

- [ ] **Step 1: Failing-Test schreiben** — am Ende des `describe("ImgToMdView — Transkribieren")`-Blocks in `tests/img_to_md_view.test.ts`:

```ts
  it("reasoning-Block trägt ein brain-Icon getrennt vom Label-Text", async () => {
    const v = mkView({ transcribeStream: async (_sp: string, _it: ImgItem, onC: any, onR: any) => { onR("denkt"); onC("Text"); return { content: "Text", reasoning: "denkt", model: "vm" }; } });
    await v.view.onOpen(); await v.view.run();
    const icons = all(v.view.contentEl, "img2md-reasoning-icon");
    expect(icons.length).toBe(1);
    expect(icons[0].getAttribute("data-icon")).toBe("brain");
    const lbl = all(v.view.contentEl, "img2md-reasoning-lbl");
    expect(lbl.length).toBe(1);
    expect(lbl[0].textContent).toContain("Thoughts");   // EN-Label nach Content, ohne Emoji
    expect(lbl[0].textContent).not.toContain("💭");
  });
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npx vitest run tests/img_to_md_view.test.ts -t "brain-Icon getrennt"`
Expected: FAIL — kein `img2md-reasoning-icon` (Summary trägt heute nur Emoji-Text).

- [ ] **Step 3: Emoji aus den i18n-Strings entfernen**

In `src/i18n.ts` vier Werte ändern (EN-Block):
```ts
  "view.thinking": "thinking…",
  "view.thoughts": "Thoughts",
```
(DE-Block):
```ts
  "view.thinking": "denkt nach…",
  "view.thoughts": "Gedanken",
```

- [ ] **Step 4: `CardRefs` umbenennen + Summary umbauen**

In `src/img_to_md_view.ts` im `interface CardRefs` das Feld umbenennen:
```ts
  reasoningLbl?: HTMLElement;   // war: reasoningSum
```

Den Reasoning-Block in `updateCard` (aktuell Z. 224-241) ersetzen durch:

```ts
    if (card.reasoning) {
      if (!refs.reasoningDet) {
        const det = cardEl.createEl("details", { cls: "img2md-reasoning" });
        det.open = live;
        const sum = det.createEl("summary", { cls: "img2md-reasoning-sum" });
        const icon = sum.createSpan({ cls: "img2md-reasoning-icon" });
        setIcon(icon, "brain");
        const lbl = sum.createSpan({ cls: "img2md-reasoning-lbl" });
        const body = det.createDiv({ cls: "img2md-reasoning-body" });
        refs.reasoningDet = det; refs.reasoningLbl = lbl; refs.reasoningBody = body;
        refs.liveWas = live;
      }
      refs.reasoningLbl!.setText(live ? t("view.thinking") : t("view.thoughts"));
      refs.reasoningBody!.setText(card.reasoning);
      // Einmaliger Auto-Collapse beim Übergang live -> nicht-live; danach gehört .open dem User.
      if (refs.liveWas && !live && !refs.autoCollapsed) {
        refs.reasoningDet.open = false;
        refs.autoCollapsed = true;
      }
      refs.liveWas = live;
    }
```

- [ ] **Step 5: Test ausführen, Erfolg bestätigen**

Run: `npx vitest run tests/img_to_md_view.test.ts -t "brain-Icon getrennt"`
Expected: PASS. Danach die ganze Datei: `npx vitest run tests/img_to_md_view.test.ts` — alle grün (die Reasoning-/Toggle-Tests aus der View-Performance-Arbeit bleiben grün, da `.open`-Logik unverändert ist).

- [ ] **Step 6: CSS für das Summary-Icon** — in `styles.css` die Zeile `.img2md-reasoning-sum { … }` ersetzen und zwei Regeln ergänzen:

```css
.img2md-reasoning-sum { color: var(--text-muted); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
.img2md-reasoning-icon { display: inline-flex; align-items: center; }
.img2md-reasoning-icon svg { width: 14px; height: 14px; }
```

- [ ] **Step 7: Volle Gates + Commit**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: alle grün; **`grep -c font-family styles.css` ergibt 0**.

```bash
git add src/i18n.ts src/img_to_md_view.ts styles.css tests/img_to_md_view.test.ts
git commit -m "feat(view): brain-Icon statt 💭-Emoji am Reasoning-Block

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `file-plus`-Icon am Notiz-Button + Abstands-Feinschliff

**Files:**
- Modify: `src/img_to_md_view.ts` (Write-Button-Aufbau in `updateCard`, aktuell Z. 266-269)
- Modify: `styles.css` (Button-Icon-Ausrichtung + Spacing)
- Test: `tests/img_to_md_view.test.ts` (neuer `it`)

**Interfaces:**
- Consumes: `setIcon`, `updateCard` aus Task 2.

- [ ] **Step 1: Failing-Test schreiben** — am Ende des `describe("ImgToMdView — Transkribieren")`-Blocks in `tests/img_to_md_view.test.ts`:

```ts
  it("Notiz-anlegen-Button trägt ein file-plus-Icon neben dem Label", async () => {
    const { view } = mkView(); await view.onOpen(); await view.run();
    const icon = all(view.contentEl, "img2md-write-icon");
    expect(icon.length).toBe(1);
    expect(icon[0].getAttribute("data-icon")).toBe("file-plus");
    const lbl = all(view.contentEl, "img2md-write-lbl");
    expect(lbl[0].textContent).toBe("Create note");
  });
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npx vitest run tests/img_to_md_view.test.ts -t "file-plus-Icon"`
Expected: FAIL — kein `img2md-write-icon` (Button ist heute reiner Text).

- [ ] **Step 3: Write-Button mit Icon + Label aufbauen**

In `src/img_to_md_view.ts` den `done`-Zweig des Write-Buttons (aktuell Z. 266-269) ersetzen durch:

```ts
      if (card.status === "done" && !refs.writeBtn) {
        const wb = refs.actionsEl.createEl("button", { cls: "img2md-write" });
        const wbIcon = wb.createSpan({ cls: "img2md-write-icon" });
        setIcon(wbIcon, "file-plus");
        wb.createSpan({ cls: "img2md-write-lbl", text: t("view.createNote") });
        wb.addEventListener("click", () => void this.writeOne(i));
        refs.writeBtn = wb;
      } else if (card.status !== "done" && refs.writeBtn) {
```

(Der `else if`-Zweig darunter bleibt unverändert.)

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npx vitest run tests/img_to_md_view.test.ts -t "file-plus-Icon"`
Expected: PASS. Danach `npx vitest run tests/img_to_md_view.test.ts` — alle grün (der bestehende „Notiz anlegen ruft writeTranscripts"-Test klickt `img2md-write` und bleibt grün, da der Button die Klasse + den Listener behält).

- [ ] **Step 5: CSS — Button-Icon-Ausrichtung + Abstands-Feinschliff**

In `styles.css` die Zeile `.img2md-write { font-size: 12px; }` ersetzen und eine Regel ergänzen:

```css
.img2md-write { font-size: 12px; display: inline-flex; align-items: center; gap: 4px; }
.img2md-write-icon { display: inline-flex; align-items: center; }
.img2md-write-icon svg { width: 14px; height: 14px; }
```

Für ruhigere Abstände im Kopfbereich die fünf `margin: 6px`-Werte auf die Theme-Spacing-Variable umstellen (mehr Luft, keine Magic Number). Ersetze jeweils:
- `.img2md-status { … margin-bottom: 6px; … }` → `margin-bottom: var(--size-4-2);`
- `.img2md-list { … margin-bottom: 6px; … }` → `margin-bottom: var(--size-4-2);`
- `.img2md-model-row { … margin-bottom: 6px; }` → `margin-bottom: var(--size-4-2);`
- `.img2md-head { … margin-bottom: 6px; }` → `margin-bottom: var(--size-4-2);`
- `.img2md-foot { … margin-top: 6px; }` → `margin-top: var(--size-4-2);`

- [ ] **Step 6: Volle Gates + Commit**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: alle grün; **`grep -c font-family styles.css` ergibt 0**.

```bash
git add src/img_to_md_view.ts styles.css tests/img_to_md_view.test.ts
git commit -m "feat(view): file-plus-Icon am Notiz-Button + Abstands-Feinschliff

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Verifikation am Gerät (nach allen Tasks)

`npm run deploy`, Obsidian neu laden:
- `brain`-Icon am Gedanken-Block (statt 💭); klappt weiterhin korrekt auf/zu.
- Lange iOS-Dateinamen im Karten-Kopf mittig gekürzt (`…`), kein 2-zeiliger Umbruch.
- „Notiz anlegen" und Copy tragen beide ein Icon; Aktionszeile wirkt stimmig.
- Kopfbereich (Status/Modell/Liste) hat etwas mehr Luft.
- Schrift unverändert (Theme); Streaming-/Toggle-Verhalten unverändert.
