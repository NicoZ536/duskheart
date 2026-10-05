/**
 * M6-Gate (hitstop.png: "Glint sitzt auf dem Gesicht der Figur"; MASTERPROMPT §4.6 Lesbarkeit, §6.2 Kampf-Feedback;
 * src/render/game/combat.ts `CHARGED_GLINT`, src/render/anim/figure.ts `HandPoint`): once a held blow turns heavy, its glint
 * shines on the weapon – the `wirkpunkt` of the item in the hand as the figure drew it (blade, club head, spear tip), turned
 * with it –, follows it while the blow is held and is gone when the blow is let go. It glows less than a telegraph's glint
 * (its bloom must not burn out the face beside it). Before, it stood at a fixed point 8 px ahead and 14 px up – the face of
 * the profile figure – and outlived the swing into the hitstop.
 */
import { describe, expect, it } from 'vitest';
import { createCombatSample } from '../../../src/game/combat/sample';
import type { Simulation } from '../../../src/game/sim';
import { atlasFrameOf, defaultFigureState, HandPoint } from '../../../src/render/anim/figure';
import { spriteFrame, type AtlasData, type AtlasManifest } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc, type SpriteFrameRef, type SpriteList } from '../../../src/render/batch/spriteList';
import { CombatView, createCombatFrame } from '../../../src/render/game/combat';
import { GLINT_SPRITE, GLINT_TICKS } from '../../../src/render/game/combatFeedback';
import { buildPlayerFigure, START_CLOTHING } from '../../../src/render/game/playerFigure';
import type { RenderScene } from '../../../src/render/scene';

const MANIFEST: AtlasManifest = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
const ATLAS: AtlasData = { manifest: MANIFEST, albedo: { kind: 'pixels', pixels: new Uint8Array(4) }, normal: { kind: 'pixels', pixels: new Uint8Array(4) } };
const HZ = 60;
const GLINT_FRAMES = new Set<SpriteFrameRef>(MANIFEST.sprites[GLINT_SPRITE]?.frames ?? []);

interface Glint {
  readonly x: number;
  readonly y: number;
  readonly boost: number;
}

/** A scene that keeps the glints pushed (the rest of the fight's parts draw nothing here). */
function glintScene(): { scene: RenderScene; glints: Glint[] } {
  const glints: Glint[] = [];
  const scene = {
    sprite: new SpriteDesc(),
    sprites: {
      push(d: SpriteDesc) {
        if (GLINT_FRAMES.has(d.frame as SpriteFrameRef)) glints.push({ x: d.x, y: d.y, boost: d.emissiveBoost });
        return 0;
      },
    },
    worldUi: { damage: () => undefined, label: () => undefined },
    water: { impulse: () => undefined },
    light: { reset: () => ({}) },
    lights: { push: () => undefined },
    post: { distortion: { shockwave: () => undefined } },
  } as unknown as RenderScene;
  return { scene, glints };
}

function fakeSim(): Simulation & { tick: number } {
  return { tick: 0, clock: { tickHz: HZ }, systems: [], player: 1 } as unknown as Simulation & { tick: number };
}

/** A view following a session whose `attackWindup` (heavy, ready at tick 130) the test raises. */
function chargedView(sim: Simulation): CombatView {
  let windup: ((e: unknown) => void) | null = null;
  const session = {
    sim,
    onEvent(name: string, h: (e: unknown) => void) {
      if (name === 'attackWindup') windup = h;
      return () => undefined;
    },
  };
  const view = new CombatView();
  view.follow(session as never, () => 'Parade!');
  if (windup === null) throw new Error('attackWindup nicht abonniert');
  (windup as (e: unknown) => void)({ entity: 1, klasse: 'keule', schwer: true, ticks: 30, tick: 100 });
  return view;
}

describe('Der Glint des aufgeladenen Schlags sitzt auf der Waffe (M6-Gate, hitstop)', () => {
  it('auf dem Wirkpunkt der Waffe, wie die Figur sie zeichnete; er folgt ihr, solange gehalten wird, und erlischt beim Loslassen', () => {
    const sim = fakeSim();
    const view = chargedView(sim);
    const head = new HandPoint();
    const frame = createCombatFrame();
    frame.combat = { ...createCombatSample(), present: true, phase: 'aufladen', fighting: true, aimed: true, aimAngle: 0, weaponHead: head };
    frame.figureX = 100;
    frame.figureY = 100;
    frame.alpha = 0;
    // The club's head as the figure drew it: 5 px ahead of the feet, 9 px up.
    head.x = 105;
    head.y = 91;
    head.z = 9;
    head.drawn = true;
    head.item = true;
    sim.tick = 131;
    const a = glintScene();
    view.draw(a.scene, ATLAS, sim, frame);
    expect(a.glints).toHaveLength(1);
    expect([a.glints[0]?.x, a.glints[0]?.y]).toEqual([105, 91]);
    // Not the old fixed point at the face (8 px ahead, 14 px up), and dimmer than a telegraph's glint (boost 1).
    expect([a.glints[0]?.x, a.glints[0]?.y]).not.toEqual([108, 86]);
    expect(a.glints[0]?.boost).toBeGreaterThan(0);
    expect(a.glints[0]?.boost).toBeLessThan(1);
    // The weapon moves on (the figure's next frame): the glint goes with it.
    head.x = 103;
    head.y = 88;
    head.z = 12;
    sim.tick = 133;
    const b = glintScene();
    view.draw(b.scene, ATLAS, sim, frame);
    expect([b.glints[0]?.x, b.glints[0]?.y]).toEqual([103, 88]);
    // Let go: the swing's trail and the hit take over – no glint in the swing or the hitstop after it.
    frame.combat = { ...frame.combat, phase: 'ausholen' };
    sim.tick = 134;
    const c = glintScene();
    view.draw(c.scene, ATLAS, sim, frame);
    expect(c.glints).toHaveLength(0);
    // Held on past its life: gone as well.
    frame.combat = { ...frame.combat, phase: 'aufladen' };
    sim.tick = 130 + GLINT_TICKS + 2;
    const d = glintScene();
    view.draw(d.scene, ATLAS, sim, frame);
    expect(d.glints).toHaveLength(0);
  });

  it('ohne gezeichnete Hand (eine Ansicht ohne Figur) vor den Füßen entlang des Ziels in Handhöhe, nicht in Gesichtshöhe', () => {
    const sim = fakeSim();
    const view = chargedView(sim);
    const frame = createCombatFrame();
    frame.combat = { ...createCombatSample(), present: true, phase: 'aufladen', fighting: true, aimed: true, aimAngle: 0 };
    frame.figureX = 100;
    frame.figureY = 100;
    frame.alpha = 0;
    sim.tick = 131;
    const a = glintScene();
    view.draw(a.scene, ATLAS, sim, frame);
    expect(a.glints).toHaveLength(1);
    const g = a.glints[0] as Glint;
    expect(g.x).toBeGreaterThan(100);
    // Hand height (8–12 px over the feet), below the profile figure's face (14 px).
    expect(100 - g.y).toBeGreaterThanOrEqual(8);
    expect(100 - g.y).toBeLessThan(14);
  });

  it('die Figur meldet den Wirkpunkt ihrer Waffe: Klinge, Keulenkopf, Speerspitze – mit der Waffe um den Griff gedreht', () => {
    for (const id of ['ausruestung_bronzeschwert', 'ausruestung_holzkeule', 'ausruestung_bronzespeer']) {
      const built = buildPlayerFigure(MANIFEST, START_CLOTHING, { hand: id });
      const item = MANIFEST.sprites[id];
      if (built === null || item === undefined) throw new Error(`${id} fehlt`);
      const body = built.body;
      for (const angle of [0, 0.6, -0.6]) {
        const s = { ...defaultFigureState(), x: 200, y: 300, action: 'idle', direction: 'right' as const, time: 0, itemTime: 0, handAngle: angle };
        let itemIndex = -1;
        const list = {
          push(d: SpriteDesc) {
            const index = d.frame === null ? -1 : item.frames.indexOf(atlasFrameOf(d.frame));
            if (index >= 0) itemIndex = index;
            return 0;
          },
        } as unknown as SpriteList;
        built.rig.emit(list, new SpriteDesc(), s);
        const p = built.rig.handPoint;
        expect(p.drawn, id).toBe(true);
        expect(p.item, id).toBe(true);
        // The hand socket of the body frame drawn …
        const clip = body.clips['idle_right'];
        const index = clip?.frames[0] ?? 0;
        const hand = body.sockets['hand']?.[index];
        if (hand === undefined || hand === null || itemIndex < 0) throw new Error(`${id}: keine Hand`);
        const bodyFrame = spriteFrame(body, index);
        const gx = 200 + hand[0] - bodyFrame.ax;
        const gy = 300 + hand[1] - bodyFrame.ay;
        // … plus the item's `wirkpunkt` (pixel centre) from its grip, turned by the hand angle as the renderer turns it.
        const w = item.sockets['wirkpunkt']?.[itemIndex];
        const f = item.frames[itemIndex];
        if (w === undefined || w === null || f === undefined) throw new Error(`${id}: kein Wirkpunkt`);
        const rx = w[0] + 0.5 - f.ax;
        const ry = w[1] + 0.5 - f.ay;
        const c = Math.cos(angle);
        const sn = Math.sin(angle);
        expect(p.x, `${id} ${angle}`).toBeCloseTo(gx + c * rx - sn * ry, 9);
        expect(p.y, `${id} ${angle}`).toBeCloseTo(gy + sn * rx + c * ry, 9);
        expect(p.z, `${id} ${angle}`).toBeCloseTo(300 - p.y, 9);
        // Ahead of the grip on the facing's side (an idle hold points the weapon up or forward, never into the face).
        expect(Math.hypot(p.x - gx, p.y - gy), `${id} ${angle}`).toBeGreaterThan(2);
      }
    }
  });
});
