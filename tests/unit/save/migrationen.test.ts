/**
 * M3-34 Save-Versionierung, Migrationsgerüst, Referenzspielstände (MASTERPROMPT §28 "Versioniert mit
 * Migrationen (Tests mit Fixture-Spielständen jeder Version), Integritätsprüfung"; M14-13 erweitert diese
 * Datei um jede spätere Version):
 * - Die laufende Simulation schreibt genau die neueste Save-Version (src/save/versions.ts): ein neuer,
 *   entfernter oder hochgezählter Teilnehmer ohne neue Save-Version ist ein Fehler.
 * - Jede Save-Version hat ihren Referenzspielstand (`tests/fixtures/saves/v<n>.json`, `npm run
 *   fixture:save`), und jeder lädt verlustfrei in den aktuellen Build: dieselben Fakten des Spielers
 *   (Position, Werte, Zustände, Taschen, Ausrüstung, Skills, Grab, Licht, Aufträge), weiterspielbar, erneut
 *   speicherbar als aktuelle Version.
 * - Das Migrationsgerüst trägt: ein Teilnehmer mit höherer Version lädt den v1-Spielstand über seine
 *   Migration; Spielstände neuerer Builds und beschädigte Spielstände werden abgelehnt.
 * - M4-30 (Save-Version 2): Bauten, Blaupausen, Räume, Kisten, Stationen samt Chargen und Warteschlange, Herdfeuer
 *   und Feuer stehen im Referenzspielstand v2 und laden mit denselben Fakten; ein Spielstand älterer Version lädt mit
 *   leerer Basis – jeder später hinzugekommene Teilnehmer beginnt leer, alle übrigen Daten bleiben unverändert.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../../src/game/setup';
import { canonicalJson } from '../../../src/save/canonical';
import { exportWorld, importWorld, parseWorldDump, parseWorldDumpText, worldDumpText, type WorldDump } from '../../../src/save/dump';
import { MemorySaveStore } from '../../../src/save/memoryStore';
import { SaveError, SaveRegistry, type SaveParticipant, type SaveSnapshot } from '../../../src/save/registry';
import { CURRENT_SAVE_VERSION, SAVE_VERSIONS, participantVersions, sameParticipantVersions, saveVersionOf } from '../../../src/save/versions';
import { loadWorld, MAIN_SLOT, saveWorld, simulationRegistry } from '../../../src/save/world';
import { EMPTY_BASE_FACTS, fixtureFile, fixtureText, loadFixture, parseFixtureText, readFixture, roomFacts, saveFacts, type SaveFixture } from '../../../tools/save/fixture';

/** Loading a fixture rebuilds its world (small) – generous for a busy machine. */
const LOAD_TIMEOUT_MS = 60_000;
/** Ticks played on after loading a fixture (10 s game time). */
const PLAY_ON_TICKS = 600;
/** Wall-clock time of the re-save [epoch ms]. */
const RESAVE_AT = Date.UTC(2026, 8, 25);

function mainSlotSnapshot(fixture: SaveFixture): SaveSnapshot {
  const slot = fixture.dump.slots.find((s) => s.slot === MAIN_SLOT);
  if (slot === undefined) throw new Error(`fixture v${fixture.saveVersion} has no main slot`);
  return slot.snapshot as SaveSnapshot;
}

describe('Save-Versionen', () => {
  it('die laufende Simulation schreibt genau die neueste Save-Version (Teilnehmer, Reihenfolge, Versionen)', () => {
    const sim = createSimulation({ seed: 1 });
    const written = participantVersions(sim.participants());
    expect(written).toEqual(CURRENT_SAVE_VERSION.participants);
    expect(sameParticipantVersions(written, CURRENT_SAVE_VERSION.participants)).toBe(true);
    expect(Object.keys(written)).toEqual(Object.keys(CURRENT_SAVE_VERSION.participants));
  });

  it('Versionen zählen lückenlos ab 1 hoch; keine Teilnehmer-Version sinkt je', () => {
    SAVE_VERSIONS.forEach((v, i) => {
      expect(v.version).toBe(i + 1);
      expect(v.milestone).toMatch(/^M\d+$/);
      const before = SAVE_VERSIONS[i - 1];
      if (before === undefined) return;
      for (const [id, version] of Object.entries(v.participants)) expect(version, id).toBeGreaterThanOrEqual(before.participants[id] ?? 1);
    });
  });

  it('sameParticipantVersions und saveVersionOf vergleichen Ids, Reihenfolge und Versionen', () => {
    expect(sameParticipantVersions({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(sameParticipantVersions({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false);
    expect(sameParticipantVersions({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
    expect(sameParticipantVersions({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    const stored = Object.fromEntries(Object.entries(CURRENT_SAVE_VERSION.participants).map(([id, version]) => [id, { version }]));
    expect(saveVersionOf(stored)).toBe(CURRENT_SAVE_VERSION);
    expect(saveVersionOf({ ...stored, fremd: { version: 1 } })).toBeUndefined();
    expect(saveVersionOf({ ...stored, player: { version: 99 } })).toBeUndefined();
  });

  it('jede Save-Version hat ihren Referenzspielstand, geschrieben von genau dieser Version', () => {
    for (const v of SAVE_VERSIONS) {
      const file = join(process.cwd(), fixtureFile(v.version));
      expect(existsSync(file), `${fixtureFile(v.version)} fehlt – npm run fixture:save`).toBe(true);
      const fixture = readFixture(v.version);
      expect(fixture.saveVersion).toBe(v.version);
      expect(fixture.milestone).toBe(v.milestone);
      expect(fixture.dump.saveVersion).toBe(v.version);
      expect(saveVersionOf(mainSlotSnapshot(fixture).participants)).toBe(v);
    }
  });
});

describe.each(SAVE_VERSIONS.map((v) => ({ version: v.version })))('Referenzspielstand v$version', ({ version }) => {
  it(
    'lädt verlustfrei in den aktuellen Build: Position, Werte, Zustände, Taschen, Ausrüstung, Skills, Grab, Licht, Aufträge',
    async () => {
      const fixture = readFixture(version);
      const sim = await loadFixture(fixture);
      const { base, ...facts } = saveFacts(sim);
      const { rooms, ...expected } = fixture.facts;
      if (expected.base === undefined) {
        // A save from before the base (version 1): the same facts, and an empty base – every participant that came
        // later starts empty.
        expect(facts).toEqual(expected);
        expect(base).toEqual(EMPTY_BASE_FACTS);
      } else {
        expect({ ...facts, base }).toEqual(expected);
      }
      // Rooms are derived from the parts and the terrain: once the chunks around them are resident (the first tick).
      sim.step();
      expect(roomFacts(sim)).toEqual(rooms ?? []);
      // What M3-34 names is really in it (a fixture that lost them would prove nothing).
      const f = fixture.facts;
      expect(f.bags.some((s) => s.at.startsWith('ausruestung:'))).toBe(true);
      expect(f.bags.some((s) => s.at.startsWith('guertel:'))).toBe(true);
      expect(f.conditions.length).toBeGreaterThan(0);
      expect(f.skills.length).toBeGreaterThan(0);
      expect(f.graves.length).toBeGreaterThan(0);
      expect(f.lights.some((l) => l.lit)).toBe(true);
      expect(f.craftOrders.length).toBeGreaterThan(0);
      expect(fixture.dump.chunks.length).toBeGreaterThan(0);
      // What M4-30 names, from save version 2 on: buildings, blueprints, rooms, chests, stations with their batches
      // and queue, hearth fires, the fire state.
      if (version < 2) return;
      const b = f.base;
      if (b === undefined) throw new Error(`Referenzspielstand v${version} ohne Basis`);
      expect(new Set(b.parts.filter((p) => !p.blueprint).map((p) => p.ebene))).toEqual(new Set(['struktur', 'dach', 'objekt']));
      expect(b.parts.some((p) => p.part === 'tuer_holz')).toBe(true);
      expect(b.parts.some((p) => p.blueprint)).toBe(true);
      expect(f.rooms?.some((r) => r.interior)).toBe(true);
      expect(b.chests.some((c) => c.slots.length > 0 && c.name !== '')).toBe(true);
      expect(b.stations.some((st) => st.recipe !== null && st.worked > 0 && st.input.length > 0)).toBe(true);
      expect(b.stationOrders.length).toBeGreaterThan(0);
      expect(f.craftOrders.length).toBeGreaterThan(b.stationOrders.length);
      expect(b.hearths.some((h) => h.lit && h.store.length > 0)).toBe(true);
      expect(b.fire.length).toBeGreaterThan(0);
    },
    LOAD_TIMEOUT_MS,
  );

  it(
    'läuft weiter und speichert als aktuelle Version erneut – Laden ergibt denselben Zustand',
    async () => {
      // The player's way: load the world, play on, save it again (same world in the same store).
      const fixture = readFixture(version);
      const store = new MemorySaveStore();
      const sim = await loadFixture(fixture, store);
      for (let i = 0; i < PLAY_ON_TICKS; i++) {
        sim.step();
        sim.events.clear();
      }
      const worldId = fixture.dump.world.id;
      await saveWorld(store, sim, { worldId, name: fixture.dump.world.name, now: RESAVE_AT, gameVersion: 'test' });
      const dump = await exportWorld(store, worldId);
      expect(dump.saveVersion).toBe(CURRENT_SAVE_VERSION.version);
      expect(dump.chunks.map((c) => c.key)).toEqual(fixture.dump.chunks.map((c) => c.key));
      const again = await loadWorld(store, worldId);
      expect(again.hashState()).toBe(sim.hashState());
      expect(saveFacts(again)).toEqual(saveFacts(sim));
      expect(roomFacts(sim).length).toBe(fixture.facts.rooms?.length ?? 0);
      // Saved under another name into another store (a copy): every chunk diff goes along.
      const copy = new MemorySaveStore();
      await saveWorld(copy, again, { worldId: 'kopie', name: 'Kopie', now: RESAVE_AT, gameVersion: 'test' });
      expect((await exportWorld(copy, 'kopie')).chunks.map((c) => c.key)).toEqual(fixture.dump.chunks.map((c) => c.key));
      expect((await loadWorld(copy, 'kopie')).hashState()).toBe(sim.hashState());
      // The loaded world derives the same rooms once its chunks are resident.
      again.step();
      sim.step();
      expect(roomFacts(again)).toEqual(roomFacts(sim));
    },
    LOAD_TIMEOUT_MS,
  );
});

describe('Referenzspielstand der aktuellen Version', () => {
  it(
    'Laden und erneutes Serialisieren ergibt denselben Snapshot (nichts geht verloren, nichts kommt dazu)',
    async () => {
      const fixture = readFixture(CURRENT_SAVE_VERSION.version);
      const sim = await loadFixture(fixture);
      expect(canonicalJson(simulationRegistry(sim).serializeAll())).toBe(canonicalJson(mainSlotSnapshot(fixture)));
    },
    LOAD_TIMEOUT_MS,
  );

  it('Datei ↔ Fixture ist verlustfrei (kanonisches JSON, getypte Arrays der Chunk-Diffs)', () => {
    const text = readFileSync(join(process.cwd(), fixtureFile(CURRENT_SAVE_VERSION.version)), 'utf8');
    const fixture = parseFixtureText(text);
    expect(fixtureText(fixture)).toBe(text);
    const dumpText = worldDumpText(fixture.dump);
    expect(canonicalJson(parseWorldDumpText(dumpText))).toBe(canonicalJson(fixture.dump));
  });
});

describe('Migrationsgerüst', () => {
  it.each(SAVE_VERSIONS.slice(0, -1).map((v) => ({ version: v.version })))(
    'Save-Version $version → aktuell: später hinzugekommene Teilnehmer beginnen leer, die übrigen Daten bleiben',
    ({ version }) => {
      const fixture = readFixture(version);
      const snapshot = mainSlotSnapshot(fixture);
      const sim = createSimulation(fixture.dump.world.config);
      const upgraded = simulationRegistry(sim).migrateSnapshot(snapshot);
      const fresh = createSimulation(fixture.dump.world.config);
      const stored = SAVE_VERSIONS[version - 1]?.participants ?? {};
      const added = Object.keys(CURRENT_SAVE_VERSION.participants).filter((id) => !(id in stored));
      expect(added.length).toBeGreaterThan(0);
      for (const id of added) expect(canonicalJson(upgraded.participants[id]?.data), id).toBe(canonicalJson(fresh.participant(id).serialize()));
      // Participants at the same version in both builds pass through untouched.
      for (const [id, v] of Object.entries(stored)) if (CURRENT_SAVE_VERSION.participants[id] === v) expect(upgraded.participants[id], id).toEqual(snapshot.participants[id]);
    },
    LOAD_TIMEOUT_MS,
  );

  it('Save-Version 2 (M4) bringt Stationen, Bauten, Kisten, Herdfeuer und Feuer; Handwerk bleibt Version 1', () => {
    const [v1, v2] = SAVE_VERSIONS;
    expect(v2?.milestone).toBe('M4');
    expect(Object.keys(v2?.participants ?? {}).filter((id) => !(id in (v1?.participants ?? {})))).toEqual(['stations', 'building', 'storage', 'hearth', 'fire']);
    expect(v2?.participants['crafting']).toBe(1);
  });

  it(
    'ein Teilnehmer mit höherer Version lädt den v1-Spielstand über seine Migration',
    async () => {
      const fixture = readFixture(1);
      const sim = createSimulation(fixture.dump.world.config);
      const original = sim.participant('player');
      let restored: unknown = null;
      // "player" v2 of a later build: the same data plus a field the migration from v1 fills in.
      const bumped: SaveParticipant = {
        id: original.id,
        version: original.version + 1,
        migrations: [{ from: original.version, migrate: (data) => ({ ...(data as Record<string, unknown>), neu: 'aus v1 migriert' }) }],
        serialize: () => ({ ...(original.serialize() as Record<string, unknown>), neu: 'aus v1 migriert' }),
        deserialize: (data) => {
          restored = data;
          const { neu: _neu, ...v1 } = data as Record<string, unknown>;
          original.deserialize(v1);
        },
      };
      const registry = new SaveRegistry().registerAll(sim.participants().map((p) => (p.id === 'player' ? bumped : p)));
      const snapshot = mainSlotSnapshot(fixture);
      const upgraded = registry.migrateSnapshot(snapshot);
      expect(upgraded.participants['player']?.version).toBe(original.version + 1);
      expect(upgraded.participants['player']?.data).toEqual({ ...(snapshot.participants['player']?.data as Record<string, unknown>), neu: 'aus v1 migriert' });
      expect(upgraded.participants['inventory']).toEqual(snapshot.participants['inventory']);
      // Restored through the bumped registry, the player is the one the unchanged build loads.
      const store = new MemorySaveStore();
      await importWorld(store, fixture.dump);
      const loaded = await loadWorld(store, fixture.dump.world.id);
      registry.deserializeAll(snapshot);
      expect(restored).toMatchObject({ neu: 'aus v1 migriert' });
      expect(saveFacts(sim).player).toEqual(saveFacts(loaded).player);
      expect(saveFacts(sim).bags).toEqual(fixture.facts.bags);
    },
    LOAD_TIMEOUT_MS,
  );

  it('Spielstände neuerer Builds werden abgelehnt: höhere Save-Version, höhere Teilnehmer-Version, unbekannter Teilnehmer', async () => {
    const fixture = readFixture(CURRENT_SAVE_VERSION.version);
    const newer: WorldDump = { ...fixture.dump, saveVersion: CURRENT_SAVE_VERSION.version + 1 };
    expect(() => parseWorldDump(newer)).toThrow(SaveError);
    await expect(importWorld(new MemorySaveStore(), newer)).rejects.toThrow(/newer than this build/);
    const sim = createSimulation(fixture.dump.world.config);
    const snapshot = mainSlotSnapshot(fixture);
    const bumped = { ...snapshot, participants: { ...snapshot.participants, player: { version: 99, data: snapshot.participants['player']?.data } } };
    expect(() => simulationRegistry(sim).migrateSnapshot(bumped)).toThrow(/newer than supported/);
    const foreign = { ...snapshot, participants: { ...snapshot.participants, siedler: { version: 1, data: {} } } };
    expect(() => simulationRegistry(sim).migrateSnapshot(foreign)).toThrow(/unknown participant "siedler"/);
  });

  it(
    'ein beschädigter Referenzspielstand wird beim Laden erkannt (Integritäts-Hash), fremde Datensätze beim Import',
    async () => {
      const fixture = readFixture(CURRENT_SAVE_VERSION.version);
      const slot = fixture.dump.slots.find((s) => s.slot === MAIN_SLOT);
      if (slot === undefined) throw new Error('no main slot');
      const snapshot = slot.snapshot as SaveSnapshot;
      const tampered: WorldDump = {
        ...fixture.dump,
        slots: [{ ...slot, snapshot: { ...snapshot, participants: { ...snapshot.participants, fear: { version: 1, data: { tampered: true } } } } }],
      };
      const store = new MemorySaveStore();
      await importWorld(store, tampered);
      await expect(loadWorld(store, fixture.dump.world.id)).rejects.toThrow(/is corrupt/);
      const foreign: WorldDump = { ...fixture.dump, slots: [{ ...slot, worldId: 'andere-welt' }] };
      expect(() => parseWorldDump(foreign)).toThrow(/a record of world "andere-welt"/);
    },
    LOAD_TIMEOUT_MS,
  );
});
