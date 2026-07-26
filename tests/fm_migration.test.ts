import { describe, it, expect } from "vitest";
import { diffMappings, isI2mNote, migrateNoteFrontmatter } from "../src/fm_migration";
import { DEFAULT_FM_MAP } from "../src/frontmatter_map";

describe("diffMappings", () => {
  it("leer wenn identisch", () => {
    expect(diffMappings(DEFAULT_FM_MAP, { ...DEFAULT_FM_MAP })).toEqual([]);
  });
  it("erkennt Key-Änderung", () => {
    const next = { ...DEFAULT_FM_MAP, kindKey: "type" };
    expect(diffMappings(DEFAULT_FM_MAP, next)).toEqual([{ field: "kindKey", from: "kind", to: "type" }]);
  });
  it("erkennt Wert-Änderung (kindTranscript)", () => {
    const next = { ...DEFAULT_FM_MAP, kindTranscript: "Transkript" };
    expect(diffMappings(DEFAULT_FM_MAP, next)).toEqual([{ field: "kindTranscript", from: "transcript", to: "Transkript" }]);
  });
  it("mehrere Änderungen", () => {
    const next = { ...DEFAULT_FM_MAP, kindKey: "type", created: "erstellt" };
    expect(diffMappings(DEFAULT_FM_MAP, next)).toHaveLength(2);
  });
});

const T = (fm: string) => `---\n${fm}\n---\n![[a.png]]\n\nBody\n`;

describe("isI2mNote", () => {
  it("Transkript-Notiz erkannt (source_image + kind: transcript)", () => {
    expect(isI2mNote(T(`source_image: "[[a.png]]"\nkind: transcript`), DEFAULT_FM_MAP)).toBe(true);
  });
  it("Beschreibungs-Notiz erkannt (source_image + kind: description)", () => {
    expect(isI2mNote(T(`source_image: "[[a.png]]"\nkind: description`), DEFAULT_FM_MAP)).toBe(true);
  });
  it("PDF-Notiz erkannt (source_pdf)", () => {
    expect(isI2mNote(T(`source_pdf: "[[a.pdf]]"\nkind: transcript`), DEFAULT_FM_MAP)).toBe(true);
  });
  it("Pre-0.13-Notiz ohne kind-Zeile erkannt", () => {
    expect(isI2mNote(T(`source_image: "[[a.png]]"\ncreated: 2026-01-01`), DEFAULT_FM_MAP)).toBe(true);
  });
  it("Fremdnotiz ohne source-Key abgelehnt", () => {
    expect(isI2mNote(T(`title: Foo\nkind: transcript`), DEFAULT_FM_MAP)).toBe(false);
  });
  it("source-Key aber fremder kind-Wert abgelehnt", () => {
    expect(isI2mNote(T(`source_image: "[[a.png]]"\nkind: note`), DEFAULT_FM_MAP)).toBe(false);
  });
  it("Notiz ohne Frontmatter abgelehnt", () => {
    expect(isI2mNote("kein FM\n![[a.png]]", DEFAULT_FM_MAP)).toBe(false);
  });
  it("Notiz mit leerem Frontmatter abgelehnt", () => {
    expect(isI2mNote("---\n---\n![[a.png]]\n", DEFAULT_FM_MAP)).toBe(false);
  });
  it("Notiz mit embedded --- in FM-Wert erkannt", () => {
    expect(isI2mNote(`---\ntitle: "a---b"\nsource_image: "[[a.png]]"\nkind: transcript\n---\n![[a.png]]\n`, DEFAULT_FM_MAP)).toBe(true);
  });
});

describe("migrateNoteFrontmatter", () => {
  const base = `---\nsource_image: "[[a.png]]"\nkind: transcript\ncreated: 2026-01-01\ntranscribed_by: "m"\n---\n![[a.png]]\n\nBody\n`;

  it("benennt Key um, Rest der Zeile bleibt", () => {
    const r = migrateNoteFrontmatter(base, DEFAULT_FM_MAP, { ...DEFAULT_FM_MAP, created: "erstellt" });
    expect(r.changed).toBe(true);
    expect(r.next).toContain(`erstellt: 2026-01-01`);
    expect(r.next).not.toContain(`created:`);
  });
  it("benennt kind-Key UND -Wert auf einer Zeile um", () => {
    const r = migrateNoteFrontmatter(base, DEFAULT_FM_MAP, { ...DEFAULT_FM_MAP, kindKey: "type", kindTranscript: "Transkript" });
    expect(r.next).toContain(`type: Transkript`);
    expect(r.next).not.toMatch(/^kind:/m);
  });
  it("erhält fremde Keys + Body zeichengenau", () => {
    const withForeign = `---\nsource_image: "[[a.png]]"\nkind: transcript\naliases: [foo]\n---\n![[a.png]]\n\nBody\n`;
    const r = migrateNoteFrontmatter(withForeign, DEFAULT_FM_MAP, { ...DEFAULT_FM_MAP, kindKey: "type" });
    expect(r.next).toContain(`aliases: [foo]`);
    expect(r.next.endsWith(`![[a.png]]\n\nBody\n`)).toBe(true);
  });
  it("CRLF-Notiz behält \\r\\n", () => {
    const crlf = base.replace(/\n/g, "\r\n");
    const r = migrateNoteFrontmatter(crlf, DEFAULT_FM_MAP, { ...DEFAULT_FM_MAP, created: "erstellt" });
    expect(r.next).toContain(`erstellt: 2026-01-01\r\n`);
    expect(r.next).not.toContain(`\ncreated:`);
  });
  it("Kette (category→tags, tags→foo) wird verweigert → conflict, unverändert", () => {
    const note = `---\nsource_image: "[[a.png]]"\nkind: transcript\ncategory: X\ntags: Y\n---\nB\n`;
    const r = migrateNoteFrontmatter(note, DEFAULT_FM_MAP, { ...DEFAULT_FM_MAP, category: "tags", tags: "foo" });
    expect(r.conflict).toBe(true);
    expect(r.changed).toBe(false);
    expect(r.next).toBe(note);
  });
  it("Swap (category↔tags) wird verweigert → conflict", () => {
    const note = `---\nsource_image: "[[a.png]]"\nkind: transcript\ncategory: X\ntags: Y\n---\nB\n`;
    const r = migrateNoteFrontmatter(note, DEFAULT_FM_MAP, { ...DEFAULT_FM_MAP, category: "tags", tags: "category" });
    expect(r.conflict).toBe(true);
    expect(r.changed).toBe(false);
  });
  it("nicht-überlappende Simultan-Umbenennung ist erlaubt (created→erstellt, transcribed_by→by)", () => {
    const note = `---\nsource_image: "[[a.png]]"\nkind: transcript\ncreated: 2026-01-01\ntranscribed_by: "m"\n---\nB\n`;
    const r = migrateNoteFrontmatter(note, DEFAULT_FM_MAP, { ...DEFAULT_FM_MAP, created: "erstellt", authorTranscribed: "by" });
    expect(r.conflict).toBe(false);
    expect(r.next).toContain(`erstellt: 2026-01-01`);
    expect(r.next).toContain(`by: "m"`);
  });
  it("Idempotenz — Nicht-Quell-Key-Umbenennung zweimal (re-gescannter Note) = No-op", () => {
    const newMap = { ...DEFAULT_FM_MAP, created: "erstellt" };
    const once = migrateNoteFrontmatter(base, DEFAULT_FM_MAP, newMap).next;
    const twice = migrateNoteFrontmatter(once, DEFAULT_FM_MAP, newMap);
    expect(twice.changed).toBe(false);
    expect(twice.next).toBe(once);
  });
  it("Idempotenz — kindKey-Umbenennung zweimal = No-op beim 2. Mal", () => {
    const newMap = { ...DEFAULT_FM_MAP, kindKey: "type" };
    const once = migrateNoteFrontmatter(base, DEFAULT_FM_MAP, newMap).next;
    const twice = migrateNoteFrontmatter(once, DEFAULT_FM_MAP, newMap);
    expect(twice.changed).toBe(false);
    expect(twice.next).toBe(once);
  });
  it("Notiz ohne Frontmatter unverändert", () => {
    const r = migrateNoteFrontmatter("kein FM\nBody\n", DEFAULT_FM_MAP, { ...DEFAULT_FM_MAP, kindKey: "type" });
    expect(r.changed).toBe(false);
  });
});

describe("migrateNoteFrontmatter — Kollision", () => {
  it("Ziel-Key existiert schon als fremder Key → conflict, unverändert", () => {
    const note = `---\nsource_image: "[[a.png]]"\nkind: transcript\ntype: manuell\n---\nB\n`;
    const r = migrateNoteFrontmatter(note, DEFAULT_FM_MAP, { ...DEFAULT_FM_MAP, kindKey: "type" });
    expect(r.conflict).toBe(true);
    expect(r.changed).toBe(false);
    expect(r.next).toBe(note);
  });
  it("zwei Quellen auf denselben Ziel-Key → conflict", () => {
    const note = `---\nsource_image: "[[a.png]]"\nkind: transcript\ncategory: X\ntags: Y\n---\nB\n`;
    // category→z UND tags→z (kein Domain/Range-Overlap, aber Ziel-Kollision)
    const r = migrateNoteFrontmatter(note, DEFAULT_FM_MAP, { ...DEFAULT_FM_MAP, category: "z", tags: "z" });
    expect(r.conflict).toBe(true);
    expect(r.changed).toBe(false);
  });
  it("idempotenter Re-Scan meldet KEINEN Kollisions-conflict (bereits migrierter Key)", () => {
    const newMap = { ...DEFAULT_FM_MAP, kindKey: "type" };
    const migrated = migrateNoteFrontmatter(`---\nsource_image: "[[a.png]]"\nkind: transcript\n---\nB\n`, DEFAULT_FM_MAP, newMap).next;
    const again = migrateNoteFrontmatter(migrated, DEFAULT_FM_MAP, newMap);
    expect(again.conflict).toBe(false);
    expect(again.changed).toBe(false);
  });
});
