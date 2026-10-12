/**
 * Auslöser auf dem Brett nach Inhaltsrang (M7-105; docs/SPIEL.md §17 „Auslöser-Sprache“, §28 „Determinismus“): ein Brett hält
 * seine Auslöser nach `Armed.rank` – dem Platz des Eigentümers in seinem Inhalt –, gleiche Ränge in Scharf-Reihenfolge, ohne
 * Rang (`UNRANKED`) hinten. Halten mehrere im selben Schritt, erreichen sie den Eigentümer in dieser Reihenfolge, gleich welche
 * Geschichte sie scharf schaltete: ein wieder scharf geschalteter Auslöser kehrt an seinen Platz zurück. Die Aufgaben geben den
 * Index der Aufgabe als Rang: zwei Schritte, die im selben Schritt halten, schließen in Inhaltsreihenfolge ab – auch wenn der
 * Schritt der ersten Aufgabe erst später aktiv wurde (wie eine geladene Welt, die alle Schritte in Inhaltsreihenfolge baut).
 */
import { describe, expect, it } from 'vitest';
import type { QuestDef } from '../../../src/content/quests/schema';
import type { Trigger } from '../../../src/content/schema/trigger';
import { QuestsSystem } from '../../../src/game/quests/system';
import { Armed, TriggerBoard, UNRANKED } from '../../../src/game/triggers/evaluator';
import type { TriggerWorld } from '../../../src/game/triggers/types';
import { chronikWelt, steps } from './chronik-testwelt';

const BAUM: Trigger = { art: 'ereignis', ereignis: 'treeFelled' };
const FELLED = { layer: 0, tx: 0, ty: 0, object: 'baum_eiche', direction: 'rechts', landsAtTick: 0 } as const;

/** A world nobody reads here (event triggers only). */
const NOWHERE = {} as TriggerWorld;

/** The owners of the triggers `board` hands over in one step after one `treeFelled`. */
function settleOrder(board: TriggerBoard): string[] {
  const out: string[] = [];
  board.dispatch('treeFelled', { ...FELLED, tick: 0 }, 1);
  board.settle(NOWHERE, false, (a) => out.push(a.owner));
  return out;
}

const T = { de: 'x', en: 'x' };
const step = (id: string, ausloeser: QuestDef['schritte'][number]['ausloeser']): QuestDef['schritte'][number] => ({ id, titel: T, hinweis: T, ausloeser });

describe('Auslöser nach Inhaltsrang (M7-105)', () => {
  it('das Brett liefert nach Rang, gleiche Ränge in Scharf-Reihenfolge, ohne Rang zuletzt; wieder scharf an seinem Platz', () => {
    const board = new TriggerBoard();
    const arm = (owner: string, rank?: number): Armed => {
      const a = new Armed(BAUM, owner, undefined, rank);
      board.arm(a);
      return a;
    };
    arm('ohne1');
    arm('c', 2);
    const a = arm('a', 0);
    arm('ohne2', UNRANKED);
    const d = arm('d', 1);
    arm('b', 0);
    expect(settleOrder(board)).toEqual(['a', 'b', 'd', 'c', 'ohne1', 'ohne2']);
    // Re-armed after the others (as a hint whose channel was off, a quest's next step): back at its place, not behind.
    for (const x of board.armed) x.reset();
    board.disarm(d);
    d.reset();
    board.arm(d);
    expect(settleOrder(board)).toEqual(['a', 'b', 'd', 'c', 'ohne1', 'ohne2']);
    // Among equal ranks the arming order counts: `a` armed again now waits behind `b`.
    for (const x of board.armed) x.reset();
    board.disarm(a);
    a.reset();
    board.arm(a);
    expect(settleOrder(board)).toEqual(['b', 'a', 'd', 'c', 'ohne1', 'ohne2']);
  });

  it('zwei Aufgabenschritte im selben Schritt: Abschluss in Inhaltsreihenfolge, auch wenn der erste später aktiv wurde', () => {
    const { sim, feeder, world, state } = chronikWelt();
    const quests = sim.addSystem(
      new QuestsSystem({
        world,
        rewards: { give: () => undefined, knowledge: () => undefined },
        quests: [
          { id: 'erste', art: 'neben', titel: T, beschreibung: T, schritte: [step('holz', { art: 'besitz', item: 'holz', anzahl: 3 }), step('baum', BAUM)] },
          { id: 'zweite', art: 'neben', titel: T, beschreibung: T, schritte: [step('baum', BAUM)] },
        ],
      }),
    );
    steps(sim, 1);
    expect(quests.status('zweite', 'baum')).toBe('aktiv');
    // The first quest's tree step becomes active only now – armed after the second's.
    state.items.holz = 3;
    steps(sim, 60);
    expect(quests.status('erste', 'baum')).toBe('aktiv');
    feeder.push(['treeFelled', FELLED]);
    const out = steps(sim, 1);
    expect(out.filter(([t]) => t === 'questStepCompleted').map(([, p]) => `${String(p.quest)}:${String(p.schritt)}`)).toEqual(['erste:baum', 'zweite:baum']);
    expect(out.filter(([t]) => t === 'questCompleted').map(([, p]) => p.quest)).toEqual(['erste', 'zweite']);
  });
});
