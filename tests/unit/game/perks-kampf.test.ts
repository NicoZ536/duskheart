/**
 * M6-34 Perks Nahkampf, Fernkampf, Verteidigung (MASTERPROMPT §23.2 "Bei 30/60/90 Wahl zwischen 2 Perks …, alle spürbar
 * (keine reinen +1-%-Perks)"; docs/SPIEL.md §14 "Perks (18)"): the perk content (six per combat skill, two per perk level),
 * one test per perk that the chosen perk changes the fight measurably against the same fight without it, the skill bonus
 * (+0,5 % per level) of the three combat skills, and the wiring of `createSimulation` (the real skill system: a perk chosen
 * with `skills.choosePerk` acts).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { COMBAT_PERK_SKILLS, PERK_EFFECTS, PERKS, type PerkDef } from '../../../src/content/perks';
import { PARRY_WINDOW_TICKS, hitDamage, hitstopTicks, knockbackPx, secondsToTicks, tension } from '../../../src/game/combat/formulas';
import { CombatPerks } from '../../../src/game/combat/perks';
import { CombatSystem, createCombatAttack } from '../../../src/game/combat/system';
import type { HitResult } from '../../../src/game/combat/targets';
import { createSimulation } from '../../../src/game/setup';
import type { SimSystem } from '../../../src/game/sim';
import type { SkillsSystem } from '../../../src/game/skills/system';
import type { SkillState } from '../../../src/game/skills/state';
import { eventsOf, kampfCatalog, kampfWelt, meadow, type Dummy, type KampfWelt } from './kampf-testwelt';

const A = BALANCE.combat.attack;
const R = BALANCE.combat.ranged;
const catalog = kampfCatalog();
const SWORD = catalog.get('probe_schwert').waffe;
const CLUB = catalog.get('probe_keule').waffe;
const DAGGER = catalog.get('probe_dolch').waffe;
const BOW = catalog.get('kurzbogen').waffe;
if (SWORD === undefined || CLUB === undefined || DAGGER === undefined || BOW === undefined) throw new Error('fixture weapons without waffe');
const HEAVY_HOLD = secondsToTicks(A.heavyHoldSeconds);
const DRAW = secondsToTicks(R.bowDrawSeconds);

function perk(id: string): PerkDef {
  const p = PERKS.find((x) => x.id === id);
  if (p === undefined) throw new Error(`no perk ${id}`);
  return p;
}

/** Skills of level 1 (no bonus) with exactly the perk `id` chosen – the perk alone, against the same fight without it. */
function onlyPerk(id: string | null): Pick<SkillsSystem, 'skill' | 'bonus'> {
  const p = id === null ? null : perk(id);
  return {
    bonus: () => 0,
    skill: (s: string): Readonly<SkillState> => ({ level: BALANCE.skills.maxLevel, xp: 0, perks: p !== null && s === p.fertigkeit ? [{ level: p.stufe, choice: p.wahl }] : [] }),
  };
}

/** A combat test world whose player has only the perk `id` (or none). */
function welt(id: string | null, seed = 1): KampfWelt {
  const k = kampfWelt(meadow(40, 20), { x: 10, y: 10 }, seed);
  k.combat.usePerks(new CombatPerks(onlyPerk(id)));
  return k;
}

/** A light blow (press and release) with the held weapon; runs until it was struck (a hitstop may hold the wind-up). */
function lightBlow(k: KampfWelt, tempo: number): void {
  const struck = (ev: Map<string, unknown[]>): boolean => eventsOf(ev, 'attackStarted').length > 0;
  if (struck(k.run(Math.max(1, secondsToTicks(tempo * A.windupShare)) + 1, [{ type: 'combat.attack', on: true }, { type: 'combat.attack', on: false }]))) return;
  for (let i = 0; i < secondsToTicks(tempo); i++) if (struck(k.run(1))) return;
}

/** A heavy blow: held past the heavy hold, released. */
function heavyBlow(k: KampfWelt): void {
  k.run(HEAVY_HOLD + 1, [{ type: 'combat.attack', on: true }]);
  k.run(1, [{ type: 'combat.attack', on: false }]);
}

/** Draws the held bow for `ticks` and releases. */
function shoot(k: KampfWelt, ticks: number): Map<string, unknown[]> {
  k.run(ticks, [{ type: 'combat.attack', on: true }]);
  return k.run(1, [{ type: 'combat.attack', on: false }]);
}

/** A foe that strikes the player (10 damage) in tick `at`. */
function foeStrikesAt(k: KampfWelt, foe: Dummy, at: number, out: { hit: HitResult | null }): void {
  const system: SimSystem = {
    id: `angreifer-${at}`,
    timeScope: 'global',
    update: (sim) => {
      if (sim.tick !== at) return;
      const h = k.combat.resolve(sim, foe.entity, sim.player, { ...createCombatAttack(), team: foe.team, damage: 10, wucht: 2, staggerSeconds: 0.3, critChance: 0, fromX: foe.x, fromY: foe.y });
      out.hit = h === null ? null : { ...h };
    },
  };
  k.sim.addSystem(system);
}

describe('Perk-Inhalt', () => {
  it('18 Perks: je 6 für Nahkampf, Fernkampf, Verteidigung, je Perkstufe genau die Wahlen 0 und 1', () => {
    expect(PERKS).toHaveLength(18);
    for (const skill of COMBAT_PERK_SKILLS) {
      const own = PERKS.filter((p) => p.fertigkeit === skill);
      expect(own, skill).toHaveLength(6);
      for (const level of BALANCE.skills.perkLevels) expect(own.filter((p) => p.stufe === level).map((p) => p.wahl).sort(), `${skill} ${level}`).toEqual([0, 1]);
    }
    expect(CONTENT.collection('perks').size).toBe(18);
    expect(CONTENT.countsByCategory().perks).toBe(18);
  });

  it('jede Wirkungsart wird von einem Perk genutzt, jede mit Text DE/EN', () => {
    expect(new Set(PERKS.flatMap((p) => p.wirkung.map((w) => w.art)))).toEqual(new Set(PERK_EFFECTS));
    for (const p of PERKS) {
      expect(p.name.de.length * p.name.en.length).toBeGreaterThan(0);
      expect(p.beschreibung.de.length * p.beschreibung.en.length).toBeGreaterThan(0);
    }
  });
});

describe('Nahkampf-Perks', () => {
  it('Wuchtschlag: der schwere Schlag trifft 30 % härter', () => {
    const amount = (id: string | null): number => {
      const k = welt(id);
      k.hold('probe_keule');
      k.aimBy(20, 0);
      const d = k.dummy(14, 0);
      heavyBlow(k);
      return d.hits[0]?.amount ?? 0;
    };
    expect(amount(null)).toBeGreaterThan(0);
    expect(amount('wuchtschlag') / amount(null)).toBeCloseTo(1.3, 9);
  });

  it('Langer Atem: ein Schlag kostet 30 % weniger Ausdauer', () => {
    const cost = (id: string | null): number => {
      const k = welt(id);
      k.hold('probe_schwert');
      const before = k.vit().stamina;
      lightBlow(k, SWORD.tempo);
      return before - k.vit().stamina;
    };
    expect(cost(null)).toBeCloseTo(SWORD.ausdauer, 9);
    expect(cost('langer_atem')).toBeCloseTo(SWORD.ausdauer * 0.7, 9);
  });

  it('Schwachstelle: deutlich mehr kritische Treffer (5 % → 15 %)', () => {
    const crits = (id: string | null): number => {
      const k = welt(id, 7);
      k.hold('probe_dolch');
      k.aimBy(20, 0);
      const d = k.dummy(10, 0, { health: 1e9, maxHealth: 1e9 });
      for (let i = 0; i < 80; i++) {
        k.vit().stamina = 100;
        lightBlow(k, DAGGER.tempo);
        k.run(secondsToTicks(DAGGER.tempo));
      }
      expect(d.hits).toHaveLength(80);
      return d.hits.filter((h) => h.crit).length;
    };
    const base = crits(null);
    const sharp = crits('schwachstelle');
    expect(sharp).toBeGreaterThan(base);
    expect(sharp).toBeGreaterThanOrEqual(6);
  });

  it('Taumelhieb: Gegner taumeln 60 % länger', () => {
    const stagger = (id: string | null): number => {
      const k = welt(id);
      k.hold('probe_keule');
      k.aimBy(20, 0);
      const d = k.dummy(14, 0);
      lightBlow(k, CLUB.tempo);
      return d.hits[0]?.staggerTicks ?? 0;
    };
    expect(stagger(null)).toBe(secondsToTicks(CLUB.stagger));
    expect(stagger('taumelhieb')).toBe(secondsToTicks(CLUB.stagger * 1.6));
  });

  it('Gnadenstoß: +50 % gegen Gegner unter 30 % Leben, sonst nichts', () => {
    const amount = (id: string | null, health: number): number => {
      const k = welt(id);
      k.hold('probe_schwert');
      k.aimBy(20, 0);
      const d = k.dummy(14, 0, { health, maxHealth: 100 });
      lightBlow(k, SWORD.tempo);
      return d.hits[0]?.amount ?? 0;
    };
    expect(amount('gnadenstoss', 29) / amount(null, 29)).toBeCloseTo(1.5, 9);
    expect(amount('gnadenstoss', 60)).toBeCloseTo(amount(null, 60), 9);
  });

  it('Blutrausch: wer im Nahkampf fällt, gibt 20 Ausdauer und 5 Leben zurück', () => {
    const after = (id: string | null): { stamina: number; health: number } => {
      const k = welt(id);
      k.hold('probe_schwert');
      k.aimBy(20, 0);
      k.dummy(14, 0, { health: 1 });
      k.vit().health = 50;
      k.vit().stamina = 50;
      lightBlow(k, SWORD.tempo);
      return { stamina: k.vit().stamina, health: k.vit().health };
    };
    const base = after(null);
    const rage = after('blutrausch');
    expect(rage.stamina - base.stamina).toBeCloseTo(20, 6);
    expect(rage.health - base.health).toBeCloseTo(5, 6);
  });
});

describe('Fernkampf-Perks', () => {
  it('Ruhige Hand: auch ohne Zielen streut der Schuss nur so wenig wie beim Zielen', () => {
    const spread = (id: string | null): number => {
      let max = 0;
      for (let i = 0; i < 30; i++) {
        const k = welt(id, 500 + i);
        k.hold('kurzbogen');
        k.pack('pfeil_feuerstein', 1);
        k.aimBy(100, 0);
        shoot(k, DRAW);
        const c = k.combat.projectiles.columns;
        max = Math.max(max, Math.abs((c.vy[0] as number) / (c.vx[0] as number)));
      }
      return max;
    };
    const bound = Math.tan((R.spreadDeg.bogen * Math.PI) / 180) * BALANCE.combat.aimMode.spreadFactor;
    expect(spread(null)).toBeGreaterThan(bound);
    expect(spread('ruhige_hand')).toBeLessThanOrEqual(bound + 1e-9);
  });

  it('Schnellspanner: der Bogen ist 30 % früher gespannt, die Armbrust lädt 30 % schneller', () => {
    const windup = (id: string | null, weapon: string, ammo: string): number => {
      const k = welt(id);
      k.hold(weapon);
      k.pack(ammo, 5);
      const ev = k.run(1, [{ type: 'combat.attack', on: true }]);
      return eventsOf<{ ticks: number }>(ev, 'attackWindup')[0]?.ticks ?? -1;
    };
    expect(windup(null, 'kurzbogen', 'pfeil_feuerstein')).toBe(DRAW);
    expect(windup('schnellspanner', 'kurzbogen', 'pfeil_feuerstein')).toBe(Math.round(DRAW * 0.7));
    const reload = secondsToTicks(R.crossbowReloadSeconds);
    expect(windup(null, 'armbrust', 'bolzen_bronze')).toBe(reload);
    expect(windup('schnellspanner', 'armbrust', 'bolzen_bronze')).toBe(Math.round(reload * 0.7));
    // Full tension comes sooner: after 0,7 of the draw the quick archer's shot is full.
    expect(tension(Math.round(DRAW * 0.7), Math.round(DRAW * 0.7))).toBe(1);
  });

  it('Kraftschuss: voll gespannt +30 % Schaden, halb gespannt nichts', () => {
    const damage = (id: string | null, ticks: number): number => {
      const k = welt(id);
      k.hold('kurzbogen');
      k.pack('pfeil_feuerstein', 3);
      k.aimBy(100, 0);
      shoot(k, ticks);
      return k.combat.projectiles.columns.damage[0] as number;
    };
    expect(damage('kraftschuss', DRAW) / damage(null, DRAW)).toBeCloseTo(1.3, 6);
    expect(damage('kraftschuss', DRAW / 2)).toBeCloseTo(damage(null, DRAW / 2), 6);
  });

  it('Sparsamer Schütze: ein Teil der Schüsse verbraucht keinen Pfeil', () => {
    const used = (id: string | null): number => {
      const k = welt(id, 11);
      k.hold('kurzbogen');
      k.pack('pfeil_feuerstein', 20);
      k.aimBy(100, 0);
      for (let i = 0; i < 20; i++) {
        k.vit().stamina = 100;
        shoot(k, DRAW);
        k.run(secondsToTicks(BOW.tempo) + 1);
      }
      return 20 - k.inventory.count('pfeil_feuerstein');
    };
    expect(used(null)).toBe(20);
    const thrifty = used('sparsamer_schuetze');
    expect(thrifty).toBeLessThan(20);
    expect(thrifty).toBeGreaterThan(5);
  });

  it('Weitschuss: der Pfeil fliegt 30 % schneller und 30 % weiter', () => {
    const shot = (id: string | null): { speed: number; flight: number } => {
      const k = welt(id);
      k.hold('kurzbogen');
      k.pack('pfeil_feuerstein', 1);
      k.aimBy(100, 0);
      shoot(k, DRAW);
      const c = k.combat.projectiles.columns;
      const speed = Math.hypot(c.vx[0] as number, c.vy[0] as number);
      let flight = 0;
      while (k.combat.projectiles.size > 0 && flight < 600) {
        k.run(1);
        flight++;
      }
      return { speed, flight };
    };
    const base = shot(null);
    const far = shot('weitschuss');
    expect(far.speed / base.speed).toBeCloseTo(1.3, 6);
    expect(base.speed).toBeCloseTo(BOW.geschoss?.geschwindigkeit ?? 0, 6);
    // Reach × 1,3 at speed × 1,3: the same flight time, 30 % farther.
    expect(Math.abs(far.flight - base.flight)).toBeLessThanOrEqual(1);
  });

  it('Wurfkunst: Wurfwaffen treffen 40 % härter und fliegen 50 % weiter', () => {
    const knife = (id: string | null): number => {
      const k = welt(id);
      k.hold('wurfmesser_feuerstein', 2);
      k.aimBy(60, 0);
      const d = k.dummy(60, 0);
      k.run(secondsToTicks(R.throwDrawSeconds), [{ type: 'combat.attack', on: true }]);
      k.run(1, [{ type: 'combat.attack', on: false }]);
      for (let i = 0; i < 120 && k.combat.projectiles.size > 0; i++) k.run(1);
      return d.hits[0]?.amount ?? 0;
    };
    expect(knife('wurfkunst') / knife(null)).toBeCloseTo(1.4, 6);
    const flask = (id: string | null): number => {
      const k = welt(id);
      k.hold('brandflasche', 1);
      k.aimBy(400, 0);
      const x0 = k.pos().x;
      k.run(secondsToTicks(R.throwDrawSeconds), [{ type: 'combat.attack', on: true }]);
      const ev = k.run(1, [{ type: 'combat.attack', on: false }]);
      expect(eventsOf(ev, 'projectileFired')).toHaveLength(1);
      let landed = -1;
      for (let i = 0; i < 300 && landed < 0; i++) {
        const hit = eventsOf<{ x: number }>(k.run(1), 'projectileHit')[0];
        if (hit !== undefined) landed = hit.x - x0;
      }
      return landed;
    };
    const reach = catalog.get('brandflasche').waffe?.reichweite ?? 0;
    expect(flask(null)).toBeCloseTo(reach, 0);
    expect(flask('wurfkunst')).toBeCloseTo(reach * 1.5, 0);
  });
});

describe('Perk-Wirkung am Einschlag über den Haken `ProjectileImpact` (M6-45)', () => {
  /**
   * A fire flask thrown 100 px east; a foe `off` px south of the aim. Returns the burst radius, whether the foe was hit and
   * how far from the burst it stood (the throw's spread moves the landing point a little – the same in every world of a seed).
   */
  function flaskAt(id: string | null, off: number): { radius: number; hit: boolean; from: number } {
    const k = welt(id);
    k.hold('brandflasche', 1);
    k.aimBy(100, 0);
    k.run(secondsToTicks(R.throwDrawSeconds), [{ type: 'combat.attack', on: true }]);
    k.run(1, [{ type: 'combat.attack', on: false }]);
    let burst: { x: number; y: number; radius: number } | undefined;
    for (let i = 0; i < 300 && burst === undefined; i++) {
      const at = k.pos();
      if (i === 0) k.dummy(100, off);
      burst = eventsOf<{ x: number; y: number; radius: number }>(k.run(1), 'projectileHit')[0];
      if (burst !== undefined) expect(Math.abs(burst.x - (at.x + 100))).toBeLessThanOrEqual(2);
    }
    if (burst === undefined) throw new Error('the flask did not burst');
    const d = k.dummies.list[0];
    return { radius: burst.radius, hit: (d?.hits.length ?? 0) > 0, from: d === undefined ? Number.NaN : Math.hypot(d.x - burst.x, d.y - burst.y) };
  }

  it('Wurfkunst: die Brandflasche platzt in einem 30 % weiteren Umkreis – ein Gegner knapp außerhalb wird getroffen', () => {
    const base = catalog.get('brandflasche').waffe?.wurf?.radius ?? 0;
    expect(base).toBe(20);
    expect(flaskAt(null, 0).radius).toBe(base);
    expect(flaskAt('wurfkunst', 0).radius).toBeCloseTo(base * 1.3, 9);
    // A foe just beyond 20 px + its body (6 px) from the burst, within 26 + 6: only the wider burst reaches it.
    const plain = flaskAt(null, 26);
    const wide = flaskAt('wurfkunst', 26);
    expect(plain.from).toBeGreaterThan(base + 6);
    expect(wide.from).toBeLessThanOrEqual(base * 1.3 + 6);
    expect(plain.hit).toBe(false);
    expect(wide.hit).toBe(true);
  });

  it('Sparsamer Schütze: drei von vier verschossenen Pfeilen lassen sich aufsammeln statt der Hälfte', () => {
    const found = (id: string | null): { shots: number; drops: number } => {
      const k = welt(id, 5);
      k.hold('kurzbogen');
      k.pack('pfeil_feuerstein', 60);
      k.aimBy(100, 0);
      let shots = 0;
      let drops = 0;
      for (let i = 0; i < 60; i++) {
        k.vit().stamina = 100;
        shoot(k, DRAW);
        for (let t = 0; t < 120 && k.combat.projectiles.size > 0; t++) {
          const stuck = eventsOf<{ wo: string; drop: boolean }>(k.run(1), 'projectileStuck')[0];
          if (stuck === undefined) continue;
          shots++;
          if (stuck.drop) drops++;
        }
        k.run(secondsToTicks(BOW.tempo) + 1);
      }
      return { shots, drops };
    };
    const plain = found(null);
    const thrifty = found('sparsamer_schuetze');
    expect(plain.shots).toBe(60);
    expect(thrifty.shots).toBe(60);
    expect(BALANCE.combat.projectile.recoverChance).toBe(0.5);
    // 60 draws each: the half and three quarters within their binomial spread.
    expect(plain.drops / plain.shots).toBeGreaterThan(0.35);
    expect(plain.drops / plain.shots).toBeLessThan(0.65);
    expect(thrifty.drops / thrifty.shots).toBeGreaterThan(0.6);
    expect(thrifty.drops).toBeGreaterThan(plain.drops);
  });

  it('der Haken gilt nur den Geschossen des Spielers', () => {
    const k = welt('wurfkunst');
    expect(k.combat.modifiers().throwRadius).toBeCloseTo(1.3, 9);
    const foe = k.dummy(40, 0);
    expect(k.combat.impact.burstRadius(k.sim, k.sim.player, 20)).toBeCloseTo(26, 9);
    expect(k.combat.impact.burstRadius(k.sim, foe.entity, 20)).toBe(20);
    const s = welt('sparsamer_schuetze');
    expect(s.combat.modifiers().recover).toBeCloseTo(0.25, 9);
    expect(s.combat.impact.recoverChance(s.sim, s.sim.player, 0.5)).toBeCloseTo(0.75, 9);
    expect(s.combat.impact.recoverChance(s.sim, s.dummy(40, 0).entity, 0.5)).toBe(0.5);
    // Never above certainty.
    expect(s.combat.impact.recoverChance(s.sim, s.sim.player, 0.9)).toBe(1);
  });
});

describe('Verteidigungs-Perks', () => {
  /** The player blocks with the wooden shield towards a foe to the east, past the parry window. */
  function blocking(id: string | null): { k: KampfWelt; foe: Dummy } {
    const k = welt(id);
    k.offhand('holzschild');
    k.aimBy(30, 0);
    const foe = k.dummy(12, 0);
    k.run(PARRY_WINDOW_TICKS + 12, [{ type: 'combat.block', on: true }]);
    return { k, foe };
  }

  it('Schildwall: der Holzschild fängt 55 % statt 40 % ab', () => {
    const base = blocking(null);
    expect(base.k.strikePlayer(base.foe, { critChance: 0, damage: 10 })?.amount).toBeCloseTo(hitDamage(10, 0, 0, false, 0.4), 9);
    const wall = blocking('schildwall');
    expect(wall.k.strikePlayer(wall.foe, { critChance: 0, damage: 10 })?.amount).toBeCloseTo(hitDamage(10, 0, 0, false, 0.55), 9);
  });

  it('Zäher Arm: Blocken kostet 35 % weniger Ausdauer', () => {
    const cost = (id: string | null): number => {
      const { k, foe } = blocking(id);
      return k.strikePlayer(foe, { critChance: 0, damage: 10 })?.blockStamina ?? -1;
    };
    expect(cost(null)).toBeCloseTo(10 * 0.4 * 1, 9);
    expect(cost('zaeher_arm')).toBeCloseTo(10 * 0.4 * 0.65, 9);
  });

  it('Paradekunst: ein Block 12 Ticks vor dem Treffer pariert noch (0,25 s statt 0,15 s)', () => {
    const hitAfter = (id: string | null, delay: number): HitResult | null => {
      const k = welt(id);
      k.hold('probe_schwert');
      k.aimBy(30, 0);
      const foe = k.dummy(12, 0);
      const out = { hit: null as HitResult | null };
      foeStrikesAt(k, foe, k.sim.tick + delay, out);
      k.run(delay + 1, [{ type: 'combat.block', on: true }]);
      return out.hit;
    };
    expect(hitAfter(null, 12)).toMatchObject({ parried: false, blocked: true });
    expect(hitAfter('paradekunst', 12)).toMatchObject({ parried: true, amount: 0 });
    expect(hitAfter('paradekunst', PARRY_WINDOW_TICKS + secondsToTicks(0.1))).toMatchObject({ parried: true });
    expect(hitAfter('paradekunst', PARRY_WINDOW_TICKS + secondsToTicks(0.1) + 1)).toMatchObject({ parried: false });
  });

  it('Standfest: halber Rückstoß und halbes Taumeln', () => {
    const hit = (id: string | null): HitResult | null => {
      const k = welt(id);
      return k.strikePlayer(k.dummy(12, 0), { critChance: 0, damage: 1, wucht: 5, staggerSeconds: 0.6 });
    };
    expect(hit(null)).toMatchObject({ knockback: knockbackPx(5), staggerTicks: secondsToTicks(0.6), hitstopTicks: hitstopTicks(5) });
    expect(hit('standfest')).toMatchObject({ knockback: knockbackPx(5) * 0.5, staggerTicks: secondsToTicks(0.3) });
  });

  it('Vergeltung: der Treffer auf den parierten Gegner richtet 50 % mehr an', () => {
    const riposte = (id: string | null): HitResult | undefined => {
      const k = welt(id);
      k.hold('probe_schwert');
      k.aimBy(30, 0);
      const foe = k.dummy(12, 0);
      const out = { hit: null as HitResult | null };
      foeStrikesAt(k, foe, k.sim.tick + 2, out);
      k.run(3, [{ type: 'combat.block', on: true }]);
      expect(out.hit).toMatchObject({ parried: true });
      k.run(1, [{ type: 'combat.block', on: false }]);
      lightBlow(k, SWORD.tempo);
      return foe.hits.find((h) => !h.parried);
    };
    const base = riposte(null);
    const vengeful = riposte('vergeltung');
    expect(base).toMatchObject({ crit: true });
    expect(vengeful).toMatchObject({ crit: true });
    expect((vengeful?.amount ?? 0) / (base?.amount ?? 1)).toBeCloseTo(1.5, 9);
  });

  it('Ausweichkünstler: wer durch einen Angriff rollt, bekommt 15 Ausdauer zurück', () => {
    const stamina = (id: string | null): number => {
      const k = welt(id);
      const foe = k.dummy(12, 0);
      k.vit().stamina = 50;
      k.run(1, [{ type: 'player.roll', dx: 0, dy: 1 }]);
      expect(k.strikePlayer(foe)).toBeNull();
      return k.vit().stamina;
    };
    expect(stamina('ausweichkuenstler') - stamina(null)).toBeCloseTo(15, 6);
  });
});

describe('Fertigkeitsbonus der Kampffertigkeiten (+0,5 % je Stufe)', () => {
  /** Skills at `level` for `skill` (others at 1), no perk chosen. */
  function levels(skill: string, level: number): Pick<SkillsSystem, 'skill' | 'bonus'> {
    const K = BALANCE.skills;
    return {
      bonus: (s: string) => (s === skill ? (level - 1) * K.bonusPerLevel : 0),
      skill: (): Readonly<SkillState> => ({ level: 1, xp: 0, perks: [] }),
    };
  }

  it('Nahkampf 41: Schläge +20 %; Fernkampf 41: Schüsse +20 %; Verteidigung 41: der Block lässt 20 % weniger durch', () => {
    const blow = (s: Pick<SkillsSystem, 'skill' | 'bonus'>): number => {
      const k = kampfWelt();
      k.combat.usePerks(new CombatPerks(s));
      k.hold('probe_schwert');
      k.aimBy(20, 0);
      const d = k.dummy(14, 0);
      lightBlow(k, SWORD.tempo);
      return d.hits[0]?.amount ?? 0;
    };
    expect(blow(levels('nahkampf', 41)) / blow(levels('fernkampf', 41))).toBeCloseTo(1.2, 9);
    const k = kampfWelt();
    k.combat.usePerks(new CombatPerks(levels('fernkampf', 41)));
    k.hold('kurzbogen');
    k.pack('pfeil_feuerstein', 1);
    k.aimBy(100, 0);
    shoot(k, DRAW);
    expect(k.combat.projectiles.columns.damage[0]).toBeCloseTo((BOW.schaden + 2) * 1.2, 5);
    const guard = kampfWelt();
    guard.combat.usePerks(new CombatPerks(levels('verteidigung', 41)));
    guard.offhand('holzschild');
    guard.aimBy(30, 0);
    const foe = guard.dummy(12, 0);
    guard.run(PARRY_WINDOW_TICKS + 12, [{ type: 'combat.block', on: true }]);
    expect(guard.strikePlayer(foe, { critChance: 0, damage: 10 })?.amount).toBeCloseTo(10 * 0.6 * 0.8, 9);
  });
});

describe('Verdrahtung in createSimulation', () => {
  it('ein mit skills.choosePerk gewählter Perk wirkt im Kampfsystem; die Stufe bringt ihren Bonus', () => {
    const sim = createSimulation({ seed: 3, worldSize: 'small' });
    const combat = sim.systems.find((s): s is CombatSystem => s instanceof CombatSystem);
    if (combat === undefined) throw new Error('no combat system');
    expect(combat.modifiers()).toMatchObject({ heavyDamage: 1, meleeDamage: 1 });
    sim.step([{ type: 'debug.unlock', skill: 'nahkampf' }]);
    expect(combat.modifiers().meleeDamage).toBeCloseTo(1 + (BALANCE.skills.maxLevel - 1) * BALANCE.skills.bonusPerLevel, 9);
    expect(combat.modifiers().heavyDamage).toBe(1);
    sim.step([{ type: 'skills.choosePerk', skill: 'nahkampf', level: 30, choice: 0 }]);
    expect(combat.modifiers().heavyDamage).toBeCloseTo(1.3, 9);
    sim.step([{ type: 'skills.choosePerk', skill: 'nahkampf', level: 60, choice: 1 }]);
    expect(combat.modifiers()).toMatchObject({ heavyDamage: expect.closeTo(1.3, 9), meleeStagger: expect.closeTo(1.6, 9), meleeCrit: 0 });
  });
});
