/**
 * Save roundtrip of the participant `guide` (M7-43, M7-44, docs/SPIEL.md §27 "gegebene Hinweise, Abklingzeiten, Schalter"): the
 * one-time hints said, cooling, the queues, what shows and when each channel last spoke, the switches survive save → load – a
 * loaded game neither repeats a one-time comment nor speaks sooner than the minimum distance allows.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../../src/content/balance';
import { GuideSystem } from '../../../../src/game/guide/system';
import { createSimulation } from '../../../../src/game/setup';
import type { Simulation } from '../../../../src/game/sim';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { chronikWelt, steps, type Feeder } from '../../game/chronik-testwelt';

function world(): { sim: Simulation; feeder: Feeder; guide: GuideSystem } {
  const w = chronikWelt();
  return { sim: w.sim, feeder: w.feeder, guide: w.sim.addSystem(new GuideSystem({ world: w.world })) };
}

describe('save roundtrip: guide', () => {
  it('restores what was said, the queue, the last time each channel spoke and the switches', () => {
    const report = expectRoundtrip(
      world,
      (w) => {
        w.feeder.push(['treeFelled', { layer: 0, tx: 0, ty: 0, object: 'baum_eiche', direction: 'rechts', landsAtTick: 0 }], ['itemBroken', { at: { bereich: 'schnellleiste', index: 0 }, item: 'steinaxt' }]);
        steps(w.sim, 1);
        w.sim.step([{ type: 'guide.configure', funke: true, hints: false }]);
      },
      (w) => w.guide.save,
    );
    const data = JSON.parse(report.canonical) as { gesagt: string[]; warteschlange: { hint: string }[]; schalter: object; funke: { id: string } | null };
    expect(data.gesagt).toEqual(['funke_baum']);
    expect(data.funke?.id).toBe('funke_baum');
    expect(data.warteschlange.map((p) => p.hint)).toEqual(['funke_kaputt']);
    expect(data.schalter).toEqual({ funke: true, hints: false });
    // After the load the waiting comment speaks no sooner than the minimum distance after the last one.
    const w = world();
    w.guide.save.deserialize(JSON.parse(report.canonical));
    const said: string[] = [];
    for (let i = 0; i < (BALANCE.guide.funkeMinSeconds + 1) * BALANCE.time.tickHz; i++) for (const [t, p] of steps(w.sim, 1)) if (t === 'guideHint') said.push(`${w.sim.tick}:${String(p.hint)}`);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/funke_kaputt$/);
  });

  it('the game simulation has the participant; saves before M7 migrate; bad data is refused', () => {
    const sim = createSimulation({ seed: 3 });
    const empty = sim.participant('guide').migrations?.find((m) => m.from === 0)?.migrate(undefined) as { schalter: object };
    expect(empty.schalter).toEqual({ funke: true, hints: true });
    const w = world();
    expect(() => w.guide.save.deserialize({ ...empty, gesagt: ['funke_erfunden'] })).toThrow(/unknown hint/);
    expect(() => w.guide.save.deserialize({ ...empty, schalter: { funke: 'ja' } })).toThrow(/guide snapshot invalid/);
  });
});
