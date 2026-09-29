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
import { FOG_DEBUG_VIEW, FOG_LOOK, FOG_ROOM, FOG_SCATTER, fogAmount, fogDefines, fogHeightFade, fogIndoors, fogRoofedLight, fogSameAir, fogScatter, type FogRooms } from '../../../src/render/passes/atmospherePass';
import { BuildingOccluders } from '../../../src/render/light/buildingOccluders';
import { OccluderField } from '../../../src/render/light/lightMath';
import { OccluderList } from '../../../src/render/light/occluders';
import { BUILDING_SUN } from '../../../src/render/light/params';
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

describe('Nebel in Räumen (Prüfung M5)', () => {
  /** A cabin (walls, a door in the south wall, straw roof) over the interior tiles 4…7 × 4…6 of a meadow; its occluder mask. */
  function cabin(roof: string | null): { field: OccluderField; rooms: FogRooms } {
    const w = bauWelt(meadow(14, 14));
    w.spawn(5, 9);
    hut(w, 4, 4, 7, 6, 'wand_holz', 'tuer_holz', roof);
    const list = new OccluderList();
    new BuildingOccluders().collect(w.building.structures, w.building.catalog, 0, OFFSET, OFFSET, OFFSET + 13, OFFSET + 13, () => 0, list);
    const field = new OccluderField(OFFSET * TILE, OFFSET * TILE, 14 * TILE, 14 * TILE);
    field.draw(list);
    const rooms: FogRooms = {
      wall: (x, y) => {
        const [i, j] = field.texel(x, y);
        return field.maskAt(i, j).structural;
      },
      roofed: (x, y) => field.roofed(x, y),
    };
    return { field, rooms };
  }
  /** World px of pixel (px, py) of relative tile (tx, ty). */
  const at = (tx: number, ty: number, px: number, py: number): [number, number] => [(OFFSET + tx) * TILE + px + 0.5, (OFFSET + ty) * TILE + py + 0.5];

  it('the room is roofed air; the eave strip, the air before the front wall and a roof seen from outside are open air', () => {
    const { rooms } = cabin('dach_stroh');
    // Every pixel of the floor inside.
    for (let ty = 4; ty <= 6; ty++) for (let tx = 4; tx <= 7; tx++) for (let py = 0; py < TILE; py += 3) for (let px = 0; px < TILE; px += 3) expect(fogIndoors(rooms, ...at(tx, ty, px, py), false), `${tx},${ty} ${px},${py}`).toBe(true);
    // Around the cabin: the ground beside and before every wall, the roof's eave over it included.
    for (let x = 3; x <= 8; x++) {
      for (let py = 12; py < TILE; py++) expect(fogIndoors(rooms, ...at(x, 7, 8, py), false), `south ${x} ${py}`).toBe(false);
      for (let py = 0; py < 5; py++) expect(fogIndoors(rooms, ...at(x, 3, 8, py), false), `north ${x} ${py}`).toBe(false);
      expect(fogIndoors(rooms, ...at(x, 8, 8, 8), false)).toBe(false);
      expect(fogIndoors(rooms, ...at(x, 2, 8, 8), false)).toBe(false);
    }
    for (let y = 3; y <= 7; y++) {
      expect(fogIndoors(rooms, ...at(2, y, 8, 8), false)).toBe(false);
      expect(fogIndoors(rooms, ...at(9, y, 8, 8), false)).toBe(false);
    }
    // The front (south) wall's face shows the air before it; the back wall's face, seen from inside, the room's.
    for (let py = 5; py <= 10; py++) {
      expect(fogIndoors(rooms, ...at(6, 7, 8, py), false), `front ${py}`).toBe(false);
      expect(fogIndoors(rooms, ...at(6, 3, 8, py), false), `back ${py}`).toBe(true);
    }
    // A roof (or a crown) above its ground lies in the open air.
    expect(fogIndoors(rooms, ...at(5, 5, 8, 8), true)).toBe(false);
    // Without a roof there is no room.
    const open = cabin(null).rooms;
    for (let ty = 4; ty <= 6; ty++) for (let tx = 4; tx <= 7; tx++) expect(fogIndoors(open, ...at(tx, ty, 8, 8), false)).toBe(false);
  });

  it('the density shader keeps the same rules, and a room keeps only a faint haze', () => {
    const src = (SHADERS['fog_density.frag'] ?? '').replace(/\s+/g, ' ');
    expect(src).toContain('vec2 ground = fields ? sdfGroundPoint(uMask, world, h) : world + vec2(0.0, h);');
    expect(src).toContain('float a = fogAmount(uFog.x, fogPattern(uNoise, ground)) * fogHeightFade(h, uFog.y, uFog.z);');
    expect(src).toContain('bool top = gbufferHasMaterial(g1, DH_MAT_CANOPY) && h > sdfGroundHeight(uMask, ground) + DH_SUN_HEIGHT_EPSILON;');
    expect(src).toContain('vec2 air = fogWall(ground) ? ground + vec2(0.0, DH_FOG_FACE_PX) : ground;');
    expect(src).toContain('return sdfRoofed(uMask, air) && sdfRoofed(uMask, air + vec2(r, 0.0)) && sdfRoofed(uMask, air - vec2(r, 0.0)) && sdfRoofed(uMask, air + vec2(0.0, r)) && sdfRoofed(uMask, air - vec2(0.0, r));');
    expect(src).toContain('if (!top && fogIndoors(air)) { a *= DH_FOG_ROOFED; open = 0.0; }');
    expect(src).toContain('oFog = vec4(a, open, 0.0, 1.0);');
    // No level-0 guess of the ground point while the mask is there.
    expect(src.match(/world \+ vec2\(0\.0, h\)/g)).toHaveLength(1);
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
    expect(src).toContain('l /= 2.0 + wne + wnw + wse + wsw;');
    for (const tap of ['ne', 'nw', 'se', 'sw']) expect(src).toContain(`lightAt(${tap}, top) * w${tap}`);
  });

  it('the pass reads ground heights, walls and roofs from the occluder mask when the occluder pass ran', () => {
    const { r } = renderer();
    const a = r.atmosphere.atmosphere;
    const s = new RenderScene();
    s.beginFrame(1);
    s.env.fog = 0.6;
    s.env.fogHeight = 40;
    r.render(s, 960, 540, 'sharp');
    expect([a.drewFog, a.roomsKnown]).toEqual([true, true]);
    r.passes.setEnabled('occluder', false);
    s.beginFrame(2);
    s.env.fog = 0.6;
    s.env.fogHeight = 40;
    r.render(s, 960, 540, 'sharp');
    expect([a.drewFog, a.roomsKnown]).toEqual([true, false]);
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
  });
});
