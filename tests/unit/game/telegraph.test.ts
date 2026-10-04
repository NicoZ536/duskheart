/**
 * Telegraphs (M6-15, MASTERPROMPT §19.4 „Ausholzeit 0,3–0,8 s (Schwierigkeit skaliert), klar sichtbar und hörbar;
 * Boss-Flächenangriffe mit Bodenmarkierung“, §29 Gegnerschaden): die Ausholzeit je Schwierigkeit, die lesbare Pose vor dem
 * Anlauf, jeder Angriff des Inhalts im Rahmen; im Spiel kündigt `creatureTelegraph` den Schlag an, der genau nach den
 * angekündigten Ticks landet – mit dem Schaden der Schwierigkeit, eine Rolle entgeht ihm, eine Parade lässt die Kreatur
 * taumeln, eine Fläche nennt ihre Bodenmarkierung.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { DIFFICULTIES } from '../../../src/content/balance/death';
import { CREATURES } from '../../../src/content/creatures/index';
import { WINDUP_MAX_SECONDS, WINDUP_MIN_SECONDS } from '../../../src/content/creatures/schema';
import { creatureDamage, windupPoseTicks, windupTicks } from '../../../src/game/creatures/formulas';
import type { SimEventMap } from '../../../src/game/sim';
import { eventsOf } from './kampf-testwelt';
import { kreaturWelt, meadow } from './kreatur-testwelt';

const D = BALANCE.creatures.difficulty;
const HZ = BALANCE.time.tickHz;
type Telegraph = SimEventMap['creatureTelegraph'];
type Attack = SimEventMap['creatureAttack'];
type Hit = SimEventMap['hitLanded'];

describe('Ausholzeit (M6-15)', () => {
  it('skaliert mit der Schwierigkeit: Entspannt ein Viertel mehr, Unbarmherzig ein Viertel weniger', () => {
    const biss = { ausholzeit: 0.4 };
    expect(windupTicks(biss, 'normal')).toBe(24);
    expect(windupTicks(biss, 'entspannt')).toBe(30);
    expect(windupTicks(biss, 'hart')).toBe(Math.round(0.4 * D.windupFactor.hart * HZ));
    expect(windupTicks(biss, 'unbarmherzig')).toBe(18);
    // Mit Anlauf: der Schlag nach Ausholen + Anlauf, die lesbare Pose ist der Ausholteil.
    const ansturm = { ausholzeit: 0.6, anlauf: 0.2 };
    expect(windupTicks(ansturm, 'normal')).toBe(48);
    expect(windupPoseTicks(ansturm, 'normal')).toBe(36);
    expect(windupPoseTicks(biss, 'normal')).toBe(24);
  });

  it('jeder Angriff aller 22 Kreaturen holt auf jeder Schwierigkeit 0,3–0,8 s aus (Ausholen + Anlauf, §19.4)', () => {
    expect(CREATURES).toHaveLength(22);
    const lo = Math.round(WINDUP_MIN_SECONDS * HZ);
    const hi = Math.round(WINDUP_MAX_SECONDS * HZ);
    let attacks = 0;
    for (const c of CREATURES) {
      for (const a of c.angriffe) {
        attacks++;
        for (const d of DIFFICULTIES) {
          const ticks = windupTicks(a, d);
          const pose = windupPoseTicks(a, d);
          expect(ticks, `${c.id}.${a.name} ${d}`).toBeGreaterThanOrEqual(lo);
          expect(ticks, `${c.id}.${a.name} ${d}`).toBeLessThanOrEqual(hi);
          expect(pose, `${c.id}.${a.name} ${d}`).toBeGreaterThanOrEqual(1);
          expect(pose, `${c.id}.${a.name} ${d}`).toBeLessThanOrEqual(ticks);
        }
      }
    }
    expect(attacks).toBeGreaterThanOrEqual(25);
  });

  it('am Rand gehalten: der Hauer des Keilers bleibt auf Hart und Unbarmherzig bei 0,3 s, der Ansturm auf Entspannt bei 0,8 s', () => {
    const keiler = CREATURES.find((c) => c.id === 'keiler');
    const hauer = keiler?.angriffe.find((a) => a.name === 'hauer');
    const ansturm = keiler?.angriffe.find((a) => a.name === 'ansturm');
    if (hauer === undefined || ansturm === undefined) throw new Error('keiler: hauer and ansturm');
    // Unclamped they would leave the frame: 0,3 × 0,75 = 0,225 s, (0,6 + 0,2) × 1,25 = 1,0 s.
    expect(hauer.ausholzeit * D.windupFactor.unbarmherzig).toBeLessThan(WINDUP_MIN_SECONDS);
    expect((ansturm.ausholzeit + (ansturm.anlauf ?? 0)) * D.windupFactor.entspannt).toBeGreaterThan(WINDUP_MAX_SECONDS);
    expect(windupTicks(hauer, 'hart')).toBe(Math.round(WINDUP_MIN_SECONDS * HZ));
    expect(windupTicks(hauer, 'unbarmherzig')).toBe(Math.round(WINDUP_MIN_SECONDS * HZ));
    expect(windupTicks(ansturm, 'entspannt')).toBe(Math.round(WINDUP_MAX_SECONDS * HZ));
    // The readable pose keeps its share of the wind-up (the run-up follows it).
    expect(windupPoseTicks(ansturm, 'entspannt')).toBe(Math.round(Math.round(WINDUP_MAX_SECONDS * HZ) * (ansturm.ausholzeit / (ansturm.ausholzeit + (ansturm.anlauf ?? 0)))));
  });

  it('Schaden nach Schwierigkeit (×0,6 / ×1 / ×1,3 / ×1,5)', () => {
    expect(creatureDamage(10, 'entspannt')).toBe(6);
    expect(creatureDamage(10, 'normal')).toBe(10);
    expect(creatureDamage(10, 'hart')).toBe(13);
    expect(creatureDamage(10, 'unbarmherzig')).toBe(15);
  });
});

/** Runs until the first telegraph and returns it. */
function untilTelegraph(w: ReturnType<typeof kreaturWelt>): { telegraph: Telegraph; tick: number } {
  for (let i = 0; i < 600; i++) {
    const ev = w.run(1);
    const t = eventsOf<Telegraph>(ev, 'creatureTelegraph');
    if (t.length > 0) return { telegraph: t[0] as Telegraph, tick: (t[0] as Telegraph).tick };
  }
  throw new Error('no telegraph');
}

describe('Telegraph im Spiel', () => {
  it('der Schlag landet genau nach den angekündigten Ticks, mit dem Schaden der Schwierigkeit', () => {
    for (const difficulty of ['normal', 'hart'] as const) {
      const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
      w.life.death.setDifficulty(difficulty);
      const wolf = w.creature('probe_wolf', 20, 12);
      const { telegraph, tick } = untilTelegraph(w);
      expect(telegraph.entity).toBe(wolf);
      expect(telegraph.angriff).toBe('biss');
      expect(telegraph.ticks).toBe(windupTicks({ ausholzeit: 0.4 }, difficulty));
      expect(telegraph.flaeche).toBeNull();
      let attack: Attack | undefined;
      let hit: Hit | undefined;
      for (let i = 0; i < telegraph.ticks + 2 && attack === undefined; i++) {
        const ev = w.run(1);
        attack = eventsOf<Attack>(ev, 'creatureAttack')[0];
        hit = eventsOf<Hit>(ev, 'hitLanded').find((h) => h.target === w.sim.player);
      }
      expect(attack?.tick).toBe(tick + telegraph.ticks);
      expect(hit).toBeDefined();
      const base = creatureDamage(6, difficulty);
      expect([base, base * BALANCE.combat.damage.critFactor].map((v) => Math.round(v * 1000))).toContain(Math.round((hit as Hit).amount * 1000));
    }
  });

  it('eine Rolle durch das Ausholen entgeht dem Schlag', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    w.creature('probe_wolf', 20, 12);
    const { telegraph } = untilTelegraph(w);
    const health = w.vit().health;
    // Rollen, sobald die Unverwundbarkeit den Schlag abdeckt (0,25 s vor ihm), weg vom Wolf (er kommt von Norden).
    const before = telegraph.ticks - Math.round(BALANCE.player.roll.invulnerableSeconds * HZ) + 2;
    w.run(before);
    const ev = w.run(telegraph.ticks, [{ type: 'player.roll', dx: 0, dy: 1 }]);
    expect(eventsOf<Attack>(ev, 'creatureAttack')).toHaveLength(1);
    expect(eventsOf<Hit>(ev, 'hitLanded').filter((h) => h.target === w.sim.player)).toEqual([]);
    expect(w.vit().health).toBe(health);
  });

  it('eine Parade kurz vor dem Schlag lässt den Wolf taumeln', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    w.hold('probe_schwert');
    const wolf = w.creature('probe_wolf', 20, 12);
    const { telegraph } = untilTelegraph(w);
    w.aimBy(0, -40);
    w.run(telegraph.ticks - 4);
    const ev = w.run(6, [{ type: 'combat.block', on: true }]);
    expect(eventsOf(ev, 'parried')).toHaveLength(1);
    expect(w.state(wolf).staggerUntilTick).toBeGreaterThanOrEqual(w.sim.tick - 1);
    expect(w.state(wolf).attackPhase).not.toBe('ausholen');
  });

  it('der Stampfer des Nachtmahrs markiert seine Fläche am Boden', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    w.cheats.god = true;
    w.light.ambient = 0.05;
    w.cenv.phase = 'nacht';
    const mare = w.creature('nachtmahr', 22, 15);
    const seen: Telegraph[] = [];
    for (let i = 0; i < 1200 && !seen.some((t) => t.angriff === 'stampfen'); i++) seen.push(...eventsOf<Telegraph>(w.run(1), 'creatureTelegraph'));
    const stomp = seen.find((t) => t.angriff === 'stampfen');
    expect(stomp?.entity).toBe(mare);
    const radius = CREATURES.find((c) => c.id === 'nachtmahr')?.angriffe.find((a) => a.name === 'stampfen')?.flaeche?.radius;
    expect(stomp?.flaeche?.radius).toBe(radius);
  });
});
