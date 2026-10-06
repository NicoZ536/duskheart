/**
 * The simulation of a milestone for the tests that pin it exactly (ADR-0208, M7-01): parallel strands add systems, save
 * participants and commands during M7, so a test of the M6 state checks the M6 lists exactly – in their order, none lost –
 * and lets a later entry through only as part of the M7 contract: a system or participant of `SYSTEM_ORDER`
 * (src/game/systemOrder.ts, docs/SPIEL.md §16 "System-Id = Teilnehmer"), a participant listed as new in docs/SPIEL.md §27
 * at its data version, a command handled by one of those systems.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Simulation } from '../../../src/game/sim';
import { SYSTEM_ORDER } from '../../../src/game/systemOrder';

/** The systems of `createSimulation` at the end of M6, in registration order. */
export const M6_SYSTEMS: readonly string[] = [
  'world-chunks', 'motion', 'world-collision', 'player', 'vitals', 'calendar', 'weather-regions', 'temperature', 'inventory', 'equipment', 'drops',
  'gathering', 'interaction', 'crafting', 'tools', 'light', 'stations', 'repair', 'building', 'rooms', 'storage', 'hearth', 'fire', 'combat',
  'creatures', 'traps', 'bestiary', 'conditions', 'fear', 'sleep', 'actions', 'skills', 'death', 'cheats',
];

/** The save participants at the end of M6 (save version 3), in order. Repair and rooms keep no state of their own. */
export const M6_PARTICIPANTS: readonly string[] = [
  'clock', 'rng', 'ecs', 'world-chunks', 'motion', 'player', 'vitals', 'calendar', 'weather-regions', 'inventory', 'equipment', 'drops', 'gathering',
  'interaction', 'crafting', 'light', 'stations', 'building', 'storage', 'hearth', 'fire', 'combat', 'creatures', 'traps', 'bestiary', 'conditions', 'fear',
  'sleep', 'actions', 'skills', 'death', 'cheats',
];

/**
 * The command types at the end of M6, in declaration order. M3: player (M3-08), bags (M3-02; `inventory.give` debug),
 * interaction (M3-10), the player's life (M3-19, M3-23 … M3-26, M3-32; debug `conditions.apply/cure`, `fear.set`,
 * `death.kill`), crafting (M3-16; pinning to the tracker M4-08), using items (M3-15), light (M3-22) and the console's
 * cheats (M3-35); M4: stations (M4-03 … M4-06), repair (M4-09), building (M4-11 … M4-25), storage (M4-21), hearth (M4-20),
 * fire (debug, M4-28); M6: the attack and block buttons (M6-02), the creatures' debug spawn and kill, carving and traps
 * (M6-30, M6-35).
 */
export const M6_COMMAND_TYPES: readonly string[] = [
  'move', 'spawnDebugMover', 'despawn', 'teleport', 'setTime', 'advanceTime', 'setSeason', 'setWeather', 'player.spawn', 'player.move',
  'player.sprint', 'player.sneak', 'player.roll', 'player.teleport', 'inventory.move', 'inventory.split', 'inventory.collect', 'inventory.sort',
  'inventory.quickMove', 'inventory.discard', 'player.selectHotbar', 'player.scrollHotbar', 'inventory.give', 'player.interact', 'player.aim',
  'conditions.apply', 'conditions.cure', 'fear.set', 'sleep.start', 'sleep.wake', 'action.eat', 'action.useBelt', 'action.drink', 'action.sit',
  'action.stand', 'action.throw', 'action.cancel', 'skills.choosePerk', 'death.respawn', 'death.lootGrave', 'death.kill',
  'craft.start', 'craft.cancel', 'craft.useChests', 'craft.pin', 'player.useItem', 'light.toggle', 'light.place', 'light.fuel', 'light.ignite', 'light.douse',
  'light.take', 'debug.god', 'debug.noclip', 'debug.unlock',
  'station.place', 'station.remove', 'station.use', 'station.put', 'station.take', 'station.takeAll', 'repair.item',
  'build.place', 'build.blueprint', 'build.complete', 'build.remove', 'build.upgrade', 'build.door', 'build.repair',
  'storage.open', 'storage.close', 'storage.put', 'storage.take', 'storage.takeAll', 'storage.storeAll', 'storage.sort', 'storage.rename',
  'storage.label', 'storage.quickStash', 'hearth.use', 'hearth.fuel', 'hearth.take', 'hearth.ignite', 'hearth.douse', 'hearth.core',
  'hearth.uncore', 'fire.ignite',
  'combat.attack', 'combat.block', 'creature.spawn', 'creature.kill', 'carcass.carve', 'trap.place', 'trap.take',
];

/** The systems M7 adds to `SYSTEM_ORDER` (docs/SPIEL.md §16): every entry of the list that M6 did not register. */
export const M7_SYSTEMS: ReadonlySet<string> = new Set(SYSTEM_ORDER.filter((id) => !M6_SYSTEMS.includes(id)));

/** The entries of `ids` that are not in `m6`, in their order. */
export function sinceM6(ids: readonly string[], m6: readonly string[]): string[] {
  return ids.filter((id) => !m6.includes(id));
}

/** The entries of `ids` that are in `m6`, in their order (equal to `m6` when nothing of M6 was lost, renamed or moved). */
export function ofM6(ids: readonly string[], m6: readonly string[]): string[] {
  return ids.filter((id) => m6.includes(id));
}

/**
 * The new participants of save version 4 with their data versions, as docs/SPIEL.md §27 lists them (rows "| neu | `id` n, …").
 */
export const S27_NEW_PARTICIPANTS: ReadonlyMap<string, number> = (() => {
  const doc = readFileSync(join(process.cwd(), 'docs/SPIEL.md'), 'utf8');
  const start = doc.indexOf('\n## 27. ');
  if (start < 0) throw new Error('docs/SPIEL.md: Abschnitt 27 fehlt');
  const end = doc.indexOf('\n## ', start + 1);
  const out = new Map<string, number>();
  for (const line of doc.slice(start, end < 0 ? undefined : end).split('\n')) {
    if (!/^\s*\| neu \|/.test(line)) continue;
    const cell = line.split('|')[2] ?? '';
    for (const m of cell.matchAll(/`([a-z-]+)` (\d+)/g)) out.set(m[1] as string, Number(m[2]));
  }
  return out;
})();

/**
 * The commands declared after the M6 commands whose handler is not a system M7 adds to `SYSTEM_ORDER` (empty: every later
 * command belongs to the M7 contract). `types` are all declared command types in order.
 */
export function laterCommandsOutsideM7(sim: Simulation, types: readonly string[]): string[] {
  return types.slice(M6_COMMAND_TYPES.length).filter((type) => {
    const owner = sim.systems.find((s) => s.commands !== undefined && Object.hasOwn(s.commands, type));
    return owner === undefined || !M7_SYSTEMS.has(owner.id);
  });
}
