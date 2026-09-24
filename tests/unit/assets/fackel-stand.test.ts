/**
 * M1-33: stehende Fackel als eigenes Sprite (Boden); `fackel_wand` bleibt Wänden vorbehalten. Geprüft
 * wird, was sich am Pixel belegen lässt: Zelle und Fußpunkt, vier emissive Flammen-Frames mit dem
 * Clip der Wandfackel, Lichtsockel im Flammenkern knapp über Kopfhöhe der Spielfigur, nur die Flamme
 * (und die Glut auf dem Pechkopf) leuchtet, Holzpfahl bis zum Boden, Farbgrenze ohne Einzelpixel.
 */
import { describe, expect, it } from 'vitest';
import spieler from '../../../assets-src/sprites/figuren/spieler_koerper';
import fackelStand from '../../../assets-src/sprites/licht/fackel_stand';
import fackelWand from '../../../assets-src/sprites/licht/fackel_wand';
import { MATERIAL_BITS, MAX_SPRITE_COLORS, TRANSPARENT, spriteColorCount, type SpriteFrame } from '../../../assets-src/lib/sprite';
import { paletteRef } from '../../../assets-src/palette';
import { checkSprite } from '../../../tools/assets/spriteChecks';

/** Die Flamme steht mindestens so hoch über dem Fuß wie der Kopf der Spielfigur (Leuchtweite, Lesbarkeit). */
function topRow(f: SpriteFrame, w: number, h: number): number {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((f.index[y * w + x] ?? TRANSPARENT) !== TRANSPARENT) return y;
  return h;
}

describe('M1-33 stehende Fackel', () => {
  it('ist ein eigenes Boden-Sprite: 16×32, Zylinder, Fußpunkt auf der untersten Zeile', () => {
    expect([fackelStand.id, fackelStand.group, fackelStand.w, fackelStand.h, fackelStand.hoehe]).toEqual(['fackel_stand', 'licht', 16, 32, 'zylinder']);
    expect(fackelStand.anchor).toEqual([8, 31]);
    for (const f of fackelStand.frames) {
      const [ax, ay] = fackelStand.anchor;
      const foot = f.index[ay * fackelStand.w + ax] ?? TRANSPARENT;
      expect(foot).not.toBe(TRANSPARENT);
      // Der Pfahl reicht bis auf den Boden: Holz direkt über der Fußzeile.
      expect(paletteRef(f.index[(ay - 1) * fackelStand.w + ax - 1] ?? TRANSPARENT).startsWith('holz.')).toBe(true);
    }
    expect(fackelWand.w).toBe(16);
    expect(fackelWand.h).toBe(16);
  });

  it('flackert in vier Frames im Takt der Wandfackel, Lichtsockel im emissiven Kern jedes Frames', () => {
    expect(fackelStand.frames).toHaveLength(4);
    expect(fackelStand.clips.idle).toEqual(fackelWand.clips.idle);
    const [lx, ly] = fackelStand.sockets.licht?.[0] ?? [0, 0];
    for (const f of fackelStand.frames) expect(f.emissive[ly * fackelStand.w + lx]).toBe(1);
  });

  it('die Flamme steht über Kopfhöhe der Spielfigur', () => {
    const [, ly] = fackelStand.sockets.licht?.[0] ?? [0, 0];
    const flame = fackelStand.anchor[1] - ly;
    const f0 = spieler.frames[0];
    expect(f0).toBeDefined();
    const head = spieler.anchor[1] - topRow(f0 as SpriteFrame, spieler.w, spieler.h);
    expect(flame).toBeLessThanOrEqual(head);
    expect(fackelStand.anchor[1] - topRow(fackelStand.frames[0] as SpriteFrame, fackelStand.w, fackelStand.h)).toBeGreaterThan(head);
  });

  it('nur Feuer leuchtet, Metall nur am Eisenring (nicht an den Keilsteinen), ≤ 12 Farben ohne Einzelpixel-Befund', () => {
    for (const f of fackelStand.frames) {
      const metalRows = new Set<number>();
      f.index.forEach((v, p) => {
        if (v === TRANSPARENT) return;
        const ref = paletteRef(v);
        expect(f.emissive[p], ref).toBe(ref.startsWith('feuer.') ? 1 : 0);
        if (((f.material[p] ?? 0) & MATERIAL_BITS.metall) !== 0) {
          expect(ref.startsWith('stein.'), ref).toBe(true);
          metalRows.add(Math.floor(p / fackelStand.w));
        }
      });
      expect(metalRows.size).toBe(1);
      const stones = Array.from(f.index).filter((v, p) => v !== TRANSPARENT && paletteRef(v).startsWith('stein.') && Math.floor(p / fackelStand.w) > fackelStand.anchor[1] - 4);
      expect(stones.length).toBeGreaterThan(0);
    }
    expect(spriteColorCount(fackelStand)).toBeLessThanOrEqual(MAX_SPRITE_COLORS);
    expect(checkSprite(fackelStand)).toEqual({ errors: [], warnings: [] });
  });
});
