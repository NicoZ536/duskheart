/**
 * Save registry (docs/ARCHITEKTUR.md "Speichern-Registry", MASTERPROMPT §28).
 *
 * Collects the `SaveParticipant`s of a simulation (each system with state registers exactly one),
 * serializes all of them into one versioned `SaveSnapshot` and restores it, upgrading old data
 * through each participant's migrations first:
 * - stored version = current → data is passed through,
 * - stored version < current → migrations `from = v, v + 1, …, current − 1` run in order,
 * - no data for a participant → treated as version 0 (a participant added later provides a
 *   migration `from: 0` that creates its initial data; otherwise loading fails),
 * - stored version > current or data of an unknown participant → the save is from a newer or
 *   different build and loading fails.
 * Validation and migration happen for all participants before the first `deserialize`, so a bad
 * save never half-loads because of a version problem; a participant that rejects its data still
 * aborts the load (callers restore into a fresh simulation and discard it on error).
 *
 * `tests/unit/save/registry.test.ts` enforces a roundtrip test per registered participant.
 */
import { z } from 'zod';
import { assertValidParticipant, type SaveMigration, type SaveParticipant } from '../game/participant';

export { PARTICIPANT_ID_PATTERN, assertValidParticipant, type SaveMigration, type SaveParticipant } from '../game/participant';

/** Version of the snapshot envelope format. */
export const SAVE_SNAPSHOT_FORMAT = 1;

/** Data of one participant with the version it was written in. */
export interface ParticipantSnapshot {
  readonly version: number;
  readonly data: unknown;
}

/** All participants of one save. */
export interface SaveSnapshot {
  readonly format: number;
  readonly participants: Readonly<Record<string, ParticipantSnapshot>>;
}

/** A save that cannot be loaded (corrupt, newer build, missing data, failed migration). */
export class SaveError extends Error {
  override readonly name = 'SaveError';
}

const participantSnapshotSchema = z.object({ version: z.number().int().min(1), data: z.unknown() }).strict();

/** zod schema of the snapshot envelope (participant data is validated by the participants). */
export const saveSnapshotSchema = z
  .object({
    format: z.literal(SAVE_SNAPSHOT_FORMAT),
    participants: z.record(z.string(), participantSnapshotSchema),
  })
  .strict();

function describeIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.map(String).join('.') || '(snapshot)'}: ${i.message}`).join('; ');
}

/** Runs the migrations of `p` from `version` up to `p.version`. */
function migrate(p: SaveParticipant, version: number, data: unknown): unknown {
  if (version > p.version) throw new SaveError(`Save participant "${p.id}": stored version ${version} is newer than supported version ${p.version}`);
  const byFrom = new Map<number, SaveMigration>();
  for (const m of p.migrations ?? []) byFrom.set(m.from, m);
  let current = data;
  for (let v = version; v < p.version; v++) {
    const m = byFrom.get(v);
    if (m === undefined) {
      throw new SaveError(
        v === 0 ? `Save participant "${p.id}": no data in the save and no migration from version 0` : `Save participant "${p.id}": no migration from version ${v} to ${v + 1}`,
      );
    }
    try {
      current = m.migrate(current);
    } catch (err) {
      throw new SaveError(`Save participant "${p.id}": migration from version ${v} failed: ${(err as Error).message}`);
    }
  }
  return current;
}

export class SaveRegistry {
  private readonly list: SaveParticipant[] = [];

  /** Registers a participant (restore order = registration order). Throws on invalid or duplicate ids. */
  register(participant: SaveParticipant): this {
    assertValidParticipant(participant);
    if (this.list.some((p) => p.id === participant.id)) throw new TypeError(`Save participant "${participant.id}" is already registered`);
    this.list.push(participant);
    return this;
  }

  /** Registers several participants in order. */
  registerAll(participants: Iterable<SaveParticipant>): this {
    for (const p of participants) this.register(p);
    return this;
  }

  /** Registered ids in restore order. */
  ids(): string[] {
    return this.list.map((p) => p.id);
  }

  has(id: string): boolean {
    return this.list.some((p) => p.id === id);
  }

  /** The participant with this id; throws if unknown. */
  get(id: string): SaveParticipant {
    const p = this.list.find((x) => x.id === id);
    if (p === undefined) throw new TypeError(`Unknown save participant "${id}"`);
    return p;
  }

  /** Snapshot of every participant at its current version. */
  serializeAll(): SaveSnapshot {
    const participants: Record<string, ParticipantSnapshot> = {};
    for (const p of this.list) participants[p.id] = { version: p.version, data: p.serialize() };
    return { format: SAVE_SNAPSHOT_FORMAT, participants };
  }

  /**
   * Validates a stored snapshot against the registered participants and upgrades every entry to
   * the current version. Pure: no participant is touched. Throws `SaveError`.
   */
  migrateSnapshot(snapshot: unknown): SaveSnapshot {
    const parsed = saveSnapshotSchema.safeParse(snapshot);
    if (!parsed.success) throw new SaveError(`Save snapshot invalid: ${describeIssues(parsed.error)}`);
    const stored = parsed.data.participants;
    for (const id of Object.keys(stored)) {
      if (!this.has(id)) throw new SaveError(`Save contains data for unknown participant "${id}"`);
    }
    const participants: Record<string, ParticipantSnapshot> = {};
    for (const p of this.list) {
      const entry = stored[p.id];
      const data = entry === undefined ? migrate(p, 0, undefined) : migrate(p, entry.version, entry.data);
      participants[p.id] = { version: p.version, data };
    }
    return { format: SAVE_SNAPSHOT_FORMAT, participants };
  }

  /** Migrates (see `migrateSnapshot`) and restores every participant in registration order. */
  deserializeAll(snapshot: unknown): void {
    const upgraded = this.migrateSnapshot(snapshot);
    for (const p of this.list) {
      const entry = upgraded.participants[p.id] as ParticipantSnapshot;
      try {
        p.deserialize(entry.data);
      } catch (err) {
        throw new SaveError(`Save participant "${p.id}" rejected its data: ${(err as Error).message}`);
      }
    }
  }
}
