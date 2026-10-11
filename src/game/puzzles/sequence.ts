/**
 * The sequence puzzles (MASTERPROMPT §21 "Hebelfolge mit Wandhinweis", "Feuerschalen-Reihenfolge", "Glockentöne (Tonfolge)",
 * "verborgene Wände (Luftzug-Partikel)"; docs/SPIEL.md §19; M7-12, M7-13): pure rules over a part index – a lever pulled, a
 * bowl lit, a bell rung, a cracked wall struck.
 *
 * - `hebel`: the levers in the order of the mural; a wrong lever resets the sequence (all levers spring back).
 * - `feuerschalen`: the bowls in the order of the inscription; a lit bowl stays lit, a wrong one puts all of them out.
 * - `glocken`: the tones of the inscription; a wrong bell starts over – with this bell when it is the first of the tune.
 * - `verborgene_wand`: every cracked wall that is real opens (a draft gives it away); a false one only thuds.
 * The solvers return the sequence (each variant is solvable by construction; the tests apply it).
 */
import type { PuzzleVariantDef } from '../../content/dungeons/schema';
import type { PuzzleRules } from './types';

export type HebelVariant = Extract<PuzzleVariantDef, { typ: 'hebel' }>;
export type FeuerschalenVariant = Extract<PuzzleVariantDef, { typ: 'feuerschalen' }>;
export type GlockenVariant = Extract<PuzzleVariantDef, { typ: 'glocken' }>;
export type VerborgeneWandVariant = Extract<PuzzleVariantDef, { typ: 'verborgene_wand' }>;

/** Progress through a sequence: how many of its steps are done. */
export interface SequenceState {
  readonly done: number;
}
/** The bowls: progress and which bowls burn (bit i = bowl i). */
export interface BowlState {
  readonly done: number;
  readonly lit: number;
}
/** The cracked walls found open (bit i = wall i). */
export interface WallState {
  readonly found: number;
}

const START: SequenceState = { done: 0 };
const DARK: BowlState = { done: 0, lit: 0 };
const CLOSED: WallState = { found: 0 };

function count(v: number, len: number): number {
  return Number.isInteger(v) && v >= 0 && v <= len ? v : 0;
}

export const HEBEL_RULES: PuzzleRules<HebelVariant, SequenceState, number> = {
  type: 'hebel',
  init: () => START,
  act: (v, s, lever) => (s.done >= v.folge.length ? s : v.folge[s.done] === lever ? { done: s.done + 1 } : START),
  solved: (v, s) => s.done >= v.folge.length,
  solve: (v) => [...v.folge],
  encode: (s) => [s.done],
  decode: (v, data) => ({ done: count(data[0] ?? 0, v.folge.length) }),
};

export const FEUERSCHALEN_RULES: PuzzleRules<FeuerschalenVariant, BowlState, number> = {
  type: 'feuerschalen',
  init: () => DARK,
  act(v, s, bowl) {
    if (s.done >= v.folge.length || (s.lit & (1 << bowl)) !== 0) return s;
    return v.folge[s.done] === bowl ? { done: s.done + 1, lit: s.lit | (1 << bowl) } : DARK;
  },
  solved: (v, s) => s.done >= v.folge.length,
  solve: (v) => [...v.folge],
  encode: (s) => [s.done, s.lit],
  decode(v, data) {
    const done = count(data[0] ?? 0, v.folge.length);
    let lit = 0;
    for (let k = 0; k < done; k++) lit |= 1 << (v.folge[k] as number);
    // The lit bowls follow from the progress: a saved mask that disagrees is no state of these rules.
    return (data[1] ?? 0) === lit ? { done, lit } : DARK;
  },
};

export const GLOCKEN_RULES: PuzzleRules<GlockenVariant, SequenceState, number> = {
  type: 'glocken',
  init: () => START,
  act(v, s, bell) {
    if (s.done >= v.folge.length) return s;
    if (v.folge[s.done] === bell) return { done: s.done + 1 };
    return { done: v.folge[0] === bell ? 1 : 0 };
  },
  solved: (v, s) => s.done >= v.folge.length,
  solve: (v) => [...v.folge],
  encode: (s) => [s.done],
  decode: (v, data) => ({ done: count(data[0] ?? 0, v.folge.length) }),
};

function realMask(v: VerborgeneWandVariant): number {
  let m = 0;
  for (const i of v.echt) m |= 1 << i;
  return m;
}

export const VERBORGENE_WAND_RULES: PuzzleRules<VerborgeneWandVariant, WallState, number> = {
  type: 'verborgene_wand',
  init: () => CLOSED,
  act: (v, s, wall) => (v.echt.includes(wall) ? { found: s.found | (1 << wall) } : s),
  solved: (v, s) => (s.found & realMask(v)) === realMask(v),
  solve: (v) => [...v.echt],
  encode: (s) => [s.found],
  decode: (v, data) => ({ found: (data[0] ?? 0) & realMask(v) }),
};
