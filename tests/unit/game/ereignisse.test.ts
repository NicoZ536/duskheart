/**
 * The world event framework (M7-38; MASTERPROMPT §10 "Ereignisse … Jedes Ereignis wird angekündigt (Himmel, Grading, Sound,
 * Funke, HUD) und in der Chronik vermerkt"; docs/SPIEL.md §18): the register of all eleven, the plan from the seed (pure,
 * unchanged by jumps), the phases `ruhe` → `angekuendigt` → `aktiv` → `ruhe`, the Finstermond announced at dusk, at most
 * one big event at a time, a run whose condition breaks off.
 */
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import type { WorldEventDef } from '../../../src/content/worldEvents/schema';
import { dayTimes } from '../../../src/world/calendar';
import { emptyOccurrence, occurrenceOn, planDraw } from '../../../src/game/worldevents/formulas';
import { ereignisWelt } from './ereignisse-testwelt';

const EVENTS = CONTENT.collection('worldEvents').values() as readonly WorldEventDef[];
const def = (id: string): WorldEventDef => EVENTS.find((e) => e.id === id) as WorldEventDef;
const SUMMER = (): 'sommer' => 'sommer';

function events<T>(map: Map<string, unknown[]>, type: string): T[] {
  return (map.get(type) ?? []) as T[];
}

describe('world events: the register', () => {
  it('holds all eleven events of §10; four run in M7, the others name their task', () => {
    expect(EVENTS.map((e) => e.id).sort()).toEqual(['erdbeben', 'finstermond', 'flut', 'haendlerin', 'lawine', 'lumenregen', 'nebelnacht', 'schattenflut', 'sonnenfinsternis', 'tierwanderung', 'waldbrand']);
    expect(EVENTS.filter((e) => e.umgesetzt === true).map((e) => e.id).sort()).toEqual(['finstermond', 'lumenregen', 'sonnenfinsternis', 'waldbrand']);
    const tasks = Object.fromEntries(EVENTS.filter((e) => e.umgesetzt !== true).map((e) => [e.id, (e.umgesetzt as { task: string }).task]));
    expect(tasks).toEqual({ schattenflut: 'M9-23', nebelnacht: 'M8-37', haendlerin: 'M9-17', tierwanderung: 'M8-37', lawine: 'M8-37', flut: 'M8-37', erdbeben: 'M10-25' });
    for (const e of EVENTS) {
      for (const lang of ['de', 'en'] as const) {
        expect(e.chronik[lang].length, `${e.id} chronik ${lang}`).toBeGreaterThan(0);
        expect(e.ankuendigung.hud[lang]).toContain('{minuten}');
      }
    }
  });
});

describe('world events: the plan', () => {
  it('is a pure function of seed, event and day – the same plan for the same seed, another for another', () => {
    const rain = def('lumenregen');
    const plan = (seed: number): string[] => {
      const out: string[] = [];
      const o = emptyOccurrence();
      for (let d = 1; d <= 120; d++) if (occurrenceOn(rain, seed, d, SUMMER, o)) out.push(`${d}:${o.start}-${o.end}`);
      return out;
    };
    expect(plan(7)).toEqual(plan(7));
    expect(plan(8)).not.toEqual(plan(7));
    // About `chance` of the nights (0,12): over 400 nights between 5 % and 20 %.
    let n = 0;
    const o = emptyOccurrence();
    for (let d = 1; d <= 400; d++) if (occurrenceOn(rain, 3, d, SUMMER, o)) n++;
    expect(n / 400).toBeGreaterThan(0.05);
    expect(n / 400).toBeLessThan(0.2);
    expect(planDraw(3, 'lumenregen', 10, 0)).toBe(planDraw(3, 'lumenregen', 10, 0));
  });

  it('the Finstermond is the night of the new moon, from the end of dusk to the next dawn, announced an hour before', () => {
    const o = emptyOccurrence();
    const fm = def('finstermond');
    const nights: number[] = [];
    for (let d = 1; d <= 24; d++) if (occurrenceOn(fm, 1, d, SUMMER, o)) nights.push(d);
    expect(nights).toEqual([8, 16, 24]);
    occurrenceOn(fm, 1, 8, SUMMER, o);
    const t = dayTimes('sommer');
    expect(o.start).toBe((8 - 1) * 1440 + t.duskEnd * 60);
    expect(o.end).toBe(8 * 1440 + t.dawnStart * 60);
    expect(o.announce).toBe(o.start - 60);
  });
});

describe('world events: phases', () => {
  it('the Finstermond is announced at dusk, runs through the night and ends at dawn', () => {
    const w = ereignisWelt();
    w.sim.skipTicks(6 * w.sim.clock.ticksPerDay);
    w.seconds(1);
    const t = dayTimes(w.calendar.season);
    const duskEnd = t.duskEnd * 60;
    // Day 7: no Finstermond tonight.
    expect(events(w.jumpTo(Math.floor((duskEnd - 30) / 60), (duskEnd - 30) % 60), 'worldEventAnnounced')).toHaveLength(0);
    w.sim.skipTicks(w.sim.clock.ticksPerDay - 120 * w.sim.clock.ticksPerGameMinute);
    // Day 8, an hour before the night: announced.
    const tt = dayTimes(w.calendar.seasonOfDay(8));
    const announced = w.jumpTo(Math.floor((tt.duskEnd * 60 - 59) / 60), (tt.duskEnd * 60 - 59) % 60);
    expect(events<{ event: string }>(announced, 'worldEventAnnounced').map((e) => e.event)).toEqual(['finstermond']);
    expect(w.events.phase('finstermond')).toBe('angekuendigt');
    const started = w.jumpTo(Math.floor(tt.duskEnd), Math.round((tt.duskEnd % 1) * 60) + 1);
    expect(events<{ event: string }>(started, 'worldEventStarted').map((e) => e.event)).toEqual(['finstermond']);
    expect(w.calendar.isFinstermond).toBe(true);
    // The Finstermond runs beside a big event.
    expect(w.rejections(w.run(1, [{ type: 'worldEvent.start', event: 'lumenregen' }]))).toEqual([]);
    expect(w.events.phase('lumenregen')).toBe('aktiv');
    const morning = w.jumpTo(Math.ceil(dayTimes(w.calendar.seasonOfDay(9)).dawnStart), 5);
    expect(events<{ event: string; grund: string }>(morning, 'worldEventEnded').some((e) => e.event === 'finstermond' && e.grund === 'zeit')).toBe(true);
    expect(w.events.phase('finstermond')).toBe('ruhe');
  });

  it('at most one big event at a time; the console starts and ends them', () => {
    const w = ereignisWelt();
    expect(w.rejections(w.run(1, [{ type: 'worldEvent.start', event: 'sonnenfinsternis' }]))).toEqual([]);
    expect(w.events.activeBig()).toBe('sonnenfinsternis');
    expect(w.rejections(w.run(1, [{ type: 'worldEvent.start', event: 'lumenregen' }]))).toEqual(['bigEventRunning']);
    expect(w.rejections(w.run(1, [{ type: 'worldEvent.start', event: 'schattenflut' }]))).toEqual(['unknownEvent']);
    const stopped = w.run(1, [{ type: 'worldEvent.stop', event: 'sonnenfinsternis' }]);
    expect(events<{ grund: string }>(stopped, 'worldEventEnded')).toEqual([expect.objectContaining({ event: 'sonnenfinsternis', grund: 'debug' })]);
    expect(w.rejections(w.run(1, [{ type: 'worldEvent.stop', event: 'sonnenfinsternis' }]))).toEqual(['notRunning']);
    expect(w.events.activeBig()).toBeNull();
  });

  it('a planned Lumen rain needs a clear sky: clouds keep it away, and clouding over ends it', () => {
    // Find a night with a rain for seed 1.
    const rain = def('lumenregen');
    const o = emptyOccurrence();
    let day = 1;
    while (!occurrenceOn(rain, 1, day, SUMMER, o)) day++;
    const run = { ...o };
    const plan = (state: 'klar' | 'bewoelkt'): { announced: number; started: number; ended: string[] } => {
      const w = ereignisWelt();
      w.weather.state = state;
      w.sim.skipTicks(Math.round((run.announce + 1 - 360) * w.sim.clock.ticksPerGameMinute) - w.sim.tick);
      const a = w.seconds(2);
      w.sim.skipTicks(Math.round((run.start + 1 - 360) * w.sim.clock.ticksPerGameMinute) - w.sim.tick);
      const s = w.seconds(2);
      w.weather.state = 'bewoelkt';
      const e = w.seconds(2);
      return { announced: events(a, 'worldEventAnnounced').length, started: events(s, 'worldEventStarted').length, ended: events<{ grund: string }>(e, 'worldEventEnded').map((x) => x.grund) };
    };
    expect(plan('klar')).toEqual({ announced: 1, started: 1, ended: ['abgesagt'] });
    expect(plan('bewoelkt')).toEqual({ announced: 0, started: 0, ended: [] });
  });

  it('a jump over a whole run misses it; the plan after the jump is unchanged', () => {
    const rain = def('lumenregen');
    const o = emptyOccurrence();
    let day = 1;
    while (!occurrenceOn(rain, 1, day, SUMMER, o)) day++;
    const w = ereignisWelt();
    w.sim.skipTicks(Math.round((o.end + 5 - 360) * w.sim.clock.ticksPerGameMinute));
    const after = w.seconds(3);
    expect(events(after, 'worldEventAnnounced')).toHaveLength(0);
    expect(events(after, 'worldEventStarted')).toHaveLength(0);
    expect(w.events.phase('lumenregen')).toBe('ruhe');
  });
});
