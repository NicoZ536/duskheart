/**
 * M5-10 (with M5-14, M5-15, M5-22): fog and the atmosphere of the game view.
 * - Fog shape functions (TypeScript = GLSL): banks thin fog, thick fog closes; nothing above floor + thickness,
 *   everything below the floor; scattered light grows with density and light.
 * - The atmosphere pass on a fake GL context: nothing without fog; with fog the density and the fog over the
 *   scene with the light pass's light scattered in it (two fullscreen draws, no extra instanced call); without
 *   the light pass the fog stays unlit; `graphics.fog` switches it; the render debugger knows `fog`.
 * - Review M5 – fog and rooms: on a cabin of the build grid (its real occluders), the room's air is roofed – not the
 *   eave strip outside a wall, not the air in front of the front wall's face, not a roof seen from outside – so its fog
 *   is a faint haze lit by the sky's share through the roof; the scattered light's softening takes no neighbour from the
 *   other air (TypeScript = GLSL); the layers lie at each pixel's ground point; the pass reads the mask when the
 *   occluder pass ran.
 * - The game view in Node (the session's world, generated in this thread): fog, grade and heat follow biome,
 *   daytime and weather (the blend is rebuilt only when its inputs move); fear and conditions reach the post state; the Nachtherz is corrupted land; a layer
 *   change covers the picture for a moment – only while time runs.
 */
import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../../src/engine/settings';
import { GameSession } from '../../../src/game/session';
import { PALETTE_HEX } from '../../../src/generated/palette';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import type { AtlasData } from '../../../src/render/assets/atlas';
import { ShaderSourceStore } from '../../../src/render/gl/shaders';
import { FOG_DEBUG_VIEW, FOG_FACE_PROBES, FOG_LOOK, FOG_ROOM, FOG_SCATTER, fogAmount, fogDefines, fogHeightFade, fogIndoors, fogRoofedLight, fogSameAir, fogScatter, fogScatterShare } from '../../../src/render/passes/atmospherePass';
import { BuildingOccluders, WALL_BAND } from '../../../src/render/light/buildingOccluders';
import { OccluderField, OccluderRing } from '../../../src/render/light/lightMath';
import { OccluderList } from '../../../src/render/light/occluders';
import { BUILDING_SUN, OCCLUDER_CLASS, OCCLUDER_RING, SDF, STRUCTURAL_TOP_PX } from '../../../src/render/light/params';
import { pointOverAmbient, pointOverDaylight, pointOverDaylightDefines, pointOverPeak } from '../../../src/render/light/banding';
import { MOONLIGHT } from '../../../src/render/light/lightColors';
import { splitDaylight } from '../../../src/render/light/skyMath';
import { ringSize } from '../../../src/render/passes/occluderPass';
import { corruptionGroundPoint } from '../../../src/render/post/corruption';
import { FrameOccluders } from '../../../src/render/post/frameOccluders';
import { CAVE_AMBIENT, CAVE_AMBIENT_INTENSITY, NIGHT_AMBIENT } from '../../../src/render/world/gameScene';
import { bauWelt, hut } from '../game/bau-testwelt';
import { meadow, OFFSET } from '../game/spieler-testwelt';
import { GRADING_INDEX, isNeutralGrading } from '../../../src/render/post/grading';
import { atmospherePostSettingsFrom } from '../../../src/render/post/settings';
import { Renderer } from '../../../src/render/renderer';
import { RenderScene } from '../../../src/render/scene';
import { SHADERS } from '../../../src/render/shaderLib';
import { GameWorldScene, type GameWorldBinding } from '../../../src/render/world/gameScene';
import { WorldHost } from '../../../src/render/world/worldHost';
import { atmosphereBlendBuilds } from '../../../src/render/world/atmosphereScene';
import { atmosphereScenarios } from '../../../src/render/post/scenarios';
import { CHUNK_TILES } from '../../../src/render/tilemap/chunk';
import { WAND_PX_JE_STUFE } from '../../../src/world/autotile';
import { basisSzenarien } from '../../../src/debug/basisScenarios';
import { createFakeGl } from './fakeGl';
import { glslScalar } from './grading-glslScalar';

const SEED = 20260924;
const TILE = 16;

function renderer() {
  const fake = createFakeGl();
  const r = new Renderer(fake.gl, { caps: { floatTargets: true, forcedRgba8: false, maxDrawBuffers: 8 }, sources: new ShaderSourceStore(SHADERS), errors: { report: () => undefined }, paletteHex: PALETTE_HEX });
  return { fake, r };
}

describe('Nebel: Form', () => {
  it('banks: thin fog varies between floor and full, thick fog stays dense; nothing above the fog height', () => {
    expect(fogAmount(0, 0.8)).toBe(0);
    expect(fogAmount(0.5, 0)).toBeCloseTo(0.5 * FOG_LOOK.floor, 12);
    expect(fogAmount(0.5, 1)).toBeCloseTo(0.5, 12);
    expect(fogAmount(1, 0.3)).toBeGreaterThan(fogAmount(0.4, 0.3));
    expect(fogHeightFade(0, 40)).toBe(1);
    expect(fogHeightFade(20, 40)).toBeCloseTo(0.5, 12);
    expect(fogHeightFade(60, 40)).toBe(0);
    expect(fogHeightFade(0, 0)).toBe(0);
    // On a floor 16 px up (the camera stands on level 1): lower ground lies deep in the fog, higher ground rises out of it.
    expect(fogHeightFade(0, 40, 16)).toBe(1);
    expect(fogHeightFade(16, 40, 16)).toBe(1);
    expect(fogHeightFade(36, 40, 16)).toBeCloseTo(0.5, 12);
    expect(fogHeightFade(56, 40, 16)).toBe(0);
    expect(fogScatter(0, 3)).toBe(0);
    expect(fogScatter(0.5, 0)).toBe(0);
    expect(fogScatter(0.5, 2)).toBeCloseTo(FOG_SCATTER.strength, 12);
    expect(fogScatter(0.8, 2)).toBeGreaterThan(fogScatter(0.4, 2));
  });

  it('fog.glsl fogAmount, fogHeightFade and fogScatter equal the TypeScript mirrors', () => {
    const amount = glslScalar('fog.glsl', 'fogAmount', fogDefines());
    const fade = glslScalar('fog.glsl', 'fogHeightFade', fogDefines());
    const scatter = glslScalar('fog.glsl', 'fogScatter', fogDefines());
    for (let d = 0; d <= 10; d++) for (let v = 0; v <= 10; v++) expect(amount(d / 10, v / 10)).toBeCloseTo(fogAmount(d / 10, v / 10), 6);
    for (const floor of [0, 16, 48]) for (let h = 0; h <= 120; h += 5) expect(fade(h, 48, floor)).toBeCloseTo(fogHeightFade(h, 48, floor), 6);
    for (let d = 0; d <= 10; d++) for (let l = 0; l <= 8; l++) expect(scatter(d / 10, l / 2)).toBeCloseTo(fogScatter(d / 10, l / 2), 6);
  });
});

describe('Atmosphären-Pass (Fake-GL)', () => {
  function foggy(lights: number): RenderScene {
    const s = new RenderScene();
    s.beginFrame(1);
    s.camera.set(0, 0);
    s.env.fog = 0.6;
    s.env.fogHeight = 40;
    for (let i = 0; i < lights; i++) {
      const l = s.light.reset();
      l.x = (i % 10) * 20 - 100;
      l.y = Math.floor(i / 10) * 20 - 60;
      l.radius = 80;
      l.height = 12;
      s.lights.push(l);
    }
    const far = s.light.reset();
    far.x = 90_000;
    far.radius = 80;
    s.lights.push(far);
    return s;
  }

  it('without fog nothing is drawn; fog and heat do not outlast their frame; the render debugger knows the fog density', () => {
    const { fake, r } = renderer();
    const s = new RenderScene();
    s.env.fog = 0.5;
    s.env.heat = 0.5;
    s.beginFrame(0);
    expect([s.env.fog, s.env.heat]).toEqual([0, 0]);
    r.render(s, 960, 540, 'sharp');
    expect(r.atmosphere.atmosphere.drewFog).toBe(false);
    expect(fake.count('drawArraysInstanced')).toBe(0);
    expect(r.debugViews.names()).toContain(FOG_DEBUG_VIEW);
  });

  it('with fog: density and the fog with the scattered light of the light pass (no instanced call of its own); graphics.fog switches it', () => {
    const { fake, r } = renderer();
    const a = r.atmosphere.atmosphere;
    r.passes.setEnabled('atmosphere', false);
    fake.calls.length = 0;
    r.render(foggy(5), 960, 540, 'sharp');
    const instancedWithoutFog = fake.count('drawArraysInstanced');
    const drawsWithoutFog = fake.count('drawArrays');
    r.passes.setEnabled('atmosphere', true);
    fake.calls.length = 0;
    r.render(foggy(5), 960, 540, 'sharp');
    expect(a.drewFog).toBe(true);
    expect(a.scattered).toBe(true);
    expect(fake.count('drawArraysInstanced')).toBe(instancedWithoutFog);
    expect(fake.count('drawArrays')).toBe(drawsWithoutFog + 2);
    expect(fake.count('blendFuncSeparate')).toBeGreaterThanOrEqual(1);
    // Without the light pass the fog stays, unlit by point lights.
    r.passes.setEnabled('lighting', false);
    r.render(foggy(5), 960, 540, 'sharp');
    expect(a.drewFog).toBe(true);
    expect(a.scattered).toBe(false);
    const s = defaultSettings();
    r.atmosphere.configure(atmospherePostSettingsFrom({ graphics: { ...s.graphics, fog: false }, accessibility: s.accessibility }));
    expect(r.passes.get('atmosphere')?.enabled).toBe(false);
  });
});

function gameAtlas(): AtlasData {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  const manifest = manifestFromGenerated(mod);
  const pixels = new Uint8Array(manifest.width * manifest.height * 4);
  return { manifest, albedo: { kind: 'pixels', pixels }, normal: { kind: 'pixels', pixels } };
}

function binding(): GameWorldBinding & { session: GameSession; host: WorldHost } {
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

describe('Atmosphäre der Spielansicht (Node, Welt der Sitzung)', () => {
  it(
    'fog, grade, heat and corruption follow biome, daytime and weather; the player reaches the post state; layer changes cover the picture',
    async () => {
      const atlas = gameAtlas();
      const { r } = renderer();
      const b = binding();
      const source = new GameWorldScene(() => atlas, () => b);
      source.activate(r);
      source.setViewSize(480, 270);
      const scene = new RenderScene();
      let t = 1;
      const frame = (advance = false): void => {
        if (advance) t += 1 / 60;
        scene.beginFrame(t);
        source.fill(scene, t);
        r.render(scene, 1920, 1080, 'sharp');
      };
      const settle = async (): Promise<void> => {
        for (let i = 0; i < 600 && !source.ready(); i++) {
          frame();
          await Promise.resolve();
        }
        frame();
      };
      await settle();
      expect(source.ready()).toBe(true);
      const sim = b.session.sim;
      const [cx, cy] = source.camera;
      const tx = Math.floor(cx / TILE);
      const ty = Math.floor(cy / TILE);
      const weather = (state: string): void => {
        b.session.command({ type: 'setWeather', state, tx, ty });
        b.session.command({ type: 'advanceTime', minutes: 60 });
        b.session.step();
        frame();
      };
      const at = (hour: number): void => {
        b.session.command({ type: 'setTime', hour, minute: 0 });
        b.session.step();
        frame();
      };

      // Midday, clear, on the start beach (Salzküste): a light sea haze, the day grade, no heat.
      at(12);
      weather('klar');
      // A still frame reuses the blend of biome, daytime and weather; a new weather rebuilds it.
      const builds = atmosphereBlendBuilds(scene);
      frame();
      frame();
      expect(atmosphereBlendBuilds(scene)).toBe(builds);
      expect(sim.world.calendar.daylight).toBe(1);
      expect(scene.env.fog).toBeGreaterThan(0);
      expect(scene.env.fog).toBeLessThan(0.15);
      expect(scene.env.heat).toBe(0);
      expect(scene.grading.active).toBe(true);
      const dayTemperature = scene.grading.params[GRADING_INDEX.temperature] as number;

      // Fog weather: thick fog in the fog height of the weather, lying on the ground level at the camera.
      weather('nebel');
      expect(atmosphereBlendBuilds(scene)).toBeGreaterThan(builds);
      expect(scene.env.fog).toBeGreaterThan(0.6);
      expect(scene.env.fogHeight).toBeGreaterThan(50);
      const chunk = b.host.get(0, Math.floor(tx / CHUNK_TILES), Math.floor(ty / CHUNK_TILES));
      if (chunk === undefined) throw new Error('Chunk an der Kamera fehlt');
      const level = chunk.height[(ty - Math.floor(ty / CHUNK_TILES) * CHUNK_TILES) * CHUNK_TILES + (tx - Math.floor(tx / CHUNK_TILES) * CHUNK_TILES)] as number;
      expect(scene.env.fogFloor).toBe(level * WAND_PX_JE_STUFE);

      // Night: the grade turns cooler, the vignette deepens, the grain rises.
      weather('klar');
      at(23);
      expect(sim.world.calendar.daylight).toBe(0);
      expect(scene.grading.params[GRADING_INDEX.temperature]).toBeLessThan(dayTemperature);
      expect(scene.grading.params[GRADING_INDEX.vignette]).toBeGreaterThan(0.2);
      expect(isNeutralGrading(scene.grading.params)).toBe(false);
      expect(scene.post.grain).toBeGreaterThan(0.5);

      // The Nachtherz is corrupted land (until its beacon burns, M7).
      const world = b.host.world;
      if (world === null) throw new Error('keine Welt');
      const { grid, regions, region } = world.plan;
      // The most interior Nachtherz cell (the most Nachtherz cells around it): the whole view lies in it.
      const isHeart = (c: number): boolean => c >= 0 && c < region.length && regions[region[c] as number]?.biome === 'nachtherz';
      let heart = -1;
      let best = -1;
      for (let c = 0; c < region.length; c++) {
        if (!isHeart(c)) continue;
        const x = c % grid.width;
        const y = Math.floor(c / grid.width);
        let around = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (x + dx >= 0 && x + dx < grid.width && isHeart((y + dy) * grid.width + x + dx)) around++;
        if (around > best) {
          best = around;
          heart = c;
        }
      }
      if (heart < 0) throw new Error('kein Nachtherz im Weltplan');
      const hx = ((heart % grid.width) + 0.5) * grid.cellTiles * TILE;
      const hy = (Math.floor(heart / grid.width) + 0.5) * grid.cellTiles * TILE;
      source.moveTo(hx, hy, 0);
      await settle();
      expect(scene.corruption.strength).toBeGreaterThan(0.5);
      source.moveTo(cx, cy, 0);
      await settle();
      expect(scene.corruption.strength).toBe(0);

      // The player: fear and conditions reach the post state.
      b.session.command({ type: 'player.spawn', tx, ty, layer: 0 });
      b.session.step();
      b.session.command({ type: 'fear.set', value: 90 });
      b.session.command({ type: 'conditions.apply', id: 'vergiftung' });
      b.session.command({ type: 'conditions.apply', id: 'beschwipst' });
      b.session.step();
      frame();
      // One tick at night in the dark has already added a little fear (§12.3: +1/s).
      expect(scene.post.fear).toBeCloseTo(0.9, 2);
      expect(scene.post.poison).toBe(1);
      expect(scene.post.drunk).toBeGreaterThan(0);

      // Into a cave: a Bayer cover while time runs, gone after its duration; a frozen frame shows none.
      const cave = world.underground.links.find((l) => l.kind === 'eingang');
      if (cave === undefined) throw new Error('kein Höhleneingang');
      b.session.command({ type: 'player.teleport', x: cave.tx * TILE + TILE / 2, y: cave.ty * TILE + TILE / 2, layer: -1 });
      b.session.step();
      frame(true);
      frame(true);
      expect(source.layer).toBe(-1);
      expect(scene.post.transition).toBeGreaterThan(0.8);
      for (let i = 0; i < 60; i++) frame(true);
      expect(scene.post.transition).toBe(0);
      expect(scene.env.heat).toBe(0);
    },
    240_000,
  );
});

describe('Nebel in Räumen (Prüfung M5, M5-49)', () => {
  /**
   * A cabin (walls, a door in the south wall – open with `doorOpen` –, straw roof; with `sideWindow` a glass window in the
   * west wall at row 5) over the interior tiles 4…7 × 4…6 of a meadow; its occluder mask as the fog reads it.
   */
  function cabin(roof: string | null, doorOpen = false, sideWindow = false): { field: OccluderField; rooms: FrameOccluders } {
    const w = bauWelt(meadow(14, 14));
    w.spawn(5, 9);
    if (sideWindow) {
      for (let x = 3; x <= 8; x++) {
        for (let y = 3; y <= 7; y++) {
          if (x !== 3 && x !== 8 && y !== 3 && y !== 7) continue;
          const part = y === 7 && x === 5 ? 'tuer_holz' : x === 3 && y === 5 ? 'fenster_glas' : 'wand_holz';
          expect(w.build(part, x, y), `${part} ${x},${y}`).toBeNull();
        }
      }
      if (roof !== null) for (let y = 3; y <= 7; y++) for (let x = 3; x <= 8; x++) expect(w.build(roof, x, y)).toBeNull();
    } else hut(w, 4, 4, 7, 6, 'wand_holz', 'tuer_holz', roof);
    if (doorOpen) expect(w.rejection(w.act({ type: 'build.door', tx: OFFSET + 5, ty: OFFSET + 7, open: true }))).toBeNull();
    const list = new OccluderList();
    new BuildingOccluders().collect(w.building.structures, w.building.catalog, 0, OFFSET, OFFSET, OFFSET + 13, OFFSET + 13, () => 0, list);
    const field = new OccluderField(OFFSET * TILE, OFFSET * TILE, 14 * TILE, 14 * TILE);
    field.draw(list);
    return { field, rooms: new FrameOccluders(field, null) };
  }
  /** World px of pixel (px, py) of relative tile (tx, ty). */
  const at = (tx: number, ty: number, px: number, py: number): [number, number] => [(OFFSET + tx) * TILE + px + 0.5, (OFFSET + ty) * TILE + py + 0.5];

  it('the room is roofed air; the eave strip, the air before the front wall and a roof seen from outside are open air', () => {
    const { rooms } = cabin('dach_stroh');
    // Every pixel of the floor inside.
    for (let ty = 4; ty <= 6; ty++) for (let tx = 4; tx <= 7; tx++) for (let py = 0; py < TILE; py += 3) for (let px = 0; px < TILE; px += 3) expect(fogIndoors(rooms, ...at(tx, ty, px, py), false, false), `${tx},${ty} ${px},${py}`).toBe(true);
    // Around the cabin: the ground beside and before every wall, the roof's eave over it included.
    for (let x = 3; x <= 8; x++) {
      for (let py = 12; py < TILE; py++) expect(fogIndoors(rooms, ...at(x, 7, 8, py), false, false), `south ${x} ${py}`).toBe(false);
      for (let py = 0; py < 5; py++) expect(fogIndoors(rooms, ...at(x, 3, 8, py), false, false), `north ${x} ${py}`).toBe(false);
      expect(fogIndoors(rooms, ...at(x, 8, 8, 8), false, false)).toBe(false);
      expect(fogIndoors(rooms, ...at(x, 2, 8, 8), false, false)).toBe(false);
    }
    for (let y = 3; y <= 7; y++) {
      expect(fogIndoors(rooms, ...at(2, y, 8, 8), false, false)).toBe(false);
      expect(fogIndoors(rooms, ...at(9, y, 8, 8), false, false)).toBe(false);
    }
    // The front (south) wall's face shows the air before it; the back wall's face, seen from inside, the room's – on its
    // band and where the wall's pixels stand, on the tile's last row south of it.
    for (let py = 5; py <= 15; py++) {
      expect(fogIndoors(rooms, ...at(6, 7, 8, py), false, true), `front ${py}`).toBe(false);
      expect(fogIndoors(rooms, ...at(6, 3, 8, py), false, true), `back ${py}`).toBe(true);
    }
    // A roof (or a crown) above its ground lies in the open air.
    expect(fogIndoors(rooms, ...at(5, 5, 8, 8), true, true)).toBe(false);
    // Without a roof there is no room.
    const open = cabin(null).rooms;
    for (let ty = 4; ty <= 6; ty++) for (let tx = 4; tx <= 7; tx++) expect(fogIndoors(open, ...at(tx, ty, 8, 8), false, false)).toBe(false);
    for (let ty = 4; ty <= 6; ty++) for (const tx of [3, 8]) expect(fogIndoors(open, ...at(tx, ty, 8, 15), false, true)).toBe(false);
  });

  it('M5-49: the side walls seen from inside show the room; the doorway lies in the open air', () => {
    const { rooms } = cabin('dach_stroh', true);
    // The side walls (north–south runs, band 5…10 across): every pixel standing on their band – the wall's pixels stand on
    // its tile's rows – shows the room beside it, not the open air outside (before M5-49: open air west of 9 px).
    for (let ty = 4; ty <= 6; ty++) {
      for (const tx of [3, 8]) {
        for (let px = 5; px <= 10; px++) for (let py = 0; py < TILE; py++) expect(fogIndoors(rooms, ...at(tx, ty, px, py), false, true), `side ${tx},${ty} ${px},${py}`).toBe(true);
      }
    }
    // The back corners' knots (a north–south and an east–west run meet): the room diagonally before them.
    for (const tx of [3, 8]) for (let px = 5; px <= 10; px++) for (let py = 5; py <= 10; py++) expect(fogIndoors(rooms, ...at(tx, 3, px, py), false, true), `corner ${tx} ${px},${py}`).toBe(true);
    // The front corners belong to the front wall: open air.
    for (const tx of [3, 8]) for (let px = 5; px <= 10; px++) for (let py = 5; py <= 15; py++) expect(fogIndoors(rooms, ...at(tx, 7, px, py), false, true), `front corner ${tx} ${px},${py}`).toBe(false);
    // The open door (tile 5, 7): its floor on the band 5…10 is open air – the door stands open, the air flows through
    // (before M5-49 the band's northern rows counted as the room) –, the floor north of it the room's, and the door's
    // frame and leaf standing on the band show the air before the front: open.
    expect(rooms.opening(...at(5, 7, 8, 8))).toBe(true);
    for (let px = 0; px < TILE; px++) {
      for (let py = 5; py <= 10; py++) {
        expect(fogIndoors(rooms, ...at(5, 7, px, py), false, false), `doorway ${px},${py}`).toBe(false);
        expect(fogIndoors(rooms, ...at(5, 7, px, py), false, true), `door ${px},${py}`).toBe(false);
      }
      for (let py = 0; py < 5; py++) expect(fogIndoors(rooms, ...at(5, 7, px, py), false, false), `inside the door ${px},${py}`).toBe(true);
    }
    // The probes step past the 6-px band in the shader's order.
    expect(FOG_FACE_PROBES.map(([x, y]) => `${x},${y}`)).toEqual(['0,1', '1,0', '-1,0', '1,1', '-1,1']);
    expect(FOG_ROOM.facePx).toBeGreaterThan(WALL_BAND.to - WALL_BAND.from);
    // A window in a side wall shows the room beside it, like its wall; the floor beside it stays the room's.
    const win = cabin('dach_stroh', false, true).rooms;
    expect(win.opening(...at(3, 5, 8, 8))).toBe(true);
    for (let px = 5; px <= 10; px++) for (let py = 0; py < TILE; py++) expect(fogIndoors(win, ...at(3, 5, px, py), false, true), `window ${px},${py}`).toBe(true);
    for (let px = 12; px < TILE; px++) expect(fogIndoors(win, ...at(3, 5, px, 8), false, false)).toBe(true);
  });

  it('the density shader keeps the same rules, and a room keeps only a faint haze', () => {
    const src = (SHADERS['fog_density.frag'] ?? '').replace(/\s+/g, ' ');
    expect(src).toContain('vec2 ground = fields ? groundPointAt(uMask, world, h) : world + vec2(0.0, h);');
    expect(src).toContain('float a = fogAmount(uFog.x, fogPattern(uNoise, ground)) * fogHeightFade(h, uFog.y, uFog.z);');
    expect(src).toContain('bool raised = h > occluderAt(uMask, ground).w + DH_SUN_HEIGHT_EPSILON;');
    expect(src).toContain('bool top = raised && gbufferHasMaterial(g1, DH_MAT_CANOPY);');
    expect(src).toContain('return roofedAt(uMask, air) && roofedAt(uMask, air + vec2(r, 0.0)) && roofedAt(uMask, air - vec2(r, 0.0)) && roofedAt(uMask, air + vec2(0.0, r)) && roofedAt(uMask, air - vec2(0.0, r));');
    // fogIndoors: off the bands the air at the ground point; the floor of an opening open; a face the first probe past
    // the band that lies in a room (FOG_FACE_PROBES in the same order).
    expect(src).toContain('if (!fogBand(g)) return fogRoomAir(ground);');
    expect(src).toContain('if (!raised && g < 0.5) return false;');
    expect(src).toContain('const vec2 FACE_PROBES[5] = vec2[5](vec2(0.0, 1.0), vec2(1.0, 0.0), vec2(-1.0, 0.0), vec2(1.0, 1.0), vec2(-1.0, 1.0));');
    expect(src).toContain('vec2 q = ground + DH_FOG_FACE_PX * FACE_PROBES[i]; if (!fogBand(fogStructure(q)) && fogRoomAir(q)) return true;');
    expect(src).toContain('return g > 0.5 * (DH_ROOF_MARK + DH_OPENING_MARK);');
    expect(src).toContain('if (fogIndoors(ground, top, raised)) { a *= DH_FOG_ROOFED; open = 0.0; }');
    expect(src).toContain('oFog = vec4(a, open, 0.0, 1.0);');
    // No level-0 guess of the ground point while the mask is there, no mask-only lookups (M5-44: the ring beyond it).
    expect(src.match(/world \+ vec2\(0\.0, h\)/g)).toHaveLength(1);
    expect(src).not.toMatch(/sdfGroundPoint|sdfGroundHeight|sdfRoofed\(|sdfOccluder\(/);
    const d = fogDefines();
    expect([d.DH_FOG_ROOFED, d.DH_FOG_ROOM_PX, d.DH_FOG_FACE_PX]).toEqual([String(FOG_ROOM.density), `${FOG_ROOM.reachPx}.0`, `${FOG_ROOM.facePx}.0`]);
    // A haze of a sixth or less of the open air's fog: at most a few of the 16 bands, never a veil.
    expect(FOG_ROOM.density).toBeGreaterThan(0);
    expect(FOG_ROOM.density * FOG_LOOK.opacity).toBeLessThan(0.1);
  });

  it('a room’s fog is lit by the sky’s share through the roof; the glow takes no neighbour from the other air (TypeScript = GLSL)', () => {
    expect(fogRoofedLight(1)).toBe(BUILDING_SUN.roofSkyShare);
    expect(fogRoofedLight(0.6)).toBeCloseTo(0.6 * BUILDING_SUN.roofSkyShare, 12);
    const same = glslScalar('fog.glsl', 'fogSameAir', fogDefines());
    for (const [tap, open] of [[0, 0], [1, 1], [0, 1], [1, 0]] as const) {
      expect(fogSameAir(tap, open)).toBe(tap === open ? 1 : 0);
      expect(same(tap, open)).toBe(fogSameAir(tap, open));
    }
    const src = (SHADERS['fog_composite.frag'] ?? '').replace(/\s+/g, ' ');
    expect(src).toContain('vec3 c = (open > 0.5 ? uFogColor : uFogColorRoofed) * a;');
    expect(src).toContain('return fogSameAir(texelFetch(uFog, clamp(q, ivec2(0), top), 0).g, open);');
    expect(src).toContain('l *= over / (2.0 + wne + wnw + wse + wsw);');
    for (const tap of ['ne', 'nw', 'se', 'sw']) expect(src).toContain(`lightAt(${tap}, top) * w${tap}`);
  });

  it('the pass reads ground heights, walls and roofs from the occluder mask when the occluder pass ran, and its ring (M5-44)', () => {
    const { r } = renderer();
    const a = r.atmosphere.atmosphere;
    const s = new RenderScene();
    const frame = (index: number, lit: boolean): void => {
      s.beginFrame(index);
      s.env.fog = 0.6;
      s.env.fogHeight = 40;
      if (lit) {
        const l = s.light.reset();
        l.radius = 80;
        s.lights.push(l);
      }
      r.render(s, 960, 540, 'sharp');
    };
    frame(1, true);
    expect([a.drewFog, a.roomsKnown, a.ringKnown]).toEqual([true, true, true]);
    // The occluder pass draws its ring only while the scene has lights or a directed light: the mask alone then.
    frame(2, false);
    expect([a.drewFog, a.roomsKnown, a.ringKnown]).toEqual([true, true, false]);
    r.passes.setEnabled('occluder', false);
    frame(3, true);
    expect([a.drewFog, a.roomsKnown, a.ringKnown]).toEqual([true, false, false]);
  });
});

describe('M5-44: Bodenpunkt jenseits des Flutrahmens aus dem Occluder-Ring', () => {
  /** A view of 480 × 270 px at world (0, 0) with its flood frame and ring; a plateau one level up reaching far below the view. */
  function plateauFrame(): { view: { w: number; h: number }; mask: FrameOccluders; maskOnly: FrameOccluders } {
    const view = { w: 480, h: 270 };
    const list = new OccluderList();
    list.rect(96, 120, 416, 720, WAND_PX_JE_STUFE, OCCLUDER_CLASS.terrain, false, WAND_PX_JE_STUFE);
    const m = SDF.marginPx;
    const field = new OccluderField(-m, -m, view.w + 2 * m, view.h + 2 * m);
    field.draw(list);
    const size = ringSize(view.w, view.h);
    const reach = OCCLUDER_RING.reachPx;
    const ring = new OccluderRing(-reach, -reach, size.width, size.height);
    ring.draw(list);
    return { view, mask: new FrameOccluders(field, ring), maskOnly: new FrameOccluders(field, null) };
  }

  it('a crown pixel at the bottom of the view on a plateau stands on level 1 (the mask alone put it on level 0, 16 px too far south)', () => {
    const { view, mask, maskOnly } = plateauFrame();
    const x = 250.5;
    const y = view.h - 0.5;
    // A crown 60 px above the plateau: its ground lies 60 px south of the view's last row, beyond the 32-px flood margin.
    const z = WAND_PX_JE_STUFE + 60;
    const [, gy] = mask.groundPoint(x, y, z);
    expect(gy).toBeCloseTo(y + 60, 0);
    // (The mask and ring hold the ground height in 8 bits: level 1 within a tenth of a pixel.)
    expect(Math.round(mask.groundHeight(x, gy) / WAND_PX_JE_STUFE)).toBe(1);
    expect(mask.groundHeight(x, gy)).toBeCloseTo(WAND_PX_JE_STUFE, 0);
    const [, old] = maskOnly.groundPoint(x, y, z);
    expect(old).toBeCloseTo(y + z, 6);
    expect(maskOnly.groundHeight(x, old)).toBe(0);
    // No seam at the flood frame's edge: down a column of crown pixels the ground point keeps its distance – with the
    // mask alone it jumps a level's 16 px where the ground point leaves the frame.
    let jumps = 0;
    let oldJumps = 0;
    for (let row = 150; row < view.h; row++) {
      const yy = row + 0.5;
      if (Math.abs(mask.groundPoint(x, yy, z)[1] - yy - 60) > 0.5) jumps++;
      if (Math.abs(maskOnly.groundPoint(x, yy, z)[1] - yy - 60) > 0.5) oldJumps++;
    }
    expect(jumps).toBe(0);
    expect(oldJumps).toBeGreaterThan(0);
    // The corruption's patches and veins take the same ground point.
    expect(corruptionGroundPoint(x, y, z, false, mask)[1]).toBeCloseTo(y + 60, 0);
    // Rooms beyond the frame too: the ring holds the roofs (a roof 100 px below the view is known).
    const roofs = new OccluderList();
    roofs.rect(200, 360, 260, 400, STRUCTURAL_TOP_PX, OCCLUDER_CLASS.roof);
    const m = SDF.marginPx;
    const field = new OccluderField(-m, -m, view.w + 2 * m, view.h + 2 * m);
    field.draw(roofs);
    const ring = new OccluderRing(-OCCLUDER_RING.reachPx, -OCCLUDER_RING.reachPx, ringSize(view.w, view.h).width, ringSize(view.w, view.h).height);
    ring.draw(roofs);
    expect(new FrameOccluders(field, ring).roofed(230.5, 380.5)).toBe(true);
    expect(new FrameOccluders(field, null).roofed(230.5, 380.5)).toBe(false);
  });
});

describe('M5-41: Streulicht im Nebel weich über dem Tageslicht', () => {
  /** A GL whose uniform locations remember their names; the last value uploaded per uniform name. */
  function namedRenderer(): { r: Renderer; values: Map<string, number[]> } {
    const fake = createFakeGl();
    const names = new Map<unknown, string>();
    const values = new Map<string, number[]>();
    const gl = new Proxy(fake.gl as object, {
      get(target, prop) {
        const v = Reflect.get(target, prop) as unknown;
        if (typeof v !== 'function') return v;
        const f = v as (...args: unknown[]) => unknown;
        if (prop === 'getUniformLocation') {
          return (program: unknown, name: string) => {
            const loc = f(program, name);
            names.set(loc, name);
            return loc;
          };
        }
        if (typeof prop === 'string' && /^uniform[1-4]f(v)?$/.test(prop)) {
          return (loc: unknown, ...args: unknown[]) => {
            const name = names.get(loc);
            if (name !== undefined) {
              const first = args[0];
              if (first instanceof Float32Array) {
                const offset = typeof args[1] === 'number' ? args[1] : 0;
                const length = typeof args[2] === 'number' ? args[2] : first.length - offset;
                values.set(name, Array.from(first.subarray(offset, offset + length)));
              } else values.set(name, args.map(Number));
            }
            return f(loc, ...args);
          };
        }
        return f;
      },
    }) as WebGL2RenderingContext;
    const r = new Renderer(gl, { caps: { floatTargets: true, forcedRgba8: false, maxDrawBuffers: 8 }, sources: new ShaderSourceStore(SHADERS), errors: { report: () => undefined }, paletteHex: PALETTE_HEX });
    return { r, values };
  }

  /** A foggy scene with a torch under ambient (r, g, b) × `intensity`, a sun or moon of `share` (0: none). */
  function scene(r: number, g: number, b: number, intensity: number, share: number): RenderScene {
    const s = new RenderScene();
    s.beginFrame(1);
    s.env.fog = 0.6;
    s.env.fogHeight = 40;
    s.env.ambientR = r;
    s.env.ambientG = g;
    s.env.ambientB = b;
    s.env.ambientIntensity = intensity;
    if (share > 0) splitDaylight(share, 0.1, s.sky.directional);
    const l = s.light.reset();
    l.radius = 80;
    l.height = 12;
    s.lights.push(l);
    return s;
  }

  it('the fog’s scattered light takes pointOverDaylight of its own daylight (composite_daylight.glsl = banding.ts)', () => {
    const peak = glslScalar('composite_daylight.glsl', 'pointOverPeak', pointOverDaylightDefines());
    for (let p = 0; p <= 12; p++) for (let l = 0; l <= 10; l++) expect(peak(p / 10, l / 10)).toBeCloseTo(pointOverPeak(p / 10, l / 10), 6);
    const src = (SHADERS['fog_composite.frag'] ?? '').replace(/\s+/g, ' ');
    expect(src).toContain('#include "composite_daylight.glsl"');
    expect(src).toContain('float over = pointOverDaylight(open > 0.5 ? uFogDay : uFogDayRoofed, uDayLevel);');
    expect(src).toContain('if (uScatter == 1 && over > 0.0) {');
    // The factor scales the light before its peak and its quantised scatter.
    expect(src.indexOf('l *= over / (2.0 + wne + wnw + wse + wsw);')).toBeLessThan(src.indexOf('float peak = max(max(l.r, l.g), l.b);'));
    // The TypeScript mirror: the open air takes the ambient, a room the sky's share through the roof.
    expect(fogScatterShare(true, 1, 1, 1)).toBe(0);
    expect(fogScatterShare(true, 0.3, 0.32, 0.36)).toBeCloseTo(pointOverAmbient(0.3, 0.32, 0.36), 12);
    expect(fogScatterShare(false, 1, 1, 1, 0.5, 0.5, 0.57)).toBeCloseTo(pointOverDaylight(0.5 * BUILDING_SUN.roofSkyShare, 0.5 * BUILDING_SUN.roofSkyShare, 0.57 * BUILDING_SUN.roofSkyShare, 1), 12);
    expect(fogScatterShare(false, 1, 1, 1, 0.5, 0.5, 0.57)).toBeGreaterThan(0);
  });

  it('uploaded by the pass: sunlit noon 0, a moonlit night ≥ 0.87, a cave ≈ 1 (the shader’s factor from the uploaded uniforms)', () => {
    const peak = glslScalar('composite_daylight.glsl', 'pointOverPeak', pointOverDaylightDefines());
    const { r, values } = namedRenderer();
    /** The shader's factor for the open air and for a room from what the pass uploaded. */
    const factors = (s: RenderScene): { open: number; room: number } => {
      values.clear();
      r.render(s, 960, 540, 'sharp');
      expect(r.atmosphere.atmosphere.scattered).toBe(true);
      const day = values.get('uFogDay');
      const roofed = values.get('uFogDayRoofed');
      const level = values.get('uDayLevel');
      if (day === undefined || roofed === undefined || level === undefined) throw new Error('Tageslicht des Nebels nicht hochgeladen');
      return { open: peak(Math.max(...day), level[0] ?? -1), room: peak(Math.max(...roofed), level[0] ?? -1) };
    };
    // Noon: white ambient at full strength, the sun's share of it.
    const noon = factors(scene(1, 1, 1, 1, 0.5));
    expect(noon.open).toBe(0);
    expect(fogScatterShare(true, 1, 1, 1)).toBe(0);
    // Under a roof at noon the sky's share lights the room's haze: the torch keeps part of its glow there.
    expect(noon.room).toBeGreaterThan(0.3);
    expect(noon.room).toBeLessThan(1);
    // The brightest night: a full moon (NIGHT_AMBIENT) in moonlight's colour.
    const full = NIGHT_AMBIENT.base + NIGHT_AMBIENT.fullMoon;
    const night = factors(scene(MOONLIGHT[0], MOONLIGHT[1], MOONLIGHT[2], full, 0.3));
    expect(night.open).toBeGreaterThanOrEqual(0.87);
    expect(night.open).toBeCloseTo(fogScatterShare(true, MOONLIGHT[0] * full, MOONLIGHT[1] * full, MOONLIGHT[2] * full), 5);
    // A cave: almost no ambient, no sky.
    const cave = factors(scene(CAVE_AMBIENT[0], CAVE_AMBIENT[1], CAVE_AMBIENT[2], CAVE_AMBIENT_INTENSITY, 0));
    expect(cave.open).toBeCloseTo(1, 2);
    expect(cave.room).toBeCloseTo(1, 2);
  });
});

describe('Screenshot-Szenarien der Atmosphäre', () => {
  it('cover every picture PROGRESS names for M5-10, M5-13 … M5-16 and M5-22', () => {
    const names = atmosphereScenarios().map((s) => s.name);
    for (const n of ['nebel-nacht-fackel', 'hitzeflimmern', 'bloom', 'schockwelle', 'crt', 'verderbnis-voll', 'verderbnis-halb']) expect(names).toContain(n);
    expect(names.filter((n) => n.startsWith('daemmerung-gruenhain-')).length).toBeGreaterThanOrEqual(4);
    for (const e of ['furcht', 'leben', 'kaelte', 'hitze', 'erschoepfung', 'gift', 'rausch', 'uebergang']) expect(names).toContain(`effekt-${e}`);
    expect(new Set(names).size).toBe(names.length);
    // Review M5: the fog around a lit cabin in the Nebelmoor, seen from inside (a base picture: built with the game's commands).
    const innen = basisSzenarien().find((b) => b.name === 'nebel-innen');
    expect(innen?.description).toMatch(/Nebelmoor/);
    // M5-41: the camp in the Nebelmoor's fog at noon – no scattered torch light over the daylight.
    expect(names).toContain('nebel-tag-fackel');
  });
});
