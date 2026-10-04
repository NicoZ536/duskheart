/**
 * M6-07, M6-08 presentation (MASTERPROMPT §19.2, §6.2; docs/SPIEL.md §10 "Projektile", §13): projectiles in flight and at
 * rest – every item flies as its own clip of the projectile sprites (or its class's, a spear as its hand sprite); an arrow
 * turns freely to its direction on screen, a throw rises and falls on its parabola above its ground shadow and tumbles; an
 * arrow that stuck without a drop stays at the angle it came in, then fades; one that sank kicks the waves.
 * M6-05c: an arrow that stuck in a body stays in it – moving with the creature at its flight height – until the creature
 * dies or leaves; at most four per body.
 */
import { describe, expect, it } from 'vitest';
import type { CombatSystem } from '../../../src/game/combat/system';
import { createSimulation } from '../../../src/game/setup';
import type { Simulation } from '../../../src/game/sim';
import type { AtlasManifest } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc, type SpriteFrameRef } from '../../../src/render/batch/spriteList';
import { CombatFeedback } from '../../../src/render/game/combatFeedback';
import type { CreatureSystem } from '../../../src/game/creatures/system';
import type { CreatureState } from '../../../src/game/creatures/state';
import { BALANCE } from '../../../src/content/balance';
import { IN_BODY, ProjectileView, resolveLook, type ProjectileBodies } from '../../../src/render/game/projectiles';
import type { RenderScene } from '../../../src/render/scene';

const MANIFEST: AtlasManifest = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
const TILE = 16;

interface Pushed {
  sprite: string;
  x: number;
  y: number;
  depth: number;
  heightBase: number;
  rotation: number;
  layer: string;
  fade: number;
}

function recordingScene(): { scene: RenderScene; pushed: Pushed[]; impulses: { kind: string; x: number; y: number }[] } {
  const owner = new Map<SpriteFrameRef, string>();
  for (const s of Object.values(MANIFEST.sprites)) s.frames.forEach((f) => owner.set(f, s.id));
  const pushed: Pushed[] = [];
  const impulses: { kind: string; x: number; y: number }[] = [];
  const scene = {
    sprite: new SpriteDesc(),
    sprites: {
      push(d: SpriteDesc) {
        pushed.push({ sprite: owner.get(d.frame as SpriteFrameRef) ?? '?', x: d.x, y: d.y, depth: d.depth, heightBase: d.heightBase, rotation: d.rotation, layer: d.layer, fade: d.fade });
        return pushed.length - 1;
      },
    },
    water: { impulse: (kind: string, x: number, y: number) => impulses.push({ kind, x, y }) },
    light: { reset: () => ({}) },
    lights: { push: () => undefined },
    post: { distortion: { shockwave: () => 0 } },
  } as unknown as RenderScene;
  return { scene, pushed, impulses };
}

/** A world with the player holding `weapon` (and `ammo`), aiming `dx`, `dy` tiles away. */
function shooter(weapon: string, ammo: string | null, dx: number, dy: number): { sim: Simulation; combat: CombatSystem; x: number; y: number } {
  const sim = createSimulation({ seed: 20260930, worldSize: 'small' });
  sim.step([{ type: 'player.spawn' } as never]);
  const give = [{ type: 'debug.god', on: true }, { type: 'inventory.give', item: weapon, count: 2 }, ...(ammo === null ? [] : [{ type: 'inventory.give', item: ammo, count: 5 }])];
  sim.step(give as never);
  const pos = sim.ecs.component('position') as unknown as { get(e: number, c: 'x' | 'y'): number };
  const x = pos.get(sim.player, 'x');
  const y = pos.get(sim.player, 'y');
  sim.step([{ type: 'player.selectHotbar', index: 0 }, { type: 'player.aim', x: Math.round(x + dx * TILE), y: Math.round(y + dy * TILE) }] as never);
  return { sim, combat: sim.system('combat') as CombatSystem, x, y };
}

describe('Geschosse: Aussehen je Item', () => {
  it('jede Munition und Wurfwaffe fliegt als ihr Clip, ein Speer als seine Hand-Sprite, ein Item ohne Flugbild gar nicht', () => {
    const at = (item: string) => {
      const look = resolveLook(item, MANIFEST);
      return look === null ? null : { sprite: look.sprite.id, clip: look.clip?.name ?? null, spin: look.spin > 0, sticks: look.sticks };
    };
    expect(at('pfeil_feuerstein')).toEqual({ sprite: 'geschoss_pfeil', clip: 'pfeil_feuerstein', spin: false, sticks: true });
    expect(at('pfeil_bronze')?.clip).toBe('pfeil_bronze');
    expect(at('pfeil_feuer')).toEqual({ sprite: 'geschoss_brandpfeil', clip: 'pfeil_feuer', spin: false, sticks: true });
    expect(at('pfeil_leucht')?.sprite).toBe('geschoss_leuchtpfeil');
    expect(at('bolzen_bronze')?.sprite).toBe('geschoss_bolzen');
    expect(at('schleuderstein')).toEqual({ sprite: 'geschoss_stein', clip: 'schleuderstein', spin: false, sticks: false });
    expect(at('wurfmesser_bronze')).toEqual({ sprite: 'geschoss_messer', clip: 'wurfmesser_bronze', spin: true, sticks: true });
    expect(at('brandflasche')).toEqual({ sprite: 'geschoss_flasche', clip: 'brandflasche', spin: true, sticks: false });
    expect(at('bronzespeer')).toEqual({ sprite: 'ausruestung_bronzespeer', clip: null, spin: false, sticks: false });
    expect(at('holz')).toBeNull();
    // A creature's shot (M6-15b): no item – the sprite of its id, clip `flug`, a burst `aufprall` where it stops.
    expect(at('geschoss_spucken')).toEqual({ sprite: 'geschoss_spucken', clip: 'flug', spin: false, sticks: false });
    expect(resolveLook('geschoss_spucken', MANIFEST)?.impact?.name).toBe('aufprall');
    expect(resolveLook('geschoss_unbekannt', MANIFEST)).toBeNull();
  });

  it('der Schuss einer Kreatur zerplatzt, wo er liegen bleibt: sein Clip `aufprall` einmal, in Flugrichtung, dann nichts', () => {
    const view = new ProjectileView();
    const feedback = new CombatFeedback();
    view.fired({ entity: 9, owner: 3, item: 'geschoss_spucken', klasse: 'wurf', vx: 0, vy: 150, tension: 1, layer: 0, x: 0, y: 0, tick: 10 });
    view.stuck({ entity: 9, item: 'geschoss_spucken', wo: 'boden', drop: false, layer: 0, x: 120, y: 90, tick: 20 }, MANIFEST, feedback);
    const sprite = MANIFEST.sprites['geschoss_spucken'];
    const clip = sprite?.clips['aufprall'];
    if (sprite === undefined || clip === undefined) throw new Error('geschoss_spucken ohne Clip aufprall');
    // On another layer: nothing.
    const other = recordingScene();
    view.draw(other.scene, MANIFEST, null, -1, 21, 1, 60);
    expect(other.pushed).toEqual([]);
    const frames: number[] = [];
    let last = 0;
    for (let t = 20; t < 20 + 60; t++) {
      const r = recordingScene();
      view.draw(r.scene, MANIFEST, null, 0, t, 1, 60);
      const splat = r.pushed.filter((p) => p.sprite === 'geschoss_spucken');
      if (splat.length === 0) continue;
      expect(splat).toHaveLength(1);
      expect(splat[0]?.x).toBe(120);
      expect(splat[0]?.rotation).toBeCloseTo(Math.PI / 2, 6);
      frames.push(t);
      last = t;
    }
    expect(frames[0]).toBe(20);
    // As long as its clip lasts, then gone; no stuck arrow is left behind.
    expect(last - 20 + 1).toBe(Math.ceil((clip.frames.length / clip.fps) * 60));
    expect(view.stats.stuck).toBe(0);
  });
});

describe('Geschosse im Flug', () => {
  it('ein Pfeil zeigt in seine Flugrichtung (frei gedreht), fliegt in Flughöhe über seinem Schatten, interpoliert mit Alpha', () => {
    const { sim, combat } = shooter('kurzbogen', 'pfeil_feuerstein', 6, -3);
    sim.step([{ type: 'combat.attack', on: true } as never]);
    for (let k = 0; k < 50; k++) sim.step([]);
    sim.step([{ type: 'combat.attack', on: false } as never]);
    sim.step([]);
    const store = combat.projectiles;
    expect(store.size).toBe(1);
    const c = store.columns;
    const view = new ProjectileView();
    const r = recordingScene();
    view.draw(r.scene, MANIFEST, combat, 0, sim.tick - 1 + 0.5, 0.5, 60);
    const arrow = r.pushed.find((p) => p.sprite === 'geschoss_pfeil');
    const shadow = r.pushed.find((p) => p.sprite === 'drop_schatten');
    expect(arrow).toBeDefined();
    expect(shadow?.layer).toBe('ground');
    const vx = c.vx[0] as number;
    const vy = c.vy[0] as number;
    expect(arrow?.rotation).toBeCloseTo(Math.atan2(vy, vx), 9);
    expect(arrow?.rotation).toBeLessThan(0);
    // Half a tick back along its velocity, lifted to the flight height above the shadow.
    expect(arrow?.x).toBeCloseTo((c.x[0] as number) - vx / 60 / 2, 6);
    expect(shadow?.x).toBeCloseTo(arrow?.x ?? 0, 9);
    expect((shadow?.y ?? 0) - (arrow?.y ?? 0)).toBeCloseTo(8, 9);
    expect(arrow?.depth).toBeCloseTo(shadow?.y ?? 0, 9);
    // Not on another layer.
    const other = recordingScene();
    view.draw(other.scene, MANIFEST, combat, -1, sim.tick, 1, 60);
    expect(other.pushed.filter((p) => p.sprite === 'geschoss_pfeil')).toEqual([]);
  });

  it('eine Brandflasche steigt und fällt auf ihrem Bogen über ihrem Schatten und überschlägt sich', () => {
    const { sim, combat } = shooter('brandflasche', null, 4, 0);
    // A throwable of the category ammunition lies in the bags: into the first hotbar slot.
    sim.step([{ type: 'inventory.move', from: { bereich: 'inventar', index: 0 }, to: { bereich: 'schnellleiste', index: 0 } }, { type: 'player.selectHotbar', index: 0 }] as never);
    sim.step([{ type: 'combat.attack', on: true } as never]);
    for (let k = 0; k < 40; k++) sim.step([]);
    sim.step([{ type: 'combat.attack', on: false } as never]);
    const view = new ProjectileView();
    const heights: number[] = [];
    const turns: number[] = [];
    for (let k = 0; k < 40 && combat.projectiles.size > 0; k++) {
      sim.step([]);
      const r = recordingScene();
      view.draw(r.scene, MANIFEST, combat, 0, sim.tick - 1 + 1, 1, 60);
      const flask = r.pushed.find((p) => p.sprite === 'geschoss_flasche');
      const shadow = r.pushed.find((p) => p.sprite === 'drop_schatten');
      if (flask === undefined || shadow === undefined) continue;
      heights.push(shadow.y - flask.y);
      turns.push(flask.rotation);
    }
    expect(heights.length).toBeGreaterThan(4);
    const peak = Math.max(...heights);
    expect(peak).toBeGreaterThan(4);
    expect(heights[0] as number).toBeLessThan(peak);
    expect(heights[heights.length - 1] as number).toBeLessThan(peak);
    expect(new Set(turns).size).toBeGreaterThan(3);
  });
});

describe('Geschosse in Ruhe', () => {
  it('ein steckender Pfeil bleibt im Winkel seines Flugs und verblasst am Ende; mit Drop zeigt ihn der Drop', () => {
    const view = new ProjectileView();
    const feedback = new CombatFeedback();
    view.fired({ entity: 7, owner: 0, item: 'pfeil_feuerstein', klasse: 'bogen', vx: 100, vy: 100, tension: 1, layer: 0, x: 0, y: 0, tick: 10 });
    view.stuck({ entity: 7, item: 'pfeil_feuerstein', wo: 'boden', drop: false, layer: 0, x: 200, y: 300, tick: 20 }, MANIFEST, feedback);
    view.stuck({ entity: 8, item: 'pfeil_feuerstein', wo: 'boden', drop: true, layer: 0, x: 250, y: 300, tick: 20 }, MANIFEST, feedback);
    const r = recordingScene();
    view.draw(r.scene, MANIFEST, null, 0, 30, 1, 60);
    const stuck = r.pushed.filter((p) => p.sprite === 'geschoss_pfeil');
    expect(stuck).toHaveLength(1);
    expect(stuck[0]?.rotation).toBeCloseTo(Math.PI / 4, 6);
    expect(stuck[0]?.x).toBeLessThan(200);
    expect(stuck[0]?.fade).toBe(0);
    const late = recordingScene();
    view.draw(late.scene, MANIFEST, null, 0, 20 + 60 * 19, 1, 60);
    expect(late.pushed.find((p) => p.sprite === 'geschoss_pfeil')?.fade).toBeGreaterThan(0);
    const gone = recordingScene();
    view.draw(gone.scene, MANIFEST, null, 0, 20 + 60 * 21, 1, 60);
    expect(gone.pushed.filter((p) => p.sprite === 'geschoss_pfeil')).toEqual([]);
  });

  it('was im tiefen Wasser versinkt, stößt im nächsten Bild die Wellen an (Pfeil leicht, Stein schwer) und spritzt', () => {
    const view = new ProjectileView();
    const feedback = new CombatFeedback();
    view.stuck({ entity: 1, item: 'pfeil_feuerstein', wo: 'wasser', drop: false, layer: 0, x: 100, y: 120, tick: 5 }, MANIFEST, feedback);
    view.stuck({ entity: 2, item: 'schleuderstein', wo: 'wasser', drop: false, layer: 0, x: 140, y: 120, tick: 5 }, MANIFEST, feedback);
    const r = recordingScene();
    feedback.draw(r.scene, MANIFEST, 0, 5.5, 60);
    expect(r.impulses).toEqual([
      { kind: 'arrow', x: 100, y: 120 },
      { kind: 'splash', x: 140, y: 120 },
    ]);
    expect(r.pushed.filter((p) => p.sprite === 'partikel_tropfen').length).toBeGreaterThan(0);
    // Once: the next frame kicks nothing.
    const next = recordingScene();
    feedback.draw(next.scene, MANIFEST, 0, 6.5, 60);
    expect(next.impulses).toEqual([]);
  });
});

/** Bodies for the view: creatures at positions the test moves (state: layer, level, last movement, health). */
function fakeBodies(): { bodies: ProjectileBodies; at: Map<number, { x: number; y: number; vx: number; vy: number; health: number; layer: number }> } {
  const at = new Map<number, { x: number; y: number; vx: number; vy: number; health: number; layer: number }>();
  const bodies = {
    store: {
      get: (e: number) => {
        const b = at.get(e);
        return b === undefined ? undefined : ({ health: b.health, layer: b.layer, level: 0, vx: b.vx, vy: b.vy } as unknown as CreatureState);
      },
    },
    positionOf: (e: number, out: { x: number; y: number }) => {
      const b = at.get(e);
      if (b === undefined) return false;
      out.x = b.x;
      out.y = b.y;
      return true;
    },
  } as unknown as ProjectileBodies;
  return { bodies, at };
}

describe('Pfeile im Körper (M6-05c)', () => {
  const Z = BALANCE.combat.projectile.flightHeightPx;
  const arrows = (r: ReturnType<typeof recordingScene>) => r.pushed.filter((p) => p.sprite === 'geschoss_pfeil');
  /** Projectile `p` of the player flies east and sticks in body `target` at (x, y) in tick `tick`. */
  const shootInto = (view: ProjectileView, p: number, target: number, x: number, y: number, tick: number) => {
    view.fired({ entity: p, owner: 0, item: 'pfeil_feuerstein', klasse: 'bogen', vx: 200, vy: 0, tension: 1, layer: 0, x: x - 50, y, tick: tick - 5 });
    view.hit({ entity: p, owner: 0, item: 'pfeil_feuerstein', target, wirkung: null, radius: 0, layer: 0, x, y, tick });
    view.stuck({ entity: p, item: 'pfeil_feuerstein', wo: 'ziel', drop: false, layer: 0, x, y, tick }, MANIFEST, new CombatFeedback());
  };

  it('der Pfeil bleibt stecken und wandert mit der Kreatur (interpoliert, in Flughöhe, vor ihr sortiert), auch lange danach', () => {
    const view = new ProjectileView();
    const { bodies, at } = fakeBodies();
    at.set(41, { x: 300, y: 200, vx: 0, vy: 0, health: 20, layer: 0 });
    shootInto(view, 7, 41, 294, 202, 100);
    expect(view.arrowsIn(41)).toBe(1);
    const first = recordingScene();
    view.draw(first.scene, MANIFEST, null, 0, 100.5, 0.5, 60, bodies);
    const a = arrows(first);
    expect(a).toHaveLength(1);
    expect(view.stats.inBodies).toBe(1);
    // At the angle it flew in; the hit point drawn back like a stuck arrow, lifted to the flight height.
    expect(a[0]?.rotation).toBeCloseTo(0, 9);
    expect(a[0]?.x).toBeCloseTo(294 - 3, 5);
    expect(a[0]?.y).toBeCloseTo(202 - Z, 5);
    expect(a[0]?.depth).toBeCloseTo(200 + IN_BODY.depthBias, 5);
    expect(a[0]?.heightBase).toBeCloseTo(Z, 5);
    // The body walks on: the arrow keeps its offset, interpolated like the body (half of the last tick's step still ahead).
    at.set(41, { x: 340, y: 230, vx: 2, vy: -1, health: 12, layer: 0 });
    const later = recordingScene();
    view.draw(later.scene, MANIFEST, null, 0, 100 + 60 * 60, 0.5, 60, bodies);
    const b = arrows(later);
    expect(b).toHaveLength(1);
    expect(b[0]?.x).toBeCloseTo(340 - 1 + (294 - 3 - 300), 5);
    expect(b[0]?.y).toBeCloseTo(230 + 0.5 + (202 - 200) - Z, 5);
    expect(b[0]?.fade).toBe(0);
    // No time limit like an arrow in the ground (20 s): a minute later it is still there.
    expect(view.stats.stuck).toBe(0);
  });

  it('stirbt die Kreatur oder verlässt sie die Welt, verschwindet der Pfeil; auf einer anderen Ebene wird er nur nicht gezeichnet', () => {
    const view = new ProjectileView();
    const { bodies, at } = fakeBodies();
    at.set(1, { x: 100, y: 100, vx: 0, vy: 0, health: 20, layer: 0 });
    at.set(2, { x: 200, y: 100, vx: 0, vy: 0, health: 20, layer: 0 });
    at.set(3, { x: 300, y: 100, vx: 0, vy: 0, health: 20, layer: -1 });
    shootInto(view, 11, 1, 95, 100, 10);
    shootInto(view, 12, 2, 195, 100, 10);
    shootInto(view, 13, 3, 295, 100, 10);
    const r = recordingScene();
    view.draw(r.scene, MANIFEST, null, 0, 11, 1, 60, bodies);
    expect(arrows(r)).toHaveLength(2);
    expect(view.arrowsIn(3)).toBe(1);
    // Body 1 dies (health 0), body 2 leaves (despawned, its chunk froze): their arrows go.
    at.set(1, { x: 100, y: 100, vx: 0, vy: 0, health: 0, layer: 0 });
    at.delete(2);
    const after = recordingScene();
    view.draw(after.scene, MANIFEST, null, 0, 12, 1, 60, bodies);
    expect(arrows(after)).toEqual([]);
    expect([view.arrowsIn(1), view.arrowsIn(2), view.arrowsIn(3)]).toEqual([0, 0, 1]);
    // Without the bodies (no creature system) nothing is drawn, nothing lost.
    const none = recordingScene();
    view.draw(none.scene, MANIFEST, null, -1, 12, 1, 60);
    expect(arrows(none)).toEqual([]);
    expect(view.arrowsIn(3)).toBe(1);
  });

  it('höchstens vier Pfeile je Körper – der fünfte verdrängt den ältesten; ohne Treffer-Ereignis und mit Drop steckt keiner', () => {
    const view = new ProjectileView();
    const { bodies, at } = fakeBodies();
    at.set(5, { x: 100, y: 100, vx: 0, vy: 0, health: 50, layer: 0 });
    for (let k = 0; k < IN_BODY.perBody + 1; k++) shootInto(view, 100 + k, 5, 96, 90 + 4 * k, 10 + k);
    expect(IN_BODY.perBody).toBe(4);
    expect(view.arrowsIn(5)).toBe(IN_BODY.perBody);
    const r = recordingScene();
    view.draw(r.scene, MANIFEST, null, 0, 20, 1, 60, bodies);
    // The first arrow (at y 90) was pushed out.
    expect(arrows(r).map((p) => Math.round(p.y + Z)).sort((a, b) => a - b)).toEqual([94, 98, 102, 106]);
    // A body hit without a known target, or an arrow that dropped as an item, stays out of the bodies.
    view.stuck({ entity: 999, item: 'pfeil_feuerstein', wo: 'ziel', drop: false, layer: 0, x: 96, y: 100, tick: 30 }, MANIFEST, new CombatFeedback());
    view.hit({ entity: 998, owner: 0, item: 'pfeil_feuerstein', target: 5, wirkung: null, radius: 0, layer: 0, x: 96, y: 100, tick: 30 });
    view.stuck({ entity: 998, item: 'pfeil_feuerstein', wo: 'ziel', drop: true, layer: 0, x: 96, y: 100, tick: 30 }, MANIFEST, new CombatFeedback());
    const same = recordingScene();
    view.draw(same.scene, MANIFEST, null, 0, 31, 1, 60, bodies);
    expect(arrows(same).map((p) => Math.round(p.y + Z)).sort((a, b) => a - b)).toEqual([94, 98, 102, 106]);
    // The pool is shared: 24 arrows in six bodies fill it, a seventh body's arrow replaces the oldest of all.
    const pool = new ProjectileView();
    for (let b = 0; b < IN_BODY.capacity / IN_BODY.perBody + 1; b++) {
      at.set(200 + b, { x: 50 * b, y: 300, vx: 0, vy: 0, health: 50, layer: 0 });
      for (let k = 0; k < IN_BODY.perBody; k++) shootInto(pool, 1000 + 10 * b + k, 200 + b, 50 * b - 4, 300, 100 * b + k);
    }
    const counts = Array.from({ length: IN_BODY.capacity / IN_BODY.perBody + 1 }, (_, b) => pool.arrowsIn(200 + b));
    expect(counts.reduce((n, c) => n + c, 0)).toBe(IN_BODY.capacity);
    expect(counts[0]).toBe(0);
    expect(counts.at(-1)).toBe(IN_BODY.perBody);
  });

  it('im Spiel: ein Pfeil des Kurzbogens steckt im Keiler, bis er erlegt ist', () => {
    const { sim, combat, x, y } = shooter('kurzbogen', 'pfeil_feuerstein', 5, 0);
    const creatures = sim.system('creatures') as CreatureSystem;
    sim.step([{ type: 'creature.spawn', creature: 'keiler', count: 1, x: Math.round(x + 5 * TILE), y: Math.round(y), layer: 0 } as never]);
    const view = new ProjectileView();
    const feedback = new CombatFeedback();
    // One tick, then the presentation reads its events like the combat view (hit before rest).
    const step = (cmds: unknown[] = []): void => {
      sim.step(cmds as never);
      sim.events.forEachOfType('projectileHit', (e) => view.hit(e));
      sim.events.forEachOfType('projectileStuck', (e) => view.stuck(e, MANIFEST, feedback));
      sim.events.clear();
    };
    // The world has its wildlife: the boar is the creature of that kind.
    let boar = -1;
    for (let i = 0; i < creatures.store.size; i++) if (creatures.store.valueAt(i).creature === 'keiler') boar = creatures.store.entityAt(i);
    expect(boar).toBeGreaterThanOrEqual(0);
    step([{ type: 'combat.attack', on: true }]);
    for (let k = 0; k < 50; k++) step();
    step([{ type: 'combat.attack', on: false }]);
    for (let k = 0; k < 40 && view.arrowsIn(boar) === 0; k++) step();
    expect(view.arrowsIn(boar)).toBe(1);
    const r = recordingScene();
    view.draw(r.scene, MANIFEST, combat, 0, sim.tick, 1, 60, creatures);
    expect(arrows(r)).toHaveLength(1);
    step([{ type: 'creature.kill', radius: 30 }]);
    step();
    const after = recordingScene();
    view.draw(after.scene, MANIFEST, combat, 0, sim.tick, 1, 60, creatures);
    expect(arrows(after)).toEqual([]);
    expect(view.arrowsIn(boar)).toBe(0);
  });
});
