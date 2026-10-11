/**
 * The puzzle rules behind one door (docs/SPIEL.md §19; M7-12, M7-13): the five rule sets by type and an encoded form the vault
 * system works with – a puzzle's state is the `number[]` of its rules' `encode` (participant `vaults`), an action names a part
 * (`part`: the lever, bowl, bell or wall index; for `kisten` the crate's map cell) and, for a push, its direction.
 */
import type { PuzzleVariantDef } from '../../content/dungeons/schema';
import { KISTEN_RULES, type KistenVariant } from './kisten';
import { FEUERSCHALEN_RULES, GLOCKEN_RULES, HEBEL_RULES, VERBORGENE_WAND_RULES, type FeuerschalenVariant, type GlockenVariant, type HebelVariant, type VerborgeneWandVariant } from './sequence';

export { KISTEN_RULES, kistenCanPush, kistenMap, kistenStep, PUSH_DIRECTIONS, PUSH_DX, PUSH_DY, type KistenAction, type KistenMap, type KistenState, type KistenVariant } from './kisten';
export { FEUERSCHALEN_RULES, GLOCKEN_RULES, HEBEL_RULES, VERBORGENE_WAND_RULES, type BowlState, type SequenceState, type WallState } from './sequence';
export { partOrdinal, PUZZLE_PART_ROLES, puzzleLayout, type PuzzleLayout, type PuzzlePart, type PuzzlePartRole } from '../../world/gen/vaults/puzzleLayout';
export type { PuzzleRules } from './types';

/** One move on a puzzle: a part (index, or the crate's map cell) and the push direction (`kisten` only, else 0). */
export interface PuzzleAction {
  readonly part: number;
  readonly dir: number;
}

/** Initial encoded state of a variant. */
export function puzzleInit(v: PuzzleVariantDef): readonly number[] {
  switch (v.typ) {
    case 'kisten':
      return KISTEN_RULES.encode(KISTEN_RULES.init(v));
    case 'hebel':
      return HEBEL_RULES.encode(HEBEL_RULES.init(v));
    case 'feuerschalen':
      return FEUERSCHALEN_RULES.encode(FEUERSCHALEN_RULES.init(v));
    case 'glocken':
      return GLOCKEN_RULES.encode(GLOCKEN_RULES.init(v));
    case 'verborgene_wand':
      return VERBORGENE_WAND_RULES.encode(VERBORGENE_WAND_RULES.init(v));
  }
}

/** The encoded state after `action`. */
export function puzzleAct(v: PuzzleVariantDef, state: readonly number[], action: PuzzleAction): readonly number[] {
  switch (v.typ) {
    case 'kisten':
      return KISTEN_RULES.encode(KISTEN_RULES.act(v, KISTEN_RULES.decode(v, state), { from: action.part, dir: action.dir }));
    case 'hebel':
      return HEBEL_RULES.encode(HEBEL_RULES.act(v, HEBEL_RULES.decode(v, state), action.part));
    case 'feuerschalen':
      return FEUERSCHALEN_RULES.encode(FEUERSCHALEN_RULES.act(v, FEUERSCHALEN_RULES.decode(v, state), action.part));
    case 'glocken':
      return GLOCKEN_RULES.encode(GLOCKEN_RULES.act(v, GLOCKEN_RULES.decode(v, state), action.part));
    case 'verborgene_wand':
      return VERBORGENE_WAND_RULES.encode(VERBORGENE_WAND_RULES.act(v, VERBORGENE_WAND_RULES.decode(v, state), action.part));
  }
}

/** Whether the encoded state solves the variant. */
export function puzzleSolved(v: PuzzleVariantDef, state: readonly number[]): boolean {
  switch (v.typ) {
    case 'kisten':
      return KISTEN_RULES.solved(v, KISTEN_RULES.decode(v, state));
    case 'hebel':
      return HEBEL_RULES.solved(v, HEBEL_RULES.decode(v, state));
    case 'feuerschalen':
      return FEUERSCHALEN_RULES.solved(v, FEUERSCHALEN_RULES.decode(v, state));
    case 'glocken':
      return GLOCKEN_RULES.solved(v, GLOCKEN_RULES.decode(v, state));
    case 'verborgene_wand':
      return VERBORGENE_WAND_RULES.solved(v, VERBORGENE_WAND_RULES.decode(v, state));
  }
}

/** A solution as actions, or null (the validator fails such a variant). */
export function puzzleSolve(v: PuzzleVariantDef): PuzzleAction[] | null {
  switch (v.typ) {
    case 'kisten':
      return KISTEN_RULES.solve(v)?.map((a) => ({ part: a.from, dir: a.dir })) ?? null;
    case 'hebel':
      return HEBEL_RULES.solve(v)?.map((part) => ({ part, dir: 0 })) ?? null;
    case 'feuerschalen':
      return FEUERSCHALEN_RULES.solve(v)?.map((part) => ({ part, dir: 0 })) ?? null;
    case 'glocken':
      return GLOCKEN_RULES.solve(v)?.map((part) => ({ part, dir: 0 })) ?? null;
    case 'verborgene_wand':
      return VERBORGENE_WAND_RULES.solve(v)?.map((part) => ({ part, dir: 0 })) ?? null;
  }
}

/** The decoded state, canonical (a saved state the rules do not know falls back to the start: `decode` then `encode`). */
export function puzzleCanonical(v: PuzzleVariantDef, state: readonly number[]): readonly number[] {
  switch (v.typ) {
    case 'kisten':
      return KISTEN_RULES.encode(KISTEN_RULES.decode(v, state));
    case 'hebel':
      return HEBEL_RULES.encode(HEBEL_RULES.decode(v, state));
    case 'feuerschalen':
      return FEUERSCHALEN_RULES.encode(FEUERSCHALEN_RULES.decode(v, state));
    case 'glocken':
      return GLOCKEN_RULES.encode(GLOCKEN_RULES.decode(v, state));
    case 'verborgene_wand':
      return VERBORGENE_WAND_RULES.encode(VERBORGENE_WAND_RULES.decode(v, state));
  }
}

export type { FeuerschalenVariant, GlockenVariant, HebelVariant, KistenVariant as KistenVariantDef, VerborgeneWandVariant };
