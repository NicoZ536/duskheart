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
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { LIGHT_KINDS } from '../../../src/content/lights';
import { STATION_LIGHT_RADIUS_MAX } from '../../../src/content/stations';
import { GBUFFER_HEIGHT_RANGE_PX } from '../../../src/render/gbuffer';
import { lightShadow, OccluderField, OccluderRing, occluderAt, raySurvives } from '../../../src/render/light/lightMath';
import { OccluderList } from '../../../src/render/light/occluders';
import { OCCLUDER_CLASS, OCCLUDER_RING, POINT_SHADOW, ROOF_MARK, SDF, STRUCTURAL_TOP_PX } from '../../../src/render/light/params';
import { jumpFloodSteps, ringSize } from '../../../src/render/passes/occluderPass';
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
