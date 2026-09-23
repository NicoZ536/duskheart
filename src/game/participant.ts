/**
 * Save participant contract (docs/ARCHITEKTUR.md "Speichern-Registry").
 *
 * Every system with state provides exactly one `SaveParticipant`. The type is defined in the game
 * layer because `SimSystem.save` needs it and `game` may not import `save` (layer rule §3.2);
 * `src/save/registry.ts` re-exports it and runs the registry, versions and migrations.
 */

/** Upgrades participant data from version `from` to `from + 1`. `from = 0` means "no data yet". */
export interface SaveMigration {
  readonly from: number;
  migrate(data: unknown): unknown;
}

/** One saveable piece of simulation state. */
export interface SaveParticipant {
  /** Unique kebab-case id; also the file name of its roundtrip test (`tests/unit/save/roundtrip/<id>.test.ts`). */
  readonly id: string;
  /** Current data version (integer ≥ 1). Bump it together with a migration. */
  readonly version: number;
  /** Migrations from older versions, one per step. */
  readonly migrations?: readonly SaveMigration[];
  /** Plain data snapshot (JSON compatible; typed arrays allowed). */
  serialize(): unknown;
  /** Restores a snapshot of the current version. Throws on malformed data. */
  deserialize(data: unknown): void;
}

/** Participant ids: lowercase kebab-case ASCII (`clock`, `rng`, `settler-jobs`). */
export const PARTICIPANT_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Checks id, version and migration list of a participant. Throws `TypeError` with the reason. */
export function assertValidParticipant(p: SaveParticipant): void {
  if (!PARTICIPANT_ID_PATTERN.test(p.id)) throw new TypeError(`Save participant id "${p.id}" must be kebab-case ASCII`);
  if (!Number.isInteger(p.version) || p.version < 1) throw new TypeError(`Save participant "${p.id}": version must be an integer ≥ 1, got ${String(p.version)}`);
  const seen = new Set<number>();
  for (const m of p.migrations ?? []) {
    if (!Number.isInteger(m.from) || m.from < 0 || m.from >= p.version) {
      throw new TypeError(`Save participant "${p.id}": migration from ${String(m.from)} is outside 0…${p.version - 1}`);
    }
    if (seen.has(m.from)) throw new TypeError(`Save participant "${p.id}": two migrations from version ${m.from}`);
    seen.add(m.from);
  }
}
