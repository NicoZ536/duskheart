/**
 * M6-81: Der Sprite-Shader ohne Tinten-Rauch, solange kein Sprite des Frames sich materialisiert (src/render/batch/
 * spriteBatcher.ts, sprite_gbuffer.frag `#ifdef DH_SMOKE`). Ein Software-Rasterer führt jeden Zweig eines Shaders aus,
 * genommen oder nicht (ADR-0066): der Rauch der Schattenbrut (M6-25) kostete jedes Sprite-Pixel jedes Frames seine
 * Rauschwerte und Texelzugriffe und verlängerte das SwiftShader-Bild von `sprites-5000` um 40 %.
 * - Die Variante ohne `DH_SMOKE` enthält keinen Rauch-Code; beide Varianten teilen jede übrige Zeile, die ohne Rauch
 *   nimmt den Zweig `smoke = false` (gleiche Pixel für jedes Sprite ohne `materialize`).
 * - Der Batcher zeichnet einen Frame mit der Rauch-Variante genau dann, wenn eines seiner Sprites `materialize` trägt;
 *   `SpriteList.materializing` vergisst das mit `clear`.
 * - Beide Programme heißen `sprite-gbuffer` (eine Datei, ein Eintrag im Fehler-Overlay); ein Fehler, der nur im Rauch-
 *   Code bleibt, bleibt gemeldet, wenn eine Änderung den gemeinsamen Code repariert.
 */
import { describe, expect, it } from 'vitest';
import { SMOKE_VARIANT, SpriteBatcher } from '../../../src/render/batch/spriteBatcher';
import { SpriteDesc, SpriteList } from '../../../src/render/batch/spriteList';
import { GpuResourceRegistry } from '../../../src/render/gl/resources';
import { ShaderLibrary, ShaderSourceStore, type ShaderErrorReporter } from '../../../src/render/gl/shaders';
import type { ShaderError } from '../../../src/render/gl/program';
import { SHADERS } from '../../../src/render/shaderLib';
import { createFakeGl, FAKE_ERROR } from './fakeGl';

const FILE = 'sprite_gbuffer.frag';
const FRAG = SHADERS[FILE] ?? '';
const FRAME = { x: 0, y: 0, w: 16, h: 24, ax: 8, ay: 23 };

/**
 * The fragment source as the GLSL preprocessor sees it with or without `DH_SMOKE`: the `#ifdef DH_SMOKE` blocks (with
 * their `#else`) resolved, every other line kept. The sprite shader nests no directive inside these blocks.
 */
function withSmoke(source: string, smoke: boolean): string {
  const out: string[] = [];
  let state: 'out' | 'if' | 'else' = 'out';
  for (const line of source.split('\n')) {
    const t = line.trim();
    if (t === '#ifdef DH_SMOKE') {
      expect(state, 'DH_SMOKE nicht verschachtelt').toBe('out');
      state = 'if';
    } else if (t === '#else' && state !== 'out') state = 'else';
    else if (t === '#endif' && state !== 'out') state = 'out';
    else if (state === 'out' || (state === 'if') === smoke) {
      if (state !== 'out') expect(t.startsWith('#'), `Direktive im DH_SMOKE-Block: ${t}`).toBe(false);
      out.push(line);
    }
  }
  expect(state).toBe('out');
  return out.join('\n');
}

/** A sprite list of `n` sprites, the one at `smokeAt` (if any) materialising. */
function frame(list: SpriteList, n: number, smokeAt = -1): void {
  list.clear();
  const d = new SpriteDesc();
  for (let i = 0; i < n; i++) {
    d.reset();
    d.frame = FRAME;
    d.x = i * 3;
    d.y = (i * 37) % 200;
    if (i === smokeAt) {
      d.materialize = true;
      d.fade = 0.5;
    }
    list.push(d);
  }
}

/**
 * The fake GL behind a GLSL preprocessor for `DH_SMOKE` alone: a shader compiles to what its variant sees, so an error
 * inside `#ifdef DH_SMOKE` fails only the smoke variant (as a real compiler does).
 */
function preprocessingGl(gl: WebGL2RenderingContext): WebGL2RenderingContext {
  return new Proxy(gl, {
    get(target, prop, receiver) {
      if (prop === 'shaderSource') {
        return (sh: WebGLShader, src: string) => target.shaderSource(sh, withSmoke(src, src.includes('\n#define DH_SMOKE 1\n')));
      }
      return Reflect.get(target, prop, receiver) as unknown;
    },
  });
}

describe('Sprite-Shader ohne Tinten-Rauch (DH_SMOKE)', () => {
  it('die Variante ohne DH_SMOKE enthält keinen Rauch-Code, die mit ihm den ganzen', () => {
    const plain = withSmoke(FRAG, false);
    const smoke = withSmoke(FRAG, true);
    for (const code of ['smokeThreshold', 'smokeRowShare', 'DH_SMOKE_', 'FLAG_MATERIALIZE) != 0u', 'float fade', 'rim = threshold', 'smokeTongue', 'if (tongue) color', 'if (rim) color', 'if (rim) emissive', 'albedoAt(p + ivec2(dx, 0))']) {
      expect(plain, code).not.toContain(code);
      expect(smoke, code).toContain(code);
    }
    // Without the smoke no sprite smokes: every sprite takes the Bayer fade, the rim is never set.
    expect(plain).toContain('  const bool smoke = false;\n  if (!smoke) {\n    if (float(vMisc.w) / 255.0 > bayer4(vec2(p))) discard;\n  }');
    expect(smoke).toContain('  bool smoke = (flags & FLAG_MATERIALIZE) != 0u;\n  if (!smoke) {');
    expect(smoke).not.toContain('const bool smoke = false;');
    expect(plain).toContain('bool rim = false;');
    expect(plain).toContain('if (a.g <= 0.0 && !rim) color = mix(color, vTint.rgb, vTint.a);');
  });

  it('beide Varianten teilen jede übrige Zeile in derselben Reihenfolge', () => {
    const plain = withSmoke(FRAG, false).split('\n');
    const smoke = withSmoke(FRAG, true).split('\n');
    // The plain variant is the smoke variant without the smoke's lines, plus the one line that fixes `smoke` to false.
    const own = plain.filter((l) => l.trim() === 'const bool smoke = false;');
    expect(own).toHaveLength(1);
    const shared = plain.filter((l) => l.trim() !== 'const bool smoke = false;');
    let j = 0;
    for (const line of shared) {
      while (j < smoke.length && smoke[j] !== line) j++;
      expect(j, `Zeile fehlt in der Rauch-Variante: ${line}`).toBeLessThan(smoke.length);
      j++;
    }
  });

  it('der Batcher zeichnet mit der Rauch-Variante genau die Frames, in denen ein Sprite sich materialisiert', () => {
    const fake = createFakeGl();
    const registry = new GpuResourceRegistry();
    const shaders = new ShaderLibrary(fake.gl, registry, new ShaderSourceStore(SHADERS), {}, { report: () => undefined });
    const b = new SpriteBatcher(fake.gl, registry, shaders);
    const programs = shaders.list().filter((p) => p.label === 'sprite-gbuffer');
    expect(programs).toHaveLength(2);
    const [plain, smoke] = programs;
    // The second one is compiled with the smoke's define, the first without.
    const fragments = fake.calls.filter((c) => c.name === 'shaderSource' && String(c.args[1]).includes('oAlbedo')).map((c) => String(c.args[1]));
    expect(fragments).toHaveLength(2);
    const smokeDefine = new RegExp(`^#define DH_SMOKE ${SMOKE_VARIANT.DH_SMOKE}$`, 'm');
    expect(fragments[0]).not.toMatch(smokeDefine);
    expect(fragments[1]).toMatch(smokeDefine);
    const list = new SpriteList();
    frame(list, 50);
    expect(list.materializing).toBe(false);
    b.prepare(list);
    expect(b.program).toBe(plain);
    frame(list, 50, 17);
    expect(list.materializing).toBe(true);
    b.prepare(list);
    expect(b.program).toBe(smoke);
    // Gone from the next frame: back to the plain one; an empty frame too.
    frame(list, 50);
    b.prepare(list);
    expect(b.program).toBe(plain);
    frame(list, 0);
    b.prepare(list);
    expect(b.program).toBe(plain);
    // A materialising sprite that is whole (fade 0) still asks for the smoke variant: the flag decides, as in the shader.
    list.clear();
    const d = new SpriteDesc();
    d.frame = FRAME;
    d.materialize = true;
    list.push(d);
    b.prepare(list);
    expect(b.program).toBe(smoke);
  });

  it('ein Fehler im gemeinsamen Code ist ein Eintrag; einer, der nur im Rauch-Code bleibt, bleibt gemeldet', () => {
    const fake = createFakeGl();
    const registry = new GpuResourceRegistry();
    const shown = new Map<string, ShaderError>();
    const reporter: ShaderErrorReporter = {
      report: (program, error) => {
        if (error === null) shown.delete(program);
        else shown.set(program, error);
      },
    };
    const store = new ShaderSourceStore(SHADERS);
    const shaders = new ShaderLibrary(preprocessingGl(fake.gl), registry, store, {}, reporter);
    new SpriteBatcher(fake.gl, registry, shaders);
    expect([...shown.keys()]).toEqual([]);
    const lines = FRAG.split('\n');
    const main = lines.findIndex((l) => l.startsWith('void main()'));
    const smokeBlock = lines.findIndex((l, i) => i > main && l.trim() === '#ifdef DH_SMOKE');
    const broken = (at: readonly number[]): string => lines.flatMap((l, i) => (at.includes(i) ? [l, `  float kaputt = ${FAKE_ERROR};`] : [l])).join('\n');
    // Broken in the shared code and in the smoke's: one entry for the shader.
    store.override(FILE, broken([main, smokeBlock]));
    expect([...shown.keys()]).toEqual(['sprite-gbuffer']);
    // The shared code mended, the smoke's still broken: the entry stays.
    store.override(FILE, broken([smokeBlock]));
    expect([...shown.keys()]).toEqual(['sprite-gbuffer']);
    expect(shown.get('sprite-gbuffer')?.message).toContain(FAKE_ERROR);
    store.override(FILE, null);
    expect([...shown.keys()]).toEqual([]);
  });
});
