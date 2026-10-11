/**
 * M7-12 acceptance "Hebelfolge mit Wandhinweis (je ≥ 3 Varianten) … jede Variante per Solver lösbar" (docs/SPIEL.md §19):
 * every `hebel` variant is solved by pulling the mural's order; a wrong lever snaps the sequence back to the start; the save
 * form round-trips.
 */
import { describe, expect, it } from 'vitest';
import { HEBEL_RULES, puzzleAct, puzzleInit, puzzleSolved } from '../../../src/game/puzzles/index';
import { runSolution, variantsOf } from './raetsel-testhilfe';

const VARIANTS = variantsOf('hebel');

describe('Rätsel hebel', () => {
  it('has at least three variants', () => {
    expect(VARIANTS.map((v) => v.id)).toEqual(['hebel_1', 'hebel_2', 'hebel_3']);
  });

  it.each(VARIANTS.map((v) => [v.id, v] as const))('%s: the solver pulls the mural’s order and solves it with the last lever', (_id, v) => {
    const r = runSolution(v);
    expect(r.steps).toBe(v.folge.length);
    expect(r.solved).toBe(true);
    expect(r.solvedBefore.every((s) => !s)).toBe(true);
  });

  it('a wrong lever resets the sequence', () => {
    for (const v of VARIANTS) {
      let s = puzzleAct(v, puzzleInit(v), { part: v.folge[0]!, dir: 0 });
      expect(HEBEL_RULES.decode(v, s).done).toBe(1);
      const wrong = [...Array(v.hebel).keys()].find((i) => i !== v.folge[1])!;
      s = puzzleAct(v, s, { part: wrong, dir: 0 });
      expect(HEBEL_RULES.decode(v, s).done).toBe(0);
      expect(puzzleSolved(v, s)).toBe(false);
    }
  });

  it('the save form round-trips; a progress beyond the sequence falls back to the start', () => {
    const v = VARIANTS[2]!;
    const s = { done: 3 };
    expect(HEBEL_RULES.decode(v, HEBEL_RULES.encode(s))).toEqual(s);
    expect(HEBEL_RULES.decode(v, [99])).toEqual({ done: 0 });
  });
});
