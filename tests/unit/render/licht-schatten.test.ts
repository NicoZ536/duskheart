/**
 * M5-05, M5-31, M5-34, M5-35: Schatten der Punkt- und Spotlichter (MASTERPROMPT §6.1 Pass 5 „weiche SDF-Schatten
 * (Sphere-Tracing mit Halbschatten)“) am CPU-Spiegel des Shaders (`lightMath.lightShadow`): Wände und geschlossene
 * Türen sperren jedes Licht (kein Schein durch Hauswände), Deko sperrt unter ihrer Oberkante, weich mit Halbschatten,
 * hart ohne; ein Occluder ist auf seiner Lichtseite hell; eine erhöhte Stufe sperrt ein tieferes Licht. Dazu das
 * Nahfeld der Flamme (der Stab einer stehenden Fackel wird nur von oben beleuchtet), das Gehäuse eines Lichts (Ofen,
 * Meiler) und die Lage eines Lichtkegels um seine Quelle (Bodenpunkt statt Flammenhöhe).
 */
import { describe, expect, it } from 'vitest';
import { lightFalloff } from '../../../src/engine/lightFalloff';
import { OccluderField, flameNearField, housingTop, lightHousing, lightShadow, nearStructural } from '../../../src/render/light/lightMath';
import { OCCLUDER_SHAPE, OccluderList } from '../../../src/render/light/occluders';
import { FLAME_NEAR_FIELD, LIGHT_HOUSING, OCCLUDER_CLASS, POINT_SHADOW, SDF, STRUCTURAL_TOP_PX } from '../../../src/render/light/params';
import { jumpFloodSteps } from '../../../src/render/passes/occluderPass';
import { SHADERS } from '../../../src/render/shaderLib';

const W = 128;
const H = 96;

/** A flooded field of `list` over [0, W) × [0, H). */
function field(build: (l: OccluderList) => void): OccluderField {
  const list = new OccluderList();
  build(list);
  const f = new OccluderField(0, 0, W, H);
  f.draw(list);
  f.flood(jumpFloodSteps(SDF.firstStepPx));
  return f;
}

/** Visibility of a light at `to` (height `zTo`) for a ground pixel at `from`. */
function vis(f: OccluderField, from: readonly [number, number], to: readonly [number, number], zTo = 8, soft = true, zFrom = 0): number {
  return lightShadow(f, from, zFrom, false, false, to, zTo, 0, -1, soft)[0];
}

describe('Punktlicht-Schatten: Wände (M5-34, M5-05)', () => {
  const house = field((l) => {
    // A wall band 6 px thick from x 40 to 90 at y 40–46 (the south wall of a room north of it).
    l.rect(40, 40, 90, 46, STRUCTURAL_TOP_PX, OCCLUDER_CLASS.structural);
  });

  it('eine Wand sperrt das Licht ganz – kein Schein auf der anderen Seite, auch nicht hoch', () => {
    const lamp: [number, number] = [65, 25];
    expect(vis(house, [65.5, 60.5], lamp)).toBe(0);
    expect(vis(house, [50.5, 70.5], lamp, 60)).toBe(0);
    // The structural visibility alone (the light map comparison's second channel) is 0 as well.
    expect(lightShadow(house, [65.5, 60.5], 0, false, false, lamp, 8, 0, -1, true)[1]).toBe(0);
    // On the light's side, and around the wall's end, the light arrives.
    expect(vis(house, [65.5, 30.5], lamp)).toBe(1);
    expect(vis(house, [110.5, 60.5], [110, 25])).toBe(1);
  });

  it('eine Wand wirft einen Halbschatten: weich zum Rand hin, hart ohne Halbschatten', () => {
    const lamp: [number, number] = [30, 25];
    // Past the wall's west end: the shadow edge runs from the light over the wall's corner (40, 40).
    const soft: number[] = [];
    const hard: number[] = [];
    for (let x = 30; x <= 60; x += 2) {
      soft.push(vis(house, [x + 0.5, 70.5], lamp, 8, true));
      hard.push(vis(house, [x + 0.5, 70.5], lamp, 8, false));
    }
    // Monotone from lit to dark across the edge, with values in between when soft, only 0/1 when hard.
    for (let i = 1; i < soft.length; i++) expect(soft[i] ?? 0).toBeLessThanOrEqual((soft[i - 1] ?? 0) + 1e-9);
    expect(soft[0]).toBe(1);
    expect(soft[soft.length - 1]).toBe(0);
    expect(soft.some((v) => v > 0.05 && v < 0.95)).toBe(true);
    for (const v of hard) expect(v === 0 || v === 1).toBe(true);
  });

  it('die Außenseite der Wand bekommt kein Licht aus dem Raum; die Innenseite ist hell', () => {
    const lamp: [number, number] = [65, 25];
    // A pixel of the wall's south face: its ground point is just south of the band; the band stands between it and
    // the light – it stays dark. A pixel on the band's north edge (the inner face) is lit.
    const outer = lightShadow(house, [65.5, 46.5], 10, true, false, lamp, 8, 0, -1, true);
    expect(outer[0]).toBe(0);
    const inner = lightShadow(house, [65.5, 39.5], 10, true, false, lamp, 8, 0, -1, true);
    expect(inner[0]).toBe(1);
  });
});

describe('Punktlicht-Schatten: Deko und Gelände (M5-05)', () => {
  const rock = field((l) => {
    // A rock 16 px across, 12 px high, centred at (64, 48).
    l.push(1, 64, 48, 8, 4, 12, OCCLUDER_CLASS.decor);
  });

  it('ein Fels wirft Schatten hinter sich, ein hoch hängendes Licht leuchtet über ihn hinweg', () => {
    const torch: [number, number] = [64, 20];
    expect(vis(rock, [64.5, 70.5], torch, 8)).toBe(0);
    expect(vis(rock, [64.5, 70.5], torch, 120)).toBe(1);
    expect(vis(rock, [30.5, 70.5], torch, 8)).toBe(1);
    // Decor shadows are the renderer's (gameplay ignores them, §12.1): the structural channel stays lit.
    expect(lightShadow(rock, [64.5, 70.5], 0, false, false, torch, 8, 0, -1, true)[1]).toBe(1);
  });

  it('der Fels selbst ist auf seiner Lichtseite hell (er verlässt erst seine eigene Standfläche)', () => {
    const torch: [number, number] = [64, 20];
    // A pixel of the rock's north face (occluder bit): its ground point lies in its own footprint.
    const lit = lightShadow(rock, [64.5, 45.5], 6, true, false, torch, 8, 0, -1, true);
    expect(lit[0]).toBeGreaterThan(0.9);
    // The same rock's south face, seen from a torch north of it, is dark: its ray crosses the whole footprint and
    // leaves the grace distance inside it.
    const dark = lightShadow(rock, [64.5, 51.5 + POINT_SHADOW.ownGracePx], 2, false, false, torch, 8, 0, -1, true);
    expect(dark[0]).toBe(0);
  });

  it('Stufe „Niedrig“ (nur Sonnenschatten): Deko wirft keinen Punktlicht-Schatten, Wände und Klippen sperren weiter', () => {
    const torch: [number, number] = [64, 20];
    expect(lightShadow(rock, [64.5, 70.5], 0, false, false, torch, 8, 0, -1, false, false)[0]).toBe(1);
    const wall = field((l) => l.rect(40, 40, 90, 46, STRUCTURAL_TOP_PX, OCCLUDER_CLASS.structural));
    expect(lightShadow(wall, [65.5, 60.5], 0, false, false, [65, 25], 8, 0, -1, false, false)[0]).toBe(0);
    const src = (SHADERS['lighting_point.frag'] ?? '').replace(/\s+/g, ' ');
    expect(src).toContain('vGeom.xy, zl, vBase, vHousing, uShadows == 2, uShadows > 0, uCompare == 1);');
  });

  it('eine erhöhte Stufe sperrt ein Licht darunter, ein Licht auf ihr erreicht den Grund unterhalb der Kante', () => {
    const plateau = field((l) => l.rect(0, 0, W, 40, 16, OCCLUDER_CLASS.terrain, true, 16));
    // Torch below the cliff (ground 0) → the plateau behind the face stays dark.
    expect(lightShadow(plateau, [60.5, 20.5], 16, false, false, [60, 60], 8, 0, -1, true)[0]).toBe(0);
    // Torch on the plateau (ground 16) lights the ground below the edge.
    expect(lightShadow(plateau, [60.5, 60.5], 0, false, false, [60, 20], 24, 16, -1, true)[0]).toBe(1);
  });
});

describe('Nahfeld der Flamme (M5-31: Stab der stehenden Fackel)', () => {
  it('was unter der Flamme steht, behält einen Teil des Lichts; daneben und am Boden volles Licht', () => {
    // Straight under the flame: the floor share.
    expect(flameNearField(0, true, 10)).toBeCloseTo(FLAME_NEAR_FIELD.floor, 12);
    // Beside the cone: full light; ground pixels and pixels above the flame are never damped.
    const radius = FLAME_NEAR_FIELD.radiusPx + 10 * FLAME_NEAR_FIELD.spread;
    expect(flameNearField(radius + 0.01, true, 10)).toBe(1);
    expect(flameNearField(0, false, 10)).toBe(1);
    expect(flameNearField(0, true, -3)).toBe(1);
    // The cone widens with the drop: a figure beside a carried torch is outside it.
    expect(flameNearField(4, true, 4)).toBe(1);
    const src = (SHADERS['lighting.glsl'] ?? '').replace(/\s+/g, ' ');
    expect(src).toContain('float radius = DH_FLAME_NEAR_RADIUS + drop * DH_FLAME_NEAR_SPREAD;');
    expect(src).toContain('return mix(DH_FLAME_NEAR_FLOOR, 1.0, smoothstep(0.5 * radius, radius, horizontal));');
  });
});

describe('Gehäuse eines Lichts (M5-35: Ofen, Meiler, Schmelzofen)', () => {
  const kiln = field((l) => {
    // A kiln's body: a footprint 28 × 12 px, 20 px high, at (50…78, 40…52); its fire burns inside.
    l.rect(50, 40, 78, 52, 20, OCCLUDER_CLASS.decor);
  });
  const fire: [number, number] = [64, 47];

  it('das Feuer brennt im Körper: dessen Oberkante wird erkannt, seine Strahlen gehen durch ihn hindurch', () => {
    const top = housingTop(kiln, fire);
    expect(top).toBeGreaterThan(19);
    // Ground around the kiln is lit all round (the fire shines out of its openings) …
    for (const p of [
      [64.5, 70.5],
      [30.5, 46.5],
      [100.5, 46.5],
      [64.5, 20.5],
    ] as const) {
      expect(lightShadow(kiln, p, 0, false, false, fire, 6, 0, top, true)[0], `${p}`).toBe(1);
    }
    // … while without the housing rule the body would block its own fire.
    expect(lightShadow(kiln, [30.5, 46.5], 0, false, false, fire, 6, 0, -1, true)[0]).toBe(0);
  });

  it('der Körper selbst ist Gehäuse, ein anderer Occluder daneben nicht', () => {
    // A pixel of the kiln's front: drawn 10 px above its ground point (64, 51).
    expect(lightHousing(kiln, [64.5, 41.5], [64.5, 51.5], false, fire)).toBe(true);
    // A stone 20 px east of the kiln: its column does not reach the fire through footprint texels.
    const two = field((l) => {
      l.rect(50, 40, 78, 52, 20, OCCLUDER_CLASS.decor);
      l.rect(90, 44, 96, 50, 8, OCCLUDER_CLASS.decor);
    });
    expect(lightHousing(two, [93.5, 42.5], [93.5, 49.5], false, fire)).toBe(false);
    const glsl = (SHADERS['lighting_point.frag'] ?? '').replace(/\s+/g, ' ');
    expect(glsl).toContain('if (own && upright && vHousing >= 0.0 && lightHousing(uMask, screen, ground, capped, vGeom.xy)) f *= DH_HOUSING_FLOOR;');
  });

  it('das Herdfeuer brennt am Rand seines Rings: der Ring wirft keinen Schatten seines eigenen Feuers (Süden hell)', () => {
    // The hearth: a ring ellipse 42 × 18 px whose sprite reaches 36 px high (flames included); its fire burns at the
    // middle of the 3 × 3 tiles, one pixel north of the ellipse, 14 px above the ground.
    const ring = field((l) => l.push(OCCLUDER_SHAPE.ellipse, 64, 44, 21, 9, 36, OCCLUDER_CLASS.decor));
    const fire: [number, number] = [64, 34];
    const flame = 14;
    expect(housingTop(ring, fire)).toBe(-1);
    const top = housingTop(ring, fire, flame);
    expect(top).toBeGreaterThan(flame);
    // South of the ring, the whole pool is lit (before: the ring's 36 px blocked every ray from the south).
    for (const p of [
      [64.5, 70.5],
      [40.5, 80.5],
      [96.5, 66.5],
    ] as const) {
      expect(lightShadow(ring, p, 0, false, false, fire, flame, 0, -1, true)[0], `ohne Gehäuse ${p}`).toBe(0);
      expect(lightShadow(ring, p, 0, false, false, fire, flame, 0, top, true)[0], `${p}`).toBe(1);
    }
    // Only a footprint rising above the flame, and only within LIGHT_HOUSING.edgePx: a low stone beside a torch, a
    // trunk a few pixels away keep their shadows.
    const stone = field((l) => l.rect(66, 30, 72, 38, 8, OCCLUDER_CLASS.decor));
    expect(housingTop(stone, fire, flame)).toBe(-1);
    const trunk = field((l) => l.rect(64 + LIGHT_HOUSING.edgePx + 1, 30, 72, 38, 60, OCCLUDER_CLASS.decor));
    expect(housingTop(trunk, fire, flame)).toBe(-1);
    const vert = (SHADERS['lighting_point.vert'] ?? '').replace(/\s+/g, ' ');
    expect(vert).toContain('vHousing = uHasMask == 1 ? housingTop(aGeom.xy, base + aGeom.z) : -1.0;');
    expect(vert).toContain('if (d < nearest && n.x > n.z + DH_SDF_SEED_EPSILON && n.x > flame) {');
  });
});

describe('Lage des Lichtkegels um die Quelle (M5-34)', () => {
  it('der Kegel liegt um den Bodenpunkt der Quelle, nicht um die Flammenhöhe nach Norden verschoben', () => {
    // The shader's geometry: a ground pixel at (x, y) is lit by a light at footprint (lx, ly), height h, with the
    // falloff of the 3D distance – symmetric about the footprint in x and y.
    const lx = 100;
    const ly = 100;
    const h = 20;
    const r = 96;
    const at = (x: number, y: number): number => lightFalloff(Math.hypot(lx - x, ly - y, h), r);
    for (const d of [8, 24, 48]) {
      expect(at(lx, ly - d)).toBeCloseTo(at(lx, ly + d), 12);
      expect(at(lx - d, ly)).toBeCloseTo(at(lx + d, ly), 12);
    }
    // The brightest ground pixel is the footprint itself.
    expect(at(lx, ly)).toBeGreaterThan(at(lx, ly - 4));
    const frag = (SHADERS['lighting_point.frag'] ?? '').replace(/\s+/g, ' ');
    // Pixels are placed at their ground point (screen point moved south by their height above their ground), the light
    // at its footprint on the ground under it: both in the same plane.
    expect(frag).toContain('vec2 ground = uHasMask == 1 ? sdfGroundPoint(uMask, screen, z) : vec2(screen.x, screen.y + z);');
    expect(frag).toContain('vec3 toLight = vec3(vGeom.x - ground.x, vGeom.y - ground.y, zl - z);');
  });
});

describe('Lichtkarten-Abgleich: wo Gameplay und Renderer nicht vergleichbar sind (M5-28)', () => {
  it('innerhalb einer Kachel einer Wand oder einer Klippe, die das Licht nicht überblickt, sonst vergleichbar', () => {
    const f = field((l) => {
      l.rect(40, 40, 90, 46, STRUCTURAL_TOP_PX, OCCLUDER_CLASS.structural);
      l.rect(0, 80, W, H, 16, OCCLUDER_CLASS.terrain, true, 16);
    });
    expect(nearStructural(f, [60.5, 50.5], 0)).toBe(true);
    expect(nearStructural(f, [60.5, 20.5], 0)).toBe(false);
    // The plateau's rim blocks a light standing below it, not one standing on it.
    expect(nearStructural(f, [60.5, 72.5], 0)).toBe(true);
    expect(nearStructural(f, [60.5, 72.5], 16)).toBe(false);
  });

  it('auch hinter näherer Deko: ein Schrank vor der Wand verdeckt sie im Distanzfeld, nicht für den Abgleich', () => {
    // A wall 10 px north of the receiver, a cupboard 3 px beside it: the distance field's nearest occluder is the
    // cupboard – the probes along eight directions still find the wall within a tile.
    const f = field((l) => {
      l.rect(20, 30, 100, 36, STRUCTURAL_TOP_PX, OCCLUDER_CLASS.structural);
      l.rect(63, 44, 75, 54, 20, OCCLUDER_CLASS.decor);
    });
    const p: [number, number] = [60.5, 46.5];
    const [i, j] = f.texel(p[0], p[1]);
    expect(f.infoAt(i, j).structural).toBe(false);
    expect(nearStructural(f, p, 0)).toBe(true);
    // Farther than a tile from the wall: comparable, cupboard or not.
    expect(nearStructural(f, [60.5, 60.5], 0)).toBe(false);
    const glsl = (SHADERS['lighting.glsl'] ?? '').replace(/\s+/g, ' ');
    expect(glsl).toContain('for (float r = DH_LM_PROBE; r < DH_LM_NEAR + 0.5; r += DH_LM_PROBE) {');
    const frag = (SHADERS['lighting_point.frag'] ?? '').replace(/\s+/g, ' ');
    expect(frag).toContain('if (uCompare == 1) { unsure = 4.0 * vis.y * (1.0 - vis.y) + (nearStructural(uDistance, uInfo, uMask, ground, vBase) ? 1.0 : 0.0);');
  });

  it('Deko vor einer Wand: das Bild ist dunkel, und hinter der Wand bleibt es auch ohne die Deko dunkel', () => {
    // A bush (decor, 20 px high) outside a room's west wall, a receiver west of the bush, the fire in the room. The
    // receiver's ray meets the bush first – the wall further on still decides what the gameplay map sees: the light
    // the comparison adds back for the decor (visibility behind the structural occluders alone) must be none.
    const room = field((l) => {
      l.rect(40, 10, 46, 90, STRUCTURAL_TOP_PX, OCCLUDER_CLASS.structural);
      l.rect(26, 44, 34, 56, 20, OCCLUDER_CLASS.decor);
    });
    const fire: [number, number] = [90, 50];
    expect(lightShadow(room, [20.5, 50.5], 0, false, false, fire, 12, 0, -1, true)).toEqual([0, 0]);
    expect(lightShadow(room, [20.5, 50.5], 0, false, false, fire, 12, 0, -1, false)).toEqual([0, 0]);
    // Without the wall only the bush's shadow: the map sees the light there.
    const open = field((l) => l.rect(26, 44, 34, 56, 20, OCCLUDER_CLASS.decor));
    expect(lightShadow(open, [20.5, 50.5], 0, false, false, fire, 12, 0, -1, true)).toEqual([0, 1]);
    // Outside the comparison's frames the march ends at the bush (the structural share is not needed there).
    expect(lightShadow(room, [20.5, 50.5], 0, false, false, fire, 12, 0, -1, true, true, false)[0]).toBe(0);
    const glsl = (SHADERS['lighting.glsl'] ?? '').replace(/\s+/g, ' ');
    expect(glsl).toContain('if (structural || !bookkeeping) { if (structural) resStructural = 0.0; break; }');
    expect(glsl).toContain('t += DH_PS_MIN_STEP; continue; }');
  });
});
