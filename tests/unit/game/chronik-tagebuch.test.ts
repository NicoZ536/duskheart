/**
 * Das Tagebuch und das Wissen der Chronik (docs/SPIEL.md §23 „Tagebuch“; M7-41): Regeln schreiben Einträge mit den Werten der
 * Nutzlast, die ihr Text nennt (der Text entsteht erst in der UI), einmalige Regeln einmal je Welt, das Tagebuch hält die
 * jüngsten `chronicleMaxEntries`; Wissenseinträge schalten per Auslöser frei; ein Erfolg steht im selben Schritt im Tagebuch.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import type { ChronicleRuleDef, KnowledgeDef } from '../../../src/content/chronik/schema';
import { CONTENT } from '../../../src/content/index';
import { AchievementsSystem } from '../../../src/game/achievements/system';
import { ChronicleSystem } from '../../../src/game/chronicle/system';
import { StatsSystem } from '../../../src/game/stats/system';
import { chronikWelt, steps } from './chronik-testwelt';

const T = { de: '{creature} gesehen.', en: 'Saw {creature}.' };

describe('Chronik: Tagebuch und Wissen (src/game/chronicle)', () => {
  it('Regeln schreiben Einträge mit Tag, Tick und den genannten Werten; einmalige einmal', () => {
    const { sim, feeder, world } = chronikWelt();
    const rules: ChronicleRuleDef[] = [
      { id: 'r_sicht', ereignis: 'bestiaryUnlocked', wo: { stage: 'gesichtet' }, art: 'entdeckung', text: T, platzhalter: { creature: 'kreatur' } },
      { id: 'r_baum', ereignis: 'treeFelled', art: 'handwerk', text: { de: 'Baum.', en: 'Tree.' }, einmalig: true },
    ];
    const chronicle = sim.addSystem(new ChronicleSystem({ world, rules, knowledge: [] }));
    feeder.push(['bestiaryUnlocked', { creature: 'wolf', stage: 'gesichtet' }], ['bestiaryUnlocked', { creature: 'wolf', stage: 'beute' }]);
    const out = steps(sim, 1);
    expect(out.filter(([t]) => t === 'chronicleEntryAdded').map(([, p]) => [p.entry, p.art, p.regel])).toEqual([[1, 'entdeckung', 'r_sicht']]);
    expect(chronicle.entries()).toEqual([{ nr: 1, tick: 0, day: 1, rule: 'r_sicht', values: { creature: 'wolf' } }]);
    for (let i = 0; i < 3; i++) {
      feeder.push(['treeFelled', { layer: 0, tx: 0, ty: 0, object: 'baum_eiche', direction: 'rechts', landsAtTick: 0 }]);
      steps(sim, 1);
    }
    expect(chronicle.entries().map((e) => e.rule)).toEqual(['r_sicht', 'r_baum']);
  });

  it('das Tagebuch hält die jüngsten Einträge, die Nummern zählen weiter', () => {
    const { sim, feeder, world } = chronikWelt();
    const chronicle = sim.addSystem(new ChronicleSystem({ world, rules: [{ id: 'r', ereignis: 'tileDug', art: 'tagebuch', text: { de: 'x', en: 'x' } }], knowledge: [] }));
    const n = BALANCE.quests.chronicleMaxEntries + 3;
    for (let i = 0; i < n; i++) feeder.push(['tileDug', { layer: 0, tx: 0, ty: 0, from: 'erde', to: 'erde', result: 'grube' }]);
    steps(sim, 1);
    expect(chronicle.entries()).toHaveLength(BALANCE.quests.chronicleMaxEntries);
    expect(chronicle.entries()[0]?.nr).toBe(4);
    expect(chronicle.entries().at(-1)?.nr).toBe(n);
  });

  it('Wissen schaltet per Auslöser frei (knowledgeUnlocked), einmal; ein Erfolg steht im selben Schritt im Tagebuch', () => {
    const { sim, feeder, world, state } = chronikWelt();
    sim.addSystem(new StatsSystem({ world }));
    sim.addSystem(new AchievementsSystem({ world }));
    const knowledge: KnowledgeDef[] = [{ id: 'wissen_x', titel: T, text: T, quelle: 'mechanik', freischaltung: { art: 'zustand', zustand: 'hungrig' } }];
    const chronicle = sim.addSystem(new ChronicleSystem({ world, knowledge }));
    state.conditions.add('hungrig');
    let out = steps(sim, 60);
    expect(out.filter(([t]) => t === 'knowledgeUnlocked').map(([, p]) => p.wissen)).toEqual(['wissen_x']);
    expect(chronicle.knows('wissen_x')).toBe(true);
    out = steps(sim, 120);
    expect(out.filter(([t]) => t === 'knowledgeUnlocked')).toEqual([]);
    feeder.push(['bossDefeated', { boss: 'borkenvater', dauerTicks: 9000, x: 0, y: 0 }]);
    out = steps(sim, 1);
    const unlocked = out.findIndex(([t]) => t === 'achievementUnlocked');
    const entry = out.findIndex(([t, p]) => t === 'chronicleEntryAdded' && p.regel === 'chronik_erfolg');
    expect(unlocked).toBeGreaterThanOrEqual(0);
    expect(entry).toBeGreaterThan(unlocked);
    expect(chronicle.entries().find((e) => e.rule === 'chronik_erfolg')?.values).toEqual({ achievement: 'borkenvater_besiegt' });
  });

  it('Inhalt: jede Regel und jeder Wissenseintrag mit Texten DE/EN, Wissen der Mechaniken bis M6 und von Strang G', () => {
    const rules = CONTENT.collection('chronicleRules').ids();
    for (const id of ['chronik_erfolg', 'chronik_aufgabe_erfuellt', 'chronik_funke_erwacht', 'chronik_erste_nacht', 'chronik_kreatur_gesichtet', 'chronik_tod', 'chronik_perkstufe']) expect(rules).toContain(id);
    const wissen = CONTENT.collection('knowledge').ids();
    for (const id of ['wissen_chronik', 'wissen_funke', 'wissen_sechs_feuer', 'wissen_hunger_durst', 'wissen_licht', 'wissen_kampf', 'wissen_fertigkeiten']) expect(wissen).toContain(id);
  });
});
