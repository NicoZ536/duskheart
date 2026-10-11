/**
 * Statistiken und Meilensteine (docs/SPIEL.md §23 „Statistiken“, §29; M7-47, M7-64, M7-72): Quellen zählen gefilterte Ereignisse
 * – 1 oder ein Nutzlastfeld, je Schlüssel –, die Spielzeit läuft im Schlaf mit der echten Geschwindigkeit, die Strecke zählt nur
 * Schritte (keine Sprünge), ein Meilenstein hält den ersten Tick fest; jedes Ereignis zählt genau einmal, auch ungeleert.
 */
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import { ALL_KEYS, StatsSystem } from '../../../src/game/stats/system';
import { TILE_PX } from '../../../src/world/model/coords';
import { chronikWelt, steps } from './chronik-testwelt';

describe('Statistiken (src/game/stats)', () => {
  it('die 16 Statistiken aus §29, die Quellen der Welle 1 (M7-72) und die Meilensteine bis LF1', () => {
    expect(CONTENT.collection('stats').ids()).toEqual([
      'spielzeit', 'tage', 'naechte_ueberlebt', 'tode', 'kills', 'hergestellt', 'gesammelt', 'geerntet', 'gefangen', 'gekocht', 'orte_entdeckt',
      'gewoelbe_abgeschlossen', 'raetsel_geloest', 'bosse_besiegt', 'leuchtfeuer_entzuendet', 'distanz',
    ]);
    const sources = CONTENT.collection('statSources').values();
    const of = (stat: string): string[] => sources.filter((s) => s.statistik === stat).map((s) => s.ereignis);
    expect(of('geerntet')).toEqual(['cropHarvested']);
    expect(of('gefangen')).toEqual(['fishCaught', 'fishTrapEmptied', 'netSwung', 'netSwung']);
    expect(of('orte_entdeckt')).toEqual(['placeDiscovered']);
    expect(of('bosse_besiegt')).toEqual(['bossDefeated']);
    expect(of('leuchtfeuer_entzuendet')).toEqual(['beaconLit']);
    // Made by hand or at a crafting station, and what a processing station turns out (the furnace's bronze, M7-64).
    expect(of('hergestellt')).toEqual(['craftCompleted', 'stationProduced']);
    const lf1 = CONTENT.collection('milestones').get('m_lf1');
    expect(lf1?.zielStunden).toBe(3);
  });

  it('Quellen zählen gefiltert, je Schlüssel und mit Wertfeld; `*` zählt die Schlüssel; jedes Ereignis einmal', () => {
    const { sim, feeder, world } = chronikWelt();
    sim.setPlayer(7);
    const stats = sim.addSystem(new StatsSystem({ world }));
    feeder.push(
      ['creatureDied', { entity: 1, creature: 'wolf', by: 7, carcass: 0, loot: true, facing: 0, variant: -1, layer: 0, x: 0, y: 0 }],
      ['creatureDied', { entity: 2, creature: 'reh', by: 7, carcass: 0, loot: true, facing: 0, variant: -1, layer: 0, x: 0, y: 0 }],
      // A creature the player did not kill (a trap, another creature) is no kill of the player's.
      ['creatureDied', { entity: 3, creature: 'reh', by: 99, carcass: 0, loot: true, facing: 0, variant: -1, layer: 0, x: 0, y: 0 }],
      ['craftCompleted', { recipe: 'rezept_faserseil', item: 'faserseil', count: 2 }],
      ['stationProduced', { id: 1, station: 'schmelzofen', recipe: 'rezept_bronzebarren', item: 'bronzebarren', count: 4, layer: 0, x: 0, y: 0 }],
      ['fishTrapEmptied', { layer: 0, tx: 1, ty: 1, anzahl: 3 }],
      ['netSwung', { fang: null, layer: 0, x: 0, y: 0 }],
      ['netSwung', { fang: 'grille', layer: 0, x: 0, y: 0 }],
    );
    steps(sim, 1);
    expect(stats.value('kills')).toBe(2);
    expect(stats.value('kills', 'reh')).toBe(1);
    expect(stats.value('kills', ALL_KEYS)).toBe(2);
    expect(stats.value('hergestellt', 'faserseil')).toBe(2);
    expect(stats.value('hergestellt', 'bronzebarren')).toBe(4);
    expect(stats.value('gefangen')).toBe(4);
    expect(stats.value('gefangen', 'grille')).toBe(1);
    expect(stats.value('unbekannt')).toBe(0);
    // Headless runs never drain: the next step must not count the old events again (the observers' mark, §17).
    sim.step();
    sim.step();
    expect(stats.value('kills')).toBe(2);
    const keys: string[] = [];
    stats.forEachKey('kills', (k, v) => keys.push(`${k}=${v}`));
    expect(keys).toEqual(['wolf=1', 'reh=1']);
  });

  it('Spielzeit im Schlaf mit der echten Geschwindigkeit; Strecke nur aus Schritten, Sprünge zählen nicht', () => {
    const { sim, world } = chronikWelt();
    let scale = 1;
    const at = { x: 0, y: 0, layer: 0 };
    const stats = sim.addSystem(
      new StatsSystem({
        world,
        timeScale: () => scale,
        playerAt: (_s, out) => {
          out.x = at.x;
          out.y = at.y;
          out.layer = at.layer;
          return true;
        },
      }),
    );
    steps(sim, 10);
    expect(stats.value('spielzeit')).toBe(10);
    scale = 30;
    steps(sim, 30);
    expect(stats.value('spielzeit')).toBeCloseTo(11, 9);
    at.x = TILE_PX * 0.5;
    steps(sim, 1);
    expect(stats.value('distanz')).toBeCloseTo(0.5, 9);
    // Fast travel, a respawn: far more than a step – not walked.
    at.x = TILE_PX * 500;
    steps(sim, 1);
    expect(stats.value('distanz')).toBeCloseTo(0.5, 9);
    at.y = TILE_PX * 0.25;
    steps(sim, 1);
    expect(stats.value('distanz')).toBeCloseTo(0.75, 9);
    // Another layer (a cave entrance): no step either.
    at.layer = -1;
    at.y = 0;
    steps(sim, 1);
    expect(stats.value('distanz')).toBeCloseTo(0.75, 9);
  });

  it('Meilensteine: der erste Tick ihres Auslösers, einmal', () => {
    const { sim, feeder, world } = chronikWelt();
    const stats = sim.addSystem(new StatsSystem({ world }));
    expect(stats.milestoneTime('m_steinaxt')).toBe(-1);
    steps(sim, 5);
    feeder.push(['craftCompleted', { recipe: 'rezept_steinaxt', item: 'steinaxt', count: 1 }]);
    // A statistic milestone holds after the count: checked on the world tick.
    steps(sim, 60);
    const first = stats.milestoneTime('m_steinaxt');
    expect(first).toBeGreaterThanOrEqual(5);
    expect(first).toBeLessThan(65);
    feeder.push(['beaconLit', { beacon: 1, biome: 'gruenhain', x: 0, y: 0 }]);
    steps(sim, 1);
    expect(stats.milestoneTime('m_lf1')).toBe(sim.tick - 1);
    feeder.push(['craftCompleted', { recipe: 'rezept_steinaxt', item: 'steinaxt', count: 1 }]);
    steps(sim, 120);
    expect(stats.milestoneTime('m_steinaxt')).toBe(first);
  });
});
