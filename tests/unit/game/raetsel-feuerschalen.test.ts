/**
 * M7-13 acceptance "Feuerschalen-Reihenfolge (je ≥ 3 Varianten) … Solver-Tests je Variante" (docs/SPIEL.md §19): every
 * `feuerschalen` variant is solved by lighting the inscription's order; a lit bowl stays lit (lighting it again changes
 * nothing), a wrong bowl puts every fire out; the save form round-trips and keeps the lit bowls consistent with the progress.
 */
import { describe, expect, it } from 'vitest';
import { FEUERSCHALEN_RULES, puzzleAct, puzzleInit } from '../../../src/game/puzzles/index';
import { runSolution, variantsOf } from './raetsel-testhilfe';

const VARIANTS = variantsOf('feuerschalen');

describe('Rätsel feuerschalen', () => {
  it('has at least three variants', () => {
    expect(VARIANTS.map((v) => v.id)).toEqual(['feuerschalen_1', 'feuerschalen_2', 'feuerschalen_3']);
  });

  it.each(VARIANTS.map((v) => [v.id, v] as const))('%s: the solver lights the inscription’s order and solves it with the last bowl', (_id, v) => {
    const r = runSolution(v);
    expect(r.steps).toBe(v.folge.length);
    expect(r.solved).toBe(true);
    expect(r.solvedBefore.every((s) => !s)).toBe(true);
  });

  it('a lit bowl stays lit; a wrong bowl puts all of them out', () => {
    for (const v of VARIANTS) {
      const first = puzzleAct(v, puzzleInit(v), { part: v.folge[0]!, dir: 0 });
      expect(FEUERSCHALEN_RULES.decode(v, first)).toEqual({ done: 1, lit: 1 << v.folge[0]! });
      expect(puzzleAct(v, first, { part: v.folge[0]!, dir: 0 })).toEqual(first);
      const wrong = [...Array(v.schalen).keys()].find((i) => i !== v.folge[1] && i !== v.folge[0])!;
      expect(FEUERSCHALEN_RULES.decode(v, puzzleAct(v, first, { part: wrong, dir: 0 }))).toEqual({ done: 0, lit: 0 });
    }
  });

  it('the save form round-trips; lit bowls that do not match the progress fall back to dark', () => {
    const v = VARIANTS[1]!;
    const s = { done: 2, lit: (1 << v.folge[0]!) | (1 << v.folge[1]!) };
    expect(FEUERSCHALEN_RULES.decode(v, FEUERSCHALEN_RULES.encode(s))).toEqual(s);
    expect(FEUERSCHALEN_RULES.decode(v, [2, 1])).toEqual({ done: 0, lit: 0 });
  });
});
