/**
 * The registration order of every simulation system (docs/SPIEL.md §16 "Systemreihenfolge", ADR-0207).
 *
 * Update, world tick, daily tick, observers and save participants all run in registration order, so the place of a
 * system decides what it sees in a tick: the world chunks first; the world settings before every reader of their
 * factors; everything that can hurt the player (bosses, vault traps, lightning) before the life systems, which see every
 * hit of the tick; the observers (`stats` … `guide`) last – they see all events of the step and are restored last.
 * `createSimulation` checks its list against this one (`systemOrderViolation`); the contract test is
 * tests/unit/game/systemreihenfolge.test.ts. Strands add their system at its place – a system missing here cannot be
 * registered.
 */

/** Registration order of every system (docs/SPIEL.md §16). The registered systems are a subsequence of this list. */
export const SYSTEM_ORDER = [
  'world-chunks', 'world-settings', 'motion', 'world-collision', 'player', 'appearance', 'vitals', 'calendar', 'weather-regions', 'temperature',
  'inventory', 'equipment', 'drops', 'gathering', 'interaction', 'crafting', 'tools', 'light', 'stations', 'repair', 'building', 'rooms',
  'storage', 'hearth', 'fire', 'combat', 'creatures', 'traps', 'bestiary',
  'bosses', 'places', 'vaults', 'farming', 'fishing', 'spoilage', 'water', 'meals', 'instruments', 'beacons', 'unlocks', 'shards', 'travel',
  'world-events', 'map',
  'conditions', 'fear', 'sleep', 'actions', 'skills', 'death', 'cheats',
  'stats', 'achievements', 'chronicle', 'quests', 'guide',
] as const;
/** One system id. */
export type SystemId = (typeof SYSTEM_ORDER)[number];

/** Position of every system id in `SYSTEM_ORDER`. */
const RANK: ReadonlyMap<string, number> = new Map(SYSTEM_ORDER.map((id, i) => [id, i]));

/** Whether `id` is a system id of `SYSTEM_ORDER`. */
export function isSystemId(id: string): id is SystemId {
  return RANK.has(id);
}

/**
 * Why the registered system ids `ids` (in registration order) break `SYSTEM_ORDER`, or `null` when they are a subsequence of
 * it: an id that is not listed, or one that comes after a system the list puts behind it.
 */
export function systemOrderViolation(ids: readonly string[]): string | null {
  let previous = -1;
  let previousId = '';
  for (const id of ids) {
    const rank = RANK.get(id);
    if (rank === undefined) return `system "${id}" is not in SYSTEM_ORDER (src/game/systemOrder.ts)`;
    if (rank <= previous) return `system "${id}" is registered after "${previousId}", SYSTEM_ORDER puts it before`;
    previous = rank;
    previousId = id;
  }
  return null;
}
