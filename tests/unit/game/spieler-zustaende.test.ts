/**
 * M6-78 Zustände wirken auf den Spieler (MASTERPROMPT §11.3 „Jeder Zustand: … sichtbare Wirkung“, §19.3 „Zustände über Waffen
 * und Munition (… Frost-Verlangsamung …, Betäubung)“, §11.1 „Erschöpft (−25 % Aktionstempo)“, §11.2 „Frierend (−10 % Präzision
 * und Arbeitstempo)“; src/content/conditions.ts; für die Kreaturen ADR-0151): `aktionstempo`, `praezision` und `sicht` aus
 * `ConditionsSystem.effects()` wirken auf den Spieler – vorher zeigte der Zustand nur Symbol, Klang und Tempo.
 * - `betaeubt` (Aktionstempo 0, „weder bewegen noch handeln“): kein Angriff, kein Block, keine Rolle, kein Benutzen, kein
 *   Schritt und kein Drehen, solange er wirkt; ein Ausholen bricht ab; danach geht alles wieder (der gehaltene Block mit neuem
 *   Paradefenster).
 * - `verlangsamt` (Frost, Aktionstempo 0,85): Ausholen, Erholung, Spannen und Nachladen dauern 1/0,85 so lang; Erschöpft
 *   (0,75) und Frierend (0,9) ebenso.
 * - `geblendet` (Präzision 0,5): ein Schuss streut doppelt so weit, die Krit-Chance des Schlags halbiert sich; Frierend 0,9.
 * Quellen: der Treffer einer Kreatur über `CombatSystem.resolve` (der Weg jedes Kreaturtreffers zum Spieler) mit dem Zustand
 * der Knochenkeule (`betaeubt`; keine Kreatur des Inhalts betäubt) und der Fixture-Wurfwaffen Frostbombe (`verlangsamt`) und
 * Blendbombe (`geblendet`, tests/unit/game/kampf-testwelt.ts). Kein neuer Speicherzustand: der Zustand selbst ist gespeichert,
 * alles andere wird aus ihm gelesen (Speichern mitten in der Betäubung, unten). Die Sicht in der Darstellung:
 * tests/unit/game/spieler-zustaende-sicht.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import type { HitCondition } from '../../../src/content/schema/item';
import { actionTicks, spreadAtPrecision } from '../../../src/game/combat/formulas';
import { COMBAT_REJECT_REASONS } from '../../../src/game/combat/events';
import { COMBAT_RNG_STREAM } from '../../../src/game/combat/system';
import { TOOL_REJECT_REASONS } from '../../../src/game/tools/events';
import { ToolsSystem } from '../../../src/game/tools/system';
import { createI18n } from '../../../src/i18n';
import { ablehnungsText } from '../../../src/ui/hud/meldungen/ablehnung';
import { eventsOf, kampfCatalog, kampfWelt, type Dummy, type KampfWelt } from './kampf-testwelt';

const HZ = BALANCE.time.tickHz;
const catalog = kampfCatalog();
/** Ticks until a hit's hitstop and knockback on the player have played out. */
const SETTLE = 12;

type Rejected = { type: string; reason: string };

/** The condition a weapon's hit carries (its data), certain to land, for `seconds` when given. */
function conditionOf(item: string, seconds?: number): HitCondition {
  const def = catalog.get(item);
  const z = def.waffe?.zustand ?? def.munition?.zustand;
  if (z === undefined) throw new Error(`${item} carries no condition`);
  return { ...z, chance: 1, ...(seconds === undefined ? {} : { sekunden: seconds }) };
}

/** Creature `foe` hits the player with the condition of `item` (no crit, no stagger); the condition lands (chance 0: the same draws, nothing lands). */
function afflict(k: KampfWelt, foe: Dummy, item: string, chance = 1, seconds?: number): void {
  const h = k.strikePlayer(foe, { damage: 1, critChance: 0, staggerSeconds: 0, wucht: 1, condition: { ...conditionOf(item, seconds), chance } });
  expect(h?.condition ?? null).toBe(chance > 0 ? conditionOf(item).id : null);
}

function rejected(events: Map<string, unknown[]>, type: string): string[] {
  return eventsOf<Rejected>(events, 'commandRejected')
    .filter((r) => r.type === type)
    .map((r) => r.reason);
}

/** A combat world with the item-use system (the primary button and uses from a slot). */
function welt(): KampfWelt {
  const k = kampfWelt();
  const tools = k.sim.addSystem(new ToolsSystem({ player: k.player, inventory: k.inventory }));
  tools.useLife(k.life);
  tools.useCombat(k.combat);
  return k;
}

describe('Betäubung (betaeubt) auf dem Spieler', () => {
  it('der Inhalt: Aktionstempo 0, Tempo 0 – die Knochenkeule betäubt mit ihm', () => {
    const z = catalog.get('knochenkeule').waffe?.zustand;
    expect(z?.id).toBe('betaeubt');
    expect(kampfWelt().life.conditions.catalog.get('betaeubt').wirkung).toMatchObject({ tempo: 0, aktionstempo: 0 });
  });

  it('ein Keulentreffer einer Kreatur betäubt: kein Angriff, kein Block, keine Rolle, kein Benutzen, kein Schritt – bis er endet, dann wieder', () => {
    const k = welt();
    k.hold('probe_schwert');
    k.aimBy(20, 0);
    const foe = k.dummy(-14, 0);
    afflict(k, foe, 'knochenkeule');
    const conditions = k.life.conditions;
    expect(conditions.has('betaeubt')).toBe(true);
    expect(k.player.stunned()).toBe(true);
    const endsAt = k.sim.tick + Math.round((conditions.remainingSeconds('betaeubt', HZ) ?? 0) * HZ);
    k.run(SETTLE);

    // Attack: refused with the reason, nothing winds up.
    let ev = k.run(1, [{ type: 'combat.attack', on: true }]);
    expect(rejected(ev, 'combat.attack')).toEqual(['stunned']);
    expect(eventsOf(ev, 'attackWindup')).toEqual([]);
    expect(k.combat.state.player.phase).toBe('bereit');
    k.run(1, [{ type: 'combat.attack', on: false }]);

    // Block: held, but no guard – a blow lands in full.
    k.run(1, [{ type: 'combat.block', on: true }]);
    expect(k.combat.state.player.blockHeld).toBe(true);
    expect(k.combat.effectiveBlock(k.sim)).toBeNull();
    const blow = k.strikePlayer(k.dummy(14, 0), { damage: 4, critChance: 0, staggerSeconds: 0, wucht: 1 });
    expect(blow).toMatchObject({ blocked: false, parried: false, amount: 4 });
    k.run(SETTLE);

    // Roll: refused, no roll.
    ev = k.run(1, [{ type: 'player.roll', dx: 0, dy: 1 }]);
    expect(rejected(ev, 'player.roll')).toEqual(['stunned']);
    expect(eventsOf(ev, 'playerRolled')).toEqual([]);

    // Walking: the body neither moves nor turns nor walks on the spot.
    const at = k.pos();
    const facing = k.body().facing;
    ev = k.run(10, [{ type: 'player.move', dx: 0, dy: 1 }]);
    expect(k.pos()).toEqual(at);
    expect(k.body().facing).toBe(facing);
    expect(k.body().state).toBe('idle');

    // Using: the primary button and a use from a slot are refused.
    ev = k.run(1, [{ type: 'player.useItem' }]);
    expect(rejected(ev, 'player.useItem')).toEqual(['stunned']);
    expect(eventsOf(ev, 'attackWindup')).toEqual([]);
    ev = k.run(1, [{ type: 'player.useItem', slot: { bereich: 'schnellleiste', index: 0 } }]);
    expect(rejected(ev, 'player.useItem')).toEqual(['stunned']);
    expect(k.sim.tick).toBeLessThan(endsAt);

    // The stun ends: the held block comes up (a new parry window), the held key walks, the attack winds up.
    k.run(endsAt - k.sim.tick + 1);
    expect(conditions.has('betaeubt')).toBe(false);
    expect(k.player.stunned()).toBe(false);
    expect(k.combat.effectiveBlock(k.sim)).not.toBeNull();
    expect(k.combat.state.player.blockSinceTick).toBeGreaterThan(endsAt - 2);
    expect(k.pos().y).toBeGreaterThan(at.y);
    k.run(1, [{ type: 'combat.block', on: false }]);
    ev = k.run(1, [{ type: 'combat.attack', on: true }]);
    expect(rejected(ev, 'combat.attack')).toEqual([]);
    expect(eventsOf(ev, 'attackWindup')).toHaveLength(1);
  });

  it('ein Ausholen bricht im Tick des Betäubungstreffers ab – kein Schlag', () => {
    const k = welt();
    k.hold('probe_schwert');
    k.aimBy(20, 0);
    const target = k.dummy(14, 0);
    k.run(1, [{ type: 'combat.attack', on: true }]);
    expect(k.combat.state.player.phase).toBe('ausholen');
    afflict(k, k.dummy(-14, 0), 'knochenkeule');
    expect(k.combat.state.player.phase).toBe('bereit');
    const ev = k.run(30, [{ type: 'combat.attack', on: false }]);
    expect(eventsOf(ev, 'attackStarted')).toEqual([]);
    expect(target.hits).toEqual([]);
  });

  it('ein Rudel im selben Tick: der Betäubungsbiss von hinten senkt die Deckung – der Biss von vorn trifft ungeblockt', () => {
    const k = welt();
    k.offhand('probe_holzschild');
    k.aimBy(30, 0);
    const front = k.dummy(14, 0);
    const behind = k.dummy(-14, 0);
    k.run(1, [{ type: 'combat.block', on: true }]);
    k.run(20);
    expect(k.combat.effectiveBlock(k.sim)).not.toBeNull();
    // Both in one tick (no step between): the first from behind (the shield faces east) stuns, the second meets no guard.
    afflict(k, behind, 'knochenkeule');
    expect(k.player.stunned()).toBe(true);
    const bite = k.strikePlayer(front, { damage: 6, critChance: 0, staggerSeconds: 0, wucht: 1 });
    expect(bite).toMatchObject({ blocked: false, parried: false, amount: 6 });
  });

  it('eine Betäubung aus jeder Quelle (hier der Befehl conditions.apply) beendet das Ausholen im nächsten Tick', () => {
    const k = welt();
    k.hold('probe_schwert');
    k.aimBy(20, 0);
    const target = k.dummy(14, 0);
    k.run(1, [{ type: 'combat.attack', on: true }]);
    expect(k.combat.state.player.phase).toBe('ausholen');
    k.run(1, [{ type: 'conditions.apply', id: 'betaeubt' }]);
    expect(k.player.stunned()).toBe(true);
    k.run(1);
    expect(k.combat.state.player.phase).toBe('bereit');
    const ev = k.run(30, [{ type: 'combat.attack', on: false }]);
    expect(eventsOf(ev, 'attackStarted')).toEqual([]);
    expect(target.hits).toEqual([]);
  });

  it('auch ein Spannen und Nachladen bricht ab; die Ausrichtung folgt nicht mehr dem Ziel', () => {
    const k = welt();
    k.hold('probe_armbrust');
    k.pack('probe_bolzen', 3);
    k.aimBy(0, 40);
    k.run(1, [{ type: 'combat.attack', on: true }]);
    expect(k.combat.state.player.phase).toBe('nachladen');
    afflict(k, k.dummy(-14, 0), 'knochenkeule');
    k.run(1);
    expect(k.combat.state.player.phase).toBe('bereit');
    expect(k.combat.state.player.loaded).toBe('');
    const facing = k.body().facing;
    k.aimBy(-40, 0);
    k.run(5);
    expect(k.body().facing).toBe(facing);
  });
});

describe('Verlangsamt (Frost), Erschöpft, Frierend: langsamere Aktionen', () => {
  /** Wind-up and recovery of a light blow, draw of a bow, reload of a crossbow [ticks], as the world plays them. */
  function timings(setup: (k: KampfWelt) => void): { windup: number; blowAfter: number; recovery: number; draw: number; reload: number } {
    const k = welt();
    setup(k);
    k.run(SETTLE);
    k.hold('probe_schwert');
    k.aimBy(20, 0);
    let ev = k.run(1, [{ type: 'combat.attack', on: true }]);
    const windup = eventsOf<{ ticks: number }>(ev, 'attackWindup')[0]?.ticks ?? -1;
    const pressed = k.sim.tick;
    let blowAfter = -1;
    for (let i = 1; i <= 60 && blowAfter < 0; i++) {
      ev = k.run(1, i === 1 ? [{ type: 'combat.attack', on: false }] : []);
      if (eventsOf(ev, 'attackStarted').length > 0) blowAfter = k.sim.tick - pressed;
    }
    const recovery = k.combat.state.player.phaseTotal;
    k.run(recovery + 1);
    k.hold('probe_bogen', 1, 1);
    k.pack('probe_pfeil', 3);
    ev = k.run(1, [{ type: 'combat.attack', on: true }]);
    const draw = eventsOf<{ ticks: number }>(ev, 'attackWindup')[0]?.ticks ?? -1;
    k.run(1, [{ type: 'combat.attack', on: false }]);
    k.run(60);
    k.hold('probe_armbrust', 1, 2);
    k.pack('probe_bolzen', 3);
    ev = k.run(1, [{ type: 'combat.attack', on: true }]);
    const reload = eventsOf<{ ticks: number }>(ev, 'attackWindup')[0]?.ticks ?? -1;
    return { windup, blowAfter, recovery, draw, reload };
  }

  const base = timings(() => undefined);

  it('ohne Zustand: die Zeiten der Waffen', () => {
    expect(base.windup).toBeGreaterThan(0);
    // The press tick winds up the first tick: the blow lands `windup` ticks after the press, counted from its tick's start.
    expect(base.blowAfter).toBe(base.windup - 1);
    expect(base.recovery).toBeGreaterThan(0);
    expect(base.draw).toBe(Math.round(BALANCE.combat.ranged.bowDrawSeconds * HZ));
    expect(base.reload).toBe(Math.round(BALANCE.combat.ranged.crossbowReloadSeconds * HZ));
  });

  for (const [name, setup, pace] of [
    ['Frost (Frostbombe: verlangsamt, Aktionstempo 0,85)', (k: KampfWelt) => afflict(k, k.dummy(-14, 0), 'probe_frostbombe'), 0.85],
    ['Erschöpft (Erschöpfung > 90, §11.1: 0,75)', (k: KampfWelt) => void (k.vit().exhaustion = 95), BALANCE.survival.exhaustion.exhaustedActionFactor],
    ['Frierend (Kern < 36 °C, §11.2: 0,9)', (k: KampfWelt) => void (k.vit().coreC = 35.5), BALANCE.survival.temperature.coldWorkFactor],
  ] as const) {
    it(`${name}: Ausholen, Erholung, Spannen und Nachladen dauern 1/Tempo so lang`, () => {
      const slow = timings(setup);
      expect(pace).toBeLessThan(1);
      expect(slow.windup).toBe(actionTicks(base.windup, pace));
      expect(slow.windup).toBeGreaterThan(base.windup);
      expect(slow.blowAfter).toBe(slow.windup - 1);
      expect(slow.recovery).toBe(actionTicks(base.recovery, pace));
      expect(slow.draw).toBe(actionTicks(base.draw, pace));
      expect(slow.reload).toBe(actionTicks(base.reload, pace));
      expect(slow.reload).toBe(Math.round(base.reload / pace));
    });
  }

  it('das Tempo der Aktionen: Zustände × Erschöpft × Frierend', () => {
    const k = welt();
    afflict(k, k.dummy(-14, 0), 'probe_frostbombe');
    k.vit().exhaustion = 95;
    k.vit().coreC = 35.5;
    k.run(2);
    expect(k.vit().temperatureStage).toBe('frierend');
    expect(k.player.actionSpeed()).toBeCloseTo(0.85 * BALANCE.survival.exhaustion.exhaustedActionFactor * BALANCE.survival.temperature.coldWorkFactor, 12);
    expect(k.player.precision()).toBeCloseTo(BALANCE.survival.temperature.coldWorkFactor, 12);
  });

  it('die Formel: Ticks / Tempo, gerundet; Tempo 1 und Betäubung (0) lassen die Ticks', () => {
    expect(actionTicks(48, 0.85)).toBe(56);
    expect(actionTicks(90, 0.75)).toBe(120);
    expect(actionTicks(1, 0.99)).toBe(1);
    expect(actionTicks(48, 1)).toBe(48);
    expect(actionTicks(48, 0)).toBe(48);
    expect(actionTicks(0, 0.5)).toBe(0);
  });
});

describe('Geblendet: Präzision', () => {
  /**
   * The spread of a bow shot towards a point east – the tangent of the angle between the aim and the flight – from a world whose
   * player the blind bomb's hit struck (`chance` 1) or missed (0, the same draws of the stream).
   */
  function shot(chance: number): number {
    const k = welt();
    afflict(k, k.dummy(-14, 0), 'probe_blendbombe', chance);
    k.run(SETTLE);
    expect(k.life.conditions.has('geblendet')).toBe(chance > 0);
    k.hold('probe_bogen');
    k.pack('probe_pfeil', 3);
    k.aimBy(100, 0);
    k.run(1, [{ type: 'combat.attack', on: true }]);
    k.run(60);
    const p = k.pos();
    const aim = k.aim ?? { x: 0, y: 0 };
    const fired = eventsOf<{ vx: number; vy: number }>(k.run(1, [{ type: 'combat.attack', on: false }]), 'projectileFired');
    expect(fired).toHaveLength(1);
    const { vx, vy } = fired[0] as { vx: number; vy: number };
    const ax = aim.x - p.x;
    const ay = aim.y - p.y;
    return (ax * vy - ay * vx) / (ax * vx + ay * vy);
  }

  it('ein Schuss streut doppelt so weit (Präzision 0,5): dieselbe Ziehung, die doppelte Abweichung', () => {
    const clear = shot(0);
    const blind = shot(1);
    expect(Math.abs(clear)).toBeGreaterThan(1e-4);
    expect(Math.abs(clear)).toBeLessThanOrEqual(Math.tan((BALANCE.combat.ranged.spreadDeg.bogen * Math.PI) / 180));
    expect(blind).toBeCloseTo(2 * clear, 12);
  });

  it('die Streuung: Tangens / Präzision, höchstens maxSpreadDeg', () => {
    const t = Math.tan((4 * Math.PI) / 180);
    expect(spreadAtPrecision(t, 1)).toBe(t);
    expect(spreadAtPrecision(t, 0.5)).toBeCloseTo(2 * t, 15);
    const max = Math.tan((BALANCE.conditions.player.maxSpreadDeg * Math.PI) / 180);
    expect(spreadAtPrecision(t, 0.01)).toBeCloseTo(max, 15);
    expect(spreadAtPrecision(t, 0)).toBeCloseTo(max, 15);
  });

  /** Whether a light blow is critical when the combat stream's next draw is `r`, blinded or not. */
  function blowCrit(blind: boolean, r: (x: number) => boolean): boolean {
    const k = welt();
    afflict(k, k.dummy(-14, 0), 'probe_blendbombe', blind ? 1 : 0);
    k.run(SETTLE);
    k.hold('probe_schwert');
    k.aimBy(20, 0);
    const target = k.dummy(14, 0, { health: 1e6, maxHealth: 1e6 });
    k.run(1, [{ type: 'combat.attack', on: true }]);
    k.run(1, [{ type: 'combat.attack', on: false }]);
    // Skip draws of the stream until the next one is `r` (the blow's crit roll is the next draw).
    const rng = k.sim.rng.stream(COMBAT_RNG_STREAM);
    for (let i = 0; i < 10_000; i++) {
      const s = rng.getState();
      const next = rng.next();
      if (r(next)) {
        rng.setState(s);
        break;
      }
    }
    k.run(40);
    expect(target.hits).toHaveLength(1);
    return target.hits[0]?.crit ?? false;
  }

  it('die Krit-Chance des Schlags halbiert sich (5 % → 2,5 %)', () => {
    const chance = BALANCE.combat.damage.critChance;
    const between = (x: number): boolean => x >= chance / 2 && x < chance;
    const below = (x: number): boolean => x < chance / 2;
    expect(blowCrit(false, between)).toBe(true);
    expect(blowCrit(true, between)).toBe(false);
    expect(blowCrit(true, below)).toBe(true);
  });

  it('die Sicht: Geblendet 0,3 für die Darstellung, ohne Zustand genau 1', () => {
    const k = welt();
    expect(k.life.conditions.sight()).toBe(1);
    afflict(k, k.dummy(-14, 0), 'probe_blendbombe');
    expect(k.life.conditions.sight()).toBeCloseTo(0.3, 12);
    expect(k.life.conditions.precision()).toBeCloseTo(0.5, 12);
    k.run(Math.round(conditionOf('probe_blendbombe').sekunden * HZ) + 2);
    expect(k.life.conditions.has('geblendet')).toBe(false);
    expect(k.life.conditions.sight()).toBe(1);
  });
});

describe('Speichern, Laden, Determinismus und Texte', () => {
  /** A player who was frozen by the frost bomb and then stunned by the bone club, `ticks` later. */
  function afflicted(ticks: number): KampfWelt {
    const k = welt();
    k.hold('probe_schwert');
    k.aimBy(20, 0);
    const foe = k.dummy(-14, 0);
    afflict(k, foe, 'probe_frostbombe');
    afflict(k, foe, 'knochenkeule');
    k.run(ticks);
    return k;
  }

  /** The same script of attacks, blocks, rolls and steps, tick by tick: the hashes after each tick and the refusals. */
  function play(k: KampfWelt): { hashes: string[]; refused: string[] } {
    const hashes: string[] = [];
    const refused: string[] = [];
    for (let i = 0; i < 150; i++) {
      const commands =
        i % 25 === 0
          ? [{ type: 'combat.attack' as const, on: true }]
          : i % 25 === 3
            ? [{ type: 'combat.attack' as const, on: false }, { type: 'player.move' as const, dx: 1, dy: 0 }]
            : i % 25 === 12
              ? [{ type: 'player.roll' as const, dx: 0, dy: 1 }]
              : i % 25 === 15
                ? [{ type: 'combat.block' as const, on: i % 50 === 15 }]
                : [];
      const ev = k.run(1, commands);
      for (const r of eventsOf<Rejected>(ev, 'commandRejected')) refused.push(`${k.sim.tick}:${r.type}:${r.reason}`);
      hashes.push(k.sim.hashState());
    }
    return { hashes, refused };
  }

  it('zwei Läufe sind bitgleich; Speichern mitten in der Betäubung und Laden ergibt Tick für Tick denselben Zustand', () => {
    const a = afflicted(20);
    const b = afflicted(20);
    const c = welt();
    for (const p of a.sim.participants()) c.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    // The aim is input (the session sends `player.aim` every frame), not saved state.
    c.aim = a.aim === null ? null : { ...a.aim };
    expect(c.sim.hashState()).toBe(a.sim.hashState());
    // Nothing of the pace is saved: the loaded conditions are the source.
    expect(c.player.stunned()).toBe(true);
    expect(c.player.actionSpeed()).toBe(a.player.actionSpeed());
    expect(c.player.precision()).toBe(a.player.precision());
    const ra = play(a);
    const rb = play(b);
    const rc = play(c);
    expect(rb).toEqual(ra);
    expect(rc).toEqual(ra);
    expect(ra.refused.some((r) => r.endsWith('combat.attack:stunned'))).toBe(true);
    expect(ra.refused.some((r) => r.endsWith('player.roll:stunned'))).toBe(true);
  });

  it('jeder neue Ablehnungsgrund hat seinen Text auf Deutsch und Englisch', () => {
    expect(COMBAT_REJECT_REASONS).toContain('stunned');
    expect(TOOL_REJECT_REASONS).toContain('stunned');
    for (const [type, key] of [
      ['combat.attack', 'ui.combat.reject.stunned'],
      ['combat.block', 'ui.combat.reject.stunned'],
      ['player.useItem', 'ui.tools.reject.stunned'],
    ] as const) {
      expect(ablehnungsText(type, 'stunned')).toBe(key);
      for (const lang of ['de', 'en'] as const) expect(createI18n(lang, { strict: true }).t(key).length, `${lang} ${key}`).toBeGreaterThan(20);
    }
  });
});
