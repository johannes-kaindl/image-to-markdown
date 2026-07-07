# v1.1-Rest: Content-aware Gate + CRLF-Diff-Fidelity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den Diff-before-overwrite-Gate (Tier-2 #4, v1) so härten, dass eine manuelle Bearbeitung einer bereits überschriebenen Notiz nicht mehr still verloren geht, und zwei nicht-CRLF-tolerante Regexes fixen (Diff-Kosmetik + ein echter Frontmatter-Datenverlust-Bug bei CRLF-Notizen).

**Architecture:** `sessionOwned: Set<string>` (View) wird zu `sessionOwned: Map<string, string>` (Pfad → zuletzt vom Plugin geschriebener Transkript-Body). Der bisherige `confirm?: boolean`-Parameter wird durch `knownBody?: string` ersetzt — der Core (`writeTranscripts`/`writePdfTranscript`) vergleicht selbst den frisch gelesenen on-disk-Body gegen `knownBody` und gated nur, wenn sie **nicht** übereinstimmen. `writePdfTranscript` gibt dafür zusätzlich den geschriebenen `body` zurück (nötig, weil die View den PDF-Merge-Body nicht selbst kennt — er entsteht erst in `pdf_to_md.ts` aus `separator`/`range`). Für Bilder kennt die View den Body direkt (`card.text.trim()`), dort ist der Rückgabewert unverändert.

**Tech Stack:** TypeScript (strict, `noImplicitAny`) · vitest + happy-dom · Obsidian Plugin API · esbuild.

## Global Constraints

- **TS strict + `noImplicitAny`** — keine `any`-Casts für neue Typen.
- **Reiner Kern ohne obsidian-Imports:** `diff.ts`, `img_to_md.ts`, `pdf_to_md.ts`, `i18n.ts` importieren NICHT `obsidian`. Nur `main.ts`, `img_to_md_view.ts` dürfen `obsidian`/DOM.
- **Keine neuen i18n-Keys** — dieser Zyklus ändert keine nutzersichtbaren Strings (gleiches Modal, gleiche Notice `notice.overwriteSkipped`).
- **Tests:** nach jeder Änderung alle grün (`npm test`) + `npx tsc --noEmit` separat. Ausgangsbasis: 284 Tests grün (Stand 0.9.0).
- **Commits:** Conventional Commits (deutsche Beschreibung erlaubt), nur berührte Dateien stagen. Trailer `Co-Authored-By: Claude <Modellname> <noreply@anthropic.com>` — `<Modellname>` = das für den jeweiligen Task tatsächlich eingesetzte Modell (siehe SDD-Modellzuteilung im Cockpit).
- **Keine Verhaltensänderung außerhalb des Gates:** der tatsächlich auf Platte geschriebene Notiz-Inhalt (Frontmatter-Reihenfolge, Body-Whitespace) bleibt byte-identisch zu v1 — nur die Gate-*Entscheidung* und die CRLF-Toleranz ändern sich.

---

### Task 1: CRLF-Fidelity — `extractTranscriptBody` + `rewriteTranscript` (`src/img_to_md.ts`)

**Files:**
- Modify: `src/img_to_md.ts:91` (`rewriteTranscript`-Frontmatter-Regex), `src/img_to_md.ts:107-108` (`extractTranscriptBody`)
- Test: `tests/img_to_md.test.ts`

**Interfaces:**
- Consumes: nichts Neues.
- Produces: keine Signaturänderung — nur die interne Regex-Toleranz ändert sich, beide Funktionen bleiben `(string) => string` bzw. `(string, {...}) => string`.

- [ ] **Step 1: Write the failing tests**

Füge in `describe("extractTranscriptBody", ...)` (nach der bestehenden letzten `it`, vor der schließenden `});`) hinzu:

```ts
  it("CRLF-Notiz: strippt Frontmatter + Embed-Zeile trotz \\r\\n", () => {
    const note = `---\r\nsource_image: "[[b.png]]"\r\ntranscribed_by: "vm"\r\n---\r\n![[b.png]]\r\n\r\nZeile 1\r\nZeile 2\r\n`;
    expect(extractTranscriptBody(note)).toBe("Zeile 1\r\nZeile 2");
  });
```

Füge in `describe("rewriteTranscript", ...)` (nach der bestehenden letzten `it`, vor der schließenden `});`) hinzu:

```ts
  it("CRLF-Notiz: erhält Frontmatter trotz \\r\\n (kein Datenverlust)", () => {
    const old = `---\r\nsource_image: "[[b.png]]"\r\nsource_note: "[[Quelle]]"\r\ncreated: 2026-01-01\r\ntranscribed_by: "alt"\r\n---\r\n![[b.png]]\r\n\r\nALTER TEXT\r\n`;
    const out = rewriteTranscript(old, { model: "neu", sourceLink: "b.png", body: "NEUER TEXT" });
    expect(out).toContain('source_image: "[[b.png]]"');
    expect(out).toContain('source_note: "[[Quelle]]"');
    expect(out).toContain("created: 2026-01-01");
    expect(out).toContain('transcribed_by: "neu"');
    expect(out).not.toContain('transcribed_by: "alt"');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/img_to_md.test.ts -t "CRLF-Notiz"`
Expected: beide FAIL. Der `extractTranscriptBody`-Test liefert den kompletten unveränderten Input zurück (Regex matcht nicht). Der `rewriteTranscript`-Test scheitert, weil `fm` nicht matcht und der Fallback `transcribed_by: "neu"` OHNE `source_image`/`source_note`/`created` liefert.

- [ ] **Step 3: Fix the regexes**

In `src/img_to_md.ts`, Zeile 91 (`rewriteTranscript`):

```ts
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(old);
```

Zeilen 106-110 (`extractTranscriptBody`):

```ts
export function extractTranscriptBody(note: string): string {
  let s = note.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  s = s.replace(/^!\[\[[^\]]*\]\]\r?\n?/, "");
  return s.trim();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/img_to_md.test.ts`
Expected: alle PASS (bestehende + 2 neue).

- [ ] **Step 5: Commit**

```bash
git add src/img_to_md.ts tests/img_to_md.test.ts
git commit -m "fix(img_to_md): CRLF-tolerante Frontmatter-/Embed-Regex (extractTranscriptBody + rewriteTranscript)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Content-aware Gate in `writeTranscripts` (`src/img_to_md.ts`)

**Files:**
- Modify: `src/img_to_md.ts` (Entry-Typ von `writeTranscripts`, Gate-Logik im `overwritePath`-Zweig)
- Test: `tests/img_to_md.test.ts`

**Interfaces:**
- Consumes: `extractTranscriptBody` (Task 1), `diffLines` (bereits importiert), `rewriteTranscript` (Task 1).
- Produces: `writeTranscripts(io, sourcePath, entries: { raw: string; link: string; content: string; model: string; overwritePath?: string; embed?: boolean; knownBody?: string }[], opts?): Promise<{ paths: (string | null)[] }>` — **`confirm?: boolean` entfällt ersatzlos, `knownBody?: string` ist der neue Name.** Task 4 (View) und Task 5 (main.ts) konsumieren dieses Feld.

- [ ] **Step 1: Write the failing tests**

Ersetze in `tests/img_to_md.test.ts` den kompletten Block von `it("Override mit confirmOverwrite=true …` bis `it("identischer Body …` (Zeilen ca. 189-238, alle vier bestehenden `confirm`-Tests) durch:

```ts
  it("Override ohne knownBody (Erstberührung), confirmOverwrite liefert true → schreibt", async () => {
    const { io, notes } = fakeIO({ notes: [
      ["b (transcript).md", `---\ntranscribed_by: "alt"\n---\n![[b.png]]\n\nALT`],
    ] });
    let seen: any = null;
    io.confirmOverwrite = async (ctx: any) => { seen = ctx; return true; };
    const r = await writeTranscripts(io, "q.md", [
      { raw: "![[b.png]]", link: "b.png", content: "NEU", model: "neu", overwritePath: "b (transcript).md" },
    ]);
    expect(r.paths).toEqual(["b (transcript).md"]);
    expect(seen.path).toBe("b (transcript).md");
    expect(seen.diff).toEqual([{ kind: "del", text: "ALT" }, { kind: "add", text: "NEU" }]);
    expect(notes.get("b (transcript).md")).toContain("NEU");
  });
  it("Override ohne knownBody, confirmOverwrite liefert false → schreibt NICHT, paths[i]=null", async () => {
    const { io, notes } = fakeIO({ notes: [
      ["b (transcript).md", `---\ntranscribed_by: "alt"\n---\n![[b.png]]\n\nALT`],
    ] });
    io.confirmOverwrite = async () => false;
    const r = await writeTranscripts(io, "q.md", [
      { raw: "![[b.png]]", link: "b.png", content: "NEU", model: "neu", overwritePath: "b (transcript).md" },
    ]);
    expect(r.paths).toEqual([null]);
    expect(notes.get("b (transcript).md")).toContain("ALT");
  });
  it("Override mit knownBody === on-disk-Body (Retry-Continuation) → kein Callback, schreibt direkt", async () => {
    const { io, notes } = fakeIO({ notes: [
      ["b (transcript).md", `---\ntranscribed_by: "alt"\n---\n![[b.png]]\n\nALT`],
    ] });
    let called = false;
    io.confirmOverwrite = async () => { called = true; return false; };
    const r = await writeTranscripts(io, "q.md", [
      { raw: "![[b.png]]", link: "b.png", content: "NEU", model: "neu", overwritePath: "b (transcript).md", knownBody: "ALT" },
    ]);
    expect(called).toBe(false);
    expect(r.paths).toEqual(["b (transcript).md"]);
    expect(notes.get("b (transcript).md")).toContain("NEU");
  });
  it("Override mit knownBody ≠ on-disk-Body (manueller Edit dazwischen) → re-gated, Callback aufgerufen", async () => {
    const { io, notes } = fakeIO({ notes: [
      ["b (transcript).md", `---\ntranscribed_by: "alt"\n---\n![[b.png]]\n\nMANUELL BEARBEITET`],
    ] });
    let seen: any = null;
    io.confirmOverwrite = async (ctx: any) => { seen = ctx; return true; };
    const r = await writeTranscripts(io, "q.md", [
      // knownBody "ALT" = was das Plugin zuletzt geschrieben hat; on-disk weicht ab (User hat editiert)
      { raw: "![[b.png]]", link: "b.png", content: "NEU", model: "neu", overwritePath: "b (transcript).md", knownBody: "ALT" },
    ]);
    expect(seen).not.toBeNull();
    expect(seen.diff).toEqual([{ kind: "del", text: "MANUELL BEARBEITET" }, { kind: "add", text: "NEU" }]);
    expect(r.paths).toEqual(["b (transcript).md"]);
    expect(notes.get("b (transcript).md")).toContain("NEU");
  });
  it("identischer Body (Erstberührung) → kein Callback, schreibt", async () => {
    const { io, notes } = fakeIO({ notes: [
      ["b (transcript).md", `---\ntranscribed_by: "alt"\n---\n![[b.png]]\n\nGLEICH`],
    ] });
    let called = false;
    io.confirmOverwrite = async () => { called = true; return true; };
    const r = await writeTranscripts(io, "q.md", [
      { raw: "![[b.png]]", link: "b.png", content: "GLEICH", model: "neu", overwritePath: "b (transcript).md" },
    ]);
    expect(called).toBe(false);
    expect(r.paths).toEqual(["b (transcript).md"]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/img_to_md.test.ts -t "knownBody"`
Expected: FAIL — `knownBody` existiert nicht im Entry-Typ (TS-Fehler beim Build) bzw. die "manueller Edit"-Erwartung schlägt fehl (aktuell gated nur `confirm`, das jetzt fehlt → mit der alten Logik würde ohne `confirm`-Flag NIE gegated, der neue Test würde also KEIN `seen` bekommen).

- [ ] **Step 3: Implement the content-aware gate**

In `src/img_to_md.ts`, ersetze die `writeTranscripts`-Signatur (aktuell Zeile 182-186):

```ts
export async function writeTranscripts(
  io: ImgToMdIO, sourcePath: string,
  entries: { raw: string; link: string; content: string; model: string; overwritePath?: string; embed?: boolean; knownBody?: string }[],
  opts?: { selfSource?: boolean; destDir?: string },
): Promise<{ paths: (string | null)[] }> {
```

Und den `overwritePath`-Zweig (aktuell Zeilen 196-210):

```ts
    if (e.overwritePath) {
      const old = await io.readNote(e.overwritePath);
      const alreadyMatches = e.knownBody !== undefined && extractTranscriptBody(old) === e.knownBody;
      if (!alreadyMatches && io.confirmOverwrite) {
        const diff = diffLines(extractTranscriptBody(old), transcript);
        const changed = diff.some(d => d.kind !== "ctx");
        if (changed && !(await io.confirmOverwrite({ path: e.overwritePath, diff }))) {
          io.notify(t("notice.overwriteSkipped"));
          paths.push(null);
          continue;
        }
      }
      await io.writeNote(e.overwritePath, rewriteTranscript(old, { model: e.model, sourceLink: e.link, body: transcript }));
      paths.push(e.overwritePath);
      continue;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/img_to_md.test.ts`
Expected: alle PASS.

- [ ] **Step 5: Commit**

```bash
git add src/img_to_md.ts tests/img_to_md.test.ts
git commit -m "feat(img_to_md): content-aware Diff-Gate in writeTranscripts (knownBody ersetzt confirm)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Content-aware Gate in `writePdfTranscript` (`src/pdf_to_md.ts`)

**Files:**
- Modify: `src/pdf_to_md.ts` (Signatur/Rückgabetyp von `writePdfTranscript`, Gate-Logik)
- Test: `tests/pdf_to_md.test.ts`

**Interfaces:**
- Consumes: `extractTranscriptBody`, `diffLines`, `rewriteTranscript`, `buildPdfBody` (alle bereits importiert/lokal).
- Produces: `writePdfTranscript(io, sourcePath, source, pages, separator, overwritePath?, embed?, opts?: { selfSource?, destDir?, range?, knownBody?: string }): Promise<{ path: string | null; body: string | null }>` — **Rückgabetyp erweitert um `body`** (der tatsächlich geschriebene, getrimmte Body-String — Task 4/5 brauchen ihn, um `knownBody` für den nächsten Write zu befüllen, da die View den PDF-Merge-Body nicht selbst berechnet).

- [ ] **Step 1: Write the failing tests**

Ersetze in `tests/pdf_to_md.test.ts` den kompletten `describe("confirmOverwrite-Gate", ...)`-Block (Zeilen ca. 228-267) durch:

```ts
  describe("confirmOverwrite-Gate (content-aware, v1.1)", () => {
    function ioWithConfirm(confirmOverwrite: (ctx: { path: string; diff: unknown[] }) => Promise<boolean>) {
      const notes = new Map<string, string>([
        ["q.md", "![[doc.pdf]]"],
        ["doc (PDF transcript).md", `---\nsource_pdf: "[[doc.pdf]]"\ntranscribed_by: "alt"\npages: "1-1"\n---\n![[doc.pdf]]\n\nALT\n`],
      ]);
      const writes: string[] = [];
      const io: any = {
        date: () => "2026-06-29",
        readNote: async (p: string) => notes.get(p) ?? "",
        writeNote: async (p: string, c: string) => { writes.push(p); notes.set(p, c); },
        createNote: async (p: string, c: string) => { notes.set(p, c); },
        noteExists: (p: string) => notes.has(p),
        resolveImage: (l: string) => ({ path: l, ext: "pdf" }),
        notify: () => {},
        confirmOverwrite,
      };
      return { io, notes, writes };
    }

    it("kein knownBody (Erstberührung), Callback liefert false → schreibt nicht, path/body null", async () => {
      const { io, notes, writes } = ioWithConfirm(async () => false);
      const r = await writePdfTranscript(io, "q.md", { raw: "![[doc.pdf]]", link: "doc.pdf" },
        [{ page: 1, content: "NEU", model: "vm" }], "comment", "doc (PDF transcript).md", true,
        { range: { from: 1, to: 1 } });
      expect(r.path).toBeNull();
      expect(r.body).toBeNull();
      expect(writes).not.toContain("doc (PDF transcript).md");
      expect(notes.get("doc (PDF transcript).md")).toContain("ALT");
    });

    it("knownBody === on-disk-Body (Retry-Continuation) → kein Callback, schreibt direkt", async () => {
      let called = false;
      const { io } = ioWithConfirm(async () => { called = true; return false; });
      const r = await writePdfTranscript(io, "q.md", { raw: "![[doc.pdf]]", link: "doc.pdf" },
        [{ page: 1, content: "NEU", model: "vm" }], "comment", "doc (PDF transcript).md", true,
        { range: { from: 1, to: 1 }, knownBody: "ALT" });
      expect(called).toBe(false);
      expect(r.path).toBe("doc (PDF transcript).md");
      expect(r.body).toBe("NEU");
    });

    it("knownBody ≠ on-disk-Body (manueller Edit dazwischen) → re-gated, Callback aufgerufen", async () => {
      let seen: any = null;
      const { io, notes } = ioWithConfirm(async (ctx) => { seen = ctx; return true; });
      const r = await writePdfTranscript(io, "q.md", { raw: "![[doc.pdf]]", link: "doc.pdf" },
        [{ page: 1, content: "NEU", model: "vm" }], "comment", "doc (PDF transcript).md", true,
        { range: { from: 1, to: 1 }, knownBody: "ANDERS" });
      expect(seen).not.toBeNull();
      expect(seen.diff).toEqual([{ kind: "del", text: "ALT" }, { kind: "add", text: "NEU" }]);
      expect(r.path).toBe("doc (PDF transcript).md");
      expect(notes.get("doc (PDF transcript).md")).toContain("NEU");
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/pdf_to_md.test.ts -t "content-aware"`
Expected: FAIL — `opts.knownBody` existiert nicht, `r.body` ist `undefined` statt der erwarteten Werte.

- [ ] **Step 3: Implement — extend return type + content-aware gate**

In `src/pdf_to_md.ts`, ersetze die `writePdfTranscript`-Funktion (aktuell Zeilen 85-133) komplett durch:

```ts
export async function writePdfTranscript(
  io: ImgToMdIO, sourcePath: string,
  source: { raw: string; link: string },
  pages: { page: number; content: string; model: string }[],
  separator: PdfPageSeparator,
  overwritePath?: string,
  embed = true,
  opts?: { selfSource?: boolean; destDir?: string; range?: { from: number; to: number }; knownBody?: string },
): Promise<{ path: string | null; body: string | null }> {
  const self = opts?.selfSource === true;
  const range = opts?.range;
  const withContent = pages.filter(p => p.content.trim()).sort((a, b) => a.page - b.page);
  if (!withContent.length) return { path: null, body: null };   // alles leer/fehlgeschlagen → keine reine Platzhalter-Notiz
  const model = withContent.find(p => p.model)?.model ?? "";
  // pages:-Frontmatter aus der GEWÄHLTEN Range (ehrlich), sonst aus den vorhandenen Seiten (Alt-Verhalten).
  const rangeFrom = range ? range.from : withContent[0].page;
  const rangeTo = range ? range.to : withContent[withContent.length - 1].page;
  const pagesStr = `${rangeFrom}-${rangeTo}`;
  // Bei range alle Seiten durchreichen (buildPdfBody füllt Lücken mit Platzhaltern); sonst nur Inhalt.
  const bodyPages = (range ? pages : withContent).map(p => ({ page: p.page, text: p.content }));
  const body = buildPdfBody(bodyPages, separator, range);
  if (overwritePath) {
    const old = await io.readNote(overwritePath);
    const alreadyMatches = opts?.knownBody !== undefined && extractTranscriptBody(old) === opts.knownBody;
    if (!alreadyMatches && io.confirmOverwrite) {
      const diff = diffLines(extractTranscriptBody(old), body.trim());
      const changed = diff.some(d => d.kind !== "ctx");
      if (changed && !(await io.confirmOverwrite({ path: overwritePath, diff }))) {
        io.notify(t("notice.overwriteSkipped"));
        return { path: null, body: null };
      }
    }
    await io.writeNote(overwritePath, rewriteTranscript(old, { model, sourceLink: source.link, body, pages: pagesStr }));
    return { path: overwritePath, body: body.trim() };
  }
  const sourceName = self ? undefined : basenameNoExt(sourcePath);
  const pdfPath = self ? sourcePath : (io.resolveImage(source.link, sourcePath)?.path ?? source.link);
  const notePath = transcriptNotePath(io, sourcePath, pdfPath, "pdf", opts?.destDir);
  const content = buildPdfNote({
    pdfLink: source.link, sourceName, date: io.date(), model,
    pages: bodyPages, rangeFrom, rangeTo, separator, range,
  });
  await io.createNote(notePath, content);
  if (embed && !self) {
    const before = await io.readNote(sourcePath);
    const replaced = replaceEmbed(before, source.raw, basenameNoExt(notePath));
    if (replaced !== before) await io.writeNote(sourcePath, replaced);
  }
  return { path: notePath, body: body.trim() };
}
```

Hinweis: `body` (untrimmed) wird — wie in v1 — unverändert an `rewriteTranscript` durchgereicht (kein Verhaltensunterschied im geschriebenen Note-Inhalt); nur der **Rückgabewert** `body` ist getrimmt, konsistent mit `extractTranscriptBody`s eigenem `.trim()`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/pdf_to_md.test.ts`
Expected: alle PASS (bestehende Tests prüfen nur `r.path`, bleiben unberührt vom zusätzlichen `body`-Feld).

- [ ] **Step 5: Commit**

```bash
git add src/pdf_to_md.ts tests/pdf_to_md.test.ts
git commit -m "feat(pdf_to_md): content-aware Diff-Gate in writePdfTranscript, body im Rückgabewert

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: View-Wiring — `sessionOwned` als Content-Map (`src/img_to_md_view.ts`)

**Files:**
- Modify: `src/img_to_md_view.ts` (`ImgToMdViewDeps`-Interface, `sessionOwned`-Feld, `writeOne`, `writeAll`, `writePdfGroup`)
- Test: `tests/img_to_md_view.test.ts`

**Interfaces:**
- Consumes: nichts Neues aus dem Kern (die View kennt weiterhin nur `ImgItem`/`card.text`).
- Produces: `ImgToMdViewDeps.writeTranscripts` Entry-Typ nutzt `knownBody?: string` (Task 5/main.ts liest das). `ImgToMdViewDeps.writePdf` gibt `Promise<{ path: string | null; body: string | null }>` zurück statt `Promise<string | null>` und nimmt `knownBody?: string` als letzten Parameter (statt `confirm?: boolean`).

- [ ] **Step 1: Write the failing tests**

In `tests/img_to_md_view.test.ts`, Zeile 25 (`mkView`-Default für `writePdf`), ändere den Rückgabewert auf ein Objekt:

```ts
    writePdf: over.writePdf ?? (async (_sp: string, _raw: string, _link: string, _pages: any[]) => { calls.written.push(_pages); return { path: "doc (PDF transcript).md", body: "body" }; }),
```

Zeile 342, passe die Erwartung an den neuen Feldnamen an:

```ts
    expect(calls.written[0]).toEqual([{ item: ITEMS[0], content: "Hallo", model: "vm", knownBody: undefined }]);
```

In den PDF-View-Tests (Zeilen ca. 506-592) geben alle lokal definierten `writePdf`-Mocks aktuell einen bloßen String zurück — jeweils auf `{ path: ..., body: "body" }` umstellen:

Zeile 526-528 (`fehlgeschlagene Seite`-Test):
```ts
    const writePdf = async (_sp: string, _raw: string, _link: string, pages: any[], _ow?: string, _embed?: boolean, range?: any) => {
      capturedPages = pages; capturedRange = range; return { path: "doc (PDF transcript).md", body: "body" };
    };
```

Zeile 544 (`Range-Edit`-Test):
```ts
    const writePdf = async (_sp: string, _raw: string, _link: string, pages: any[], _ow?: string, _embed?: boolean, range?: any) => { capturedRange = range; capturedPages = pages; return { path: "doc (PDF transcript).md", body: "body" }; };
```

Zeile 562-565 (`Retry-nach-Teil-Write`-Test):
```ts
    const writePdf = async (_sp: string, _raw: string, _link: string, pages: any[], overwritePath?: string, _embed?: boolean, range?: any) => {
      writeCalls.push({ pages: pages.map((p: any) => p.page), overwritePath, range });
      return { path: "doc (PDF transcript).md", body: "body" };
    };
```

Zeile 584 (`alle Seiten fehlgeschlagen`-Test):
```ts
    const writePdf = async () => { writeCount++; return { path: "x.md", body: "body" }; };
```

Ersetze den gesamten `describe("ImgToMdView — Diff-Confirm (Task 7)", ...)`-Block (Zeilen ca. 595-630) durch:

```ts
describe("ImgToMdView — Diff-Confirm + Content-aware Gate (v1.1)", () => {
  it("Override-Erst-Write: kein knownBody; Folge-Retry: knownBody = zuletzt geschriebener Body", async () => {
    const item: ImgItem = { raw: "![[b.png]]", link: "b.png", ext: "png", supported: true, kind: "image", existingTranscriptPath: "b (transcript).md" };
    const knownBodies: (string | undefined)[] = [];
    const { view } = mkView({
      scan: async () => [item],
      writeTranscripts: async (_sp: string, entries: any[]) => { knownBodies.push(entries[0].knownBody); return ["b (transcript).md"]; },
    });
    await view.onOpen();
    // Override-Item: default abgewählt (existingTranscriptPath) → wie im bestehenden "vorhandenes
    // Transkript"-Test erst selektieren (Checkbox-change), bevor run() die Karte erzeugt.
    const cb = all(view.contentEl, "img2md-check")[0];
    (cb._listeners["change"] ?? []).forEach((h: any) => h());
    await view.run();
    await view.writeOne(0);
    (view as any).state.cards[0].status = "done";   // simulierter zweiter Write derselben Notiz
    await view.writeOne(0);
    expect(knownBodies).toEqual([undefined, "Hallo"]);   // "Hallo" = card.text aus dem transcribeStream-Default
  });

  it("PDF-Override: kein knownBody beim ersten Write; Retry bekommt den von writePdf zurückgegebenen body", async () => {
    const item: ImgItem = { raw: "![[doc.pdf]]", link: "doc.pdf", ext: "pdf", supported: true, kind: "pdf", pageCount: 1, range: { from: 1, to: 1 }, existingTranscriptPath: "doc (PDF transcript).md" };
    const knownBodies: (string | undefined)[] = [];
    const writePdf = async (_sp: string, _raw: string, _link: string, _pages: any[], _ow?: string, _embed?: boolean, _range?: any, knownBody?: string) => {
      knownBodies.push(knownBody);
      return { path: "doc (PDF transcript).md", body: "PDF-BODY" };
    };
    const { view } = mkView({ scan: async () => [item], writePdf });
    await view.onOpen();
    const cb = all(view.contentEl, "img2md-check")[0];
    (cb._listeners["change"] ?? []).forEach((h: any) => h());
    await view.run();
    await view.writeAll();
    (view as any).state.cards[0].status = "done";   // simulierter zweiter Write derselben Notiz
    await view.writeAll();
    expect(knownBodies).toEqual([undefined, "PDF-BODY"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/img_to_md_view.test.ts`
Expected: FAIL/TS-Fehler — `ImgToMdViewDeps` erwartet noch `confirm`/bare-string-Rückgabe, `sessionOwned` ist noch ein `Set`.

- [ ] **Step 3: Implement the view wiring**

In `src/img_to_md_view.ts`, Zeilen 27-28 (`ImgToMdViewDeps`):

```ts
  writeTranscripts: (sourcePath: string, entries: { item: ImgItem; content: string; model: string; knownBody?: string }[]) => Promise<(string | null)[]>;
  writePdf: (sourcePath: string, raw: string, link: string, pages: { page: number; content: string; model: string }[], overwritePath?: string, embed?: boolean, range?: { from: number; to: number }, knownBody?: string) => Promise<{ path: string | null; body: string | null }>;
```

Zeilen 57-60 (Feld + Kommentar):

```ts
  /** Notizen-Pfade, die diese Session bereits selbst geschrieben hat, gemappt auf den zuletzt
   *  geschriebenen Transkript-Body — Diff-Confirm-Gate feuert beim ERSTEN Override einer aus dem
   *  Scan vorgefundenen (fremden) Notiz UND erneut, wenn der on-disk-Body inzwischen vom zuletzt
   *  geschriebenen abweicht (z.B. manueller Edit zwischen zwei Writes derselben Session). */
  private sessionOwned = new Map<string, string>();
```

`writePdfGroup` (aktuell Zeilen 409-422):

```ts
  private async writePdfGroup(path: string, g: PdfGroup): Promise<void> {
    if (g.pending || !g.pages.length) return;
    const op = g.item.existingTranscriptPath;
    const knownBody = op ? this.sessionOwned.get(op) : undefined;
    const { path: created, body } = await this.deps.writePdf(
      path, g.raw, g.link,
      g.pages.map(p => ({ page: p.page, content: p.content.trim(), model: p.model })),
      g.item.existingTranscriptPath, g.item.embed, g.range, knownBody,
    );
    if (!created || body === null) return;
    this.sessionOwned.set(created, body);
    if (!g.item.existingTranscriptPath) g.item.existingTranscriptPath = created;
    if (!g.failedPages.length) g.cardIndices.forEach(j => this.state.markWritten(j, created));
  }
```

`writeOne` (aktuell Zeilen 424-439), nur der Bild-Zweig ändert sich:

```ts
  async writeOne(i: number): Promise<void> {
    const path = this.deps.getActivePath();
    const card = this.state.cards[i];
    if (!path || !card || card.status !== "done") return;
    if (card.item.kind === "pdf") {
      const g = partitionDoneCards(this.state.cards).pdfs.find(x => x.raw === card.item.raw);
      if (g) await this.writePdfGroup(path, g);
    } else {
      const op = card.item.existingTranscriptPath;
      const knownBody = op ? this.sessionOwned.get(op) : undefined;
      const transcript = card.text.trim();
      const [created] = await this.deps.writeTranscripts(path, [{ item: card.item, content: transcript, model: card.model, knownBody }]);
      if (created) { this.sessionOwned.set(created, transcript); this.state.markWritten(i, created); }
    }
    this.updateAllCards();
    await this.rescan();
  }
```

`writeAll` (aktuell Zeilen 441-456), nur der Bild-Zweig ändert sich:

```ts
  async writeAll(): Promise<void> {
    const path = this.deps.getActivePath();
    if (!path) return;
    const part = partitionDoneCards(this.state.cards);
    if (part.images.length) {
      const transcripts = part.images.map(x => x.card.text.trim());
      const entries = part.images.map((x, k) => {
        const op = x.card.item.existingTranscriptPath;
        return { item: x.card.item, content: transcripts[k], model: x.card.model, knownBody: op ? this.sessionOwned.get(op) : undefined };
      });
      const paths = await this.deps.writeTranscripts(path, entries);
      part.images.forEach((x, k) => { const p = paths[k]; if (p) { this.sessionOwned.set(p, transcripts[k]); this.state.markWritten(x.cardIndex, p); } });
    }
    for (const g of part.pdfs) await this.writePdfGroup(path, g);
    this.updateAllCards();
    await this.rescan();
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/img_to_md_view.test.ts`
Expected: alle PASS.

- [ ] **Step 5: Commit**

```bash
git add src/img_to_md_view.ts tests/img_to_md_view.test.ts
git commit -m "feat(view): sessionOwned als Content-Map — knownBody statt confirm-Flag durchreichen

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: main.ts — `knownBody` durchreichen, PDF-Rückgabeobjekt weiterreichen

**Files:**
- Modify: `src/main.ts` (Zeilen 185-196, die beiden `ImgToMdViewDeps`-Closures)

**Interfaces:**
- Consumes: `writeTranscripts`/`writePdfTranscript` aus Task 2/3 (`knownBody`-Parameter, `{ path, body }`-Rückgabe von `writePdfTranscript`), `ImgToMdViewDeps` aus Task 4.
- Produces: nichts (main.ts ist reiner Glue, kein weiterer Konsument im Repo).

- [ ] **Step 1: Adjust the two dep closures**

In `src/main.ts`, ersetze Zeilen 185-196:

```ts
      writeTranscripts: async (sourcePath, entries) => {
        const self = classifySource(extOf(sourcePath)) !== null;
        const destDir = self ? this.app.fileManager.getNewFileParent(sourcePath).path : undefined;
        const { paths } = await writeTranscripts(this.makeImgIO(), sourcePath, entries.map(e => ({ raw: e.item.raw, link: e.item.link, content: e.content, model: e.model, overwritePath: e.item.existingTranscriptPath, embed: e.item.embed, knownBody: e.knownBody })), { selfSource: self, destDir });
        return paths;
      },
      writePdf: async (sourcePath, raw, link, pages, overwritePath, embed, range, knownBody) => {
        const self = classifySource(extOf(sourcePath)) !== null;
        const destDir = self ? this.app.fileManager.getNewFileParent(sourcePath).path : undefined;
        const { path, body } = await writePdfTranscript(this.makeImgIO(), sourcePath, { raw, link }, pages, this.settings.pdfPageSeparator, overwritePath, embed, { selfSource: self, destDir, range, knownBody });
        return { path, body };
      },
```

- [ ] **Step 2: Typecheck + Lint + Build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: alle sauber. Kein Test-File für `main.ts` (ungetesteter Glue, konsistent mit allen anderen Wirings) — dieser Schritt ist hier der einzige Verifikations-Backstop.

- [ ] **Step 3: Full test run**

Run: `npm test`
Expected: alle grün (≥ 284 + neue Tests aus Task 1-4).

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat(main): knownBody statt confirm durchreichen, PDF-Rückgabeobjekt {path,body} weiterreichen

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Vollständige Regression + Abschluss

**Files:** keine Code-Änderungen erwartet — reine Verifikation. Falls die Schritte unten Lücken aufdecken, in genau dem betroffenen Task (1-5) nachbessern, nicht hier neuen Code einführen.

- [ ] **Step 1: Volle Test-Suite**

Run: `npm test`
Expected: alle Tests grün (Task 1: +2, Task 2: +1 netto neuer Test ggü. v1 [4 alte ersetzt durch 5 neue], Task 3: +1 netto, Task 4: kein Netto-Zuwachs bei den ersetzten Tests + 0 neue Assertions-Dateien).

- [ ] **Step 2: Typecheck + Lint + Build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: alle sauber, keine `any`-Warnungen in den geänderten Dateien.

- [ ] **Step 3: Grep-Verifikation — keine verwaisten `confirm`-Referenzen**

Run: `grep -rn "confirm" src/ | grep -v confirmOverwrite`
Expected: keine Treffer (der alte `confirm?: boolean`-Parameter ist vollständig durch `knownBody` ersetzt; nur `confirmOverwrite` als Callback-Name bleibt).

- [ ] **Step 4: Commit (falls Step 1-3 Nacharbeiten nötig machten)**

Nur falls Nacharbeiten anfielen:

```bash
git add -A
git commit -m "fix: Nacharbeiten aus der v1.1-Regressionsprüfung

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Abschluss (nach allen Tasks)

- [ ] **Whole-Branch-Review** (adversariell, Opus) — insbesondere: greift der Gate wirklich bei JEDER Divergenz zwischen on-disk und `knownBody` (auch bei nur-whitespace-Änderungen, die `changed` in `diffLines` als `ctx` durchgehen lassen könnte)? Bleibt der PDF-Retry-Continuation-Pfad garantiert gate-frei (kein False-Positive durch die neue `body.trim()`-Rückgabe)? Ist `body === null`-Handling in `writePdfGroup` vollständig (kein `sessionOwned.set(path, null as any)`-Leck)?
- [ ] **Geräte-Abnahme in Obsidian** (Backstop für den neuen Randfall):
  1. Bild mit bestehendem Transkript → Override-Haken → transkribieren → Diff-Modal → „Überschreiben".
  2. Die entstandene Transkript-Notiz **manuell in Obsidian editieren** (z.B. eine Zeile hinzufügen).
  3. Dieselbe Quelle in **derselben Sidebar-Session** erneut transkribieren + überschreiben → Diff-Modal muss **erneut erscheinen** und die manuellen Edits gegen die neue Transkription zeigen (nicht die alte Vision-Ausgabe).
  4. PDF-Partial-Failure-Retry weiterhin OHNE Modal (Regressionscheck aus v1).
- [ ] **Docs:** CHANGELOG-Eintrag (v1.1-Rest schließt den in 0.9.0 dokumentierten Follow-up).
- [ ] **Cockpit** (`§🧭` + Frontmatter) nach Merge nachziehen — v1.1-Rest als erledigt markieren.

## Self-Review (gegen die Spec)

- **Spec-Coverage:** Content-aware Gate Bild (Task 2) · Content-aware Gate PDF inkl. `body`-Rückgabe (Task 3) · View-Map + Wiring (Task 4) · main.ts-Durchreichung (Task 5) · CRLF-Fidelity beide Regex-Stellen (Task 1) · Retry-Continuation-Regression (Tests in Task 2-4) · manueller-Edit-Re-Gate (Tests in Task 2-4). Alle Spec-Punkte aus `2026-07-07-diff-before-overwrite-v1.1-design.md` abgedeckt.
- **Typkonsistenz:** `knownBody?: string` durchgängig gleich benannt in `writeTranscripts`-Entries, `writePdfTranscript`-`opts`, `ImgToMdViewDeps` (beide Methoden), View-internen Aufrufen und main.ts — kein Restvorkommen von `confirm` außerhalb `confirmOverwrite`. `writePdfTranscript`/`ImgToMdViewDeps.writePdf`-Rückgabetyp `{ path: string | null; body: string | null }` identisch in Task 3, 4, 5.
- **Placeholder-Scan:** keine TBD/TODO; jeder Code-Schritt zeigt vollständigen Code.
