/**
 * Save roundtrip of the participant `chronicle` (M7-41, docs/SPIEL.md §27 "Einträge/Wissen"): diary entries with their values,
 * the next number, the one-time rules written, the knowledge unlocked and the counters waiting survive save → load.
 */
import { describe, expect, it } from 'vitest';
import { ChronicleSystem } from '../../../../src/game/chronicle/system';
import { createSimulation } from '../../../../src/game/setup';
import type { Simulation } from '../../../../src/game/sim';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { chronikWelt, steps, type Feeder } from '../../game/chronik-testwelt';

function world(): { sim: Simulation; feeder: Feeder; chronicle: ChronicleSystem } {
  const w = chronikWelt();
  return { sim: w.sim, feeder: w.feeder, chronicle: w.sim.addSystem(new ChronicleSystem({ world: w.world })) };
}

describe('save roundtrip: chronicle', () => {
  it('restores entries, numbers, one-time rules and knowledge; a one-time rule stays written after the load', () => {
    const report = expectRoundtrip(
      world,
      (w) => {
        w.feeder.push(['treeFelled', { layer: 0, tx: 0, ty: 0, object: 'baum_eiche', direction: 'rechts', landsAtTick: 0 }], ['bestiaryUnlocked', { creature: 'reh', stage: 'gesichtet' }]);
        steps(w.sim, 1);
      },
      (w) => w.chronicle.save,
    );
    const data = JSON.parse(report.canonical) as { eintraege: { rule: string; values: object }[]; einmalig: string[]; wissen: { id: string }[]; naechste: number };
    expect(data.eintraege.map((e) => e.rule)).toEqual(['chronik_erster_baum', 'chronik_kreatur_gesichtet']);
    expect(data.eintraege[1]?.values).toEqual({ creature: 'reh' });
    expect(data.einmalig).toEqual(['chronik_erster_baum']);
    expect(data.wissen.map((k) => k.id).sort()).toEqual(['wissen_bestiarium', 'wissen_sammeln'].filter((id) => data.wissen.some((k) => k.id === id)).sort());
    const w = world();
    w.chronicle.save.deserialize(JSON.parse(report.canonical));
    w.feeder.push(['treeFelled', { layer: 0, tx: 0, ty: 0, object: 'baum_eiche', direction: 'rechts', landsAtTick: 0 }]);
    steps(w.sim, 1);
    expect(w.chronicle.entries().filter((e) => e.rule === 'chronik_erster_baum')).toHaveLength(1);
    expect(w.chronicle.entries().at(-1)?.nr).toBe(data.naechste - 1);
  });

  it('the game simulation has the participant; saves before M7 migrate; bad data is refused', () => {
    const sim = createSimulation({ seed: 3 });
    expect(sim.participant('chronicle').migrations?.find((m) => m.from === 0)?.migrate(undefined)).toEqual({ eintraege: [], naechste: 1, einmalig: [], wissen: [], wartend: {} });
    const w = world();
    expect(() => w.chronicle.save.deserialize({ eintraege: [{ nr: 1, tick: 0, day: 1, rule: 'erfunden', values: {} }], naechste: 2, einmalig: [], wissen: [], wartend: {} })).toThrow(/unknown rule/);
    expect(() => w.chronicle.save.deserialize({ eintraege: [], naechste: 1, einmalig: [], wissen: [{ id: 'wissen_nie', tick: 0 }], wartend: {} })).toThrow(/unknown knowledge/);
    expect(() => w.chronicle.save.deserialize({ eintraege: [{ nr: 3, tick: 0, day: 1, rule: 'chronik_tod', values: {} }], naechste: 2, einmalig: [], wissen: [], wartend: {} })).toThrow(/chronicle snapshot invalid/);
  });
});
