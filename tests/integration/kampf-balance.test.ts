/**
 * Kampf-Balance M6 nach §D in der Spielwelt (M6-37; MASTERPROMPT §D „normale Gegner einer Stufe fallen nach 4–6 Treffern
 * mit stufengerechter Einhandwaffe; Elites ×4 … Gegnerschaden gegen stufengerechte Rüstung: normaler Treffer 8–12 % des
 * effektiven Lebens, schwere telegraphierte Attacke 20–30 % …; kein One-Shot auf Normal“; docs/BALANCE.md).
 *
 * Nicht aus Formeln, sondern durch das Spiel: `createSimulation` mit dem Content (tests/integration/kampf-welt.ts), ein
 * Spieler der Stufe 0 (Fasergewand, Rüstung 6) und einer der Stufe 1 (Lederrüstung, mit Set-Bonus Rüstung 12 = §D) mit
 * den Einhandwaffen ihrer Stufe aus dem Content, frisch (alle Fertigkeiten Stufe 1), auf „Normal“. Jeder Treffer läuft
 * durch `CombatSystem.resolve` und das `applyHit` der Kreatur bzw. des Spielers (Resistenzen, Rüstung, Varianten, Set-Boni);
 * ein Zustand eines Angriffs läuft seine Sekunden in der Welt, ein Griff beißt wie `holdStep`.
 * - Stufe 0 gegen jede Kreatur der Stufe 0: Gegner (Familie `gegner`, `schattenbrut`) fallen nach 4–6 Treffern jeder
 *   Einhandwaffe (Dolch ×0,6 „schnell“: höchstens 10), treffen normal 8–12 %, schwer telegraphiert 20–30 %; Friedliche
 *   treffen höchstens 12 %.
 * - Stufe 1 gegen die Kreaturen der Stufe 1: die Schattenbrut-Varianten der Stufe-1-Biome (Moor, Tiefe) wie oben, der
 *   Nachtmahr wie ein Elite ×4 (16–24 Treffer), schwer 20–30 %.
 * - Kein One-Shot: jeder Angriff jeder Kreatur (auch der stärksten Variante bis Stufe 1), kritisch, ohne Rüstung, lässt den
 *   Spieler aus vollem Leben stehen.
 * - Die Messung ist die des Spiels: ein echter Schlag der Feuersteinklinge und ein echter Wolfsbiss treffen genau so hart.
 * - Stufenkurve (docs/BALANCE.md §3): mit der Ausrüstung der Stufe 1 fällt jeder Gegner der Stufe 0 nach höchstens so vielen
 *   Treffern wie mit der der Stufe 0 – und keiner nach mehr als 4 –, und jeder seiner Angriffe trifft weniger hart.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/content/balance';
import type { CreatureDef } from '../../src/content/creatures/schema';
import { CONTENT } from '../../src/content/index';
import type { EquipmentSystem } from '../../src/game/equipment/system';
import type { EquipmentSlot } from '../../src/game/items/slots';
import type { SimEventMap } from '../../src/game/sim';
import { attackToll, clearCreatures, foe, heal, hitsToKill, kampfWelt, playerBlow, type KampfWelt } from './kampf-welt';

/** One-handed tier weapons (§D „stufengerechte Einhandwaffe“) of the content, by tier; the dagger is the fast class. */
const EINHAENDER = ['schwert', 'axt', 'keule', 'speer'] as const;
/** Heavy telegraphed attacks (§D 20–30 %): the charges and leaps, the ambush, the great claw, the grab, the Nachtmahr's. */
const SCHWER = new Set(['keiler.ansturm', 'wolf.sprung', 'dornling.ueberfall', 'scherenkrebs.scherenschlag', 'schleicher.sprung', 'kriecher.packen', 'nachtmahr.stampfen', 'nachtmahr.ansturm']);
/** Armour of a set per tier (§D „Rüstungswert je Set“) and the set a player of that tier wears. */
const SET_JE_STUFE: Readonly<Record<number, { readonly set: string; readonly ruestung: number }>> = { 0: { set: 'faser', ruestung: 6 }, 1: { set: 'leder', ruestung: 12 } };
/** The Nachtmahr holds like an elite (§D „Elites ×4“): 4 × the 4–6 hits of a normal foe of its tier. */
const ELITE = [16, 24] as const;
const HEALTH = BALANCE.survival.health.base;
/** Ticks between two presses of the attack button in the swing check (a second: the combo window is long over). */
const PRESS_TICKS = BALANCE.time.tickHz;
/** How far beside the wolf the player stands for its swing [px] (inside the flint blade's reach of 20 px). */
const BESIDE_PX = 14;

const creatures = CONTENT.collection('creatures').values();
const items = CONTENT.collection('items').values();
const foes = (tier: number): CreatureDef[] => creatures.filter((c) => c.stufe === tier && (c.familie === 'gegner' || c.familie === 'schattenbrut'));

function weapons(tier: number, klassen: readonly string[]): string[] {
  return items.filter((i) => i.stufe === tier && i.waffe !== undefined && klassen.includes(i.waffe.klasse)).map((i) => i.id);
}

/** Variant indices of `c` whose biomes are of tier `tier` (the shadow brood's biome variants, M6-25b). */
function variantsOfTier(c: CreatureDef, tier: number): number[] {
  return (c.varianten ?? []).flatMap((v, i) => (v.biome.every((b) => BALANCE.spawn.biomeTier[b] === tier) ? [i] : []));
}

/** Puts on the whole set of tier `tier` (and takes the other set off by swapping it into the bags). */
function dress(w: KampfWelt, tier: number): void {
  const set = CONTENT.collection('armorSets').get((SET_JE_STUFE[tier] as { set: string }).set);
  for (const id of set.teile) w.wear(id, CONTENT.collection('items').get(id).ausruestung as EquipmentSlot);
}

/** Takes every armour piece off (into the bags). */
function undress(w: KampfWelt): void {
  for (let i = 0; i < 4; i++) {
    const worn = w.inventory.state.ausruestung[i];
    if (worn === null || worn === undefined) continue;
    const free = w.inventory.state.inventar.findIndex((s) => s === null);
    w.ok('Ablegen', [{ type: 'inventory.move', from: { bereich: 'ausruestung', index: i }, to: { bereich: 'inventar', index: free } }]);
  }
}

function armour(w: KampfWelt): number {
  return (w.sim.system('equipment') as unknown as EquipmentSystem).stats().werte.ruestung;
}

function expectShare(w: KampfWelt, c: CreatureDef, variant: number, what: string): void {
  for (const a of c.angriffe) {
    const toll = attackToll(w, c.id, variant, a);
    const share = toll.total / HEALTH;
    const key = `${c.id}.${a.name}`;
    const [lo, hi] = c.familie === 'friedlich' ? [0, 0.12] : SCHWER.has(key) ? [0.2, 0.3] : [0.08, 0.12];
    expect(share, `${key} ${what}`).toBeGreaterThanOrEqual(lo - 1e-9);
    expect(share, `${key} ${what}`).toBeLessThanOrEqual(hi + 1e-9);
  }
}

describe('Kampf-Balance M6 (§D) in der Spielwelt', () => {
  let w: KampfWelt;

  beforeAll(() => {
    // Evening twilight: the brood awake and not fading, no night spawner; the player on open ground, not god.
    w = kampfWelt({ hour: 19, god: false });
    w.goTo(w.openSpot(w.tile(), 3));
  });

  it('die Einhandwaffen der Stufen 0 und 1 und die Sets sind die des Contents; ihre Rüstung ist die von §D', () => {
    expect(weapons(0, EINHAENDER).sort()).toEqual(['feuersteinklinge', 'holzkeule', 'knochenkeule', 'steinkampfaxt', 'steinspeer']);
    expect(weapons(1, EINHAENDER).sort()).toEqual(['bronzekampfaxt', 'bronzeschwert', 'bronzespeer', 'bronzestreitkolben']);
    for (const tier of [0, 1]) {
      dress(w, tier);
      expect(armour(w), `Set Stufe ${tier}`).toBe(SET_JE_STUFE[tier]?.ruestung);
    }
    undress(w);
    expect(armour(w)).toBe(0);
  });

  it('Stufe 0: jeder Gegner fällt nach 4–6 Treffern jeder Einhandwaffe (Dolch höchstens 10), Friedliche nach höchstens 6', () => {
    const list = creatures.filter((c) => c.stufe === 0);
    expect(foes(0).length).toBeGreaterThanOrEqual(12);
    for (const id of weapons(0, EINHAENDER)) {
      w.hold(id);
      for (const c of list) {
        const { hits } = hitsToKill(w, c.id, -1);
        if (c.familie !== 'friedlich') expect(hits, `${c.id} × ${id}`).toBeGreaterThanOrEqual(4);
        expect(hits, `${c.id} × ${id}`).toBeLessThanOrEqual(6);
      }
    }
    for (const id of weapons(0, ['dolch'])) {
      w.hold(id);
      for (const c of foes(0)) expect(hitsToKill(w, c.id, -1).hits, `${c.id} × ${id}`).toBeLessThanOrEqual(10);
    }
  });

  it('Stufe 0 im Fasergewand: normal 8–12 %, schwer telegraphiert 20–30 %, Friedliche höchstens 12 % des Lebens', () => {
    dress(w, 0);
    for (const c of creatures.filter((x) => x.stufe === 0)) expectShare(w, c, -1, 'T0');
  });

  it('Stufe 1: die Schattenbrut der Stufe-1-Biome fällt nach 4–6 Treffern, der Nachtmahr wie ein Elite ×4', () => {
    const brood = foes(0).filter((c) => variantsOfTier(c, 1).length > 0);
    expect(brood.map((c) => c.id).sort()).toEqual(['kriecher', 'lichtfresser', 'schleicher', 'speier']);
    for (const id of weapons(1, EINHAENDER)) {
      w.hold(id);
      for (const c of brood) {
        for (const v of variantsOfTier(c, 1)) {
          const { hits } = hitsToKill(w, c.id, v);
          expect(hits, `${c.id}/${c.varianten?.[v]?.id} × ${id}`).toBeGreaterThanOrEqual(4);
          expect(hits, `${c.id}/${c.varianten?.[v]?.id} × ${id}`).toBeLessThanOrEqual(6);
        }
      }
      const { hits } = hitsToKill(w, 'nachtmahr', -1);
      expect(hits, `nachtmahr × ${id}`).toBeGreaterThanOrEqual(ELITE[0]);
      expect(hits, `nachtmahr × ${id}`).toBeLessThanOrEqual(ELITE[1]);
    }
  });

  it('Stufe 1 in der Lederrüstung: die Brut-Varianten und der Nachtmahr treffen in den Bändern von §D', () => {
    dress(w, 1);
    for (const c of foes(0)) for (const v of variantsOfTier(c, 1)) expectShare(w, c, v, `T1/${c.varianten?.[v]?.id}`);
    expectShare(w, CONTENT.collection('creatures').get('nachtmahr'), -1, 'T1');
  });

  it('kein One-Shot auf Normal: jeder Angriff, kritisch, ohne Rüstung, lässt den Spieler aus vollem Leben stehen', () => {
    undress(w);
    for (const c of creatures) {
      const strongest = [-1, ...variantsOfTier(c, 1)];
      for (const v of strongest) {
        for (const a of c.angriffe) {
          const toll = attackToll(w, c.id, v, a, 1);
          expect(toll.left, `${c.id}.${a.name}${v >= 0 ? `/${c.varianten?.[v]?.id}` : ''}`).toBeGreaterThan(0);
          expect(toll.total, `${c.id}.${a.name}`).toBeLessThan(HEALTH);
        }
      }
    }
    heal(w);
  });

  it('die Messung ist die des Spiels: ein echter Schwertschlag und ein echter Wolfsbiss treffen genau so hart', () => {
    undress(w);
    heal(w);
    // The blow of the harness against a real swing of the flint blade (god mode: the wolf bites back meanwhile).
    w.ok('God an', [{ type: 'debug.god', on: true }]);
    w.hold('feuersteinklinge');
    const e = foe(w, 'wolf', -1);
    const s = w.creatures.store.get(e);
    if (s === undefined) throw new Error('kein Wolf');
    const expected = w.combat.resolve(w.sim, w.sim.player, e, playerBlow(w))?.amount ?? 0;
    s.health = s.maxHealth;
    const at = { x: 0, y: 0 };
    let real: SimEventMap['hitLanded'] | undefined;
    // One press a second (the combo window long over: every swing is a first blow), the player put beside the wolf and aiming at it.
    for (let i = 0; i < 20 * PRESS_TICKS && real === undefined; i++) {
      w.creatures.positionOf(e, at);
      const phase = i % PRESS_TICKS;
      const commands =
        phase === 0
          ? [{ type: 'player.teleport', x: at.x - BESIDE_PX, y: at.y, layer: 0 } as const, { type: 'player.aim', x: Math.round(at.x), y: Math.round(at.y) } as const, { type: 'combat.attack', on: true } as const]
          : phase === 1
            ? [{ type: 'combat.attack', on: false } as const]
            : [];
      for (const [type, payload] of w.run(commands)) {
        const h = payload as SimEventMap['hitLanded'];
        if (type === 'hitLanded' && h.attacker === w.sim.player && h.target === e && !h.crit) real = h;
      }
    }
    expect(real?.amount).toBeCloseTo(expected, 9);
    clearCreatures(w);
    w.ok('God aus', [{ type: 'debug.god', on: false }]);
    // A wolf's bite in the world against the harness's toll of it (healed after every tick: the bites never add up).
    const bite = CONTENT.collection('creatures').get('wolf').angriffe.find((a) => a.name === 'biss');
    if (bite === undefined) throw new Error('kein Biss');
    const toll = attackToll(w, 'wolf', -1, bite);
    const t = w.tile();
    const [wolf] = w.spawn('wolf', 1, { tx: t.tx, ty: t.ty - 3 });
    let seen: number | undefined;
    for (let i = 0; i < 40 * PRESS_TICKS && seen === undefined; i++) {
      const events = w.run();
      const biss = events.some((x) => x[0] === 'creatureAttack' && (x[1] as SimEventMap['creatureAttack']).entity === wolf && (x[1] as SimEventMap['creatureAttack']).angriff === 'biss');
      for (const [type, payload] of events) {
        const h = payload as SimEventMap['hitLanded'];
        if (biss && type === 'hitLanded' && h.attacker === wolf && h.target === w.sim.player && !h.crit) seen = h.amount;
      }
      heal(w);
    }
    expect(seen).toBeDefined();
    expect(seen).toBeCloseTo(toll.blow, 9);
    clearCreatures(w);
  });

  it('Stufenkurve: mit Stufe-1-Ausrüstung fallen die Gegner der Stufe 0 schneller (höchstens 4 Treffer) und treffen schwächer', () => {
    // The bags as they are (dressing and arming twice more would fill them): restored at the end.
    const bags = structuredClone(w.sim.participant('inventory').serialize());
    const t0 = new Map<string, number>();
    const t1 = new Map<string, number>();
    for (const [tier, out] of [
      [0, t0],
      [1, t1],
    ] as const) {
      for (const id of weapons(tier, EINHAENDER)) {
        w.hold(id);
        for (const c of foes(0)) out.set(c.id, Math.max(out.get(c.id) ?? 0, hitsToKill(w, c.id, -1).hits));
      }
    }
    for (const c of foes(0)) {
      expect(t1.get(c.id), c.id).toBeLessThanOrEqual(t0.get(c.id) ?? 0);
      expect(t1.get(c.id), c.id).toBeLessThanOrEqual(4);
    }
    const tolls = (tier: number): number[] => {
      dress(w, tier);
      return foes(0).flatMap((c) => c.angriffe.map((a) => attackToll(w, c.id, -1, a).total));
    };
    const light = tolls(0);
    const heavy = tolls(1);
    heavy.forEach((d, i) => expect(d, `Angriff ${i}`).toBeLessThan(light[i] ?? 0));
    w.sim.participant('inventory').deserialize(bags);
    w.run();
  });
});
