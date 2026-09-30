/**
 * M6-06 Nahkampfklassen (docs/SPIEL.md §10 "Nahkampfklassen (M6-06)"; MASTERPROMPT §19.2): Schwert 3er-Kombo, schwer
 * Rundumhieb · Axt schwer Rüstungsbruch, fällt Bäume mit 50 % · Keule Wucht, hoher Stagger · Speer Reichweite, schwer Wurf
 * (wird Projektil, bleibt als Drop liegen) · Dolch Rückenangriff ×3 beim Schleichen · Zweihand breit, langsam, Licht am
 * Gürtel.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { hitstopTicks, secondsToTicks } from '../../../src/game/combat/formulas';
import { findCarriedLight } from '../../../src/game/light/formulas';
import { contentItemCatalog } from '../../../src/game/items/catalog';
import { createHarvestPlan, createObjectHit } from '../../../src/game/gathering/system';
import { eventsOf, kampfCatalog, kampfWelt, runUntil, type KampfWelt } from './kampf-testwelt';
import { gatherWorld } from './interaktion-testwelt';

const A = BALANCE.combat.attack;
const C = BALANCE.combat;
const catalog = kampfCatalog();

function waffe(id: string) {
  const w = catalog.get(id).waffe;
  if (w === undefined) throw new Error(`${id} has no waffe`);
  return w;
}

/** Presses and releases the attack button and runs until the blow landed (and its recovery if `recover`). */
function swing(k: KampfWelt, heavy = false): Map<string, unknown[]> {
  const all = new Map<string, unknown[]>();
  const merge = (m: Map<string, unknown[]>) => m.forEach((v, key) => all.set(key, [...(all.get(key) ?? []), ...v]));
  if (heavy) {
    merge(k.run(secondsToTicks(A.heavyHoldSeconds), [{ type: 'combat.attack', on: true }]));
    merge(k.run(1, [{ type: 'combat.attack', on: false }]));
  } else merge(k.run(1, [{ type: 'combat.attack', on: true }, { type: 'combat.attack', on: false }]));
  for (let i = 0; i < 120 && k.combat.state.player.phase !== 'erholung'; i++) merge(k.run(1));
  return all;
}

/** Runs until the player is ready again. */
function recover(k: KampfWelt): void {
  runUntil(k, () => k.combat.state.player.phase === 'bereit', 200);
}

describe('Schwert', () => {
  it('3er-Kombo im Kombofenster: Schritte 1, 2, 3, dann wieder 1 – der dritte mit seinem Faktor', () => {
    const k = kampfWelt();
    k.hold('probe_schwert');
    k.aimBy(20, 0);
    const d = k.dummy(14, 0, { health: 1e6, maxHealth: 1e6 });
    const steps: number[] = [];
    for (let i = 0; i < 4; i++) {
      const ev = swing(k);
      steps.push(...eventsOf<{ kombo: number }>(ev, 'attackStarted').map((e) => e.kombo));
      recover(k);
    }
    expect(steps).toEqual([1, 2, 3, 1]);
    const [f1, f2, f3] = waffe('probe_schwert').kombo ?? [];
    const amounts = d.hits.map((h) => (h.crit ? h.amount / C.damage.critFactor : h.amount));
    expect(amounts[0]).toBeCloseTo(8 * (f1 ?? 0), 6);
    expect(amounts[1]).toBeCloseTo(8 * (f2 ?? 0), 6);
    expect(amounts[2]).toBeCloseTo(8 * (f3 ?? 0), 6);
  });

  it('nach dem Kombofenster beginnt die Kombo neu', () => {
    const k = kampfWelt();
    k.hold('probe_schwert');
    swing(k);
    recover(k);
    k.run(secondsToTicks(A.comboWindowSeconds) + 1);
    expect(eventsOf<{ kombo: number }>(swing(k), 'attackStarted').map((e) => e.kombo)).toEqual([1]);
  });

  it('schwer: der Rundumhieb trifft auch hinter und neben der Figur', () => {
    const k = kampfWelt();
    k.hold('probe_schwert');
    k.aimBy(20, 0);
    const around = [k.dummy(14, 0), k.dummy(-14, 0), k.dummy(0, 14), k.dummy(0, -14)];
    const ev = swing(k, true);
    expect(eventsOf(ev, 'attackStarted')).toEqual([expect.objectContaining({ schwer: true, bogen: 360 })]);
    for (const d of around) expect(d.hits).toHaveLength(1);
    const light = kampfWelt();
    light.hold('probe_schwert');
    light.aimBy(20, 0);
    const behind = light.dummy(-14, 0);
    swing(light);
    expect(behind.hits).toEqual([]);
  });
});

describe('Axt', () => {
  it('schwer: Rüstungsbruch – der Treffer bricht Rüstung auf Zeit', () => {
    const k = kampfWelt();
    k.hold('probe_kampfaxt');
    k.aimBy(20, 0);
    const d = k.dummy(14, 0);
    swing(k, true);
    expect(d.hits[0]).toMatchObject({ armorBreak: C.axe.armorBreakPoints, armorBreakSeconds: C.axe.armorBreakSeconds });
    const light = kampfWelt();
    light.hold('probe_kampfaxt');
    light.aimBy(20, 0);
    const l = light.dummy(14, 0);
    swing(light);
    expect(l.hits[0]?.armorBreak).toBe(0);
  });

  it('gebrochene Rüstung am Spieler hält ihre Zeit, dann ist sie zurück', () => {
    const k = kampfWelt();
    k.wear('probe_brustpanzer', 'brust');
    const foe = k.dummy(12, 0);
    k.strikePlayer(foe, { critChance: 0, damage: 1, armorBreak: 10, armorBreakSeconds: 2 });
    expect(k.combat.state.player.armorBreak).toBe(10);
    const h = k.strikePlayer(foe, { critChance: 0, damage: 10 });
    expect(h?.amount).toBeCloseTo(10 * (1 - 2 / 52), 12);
    k.run(secondsToTicks(2));
    expect(k.combat.state.player.armorBreak).toBe(10);
    k.run(2);
    expect(k.combat.state.player.armorBreak).toBe(0);
  });

  it('fällt Bäume mit 50 %: der Faktor der Kampfaxt und doppelt so viele Hiebe am Baum', () => {
    const k = kampfWelt();
    k.hold('probe_kampfaxt');
    expect(k.combat.objectPowerFactor()).toBe(C.axe.fellPowerFactor);
    k.hold('probe_schwert');
    expect(k.combat.objectPowerFactor()).toBe(1);
    // The gathering hook: the same stone axe needs twice the hits at half power.
    const g = gatherWorld(['.....', '..E..', '.....']);
    g.place(1, 1);
    g.hold('probe_steinaxt');
    const hit = createObjectHit();
    const plan = createHarvestPlan();
    const tree = g.tile(2, 1);
    expect(g.gathering.objectAt(0, tree.tx, tree.ty, hit)).toBe(true);
    const tool = g.interaction.heldTool();
    g.gathering.planObject(g.sim, hit, tool, plan);
    const full = plan.hitsTotal;
    g.gathering.setObjectPowerFactor(() => C.axe.fellPowerFactor);
    g.gathering.planObject(g.sim, hit, tool, plan);
    expect(full).toBeGreaterThan(0);
    expect(plan.hitsTotal).toBeGreaterThanOrEqual(2 * full - 1);
    expect(plan.hitsTotal).toBeLessThanOrEqual(2 * full);
  });
});

describe('Keule', () => {
  it('Wucht und hoher Stagger: längerer Hitstop, weiterer Rückstoß, längeres Taumeln als das Schwert', () => {
    const club = kampfWelt();
    club.hold('probe_keule');
    club.aimBy(20, 0);
    const c = club.dummy(14, 0);
    swing(club);
    const sword = kampfWelt();
    sword.hold('probe_schwert');
    sword.aimBy(20, 0);
    const s = sword.dummy(14, 0);
    swing(sword);
    const ch = c.hits[0];
    const sh = s.hits[0];
    expect(ch?.staggerTicks).toBe(secondsToTicks(waffe('probe_keule').stagger));
    expect(ch?.staggerTicks).toBeGreaterThan(sh?.staggerTicks ?? Infinity);
    expect(ch?.hitstopTicks).toBe(hitstopTicks(4));
    expect(ch?.knockback).toBeGreaterThan(sh?.knockback ?? Infinity);
  });
});

describe('Speer', () => {
  it('Reichweite: trifft, wo das Schwert nicht mehr hinreicht', () => {
    const spear = contentItemCatalog().get('steinspeer').waffe;
    expect(spear?.reichweite).toBeGreaterThan(waffe('probe_schwert').reichweite);
    const k = kampfWelt();
    k.hold('steinspeer');
    k.aimBy(40, 0);
    // Reach counts to the body's edge (radius 6): 21 px lies beyond the sword's 20, within the spear's 28.
    const d = k.dummy(27, 0);
    swing(k);
    expect(d.hits).toHaveLength(1);
    const s = kampfWelt();
    s.hold('probe_schwert');
    s.aimBy(40, 0);
    const out = s.dummy(27, 0);
    swing(s);
    expect(out.hits).toEqual([]);
  });

  it('schwer: der Speer fliegt als Projektil, trifft und bleibt als Drop liegen (mit seiner Haltbarkeit)', () => {
    const k = kampfWelt();
    k.hold('steinspeer');
    k.aimBy(100, 0);
    const d = k.dummy(80, 0);
    const ev = swing(k, true);
    expect(eventsOf(ev, 'projectileFired')).toEqual([expect.objectContaining({ item: 'steinspeer', owner: k.sim.player })]);
    expect(k.inventory.selected()).toBeNull();
    runUntil(k, () => k.combat.projectiles.size === 0, 60);
    expect(d.hits).toHaveLength(1);
    expect(d.hits[0]?.type).toBe('stich');
    expect(k.landed).toEqual([expect.objectContaining({ stack: expect.objectContaining({ item: 'steinspeer', count: 1, haltbarkeit: 60 }) })]);
  });
});

describe('Dolch', () => {
  it('Rückenangriff ×3 beim Schleichen, wenn das Ziel den Spieler nicht bemerkt', () => {
    const base = waffe('probe_dolch').schaden;
    const cases: Array<[sneak: boolean, aware: boolean, factor: number]> = [
      [true, false, C.dagger.backstabFactor],
      [true, true, 1],
      [false, false, 1],
    ];
    for (const [sneak, aware, factor] of cases) {
      const k = kampfWelt();
      k.hold('probe_dolch');
      k.aimBy(20, 0);
      const d = k.dummy(12, 0, { aware });
      if (sneak) k.run(1, [{ type: 'player.sneak', on: true }]);
      const ev = swing(k);
      const h = d.hits[0];
      const amount = h === undefined ? 0 : h.crit ? h.amount / C.damage.critFactor : h.amount;
      expect(amount, `schleichen ${sneak}, bemerkt ${aware}`).toBeCloseTo(base * factor, 6);
      expect(eventsOf<{ backstab: boolean }>(ev, 'hitLanded')[0]?.backstab).toBe(factor > 1);
    }
  });

  it('der Dolch ist schnell: kürzeres Ausholen als das Schwert', () => {
    const dagger = secondsToTicks(waffe('probe_dolch').tempo * A.windupShare);
    const sword = secondsToTicks(waffe('probe_schwert').tempo * A.windupShare);
    expect(dagger).toBeLessThan(sword);
  });
});

describe('Zweihand', () => {
  it('breit: trifft auch weit seitlich, was das Schwert nicht erreicht', () => {
    const k = kampfWelt();
    k.hold('probe_zweihand');
    k.aimBy(20, 0);
    const side = k.dummy(6, 16);
    swing(k);
    expect(side.hits).toHaveLength(1);
    const s = kampfWelt();
    s.hold('probe_schwert');
    s.aimBy(20, 0);
    const sideS = s.dummy(6, 16);
    swing(s);
    expect(sideS.hits).toEqual([]);
  });

  it('Licht an den Gürtel: mit Zweihandwaffe hängt die Fackel am Gürtel (−40 %), mit Schwert in der Nebenhand', () => {
    const k = kampfWelt();
    k.offhand('fackel');
    k.hold('probe_zweihand');
    expect(k.combat.twoHandedRule(catalog.get('probe_zweihand'))).toBe(true);
    expect(findCarriedLight(k.inventory.state, catalog, k.combat.twoHandedRule)?.mode).toBe('guertel');
    k.hold('probe_schwert');
    expect(findCarriedLight(k.inventory.state, catalog, k.combat.twoHandedRule)?.mode).toBe('hand');
  });

  it('langsam: das längste Ausholen der Nahkampfklassen', () => {
    const windup = (id: string) => secondsToTicks(waffe(id).tempo * A.windupShare);
    for (const id of ['probe_schwert', 'probe_kampfaxt', 'probe_keule', 'probe_dolch']) expect(windup('probe_zweihand')).toBeGreaterThan(windup(id));
  });
});
