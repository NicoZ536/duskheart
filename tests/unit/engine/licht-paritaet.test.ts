/**
 * M6-16f Parität des kanonischen Lichtmodells (src/engine/lightFalloff.ts) mit dem Shader (lighting_point.frag, der je Pixel
 * `lightFalloff(length(toLight), r)` und `dot(away / len, achse)` rechnet): Abstand und Kegelkosinus der Spiel-Lichtkarte
 * sind die √-Form des Shaders – `length(v)` = √(v·v), in der Reihenfolge x² + y² + z² summiert –, nicht `Math.hypot`
 * (das rundet anders und legt je Aufruf seine Argumentliste an). Geprüft wird:
 * - der Shader rechnet weiterhin mit `length(toLight)` und `dot(away / len, vCone.xy)` (eine Änderung dort fällt hier auf);
 * - `lightDistance` ist bitgleich mit dem Spiegel der Shader-Anweisungen, `coneCosine` gleich bis auf eine Rundung
 *   (der Shader teilt vor dem Skalarprodukt), der Kegel-Epsilon ist derselbe Wert;
 * - `Math.hypot` wäre es nicht: es weicht an Stichproben in der letzten Stelle ab.
 */
import { describe, expect, it } from 'vitest';
import { coneCosine, LIGHT_CONE_EPSILON, lightDistance } from '../../../src/engine/lightFalloff';
import { Rng } from '../../../src/engine/rng';
import { lightingDefines } from '../../../src/render/light/falloff';
import { SHADERS } from '../../../src/render/shaderLib';

const FRAG = SHADERS['lighting_point.frag'] ?? '';

/** GLSL `length(vec3(x, y, z))` = √(dot(v, v)), summed x·x + y·y + z·z. */
function glslLength3(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

/** The shader's cone statement: `len = length(away); len < ε ? 1 : dot(away / len, (cos, sin))`. */
function glslConeCosine(ax: number, ay: number, axis: number): number {
  const len = Math.sqrt(ax * ax + ay * ay);
  if (len < LIGHT_CONE_EPSILON) return 1;
  return (ax / len) * Math.cos(axis) + (ay / len) * Math.sin(axis);
}

/** A light offset and a point of a lit scene: within a few hundred px, heights of a flame above the ground. */
function sample(rng: Rng): { light: { x: number; y: number; height: number }; x: number; y: number; z: number } {
  const x = rng.float(-4000, 4000);
  const y = rng.float(-4000, 4000);
  return { light: { x: x + rng.float(-300, 300), y: y + rng.float(-300, 300), height: rng.float(0, 40) }, x, y, z: rng.int(0, 3) === 0 ? 0 : rng.float(0, 24) };
}

describe('Lichtmodell = Shader (√-Form, M6-16f)', () => {
  it('der Shader rechnet Abstand und Kegel mit length() und dot(away / len, Achse)', () => {
    expect(FRAG).toContain('float f = lightFalloff(length(toLight), vGeom.w);');
    expect(FRAG).toContain('vec3 toLight = vec3(vGeom.x - ground.x, vGeom.y - ground.y, zl - z);');
    expect(FRAG).toContain('vec2 away = -toLight.xy;');
    expect(FRAG).toContain('float len = length(away);');
    expect(FRAG).toContain('float cosAngle = len < DH_LIGHT_CONE_EPSILON ? 1.0 : dot(away / len, vCone.xy);');
    // The same epsilon on both sides.
    expect(Number(lightingDefines()['DH_LIGHT_CONE_EPSILON'])).toBe(LIGHT_CONE_EPSILON);
  });

  it('lightDistance ist bitgleich mit length(toLight) des Shaders', () => {
    const rng = new Rng(16);
    for (let i = 0; i < 20_000; i++) {
      const s = sample(rng);
      const glsl = glslLength3(s.light.x - s.x, s.light.y - s.y, s.light.height - s.z);
      expect(Object.is(lightDistance(s.light, s.x, s.y, s.z), glsl), `Stichprobe ${i}`).toBe(true);
    }
    expect(lightDistance({ x: 0, y: 0, height: 0 }, 0, 0, 0)).toBe(0);
  });

  it('Math.hypot ist nicht die Form des Shaders: es weicht in der letzten Stelle ab', () => {
    const rng = new Rng(17);
    let differs = 0;
    for (let i = 0; i < 20_000; i++) {
      const s = sample(rng);
      if (!Object.is(Math.hypot(s.light.x - s.x, s.light.y - s.y, s.light.height - s.z), glslLength3(s.light.x - s.x, s.light.y - s.y, s.light.height - s.z))) differs++;
    }
    expect(differs).toBeGreaterThan(0);
  });

  it('coneCosine gleicht dot(away / len, Achse) bis auf eine Rundung; unter ε ist beides 1', () => {
    const rng = new Rng(18);
    for (let i = 0; i < 20_000; i++) {
      const s = sample(rng);
      const axis = rng.float(-Math.PI, Math.PI);
      const ax = s.x - s.light.x;
      const ay = s.y - s.light.y;
      const ours = coneCosine(ax, ay, axis);
      expect(Math.abs(ours - glslConeCosine(ax, ay, axis)), `Stichprobe ${i}`).toBeLessThanOrEqual(4 * Number.EPSILON);
      expect(Math.abs(ours)).toBeLessThanOrEqual(1 + 4 * Number.EPSILON);
    }
    for (const [ax, ay] of [
      [0, 0],
      [LIGHT_CONE_EPSILON / 2, 0],
      [0, -LIGHT_CONE_EPSILON / 3],
    ] as const) {
      expect(coneCosine(ax, ay, 1.3)).toBe(1);
      expect(glslConeCosine(ax, ay, 1.3)).toBe(1);
    }
  });
});
