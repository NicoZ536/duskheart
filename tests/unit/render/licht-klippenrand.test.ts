/**
 * Fackelschein über einer Klippenkante (M7-146; MASTERPROMPT §6.1 Pass 5, §12.1; src/render/shaders/lighting.glsl
 * `lightShadow`, CPU-Spiegel src/render/light/lightMath.ts): eine erhöhte Stufe sperrt ein tieferes Licht (die Regel der
 * Gameplay-Lichtkarte) – aber ihre ersten `POINT_SHADOW.rimPx` Pixel hinter der Kante bekommen einen Anteil, der nach innen
 * auf nichts ausläuft, skaliert mit der Flammenhöhe über der Stufe. So läuft der Schein weich über die Kante, statt dass die
 * beleuchteten Klippenwände als harte Rechtecke vor der dunklen Stufe stehen. Weiter hinten bleibt die Stufe dunkel, eine
 * Wand auf der Stufe sperrt, und der Streifen liegt in der Reichweite, in der der Lichtkarten-Abgleich ohnehin nicht
 * vergleicht.
 */
import { describe, expect, it } from 'vitest';
import { OccluderField, lightShadow, nearStructural } from '../../../src/render/light/lightMath';
import { OccluderList } from '../../../src/render/light/occluders';
import { LIGHTMAP_COMPARISON, OCCLUDER_CLASS, POINT_SHADOW, SDF, STRUCTURAL_TOP_PX } from '../../../src/render/light/params';
import { jumpFloodSteps } from '../../../src/render/passes/occluderPass';
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
  });
});
