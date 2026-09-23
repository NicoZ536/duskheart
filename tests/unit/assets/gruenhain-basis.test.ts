/**
 * M1-22: erste Sprite-Serie (Grünhain-Grundtiles, Felsen, Laubbaum, Wandfackel, Spieler-Grundkörper).
 * Prüft die handwerklichen Verträge aus docs/ART.md, die sich am Pixel belegen lassen: Größen und
 * Höhen-Hinweise, Farbgrenze ohne verwaiste Einzelpixel, nahtlose Kacheln (Rand in Grundfarbe,
 * Übergangsverlauf stößt an sich selbst an), Blätterdach nur auf der Krone, Idle-Clips mit Sockeln.
 */
import { describe, expect, it } from 'vitest';
import baumLaub from '../../../assets-src/sprites/gruenhain_basis/baum_laub';
import bodenErde from '../../../assets-src/sprites/gruenhain_basis/boden_erde';
import bodenGras from '../../../assets-src/sprites/gruenhain_basis/boden_gras';
import bodenKante from '../../../assets-src/sprites/gruenhain_basis/boden_gras_kante';
import felsen from '../../../assets-src/sprites/gruenhain_basis/felsen';
import spieler from '../../../assets-src/sprites/figuren/spieler_koerper';
import fackelWand from '../../../assets-src/sprites/licht/fackel_wand';
import { MATERIAL_BITS, MAX_SPRITE_COLORS, TRANSPARENT, spriteColorCount, spriteHasEmissive, type Sprite, type SpriteFrame } from '../../../assets-src/lib/sprite';
import { paletteRef } from '../../../assets-src/palette';
import { checkSprite } from '../../../tools/assets/spriteChecks';

const TILE = 16;
/** Mindestanteil der Grundfarbe am Kachelrand (docs/ART.md §3: Varianten treffen sich auf Grundfarbe). */
const MIN_BORDER_BASE_SHARE = 0.8;
/** Höchster Sprung des Übergangsverlaufs zwischen gegenüberliegenden Kanten (px). */
const MAX_PROFILE_JUMP = 1;

const [felsKlein, felsGross] = felsen;
const SERIE: readonly Sprite[] = [bodenGras, bodenErde, bodenKante, felsKlein, felsGross, baumLaub, fackelWand, spieler].filter((s): s is Sprite => s !== undefined);

function frame(s: Sprite, i: number): SpriteFrame {
  const f = s.frames[i];
  if (f === undefined) throw new Error(`${s.id}: Frame ${i} fehlt`);
  return f;
}

function rampAt(f: SpriteFrame, w: number, x: number, y: number): string {
  const v = f.index[y * w + x] ?? TRANSPARENT;
  return v === TRANSPARENT ? '' : (paletteRef(v).split('.')[0] ?? '');
}

/** Randpixel (Zeile 0/15, Spalte 0/15) einer Kachel. */
function border(f: SpriteFrame): number[] {
  const out: number[] = [];
  for (let i = 0; i < TILE; i++) out.push(f.index[i] ?? 0, f.index[(TILE - 1) * TILE + i] ?? 0, f.index[i * TILE] ?? 0, f.index[i * TILE + TILE - 1] ?? 0);
  return out;
}

function mostCommon(values: readonly number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
}

describe('M1-22 Sprite-Serie', () => {
  it('enthält alle Sprites mit Größe, Gruppe und Höhen-Hinweis nach docs/ART.md §2.7/§3', () => {
    expect(felsKlein).toBeDefined();
    expect(felsGross).toBeDefined();
    const meta = SERIE.map((s) => [s.id, s.group, s.w, s.h, s.hoehe]);
    expect(meta).toEqual([
      ['boden_gras', 'gruenhain_basis', 16, 16, 'flach'],
      ['boden_erde', 'gruenhain_basis', 16, 16, 'flach'],
      ['boden_gras_kante', 'gruenhain_basis', 16, 16, 'flach'],
      ['fels_klein', 'gruenhain_basis', 16, 16, 'block'],
      ['fels_gross', 'gruenhain_basis', 32, 32, 'block'],
      ['baum_laub', 'gruenhain_basis', 48, 64, 'kugel'],
      ['fackel_wand', 'licht', 16, 16, 'zylinder'],
      ['spieler_koerper', 'figuren', 32, 32, 'zylinder'],
    ]);
  });

  it('bleibt je Sprite bei ≤ 12 Farben ohne Paletten- oder Einzelpixel-Befund', () => {
    for (const s of SERIE) {
      expect(spriteColorCount(s), s.id).toBeLessThanOrEqual(MAX_SPRITE_COLORS);
      expect(s.ausnahmeFarben, s.id).toBeNull();
      expect(checkSprite(s), s.id).toEqual({ errors: [], warnings: [] });
    }
  });
});

describe('Bodentiles', () => {
  it('Gras und Erde haben 3–4 voll deckende Varianten, deren Rand überwiegend die Grundfarbe ist', () => {
    for (const s of [bodenGras, bodenErde]) {
      expect(s.frames.length, s.id).toBeGreaterThanOrEqual(3);
      expect(s.frames.length, s.id).toBeLessThanOrEqual(4);
      const base = mostCommon(s.frames.flatMap((f) => [...f.index]));
      for (const f of s.frames) {
        expect(f.index.every((v) => v !== TRANSPARENT), s.id).toBe(true);
        const b = border(f);
        expect(b.filter((v) => v === base).length / b.length, s.id).toBeGreaterThanOrEqual(MIN_BORDER_BASE_SHARE);
      }
    }
  });

  it('Übergang: Grasseite in gras, Erdseite in erde; der Verlauf stößt an sich selbst nahtlos an', () => {
    // Frames: Gras oben, unten, links, rechts. `along` läuft entlang der Kante, `across` quer dazu.
    const sides = [
      { i: 0, vertical: true, grassFirst: true },
      { i: 1, vertical: true, grassFirst: false },
      { i: 2, vertical: false, grassFirst: true },
      { i: 3, vertical: false, grassFirst: false },
    ] as const;
    expect(bodenKante.frames).toHaveLength(sides.length);
    for (const side of sides) {
      const f = frame(bodenKante, side.i);
      const at = (along: number, across: number): string => (side.vertical ? rampAt(f, TILE, along, across) : rampAt(f, TILE, across, along));
      const first = side.grassFirst ? 'gras' : 'erde';
      const last = side.grassFirst ? 'erde' : 'gras';
      // Übergang je Linie: erster Pixel (quer), der nicht mehr zur ersten Seite gehört.
      const profile = Array.from({ length: TILE }, (_, along) => {
        let c = 0;
        while (c < TILE && at(along, c) === first) c++;
        return c;
      });
      for (let along = 0; along < TILE; along++) {
        expect(at(along, 0), `Frame ${side.i}`).toBe(first);
        expect(at(along, TILE - 1), `Frame ${side.i}`).toBe(last);
      }
      expect(Math.abs((profile[0] ?? 0) - (profile[TILE - 1] ?? 0)), `Frame ${side.i}: Verlauf an der Kachelnaht`).toBeLessThanOrEqual(MAX_PROFILE_JUMP);
    }
  });
});

describe('Objekte', () => {
  it('Felsen: Occluder-Ellipse über der Standfläche, Anker auf der Fußzeile', () => {
    for (const s of [felsKlein, felsGross]) {
      if (s === undefined) throw new Error('Fels fehlt');
      expect(s.occluder.kind, s.id).toBe('ellipse');
      const f = frame(s, 0);
      const footRow = Array.from({ length: s.w }, (_, x) => f.index[s.anchor[1] * s.w + x] ?? 0);
      expect(footRow.some((v) => v !== TRANSPARENT), s.id).toBe(true);
      expect(Array.from({ length: s.w }, (_, x) => f.index[(s.anchor[1] + 1) * s.w + x] ?? 0).every((v) => v === TRANSPARENT), s.id).toBe(true);
    }
  });

  it('Laubbaum ≥ 32×48: nur die Krone trägt Blätterdach und Wind, der Occluder sitzt am Stamm', () => {
    expect(baumLaub.w).toBeGreaterThanOrEqual(32);
    expect(baumLaub.h).toBeGreaterThanOrEqual(48);
    const f = frame(baumLaub, 0);
    const canopy = MATERIAL_BITS.dach | MATERIAL_BITS.wind;
    f.index.forEach((v, p) => {
      if (v === TRANSPARENT) return;
      const ramp = paletteRef(v).split('.')[0];
      expect(f.material[p], `${ramp} bei ${p % baumLaub.w}, ${Math.floor(p / baumLaub.w)}`).toBe(ramp === 'gras' ? canopy : 0);
    });
    expect(baumLaub.occluder.kind).toBe('ellipse');
    if (baumLaub.occluder.kind !== 'ellipse') return;
    const { x, y } = baumLaub.occluder;
    const trunk = f.index[Math.floor(y) * baumLaub.w + Math.floor(x)] ?? TRANSPARENT;
    expect(paletteRef(trunk).startsWith('holz.')).toBe(true);
  });

  it('Wandfackel: vier Flammen-Frames, emissiv, Lichtsockel in der Flamme', () => {
    expect(fackelWand.frames).toHaveLength(4);
    expect(spriteHasEmissive(fackelWand)).toBe(true);
    const [lx, ly] = fackelWand.sockets.licht?.[0] ?? [0, 0];
    for (const f of fackelWand.frames) expect(f.emissive[ly * fackelWand.w + lx]).toBe(1);
  });
});

describe('Spieler-Grundkörper', () => {
  const DIRS = ['down', 'up', 'left', 'right'] as const;
  /** Hände, die in der Richtung sichtbar sind (im Profil liegt die ferne Hand hinter dem Körper). */
  const VISIBLE_HANDS: Readonly<Record<(typeof DIRS)[number], readonly ('hand' | 'nebenhand')[]>> = {
    down: ['hand', 'nebenhand'],
    up: ['hand', 'nebenhand'],
    right: ['hand'],
    left: ['nebenhand'],
  };

  it('Idle in vier Richtungen mit je 4 eigenen Frames, 8 fps, nicht spiegelbar', () => {
    expect(spieler.spiegelbar).toBe(false);
    const used = new Set<number>();
    for (const d of DIRS) {
      const clip = spieler.clips[`idle_${d}`];
      expect(clip, d).toBeDefined();
      if (clip === undefined) continue;
      expect(clip.fps).toBe(8);
      expect(clip.loop).toBe(true);
      const unique = new Set(clip.frames);
      expect(unique.size, d).toBe(4);
      for (const f of unique) {
        expect(used.has(f), `Frame ${f} doppelt genutzt`).toBe(false);
        used.add(f);
      }
    }
    expect(used.size).toBe(spieler.frames.length);
  });

  it('Körper ≈ 16×24 in der 32×32-Zelle, Füße auf der Ankerzeile', () => {
    for (const f of spieler.frames) {
      let x0 = spieler.w;
      let x1 = -1;
      let y0 = spieler.h;
      let y1 = -1;
      f.index.forEach((v, p) => {
        if (v === TRANSPARENT) return;
        const x = p % spieler.w;
        const y = Math.floor(p / spieler.w);
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      });
      expect(x1 - x0 + 1).toBeGreaterThanOrEqual(14);
      expect(x1 - x0 + 1).toBeLessThanOrEqual(18);
      expect(y1 - y0 + 1).toBeGreaterThanOrEqual(22);
      expect(y1 - y0 + 1).toBeLessThanOrEqual(24);
      expect(y1).toBe(spieler.anchor[1]);
    }
  });

  it('Hand-Sockel je Frame liegen auf der sichtbaren Hand (Haut)', () => {
    DIRS.forEach((d) => {
      const clip = spieler.clips[`idle_${d}`];
      for (const fi of new Set(clip?.frames ?? [])) {
        for (const socket of VISIBLE_HANDS[d]) {
          const p = spieler.sockets[socket]?.[fi];
          expect(p, `${d} ${socket} Frame ${fi}`).toBeDefined();
          if (p === undefined) continue;
          const v = frame(spieler, fi).index[p[1] * spieler.w + p[0]] ?? TRANSPARENT;
          expect(v === TRANSPARENT ? '' : paletteRef(v), `${d} ${socket} Frame ${fi}`).toMatch(/^haut\./);
        }
      }
    });
  });
});
