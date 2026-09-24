/**
 * Where the world debug scenes look (M2-28 scenarios `gruenhain-tag`, `frostkamm-tag`, `glutsand-tag`,
 * `ebene-1-roh`): a deterministic spot of a generated world that shows what the renderer has to prove
 * – height levels with cliffs, water, vegetation – well inside one biome.
 *
 * Surface: every window of plan cells (the view is about 30 × 17 tiles, a window 4 × 3 cells of
 * 8 tiles) whose cells and a margin ring belong to the biome is scored by its level steps, levels,
 * water and ramps; the first best window in scan order wins. Underground: the first cavern of the
 * layer with the wanted feature (a mushroom grove on −1), else the largest cavern.
 * Both read only the world plan, so the choice costs no chunk generation.
 */
import type { GeneratedWorld } from '../../world/gen/world';
import { layerPlanOf, type NodeFeature } from '../../world/gen/underground/index';
import type { Layer } from '../../world/model/coords';

/** A tile of the world. */
export interface TileSpot {
  readonly tx: number;
  readonly ty: number;
}

/** Plan cells of the scored window (≈ the 480 × 270 px view: 30 × 17 tiles) and the margin ring that must share the biome. */
export const SHOWCASE_WINDOW = { cellsW: 4, cellsH: 3, margin: 2 } as const;
/** Score weights of a window: level steps between neighbouring cells (capped), extra levels, water cells (capped), ramps. */
export const SHOWCASE_SCORE = {
  stepWeight: 3,
  stepCap: 10,
  levelBonus: 8,
  waterWeight: 4,
  waterCap: 3,
  rampWeight: 6,
} as const;
/** Feature of the underground showcase cavern per layer (§9.3: mushroom groves on −1, crystal grottos on −2, obsidian halls on −3). */
const CAVE_FEATURE: Readonly<Record<number, NodeFeature>> = { [-1]: 'pilzhain', [-2]: 'kristallgrotte', [-3]: 'obsidianhalle' };

/** Centre tile of the best surface window of `biome`; throws when the world has no fitting window. */
export function surfaceShowcase(world: GeneratedWorld, biome: string): TileSpot {
  const plan = world.plan;
  const { width, height, cellTiles } = plan.grid;
  const inBiome = (cx: number, cy: number): boolean => {
    if (cx < 0 || cy < 0 || cx >= width || cy >= height) return false;
    const c = cy * width + cx;
    const r = plan.region[c] as number;
    return plan.land[c] === 1 && r >= 0 && plan.regions[r]?.biome === biome;
  };
  const rampCells = new Set<number>();
  for (const r of plan.ramps) {
    rampCells.add(r.low);
    rampCells.add(r.high);
  }
  const { cellsW, cellsH, margin } = SHOWCASE_WINDOW;
  const S = SHOWCASE_SCORE;
  let best = -1;
  let bestX = -1;
  let bestY = -1;
  for (let wy = margin; wy + cellsH + margin <= height; wy++) {
    for (let wx = margin; wx + cellsW + margin <= width; wx++) {
      let ok = true;
      for (let y = wy - margin; y < wy + cellsH + margin && ok; y++) for (let x = wx - margin; x < wx + cellsW + margin && ok; x++) ok = inBiome(x, y);
      if (!ok) continue;
      let steps = 0;
      let water = 0;
      let ramps = 0;
      let minLevel = Number.POSITIVE_INFINITY;
      let maxLevel = Number.NEGATIVE_INFINITY;
      for (let y = wy; y < wy + cellsH; y++) {
        for (let x = wx; x < wx + cellsW; x++) {
          const c = y * width + x;
          const level = plan.level[c] as number;
          minLevel = Math.min(minLevel, level);
          maxLevel = Math.max(maxLevel, level);
          if (x + 1 < wx + cellsW && plan.level[c + 1] !== level) steps++;
          if (y + 1 < wy + cellsH && plan.level[c + width] !== level) steps++;
          if (plan.riverCell[c] === 1 || (plan.lake[c] as number) >= 0) water++;
          if (rampCells.has(c)) ramps++;
        }
      }
      const score = Math.min(steps, S.stepCap) * S.stepWeight + (maxLevel > minLevel ? S.levelBonus : 0) + Math.min(water, S.waterCap) * S.waterWeight + (ramps > 0 ? S.rampWeight : 0);
      if (score > best) {
        best = score;
        bestX = wx;
        bestY = wy;
      }
    }
  }
  if (best < 0) throw new Error(`Schauplatz: Welt ${world.seed} hat kein Fenster von ${cellsW + 2 * margin}×${cellsH + 2 * margin} Zellen im Biom ${biome}`);
  return { tx: Math.round((bestX + cellsW / 2) * cellTiles), ty: Math.round((bestY + cellsH / 2) * cellTiles) };
}

/** Centre tile of the showcase cavern of an underground layer. */
export function caveShowcase(world: GeneratedWorld, layer: Layer): TileSpot {
  if (layer === 0) throw new RangeError('Schauplatz: Höhlen gibt es nur auf den Ebenen −1 … −3');
  const lp = layerPlanOf(world.underground, layer);
  const caverns = lp.nodes.filter((n) => n.role === 'kaverne');
  const wanted = CAVE_FEATURE[layer];
  const node = caverns.find((n) => n.feature === wanted) ?? caverns.reduce<(typeof caverns)[number] | undefined>((a, n) => (a === undefined || n.softRadius > a.softRadius ? n : a), undefined);
  if (node === undefined) throw new Error(`Schauplatz: Ebene ${layer} der Welt ${world.seed} hat keine Kaverne`);
  return { tx: Math.round(node.x), ty: Math.round(node.y) };
}
