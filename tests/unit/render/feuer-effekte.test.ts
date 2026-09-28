/**
 * M5-21: full fire effects. A burning tile of the fire simulation is a particle source where its flames stand – sparks,
 * embers and smoke by the fire's stage – with a column of hot air over it (the heat shimmer list the post chain may
 * claim); a burning crown sparks at its height. The player's lights (M3-22) spark and smoke too: a burning camp fire
 * by its brightness (with hot air), a lit torch – placed or carried along with the figure – thinly. The flames breathe
 * and sway. The shimmer columns become screen rectangles over the fire.
 */
import { describe, expect, it } from 'vitest';
import type { AtlasData } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc } from '../../../src/render/batch/spriteList';
import { createFireFrame, FIRE_EFFECTS, FireView, STAGE } from '../../../src/render/game/fire';
import { ParticleScene } from '../../../src/render/particles/sceneParticles';
import { shimmerColumns } from '../../../src/render/particles/shimmer';
import { claimHeatShimmer, forwardHeat, heatShimmerClaimed, POST_DISTORTION_PASS } from '../../../src/render/particles/distortion';
import { particleEmitter } from '../../../src/render/particles/tables';
import type { RenderScene } from '../../../src/render/scene';
import { RenderScene as Scene } from '../../../src/render/scene';
import { ParticleSceneFiller, CAMP_FIRE_SHIMMER } from '../../../src/render/world/particlesScene';
import { PassRegistry, type PassSetup } from '../../../src/render/passes/registry';
import { BALANCE } from '../../../src/content/balance';
import { lagerWelt, type LagerWelt } from '../game/lager-testwelt';
import { lightWorld } from '../game/licht-testwelt';
import { meadow, OFFSET } from '../game/spieler-testwelt';

const MANIFEST = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
const ATLAS: AtlasData = { manifest: MANIFEST, albedo: { kind: 'pixels', pixels: new Uint8Array(4) }, normal: { kind: 'pixels', pixels: new Uint8Array(4) } };
const T = 16;
const SECOND = BALANCE.time.tickHz;

interface Recorded {
  scene: RenderScene;
  flames: { boost: number; sway: number }[];
  particles: ParticleScene;
}

function recordingScene(): Recorded {
  const flames: Recorded['flames'] = [];
  const particles = new ParticleScene();
  const scene = {
    sprite: new SpriteDesc(),
    particles,
    sprites: {
      push(d: SpriteDesc) {
        flames.push({ boost: d.emissiveBoost, sway: d.windAmplitude });
        return flames.length - 1;
      },
    },
  } as unknown as RenderScene;
  return { scene, flames, particles };
}

function world(): LagerWelt {
  return lagerWelt(meadow(30, 16), { x: 4, y: 12 });
}

function frame(time = 0) {
  const f = createFireFrame();
  f.left = OFFSET * T;
  f.top = OFFSET * T;
  f.right = (OFFSET + 30) * T;
  f.bottom = (OFFSET + 16) * T;
  f.time = time;
  return f;
}

/** Sources of `preset` in `p`: strengths and positions. */
function sources(p: ParticleScene, id: string): { strength: number; x: number; y: number; z: number }[] {
  const preset = particleEmitter(id);
  const out: { strength: number; x: number; y: number; z: number }[] = [];
  const e = p.emitters;
  for (let i = 0; i < e.count; i++) if (e.preset[i] === preset) out.push({ strength: e.strength[i] as number, x: e.x[i] as number, y: e.y[i] as number, z: e.z[i] as number });
  return out;
}

describe('Brand als Partikelquelle', () => {
  it('eine brennende Wand funkt, glimmt und raucht nach ihrer Stufe und flimmert; die Flammen atmen und wiegen sich', () => {
    const w = world();
    const view = new FireView();
    const b = w.build('wand_holz', 6, 10);
    expect(b).toBeNull();
    w.act({ type: 'fire.ignite', tx: OFFSET + 6, ty: OFFSET + 10 });
    const young = recordingScene();
    view.draw(young.scene, ATLAS, w.sim, frame(), null, null);
    expect(sources(young.particles, 'brand_funken').map((s) => s.strength)).toEqual([Math.fround(FIRE_EFFECTS.sparks[STAGE.klein])]);
    w.run(10 * SECOND);
    const full = recordingScene();
    view.draw(full.scene, ATLAS, w.sim, frame(0.4), null, null);
    const sparks = sources(full.particles, 'brand_funken');
    expect(sparks.map((s) => s.strength)).toEqual([FIRE_EFFECTS.sparks[STAGE.gross]]);
    expect(sources(full.particles, 'brand_rauch').map((s) => s.strength)).toEqual([FIRE_EFFECTS.smoke[STAGE.gross]]);
    expect(sources(full.particles, 'brand_glut')).toHaveLength(1);
    // Where the wall burns: on its tile, the smoke above the sparks.
    const s0 = sparks[0] as { x: number; y: number; z: number };
    expect(Math.floor(s0.x / T)).toBe(OFFSET + 6);
    expect(Math.floor(s0.y / T)).toBe(OFFSET + 10);
    expect((sources(full.particles, 'brand_rauch')[0]?.z ?? 0) > s0.z).toBe(true);
    expect(full.particles.distortion.count).toBe(1);
    expect(full.particles.distortion.height[0]).toBe(FIRE_EFFECTS.shimmer.height[STAGE.gross]);
    expect(view.effectStats).toEqual({ sources: 3, shimmer: 1 });
    // The flames breathe (their glow differs with time and between them) and sway with the wind.
    expect(full.flames.length).toBeGreaterThan(1);
    for (const f of full.flames) {
      expect(f.sway).toBeGreaterThan(0);
      expect(f.boost).toBeGreaterThanOrEqual(0);
      expect(f.boost).toBeLessThanOrEqual(0.12 + 1e-9);
    }
    const later = recordingScene();
    view.draw(later.scene, ATLAS, w.sim, frame(0.55), null, null);
    expect(later.flames.map((f) => f.boost)).not.toEqual(full.flames.map((f) => f.boost));
  });

  it('ohne Brand keine Quellen; ein Baum brennt auch in der Krone', () => {
    const w = world();
    const view = new FireView();
    const none = recordingScene();
    view.draw(none.scene, ATLAS, w.sim, frame(), null, null);
    expect([none.particles.emitters.count, none.particles.distortion.count]).toEqual([0, 0]);
    const rows = meadow(30, 16);
    rows[10] = '.'.repeat(8) + 'T' + '.'.repeat(21);
    const trees = lagerWelt(rows, { x: 4, y: 12 });
    trees.act({ type: 'fire.ignite', tx: OFFSET + 8, ty: OFFSET + 10 });
    trees.run(10 * SECOND);
    const r = recordingScene();
    view.draw(r.scene, ATLAS, trees.sim, frame(), null, null);
    const sparks = sources(r.particles, 'brand_funken');
    expect(sparks).toHaveLength(2);
    expect(Math.max(...sparks.map((s) => s.z)) - Math.min(...sparks.map((s) => s.z))).toBeGreaterThan(16);
  });
});

describe('Lagerfeuer und Fackeln der Lichtquellenliste', () => {
  it('ein brennendes Lagerfeuer funkt, raucht, glüht und flimmert; getragene und gesteckte Fackeln funken und rauchen dünn', () => {
    const w = lightWorld(Array.from({ length: 24 }, () => '.'.repeat(24)));
    w.spawn(10, 10);
    w.give('lagerfeuer', 1);
    w.give('holz', 3);
    w.give('fackel', 2);
    const fire = w.place('lagerfeuer', 11, 10);
    w.step(1, [{ type: 'light.fuel', light: fire, from: w.slotOf('holz') }]);
    w.step(1, [{ type: 'light.ignite', tx: OFFSET + 11, ty: OFFSET + 10 }]);
    w.place('fackel', 16, 10);
    w.equipTorch();
    w.step(1, [{ type: 'light.toggle' }]);
    const scene = new Scene();
    scene.beginFrame(1);
    const figure = w.pos();
    new ParticleSceneFiller().fillFlames(scene, w.sim, 0, figure.x, figure.y, true, figure.x + 0.5, figure.y);
    const p = scene.particles;
    expect(sources(p, 'lagerfeuer_funken')).toHaveLength(1);
    expect(sources(p, 'lagerfeuer_rauch')[0]?.strength).toBeGreaterThan(0.5);
    expect(sources(p, 'lagerfeuer_glut')).toHaveLength(1);
    expect(p.distortion.count).toBe(1);
    expect(p.distortion.width[0]).toBe(CAMP_FIRE_SHIMMER.width);
    const torches = sources(p, 'fackel_funken');
    expect(torches).toHaveLength(2);
    expect(sources(p, 'fackel_rauch')).toHaveLength(2);
    // The carried torch follows the figure as drawn (interpolated), the placed one stands on its tile.
    const carried = torches.find((t) => Math.abs(t.x - (figure.x + 0.5)) < 16);
    expect(carried).toBeDefined();
    expect(torches.some((t) => Math.floor(t.x / T) === OFFSET + 16)).toBe(true);
    // Below ground nothing of the surface's lights sparks.
    scene.beginFrame(1);
    new ParticleSceneFiller().fillFlames(scene, w.sim, -1, figure.x, figure.y, true, figure.x, figure.y);
    expect(scene.particles.emitters.count).toBe(0);
  });
});

describe('Hitzeflimmern', () => {
  it('Säulen heißer Luft werden Rechtecke über dem Feuer; die Post-Kette kann sie übernehmen', () => {
    const p = new ParticleScene();
    p.distortion.push(100, 200, 10, 14, 30, 1.5);
    p.distortion.push(5000, 200, 10, 14, 30, 1.5);
    const out = new Float32Array(12);
    const n = shimmerColumns(p.distortion, 0, 0, 482, 272, out);
    expect(n).toBe(1);
    expect(Array.from(out.subarray(0, 5))).toEqual([93, 160, 14, 30, 1.5]);
    const setup = {} as PassSetup;
    const passes = new PassRegistry(setup);
    expect(heatShimmerClaimed(passes)).toBe(false);
    claimHeatShimmer(passes);
    expect(heatShimmerClaimed(passes)).toBe(true);
  });

  it('läuft der Verzerrungspass der Post-Kette, wird jede Säule dort eine Hitzefläche über dem Feuer', () => {
    const p = new ParticleScene();
    p.distortion.push(100, 200, 10, 14, 30, 1.5);
    p.distortion.push(300, 50, 0, 10, 12, 0.6);
    const areas: number[][] = [];
    const n = forwardHeat(p.distortion, { heat: (x, y, rx, ry, s) => areas.push([x, y, rx, ry, s]) - 1 });
    expect(n).toBe(2);
    expect(areas).toEqual([
      [100, 175, 7, 15, 1.5],
      [300, 44, 5, 6, 0.6],
    ].map((a) => a.map(Math.fround)));
    expect(POST_DISTORTION_PASS).toBe('distortion');
  });
});
