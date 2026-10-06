/**
 * Contribution of strand D (Feld & Fang) to the reference save of save version 4 (docs/SPIEL.md §27 "bepflanzte Beete mit
 * Frucht in Stufe 2 und Frost-Opfer, Reuse mit Fang"; §20; M7-19 … M7-24): made by commands only, and its facts for the
 * migration test – read through the public API of the farming and fishing systems (`forEachPlot`, `forEachTrap`), never from
 * the snapshot layout.
 *
 * `playFeld(sim)`:
 * - sets a wooden garden bed near the player (`build.place beet_holz`), sows a carrot into it (`farm.plant`) and lets it grow
 *   `GROW_DAYS` good days (`farm.grow`): a carrot in stage 2;
 * - sets `TRAPS` fish traps into the water nearest the player (`fishing.placeTrap`, each from the land tile beside it);
 * - goes to the Frostkamm (the plan cell of the biome nearest the player – its nights are far below 0 °C in every season),
 *   sets a bed there and sows a tomato (not hardy);
 * - jumps one day ahead (`advanceTime`, crossing exactly one 06:00): the dawn freezes the tomato (frost, caught up silently by
 *   the jump), and the traps' chunks catch up their dawn (a catch per trap with `BALANCE.fishing.trap.catchChance`);
 * - returns the player to where they stood and restores the hotbar selection.
 * Every step checks its effect and throws when it is missing (the fixture world is fixed: seed 3, small).
 * Use (integrator, tools/save/fixture.ts): before `setTime` „Abenddämmerung“ (the day's jump must come before the dusk the
 * save is made at), `feldFacts(sim)` beside `saveFacts`. Fixtures of versions 1–3 load with `EMPTY_FELD_FACTS` (no plot and no
 * trap before M7; the participants `farming` and `fishing` migrate from 0 to nothing).
 */
import { z } from 'zod';
import { PESTS, type FarmPlot } from '../../../src/game/farming/types';
import { FarmingSystem } from '../../../src/game/farming/system';
import { FishingSystem } from '../../../src/game/fishing/system';
import type { GameCommand } from '../../../src/game/commands';
import type { InventorySystem } from '../../../src/game/inventory/system';
import type { PlayerSystem } from '../../../src/game/player/system';
import type { Simulation } from '../../../src/game/sim';
import { TILE_PX } from '../../../src/world/model/coords';

/** Ticks for the zone to stream the chunks around a teleport target. */
const SETTLE_TICKS = 30;
/** Good days the home bed's carrot grows: two days a stage, so stage 2 (§27 "Frucht in Stufe 2"). */
const GROW_DAYS = 4;
const HOME_CROP = 'karotte';
const HOME_STAGE = 2;
/** The frost victim: a tomato is not hardy (src/content/farming/index.ts). */
const FROST_CROP = 'tomate';
const FROST_BIOME = 'frostkamm';
/** Fish traps set (each catches at a dawn with chance ½: three make an empty catch unlikely; checked below). */
const TRAPS = 3;
/** How far around a spot a free tile (bed) or water (trap) is searched [tiles]. */
const SEARCH_TILES = 24;
/** One game day [min]: the jump crosses exactly one 06:00, wherever the clock stands. */
const DAY_MINUTES = 24 * 60;
/** Hotbar slot the fixture holds its items in. */
const HAND_SLOT = 9;

function farming(sim: Simulation): FarmingSystem {
  const f = sim.system('farming');
  if (!(f instanceof FarmingSystem)) throw new Error('feld: die Simulation hat kein System farming');
  return f;
}

function fishing(sim: Simulation): FishingSystem {
  const f = sim.system('fishing');
  if (!(f instanceof FishingSystem)) throw new Error('feld: die Simulation hat kein System fishing');
  return f;
}

/** Runs `commands` then `ticks − 1` more ticks; throws if a command was refused. Returns the event types seen. */
function run(sim: Simulation, what: string, commands: readonly GameCommand[], ticks = 1): Set<string> {
  const seen = new Set<string>();
  const refused: string[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step(i === 0 ? commands : undefined);
    sim.events.drain((type, payload) => {
      seen.add(type);
      if (type === 'commandRejected') refused.push(JSON.stringify(payload));
    });
  }
  if (refused.length > 0) throw new Error(`Fixture-Szenario (Feld): ${what} abgelehnt: ${refused.join(', ')}`);
  return seen;
}

/** Runs `commands` once and reports whether none was refused (a try at a candidate tile). */
function attempt(sim: Simulation, commands: readonly GameCommand[]): boolean {
  let refused = false;
  sim.step(commands);
  sim.events.drain((type, _payload) => {
    if (type === 'commandRejected') refused = true;
  });
  return !refused;
}

function teleport(tx: number, ty: number): GameCommand {
  return { type: 'player.teleport', x: (tx + 0.5) * TILE_PX, y: (ty + 0.5) * TILE_PX, layer: 0 };
}

/** Tiles around (tx, ty) in rings outwards, up to `SEARCH_TILES`. */
function* rings(tx: number, ty: number): Generator<readonly [number, number]> {
  for (let r = 1; r <= SEARCH_TILES; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) yield [tx + dx, ty + dy];
  }
}

/** Moves `item` into the hand (hotbar slot `HAND_SLOT`, selected). */
function hold(sim: Simulation, item: string): void {
  const inventory = sim.system('inventory') as InventorySystem;
  const state = inventory.state;
  for (const bereich of ['schnellleiste', 'inventar'] as const) {
    const index = state[bereich].findIndex((s) => s?.item === item);
    if (index < 0) continue;
    const moves: GameCommand[] = bereich === 'schnellleiste' && index === HAND_SLOT ? [] : [{ type: 'inventory.move', from: { bereich, index }, to: { bereich: 'schnellleiste', index: HAND_SLOT } }];
    run(sim, `${item} in die Hand`, [...moves, { type: 'player.selectHotbar', index: HAND_SLOT }]);
    return;
  }
  throw new Error(`Fixture-Szenario (Feld): ${item} fehlt in den Taschen`);
}

/** Sets a wooden bed on the first free tile around (tx, ty) and sows `crop` into it; returns the bed's tile. */
function bedWith(sim: Simulation, tx: number, ty: number, crop: string): { tx: number; ty: number } {
  const f = farming(sim);
  for (const [x, y] of rings(tx, ty)) {
    if (!attempt(sim, [{ type: 'build.place', part: 'beet_holz', tx: x, ty: y }])) continue;
    if (!f.isPlot(0, x, y)) throw new Error(`Fixture-Szenario (Feld): das Beet auf ${x},${y} ist kein Acker`);
    hold(sim, `saat_${crop}`);
    run(sim, 'vor das Beet', [teleport(x, y + 1)], 2);
    run(sim, `${crop} säen`, [{ type: 'farm.plant', tx: x, ty: y }]);
    return { tx: x, ty: y };
  }
  throw new Error(`Fixture-Szenario (Feld): kein Platz für ein Beet um ${tx},${ty}`);
}

/** Water tiles around (tx, ty) where a trap may go, each with a land tile beside it the player may stand on, nearest first. */
function* shoreWater(sim: Simulation, tx: number, ty: number): Generator<{ tx: number; ty: number; landX: number; landY: number }> {
  const fish = fishing(sim);
  const day = sim.clock.day;
  for (const [x, y] of rings(tx, ty)) {
    if (fish.castProblem(0, x, y, day) !== null || fish.trapAt(0, x, y) !== undefined) continue;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      if (fish.waterAt(0, x + dx, y + dy) > 0) continue;
      yield { tx: x, ty: y, landX: x + dx, landY: y + dy };
      break;
    }
  }
}

/** The plan cell centre of `biome` nearest (tx, ty) [tiles]. */
function nearestBiome(sim: Simulation, biome: string, tx: number, ty: number): { tx: number; ty: number } {
  const plan = sim.world.generated.plan;
  const { width, height, cellTiles } = plan.grid;
  let best: { tx: number; ty: number } | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (let cy = 1; cy < height - 1; cy++) {
    for (let cx = 1; cx < width - 1; cx++) {
      const c = cy * width + cx;
      const r = plan.region[c] as number;
      if (plan.land[c] !== 1 || r < 0 || plan.regions[r]?.biome !== biome) continue;
      const x = Math.floor((cx + 0.5) * cellTiles);
      const y = Math.floor((cy + 0.5) * cellTiles);
      const d = (x - tx) ** 2 + (y - ty) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { tx: x, ty: y };
      }
    }
  }
  if (best === null) throw new Error(`Fixture-Szenario (Feld): kein ${biome} in der Welt`);
  return best;
}

/** Plays the field and fishing part of the reference save (see module comment); throws if a step does not have its effect. */
export function playFeld(sim: Simulation): void {
  const player = sim.system('player') as PlayerSystem;
  const inventory = sim.system('inventory') as InventorySystem;
  const at = { x: 0, y: 0 };
  if (!player.position(sim, at)) throw new Error('Fixture-Szenario (Feld): kein Spieler');
  const home = { tx: Math.floor(at.x / TILE_PX), ty: Math.floor(at.y / TILE_PX) };
  const selected = inventory.state.auswahl;
  run(sim, 'Ausrüstung', [
    { type: 'inventory.give', item: 'beet_holz', count: 2 },
    { type: 'inventory.give', item: `saat_${HOME_CROP}`, count: 1 },
    { type: 'inventory.give', item: `saat_${FROST_CROP}`, count: 1 },
    { type: 'inventory.give', item: 'reuse', count: TRAPS },
  ]);
  // The carrot bed at home, grown to stage 2.
  const bed = bedWith(sim, home.tx, home.ty, HOME_CROP);
  run(sim, 'wachsen', [{ type: 'farm.grow', tage: GROW_DAYS }]);
  const plot = createPlot();
  if (!farming(sim).plotAt(0, bed.tx, bed.ty, plot) || plot.crop !== HOME_CROP || plot.stage !== HOME_STAGE) throw new Error(`Fixture-Szenario (Feld): die Karotte steht nicht in Stufe ${HOME_STAGE} (${plot.crop} ${plot.stage})`);
  // The fish traps in the water nearest home (a shore tile the player cannot stand on is passed over).
  let traps = 0;
  for (const w of shoreWater(sim, home.tx, home.ty)) {
    if (traps === TRAPS) break;
    run(sim, 'ans Ufer', [teleport(w.landX, w.landY)], 2);
    hold(sim, 'reuse');
    if (!attempt(sim, [{ type: 'fishing.placeTrap', from: { bereich: 'schnellleiste', index: HAND_SLOT }, tx: w.tx, ty: w.ty }])) continue;
    if (fishing(sim).trapAt(0, w.tx, w.ty) === undefined) throw new Error(`Fixture-Szenario (Feld): die Reuse auf ${w.tx},${w.ty} fehlt`);
    traps++;
  }
  if (traps < TRAPS) throw new Error('Fixture-Szenario (Feld): kein Wasser für die Reusen');
  // The frost victim in the Frostkamm; the dawn that freezes it while its chunk is the active zone.
  const cold = nearestBiome(sim, FROST_BIOME, home.tx, home.ty);
  run(sim, 'in den Frostkamm', [teleport(cold.tx, cold.ty)], SETTLE_TICKS);
  const victim = bedWith(sim, cold.tx, cold.ty, FROST_CROP);
  // The jump freezes the zone and catches it up silently (no `cropDied` event): the plot itself tells.
  run(sim, 'ein Tag', [{ type: 'advanceTime', minutes: DAY_MINUTES }], 2);
  if (!farming(sim).plotAt(0, victim.tx, victim.ty, plot) || !plot.dead) throw new Error('Fixture-Szenario (Feld): der Frost hat die Tomate nicht getroffen');
  run(sim, 'zurück', [teleport(home.tx, home.ty), { type: 'player.selectHotbar', index: selected }], SETTLE_TICKS);
  const caught = feldFacts(sim).reusen.reduce((n, r) => n + r.fish.length, 0);
  if (caught === 0) throw new Error('Fixture-Szenario (Feld): keine Reuse hat gefangen');
}

function createPlot(): FarmPlot {
  return { layer: 0, tx: 0, ty: 0, moisture: 0, fertility: 0, crop: '', stage: 0, daysInStage: 0, qualityPoints: 0, pest: 'keine', lastWateredDay: 0, harvests: 0, sheltered: false, dead: false };
}

/** Facts of the field and fishing: every plot with its crop and state, every fish trap with its catch. */
export const feldFactsSchema = z
  .object({
    beete: z.array(
      z
        .object({
          layer: z.number().int(),
          tx: z.number().int(),
          ty: z.number().int(),
          crop: z.string(),
          stage: z.number().int().min(0),
          dead: z.boolean(),
          moisture: z.number().int().min(0).max(100),
          fertility: z.number().int().min(0).max(100),
          pest: z.enum(PESTS),
          harvests: z.number().int().min(0),
        })
        .strict(),
    ),
    reusen: z.array(z.object({ layer: z.number().int(), tx: z.number().int(), ty: z.number().int(), fish: z.array(z.string()) }).strict()),
  })
  .strict();
export type FeldFacts = z.output<typeof feldFactsSchema>;

/** A world before M7: no plot, no trap. */
export const EMPTY_FELD_FACTS: FeldFacts = { beete: [], reusen: [] };

/** The plots and fish traps of `sim`, read through the farming and fishing systems. */
export function feldFacts(sim: Simulation): FeldFacts {
  const beete: FeldFacts['beete'] = [];
  farming(sim).forEachPlot(createPlot(), (p) => {
    beete.push({ layer: p.layer, tx: p.tx, ty: p.ty, crop: p.crop, stage: p.stage, dead: p.dead, moisture: p.moisture, fertility: p.fertility, pest: p.pest, harvests: p.harvests });
  });
  const reusen: FeldFacts['reusen'] = [];
  fishing(sim).forEachTrap((layer, tx, ty, fish) => reusen.push({ layer, tx, ty, fish: [...fish] }));
  return { beete, reusen };
}
