/**
 * Save roundtrip of the participant `meals` (M7-26, docs/SPIEL.md §21, §27): the boredom counters per dish survive save → load,
 * and a loaded stomach is fed up exactly like the one that was never saved; saves before the kitchen migrate to no boredom.
 */
import { describe, expect, it } from 'vitest';
import { consumeTicks } from '../../../../src/game/actions/formulas';
import { createSimulation } from '../../../../src/game/setup';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { kuecheWelt, type KuecheWelt } from '../../game/kueche-testwelt';

const INV0 = { bereich: 'inventar', index: 0 } as const;

function welt(): KuecheWelt {
  const w = kuecheWelt();
  w.spawn(10, 10);
  w.vit().satiety = 0;
  return w;
}

function eat(w: KuecheWelt, item: string): number {
  w.put(w.stack(item));
  const ev = w.run(consumeTicks('gericht') + 2, [{ type: 'action.eat', from: INV0 }]);
  return ((ev.get('itemEaten') ?? []) as Array<{ satiety: number }>)[0]?.satiety ?? -1;
}

/** Two breads and a stew eaten, one dawn passed (bread 2 → 0,5, the stew's 1 forgotten), then another bread (1,5). */
function gegessen(w: KuecheWelt): void {
  eat(w, 'brot');
  eat(w, 'brot');
  eat(w, 'eintopf');
  w.meals.dailyTick();
  eat(w, 'brot');
}

describe('save roundtrip: meals', () => {
  it('restores the boredom counters', () => {
    const report = expectRoundtrip(welt, gegessen, (w) => w.meals.save);
    expect(report.id).toBe('meals');
    expect(JSON.parse(report.canonical)).toEqual({ ueberdruss: [['brot', 1.5]] });
  });

  it('save → load → weiter: das nächste Brot sättigt gleich (halb)', () => {
    const a = welt();
    gegessen(a);
    const b = welt();
    b.meals.save.deserialize(structuredClone(a.meals.save.serialize()));
    expect(eat(b, 'brot')).toBe(eat(a, 'brot'));
    expect(b.meals.save.serialize()).toEqual(a.meals.save.serialize());
  });

  it('the game simulation has the participant (empty at the start); saves before the kitchen migrate', () => {
    const sim = createSimulation({ seed: 3 });
    expect(sim.participant('meals').serialize()).toEqual({ ueberdruss: [] });
    expect(sim.participant('meals').migrations?.[0]?.migrate({})).toEqual({ ueberdruss: [] });
  });
});
