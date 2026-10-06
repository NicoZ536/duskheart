/**
 * M7-51 Schwierigkeit und Welteinstellungen (MASTERPROMPT §29, docs/SPIEL.md §25, §17 „Haken“): die vier Voreinstellungen
 * mit ihren Faktoren und Todesstrafen, die Überschreibungen einer Welt (Hunger/Durst, Gegnerschaden, Schattenflut-Intervall,
 * Logistik-Realismus, Jahreszeitenlänge), „jederzeit änderbar außer Unbarmherzig“, die Spawnsperre einer friedlichen Welt
 * und die Leser der Faktoren: der Hunger- und Durstabbau der Vitalwerte, die Schläge der Kreaturen. Alles kommt als Befehl
 * herein (`world.setDifficulty`, `world.setSettings`); die Schwierigkeit bleibt im Teilnehmer `death`.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { DIFFICULTIES, type Difficulty } from '../../../src/content/balance/death';
import { CREATURE_FAMILIES } from '../../../src/content/creatures/schema';
import { parseGameCommand, type GameCommand } from '../../../src/game/commands';
import { penaltyOf } from '../../../src/game/death/formulas';
import { Simulation } from '../../../src/game/sim';
import { VitalsSystem } from '../../../src/game/survival/system';
import { RESOURCE_DENSITIES } from '../../../src/game/worldsettings/types';
import { defaultWorldSettings, resolveFactors, type MutableDifficultyFactors } from '../../../src/game/worldsettings/formulas';
import { WorldSettingsSystem } from '../../../src/game/worldsettings/system';
import { DEPOSIT_DENSITIES, RESOURCES } from '../../../src/world/gen/resources';
import { Calendar } from '../../../src/world/calendar';
import { eventsOf } from './kampf-testwelt';
import { kreaturWelt, meadow, type KreaturWelt } from './kreatur-testwelt';
import { lifeWorld, type LifeWorld } from './leben-testwelt';
import { createSimulation } from '../../../src/game/setup';
import { EMPTY_WELT_FACTS, playWelt, weltFacts, weltFactsSchema } from '../../../tools/save/fixtureM7/welt';

type Changed = { schwierigkeit: Difficulty; feld: string; tick: number };
type Rejected = { type: string; reason: string };

/** A simulation with only the world settings and a stand-in for the difficulty kept by death (pure command tests). */
function settingsSim(start: Difficulty = 'normal'): { sim: Simulation; ws: WorldSettingsSystem; calendar: Calendar; held: { difficulty: Difficulty }; run(cmds: GameCommand[]): Map<string, unknown[]> } {
  const sim = new Simulation({ seed: 7, worldSize: 'small' });
  const calendar = new Calendar(sim.clock);
  const ws = sim.addSystem(new WorldSettingsSystem({ calendar }));
  const held = {
    difficulty: start,
    setDifficulty(d: Difficulty): boolean {
      if (held.difficulty === 'unbarmherzig' || d === held.difficulty) return false;
      held.difficulty = d;
      return true;
    },
  };
  ws.useDeath(held);
  return {
    sim,
    ws,
    calendar,
    held,
    run(cmds) {
      const events = new Map<string, unknown[]>();
      sim.step(cmds);
      sim.events.drain((type, payload) => {
        const list = events.get(type) ?? [];
        list.push(payload);
        events.set(type, list);
      });
      return events;
    },
  };
}

function factorsOf(d: Difficulty, settings = defaultWorldSettings()): MutableDifficultyFactors {
  return { ...resolveFactors(d, settings, { hungerThirst: 0, enemyDamage: 0, shadowFloodNights: 0 }) };
}

describe('Voreinstellungen (§29)', () => {
  it('Faktoren je Stufe wie die Tabelle: Hunger/Durst, Gegnerschaden, Schattenflut', () => {
    expect(factorsOf('entspannt')).toEqual({ hungerThirst: 0.6, enemyDamage: 0.6, shadowFloodNights: null });
    expect(factorsOf('normal')).toEqual({ hungerThirst: 1, enemyDamage: 1, shadowFloodNights: 7 });
    expect(factorsOf('hart')).toEqual({ hungerThirst: 1.25, enemyDamage: 1.3, shadowFloodNights: 5 });
    expect(factorsOf('unbarmherzig')).toEqual({ hungerThirst: 1.25, enemyDamage: 1.5, shadowFloodNights: 5 });
  });

  it('Todesstrafen je Stufe: Inventar bleibt · Inventar im Grab −25 % · alles im Grab · Permadeath', () => {
    expect(DIFFICULTIES.map((d) => penaltyOf(d))).toEqual([
      { grave: 'nichts', skillLoss: 0, permadeath: false },
      { grave: 'inventar', skillLoss: 0.25, permadeath: false },
      { grave: 'alles', skillLoss: 0.25, permadeath: false },
      { grave: 'alles', skillLoss: 0.25, permadeath: true },
    ]);
  });

  it('Überschreibungen der Welt gelten vor der Voreinstellung; „voreinstellung“ und „aus“ beim Schattenflut-Intervall', () => {
    const s = { ...defaultWorldSettings(), hungerThirst: 0.5, enemyDamage: 2, shadowFloodNights: 9 };
    for (const d of DIFFICULTIES) expect(factorsOf(d, s)).toEqual({ hungerThirst: 0.5, enemyDamage: 2, shadowFloodNights: 9 });
    expect(factorsOf('hart', { ...defaultWorldSettings(), shadowFloodNights: null }).shadowFloodNights).toBeNull();
    expect(factorsOf('entspannt', { ...defaultWorldSettings(), shadowFloodNights: 4 }).shadowFloodNights).toBe(4);
  });

  it('die Ressourcendichte hat dieselben Ids in Welteinstellungen und Weltgenerator; Normal ändert keine Zahl', () => {
    expect([...RESOURCE_DENSITIES]).toEqual([...DEPOSIT_DENSITIES]);
    expect(RESOURCES.densityFactor.normal).toBe(1);
    expect(RESOURCES.densityFactor.gering).toBeLessThan(1);
    expect(RESOURCES.densityFactor.reich).toBeGreaterThan(1);
  });
});

describe('Befehle world.setDifficulty / world.setSettings', () => {
  it('die Schwierigkeit bleibt in death; jede Änderung meldet worldSettingsChanged; die Faktoren folgen', () => {
    const t = settingsSim();
    const factors = t.ws.factors();
    expect(factors.enemyDamage).toBe(1);
    const ev = t.run([{ type: 'world.setDifficulty', schwierigkeit: 'hart' }]);
    expect(t.held.difficulty).toBe('hart');
    expect(eventsOf<Changed>(ev, 'worldSettingsChanged').map((e) => [e.schwierigkeit, e.feld])).toEqual([['hart', 'schwierigkeit']]);
    // The held record is recomputed in place: reading it every tick allocates nothing.
    expect(t.ws.factors()).toBe(factors);
    expect(factors).toEqual({ hungerThirst: 1.25, enemyDamage: 1.3, shadowFloodNights: 5 });
    // The same difficulty again changes nothing.
    expect(eventsOf(t.run([{ type: 'world.setDifficulty', schwierigkeit: 'hart' }]), 'worldSettingsChanged')).toEqual([]);
  });

  it('world.setSettings ändert nur die genannten Felder, je Feld ein Ereignis; null nimmt die Voreinstellung zurück', () => {
    const t = settingsSim('entspannt');
    const ev = t.run([{ type: 'world.setSettings', friedlich: true, hungerDurst: 1.5, gegnerschaden: 0.25, schattenflut: 3, logistikRealismus: true, jahreszeitenLaenge: 10 }]);
    expect(eventsOf<Changed>(ev, 'worldSettingsChanged').map((e) => e.feld)).toEqual(['friedlich', 'hungerDurst', 'gegnerschaden', 'schattenflut', 'logistikRealismus', 'jahreszeitenLaenge']);
    expect(t.ws.state).toEqual({ peaceful: true, hungerThirst: 1.5, enemyDamage: 0.25, shadowFloodNights: 3, logisticsRealism: true });
    expect(t.ws.peaceful()).toBe(true);
    expect(t.ws.logisticsRealism()).toBe(true);
    expect(t.calendar.seasonLengthDays).toBe(10);
    expect({ ...t.ws.factors() }).toEqual({ hungerThirst: 1.5, enemyDamage: 0.25, shadowFloodNights: 3 });
    const back = t.run([{ type: 'world.setSettings', hungerDurst: null, schattenflut: 'voreinstellung' }]);
    expect(eventsOf<Changed>(back, 'worldSettingsChanged').map((e) => e.feld)).toEqual(['hungerDurst', 'schattenflut']);
    expect({ ...t.ws.factors() }).toEqual({ hungerThirst: 0.6, enemyDamage: 0.25, shadowFloodNights: null });
    expect(eventsOf(t.run([{ type: 'world.setSettings', friedlich: true }]), 'worldSettingsChanged')).toEqual([]);
  });

  it('Unbarmherzig sperrt Schwierigkeit und alles, was die Welt milder macht; nur die Jahreszeitenlänge bleibt änderbar', () => {
    const t = settingsSim();
    t.run([{ type: 'world.setDifficulty', schwierigkeit: 'unbarmherzig' }]);
    const down = t.run([{ type: 'world.setDifficulty', schwierigkeit: 'entspannt' }]);
    expect(eventsOf<Rejected>(down, 'commandRejected').map((r) => r.reason)).toEqual(['difficultyLocked']);
    expect(t.held.difficulty).toBe('unbarmherzig');
    const soften = t.run([{ type: 'world.setSettings', friedlich: true, jahreszeitenLaenge: 5 }]);
    expect(eventsOf<Rejected>(soften, 'commandRejected').map((r) => r.reason)).toEqual(['difficultyLocked']);
    // Refused whole: not even the season length of that command.
    expect(t.ws.state).toEqual(defaultWorldSettings());
    expect(t.calendar.seasonLengthDays).toBe(BALANCE.calendar.defaultSeasonLengthDays);
    const season = t.run([{ type: 'world.setSettings', jahreszeitenLaenge: 5 }]);
    expect(eventsOf<Changed>(season, 'worldSettingsChanged').map((e) => [e.schwierigkeit, e.feld])).toEqual([['unbarmherzig', 'jahreszeitenLaenge']]);
    expect(t.calendar.seasonLengthDays).toBe(5);
  });

  it('die Befehle prüfen ihre Werte: Regler-Schritte, Bereiche, Jahreszeitenlänge 3–14', () => {
    expect(() => parseGameCommand({ type: 'world.setSettings', hungerDurst: 0.55 })).not.toThrow();
    expect(() => parseGameCommand({ type: 'world.setSettings', hungerDurst: 0.33 })).toThrow(TypeError);
    expect(() => parseGameCommand({ type: 'world.setSettings', gegnerschaden: 2.5 })).toThrow(TypeError);
    expect(() => parseGameCommand({ type: 'world.setSettings', schattenflut: 2 })).toThrow(TypeError);
    expect(() => parseGameCommand({ type: 'world.setSettings', jahreszeitenLaenge: 2 })).toThrow(TypeError);
    expect(() => parseGameCommand({ type: 'world.setSettings', jahreszeitenLaenge: 15 })).toThrow(TypeError);
    expect(() => parseGameCommand({ type: 'world.setDifficulty', schwierigkeit: 'leicht' })).toThrow(TypeError);
    expect(() => parseGameCommand({ type: 'world.setSettings', laune: 1 })).toThrow(TypeError);
  });
});

describe('Leser der Faktoren', () => {
  /** Satiety and thirst a player loses in `ticks` under vitals with the world settings at `difficulty` (or none). */
  function drain(difficulty: Difficulty | null, ticks = 600): { satiety: number; thirst: number } {
    const w: LifeWorld = lifeWorld(meadow(6, 6));
    w.spawn(3, 3);
    const ws = new WorldSettingsSystem();
    ws.useDeath(w.life.death);
    if (difficulty !== null) w.life.death.setDifficulty(difficulty);
    // A second vitals system on the same components: only it runs (the test world is not stepped).
    const vitals = new VitalsSystem({ components: w.components, influences: w.influences, motion: w.motion, environment: w.env, cheats: w.cheats, ...(difficulty === null ? {} : { worldSettings: ws }) });
    const v = w.vit();
    v.satiety = 80;
    v.thirst = 80;
    for (let i = 0; i < ticks; i++) vitals.update(w.sim, w.sim.dt);
    return { satiety: 80 - v.satiety, thirst: 80 - v.thirst };
  }

  it('Hunger und Durst sinken mit dem Faktor der Stufe; Normal genau wie ohne Welteinstellungen', () => {
    const none = drain(null);
    expect(none.satiety).toBeGreaterThan(0);
    expect(none.thirst).toBeGreaterThan(0);
    expect(drain('normal')).toEqual(none);
    for (const d of ['entspannt', 'hart'] as const) {
      const got = drain(d);
      const f = BALANCE.difficulty.presets[d].hungerThirst;
      expect(got.satiety).toBeCloseTo(none.satiety * f, 9);
      expect(got.thirst).toBeCloseTo(none.thirst * f, 9);
    }
  });

  /** The wolf's first bite on the player in a creature world bound to world settings `ws` (after `setup` commands). */
  function bite(setup: GameCommand[]): number {
    const w: KreaturWelt = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    const ws = w.sim.addSystem(new WorldSettingsSystem());
    ws.useDeath(w.life.death);
    w.creatures.useWorldSettings(ws);
    w.creatures.addSpawnBlocker(ws.spawnBlocker);
    w.run(1, setup);
    w.creature('probe_wolf', 20, 12);
    for (let i = 0; i < 600; i++) {
      const hit = eventsOf<{ target: number; amount: number; crit?: boolean }>(w.run(1), 'hitLanded').find((h) => h.target === w.sim.player);
      if (hit !== undefined) return hit.amount;
    }
    throw new Error('the wolf never bit');
  }

  it('Kreaturenschläge mit dem Gegnerschaden der Welt: Voreinstellung oder Überschreibung', () => {
    const crit = BALANCE.combat.damage.critFactor;
    const base = 6;
    const near = (amount: number, factor: number): boolean => [base * factor, base * factor * crit].some((v) => Math.abs(v - amount) < 1e-9);
    expect(near(bite([]), 1)).toBe(true);
    expect(near(bite([{ type: 'world.setDifficulty', schwierigkeit: 'hart' }]), 1.3)).toBe(true);
    expect(near(bite([{ type: 'world.setSettings', gegnerschaden: 0.5 }]), 0.5)).toBe(true);
  });

  it('Friedlich: die Spawnsperre hält Gegner, Schattenbrut und Elites fern, Tiere nie', () => {
    const t = settingsSim();
    const sim = t.sim;
    for (const f of CREATURE_FAMILIES) expect(t.ws.spawnBlocker(sim, 0, 0, 0, f), f).toBe(false);
    t.run([{ type: 'world.setSettings', friedlich: true }]);
    expect(CREATURE_FAMILIES.filter((f) => t.ws.spawnBlocker(sim, 0, 0, 0, f))).toEqual(['gegner', 'schattenbrut', 'elite']);
  });

  it('Friedlich in der Kreaturenwelt: keine Schattenbrut in der Nacht', () => {
    const night = (peaceful: boolean): number => {
      const w = kreaturWelt(meadow(60, 40), { x: 30, y: 20 });
      w.cheats.god = true;
      const ws = w.sim.addSystem(new WorldSettingsSystem());
      ws.useDeath(w.life.death);
      w.creatures.addSpawnBlocker(ws.spawnBlocker);
      w.cenv.phase = 'nacht';
      w.light.ambient = 0.05;
      w.run(1, peaceful ? [{ type: 'world.setSettings', friedlich: true }] : []);
      w.run(12 * 60);
      return [...Array(w.creatures.store.size).keys()].filter((i) => w.creatures.store.valueAt(i).creature === 'probe_schleicher').length;
    };
    expect(night(false)).toBeGreaterThan(0);
    expect(night(true)).toBe(0);
  });
});

describe('Fixture-Beitrag „Welt Hart“ (Referenzspielstand v4, tools/save/fixtureM7/welt.ts)', () => {
  it('nur über Befehle: Hart, Überschreibungen, Logistik, kürzere Jahreszeit; vorher die Fakten einer Welt vor M7', () => {
    const sim = createSimulation({ seed: 3, worldSize: 'small' });
    expect(weltFacts(sim)).toEqual(EMPTY_WELT_FACTS);
    playWelt(sim);
    const facts = weltFactsSchema.parse(weltFacts(sim));
    expect(facts).toEqual({ ...EMPTY_WELT_FACTS, difficulty: 'hart', hungerThirst: 1.1, shadowFloodNights: 6, logisticsRealism: true, seasonLengthDays: 5 });
    // Every recorded field differs from the empty facts except those the fixture leaves at their default.
    expect(Object.keys(facts).filter((k) => facts[k as keyof typeof facts] !== EMPTY_WELT_FACTS[k as keyof typeof facts]).sort()).toEqual(['difficulty', 'hungerThirst', 'logisticsRealism', 'seasonLengthDays', 'shadowFloodNights']);
  });
});
