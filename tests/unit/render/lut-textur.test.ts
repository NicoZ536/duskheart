/**
 * M5-14/M5-22: the 3D LUT textures are registry resources – allocated with their retained texels, updated
 * in place, rebuilt with the latest texels after a context loss (MASTERPROMPT §6.3).
 */
import { describe, expect, it } from 'vitest';
import { GpuResourceRegistry } from '../../../src/render/gl/resources';
import { Texture3D } from '../../../src/render/post/lut3d';
import { createFakeGl } from './fakeGl';

describe('3D-LUT-Textur', () => {
  it('allocates size³ RGBA8 texels, updates in place and restores the latest texels after a context loss', () => {
    const fake = createFakeGl();
    const reg = new GpuResourceRegistry();
    const first = new Uint8Array(4 * 4 * 4 * 4).fill(7);
    const tex = reg.add(new Texture3D(fake.gl, { label: 'lut', size: 4, filter: 'linear', pixels: first }));
    const alloc = fake.calls.filter((c) => c.name === 'texImage3D');
    expect(alloc).toHaveLength(1);
    expect(alloc[0]?.args.slice(3, 6)).toEqual([4, 4, 4]);
    expect(alloc[0]?.args[9]).toBe(first);
    expect(tex.bytes()).toBe(256);
    const next = new Uint8Array(256).fill(9);
    tex.setPixels(next);
    expect(fake.calls.filter((c) => c.name === 'texSubImage3D').at(-1)?.args[10]).toBe(next);
    fake.lose();
    reg.loseAll();
    expect(tex.handle).toBeNull();
    tex.setPixels(first);
    fake.restore();
    fake.calls.length = 0;
    reg.restoreAll();
    expect(fake.calls.filter((c) => c.name === 'texImage3D').map((c) => c.args[9])).toEqual([first]);
    expect(tex.handle).not.toBeNull();
    expect(() => new Texture3D(fake.gl, { label: 'klein', size: 4, filter: 'nearest', pixels: new Uint8Array(8) })).toThrow(/zu wenige Texel/);
  });
});
