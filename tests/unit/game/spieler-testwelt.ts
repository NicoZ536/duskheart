/**
 * Test support for the player tests (bewegung, klippen-wasser, werte, temperatur, spieler-*):
 * a simulation with the player's systems on a hand-drawn world (ASCII rows, like the M2-23 collision
 * tests) and a controllable environment (air temperature, rain).
 *
 * Legend: `.` grass on level 0 · `1`–`4` grass on that level · `w` deep water · `s` shallow water ·
 * `T` birch (blocks one tile) · `#` solid rock · `r`/`R` ramp tile on level 0/1 · `S` sand on level 0.
 * Row 0 is tile row `OFFSET`, column 0 tile column `OFFSET` (the map lies away from the world edge);
 * everything outside the drawn rows is grass on level 0.
 */
import { NULL_ENTITY } from '../../../src/engine/ecs';
import { createDebugCheats, type DebugCheats } from '../../../src/game/cheats/state';
import { WorldCollision } from '../../../src/game/player/collision';
import { registerPlayerComponents, type PlayerComponents } from '../../../src/game/player/components';
import type { PlayerBody } from '../../../src/game/player/state';
import { PlayerSystem } from '../../../src/game/player/system';
import { Simulation } from '../../../src/game/sim';
import type { SurvivalEnvironment } from '../../../src/game/survival/environment';
import { PlayerInfluences } from '../../../src/game/survival/modifiers';
import type { Vitals } from '../../../src/game/survival/state';
import { VitalsSystem } from '../../../src/game/survival/system';
import { MotionSystem } from '../../../src/game/systems/motion';
import type { GameCommand } from '../../../src/game/commands';
import { ChunkData, TILE_FLAG_RAMP, WATER_DEPTH_DEEP, WATER_DEPTH_SHALLOW } from '../../../src/world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX, packChunkId, type Layer } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';

/** Tile offset of the drawn map (keeps it off the world edge). */
export const OFFSET = 64;
/** World edge of the test worlds [tiles] (the small preset). */
export const WORLD_TILES = 1024;
export const T = TILE_PX;

const IDS = contentWorldIdTables();
const GRAS = IDS.terrain.runtimeId('gras');
const SAND = IDS.terrain.runtimeId('sand');
const FELS = IDS.terrain.runtimeId('fels');
const BIRKE = IDS.objects.runtimeId('baum_birke');

/** Chunk source over hand-drawn chunks (every chunk of the surface exists, grass on level 0). */
export class TestChunks {
  readonly map = new Map<number, ChunkData>();
  get(layer: Layer, cx: number, cy: number): ChunkData | undefined {
    if (cx < 0 || cy < 0 || cx >= WORLD_TILES >> CHUNK_SHIFT || cy >= WORLD_TILES >> CHUNK_SHIFT) return undefined;
    const key = packChunkId(layer, cx, cy);
    let c = this.map.get(key);
    if (c === undefined) {
      c = new ChunkData(layer, cx, cy);
      c.ground.fill(GRAS);
      this.map.set(key, c);
    }
    return c;
  }
  /** Chunk and local index of a tile. */
  at(tx: number, ty: number, layer: Layer = 0): { chunk: ChunkData; i: number } {
    const chunk = this.get(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    if (chunk === undefined) throw new Error(`tile ${tx},${ty} outside the test world`);
    return { chunk, i: ((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK) };
  }
}

/** Draws `rows` at (OFFSET, OFFSET). */
export function draw(chunks: TestChunks, rows: readonly string[]): void {
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const { chunk: c, i } = chunks.at(OFFSET + x, OFFSET + y);
      switch (ch) {
        case '.':
          break;
        case 'w':
          c.water[i] = WATER_DEPTH_DEEP;
          break;
        case 's':
          c.water[i] = WATER_DEPTH_SHALLOW;
          break;
        case 'T':
          c.object[i] = BIRKE;
          break;
        case '#':
          c.solid[i] = FELS;
          break;
        case 'S':
          c.ground[i] = SAND;
          break;
        case 'r':
          c.flags[i] = TILE_FLAG_RAMP;
          break;
        case 'R':
          c.flags[i] = TILE_FLAG_RAMP;
          c.height[i] = 1;
          break;
        default:
          if (ch >= '1' && ch <= '4') c.height[i] = Number(ch);
          else throw new Error(`unknown map character ${ch}`);
      }
    });
  });
}

/** The environment of a test: fixed air temperature and rain, changeable by the test. */
export interface TestEnvironment extends SurvivalEnvironment {
  air: number;
  wet: number;
}

export function testEnvironment(air = 20, wet = 0): TestEnvironment {
  const env: TestEnvironment = {
    air,
    wet,
    ambientC: () => env.air,
    rain: () => env.wet,
  };
  return env;
}

/** A simulation with motion, collision, player and vitals on a drawn world. */
export interface TestWorld {
  readonly sim: Simulation;
  readonly chunks: TestChunks;
  readonly motion: MotionSystem;
  readonly collision: WorldCollision;
  readonly player: PlayerSystem;
  readonly vitals: VitalsSystem;
  readonly influences: PlayerInfluences;
  readonly components: PlayerComponents;
  readonly env: TestEnvironment;
  /** The debug cheats' switches the player and the vitals read (all off; the `cheats` system of `lifeWorld` flips them). */
  readonly cheats: DebugCheats;
  /** Steps `n` ticks (commands go into the first), dropping the events; returns the events of all ticks by type. */
  run(n: number, commands?: readonly GameCommand[]): Map<string, unknown[]>;
  /** Spawns the player on the centre of drawn tile (x, y) (map coordinates). */
  spawn(x: number, y: number): void;
  /** Position [px] of the player. */
  pos(): { x: number; y: number };
  body(): PlayerBody;
  vit(): Vitals;
  /** World px of the centre of drawn tile (x, y). */
  centre(x: number, y: number): { x: number; y: number };
}

export function testWorld(rows: readonly string[], env: TestEnvironment = testEnvironment(), seed = 1): TestWorld {
  const sim = new Simulation({ seed, worldSize: 'small' });
  const chunks = new TestChunks();
  draw(chunks, rows);
  const motion = sim.addSystem(new MotionSystem(sim));
  const collision = sim.addSystem(new WorldCollision(sim, { chunks, worldTiles: WORLD_TILES }));
  const components = registerPlayerComponents(sim.ecs);
  const influences = new PlayerInfluences();
  const cheats = createDebugCheats();
  const vitals = new VitalsSystem({ components, influences, motion, environment: env, cheats });
  const player = sim.addSystem(new PlayerSystem(sim, { motion, collision, components, influences, vitals, cheats }));
  sim.addSystem(vitals);
  const w: TestWorld = {
    sim,
    chunks,
    motion,
    collision,
    player,
    vitals,
    influences,
    components,
    env,
    cheats,
    run(n, commands) {
      const events = new Map<string, unknown[]>();
      for (let i = 0; i < n; i++) {
        sim.step(i === 0 ? commands : undefined);
        sim.events.drain((type, payload) => {
          const list = events.get(type) ?? [];
          list.push(payload);
          events.set(type, list);
        });
      }
      return events;
    },
    spawn(x, y) {
      w.run(1, [{ type: 'player.spawn', tx: OFFSET + x, ty: OFFSET + y }]);
      if (sim.player === NULL_ENTITY) throw new Error('player did not spawn');
    },
    pos() {
      const p = { x: 0, y: 0 };
      if (!player.position(sim, p)) throw new Error('no player');
      return p;
    },
    body() {
      const b = player.body(sim);
      if (b === undefined) throw new Error('no player');
      return b;
    },
    vit() {
      const v = vitals.vitalsOf(sim);
      if (v === undefined) throw new Error('no player');
      return v;
    },
    centre(x, y) {
      return { x: (OFFSET + x) * T + T / 2, y: (OFFSET + y) * T + T / 2 };
    },
  };
  return w;
}

/** An open meadow of `w × h` tiles. */
export function meadow(w: number, h: number): string[] {
  return Array.from({ length: h }, () => '.'.repeat(w));
}
