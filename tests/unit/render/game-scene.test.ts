/**
 * M2-29: the game view (`spiel`) on the session's own world, end to end in Node (in-thread world,
 * fake GL): the page's world host hands the generated world to the simulation and streams the
 * simulation's chunk store; the free camera composes the title picture towards the sea; a figure takes
 * the camera (and its layer) over; the light follows the calendar (full day at 06:00, night later,
 * caves dark with the figure's hand light); the debug overlays draw into the frame's overlay list.
 */
import { describe, expect, it } from 'vitest';
import { PALETTE_HEX } from '../../../src/generated/palette';
import { GameSession } from '../../../src/game/session';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import type { AtlasData } from '../../../src/render/assets/atlas';
import { ShaderSourceStore } from '../../../src/render/gl/shaders';
import { Renderer } from '../../../src/render/renderer';
import { RenderScene } from '../../../src/render/scene';
import { createSceneSource, RENDER_SCENE_IDS } from '../../../src/render/scenes';
import { SHADERS } from '../../../src/render/shaderLib';
import { GameWorldScene, titleCamera, type GameWorldBinding } from '../../../src/render/world/gameScene';
import { WorldHost } from '../../../src/render/world/worldHost';
import { cellAtTile } from '../../../src/world/gen/plan/grid';
import { createFakeGl } from './fakeGl';

const SEED = 20260924;
const TILE = 16;

function gameAtlas(): AtlasData {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  const manifest = manifestFromGenerated(mod);
  const pixels = new Uint8Array(manifest.width * manifest.height * 4);
  return { manifest, albedo: { kind: 'pixels', pixels }, normal: { kind: 'pixels', pixels } };
}

function renderer(): Renderer {
  return new Renderer(createFakeGl().gl, { caps: { floatTargets: true, forcedRgba8: false, maxDrawBuffers: 8 }, sources: new ShaderSourceStore(SHADERS), errors: { report: () => undefined }, paletteHex: PALETTE_HEX });
}

/** A session whose world the host generates in this thread and hands over (as `main.tsx` does with the worker). */
function binding(): GameWorldBinding & { session: GameSession } {
  let host: WorldHost | null = null;
  const session = new GameSession({ config: { seed: SEED, worldSize: 'small', dayLengthMinutes: 12 }, simulation: { chunkJobs: () => (host as WorldHost).createJobQueue() } });
  host = new WorldHost({
    seed: SEED,
    preset: 'small',
    now: () => performance.now(),
    adopt: (world) => {
      session.sim.world.provide(world);
      return session.sim.world.chunks;
    },
  });
  host.start();
  return { session, host };
}

describe('Spielansicht (Node, Fake-GL, Welt der Sitzung im Hauptthread)', () => {
  it('is a render scene; without a session it only shows the background', () => {
    expect(RENDER_SCENE_IDS).toContain('spiel');
    const atlas = gameAtlas();
    const source = createSceneSource('spiel', { gameAtlas: () => atlas, t: (k) => k });
    const scene = new RenderScene();
    source.fill(scene, 0);
    expect(source.ready?.()).toBe(false);
    expect(scene.sprites.count).toBe(0);
  });

  it(
    'streams the session world, composes the title picture, follows the figure onto a cave layer and draws the overlays',
    async () => {
      const atlas = gameAtlas();
      const r = renderer();
      const b = binding();
      const source = new GameWorldScene(() => atlas, () => b);
      source.activate(r);
      const scene = new RenderScene();
      const frame = (): void => {
        scene.beginFrame(1);
        source.fill(scene, 1);
        r.render(scene, 1920, 1080, 'sharp');
      };
      for (let i = 0; i < 600 && !source.ready(); i++) {
        frame();
        await Promise.resolve();
      }
      expect(source.ready()).toBe(true);
      // The host streams the simulation's own chunk store.
      expect(b.host.manager).toBe(b.session.sim.world.chunks);
      const world = b.host.world;
      if (world === null) throw new Error('keine Welt');
      // Title picture: towards the nearest sea, the beach centre at most 64 tiles away.
      const t = titleCamera(world);
      expect(source.camera).toEqual([t.x * TILE + TILE / 2, t.y * TILE + TILE / 2]);
      expect(Math.hypot(t.x - world.spawn.x, t.y - world.spawn.y)).toBeLessThanOrEqual(64);
      let info = source.info();
      expect(info).toMatchObject({ scene: 'spiel', state: 'bereit', follows: false, figure: null, layer: 0, ambient: 1 });
      expect(info.terrain.missing).toBe(0);
      expect(scene.sprites.count).toBeGreaterThan(10);
      expect(r.stats.drawCalls).toBeLessThanOrEqual(150);

      // A figure on the beach: the camera follows it, the canopy fade circles it.
      const sx = world.spawn.x * TILE + TILE / 2;
      const sy = world.spawn.y * TILE + TILE / 2;
      b.session.command({ type: 'spawnDebugMover', x: sx, y: sy, controlled: true });
      b.session.step();
      frame();
      info = source.info();
      expect(info.follows).toBe(true);
      expect(info.figure).toEqual([sx, sy]);
      expect(source.camera).toEqual([sx, sy - 8]);
      expect(scene.fadeRadius).toBeGreaterThan(0);

      // Overlays: chunk borders of the visible chunks, collision tiles, the temperature field.
      source.overlays.enabled.chunks = true;
      source.overlays.enabled.kollision = true;
      source.overlays.enabled.temperatur = true;
      source.setViewSize(480, 270);
      frame();
      const stats = source.info().overlayStats;
      expect(stats.chunks).toBeGreaterThanOrEqual(1);
      expect(stats.temperatureTiles).toBeGreaterThanOrEqual(30 * 17);
      expect(scene.debugOverlay.count).toBeGreaterThan(stats.temperatureTiles);
      source.overlays.enabled.chunks = false;
      source.overlays.enabled.kollision = false;
      source.overlays.enabled.temperatur = false;
      frame();
      expect(scene.debugOverlay.count).toBe(0);

      // Into the caves: the view shows layer −1, dark, lit by the figure's hand light.
      const cave = world.underground.links.find((l) => l.kind === 'eingang');
      if (cave === undefined) throw new Error('kein Höhleneingang');
      b.session.command({ type: 'teleport', x: cave.tx * TILE + TILE / 2, y: cave.ty * TILE + TILE / 2, layer: -1 });
      b.session.step();
      for (let i = 0; i < 400 && source.info().terrain.missing > 0; i++) {
        frame();
        await Promise.resolve();
      }
      frame();
      info = source.info();
      expect(info.layer).toBe(-1);
      expect(info.terrain.missing).toBe(0);
      expect(info.ambient).toBeLessThan(0.1);
      expect(scene.lights.count).toBeGreaterThanOrEqual(1);

      // Night on the surface: moonlight instead of the white day.
      b.session.command({ type: 'teleport', x: sx, y: sy, layer: 0 });
      b.session.command({ type: 'setTime', hour: 23, minute: 30 });
      b.session.step();
      frame();
      expect(source.info().ambient).toBeLessThan(0.5);
      expect(scene.env.ambientB).toBeGreaterThan(scene.env.ambientR);
      source.deactivate(r);
      b.host.dispose();
    },
    90_000,
  );

  it('the title camera looks towards open sea when there is one near the beach', () => {
    const b = binding();
    return new Promise<void>((resolve, reject) => {
      const check = (): void => {
        const world = b.host.world;
        if (world === null) {
          setTimeout(check, 10);
          return;
        }
        try {
          const t = titleCamera(world);
          const { grid, land } = world.plan;
          // Beyond the camera, in the direction it moved, lies sea.
          const dx = t.x - world.spawn.x;
          const dy = t.y - world.spawn.y;
          const len = Math.hypot(dx, dy);
          if (len > 0) {
            const sea = [...Array(40).keys()].some((k) => land[cellAtTile(grid, t.x + (dx / len) * k + 0.5, t.y + (dy / len) * k + 0.5)] === 0);
            expect(sea).toBe(true);
          }
          b.host.dispose();
          resolve();
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      };
      check();
    });
  }, 30_000);
});
