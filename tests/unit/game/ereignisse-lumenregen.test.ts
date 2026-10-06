/**
 * Lumen rain and eclipse (M7-39; MASTERPROMPT §10 "Lumenregen (Sternschnuppen: glühende Scherben schlagen ein, selten ein
 * Meteorit mit Sternenerz)", "Sonnenfinsternis (selten: tagsüber eine Stunde Nacht)"; docs/SPIEL.md §18): shards fall near
 * the player while the rain runs, the meteorite comes once in the runs its plan gives it, with star ore; the eclipse darkens
 * the calendar's daylight – the value the light map, the shadow brood, fear and the sky read – and turns the day phase to
 * night.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import type { WorldEventDef } from '../../../src/content/worldEvents/schema';
import { eclipseFactor, emptyOccurrence, occurrenceOn, planDraw } from '../../../src/game/worldevents/formulas';
import { TILE_PX } from '../../../src/world/model/coords';
import { ereignisWelt, type EreignisWelt } from './ereignisse-testwelt';

const W = BALANCE.worldEvents;
const MEADOW = Array.from({ length: 64 }, () => '.'.repeat(64));
const def = (id: string): WorldEventDef => CONTENT.collection('worldEvents').get(id) as WorldEventDef;

function count(map: Map<string, unknown[]>, type: string): number {
  return (map.get(type) ?? []).length;
}

/** A world at 23:00 of day 2 with the Lumen rain started from the console (its run: now … now + 60 min). */
function rainNight(seed = 1): EreignisWelt {
  // A meadow wide enough for the meteorite's distance (up to 28 tiles), the player in its middle.
  const w = ereignisWelt(MEADOW, { x: 32, y: 32 }, { seed });
  w.sim.skipTicks(w.sim.clock.ticksPerDay);
  w.jumpTo(23);
  w.run(1, [{ type: 'worldEvent.start', event: 'lumenregen' }]);
  return w;
}

describe('Lumen rain', () => {
  it('lets glowing shards fall near the player while it runs, the same for the same world', () => {
    const fall = (w: EreignisWelt): string => {
      const e = w.seconds(60);
      expect(count(e, 'lumenShardFell')).toBeGreaterThan(10);
      return w.fallen.filter((f) => f.stack.item === 'lumen_scherbe').map((f) => `${f.x},${f.y}`).join(' ');
    };
    const a = rainNight();
    const shards = fall(a);
    expect(fall(rainNight())).toBe(shards);
    const p = a.pos();
    for (const f of a.fallen.filter((x) => x.stack.item === 'lumen_scherbe')) {
      const d = Math.hypot(f.x - p.x, f.y - p.y) / TILE_PX;
      expect(d).toBeGreaterThanOrEqual((W.shardDistanceTiles[0] as number) - 1.5);
      expect(d).toBeLessThanOrEqual((W.shardDistanceTiles[1] as number) + 1.5);
    }
    // Over: no more shards.
    expect(a.events.phase('lumenregen')).toBe('ruhe');
    expect(count(a.seconds(10), 'lumenShardFell')).toBe(0);
  });

  it('brings its meteorite once in the runs its plan gives one – star ore at the impact', () => {
    let seen = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const w = rainNight(seed);
      const day = w.sim.clock.day;
      w.seconds(62);
      // Counted by its ore: the impact may come in the start's own world tick.
      const impacts = w.fallen.filter((f) => f.stack.item === 'sternenerz').length;
      const planned = planDraw(seed, 'lumenregen', day, 3) < W.meteorChance;
      expect(impacts, `seed ${seed}`).toBe(planned ? 1 : 0);
      if (impacts === 1) {
        seen++;
        const ore = w.fallen.filter((f) => f.stack.item === 'sternenerz');
        expect(ore).toHaveLength(1);
        expect(ore[0]?.stack.count).toBeGreaterThanOrEqual(W.meteorOre[0] as number);
        expect(ore[0]?.stack.count).toBeLessThanOrEqual(W.meteorOre[1] as number);
      }
    }
    // A quarter of the rains: some of ten.
    expect(seen).toBeGreaterThan(0);
    expect(seen).toBeLessThan(10);
  });

  it('is planned only in the night window of its nights', () => {
    const o = emptyOccurrence();
    for (let d = 1; d <= 300; d++) {
      if (!occurrenceOn(def('lumenregen'), 5, d, () => 'sommer', o)) continue;
      const h = (o.start - (d - 1) * 1440) / 60;
      expect(h).toBeGreaterThanOrEqual(W.nightWindowHours[0] as number);
      expect(h).toBeLessThan(W.nightWindowHours[1] as number);
      expect(o.end - o.start).toBeGreaterThanOrEqual(30);
      expect(o.end - o.start).toBeLessThanOrEqual(60);
    }
  });
});

describe('Solar eclipse', () => {
  it('darkens the day over its ramp to full night and gives it back', () => {
    expect(eclipseFactor(100, 100, 160)).toBe(1);
    expect(eclipseFactor(103, 100, 160)).toBeCloseTo(0.5);
    expect(eclipseFactor(130, 100, 160)).toBe(0);
    expect(eclipseFactor(157, 100, 160)).toBeCloseTo(0.5);
    expect(eclipseFactor(160, 100, 160)).toBe(1);
  });

  it('turns noon into an hour of night for the daylight and the day phase, then back to day', () => {
    const w = ereignisWelt();
    w.jumpTo(12);
    expect(w.calendar.daylight).toBe(1);
    expect(w.calendar.dayPhase).toBe('tag');
    const ambientDay = w.calendar.ambientLight;
    w.run(1, [{ type: 'worldEvent.start', event: 'sonnenfinsternis' }]);
    w.seconds(20);
    expect(w.calendar.daylight).toBe(0);
    expect(w.calendar.dayPhase).toBe('nacht');
    expect(w.calendar.ambientLight).toBeLessThan(ambientDay / 4);
    w.seconds(45);
    expect(w.events.phase('sonnenfinsternis')).toBe('ruhe');
    expect(w.calendar.daylight).toBe(1);
    expect(w.calendar.dayPhase).toBe('tag');
  });

  it('is rare and by day: planned in the day window on a few of many days', () => {
    const o = emptyOccurrence();
    let n = 0;
    for (let d = 1; d <= 600; d++) {
      if (!occurrenceOn(def('sonnenfinsternis'), 9, d, () => 'sommer', o)) continue;
      n++;
      const h = (o.start - (d - 1) * 1440) / 60;
      expect(h).toBeGreaterThanOrEqual(W.dayWindowHours[0] as number);
      expect(h).toBeLessThan(W.dayWindowHours[1] as number);
      expect(o.end - o.start).toBe(60);
    }
    expect(n).toBeGreaterThan(3);
    expect(n).toBeLessThan(40);
  });
});
