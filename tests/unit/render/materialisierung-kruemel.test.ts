/**
 * Keine Krümel und keine Inseln beim Formen und Zerfallen der Schattenbrut (M6-Gate visual:materialize-orphan-pixels,
 * M6-Gate-Bildprüfung `schattenbrut-materialisierung`; MASTERPROMPT §4.5 „keine verwaisten Einzelpixel“, §31.5 Artefakte;
 * src/render/batch/materialize.ts `materializeMask`, der CPU-Spiegel des Rauchzweigs von sprite_gbuffer.frag): an echten
 * Brut-Frames des Spielatlas, gespiegelt und ungespiegelt, an mehreren Weltorten, Zeiten und Ausblendstufen
 * - gibt es kein sichtbares Pixel ohne sichtbaren Nachbarn (8er-Nachbarschaft) und keinen einzelnen glühenden Randpixel;
 * - hängt jedes sichtbare Pixel am Körper, der vom Boden aufsteigt: in jeder Spalte folgen von unten nur Körper, Rand,
 *   Rauchzunge, nichts; kein Rand steht über einer Lücke, jedes zusammenhängende Stück reicht bis zum Fuß seiner Spalte;
 * - die Regeln davor ließen beides stehen – die Reproduktionen der Befunde: die Schwelle je Pixelzeile Krümel, die Schwelle
 *   aus 2D-Rauschen und Höhe (ADR-0169) abgelöste Randinseln über dem Körper (das violette „!“ über dem Schleicher);
 * - ein 2 × 2-Cluster hat eine Schwelle: alle seine Pixel zeigen dasselbe.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { MATERIALIZE, SMOKE_PIXEL, materializeMask, smokeFront, smokeRowShare, smokeThreshold, type SmokeFrame } from '../../../src/render/batch/materialize';
import { clusterNoise } from '../../../src/render/surface/rules';
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

/**
 * The smoke threshold of the rules before the gate's picture review (ADR-0113, ADR-0169): the rising 2D cluster noise of
 * the pixel mixed with its row share at weight 0,35, a rim band 0,1 above the fade.
 */
const OLD = { heightWeight: 0.35, edge: 0.1 } as const;
function oldThreshold(x: number, y: number, rowShare: number, seconds: number): number {
  const M = MATERIALIZE;
  const n = clusterNoise(x, y + seconds * M.risePxPerSecond, M.wavelengthPx, M.detailPx, M.cellPx, M.salt);
  return n * (1 - OLD.heightWeight) + rowShare * OLD.heightWeight;
}

function oldKind(threshold: number, fade: number): number {
  if (threshold < fade) return SMOKE_PIXEL.none;
  return threshold < fade + OLD.edge ? SMOKE_PIXEL.rim : SMOKE_PIXEL.body;
}

/** The rule of ADR-0113: a threshold per pixel row, no crumb rule (what `schattenbrut-materialisierung` showed first). */
function oldMask(frame: SmokeFrame, fade: number, seconds: number, out: Uint8Array): void {
  for (let ly = 0; ly < frame.h; ly++) {
    for (let lx = 0; lx < frame.w; lx++) {
      let v: number = SMOKE_PIXEL.none;
      if (frame.opaque(lx, ly)) {
        const local = lx + 0.5;
        const x = frame.worldX + (frame.mirrored ? frame.anchorX - local : local - frame.anchorX);
        const y = frame.worldY + (ly + 0.5 - frame.anchorY);
        v = oldKind(oldThreshold(x, y, (ly + 0.5) / frame.h, seconds), fade);
      }
      out[ly * frame.w + lx] = v;
    }
  }
}

/**
 * The rule of ADR-0169: the 2D threshold per 2 × 2 cluster with the crumb rule – no crumbs, but islands of rim and body
 * above the front (the gate's picture of `schattenbrut-materialisierung`).
 */
function adr0169Mask(frame: SmokeFrame, fade: number, seconds: number, out: Uint8Array): void {
  const wx = (lx: number): number => frame.worldX + (frame.mirrored ? frame.anchorX - (lx + 0.5) : lx + 0.5 - frame.anchorX);
  const wy = (ly: number): number => frame.worldY + (ly + 0.5 - frame.anchorY);
  const th = (lx: number, ly: number): number => oldThreshold(wx(lx), wy(ly), smokeRowShare(wy(ly), ly + 0.5, frame.h, seconds), seconds);
  for (let ly = 0; ly < frame.h; ly++) {
    for (let lx = 0; lx < frame.w; lx++) {
      let v: number = SMOKE_PIXEL.none;
      if (frame.opaque(lx, ly)) {
        v = oldKind(th(lx, ly), fade);
        const fy = wy(ly) + seconds * MATERIALIZE.risePxPerSecond;
        const dxWorld = wx(lx) - Math.floor(wx(lx) / 2) * 2 < 1 ? 1 : -1;
        const dy = fy - Math.floor(fy / 2) * 2 < 1 ? 1 : -1;
        const dx = frame.mirrored ? -dxWorld : dxWorld;
        const alone = !frame.opaque(lx + dx, ly) && !frame.opaque(lx, ly + dy) && !frame.opaque(lx + dx, ly + dy);
        if (v !== SMOKE_PIXEL.none && alone) {
          const left = frame.opaque(lx - dx, ly) && th(lx - dx, ly) >= fade;
          const up = frame.opaque(lx, ly - dy) && th(lx, ly - dy) >= fade;
          v = left || up ? SMOKE_PIXEL.body : SMOKE_PIXEL.none;
        }
      }
      out[ly * frame.w + lx] = v;
    }
  }
}

/**
 * Islands of a mask over its frame: rim pixels standing over a gap (an opaque pixel directly below them in their column that
 * shows nothing – the violet "!"), and connected pieces of shown pixels (8-neighbourhood) that reach the foot of none of
 * their columns (every one of their pixels has an opaque pixel below it in its column that shows nothing).
 */
function islands(mask: Uint8Array, frame: SmokeFrame): { rimOverGap: number; floating: number } {
  const { w, h } = frame;
  const shown = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && (mask[y * w + x] as number) !== SMOKE_PIXEL.none;
  /** Whether an opaque pixel below (x, y) in its column shows nothing. */
  const gapBelow = (x: number, y: number): boolean => {
    for (let yy = y + 1; yy < h; yy++) if (frame.opaque(x, yy) && !shown(x, yy)) return true;
    return false;
  };
  let rimOverGap = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x] === SMOKE_PIXEL.rim && frame.opaque(x, y + 1) && !shown(x, y + 1)) rimOverGap++;
  let floating = 0;
  const seen = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!shown(x, y) || seen[y * w + x] === 1) continue;
      let grounded = false;
      const stack = [y * w + x];
      seen[y * w + x] = 1;
      while (stack.length > 0) {
        const i = stack.pop() as number;
        const px = i % w;
        const py = (i - px) / w;
        if (!gapBelow(px, py)) grounded = true;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = px + dx;
            const ny = py + dy;
            if (shown(nx, ny) && seen[ny * w + nx] === 0) {
              seen[ny * w + nx] = 1;
              stack.push(ny * w + nx);
            }
          }
        }
      }
      if (!grounded) floating++;
    }
  }
  return { rimOverGap, floating };
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
function sweep(mask: (frame: SmokeFrame, fade: number, seconds: number, out: Uint8Array) => void): { isolated: number; lonelyRim: number; rimOverGap: number; floating: number; cases: number } {
  let isolated = 0;
  let lonelyRim = 0;
  let rimOverGap = 0;
  let floating = 0;
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
              const l = islands(out, frame);
              rimOverGap += l.rimOverGap;
              floating += l.floating;
              cases++;
            }
          }
        }
      }
    }
  }
  return { isolated, lonelyRim, rimOverGap, floating, cases };
}

/**
 * A sweep masks 5 130 frames and walks each for crumbs and islands (≈ 3–5 s alone); under the load of a check beside the other
 * strands' builds it took 17–30 s – more than the unit default of 15 s.
 */
const SWEEP_TIMEOUT_MS = 120_000;

describe('Rauch ohne Krümel (materializeMask)', { timeout: SWEEP_TIMEOUT_MS }, () => {
  it('die Cluster sind 2 × 2 Pixel groß (die Krümelregel kennt genau einen Partner je Achse)', () => {
    expect(MATERIALIZE.cellPx).toBe(2);
  });

  it('vorher: die Schwelle je Pixelzeile ließ einzelne Pixel und einzelne Randpixel stehen (Reproduktion)', () => {
    const before = sweep(oldMask);
    expect(before.isolated).toBeGreaterThan(0);
    expect(before.lonelyRim).toBeGreaterThan(0);
  });

  it('vorher: die Schwelle aus 2D-Rauschen und Höhe (ADR-0169) ließ Rand- und Körperinseln über der Front schweben (Reproduktion)', () => {
    const before = sweep(adr0169Mask);
    expect(before.isolated).toBe(0);
    expect(before.rimOverGap).toBeGreaterThan(0);
    expect(before.floating).toBeGreaterThan(0);
  });

  it('jetzt: kein Pixel ohne Nachbarn, kein einzelner glühender Randpixel, keine Insel über der Front – in jedem Fall', () => {
    const after = sweep(materializeMask);
    expect(after.cases).toBe(SPRITES.length * CLIPS.length * 2 * PLACES.length * TIMES.length * 19);
    expect(after).toMatchObject({ isolated: 0, lonelyRim: 0, rimOverGap: 0, floating: 0 });
  });

  it('jede Spalte zeigt in jedem ihrer Läufe von unten nur Körper, Rand, Rauchzunge, nichts – in dieser Reihenfolge', () => {
    const rank = [0, 3, 2, 1];
    const out = new Uint8Array(64 * 64);
    for (const sprite of SPRITES) {
      for (const [wx, wy] of PLACES) {
        const frame = frameOf(sprite, 'idle_down', 0, wx, wy, false);
        for (const t of TIMES) {
          for (let k = 1; k <= 19; k++) {
            materializeMask(frame, k / 20, t, out);
            for (let x = 0; x < frame.w; x++) {
              let last = 3;
              for (let y = frame.h - 1; y >= 0; y--) {
                // A gap in the silhouette starts a new run (its lowest pixel may be a crumb the crumb rule took away).
                if (!frame.opaque(x, y)) {
                  last = 3;
                  continue;
                }
                const r = rank[out[y * frame.w + x] as number] as number;
                expect(r, `${sprite} (${x}, ${y}) Ausblenden ${k / 20}`).toBeLessThanOrEqual(last);
                last = r;
              }
            }
          }
        }
      }
    }
  });

  it('ein Cluster hat eine Schwelle: die beiden Zeilen eines 2 × 2-Feldes im steigenden Rauch teilen sie', () => {
    for (const t of TIMES) {
      for (let y = 100; y < 140; y++) {
        const h = 32;
        const field = y + 0.5 + t * MATERIALIZE.risePxPerSecond;
        // The row partner in the same cell of the rising field.
        const partner = field - Math.floor(field / 2) * 2 < 1 ? 1 : -1;
        const a = smokeThreshold(smokeRowShare(y + 0.5, 10.5, h, t), smokeFront(40.5, t));
        const b = smokeThreshold(smokeRowShare(y + partner + 0.5, 10.5 + partner, h, t), smokeFront(40.5, t));
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
