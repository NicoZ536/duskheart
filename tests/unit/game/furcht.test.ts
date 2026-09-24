/**
 * M3-23: fear (MASTERPROMPT §12.3) – every rate and threshold: dark +1,0/s at night and +0,5/s in caves,
 * corruption +0,5/s, sighting +10, raw or spoiled food +5, a settler's death +20; bright −0,5/s, fire −1/s,
 * cosy room up to −1,5/s, sleep −5 per game hour, comfort food −10 … −25, music −2/s, companion −0,2/s;
 * stages 20 (eye), 40 (whispers), 60 (hallucinations, desaturation), 80 (hallucinations hurt), 100
 * (Nachtmahr until glaring light).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import {
  clampFear,
  comfortFoodCalm,
  createFearSurroundings,
  desaturation,
  fearDecayPerSecond,
  fearRatePerSecond,
  fearRisePerSecond,
  fearStage,
  fearStageEffects,
  frightAmount,
  hallucinationIntervalSeconds,
  lightStage,
  roomDecayPerSecond,
  type FearSurroundings,
} from '../../../src/game/fear/formulas';
import { baseItem, defineItemGroup, ITEM_SFX } from '../../../src/content/items/define';
import { ITEMS } from '../../../src/content/items/index';
import { ItemCatalog } from '../../../src/game/items/catalog';
import { lifeWorld, type LifeWorld } from './leben-testwelt';
import { meadow } from './spieler-testwelt';

const TICK = BALANCE.time.tickHz;

/** A cooked dish (dishes come with cooking, M4; the comfort rule already applies). */
const EINTOPF = defineItemGroup('furcht_proben', [
  baseItem({
    id: 'probe_eintopf',
    name: { de: 'Eintopf', en: 'Stew' },
    beschreibung: { de: 'Testgegenstand.', en: 'Test item.' },
    kategorie: 'gericht',
    frische: 5,
    essbar: { saettigung: 30, durst: 5 },
    tauschwert: 1,
    sounds: { aufheben: ITEM_SFX.frucht },
  }),
]);
/** Simulated seconds per game hour at the default day length (24 real minutes per day). */
const HOUR_S = 60;

function s(patch: Partial<FearSurroundings>): FearSurroundings {
  return { ...createFearSurroundings(), ...patch };
}

function world(): LifeWorld {
  const w = lifeWorld(meadow(24, 24));
  w.spawn(12, 12);
  return w;
}

describe('Furcht-Raten (reine Funktionen)', () => {
  it('rise: dark at night +1,0/s on the surface, +0,5/s underground, corruption +0,5/s; not while asleep', () => {
    expect(fearRisePerSecond(s({ light: 0.1, night: true }))).toBe(1);
    expect(fearRisePerSecond(s({ light: 0.1, night: false }))).toBe(0);
    expect(fearRisePerSecond(s({ light: 0.1, underground: true }))).toBe(0.5);
    expect(fearRisePerSecond(s({ light: 0.15, night: true }))).toBe(0);
    expect(fearRisePerSecond(s({ light: 1, corruption: true }))).toBe(0.5);
    expect(fearRisePerSecond(s({ light: 0.05, night: true, corruption: true }))).toBe(1.5);
    expect(fearRisePerSecond(s({ light: 0, night: true, sleeping: true }))).toBe(0);
  });

  it('decay: the strongest place (bright 0,5 · fire 1 · room up to 1,5) plus music 2, companion 0,2, sleep 5 per game hour', () => {
    expect(fearDecayPerSecond(s({ light: 0.4 }), HOUR_S)).toBe(0.5);
    expect(fearDecayPerSecond(s({ light: 0.39 }), HOUR_S)).toBe(0);
    expect(fearDecayPerSecond(s({ light: 0.9, atFire: true }), HOUR_S)).toBe(1);
    expect(roomDecayPerSecond(20)).toBe(1.5);
    expect(roomDecayPerSecond(10)).toBe(0.75);
    expect(roomDecayPerSecond(40)).toBe(1.5);
    expect(roomDecayPerSecond(-3)).toBe(0);
    expect(fearDecayPerSecond(s({ light: 0.5, atFire: true, roomComfort: 20 }), HOUR_S)).toBe(1.5);
    expect(fearDecayPerSecond(s({ light: 0, music: true }), HOUR_S)).toBe(2);
    expect(fearDecayPerSecond(s({ light: 0, companion: true }), HOUR_S)).toBeCloseTo(0.2, 12);
    expect(fearDecayPerSecond(s({ light: 0, sleeping: true }), HOUR_S) * HOUR_S).toBeCloseTo(5, 12);
  });

  it('net rate: rise × (1 − resistance) − decay + the conditions’ rate; frights lowered by resistance; comfort food 10–25', () => {
    expect(fearRatePerSecond(s({ light: 0, night: true }), 0.25, 0, HOUR_S)).toBe(0.75);
    expect(fearRatePerSecond(s({ light: 1 }), 0, -1, HOUR_S)).toBe(-1.5);
    expect(frightAmount(BALANCE.fear.rise.sighting, 0)).toBe(10);
    expect(frightAmount(BALANCE.fear.rise.settlerDeath, 0.5)).toBe(10);
    expect(BALANCE.fear.rise.badFood).toBe(5);
    expect([comfortFoodCalm(5), comfortFoodCalm(18), comfortFoodCalm(40)]).toEqual([10, 18, 25]);
    expect([clampFear(-3), clampFear(42), clampFear(130)]).toEqual([0, 42, 100]);
  });

  it('stages at 20, 40, 60, 80 and 100 with their effects; light stages of §12.1', () => {
    expect([19.9, 20, 39.9, 40, 59.9, 60, 79.9, 80, 99.9, 100].map(fearStage)).toEqual(['ruhig', 'unruhig', 'unruhig', 'fluestern', 'fluestern', 'trugbilder', 'trugbilder', 'bedrohlich', 'bedrohlich', 'nachtmahr']);
    expect(fearStageEffects('ruhig')).toEqual({ eye: false, whispers: false, hallucinations: false, harmful: false });
    expect(fearStageEffects('unruhig')).toEqual({ eye: true, whispers: false, hallucinations: false, harmful: false });
    expect(fearStageEffects('fluestern')).toEqual({ eye: true, whispers: true, hallucinations: false, harmful: false });
    expect(fearStageEffects('trugbilder')).toEqual({ eye: true, whispers: true, hallucinations: true, harmful: false });
    expect(fearStageEffects('bedrohlich').harmful).toBe(true);
    expect(fearStageEffects('nachtmahr').harmful).toBe(true);
    expect(hallucinationIntervalSeconds('fluestern')).toBeNull();
    expect(hallucinationIntervalSeconds('trugbilder')).toBe(10);
    expect(hallucinationIntervalSeconds('bedrohlich')).toBe(6);
    expect([desaturation(60), desaturation(80), desaturation(100)]).toEqual([0, 0.5, 1]);
    expect([0.1, 0.15, 0.39, 0.4, 0.9, 0.91].map(lightStage)).toEqual(['dunkel', 'daemmrig', 'daemmrig', 'hell', 'hell', 'gleissend']);
  });
});

describe('Furchtsystem', () => {
  it('in the dark at night fear rises 1 per second; in daylight it falls 0,5 per second', () => {
    const w = world();
    w.env.light = 0.05;
    w.env.night = true;
    w.run(10 * TICK);
    expect(w.life.fear.state.value).toBeCloseTo(10, 6);
    w.env.light = 1;
    w.env.night = false;
    w.run(4 * TICK);
    expect(w.life.fear.state.value).toBeCloseTo(8, 6);
  });

  it('at a fire fear falls 1 per second, in caves the dark rises it 0,5 per second', () => {
    const w = world();
    w.env.light = 0.2;
    w.fire(13, 12);
    w.run(1, [{ type: 'fear.set', value: 50 }]);
    const v0 = w.life.fear.state.value;
    w.run(5 * TICK);
    expect(v0 - w.life.fear.state.value).toBeCloseTo(5, 6);
    const cave = world();
    cave.env.light = 0;
    cave.run(1, [{ type: 'player.teleport', x: cave.pos().x, y: cave.pos().y, layer: -1 }]);
    cave.run(4 * TICK);
    expect(cave.life.fear.state.value).toBeCloseTo(2 + 0.5 / TICK, 6);
  });

  it('surroundings providers: corruption rises, a cosy room, music and a companion calm', () => {
    const w = world();
    w.env.light = 0.2;
    let room = 0;
    w.life.fear.addSurroundings((_sim, _e, out) => {
      out.corruption = true;
      out.roomComfort = room;
      out.companion = true;
    });
    w.run(1, [{ type: 'fear.set', value: 50 }]);
    const v0 = w.life.fear.state.value;
    w.run(TICK);
    expect(w.life.fear.state.value - v0).toBeCloseTo(0.5 - 0.2, 6);
    room = 20;
    const v1 = w.life.fear.state.value;
    w.run(TICK);
    expect(w.life.fear.state.value - v1).toBeCloseTo(0.5 - 1.5 - 0.2, 6);
  });

  it('asleep in the dark fear falls 5 per game hour', () => {
    const w = world();
    w.bed(13, 12, 'bett');
    w.jumpToHour(20);
    w.env.light = 0;
    w.env.night = true;
    w.run(1, [{ type: 'fear.set', value: 30 }]);
    w.run(1, [{ type: 'sleep.start', ...w.tile(13, 12) }]);
    const hour = w.sim.clock.ticksPerGameHour;
    const v0 = w.life.fear.state.value;
    w.run(hour);
    expect(v0 - w.life.fear.state.value).toBeCloseTo(5, 6);
  });

  it('frights and comfort: sighting +10, raw food +5, a settler’s death +20, comfort food −10 … −25; stage events', () => {
    const w = world();
    const first = w.run(1);
    expect(first.get('fearStageChanged')).toBeUndefined();
    w.life.fear.spike(w.sim, BALANCE.fear.rise.sighting, 'sichtung');
    w.life.fear.spike(w.sim, BALANCE.fear.rise.settlerDeath, 'siedlertod');
    const ev = w.run(1);
    // Spiked outside a tick; the tick in daylight then calms by 0,5/s for 1/60 s.
    expect(w.life.fear.state.value).toBeCloseTo(30 - 0.5 / TICK, 9);
    expect(ev.get('fearChanged')).toEqual([expect.objectContaining({ amount: 10, reason: 'sichtung' }), expect.objectContaining({ amount: 20, reason: 'siedlertod' })]);
    expect(ev.get('fearStageChanged')).toEqual([expect.objectContaining({ stage: 'unruhig', previous: 'ruhig' })]);
    w.life.fear.soothe(w.sim, comfortFoodCalm(40), 'wohlfuehlessen');
    expect(w.life.fear.state.value).toBeCloseTo(5 - 0.5 / TICK, 9);
    w.run(1, [{ type: 'inventory.give', item: 'himbeeren', count: 1 }]);
    const eaten = w.run(2 * TICK, [{ type: 'action.eat', from: { bereich: 'inventar', index: 0 } }]);
    expect(eaten.get('fearChanged')).toEqual([expect.objectContaining({ amount: 5, reason: 'nahrung' })]);
  });

  it('a cooked dish comforts (−10), raw food frightens (+5)', () => {
    const w = lifeWorld(meadow(24, 24), 1, new ItemCatalog([...ITEMS, ...EINTOPF]));
    w.spawn(12, 12);
    w.env.light = 0.2;
    w.run(1, [{ type: 'fear.set', value: 50 }]);
    w.run(1, [{ type: 'inventory.give', item: 'probe_eintopf', count: 1 }]);
    const ev = w.run(3 * TICK, [{ type: 'action.eat', from: { bereich: 'inventar', index: 0 } }]);
    expect(ev.get('fearChanged')).toEqual([expect.objectContaining({ amount: -10, reason: 'wohlfuehlessen' })]);
  });

  it('from 60 hallucinations creep out of the dark and dissolve in light; below 60 they vanish', () => {
    const w = world();
    w.env.light = 0.1;
    w.env.night = true;
    w.run(1, [{ type: 'fear.set', value: 65 }]);
    const appeared: Array<{ harmful: boolean; x: number; y: number }> = [];
    for (let i = 0; i < 20 * TICK && w.life.fear.state.hallucinations.length === 0; i++) appeared.push(...((w.run(1).get('hallucinationAppeared') ?? []) as typeof appeared));
    expect(appeared.length).toBe(1);
    expect(appeared[0]?.harmful).toBe(false);
    const p = w.pos();
    const d = Math.hypot((appeared[0]?.x ?? 0) - p.x, (appeared[0]?.y ?? 0) - p.y) / 16;
    expect(d).toBeGreaterThanOrEqual(BALANCE.fear.hallucinations.spawnMinTiles - 1e-9);
    expect(d).toBeLessThanOrEqual(BALANCE.fear.hallucinations.spawnMaxTiles + 1e-9);
    const before = w.life.fear.state.hallucinations.length;
    expect(before).toBeGreaterThan(0);
    w.env.light = 0.5;
    const gone = w.run(1).get('hallucinationVanished') as Array<{ reason: string }>;
    expect(gone.map((g) => g.reason)).toEqual(Array.from({ length: before }, () => 'licht'));
    expect(w.life.fear.state.hallucinations).toEqual([]);
    w.env.light = 0.1;
    w.run(1, [{ type: 'fear.set', value: 65 }]);
    w.run(12 * TICK);
    w.run(1, [{ type: 'fear.set', value: 30 }]);
    expect(w.life.fear.state.hallucinations).toEqual([]);
  });

  it('from 80 hallucinations that reach the player hurt: 5 HP, a hit that stops eating', () => {
    const w = world();
    w.env.light = 0.1;
    w.env.night = true;
    w.run(1, [{ type: 'fear.set', value: 85 }]);
    const ev = w.run(40 * TICK);
    const hits = (ev.get('playerAfflicted') ?? []) as Array<{ source: string; amount: number }>;
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((x) => x.source === 'trugbild' && x.amount === BALANCE.fear.hallucinations.damage)).toBe(true);
    expect((ev.get('hallucinationVanished') as Array<{ reason: string }>).some((x) => x.reason === 'angriff')).toBe(true);
  });

  it('a struck hallucination dissolves', () => {
    const w = world();
    w.env.light = 0.1;
    w.run(1, [{ type: 'fear.set', value: 70 }]);
    for (let i = 0; i < 20 * TICK && w.life.fear.state.hallucinations.length === 0; i++) w.run(1);
    const h = w.life.fear.state.hallucinations[0];
    expect(h).toBeDefined();
    if (h === undefined) return;
    expect(w.life.fear.strikeHallucination(w.sim, h.id)).toBe(true);
    expect(w.life.fear.strikeHallucination(w.sim, h.id)).toBe(false);
  });

  it('at 100 the Nachtmahr hunts until glaring light; it forbids sleep; death ends it', () => {
    const w = world();
    const called: number[] = [];
    w.life.fear.onNightmare((_sim, e) => called.push(e));
    w.env.light = 0.1;
    const ev = w.run(1, [{ type: 'fear.set', value: 100 }]);
    expect(ev.get('nightmareSummoned')).toEqual([expect.objectContaining({ entity: w.sim.player })]);
    expect(called).toEqual([w.sim.player]);
    expect(w.life.fear.pursued).toBe(true);
    w.bed(13, 12, 'bett');
    w.jumpToHour(21);
    const refused = w.run(1, [{ type: 'sleep.start', ...w.tile(13, 12) }]);
    expect(refused.get('commandRejected')).toEqual([expect.objectContaining({ reason: 'enemiesNear' })]);
    w.env.light = 0.9;
    expect(w.run(TICK).get('nightmareEnded')).toBeUndefined();
    w.env.light = 0.95;
    expect(w.run(1).get('nightmareEnded')).toEqual([expect.objectContaining({ reason: 'licht' })]);
    w.env.light = 0;
    w.env.night = true;
    w.run(1, [{ type: 'fear.set', value: 100 }]);
    const died = w.run(1, [{ type: 'death.kill' }]);
    expect(died.get('nightmareEnded')).toEqual([expect.objectContaining({ reason: 'tod' })]);
    expect(w.life.fear.state.value).toBe(0);
  });
});

describe('Determinismus', () => {
  /** A dark night with high fear, a meal, a bleeding wound and a bed: every life system has state. */
  function busy(w: LifeWorld): void {
    w.env.light = 0.05;
    w.env.night = true;
    w.run(1, [{ type: 'fear.set', value: 85 }, { type: 'conditions.apply', id: 'blutung' }]);
    w.run(1, [{ type: 'inventory.give', item: 'apfel', count: 5 }]);
    w.run(1, [{ type: 'action.eat', from: { bereich: 'inventar', index: 0 } }]);
    w.run(4 * TICK);
  }

  it('same seed and commands give the same state; save → load → continue gives the same hash as running on', () => {
    const a = world();
    const b = world();
    busy(a);
    busy(b);
    expect(a.sim.hashState()).toBe(b.sim.hashState());
    const snapshot = a.sim.snapshot();
    const c = lifeWorld(meadow(24, 24));
    // The surroundings are the world's, not saved state: the loaded world has the same night.
    c.env.light = a.env.light;
    c.env.night = a.env.night;
    for (const p of c.sim.participants()) {
      const saved = snapshot.participants[p.id];
      if (saved === undefined) throw new Error(`participant ${p.id} missing`);
      p.deserialize(JSON.parse(JSON.stringify(saved.data)) as unknown);
    }
    expect(c.sim.hashState()).toBe(a.sim.hashState());
    a.run(6 * TICK);
    c.run(6 * TICK);
    expect(c.sim.hashState()).toBe(a.sim.hashState());
    expect(c.life.fear.state).toEqual(a.life.fear.state);
  });
});
