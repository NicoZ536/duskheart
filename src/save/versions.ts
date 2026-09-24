/**
 * Save versions (MASTERPROMPT §28 "Versioniert mit Migrationen (Tests mit Fixture-Spielständen jeder
 * Version)", M3-34, ADR-0030).
 *
 * Each save participant carries its own data version and migrations (src/save/registry.ts). A *save
 * version* names one complete combination of them: the participants a build writes, each at its data
 * version. Version 1 is M3, the first build in which players create saves (pause menu, M3-31); every
 * milestone that changes saved data adds the next version (M4-30, M6-36, M8-58 …).
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
