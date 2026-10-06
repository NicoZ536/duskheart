/**
 * Besitz-Kreaturen (M7-01, docs/SPIEL.md §17 „Haken“, ADR-0207): Orts- und Gewölbewächter, Mini-Boss und Boss-Diener
 * entstehen über `CreatureSystem.spawnOwned` mit ihrem Besitzer (`besitzer`) und optional eigener Leine (`leine`), leben im
 * Chunk-Bestand wie jede Kreatur – beim Einfrieren mit Besitzer und Leine hinein, beim Aktivieren wieder heraus –, zählen
 * nicht zum Wildbestand, melden ihren Tod (`onOwnedDeath`), verschwinden mit `despawnOwned` ohne Tod und Beute; `countOwned`
 * zählt aktive und eingelagerte. Spawnsperren (`addSpawnBlocker`) verbieten Tabellen-Spawns – Nachtspawner, Nachwuchs –,
 * nie die eigenen. Speichern → Laden behält Besitzer und Leine, der geladene Lauf geht weiter wie der ununterbrochene.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import type { CreatureFamily } from '../../../src/content/creatures/schema';
import { NULL_ENTITY, type Entity } from '../../../src/engine/ecs';
import { isCreatureOwner, type CreatureOwner } from '../../../src/game/creatures/owned';
import { creaturesSnapshotSchema } from '../../../src/game/creatures/state';
import type { SimEventMap } from '../../../src/game/sim';
import { expectRoundtrip } from '../../../src/save/roundtrip';
import type { ChunkData } from '../../../src/world/model/chunk';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { eventsOf } from './kampf-testwelt';
import { chunkOfMap, kreaturWelt, meadow, type KreaturWelt } from './kreatur-testwelt';

const ORT: CreatureOwner = 'ort:7';
const BOSS: CreatureOwner = 'boss:borkenvater';

function world(): KreaturWelt {
  const w = kreaturWelt(meadow(60, 40), { x: 30, y: 20 });
  w.cheats.god = true;
  return w;
}

/** An owned creature at map tile (x, y). */
function owned(w: KreaturWelt, creature: string, x: number, y: number, owner: CreatureOwner, leashTiles?: number): Entity {
  const c = w.centre(x, y);
  return w.creatures.spawnOwned(w.sim, { creature, layer: 0, x: c.x, y: c.y, owner, ...(leashTiles === undefined ? {} : { leashTiles }) });
}

/** The drawn chunk under map tile (x, y). */
function chunkAt(w: KreaturWelt, x: number, y: number): ChunkData {
  const [cx, cy] = chunkOfMap(x, y).split(',').map(Number) as [number, number];
  const chunk = w.chunks.get(0, cx, cy);
  if (chunk === undefined) throw new Error(`no chunk ${cx},${cy}`);
  return chunk;
}

describe('Besitz-Kreaturen (M7-01)', () => {
  it('spawnOwned: Besitzer, eigene Leine, Heimat am Spawnpunkt; countOwned je Besitzer', () => {
    const w = world();
    const wolf = owned(w, 'probe_wolf', 20, 20, ORT, 12);
    owned(w, 'keiler', 22, 20, ORT);
    owned(w, 'probe_wolf', 40, 20, BOSS);
    const s = w.state(wolf);
    expect(s.besitzer).toBe(ORT);
    expect(s.leine).toBe(12);
    expect({ x: s.homeX, y: s.homeY }).toEqual(w.centre(20, 20));
    expect(w.creatures.countOwned(ORT)).toBe(2);
    expect(w.creatures.countOwned(BOSS)).toBe(1);
    expect(w.creatures.countOwned('gewoelbe:1')).toBe(0);
    // A creature of the spawn table has no owner.
    expect(w.state(w.creature('hase', 25, 25)).besitzer).toBeUndefined();
  });

  it('der Tod meldet Besitzer, Art und Entität; fremde Tode melden nichts', () => {
    const w = world();
    const deaths: string[] = [];
    w.creatures.onOwnedDeath((_s, owner, creature, entity) => deaths.push(`${owner}/${creature}/${entity === NULL_ENTITY ? 'keine' : 'entitaet'}`));
    owned(w, 'probe_wolf', 31, 20, ORT);
    w.creature('hase', 29, 20);
    const ev = w.run(1, [{ type: 'creature.kill', radius: 4 }]);
    expect(eventsOf<SimEventMap['creatureDied']>(ev, 'creatureDied').map((d) => d.creature).sort()).toEqual(['hase', 'probe_wolf']);
    expect(deaths).toEqual(['ort:7/probe_wolf/entitaet']);
    expect(w.creatures.countOwned(ORT)).toBe(0);
  });

  it('Einfrieren und Aktivieren tragen Besitzer und Leine durch den Bestand; der Wildbestand zählt sie nicht', () => {
    const w = world();
    const e = owned(w, 'probe_wolf', 50, 30, ORT, 9);
    const home = w.state(e);
    const chunk = w.chunks.get(0, home.homeCx, home.homeCy) as ChunkData;
    w.creatures.zoneListener.onDeactivate(chunk, w.sim.tick);
    w.run(1);
    expect(w.creatures.store.has(e)).toBe(false);
    const stock = w.creatures.population.find(0, home.homeCx, home.homeCy);
    expect(stock?.members.map((m) => [m.creature, m.besitzer, m.leine])).toEqual([['probe_wolf', ORT, 9]]);
    expect(w.creatures.countOwned(ORT)).toBe(1);
    w.creatures.zoneListener.onActivate(chunk, w.sim.tick);
    const back = [...Array(w.creatures.store.size).keys()].map((i) => w.creatures.store.valueAt(i)).filter((s) => s.besitzer === ORT);
    expect(back.map((s) => [s.creature, s.leine])).toEqual([['probe_wolf', 9]]);
    expect(stock?.members).toEqual([]);
  });

  it('in einen eingefrorenen Chunk: direkt in den Bestand (NULL_ENTITY), zum Leben erweckt mit dem Chunk', () => {
    const w = world();
    const frozen = chunkAt(w, 50, 30);
    w.zone.only = new Set([chunkOfMap(30, 20)]);
    expect(owned(w, 'keiler', 50, 30, BOSS)).toBe(NULL_ENTITY);
    expect(w.creatures.countOwned(BOSS)).toBe(1);
    w.zone.only = null;
    w.creatures.zoneListener.onActivate(frozen, w.sim.tick);
    expect([...Array(w.creatures.store.size).keys()].some((i) => w.creatures.store.valueAt(i).besitzer === BOSS)).toBe(true);
    expect(w.creatures.countOwned(BOSS)).toBe(1);
  });

  it('despawnOwned entfernt aktive und eingelagerte ohne Tod und Beute; andere bleiben', () => {
    const w = world();
    owned(w, 'probe_wolf', 20, 20, BOSS);
    owned(w, 'probe_wolf', 21, 20, BOSS);
    const far = owned(w, 'keiler', 50, 30, BOSS);
    owned(w, 'keiler', 23, 20, ORT);
    const home = w.state(far);
    w.creatures.zoneListener.onDeactivate(w.chunks.get(0, home.homeCx, home.homeCy) as ChunkData, w.sim.tick);
    w.run(1);
    expect(w.creatures.countOwned(BOSS)).toBe(3);
    expect(w.creatures.despawnOwned(w.sim, BOSS)).toBe(3);
    const ev = w.run(1);
    expect(eventsOf(ev, 'creatureDied')).toEqual([]);
    expect(eventsOf(ev, 'entityDespawned').length).toBeGreaterThanOrEqual(2);
    expect(w.spilled).toEqual([]);
    expect(w.creatures.countOwned(BOSS)).toBe(0);
    expect(w.creatures.countOwned(ORT)).toBe(1);
  });

  it('Spawnsperren: kein Nachtspawn und kein Nachwuchs auf gesperrten Kacheln; eigene Spawns ignorieren sie', () => {
    const night = (block: boolean): { w: KreaturWelt; asked: Set<CreatureFamily> } => {
      const w = world();
      w.cenv.phase = 'nacht';
      w.light.ambient = 0.05;
      const asked = new Set<CreatureFamily>();
      if (block)
        w.creatures.addSpawnBlocker((_s, _l, _tx, _ty, family) => {
          asked.add(family);
          return true;
        });
      w.run(12 * 60);
      return { w, asked };
    };
    const brood = (w: KreaturWelt): number => [...Array(w.creatures.store.size).keys()].filter((i) => w.creatures.store.valueAt(i).creature === 'probe_schleicher').length;
    const open = night(false);
    expect(brood(open.w)).toBeGreaterThan(0);
    const shut = night(true);
    expect(brood(shut.w)).toBe(0);
    expect(shut.asked.has('schattenbrut')).toBe(true);
    // Owned creatures appear all the same.
    expect(owned(shut.w, 'probe_schleicher', 25, 20, BOSS)).not.toBe(NULL_ENTITY);
    // Regrowth of a frozen chunk (the population plans through the same veto).
    const regrow = (block: boolean, guards = 0): number => {
      const w = world();
      if (block) w.creatures.addSpawnBlocker(() => true);
      const chunk = chunkAt(w, 30, 20);
      chunk.biome.fill(contentWorldIdTables().biomes.runtimeId('gruenhain'));
      const stock = w.creatures.population.stockOf(0, chunk.cx, chunk.cy, 0);
      stock.seeded = true;
      stock.regrowTick = 1;
      // Owned guards in the stock are no part of its population: they do not fill the chunk's room for wild animals.
      for (let i = 0; i < guards; i++) stock.members.push({ creature: 'keiler', variant: -1, serial: 900 + i, health: 1, x: 0, y: 0, homeX: 0, homeY: 0, pack: 0, storedTick: 0, besitzer: ORT });
      w.creatures.population.catchUp(chunk, 0, 40 * w.creatures.population.regrowTicks);
      return stock.members.length;
    };
    expect(regrow(false)).toBeGreaterThan(0);
    expect(regrow(true)).toBe(0);
    expect(regrow(false, BALANCE.spawn.wildlife.maxPerChunk)).toBeGreaterThan(BALANCE.spawn.wildlife.maxPerChunk);
  });

  it('Speichern → Laden: Besitzer und Leine aktiver und eingelagerter Kreaturen; der Lauf geht gleich weiter', () => {
    const setup = (w: KreaturWelt): void => {
      owned(w, 'probe_wolf', 33, 20, ORT, 14);
      // In another chunk than the wolf (map tiles 32–63 × 32–39: chunk 3,3).
      const far = owned(w, 'keiler', 50, 35, 'gewoelbe:3', 6);
      const home = w.state(far);
      w.creatures.zoneListener.onDeactivate(w.chunks.get(0, home.homeCx, home.homeCy) as ChunkData, w.sim.tick);
      w.run(30);
    };
    const report = expectRoundtrip(world, setup, (w) => w.creatures.save);
    const data = creaturesSnapshotSchema.parse(JSON.parse(report.canonical));
    expect(data.creatures.filter((c) => c.besitzer !== undefined).map((c) => [c.creature, c.besitzer, c.leine])).toEqual([['probe_wolf', ORT, 14]]);
    expect(data.chunks.flatMap((c) => c.members).map((m) => [m.creature, m.besitzer, m.leine])).toEqual([['keiler', 'gewoelbe:3', 6]]);
    // Written only when set: a creature without an owner carries neither field.
    const raw = JSON.parse(report.canonical) as { creatures: Record<string, unknown>[] };
    expect(raw.creatures.filter((c) => !('besitzer' in c)).every((c) => !('leine' in c))).toBe(true);
    const a = world();
    setup(a);
    const b = world();
    for (const p of a.sim.participants()) b.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    a.run(60);
    b.run(60);
    expect(b.sim.hashState()).toBe(a.sim.hashState());
  });

  it('Besitzer-Ids: ort:<slot>, gewoelbe:<slot>, boss:<id>; alles andere lehnt der Spielstand ab', () => {
    for (const ok of ['ort:0', 'ort:12', 'gewoelbe:3', 'boss:borkenvater']) expect(isCreatureOwner(ok), ok).toBe(true);
    for (const bad of ['ort:-1', 'ort:01', 'ort:x', 'boss:', 'boss:Gross', 'drache:1', 7]) expect(isCreatureOwner(bad), String(bad)).toBe(false);
    const w = world();
    owned(w, 'probe_wolf', 33, 20, ORT);
    const good = w.creatures.save.serialize() as { creatures: Record<string, unknown>[] };
    const first = good.creatures.find((c) => c.besitzer !== undefined) as Record<string, unknown>;
    for (const bad of [{ ...first, besitzer: 'drache:1' }, { ...first, leine: 0 }]) {
      expect(() => w.creatures.save.deserialize({ ...good, creatures: [bad] })).toThrow(TypeError);
    }
  });
});
