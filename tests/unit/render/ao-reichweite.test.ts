/**
 * M5-61: die SDF-Umgebungsverdeckung (MASTERPROMPT §6.1 Pass 5 „Umgebungslicht × SDF-AO“) reicht so weit, wie ihr Werfer
 * groß ist. Vorher legte sie um jeden Occluder 10 px dunklen Hof – um einen kleinen Felsen (12 px breit) etwa die
 * doppelte Grundfläche (`tilemap`, `palette`). Jetzt: Deko verdeckt am Fuß voll (`SDF_AO.decorContactPx`) und blendet
 * über `SDF_AO.decorReachPerHeight` px je px ihrer Höhe über ihrem Boden aus (höchstens `radiusPx`); Wände, Türen und
 * Klippen behalten den ganzen Radius. Geprüft am CPU-Spiegel (`sdfOcclusion`, `aoReach`) und an den Felsen des
 * Spiel-Atlas: Standfläche samt Hof höchstens eine Kachel breit.
 */
import { describe, expect, it } from 'vitest';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { aoReach, OccluderField, sdfOcclusion, smoothstep } from '../../../src/render/light/lightMath';
import { OCCLUDER_SHAPE, OccluderList, shadowlessDecor, spriteTop } from '../../../src/render/light/occluders';
import { OCCLUDER_CLASS, SDF, SDF_AO, STRUCTURAL_TOP_PX } from '../../../src/render/light/params';
import { jumpFloodSteps } from '../../../src/render/passes/occluderPass';
import { SHADERS } from '../../../src/render/shaderLib';
import { TILE_PX } from '../../../src/world/model/coords';

function field(build: (l: OccluderList) => void): OccluderField {
  const list = new OccluderList();
  build(list);
  const f = new OccluderField(0, 0, 128, 96);
  f.draw(list);
  f.flood(jumpFloodSteps(SDF.firstStepPx));
  return f;
}

/** Ground pixels of row `y` (centres) whose ambient is darkened: [first, last] x, or null. */
function darkSpan(f: OccluderField, y: number): [number, number] | null {
  let first = -1;
  let last = -1;
  for (let x = 0; x < 128; x++) {
    const occluded = f.maskAt(x, Math.floor(y)).decor > 0;
    if (!occluded && sdfOcclusion(f, [x + 0.5, y], 0) < 1) {
      if (first < 0) first = x;
      last = x;
    }
  }
  return first < 0 ? null : [first, last];
}

describe('AO-Reichweite nach Werfergröße (M5-61)', () => {
  it('Deko: voll am Fuß, dann nach ihrer Höhe ausgeblendet; Wände und Klippen über den ganzen Radius', () => {
    expect(aoReach(false, 99)).toEqual({ from: 0, end: SDF_AO.radiusPx });
    expect(aoReach(true, 0)).toEqual({ from: SDF_AO.decorContactPx, end: SDF_AO.decorContactPx });
    // A small rock (11 px), a large one (21 px), a tree trunk (75 px): the reach grows with the caster, capped.
    const small = aoReach(true, 11).end;
    const large = aoReach(true, 21).end;
    const trunk = aoReach(true, 75).end;
    expect(small).toBeLessThanOrEqual(2);
    expect(large).toBeGreaterThan(small);
    expect(large).toBeLessThan(4);
    expect(trunk).toBeGreaterThan(large);
    expect(trunk).toBeLessThanOrEqual(SDF_AO.radiusPx);
    expect(aoReach(true, 500).end).toBe(SDF_AO.radiusPx);
  });

  it('ein kleiner Fels: Standfläche samt Hof höchstens eine Kachel breit, am Fuß so dunkel wie zuvor', () => {
    // The small rock of the game's atlas: an ellipse 6 × 2.5 px, 9 … 11 px high.
    const rock = field((l) => l.push(OCCLUDER_SHAPE.ellipse, 64, 48, 6, 2.5, 11, OCCLUDER_CLASS.decor));
    const span = darkSpan(rock, 48.5);
    expect(span).not.toBeNull();
    const [a, b] = span ?? [0, 0];
    expect(b - a + 1).toBeLessThanOrEqual(TILE_PX);
    // Right at its foot (a pixel south of the ellipse) the full contact shadow, as before.
    const foot = sdfOcclusion(rock, [64.5, 50.5], 0);
    expect(foot).toBeCloseTo(1 - SDF_AO.strength, 6);
    // Beyond its reach nothing – before, the halo went on to 10 px.
    expect(sdfOcclusion(rock, [64.5, 48 + 2.5 + 3.5], 0)).toBe(1);
    expect(sdfOcclusion(rock, [64.5 + 6 + 3.5, 48.5], 0)).toBe(1);
  });

  it('eine Wand dunkelt wie bisher über den ganzen Radius, ein Baumstamm weiter als ein Fels', () => {
    const wall = field((l) => l.rect(60, 20, 64, 76, STRUCTURAL_TOP_PX, OCCLUDER_CLASS.structural));
    for (const d of [1, 3, 6, 9]) {
      const v = sdfOcclusion(wall, [64 + d - 0.5, 48.5], 0);
      expect(v, `${d}`).toBeCloseTo(1 - SDF_AO.strength * (1 - smoothstep(0, SDF_AO.radiusPx, wall.distanceAt(64 + d - 1, 48))), 9);
      expect(v).toBeLessThan(1);
    }
    const trunk = field((l) => l.push(OCCLUDER_SHAPE.ellipse, 64, 48, 4, 2, 75, OCCLUDER_CLASS.decor));
    const rock = field((l) => l.push(OCCLUDER_SHAPE.ellipse, 64, 48, 4, 2, 11, OCCLUDER_CLASS.decor));
    expect(sdfOcclusion(trunk, [64.5 + 4 + 4, 48.5], 0)).toBeLessThan(1);
    expect(sdfOcclusion(rock, [64.5 + 4 + 4, 48.5], 0)).toBe(1);
  });

  it('die Felsen des Spiel-Atlas: jeder kleine Fels mit Hof höchstens eine Kachel breit', () => {
    const mod = generatedAtlasModule();
    if (mod === null) return;
    const m = manifestFromGenerated(mod);
    const rocks = Object.values(m.sprites).filter((s) => s.id.startsWith('fels_klein') && shadowlessDecor(s) === null);
    expect(rocks.length).toBeGreaterThanOrEqual(5);
    for (const r of rocks) {
      const o = r.occluder;
      if (o === undefined || o.kind !== 'ellipse') throw new Error(`${r.id}: Ellipse erwartet`);
      expect(2 * o.rx + 2 * aoReach(true, spriteTop(r)).end, r.id).toBeLessThanOrEqual(TILE_PX);
    }
  });

  it('der Shader rechnet dieselbe Reichweite', () => {
    const src = (SHADERS['shadow.glsl'] ?? '').replace(/\s+/g, ' ');
    expect(src).toContain('bool decor = occ.y < 0.5 && occ.x > occ.z + DH_SDF_SEED_EPSILON;');
    expect(src).toContain('float from = decor ? DH_AO_DECOR_CONTACT : 0.0;');
    expect(src).toContain('float end = decor ? min(DH_AO_RADIUS, from + DH_AO_DECOR_PER_HEIGHT * max(0.0, occ.x - occ.w)) : DH_AO_RADIUS;');
    expect(src).toContain('if (d >= max(end, from)) return 1.0;');
    expect(src).toContain('float near = d <= from ? 1.0 : 1.0 - smoothstep(from, end, d);');
  });
});
