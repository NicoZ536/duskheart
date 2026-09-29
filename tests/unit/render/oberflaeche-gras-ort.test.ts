/**
 * M5-69: `gras-interaktiv` walks into dense dune grass. Since the coast showcase (M5-64) the scenario stood next to the
 * first marram tuft along a run of dune grass ground – in sparse grass, the bending read only on the outlined marram.
 * Now `denseGrassRun` scores every run around the showcase by the tufts of the dune grass decor the figure bends
 * (`GRASS_SPOT`: within its push at the end of the walk, along the last stretch behind it, in the clump around it) and
 * keeps the spawn and the walk clear (open ground to spawn on, no blocking footprint on the run, nothing in the
 * interaction's reach where the walk ends: no marker over the picture).
 *
 * Measured on the world of the pictures (seed 20260923, medium: the session of the screenshot scenarios) with the
 * scenario's own query shape over generated chunks.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { FOOTPRINT_MAX_TILES, WORLD_OBJECTS } from '../../../src/content/worldObjects';
import { SURFACE_PARAMS } from '../../../src/render/surface/params';
import { denseGrassRun, GRASS_SPOT, grassWalkPx, type GrassQuery } from '../../../src/render/surface/scenarios';
import { DECOR_SIZES, GROUND_DECOR_RULES, tuftsNear, type GroundDecorRule } from '../../../src/render/world/groundDecor';
import { surfaceShowcase } from '../../../src/render/world/showcase';
import { generateChunk } from '../../../src/world/gen/chunk';
import { generateWorld } from '../../../src/world/gen/world';
import { type ChunkData, WATER_DEPTH_MASK } from '../../../src/world/model/chunk';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';

const TILE = 16;
const CS = 32;
const ids = contentWorldIdTables();
const RULE = GROUND_DECOR_RULES.find((r) => r.terrain === GRASS_SPOT.terrain) as GroundDecorRule;
const SHAPES = new Map(WORLD_OBJECTS.map((o) => [o.id, o]));

/** The scenario's query over the generated chunks of `world` (all resident). */
function worldQuery(seed: number): { q: GrassQuery; at: { tx: number; ty: number } } {
  const world = generateWorld(seed, 'medium');
  const at = surfaceShowcase(world, 'salzkueste');
  const chunks = new Map<string, ChunkData>();
  const chunk = (tx: number, ty: number): { c: ChunkData; i: number } => {
    const cx = Math.floor(tx / CS);
    const cy = Math.floor(ty / CS);
    let c = chunks.get(`${cx},${cy}`);
    if (c === undefined) {
      c = generateChunk(world, 0, cx, cy);
      chunks.set(`${cx},${cy}`, c);
    }
    return { c, i: (ty - cy * CS) * CS + (tx - cx * CS) };
  };
  const q: GrassQuery = {
    objectAt(tx, ty) {
      const { c, i } = chunk(tx, ty);
      const id = c.object[i] as number;
      return id === 0 ? '' : ids.objects.stringId(id);
    },
    groundAt(tx, ty) {
      const { c, i } = chunk(tx, ty);
      const g = c.ground[i] as number;
      return { terrain: g === 0 ? '' : ids.terrain.stringId(g), level: c.height[i] as number, water: ((c.water[i] as number) & WATER_DEPTH_MASK) !== 0, solid: (c.solid[i] as number) !== 0 };
    },
  };
  return { q, at };
}

describe('M5-69: gras-interaktiv steht in dichtem Dünengras', { timeout: 120_000 }, () => {
  it('Büschel zählen je Größe, nur wo sie stehen (Boden der Regel, trocken, kein Objekt)', () => {
    expect(DECOR_SIZES).toHaveLength(GRASS_SPOT.sizeWeights.length);
    // Somewhere the rule's clusters lie: a cell with a cluster, its tufts around its centre.
    let x = 0;
    let y = 0;
    let n = 0;
    for (let g = 0; g < 50 && n === 0; g++) {
      x = (g * RULE.cellTiles + RULE.cellTiles / 2) * TILE;
      y = x;
      n = tuftsNear(RULE, x, y, RULE.radiusPx[1] * 2, () => true);
    }
    expect(n).toBeGreaterThan(0);
    expect(tuftsNear(RULE, x, y, RULE.radiusPx[1] * 2, () => false)).toBe(0);
    const weighted = tuftsNear(RULE, x, y, RULE.radiusPx[1] * 2, () => true, [1, 10, 100]);
    expect(weighted).toBeGreaterThanOrEqual(n);
    expect(tuftsNear(RULE, x, y, RULE.radiusPx[1] * 2, () => true, [0, 0, 0])).toBe(0);
    expect(tuftsNear(RULE, x, y, 0.5, () => true)).toBeLessThanOrEqual(n);
  });

  it('am Ende des Wegs stehen viele Büschel im Druck der Füße und im Horst, dahinter die niedergedrückten; Start offen, Weg frei, nichts in Reichweite', () => {
    const { q, at } = worldQuery(20260923);
    const spot = denseGrassRun(q, at);
    if (spot === null) throw new Error('kein Ort');
    expect(Math.max(Math.abs(spot.tx - at.tx), Math.abs(spot.ty - at.ty))).toBeLessThanOrEqual(GRASS_SPOT.searchTiles);
    const stands = (tx: number, ty: number): boolean => {
      const g = q.groundAt(tx, ty);
      return g !== null && g.terrain === GRASS_SPOT.terrain && !g.water && q.objectAt(tx, ty) === '';
    };
    const push = SURFACE_PARAMS.grass.benderRadiusPx;
    const ex = spot.tx * TILE + TILE / 2 + grassWalkPx();
    const ey = spot.ty * TILE + TILE / 2;
    // Dense: tufts on every side of the feet, a clump around, the stretch walked through full of them (the old spot:
    // none within the push, none in 24 px – the dune grass there was bare sand between clumps).
    expect(tuftsNear(RULE, ex, ey, push, stands)).toBeGreaterThanOrEqual(5);
    expect(tuftsNear(RULE, ex, ey, GRASS_SPOT.aroundPx, stands)).toBeGreaterThanOrEqual(15);
    // The stretch behind the figure: discs of the push's radius along the last `trailPx` of the walk.
    let trail = 0;
    for (let s = GRASS_SPOT.trailStepPx; s <= GRASS_SPOT.trailPx; s += GRASS_SPOT.trailStepPx) trail += tuftsNear(RULE, ex - s, ey, push, stands);
    expect(trail).toBeGreaterThanOrEqual(8);
    // The spawn stays where it is asked for: the tile and its neighbours open ground on one level.
    const level = q.groundAt(spot.tx, spot.ty)?.level;
    const blocked = (tx: number, ty: number): boolean => {
      for (let i = 0; i < FOOTPRINT_MAX_TILES; i++) {
        for (let j = 0; j < FOOTPRINT_MAX_TILES; j++) {
          const o = SHAPES.get(q.objectAt(tx - i, ty + j) ?? '');
          if (o !== undefined && o.blocking && i < o.footprint.w && j < o.footprint.h) return true;
        }
      }
      return false;
    };
    for (let y = spot.ty - 1; y <= spot.ty + 1; y++) {
      for (let x = spot.tx - 1; x <= spot.tx + 1; x++) {
        const g = q.groundAt(x, y);
        expect(g?.water === false && g.level === level && !blocked(x, y), `Nachbar ${x},${y}`).toBe(true);
      }
    }
    for (let k = 0; k < GRASS_SPOT.length; k++) expect(blocked(spot.tx + k, spot.ty), `Weg ${k}`).toBe(false);
    // Nothing in reach where the walk ends: no object's footprint, no water within the interaction's reach.
    const fx = ex / TILE;
    const fy = ey / TILE;
    const reach = BALANCE.interaction.reachTiles;
    const d = (x0: number, y0: number, x1: number, y1: number): number => Math.hypot(Math.max(x0 - fx, 0, fx - x1), Math.max(y0 - fy, 0, fy - y1));
    for (let y = Math.floor(fy) - 4; y <= Math.floor(fy) + 4; y++) {
      for (let x = Math.floor(fx) - 4; x <= Math.floor(fx) + 4; x++) {
        if (q.groundAt(x, y)?.water === true) expect(d(x, y, x + 1, y + 1), `Wasser ${x},${y}`).toBeGreaterThan(reach);
        const o = SHAPES.get(q.objectAt(x, y) ?? '');
        if (o !== undefined) expect(d(x, y + 1 - o.footprint.h, x + o.footprint.w, y + 1), `${o.id} ${x},${y}`).toBeGreaterThan(reach);
      }
    }
    // A fixed choice: asked again, the same spot.
    expect(denseGrassRun(q, at)).toEqual(spot);
  });

  it('der Start ist offener Boden: steht neben dem besten Ort ein Fels, wählt die Suche einen anderen (sonst setzte der Spawn den Spieler um)', () => {
    const rock = WORLD_OBJECTS.find((o) => o.blocking && o.footprint.w === 1 && o.footprint.h === 1 && o.id.startsWith('fels_'))?.id ?? '';
    expect(rock).not.toBe('');
    const at = { tx: 1000, ty: 1000 };
    const objects = new Map<string, string>();
    const q: GrassQuery = {
      objectAt: (tx, ty) => objects.get(`${tx},${ty}`) ?? '',
      groundAt: () => ({ terrain: GRASS_SPOT.terrain, level: 0, water: false, solid: false }),
    };
    const open = denseGrassRun(q, at);
    if (open === null) throw new Error('kein Ort');
    // A rock south of the start: far from the end of the walk and its grass (the score stays), but the spawn would move.
    objects.set(`${open.tx},${open.ty + 1}`, rock);
    const beside = denseGrassRun(q, at);
    expect(beside).not.toBeNull();
    expect(beside).not.toEqual(open);
  });

  it('solange ein Chunk der Suche fehlt, fragt das Szenario erneut (null) statt am Rand der Streaming-Grenze zu wählen', () => {
    const { q, at } = worldQuery(20260923);
    const partial: GrassQuery = {
      objectAt: (tx, ty) => (tx > at.tx + GRASS_SPOT.searchTiles ? null : q.objectAt(tx, ty)),
      groundAt: (tx, ty) => (tx > at.tx + GRASS_SPOT.searchTiles ? null : q.groundAt(tx, ty)),
    };
    expect(denseGrassRun(partial, at)).toBeNull();
  });
});
