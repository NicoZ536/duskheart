/**
 * Game atlas of `npm run assets`: the generated manifest (when present) matches the atlas contract
 * of docs/RENDER.md §2 and converts into the renderer's model (frames with anchor, clips, sockets,
 * palette rows).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkGeneratedAtlasModule, generatedAtlasModule, manifestFromGenerated, type GeneratedAtlasModule } from '../../../src/render/assets/generated';
import { SpriteEntry } from '../../../src/render/assets/spriteTable';
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
        { x: 1, y: 1, w: 16, h: 16, ax: 8, ay: 15 },
        { x: 18, y: 1, w: 16, h: 16, ax: 8, ay: 15 },
      ],
      clips: { idle: { name: 'idle', frames: [0, 1], fps: 12, loop: true, events: [{ frame: 1, name: 'knistern' }] } },
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
  it('converts frames (with their anchor), clips, sockets and palette rows', () => {
    const m = manifestFromGenerated(MODULE);
    const s = m.sprites['fackel'];
    expect(s?.frames[1]).toEqual({ x: 18, y: 1, w: 16, h: 16, ax: 8, ay: 15 });
    expect(s?.clips['idle']).toEqual({ name: 'idle', frames: [0, 1], fps: 12, loop: true, events: [{ frame: 1, name: 'knistern' }] });
    expect(s?.sockets['licht']?.[1]).toEqual([8, 3]);
    // The module's own objects, no copy (M7-130: one set of ≈ 35 000 frames on the heap).
    expect(s?.frames).toBe(MODULE.SPRITES['fackel']?.frames);
    expect(s?.clips).toBe(MODULE.SPRITES['fackel']?.clips);
    expect(s?.sockets).toBe(MODULE.SPRITES['fackel']?.sockets);
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
    // M7-130: the sprite headers are read as JSON (`JSON.parse` in the module), not an object literal with its boilerplates;
    // M7-151: frames, clips and sockets are typed-array columns of a `SpriteTable`, the entries of which are `SPRITES`.
    const source = readFileSync(fileURLToPath(new URL('../../../src/generated/atlas.ts', import.meta.url)), 'utf8');
    expect(source).toMatch(/^const TABLE = new SpriteTable\(JSON\.parse\(`\[\{"id":/m);
    expect(source).toMatch(/^ {2}rects: new Int32Array\(JSON\.parse\(`\[/m);
    expect(source).toMatch(/^ {2}clipFps: new Float64Array\(JSON\.parse\(`\[/m);
    expect(source).toMatch(/^export const SPRITES: Readonly<Record<SpriteId, AtlasSprite>> = TABLE\.sprites;$/m);
    expect(source).not.toMatch(/^export const SPRITES[^\n]*= \{$/m);
    expect(source).not.toMatch(/"frames":\[\{/);
    for (const s of Object.values(mod.SPRITES)) expect(s).toBeInstanceOf(SpriteEntry);
    // The whole contract (every sprite, frame, clip and socket) is checked here, where the module is built – not in the game (M7-115).
    expect(checkGeneratedAtlasModule(mod)).toBe(mod);
    const m = manifestFromGenerated(mod);
    // Every frame and clip frame of every sprite; the violations are collected and checked in one expect (one expect per
    // frame were 50 000 calls, M6-93).
    const fehler: string[] = [];
    for (const s of Object.values(m.sprites)) {
      s.frames.forEach((f, i) => {
        if (!(f.x + f.w <= m.width)) fehler.push(`${s.id} Frame ${i}: rechts ${f.x + f.w} > ${m.width}`);
        if (!(f.y + f.h <= m.height)) fehler.push(`${s.id} Frame ${i}: unten ${f.y + f.h} > ${m.height}`);
      });
      for (const c of Object.values(s.clips)) for (const f of c.frames) if (!(f < s.frames.length)) fehler.push(`${s.id} Clip ${c.name}: Frame ${f} ≥ ${s.frames.length}`);
    }
    expect(fehler).toEqual([]);
    for (const r of m.paletteRows) validateRow(r);
    // Every rule names rows the atlas has.
    const rows = new Set(m.paletteRows.map((r) => r.name));
    for (const [id, rule] of Object.entries(m.objectRows ?? {})) if (rule.kind === 'season') for (const r of rule.rows) expect(rows.has(r), `${id}: ${r}`).toBe(true);
  });

  it('the full contract check names what does not fit and hands the module itself back', () => {
    expect(checkGeneratedAtlasModule(MODULE)).toBe(MODULE);
    const kaputt = { ...MODULE, SPRITES: { fackel: { ...MODULE.SPRITES['fackel'], frames: [] } } };
    expect(() => checkGeneratedAtlasModule(kaputt)).toThrow(/Atlas-Vertrag.*frames/s);
    expect(() => checkGeneratedAtlasModule({ ...MODULE, ATLAS: { ...MODULE.ATLAS, width: 0 } })).toThrow(/Atlas-Vertrag/);
    // M7-130: every frame names its anchor, every clip its key.
    const fackel = MODULE.SPRITES['fackel'] as GeneratedAtlasModule['SPRITES'][string];
    const ohneAnker = { ...MODULE, SPRITES: { fackel: { ...fackel, frames: [{ x: 1, y: 1, w: 16, h: 16 }] } } };
    expect(() => checkGeneratedAtlasModule(ohneAnker)).toThrow(/Atlas-Vertrag.*ax/s);
    const falscherName = { ...MODULE, SPRITES: { fackel: { ...fackel, clips: { idle: { ...fackel.clips['idle'], name: 'lauf' } } } } };
    expect(() => checkGeneratedAtlasModule(falscherName)).toThrow(/Clip-Name ≠ Schlüssel.*fackel\.idle/);
  });

  it('the game gets the data of the module itself, no checked copy (M7-115: one atlas on the heap, no copy as boot garbage)', () => {
    const mod = generatedAtlasModule();
    if (mod === null) return;
    const own = Object.values(import.meta.glob('../../../src/generated/atlas.ts', { eager: true }))[0] as GeneratedAtlasModule;
    expect(mod.SPRITES).toBe(own.SPRITES);
    expect(mod.PALETTE_ROWS).toBe(own.PALETTE_ROWS);
    expect(mod.OBJEKT_ZEILEN).toBe(own.OBJEKT_ZEILEN);
    // M7-151: the renderer's sprites are the table's entries themselves; what a sprite decodes it keeps.
    const m = manifestFromGenerated(mod);
    for (const [id, s] of Object.entries(m.sprites)) expect(s, id).toBe(mod.SPRITES[id]);
    const first = Object.values(mod.SPRITES)[0] as unknown as SpriteEntry;
    expect(first.frames).toBe(first.frames);
    expect(first.clips).toBe(first.clips);
    expect(first.sockets).toBe(first.sockets);
  });

  it('checks the manifest once and shares it: every later call allocates nothing (M7-115, boot garbage of the loading screen)', () => {
    const first = generatedAtlasModule();
    if (first === null) return;
    expect(generatedAtlasModule()).toBe(first);
    // A second check would build a full copy of the ≈ 1 600 sprites (megabytes); a shared result costs a few bytes at most.
    const gc = (globalThis as { gc?: () => void }).gc;
    gc?.();
    const before = process.memoryUsage().heapUsed;
    let same = 0;
    for (let i = 0; i < 20; i++) if (generatedAtlasModule() === first) same++;
    const grown = process.memoryUsage().heapUsed - before;
    expect(same).toBe(20);
    expect(grown).toBeLessThan(1_000_000);
  });
});
