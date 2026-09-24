/**
 * M3-16/M3-22/M3-24/M3-26: platzierbare Welt-Sprites. Belegt am Pixel:
 * - `lagerfeuer`: Zustände nach Brennstoff als Clips (aus, brennt, schwach, glut, asche), Flammen mit
 *   10–12 fps; nur Feuer leuchtet, und zwar genau in den brennenden/glimmenden Frames; volles Feuer >
 *   schwaches Feuer > Glut; der Lichtsockel liegt in jedem brennenden Frame im hellen Flammenkern, die
 *   Flammenspitzen sind dunkler als der Kern; Steinring und Scheite bleiben in allen Frames stehen.
 * - `werkbank`, `grasbett`, `grab`: Ids = Item-/Objekt-Ids, Sockel für Arbeit, Liegen und Kartenmarker;
 *   das Grab weht in drei verschiedenen Frames, nur das Tuch bewegt sich und es trägt die Kleidungsrampe.
 * - Alle: 1 px Luft zum Zellrand, ≤ 12 Farben, keine Befunde des Paletten-Validators.
 */
import { describe, expect, it } from 'vitest';
import grab from '../../../assets-src/sprites/platzierbar/grab';
import grasbett from '../../../assets-src/sprites/platzierbar/grasbett';
import lagerfeuer from '../../../assets-src/sprites/platzierbar/lagerfeuer';
import werkbank from '../../../assets-src/sprites/platzierbar/werkbank';
import fackelWand from '../../../assets-src/sprites/licht/fackel_wand';
import { MAX_SPRITE_COLORS, TRANSPARENT, spriteColorCount, type Sprite, type SpriteFrame } from '../../../assets-src/lib/sprite';
import { paletteRef } from '../../../assets-src/palette';
import { checkSprite } from '../../../tools/assets/spriteChecks';

const ALLE: readonly Sprite[] = [lagerfeuer, werkbank, grasbett, grab];

function frame(s: Sprite, i: number): SpriteFrame {
  const f = s.frames[i];
  if (f === undefined) throw new Error(`${s.id}: Frame ${i} fehlt`);
  return f;
}

function leuchtend(f: SpriteFrame): number {
  let n = 0;
  f.index.forEach((v, p) => {
    if (v !== TRANSPARENT && (f.emissive[p] ?? 0) > 0) n++;
  });
  return n;
}

function stufe(v: number): number {
  return Number(paletteRef(v).split('.')[1] ?? -1);
}

describe('M3-16/M3-22 Lagerfeuer', () => {
  const clip = (name: string): readonly number[] => lagerfeuer.clips[name]?.frames ?? [];

  it('Zustände als Clips: aus, brennt (6 Frames), schwach (4), glut, asche – Flammen mit 10–12 fps', () => {
    expect(Object.keys(lagerfeuer.clips).sort()).toEqual(['asche', 'aus', 'brennt', 'glut', 'schwach']);
    expect(new Set(clip('brennt')).size).toBe(6);
    expect(new Set(clip('schwach')).size).toBe(4);
    expect(new Set(clip('glut')).size).toBe(2);
    for (const name of ['brennt', 'schwach']) {
      const fps = lagerfeuer.clips[name]?.fps ?? 0;
      expect(fps, name).toBeGreaterThanOrEqual(10);
      expect(fps, name).toBeLessThanOrEqual(12);
    }
    // Jeder Flammen-Frame ist eine eigene Zeichnung (kein Standbild im Clip).
    const bilder = new Set(clip('brennt').map((i) => frame(lagerfeuer, i).index.join(',')));
    expect(bilder.size).toBe(6);
    expect([lagerfeuer.w, lagerfeuer.h]).toEqual([32, 32]);
  });

  it('nur Feuer leuchtet – in brennt, schwach und glut; aus und asche sind dunkel; voll > schwach > Glut', () => {
    lagerfeuer.frames.forEach((f, i) =>
      f.index.forEach((v, p) => {
        if (v === TRANSPARENT) return;
        const ref = paletteRef(v);
        expect(f.emissive[p], `Frame ${i} ${ref}`).toBe(ref.startsWith('feuer.') ? 1 : 0);
      }),
    );
    for (const name of ['aus', 'asche']) for (const i of clip(name)) expect(leuchtend(frame(lagerfeuer, i)), name).toBe(0);
    const mittel = (name: string): number => clip(name).reduce((n, i) => n + leuchtend(frame(lagerfeuer, i)), 0) / clip(name).length;
    expect(mittel('glut')).toBeGreaterThan(0);
    expect(mittel('schwach')).toBeGreaterThan(mittel('glut') * 2);
    expect(mittel('brennt')).toBeGreaterThan(mittel('schwach') * 1.5);
  });

  it('Lichtsockel im hellen Kern jedes brennenden Frames; Spitzen dunkler als der Kern', () => {
    const licht = lagerfeuer.sockets.licht ?? [];
    expect(licht).toHaveLength(lagerfeuer.frames.length);
    for (const name of ['brennt', 'schwach', 'glut']) {
      for (const i of clip(name)) {
        const f = frame(lagerfeuer, i);
        const [x, y] = licht[i] ?? [0, 0];
        const p = y * lagerfeuer.w + x;
        expect(f.emissive[p], `${name} ${i}`).toBe(1);
        if (name === 'glut') continue;
        const kern = stufe(f.index[p] ?? 0);
        expect(kern, `${name} ${i}`).toBeGreaterThanOrEqual(3);
        // Oberstes leuchtendes Pixel der Flamme (Funken ohne leuchtenden Nachbarn zählen nicht) ist dunkler als der Kern.
        const glueht = (q: number): boolean => (f.index[q] ?? TRANSPARENT) !== TRANSPARENT && (f.emissive[q] ?? 0) > 0;
        const oben = f.index.findIndex((_, q) => {
          if (!glueht(q)) return false;
          const qx = q % lagerfeuer.w;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx !== 0 || dy !== 0) && qx + dx >= 0 && qx + dx < lagerfeuer.w && glueht(q + dy * lagerfeuer.w + dx)) return true;
          return false;
        });
        expect(stufe(f.index[oben] ?? 0), `${name} ${i} Spitze`).toBeLessThan(kern);
      }
    }
  });

  it('der vordere Steinring bleibt in allen Frames unverändert (Flammen und Glut liegen dahinter)', () => {
    const f0 = frame(lagerfeuer, 0);
    let steine = 0;
    for (let p = 23 * lagerfeuer.w; p < f0.index.length; p++) {
      const v = f0.index[p] ?? TRANSPARENT;
      if (v === TRANSPARENT || !paletteRef(v).startsWith('stein.')) continue;
      steine++;
      for (const f of lagerfeuer.frames) expect(f.index[p], `Pixel ${p}`).toBe(v);
    }
    expect(steine).toBeGreaterThan(60);
  });
});

describe('M3-16/M3-24/M3-26 Werkbank, Grasbett, Grab', () => {
  it('Ids wie die Items bzw. das Grab-Objekt, Gruppe platzierbar, Sockel für Arbeit, Liegen und Marker', () => {
    expect(ALLE.map((s) => [s.id, s.group])).toEqual([
      ['lagerfeuer', 'platzierbar'],
      ['werkbank', 'platzierbar'],
      ['grasbett', 'platzierbar'],
      ['grab', 'platzierbar'],
    ]);
    expect(werkbank.sockets.arbeit).toBeDefined();
    expect(grasbett.sockets.kopf).toBeDefined();
    expect(grasbett.sockets.liegen).toBeDefined();
    expect(grab.sockets.marker).toBeDefined();
    // Das Grasbett ist länger als breit (die Figur liegt mit dem Kopf oben) und hat Platz für den 16 px breiten Körper.
    expect(grasbett.h).toBeGreaterThan(grasbett.w);
    expect(grasbett.w).toBeGreaterThanOrEqual(20);
  });

  it('Grab: drei verschiedene Frames im Clip wehen, nur das Tuch (Kleidungsrampe wasser) bewegt sich', () => {
    expect(grab.frames).toHaveLength(3);
    expect(grab.clips.wehen?.frames).toEqual([0, 1, 2, 1]);
    expect(new Set(grab.frames.map((f) => f.index.join(','))).size).toBe(3);
    const f0 = frame(grab, 0);
    for (const f of grab.frames) {
      f.index.forEach((v, p) => {
        const a = f0.index[p] ?? TRANSPARENT;
        if (v === a) return;
        const refs = [v, a].filter((x) => x !== TRANSPARENT).map((x) => paletteRef(x));
        // Unterschiede nur am Tuch und seiner Kontur.
        for (const r of refs) expect(r.startsWith('wasser.') || r === 'nacht.1', r).toBe(true);
      });
    }
    expect(f0.index.some((v) => v !== TRANSPARENT && paletteRef(v).startsWith('wasser.'))).toBe(true);
  });

  it('die Wandfackel aus M1 steht weiter bereit (16×16, leuchtende Flamme, Clip idle)', () => {
    expect([fackelWand.id, fackelWand.w, fackelWand.h]).toEqual(['fackel_wand', 16, 16]);
    expect(fackelWand.clips.idle?.frames.length).toBe(4);
    expect(leuchtend(frame(fackelWand, 0))).toBeGreaterThan(0);
  });

  it('alle: 1 px Luft zum Zellrand, ≤ 12 Farben ohne Ausnahme, keine Befunde', () => {
    for (const s of ALLE) {
      for (const f of s.frames) {
        for (let y = 0; y < s.h; y++) {
          for (let x = 0; x < s.w; x++) {
            if (x > 0 && y > 0 && x < s.w - 1 && y < s.h - 1) continue;
            expect(f.index[y * s.w + x], `${s.id} (${x}, ${y})`).toBe(TRANSPARENT);
          }
        }
      }
      expect(spriteColorCount(s), s.id).toBeLessThanOrEqual(MAX_SPRITE_COLORS);
      expect(s.ausnahmeFarben, s.id).toBeNull();
      expect(checkSprite(s), s.id).toEqual({ errors: [], warnings: [] });
    }
  });
});
