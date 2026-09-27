/**
 * M4-16 Innenraum-Klima (MASTERPROMPT §16.4): no precipitation inside, the temperature pulled towards 18 °C by the
 * insulation of walls and roof, heat sources (fireplace, oven) and cold sources (ice) inside. Acceptance: a wooden
 * house at night is at least 6 °C warmer inside than outside – on a hand-drawn meadow and in the real world at the
 * start beach.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import type { GameCommand } from '../../../src/game/commands';
import type { PlayerSystem } from '../../../src/game/player/system';
import type { WorldCollision } from '../../../src/game/player/collision';
import { roomInsulation, roomTemperatureC, sourceRoomHeatC } from '../../../src/game/rooms/formulas';
import type { RoomsSystem } from '../../../src/game/rooms/system';
import { createSimulation } from '../../../src/game/setup';
import { BLOCK_ALL } from '../../../src/world/collision/tiles';
import { TILE_FLAG_RAMP, TILE_FLAG_STAIRS, WATER_DEPTH_MASK } from '../../../src/world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX } from '../../../src/world/model/coords';
import { bauWelt, hut } from './bau-testwelt';
import { meadow, T } from './spieler-testwelt';

const C = BALANCE.rooms.climate;
const M = BALANCE.building.materials;

describe('Formeln (§16.4)', () => {
  it('Temperatur Richtung 18 °C nach Dämmwert, Quellen addiert', () => {
    expect(roomTemperatureC(5, 0, 0)).toBe(5);
    expect(roomTemperatureC(5, 1, 0)).toBe(C.targetC);
    expect(roomTemperatureC(30, 0.5, 0)).toBe(24);
    expect(roomTemperatureC(5, 0.5, 3)).toBe(14.5);
    // A fire (core 15 °C) warms a small room by half its core heat, a room four times the reference a quarter of that.
    expect(sourceRoomHeatC(15, 9)).toBe(15 * C.heatShare);
    expect(sourceRoomHeatC(15, 4 * C.referenceTiles)).toBe((15 * C.heatShare) / 4);
    expect(sourceRoomHeatC(-10, 9)).toBe(-10 * C.heatShare);
  });

  it('Dämmwert: Wände und Dach gewichtet; offene Tiles halten nichts', () => {
    expect(roomInsulation(12, 12 * M.holz.insulation, 9, 9 * M.stroh.insulation)).toBeCloseTo(C.wallWeight * M.holz.insulation + (1 - C.wallWeight) * M.stroh.insulation, 12);
    expect(roomInsulation(12, 12 * M.holz.insulation, 9, 0)).toBeCloseTo(C.wallWeight * M.holz.insulation, 12);
    expect(roomInsulation(0, 0, 0, 0)).toBe(0);
  });
});

describe('Innenraum auf der Wiese', () => {
  it('Holzhaus mit Strohdach bei 5 °C Nachtluft: innen ≥ 6 °C wärmer; offene Tür kühlt, Feuer wärmt', () => {
    const w = bauWelt(meadow(24, 24));
    w.env.air = 5;
    w.spawn(10, 10);
    hut(w, 9, 9, 11, 11);
    const room = w.roomAt(10, 10);
    expect(room?.region.interior).toBe(true);
    const walls = (11 * M.holz.insulation + M.holz.insulation * BALANCE.building.doorInsulation.tuer) / 12;
    const insulation = C.wallWeight * walls + (1 - C.wallWeight) * M.stroh.insulation;
    expect(room?.insulation).toBeCloseTo(insulation, 12);
    expect(room?.temperatureC).toBeCloseTo(5 + (C.targetC - 5) * insulation, 12);
    expect((room?.temperatureC ?? 0) - 5).toBeGreaterThanOrEqual(6);
    // An open door lets the cold in.
    w.act({ type: 'build.door', tx: w.tile(10, 12).tx, ty: w.tile(10, 12).ty });
    expect(w.roomAt(10, 10)?.temperatureC).toBeLessThan(room?.temperatureC ?? 0);
    w.act({ type: 'build.door', tx: w.tile(10, 12).tx, ty: w.tile(10, 12).ty });
    // A fire inside heats the room; outside the house it does not.
    w.fire(9, 9);
    expect(w.roomAt(10, 10)?.temperatureC).toBeCloseTo((room?.temperatureC ?? 0) + sourceRoomHeatC(15, 9), 12);
    w.fires.length = 0;
    w.fire(4, 4);
    expect(w.roomAt(10, 10)?.temperatureC).toBeCloseTo(room?.temperatureC ?? 0, 12);
  });

  it('Kühlquellen (Eis) kühlen; ohne Dach ist es kein Innenraum und ohne Wirkung', () => {
    const w = bauWelt(meadow(24, 24));
    w.env.air = 20;
    w.spawn(10, 10);
    hut(w, 9, 9, 11, 11, 'wand_stein', 'tuer_holz', null);
    const open = w.roomAt(10, 10);
    expect(open?.region.interior).toBe(false);
    expect(open?.temperatureC).toBe(20);
    for (let y = 8; y <= 12; y++) for (let x = 8; x <= 12; x++) expect(w.build('dach_stroh', x, y)).toBeNull();
    const warm = w.roomAt(10, 10)?.temperatureC ?? 0;
    w.fires.push({ x: w.px(10, 9).x, y: w.px(10, 9).y, layer: 0, coreHeatC: -12, coreRadiusPx: T, radiusPx: 2 * T });
    expect(w.roomAt(10, 10)?.temperatureC).toBeCloseTo(warm + sourceRoomHeatC(-12, 9), 12);
  });

  it('der Spieler drinnen: gefühlte Temperatur mit Raumwert, kein Regen; unter einem Vordach trocken, aber ohne Raumwert', () => {
    const w = bauWelt(meadow(24, 24));
    w.env.air = 5;
    w.spawn(10, 10);
    hut(w, 9, 9, 11, 11);
    // Rain starts once the house stands.
    w.env.wet = 1;
    w.run(60);
    const room = w.roomAt(10, 10);
    expect(w.vit().roomC).toBeCloseTo((room?.temperatureC ?? 0) - 5, 10);
    expect(w.vit().wetness).toBe(0);
    expect(w.influences.current.indoors).toBe(true);
    // A roof on a pillar outside: dry, but no room.
    w.run(1, [{ type: 'player.teleport', x: w.px(16, 15).x, y: w.px(16, 15).y, layer: 0 }]);
    expect(w.build('saeule_holz', 16, 16)).toBeNull();
    expect(w.build('dach_stroh', 16, 15)).toBeNull();
    w.run(60);
    expect(w.influences.current.indoors).toBe(true);
    expect(w.vit().roomC).toBe(0);
    expect(w.vit().wetness).toBe(0);
    // Out in the rain.
    w.run(1, [{ type: 'player.teleport', x: w.px(20, 20).x, y: w.px(20, 20).y, layer: 0 }]);
    w.run(60);
    expect(w.vit().wetness).toBeGreaterThan(0);
  });
});

describe('Holzhaus in der echten Welt (M4-16 Akzeptanz)', () => {
  it('am Startstrand, 03:00 im Frühling: innen ≥ 6 °C wärmer als außen', () => {
    const sim = createSimulation({ seed: 1, worldSize: 'small' });
    sim.step([{ type: 'player.spawn' }]);
    const player = sim.system('player') as PlayerSystem;
    const rooms = sim.system('rooms') as RoomsSystem;
    const collision = sim.system('world-collision') as WorldCollision;
    const p = { x: 0, y: 0 };
    expect(player.position(sim, p)).toBe(true);
    const px = Math.floor(p.x / TILE_PX);
    const py = Math.floor(p.y / TILE_PX);
    // A free 5 × 5 site near the spawn: open, dry, no world object, no ramp.
    const free = (x: number, y: number): boolean => {
      const chunk = sim.world.chunks.get(0, x >> CHUNK_SHIFT, y >> CHUNK_SHIFT);
      if (chunk === undefined) return false;
      const i = ((y & CHUNK_MASK) << CHUNK_SHIFT) | (x & CHUNK_MASK);
      return (collision.grid.tileInfo(0, x, y) & BLOCK_ALL) === 0 && chunk.object[i] === 0 && ((chunk.water[i] as number) & WATER_DEPTH_MASK) === 0 && ((chunk.flags[i] as number) & (TILE_FLAG_RAMP | TILE_FLAG_STAIRS)) === 0;
    };
    let site: { x: number; y: number } | null = null;
    for (let r = 0; r <= 12 && site === null; r++) {
      for (let dy = -r; dy <= r && site === null; dy++) {
        for (let dx = -r; dx <= r && site === null; dx++) {
          const cx = px + dx;
          const cy = py + dy;
          let ok = true;
          for (let y = cy - 2; y <= cy + 2 && ok; y++) for (let x = cx - 2; x <= cx + 2 && ok; x++) ok = free(x, y);
          if (ok) site = { x: cx, y: cy };
        }
      }
    }
    expect(site).not.toBeNull();
    const { x: cx, y: cy } = site as { x: number; y: number };
    const commands: GameCommand[] = [
      { type: 'player.teleport', x: (cx + 0.5) * TILE_PX, y: (cy + 0.5) * TILE_PX, layer: 0 },
      { type: 'inventory.give', item: 'wand_holz', count: 15 },
      { type: 'inventory.give', item: 'tuer_holz', count: 1 },
      { type: 'inventory.give', item: 'dach_stroh', count: 25 },
    ];
    for (let y = cy - 2; y <= cy + 2; y++) {
      for (let x = cx - 2; x <= cx + 2; x++) {
        if (Math.abs(x - cx) === 2 || Math.abs(y - cy) === 2) commands.push({ type: 'build.place', part: x === cx && y === cy + 2 ? 'tuer_holz' : 'wand_holz', tx: x, ty: y });
      }
    }
    for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) commands.push({ type: 'build.place', part: 'dach_stroh', tx: x, ty: y });
    const rejected: unknown[] = [];
    for (const c of commands) {
      sim.step([c]);
      sim.events.drain((type, e) => {
        if (type === 'commandRejected') rejected.push(e);
      });
    }
    expect(rejected).toEqual([]);
    sim.step([{ type: 'setTime', hour: 3, minute: 0 }]);
    sim.step();
    const room = rooms.roomAt(sim, 0, cx, cy);
    expect(room?.region.interior).toBe(true);
    const outside = sim.world.temperature.temperatureAt(0, cx, cy);
    expect(room?.outsideC).toBeCloseTo(outside, 0);
    expect((room?.temperatureC ?? 0) - outside).toBeGreaterThanOrEqual(6);
    // The player inside feels it: the room value of the felt temperature.
    expect(player.vitalsOf(sim.player)?.roomC).toBeGreaterThanOrEqual(6);
  }, 60000);
});
