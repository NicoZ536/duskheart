/**
 * Save registry + enforcement (M0-14): every save participant registered by the default
 * simulation must have a roundtrip test at `tests/unit/save/roundtrip/<id>.test.ts` that calls
 * `expectRoundtrip` for that id.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../../src/game/setup';
import { SAVE_SNAPSHOT_FORMAT, SaveError, SaveRegistry, type SaveParticipant } from '../../../src/save/registry';
import { simulationRegistry } from '../../../src/save/world';

const ROUNDTRIP_DIR = fileURLToPath(new URL('./roundtrip/', import.meta.url));

/** Ids without a roundtrip test file that exercises `expectRoundtrip` for exactly that id. */
function missingRoundtripTests(ids: readonly string[], dir: string): string[] {
  return ids.filter((id) => {
    const file = join(dir, `${id}.test.ts`);
    if (!existsSync(file)) return true;
    const source = readFileSync(file, 'utf8');
    return !source.includes('expectRoundtrip(') || !source.includes(`'${id}'`);
  });
}

/** A participant holding one number, with configurable version and migrations. */
function counter(id: string, version = 1, migrations: SaveParticipant['migrations'] = []): SaveParticipant & { value: number } {
  const p = {
    id,
    version,
    migrations,
    value: 0,
    serialize: () => ({ value: p.value }),
    deserialize: (data: unknown) => {
      const v = (data as { value?: unknown } | null)?.value;
      if (typeof v !== 'number') throw new TypeError('value must be a number');
      p.value = v;
    },
  };
  return p;
}

describe('roundtrip enforcement', () => {
  it('every participant of the default simulation has a roundtrip test', () => {
    const ids = simulationRegistry(createSimulation({ seed: 1 })).ids();
    expect(ids).toEqual(expect.arrayContaining(['clock', 'rng', 'ecs', 'motion']));
    expect(missingRoundtripTests(ids, ROUNDTRIP_DIR)).toEqual([]);
  });

  it('flags a participant without roundtrip test', () => {
    const sim = createSimulation({ seed: 1 });
    sim.addSystem({ id: 'weather', save: counter('weather') });
    const ids = simulationRegistry(sim).ids();
    expect(missingRoundtripTests(ids, ROUNDTRIP_DIR)).toEqual(['weather']);
  });

  it('has no orphaned roundtrip tests', () => {
    const ids = new Set(simulationRegistry(createSimulation({ seed: 1 })).ids());
    const files = readdirSync(ROUNDTRIP_DIR).filter((f) => f.endsWith('.test.ts'));
    expect(files.map((f) => f.replace(/\.test\.ts$/, '')).filter((id) => !ids.has(id))).toEqual([]);
  });
});

describe('SaveRegistry', () => {
  it('serializes and restores all participants in registration order', () => {
    const order: string[] = [];
    const a = counter('a');
    const b = counter('b');
    const wrap = (p: SaveParticipant & { value: number }): SaveParticipant => ({
      ...p,
      deserialize: (d) => {
        order.push(p.id);
        p.deserialize(d);
      },
    });
    const reg = new SaveRegistry().register(wrap(a)).register(wrap(b));
    a.value = 3;
    b.value = 4;
    const snap = reg.serializeAll();
    expect(snap).toEqual({ format: SAVE_SNAPSHOT_FORMAT, participants: { a: { version: 1, data: { value: 3 } }, b: { version: 1, data: { value: 4 } } } });
    a.value = 0;
    b.value = 0;
    reg.deserializeAll(JSON.parse(JSON.stringify(snap)));
    expect([a.value, b.value]).toEqual([3, 4]);
    expect(order).toEqual(['a', 'b']);
    expect(reg.ids()).toEqual(['a', 'b']);
    expect(reg.get('b')).toBeDefined();
    expect(() => reg.get('c')).toThrow(/Unknown save participant/);
  });

  it('validates registrations', () => {
    const reg = new SaveRegistry().register(counter('a'));
    expect(() => reg.register(counter('a'))).toThrow(/already registered/);
    expect(() => reg.register(counter('Bad_Id'))).toThrow(/kebab-case/);
    expect(() => reg.register(counter('v0', 0))).toThrow(/version/);
    expect(() => reg.register(counter('m', 2, [{ from: 2, migrate: (d) => d }]))).toThrow(/outside/);
    expect(() =>
      reg.register(
        counter('m', 3, [
          { from: 1, migrate: (d) => d },
          { from: 1, migrate: (d) => d },
        ]),
      ),
    ).toThrow(/two migrations/);
  });

  it('runs migrations step by step from the stored version', () => {
    const p = counter('c', 3, [
      { from: 1, migrate: (d) => ({ value: (d as { v: number }).v }) },
      { from: 2, migrate: (d) => ({ value: (d as { value: number }).value * 10 }) },
    ]);
    const reg = new SaveRegistry().register(p);
    reg.deserializeAll({ format: SAVE_SNAPSHOT_FORMAT, participants: { c: { version: 1, data: { v: 7 } } } });
    expect(p.value).toBe(70);
    reg.deserializeAll({ format: SAVE_SNAPSHOT_FORMAT, participants: { c: { version: 2, data: { value: 5 } } } });
    expect(p.value).toBe(50);
    const upgraded = reg.migrateSnapshot({ format: SAVE_SNAPSHOT_FORMAT, participants: { c: { version: 1, data: { v: 1 } } } });
    expect(upgraded.participants['c']).toEqual({ version: 3, data: { value: 10 } });
  });

  it('initializes participants added after the save through a migration from version 0', () => {
    const old = counter('old');
    const added = counter('added', 1, [{ from: 0, migrate: () => ({ value: 42 }) }]);
    const reg = new SaveRegistry().register(old).register(added);
    reg.deserializeAll({ format: SAVE_SNAPSHOT_FORMAT, participants: { old: { version: 1, data: { value: 1 } } } });
    expect(added.value).toBe(42);
  });

  it('rejects incompatible or corrupt saves before touching any participant', () => {
    const a = counter('a', 2, [{ from: 1, migrate: (d) => d }]);
    const b = counter('b');
    const reg = new SaveRegistry().register(a).register(b);
    a.value = 9;
    const ok = { version: 1, data: { value: 1 } };
    const cases: Array<[unknown, RegExp]> = [
      [null, /snapshot invalid/],
      [{ format: 99, participants: {} }, /format/],
      [{ format: SAVE_SNAPSHOT_FORMAT, participants: { a: { version: 3, data: {} }, b: ok } }, /newer than supported/],
      [{ format: SAVE_SNAPSHOT_FORMAT, participants: { a: ok } }, /"b": no data in the save/],
      [{ format: SAVE_SNAPSHOT_FORMAT, participants: { a: ok, b: ok, c: ok } }, /unknown participant "c"/],
      [{ format: SAVE_SNAPSHOT_FORMAT, participants: { a: { version: 0, data: {} }, b: ok } }, /snapshot invalid/],
    ];
    for (const [snap, msg] of cases) {
      expect(() => reg.deserializeAll(snap)).toThrow(SaveError);
      expect(() => reg.deserializeAll(snap)).toThrow(msg);
    }
    expect(a.value).toBe(9);
    const gap = new SaveRegistry().register(counter('g', 3, [{ from: 2, migrate: (d) => d }]));
    expect(() => gap.deserializeAll({ format: SAVE_SNAPSHOT_FORMAT, participants: { g: { version: 1, data: {} } } })).toThrow(/no migration from version 1 to 2/);
    const failing = new SaveRegistry().register(
      counter('f', 2, [
        {
          from: 1,
          migrate: () => {
            throw new Error('boom');
          },
        },
      ]),
    );
    expect(() => failing.deserializeAll({ format: SAVE_SNAPSHOT_FORMAT, participants: { f: { version: 1, data: {} } } })).toThrow(/migration from version 1 failed: boom/);
  });

  it('wraps participant errors with the participant id', () => {
    const reg = new SaveRegistry().register(counter('a'));
    expect(() => reg.deserializeAll({ format: SAVE_SNAPSHOT_FORMAT, participants: { a: { version: 1, data: { value: 'x' } } } })).toThrow(
      /Save participant "a" rejected its data: value must be a number/,
    );
  });
});
