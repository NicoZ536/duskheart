/**
 * Ein parierter Kreaturschlag ist ein Schlag (M6-Gate; MASTERPROMPT §19.4 „Angreifen (Musterauswahl mit Gewichtung und
 * Cooldowns)“, „Gruppentaktik“; docs/SPIEL.md §11 „Angreifen (Musterwahl gewichtet mit Abklingzeiten)“, ADR-0097
 * Rudel-Zugfolge): die Parade bricht den Angriff im Schlag ab (`applyHit` → `cancelAttack`), trotzdem läuft die Abklingzeit
 * genau dieses Angriffs – vorher schrieb `attackStep` sie nach `cooldowns[-1]`: der parierte Wolf holte vor Ablauf seiner
 * Abklingzeit wieder aus, und im Rudel blieb er für immer vorn in der Zugfolge (`lastBlow`), sein Gefährte kam nie dran.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import type { Entity } from '../../../src/engine/ecs';
import type { SimEventMap } from '../../../src/game/sim';
import { eventsOf } from './kampf-testwelt';
import { kreaturWelt, meadow, probeCatalog, type KreaturWelt } from './kreatur-testwelt';

type Telegraph = SimEventMap['creatureTelegraph'];
type Attack = SimEventMap['creatureAttack'];

/** The probe wolf's bite and its cooldown [ticks]. */
const BISS = probeCatalog().get('probe_wolf').attacks[0];
const BISS_COOLDOWN = Math.round((BISS?.abklingzeit ?? 0) * BALANCE.time.tickHz);

/** Runs tick by tick until the first telegraph (at most 10 s). */
function untilTelegraph(w: KreaturWelt): Telegraph {
  for (let i = 0; i < 600; i++) {
    const t = eventsOf<Telegraph>(w.run(1), 'creatureTelegraph');
    if (t.length > 0) return t[0] as Telegraph;
  }
  throw new Error('no telegraph');
}

/** A wolf three tiles north of the player (sword in hand) winds up; the player parries its bite. */
function parriedBite(): { w: KreaturWelt; wolf: Entity; blowTick: number } {
  const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
  w.hold('probe_schwert');
  const wolf = w.creature('probe_wolf', 20, 12);
  const telegraph = untilTelegraph(w);
  w.aimBy(0, -40);
  // The block begins 4 ticks before the blow: within the parry window (9 ticks).
  w.run(telegraph.ticks - 4);
  const ev = w.run(6, [{ type: 'combat.block', on: true }]);
  expect(eventsOf(ev, 'parried')).toHaveLength(1);
  const blow = eventsOf<Attack>(ev, 'creatureAttack').filter((a) => a.entity === wolf);
  expect(blow).toHaveLength(1);
  return { w, wolf, blowTick: (blow[0] as Attack).tick };
}

describe('Parierter Kreaturschlag', () => {
  it('die Abklingzeit des parierten Angriffs läuft (kein cooldowns[-1]), der Angriff ist abgebrochen', () => {
    const { w, wolf, blowTick } = parriedBite();
    const s = w.state(wolf);
    expect(Object.keys(s.cooldowns)).toEqual(['0']);
    expect(s.cooldowns[0]).toBe(blowTick + BISS_COOLDOWN);
    // The parry's stagger and the cancel stand: no recovery laid over them.
    expect(s.attack).toBe(-1);
    expect(s.attackPhase).toBe('keine');
    expect(s.staggerUntilTick).toBeGreaterThan(blowTick);
  });

  it('der parierte Wolf holt erst nach seiner Abklingzeit wieder aus', () => {
    const { w, wolf, blowTick } = parriedBite();
    w.run(1, [{ type: 'combat.block', on: false }]);
    let next = -1;
    for (let i = 0; i < 300 && next < 0; i++) {
      const t = eventsOf<Telegraph>(w.run(1), 'creatureTelegraph').filter((x) => x.entity === wolf);
      if (t.length > 0) next = (t[0] as Telegraph).tick;
    }
    expect(next).toBeGreaterThan(0);
    expect(next - blowTick).toBeGreaterThanOrEqual(BISS_COOLDOWN);
  });

  it('im Rudel geht der Zug nach einer Parade an den Gefährten (beide holen aus)', () => {
    const w = kreaturWelt(meadow(60, 40), { x: 30, y: 20 });
    w.hold('probe_schwert');
    const c = w.centre(30, 14);
    w.run(1, [{ type: 'creature.spawn', creature: 'probe_wolf', count: 2, x: c.x, y: c.y, layer: 0 }]);
    const wolves = [w.creatures.store.entityAt(0) as Entity, w.creatures.store.entityAt(1) as Entity];
    expect(w.state(wolves[0] as Entity).pack).toBe(w.state(wolves[1] as Entity).pack);
    const telegraphs = new Map<Entity, number>(wolves.map((e) => [e, 0]));
    let pressAt = -1;
    let parries = 0;
    // 20 s: the player turns to every wind-up and parries it.
    for (let i = 0; i < 20 * BALANCE.time.tickHz; i++) {
      const cmds: { type: 'combat.block'; on: boolean }[] = [];
      if (w.sim.tick === pressAt) cmds.push({ type: 'combat.block', on: false }, { type: 'combat.block', on: true });
      const ev = w.run(1, cmds);
      parries += eventsOf(ev, 'parried').length;
      for (const t of eventsOf<Telegraph>(ev, 'creatureTelegraph')) {
        telegraphs.set(t.entity, (telegraphs.get(t.entity) ?? 0) + 1);
        const p = w.where(t.entity);
        const me = w.pos();
        w.aimBy(p.x - me.x, p.y - me.y);
        pressAt = t.tick + t.ticks - 4;
      }
    }
    expect(parries).toBeGreaterThan(3);
    for (const e of wolves) expect(telegraphs.get(e)).toBeGreaterThan(1);
    for (const e of wolves) expect(Object.keys(w.state(e).cooldowns)).toEqual(['0']);
  });
});
