/**
 * Aufgaben (MASTERPROMPT §23.3; docs/SPIEL.md §23 „Aufgaben“, „Einstieg“; M7-42, M7-43): Start bei Weltbeginn oder per Auslöser,
 * Schritte der Reihe nach (Ereignis-Teile zählen ab dem aktiven Schritt), Belohnung, bis 3 verfolgte, der Einstieg jederzeit
 * abschaltbar, der Debug-Sprung; dazu der Inhalt: „Die sechs Feuer“ Akt 1, der Einstieg bis zur Werkbank und die Bronzezeit.
 */
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import type { QuestDef } from '../../../src/content/quests/schema';
import { QuestsSystem } from '../../../src/game/quests/system';
import { StatsSystem } from '../../../src/game/stats/system';
import { chronikWelt, steps } from './chronik-testwelt';

const T = { de: 'x', en: 'x' };
/** The reasons of the commands refused since the last drain (drains the queue). */
function refused(sim: { events: { drain(cb: (type: string, payload: unknown) => void): void } }): string[] {
  const out: string[] = [];
  sim.events.drain((type, payload) => {
    if (type === 'commandRejected') out.push((payload as { reason: string }).reason);
  });
  return out;
}
const step = (id: string, ausloeser: QuestDef['schritte'][number]['ausloeser']): QuestDef['schritte'][number] => ({ id, titel: T, hinweis: T, ausloeser });

describe('Aufgaben (src/game/quests)', () => {
  it('Inhalt: Hauptaufgabe Akt 1 mit Funke, Stätte, Borkenvater, Leuchtfeuer; Einstieg bis zur Werkbank, dann die Bronzezeit', () => {
    const hq = CONTENT.collection('quests').get('hq_sechs_feuer_1');
    expect(hq?.art).toBe('haupt');
    expect(hq?.akt).toBe(1);
    expect(hq?.schritte.map((s) => s.id)).toEqual(['funke_erwacht', 'staette_finden', 'borkenvater', 'entzuenden']);
    expect(hq?.schritte.map((s) => s.marker?.art ?? null)).toEqual([null, 'leuchtfeuer', 'boss', 'leuchtfeuer']);
    const e = CONTENT.collection('quests').get('einstieg');
    expect(e?.schritte.map((s) => s.id)).toEqual(['fasern_steine', 'steinaxt', 'lagerfeuer', 'unterschlupf', 'werkbank']);
    // The way to bronze follows the first day as a side quest (it starts once the onboarding is done).
    const b = CONTENT.collection('quests').get('bronzezeit');
    expect(b?.art).toBe('neben');
    expect(b?.start).toEqual({ art: 'aufgabe', aufgabe: 'einstieg', status: 'erledigt' });
    expect(b?.schritte.map((s) => s.id)).toEqual(['kupfer_zinn', 'bronze']);
  });

  it('Start, Schritte der Reihe nach, Belohnung; Ereignis-Teile zählen erst ab dem aktiven Schritt', () => {
    const { sim, feeder, world, state } = chronikWelt();
    sim.addSystem(new StatsSystem({ world }));
    const given: string[] = [];
    const quests = sim.addSystem(
      new QuestsSystem({
        world,
        rewards: { give: (_s, item, n) => given.push(`${item}×${n}`), knowledge: (_s, id) => given.push(id) },
        quests: [
          {
            id: 'a',
            art: 'neben',
            titel: T,
            beschreibung: T,
            schritte: [step('holz', { art: 'besitz', item: 'holz', anzahl: 3 }), step('baum', { art: 'ereignis', ereignis: 'treeFelled' })],
            belohnung: { items: [{ item: 'fackel', anzahl: 2 }], wissen: 'wissen_licht' },
          },
          { id: 'b', art: 'neben', titel: T, beschreibung: T, start: { art: 'aufgabe', aufgabe: 'a', status: 'erledigt' }, schritte: [step('x', { art: 'ereignis', ereignis: 'tileDug' })] },
        ],
      }),
    );
    let out = steps(sim, 1);
    expect(out.filter(([t]) => t === 'questStarted').map(([, p]) => p.quest)).toEqual(['a']);
    expect(quests.status('a')).toBe('aktiv');
    expect(quests.status('a', 'holz')).toBe('aktiv');
    expect(quests.status('a', 'baum')).toBe('offen');
    expect(quests.status('b')).toBe('offen');
    // A tree felled before its step is active does not count.
    feeder.push(['treeFelled', { layer: 0, tx: 0, ty: 0, object: 'baum_eiche', direction: 'rechts', landsAtTick: 0 }]);
    steps(sim, 1);
    state.items.holz = 3;
    out = steps(sim, 60);
    expect(out.filter(([t]) => t === 'questStepCompleted').map(([, p]) => p.schritt)).toEqual(['holz']);
    expect(quests.status('a', 'holz')).toBe('erledigt');
    steps(sim, 120);
    expect(quests.status('a', 'baum')).toBe('aktiv');
    feeder.push(['treeFelled', { layer: 0, tx: 0, ty: 0, object: 'baum_eiche', direction: 'rechts', landsAtTick: 0 }]);
    out = steps(sim, 1);
    expect(out.filter(([t]) => t === 'questCompleted').map(([, p]) => p.quest)).toEqual(['a']);
    expect(given).toEqual(['fackel×2', 'wissen_licht']);
    expect(quests.status('a', 'holz')).toBe('erledigt');
    // `b` starts once `a` is done (its start trigger, a state, on the world tick).
    out = steps(sim, 60);
    expect(out.filter(([t]) => t === 'questStarted').map(([, p]) => p.quest)).toEqual(['b']);
  });

  it('verfolgen: bis drei, neue nehmen freie Plätze, abgelehnt mit Grund', () => {
    const { sim, world } = chronikWelt();
    const defs: QuestDef[] = ['q1', 'q2', 'q3', 'q4'].map((id) => ({ id, art: 'neben', titel: T, beschreibung: T, schritte: [step('s', { art: 'ereignis', ereignis: 'tileDug' })] }));
    const quests = sim.addSystem(new QuestsSystem({ world, quests: defs }));
    steps(sim, 1);
    expect(quests.runs.map((r) => r.state?.tracked)).toEqual([true, true, true, false]);
    sim.step([{ type: 'quest.track', quest: 'q4', on: true }]);
    expect(refused(sim)).toEqual(['trackerFull']);
    sim.step([{ type: 'quest.track', quest: 'q1', on: false }, { type: 'quest.track', quest: 'q4', on: true }]);
    expect(quests.runs.map((r) => r.state?.tracked)).toEqual([false, true, true, true]);
    sim.step([{ type: 'quest.track', quest: 'nix', on: true }]);
    expect(refused(sim)).toEqual(['unknownQuest']);
  });

  it('Einstieg abschaltbar: aus hält den Schritt an und verlässt den Tracker, an läuft er mit seinen Zählern weiter', () => {
    const { sim, feeder, world } = chronikWelt();
    const defs: QuestDef[] = [{ id: 'einstieg', art: 'einstieg', titel: T, beschreibung: T, schritte: [step('drei', { art: 'ereignis', ereignis: 'tileDug', anzahl: 3 })] }];
    const quests = sim.addSystem(new QuestsSystem({ world, quests: defs }));
    steps(sim, 1);
    const run = quests.run('einstieg');
    feeder.push(['tileDug', { layer: 0, tx: 0, ty: 0, from: 'erde', to: 'erde_gegraben', result: 'grube' }]);
    steps(sim, 1);
    sim.step([{ type: 'quest.onboarding', on: false }]);
    expect(quests.onboarding).toBe(false);
    expect(quests.active(run!)).toBe(false);
    expect(run?.state?.tracked).toBe(false);
    feeder.push(['tileDug', { layer: 0, tx: 0, ty: 0, from: 'erde', to: 'erde_gegraben', result: 'grube' }]);
    steps(sim, 1);
    expect(run?.step?.count).toBe(1);
    sim.step([{ type: 'quest.onboarding', on: true }]);
    expect(run?.state?.tracked).toBe(true);
    feeder.push(['tileDug', { layer: 0, tx: 0, ty: 0, from: 'erde', to: 'erde_gegraben', result: 'grube' }], ['tileDug', { layer: 0, tx: 0, ty: 0, from: 'erde', to: 'erde_gegraben', result: 'grube' }]);
    steps(sim, 1);
    expect(quests.status('einstieg')).toBe('erledigt');
    // A world that begins with the onboarding off never starts it until it is switched on.
    const w2 = chronikWelt();
    const q2 = w2.sim.addSystem(new QuestsSystem({ world: w2.world, quests: defs }));
    w2.sim.step([{ type: 'quest.onboarding', on: false }]);
    steps(w2.sim, 3);
    expect(q2.status('einstieg')).toBe('offen');
    w2.sim.step([{ type: 'quest.onboarding', on: true }]);
    expect(q2.status('einstieg')).toBe('aktiv');
  });

  it('Debug: ein Schritt weiter, ein Sprung zu einem Schritt, unbekannte abgelehnt', () => {
    const { sim, world } = chronikWelt();
    const quests = sim.addSystem(new QuestsSystem({ world }));
    steps(sim, 1);
    sim.step([{ type: 'quest.debug', quest: 'hq_sechs_feuer_1', schritt: 'borkenvater' }]);
    expect(quests.status('hq_sechs_feuer_1', 'borkenvater')).toBe('aktiv');
    expect(quests.status('hq_sechs_feuer_1', 'staette_finden')).toBe('erledigt');
    refused(sim);
    sim.step([{ type: 'quest.debug', quest: 'hq_sechs_feuer_1' }]);
    expect(quests.status('hq_sechs_feuer_1', 'entzuenden')).toBe('aktiv');
    sim.step([{ type: 'quest.debug', quest: 'hq_sechs_feuer_1', schritt: 'gibtsnicht' }]);
    expect(refused(sim)).toEqual(['unknownStep']);
  });
});
