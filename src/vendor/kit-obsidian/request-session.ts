// vendored from obsidian-kit@0.45.0, src/obsidian/request-session.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { Notice } from "obsidian";
import type { Deviation, DeviationKind } from "../kit/sampling-profiles";

/** Zustand der laufenden Sitzung: letzte gesendete Parameter und beobachtete Abweichungen.
 *  Wird nicht gespeichert — „Letzte Anfrage" gilt nur, solange Obsidian läuft (Spec § 5.1).
 *  Notice nur für Abweichungen, die das Ergebnis ändern, je Art höchstens einmal (Spec § 5.3).
 *  Das Kit formuliert nicht: `message` kommt vom Plugin. */
export interface RequestSessionOptions {
  message(d: Deviation): string;
  notice?: (text: string) => void;
  onChange?(): void;
}
export interface RequestSession {
  recordRequest(params: Record<string, unknown>, extra?: { systemPrompt?: string }): void;
  lastRequest(): { params: Record<string, unknown>; systemPrompt?: string } | null;
  report(ds: Deviation[]): void;
  deviations(): readonly { kind: DeviationKind; count: number; detail?: string }[];
  clear(): void;
}

export function createRequestSession(opts: RequestSessionOptions): RequestSession {
  const notice = opts.notice ?? ((t: string) => { new Notice(t); });
  let last: { params: Record<string, unknown>; systemPrompt?: string } | null = null;
  const seen = new Map<DeviationKind, { kind: DeviationKind; count: number; detail?: string }>();
  const noticed = new Set<DeviationKind>();
  return {
    recordRequest(params, extra) {
      last = extra?.systemPrompt !== undefined ? { params, systemPrompt: extra.systemPrompt } : { params };
      opts.onChange?.();
    },
    lastRequest: () => last,
    report(ds) {
      if (ds.length === 0) return;
      for (const d of ds) {
        const prev = seen.get(d.kind);
        const entry: { kind: DeviationKind; count: number; detail?: string } = { kind: d.kind, count: (prev?.count ?? 0) + 1 };
        const detail = d.detail ?? prev?.detail;
        if (detail !== undefined) entry.detail = detail;
        seen.set(d.kind, entry);
        if (d.affectsResult && !noticed.has(d.kind)) { noticed.add(d.kind); notice(opts.message(d)); }
      }
      opts.onChange?.();
    },
    deviations: () => [...seen.values()],
    clear() { seen.clear(); noticed.clear(); opts.onChange?.(); },
  };
}
