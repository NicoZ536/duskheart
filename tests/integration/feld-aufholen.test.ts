/**
 * Field and fishing in the real game simulation (M7-19 … M7-24; docs/SPIEL.md §20, §27, §28): the fixture contribution of the
 * reference save v4 (tools/save/fixtureM7/feld.ts) plays its part by commands in a small world – a carrot bed in stage 2, a
 * tomato frozen in the Frostkamm, fish traps with a catch –, and the frozen chunks' catch-up does not depend on how a time
 * jump is cut: the beds and traps after one jump over N days equal those after N jumps of one day each (a → b → c), for
 * several N, down to the participants' snapshots (determinism rule §28 "aktiv ≡ eingefroren + aufgeholt ≡ a → b → c" for the
 * real game; the active-against-frozen half on a drawn world lives in tests/unit/game/wachstum.test.ts and angeln.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../src/game/setup';
import type { Simulation } from '../../src/game/sim';
import { EMPTY_FELD_FACTS, feldFacts, feldFactsSchema, playFeld } from '../../tools/save/fixtureM7/feld';
import { WORLD_TIMEOUT_MS } from '../unit/world/weltgen-hilfen';

/** Minutes of a game day. */
const DAY_MINUTES = 24 * 60;
/** The jump lengths compared [days]: a week, a little more than a season's half, a season and a bit. */
const SWEEP_DAYS = [3, 9, 17] as const;
/** The fixture world (tools/save/fixture.ts). */
const SEED = 3;

function played(): Simulation {
  const sim = createSimulation({ seed: SEED, worldSize: 'small' });
  sim.step([{ type: 'player.spawn' }]);
  playFeld(sim);
  return sim;
}

/** The farming and fishing participants' snapshots (the save's view of the same state). */
function snapshots(sim: Simulation): unknown {
  const snap = sim.snapshot();
  return { farming: snap.participants['farming'], fishing: snap.participants['fishing'] };
}

describe('Feld & Fang in der echten Simulation', () => {
  it(
    'Fixture-Beitrag nur über Befehle: Karotte in Stufe 2 im Beet, eine erfrorene Tomate im Frostkamm, Reusen mit Fang',
    () => {
      const sim = createSimulation({ seed: SEED, worldSize: 'small' });
      expect(feldFacts(sim)).toEqual(EMPTY_FELD_FACTS);
      sim.step([{ type: 'player.spawn' }]);
      playFeld(sim);
      const facts = feldFactsSchema.parse(feldFacts(sim));
      expect(facts.beete).toHaveLength(2);
      expect(facts.beete.filter((b) => b.crop === 'karotte' && !b.dead && b.stage >= 2)).toHaveLength(1);
      expect(facts.beete.filter((b) => b.crop === 'tomate' && b.dead)).toHaveLength(1);
      expect(facts.reusen).toHaveLength(3);
      expect(facts.reusen.reduce((n, r) => n + r.fish.length, 0)).toBeGreaterThan(0);
    },
    WORLD_TIMEOUT_MS * 2,
  );

  it(
    'Aufholen: ein Sprung über N Tage ≡ N Sprünge zu einem Tag (a → b → c) – Beete und Reusen bis in die Snapshots',
    () => {
      const base = played();
      const start = base.snapshot();
      for (const days of SWEEP_DAYS) {
        const once = played();
        expect(once.snapshot()).toEqual(start);
        once.step([{ type: 'advanceTime', minutes: days * DAY_MINUTES }]);
        const steps = played();
        for (let d = 0; d < days; d++) steps.step([{ type: 'advanceTime', minutes: DAY_MINUTES }]);
        expect(steps.tick, `${days} Tage`).toBe(once.tick);
        expect(feldFacts(steps), `${days} Tage`).toEqual(feldFacts(once));
        expect(snapshots(steps), `${days} Tage`).toEqual(snapshots(once));
      }
    },
    WORLD_TIMEOUT_MS * 6,
  );
});
