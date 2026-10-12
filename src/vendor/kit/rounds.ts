// vendored from code-kit@0.23.0, src/ts/pure/rounds.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** History of several LLM rounds with step-back. Each round is whatever the caller stores
 *  (input, output, model, ...); this module only knows the list and which round is active.
 *
 *  Three independent instances existed before this one (obsidian-plugins/, 2026-07..2026-09):
 *  `lingotuner/src/core/session.ts` (`Session{rounds, active}`, `addRound`, `selectRound`,
 *  `basedOn`), `obsidian-transmute/src/core/session.ts` (phase `preview{versions, active}`,
 *  `selectVersion`, "refine builds on the active version") and
 *  `image-to-markdown/src/img_to_md_state.ts` (`RefineRound[]` per card, `selectRefineVersion`).
 *  All three share the same rule: **the selection belongs to the state** — refining after a
 *  step back appends after the last round and builds on the *active* one, nothing is cut off.
 *
 *  ── What stayed with the callers, and why ───────────────────────────────────────────────
 *  The round content (`T`) — dials, instruction, hits, source name — is domain data and stays a
 *  type parameter. The strip that shows the rounds is UI with its own grammar per plugin (see
 *  `obsidian-kit/obsidian/version-list`). Streaming, abort and transport are not here either.
 *  image-to-markdown keeps index 0 for the original text (`base`) and counts rounds from 1;
 *  that is a display convention of its card, not a property of the history, so `active` here is
 *  always an index into `rounds` (-1 without a round) and the caller adds the offset.
 *
 *  All functions are pure: they return a new model or, where nothing changes, the same object.
 */

export interface Rounds<T> {
  readonly rounds: readonly T[];
  /** Index into `rounds`; -1 while there is no round. */
  readonly active: number;
}

/** The model without a round. Shared and immutable — never mutate `rounds`. */
export const EMPTY_ROUNDS: Rounds<never> = Object.freeze({ rounds: Object.freeze([]), active: -1 });

/** Append `round` and select it. */
export function pushRound<T>(s: Rounds<T>, round: T): Rounds<T> {
  const rounds = [...s.rounds, round];
  return { rounds, active: rounds.length - 1 };
}

/** Select the round at `index`. Out of range, non-integer or already active: the *same* object
 *  comes back, so a caller can skip a redraw with `next === prev`. */
export function selectRound<T>(s: Rounds<T>, index: number): Rounds<T> {
  if (!Number.isInteger(index) || index < 0 || index >= s.rounds.length || index === s.active) return s;
  return { rounds: s.rounds, active: index };
}

/** The active round, or `null` without one. */
export function activeRound<T>(s: Rounds<T>): T | null {
  return s.active >= 0 ? (s.rounds[s.active] ?? null) : null;
}

/** The index a new round builds on: the **active** one, not necessarily the last. `null`
 *  without a round — the first run comes from the source. Store it as the new round's
 *  `basedOn` to get a chain index (lingotuner reads its root round from it). */
export function refineBase<T>(s: Rounds<T>): number | null {
  return s.active >= 0 ? s.active : null;
}

/** Back to the empty model (reset). */
export function clearRounds<T = never>(): Rounds<T> {
  return EMPTY_ROUNDS;
}
