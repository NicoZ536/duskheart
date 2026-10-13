/**
 * Fackelschein über einer Klippenkante (M7-146; MASTERPROMPT §6.1 Pass 5, §12.1; src/render/shaders/lighting.glsl
 * `lightShadow`, CPU-Spiegel src/render/light/lightMath.ts): eine erhöhte Stufe sperrt ein tieferes Licht (die Regel der
 * Gameplay-Lichtkarte) – aber ihre ersten `POINT_SHADOW.rimPx` Pixel hinter der Kante bekommen einen Anteil, der nach innen
 * auf nichts ausläuft, skaliert mit der Flammenhöhe über der Stufe. So läuft der Schein weich über die Kante, statt dass die
 * beleuchteten Klippenwände als harte Rechtecke vor der dunklen Stufe stehen. Die Wand darunter (G-Buffer-Bit `wall`,
 * `faceLight` im Punktlichtpass) blendet in ihren obersten `POINT_SHADOW.faceFadePx` Pixeln auf denselben Anteil ab, so
 * treffen Wand und Rand sich an der Kante (eine dem Licht zugewandte Wand nimmt bis zum 1,7-fachen des Bodenlichts). Weiter hinten bleibt die Stufe dunkel, eine Wand auf der Stufe
 * sperrt, und der Streifen liegt in der Reichweite, in der der Lichtkarten-Abgleich ohnehin nicht vergleicht.
 */
import { describe, expect, it } from 'vitest';
import { faceLight, OccluderField, lightShadow, nearStructural } from '../../../src/render/light/lightMath';
import { OccluderList } from '../../../src/render/light/occluders';
import { LIGHTMAP_COMPARISON, OCCLUDER_CLASS, POINT_SHADOW, SDF, STRUCTURAL_TOP_PX } from '../../../src/render/light/params';
import { jumpFloodSteps } from '../../../src/render/passes/occluderPass';
import { GBUFFER_MASK } from '../../../src/render/gbuffer';
import { SHADERS } from '../../../src/render/shaderLib';

const W = 128;
const H = 112;
/** The plateau: level 1 (16 px) north of y = 40; its cliff face on the tile row below the edge (y 40–56, ground 0). */
const EDGE = 40;
const FACE = 16;
const TOP = 16;

/** A flooded field: the plateau, its face, and `more`. */
function field(more: (l: OccluderList) => void = () => undefined): OccluderField {
  const list = new OccluderList();
  list.rect(0, 0, W, EDGE, TOP, OCCLUDER_CLASS.terrain, true, TOP);
  list.rect(0, EDGE, W, EDGE + FACE, TOP, OCCLUDER_CLASS.terrain, true, 0);
  more(list);
  const f = new OccluderField(0, 0, W, H);
  f.draw(list);
  f.flood(jumpFloodSteps(SDF.firstStepPx));
  return f;
}

/** A torch south of the face on level 0, its flame `zTo` px high: the visibility of plateau pixel (60.5, y). */
function plateau(f: OccluderField, y: number, zTo: number): number {
  return lightShadow(f, [60.5, y], TOP, false, false, [60, EDGE + FACE + 24], zTo, 0, -1, true)[0];
}

describe('Fackelschein über der Klippenkante (M7-146)', () => {
  it('die ersten Pixel hinter der Kante bekommen einen Anteil, der nach innen ausläuft; weiter hinten bleibt die Stufe dunkel', () => {
    const f = field();
    // A staked torch (19 px): above the plateau's top – the full share at the edge.
    const at = (d: number): number => plateau(f, EDGE - d, 19);
    expect(at(0.5)).toBeGreaterThan(0.85);
    // Falling off monotonically into the level …
    let last = Infinity;
    for (let d = 0.5; d <= POINT_SHADOW.rimPx; d += 1) {
      const v = at(d);
      expect(v, `${d}`).toBeLessThanOrEqual(last + 1e-9);
      last = v;
    }
    expect(at(POINT_SHADOW.rimPx / 2)).toBeGreaterThan(0.2);
    expect(at(POINT_SHADOW.rimPx / 2)).toBeLessThan(0.8);
    // … and dark beyond the rim (the gameplay light map's rule: the level blocks a light standing lower).
    expect(at(POINT_SHADOW.rimPx + 1)).toBe(0);
    expect(at(20)).toBe(0);
  });

  it('der Anteil folgt der Flammenhöhe über der Stufe: Lagerfeuer kaum, Handfackel etwa halb, gesteckte Fackel ganz', () => {
    const f = field();
    const edge = (zTo: number): number => plateau(f, EDGE - 0.5, zTo);
    expect(edge(TOP - POINT_SHADOW.rimBelowPx)).toBe(0);
    const fire = edge(10);
    const hand = edge(14);
    const staked = edge(19);
    expect(fire).toBeLessThan(0.25);
    expect(hand).toBeGreaterThan(0.3);
    expect(hand).toBeLessThan(0.7);
    expect(staked).toBeGreaterThan(0.85);
    expect(fire).toBeLessThan(hand);
    expect(hand).toBeLessThan(staked);
  });

  it('die Wand unter der Kante (faceLight): unten voll, zur Oberkante hin auf den Anteil des Rands; eine gesteckte Fackel lässt sie ganz', () => {
    const f = field();
    const edge = plateau(f, EDGE - 0.5, 14);
    // Up to faceFadePx under the top the wall takes the light whole (the hand torch, 14 px).
    for (let z = 0; z <= TOP - POINT_SHADOW.faceFadePx; z += 2) expect(faceLight(TOP, z, 14), `${z}`).toBe(1);
    // Then falling towards its top row, monotonically, to the rim's share – the rim's first pixel.
    let last = Infinity;
    for (let z = TOP - POINT_SHADOW.faceFadePx; z <= TOP; z += 0.5) {
      const v = faceLight(TOP, z, 14);
      expect(v, `${z}`).toBeLessThanOrEqual(last + 1e-9);
      last = v;
    }
    expect(faceLight(TOP, TOP, 14)).toBeLessThan(0.75);
    expect(Math.abs(faceLight(TOP, TOP, 14) - edge)).toBeLessThan(0.05);
    // A flame above the level's top leaves the wall whole, a camp fire far under it darkens its top more.
    expect(faceLight(TOP, TOP, 19)).toBeGreaterThan(0.9);
    expect(faceLight(TOP, TOP, 10)).toBeLessThan(faceLight(TOP, TOP, 14));
    // Higher levels: the same relative to their top.
    expect(faceLight(2 * TOP, 2 * TOP - 1, 14)).toBe(faceLight(TOP, TOP - 1, 14 - TOP));
  });

  it('die Wandpixel tragen ihr Bit im G-Buffer (Klippenwand, kein Wasserfall), der Punktlichtpass blendet nur sie ab', () => {
    const bits = Object.values(GBUFFER_MASK);
    expect(new Set(bits).size).toBe(bits.length);
    expect(GBUFFER_MASK.wall).toBeLessThan(256);
    const terrain = (SHADERS['world/terrain.frag'] ?? '').replace(/\s+/g, ' ');
    expect(terrain).toContain('if (kind == KIND_WALL) mask |= DH_MASK_WALL;');
    const point = (SHADERS['lighting_point.frag'] ?? '').replace(/\s+/g, ' ');
    expect(point).toContain('if (uHasMask == 1 && gbufferHasMask(texelFetch(uSurface, p, 0), DH_MASK_WALL)) vis *= faceLight(occluderAt(uMask, screen).z, z, zl);');
  });

  it('eine Wand auf der Stufe sperrt weiter; ein Licht auf der Stufe beleuchtet sie wie bisher; der Grund unten bleibt unberührt', () => {
    // A wall band along the rim (y 34–38): the pixels behind it stay dark.
    const walled = field((l) => l.rect(0, 34, W, 38, STRUCTURAL_TOP_PX, OCCLUDER_CLASS.structural));
    expect(plateau(walled, 30.5, 19)).toBe(0);
    // A light standing on the plateau (ground 16) lights its top fully.
    const f = field();
    expect(lightShadow(f, [60.5, 20.5], TOP, false, false, [60, 10], 32, TOP, -1, true)[0]).toBe(1);
    // The ground below the face, in front of the torch: fully lit.
    expect(lightShadow(f, [60.5, EDGE + FACE + 8.5], 0, false, false, [60, EDGE + FACE + 24], 19, 0, -1, true)[0]).toBe(1);
  });

  it('der Streifen liegt in der Reichweite, in der der Lichtkarten-Abgleich nicht vergleicht', () => {
    expect(POINT_SHADOW.rimPx).toBeLessThanOrEqual(LIGHTMAP_COMPARISON.nearStructuralPx);
    const f = field();
    for (let d = 0.5; d <= POINT_SHADOW.rimPx; d += 2) expect(nearStructural(f, [60.5, EDGE - d], 0), `${d}`).toBe(true);
  });

  it('der Shader hat denselben Schritt wie der CPU-Spiegel', () => {
    const glsl = (SHADERS['lighting.glsl'] ?? '').replace(/\s+/g, ' ');
    expect(glsl).toContain('bool rim = !inside && start.z > base + DH_PS_HEIGHT_EPSILON && start.w + DH_PS_HEIGHT_EPSILON >= start.z;');
    expect(glsl).toContain('float rimShare = rim ? smoothstep(start.z - DH_PS_RIM_BELOW, start.z + DH_PS_RIM_ABOVE, zTo) : 1.0;');
    expect(glsl).toContain('rimShare = min(rimShare, 1.0 - smoothstep(0.0, DH_PS_RIM, t));');
    expect(glsl).toContain('return vec2(smoothstep(0.0, 1.0, res), smoothstep(0.0, 1.0, resStructural)) * rimShare;');
    expect(glsl).toContain('float rimShare = smoothstep(top - DH_PS_RIM_BELOW, top + DH_PS_RIM_ABOVE, zTo); return 1.0 - (1.0 - rimShare) * smoothstep(top - DH_PS_FACE_FADE, top, z);');
  });
});
