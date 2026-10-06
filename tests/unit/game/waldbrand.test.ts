/**
 * Forest fire (M7-40; MASTERPROMPT §10 "Waldbrand (Sommer, Blitz)"; docs/SPIEL.md §18): on a summer day the plan allows, a
 * thunderstorm over the player's region becomes the forest fire – announced as the storm begins, running after its lead
 * until the storm ends; its lightning sets trees alight far more often (a dry storm), and the fire simulation (M4-28) takes
 * it from there: the struck tree burns and the flames spread to the trees around. Outside summer the storm is only a storm.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import type { WorldEventDef } from '../../../src/content/worldEvents/schema';
import { weatherDay } from '../../../src/game/worldevents/formulas';
import { dryStormEnvironment } from '../../../src/game/worldevents/fire';
import { climateCode, codeWet, codeWindClass, codeWindDirection } from '../../../src/game/fire/formulas';
import type { Simulation } from '../../../src/game/sim';
import { ereignisWelt, type EreignisWelt } from './ereignisse-testwelt';

const fire = CONTENT.collection('worldEvents').get('waldbrand') as WorldEventDef;
const DAY_MINUTES = 1440;

/** A forest of 40 × 30: trees on every other tile in a chequer, the player on a clearing in the middle. */
function forest(seed = 1): EreignisWelt {
  const rows = Array.from({ length: 30 }, (_, y) => Array.from({ length: 40 }, (_, x) => (Math.abs(x - 20) <= 2 && Math.abs(y - 15) <= 2 ? '.' : (x + y) % 2 === 0 ? 'T' : '.')).join(''));
  const w = ereignisWelt(rows, { x: 20, y: 15 }, { seed });
  w.cheats.god = true;
  return w;
}

/** The first day from `from` on that is a forest fire day for `seed` in `season`. */
function fireDay(seed: number, from: number, season: 'sommer' | 'fruehling'): number {
  for (let d = from; d < from + 7; d++) if (weatherDay(fire, seed, d, season)) return d;
  throw new Error(`no forest fire day for seed ${seed}`);
}

/** Jumps to 13:00 of `day` and lets a thunderstorm begin there for two hours; returns the events of the next `minutes`. */
function storm(w: EreignisWelt, day: number, minutes: number): Map<string, unknown[]> {
  const start = (day - 1) * DAY_MINUTES + 13 * 60;
  w.sim.skipTicks(Math.round((start - 360) * w.sim.clock.ticksPerGameMinute) - w.sim.tick);
  w.weather.state = 'gewitter';
  w.weather.start = start;
  w.weather.end = start + 120;
  return w.seconds(minutes);
}

function count(map: Map<string, unknown[]>, type: string, where: (e: Record<string, unknown>) => boolean = () => true): number {
  return ((map.get(type) ?? []) as Record<string, unknown>[]).filter(where).length;
}

describe('forest fire', () => {
  it('is planned only in summer, on about half of its days', () => {
    let summer = 0;
    for (let d = 1; d <= 200; d++) {
      expect(weatherDay(fire, 4, d, 'fruehling')).toBe(false);
      if (weatherDay(fire, 4, d, 'sommer')) summer++;
    }
    expect(summer).toBeGreaterThan(70);
    expect(summer).toBeLessThan(130);
  });

  it('a summer storm on its day is the forest fire: announced with the storm, running after the lead, ending with it', () => {
    const w = forest();
    const day = fireDay(1, 8, 'sommer');
    const first = storm(w, day, 2);
    expect(count(first, 'worldEventAnnounced', (e) => e.event === 'waldbrand')).toBe(1);
    expect(w.events.phase('waldbrand')).toBe('angekuendigt');
    const lead = w.seconds(fire.ankuendigung.vorlaufMinuten);
    expect(count(lead, 'worldEventStarted', (e) => e.event === 'waldbrand')).toBe(1);
    expect(w.events.dry()).toBe(true);
    // The storm moves on: the fire event ends.
    w.weather.state = 'regen';
    const after = w.seconds(2);
    expect(count(after, 'worldEventEnded', (e) => e.event === 'waldbrand')).toBe(1);
    expect(w.events.phase('waldbrand')).toBe('ruhe');
  });

  it('its lightning sets the forest alight, and the fire spreads from tree to tree', () => {
    const w = forest();
    const day = fireDay(1, 8, 'sommer');
    const e = storm(w, day, 90);
    const lit = count(e, 'fireStarted', (x) => x.cause === 'blitz');
    expect(lit).toBeGreaterThan(0);
    expect(count(e, 'fireStarted', (x) => x.cause === 'ausbreitung')).toBeGreaterThan(0);
    expect(count(e, 'treeBurned')).toBeGreaterThan(0);
  });

  it('far more strikes set trees alight in the dry summer storm than in a spring storm', () => {
    const struckTrees = (season: 'sommer' | 'fruehling'): { trees: number; lit: number } => {
      const w = forest(3);
      const day = season === 'sommer' ? fireDay(3, 8, 'sommer') : 2;
      const e = storm(w, day, 90);
      const trees = ((e.get('lightningStruck') ?? []) as { ziel: string; entzuendet: boolean }[]).filter((s) => s.ziel === 'baum');
      return { trees: trees.length, lit: trees.filter((s) => s.entzuendet).length };
    };
    const summer = struckTrees('sommer');
    const spring = struckTrees('fruehling');
    expect(summer.trees).toBeGreaterThan(3);
    expect(spring.trees).toBeGreaterThan(3);
    expect(summer.lit / summer.trees).toBeGreaterThan(spring.lit / spring.trees);
    expect(summer.lit / summer.trees).toBeGreaterThan(BALANCE.worldEvents.igniteTreeChance);
  });

  it('its storm is dry: while it runs the fires read no rain, the wind stays (createSimulation wraps the fire environment)', () => {
    let dry = false;
    const wet = climateCode(1, 0.85, 5);
    const env = dryStormEnvironment({ active: () => true, region: () => 0, regions: () => 1, climate: () => wet }, () => dry);
    const sim = null as unknown as Simulation;
    expect(codeWet(env.climate(sim, 0))).toBe(true);
    dry = true;
    const code = env.climate(sim, 0);
    expect(codeWet(code)).toBe(false);
    expect(codeWindClass(code)).toBe(codeWindClass(wet));
    expect(codeWindDirection(code)).toBe(5);
    // A dry climate stays as it is.
    expect(env.climate(sim, 0)).toBe(code);
  });
});
