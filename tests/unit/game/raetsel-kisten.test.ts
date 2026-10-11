/**
 * M7-12 acceptance "Kistenschieben auf Druckplatten (je ≥ 3 Varianten) … jede Variante per Solver lösbar"
 * (docs/SPIEL.md §19): every `kisten` variant of the content is solved by the breadth-first solver, its pushes applied from the
 * start state solve it (and not before the last one); a crate never goes into a wall or another crate; the save form
 * round-trips and an unknown state falls back to the start.
 */
import { describe, expect, it } from 'vitest';
import { KISTEN_RULES, kistenMap, puzzleCanonical, puzzleInit, puzzleSolve } from '../../../src/game/puzzles/index';
import { runSolution, variantsOf } from './raetsel-testhilfe';

const VARIANTS = variantsOf('kisten');

describe('Rätsel kisten', () => {
  it('has at least three variants', () => {
    expect(VARIANTS.map((v) => v.id)).toEqual(['kisten_1', 'kisten_2', 'kisten_3']);
  });

  it.each(VARIANTS.map((v) => [v.id, v] as const))('%s: the solver finds a solution that solves it with its last push', (_id, v) => {
    const r = runSolution(v);
    expect(r.steps).toBeGreaterThanOrEqual(4);
    expect(r.solved).toBe(true);
    expect(r.solvedBefore.every((s) => !s)).toBe(true);
  });

  it('a crate is never pushed into a wall, another crate or off the map', () => {
    const v = VARIANTS[0];
    if (v === undefined) throw new Error('no variant');
    const m = kistenMap(v);
    const s = KISTEN_RULES.init(v);
    for (const c of s.crates) {
      for (let d = 0; d < 4; d++) {
        const next = KISTEN_RULES.act(v, s, { from: c, dir: d });
        const x = (c % m.w) + [0, 1, 0, -1][d]!;
        const y = Math.floor(c / m.w) + [-1, 0, 1, 0][d]!;
        const to = y * m.w + x;
        const blocked = m.wall[to] === 1 || s.crates.includes(to);
        expect(next.crates.includes(to)).toBe(!blocked);
        expect(next.crates).toHaveLength(s.crates.length);
      }
    }
    // Pushing a floor cell (no crate there) changes nothing.
    expect(KISTEN_RULES.act(v, s, { from: m.entry, dir: 1 })).toBe(s);
  });

  it('is not solved at the start, solved only with a crate on every plate', () => {
    for (const v of VARIANTS) {
      const m = kistenMap(v);
      expect(KISTEN_RULES.solved(v, KISTEN_RULES.init(v))).toBe(false);
      expect(KISTEN_RULES.solved(v, { crates: [...m.plates] })).toBe(true);
      expect(KISTEN_RULES.solved(v, { crates: [...m.plates.slice(1), m.entry] })).toBe(false);
    }
  });

  it('the save form round-trips; a broken one falls back to the start', () => {
    for (const v of VARIANTS) {
      const sol = puzzleSolve(v);
      expect(sol).not.toBeNull();
      const s = KISTEN_RULES.act(v, KISTEN_RULES.init(v), { from: sol![0]!.part, dir: sol![0]!.dir });
      expect(KISTEN_RULES.decode(v, KISTEN_RULES.encode(s))).toEqual(s);
      const m = kistenMap(v);
      const wallCell = m.wall.indexOf(1);
      expect(puzzleCanonical(v, [wallCell, ...KISTEN_RULES.encode(s).slice(1)])).toEqual(puzzleInit(v));
      expect(puzzleCanonical(v, [1])).toEqual(puzzleInit(v));
    }
  });
});
