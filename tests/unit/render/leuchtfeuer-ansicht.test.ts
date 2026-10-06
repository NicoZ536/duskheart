/**
 * The render views of strand F on a drawn test world (M7-32 … M7-35; docs/SPIEL.md §30 "Render-Szenen-Teile"): the boss's
 * body and the ground markers of its wind-ups (`BossView.draw`), the camera framing a fight (`BossView.framing`: none asleep,
 * eased in over the waking, at most `FRAME_MAX_PX` per axis towards the boss's visual centre, held through the fall, released
 * by presentation time), and the beacon's particles at its bowl (`BeaconView`: embers while it waits, the Lumen storm through
 * the ignition and for six seconds after, then the calm sparks). A minimal atlas stands in for the generated one: the views
 * read only sprite frames and clips.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import type { AtlasData, AtlasManifest, AtlasSprite } from '../../../src/render/assets/atlas';
import { BeaconView, createBeaconFrame } from '../../../src/render/game/beacons';
import { BossView, createBossFrame } from '../../../src/render/game/bosses';
import { RenderScene } from '../../../src/render/scene';
import { TILE_PX } from '../../../src/world/model/coords';
import { ARENA, drawnArena, leuchtfeuerWelt, OFFSET, SITE } from '../game/leuchtfeuer-testwelt';

const HZ = BALANCE.time.tickHz;
/** Cell and anchor of the stand-in body: its visual centre lies 112 − 142 / 2 = 41 px above the foot. */
const BODY = { w: 128, h: 142, ax: 64, ay: 112 } as const;
const LIFT = BODY.ay - BODY.h / 2;
const FRAME_MAX_PX = 72;

function sprite(id: string, frames: number, cell: { w: number; h: number; ax: number; ay: number } = { w: 1, h: 1, ax: 0, ay: 0 }): AtlasSprite {
  return {
    id,
    group: 'test',
    size: [cell.w, cell.h],
    frames: Array.from({ length: frames }, () => ({ x: 0, y: 0, ...cell })),
    clips: {},
    sockets: {},
    heightHint: { kind: 'flat' },
    emissive: false,
    symmetric: true,
  } as unknown as AtlasSprite;
}

const manifest = {
  width: 1,
  height: 1,
  sprites: {
    boss_borkenvater: sprite('boss_borkenvater', 1, BODY),
    boss_borkenvater_knoten: sprite('boss_borkenvater_knoten', 1),
    boss_borkenvater_wurzel: sprite('boss_borkenvater_wurzel', 1),
    kampf_punkt: sprite('kampf_punkt', 8),
    leuchtfeuer: sprite('leuchtfeuer', 1),
  },
  paletteRows: [],
  sourceHash: 'test',
} as unknown as AtlasManifest;
const atlas: AtlasData = { manifest, albedo: { kind: 'pixels', pixels: new Uint8Array(4) }, normal: { kind: 'pixels', pixels: new Uint8Array(4) } };

/** A frame around world tile (tx, ty) of the drawn map, `half` tiles each way. */
function frameAround<F extends { left: number; top: number; right: number; bottom: number; tileLeft: number; tileTop: number; tileRight: number; tileBottom: number; tick: number; alpha: number; time: number }>(f: F, tx: number, ty: number, half: number, tick: number, time: number): F {
  f.tileLeft = OFFSET + tx - half;
  f.tileRight = OFFSET + tx + half;
  f.tileTop = OFFSET + ty - half;
  f.tileBottom = OFFSET + ty + half;
  f.left = f.tileLeft * TILE_PX;
  f.right = (f.tileRight + 1) * TILE_PX;
  f.top = f.tileTop * TILE_PX;
  f.bottom = (f.tileBottom + 1) * TILE_PX;
  f.tick = tick;
  f.alpha = 0;
  f.time = time;
  return f;
}

describe('Boss im Bild (M7-32 … M7-34)', () => {
  it('Körper schlafend ohne Markierung; die Rahmung folgt dem Kampf: keine im Schlaf, eingeblendet, begrenzt, gehalten, losgelassen', () => {
    // Outside the arena: the boss sleeps until the console wakes it.
    const w = leuchtfeuerWelt({ spawnAt: { x: ARENA.x, y: ARENA.y + 12 } });
    w.run(2);
    expect(w.bosses.state('borkenvater').state).toBe('schlafend');
    const view = new BossView();
    const scene = new RenderScene();
    const f = frameAround(createBossFrame(), ARENA.x, ARENA.y, 12, w.sim.tick, 0);
    view.draw(scene, atlas, w.sim, f);
    expect(view.stats).toMatchObject({ bodies: 1, markers: 0, knots: 0 });
    const shift = { x: 0, y: 0 };
    const clock = { renderAlpha: 0 };
    /** The camera's shift at `tick` and presentation `time` (none: 0, 0) for a figure at (x, y) on `layer`. */
    const framed = (x: number, y: number, tick: number, time: number, layer: 0 | -1 = 0): { x: number; y: number } =>
      view.framing(w.sim, manifest, layer, x, y, tick, clock, time, shift) ? { x: shift.x, y: shift.y } : { x: 0, y: 0 };
    const a = drawnArena();
    const figureX = a.bossX;
    const figureY = a.bossY + 6 * TILE_PX;
    expect(view.framing(w.sim, manifest, 0, figureX, figureY, w.sim.tick, clock, 0, shift)).toBe(false);
    // Into the inner ring: it wakes.
    w.goTo(ARENA.x, ARENA.y + 4);
    w.run(1);
    expect(w.bosses.state('borkenvater').state).toBe('erwacht');
    const woke = w.bosses.state('borkenvater').awakenedTick;
    // Half way through the ease (smoothstep of ½ = ½), then the whole way: half the way to the centre, clamped.
    const full = Math.max(-FRAME_MAX_PX, (a.bossY - LIFT - figureY) / 2);
    let o = framed(figureX, figureY, woke + HZ / 2, 0.1);
    expect(o.x).toBe(0);
    expect(o.y).toBeCloseTo(full / 2, 6);
    // The render fraction counts: half a tick later the ease has gone on.
    clock.renderAlpha = 0.5;
    expect(framed(figureX, figureY, woke + HZ / 2, 0.1).y).toBeLessThan(o.y);
    clock.renderAlpha = 0;
    o = framed(figureX, figureY, woke + HZ, 0.2);
    expect(o.y).toBeCloseTo(full, 6);
    // Far south of the trunk the shift stops at its bound; east of it the camera leans east.
    expect(framed(figureX - 20 * TILE_PX, a.bossY + 30 * TILE_PX, woke + HZ, 0.3)).toEqual({ x: FRAME_MAX_PX, y: -FRAME_MAX_PX });
    // Another layer (the caves): no framing.
    expect(framed(figureX, figureY, woke + HZ, 0.4, -1)).toEqual({ x: 0, y: 0 });
    framed(figureX, figureY, woke + HZ, 0.5);
    // The fall: held while the dead tree falls, then released over 0.8 s of presentation time.
    w.run(1, [{ type: 'boss.debug', boss: 'borkenvater', aktion: 'besiegen' }]);
    const fell = w.bosses.state('borkenvater').defeatedTick;
    expect(framed(figureX, figureY, fell + HZ, 0.6).y).toBeCloseTo(full, 6);
    expect(framed(figureX, figureY, fell + 3 * HZ, 1.0).y).toBeCloseTo(full * 0.5, 6);
    expect(framed(figureX, figureY, fell + 4 * HZ, 1.4)).toEqual({ x: 0, y: 0 });
    // Released: idle again, no number formed (false at once).
    expect(view.framing(w.sim, manifest, 0, figureX, figureY, fell + 5 * HZ, clock, 1.6, shift)).toBe(false);
  });

  it('ein Wurzelstoß zeigt seine Risslinien am Boden, solange er ausholt', () => {
    const w = leuchtfeuerWelt({ spawnAt: { x: ARENA.x, y: ARENA.y + 4 } });
    w.run(2);
    expect(w.bosses.state('borkenvater').state).toBe('erwacht');
    const view = new BossView();
    const scene = new RenderScene();
    let seen = 0;
    for (let k = 0; k < 20 * HZ && seen === 0; k++) {
      w.run(1);
      const b = w.bosses.state('borkenvater');
      if (b.attack !== 'wurzelstoss' || w.sim.tick >= b.attackEndTick) continue;
      scene.sprites.clear();
      view.draw(scene, atlas, w.sim, frameAround(createBossFrame(), ARENA.x, ARENA.y, 14, w.sim.tick, k / HZ));
      seen = view.stats.markerPixels;
      expect(view.stats.markers).toBe(1);
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('Leuchtfeuer im Bild (M7-35)', () => {
  it('Glut, solange es wartet; der Lumen-Sturm beim Entzünden und sechs Sekunden danach; dann die Funken', () => {
    const w = leuchtfeuerWelt();
    w.run(2);
    const view = new BeaconView();
    const scene = new RenderScene();
    const at = (now: number): number => {
      scene.particles.beginFrame();
      view.draw(scene, atlas, w.sim, frameAround(createBeaconFrame(), SITE.x, SITE.y, 12, now, 0));
      return scene.particles.emitters.count;
    };
    expect(at(w.sim.tick)).toBe(0);
    expect(view.stats.beacons).toBe(1);
    w.run(1, [{ type: 'boss.debug', boss: 'borkenvater', aktion: 'besiegen' }]);
    expect(at(w.sim.tick)).toBe(1);
    w.run(1, [{ type: 'beacon.debug', beacon: 1, aktion: 'entzuenden' }]);
    const lit = w.beacons.state(1).litTick;
    expect(at(lit + HZ)).toBe(2);
    expect(scene.particles.emitters.strength[1]).toBeCloseTo(1 - 1 / 6, 6);
    // One second after the flame stood the light wave's front crosses the view; four seconds later it has passed it.
    expect(view.stats.wavePixels).toBeGreaterThan(0);
    expect(at(lit + 6 * HZ)).toBe(1);
    expect(view.stats.wavePixels).toBe(0);
  });
});
