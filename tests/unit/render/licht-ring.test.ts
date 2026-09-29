/**
 * M5-Review M2 und Minor 2: Lichter jenseits des Occluder-Rahmens und Strahlen, denen die Schritte ausgehen
 * (MASTERPROMPT §12.1 „Wände … sind in Karte und Bild lichtdicht“, M5-34). Am CPU-Spiegel des Shaders
 * (`lightMath.lightShadow` mit dem Occluder-Ring, `raySurvives`, `OccluderRing` = sdf_ring.glsl / occluder_mask.* mit dem
 * Spielraum des Rings):
 * - Eine Fackel in einer Hütte 60 px neben dem Rahmen des Distanzfelds wirft kein Licht aus der Hütte in den Rahmen –
 *   der Ring kennt die Wände; ein Lagerfeuer im Freien neben dem Rahmen leuchtet hinein (kein Sprung am Bildrand).
 * - Ein Strahl, der streifend an einer Wand entlangläuft, verbraucht seine 40 Schritte; dahinter entscheidet der grobe
 *   Gang durch Maske und Ring – eine Querwand sperrt, freie Bahn bleibt hell.
 * - Das Licht bringt seinen Boden mit (Ebene × 16 px, `LightDesc.base`); der Ring reicht für jedes Licht des Contents.
 * - M5-45: ein Ofen 60 px neben dem Rahmen brennt in seinem Körper wie im Rahmen – der Ring trägt die Deko-Standflächen
 *   des Frames, `housingTop` und `lightHousing` lesen sie jenseits des Rahmens (`occluderWithDecorAt`): sein Licht geht
 *   rundum hinaus, sein Körper behält nur den Gehäuseanteil und leuchtet sonst durch seine Öffnungen.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { FURNITURE_FLAME_HEIGHT_PX, LIGHT_KINDS } from '../../../src/content/lights';
import { GBUFFER_HEIGHT_RANGE_PX } from '../../../src/render/gbuffer';
import { housingTop, lightHousing, lightShadow, OccluderField, OccluderRing, occluderAt, occluderWithDecorAt, raySurvives } from '../../../src/render/light/lightMath';
import { OccluderList, SpriteOccluders } from '../../../src/render/light/occluders';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc, SpriteList } from '../../../src/render/batch/spriteList';
import { STATION_LIGHT_RADIUS_MAX, STATIONS } from '../../../src/content/stations';
import { LIGHT_HOUSING, OCCLUDER_CLASS, OCCLUDER_RING, POINT_SHADOW, ROOF_MARK, SDF, STRUCTURAL_TOP_PX } from '../../../src/render/light/params';
import { jumpFloodSteps, ringSize } from '../../../src/render/passes/occluderPass';
import { PALETTE_HEX } from '../../../src/generated/palette';
import { sceneAtlas } from '../../../src/render/assets/sceneSprites';
import { ShaderSourceStore } from '../../../src/render/gl/shaders';
import { findLightPipeline, installLightPipeline } from '../../../src/render/light/pipeline';
import type { OccluderList as FootprintList } from '../../../src/render/light/occluders';
import { Renderer } from '../../../src/render/renderer';
import { RenderScene } from '../../../src/render/scene';
import { createFakeGl } from './fakeGl';
import { SHADERS } from '../../../src/render/shaderLib';
import { TILE_PX } from '../../../src/world/model/coords';

/** The flood frame: [0, W) × [0, H) – the view and its margin. */
const W = 160;
const H = 96;
const R = OCCLUDER_RING.reachPx;
const T = OCCLUDER_RING.texelPx;
/** Wall band of a build-grid wall: rows 5–10 of its tile (`WALL_BAND`), 6 px. */
const BAND = 6;

interface Scene {
  readonly field: OccluderField;
  readonly ring: OccluderRing;
}

/** The scene's footprints `build` in the flood frame and in the ring around it (both as the occluder pass draws them). */
function scene(build: (l: OccluderList) => void): Scene {
  const list = new OccluderList();
  build(list);
  const field = new OccluderField(0, 0, W, H);
  field.draw(list);
  field.flood(jumpFloodSteps(SDF.firstStepPx));
  const size = ringSize(W, H);
  const ring = new OccluderRing(-R, -R, size.width, size.height);
  ring.draw(list);
  return { field, ring };
}

/** A hut of wooden walls from (x0, y0) to (x1, y1) [px]: four wall bands of `BAND` px on its tile edges. */
function hut(l: OccluderList, x0: number, y0: number, x1: number, y1: number, openWest = false): void {
  l.rect(x0, y0, x1, y0 + BAND, STRUCTURAL_TOP_PX, OCCLUDER_CLASS.structural);
  l.rect(x0, y1 - BAND, x1, y1, STRUCTURAL_TOP_PX, OCCLUDER_CLASS.structural);
  if (openWest) {
    // A door gap of a tile in the middle of the west wall.
    const mid = (y0 + y1) / 2;
    l.rect(x0, y0, x0 + BAND, mid - TILE_PX / 2, STRUCTURAL_TOP_PX, OCCLUDER_CLASS.structural);
    l.rect(x0, mid + TILE_PX / 2, x0 + BAND, y1, STRUCTURAL_TOP_PX, OCCLUDER_CLASS.structural);
  } else l.rect(x0, y0, x0 + BAND, y1, STRUCTURAL_TOP_PX, OCCLUDER_CLASS.structural);
  l.rect(x1 - BAND, y0, x1, y1, STRUCTURAL_TOP_PX, OCCLUDER_CLASS.structural);
  l.rect(x0, y0, x1, y1, 0, OCCLUDER_CLASS.roof);
}

/** Visibility of a light at `to` (flame 12 px up) for a ground pixel at `from`, hard shadows, through field and ring. */
function vis(s: Scene, from: readonly [number, number], to: readonly [number, number], ring = true): number {
  return lightShadow(s.field, from, 0, false, false, to, 12, 0, -1, false, true, false, ring ? s.ring : null)[0];
}

describe('Occluder-Ring jenseits des Distanzfelds (M5-Review M2)', () => {
  it('der Ring reicht für jedes Licht des Contents und unter die höchsten Pixel der Ansicht', () => {
    const radii = [
      BALANCE.light.torch.radiusTiles,
      BALANCE.light.campfire.radiusTiles,
      BALANCE.hearth.light.radiusTiles,
      BALANCE.fire.light.radiusTiles,
      STATION_LIGHT_RADIUS_MAX,
      ...LIGHT_KINDS.map((k) => k.moebel?.radius ?? 0),
    ];
    expect(Math.max(...radii) * TILE_PX).toBeLessThanOrEqual(R);
    // Every ray of such a light fits the march: its length is at most the radius.
    expect(OCCLUDER_RING.maxSteps * OCCLUDER_RING.stepPx).toBeGreaterThanOrEqual(R);
    // The march never steps over a wall band.
    expect(OCCLUDER_RING.stepPx).toBeLessThan(BAND);
    const size = ringSize(480, 270);
    expect(size.width * T).toBeGreaterThanOrEqual(480 + 2 * R);
    expect(size.height * T).toBeGreaterThanOrEqual(270 + 2 * R + GBUFFER_HEIGHT_RANGE_PX);
  });

  it('eine Wand bleibt im groben Ring geschlossen: jede Probe auf dem Wandband trifft sie', () => {
    const s = scene((l) => hut(l, 220, 20, 284, 84));
    // Along the west wall's band (x 220–226), every 0.5 px: structural in the ring, and roofed inside the hut.
    for (let y = 20.25; y < 84; y += 0.5) {
      for (let x = 220.25; x < 226; x += 0.5) expect(s.ring.at(x, y)?.structural).toBe(true);
    }
    const inside = s.ring.at(250, 50);
    expect(inside?.structural).toBe(false);
    expect(s.ring.mask[((Math.floor((50 + R) / T) * s.ring.width + Math.floor((250 + R) / T)) * 4) + 1]).toBe(ROOF_MARK);
    // Inside the flood frame the field's own mask answers; beyond both nothing is known.
    expect(occluderAt(s.field, s.ring, 10, 10)).toEqual(s.field.maskAt(10, 10));
    expect(occluderAt(s.field, s.ring, W + R + 10, 10)).toBeNull();
  });

  it('eine Fackel in einer Hütte 60 px neben dem Rahmen wirft kein Licht aus der Hütte in den Rahmen', () => {
    // The hut's west wall 60 px east of the frame (x 220–226), the torch inside it.
    const s = scene((l) => hut(l, W + 60, 20, W + 124, 84));
    const torch: [number, number] = [W + 90, 52];
    // Ground in the frame near its east edge, in the torch's reach: the walls outside the frame keep the light in.
    for (const y of [30.5, 52.5, 70.5]) {
      expect(vis(s, [W - 4.5, y], torch)).toBe(0);
      expect(vis(s, [W - 40.5, y], torch)).toBe(0);
    }
    // The same torch with a door gap in the west wall: its light falls out through the gap only.
    const open = scene((l) => hut(l, W + 60, 20, W + 124, 84, true));
    expect(vis(open, [W - 4.5, 52.5], [W + 90, 52])).toBe(1);
    expect(vis(open, [W - 4.5, 24.5], [W + 90, 52])).toBe(0);
  });

  it('ein Lagerfeuer im Freien neben dem Rahmen leuchtet hinein – mit und ohne Wände dazwischen richtig', () => {
    const open = scene(() => undefined);
    const fire: [number, number] = [W + 70, 48];
    expect(vis(open, [W - 10.5, 48.5], fire)).toBe(1);
    // A wall across the way outside the frame (a fence of the build grid is decor; a wall is structural).
    const walled = scene((l) => l.rect(W + 30, 0, W + 30 + BAND, H, STRUCTURAL_TOP_PX, OCCLUDER_CLASS.structural));
    expect(vis(walled, [W - 10.5, 48.5], fire)).toBe(0);
    // Without the ring, a ray that leaves the frame counts as blocked (nothing is known out there): no light leaks in.
    expect(vis(walled, [W - 10.5, 48.5], fire, false)).toBe(0);
  });

  it('eine erhöhte Stufe außerhalb des Rahmens sperrt ein tieferes Licht, nicht ein Licht auf ihr', () => {
    const s = scene((l) => l.rect(W + 20, 0, W + 60, H, 16, OCCLUDER_CLASS.terrain, true, 16));
    // A light on level 0 east of the plateau: the plateau between blocks it.
    expect(lightShadow(s.field, [W - 10.5, 40.5], 0, false, false, [W + 90, 40], 12, 0, -1, false, true, false, s.ring)[0]).toBe(0);
    // A light standing on the plateau (its ground 16 px, `LightDesc.base`) reaches the ground below the edge.
    expect(lightShadow(s.field, [W - 10.5, 40.5], 0, false, false, [W + 40, 40], 28, 16, -1, false, true, false, s.ring)[0]).toBe(1);
  });

  it('der Shader verfolgt den Strahl hinter dem Rahmen durch den Ring; das Licht bringt seinen Boden mit', () => {
    const glsl = (SHADERS['lighting.glsl'] ?? '').replace(/\s+/g, ' ');
    expect(glsl).toContain('if (t < end && resStructural > 0.0 && (res > 0.0 || bookkeeping)) { float rest = raySurvives(mask, from, dir, t, end, base, inside && (ownWall || face));');
    expect(glsl).toContain('if (!occluderKnown(p)) return 0.0;');
    const ring = (SHADERS['sdf_ring.glsl'] ?? '').replace(/\s+/g, ' ');
    expect(ring).toContain('if (sdfInside(t)) return sdfOccluder(mask, t);');
    const vert = (SHADERS['lighting_point.vert'] ?? '').replace(/\s+/g, ' ');
    expect(vert).toContain('float base = aBase >= 0.0 ? aBase : uHasMask == 1 ? occluderAt(uMask, aGeom.xy).w : 0.0;');
    expect(vert).toContain('vRoofed = uHasMask == 1 && roofedAt(uMask, aGeom.xy) ? 1.0 : 0.0;');
    const mask = (SHADERS['occluder_mask.vert'] ?? '').replace(/\s+/g, ' ');
    expect(mask).toContain('vec2 ext = aBox.zw + uSlack.x;');
  });
});

describe('Strahlen, denen die Schritte ausgehen (M5-Review Minor 2)', () => {
  // A long wall along x (y 40–46) and a receiver 1.5 px below its south face: the ray to a light far east runs along the
  // face at a distance of about a pixel – the sphere trace advances by little more than a pixel per step.
  const wall = (l: OccluderList): void => l.rect(0, 40, W, 46, STRUCTURAL_TOP_PX, OCCLUDER_CLASS.structural);
  const from: [number, number] = [4.5, 47.5];
  const light: [number, number] = [150, 47.5];

  it('die 40 Schritte reichen nicht bis zum Licht', () => {
    expect(POINT_SHADOW.maxSteps * 1.5).toBeLessThan(light[0] - from[0]);
  });

  it('freie Bahn an der Wand entlang bleibt hell', () => {
    const s = scene(wall);
    expect(vis(s, from, light)).toBe(1);
  });

  it('eine Querwand hinter dem 40. Schritt sperrt das Licht (vorher leckte es entlang der Wand)', () => {
    const s = scene((l) => {
      wall(l);
      l.rect(120, 46, 120 + BAND, H, STRUCTURAL_TOP_PX, OCCLUDER_CLASS.structural);
    });
    expect(vis(s, from, light)).toBe(0);
    // The march itself: from past the traced stretch on, the cross wall at x 120 blocks.
    expect(raySurvives(s.field, s.ring, from, [1, 0], 80, 140, 0, false)).toBe(0);
    expect(raySurvives(s.field, s.ring, from, [1, 0], 80, 110, 0, false)).toBe(1);
    // A receiver standing in its own wall leaves it first.
    expect(raySurvives(s.field, s.ring, [60.5, 43.5], [0, 1], 0, 40, 0, true)).toBe(1);
    expect(raySurvives(s.field, s.ring, [60.5, 43.5], [0, 1], 0, 40, 0, false)).toBe(0);
  });
});

describe('Lichtgehäuse jenseits des Rahmens (M5-45: Ofen, Meiler, Schmelze, Laterne)', () => {
  /** A kiln's body: a decor footprint 28 × 12 px, `top` px high, its top-left at (x, y); its fire burns inside. */
  const kiln = (x: number, y: number, top = 20) => (l: OccluderList): void => l.rect(x, y, x + 28, y + 12, top, OCCLUDER_CLASS.decor);
  /** The fire of a kiln at (x, y) and its flame height. */
  const fireOf = (x: number, y: number): [number, number] => [x + 14, y + 7];
  const FLAME = 6;
  /** Light kept on a pixel of the body (lighting_point.frag): the housing's share, else all of it. */
  const bodyShare = (housed: boolean, top: number): number => (housed && top >= 0 ? LIGHT_HOUSING.floor : 1);
  /** The same kiln in the frame, 60 px east of it and 60 px south of it (top-left corners). */
  const places = {
    rahmen: [50, 40],
    osten: [W + 60, 40],
    sueden: [50, H + 60],
  } as const;

  it('ein Ofen 60 px neben dem Rahmen brennt in seinem Körper wie im Rahmen – Licht rundum hinaus, Körper nur durch die Öffnungen', () => {
    const inside = scene(kiln(...places.rahmen));
    const reference = housingTop(inside.field, fireOf(...places.rahmen), Number.POSITIVE_INFINITY, inside.ring);
    expect(reference).toBeGreaterThan(19);
    for (const [name, [x, y]] of Object.entries(places)) {
      const s = scene(kiln(x, y));
      const fire = fireOf(x, y);
      // The housing's top: the same 8-bit value from the ring as from the mask (the rays pass exactly it).
      const top = housingTop(s.field, fire, Number.POSITIVE_INFINITY, s.ring);
      expect(top, name).toBe(reference);
      // A pixel of the kiln's front beside the fire (drawn 6 px above its ground point) is its body: lit dimly.
      const front: [number, number] = [x + 2.5, y + 5.5];
      const ground: [number, number] = [x + 2.5, y + 11.5];
      expect(lightHousing(s.field, front, ground, false, fire, s.ring), name).toBe(true);
      expect(bodyShare(lightHousing(s.field, front, ground, false, fire, s.ring), top), name).toBe(LIGHT_HOUSING.floor);
      // Its light goes out all round: ground north, south, west and east of the kiln is lit.
      for (const [dx, dy] of [
        [14.5, -20.5],
        [14.5, 30.5],
        [-20.5, 6.5],
        [48.5, 6.5],
      ] as const) {
        expect(lightShadow(s.field, [x + dx, y + dy], 0, false, false, fire, FLAME, 0, top, false, true, false, s.ring)[0], `${name} ${dx} ${dy}`).toBe(1);
      }
    }
    // Before (the mask alone): beyond the frame the kiln stood free, its body lit in full – and it switched to the housing
    // share when it scrolled into the margin.
    for (const [x, y] of [places.osten, places.sueden]) {
      const s = scene(kiln(x, y));
      const fire = fireOf(x, y);
      expect(housingTop(s.field, fire)).toBe(-1);
      expect(bodyShare(lightHousing(s.field, [x + 2.5, y + 5.5], [x + 2.5, y + 11.5], false, fire), -1)).toBe(1);
    }
  });

  it('ein hoher Ofen südlich des Rahmens, dessen Körper ins Bild ragt: dessen Pixel im Rahmen gehören zum Gehäuse', () => {
    const [x, y] = places.sueden;
    const s = scene(kiln(x, y, 80));
    const fire = fireOf(x, y);
    const top = housingTop(s.field, fire, Number.POSITIVE_INFINITY, s.ring);
    expect(top).toBeGreaterThan(79);
    // A pixel of the body 2.5 px above the frame's bottom edge; its ground point lies 69 px further south, in the kiln.
    const pixel: [number, number] = [x + 10.5, H - 2.5];
    const ground: [number, number] = [x + 10.5, y + 6.5];
    expect(bodyShare(lightHousing(s.field, pixel, ground, false, fire, s.ring), top)).toBe(LIGHT_HOUSING.floor);
    expect(lightHousing(s.field, pixel, ground, false, fire)).toBe(false);
  });

  it('kein Gehäuse jenseits des Rahmens, wo keines ist: ein Stein neben dem Lagerfeuer, ein anderer Körper daneben', () => {
    // A camp fire 60 px east of the frame with a rock 8 px beside it (beyond LIGHT_HOUSING.edgePx): no housing, the rock
    // keeps its shadow in the frame's rule (decor beyond the frame casts none).
    const fire: [number, number] = [W + 70, 48];
    const s = scene((l) => l.rect(W + 70 + LIGHT_HOUSING.edgePx + 3, 40, W + 86, 56, 30, OCCLUDER_CLASS.decor));
    expect(housingTop(s.field, fire, 12, s.ring)).toBe(-1);
    // Beside a kiln beyond the frame, a stone's pixel is not the kiln's body.
    const [x, y] = places.osten;
    const two = scene((l) => {
      kiln(x, y)(l);
      l.rect(x + 40, y + 4, x + 46, y + 10, 8, OCCLUDER_CLASS.decor);
    });
    expect(lightHousing(two.field, [x + 43.5, y + 2.5], [x + 43.5, y + 9.5], false, fireOf(x, y), two.ring)).toBe(false);
    // The ring's decor is read for housings only: rays and ground points beyond the frame see no decor.
    expect(occluderAt(two.field, two.ring, x + 10, y + 6)?.decor).toBe(0);
    expect(occluderWithDecorAt(two.field, two.ring, x + 10, y + 6)?.decor).toBeGreaterThan(19);
    expect(occluderWithDecorAt(two.field, null, x + 10, y + 6)).toBeNull();
  });

  it('die Gehäuse des Spiel-Atlas (Öfen, Meiler, Schmelze, Laternen): jenseits des Rahmens dasselbe Gehäuse wie im Rahmen', () => {
    const mod = generatedAtlasModule();
    if (mod === null) return;
    const manifest = manifestFromGenerated(mod);
    const sprites = new SpriteOccluders();
    sprites.bind(manifest);
    /**
     * Station sprites with their light's depth behind the anchor and flame height (content/stations.ts `licht`), lamps
     * with their flame height (`FURNITURE_FLAME_HEIGHT_PX`) and their light on the anchor or 1 px behind it.
     */
    const station = (id: string): { depth: number; flame: number } => {
      const l = STATIONS.find((d) => d.id === id)?.licht;
      return { depth: l?.tiefePx ?? Number.NaN, flame: l?.hoehePx ?? Number.NaN };
    };
    const lamp = (item: string, depth: number): { depth: number; flame: number } => ({ depth, flame: FURNITURE_FLAME_HEIGHT_PX[item] ?? Number.NaN });
    const housings = [
      { id: 'obj_lehmofen', ...station('lehmofen') },
      { id: 'obj_koehlermeiler', ...station('koehlermeiler') },
      { id: 'obj_schmelzofen', ...station('schmelzofen') },
      ...[0, 1].flatMap((d) => [
        { id: 'obj_laterne_stehend', ...lamp('laterne_stehend', d) },
        { id: 'obj_harzlampe', ...lamp('harzlampe', d) },
        { id: 'obj_laternenpfahl', ...lamp('laternenpfahl', d) },
      ]),
    ];
    for (const { id, depth, flame } of housings) {
      expect(depth, id).toBeGreaterThanOrEqual(0);
      expect(flame, id).toBeGreaterThan(0);
      const frame = manifest.sprites[id]?.frames[0];
      if (frame === undefined) throw new Error(`${id} fehlt`);
      /** The sprite's footprint with its anchor at (x, y), as the occluder pass collects it from the frame's sprites. */
      const at = (x: number, y: number) =>
        scene((l) => {
          const list = new SpriteList();
          const d = new SpriteDesc();
          d.frame = frame;
          d.x = x;
          d.y = y;
          d.layer = 'objects';
          list.push(d);
          expect(sprites.collect(list, l), id).toBe(1);
        });
      const inside = at(60, 60);
      const reference = housingTop(inside.field, [60, 60 - depth], flame, inside.ring);
      // Each of them burns in its body in the frame (lighting_point.vert: `housingTop(ground point, base + height)`).
      expect(reference, `${id} ${depth}`).toBeGreaterThan(flame);
      for (const [x, y] of [
        [W + 60, 60],
        [W + 61, 61],
        [60, H + 60],
        [61, H + 61],
      ] as const) {
        const s = at(x, y);
        expect(housingTop(s.field, [x, y - depth], flame, s.ring), `${id} ${depth} ${x} ${y}`).toBe(reference);
        // Without the ring's decor (before M5-45): no housing beyond the frame.
        expect(housingTop(s.field, [x, y - depth], flame), `${id} ${x} ${y} vorher`).toBe(-1);
      }
    }
  });

  it('der Occluder-Pass zeichnet alle Standflächen des Frames in den Ring, die Shader lesen dort die Gehäuse', () => {
    const fake = createFakeGl();
    const r = new Renderer(fake.gl, { caps: { floatTargets: true, forcedRgba8: false, maxDrawBuffers: 8 }, sources: new ShaderSourceStore(SHADERS), errors: { report: () => undefined }, paletteHex: PALETTE_HEX });
    const pipeline = findLightPipeline(r.passes) ?? installLightPipeline(r.passes);
    // The sprites' footprints (SpriteOccluders.collect) stand in: one kiln body as a sprite of the frame would give it.
    (pipeline.occluder as unknown as { sprites: { bind(): void; collect(list: unknown, out: FootprintList): number } }).sprites = {
      bind: () => undefined,
      collect: (_list, out) => {
        out.rect(400, 40, 428, 52, 20, OCCLUDER_CLASS.decor);
        return 1;
      },
    };
    const run = pipeline.occluder.execute.bind(pipeline.occluder);
    let calls: { name: string; args: readonly unknown[] }[] = [];
    pipeline.occluder.execute = (ctx) => {
      const from = fake.calls.length;
      run(ctx);
      calls = fake.calls.slice(from);
    };
    const s = new RenderScene();
    s.beginFrame(1);
    s.atlas = sceneAtlas();
    s.sky.occluders.rect(-40, 0, 40, 6, STRUCTURAL_TOP_PX, OCCLUDER_CLASS.structural);
    const light = s.light.reset();
    light.x = 420;
    light.y = 47;
    light.radius = 64;
    s.lights.push(light);
    r.render(s, 640, 360, 'sharp');
    expect(pipeline.occluder.footprints.count).toBe(2);
    // Mask and ring: each draws both footprints (before, the ring drew the scene's first record only).
    expect(calls.filter((c) => c.name === 'drawArraysInstanced').map((c) => c.args[3])).toEqual([2, 2]);
    const ring = (SHADERS['sdf_ring.glsl'] ?? '').replace(/\s+/g, ' ');
    expect(ring).toContain('vec4 occluderWithDecorAt(sampler2D mask, vec2 world) { ivec2 t = sdfTexel(world); if (sdfInside(t)) return sdfOccluder(mask, t);');
    expect(ring).toContain('return vec4(m.r * DH_GBUFFER_HEIGHT_RANGE, step(0.5, m.g), m.b * DH_GBUFFER_HEIGHT_RANGE, m.a * DH_GBUFFER_HEIGHT_RANGE);');
    // occluderAt (rays, ground points) keeps decor 0 beyond the frame.
    expect(ring).toContain('return vec4(0.0, step(0.5, m.g), m.b * DH_GBUFFER_HEIGHT_RANGE, m.a * DH_GBUFFER_HEIGHT_RANGE);');
    const vert = (SHADERS['lighting_point.vert'] ?? '').replace(/\s+/g, ' ');
    expect(vert).toContain('vec4 m = occluderWithDecorAt(uMask, at);');
    expect(vert).toContain('vec4 n = occluderWithDecorAt(uMask, at + vec2(float(i), float(j)));');
    const glsl = (SHADERS['lighting.glsl'] ?? '').replace(/\s+/g, ' ');
    expect(glsl).toContain('vec4 m = occluderWithDecorAt(mask, to + dir * t);');
  });
});
