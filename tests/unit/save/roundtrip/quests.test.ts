/**
 * Save roundtrip of the participant `quests` (M7-42, M7-43, docs/SPIEL.md §27 "Aufgaben/Schritte/Zähler/verfolgt/Einstieg an"):
 * started quests with status, step, the step's counters, start tick and tracker flag, the waiting start triggers and the
 * world's onboarding switch survive save → load; a restored step goes on counting where it stood.
 */
import { describe, expect, it } from 'vitest';
import { QuestsSystem } from '../../../../src/game/quests/system';
import { createSimulation } from '../../../../src/game/setup';
import type { Simulation } from '../../../../src/game/sim';
import { StatsSystem } from '../../../../src/game/stats/system';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { chronikWelt, steps, type Feeder } from '../../game/chronik-testwelt';

function world(): { sim: Simulation; feeder: Feeder; quests: QuestsSystem } {
  const w = chronikWelt();
  w.sim.addSystem(new StatsSystem({ world: w.world }));
  return { sim: w.sim, feeder: w.feeder, quests: w.sim.addSystem(new QuestsSystem({ world: w.world })) };
}

describe('save roundtrip: quests', () => {
  it('restores quests, steps, counters, tracking and the onboarding switch', () => {
    const report = expectRoundtrip(
      world,
      (w) => {
        steps(w.sim, 1);
        w.sim.step([{ type: 'quest.debug', quest: 'einstieg', schritt: 'unterschlupf' }]);
        w.sim.step([{ type: 'quest.track', quest: 'einstieg', on: false }]);
        steps(w.sim, 60);
      },
      (w) => w.quests.save,
    );
    const data = JSON.parse(report.canonical) as { aufgaben: { quest: string; step: number; tracked: boolean; status: string }[]; einstieg: boolean };
    expect(data.aufgaben.map((q) => [q.quest, q.status, q.step, q.tracked])).toEqual([
      ['einstieg', 'aktiv', 3, false],
      ['hq_sechs_feuer_1', 'aktiv', 0, true],
    ]);
    expect(data.einstieg).toBe(true);
    // The restored step goes on waiting for its shelter: a night in the grass bed.
    const w = world();
    w.quests.save.deserialize(JSON.parse(report.canonical));
    w.feeder.push(['sleepStarted', { entity: 1, place: 'grasbett', x: 0, y: 0, layer: 0, nap: false }]);
    steps(w.sim, 1);
    expect(w.quests.status('einstieg', 'unterschlupf')).toBe('erledigt');
    expect(w.quests.status('einstieg', 'werkbank')).toBe('aktiv');
  });

  it('the game simulation has the participant; saves before M7 begin the quests on the next step; bad data is refused', () => {
    const sim = createSimulation({ seed: 3 });
    const empty = sim.participant('quests').migrations?.find((m) => m.from === 0)?.migrate(undefined);
    expect(empty).toEqual({ aufgaben: [], startWartend: {}, einstieg: true });
    const w = world();
    w.quests.save.deserialize(empty);
    steps(w.sim, 1);
    expect(w.quests.status('einstieg')).toBe('aktiv');
    expect(() => w.quests.save.deserialize({ aufgaben: [{ quest: 'erfunden', status: 'aktiv', step: 0, counts: [], startedTick: 0, tracked: true }], startWartend: {}, einstieg: true })).toThrow(/unknown quest/);
    expect(() => w.quests.save.deserialize({ aufgaben: [{ quest: 'einstieg', status: 'aktiv', step: 99, counts: [], startedTick: 0, tracked: true }], startWartend: {}, einstieg: true })).toThrow(/has no step/);
  });
});
