/**
 * Save versions (MASTERPROMPT §28 "Versioniert mit Migrationen (Tests mit Fixture-Spielständen jeder
 * Version)", M3-34, ADR-0030).
 *
 * Each save participant carries its own data version and migrations (src/save/registry.ts). A *save
 * version* names one complete combination of them: the participants a build writes, each at its data
 * version. Version 1 is M3, the first build in which players create saves (pause menu, M3-31); every
 * milestone that changes saved data adds the next version (2 = M4, M4-30; 3 = M6 – opened by the fight, completed by
 * M6-36; 4 = M7 – opened by the first strand with a participant, docs/SPIEL.md §27; then M8-58 …).
 *
 * The list is the contract between the build and the fixture saves in `tests/fixtures/saves/`:
 * - `tests/unit/save/migrationen.test.ts` requires the current simulation to write exactly the last
 *   entry (a participant added, removed or bumped without a new save version fails) and loads the
 *   fixture save of every entry into the current build, checking that nothing of the player's state is
 *   lost;
 * - `npm run fixture:save` (tools/save/fixture.ts) writes the fixture save of the current version;
 *   fixtures of older versions are frozen.
 */
import type { SaveParticipant } from './registry';

/** One save version: which participants a build writes, and at which data version. */
export interface SaveVersion {
  /** Save version (1, 2, …). */
  readonly version: number;
  /** Milestone whose build writes it. */
  readonly milestone: string;
  /** Participant id → data version, in restore order. */
  readonly participants: Readonly<Record<string, number>>;
}

/** Every save version so far, oldest first (entries are never changed once a later one exists). */
export const SAVE_VERSIONS: readonly SaveVersion[] = [
  {
    version: 1,
    milestone: 'M3',
    participants: {
      clock: 1,
      rng: 1,
      ecs: 1,
      'world-chunks': 1,
      motion: 2,
      player: 1,
      vitals: 1,
      calendar: 1,
      'weather-regions': 1,
      inventory: 1,
      equipment: 1,
      drops: 1,
      gathering: 1,
      interaction: 1,
      crafting: 1,
      light: 1,
      conditions: 1,
      fear: 1,
      sleep: 1,
      actions: 1,
      skills: 1,
      death: 1,
      cheats: 1,
    },
  },
  {
    // M4 "Crafting & Bau I" (M4-30): placed stations with their slots and batches, the build grid (parts, blueprints,
    // doors), chests, hearth fires and burning tiles. Saves of version 1 load with all of them empty (each new
    // participant migrates from 0); `crafting` keeps version 1 – its new fields (station orders, "all recipes") are
    // optional and absent in M3 saves. Rooms are recomputed from the buildings and have no participant.
    version: 2,
    milestone: 'M4',
    participants: {
      clock: 1,
      rng: 1,
      ecs: 1,
      'world-chunks': 1,
      motion: 2,
      player: 1,
      vitals: 1,
      calendar: 1,
      'weather-regions': 1,
      inventory: 1,
      equipment: 1,
      drops: 1,
      gathering: 1,
      interaction: 1,
      crafting: 1,
      light: 1,
      stations: 1,
      building: 1,
      storage: 1,
      hearth: 1,
      fire: 1,
      conditions: 1,
      fear: 1,
      sleep: 1,
      actions: 1,
      skills: 1,
      death: 1,
      cheats: 1,
    },
  },
  {
    // M6 "Kampf & Kreaturen I": the fight (`combat`, M6-01 … M6-09: the player's attack, block, hitstop, stagger, broken
    // armour, a loaded bolt, parry marks, projectiles in flight, glowing arrows). Saves of version 2 load with no fight in
    // progress (the participant migrates from 0). The creature strand adds the creatures (`creatures`: live ones with their
    // AI, the chunk stocks, carcasses, the path service's pending requests), `traps` and the `bestiary` – saves of version 2
    // load without them (migrations from 0: every chunk is populated on its next activation). M6-36 completes the fixture.
    version: 3,
    milestone: 'M6',
    participants: {
      clock: 1,
      rng: 1,
      ecs: 1,
      'world-chunks': 1,
      motion: 2,
      player: 1,
      vitals: 1,
      calendar: 1,
      'weather-regions': 1,
      inventory: 1,
      equipment: 1,
      drops: 1,
      gathering: 1,
      interaction: 1,
      crafting: 1,
      light: 1,
      stations: 1,
      building: 1,
      storage: 1,
      hearth: 1,
      fire: 1,
      combat: 1,
      creatures: 1,
      traps: 1,
      bestiary: 1,
      conditions: 1,
      fear: 1,
      sleep: 1,
      actions: 1,
      skills: 1,
      death: 1,
      cheats: 1,
    },
  },
  {
    // M7 "Das erste Feuer" (docs/SPIEL.md §27): version 3 plus the new participants, each at its place of the system order.
    // Saves of versions 1–3 load with every new participant empty (each migrates from 0); no participant of version 3 changes
    // its data version (optional new fields only, ADR-0038, ADR-0207). `world-settings` (M7-51): peaceful, factor overrides,
    // shadow flood interval, logistics realism – the difficulty stays in `death`.
    // `places` (M7-07): the touched location slots – discovered/revealed, chests, guards, cleansing and return, blessing.
    // `world-events` (M7-38 … M7-40): the phase and run of every running world event, the minute lightning and the Lumen rain
    // drew up to, handled and forced runs.
    version: 4,
    milestone: 'M7',
    participants: {
      clock: 1,
      rng: 1,
      ecs: 1,
      'world-chunks': 1,
      'world-settings': 1,
      motion: 2,
      player: 1,
      vitals: 1,
      calendar: 1,
      'weather-regions': 1,
      inventory: 1,
      equipment: 1,
      drops: 1,
      gathering: 1,
      interaction: 1,
      crafting: 1,
      light: 1,
      stations: 1,
      building: 1,
      storage: 1,
      hearth: 1,
      fire: 1,
      combat: 1,
      creatures: 1,
      traps: 1,
      bestiary: 1,
      // Strand F (M7-32 … M7-34): the bosses – state, phase, health, the running attack, loot given.
      bosses: 1,
      places: 1,
      'world-events': 1,
      // Strand B (M7-49): the revealed map cells per layer (run lengths, Base64) and the own markers.
      map: 1,
      // Strand D (M7-19 … M7-23): the plots per chunk and the climate log (docs/SPIEL.md §27).
      farming: 1,
      // Strand D (M7-24): the line in the water, the fish traps per chunk, the ice holes (docs/SPIEL.md §27).
      fishing: 1,
      // Strand A (M7-31): the music being played (instrument, song, start tick, slot), plays so far, net swings, swarm catches.
      instruments: 1,
      // Strand F (M7-35 … M7-37): beacons (state, ignition and lit tick, vision shown), the unlocks granted (id, tick, source),
      // the shards used per kind, the waystones (number, place, name).
      beacons: 1,
      unlocks: 1,
      shards: 1,
      travel: 1,
      conditions: 1,
      fear: 1,
      sleep: 1,
      actions: 1,
      skills: 1,
      death: 1,
      cheats: 1,
    },
  },
];

/** The save version the running build writes. */
export const CURRENT_SAVE_VERSION: SaveVersion = SAVE_VERSIONS[SAVE_VERSIONS.length - 1] as SaveVersion;

/** Participant id → data version of `participants`, in their order. */
export function participantVersions(participants: Iterable<Pick<SaveParticipant, 'id' | 'version'>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of participants) out[p.id] = p.version;
  return out;
}

/** Whether two participant version maps list the same ids in the same order at the same versions. */
export function sameParticipantVersions(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k, i) => kb[i] === k && a[k] === b[k]);
}

/** The save version whose participants were written at exactly the versions of `stored` (ignoring order), or `undefined`. */
export function saveVersionOf(stored: Readonly<Record<string, { readonly version: number }>>): SaveVersion | undefined {
  const ids = Object.keys(stored);
  return SAVE_VERSIONS.find((v) => {
    const expected = Object.keys(v.participants);
    return expected.length === ids.length && expected.every((id) => stored[id]?.version === v.participants[id]);
  });
}
