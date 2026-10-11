/**
 * Save roundtrip of the participant `water` (M7-30, docs/SPIEL.md §21, §27): the rain collectors with their water, roof and
 * next farm day, and the collector of a sip under way survive save → load; a loaded collector gains the same rain at dawn.
 */
import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../../../src/game/setup';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { minuteOf } from '../../../../src/world/climate/gameTime';
import { kuecheWelt, type KuecheWelt } from '../../game/kueche-testwelt';
import { OFFSET } from '../../game/spieler-testwelt';

/** Two collectors (one under a roof) and rain of 90 minutes on farm days 1 and 2. */
function welt(): KuecheWelt {
  const w = kuecheWelt();
  w.spawn(10, 10);
  w.climate.track(0);
  w.climate.record(0, 'klar', minuteOf(1, 0), minuteOf(1, 8));
  w.climate.record(0, 'regen', minuteOf(1, 8), minuteOf(1, 8) + 90);
  w.climate.record(0, 'klar', minuteOf(1, 8) + 90, minuteOf(2, 8));
  w.climate.record(0, 'regen', minuteOf(2, 8), minuteOf(2, 8) + 90);
  w.climate.record(0, 'klar', minuteOf(2, 8) + 90, minuteOf(4, 0));
  return w;
}

function gesammelt(w: KuecheWelt): void {
  w.roof(12, 10);
  w.water.placed(w.sim, 'regensammler', 0, OFFSET + 11, OFFSET + 10);
  w.water.placed(w.sim, 'regensammler', 0, OFFSET + 12, OFFSET + 10);
  w.run(61);
  w.water.dailyTick(w.sim, 2);
  w.waterUses.use(w.sim, 0, OFFSET + 11, OFFSET + 10, w.sim.tick);
  w.run(1);
}

describe('save roundtrip: water', () => {
  it('restores the collectors and the sip under way', () => {
    const report = expectRoundtrip(welt, gesammelt, (w) => w.water.save);
    expect(report.id).toBe('water');
    expect(JSON.parse(report.canonical)).toEqual({
      sammler: [
        [0, OFFSET + 11, OFFSET + 10, 90, false, 2],
        [0, OFFSET + 12, OFFSET + 10, 0, true, 2],
      ],
      schluck: [0, OFFSET + 11, OFFSET + 10],
    });
  });

  it('save → load → weiter: der Schluck endet am selben Sammler, der nächste Morgen bringt denselben Regen', () => {
    const a = welt();
    gesammelt(a);
    const b = welt();
    // The roof is the building's (its own participant): the same world around the loaded collectors.
    b.roof(12, 10);
    b.water.save.deserialize(structuredClone(a.water.save.serialize()));
    b.sim.participant('actions').deserialize(structuredClone(a.sim.participant('actions').serialize()));
    for (const w of [a, b]) {
      w.run(200);
      w.water.dailyTick(w.sim, 3);
    }
    expect(b.water.save.serialize()).toEqual(a.water.save.serialize());
    expect([...a.water.all][0]?.fill).toBe(90 - 15 + 90);
  });

  it('the game simulation has the participant (no collectors at the start)', () => {
    const sim = createSimulation({ seed: 3 });
    expect(sim.participant('water').serialize()).toEqual({ sammler: [], schluck: null });
  });
});
