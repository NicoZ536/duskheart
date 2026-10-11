/**
 * M7-13 acceptance "Glockentöne (Tonfolge) (je ≥ 3 Varianten) … Solver-Tests je Variante" (docs/SPIEL.md §19): every
 * `glocken` variant is solved by ringing the inscription's tune; a wrong bell starts over – with this bell when it opens the
 * tune; every bell has its own tone; the save form round-trips.
 */
import { describe, expect, it } from 'vitest';
import { GLOCKEN_RULES, puzzleAct, puzzleInit } from '../../../src/game/puzzles/index';
import { runSolution, variantsOf } from './raetsel-testhilfe';

const VARIANTS = variantsOf('glocken');

describe('Rätsel glocken', () => {
  it('has at least three variants, each bell with its own tone', () => {
    expect(VARIANTS.map((v) => v.id)).toEqual(['glocken_1', 'glocken_2', 'glocken_3']);
    for (const v of VARIANTS) expect(new Set(v.toene).size).toBe(v.glocken);
  });

  it.each(VARIANTS.map((v) => [v.id, v] as const))('%s: the solver rings the tune and solves it with the last bell', (_id, v) => {
    const r = runSolution(v);
    expect(r.steps).toBe(v.folge.length);
    expect(r.solved).toBe(true);
    expect(r.solvedBefore.every((s) => !s)).toBe(true);
  });

  it('a wrong bell starts over; the tune’s first bell starts it anew', () => {
    for (const v of VARIANTS) {
      const two = puzzleAct(v, puzzleAct(v, puzzleInit(v), { part: v.folge[0]!, dir: 0 }), { part: v.folge[1]!, dir: 0 });
      expect(GLOCKEN_RULES.decode(v, two).done).toBe(2);
      const third = v.folge[2]!;
      const other = [...Array(v.glocken).keys()].find((i) => i !== third && i !== v.folge[0])!;
      expect(GLOCKEN_RULES.decode(v, puzzleAct(v, two, { part: other, dir: 0 })).done).toBe(0);
      if (third !== v.folge[0]) expect(GLOCKEN_RULES.decode(v, puzzleAct(v, two, { part: v.folge[0]!, dir: 0 })).done).toBe(1);
    }
  });

  it('the save form round-trips', () => {
    const v = VARIANTS[0]!;
    expect(GLOCKEN_RULES.decode(v, GLOCKEN_RULES.encode({ done: 2 }))).toEqual({ done: 2 });
    expect(GLOCKEN_RULES.decode(v, [-1])).toEqual({ done: 0 });
  });
});
