/**
 * M4 im echten Spiel (`createSimulation`, src/game/setup.ts): die Kopplungen der Basis auf der generierten Welt –
 * - E benutzt, was in der Basis steht, und der Hinweis nennt es (§11.4, §26 "Interaktionshinweis"): Station (Benutzen →
 *   Stationsbildschirm), Tür (Öffnen/Schließen, im Türrahmen blockiert), Stuhl (Hinsetzen/Aufstehen), Holz- und Grasbett
 *   (Schlafen, Wiedereinstiegspunkt), Kiste (Öffnen; das Handwerk nimmt aus ihr), Herdfeuer (Öffnen), Blaupause
 *   (Fertigstellen mit dem Hammer);
 * - was steht, steht im Weg (§16.1): Stationen, Kisten, Herdfeuer, Möbel und das Lagerfeuer, der Teppich nicht; nichts
 *   wird auf den Spieler oder auf ein Bauteil gestellt;
 * - Lampen und Kamin aus dem Bau-Raster sind Lichter: Brennstoff mit E, Licht, der Kamin heizt den Raum (§16.4); Regen
 *   löscht das Lagerfeuer im Freien, der Kamin unter dem Dach brennt weiter (§10); abgebaut kommt das Harz zurück;
 * - `debug.unlock` zeigt auch jedes Rezept (M4-01).
 */
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import { USE_BLOCKS, USE_VERBS, type UseAction, type UseBlock } from '../../../src/content/uses';
import type { EventArgs } from '../../../src/engine/events';
import type { ActionsSystem } from '../../../src/game/actions/system';
import type { BuildingSystem } from '../../../src/game/building/system';
import { parseGameCommand, type GameCommand } from '../../../src/game/commands';
import type { CraftingSystem } from '../../../src/game/crafting/system';
import type { DeathSystem } from '../../../src/game/death/system';
import type { HearthSystem } from '../../../src/game/hearth/system';
import { hintText, interactionHint } from '../../../src/game/interaction/hint';
import type { InteractionSystem } from '../../../src/game/interaction/system';
import type { InventorySystem } from '../../../src/game/inventory/system';
import { BAG_AREAS, type SlotRef } from '../../../src/game/items/slots';
import type { LightSystem } from '../../../src/game/light/system';
import type { WorldCollision } from '../../../src/game/player/collision';
import type { PlayerSystem } from '../../../src/game/player/system';
import { sourceRoomHeatC } from '../../../src/game/rooms/formulas';
import type { RoomsSystem } from '../../../src/game/rooms/system';
import { createSimulation } from '../../../src/game/setup';
import type { SimEventMap, Simulation } from '../../../src/game/sim';
import type { StationSystem } from '../../../src/game/stations/system';
import type { StorageSystem } from '../../../src/game/storage/system';
import { createI18n } from '../../../src/i18n/index';
import { BLOCK_ALL, BLOCK_OBJECT } from '../../../src/world/collision/tiles';
import { TILE_FLAG_RAMP, TILE_FLAG_STAIRS, WATER_DEPTH_MASK } from '../../../src/world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX } from '../../../src/world/model/coords';

const CONFIG = { seed: 1, worldSize: 'small', dayLengthMinutes: 24 } as const;
/** A free site of 11 × 9 tiles lies next to the spawn on this world (checked when the game starts). */
const SITE = { w: 11, h: 9 } as const;
/** A generated world and many ticks: more than the default 5 s on a loaded machine. */
const FULL_SIM_TIMEOUT_MS = 60_000;
const DE = createI18n('de');
type Ev = EventArgs<SimEventMap>;

interface Game {
  readonly sim: Simulation;
  /** North-west tile of the free site. */
  readonly x0: number;
  readonly y0: number;
  run(commands?: readonly GameCommand[], ticks?: number): Ev[];
  sys<T>(id: string): T;
  /** World tile of site tile (x, y). */
  at(x: number, y: number): { tx: number; ty: number };
  /** Puts the player on the centre of site tile (x, y). */
  stand(x: number, y: number): void;
  /** Aims at site tile (x, y) and returns the German hint line of the focus ('' without one). */
  hint(x: number, y: number): string;
  /** Presses and releases E on site tile (x, y); returns the events. */
  press(x: number, y: number): Ev[];
  give(item: string, count: number): void;
  slotOf(item: string): SlotRef;
  /** Places build part `part` on site tile (x, y) (gives it first); no refusal. */
  build(part: string, x: number, y: number): void;
}

function of<K extends keyof SimEventMap>(events: readonly Ev[], type: K): SimEventMap[K][] {
  return events.filter((e) => e[0] === type).map((e) => e[1] as SimEventMap[K]);
}

function reasons(events: readonly Ev[]): string[] {
  return of(events, 'commandRejected').map((r) => r.reason);
}

function game(): Game {
  const sim = createSimulation(CONFIG);
  const sys = <T>(id: string): T => sim.system(id) as unknown as T;
  const run = (commands: readonly GameCommand[] = [], ticks = 1): Ev[] => {
    const out: Ev[] = [];
    for (let i = 0; i < ticks; i++) {
      sim.step(i === 0 ? commands.map((c) => parseGameCommand(c)) : undefined);
      sim.events.drain((...e) => out.push(e));
    }
    return out;
  };
  run([{ type: 'player.spawn' }], 2);
  run([{ type: 'setWeather', state: 'klar' }, { type: 'setTime', hour: 12, minute: 0 }]);
  const player = sys<PlayerSystem>('player');
  const collision = sys<WorldCollision>('world-collision');
  const p = { x: 0, y: 0 };
  if (!player.position(sim, p)) throw new Error('no player');
  const px = Math.floor(p.x / TILE_PX);
  const py = Math.floor(p.y / TILE_PX);
  collision.ensureTiles(0, px - 40, py - 40, px + 40, py + 40);
  const free = (x: number, y: number): boolean => {
    const chunk = sim.world.chunks.get(0, x >> CHUNK_SHIFT, y >> CHUNK_SHIFT);
    if (chunk === undefined) return false;
    const i = ((y & CHUNK_MASK) << CHUNK_SHIFT) | (x & CHUNK_MASK);
    return (collision.grid.tileInfo(0, x, y) & BLOCK_ALL) === 0 && chunk.object[i] === 0 && ((chunk.water[i] as number) & WATER_DEPTH_MASK) === 0 && ((chunk.flags[i] as number) & (TILE_FLAG_RAMP | TILE_FLAG_STAIRS)) === 0;
  };
  let site: { x: number; y: number } | null = null;
  for (let r = 0; r <= 30 && site === null; r++) {
    for (let dy = -r; dy <= r && site === null; dy++) {
      for (let dx = -r; dx <= r && site === null; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        let ok = true;
        for (let y = py + dy; y < py + dy + SITE.h && ok; y++) for (let x = px + dx; x < px + dx + SITE.w && ok; x++) ok = free(x, y);
        if (ok) site = { x: px + dx, y: py + dy };
      }
    }
  }
  if (site === null) throw new Error('no free site next to the spawn');
  const { x: x0, y: y0 } = site;
  const at = (x: number, y: number): { tx: number; ty: number } => ({ tx: x0 + x, ty: y0 + y });
  const inventory = sys<InventorySystem>('inventory');
  const g: Game = {
    sim,
    x0,
    y0,
    run,
    sys,
    at,
    stand(x, y) {
      run([{ type: 'player.teleport', x: (x0 + x + 0.5) * TILE_PX, y: (y0 + y + 0.5) * TILE_PX, layer: 0 }], 2);
    },
    hint(x, y) {
      run([{ type: 'player.aim', x: (x0 + x + 0.5) * TILE_PX, y: (y0 + y + 0.5) * TILE_PX }], 2);
      const h = interactionHint(sys<InteractionSystem>('interaction').focus);
      return h === null ? '' : hintText(h, 'de', (k, params) => DE.t(k, params));
    },
    press(x, y) {
      const ev = run([{ type: 'player.interact', on: true, ...at(x, y) }], 2);
      return [...ev, ...run([{ type: 'player.interact', on: false }])];
    },
    give(item, count) {
      run([{ type: 'inventory.give', item, count }]);
    },
    slotOf(item) {
      const state = inventory.state;
      for (const area of BAG_AREAS) {
        const index = state[area].findIndex((s) => s !== null && s.item === item);
        if (index >= 0) return { bereich: area, index };
      }
      throw new Error(`no ${item} in the bags`);
    },
    build(part, x, y) {
      g.give(part, 1);
      const ev = run([{ type: 'build.place', part, ...at(x, y) }]);
      expect(reasons(ev), `${part} at ${x},${y}`).toEqual([]);
    },
  };
  g.stand(5, 4);
  return g;
}

/** "<Verb>: <item name>" (and " – <reason>") as the German hint says it. */
function line(action: UseAction, item: string, block?: UseBlock, detail?: string): string {
  const base = `${USE_VERBS[action].de}: ${CONTENT.collection('items').get(item).name.de}`;
  if (block === undefined) return base;
  const reason = USE_BLOCKS[block].de.replaceAll('{item}', detail === undefined ? '' : CONTENT.collection('items').get(detail).name.de);
  return `${base} – ${reason}`;
}

describe('M4 in createSimulation', { timeout: FULL_SIM_TIMEOUT_MS }, () => {
  it('E an Station, Tür, Stuhl, Betten, Kiste und Blaupause: der Hinweis nennt das Ding, E benutzt es', () => {
    const g = game();
    // Station: "Benutzen: Werkbank" – its screen opens.
    g.give('werkbank', 1);
    g.stand(1, 3);
    const placed = g.run([{ type: 'station.place', from: g.slotOf('werkbank'), ...g.at(1, 1) }]);
    expect(reasons(placed)).toEqual([]);
    const station = g.sys<StationSystem>('stations').placed[0];
    g.stand(2, 2);
    expect(g.hint(2, 1)).toBe(line('benutzen', 'werkbank'));
    expect(of(g.press(2, 1), 'stationOpened')).toEqual([expect.objectContaining({ id: station?.id, station: 'werkbank' })]);
    // Door: open, close; standing in the open doorway it cannot close.
    g.build('tuer_holz', 5, 1);
    g.stand(5, 2);
    expect(g.hint(5, 1)).toBe(line('oeffnen', 'tuer_holz'));
    expect(of(g.press(5, 1), 'doorToggled')).toEqual([expect.objectContaining({ open: true })]);
    expect(g.hint(5, 1)).toBe(line('schliessen', 'tuer_holz'));
    g.stand(5, 1);
    expect(g.hint(5, 1)).toBe(line('schliessen', 'tuer_holz', 'imWeg'));
    const blocked = g.press(5, 1);
    expect(of(blocked, 'doorToggled')).toEqual([]);
    expect(of(blocked, 'commandRejected')).toEqual([expect.objectContaining({ type: 'player.interact', reason: 'imWeg' })]);
    g.stand(5, 2);
    expect(of(g.press(5, 1), 'doorToggled')).toEqual([expect.objectContaining({ open: false })]);
    // Chair: sit down, stand up.
    g.build('stuhl_holz', 8, 1);
    g.stand(8, 2);
    const actions = g.sys<ActionsSystem>('actions');
    expect(g.hint(8, 1)).toBe(line('sitzen', 'stuhl_holz'));
    g.press(8, 1);
    expect(actions.state.seat).not.toBeNull();
    expect(g.hint(8, 1)).toBe(line('aufstehen', 'stuhl_holz'));
    g.press(8, 1);
    expect(actions.state.seat).toBeNull();
    // Beds: before 19:00 not tired; in the evening they sleep and set the respawn point.
    g.build('holzbett', 1, 4);
    g.build('grasbett', 3, 4);
    g.stand(1, 6);
    expect(g.hint(1, 5)).toBe(line('schlafen', 'holzbett', 'nochNichtMuede'));
    g.run([{ type: 'setTime', hour: 20, minute: 0 }]);
    expect(g.hint(1, 5)).toBe(line('schlafen', 'holzbett'));
    const death = g.sys<DeathSystem>('death');
    expect(of(g.press(1, 5), 'sleepStarted')).toEqual([expect.objectContaining({ place: 'bett' })]);
    expect(death.state.respawn).toMatchObject({ x: (g.x0 + 1.5) * TILE_PX, y: (g.y0 + 5) * TILE_PX, layer: 0 });
    g.run([{ type: 'sleep.wake' }], 2);
    g.stand(3, 6);
    expect(g.hint(3, 5)).toBe(line('schlafen', 'grasbett'));
    expect(of(g.press(3, 5), 'sleepStarted')).toEqual([expect.objectContaining({ place: 'grasbett' })]);
    expect(death.state.respawn).toMatchObject({ x: (g.x0 + 3.5) * TILE_PX, y: (g.y0 + 5) * TILE_PX });
    g.run([{ type: 'sleep.wake' }, { type: 'setTime', hour: 12, minute: 0 }], 2);
    // Chest: open; crafting takes from it.
    g.build('kiste_holz', 5, 4);
    g.stand(5, 5);
    expect(g.hint(5, 4)).toBe(line('oeffnen', 'kiste_holz'));
    const chest = g.sys<StorageSystem>('storage').chests[0];
    expect(of(g.press(5, 4), 'chestOpened')).toEqual([expect.objectContaining({ chest: chest?.id })]);
    g.give('fasern', 3);
    g.run([{ type: 'storage.put', chest: chest?.id ?? 0, from: g.slotOf('fasern') }]);
    const crafted = g.run([{ type: 'craft.start', recipe: 'rezept_faserseil', count: 1 }]);
    expect(of(crafted, 'chestTaken')).toEqual([expect.objectContaining({ taken: 'fasern', by: 'handwerk' })]);
    // Blueprint: without a hammer the hint says so; with one E finishes it from the bags.
    g.give('wand_holz', 1);
    const bp = g.run([{ type: 'build.blueprint', part: 'wand_holz', ...g.at(8, 4) }]);
    expect(reasons(bp)).toEqual([]);
    g.stand(8, 5);
    expect(g.hint(8, 4)).toBe(line('fertigstellen', 'wand_holz', 'keinHammer'));
    g.give('steinhammer', 1);
    g.run([{ type: 'inventory.move', from: g.slotOf('steinhammer'), to: { bereich: 'schnellleiste', index: 9 } }, { type: 'player.selectHotbar', index: 9 }]);
    expect(g.hint(8, 4)).toBe(line('fertigstellen', 'wand_holz'));
    expect(of(g.press(8, 4), 'blueprintCompleted')).toEqual([expect.objectContaining({ part: 'wand_holz' })]);
  });

  it('was steht, steht im Weg – der Teppich nicht; nichts auf den Spieler oder auf ein Bauteil; E öffnet das Herdfeuer', () => {
    const g = game();
    const collision = g.sys<WorldCollision>('world-collision');
    const blocks = (x: number, y: number): boolean => (collision.grid.tileInfo(0, g.x0 + x, g.y0 + y) & BLOCK_OBJECT) !== 0;
    g.stand(2, 2);
    g.give('werkbank', 1);
    expect(reasons(g.run([{ type: 'station.place', from: g.slotOf('werkbank'), ...g.at(2, 2) }]))).toEqual(['standingThere']);
    expect(reasons(g.run([{ type: 'station.place', from: g.slotOf('werkbank'), ...g.at(4, 2) }]))).toEqual([]);
    g.give('lagerfeuer', 2);
    expect(reasons(g.run([{ type: 'light.place', from: g.slotOf('lagerfeuer'), ...g.at(2, 2) }]))).toEqual(['standingThere']);
    expect(reasons(g.run([{ type: 'light.place', from: g.slotOf('lagerfeuer'), ...g.at(4, 5) }]))).toEqual([]);
    g.build('kiste_holz', 4, 0);
    g.build('stuhl_holz', 6, 0);
    g.build('teppich_stroh', 4, 7);
    g.build('herdfeuer', 8, 0);
    expect([blocks(4, 2), blocks(5, 2), blocks(4, 5), blocks(4, 0), blocks(6, 0), blocks(9, 1), blocks(4, 7), blocks(5, 8), blocks(3, 2)]).toEqual([true, true, true, true, true, true, false, false, false]);
    // Walking east: the bench and the camp fire stop the player, the carpet does not.
    const player = g.sys<PlayerSystem>('player');
    const pos = { x: 0, y: 0 };
    for (const [row, wall] of [
      [2, 4],
      [5, 4],
    ] as const) {
      g.stand(2, row);
      g.run([{ type: 'player.move', dx: 1, dy: 0 }], 60);
      g.run([{ type: 'player.move', dx: 0, dy: 0 }]);
      player.position(g.sim, pos);
      expect(pos.x, `row ${row}`).toBeLessThan((g.x0 + wall) * TILE_PX);
    }
    g.stand(2, 7);
    g.run([{ type: 'player.move', dx: 1, dy: 0 }], 60);
    g.run([{ type: 'player.move', dx: 0, dy: 0 }]);
    player.position(g.sim, pos);
    expect(pos.x).toBeGreaterThan((g.x0 + 6) * TILE_PX);
    // Onto the carpet: neither a station nor a light.
    g.stand(3, 6);
    g.give('saegebock', 1);
    expect(reasons(g.run([{ type: 'station.place', from: g.slotOf('saegebock'), ...g.at(4, 7) }]))).toEqual(['tileTaken']);
    expect(reasons(g.run([{ type: 'light.place', from: g.slotOf('lagerfeuer'), ...g.at(5, 8) }]))).toEqual(['tileTaken']);
    // The hearth: "Öffnen: Herdfeuer" – its screen.
    g.stand(9, 3);
    expect(g.hint(9, 2)).toBe(line('oeffnen', 'herdfeuer'));
    const hearth = g.sys<HearthSystem>('hearth').hearths[0];
    expect(of(g.press(9, 2), 'hearthOpened')).toEqual([expect.objectContaining({ hearth: hearth?.id })]);
  });

  it('Lampen und Kamin aus dem Bau-Raster: Brennstoff mit E, Licht, Raumwärme; Regen löscht das Lagerfeuer draußen, nicht den Kamin', () => {
    const g = game();
    // A wooden house 5 × 5 with a straw roof (interior 3 × 3), the fireplace inside along its north wall.
    g.stand(2, 2);
    for (let y = 0; y <= 4; y++) {
      for (let x = 0; x <= 4; x++) if (x === 0 || x === 4 || y === 0 || y === 4) g.build(x === 2 && y === 4 ? 'tuer_holz' : 'wand_holz', x, y);
    }
    for (let y = 0; y <= 4; y++) for (let x = 0; x <= 4; x++) g.build('dach_stroh', x, y);
    g.build('kamin_stein', 1, 1);
    const light = g.sys<LightSystem>('light');
    const kamin = light.state.placed.find((l) => l.kind === 'kamin_stein');
    expect(kamin).toMatchObject({ ...g.at(1, 1), groesse: { b: 2, t: 1 }, mount: 'boden' });
    g.run([{ type: 'setTime', hour: 3, minute: 0 }]);
    const rooms = g.sys<RoomsSystem>('rooms');
    const cold = rooms.roomAt(g.sim, 0, g.x0 + 2, g.y0 + 2);
    expect(cold?.region.interior).toBe(true);
    g.give('holz', 20);
    expect(g.hint(1, 1)).toBe(line('nachlegen', 'kamin_stein'));
    // E puts on what fits: the fireplace holds 12 minutes – 16 logs of 45 s (§15.4).
    expect(of(g.press(1, 1), 'fireFueled')).toEqual([expect.objectContaining({ light: kamin?.id, item: 'holz', count: 16, fuelSeconds: 720 })]);
    expect(g.hint(2, 1)).toBe(line('entzuenden', 'kamin_stein'));
    expect(of(g.press(2, 1), 'lightIgnited')).toEqual([expect.objectContaining({ light: kamin?.id, kind: 'kamin_stein' })]);
    expect(light.heatSources()(g.sim)).toEqual([expect.objectContaining({ coreHeatC: 15 })]);
    const warm = rooms.roomAt(g.sim, 0, g.x0 + 2, g.y0 + 2);
    expect(warm?.temperatureC).toBeCloseTo((cold?.temperatureC ?? 0) + sourceRoomHeatC(15, 9), 9);
    // A resin lamp outside: E names its fuel, fills it, lights it; a wall lamp on the house's south wall.
    g.build('harzlampe', 7, 2);
    g.stand(7, 3);
    expect(g.hint(7, 2)).toBe(line('nachlegen', 'harzlampe', 'keinLampenbrennstoff', 'harz'));
    g.give('harz', 5);
    // Four lumps fill it (§12.2 lamps, `vorrat` 4); lit, it holds no more.
    expect(of(g.press(7, 2), 'fireFueled')).toEqual([expect.objectContaining({ item: 'harz', count: 4 })]);
    expect(of(g.press(7, 2), 'lightIgnited')).toEqual([expect.objectContaining({ kind: 'harzlampe' })]);
    expect(g.hint(7, 2)).toBe(line('nachlegen', 'harzlampe', 'lampeVoll'));
    expect(of(g.press(7, 2), 'commandRejected')).toEqual([expect.objectContaining({ type: 'player.interact', reason: 'lampeVoll' })]);
    const lamp = light.state.placed.find((l) => l.kind === 'harzlampe');
    expect(light.sources(g.sim).find((s) => s.id === lamp?.id)?.radius).toBe(4 * TILE_PX);
    // Taken down within 30 s: the lamp comes back whole, its light leaves, its three unburned lumps come back.
    const inventory = g.sys<InventorySystem>('inventory');
    const harz = inventory.count('harz');
    const removed = g.run([{ type: 'build.remove', ...g.at(7, 2) }]);
    expect(of(removed, 'lightRemoved')).toEqual([expect.objectContaining({ light: lamp?.id, kind: 'harzlampe', reason: 'abgebaut' })]);
    expect(inventory.count('harz')).toBe(harz + 3);
    expect(inventory.count('harzlampe')).toBe(1);
    expect(light.state.placed.some((l) => l.kind === 'harzlampe')).toBe(false);
    // Set up again, filled and lit for the rain.
    g.build('harzlampe', 7, 2);
    const again = light.lightAt(0, g.x0 + 7, g.y0 + 2);
    g.run([{ type: 'light.fuel', light: again?.id ?? 0, from: g.slotOf('harz'), count: 1 }]);
    g.run([{ type: 'light.ignite', ...g.at(7, 2) }]);
    expect(again?.torch?.lit).toBe(true);
    g.build('harzlampe_wand', 1, 5);
    expect(light.state.placed.find((l) => l.kind === 'harzlampe_wand')).toMatchObject({ ...g.at(1, 5), mount: 'wand' });
    // A camp fire outside, then rain: out it goes; the fireplace under the roof burns on; the open lamp burns faster.
    g.give('lagerfeuer', 1);
    g.stand(7, 7);
    g.run([{ type: 'light.place', from: g.slotOf('lagerfeuer'), ...g.at(8, 7) }]);
    const camp = light.lightAt(0, g.x0 + 8, g.y0 + 7);
    g.run([{ type: 'light.fuel', light: camp?.id ?? 0, from: g.slotOf('holz'), count: 2 }]);
    g.run([{ type: 'light.ignite', ...g.at(8, 7) }]);
    expect(light.lightAt(0, g.x0 + 8, g.y0 + 7)?.fire?.lit).toBe(true);
    // The rain blends in (§10 "weiche Übergänge"): within a game hour it is rain, not a drizzle.
    g.run([{ type: 'setWeather', state: 'regen' }]);
    const wet: Ev[] = [];
    for (let i = 0; i < g.sim.clock.ticksPerGameHour && light.state.placed.find((l) => l.kind === 'harzlampe')?.torch?.rain !== 'regen'; i += 60) wet.push(...g.run([], 60));
    expect(of(wet, 'lightExtinguished')).toEqual([expect.objectContaining({ light: camp?.id, reason: 'regen' })]);
    expect(light.state.placed.find((l) => l.kind === 'kamin_stein')?.fire?.lit).toBe(true);
    expect(light.state.placed.find((l) => l.kind === 'harzlampe')?.torch?.rain).toBe('regen');
    expect(reasons(g.run([{ type: 'light.ignite', ...g.at(8, 7) }]))).toEqual(['raining']);
    // The building grid knows the fireplace as its part; the light sits on both of its tiles.
    expect(g.sys<BuildingSystem>('building').partAt(0, 'objekt', g.x0 + 2, g.y0 + 1)?.id).toBe('kamin_stein');
    expect(light.lightAt(0, g.x0 + 2, g.y0 + 1)?.kind).toBe('kamin_stein');
  });

  it('debug.unlock zeigt jede Fertigkeit und jedes Rezept', () => {
    const g = game();
    const crafting = g.sys<CraftingSystem>('crafting');
    expect(crafting.unlockedAll).toBe(false);
    const ev = g.run([{ type: 'debug.unlock' }]);
    expect(crafting.unlockedAll).toBe(true);
    expect(crafting.recipes.list.every((r) => crafting.isVisible(r.id))).toBe(true);
    expect(of(ev, 'recipeDiscovered').length).toBeGreaterThan(0);
    expect(of(ev, 'skillLevelUp').length).toBeGreaterThan(0);
  });
});
