/**
 * Verderb in der echten Simulation (M7-29; docs/SPIEL.md §21 „Verderb“, §28 „aktiv ≡ eingefroren + aufgeholt ≡ a → b → c“) und der
 * Fixture-Beitrag der Küche zum Referenzspielstand v4 (tools/save/fixtureM7/kueche.ts):
 *
 * - Ein Vorrat am Start der Welt der Referenzspielstände (Seed 3, klein): eine Holzkiste mit Brot und Äpfeln, ein Vorratsfass mit
 *   Forellen und Brot, eine Räucherkammer ohne Brennstoff mit Forellen im Eingang. Bleibt der Spieler dabei (die Stunden laufen
 *   aktiv), steht danach jeder Stapel genau so frisch da, wie wenn er weit fortgeht (die Chunks frieren ein, ihr Verderb wartet
 *   mit Stempel und Ort) und zurückkehrt (Aufholen in einem Zug) – und wie nach einem Zeitsprung oder zwei kürzeren
 *   hintereinander (a → b → c), bitgleich.
 * - Der Fixture-Beitrag stellt nur über Befehle her, was §27 verlangt (Kiste mit verderbendem Essen + Vorratsfass, Regensammler
 *   halb voll, aktive Mahlzeit-Effekte + Überdruss); Speichern und Laden geben dieselben Fakten.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/content/balance';
import type { GameCommand } from '../../src/game/commands';
import type { InventorySystem } from '../../src/game/inventory/system';
import type { PlayerSystem } from '../../src/game/player/system';
import { createSimulation } from '../../src/game/setup';
import type { Simulation } from '../../src/game/sim';
import type { SpoilageSystem } from '../../src/game/spoilage/system';
import type { StationSystem } from '../../src/game/stations/system';
import type { StorageSystem } from '../../src/game/storage/system';
import { MemorySaveStore } from '../../src/save/memoryStore';
import { loadWorld, saveWorld } from '../../src/save/world';
import { CHUNK_SHIFT, packChunkId, TILE_PX } from '../../src/world/model/coords';
import { EMPTY_KUECHE_FACTS, kuecheFacts, kuecheFactsSchema, playKuecheMahl, playKuecheVorrat } from '../../tools/save/fixtureM7/kueche';
import { WORLD_TIMEOUT_MS } from '../unit/world/weltgen-hilfen';

/** The world of the reference saves (tools/save/fixture.ts). */
const SEED = 3;
const SETTLE_TICKS = 30;
/** Game hours the store spoils in the comparison (each run steps them tick by tick or jumps them). */
const HOURS = 5;
/** How far the player goes to let the home chunks freeze [tiles] (well beyond the active zone). */
const AWAY_TILES = 320;
/** How far around the player a free tile is searched [tiles]. */
const SEARCH_TILES = 8;

function run(sim: Simulation, what: string, commands: readonly GameCommand[], ticks = 1): void {
  const refused: string[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step(i === 0 ? commands : undefined);
    sim.events.drain((type, payload) => {
      if (type === 'commandRejected') refused.push(JSON.stringify(payload));
    });
  }
  if (refused.length > 0) throw new Error(`${what} abgelehnt: ${refused.join(', ')}`);
}

function attempt(sim: Simulation, commands: readonly GameCommand[]): boolean {
  let refused = false;
  sim.step(commands);
  sim.events.drain((type) => {
    if (type === 'commandRejected') refused = true;
  });
  return !refused;
}

const teleport = (tx: number, ty: number): GameCommand => ({ type: 'player.teleport', x: (tx + 0.5) * TILE_PX, y: (ty + 0.5) * TILE_PX, layer: 0 });

function slotOf(sim: Simulation, item: string): { bereich: 'inventar' | 'schnellleiste'; index: number } {
  const state = (sim.system('inventory') as InventorySystem).state;
  for (const bereich of ['inventar', 'schnellleiste'] as const) {
    const index = state[bereich].findIndex((s) => s?.item === item);
    if (index >= 0) return { bereich, index };
  }
  throw new Error(`${item} fehlt in den Taschen`);
}

interface Vorrat {
  readonly sim: Simulation;
  readonly home: { readonly tx: number; readonly ty: number };
  readonly chunks: readonly number[];
}

/** The store at the start (see module comment), the player back at home; every run builds the same one. */
function vorrat(): Vorrat {
  const sim = createSimulation({ seed: SEED, worldSize: 'small' });
  run(sim, 'Spieler', [{ type: 'player.spawn' }], SETTLE_TICKS);
  const at = { x: 0, y: 0 };
  if (!(sim.system('player') as PlayerSystem).position(sim, at)) throw new Error('kein Spieler');
  const home = { tx: Math.floor(at.x / TILE_PX), ty: Math.floor(at.y / TILE_PX) };
  run(sim, 'Ausrüstung', [
    { type: 'inventory.give', item: 'kiste_holz', count: 1 },
    { type: 'inventory.give', item: 'vorratsfass', count: 1 },
    { type: 'inventory.give', item: 'raeucherkammer', count: 1 },
  ]);
  const tiles: Array<{ tx: number; ty: number }> = [];
  const place = (command: (x: number, y: number) => GameCommand): { tx: number; ty: number } => {
    for (let r = 1; r <= SEARCH_TILES; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          run(sim, 'hin', [teleport(home.tx + dx, home.ty + dy + 2)]);
          if (attempt(sim, [command(home.tx + dx, home.ty + dy)])) {
            const t = { tx: home.tx + dx, ty: home.ty + dy };
            tiles.push(t);
            return t;
          }
        }
      }
    }
    throw new Error('kein Platz');
  };
  const kiste = place((tx, ty) => ({ type: 'build.place', part: 'kiste_holz', tx, ty }));
  const fass = place((tx, ty) => ({ type: 'build.place', part: 'vorratsfass', tx, ty }));
  const kammer = place((tx, ty) => ({ type: 'station.place', from: slotOf(sim, 'raeucherkammer'), tx, ty }));
  const storage = sim.system('storage') as StorageSystem;
  const stations = sim.system('stations') as StationSystem;
  const fill = (to: { tx: number; ty: number }, food: ReadonlyArray<readonly [string, number]>, put: (from: ReturnType<typeof slotOf>, count: number) => GameCommand): void => {
    run(sim, 'an den Behälter', [teleport(to.tx, to.ty + 1)]);
    for (const [item, count] of food) {
      run(sim, `${item} holen`, [{ type: 'inventory.give', item, count }]);
      run(sim, `${item} hinein`, [put(slotOf(sim, item), count)]);
    }
  };
  const chest = (t: { tx: number; ty: number }): number => storage.chestAt(0, t.tx, t.ty)?.id ?? -1;
  fill(kiste, [['brot', 3], ['apfel', 4]], (from, count) => ({ type: 'storage.put', chest: chest(kiste), from, count }));
  fill(fass, [['forelle', 2], ['brot', 2]], (from, count) => ({ type: 'storage.put', chest: chest(fass), from, count }));
  fill(kammer, [['forelle', 3]], (from, count) => ({ type: 'station.put', station: stations.stationAt(0, kammer.tx, kammer.ty)?.id ?? -1, from, bereich: 'eingang', count }));
  run(sim, 'heim', [teleport(home.tx, home.ty)], SETTLE_TICKS);
  const chunks = [...new Set(tiles.map((t) => packChunkId(0, t.tx >> CHUNK_SHIFT, t.ty >> CHUNK_SHIFT)))];
  return { sim, home, chunks };
}

/** Freshness of every perishable stack in the store's containers (chests and the smokehouse's slots). */
function frische(sim: Simulation): unknown {
  const stations = (sim.system('stations') as StationSystem).placed.map((p) => ({
    station: p.station,
    eingang: (p.proc?.eingang ?? []).map((s) => (s === null ? null : [s.item, s.count, s.frische ?? null])),
  }));
  return { vorrat: kuecheFacts(sim).vorrat, stations };
}

describe('Verderb in der echten Simulation (M7-29)', () => {
  it(
    'aktiv ≡ eingefroren + aufgeholt ≡ a → b → c: Kiste, Vorratsfass und Räucherkammer bitgleich',
    () => {
      const ticks = HOURS * createSimulation({ seed: SEED, worldSize: 'small' }).clock.ticksPerGameHour;
      // Active: the player stays at home, every hour spoils in the hourly pass.
      const aktiv = vorrat();
      run(aktiv.sim, 'bleiben', [], ticks);
      const soll = frische(aktiv.sim);
      expect(JSON.stringify(soll)).not.toBe(JSON.stringify(frische(vorrat().sim)));
      // Frozen: the player goes far away, the home chunks freeze with their stamp and catch up on the way back.
      const fort = vorrat();
      const spoilage = fort.sim.system('spoilage') as SpoilageSystem;
      run(fort.sim, 'fort', [teleport(fort.home.tx, fort.home.ty - AWAY_TILES)], SETTLE_TICKS);
      expect(fort.chunks.some((c) => spoilage.frozenChunk(c) !== undefined)).toBe(true);
      run(fort.sim, 'fort bleiben', [], ticks - 2 * SETTLE_TICKS);
      run(fort.sim, 'zurück', [teleport(fort.home.tx, fort.home.ty)], SETTLE_TICKS);
      expect(fort.chunks.every((c) => spoilage.frozenChunk(c) === undefined)).toBe(true);
      expect(fort.sim.tick).toBe(aktiv.sim.tick);
      expect(frische(fort.sim)).toEqual(soll);
      // Jumps: one jump over the hours, or two shorter ones one after the other.
      const sprung = vorrat();
      run(sprung.sim, 'Sprung', [{ type: 'advanceTime', minutes: HOURS * 60 }], SETTLE_TICKS);
      const zwei = vorrat();
      run(zwei.sim, 'Sprung a → b', [{ type: 'advanceTime', minutes: 2 * 60 }], SETTLE_TICKS);
      run(zwei.sim, 'Sprung b → c', [{ type: 'advanceTime', minutes: (HOURS - 2) * 60 }], SETTLE_TICKS);
      expect(frische(sprung.sim)).toEqual(soll);
      expect(frische(zwei.sim)).toEqual(soll);
    },
    WORLD_TIMEOUT_MS * 4,
  );
});

describe('Fixture-Beitrag „Küche & Vorrat“ (Referenzspielstand v4, tools/save/fixtureM7/kueche.ts)', () => {
  it(
    'nur über Befehle: Kiste mit verderbendem Essen, Vorratsfass, Regensammler halb voll, zwei Mahlzeit-Effekte, Überdruss – Speichern und Laden geben dieselben Fakten',
    async () => {
      const sim = createSimulation({ seed: SEED, worldSize: 'small' });
      expect(kuecheFacts(sim)).toEqual(EMPTY_KUECHE_FACTS);
      run(sim, 'Spieler', [{ type: 'player.spawn' }], SETTLE_TICKS);
      playKuecheVorrat(sim);
      // The evening of the reference save, then the meals right before it is saved.
      run(sim, 'Abend', [{ type: 'setTime', hour: 19, minute: 30 }], SETTLE_TICKS);
      playKuecheMahl(sim);
      const facts = kuecheFactsSchema.parse(kuecheFacts(sim));
      const kiste = facts.vorrat.find((v) => v.behaelter === 'kiste');
      const fass = facts.vorrat.find((v) => v.behaelter === 'vorratsfass');
      expect(kiste?.stapel.every((s) => s.frische > 0 && s.frische < 100)).toBe(true);
      expect(fass?.stapel.every((s) => s.frische > 0 && s.frische < 100)).toBe(true);
      // The barrel keeps its bread better than the chest (×0,75).
      const brot = (v: typeof kiste): number => v?.stapel.find((s) => s.item === 'brot')?.frische ?? 0;
      expect(brot(fass)).toBeGreaterThan(brot(kiste));
      expect(facts.sammler).toHaveLength(1);
      const sammler = facts.sammler[0];
      expect(sammler?.ueberdacht).toBe(false);
      expect(sammler?.fuellung ?? 0).toBeGreaterThan(0);
      expect(sammler?.fuellung ?? 0).toBeLessThanOrEqual(BALANCE.water.collector.capacityMinutes / 2);
      expect(facts.mahlzeit.map((m) => m.zustand).sort()).toEqual(['ausdauernd', 'gestaerkt']);
      expect(facts.ueberdruss).toContainEqual(['eintopf', 2]);
      // Saved and loaded: the same facts.
      const store = new MemorySaveStore();
      await saveWorld(store, sim, { worldId: 'kueche', name: 'kueche', now: 1, gameVersion: 'test' });
      const loaded = await loadWorld(store, 'kueche');
      expect(kuecheFacts(loaded)).toEqual(facts);
    },
    WORLD_TIMEOUT_MS * 2,
  );
});
