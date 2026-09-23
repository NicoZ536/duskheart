/**
 * M1-09: GLSL `#include` resolution (nested, cycle-safe, readable errors), `#define` injection after
 * `#version`, compiler errors mapped back to file and line, and hot reload keeping the last good
 * program (ShaderLibrary with a recording fake GL).
 */
import { describe, expect, it } from 'vitest';
import { DEFINES_FILE, MAX_INCLUDE_DEPTH, parseShaderLog, preprocess, resolveIncludes, ShaderError } from '../../../src/render/gl/program';
import { GpuResourceRegistry } from '../../../src/render/gl/resources';
import { ShaderLibrary, ShaderSourceStore, type ShaderErrorReporter } from '../../../src/render/gl/shaders';
import { SHADERS } from '../../../src/render/shaderLib';
import { createFakeGl, FAKE_ERROR } from './fakeGl';

const CHUNKS = {
  'a.glsl': 'float a() { return 1.0; }',
  'b.glsl': '#include "a.glsl"\nfloat b() { return a() * 2.0; }',
  'loop1.glsl': '#include "loop2.glsl"',
  'loop2.glsl': '#include "loop1.glsl"',
};

describe('#include', () => {
  it('resolves nested includes in place, keeping the other lines', () => {
    const out = resolveIncludes('#version 300 es\n  #include "b.glsl"\nvoid main() {}', CHUNKS, 'main.frag');
    expect(out).toBe('#version 300 es\nfloat a() { return 1.0; }\nfloat b() { return a() * 2.0; }\nvoid main() {}');
  });

  it('maps every output line to its file and line', () => {
    const pre = preprocess('main.frag', '#version 300 es\n#include "b.glsl"\nvoid main() {}', CHUNKS);
    expect(pre.lines).toEqual([
      { file: 'main.frag', line: 1 },
      { file: 'a.glsl', line: 1 },
      { file: 'b.glsl', line: 2 },
      { file: 'main.frag', line: 3 },
    ]);
    expect([...pre.files].sort()).toEqual(['a.glsl', 'b.glsl', 'main.frag']);
  });

  it('inserts defines right after #version', () => {
    const pre = preprocess('m.frag', '#version 300 es\nvoid main() {}', {}, { DH_X: '1', DH_Y: '2.0' });
    expect(pre.code.split('\n')).toEqual(['#version 300 es', '#define DH_X 1', '#define DH_Y 2.0', 'void main() {}']);
    expect(pre.lines[1]).toEqual({ file: DEFINES_FILE, line: 1 });
    expect(pre.lines[3]).toEqual({ file: 'm.frag', line: 2 });
  });

  it('reports cycles, missing files and runaway nesting', () => {
    expect(() => resolveIncludes('#include "loop1.glsl"', CHUNKS)).toThrow(/Zyklus/);
    expect(() => resolveIncludes('#include "fehlt.glsl"', CHUNKS, 'x.frag')).toThrow(/fehlt\.glsl nicht gefunden \(x\.frag:1\)/);
    const deep: Record<string, string> = {};
    for (let i = 0; i <= MAX_INCLUDE_DEPTH + 1; i++) deep[`d${i}.glsl`] = `#include "d${i + 1}.glsl"`;
    deep[`d${MAX_INCLUDE_DEPTH + 2}.glsl`] = 'float x;';
    expect(() => resolveIncludes('#include "d0.glsl"', deep)).toThrow(/zu tief/);
  });

  it('maps compiler log lines back to the original file and line', () => {
    const pre = preprocess('main.frag', '#version 300 es\n#include "b.glsl"\nvoid main() { oops; }', CHUNKS, { DH_X: '1' });
    const diags = parseShaderLog("ERROR: 0:5: 'oops' : undeclared identifier\nERROR: 0:1: '' : compilation terminated", pre, 'main.frag');
    expect(diags[0]).toEqual({ file: 'main.frag', line: 3, message: "'oops' : undeclared identifier", code: 'void main() { oops; }' });
    expect(diags[1]?.file).toBe('main.frag');
    expect(parseShaderLog('driver says no', pre, 'main.frag')).toEqual([{ file: 'main.frag', line: 0, message: 'driver says no', code: '' }]);
  });

  it('every shader of the project resolves its includes', () => {
    for (const [name, src] of Object.entries(SHADERS)) {
      if (!name.endsWith('.vert') && !name.endsWith('.frag')) continue;
      const pre = preprocess(name, src, SHADERS, { DH_FLOAT_TARGETS: '1' });
      expect(pre.code, name).not.toMatch(/#include/);
      expect(pre.code.split('\n')[0], name).toBe('#version 300 es');
    }
  });
});

describe('hot reload', () => {
  function setup() {
    const fake = createFakeGl();
    const reports: Array<{ program: string; error: ShaderError | null; hasFallback: boolean }> = [];
    const reporter: ShaderErrorReporter = { report: (program, error, hasFallback) => reports.push({ program, error, hasFallback }) };
    const store = new ShaderSourceStore({
      'x.vert': '#version 300 es\nvoid main() {}',
      'x.frag': '#version 300 es\n#include "lib.glsl"\nvoid main() {}',
      'y.frag': '#version 300 es\nvoid main() {}',
      'lib.glsl': 'float lib() { return 1.0; }',
    });
    const lib = new ShaderLibrary(fake.gl, new GpuResourceRegistry(), store, {}, reporter);
    const x = lib.program({ name: 'x', vertex: 'x.vert', fragment: 'x.frag' });
    const y = lib.program({ name: 'y', vertex: 'x.vert', fragment: 'y.frag' });
    return { fake, reports, store, lib, x, y };
  }

  it('rebuilds only programs that use a changed file (including includes)', () => {
    const { store, x, y } = setup();
    expect([x.buildCount, y.buildCount]).toEqual([1, 1]);
    store.set('lib.glsl', 'float lib() { return 2.0; }');
    expect([x.buildCount, y.buildCount]).toEqual([2, 1]);
    store.replaceAll({ ...Object.fromEntries(store.files().map((f) => [f, store.get(f) ?? ''])), 'y.frag': '#version 300 es\nvoid main() { }' });
    expect([x.buildCount, y.buildCount]).toEqual([2, 2]);
  });

  it('a broken edit keeps the last good program and reports file + line; fixing it clears the report', () => {
    const { store, reports, x } = setup();
    const good = x.handle;
    store.override('lib.glsl', `float lib() {\n  return ${FAKE_ERROR};\n}`);
    expect(x.handle).toBe(good);
    expect(x.error).toBeInstanceOf(ShaderError);
    expect(x.error?.diagnostics[0]).toMatchObject({ file: 'lib.glsl', line: 2 });
    expect(reports.at(-1)).toMatchObject({ program: 'x', hasFallback: true });
    expect(x.use()).toBe(true);
    store.override('lib.glsl', null);
    expect(x.error).toBeNull();
    expect(reports.at(-1)).toEqual({ program: 'x', error: null, hasFallback: true });
    expect(x.handle).not.toBe(good);
  });

  it('a program that never built reports "no fallback" and is skipped', () => {
    const fake = createFakeGl();
    const reports: boolean[] = [];
    const store = new ShaderSourceStore({ 'v.vert': '#version 300 es\nvoid main() {}', 'f.frag': `#version 300 es\n${FAKE_ERROR}` });
    const lib = new ShaderLibrary(fake.gl, new GpuResourceRegistry(), store, {}, { report: (_p, e, fb) => reports.push(e !== null && !fb) });
    const p = lib.program({ name: 'kaputt', vertex: 'v.vert', fragment: 'f.frag' });
    expect(p.handle).toBeNull();
    expect(p.use()).toBe(false);
    expect(reports).toEqual([true]);
    expect(lib.failing()).toEqual([p]);
  });

  it('a program whose first build failed in an include is rebuilt once the include is fixed', () => {
    const fake = createFakeGl();
    const store = new ShaderSourceStore({
      'v.vert': '#version 300 es\nvoid main() {}',
      'f.frag': '#version 300 es\n#include "teil.glsl"\nvoid main() {}',
      'teil.glsl': `float teil() { return ${FAKE_ERROR}; }`,
    });
    const lib = new ShaderLibrary(fake.gl, new GpuResourceRegistry(), store, {}, { report: () => undefined });
    const p = lib.program({ name: 'teil', vertex: 'v.vert', fragment: 'f.frag' });
    expect(p.handle).toBeNull();
    // Before its first build the program only knows its entry files, not the include.
    expect(p.files.has('teil.glsl')).toBe(false);
    store.set('teil.glsl', 'float teil() { return 1.0; }');
    expect(p.error).toBeNull();
    expect(p.handle).not.toBeNull();
    expect(p.files.has('teil.glsl')).toBe(true);
  });

  it('overriding an unknown file is an error', () => {
    const { store } = setup();
    expect(() => store.override('nope.glsl', 'x')).toThrow(/existiert nicht/);
  });
});
