/**
 * Die weiteren Statistiken der Chronik (M7-106; docs/SPIEL.md §23 „Statistiken“, §29; ADR-0263): je neue Quelle ein Ereignis,
 * wie es sein System schiebt – gezählt wird 1 oder das Wertfeld, je Schlüssel, gefiltert wo die Quelle filtert (ein Blitz, der
 * nichts entzündet, ein Bosskampf, der nicht durch den Tod endet, zählen nicht). Jede Statistik hat Namen DE/EN, und jede
 * kanonische Statistik hat eine Quelle – außer den beiden, die das System selbst zählt (Spielzeit, Strecke).
 */
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import { STAT_SOURCES_M7_106, STATS_M7_106 } from '../../../src/content/stats/erweitert';
import { ALL_KEYS, OWN_STATS, StatsSystem } from '../../../src/game/stats/system';
import { chronikWelt, steps, type Feed } from './chronik-testwelt';

/** One case per source: the event fed, the statistic, its key (or null) and what one event adds. */
const CASES: readonly { feed: Feed; stat: string; key: string | null; adds: number }[] = [
  { feed: ['mealEaten', { item: 'eintopf', effekte: [], ueberdruss: 0, kueche: false, roh: false }], stat: 'gegessen', key: 'eintopf', adds: 1 },
  { feed: ['foodSpoiled', { item: 'apfel', count: 3, behaelter: 'kiste' }], stat: 'verdorben', key: 'apfel', adds: 3 },
  { feed: ['placeCleansed', { place: 4, ortstyp: 'friedhof' }], stat: 'orte_gereinigt', key: 'friedhof', adds: 1 },
  { feed: ['placeChestOpened', { place: 4, ortstyp: 'gehoeft', chest: 0, stufe: 1, tx: 1, ty: 1 }], stat: 'ortstruhen_geoeffnet', key: 'gehoeft', adds: 1 },
  { feed: ['towerClimbed', { place: 2, ortstyp: 'aussichtsturm', radiusTiles: 40, x: 0, y: 0, layer: 0 }], stat: 'tuerme_bestiegen', key: null, adds: 1 },
  { feed: ['shrineBlessed', { place: 3, ortstyp: 'schrein', zustand: 'gesegnet', sekunden: 600 }], stat: 'segen_empfangen', key: 'gesegnet', adds: 1 },
  { feed: ['placeDugUp', { place: 5, ortstyp: 'buddelstelle', tx: 1, ty: 1 }], stat: 'buddelfunde', key: null, adds: 1 },
  { feed: ['worldEventStarted', { event: 'lumenregen', startTick: 10, endTick: 900 }], stat: 'weltereignisse_erlebt', key: 'lumenregen', adds: 1 },
  { feed: ['lightningStruck', { layer: 0, x: 0, y: 0, ziel: 'baum', entzuendet: true }], stat: 'blitzbraende', key: null, adds: 1 },
  { feed: ['meteorImpact', { layer: 0, x: 0, y: 0 }], stat: 'meteore', key: null, adds: 1 },
  { feed: ['mapMarked', { id: 1, symbol: 'eigen_2', layer: 0, tx: 3, ty: 4 }], stat: 'kartenmarker', key: null, adds: 1 },
  { feed: ['bossDefeated', { boss: 'borkenvater', dauerTicks: 5400, x: 0, y: 0 }], stat: 'boss_kampfzeit', key: 'borkenvater', adds: 5400 },
  { feed: ['bossReset', { boss: 'borkenvater', grund: 'tod' }], stat: 'boss_niederlagen', key: 'borkenvater', adds: 1 },
  { feed: ['travelled', { von: 'lf_1', nach: 'herd_2', kind: 'herdfeuer', kosten: 4, x: 0, y: 0, layer: 0 }], stat: 'schnellreisen', key: 'herdfeuer', adds: 1 },
  { feed: ['travelled', { von: 'lf_1', nach: 'herd_2', kind: 'herdfeuer', kosten: 4, x: 0, y: 0, layer: 0 }], stat: 'reise_lumen', key: null, adds: 4 },
  { feed: ['shardUsed', { art: 'herz', gesamt: 1, item: 'herzsplitter' }], stat: 'splitter_benutzt', key: 'herz', adds: 1 },
  { feed: ['unlockGranted', { unlock: 'lf1_wegsteine', quelle: 'leuchtfeuer:1' }], stat: 'freischaltungen', key: null, adds: 1 },
];

describe('Statistiken M7-106 (src/content/stats/erweitert.ts)', () => {
  it('17 Statistiken mit Namen DE/EN, je eine Quelle; jede kanonische Statistik hat eine Quelle (bis auf die eigenen)', () => {
    expect(STATS_M7_106).toHaveLength(17);
    for (const s of STATS_M7_106) {
      expect(s.name.de.length, s.id).toBeGreaterThan(0);
      expect(s.name.en.length, s.id).toBeGreaterThan(0);
    }
    const sources = CONTENT.collection('statSources').values();
    const own: ReadonlySet<string> = new Set(Object.values(OWN_STATS));
    for (const s of CONTENT.collection('stats').values()) {
      if (own.has(s.id)) continue;
      expect(sources.some((q) => q.statistik === s.id), s.id).toBe(true);
    }
    // Each case covers exactly one of the new sources.
    expect(new Set(CASES.map((c) => c.stat))).toEqual(new Set(STAT_SOURCES_M7_106.map((s) => s.statistik)));
  });

  for (const c of CASES) {
    it(`${c.feed[0]} → ${c.stat}${c.key === null ? '' : ` (${c.key})`}`, () => {
      const { sim, feeder, world } = chronikWelt();
      const stats = sim.addSystem(new StatsSystem({ world }));
      feeder.push(c.feed, c.feed);
      steps(sim, 1);
      expect(stats.value(c.stat)).toBe(2 * c.adds);
      if (c.key !== null) {
        expect(stats.value(c.stat, c.key)).toBe(2 * c.adds);
        expect(stats.value(c.stat, ALL_KEYS)).toBe(1);
      }
    });
  }

  it('Filter: ein Blitz ohne Brand zählt nicht, ein Bosskampf, der nicht durch den Tod endet, auch nicht; Reisen ohne Kosten zählen keine Lumen', () => {
    const { sim, feeder, world } = chronikWelt();
    const stats = sim.addSystem(new StatsSystem({ world }));
    feeder.push(
      ['lightningStruck', { layer: 0, x: 0, y: 0, ziel: 'boden', entzuendet: false }],
      ['bossReset', { boss: 'borkenvater', grund: 'verlassen' }],
      ['travelled', { von: 'a', nach: 'b', kind: 'wegstein', kosten: 0, x: 0, y: 0, layer: 0 }],
    );
    steps(sim, 1);
    expect(stats.value('blitzbraende')).toBe(0);
    expect(stats.value('boss_niederlagen')).toBe(0);
    expect(stats.value('reise_lumen')).toBe(0);
    expect(stats.value('schnellreisen', 'wegstein')).toBe(1);
  });

  it('die Zählung überlebt Speichern und Laden', () => {
    const a = chronikWelt();
    const stats = a.sim.addSystem(new StatsSystem({ world: a.world }));
    for (const c of CASES) a.feeder.push(c.feed);
    steps(a.sim, 1);
    const b = chronikWelt();
    const loaded = b.sim.addSystem(new StatsSystem({ world: b.world }));
    loaded.save.deserialize(JSON.parse(JSON.stringify(stats.save.serialize())));
    for (const c of CASES) expect(loaded.value(c.stat, c.key ?? undefined), c.stat).toBe(stats.value(c.stat, c.key ?? undefined));
  });
});
