/**
 * Beschwipst nimmt Schaden (M7-67; MASTERPROMPT §11.3 „Beschwipst“, docs/SPIEL.md §21 „Met mit Schwanken“): die Wirkung
 * `schadensresistenz` 0,1 des Zustands wirkt auf jeden Treffer, der den Spieler über den Kampf erreicht – Nahkampf und Geschoss,
 * jede Schadensart, zusätzlich zur Resistenz der Ausrüstung (`resistWithShare`: 10 % weniger von dem, was die Art durchlässt).
 * Ohne den Zustand ändert sich kein Wert, nicht einmal um einen Rundungsschritt.
 */
import { describe, expect, it } from 'vitest';
import { resistFactor, resistWithShare } from '../../../src/game/combat/formulas';
import { kampfWelt, type KampfWelt } from './kampf-testwelt';

const BESCHWIPST = 'beschwipst';

/** A foe's blow of `damage` HP of `type` on the player, without a crit (the roll would add noise). */
function blow(k: KampfWelt, type: 'hieb' | 'feuer' | 'stich' = 'hieb', projectile = false): number {
  const foe = k.dummy(16, 0, { team: 'feind' });
  const hit = k.strikePlayer(foe, { damage: 20, type, critChance: 0, projectile });
  if (hit === null) throw new Error('the blow did not land');
  return hit.amount;
}

describe('Beschwipst: schadensresistenz 0,1 auf den Spieler (M7-67)', () => {
  it('die Formel: genau (1 − Anteil) dessen, was die Art durchlässt – auch bei einer Schwäche', () => {
    expect(resistFactor(resistWithShare(0, 0.1))).toBeCloseTo(0.9, 12);
    expect(resistFactor(resistWithShare(0.3, 0.1))).toBeCloseTo(0.7 * 0.9, 12);
    expect(resistFactor(resistWithShare(-0.5, 0.1))).toBeCloseTo(1.5 * 0.9, 12);
    expect(resistFactor(resistWithShare(1, 0.1))).toBe(0);
  });

  it('ein Treffer ohne Beschwipst, mit Beschwipst 10 % weniger, danach wieder bitgleich wie vorher', () => {
    const k = kampfWelt();
    const before = blow(k);
    expect(before).toBeGreaterThan(0);
    expect(k.life.conditions.apply(k.sim, BESCHWIPST).ok).toBe(true);
    expect(k.life.conditions.effects().damageResistance).toBeCloseTo(0.1, 12);
    const tipsy = blow(k);
    expect(tipsy).toBeCloseTo(before * 0.9, 9);
    expect(tipsy).toBeLessThan(before);
    k.life.conditions.cure(k.sim, BESCHWIPST);
    expect(blow(k)).toBe(before);
  });

  it('auch Geschosse und jede Schadensart: die Sicht des Spielers trägt den Anteil in jeder Art', () => {
    const k = kampfWelt();
    const arrow = blow(k, 'stich', true);
    const fire = blow(k, 'feuer');
    k.life.conditions.apply(k.sim, BESCHWIPST);
    expect(blow(k, 'stich', true)).toBeCloseTo(arrow * 0.9, 9);
    expect(blow(k, 'feuer')).toBeCloseTo(fire * 0.9, 9);
    // The player's view carries the share in every type (the fight reads the type of the blow from it).
    const view = k.combat.playerTargets;
    const out = { resist: { hieb: 0, stich: 0, wucht: 0, feuer: 0, frost: 0, gift: 0, licht: 0, schatten: 0 } } as unknown as Parameters<typeof view.view>[2];
    expect(view.view(k.sim, k.sim.player, out)).toBe(true);
    for (const r of Object.values(out.resist)) expect(r).toBeCloseTo(0.1, 12);
  });
});
