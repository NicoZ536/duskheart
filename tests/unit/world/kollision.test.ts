/**
 * M2-23: collision (MASTERPROMPT §3.3) – circles and boxes against the tile grid (walls, solid rock,
 * deep water, cliffs by height difference, ramps and stairs), corners, no tunnelling at 60 tiles/s,
 * swept tests for fast projectiles and the entity hash grid. Worlds are drawn as ASCII maps.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../../../src/engine/rng';
import { UEBERGANG, wandAn } from '../../../src/world/autotile';
import {
  BLOCK_DEEP_WATER,
  BLOCK_HAZARD,
  BLOCK_OBJECT,
  BLOCK_SOLID,
  BLOCK_VOID,
  BLOCK_WALL,
  BodyGrid,
  CONTACT_SKIN_PX,
  CollisionGrid,
  LAND_CREATURE_RULES,
  MOVE_HIT,
  PLAYER_RULES,
  PROJECTILE_RULES,
  blocksMover,
  createBodyHit,
  createMoveResult,
  createSweepHit,
  infoCategories,
  infoConnector,
  infoLevel,
  infoWallTop,
  moveBox,
  moveCircle,
  moveCircles,
  moveResultDropped,
  moveResultLevel,
  packTileInfo,
  segmentVsRoundedBox,
  sweepCircle,
  sweepContact,
  type MoveResult,
  type MoverRules,
} from '../../../src/world/collision';
import { ChunkData, TILE_FLAG_BRIDGE, TILE_FLAG_RAMP, TILE_FLAG_STAIRS, WATER_DEPTH_DEEP, WATER_DEPTH_SHALLOW, WATER_FROZEN } from '../../../src/world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, CHUNK_SIZE, TILE_PX, packChunkId, type Layer } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';

const T = TILE_PX;
const IDS = contentWorldIdTables();
const GRAS = IDS.terrain.runtimeId('gras');
const FELS = IDS.terrain.runtimeId('fels');
const LAVA = IDS.terrain.runtimeId('lava');
const BIRKE = IDS.objects.runtimeId('baum_birke');
const EICHE = IDS.objects.runtimeId('baum_eiche');
const BLUME = IDS.objects.runtimeId('deko_blumen');

/** Chunk source over a map (packed id → chunk). */
class TestChunks {
  readonly map = new Map<number, ChunkData>();
  get(layer: Layer, cx: number, cy: number): ChunkData | undefined {
    return this.map.get(packChunkId(layer, cx, cy));
  }
  chunkOf(layer: Layer, tx: number, ty: number): ChunkData {
    const key = packChunkId(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    let c = this.map.get(key);
    if (c === undefined) {
      c = new ChunkData(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
      c.ground.fill(GRAS);
      this.map.set(key, c);
    }
    return c;
  }
}

function idx(tx: number, ty: number): number {
  return ((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK);
}

/**
 * Builds a world from rows. Legend: `.` grass (level 0), `#` solid rock, `T` birch (1×1), `E` oak
 * anchor (2×1, covers the tile east of it), `w` deep water, `s` shallow water, `i` frozen deep water,
 * `b` bridge over deep water, `L` lava, `f` flower (does not block), `1`–`4` grass at that level,
 * `r`/`R` ramp tile at level 0/1, `t` stairs at level 0.
 */
function drawWorld(chunks: TestChunks, rows: readonly string[], layer: Layer = 0): void {
  rows.forEach((row, ty) => {
    [...row].forEach((ch, tx) => {
      const c = chunks.chunkOf(layer, tx, ty);
      const i = idx(tx, ty);
      switch (ch) {
        case '.':
          break;
        case '#':
          c.solid[i] = FELS;
          break;
        case 'T':
          c.object[i] = BIRKE;
          break;
        case 'E':
          c.object[i] = EICHE;
          break;
        case 'f':
          c.object[i] = BLUME;
          break;
        case 'w':
          c.water[i] = WATER_DEPTH_DEEP;
          break;
        case 's':
          c.water[i] = WATER_DEPTH_SHALLOW;
          break;
        case 'i':
          c.water[i] = WATER_DEPTH_DEEP | WATER_FROZEN;
          break;
        case 'b':
          c.water[i] = WATER_DEPTH_DEEP;
          c.flags[i] = TILE_FLAG_BRIDGE;
          break;
        case 'L':
          c.ground[i] = LAVA;
          break;
        case 'r':
          c.flags[i] = TILE_FLAG_RAMP;
          break;
        case 'R':
          c.flags[i] = TILE_FLAG_RAMP;
          c.height[i] = 1;
          break;
        case 't':
          c.flags[i] = TILE_FLAG_STAIRS;
          break;
        default:
          if (ch >= '1' && ch <= '4') c.height[i] = Number(ch);
          else throw new Error(`unknown map character ${ch}`);
      }
    });
  });
}

function world(rows: readonly string[], opts: { memo?: boolean; size?: number } = {}): { grid: CollisionGrid; chunks: TestChunks; nextEpoch: () => void } {
  const chunks = new TestChunks();
  drawWorld(chunks, rows);
  const size = opts.size ?? Math.max(rows.length, ...rows.map((r) => r.length));
  // Fill every chunk of the world so that nothing inside it is void.
  for (let ty = 0; ty < size; ty += CHUNK_SIZE) for (let tx = 0; tx < size; tx += CHUNK_SIZE) chunks.chunkOf(0, tx, ty);
  let epoch = 0;
  const grid = new CollisionGrid({ chunks, worldTiles: size, ...(opts.memo === true ? { memo: true, epoch: () => epoch } : {}) });
  return { grid, chunks, nextEpoch: () => epoch++ };
}

/** Whether a circle overlaps (deeper than `tolerance`) a tile that blocks it relative to the tile under its centre. */
function overlapsBlocked(grid: CollisionGrid, layer: Layer, x: number, y: number, r: number, rules: MoverRules, tolerance = 1e-6): boolean {
  const ref = grid.tileInfo(layer, Math.floor(x / T), Math.floor(y / T));
  const level = infoLevel(ref);
  for (let ty = Math.floor((y - r) / T); ty <= Math.floor((y + r) / T); ty++) {
    for (let tx = Math.floor((x - r) / T); tx <= Math.floor((x + r) / T); tx++) {
      const qx = Math.min(Math.max(x, tx * T), tx * T + T);
      const qy = Math.min(Math.max(y, ty * T), ty * T + T);
      const d = Math.hypot(x - qx, y - qy);
      if (d >= r - tolerance) continue;
      if (blocksMover(rules, ref, grid.tileInfo(layer, tx, ty), level)) return true;
    }
  }
  return false;
}

function move(grid: CollisionGrid, x: number, y: number, r: number, dx: number, dy: number, rules: MoverRules = LAND_CREATURE_RULES): MoveResult {
  return moveCircle(grid, 0, x, y, r, dx, dy, rules, createMoveResult());
}

// -----------------------------------------------------------------------------------------------

describe('tile info', () => {
  it('derives the categories of every kind of tile', () => {
    const { grid } = world(['.#TEfwsibL', '..........']);
    const cat = (tx: number): number => infoCategories(grid.tileInfo(0, tx, 0));
    expect(cat(0)).toBe(0);
    expect(cat(1)).toBe(BLOCK_SOLID);
    expect(cat(2)).toBe(BLOCK_OBJECT);
    expect(cat(3)).toBe(BLOCK_OBJECT);
    expect(cat(4)).toBe(BLOCK_OBJECT); // east half of the 2×1 oak
    expect(cat(5)).toBe(BLOCK_DEEP_WATER);
    expect(cat(6)).toBe(0); // shallow water: wade
    expect(cat(7)).toBe(0); // frozen: walk on the ice
    expect(cat(8)).toBe(0); // bridge
    expect(cat(9)).toBe(BLOCK_HAZARD);
    expect(cat(10)).toBe(BLOCK_VOID); // the world is 10 tiles wide
  });

  it('treats tiles outside the world and in missing chunks as void', () => {
    const { grid, chunks } = world(['....'], { size: 64 });
    expect(grid.tileInfo(0, -1, 0)).toBe(BLOCK_VOID);
    expect(grid.tileInfo(0, 0, 64)).toBe(BLOCK_VOID);
    chunks.map.delete(packChunkId(0, 1, 1));
    expect(grid.tileInfo(0, 40, 40)).toBe(BLOCK_VOID);
    expect(grid.tileInfo(-1, 0, 0)).toBe(BLOCK_VOID);
  });

  it('lets a 2×1 footprint reach across a chunk border', () => {
    const chunks = new TestChunks();
    const row = `${'.'.repeat(31)}E..`;
    drawWorld(chunks, [row]);
    chunks.chunkOf(0, 32, 0);
    const grid = new CollisionGrid({ chunks, worldTiles: 64 });
    expect(infoCategories(grid.tileInfo(0, 31, 0))).toBe(BLOCK_OBJECT);
    expect(infoCategories(grid.tileInfo(0, 32, 0))).toBe(BLOCK_OBJECT);
    expect(infoCategories(grid.tileInfo(0, 33, 0))).toBe(0);
  });

  it('marks cliff faces exactly like the autotiler (wandAn) on random height fields', () => {
    const rng = new Rng(2301);
    let walls = 0;
    let ramps = 0;
    for (let trial = 0; trial < 40; trial++) {
      const chunks = new TestChunks();
      const c = chunks.chunkOf(0, 0, 0);
      for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
        c.height[i] = rng.int(0, 5);
        if (rng.bool(0.1)) c.flags[i] = rng.bool() ? TILE_FLAG_RAMP : TILE_FLAG_STAIRS;
      }
      const grid = new CollisionGrid({ chunks, worldTiles: CHUNK_SIZE });
      for (let ty = 4; ty < CHUNK_SIZE; ty++) {
        for (let tx = 0; tx < CHUNK_SIZE; tx++) {
          const u = {
            hoehe: (dx: number, dy: number) => c.height[idx(tx + dx, ty + dy)] as number,
            uebergang: (dx: number, dy: number) => {
              const f = c.flags[idx(tx + dx, ty + dy)] as number;
              return (f & TILE_FLAG_RAMP) !== 0 ? UEBERGANG.rampe : (f & TILE_FLAG_STAIRS) !== 0 ? UEBERGANG.treppe : UEBERGANG.keiner;
            },
          };
          const wand = wandAn(u);
          const info = grid.tileInfo(0, tx, ty);
          const ownConnector = ((c.flags[idx(tx, ty)] as number) & (TILE_FLAG_RAMP | TILE_FLAG_STAIRS)) !== 0;
          expect((info & BLOCK_WALL) !== 0).toBe(wand !== null && wand.art === UEBERGANG.keiner);
          expect(infoWallTop(info)).toBe(wand === null ? 0 : u.hoehe(0, wand.kanteDy));
          expect(infoConnector(info)).toBe(ownConnector || (wand !== null && wand.art !== UEBERGANG.keiner));
          expect(infoLevel(info)).toBe(u.hoehe(0, 0));
          if (wand !== null && wand.art === UEBERGANG.keiner) walls++;
          else if (wand !== null) ramps++;
        }
      }
    }
    expect(walls).toBeGreaterThan(1000);
    expect(ramps).toBeGreaterThan(50);
  });

  it('packs and unpacks tile infos', () => {
    const info = packTileInfo(BLOCK_WALL | BLOCK_OBJECT, 2, 4, true);
    expect(infoCategories(info)).toBe(BLOCK_WALL | BLOCK_OBJECT);
    expect(infoLevel(info)).toBe(2);
    expect(infoWallTop(info)).toBe(4);
    expect(infoConnector(info)).toBe(true);
  });
});

describe('mover rules', () => {
  const at = (cat: number, level: number, connector = false, wallTop = 0): number => packTileInfo(cat, level, wallTop, connector);
  it('player swims and jumps down, land creatures do neither', () => {
    const ground = at(0, 1);
    expect(blocksMover(PLAYER_RULES, ground, at(BLOCK_DEEP_WATER, 1), 0)).toBe(false);
    expect(blocksMover(LAND_CREATURE_RULES, ground, at(BLOCK_DEEP_WATER, 1), 0)).toBe(true);
    expect(blocksMover(PLAYER_RULES, ground, at(0, 0), 0)).toBe(false);
    expect(blocksMover(LAND_CREATURE_RULES, ground, at(0, 0), 0)).toBe(true);
    for (const rules of [PLAYER_RULES, LAND_CREATURE_RULES]) {
      expect(blocksMover(rules, ground, at(0, 2), 0)).toBe(true);
      expect(blocksMover(rules, ground, at(BLOCK_SOLID, 1), 0)).toBe(true);
      expect(blocksMover(rules, ground, at(BLOCK_OBJECT, 1), 0)).toBe(true);
      expect(blocksMover(rules, ground, at(BLOCK_HAZARD, 1), 0)).toBe(true);
      expect(blocksMover(rules, ground, at(BLOCK_WALL, 1, false, 2), 0)).toBe(true);
      expect(blocksMover(rules, ground, at(BLOCK_VOID, 0), 0)).toBe(true);
      // Ramps and stairs connect one level when both tiles belong to them.
      expect(blocksMover(rules, at(0, 1, true), at(0, 2, true), 0)).toBe(false);
      expect(blocksMover(rules, at(0, 2, true), at(0, 1, true), 0)).toBe(false);
      expect(blocksMover(rules, at(0, 1, false), at(0, 2, true), 0)).toBe(true);
      expect(blocksMover(rules, at(0, 1, true), at(0, 3, true), 0)).toBe(true);
    }
  });

  it('projectiles keep their flight level', () => {
    const ref = at(0, 0);
    expect(blocksMover(PROJECTILE_RULES, ref, at(BLOCK_DEEP_WATER, 0), 1)).toBe(false);
    expect(blocksMover(PROJECTILE_RULES, ref, at(BLOCK_HAZARD, 0), 1)).toBe(false);
    expect(blocksMover(PROJECTILE_RULES, ref, at(0, 0), 1)).toBe(false);
    expect(blocksMover(PROJECTILE_RULES, ref, at(0, 2), 1)).toBe(true);
    expect(blocksMover(PROJECTILE_RULES, ref, at(BLOCK_WALL, 0, false, 2), 1)).toBe(true);
    expect(blocksMover(PROJECTILE_RULES, ref, at(BLOCK_WALL, 0, false, 2), 2)).toBe(false);
    expect(blocksMover(PROJECTILE_RULES, ref, at(BLOCK_OBJECT, 0), 3)).toBe(true);
    expect(blocksMover(PROJECTILE_RULES, ref, at(BLOCK_SOLID, 0), 3)).toBe(true);
  });
});

describe('moving circles', () => {
  const open = ['........', '........', '........', '........'];

  it('moves freely in the open', () => {
    const { grid } = world(open);
    const r = move(grid, 40, 30, 5, 7.25, -3.5);
    expect(r.x).toBeCloseTo(47.25, 12);
    expect(r.y).toBeCloseTo(26.5, 12);
    expect([r.hit, r.level, r.dropped, r.normalX, r.normalY]).toEqual([false, 0, 0, 0, 0]);
  });

  it('stops at a wall at exactly its radius', () => {
    const { grid } = world(['....#...', '....#...', '....#...']);
    const r = move(grid, 40, 24, 5, 30, 0);
    expect(r.hit).toBe(true);
    expect(r.x).toBeCloseTo(4 * T - 5 - CONTACT_SKIN_PX, 9);
    expect(r.y).toBe(24);
    expect([r.normalX, r.normalY]).toEqual([-1, 0]);
  });

  it('slides along a wall when moving diagonally', () => {
    const { grid } = world(['....#...', '....#...', '....#...', '....#...', '....#...']);
    const r = move(grid, 58, 20, 5, 12, 30);
    expect(r.hit).toBe(true);
    expect(r.x).toBeCloseTo(4 * T - 5 - CONTACT_SKIN_PX, 9);
    expect(r.y).toBeCloseTo(50, 9);
  });

  it('glides around a convex corner and never enters it', () => {
    const { grid } = world(['........', '........', '...#....', '........', '........']);
    // Heading east just grazing the block's top-left corner: the round body is deflected upwards.
    let x = 30;
    let y = 2 * T - 3;
    for (let k = 0; k < 30; k++) {
      const r = move(grid, x, y, 5, 2, 0);
      x = r.x;
      y = r.y;
      expect(overlapsBlocked(grid, 0, x, y, 5, LAND_CREATURE_RULES)).toBe(false);
    }
    expect(x).toBeGreaterThan(4 * T + 5);
    expect(y).toBeLessThan(2 * T - 3);
    expect(y).toBeGreaterThan(2 * T - 5 - 0.01);
  });

  it('stops in a concave corner against both walls', () => {
    const { grid } = world(['#####', '#....', '#....', '#....']);
    const r = move(grid, 40, 40, 6, -40, -40);
    expect(r.x).toBeCloseTo(T + 6 + CONTACT_SKIN_PX, 6);
    expect(r.y).toBeCloseTo(T + 6 + CONTACT_SKIN_PX, 6);
    expect(overlapsBlocked(grid, 0, r.x, r.y, 6, LAND_CREATURE_RULES)).toBe(false);
  });

  it('cannot squeeze between two blocks that touch at a corner', () => {
    const { grid } = world(['......', '..#...', '...#..', '......']);
    // From the lower left towards the upper right, straight through the shared corner (48, 32).
    const r = move(grid, 40, 40, 3, 16, -16);
    expect(r.hit).toBe(true);
    expect(r.x < 48 || r.y > 32).toBe(true);
    expect(overlapsBlocked(grid, 0, r.x, r.y, 3, LAND_CREATURE_RULES)).toBe(false);
  });

  it('does not tunnel through a one-tile wall at 60 tiles/s from any direction', () => {
    // A wall one tile thick in column 10.
    const { grid } = world(Array.from({ length: 20 }, () => '..........#.........'));
    const step = 60 * T * (1 / 60); // one tile per tick
    for (const r of [1, 2.5, 5, 8, 15]) {
      for (let a = -60; a <= 60; a += 7.5) {
        const angle = (a * Math.PI) / 180;
        let x = 4 * T;
        let y = 10 * T + 3.3;
        for (let tick = 0; tick < 30; tick++) {
          const m = move(grid, x, y, r, step * Math.cos(angle), step * Math.sin(angle));
          x = m.x;
          y = m.y;
          expect(x).toBeLessThan(10 * T);
          expect(overlapsBlocked(grid, 0, x, y, r, LAND_CREATURE_RULES)).toBe(false);
        }
      }
    }
  });

  it('keeps fast movers out of every blocked tile in random mazes (60 tiles/s)', () => {
    const rng = new Rng(77);
    for (let trial = 0; trial < 8; trial++) {
      const rows = Array.from({ length: 32 }, (_, y) => Array.from({ length: 32 }, (__, x) => (x === 0 || y === 0 || x === 31 || y === 31 || rng.bool(0.18) ? '#' : '.')).join(''));
      const { grid } = world(rows);
      for (let m = 0; m < 40; m++) {
        let x = 0;
        let y = 0;
        const r = rng.float(1, 7.5);
        do {
          x = rng.float(T, 31 * T);
          y = rng.float(T, 31 * T);
        } while (overlapsBlocked(grid, 0, x, y, r, LAND_CREATURE_RULES));
        for (let tick = 0; tick < 60; tick++) {
          const speed = rng.float(0, T);
          const angle = rng.float(0, 2 * Math.PI);
          const res = move(grid, x, y, r, speed * Math.cos(angle), speed * Math.sin(angle));
          x = res.x;
          y = res.y;
          expect(overlapsBlocked(grid, 0, x, y, r, LAND_CREATURE_RULES)).toBe(false);
        }
      }
    }
  });

  it('climbs cliffs only along ramps and stairs; the player jumps down, creatures do not', () => {
    // Plateau (level 1) in rows 0–3; its south edge drops to level 0 with a cliff face in row 4,
    // except at the ramp column 3 (R on the plateau edge, r on the face row below).
    const rows = ['11111111', '11111111', '11111111', '111R1111', '...r....', '........', '........'];
    const { grid } = world(rows);
    // Row 4 is the cliff face (wall) except the ramp column.
    expect(infoCategories(grid.tileInfo(0, 1, 4))).toBe(BLOCK_WALL);
    expect(infoCategories(grid.tileInfo(0, 3, 4))).toBe(0);
    expect(infoConnector(grid.tileInfo(0, 3, 4))).toBe(true);
    for (const rules of [PLAYER_RULES, LAND_CREATURE_RULES]) {
      // Walking north into the face next to the ramp stops at the face.
      const blocked = move(grid, 1.5 * T, 6 * T, 5, 0, -40, rules);
      expect(blocked.hit).toBe(true);
      expect(blocked.y).toBeCloseTo(5 * T + 5 + CONTACT_SKIN_PX, 6);
      // Up the ramp column onto the plateau.
      let x = 3.5 * T;
      let y = 6 * T;
      let res = move(grid, x, y, 5, 0, 0, rules);
      for (let k = 0; k < 40; k++) {
        res = move(grid, x, y, 5, 0, -2, rules);
        x = res.x;
        y = res.y;
      }
      expect(y).toBeLessThan(3 * T);
      expect(res.level).toBe(1);
      expect(res.dropped).toBe(0);
    }
    // East edge of a plateau without ramp: the player steps down (a drop), the creature cannot. Once
    // its centre is below the edge, the plateau blocks it like any higher tile: it is pushed clear of
    // the ledge (at most by its radius) and cannot climb back.
    const east = world(['1111....', '1111....', '1111....']);
    const player = move(east.grid, 3 * T, 1.5 * T, 5, 30, 0, PLAYER_RULES);
    expect(player.level).toBe(0);
    expect(player.dropped).toBe(1);
    expect(player.x).toBeGreaterThanOrEqual(3 * T + 30);
    expect(player.x).toBeLessThanOrEqual(3 * T + 30 + 5);
    expect(player.y).toBe(1.5 * T);
    expect(overlapsBlocked(east.grid, 0, player.x, player.y, 5, PLAYER_RULES)).toBe(false);
    const creature = move(east.grid, 3 * T, 1.5 * T, 5, 30, 0, LAND_CREATURE_RULES);
    expect(creature.hit).toBe(true);
    expect(creature.x).toBeCloseTo(4 * T - 5 - CONTACT_SKIN_PX, 6);
    expect(creature.level).toBe(1);
    // And nobody walks back up that edge.
    for (const rules of [PLAYER_RULES, LAND_CREATURE_RULES]) {
      const up = move(east.grid, 6 * T, 1.5 * T, 5, -40, 0, rules);
      expect(up.hit).toBe(true);
      expect(up.x).toBeCloseTo(4 * T + 5 + CONTACT_SKIN_PX, 6);
    }
  });

  it('applies the water and lava rules', () => {
    const { grid } = world(['.....w....', '.....i....', '.....b....', '.....s....', '.....L....']);
    const through = (row: number, rules: MoverRules): boolean => move(grid, 3 * T, (row + 0.5) * T, 5, 60, 0, rules).x > 6 * T;
    expect(through(0, PLAYER_RULES)).toBe(true);
    expect(through(0, LAND_CREATURE_RULES)).toBe(false);
    for (const rules of [PLAYER_RULES, LAND_CREATURE_RULES]) {
      expect(through(1, rules)).toBe(true);
      expect(through(2, rules)).toBe(true);
      expect(through(3, rules)).toBe(true);
      expect(through(4, rules)).toBe(false);
    }
    // Projectiles fly over water and lava.
    expect(through(0, PROJECTILE_RULES)).toBe(true);
    expect(through(4, PROJECTILE_RULES)).toBe(true);
  });

  it('flying circles keep the level they started on', () => {
    const { grid } = world(['........', '.....222', '........']);
    const res = move(grid, 1.5 * T, 1.5 * T, 3, 80, 0, PROJECTILE_RULES);
    expect(res.hit).toBe(true);
    expect(res.x).toBeCloseTo(5 * T - 3 - CONTACT_SKIN_PX, 6);
    expect(res.level).toBe(0);
    // A wide ramp rises in front of a flyer on the lower level: it hits the ramp tiles below the
    // edge, with and without memo (the open fast path must not skip them).
    const ramp = ['11111111', '11111111', '1RRRR111', '.rrrr...', '........', '........', '........'];
    for (const memo of [false, true]) {
      const hit = move(world(ramp, { memo }).grid, 3.5 * T, 4.5 * T, 8, 0, -6, PROJECTILE_RULES);
      expect(hit.hit).toBe(true);
      expect(hit.y).toBeCloseTo(4 * T + 8 + CONTACT_SKIN_PX, 6);
    }
  });

  it('crosses chunk borders and stops at the world edge', () => {
    const { grid } = world(['.'], { size: 64 });
    const across = move(grid, 30 * T, 10 * T, 5, 4 * T, 3 * T);
    expect(across.x).toBeCloseTo(34 * T, 9);
    expect(across.y).toBeCloseTo(13 * T, 9);
    expect(across.hit).toBe(false);
    const edge = move(grid, 62 * T, 10 * T, 5, 3 * T, 0);
    expect(edge.hit).toBe(true);
    expect(edge.x).toBeCloseTo(64 * T - 5 - CONTACT_SKIN_PX, 6);
  });

  it('rejects radii beyond one tile and non-finite displacements', () => {
    const { grid } = world(open);
    expect(() => move(grid, 40, 30, 0, 1, 1)).toThrow(RangeError);
    expect(() => move(grid, 40, 30, T + 1, 1, 1)).toThrow(RangeError);
    expect(() => move(grid, 40, 30, 5, Number.NaN, 1)).toThrow(RangeError);
    expect(() => move(grid, 40, 30, 5, Number.POSITIVE_INFINITY, 1)).toThrow(RangeError);
  });

  it('moves a batch exactly like single moves', () => {
    const rng = new Rng(9);
    const rows = Array.from({ length: 64 }, () => Array.from({ length: 64 }, () => (rng.bool(0.08) ? '#' : rng.bool(0.04) ? 'E' : '.')).join(''));
    const { grid } = world(rows);
    const n = 300;
    const batch = {
      count: n,
      x: new Float64Array(n),
      y: new Float64Array(n),
      dx: new Float64Array(n),
      dy: new Float64Array(n),
      r: new Float64Array(n),
      result: new Int32Array(n),
      normalX: new Float64Array(n),
      normalY: new Float64Array(n),
    };
    for (let i = 0; i < n; i++) {
      batch.x[i] = rng.float(T, 63 * T);
      batch.y[i] = rng.float(T, 63 * T);
      batch.dx[i] = rng.float(-T, T);
      batch.dy[i] = rng.float(-T, T);
      batch.r[i] = rng.float(2, 8);
    }
    const expected = Array.from({ length: n }, (_, i) => move(grid, batch.x[i] as number, batch.y[i] as number, batch.r[i] as number, batch.dx[i] as number, batch.dy[i] as number));
    moveCircles(grid, 0, batch, LAND_CREATURE_RULES);
    for (let i = 0; i < n; i++) {
      const e = expected[i] as MoveResult;
      expect([batch.x[i], batch.y[i], batch.normalX[i], batch.normalY[i]]).toEqual([e.x, e.y, e.normalX, e.normalY]);
      expect([((batch.result[i] as number) & MOVE_HIT) !== 0, moveResultLevel(batch.result[i] as number), moveResultDropped(batch.result[i] as number)]).toEqual([e.hit, e.level, e.dropped]);
    }
  });
});

describe('memoised tile infos', () => {
  function randomRows(rng: Rng, size: number): string[] {
    const pick = '....................#TEwsLf12rR';
    return Array.from({ length: size }, () => Array.from({ length: size }, () => pick[rng.int(0, pick.length)] as string).join(''));
  }

  it('moves exactly like the live grid, also after reported edits', () => {
    const rng = new Rng(314);
    for (let trial = 0; trial < 4; trial++) {
      const rows = randomRows(rng, 64);
      const live = world(rows);
      const memo = world(rows, { memo: true });
      const edit = (w: { chunks: TestChunks }, tx: number, ty: number, kind: number): void => {
        const c = w.chunks.chunkOf(0, tx, ty);
        const i = idx(tx, ty);
        if (kind === 0) c.object[i] = c.object[i] === 0 ? EICHE : 0;
        else if (kind === 1) c.solid[i] = c.solid[i] === 0 ? FELS : 0;
        else if (kind === 2) c.height[i] = ((c.height[i] as number) + 1) % 3;
        else c.water[i] = (c.water[i] as number) ^ WATER_FROZEN;
      };
      for (let step = 0; step < 400; step++) {
        const x = rng.float(8, 64 * T - 8);
        const y = rng.float(8, 64 * T - 8);
        const dx = rng.float(-T, T);
        const dy = rng.float(-T, T);
        const r = rng.float(2, 8);
        const rules = [PLAYER_RULES, LAND_CREATURE_RULES, PROJECTILE_RULES][rng.int(0, 3)] as MoverRules;
        expect(moveCircle(memo.grid, 0, x, y, r, dx, dy, rules, createMoveResult())).toEqual(moveCircle(live.grid, 0, x, y, r, dx, dy, rules, createMoveResult()));
        if (step % 10 === 0) {
          const tx = rng.int(0, 64);
          const ty = rng.int(0, 64);
          const kind = rng.int(0, 4);
          edit(live, tx, ty, kind);
          edit(memo, tx, ty, kind);
          memo.grid.invalidateTile(0, tx, ty);
          expect(memo.grid.staleTiles()).toEqual([]);
        }
      }
    }
  });

  it('reports unreported edits as stale and picks up replaced chunks by itself', () => {
    const { grid, chunks, nextEpoch } = world(['........'], { memo: true, size: 64 });
    for (let ty = 0; ty < 64; ty++) for (let tx = 0; tx < 64; tx++) grid.tileInfo(0, tx, ty);
    chunks.chunkOf(0, 5, 5).solid[idx(5, 5)] = FELS;
    expect(grid.staleTiles()).toEqual([{ layer: 0, tx: 5, ty: 5 }]);
    grid.invalidateChunk(0, 0, 0);
    expect(grid.staleTiles()).toEqual([]);
    expect(infoCategories(grid.tileInfo(0, 5, 5))).toBe(BLOCK_SOLID);
    // A reloaded chunk is a new instance: its memo and its neighbours' borders are rebuilt.
    const fresh = new ChunkData(0, 1, 0);
    fresh.ground.fill(GRAS);
    fresh.height.fill(3);
    chunks.map.set(packChunkId(0, 1, 0), fresh);
    nextEpoch();
    expect(infoLevel(grid.tileInfo(0, 40, 3))).toBe(3);
    expect(grid.staleTiles()).toEqual([]);
    // The face row below a plateau that appears in the chunk north of it.
    chunks.map.delete(packChunkId(0, 0, 0));
    nextEpoch();
    expect(grid.tileInfo(0, 3, 3)).toBe(BLOCK_VOID);
    expect(grid.tileInfo(0, 3, 33)).toBe(grid.liveInfo(0, 3, 33));
    const north = new ChunkData(0, 0, 0);
    north.ground.fill(GRAS);
    north.height.fill(2);
    chunks.map.set(packChunkId(0, 0, 0), north);
    nextEpoch();
    expect(grid.tileInfo(0, 3, 32)).toBe(grid.liveInfo(0, 3, 32));
    expect((grid.tileInfo(0, 3, 32) & BLOCK_WALL) !== 0).toBe(true);
    expect(grid.staleTiles()).toEqual([]);
  });
});

describe('moving boxes', () => {
  it('stops exactly at tile faces and slides along them', () => {
    const { grid } = world(['....#...', '....#...', '....#...', '....#...', '........', '########']);
    const out = createMoveResult();
    moveBox(grid, 0, 40, 24, 6, 4, 30, 25, LAND_CREATURE_RULES, out);
    expect(out.hit).toBe(true);
    expect(out.x).toBeCloseTo(4 * T - 6 - CONTACT_SKIN_PX, 9);
    expect(out.y).toBeCloseTo(49, 9);
    moveBox(grid, 0, 40, 60, 6, 4, 0, 30, LAND_CREATURE_RULES, out);
    expect(out.y).toBeCloseTo(5 * T - 4 - CONTACT_SKIN_PX, 9);
    expect([out.normalX, out.normalY]).toEqual([0, -1]);
  });

  it('does not tunnel at 60 tiles/s', () => {
    const rows = Array.from({ length: 12 }, () => '......#.....');
    const { grid } = world(rows);
    const out = createMoveResult();
    for (const [hw, hh] of [
      [1, 1],
      [4, 7],
      [8, 8],
      [16, 3],
    ] as const) {
      let x = 2 * T;
      let y = 5 * T;
      for (let tick = 0; tick < 20; tick++) {
        moveBox(grid, 0, x, y, hw, hh, T, T * 0.3, LAND_CREATURE_RULES, out);
        x = out.x;
        y = out.y;
        expect(x + hw).toBeLessThanOrEqual(6 * T);
      }
    }
  });
});

describe('swept tests for projectiles', () => {
  it('finds the exact contact with a wall and a rounded corner', () => {
    const { grid } = world(['..........', '..........', '......#...', '..........']);
    const hit = createSweepHit();
    sweepCircle(grid, 0, 8, 2.5 * T, 150, 2.5 * T, 0, PROJECTILE_RULES, 0, hit);
    expect(hit.hit).toBe(true);
    expect(hit.x).toBeCloseTo(6 * T, 9);
    expect([hit.normalX, hit.normalY, hit.tileX, hit.tileY]).toEqual([-1, 0, 6, 2]);
    // A circle of radius 4 passing 2 px above the block's top face (y = 32) touches its round corner.
    const y = 2 * T - 2;
    sweepCircle(grid, 0, 8, y, 150, y, 4, PROJECTILE_RULES, 0, hit);
    expect(hit.hit).toBe(true);
    const cornerX = 6 * T - Math.sqrt(16 - 4);
    expect(hit.x).toBeCloseTo(cornerX, 9);
    expect(Math.hypot(hit.normalX, hit.normalY)).toBeCloseTo(1, 9);
  });

  it('walks the grid without missing a tile: matches a brute-force search over every blocked tile', () => {
    const rng = new Rng(4242);
    const rows = Array.from({ length: 40 }, () => Array.from({ length: 40 }, () => (rng.bool(0.12) ? '#' : rng.bool(0.05) ? 'T' : '.')).join(''));
    const { grid } = world(rows);
    const hit = createSweepHit();
    let hits = 0;
    for (let k = 0; k < 1500; k++) {
      const x0 = rng.float(0, 40 * T);
      const y0 = rng.float(0, 40 * T);
      const x1 = rng.float(0, 40 * T);
      const y1 = rng.float(0, 40 * T);
      const r = rng.bool(0.3) ? 0 : rng.float(0.5, T);
      let best = Number.POSITIVE_INFINITY;
      for (let ty = Math.floor((Math.min(y0, y1) - r) / T) - 1; ty <= Math.floor((Math.max(y0, y1) + r) / T) + 1; ty++) {
        for (let tx = Math.floor((Math.min(x0, x1) - r) / T) - 1; tx <= Math.floor((Math.max(x0, x1) + r) / T) + 1; tx++) {
          if (!blocksMover(PROJECTILE_RULES, 0, grid.tileInfo(0, tx, ty), 0)) continue;
          if (segmentVsRoundedBox(x0, y0, x1 - x0, y1 - y0, r, tx * T, ty * T, tx * T + T, ty * T + T)) best = Math.min(best, sweepContact.t);
        }
      }
      sweepCircle(grid, 0, x0, y0, x1, y1, r, PROJECTILE_RULES, 0, hit);
      if (Number.isFinite(best)) {
        hits++;
        expect(hit.hit).toBe(true);
        expect(hit.t).toBe(best);
      } else expect(hit.hit).toBe(false);
    }
    expect(hits).toBeGreaterThan(1000);
  });

  it('computes the contact time of a moving circle and a box exactly', () => {
    const rng = new Rng(4243);
    let checked = 0;
    for (let k = 0; k < 3000; k++) {
      const x0 = rng.float(-40, 60);
      const y0 = rng.float(-40, 60);
      const dx = rng.float(-80, 80);
      const dy = rng.float(-80, 80);
      const r = rng.bool(0.2) ? 0 : rng.float(0.5, 16);
      const ref = toiOf(x0, y0, x0 + dx, y0 + dy, r, 0, 0);
      const touched = segmentVsRoundedBox(x0, y0, dx, dy, r, 0, 0, T, T);
      // Skip grazing contacts: the reference samples the path and may miss a touch shorter than a sample.
      const closest = closestApproach(x0, y0, dx, dy, r);
      if (Math.abs(closest) < 1e-3) continue;
      checked++;
      expect(touched).toBe(Number.isFinite(ref));
      if (touched) {
        expect(sweepContact.t).toBeCloseTo(ref, 9);
        expect(Math.hypot(sweepContact.nx, sweepContact.ny)).toBeCloseTo(1, 9);
      }
    }
    expect(checked).toBeGreaterThan(2500);
  });

  it('never tunnels, whatever the speed', () => {
    const rows = Array.from({ length: 8 }, () => `${'.'.repeat(100)}#${'.'.repeat(100)}`);
    const { grid } = world(rows, { size: 256 });
    const hit = createSweepHit();
    for (const len of [T, 3 * T, 60 * T, 150 * T]) {
      for (const r of [0, 1, 6]) {
        sweepCircle(grid, 0, 90 * T, 3.3 * T, 90 * T + len, 3.3 * T + len * 0.01, r, PROJECTILE_RULES, 0, hit);
        if (len > 10 * T) {
          expect(hit.hit).toBe(true);
          expect(hit.x + r).toBeCloseTo(100 * T, 6);
        }
      }
    }
    // 1 tile per tick at 60 tiles/s, tick by tick.
    let x = 95 * T;
    for (let tick = 0; tick < 10; tick++) {
      sweepCircle(grid, 0, x, 2.5 * T, x + T, 2.5 * T, 2, PROJECTILE_RULES, 0, hit);
      x = hit.x;
      if (hit.hit) break;
    }
    expect(hit.hit).toBe(true);
    expect(x).toBeCloseTo(100 * T - 2, 9);
  });

  it('keeps the flight level: over water, lava and lower ground; into higher cliffs', () => {
    const { grid } = world(['..wwLL..2', '.........', '222222222', '222222222', '.........']);
    const hit = createSweepHit();
    sweepCircle(grid, 0, 8, 8, 8 * T + 4, 8, 1, PROJECTILE_RULES, 0, hit);
    expect(hit.hit).toBe(true);
    expect(hit.tileX).toBe(8);
    // Shot from level 2 over the face row south of the plateau: passes.
    sweepCircle(grid, 0, 4 * T, 3.5 * T, 4 * T, 4.9 * T, 1, PROJECTILE_RULES, 2, hit);
    expect(hit.hit).toBe(false);
    // Shot from level 0 north into the cliff face (the drop of 2 levels shows faces in rows 4 and 5).
    sweepCircle(grid, 0, 4 * T, 6.5 * T, 4 * T, 0.5 * T, 1, PROJECTILE_RULES, 0, hit);
    expect(hit.hit).toBe(true);
    expect(hit.tileY).toBe(5);
    expect(hit.y).toBeCloseTo(6 * T + 1, 9);
  });

  it('reports a start inside an obstacle at t = 0', () => {
    const { grid } = world(['....', '.#..', '....']);
    const hit = createSweepHit();
    sweepCircle(grid, 0, 1.5 * T, 1.5 * T, 3.5 * T, 1.5 * T, 0, PROJECTILE_RULES, 0, hit);
    expect([hit.hit, hit.t]).toEqual([true, 0]);
    sweepCircle(grid, 0, 2 * T + 2, 1.5 * T, 3.5 * T, 1.5 * T, 3, PROJECTILE_RULES, 0, hit);
    expect([hit.hit, hit.t]).toEqual([true, 0]);
  });

  it('rejects radii beyond one tile and non-finite coordinates', () => {
    const { grid } = world(['....', '....']);
    const hit = createSweepHit();
    expect(() => sweepCircle(grid, 0, 8, 8, 40, 8, T + 1, PROJECTILE_RULES, 0, hit)).toThrow(RangeError);
    expect(() => sweepCircle(grid, 0, 8, 8, 40, 8, -1, PROJECTILE_RULES, 0, hit)).toThrow(RangeError);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => sweepCircle(grid, 0, bad, 8, 40, 8, 2, PROJECTILE_RULES, 0, hit)).toThrow(RangeError);
      expect(() => sweepCircle(grid, 0, 8, bad, 40, 8, 2, PROJECTILE_RULES, 0, hit)).toThrow(RangeError);
      expect(() => sweepCircle(grid, 0, 8, 8, bad, 8, 2, PROJECTILE_RULES, 0, hit)).toThrow(RangeError);
      expect(() => sweepCircle(grid, 0, 8, 8, 40, bad, 2, PROJECTILE_RULES, 0, hit)).toThrow(RangeError);
    }
    expect(sweepCircle(grid, 0, 8, 8, 40, 8, 2, PROJECTILE_RULES, 0, hit).hit).toBe(false);
  });
});

/** Smallest signed distance (distance − r) between the moving circle's path and tile (0, 0) (sampled). */
function closestApproach(x0: number, y0: number, dx: number, dy: number, r: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (let s = 0; s <= 4096; s++) {
    const x = x0 + (dx * s) / 4096;
    const y = y0 + (dy * s) / 4096;
    const qx = Math.min(Math.max(x, 0), T);
    const qy = Math.min(Math.max(y, 0), T);
    best = Math.min(best, Math.abs(Math.hypot(x - qx, y - qy) - r));
  }
  return best;
}

/** Time of the first contact of a sweep with one tile (brute-force reference). */
function toiOf(x0: number, y0: number, x1: number, y1: number, r: number, tx: number, ty: number): number {
  // Sampling for the first contact, then bisection on the distance function.
  const dist = (t: number): number => {
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    const qx = Math.min(Math.max(x, tx * T), tx * T + T);
    const qy = Math.min(Math.max(y, ty * T), ty * T + T);
    const inside = x > tx * T && x < tx * T + T && y > ty * T && y < ty * T + T;
    return inside ? -1 : Math.hypot(x - qx, y - qy) - r;
  };
  if (dist(0) < 0 || (r > 0 && dist(0) === 0 && dist(1e-9) < 0)) return 0;
  // Coarse scan for the first sign change, then bisection.
  const steps = 4096;
  let prev = 0;
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    if (dist(t) <= 0) {
      let lo = prev;
      let hi = t;
      for (let k = 0; k < 80; k++) {
        const mid = (lo + hi) / 2;
        if (dist(mid) <= 0) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    prev = t;
  }
  return Number.POSITIVE_INFINITY;
}

describe('entity hash grid', () => {
  function randomBodies(rng: Rng, n: number, grid: BodyGrid, extent = 1200): Array<{ id: number; layer: Layer; x: number; y: number; r: number }> {
    const bodies = Array.from({ length: n }, (_, i) => ({ id: 1000 + i * 3, layer: (rng.bool(0.8) ? 0 : -1) as Layer, x: rng.float(-200, extent), y: rng.float(-200, extent), r: rng.float(0, 12) }));
    grid.clear();
    for (const b of bodies) grid.add(b.id, b.layer, b.x, b.y, b.r);
    grid.build();
    return bodies;
  }

  it('queries match brute force, in a deterministic order', () => {
    const rng = new Rng(55);
    const grid = new BodyGrid();
    const bodies = randomBodies(rng, 700, grid);
    const out = new Int32Array(64);
    for (let k = 0; k < 300; k++) {
      const layer: Layer = rng.bool(0.8) ? 0 : -1;
      const x = rng.float(-250, 1250);
      const y = rng.float(-250, 1250);
      const r = rng.float(0, 40);
      const n = grid.queryCircle(layer, x, y, r, out);
      const got = Array.from(out.subarray(0, n), (i) => grid.idOf(i)).sort((a, b) => a - b);
      const want = bodies.filter((b) => b.layer === layer && Math.hypot(b.x - x, b.y - y) <= b.r + r).map((b) => b.id);
      expect(got).toEqual(want);
      const again = grid.queryCircle(layer, x, y, r, new Int32Array(64));
      expect(again).toBe(n);
    }
    // Huge queries fall back to scanning every body.
    const all = new Int32Array(1024);
    const n = grid.queryCircle(0, 500, 500, 1e6, all);
    expect(n).toBe(bodies.filter((b) => b.layer === 0).length);
  });

  it('lists every overlapping pair exactly once', () => {
    const rng = new Rng(56);
    const grid = new BodyGrid();
    const bodies = randomBodies(rng, 900, grid, 500);
    const pairs = new Int32Array(20_000);
    const n = grid.overlapPairs(pairs);
    const got: string[] = [];
    for (let k = 0; k < n; k++) got.push(`${grid.idOf(pairs[2 * k] as number)}-${grid.idOf(pairs[2 * k + 1] as number)}`);
    const want: string[] = [];
    bodies.forEach((a, i) => {
      bodies.forEach((b, j) => {
        if (j > i && a.layer === b.layer && Math.hypot(a.x - b.x, a.y - b.y) <= a.r + b.r) want.push(`${a.id}-${b.id}`);
      });
    });
    expect(n).toBeGreaterThan(100);
    expect(got.sort()).toEqual(want.sort());
    for (let k = 0; k < n; k++) expect(pairs[2 * k] as number).toBeLessThan(pairs[2 * k + 1] as number);
    const neighbours = new Int32Array(32);
    const count = grid.queryBody(0, neighbours);
    expect(Array.from(neighbours.subarray(0, count)).includes(0)).toBe(false);
  });

  it('caps pile-ups per body and scans all bodies around huge ones', () => {
    /** Pairs each body would report under the per-body cap of 64 (smaller index first). */
    const expectedPairs = (bodies: ReadonlyArray<{ layer: Layer; x: number; y: number; r: number }>): number =>
      bodies.reduce((sum, a, i) => sum + Math.min(64, bodies.filter((b, j) => j > i && b.layer === a.layer && Math.hypot(a.x - b.x, a.y - b.y) <= a.r + b.r).length), 0);
    const check = (bodies: ReadonlyArray<{ layer: Layer; x: number; y: number; r: number }>): void => {
      const grid = new BodyGrid();
      bodies.forEach((b, i) => grid.add(i + 1, b.layer, b.x, b.y, b.r));
      grid.build();
      const pairs = new Int32Array(20_000);
      const n = grid.overlapPairs(pairs);
      expect(n).toBe(expectedPairs(bodies));
      const seen = new Set<string>();
      for (let k = 0; k < n; k++) {
        const i = pairs[2 * k] as number;
        const j = pairs[2 * k + 1] as number;
        const a = bodies[i];
        const b = bodies[j];
        expect(i).toBeLessThan(j);
        expect(a?.layer).toBe(b?.layer);
        expect(Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0))).toBeLessThanOrEqual((a?.r ?? 0) + (b?.r ?? 0));
        seen.add(`${i}-${j}`);
      }
      expect(seen.size).toBe(n);
      // A short output buffer still reports the full count.
      const short = new Int32Array(10);
      expect(grid.overlapPairs(short)).toBe(n);
      expect(Array.from(short)).toEqual(Array.from(pairs.subarray(0, 10)));
    };
    // 100 small bodies on one spot (cell scan) and one on another layer.
    const pile = Array.from({ length: 100 }, (_, i) => ({ layer: 0 as Layer, x: 40 + (i % 3), y: 40 + (i % 5), r: 4 }));
    check([...pile, { layer: -1, x: 40, y: 40, r: 4 }]);
    // One huge body: every body on its layer scans all bodies instead of the cells.
    check([{ layer: 0, x: 500, y: 500, r: 2000 }, ...pile, { layer: 0, x: 3000, y: 3000, r: 1 }, { layer: -1, x: 40, y: 40, r: 4 }]);
  });

  it('sweeps find the first body like brute force', () => {
    const rng = new Rng(57);
    const grid = new BodyGrid();
    const bodies = randomBodies(rng, 500, grid);
    const hit = createBodyHit();
    for (let k = 0; k < 300; k++) {
      const x0 = rng.float(0, 1000);
      const y0 = rng.float(0, 1000);
      const x1 = x0 + rng.float(-80, 80);
      const y1 = y0 + rng.float(-80, 80);
      const r = rng.float(0, 3);
      grid.sweep(0, x0, y0, x1, y1, r, hit);
      let best = Number.POSITIVE_INFINITY;
      let bestIndex = -1;
      bodies.forEach((b, i) => {
        if (b.layer !== 0) return;
        const t = toiCircle(x0, y0, x1, y1, b.x, b.y, b.r + r);
        if (t < best || (t === best && i < bestIndex)) {
          best = t;
          bestIndex = i;
        }
      });
      if (Number.isFinite(best)) {
        expect(hit.hit).toBe(true);
        expect(hit.t).toBeCloseTo(best, 9);
        expect(hit.id).toBe(bodies[hit.index]?.id);
      } else expect(hit.hit).toBe(false);
    }
  });

  it('grows, rebuilds and validates', () => {
    const grid = new BodyGrid();
    expect(() => grid.queryCircle(0, 0, 0, 1, new Int32Array(4))).toThrow(/build/);
    const ids = new Float64Array(3000).map((_, i) => i);
    const xs = new Float64Array(3000).map((_, i) => (i % 60) * 10);
    const ys = new Float64Array(3000).map((_, i) => Math.floor(i / 60) * 10);
    const rs = new Float64Array(3000).fill(5);
    grid.addColumns(3000, ids, 0, xs, ys, rs);
    grid.build();
    expect(grid.size).toBe(3000);
    const out = new Int32Array(8);
    expect(grid.queryBody(61, out)).toBe(4);
    expect(() => grid.add(1, 0, Number.NaN, 0, 1)).toThrow(RangeError);
    expect(() => grid.add(1, 0, 0, 0, -1)).toThrow(RangeError);
    expect(() => grid.addColumns(4, ids, 0, xs, ys, new Float64Array(2))).toThrow(RangeError);
    grid.clear();
    grid.add(7, 0, 0, 0, 1);
    grid.build();
    expect(grid.queryCircle(0, 0, 0, 0, out)).toBe(1);
    expect(grid.idOf(out[0] as number)).toBe(7);
  });
});

/** First time a point moving from p0 to p1 is within `reach` of (cx, cy), or +∞. */
function toiCircle(x0: number, y0: number, x1: number, y1: number, cx: number, cy: number, reach: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const mx = x0 - cx;
  const my = y0 - cy;
  const c = mx * mx + my * my - reach * reach;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy;
  const b = mx * dx + my * dy;
  const disc = b * b - a * c;
  if (a === 0 || b >= 0 || disc < 0) return Number.POSITIVE_INFINITY;
  const t = (-b - Math.sqrt(disc)) / a;
  return t <= 1 ? t : Number.POSITIVE_INFINITY;
}
