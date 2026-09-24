/**
 * Game atlas of `npm run assets`: the generated manifest (when present) matches the atlas contract
 * of docs/RENDER.md §2 and converts into the renderer's model (frames with anchor, clips, sockets,
 * palette rows).
 */
import { describe, expect, it } from 'vitest';
import { generatedAtlasModule, manifestFromGenerated, type GeneratedAtlasModule } from '../../../src/render/assets/generated';
import { validateRow } from '../../../src/render/palette/lut';


const MODULE: GeneratedAtlasModule = {
  ATLAS: { width: 64, height: 32, albedoUrl: 'generated/a.png', normalUrl: 'generated/n.png', sourceHash: 'abc' },
  SPRITES: {
    fackel: {
      id: 'fackel',
      group: 'licht',
      size: [16, 16],
      anchor: [8, 15],
      sockets: { licht: [[8, 2], [8, 3]] },
      frames: [
        { x: 1, y: 1, w: 16, h: 16 },
        { x: 18, y: 1, w: 16, h: 16 },
      ],
      clips: { idle: { frames: [0, 1], fps: 12, loop: true, events: [{ frame: 1, name: 'knistern' }] } },
      hoehe: 'zylinder',
      emissiv: true,
      spiegelbar: true,
      material: 8,
      bounds: { x: 4, y: 1, w: 8, h: 15 },
    },
  },
  PALETTE_ROWS: [{ id: 'basis', map: Array.from({ length: 64 }, (_, i) => i + 1) }],
  OBJEKT_ZEILEN: { baum_eiche: { regel: 'jahreszeit', zeilen: ['fruehling', 'sommer', 'herbst', 'winter'] }, deko_moos: { regel: 'biom' } },
};

describe('generierter Atlas', () => {
  it('converts frames (with the sprite anchor), clips, sockets and palette rows', () => {
    const m = manifestFromGenerated(MODULE);
    const s = m.sprites['fackel'];
    expect(s?.frames[1]).toEqual({ x: 18, y: 1, w: 16, h: 16, ax: 8, ay: 15 });
    expect(s?.clips['idle']).toEqual({ name: 'idle', frames: [0, 1], fps: 12, loop: true, events: [{ frame: 1, name: 'knistern' }] });
    expect(s?.sockets['licht']?.[1]).toEqual([8, 3]);
    expect([s?.heightHint, s?.emissive, s?.symmetric]).toEqual(['zylinder', true, true]);
    expect(m.paletteRows[0]?.name).toBe('basis');
    expect([m.width, m.height, m.sourceHash]).toEqual([64, 32, 'abc']);
  });

  it('converts material flags, bounds and the palette row rules of world objects (M2-28)', () => {
    const m = manifestFromGenerated(MODULE);
    expect([m.sprites['fackel']?.material, m.sprites['fackel']?.bounds]).toEqual([8, { x: 4, y: 1, w: 8, h: 15 }]);
    expect(m.objectRows?.['baum_eiche']).toEqual({ kind: 'season', rows: ['fruehling', 'sommer', 'herbst', 'winter'] });
    expect(m.objectRows?.['deko_moos']).toEqual({ kind: 'biome' });
  });

  it('the generated manifest of this checkout (if built) fits the contract', () => {
    const mod = generatedAtlasModule();
    if (mod === null) return;
    const m = manifestFromGenerated(mod);
    for (const s of Object.values(m.sprites)) {
      for (const f of s.frames) {
        expect(f.x + f.w, s.id).toBeLessThanOrEqual(m.width);
        expect(f.y + f.h, s.id).toBeLessThanOrEqual(m.height);
      }
      for (const c of Object.values(s.clips)) for (const f of c.frames) expect(f, `${s.id}`).toBeLessThan(s.frames.length);
    }
    for (const r of m.paletteRows) validateRow(r);
    // Every rule names rows the atlas has.
    const rows = new Set(m.paletteRows.map((r) => r.name));
    for (const [id, rule] of Object.entries(m.objectRows ?? {})) if (rule.kind === 'season') for (const r of rule.rows) expect(rows.has(r), `${id}: ${r}`).toBe(true);
  });
});
