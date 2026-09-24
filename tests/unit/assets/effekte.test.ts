/**
 * M3-10/M3-11/M3-12/M3-15 (Effekt-Sprites): Sammel-Partikel je Material, Staubwolke, Drop-Schatten und die
 * liegenden Stämme der Fall-Animation. Belegt am Pixel:
 * - Partikel: je Material ein eigenes Sprite mit ≥ 4 taumelnden Frames und Clip, in der Rampe seines
 *   Materials (Holz, Stein, Erde; Blätter in `gras`, damit die Jahreszeit-Zeile sie färbt); Funken
 *   leuchten und verglühen (Pixelzahl fällt, Clip ohne Schleife).
 * - Staubwolke: quillt auf und zerfasert (Pixelzahl steigt bis zur Mitte, fällt danach).
 * - Drop-Schatten: flach, nur `nacht`, im oberen Wippen kleiner.
 * - Stämme: je Baumart (14) liegend nach rechts (spiegelbar für links), nach Norden und nach Süden, mit
 *   Clips `liegen`/`zerfallen`, Sockel `basis`; Rinde in der Rampe des Stammes der Art, Schnittfläche in
 *   den Stumpffarben (nach Norden sichtbar); beim Zerfallen entstehen getrennte Stücke; Länge 26–44 px.
 * - Alle: 1 px Luft zum Zellrand, ≤ 12 Farben, keine Befunde des Paletten-Validators.
 */
import { describe, expect, it } from 'vitest';
import partikel from '../../../assets-src/sprites/effekte/partikel';
import dropSchatten from '../../../assets-src/sprites/effekte/drop_schatten';
import baumstaemme, { STAMM_ARTEN } from '../../../assets-src/sprites/effekte/baumstaemme';
import { STAMM_GRUPPE, STAMM_LAENGE, stammLaenge } from '../../../assets-src/sprites/baeume/_stamm';
import { components } from '../../../assets-src/lib/distance';
import { MAX_SPRITE_COLORS, TRANSPARENT, spriteColorCount, type Sprite, type SpriteFrame } from '../../../assets-src/lib/sprite';
import { paletteIndex, paletteRef } from '../../../assets-src/palette';
import { checkSprite } from '../../../tools/assets/spriteChecks';
import { WORLD_OBJECTS } from '../../../src/content/worldObjects';

const STAEMME: readonly Sprite[] = baumstaemme.flatMap((r) => r.sprites);
const ALLE: readonly Sprite[] = [...partikel, dropSchatten, ...STAEMME];

function sprite(liste: readonly Sprite[], id: string): Sprite {
  const s = liste.find((x) => x.id === id);
  if (s === undefined) throw new Error(`${id} fehlt`);
  return s;
}

function frame(s: Sprite, i: number): SpriteFrame {
  const f = s.frames[i];
  if (f === undefined) throw new Error(`${s.id}: Frame ${i} fehlt`);
  return f;
}

function deckend(f: SpriteFrame): number {
  return f.index.reduce((n, v) => n + (v !== TRANSPARENT ? 1 : 0), 0);
}

function rampen(s: Sprite): Set<string> {
  const out = new Set<string>();
  for (const f of s.frames) for (const v of f.index) if (v !== TRANSPARENT) out.add(paletteRef(v).split('.')[0] ?? '');
  return out;
}

describe('M3-15 Sammel-Partikel und Staubwolke', () => {
  it('je Material ein Partikel mit ≥ 4 Frames und Clip in der Rampe seines Materials', () => {
    const erwartet: ReadonlyArray<readonly [string, readonly string[]]> = [
      ['partikel_splitter', ['holz']],
      ['partikel_steinsplitter', ['stein', 'nacht']],
      ['partikel_funken', ['feuer']],
      ['partikel_blatt', ['gras']],
      ['partikel_erde', ['erde']],
    ];
    for (const [id, erlaubt] of erwartet) {
      const s = sprite(partikel, id);
      expect(s.frames.length, id).toBeGreaterThanOrEqual(4);
      expect(Object.keys(s.clips).length, id).toBe(1);
      expect(new Set(s.frames.map((f) => f.index.join(','))).size, id).toBe(s.frames.length);
      for (const r of rampen(s)) expect(erlaubt, `${id}: ${r}`).toContain(r);
    }
  });

  it('Funken leuchten vollständig und verglühen (Pixelzahl fällt, keine Schleife)', () => {
    const s = sprite(partikel, 'partikel_funken');
    for (const f of s.frames) f.index.forEach((v, p) => v !== TRANSPARENT && expect(f.emissive[p]).toBe(1));
    const n = s.frames.map(deckend);
    for (let i = 1; i < n.length; i++) expect(n[i] ?? 0).toBeLessThan(n[i - 1] ?? 0);
    expect(s.clips.verglimmen?.loop).toBe(false);
  });

  it('Staubwolke quillt auf und zerfasert', () => {
    const s = sprite(partikel, 'staubwolke');
    const n = s.frames.map(deckend);
    expect(n).toHaveLength(5);
    expect(n[1] ?? 0).toBeGreaterThan(n[0] ?? 0);
    expect(n[2] ?? 0).toBeGreaterThanOrEqual(n[1] ?? 0);
    expect(n[3] ?? 0).toBeLessThan(n[2] ?? 0);
    expect(n[4] ?? 0).toBeLessThan(n[3] ?? 0);
    expect(s.clips.aufwirbeln?.loop).toBe(false);
  });

  it('Drop-Schatten: flach, nur nacht, im oberen Wippen kleiner', () => {
    expect(dropSchatten.hoehe).toBe('flach');
    expect([...rampen(dropSchatten)]).toEqual(['nacht']);
    expect(deckend(frame(dropSchatten, 1))).toBeLessThan(deckend(frame(dropSchatten, 0)));
    expect(dropSchatten.clips.wippen?.frames).toEqual([0, 0, 1, 1]);
  });
});

describe('M3-11 liegende Stämme der Fall-Animation', () => {
  it('alle 14 Baumarten der Welt-Objekte, je nach rechts (spiegelbar), Norden und Süden', () => {
    const arten = WORLD_OBJECTS.filter((o) => o.kind === 'baum').map((o) => o.id.replace(/^baum_/, ''));
    expect(arten).toHaveLength(14);
    expect(STAMM_ARTEN.map((a) => a.art).sort()).toEqual([...arten].sort());
    for (const a of arten) {
      const quer = sprite(STAEMME, `baum_stamm_${a}`);
      expect(quer.spiegelbar, a).toBe(true);
      expect(quer.w, a).toBeGreaterThan(quer.h);
      for (const r of ['nord', 'sued']) {
        const s = sprite(STAEMME, `baum_stamm_${a}_${r}`);
        expect(s.spiegelbar, s.id).toBe(false);
        expect(s.h, s.id).toBeGreaterThan(s.w);
      }
    }
    expect(STAEMME).toHaveLength(42);
    for (const s of STAEMME) {
      expect(s.group, s.id).toBe(STAMM_GRUPPE);
      expect(Object.keys(s.clips).sort(), s.id).toEqual(['liegen', 'zerfallen']);
      expect(s.clips.zerfallen?.loop, s.id).toBe(false);
      expect(s.sockets.basis, s.id).toBeDefined();
    }
  });

  it('Rinde in der Rampe des Stammes der Art, Schnittfläche in den Stumpffarben, Länge nach Baumhöhe', () => {
    for (const a of STAMM_ARTEN) {
      const laenge = stammLaenge(a);
      expect(laenge, a.art).toBeGreaterThanOrEqual(STAMM_LAENGE.min);
      expect(laenge, a.art).toBeLessThanOrEqual(STAMM_LAENGE.max);
      const mitte = paletteIndex(a.stamm.farben.mitte.replace('*', ''));
      const schnitt = [a.stumpf.schnitt.kern, a.stumpf.schnitt.ring].map((r) => paletteIndex(r.replace('*', '')));
      for (const id of [`baum_stamm_${a.art}`, `baum_stamm_${a.art}_nord`]) {
        const f = frame(sprite(STAEMME, id), 0);
        expect(f.index.filter((v) => v === mitte).length, `${id} Rinde`).toBeGreaterThanOrEqual(20);
        expect(schnitt.some((v) => f.index.includes(v)), `${id} Schnittfläche`).toBe(true);
      }
      const quer = sprite(STAEMME, `baum_stamm_${a.art}`);
      expect(quer.w - 6, a.art).toBe(laenge);
    }
  });

  it('beim Zerfallen entstehen getrennte Stücke (Risse, dann Lücken)', () => {
    for (const s of STAEMME) {
      const teile = s.frames.map((f) => components(Uint8Array.from(f.index, (v) => (v === TRANSPARENT ? 0 : 1)), s.w, s.h).count);
      expect(teile[2] ?? 0, s.id).toBeGreaterThanOrEqual((teile[0] ?? 0) + 2);
      expect(frame(s, 1).index.join(','), s.id).not.toBe(frame(s, 0).index.join(','));
    }
  });
});

describe('Effekt-Sprites gesamt', () => {
  it('1 px Luft zum Zellrand, ≤ 12 Farben ohne Ausnahme, keine Befunde', () => {
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
