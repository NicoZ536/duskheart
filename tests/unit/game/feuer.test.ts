/**
 * M4-28 Feuer-Simulation (MASTERPROMPT §16.2 "Brennbar … Fachwerk/Lehm kaum (−70 %)", §16.8 "Kein Dauerverfall:
 * Gebäude nehmen nur durch Schattenflut, Brände und Bosse Schaden", §10 "Wind … Feuer löschen"; §3.3 Welt-Tick):
 * - formulas: damage per second by flammability (timber frame −70 %), spread delay by flammability, diagonal and wind;
 * - a torch sets wood alight; the fire damages the parts on its tile each world second until they are destroyed and
 *   spreads to flammable neighbours – wooden walls, straw roofs, trees – never to stone;
 * - timber frame burns 70 % slower and catches much later;
 * - the wind speeds the spread downwind; rain puts out fires under the open sky, a roof shelters them;
 * - a burned tree leaves its stump; a player in the flames catches "Brennen"; nothing decays without fire;
 * - Aufhol-Fall: a fire in a frozen chunk (rain and wind changing meanwhile) catches up to exactly the state of the
 *   ticking one, in one step or in two.
 * - Review M4 (#5, #21): a fire spreads only into active chunks – a neighbour outside the active zone waits undecided
 *   until its chunk activates, so the camera's loaded chunks never change the game (`hashState` of a headless run and
 *   of one with the camera's ring loaded are equal); a part over several burning tiles burns once a second; the climate
 *   log keeps only the regions a fire needs; a catch-up after many days costs only the seconds in which it burns.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { parseGameCommand, type GameCommand } from '../../../src/game/commands';
import type { BuildingSystem } from '../../../src/game/building/system';
import { burnDamage, climateAt, climateCode, pruneClimate, recordClimate, spreadDelay, windFactor } from '../../../src/game/fire/formulas';
import { PENDING_SPREAD } from '../../../src/game/fire/state';
import type { FireSystem } from '../../../src/game/fire/system';
import { createObjectHit, type GatheringSystem } from '../../../src/game/gathering/system';
import { STAGE_STUMP } from '../../../src/game/gathering/objectState';
import type { PlayerSystem } from '../../../src/game/player/system';
import { createSimulation } from '../../../src/game/setup';
import type { Simulation } from '../../../src/game/sim';
import { CHUNK_MASK, CHUNK_SHIFT, CHUNK_SIZE, TILE_PX } from '../../../src/world/model/coords';
import { lagerWelt, type LagerWelt } from './lager-testwelt';
import { OFFSET, meadow } from './spieler-testwelt';

const F = BALANCE.fire;
const SECOND = BALANCE.time.tickHz;
/** Directions of the spread plan. */
const EAST = 2;
const WEST = 6;
const SOUTH_EAST = 3;

/** A 30 × 16 meadow (birches where `T` is drawn), the player on (4, 12). */
function world(extra: readonly string[] = []): LagerWelt {
  const rows = meadow(30, 16);
  extra.forEach((r, y) => {
    rows[y] = r + rows[y]?.slice(r.length);
  });
  return lagerWelt(rows, { x: 4, y: 12 });
}

function ignite(w: LagerWelt, x: number, y: number): string | null {
  return w.rejection(w.act({ type: 'fire.ignite', tx: OFFSET + x, ty: OFFSET + y }));
}

function hp(w: LagerWelt, x: number, y: number, li = 1): number {
  return w.building.structures.hp(0, li, OFFSET + x, OFFSET + y);
}

function part(w: LagerWelt, x: number, y: number): string | undefined {
  return w.building.partAt(0, 'struktur', OFFSET + x, OFFSET + y)?.id;
}

function burning(w: LagerWelt, x: number, y: number): boolean {
  return w.feuer.burningAt(0, OFFSET + x, OFFSET + y);
}

/** Builds a row of `parts` from drawn tile (x, y) eastwards (the player walks along). */
function row(w: LagerWelt, x: number, y: number, parts: readonly string[]): void {
  parts.forEach((p, k) => {
    const r = w.build(p, x + k, y);
    if (r !== null) throw new Error(`${p} at ${x + k},${y}: ${r}`);
  });
}

describe('Formeln (§16.2, §10)', () => {
  it('Schaden je Sekunde nach Brennbarkeit: Holz 10, Fachwerk 3 (−70 %), Stein 0', () => {
    expect(burnDamage(BALANCE.building.materials.holz.flammability)).toBe(10);
    expect(burnDamage(BALANCE.building.materials.fachwerk.flammability)).toBe(3);
    expect(burnDamage(BALANCE.building.materials.stein.flammability)).toBe(0);
    expect(1 - burnDamage(0.3) / burnDamage(1)).toBeCloseTo(0.7, 10);
  });

  it('Ausbreitung: 12 s zu Holz, 40 s zu Fachwerk, diagonal ×1,5; Wind beschleunigt mit, bremst gegen', () => {
    const calm = climateCode(0, 0, 0);
    expect(spreadDelay(1, EAST, calm)).toBe(12);
    expect(spreadDelay(0.3, EAST, calm)).toBe(40);
    expect(spreadDelay(1, SOUTH_EAST, calm)).toBe(18);
    expect(spreadDelay(0, EAST, calm)).toBe(-1);
    const storm = climateCode(0, 1, EAST);
    expect(windFactor(EAST, storm)).toBeCloseTo(2.5, 10);
    expect(windFactor(WEST, storm)).toBe(F.minWindFactor);
    expect(spreadDelay(1, EAST, storm)).toBe(5);
    expect(spreadDelay(1, WEST, storm)).toBe(48);
    expect(spreadDelay(1, 0, storm)).toBe(12);
  });

  it('Klimaläufe: nur Wechsel werden notiert; Nachschlagen und Kürzen', () => {
    const runs: number[] = [];
    recordClimate(runs, 10, 1);
    recordClimate(runs, 11, 1);
    recordClimate(runs, 15, 4);
    recordClimate(runs, 20, 1);
    expect(runs).toEqual([10, 1, 15, 4, 20, 1]);
    expect([climateAt(runs, 9), climateAt(runs, 10), climateAt(runs, 14), climateAt(runs, 15), climateAt(runs, 99)]).toEqual([1, 1, 1, 4, 1]);
    pruneClimate(runs, 17);
    expect(runs).toEqual([17, 4, 20, 1]);
    pruneClimate(runs, 30);
    expect(runs).toEqual([30, 1]);
  });
});

describe('Brand an Holzbauten (§16.2, §16.8)', () => {
  it('eine Fackel setzt Holz in Brand, Stein und leeres Gras nicht', () => {
    const w = world();
    row(w, 6, 10, ['wand_holz', 'wand_stein']);
    const torch = w.feuer.flammableProvider();
    expect(torch(w.sim, 0, OFFSET + 7, OFFSET + 10)).toBe(false);
    expect(torch(w.sim, 0, OFFSET + 6, OFFSET + 5)).toBe(false);
    expect(torch(w.sim, 0, OFFSET + 6, OFFSET + 10)).toBe(true);
    expect(burning(w, 6, 10)).toBe(true);
    expect(ignite(w, 6, 10)).toBe('burning');
    expect(ignite(w, 7, 10)).toBe('nothingToBurn');
  });

  it('das Feuer frisst die Holzwand in 30 s und springt nach 12 s auf die nächste; an Stein endet es', () => {
    const w = world();
    row(w, 6, 10, ['wand_holz', 'wand_holz', 'wand_stein', 'wand_holz']);
    const started = w.act({ type: 'fire.ignite', tx: OFFSET + 6, ty: OFFSET + 10 });
    expect(started.get('fireStarted')?.[0]).toMatchObject({ cause: 'debug' });
    const events = w.run(12 * SECOND);
    expect(hp(w, 6, 10)).toBe(300 - 12 * 10);
    expect(events.get('fireStarted')?.[0]).toMatchObject({ tx: OFFSET + 7, cause: 'ausbreitung' });
    const later = w.run(40 * SECOND);
    expect(part(w, 6, 10)).toBeUndefined();
    expect(part(w, 7, 10)).toBeUndefined();
    expect(part(w, 8, 10)).toBe('wand_stein');
    expect(hp(w, 8, 10)).toBe(BALANCE.building.materials.stein.wallHp);
    expect(part(w, 9, 10)).toBe('wand_holz');
    expect(later.get('partRemoved')?.map((e) => (e as { reason: string }).reason)).toEqual(['zerstoert', 'zerstoert']);
    expect(later.get('fireOut')?.map((e) => (e as { reason: string }).reason)).toEqual(['abgebrannt', 'abgebrannt']);
    expect(w.feuer.size).toBe(0);
  });

  it('Fachwerk brennt 70 % langsamer und fängt erst nach 40 s', () => {
    const w = world();
    row(w, 6, 10, ['wand_holz', 'wand_fachwerk']);
    row(w, 6, 12, ['wand_fachwerk']);
    ignite(w, 6, 10);
    ignite(w, 6, 12);
    w.run(10 * SECOND);
    expect(hp(w, 6, 10)).toBe(300 - 100);
    expect(hp(w, 6, 12)).toBe(450 - 30);
    // The wood burns out after 30 s – before it could reach the timber frame beside it (40 s).
    w.run(40 * SECOND);
    expect(part(w, 6, 10)).toBeUndefined();
    expect(burning(w, 7, 10)).toBe(false);
    expect(hp(w, 7, 10)).toBe(450);
  });

  it('der Wind treibt das Feuer: mit dem Sturm schneller nach Osten als nach Westen', () => {
    const w = world();
    w.climate.wind = 1;
    w.climate.dir = EAST;
    row(w, 6, 10, ['wand_holz', 'wand_holz', 'wand_holz']);
    w.run(2);
    ignite(w, 7, 10);
    w.run(6 * SECOND);
    expect(burning(w, 8, 10)).toBe(true);
    expect(burning(w, 6, 10)).toBe(false);
    // Upwind the storm slows it to 48 s – longer than the wall at (7, 10) burns (30 s): the western wall is spared.
    w.run(45 * SECOND);
    expect(part(w, 7, 10)).toBeUndefined();
    expect(part(w, 8, 10)).toBeUndefined();
    expect(part(w, 6, 10)).toBe('wand_holz');
    expect(hp(w, 6, 10)).toBe(300);
  });
});

describe('Regen löscht (§10)', () => {
  it('Regen löscht unter freiem Himmel; unter dem Dach brennt es weiter; Niesel löscht nicht', () => {
    const w = world();
    row(w, 6, 10, ['wand_holz']);
    row(w, 9, 10, ['wand_holz']);
    // A roof tile on the wall at (9, 10) covers it (the wall carries it); the wall at (6, 10) stands in the open.
    expect(w.build('dach_stroh', 9, 10)).toBeNull();
    expect(w.building.roofed(0, OFFSET + 9, OFFSET + 10)).toBe(true);
    ignite(w, 6, 10);
    ignite(w, 9, 10);
    w.climate.rain = 0.25;
    w.run(3 * SECOND);
    expect(burning(w, 6, 10)).toBe(true);
    w.climate.rain = 0.65;
    const ev = w.run(2 * SECOND);
    expect(ev.get('fireOut')?.[0]).toMatchObject({ tx: OFFSET + 6, ty: OFFSET + 10, reason: 'regen' });
    expect(burning(w, 6, 10)).toBe(false);
    expect(burning(w, 9, 10)).toBe(true);
  });
});

describe('Bäume, Spieler, kein Dauerverfall', () => {
  it('ein Baum neben dem Brand fängt Feuer und brennt zum Stumpf nieder', () => {
    const w = world(['', '', '', '', '', '', '', '', '', '', '.......T']);
    row(w, 6, 10, ['wand_holz']);
    ignite(w, 6, 10);
    const ev = w.run(90 * SECOND);
    expect(ev.get('fireStarted')?.some((e) => (e as { tx: number }).tx === OFFSET + 7)).toBe(true);
    expect(ev.get('treeBurned')?.[0]).toMatchObject({ tx: OFFSET + 7, ty: OFFSET + 10 });
    const chunk = w.chunks.at(OFFSET + 7, OFFSET + 10);
    expect(chunk.chunk.objectState.get(chunk.i)?.growth).toBe(STAGE_STUMP);
    expect(w.feuer.size).toBe(0);
  });

  it('wer in den Flammen steht, brennt; ohne Feuer verfällt nichts', () => {
    const w = world();
    expect(w.build('boden_holz', 4, 12 - 1)).toBeNull();
    row(w, 8, 8, ['wand_holz']);
    w.run(600 * SECOND);
    expect(hp(w, 8, 8)).toBe(300);
    const p = w.pos();
    w.act({ type: 'player.teleport', x: p.x, y: p.y - 16, layer: 0 });
    ignite(w, 4, 11);
    w.run(2 * SECOND);
    expect(w.life.conditions.has('brennen')).toBe(true);
  });
});

describe('Aufholen in entladenen Chunks (M4-28 Akzeptanz)', () => {
  /** A little wooden camp with a tree, set alight; the storm blows east; later it rains. */
  function camp(): LagerWelt {
    const w = world(['', '', '', '', '', '', '', '', '', '', '', '', '', '...........T']);
    row(w, 6, 10, ['wand_holz', 'wand_holz', 'wand_fachwerk', 'wand_holz', 'tuer_holz']);
    row(w, 6, 12, ['wand_palisade', 'wand_holz', 'wand_holz', 'wand_holz']);
    expect(w.build('dach_stroh', 7, 11)).toBeNull();
    w.climate.wind = 0.8;
    w.climate.dir = EAST;
    ignite(w, 6, 10);
    w.run(5 * SECOND + 17);
    return w;
  }

  it('eingefroren + aufgeholt = durchgehend brennend (Wind, später Regen); in zwei Schritten ebenso', () => {
    const ticking = camp();
    const frozen = camp();
    const split = camp();
    const from = frozen.sim.tick;
    frozen.active = false;
    split.active = false;
    for (const w of [ticking, frozen, split]) {
      w.run(40 * SECOND);
      w.climate.rain = 0.7;
      w.climate.wind = 0.3;
      w.run(3 * SECOND + 11);
      w.climate.rain = 0;
      w.run(7 * SECOND);
      // A new fire in the chunk while it is frozen waits there for the catch-up.
      ignite(w, 9, 12);
      w.run(25 * SECOND);
    }
    const chunk = { layer: 0 as const, cx: (OFFSET + 6) >> CHUNK_SHIFT, cy: (OFFSET + 10) >> CHUNK_SHIFT };
    frozen.feuer.catchUp(chunk, from, frozen.sim.tick);
    split.feuer.catchUp(chunk, from, from + 50 * SECOND + 7);
    split.feuer.catchUp(chunk, from + 50 * SECOND + 7, split.sim.tick);
    const state = (w: LagerWelt): unknown => ({
      building: w.building.save.serialize(),
      fire: w.feuer.save.serialize(),
      tree: w.chunks.at(OFFSET + 11, OFFSET + 13).chunk.objectState.get(((OFFSET + 13) & CHUNK_MASK) * 32 + ((OFFSET + 11) & CHUNK_MASK)),
    });
    expect(state(frozen)).toEqual(state(ticking));
    expect(state(split)).toEqual(state(ticking));
    // Something burned down, something still burns, something survived the rain.
    expect(ticking.feuer.size).toBeGreaterThan(0);
    expect(part(ticking, 6, 10)).toBeUndefined();
    expect(ticking.building.structures.hp(0, 1, OFFSET + 8, OFFSET + 10)).toBeGreaterThan(0);
  });
});

describe('Review M4: Brand an der Grenze der aktiven Zone, Schaden je Teil, Klimaprotokoll, Aufholkosten (#5, #21)', () => {
  const CONFIG = { seed: 1, worldSize: 'small', dayLengthMinutes: 24 } as const;
  /** A generated world and minutes of ticks: more than the default 5 s on a loaded machine. */
  const FULL_SIM_TIMEOUT_MS = 120_000;
  const R = BALANCE.stream.activeRadiusChunks;

  function start(): Simulation {
    const sim = createSimulation(CONFIG);
    const step = (commands: readonly GameCommand[], ticks = 1): void => {
      for (let i = 0; i < ticks; i++) {
        sim.step(i === 0 ? commands.map((c) => parseGameCommand(c)) : undefined);
        sim.events.drain(() => undefined);
      }
    };
    step([{ type: 'player.spawn' }], 2);
    step([{ type: 'setWeather', state: 'klar' }, { type: 'setTime', hour: 12, minute: 0 }]);
    return sim;
  }

  function run(sim: Simulation, commands: readonly GameCommand[], ticks: number): void {
    for (let i = 0; i < ticks; i++) {
      sim.step(i === 0 ? commands.map((c) => parseGameCommand(c)) : undefined);
      sim.events.drain(() => undefined);
    }
  }

  function playerChunk(sim: Simulation): { cx: number; cy: number; x: number; y: number } {
    const p = { x: 0, y: 0 };
    (sim.system('player') as unknown as PlayerSystem).position(sim, p);
    return { cx: Math.floor(p.x / TILE_PX) >> CHUNK_SHIFT, cy: Math.floor(p.y / TILE_PX) >> CHUNK_SHIFT, x: p.x, y: p.y };
  }

  /** The four sides of a chunk: tile step outwards and the spread direction that points that way. */
  const SIDES = [
    { dx: 1, dy: 0, dir: 2 },
    { dx: -1, dy: 0, dir: 6 },
    { dx: 0, dy: 1, dir: 4 },
    { dx: 0, dy: -1, dir: 0 },
  ] as const;
  type Side = (typeof SIDES)[number];
  interface Tile {
    readonly tx: number;
    readonly ty: number;
  }

  /** Whether chunk column or row `c` lies in the world. */
  function inWorld(c: number): boolean {
    return c >= 0 && c < BALANCE.world.sizeTiles[CONFIG.worldSize] / CHUNK_SIZE;
  }

  function centreOf(t: Tile): { x: number; y: number } {
    return { x: (t.tx + 0.5) * TILE_PX, y: (t.ty + 0.5) * TILE_PX };
  }

  /**
   * A standing tree `b` on the edge of its chunk and, across the chunk border, a tile `a` where a timber-frame wall can
   * stand (the player on `stand`, two tiles behind it). Searched in a simulation of its own, so the runs under test
   * load nothing extra.
   */
  function wallBesideTree(): { a: Tile; b: Tile; stand: Tile; side: Side } {
    const sim = start();
    const gathering = sim.system('gathering') as unknown as GatheringSystem;
    const building = sim.system('building') as unknown as BuildingSystem;
    const hit = createObjectHit();
    const home = playerChunk(sim);
    const last = BALANCE.world.sizeTiles[CONFIG.worldSize] / CHUNK_SIZE - 1;
    for (let r = 1; r <= 4; r++) {
      for (let cy = home.cy - r; cy <= home.cy + r; cy++) {
        for (let cx = home.cx - r; cx <= home.cx + r; cx++) {
          if (Math.max(Math.abs(cx - home.cx), Math.abs(cy - home.cy)) !== r || cx < 1 || cy < 1 || cx >= last || cy >= last) continue;
          sim.world.chunks.ensure(0, cx, cy);
          for (const side of SIDES) {
            for (let i = 2; i < CHUNK_SIZE - 2; i++) {
              // The tree on the edge of chunk (cx, cy) that faces away from `side`; the wall outside it.
              const b = { tx: side.dx === 0 ? cx * CHUNK_SIZE + i : side.dx > 0 ? cx * CHUNK_SIZE : (cx + 1) * CHUNK_SIZE - 1, ty: side.dy === 0 ? cy * CHUNK_SIZE + i : side.dy > 0 ? cy * CHUNK_SIZE : (cy + 1) * CHUNK_SIZE - 1 };
              if (!gathering.standingTreeAt(0, b.tx, b.ty, hit)) continue;
              const a = { tx: b.tx - side.dx, ty: b.ty - side.dy };
              const stand = { tx: a.tx - 2 * side.dx, ty: a.ty - 2 * side.dy };
              // The player later stands R chunks behind the wall's chunk: inside the world.
              if (!inWorld((a.tx >> CHUNK_SHIFT) - side.dx * R) || !inWorld((a.ty >> CHUNK_SHIFT) - side.dy * R)) continue;
              const p = centreOf(stand);
              run(sim, [{ type: 'player.teleport', x: p.x, y: p.y, layer: 0 }], 1);
              const verdict = building.preview(sim, 'wand_fachwerk', a.tx, a.ty);
              if (verdict === null || verdict === 'noMaterial') return { a, b, stand, side };
            }
          }
        }
      }
    }
    throw new Error('no tree on a chunk edge with room for a wall beside it');
  }

  function burning(sim: Simulation, t: Tile): boolean {
    return (sim.system('fire') as unknown as FireSystem).burningAt(0, t.tx, t.ty);
  }

  it(
    '#5: ein Brand am Rand der aktiven Zone liest keinen eingefrorenen Chunk – ohne und mit den Chunks der Kamera derselbe Zustand; die Aktivierung entscheidet',
    () => {
      const { a, b, stand, side } = wallBesideTree();
      const achunk = { cx: a.tx >> CHUNK_SHIFT, cy: a.ty >> CHUNK_SHIFT };
      const scenario = (camera: boolean): { hashes: string[]; pending: number | undefined; treeEarly: boolean; spread: boolean } => {
        const sim = start();
        // The browser keeps the camera's square resident (load radius 4 around the player); headless runs and replays
        // keep only the active zone.
        const look = (): void => {
          if (!camera) return;
          const c = playerChunk(sim);
          sim.world.chunks.update(0, c.cx, c.cy);
          for (let dy = -BALANCE.stream.surfaceLoadRadiusChunks; dy <= BALANCE.stream.surfaceLoadRadiusChunks; dy++) {
            for (let dx = -BALANCE.stream.surfaceLoadRadiusChunks; dx <= BALANCE.stream.surfaceLoadRadiusChunks; dx++) {
              if (inWorld(c.cx + dx) && inWorld(c.cy + dy)) sim.world.chunks.ensure(0, c.cx + dx, c.cy + dy);
            }
          }
        };
        const go = (x: number, y: number): void => {
          run(sim, [{ type: 'player.teleport', x, y, layer: 0 }], 1);
          look();
          run(sim, [], 1);
        };
        // A timber-frame wall beside the tree (it burns 150 s), then far away and back so that the wall's chunk is in
        // the outer ring of the active zone and the tree's chunk just outside it (frozen).
        const p = centreOf(stand);
        go(p.x, p.y);
        run(sim, [{ type: 'inventory.give', item: 'wand_fachwerk', count: 1 }], 1);
        run(sim, [{ type: 'build.place', part: 'wand_fachwerk', tx: a.tx, ty: a.ty }], 1);
        expect((sim.system('building') as unknown as BuildingSystem).partAt(0, 'struktur', a.tx, a.ty)?.id).toBe('wand_fachwerk');
        const far = 10 * CHUNK_SIZE * TILE_PX * (achunk.cx < 16 ? 1 : -1);
        go(p.x + far, p.y);
        const ring = { cx: achunk.cx - side.dx * R, cy: achunk.cy - side.dy * R };
        go((ring.cx + 0.5) * CHUNK_SIZE * TILE_PX, (ring.cy + 0.5) * CHUNK_SIZE * TILE_PX);
        expect(sim.world.zone.isActive(0, achunk.cx, achunk.cy)).toBe(true);
        expect(sim.world.zone.isActive(0, b.tx >> CHUNK_SHIFT, b.ty >> CHUNK_SHIFT)).toBe(false);
        run(sim, [{ type: 'fire.ignite', tx: a.tx, ty: a.ty }], 1);
        run(sim, [], 10 * SECOND);
        const hashes = [sim.hashState()];
        const fire = sim.system('fire') as unknown as FireSystem;
        const pending = [...fire.cells].find((c) => c.tx === a.tx && c.ty === a.ty)?.plan?.[side.dir];
        const treeEarly = burning(sim, b);
        // One chunk towards the tree: its chunk activates, catches up and decides – the fire crosses the border.
        go((ring.cx + side.dx + 0.5) * CHUNK_SIZE * TILE_PX, (ring.cy + side.dy + 0.5) * CHUNK_SIZE * TILE_PX);
        expect(sim.world.zone.isActive(0, b.tx >> CHUNK_SHIFT, b.ty >> CHUNK_SHIFT)).toBe(true);
        let spread = false;
        for (let k = 0; k < 100 && !spread; k++) {
          run(sim, [], SECOND);
          spread = burning(sim, b);
        }
        hashes.push(sim.hashState());
        return { hashes, pending, treeEarly, spread };
      };
      const headless = scenario(false);
      const camera = scenario(true);
      expect(camera.hashes).toEqual(headless.hashes);
      // The tree across the border was not read: its direction waited undecided and the tree did not burn while its
      // chunk was frozen; its activation let the fire across – in both runs.
      for (const r of [headless, camera]) expect([r.pending, r.treeEarly, r.spread]).toEqual([PENDING_SPREAD, false, true]);
    },
    FULL_SIM_TIMEOUT_MS,
  );

  it('#21: ein Teil über mehreren brennenden Kacheln verliert je Sekunde nur einmal Trefferpunkte', () => {
    const w = world();
    // The 2 × 2 fixture carpet (wood, walkable) on (8, 8)–(9, 9); all four tiles burn.
    expect(w.build('probe_moebel_teppich', 8, 8)).toBeNull();
    for (const [x, y] of [
      [8, 8],
      [9, 8],
      [8, 9],
      [9, 9],
    ] as const)
      expect(ignite(w, x, y)).toBeNull();
    w.run(3 * SECOND);
    const carpetHp = Math.round(BALANCE.building.materials.holz.wallHp * BALANCE.building.hpFactor.moebel);
    expect(w.building.structures.hp(0, 2, OFFSET + 8, OFFSET + 8)).toBe(carpetHp - 3 * burnDamage(1));
  });

  it('#21: das Klimaprotokoll hält nur die Regionen, die ein Brand braucht, und nur ab der frühesten offenen Sekunde', () => {
    // Two weather regions: the west half of the map (x < 15) is region 0, the east half region 1; the east half's
    // climate changes every second, the west half's never.
    const w = world();
    row(w, 4, 10, ['wand_holz']);
    const fire = w.feuer as unknown as { stateValue: { klima: Map<number, number[]> }; env: { region: unknown; regions: unknown; climate: unknown } };
    fire.env.region = (_s: unknown, layer: number, tx: number) => (layer !== 0 ? -1 : tx - OFFSET < 15 ? 0 : 1);
    fire.env.regions = () => 2;
    let flip = 0;
    fire.env.climate = (_s: unknown, region: number) => (region === 0 ? climateCode(0, 0, 0) : climateCode(0, (flip++ % 2) * 0.9, 0));
    ignite(w, 4, 10);
    w.active = false;
    w.run(120 * SECOND);
    // The frozen fire in the west keeps its own region's log (one run: nothing changed) and none of the east.
    expect([...fire.stateValue.klima.keys()]).toEqual([0]);
    expect(fire.stateValue.klima.get(0)?.length).toBe(2);
  });

  it('#21: Aufholen nach vielen Tagen kostet nur die Sekunden, in denen es brennt – nicht Sekunden × brennende Kacheln', () => {
    const w = world();
    // 60 burning floors in the drawn chunk, frozen; one burning floor in the chunk east of it.
    let n = 0;
    for (let y = 2; y < 16 && n < 60; y++) {
      for (let x = 2; x < 28 && n < 60; x++) {
        w.act({ type: 'player.teleport', x: (OFFSET + x) * TILE_PX + 8, y: (OFFSET + y) * TILE_PX + 8 + 3 * TILE_PX, layer: 0 });
        if (w.build('boden_holz', x, y) === null) n++;
      }
    }
    const far = { x: CHUNK_SIZE + 2, y: 2 };
    w.act({ type: 'player.teleport', x: (OFFSET + far.x) * TILE_PX + 8, y: (OFFSET + far.y + 3) * TILE_PX + 8, layer: 0 });
    expect(w.build('boden_holz', far.x, far.y)).toBeNull();
    w.active = false;
    for (let y = 2; y < 16; y++) for (let x = 2; x < 28; x++) w.act({ type: 'fire.ignite', tx: OFFSET + x, ty: OFFSET + y });
    w.act({ type: 'fire.ignite', tx: OFFSET + far.x, ty: OFFSET + far.y });
    expect(w.feuer.size).toBe(61);
    const from = w.sim.tick;
    // Ten thousand game days away (14,4 million world seconds): a pass over all 61 burning tiles in every one of them
    // took many seconds; the floor burns out in its first minute, and the catch-up ends with it.
    const days = 10_000;
    const chunk = { layer: 0 as const, cx: (OFFSET + far.x) >> CHUNK_SHIFT, cy: (OFFSET + far.y) >> CHUNK_SHIFT };
    const t0 = performance.now();
    w.feuer.catchUp(chunk, from, from + days * 24 * 60 * SECOND);
    const ms = performance.now() - t0;
    expect(w.feuer.burningAt(0, OFFSET + far.x, OFFSET + far.y)).toBe(false);
    expect(w.feuer.size).toBe(60);
    expect(ms).toBeLessThan(1000);
  });
});
