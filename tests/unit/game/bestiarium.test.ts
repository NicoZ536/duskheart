/**
 * Das Bestiarium (M6-32, MASTERPROMPT §20.1 „Bestiarium-Eintrag DE/EN“; docs/SPIEL.md §11 „Bestiarium“): „gesichtet“ nach
 * drei Sekunden im Blick (im Hellen oder mit leuchtenden Augen im Dunkeln, nah genug), „Resistenzen“ nach dem ersten und
 * „Beute“ nach dem dritten Sieg – je einmal gemeldet; jede Kreatur hat ihren Eintrag in beiden Sprachen.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CREATURES } from '../../../src/content/creatures/kreaturen';
import type { SimEventMap } from '../../../src/game/sim';
import { eventsOf } from './kampf-testwelt';
import { kreaturWelt, meadow } from './kreatur-testwelt';

const B = BALANCE.creatures.bestiary;
const HZ = BALANCE.time.tickHz;
type Unlocked = SimEventMap['bestiaryUnlocked'];

describe('Bestiarium (M6-32)', () => {
  it('gesichtet nach drei Sekunden im Blick – einmal', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    const deer = w.creature('reh', 24, 15);
    w.state(deer).stateUntilTick = w.sim.tick + 10 * HZ;
    let at = -1;
    const all: Unlocked[] = [];
    for (let t = 0; t < 6 * HZ; t++) {
      const u = eventsOf<Unlocked>(w.run(1), 'bestiaryUnlocked');
      if (u.length > 0 && at < 0) at = t;
      all.push(...u);
    }
    expect(all).toEqual([expect.objectContaining({ creature: 'reh', stage: 'gesichtet' })]);
    expect(at).toBeGreaterThanOrEqual(B.sightSeconds * HZ - HZ / B.checkHz - 2);
    expect(at).toBeLessThanOrEqual(B.sightSeconds * HZ + HZ / B.checkHz + 2);
    expect(w.bestiary.stages('reh')).toEqual({ gesichtet: true, resistenzen: false, beute: false });
  });

  it('im Dunkeln nur mit leuchtenden Augen, und nicht zu weit weg', () => {
    const w = kreaturWelt(meadow(60, 40), { x: 20, y: 15 });
    w.light.ambient = 0.05;
    w.cheats.god = true;
    w.creature('hase', 22, 15);
    w.creature('probe_wolf', 20, 12);
    w.creature('reh', 20 + B.sightRadiusTiles + 6, 15);
    const u = eventsOf<Unlocked>(w.run(5 * HZ), 'bestiaryUnlocked');
    expect(u.map((e) => e.creature)).toEqual(['probe_wolf']);
    expect(w.bestiary.entry('hase').seenTicks).toBe(0);
    expect(w.bestiary.entry('reh').seenTicks).toBe(0);
  });

  it('Resistenzen nach dem ersten, Beute nach dem dritten Sieg', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    const stages: string[] = [];
    for (let i = 0; i < 4; i++) {
      w.creature('hase', 22, 15);
      stages.push(...eventsOf<Unlocked>(w.run(1, [{ type: 'creature.kill', radius: 4 }]), 'bestiaryUnlocked').map((e) => `${e.creature}:${e.stage}`));
    }
    expect(stages).toEqual(['hase:resistenzen', 'hase:beute']);
    expect(w.bestiary.entry('hase').kills).toBe(4);
    expect(w.bestiary.stages('hase')).toEqual({ gesichtet: false, resistenzen: true, beute: true });
    expect(B.killsForResistances).toBe(1);
    expect(B.killsForLoot).toBe(3);
  });

  it('jede Kreatur hat Text und Hinweis in beiden Sprachen', () => {
    for (const c of CREATURES) {
      for (const lang of ['de', 'en'] as const) {
        expect(c.bestiarium.text[lang].length, `${c.id} ${lang}`).toBeGreaterThan(20);
        expect(c.bestiarium.hinweis[lang].length, `${c.id} ${lang}`).toBeGreaterThan(10);
        expect(c.name[lang].length).toBeGreaterThan(0);
      }
    }
  });
});
