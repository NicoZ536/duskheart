/**
 * Schattenbrut handelt erst nach dem Formen (M6-13c; MASTERPROMPT §19.4 „Telegraphs … klar sichtbar“, ADR-0113; docs/SPIEL.md
 * §13 „Schattenbrut formt sich nach dem Erscheinen in `formSeconds` (0,9 s) vom Boden her“):
 * - die Simulation und die Darstellung formen gleich lange (die Darstellung liest `BALANCE.creatures.shadowBrood.formSeconds`,
 *   M6-13e: der Rauch ist genau in dem Tick fort, in dem die Brut zu handeln beginnt);
 * - eine Schattenbrut, die neben dem Spieler aus dem Rauch steigt, bewegt sich nicht, holt nicht aus, schlägt und spuckt nicht
 *   und richtet keinen Schaden an, bis sie geformt ist – danach greift sie an;
 * - Tiere und Feinde, die keine Schattenbrut sind, handeln sofort (die Regel gilt nur dem Rauch).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import type { Entity } from '../../../src/engine/ecs';
import { secondsToTicks } from '../../../src/game/combat/formulas';
import type { SimEventMap } from '../../../src/game/sim';
import { formingFade } from '../../../src/render/batch/materialize';
import { eventsOf } from './kampf-testwelt';
import { kreaturWelt, meadow, type KreaturWelt } from './kreatur-testwelt';

const HZ = BALANCE.time.tickHz;
const FORM_TICKS = secondsToTicks(BALANCE.creatures.shadowBrood.formSeconds, 1);

/** A dark night on an open field, the player lit at map tile (20, 15). */
function nacht(): KreaturWelt {
  const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
  w.cenv.phase = 'nacht';
  w.light.ambient = 0.05;
  w.light.lit = true;
  return w;
}

/** What creature `e` did over `ticks` ticks: telegraphs, blows, shots, damage to the player, how far it moved [px]. */
function watch(w: KreaturWelt, e: Entity, ticks: number): { telegraphs: number; blows: number; shots: number; hurt: number; moved: number; firstTelegraph: number } {
  const start = w.where(e);
  const health = w.vit().health;
  let telegraphs = 0;
  let blows = 0;
  let shots = 0;
  let firstTelegraph = -1;
  let moved = 0;
  for (let i = 0; i < ticks; i++) {
    const ev = w.run(1);
    const t = eventsOf<SimEventMap['creatureTelegraph']>(ev, 'creatureTelegraph').filter((x) => x.entity === e).length;
    if (t > 0 && firstTelegraph < 0) firstTelegraph = i;
    telegraphs += t;
    blows += eventsOf<SimEventMap['creatureAttack']>(ev, 'creatureAttack').filter((x) => x.entity === e).length;
    shots += eventsOf<SimEventMap['projectileFired']>(ev, 'projectileFired').filter((x) => x.owner === e).length;
    if (w.creatures.store.has(e)) {
      const p = w.where(e);
      moved = Math.max(moved, Math.hypot(p.x - start.x, p.y - start.y));
    }
  }
  return { telegraphs, blows, shots, hurt: health - w.vit().health, moved, firstTelegraph };
}

describe('Schattenbrut handelt erst nach dem Formen (M6-13c)', () => {
  it('die Simulation formt so lange wie der Rauch im Bild: 0,9 s', () => {
    expect(FORM_TICKS).toBe(54);
    expect(formingFade(FORM_TICKS - 1, HZ)).toBeGreaterThan(0);
    expect(formingFade(FORM_TICKS, HZ)).toBe(0);
  });

  it('ein Schleicher neben dem Spieler steht still, holt nicht aus und schlägt nicht, bis er geformt ist – dann greift er an', () => {
    const w = nacht();
    w.cheats.god = false;
    // One tile north of the player: its claw reaches at once.
    const e = w.creature('schleicher', 20, 14);
    const born = w.state(e).bornTick;
    // `creature` ran the spawn tick: the forming started there.
    const forming = watch(w, e, FORM_TICKS - (w.sim.tick - born));
    expect(forming).toMatchObject({ telegraphs: 0, blows: 0, shots: 0, hurt: 0, moved: 0 });
    expect(w.state(e).attackPhase).toBe('keine');
    const formed = watch(w, e, 2 * HZ);
    expect(formed.telegraphs).toBeGreaterThan(0);
    // It decides at its next thinking tick (12 ticks at the latest) and winds up at once.
    expect(formed.firstTelegraph).toBeLessThanOrEqual(Math.round(HZ / BALANCE.ai.thinkHz));
  });

  it('ein Speier spuckt nicht, solange er sich formt', () => {
    const w = nacht();
    const e = w.creature('speier', 20, 11);
    const born = w.state(e).bornTick;
    const forming = watch(w, e, FORM_TICKS - (w.sim.tick - born));
    expect(forming).toMatchObject({ telegraphs: 0, shots: 0, moved: 0 });
    expect(watch(w, e, 3 * HZ).telegraphs).toBeGreaterThan(0);
  });

  it('ein Treffer während des Formens trifft (der Körper ist da), gehandelt wird trotzdem erst danach', () => {
    const w = nacht();
    const e = w.creature('schleicher', 20, 14);
    const hp = w.state(e).health;
    w.hold('probe_schwert');
    w.aimBy(0, -40);
    const ev = w.run(1, [{ type: 'combat.attack', on: true }]);
    const all = [ev];
    for (let i = 0; i < 20; i++) all.push(w.run(1, i === 0 ? [{ type: 'combat.attack', on: false }] : undefined));
    expect(w.state(e).health).toBeLessThan(hp);
    expect(all.flatMap((x) => eventsOf<SimEventMap['creatureTelegraph']>(x, 'creatureTelegraph')).filter((t) => t.entity === e)).toEqual([]);
    expect(w.sim.tick - w.state(e).bornTick).toBeLessThan(FORM_TICKS);
  });

  it('ein Wolf, der keine Schattenbrut ist, holt sofort aus', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    const e = w.creature('probe_wolf', 20, 14);
    const first = watch(w, e, FORM_TICKS);
    expect(first.telegraphs).toBeGreaterThan(0);
    expect(first.firstTelegraph).toBeLessThan(FORM_TICKS / 2);
  });
});
