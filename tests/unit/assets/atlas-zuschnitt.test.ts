/**
 * M7-110 Zuschnitt im Atlas (tools/assets/atlas.ts, Sprite-Angabe `zuschnitt`): die Overlay-Layer der Rüstung liegen nur mit
 * den deckenden Pixeln je Frame im Atlas – sonst passen die Rüstungen der Körperformen `schmal` und `kraeftig` nicht mehr in
 * den Atlas (4096²). Belegt an einem kleinen Atlas:
 * - das Rechteck eines beschnittenen Frames ist das seiner deckenden Pixel, der Anker im Rechteck (`ax`, `ay`) ist der
 *   Zell-Anker minus der Lage des Rechtecks; ein leerer Frame wird 1×1;
 * - jedes deckende Pixel landet relativ zum Anker genau dort, wo es unbeschnitten lag (der Renderer zeichnet ein Sprite
 *   relativ zu seinem Anker – Lage, Spiegelung, Drehung, Höhe über der Ankerzeile bleiben gleich), mit denselben Albedo- und
 *   Normalen-Bytes;
 * - der Laufzeit-Adapter (`manifestFromGenerated`) übernimmt den Anker je Frame, unbeschnittene Frames behalten den Zell-Anker;
 * - Zuschnitt mit Sockeln oder Occluder bricht den Build ab (beide stehen in Zellkoordinaten).
 */
import { describe, expect, it } from 'vitest';
import { paletteIndex } from '../../../assets-src/palette';
import { spriteFromPixels, type Sprite } from '../../../assets-src/lib/sprite';
import { buildAtlas, type ManifestSprite } from '../../../tools/assets/atlas';
import type { LoadedSprite } from '../../../tools/assets/sources';
import { RGBA_BYTES } from '../../../tools/lib/image';
import { manifestFromGenerated, type GeneratedAtlasModule } from '../../../src/render/assets/generated';

const N = 32;
const ANKER: [number, number] = [16, 31];
const STOFF = paletteIndex('wasser.2');
const KONTUR = paletteIndex('nacht.1');

/** Ein 32×32-Frame mit einem Rechteck Stoff (Kontur am Rand) bei (x, y), w × h; w = 0: leer. */
function frame(x: number, y: number, w: number, h: number): { index: Uint8Array } {
  const index = new Uint8Array(N * N);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) index[(y + j) * N + x + i] = i === 0 || j === 0 || i === w - 1 || j === h - 1 ? KONTUR : STOFF;
  return { index };
}

const FRAMES = [frame(10, 19, 12, 7), frame(4, 12, 6, 14), frame(0, 0, 0, 0), frame(20, 26, 12, 6)];

function sprite(id: string, zuschnitt: boolean, extra: Record<string, unknown> = {}): Sprite {
  return spriteFromPixels({ id, size: [N, N], anchor: ANKER, hoehe: 'zylinder', ...(zuschnitt ? { zuschnitt: true } : {}), ...extra }, FRAMES);
}

const geladen = (s: Sprite): LoadedSprite => ({ sprite: s, group: 'test', file: `${s.id}.ts` });

/** Deckende Pixel eines Frames relativ zum Anker, mit ihren Albedo- und Normalen-Bytes (aus dem Atlas). */
function pixelAmAnker(atlas: { width: number; albedo: Uint8Array; normal: Uint8Array }, r: { x: number; y: number; w: number; h: number }, ax: number, ay: number): string[] {
  const out: string[] = [];
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const p = ((r.y + y) * atlas.width + r.x + x) * RGBA_BYTES;
      if ((atlas.albedo[p + 3] ?? 0) === 0) continue;
      out.push(`${x - ax},${y - ay}:${Array.from(atlas.albedo.subarray(p, p + RGBA_BYTES)).join('.')}/${Array.from(atlas.normal.subarray(p, p + RGBA_BYTES)).join('.')}`);
    }
  }
  return out.sort();
}

describe('M7-110 Zuschnitt im Atlas', () => {
  const atlas = buildAtlas([geladen(sprite('zelle', false)), geladen(sprite('schnitt', true))]);
  const byId = new Map(atlas.sprites.map((s) => [s.id, s]));
  const zelle = byId.get('zelle') as ManifestSprite;
  const schnitt = byId.get('schnitt') as ManifestSprite;

  it('das Rechteck eines beschnittenen Frames umfasst genau die deckenden Pixel; der Anker liegt im Rechteck; leer: 1×1', () => {
    expect(zelle.frames.every((r) => r.w === N && r.h === N && r.ax === undefined && r.ay === undefined)).toBe(true);
    expect(schnitt.frames.map((r) => [r.w, r.h, r.ax, r.ay])).toEqual([
      [12, 7, ANKER[0] - 10, ANKER[1] - 19],
      [6, 14, ANKER[0] - 4, ANKER[1] - 12],
      [1, 1, ANKER[0], ANKER[1]],
      [12, 6, ANKER[0] - 20, ANKER[1] - 26],
    ]);
    // Size, anchor and bounds of the sprite stay those of the cell.
    expect([schnitt.size, schnitt.anchor, schnitt.bounds]).toEqual([zelle.size, zelle.anchor, zelle.bounds]);
  });

  it('jedes deckende Pixel liegt relativ zum Anker wie unbeschnitten, mit denselben Albedo- und Normalen-Bytes', () => {
    let pixel = 0;
    schnitt.frames.forEach((r, f) => {
      const z = zelle.frames[f];
      if (z === undefined) throw new Error(`Frame ${f} fehlt`);
      const soll = pixelAmAnker(atlas, z, ANKER[0], ANKER[1]);
      expect(pixelAmAnker(atlas, r, r.ax ?? -1, r.ay ?? -1), `Frame ${f}`).toEqual(soll);
      pixel += soll.length;
    });
    expect(pixel).toBe(12 * 7 + 6 * 14 + 12 * 6);
  });

  it('die Laufzeit übernimmt den Anker je Frame; unbeschnittene Frames haben den Zell-Anker', () => {
    const mod = {
      ATLAS: { width: atlas.width, height: atlas.height, albedoUrl: 'a.png', normalUrl: 'n.png', sourceHash: 'test' },
      SPRITES: JSON.parse(JSON.stringify({ zelle, schnitt })) as GeneratedAtlasModule['SPRITES'],
      PALETTE_ROWS: [],
      OBJEKT_ZEILEN: {},
    } satisfies GeneratedAtlasModule;
    const m = manifestFromGenerated(mod);
    expect(m.sprites['zelle']?.frames.map((f) => [f.ax, f.ay])).toEqual(FRAMES.map(() => ANKER));
    expect(m.sprites['schnitt']?.frames.map((f) => [f.x, f.y, f.w, f.h, f.ax, f.ay])).toEqual(schnitt.frames.map((r) => [r.x, r.y, r.w, r.h, r.ax, r.ay]));
  });

  it('Zuschnitt mit Sockeln oder Occluder bricht den Build ab', () => {
    expect(() => buildAtlas([geladen(sprite('mit_sockel', true, { sockets: { hand: [[16, 20]] } }))])).toThrow(/Zuschnitt nur ohne Sockel und Occluder/);
    expect(() => buildAtlas([geladen(sprite('mit_occluder', true, { occluder: { kind: 'rect', x: 10, y: 28, w: 12, h: 3 } }))])).toThrow(/Zuschnitt nur ohne Sockel und Occluder/);
  });
});
