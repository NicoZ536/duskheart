/**
 * Helpers of the puzzle tests (M7-12, M7-13): the variants of the content (`PUZZLE_TYPES`, parsed with the schema – no
 * registry needed) and a runner that applies a solver's actions from the start state.
 */
import { puzzleTypeSchema, type PuzzleVariantDef } from '../../../src/content/dungeons/schema';
import { PUZZLE_TYPES } from '../../../src/content/dungeons/raetsel';
import { puzzleAct, puzzleInit, puzzleSolved, puzzleSolve } from '../../../src/game/puzzles/index';

/** The parsed variants of one puzzle type. */
export function variantsOf<T extends PuzzleVariantDef['typ']>(typ: T): Extract<PuzzleVariantDef, { typ: T }>[] {
  const def = PUZZLE_TYPES.find((p) => p.id === typ);
  if (def === undefined) throw new Error(`no puzzle type ${typ}`);
  const all: readonly PuzzleVariantDef[] = puzzleTypeSchema.parse(def).varianten;
  return all.filter((v): v is Extract<PuzzleVariantDef, { typ: T }> => v.typ === typ);
}

/** Applies the solver's solution from the start; returns the states after every step and whether the last one solves. */
export function runSolution(v: PuzzleVariantDef): { steps: number; solvedBefore: boolean[]; solved: boolean } {
  const solution = puzzleSolve(v);
  if (solution === null) return { steps: -1, solvedBefore: [], solved: false };
  let state = puzzleInit(v);
  const solvedBefore: boolean[] = [];
  for (const a of solution) {
    solvedBefore.push(puzzleSolved(v, state));
    state = puzzleAct(v, state, a);
  }
  return { steps: solution.length, solvedBefore, solved: puzzleSolved(v, state) };
}
