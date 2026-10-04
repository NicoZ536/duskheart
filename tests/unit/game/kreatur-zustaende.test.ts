/**
 * Zustände wirken auf Kreaturen wie auf den Spieler (M6-Gate; MASTERPROMPT §19.3 „Zustände über Waffen und Munition
 * (Brennen, Frost-Verlangsamung, Gift, Blutung, Betäubung)“; src/content/conditions.ts): die Wirkung des Zustands gilt,
 * nicht nur sein Tempo.
 * - `betaeubt` (Aktionstempo 0, „weder bewegen noch handeln“): die Kreatur denkt nicht, holt nicht aus und beißt nicht,
 *   bis er endet – ein Ausholen bricht ab; vorher stand sie nur still und biss weiter.
 * - Stapelregel wie beim Spieler (`applyStack`): `einmalig` – wer betäubt ist, wird nicht erneut betäubt; `stapeln` –
 *   Blutung bis 3 Stapel, Schaden je Stapel; `verlaengern` – Gift addiert seine Dauer bis 60 s.
 * - `verlangsamt` (Frost, Aktionstempo 0,85): das Ausholen dauert 1/0,85 so lang (Telegraph und Schlag gleich).
 * - `geblendet` (Sicht 0,3): die Kreatur sieht 0,3 ihrer Sichtweite.
 * - Stapel werden gespeichert (nur über eins).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { NULL_ENTITY, type Entity } from '../../../src/engine/ecs';
import { createCombatAttack } from '../../../src/game/combat/system';
import type { SimEventMap } from '../../../src/game/sim';
import { expectRoundtrip } from '../../../src/save/roundtrip';
import { eventsOf } from './kampf-testwelt';
import { kreaturWelt, meadow, probeCatalog, type KreaturWelt } from './kreatur-testwelt';

type Telegraph = SimEventMap['creatureTelegraph'];
type Attack = SimEventMap['creatureAttack'];

const HZ = BALANCE.time.tickHz;
const WOLF = probeCatalog().get('probe_wolf');
const CONDITIONS = CONTENT.collection('conditions');

/** The player strikes creature `e` with condition `id` for `seconds` (chance 1, no stagger, no crit) through `CombatSystem.resolve`. */
function strike(w: KreaturWelt, e: Entity, id: string, seconds: number, damage = 1): void {
  const p = w.pos();
  const a = { ...createCombatAttack(), team: 'spieler' as const, damage, type: 'wucht' as const, wucht: 1, staggerSeconds: 0, critChance: 0, condition: { id, chance: 1, sekunden: seconds }, fromX: p.x, fromY: p.y };
  const h = w.combat.resolve(w.sim, w.sim.player, e, a);
  expect(h?.condition).toBe(id);
}

/** The condition `id` of creature `e`, or undefined. */
function cond(w: KreaturWelt, e: Entity, id: string): { id: string; untilTick: number; stacks?: number } | undefined {
  return w.state(e).conditions.find((c) => c.id === id);
}

/** A bright meadow, the player (god mode) at map tile (20, 15), a probe wolf two tiles north that has noticed him. */
function nah(): { w: KreaturWelt; wolf: Entity } {
  const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
  w.cheats.god = true;
  const wolf = w.creature('probe_wolf', 20, 13);
  w.run(20);
  return { w, wolf };
}

/** Runs tick by tick until creature `e` telegraphs (at most 10 s). */
function untilTelegraph(w: KreaturWelt, e: Entity): Telegraph {
  for (let i = 0; i < 10 * HZ; i++) {
    const t = eventsOf<Telegraph>(w.run(1), 'creatureTelegraph').filter((x) => x.entity === e);
    if (t.length > 0) return t[0] as Telegraph;
  }
  throw new Error('no telegraph');
}

describe('Betäubung (betaeubt)', () => {
  it('der Inhalt: Aktionstempo 0, Tempo 0, einmalig', () => {
    const def = CONDITIONS.get('betaeubt');
    expect(def.wirkung).toMatchObject({ tempo: 0, aktionstempo: 0 });
    expect(def.stapel.regel).toBe('einmalig');
  });

  it('ein betäubter Wolf neben dem Spieler holt nicht aus und beißt nicht, bis die Betäubung endet – danach wieder', () => {
    const { w, wolf } = nah();
    strike(w, wolf, 'betaeubt', 1.5);
    const until = cond(w, wolf, 'betaeubt')?.untilTick as number;
    expect(until).toBe(w.sim.tick + Math.round(1.5 * HZ));
    const telegraphs: number[] = [];
    const blows: number[] = [];
    let still = true;
    let at = { x: 0, y: 0 };
    for (let i = 0; w.sim.tick <= until + 3 * HZ; i++) {
      const ev = w.run(1);
      for (const t of eventsOf<Telegraph>(ev, 'creatureTelegraph')) if (t.entity === wolf) telegraphs.push(t.tick);
      for (const a of eventsOf<Attack>(ev, 'creatureAttack')) if (a.entity === wolf) blows.push(a.tick);
      // Once the hit's knock has played out it stands where it is until the stun ends.
      if (i === BALANCE.creatures.knockbackTicks + 2) at = w.where(wolf);
      if (i > BALANCE.creatures.knockbackTicks + 2 && w.sim.tick <= until) {
        const p = w.where(wolf);
        if (p.x !== at.x || p.y !== at.y) still = false;
      }
    }
    expect(telegraphs.filter((t) => t <= until)).toEqual([]);
    expect(blows.filter((t) => t <= until)).toEqual([]);
    expect(still).toBe(true);
    // Its stun over, it fights again.
    expect(telegraphs.filter((t) => t > until).length).toBeGreaterThan(0);
    expect(blows.filter((t) => t > until).length).toBeGreaterThan(0);
  });

  it('eine Betäubung mitten im Ausholen bricht es ab (auch ohne Taumeln)', () => {
    const { w, wolf } = nah();
    untilTelegraph(w, wolf);
    expect(w.state(wolf).attackPhase).toBe('ausholen');
    strike(w, wolf, 'betaeubt', 1.5);
    const until = cond(w, wolf, 'betaeubt')?.untilTick as number;
    const blows: number[] = [];
    while (w.sim.tick <= until) for (const a of eventsOf<Attack>(w.run(1), 'creatureAttack')) if (a.entity === wolf) blows.push(a.tick);
    expect(blows).toEqual([]);
    expect(w.state(wolf).attackPhase).toBe('keine');
  });

  it('einmalig: wer betäubt ist, wird nicht erneut betäubt – ist die Betäubung vorbei, wirkt die nächste', () => {
    const { w, wolf } = nah();
    strike(w, wolf, 'betaeubt', 1.5);
    const until = cond(w, wolf, 'betaeubt')?.untilTick as number;
    w.run(30);
    strike(w, wolf, 'betaeubt', 1.5);
    expect(cond(w, wolf, 'betaeubt')?.untilTick).toBe(until);
    while (w.sim.tick <= until + 1) w.run(1);
    strike(w, wolf, 'betaeubt', 1.5);
    expect(cond(w, wolf, 'betaeubt')?.untilTick).toBe(w.sim.tick + Math.round(1.5 * HZ));
  });
});

describe('Stapelregeln wie beim Spieler', () => {
  it('Blutung stapelt bis 3, ihr Schaden zählt je Stapel', () => {
    const { w, wolf } = nah();
    const def = CONDITIONS.get('blutung');
    expect(def.stapel).toEqual({ regel: 'stapeln', max: 3 });
    strike(w, wolf, 'blutung', 5);
    expect(cond(w, wolf, 'blutung')?.stacks).toBeUndefined();
    strike(w, wolf, 'blutung', 5);
    expect(cond(w, wolf, 'blutung')?.stacks).toBe(2);
    const before = w.state(wolf).health;
    w.run(HZ);
    const perSecond = def.wirkung.schadenProSekunde as number;
    expect(before - w.state(wolf).health).toBeCloseTo(2 * perSecond, 6);
    strike(w, wolf, 'blutung', 5);
    strike(w, wolf, 'blutung', 5);
    expect(cond(w, wolf, 'blutung')?.stacks).toBe(3);
  });

  it('Gift verlängert seine Dauer bis 60 s, Brennen beginnt neu (nie kürzer)', () => {
    const { w, wolf } = nah();
    strike(w, wolf, 'vergiftung', 8);
    const t0 = w.sim.tick;
    strike(w, wolf, 'vergiftung', 8);
    expect(cond(w, wolf, 'vergiftung')?.untilTick).toBe(t0 + 16 * HZ);
    for (let i = 0; i < 10; i++) strike(w, wolf, 'vergiftung', 8);
    expect(cond(w, wolf, 'vergiftung')?.untilTick).toBe(t0 + 60 * HZ);
    strike(w, wolf, 'brennen', 6);
    w.run(HZ);
    strike(w, wolf, 'brennen', 2);
    expect(cond(w, wolf, 'brennen')?.untilTick).toBe(t0 + 6 * HZ);
    strike(w, wolf, 'brennen', 6);
    expect(cond(w, wolf, 'brennen')?.untilTick).toBe(t0 + 7 * HZ);
  });
});

describe('Frost und Blendung', () => {
  it('verlangsamt (Aktionstempo 0,85): das Ausholen dauert 1/0,85 so lang – Telegraph, Pose und Schlag stimmen überein', () => {
    const action = CONDITIONS.get('verlangsamt').wirkung.aktionstempo as number;
    expect(action).toBe(0.85);
    const { w, wolf } = nah();
    const base = WOLF.windup.normal[0] as number;
    const basePose = WOLF.windupPose.normal[0] as number;
    // A plain wind-up first (the control).
    const plain = untilTelegraph(w, wolf);
    expect(plain.ticks).toBe(base);
    w.run(2 * HZ);
    strike(w, wolf, 'verlangsamt', 8);
    w.run(BALANCE.creatures.knockbackTicks + 4);
    const slow = untilTelegraph(w, wolf);
    const ticks = Math.round(base / action);
    expect(ticks).toBeGreaterThan(base);
    expect(slow.ticks).toBe(ticks);
    expect(slow.poseTicks).toBe(basePose + ticks - base);
    const s = w.state(wolf);
    expect(s.attackEndTick - s.attackTick).toBe(ticks);
    let blow = -1;
    for (let i = 0; i < 2 * ticks && blow < 0; i++) {
      const a = eventsOf<Attack>(w.run(1), 'creatureAttack').filter((x) => x.entity === wolf);
      if (a.length > 0) blow = (a[0] as Attack).tick;
    }
    expect(blow).toBe(slow.tick + ticks);
  });

  it('geblendet (Sicht 0,3): 8 Kacheln vor ihm sieht der Wolf den Spieler nicht mehr, 3 Kacheln vor ihm schon', () => {
    expect(CONDITIONS.get('geblendet').wirkung.sicht).toBe(0.3);
    // Bright day: its sight is 14 tiles; blinded 4,2.
    const look = (dy: number, blind: boolean): Entity => {
      const w = kreaturWelt(meadow(40, 30), { x: 20, y: 20 });
      w.cheats.god = true;
      const wolf = w.creature('probe_wolf', 20, 20 - dy);
      const s = w.state(wolf);
      // It rests facing the player.
      s.state = 'ruhen';
      s.stateUntilTick = Number.MAX_SAFE_INTEGER;
      s.goalX = Number.NaN;
      s.goalY = Number.NaN;
      s.facing = Math.PI / 2;
      if (blind) s.conditions.push({ id: 'geblendet', untilTick: w.sim.tick + 10 * HZ });
      w.run(HZ / 2);
      return w.state(wolf).target;
    };
    expect(WOLF.profile.sicht).toBe(14);
    expect(look(8, false)).not.toBe(NULL_ENTITY);
    expect(look(8, true)).toBe(NULL_ENTITY);
    expect(look(3, true)).not.toBe(NULL_ENTITY);
  });
});

describe('Speichern', () => {
  it('Stapel und eine laufende Betäubung überstehen Speichern → Laden; ohne Stapel steht kein Feld', () => {
    const factory = (): KreaturWelt => {
      const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
      w.cheats.god = true;
      w.creature('probe_wolf', 20, 13);
      return w;
    };
    const report = expectRoundtrip(
      factory,
      (w) => {
        const wolf = w.creatures.store.entityAt(0) as Entity;
        strike(w, wolf, 'blutung', 5);
        strike(w, wolf, 'blutung', 5);
        strike(w, wolf, 'betaeubt', 1.5);
      },
      (w) => w.creatures.save,
    );
    const data = JSON.parse(report.canonical) as { creatures: { conditions: Record<string, unknown>[] }[] };
    const conditions = data.creatures[0]?.conditions ?? [];
    expect(conditions.find((c) => c.id === 'blutung')).toMatchObject({ stacks: 2 });
    expect(Object.keys(conditions.find((c) => c.id === 'betaeubt') ?? {}).sort()).toEqual(['id', 'untilTick']);
  });

  it('Speichern → Laden mitten in Betäubung, Blutung und Frost geht Tick für Tick gleich weiter (Rudelruf inklusive)', () => {
    const world = (): KreaturWelt => {
      const w = kreaturWelt(meadow(60, 40), { x: 30, y: 30 });
      w.cheats.god = true;
      w.light.ambient = 0.05;
      return w;
    };
    const a = world();
    a.run(1, [{ type: 'creature.spawn', creature: 'probe_wolf', count: 3, x: a.centre(30, 26).x, y: a.centre(30, 26).y, layer: 0 }]);
    a.run(10, [{ type: 'player.sprint', on: true }, { type: 'player.move', dx: 1, dy: 0 }]);
    const [w0, w1, w2] = [0, 1, 2].map((i) => a.creatures.store.entityAt(i) as Entity) as [Entity, Entity, Entity];
    strike(a, w0, 'betaeubt', 1.5);
    strike(a, w1, 'blutung', 5);
    strike(a, w1, 'blutung', 5);
    strike(a, w2, 'verlangsamt', 5);
    a.run(3);
    const b = world();
    for (const p of a.sim.participants()) b.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    for (let i = 0; i < 6; i++) {
      a.run(30);
      b.run(30);
      expect(b.sim.hashState(), `nach ${(i + 1) * 30} Ticks`).toBe(a.sim.hashState());
    }
  });
});
