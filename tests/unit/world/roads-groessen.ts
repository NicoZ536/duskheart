/**
 * The per-size cases of `tests/unit/world/roads.test.ts` (M2-11, Builder roads, 3 seeds per size), moved here
 * unchanged (M7-75): the unit file runs them for the sizes of `UNIT_SIZES`, `tests/integration/roads-groessen.test.ts`
 * for the others (`weltgroessen.ts`).
 */
import { describe, expect, it } from 'vitest';
import { cellCenterX, cellCenterY, neighbour4 } from '../../../src/world/gen/plan/grid';
import { MAIN_LANDMASS } from '../../../src/world/gen/plan/island';
import { BEACON_BIOMES, createCellInfo, type LocationSlot } from '../../../src/world/gen/locations';
import { generateWorld, type GeneratedWorld } from '../../../src/world/gen/world';
import { createSurfaceContext } from '../../../src/world/gen/worldContext';
import type { WorldSizePreset } from '../../../src/content/balance';

const SEEDS = [101, 202, 303];
export const TIMEOUT_MS = 60_000;
/** Union-find over the roads: whether they join every terminal. */
function joinsAll(w: GeneratedWorld): boolean {
  const parent = new Map<number, number>(w.roads.terminals.map((t) => [t, t]));
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r) as number;
    return r;
  };
  for (const r of w.roads.roads) parent.set(find(r.from), find(r.to));
  return new Set(w.roads.terminals.map(find)).size === 1;
}

/** The cases of every size of `presets` (one `describe` per size). */
export function roadSizes(presets: readonly WorldSizePreset[]): void {
  for (const preset of presets) {
    describe(preset, () => {
      const worlds = SEEDS.map((seed) => generateWorld(seed, preset));

      it('verbinden alle Leuchtfeuer-Stätten und das Nachtherz', () => {
        for (const w of worlds) {
          const sites = w.locations.filter((s) => s.type === 'leuchtfeuer' || s.type === 'nachtherz').map((s) => s.id);
          expect([...w.roads.terminals].sort((a, b) => a - b)).toEqual(sites.sort((a, b) => a - b));
          expect(sites).toHaveLength(BEACON_BIOMES.length + 1);
          expect(w.roads.connected).toBe(true);
          expect(joinsAll(w)).toBe(true);
          // A spanning tree: one road less than sites.
          expect(w.roads.roads).toHaveLength(sites.length - 1);
        }
      }, TIMEOUT_MS);

      it('führen über begehbares Land, wechseln die Höhe nur über Rampen und Treppen', () => {
        for (const w of worlds) {
          const { plan } = w;
          const { grid } = plan;
          const ctx = createSurfaceContext(plan);
          const cells = createCellInfo(ctx);
          const ramps = new Set(plan.ramps.flatMap((r) => [`${r.low}:${r.high}`, `${r.high}:${r.low}`]));
          let length = 0;
          for (const road of w.roads.roads) {
            const path = Array.from(road.cells);
            const from = w.locations[road.from] as LocationSlot;
            const to = w.locations[road.to] as LocationSlot;
            expect(path[0]).toBe(Math.floor(from.y / grid.cellTiles) * grid.width + Math.floor(from.x / grid.cellTiles));
            expect(path[path.length - 1]).toBe(Math.floor(to.y / grid.cellTiles) * grid.width + Math.floor(to.x / grid.cellTiles));
            for (let i = 0; i < path.length; i++) {
              const c = path[i] as number;
              expect(cells.walk[c], `Zelle ${c}`).toBe(1);
              expect(plan.landmass[c]).toBe(MAIN_LANDMASS);
              if (i === 0) continue;
              const p = path[i - 1] as number;
              const dx = (c % grid.width) - (p % grid.width);
              const dy = Math.floor(c / grid.width) - Math.floor(p / grid.width);
              expect(Math.max(Math.abs(dx), Math.abs(dy))).toBe(1);
              const lp = plan.level[p] as number;
              const lc = plan.level[c] as number;
              if (dx !== 0 && dy !== 0) {
                expect(lc).toBe(lp);
                expect(plan.riverCell[c] === 1 || plan.riverCell[p] === 1).toBe(false);
              } else if (lc !== lp) {
                expect(Math.abs(lc - lp)).toBe(1);
                expect(ramps.has(`${p}:${c}`), `Stufe ${p} → ${c} ohne Rampe`).toBe(true);
                expect([0, 1, 2, 3].some((d) => neighbour4(grid, p, d) === c)).toBe(true);
              }
            }
            // Polyline: from site cell centre to site cell centre, level ranges ordered.
            expect(road.xs[0]).toBeCloseTo(cellCenterX(grid, path[0] as number), 3);
            expect(road.ys[road.ys.length - 1]).toBeCloseTo(cellCenterY(grid, path[path.length - 1] as number), 3);
            for (let i = 0; i < road.xs.length; i++) expect(road.levelMin[i] as number).toBeLessThanOrEqual(road.levelMax[i] as number);
            for (let i = 1; i < road.xs.length; i++) length += Math.hypot((road.xs[i] as number) - (road.xs[i - 1] as number), (road.ys[i] as number) - (road.ys[i - 1] as number));
          }
          expect(w.roads.lengthTiles).toBeCloseTo(length, 0);
          expect(w.report.roads.lengthTiles).toBe(w.roads.lengthTiles);
        }
      }, TIMEOUT_MS);
    });
  }
}
