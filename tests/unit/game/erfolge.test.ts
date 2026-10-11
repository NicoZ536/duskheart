/**
 * Erfolge (MASTERPROMPT §23.3 „Erfolge (≥ 60, lokal)“; docs/SPIEL.md §23, §29; M7-47): die 15 Erfolge von M7 mit Symbol, jeder
 * schaltet genau einmal frei, sobald sein Auslöser hält (`achievementUnlocked`); Ereignis-Teile zählen über Schritte und
 * Speichern hinweg, Statistik-Teile lesen die Zähler desselben Schritts.
 */
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import { AchievementsSystem } from '../../../src/game/achievements/system';
import { StatsSystem } from '../../../src/game/stats/system';
import { chronikWelt, steps } from './chronik-testwelt';

describe('Erfolge (src/game/achievements)', () => {
  it('15 Erfolge mit den Ids aus §29, alle mit Texten DE/EN', () => {
    expect(CONTENT.collection('achievements').ids()).toEqual([
      'erste_nacht', 'feuermacher', 'steinzeit', 'baumeister', 'gemuetlich', 'jaeger', 'bronzezeit', 'gaertner', 'koch', 'angler', 'entdecker',
      'gewoelbe_bezwungen', 'borkenvater_besiegt', 'erstes_feuer', 'forscher',
    ]);
    expect(CONTENT.countsByCategory().achievements).toBe(15);
  });

  it('ein Erfolg schaltet einmal frei: Statistik im selben Schritt, Ereignisse ab Weltbeginn gezählt, Zustand im Welt-Tick', () => {
    const { sim, feeder, world, state } = chronikWelt();
    sim.addSystem(new StatsSystem({ world }));
    const ach = sim.addSystem(new AchievementsSystem({ world }));
    feeder.push(['bossDefeated', { boss: 'borkenvater', dauerTicks: 4000, x: 0, y: 0 }]);
    let out = steps(sim, 1);
    expect(out.filter(([t]) => t === 'achievementUnlocked').map(([, p]) => p.achievement)).toEqual(['borkenvater_besiegt']);
    expect(ach.has('borkenvater_besiegt')).toBe(true);
    // Five camp fires over many steps.
    for (let i = 0; i < 4; i++) {
      feeder.push(['lightIgnited', { light: i, kind: 'lagerfeuer', layer: 0, x: 0, y: 0 }]);
      steps(sim, 3);
    }
    expect(ach.has('feuermacher')).toBe(false);
    expect(ach.waiting('feuermacher')?.count).toBe(4);
    feeder.push(['lightIgnited', { light: 9, kind: 'fackel', layer: 0, x: 0, y: 0 }]);
    steps(sim, 1);
    expect(ach.has('feuermacher')).toBe(false);
    feeder.push(['lightIgnited', { light: 5, kind: 'lagerfeuer', layer: 0, x: 0, y: 0 }]);
    out = steps(sim, 1);
    expect(ach.has('feuermacher')).toBe(true);
    // A condition is read on the world tick.
    state.conditions.add('behaglich');
    out = steps(sim, 60);
    expect(out.filter(([t]) => t === 'achievementUnlocked').map(([, p]) => p.achievement)).toEqual(['gemuetlich']);
    // Once only: the same moments again unlock nothing.
    feeder.push(['bossDefeated', { boss: 'borkenvater', dauerTicks: 4000, x: 0, y: 0 }]);
    out = steps(sim, 61);
    expect(out.filter(([t]) => t === 'achievementUnlocked')).toEqual([]);
    expect(ach.unlocked().map((a) => a.id)).toEqual(['borkenvater_besiegt', 'feuermacher', 'gemuetlich']);
  });

  it('verschiedene Schlüssel: der Gärtner braucht 18 verschiedene Nutzpflanzen, der Angler alle acht Fische', () => {
    const { sim, feeder, world } = chronikWelt();
    sim.addSystem(new StatsSystem({ world }));
    const ach = sim.addSystem(new AchievementsSystem({ world }));
    const crops = CONTENT.collection('crops').ids();
    expect(crops).toHaveLength(18);
    for (const crop of crops.slice(0, 17)) feeder.push(['cropHarvested', { crop, layer: 0, tx: 0, ty: 0, qualitaet: 1, anzahl: 1 }]);
    feeder.push(['cropHarvested', { crop: crops[0] as string, layer: 0, tx: 0, ty: 0, qualitaet: 1, anzahl: 1 }]);
    steps(sim, 61);
    expect(ach.has('gaertner')).toBe(false);
    feeder.push(['cropHarvested', { crop: crops[17] as string, layer: 0, tx: 0, ty: 0, qualitaet: 1, anzahl: 1 }]);
    steps(sim, 61);
    expect(ach.has('gaertner')).toBe(true);
    for (const fish of CONTENT.collection('fish').ids()) feeder.push(['fishCaught', { layer: 0, x: 0, y: 0, fish }]);
    steps(sim, 61);
    expect(ach.has('angler')).toBe(true);
  });
});
