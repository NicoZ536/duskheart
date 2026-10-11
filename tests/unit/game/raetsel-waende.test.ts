/**
 * M7-13 acceptance "verborgene Wände (Luftzug-Partikel) (je ≥ 3 Varianten) … Solver-Tests je Variante" (docs/SPIEL.md §19):
 * every `verborgene_wand` variant is solved by opening its real walls; a false wall changes nothing; the save form keeps only
 * real walls.
 */
import { describe, expect, it } from 'vitest';
import { puzzleAct, puzzleInit, puzzleSolved, VERBORGENE_WAND_RULES } from '../../../src/game/puzzles/index';
import { runSolution, variantsOf } from './raetsel-testhilfe';

const VARIANTS = variantsOf('verborgene_wand');

describe('Rätsel verborgene_wand', () => {
  it('has at least three variants', () => {
    expect(VARIANTS.map((v) => v.id)).toEqual(['verborgene_wand_1', 'verborgene_wand_2', 'verborgene_wand_3']);
  });

  it.each(VARIANTS.map((v) => [v.id, v] as const))('%s: the solver opens the real walls and solves it with the last one', (_id, v) => {
    const r = runSolution(v);
    expect(r.steps).toBe(v.echt.length);
    expect(r.solved).toBe(true);
    expect(r.solvedBefore.every((s) => !s)).toBe(true);
  });

  it('a false wall only thuds: nothing opens', () => {
    for (const v of VARIANTS) {
      const s = puzzleInit(v);
      for (let i = 0; i < v.waende; i++) if (!v.echt.includes(i)) expect(puzzleAct(v, s, { part: i, dir: 0 })).toEqual(s);
      expect(puzzleSolved(v, s)).toBe(false);
    }
  });

  it('the save form keeps only real walls', () => {
    const v = VARIANTS[2]!;
    expect(VERBORGENE_WAND_RULES.decode(v, [0b11111])).toEqual({ found: (1 << 2) | (1 << 4) });
    expect(VERBORGENE_WAND_RULES.decode(v, VERBORGENE_WAND_RULES.encode({ found: 1 << 4 }))).toEqual({ found: 1 << 4 });
  });
});
