/**
 * M6-05 "Einschlagpartikel je Material, Screenshake skaliert (aus → keiner), Waffen-Smears, Auflösen besiegter Gegner"
 * (MASTERPROMPT §6.2 "Kampf", §19.1, §29 "Bildschirmwackeln"; docs/SPIEL.md §13): what a hit sheds depends on the body's
 * material and flies away from the attacker, more for a heavier blow and a crit; the camera's shake is whole pixels,
 * decays within its ticks and scales with the setting down to none; a swing leaves a trail on its arc at the blow's reach
 * that dims from where it began; shadow brood falls apart in wisps and violet sparks. All timed in simulation ticks and
 * deterministic.
 */
import { describe, expect, it } from 'vitest';
import { HIT_MATERIALS } from '../../../src/game/combat/targets';
import { GameSession } from '../../../src/game/session';
import type { AtlasData, AtlasManifest } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc, type SpriteFrameRef } from '../../../src/render/batch/spriteList';
import { CombatView, createCombatFrame } from '../../../src/render/game/combat';
import { CombatFeedback, MATERIAL_IMPACT, PARTICLES, PUNKT, SHAKE } from '../../../src/render/game/combatFeedback';
import type { RenderScene } from '../../../src/render/scene';

const MANIFEST: AtlasManifest = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
const HZ = 60;

interface Pushed {
  sprite: string;
  frame: number;
  x: number;
  y: number;
  tint: number;
}

function draw(feedback: CombatFeedback, now: number, layer: 0 | -1 = 0): Pushed[] {
  const owner = new Map<SpriteFrameRef, [string, number]>();
  for (const s of Object.values(MANIFEST.sprites)) s.frames.forEach((f, i) => owner.set(f, [s.id, i]));
  const pushed: Pushed[] = [];
  const scene = {
    sprite: new SpriteDesc(),
    sprites: {
      push(d: SpriteDesc) {
        const o = owner.get(d.frame as SpriteFrameRef);
        pushed.push({ sprite: o?.[0] ?? '?', frame: o?.[1] ?? -1, x: d.x, y: d.y, tint: d.tintStrength });
        return pushed.length - 1;
      },
    },
    water: { impulse: () => true },
    light: { reset: () => ({}) },
    lights: { push: () => undefined },
    post: { distortion: { shockwave: () => 0 } },
  } as unknown as RenderScene;
  feedback.draw(scene, MANIFEST, layer, now, HZ);
  return pushed;
}

describe('Einschlagpartikel je Material', () => {
  it('jedes Material wirft seine Stücke (und seinen Akzent), vom Angreifer weg, nur auf seiner Ebene', () => {
    for (const material of HIT_MATERIALS) {
      const m = MATERIAL_IMPACT[material];
      const f = new CombatFeedback();
      f.impact(material, 100, 100, 10, 1, 0, 3, false, 50, 0, 1);
      const early = draw(f, 51);
      const main = early.filter((p) => p.sprite === PARTICLES[m.main].sprite);
      expect(main.length, material).toBeGreaterThanOrEqual(2 + 3);
      if (m.accent !== null) expect(early.some((p) => p.sprite === PARTICLES[m.accent as keyof typeof PARTICLES].sprite), material).toBe(true);
      const sprites = new Set(early.map((p) => p.sprite));
      expect([...sprites].sort(), material).toEqual([...new Set([PARTICLES[m.main].sprite, ...(m.accent === null ? [] : [PARTICLES[m.accent].sprite])])].sort());
      // They fly away from the attacker (the blow came along +x).
      const later = draw(f, 60);
      const mean = later.reduce((a, p) => a + p.x, 0) / Math.max(1, later.length);
      expect(mean, material).toBeGreaterThan(100);
      expect(draw(f, 55, -1), material).toEqual([]);
      // Gone after their life.
      expect(draw(f, 50 + HZ * 2), material).toEqual([]);
    }
    // The other way round: from the other side.
    const back = new CombatFeedback();
    back.impact('fleisch', 100, 100, 10, -1, 0, 3, false, 50, 0, 1);
    const pieces = draw(back, 60);
    expect(pieces.reduce((a, p) => a + p.x, 0) / pieces.length).toBeLessThan(100);
  });

  it('mehr Stücke bei mehr Wucht und bei einem Krit; gleiche Eingaben, gleiches Bild', () => {
    const count = (wucht: number, crit: boolean): number => {
      const f = new CombatFeedback();
      f.impact('holz', 100, 100, 10, 0, 1, wucht, crit, 50, 0, 1);
      return draw(f, 51).length;
    };
    expect(count(5, false)).toBeGreaterThan(count(1, false));
    expect(count(3, true)).toBeGreaterThan(count(3, false));
    const a = new CombatFeedback();
    const b = new CombatFeedback();
    a.impact('stein', 80, 90, 6, 1, 0, 2, false, 70, 0, 4);
    b.impact('stein', 80, 90, 6, 1, 0, 2, false, 70, 0, 4);
    expect(draw(a, 75.5)).toEqual(draw(b, 75.5));
  });

  it('Schattenbrut löst sich auf: Schwaden und violette Funken steigen aus ihrem Körper', () => {
    const f = new CombatFeedback();
    f.dissolve(300, 200, 12, 32, 10, 0);
    const now = draw(f, 12);
    const wisps = now.filter((p) => p.sprite === PARTICLES.schatten.sprite);
    const sparks = now.filter((p) => p.sprite === PARTICLES.funken.sprite);
    expect(wisps.length).toBeGreaterThanOrEqual(8);
    expect(sparks.length).toBe(wisps.length);
    for (const s of sparks) expect(s.tint).toBeGreaterThan(0);
    expect(draw(f, 10 + HZ * 2)).toEqual([]);
  });
});

describe('Screenshake', () => {
  it('ganze Pixel, klingt in seinen Ticks ab, skaliert mit der Einstellung; 0 % wackelt nie', () => {
    const f = new CombatFeedback();
    f.shake(3, 100);
    const out = { x: 0, y: 0 };
    let moved = 0;
    for (let t = 100; t < 100 + SHAKE.ticks; t += 0.5) {
      const o = f.shakeOffset(t, 1, out);
      expect(Number.isInteger(o.x) && Number.isInteger(o.y)).toBe(true);
      expect(Math.abs(o.x)).toBeLessThanOrEqual(3);
      expect(Math.abs(o.y)).toBeLessThanOrEqual(3);
      if (o.x !== 0 || o.y !== 0) moved++;
      const half = f.shakeOffset(t, 0.5, { x: 0, y: 0 });
      expect(Math.abs(half.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(half.y)).toBeLessThanOrEqual(2);
      expect(f.shakeOffset(t, 0, { x: 9, y: 9 })).toEqual({ x: 0, y: 0 });
    }
    expect(moved).toBeGreaterThan(4);
    expect(f.shakeOffset(100 + SHAKE.ticks, 1, out)).toEqual({ x: 0, y: 0 });
    expect(f.shakeOffset(99, 1, out)).toEqual({ x: 0, y: 0 });
    // A weaker shake does not cut a stronger one short; a stronger one takes over.
    f.shake(1, 102);
    expect(f.shakeLeft(102)).toBeCloseTo(3 * (1 - 2 / SHAKE.ticks), 12);
    f.shake(5, 104);
    expect(f.shakeLeft(104)).toBe(5);
    f.shake(0, 105);
    expect(f.shakeLeft(105)).toBeCloseTo(5 * (1 - 1 / SHAKE.ticks), 12);
  });
});

describe('Waffen-Smear', () => {
  it('ein Hieb zieht seine Spur auf dem Bogen in Reichweite (Handhöhe), sie verblasst von ihrem Anfang her', () => {
    const f = new CombatFeedback();
    const reach = 22;
    f.smear(200, 200, 0, 0, reach, 90, 1, false, 10);
    const fresh = draw(f, 10.5).filter((p) => p.sprite === 'kampf_punkt');
    expect(fresh.length).toBeGreaterThan(40);
    for (const p of fresh) {
      const d = Math.hypot(p.x - 200, p.y - (200 - 8));
      expect(d).toBeGreaterThan(reach - 2.5);
      expect(d).toBeLessThan(reach + 1);
      // Within the 90° swing around the aim (east).
      expect(p.x - 200).toBeGreaterThan(reach * Math.cos(Math.PI / 4) - 2);
    }
    expect(new Set(fresh.map((p) => p.frame)).has(PUNKT.schmier)).toBe(true);
    // Later: the start of the swing (its upper end, sense +1 sweeps downwards) dims before its end.
    const mid = draw(f, 15).filter((p) => p.sprite === 'kampf_punkt');
    const dimTop = mid.filter((p) => p.y < 192 && p.frame !== PUNKT.schmier).length;
    const dimBottom = mid.filter((p) => p.y > 192 && p.frame !== PUNKT.schmier).length;
    expect(dimTop).toBeGreaterThan(dimBottom);
    expect(draw(f, 10 + 9)).toEqual([]);
  });

  it('ein Stoß (schmaler Bogen) ist ein Strich entlang des Ziels', () => {
    const f = new CombatFeedback();
    f.smear(100, 100, 0, Math.PI / 2, 30, 20, 1, false, 5);
    const streak = draw(f, 5).filter((p) => p.sprite === 'kampf_punkt');
    expect(streak.length).toBeGreaterThan(10);
    for (const p of streak) {
      expect(p.x).toBe(100);
      expect(p.y).toBeGreaterThan(100 - 8);
    }
  });
});

describe('Schlagspur nur für Hiebe', () => {
  it('ein Schwerthieb zieht seine Spur, ein Bogenschuss keine (sein Pfeil ist das Bild)', () => {
    const smearsOf = (weapon: string, ammo: string | null, hold: number): number => {
      const session = new GameSession({ config: { seed: 20260930, worldSize: 'small', dayLengthMinutes: 12 } });
      const view = new CombatView();
      view.follow(session, () => 'Parade!');
      let started = 0;
      session.onEvent('attackStarted', () => started++);
      session.command({ type: 'player.spawn' });
      session.step();
      session.command({ type: 'debug.god', on: true });
      session.command({ type: 'inventory.give', item: weapon, count: 1 });
      if (ammo !== null) session.command({ type: 'inventory.give', item: ammo, count: 3 });
      session.step();
      const p = session.debugState().player;
      if (p === null) throw new Error('kein Spieler');
      session.command({ type: 'player.selectHotbar', index: 0 });
      session.command({ type: 'player.aim', x: Math.round(p.x + 64), y: Math.round(p.y) });
      session.command({ type: 'combat.attack', on: true });
      for (let k = 0; k < hold; k++) session.step();
      session.command({ type: 'combat.attack', on: false });
      for (let k = 0; k < 40 && started === 0; k++) session.step();
      expect(started, weapon).toBe(1);
      const scene = {
        sprite: new SpriteDesc(),
        sprites: { push: () => 0 },
        worldUi: { damage: () => undefined },
        water: { impulse: () => true },
        light: { reset: () => ({}) },
        lights: { push: () => undefined },
        post: { distortion: { shockwave: () => 0 } },
      } as unknown as RenderScene;
      view.draw(scene, { manifest: MANIFEST } as unknown as AtlasData, session.sim, createCombatFrame());
      const n = view.info().smears;
      view.dispose();
      return n;
    };
    expect(smearsOf('bronzeschwert', null, 1)).toBe(1);
    expect(smearsOf('kurzbogen', 'pfeil_feuerstein', 50)).toBe(0);
  });
});
