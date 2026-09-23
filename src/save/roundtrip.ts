/**
 * Roundtrip test helper for save participants (MASTERPROMPT §2.3 "Save/Load-Roundtrip-Test pro
 * System"). Framework independent: it throws an `Error` describing the first difference, so a
 * Vitest test simply calls it (`tests/unit/save/roundtrip/<id>.test.ts`).
 *
 * Procedure: create a subject, `mutate` it, serialize the participant, transport the data like a
 * real save would (structured clone as in IndexedDB, and canonical JSON as in export files),
 * deserialize into a freshly created subject and compare both serializations canonically.
 * Also asserts that `mutate` changed the state (a roundtrip of the initial state proves little)
 * and that `serialize()` is stable and side-effect free.
 */
import { canonicalDiff, canonicalJson, parseCanonical, stableHash64 } from './canonical';
import type { SaveParticipant } from './registry';

/** How serialized data travels between the two subjects. */
export type RoundtripTransport = 'structuredClone' | 'json';

/** Result of a successful roundtrip. */
export interface RoundtripReport {
  readonly id: string;
  /** Canonical JSON of the mutated state. */
  readonly canonical: string;
  readonly hash: string;
  readonly transports: readonly RoundtripTransport[];
}

const TRANSPORTS: Readonly<Record<RoundtripTransport, (data: unknown) => unknown>> = {
  structuredClone: (data) => structuredClone(data),
  json: (data) => parseCanonical(canonicalJson(data)),
};

/** Checks the roundtrip of a participant created directly by `factory`. */
export function expectRoundtrip(factory: () => SaveParticipant, mutate: (participant: SaveParticipant) => void): RoundtripReport;
/** Checks the roundtrip of the participant `pick(subject)` of subjects created by `factory`. */
export function expectRoundtrip<T>(factory: () => T, mutate: (subject: T) => void, pick: (subject: T) => SaveParticipant): RoundtripReport;
export function expectRoundtrip<T>(factory: () => T, mutate: (subject: T) => void, pick?: (subject: T) => SaveParticipant): RoundtripReport {
  const select = pick ?? ((s: T) => s as unknown as SaveParticipant);
  const pristine = canonicalJson(select(factory()).serialize());

  const subject = factory();
  mutate(subject);
  const source = select(subject);
  const data = source.serialize();
  const canonical = canonicalJson(data);
  if (canonical === pristine) {
    throw new Error(`Roundtrip "${source.id}": mutate() did not change the serialized state; the test would prove nothing`);
  }
  const again = source.serialize();
  const unstable = canonicalDiff(data, again);
  if (unstable !== null) throw new Error(`Roundtrip "${source.id}": serialize() is not stable – ${unstable}`);

  const transports = Object.keys(TRANSPORTS) as RoundtripTransport[];
  for (const transport of transports) {
    const target = select(factory());
    if (target.id !== source.id || target.version !== source.version) {
      throw new Error(`Roundtrip "${source.id}": factory produced participant "${target.id}" v${target.version}, expected v${source.version}`);
    }
    target.deserialize(TRANSPORTS[transport](data));
    const restored = target.serialize();
    const diff = canonicalDiff(data, restored);
    if (diff !== null) throw new Error(`Roundtrip "${source.id}" via ${transport}: restored state differs at ${diff}`);
  }
  const after = canonicalDiff(data, source.serialize());
  if (after !== null) throw new Error(`Roundtrip "${source.id}": serialize() changed the state – ${after}`);
  return { id: source.id, canonical, hash: stableHash64(data), transports };
}
