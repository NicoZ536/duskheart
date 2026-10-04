/**
 * Wer schläft, zerlegt nicht und stellt keine Fallen (M6-Gate; ADR-0035 „Handlungsunfähigkeit … Die Systeme der eigenen
 * Taten fragen ihn (`PlayerSystem.incapacity`) … lehnen mit dem Grund ab“; docs/SPIEL.md §10 „Wer tot ist oder schläft …“):
 * `carcass.carve`, `trap.place` und `trap.take` fragen `incapacity` und lehnen im Schlaf mit `asleep` ab (DE/EN-Text
 * `ui.creatures.reject.asleep`) – vorher prüften sie nur den Tod, und ein Befehl aus Konsole oder Wiederholung zerlegte im
 * Schlaf. Wach geht alles wie zuvor. Der Schlaf meldet sich wie im Spiel als Anbieter der Handlungsunfähigkeit (src/game/
 * sleep: `addIncapacity`).
 */
import { describe, expect, it } from 'vitest';
import { NULL_ENTITY } from '../../../src/engine/ecs';
import { CREATURE_REJECT_REASONS } from '../../../src/game/creatures/events';
import type { SimEventMap } from '../../../src/game/sim';
import de from '../../../src/i18n/de.json';
import en from '../../../src/i18n/en.json';
import { eventsOf } from './kampf-testwelt';
import { kreaturWelt, meadow, tileOf, type KreaturWelt } from './kreatur-testwelt';

const HOTBAR = { bereich: 'schnellleiste', index: 0 } as const;
type Rejected = SimEventMap['commandRejected'];

/** A meadow with a hare's carcass next to the player and a sleep the test switches. */
function welt(): { w: KreaturWelt; carcass: number; sleep: { on: boolean } } {
  const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
  const sleep = { on: false };
  w.player.addIncapacity(() => (sleep.on ? 'asleep' : null));
  w.creature('hase', 21, 15);
  const died = eventsOf<SimEventMap['creatureDied']>(w.run(1, [{ type: 'creature.kill', radius: 3 }]), 'creatureDied')[0];
  expect(died?.carcass).not.toBe(NULL_ENTITY);
  return { w, carcass: died?.carcass as number, sleep };
}

function rejected(ev: Map<string, unknown[]>, type: string): string[] {
  return eventsOf<Rejected>(ev, 'commandRejected')
    .filter((r) => r.type === type)
    .map((r) => r.reason);
}

describe('Kreatur- und Fallenbefehle im Schlaf', () => {
  it('der Grund „asleep“ hat seinen Text in DE und EN', () => {
    expect(CREATURE_REJECT_REASONS).toContain('asleep');
    expect((de as Record<string, string>)['ui.creatures.reject.asleep']).toBeTruthy();
    expect((en as Record<string, string>)['ui.creatures.reject.asleep']).toBeTruthy();
  });

  it('carcass.carve: im Schlaf abgelehnt (asleep), wach zerlegt', () => {
    const { w, carcass, sleep } = welt();
    w.hold('steinmesser');
    sleep.on = true;
    const ev = w.run(1, [{ type: 'carcass.carve', carcass }]);
    expect(rejected(ev, 'carcass.carve')).toEqual(['asleep']);
    expect(eventsOf(ev, 'carcassCarved')).toEqual([]);
    expect(w.creatures.carcasses.has(carcass)).toBe(true);
    sleep.on = false;
    expect(eventsOf(w.run(1, [{ type: 'carcass.carve', carcass }]), 'carcassCarved')).toHaveLength(1);
  });

  it('trap.place und trap.take: im Schlaf abgelehnt (asleep), wach gestellt und genommen', () => {
    const { w, sleep } = welt();
    w.hold('schlinge');
    const { tx, ty } = tileOf(w.pos());
    sleep.on = true;
    expect(rejected(w.run(1, [{ type: 'trap.place', from: HOTBAR, tx, ty: ty + 1 }]), 'trap.place')).toEqual(['asleep']);
    expect(w.traps.traps).toEqual([]);
    sleep.on = false;
    expect(rejected(w.run(1, [{ type: 'trap.place', from: HOTBAR, tx, ty: ty + 1 }]), 'trap.place')).toEqual([]);
    const trap = w.traps.traps[0];
    expect(trap).toBeDefined();
    sleep.on = true;
    expect(rejected(w.run(1, [{ type: 'trap.take', trap: trap?.id ?? 0 }]), 'trap.take')).toEqual(['asleep']);
    expect(w.traps.traps).toHaveLength(1);
    sleep.on = false;
    expect(rejected(w.run(1, [{ type: 'trap.take', trap: trap?.id ?? 0 }]), 'trap.take')).toEqual([]);
    expect(w.traps.traps).toEqual([]);
  });

  it('tot bleibt der Grund „dead“', () => {
    const { w, carcass } = welt();
    w.hold('steinmesser');
    w.vit().health = 0;
    expect(rejected(w.run(1, [{ type: 'carcass.carve', carcass }]), 'carcass.carve')).toEqual(['dead']);
  });
});
