/**
 * Synthetic atlas builder (render tests, debug scenes): same sources ⇒ same bytes, no overlapping
 * frames, source format errors are readable, relief/normals follow the height hint (sphere ⇒
 * radial normals, flat ⇒ (0, 0, 1)), and the figure's left frames are mirrored with swapped hands.
 */
import { describe, expect, it } from 'vitest';
import { PALETTE_RAMPS } from '../../../src/generated/palette';
import { atlasSprite, type AtlasImage } from '../../../src/render/assets/atlas';
import { reliefFromHint } from '../../../src/render/assets/normals';
import { sceneAtlas, scenePaletteRows, sceneSpriteSources } from '../../../src/render/assets/sceneSprites';
import { mirrorRaster, parseSpriteFrames, paletteRefResolver, rasterRows, type SpriteSource } from '../../../src/render/assets/spriteSource';
import { buildAtlas } from '../../../src/render/assets/synthetic';

const RGBA = 4;
const opts = { ramps: PALETTE_RAMPS, paletteRows: scenePaletteRows() };

const disc: SpriteSource = {
  id: 'scheibe',
  group: 'test',
  size: [9, 9],
  anchor: [4, 8],
  hoehe: 'kugel',
  legende: { '.': null, s: 'stein.3', f: 'feuer.4*' },
  frames: [
    `...sss...
     .sssssss.
     .sssssss.
     sssssssss
     ssssfssss
     sssssssss
     .sssssss.
     .sssssss.
     ...sss...`,
  ],
};

function pixels(img: AtlasImage): Uint8Array {
  if (img.kind !== 'pixels' || !(img.pixels instanceof Uint8Array)) throw new Error('Pixel erwartet');
  return img.pixels;
}

describe('synthetischer Atlas', () => {
  it('is deterministic', () => {
    const a = buildAtlas(sceneSpriteSources(), opts);
    const b = buildAtlas(sceneSpriteSources(), opts);
    expect(pixels(a.albedo)).toEqual(pixels(b.albedo));
    expect(pixels(a.normal)).toEqual(pixels(b.normal));
    expect(a.manifest.sourceHash).toBe(b.manifest.sourceHash);
  });

  it('packs every frame inside the atlas without overlap', () => {
    const m = sceneAtlas().manifest;
    const rects = Object.values(m.sprites).flatMap((s) => s.frames);
    for (const r of rects) {
      expect(r.x + r.w).toBeLessThanOrEqual(m.width);
      expect(r.y + r.h).toBeLessThanOrEqual(m.height);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        if (!a || !b) continue;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    }
  });

  it('writes palette index, emissive flag and coverage per the atlas contract', () => {
    const atlas = buildAtlas([disc], opts);
    const px = pixels(atlas.albedo);
    const f = atlas.manifest.sprites['scheibe']?.frames[0];
    if (!f) throw new Error('Frame fehlt');
    const at = (x: number, y: number): number[] => [...px.subarray(((f.y + y) * atlas.manifest.width + f.x + x) * RGBA, ((f.y + y) * atlas.manifest.width + f.x + x) * RGBA + RGBA)];
    const ref = paletteRefResolver(PALETTE_RAMPS);
    expect(at(0, 0)).toEqual([0, 0, 0, 0]);
    expect(at(4, 0)).toEqual([ref('stein.3'), 0, 0, 255]);
    expect(at(4, 4)).toEqual([ref('feuer.4'), 255, 0, 255]);
    expect(atlas.manifest.sprites['scheibe']?.emissive).toBe(true);
  });

  it('sphere relief gives radial normals, flat relief gives (0, 0, 1)', () => {
    const atlas = buildAtlas([disc, { ...disc, id: 'flach', hoehe: 'flach' }], opts);
    const nx = (id: string, x: number, y: number): [number, number, number] => {
      const f = atlas.manifest.sprites[id]?.frames[0];
      if (!f) throw new Error('Frame fehlt');
      const o = ((f.y + y) * atlas.manifest.width + f.x + x) * RGBA;
      const n = pixels(atlas.normal);
      return [((n[o] ?? 0) / 255) * 2 - 1, ((n[o + 1] ?? 0) / 255) * 2 - 1, n[o + 2] ?? 0];
    };
    const [lx] = nx('scheibe', 1, 4);
    const [rx] = nx('scheibe', 7, 4);
    const [, ty] = nx('scheibe', 4, 1);
    const [, by] = nx('scheibe', 4, 7);
    expect(lx).toBeLessThan(-0.2);
    expect(rx).toBeGreaterThan(0.2);
    expect(ty).toBeGreaterThan(0.2);
    expect(by).toBeLessThan(-0.2);
    const [cx, cy, ch] = nx('scheibe', 4, 4);
    expect(Math.abs(cx)).toBeLessThan(0.1);
    expect(Math.abs(cy)).toBeLessThan(0.1);
    expect(ch).toBeGreaterThan(0);
    const [fx, fy, fh] = nx('flach', 4, 4);
    expect([Math.round(fx * 100), Math.round(fy * 100), fh]).toEqual([0, 0, 0]);
    expect(reliefFromHint(new Uint8Array(4).fill(1), 2, 2, 'flach').every((h) => h === 0)).toBe(true);
    expect(() => reliefFromHint(new Uint8Array(4), 2, 2, 'custom')).toThrow(/custom/);
  });

  it('reports unknown legend characters and wrong frame sizes', () => {
    const resolve = paletteRefResolver(PALETTE_RAMPS);
    expect(() => parseSpriteFrames({ ...disc, frames: ['...sss..X\n'.repeat(9)] }, resolve)).toThrow(/unbekanntes Legendenzeichen „X“/);
    expect(() => parseSpriteFrames({ ...disc, frames: ['sss'] }, resolve)).toThrow(/1 statt 9 Zeilen/);
    expect(() => parseSpriteFrames({ ...disc, legende: { s: 'moos.2' } }, resolve)).toThrow(/unbekannte Rampe/);
  });

  it('the figure has four directions; left is the mirrored right with swapped hands', () => {
    const m = sceneAtlas().manifest;
    const fig = atlasSprite(m, 'wanderer');
    const source = sceneSpriteSources().find((s) => s.id === 'wanderer');
    if (!source) throw new Error('Figur fehlt');
    const right = fig.clips['walk_right']?.frames[0] ?? -1;
    const left = fig.clips['walk_left']?.frames[0] ?? -1;
    expect(rasterRows(source.frames[left] ?? '')).toEqual(rasterRows(mirrorRaster(source.frames[right] ?? '')));
    const w = fig.size[0];
    expect(fig.sockets['hand']?.[left]).toEqual([w - (fig.sockets['nebenhand']?.[right]?.[0] ?? 0), fig.sockets['nebenhand']?.[right]?.[1]]);
    for (const dir of ['down', 'up', 'left', 'right']) {
      expect(fig.clips[`idle_${dir}`]?.fps).toBe(8);
      expect(fig.clips[`walk_${dir}`]?.fps).toBe(10);
    }
  });
});
