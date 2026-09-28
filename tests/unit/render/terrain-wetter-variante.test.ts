/**
 * The terrain shader in two variants (ADR „M5-Integration: Frame-Pfad und E2E“, src/render/world/terrainPass.ts): the pass
 * compiles `world/terrain.frag` with `DH_SURFACE_WEATHER` (settling snow, wet patches, puddles) and without it, and draws
 * the weather variant only while snowfall, wetness or puddle fill is above 0. Without the define the shader loses exactly
 * the code that changes no pixel while all three are 0 – guarded here by the shape of the two `#ifdef` regions: one `if`
 * on `cover > 0.0` and one `else if` whose branches need `fill > 0.0` or `wet > 0.0`, nothing else.
 */
import { describe, expect, it } from 'vitest';
import { PALETTE_HEX } from '../../../src/generated/palette';
import { ShaderSourceStore } from '../../../src/render/gl/shaders';
import { Renderer } from '../../../src/render/renderer';
import { RenderScene } from '../../../src/render/scene';
import { SHADERS } from '../../../src/render/shaderLib';
import { WORLD_TERRAIN_ORDER, WorldTerrainRenderer } from '../../../src/render/world/terrainPass';
import { createFakeGl } from './fakeGl';

const DEFINE = 'DH_SURFACE_WEATHER';

/** The text between the brace at `open` and its matching closing brace (exclusive), and the index after that brace. */
function block(src: string, open: number): { body: string; end: number } {
  expect(src[open]).toBe('{');
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return { body: src.slice(open + 1, i), end: i + 1 };
  }
  throw new Error('Klammer ohne Gegenstück');
}

/** The regions between `#ifdef DH_SURFACE_WEATHER` and `#endif` of `src`. */
function weatherRegions(src: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`#ifdef ${DEFINE}\\n([\\s\\S]*?)#endif`, 'g');
  for (let m = re.exec(src); m !== null; m = re.exec(src)) out.push(m[1] ?? '');
  return out;
}

describe('Terrain-Shader: Wetter-Variante nur bei Wetter', () => {
  const source = SHADERS['world/terrain.frag'] ?? '';

  it('die beiden Wetter-Bereiche ändern nur bei Schneefall, Nässe oder Pfützen ein Pixel', () => {
    const [snow, rain, ...rest] = weatherRegions(source);
    expect(rest).toEqual([]);
    // Settling snow: declarations, then one `if` that needs a snow cover above 0.
    const snowIf = (snow ?? '').indexOf('if (settles && !snowy && cover > 0.0 &&');
    expect(snowIf).toBeGreaterThan(0);
    expect((snow ?? '').slice(0, snowIf)).toMatch(/^\s*float cover = uSurface\.x;\s*(\/\/[^\n]*\n\s*)*bool settles = [^;]*;\s*$/);
    const snowBody = block(snow ?? '', (snow ?? '').indexOf('{', snowIf));
    expect((snow ?? '').slice(snowBody.end).trim()).toBe('');
    // Rain: an `else if` of the snow branch whose two branches need puddle fill or wetness above 0 – no plain `else`.
    const r = rain ?? '';
    const head = r.match(/^\s*else if \(open && \(vGround & DH_GROUND_WETS\) != 0u\) \{/);
    expect(head).not.toBeNull();
    const outer = block(r, r.indexOf('{'));
    expect(r.slice(outer.end).trim()).toBe('');
    const body = outer.body;
    const puddle = body.match(/^\s*float wet = uSurface\.y;\s*float fill = uSurface\.z;\s*if \(fill > 0\.0 && [^{]*\{/);
    expect(puddle).not.toBeNull();
    const first = block(body, body.indexOf('{', body.indexOf('if (fill > 0.0')));
    const tail = body.slice(first.end);
    expect(tail).toMatch(/^\s*else if \(wet > 0\.0\) \{/);
    const second = block(tail, tail.indexOf('{'));
    expect(tail.slice(second.end).trim()).toBe('');
  });

  it('der Pass übersetzt beide Varianten und zeichnet die Wetter-Variante nur, solange Schnee, Nässe oder Pfützen über 0 liegen', () => {
    const fake = createFakeGl();
    const r = new Renderer(fake.gl, { caps: { floatTargets: true, forcedRgba8: false, maxDrawBuffers: 8 }, sources: new ShaderSourceStore(SHADERS), errors: { report: () => undefined }, paletteHex: PALETTE_HEX });
    const terrain = new WorldTerrainRenderer();
    r.passes.add(terrain, WORLD_TERRAIN_ORDER);
    const fragments = fake.calls.filter((c) => c.name === 'shaderSource').map((c) => String(c.args[1])).filter((s) => s.includes('World terrain → G-buffer'));
    expect(fragments).toHaveLength(2);
    expect(fragments.filter((s) => s.includes(`#define ${DEFINE}`))).toHaveLength(1);
    const scene = new RenderScene();
    scene.ground.push(terrain);
    const frame = (snow: number, wetness: number, puddles: number): boolean => {
      scene.beginFrame(0);
      scene.surface.snow = snow;
      scene.surface.wetness = wetness;
      scene.surface.puddles = puddles;
      r.render(scene, 1280, 720, 'sharp');
      return terrain.stats.weatherShader;
    };
    expect(frame(0, 0, 0)).toBe(false);
    expect(frame(0.25, 0, 0)).toBe(true);
    expect(frame(0, 0.5, 0)).toBe(true);
    expect(frame(0, 0, 0.1)).toBe(true);
    expect(frame(0, 0, 0)).toBe(false);
  });
});
