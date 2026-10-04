/**
 * Keine Krümel beim Formen und Zerfallen der Schattenbrut (M6-Gate visual:materialize-orphan-pixels; MASTERPROMPT §4.5
 * „keine verwaisten Einzelpixel“, §31.5 Artefakte; src/render/batch/materialize.ts `materializeMask`, der CPU-Spiegel des
 * Rauchzweigs von sprite_gbuffer.frag): an echten Brut-Frames des Spielatlas, gespiegelt und ungespiegelt, an mehreren
 * Weltorten, Zeiten und Ausblendstufen
 * - gibt es kein sichtbares Pixel ohne sichtbaren Nachbarn (8er-Nachbarschaft) und keinen einzelnen glühenden Randpixel;
 * - die Regel davor (Schwelle je Pixelzeile, keine Krümelregel) ließ beides stehen – die Reproduktion des Befunds;
 * - ein 2 × 2-Cluster hat eine Schwelle: alle seine Pixel zeigen dasselbe.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { MATERIALIZE, SMOKE_PIXEL, materializeMask, materializePixel, smokeRowShare, smokeThreshold, type SmokeFrame } from '../../../src/render/batch/materialize';
import { decodePng } from '../../../tools/lib/png';

const MOD = (() => {
  const m = generatedAtlasModule();
  if (m === null) throw new Error('Spielatlas fehlt – npm run assets');
  return m;
})();
const MANIFEST = manifestFromGenerated(MOD);
const ALBEDO = decodePng(readFileSync(join(process.cwd(), 'public', MOD.ATLAS.albedoUrl)));

/** Frame `index` of clip `clip` of `sprite` as the smoke sees it, its anchor at world (wx, wy). */
function frameOf(sprite: string, clip: string, index: number, wx: number, wy: number, mirrored: boolean): SmokeFrame {
  const s = MANIFEST.sprites[sprite];
  const c = s?.clips[clip];
  const f = s?.frames[c?.frames[index] ?? -1];
  if (f === undefined) throw new Error(`${sprite}: kein Frame ${clip}[${index}]`);
  const opaque = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < f.w && y < f.h && (ALBEDO.rgba[((f.y + y) * ALBEDO.width + f.x + x) * 4 + 3] as number) > 127;
  return { w: f.w, h: f.h, opaque, anchorX: f.ax, anchorY: f.ay, worldX: wx, worldY: wy, mirrored };
}

/** The rule before the fix: a threshold per pixel row, no crumb rule (what `schattenbrut-materialisierung` showed). */
function oldMask(frame: SmokeFrame, fade: number, seconds: number, out: Uint8Array): void {
  for (let ly = 0; ly < frame.h; ly++) {
    for (let lx = 0; lx < frame.w; lx++) {
      let v: number = SMOKE_PIXEL.none;
      if (frame.opaque(lx, ly)) {
        const local = lx + 0.5;
        const x = frame.worldX + (frame.mirrored ? frame.anchorX - local : local - frame.anchorX);
        const y = frame.worldY + (ly + 0.5 - frame.anchorY);
        const k = materializePixel(smokeThreshold(x, y, (ly + 0.5) / frame.h, seconds), fade);
        v = k === 'weg' ? SMOKE_PIXEL.none : k === 'rand' ? SMOKE_PIXEL.rim : SMOKE_PIXEL.body;
      }
      out[ly * frame.w + lx] = v;
    }
  }
}

/** Visible pixels without a visible 8-neighbour, and rim pixels without a rim 8-neighbour. */
function crumbs(mask: Uint8Array, w: number, h: number): { isolated: number; lonelyRim: number } {
  let isolated = 0;
  let lonelyRim = 0;
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : (mask[y * w + x] as number));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = at(x, y);
      if (v === SMOKE_PIXEL.none) continue;
      let seen = 0;
      let rims = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const n = at(x + dx, y + dy);
          if (n !== SMOKE_PIXEL.none) seen++;
          if (n === SMOKE_PIXEL.rim) rims++;
        }
      }
      if (seen === 0) isolated++;
      if (v === SMOKE_PIXEL.rim && rims === 0) lonelyRim++;
    }
  }
  return { isolated, lonelyRim };
}

const SPRITES = ['kreatur_kriecher', 'kreatur_speier', 'kreatur_schleicher', 'kreatur_lichtfresser', 'kreatur_nachtmahr'] as const;
const CLIPS = ['idle_down', 'idle_right', 'move_up'] as const;
const PLACES: readonly (readonly [number, number])[] = [
  [403, 211],
  [1000, 77],
  [-317, 520],
];
const TIMES = [0, 0.37, 1.13] as const;

/** Sums the crumbs of `mask` over every case (sprite, clip, mirroring, place, time, fade 0.05 … 0.95). */
function sweep(mask: (frame: SmokeFrame, fade: number, seconds: number, out: Uint8Array) => void): { isolated: number; lonelyRim: number; cases: number } {
  let isolated = 0;
  let lonelyRim = 0;
  let cases = 0;
  const out = new Uint8Array(64 * 64);
  for (const sprite of SPRITES) {
    for (const clip of CLIPS) {
      for (const mirrored of [false, true]) {
        for (const [wx, wy] of PLACES) {
          const frame = frameOf(sprite, clip, 0, wx, wy, mirrored);
          for (const t of TIMES) {
            for (let k = 1; k <= 19; k++) {
              mask(frame, k / 20, t, out);
              const c = crumbs(out, frame.w, frame.h);
              isolated += c.isolated;
              lonelyRim += c.lonelyRim;
              cases++;
            }
          }
        }
      }
    }
  }
  return { isolated, lonelyRim, cases };
}

describe('Rauch ohne Krümel (materializeMask)', () => {
  it('die Cluster sind 2 × 2 Pixel groß (die Krümelregel kennt genau einen Partner je Achse)', () => {
    expect(MATERIALIZE.cellPx).toBe(2);
  });

  it('vorher: die Schwelle je Pixelzeile ließ einzelne Pixel und einzelne Randpixel stehen (Reproduktion)', () => {
    const before = sweep(oldMask);
    expect(before.isolated).toBeGreaterThan(0);
    expect(before.lonelyRim).toBeGreaterThan(0);
  });

  it('jetzt: kein sichtbares Pixel ohne Nachbarn, kein einzelner glühender Randpixel – in jedem Fall', () => {
    const after = sweep(materializeMask);
    expect(after.cases).toBe(SPRITES.length * CLIPS.length * 2 * PLACES.length * TIMES.length * 19);
    expect(after).toMatchObject({ isolated: 0, lonelyRim: 0 });
  });

  it('ein Cluster hat eine Schwelle: die beiden Zeilen eines 2 × 2-Feldes im steigenden Rauch teilen sie', () => {
    for (const t of TIMES) {
      for (let y = 100; y < 140; y++) {
        const h = 32;
        const field = y + 0.5 + t * MATERIALIZE.risePxPerSecond;
        // The row partner in the same cell of the rising field.
        const partner = field - Math.floor(field / 2) * 2 < 1 ? 1 : -1;
        const a = smokeThreshold(40.5, y + 0.5, smokeRowShare(y + 0.5, 10.5, h, t), t);
        const b = smokeThreshold(40.5, y + partner + 0.5, smokeRowShare(y + partner + 0.5, 10.5 + partner, h, t), t);
        expect(b).toBe(a);
      }
    }
  });

  it('ganz geformt (Ausblenden 0) zeigt der Frame jedes deckende Pixel als Körper', () => {
    const frame = frameOf('kreatur_speier', 'idle_down', 0, 403, 211, false);
    const out = new Uint8Array(frame.w * frame.h);
    materializeMask(frame, 0, 0.5, out);
    for (let y = 0; y < frame.h; y++) for (let x = 0; x < frame.w; x++) expect(out[y * frame.w + x]).toBe(frame.opaque(x, y) ? SMOKE_PIXEL.body : SMOKE_PIXEL.none);
  });
});
