/**
 * Contribution of strand F (Boss & Leuchtfeuer) to the reference save of save version 4 (docs/SPIEL.md §27 "Borkenvater
 * besiegt, Leuchtfeuer 1 entzündet, Freischaltungen LF1, ein Wegstein, ein Herzsplitter benutzt"; M7-32 … M7-37), made by
 * commands only, and its facts for the migration test – read through the systems' public API (`BossesSystem`,
 * `BeaconsSystem`, `UnlocksSystem`, `ShardsSystem`, `TravelSystem`), never from the snapshot layout.
 *
 * `playLeuchtfeuer(sim)`: the console defeats the Borkenvater (`boss.debug … besiegen`: its loot lies in the arena) and lights
 * the first beacon (`beacon.debug … entzuenden`: the four LF1 unlocks, the ember core into the bags), the vision counts as
 * seen (`beacon.visionSeen`); a way stone is set on the first open tile beside the player and named (`build.place`,
 * `travel.rename`); a heart shard is used (`player.useItem`). The player does not move.
 * Use (integrator, tools/save/fixture.ts): after the base and before the fight (the fight stays the last thing before the
 * save), `leuchtfeuerFacts(sim)` beside `saveFacts`. Fixtures of versions 1–3 load with `emptyLeuchtfeuerFacts()` (every
 * save before M7: the bosses asleep at full health, the beacons dark, nothing unlocked, no shard used, no way stone; the
 * participants `bosses`, `beacons`, `unlocks`, `shards` and `travel` migrate from 0).
 */
import { z } from 'zod';
import { CONTENT } from '../../../src/content/index';
import type { BossDef } from '../../../src/content/bosses/schema';
import type { BeaconDef } from '../../../src/content/beacons/schema';
import { BeaconsSystem } from '../../../src/game/beacons/system';
import { BossesSystem } from '../../../src/game/bosses/system';
import type { GameCommand } from '../../../src/game/commands';
import type { InventorySystem } from '../../../src/game/inventory/system';
import type { PlayerSystem } from '../../../src/game/player/system';
import { ShardsSystem } from '../../../src/game/shards/system';
import { SHARD_KINDS } from '../../../src/game/shards/state';
import type { Simulation } from '../../../src/game/sim';
import { TravelSystem } from '../../../src/game/travel/system';
import { UnlocksSystem } from '../../../src/game/unlocks/system';
import { TILE_PX } from '../../../src/world/model/coords';

/** The boss, the beacon and the name of the reference save's way stone. */
export const LEUCHTFEUER_FIXTURE = { boss: 'borkenvater', beacon: 1, waystoneName: 'Am Strand' } as const;
/** Offsets from the player's tile tried for the way stone, nearest first [tiles] (within building reach). */
const STONE_OFFSETS: readonly (readonly [number, number])[] = [
  [2, 0],
  [-2, 0],
  [0, 2],
  [0, -2],
  [2, 2],
  [-2, 2],
  [2, -2],
  [-2, -2],
  [3, 0],
  [-3, 0],
  [0, 3],
  [0, -3],
];

function system<T>(sim: Simulation, id: string, kind: abstract new (...args: never[]) => T): T {
  const s = sim.system(id);
  if (!(s instanceof kind)) throw new Error(`leuchtfeuer: die Simulation hat kein System ${id}`);
  return s;
}

/** Runs `commands` for one tick then `ticks − 1` more; returns the event types seen and the refusals. */
function step(sim: Simulation, commands: readonly GameCommand[], ticks = 1): { seen: Set<string>; refused: string[] } {
  const seen = new Set<string>();
  const refused: string[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step(i === 0 ? commands : undefined);
    sim.events.drain((type, payload) => {
      seen.add(type);
      if (type === 'commandRejected') refused.push(JSON.stringify(payload));
    });
  }
  return { seen, refused };
}

/** Like `step`, but throws if a command was refused or an expected event is missing. */
function run(sim: Simulation, what: string, commands: readonly GameCommand[], expect: readonly string[] = []): void {
  const r = step(sim, commands);
  if (r.refused.length > 0) throw new Error(`Fixture-Szenario (Leuchtfeuer): ${what} abgelehnt: ${r.refused.join(', ')}`);
  for (const e of expect) if (!r.seen.has(e)) throw new Error(`Fixture-Szenario (Leuchtfeuer): ${what} ohne ${e}`);
}

/** Plays the beacon part of the reference save (see module comment); throws if a step does not have its effect. */
export function playLeuchtfeuer(sim: Simulation): void {
  const { boss, beacon, waystoneName } = LEUCHTFEUER_FIXTURE;
  run(sim, 'Borkenvater besiegen', [{ type: 'boss.debug', boss, aktion: 'besiegen' }], ['bossDefeated']);
  run(sim, 'Leuchtfeuer entzünden', [{ type: 'beacon.debug', beacon, aktion: 'entzuenden' }], ['beaconLit', 'unlockGranted']);
  run(sim, 'Vision gesehen', [{ type: 'beacon.visionSeen', beacon }]);
  // The way stone on the first open tile beside the player.
  const player = sim.system('player') as PlayerSystem;
  const at = { x: 0, y: 0 };
  if (!player.position(sim, at)) throw new Error('Fixture-Szenario (Leuchtfeuer): kein Spieler');
  const tx = Math.floor(at.x / TILE_PX);
  const ty = Math.floor(at.y / TILE_PX);
  run(sim, 'Wegstein geben', [{ type: 'inventory.give', item: 'wegstein', count: 1 }]);
  const travel = system(sim, 'travel', TravelSystem);
  const before = travel.state.waystones.length;
  for (const [dx, dy] of STONE_OFFSETS) {
    if (step(sim, [{ type: 'build.place', part: 'wegstein', tx: tx + dx, ty: ty + dy }]).refused.length === 0) break;
  }
  const stone = travel.state.waystones[before];
  if (stone === undefined) throw new Error('Fixture-Szenario (Leuchtfeuer): kein Platz für den Wegstein neben dem Spieler');
  run(sim, 'Wegstein benennen', [{ type: 'travel.rename', wegstein: stone.id, name: waystoneName }]);
  // A heart shard used.
  run(sim, 'Herzsplitter geben', [{ type: 'inventory.give', item: 'herzsplitter', count: 1 }]);
  const inv = sim.system('inventory') as InventorySystem;
  const quick = inv.state.schnellleiste.findIndex((s) => s?.item === 'herzsplitter');
  const slot = quick >= 0 ? { bereich: 'schnellleiste' as const, index: quick } : { bereich: 'inventar' as const, index: inv.state.inventar.findIndex((s) => s?.item === 'herzsplitter') };
  if (slot.index < 0) throw new Error('Fixture-Szenario (Leuchtfeuer): Herzsplitter nicht in den Taschen');
  run(sim, 'Herzsplitter benutzen', [{ type: 'player.useItem', slot }], ['shardUsed']);
}

/** Facts of the bosses, beacons, unlocks, shards and way stones. */
export const leuchtfeuerFactsSchema = z
  .object({
    bosses: z.array(z.object({ boss: z.string().min(1), state: z.string().min(1), phase: z.number().int().min(0), health: z.number().min(0), lootGiven: z.boolean(), defeated: z.boolean() }).strict()),
    beacons: z.array(z.object({ nummer: z.number().int().min(1), state: z.string().min(1), lit: z.boolean(), visionShown: z.boolean() }).strict()),
    /** Granted unlocks with their source, by id. */
    unlocks: z.array(z.object({ id: z.string().min(1), source: z.string().min(1) }).strict()),
    shards: z.record(z.enum(SHARD_KINDS), z.number().int().min(0)),
    waystones: z.array(z.object({ id: z.number().int().min(1), name: z.string() }).strict()),
  })
  .strict();
export type LeuchtfeuerFacts = z.output<typeof leuchtfeuerFactsSchema>;

/** A world before M7: every boss asleep at full health, every beacon dark, nothing unlocked, no shard, no way stone. */
export function emptyLeuchtfeuerFacts(): LeuchtfeuerFacts {
  return {
    bosses: (CONTENT.collection('bosses').values() as readonly BossDef[]).map((d) => ({ boss: d.id, state: 'schlafend', phase: 0, health: d.leben, lootGiven: false, defeated: false })),
    beacons: (CONTENT.collection('beacons').values() as readonly BeaconDef[]).map((d) => ({ nummer: d.nummer, state: 'erloschen', lit: false, visionShown: false })).sort((a, b) => a.nummer - b.nummer),
    unlocks: [],
    shards: { herz: 0, glut: 0 },
    waystones: [],
  };
}

/** The facts of `sim`, read through the systems. */
export function leuchtfeuerFacts(sim: Simulation): LeuchtfeuerFacts {
  const bosses = system(sim, 'bosses', BossesSystem);
  const beacons = system(sim, 'beacons', BeaconsSystem);
  const unlocks = system(sim, 'unlocks', UnlocksSystem);
  const shards = system(sim, 'shards', ShardsSystem);
  const travel = system(sim, 'travel', TravelSystem);
  return {
    bosses: (CONTENT.collection('bosses').values() as readonly BossDef[]).map((d) => {
      const b = bosses.state(d.id);
      return { boss: d.id, state: b.state, phase: b.phase, health: b.health, lootGiven: b.lootGiven, defeated: b.defeatedTick >= 0 };
    }),
    beacons: (CONTENT.collection('beacons').values() as readonly BeaconDef[])
      .map((d) => {
        const s = beacons.state(d.nummer);
        return { nummer: d.nummer, state: s.state, lit: s.litTick >= 0, visionShown: s.visionShown };
      })
      .sort((a, b) => a.nummer - b.nummer),
    unlocks: unlocks
      .granted()
      .map((g) => ({ id: g.id, source: g.source }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    shards: { herz: shards.used('herz'), glut: shards.used('glut') },
    waystones: travel.state.waystones.map((w) => ({ id: w.id, name: w.name })),
  };
}
