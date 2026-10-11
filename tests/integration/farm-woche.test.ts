/**
 * M7-60 – die Farm-Woche (docs/SPIEL.md §21 „Farm-Woche“, §20, §28): sieben Spieltage headless in der echten Simulation (Welt der
 * Referenzspielstände: Seed 3, klein), nur über Befehle – säen, gießen, Regen, kompostieren und düngen, ernten, kochen, verderben,
 * Verdorbenes kompostieren. Zwischen den Handlungen springt die Uhr (`advanceTime`: die aktive Zone friert ein und holt beim
 * Wiederaufwachen auf), zu jeder Handlung läuft sie eine Spielstunde aktiv – beide Wege kommen vor:
 *
 * - Tag 1, 06:00: am Fluss nahe dem Start zwei Holzbeete mit Erbsen (weiter als 2 Kacheln vom Wasser: kein Wassernähe-Bonus),
 *   die Gießkanne am Fluss gefüllt, beide Beete gegossen; Kompostkiste mit 6 Fasern; Kessel mit Lagerfeuer und Regensammler daneben,
 *   eine Kiste. Eine Stunde aktiv, Regen über der Region, Sprung in den nächsten Morgen.
 * - Tag 2: der Regensammler hat den Regen des Tages, die Erbsen sind gewachsen. Tag 3: Kompost aus der Kiste geholt und auf ein
 *   Beet gestreut (Fruchtbarkeit +30), noch einmal gegossen.
 * - Tag 5: die Erbsen sind reif und werden geerntet; das Lagerfeuer brennt neu; Erbsensuppe im Kessel – das Wasser kommt aus dem
 *   Regensammler (ein Schluck, kein offenes Wasser in Reichweite); die Suppe kommt in die Kiste.
 * - Tag 7: die Suppe ist nach ihren zwei Tagen Haltbarkeit in der Kiste zu Verdorbenem geworden (auf die Spielstunde genau, die der
 *   Verlust je Stunde vorgibt); Verdorbenes mit 5 Fasern in die Kompostkiste – ein neuer Kompost-Durchgang beginnt.
 *
 * Laufzeit ≤ 60 s (gemessen und geprüft).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/content/balance';
import { CONTENT } from '../../src/content/index';
import { waterSource } from '../../src/game/actions/formulas';
import type { GameCommand } from '../../src/game/commands';
import type { FarmingSystem } from '../../src/game/farming/system';
import type { FarmPlot } from '../../src/game/farming/types';
import type { FishingSystem } from '../../src/game/fishing/system';
import type { InventorySystem } from '../../src/game/inventory/system';
import type { LightSystem } from '../../src/game/light/system';
import type { PlayerSystem } from '../../src/game/player/system';
import { createSimulation } from '../../src/game/setup';
import type { Simulation } from '../../src/game/sim';
import type { StationSystem } from '../../src/game/stations/system';
import type { StorageSystem } from '../../src/game/storage/system';
import { lossPerHour } from '../../src/game/spoilage/formulas';
import type { WaterSystem } from '../../src/game/water/system';
import { TILE_PX } from '../../src/world/model/coords';

/** The world of the reference saves (tools/save/fixture.ts). */
const SEED = 3;
/** The budget of the whole week [ms] (docs/SPIEL.md §21 „Laufzeit ≤ 60 s“). */
const BUDGET_MS = 60_000;
const DAY_MINUTES = 24 * 60;
const HOUR_MINUTES = 60;
/** Ticks for the zone to stream the chunks around a teleport target. */
const SETTLE_TICKS = 30;
/** How far from the start the river is searched, and around the farm site its parts [tiles]. */
const RIVER_SEARCH = 64;
const SITE_SEARCH = 10;
/** The farm site lies this far west of the river's bank, and nothing of it within `DRY_TILES` of fresh water [tiles]. */
const SITE_OFFSET = 9;
const DRY_TILES = BALANCE.farming.waterNearTiles + 1;
/** Ticks one craft or harvest may take at most. */
const WORK_LIMIT_TICKS = 3600;
const CROP = 'erbse';

type Ereignis = readonly [string, unknown];

class Woche {
  readonly farming: FarmingSystem;
  readonly fishing: FishingSystem;
  readonly inventory: InventorySystem;
  readonly stations: StationSystem;
  readonly storage: StorageSystem;
  readonly water: WaterSystem;
  readonly light: LightSystem;
  readonly plot: FarmPlot = { layer: 0, tx: 0, ty: 0, moisture: 0, fertility: 0, crop: '', stage: 0, daysInStage: 0, qualityPoints: 0, pest: 'keine', lastWateredDay: 0, harvests: 0, sheltered: false, dead: false };
  /** Ticks stepped one by one and ticks jumped (the two ways time passes this week). */
  aktiv = 0;
  gesprungen = 0;

  constructor(readonly sim: Simulation) {
    this.farming = sim.system('farming') as FarmingSystem;
    this.fishing = sim.system('fishing') as FishingSystem;
    this.inventory = sim.system('inventory') as InventorySystem;
    this.stations = sim.system('stations') as StationSystem;
    this.storage = sim.system('storage') as StorageSystem;
    this.water = sim.system('water') as WaterSystem;
    this.light = sim.system('light') as LightSystem;
  }

  /** Runs `commands` then `ticks − 1` more ticks; throws if one was refused. Returns the events. */
  run(what: string, commands: readonly GameCommand[], ticks = 1): Ereignis[] {
    const out: Ereignis[] = [];
    const refused: string[] = [];
    for (let i = 0; i < ticks; i++) {
      this.sim.step(i === 0 ? commands : undefined);
      this.sim.events.drain((type, payload) => {
        out.push([type, payload]);
        if (type === 'commandRejected') refused.push(JSON.stringify(payload));
      });
    }
    this.aktiv += ticks;
    if (refused.length > 0) throw new Error(`Farm-Woche: ${what} abgelehnt: ${refused.join(', ')}`);
    return out;
  }

  /** Runs `commands` once; whether none was refused. */
  attempt(commands: readonly GameCommand[]): boolean {
    let refused = false;
    this.sim.step(commands);
    this.sim.events.drain((type, _payload) => {
      if (type === 'commandRejected') refused = true;
    });
    this.aktiv++;
    return !refused;
  }

  /** Runs until `done` sees its event (at most `limit` ticks); throws otherwise. */
  until(what: string, commands: readonly GameCommand[], done: (e: Ereignis) => boolean, limit = WORK_LIMIT_TICKS): Ereignis[] {
    const all: Ereignis[] = [];
    for (let i = 0; i < limit; i++) {
      const e = this.run(what, i === 0 ? commands : []);
      all.push(...e);
      if (e.some(done)) return all;
    }
    throw new Error(`Farm-Woche: ${what} nicht in ${limit} Ticks`);
  }

  /** One game hour stepped tick by tick (the active zone lives). */
  stunde(): void {
    this.run('eine Stunde', [], this.sim.clock.ticksPerGameHour);
  }

  /** Jumps the clock to `hour`:`minute` of day `day` (the zone freezes and catches up when it wakes). */
  springe(day: number, hour: number, minute = 0): void {
    const now = (this.sim.clock.day - 1) * DAY_MINUTES + this.sim.clock.minuteOfDay;
    const to = (day - 1) * DAY_MINUTES + hour * HOUR_MINUTES + minute;
    if (to <= now) throw new Error(`Farm-Woche: Sprung zurück (${now} → ${to})`);
    const before = this.sim.tick;
    this.run(`Sprung zu Tag ${day} ${hour}:${minute}`, [{ type: 'advanceTime', minutes: to - now }], SETTLE_TICKS);
    this.gesprungen += this.sim.tick - before - SETTLE_TICKS;
  }

  teleport(tx: number, ty: number): void {
    this.run('teleportieren', [{ type: 'player.teleport', x: (tx + 0.5) * TILE_PX, y: (ty + 0.5) * TILE_PX, layer: 0 }], 2);
  }

  slotOf(item: string): { bereich: 'inventar' | 'schnellleiste'; index: number } {
    for (const bereich of ['inventar', 'schnellleiste'] as const) {
      const index = this.inventory.state[bereich].findIndex((s) => s?.item === item);
      if (index >= 0) return { bereich, index };
    }
    throw new Error(`Farm-Woche: ${item} fehlt in den Taschen`);
  }

  count(item: string): number {
    let n = 0;
    for (const bereich of ['inventar', 'schnellleiste'] as const) for (const s of this.inventory.state[bereich]) if (s?.item === item) n += s.count;
    return n;
  }

  /** Uses the item `item` from the bags on tile (tx, ty), standing south of it. */
  use(what: string, item: string, tx: number, ty: number): Ereignis[] {
    this.teleport(tx, ty + 1);
    return this.run(what, [{ type: 'player.useItem', slot: this.slotOf(item), tx, ty }], 2);
  }

  plotOf(tx: number, ty: number): FarmPlot {
    if (!this.farming.plotAt(0, tx, ty, this.plot)) throw new Error(`Farm-Woche: kein Beet auf ${tx},${ty}`);
    return this.plot;
  }

  fresh(tx: number, ty: number): boolean {
    const s = waterSource(this.fishing.waterAt(0, tx, ty));
    return s === 'fluss' || s === 'see' || s === 'quelle';
  }

  /** Whether no fresh water lies within `DRY_TILES` of (tx, ty). */
  dry(tx: number, ty: number): boolean {
    for (let dy = -DRY_TILES; dy <= DRY_TILES; dy++) for (let dx = -DRY_TILES; dx <= DRY_TILES; dx++) if (this.fresh(tx + dx, ty + dy)) return false;
    return true;
  }

  /** Tiles around (tx, ty) in rings outwards up to `r`. */
  *rings(tx: number, ty: number, r: number): Generator<readonly [number, number]> {
    for (let k = 1; k <= r; k++) {
      for (let dy = -k; dy <= k; dy++) for (let dx = -k; dx <= k; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === k) yield [tx + dx, ty + dy];
    }
  }

  /** Places something on the first dry tile around (tx, ty) the command accepts, standing south of it; returns the tile. */
  place(what: string, tx: number, ty: number, command: (x: number, y: number) => GameCommand): { tx: number; ty: number } {
    for (const [x, y] of this.rings(tx, ty, SITE_SEARCH)) {
      if (!this.dry(x, y)) continue;
      this.teleport(x, y + 2);
      if (this.attempt([command(x, y)])) return { tx: x, ty: y };
    }
    throw new Error(`Farm-Woche: kein Platz für ${what} um ${tx},${ty}`);
  }
}

describe('Farm-Woche (M7-60)', () => {
  it(
    'sieben Spieltage: säen, gießen, Regen, kompostieren, ernten, kochen mit Regenwasser, verderben, Verdorbenes kompostieren',
    () => {
      const t0 = performance.now();
      const w = new Woche(createSimulation({ seed: SEED, worldSize: 'small' }));
      const sim = w.sim;
      w.run('Spieler erscheint', [{ type: 'player.spawn' }], SETTLE_TICKS);
      expect(sim.clock.day).toBe(1);
      const at = { x: 0, y: 0 };
      if (!(sim.system('player') as PlayerSystem).position(sim, at)) throw new Error('kein Spieler');
      const home = { tx: Math.floor(at.x / TILE_PX), ty: Math.floor(at.y / TILE_PX) };

      // ---- Tag 1, 06:00 – der Fluss, der Hof, säen, gießen, kompostieren.
      let river: { tx: number; ty: number } | null = null;
      for (const [x, y] of w.rings(home.tx, home.ty, RIVER_SEARCH)) {
        if (w.fresh(x, y) && !w.fresh(x - 1, y)) {
          river = { tx: x, ty: y };
          break;
        }
      }
      if (river === null) throw new Error('kein Fluss nahe dem Start');
      const site = { tx: river.tx - SITE_OFFSET, ty: river.ty };
      w.run('Ausrüstung', [
        { type: 'inventory.give', item: 'beet_holz', count: 2 },
        { type: 'inventory.give', item: `saat_${CROP}`, count: 2 },
        { type: 'inventory.give', item: 'giesskanne', count: 1 },
        { type: 'inventory.give', item: 'kompostkiste', count: 1 },
        { type: 'inventory.give', item: 'kessel', count: 1 },
        { type: 'inventory.give', item: 'lagerfeuer', count: 1 },
        { type: 'inventory.give', item: 'regensammler', count: 1 },
        { type: 'inventory.give', item: 'kiste_holz', count: 1 },
        { type: 'inventory.give', item: 'fasern', count: 6 },
      ]);
      // The kitchen corner: the cauldron, the camp fire beside it, the rain collector on its other side; the cook stands south.
      const kessel = w.place('Kessel', site.tx, site.ty, (x, y) => ({ type: 'station.place', from: w.slotOf('kessel'), tx: x, ty: y }));
      const feuer = [
        [kessel.tx - 1, kessel.ty],
        [kessel.tx + 1, kessel.ty],
        [kessel.tx, kessel.ty - 1],
      ].find(([x, y]) => w.attempt([{ type: 'light.place', from: w.slotOf('lagerfeuer'), tx: x as number, ty: y as number }]));
      if (feuer === undefined) throw new Error('kein Platz für das Lagerfeuer am Kessel');
      const sammler = [
        [kessel.tx + 1, kessel.ty],
        [kessel.tx - 1, kessel.ty],
        [kessel.tx + 1, kessel.ty + 1],
        [kessel.tx - 1, kessel.ty + 1],
      ].find(([x, y]) => w.attempt([{ type: 'build.place', part: 'regensammler', tx: x as number, ty: y as number }]));
      if (sammler === undefined) throw new Error('kein Platz für den Regensammler am Kessel');
      const collector = { tx: sammler[0] as number, ty: sammler[1] as number };
      const fire = { tx: feuer[0] as number, ty: feuer[1] as number };
      const bedA = w.place('Beet', site.tx, site.ty + 3, (x, y) => ({ type: 'build.place', part: 'beet_holz', tx: x, ty: y }));
      const bedB = w.place('Beet', site.tx, site.ty + 3, (x, y) => ({ type: 'build.place', part: 'beet_holz', tx: x, ty: y }));
      const kompost = w.place('Kompostkiste', site.tx, site.ty - 3, (x, y) => ({ type: 'station.place', from: w.slotOf('kompostkiste'), tx: x, ty: y }));
      const kiste = w.place('Kiste', site.tx, site.ty - 3, (x, y) => ({ type: 'build.place', part: 'kiste_holz', tx: x, ty: y }));
      const kompostId = w.stations.stationAt(0, kompost.tx, kompost.ty)?.id ?? -1;
      const kesselId = w.stations.stationAt(0, kessel.tx, kessel.ty)?.id ?? -1;
      const chestId = w.storage.chestAt(0, kiste.tx, kiste.ty)?.id ?? -1;
      expect(kompostId).toBeGreaterThan(0);
      expect(kesselId).toBeGreaterThan(0);
      expect(chestId).toBeGreaterThan(0);
      for (const bed of [bedA, bedB]) {
        const e = w.use('säen', `saat_${CROP}`, bed.tx, bed.ty);
        expect(e.some(([t]) => t === 'cropPlanted')).toBe(true);
        expect(w.plotOf(bed.tx, bed.ty).crop).toBe(CROP);
      }
      // The can is filled at the river and waters both beds.
      w.teleport(river.tx - 1, river.ty);
      w.run('Gießkanne füllen', [{ type: 'player.useItem', slot: w.slotOf('giesskanne'), tx: river.tx, ty: river.ty }], 2);
      for (const bed of [bedA, bedB]) {
        w.use('gießen', 'giesskanne', bed.tx, bed.ty);
        expect(w.plotOf(bed.tx, bed.ty).moisture).toBe(BALANCE.farming.wetMoisture);
      }
      w.teleport(kompost.tx, kompost.ty + 1);
      w.run('Fasern in die Kompostkiste', [{ type: 'station.put', station: kompostId, from: w.slotOf('fasern'), bereich: 'eingang', count: 6 }]);
      w.stunde();
      expect(w.stations.station(kompostId)?.proc?.rezept).toBe('rezept_kompost');
      // Rain over the farm (the forced weather begins at the next world tick), then on to the next morning.
      w.run('Regen', [{ type: 'setWeather', state: 'regen', tx: collector.tx, ty: collector.ty }], 2 * sim.clock.worldTickInterval);
      w.springe(2, 7);

      // ---- Tag 2 – Regen im Sammler, die Erbsen wachsen.
      const rain = w.water.collectorAt(0, collector.tx, collector.ty)?.fill ?? 0;
      expect(rain).toBeGreaterThan(BALANCE.water.collector.minutesPerSip);
      for (const bed of [bedA, bedB]) expect(w.plotOf(bed.tx, bed.ty).stage).toBe(1);
      w.stunde();
      w.springe(3, 9);

      // ---- Tag 3 – Kompost auf Beet A, noch einmal gießen.
      w.teleport(kompost.tx, kompost.ty + 1);
      w.run('Kompost holen', [{ type: 'station.takeAll', station: kompostId }]);
      expect(w.count('kompost')).toBe(2);
      const fertility = w.plotOf(bedA.tx, bedA.ty).fertility;
      w.use('düngen', 'kompost', bedA.tx, bedA.ty);
      expect(w.plotOf(bedA.tx, bedA.ty).fertility).toBeGreaterThan(fertility);
      w.teleport(river.tx - 1, river.ty);
      w.run('Gießkanne füllen', [{ type: 'player.useItem', slot: w.slotOf('giesskanne'), tx: river.tx, ty: river.ty }], 2);
      for (const bed of [bedA, bedB]) w.use('gießen', 'giesskanne', bed.tx, bed.ty);
      w.stunde();
      w.springe(5, 7);

      // ---- Tag 5 – Ernte, Feuer, Erbsensuppe mit Regenwasser, in die Kiste.
      const ripe = CONTENT.collection('crops').get(CROP).stufen - 1;
      for (const bed of [bedA, bedB]) {
        expect(w.plotOf(bed.tx, bed.ty).stage).toBe(ripe);
        w.teleport(bed.tx, bed.ty + 1);
        w.until('ernten', [{ type: 'farm.harvest', tx: bed.tx, ty: bed.ty }], ([t]) => t === 'cropHarvested');
        w.run('aufsammeln', [], SETTLE_TICKS * 2);
      }
      expect(w.count(CROP)).toBeGreaterThanOrEqual(3);
      const lightId = w.light.lightAt(0, fire.tx, fire.ty)?.id ?? -1;
      w.teleport(kessel.tx, kessel.ty + 1);
      w.run('Holz und Zwiebel', [
        { type: 'inventory.give', item: 'holz', count: 6 },
        { type: 'inventory.give', item: 'zwiebel', count: 1 },
      ]);
      w.run('Feuer', [{ type: 'light.fuel', light: lightId, from: w.slotOf('holz'), count: 6 }, { type: 'light.ignite', tx: fire.tx, ty: fire.ty }]);
      w.run('Rezepte', [{ type: 'debug.unlock' }]);
      const before = w.water.collectorAt(0, collector.tx, collector.ty)?.fill ?? 0;
      const cooked = w.until('Erbsensuppe', [{ type: 'craft.start', recipe: 'rezept_erbsensuppe', count: 1 }], ([t]) => t === 'craftCompleted');
      expect(cooked.some(([t]) => t === 'craftStarted')).toBe(true);
      // No open water within reach: the soup's water is one sip of the rain collector.
      expect(w.water.collectorAt(0, collector.tx, collector.ty)?.fill).toBe(before - BALANCE.water.collector.minutesPerSip);
      expect(w.count('erbsensuppe')).toBe(1);
      w.teleport(kiste.tx, kiste.ty + 1);
      w.run('Suppe in die Kiste', [{ type: 'storage.put', chest: chestId, from: w.slotOf('erbsensuppe'), count: 1 }]);
      const cookedHour = Math.floor(sim.tick / sim.clock.ticksPerGameHour);
      w.stunde();
      w.springe(7, 9);

      // ---- Tag 7 – die Suppe ist verdorben (zwei Tage Haltbarkeit: so viele Stunden, wie der Verlust je Stunde vorgibt).
      const soupDays = CONTENT.collection('items').get('erbsensuppe').frische ?? 0;
      expect(soupDays).toBe(BALANCE.meals.shelfLifeDays.suppe);
      const hoursToRot = Math.ceil(100 / lossPerHour(soupDays, 1));
      expect(Math.floor(sim.tick / sim.clock.ticksPerGameHour) - cookedHour).toBeGreaterThanOrEqual(hoursToRot);
      const chest = w.storage.chest(chestId);
      expect(chest?.slots.filter((s) => s !== null).map((s) => s?.item)).toEqual(['verdorbenes']);
      w.teleport(kiste.tx, kiste.ty + 1);
      w.run('Verdorbenes holen', [{ type: 'storage.takeAll', chest: chestId }]);
      w.run('Fasern', [{ type: 'inventory.give', item: 'fasern', count: 5 }]);
      w.teleport(kompost.tx, kompost.ty + 1);
      w.run('Verdorbenes in die Kompostkiste', [
        { type: 'station.put', station: kompostId, from: w.slotOf('verdorbenes'), bereich: 'eingang', count: 1 },
        { type: 'station.put', station: kompostId, from: w.slotOf('fasern'), bereich: 'eingang', count: 5 },
      ]);
      w.stunde();
      expect(w.stations.station(kompostId)?.proc?.rezept).toBe('rezept_kompost');
      expect(sim.clock.day).toBe(7);

      // Both ways time passed: the active hours and the jumps between them.
      expect(w.aktiv).toBeGreaterThan(5 * sim.clock.ticksPerGameHour);
      expect(w.gesprungen).toBeGreaterThan(5 * sim.clock.ticksPerDay);
      expect(performance.now() - t0).toBeLessThan(BUDGET_MS);
    },
    BUDGET_MS * 2,
  );
});
