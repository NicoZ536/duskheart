/**
 * Das Bild `schattenbrut-materialisierung` zeigt jede Brut mitten im Formen (M6-Gate-Bildprüfung: der Speier stand mit dem
 * Ausblendwert 0,33 nach 36 Ticks schon ganz da; src/debug/kreaturenKueste.ts `FORMING`, src/render/batch/materialize.ts):
 * mit dem Ausblendwert, den die Darstellung nach `steps − delay` Ticks seit dem Erscheinen rechnet (`formingFade`), und der
 * echten Maske an den Frames des Spielatlas
 * - ist keine Rolle schon ganz und keine erst ein paar Beinpixel: unten steht Körper, darüber glüht der Rand, oben ist noch
 *   ein Teil fort – an 60 Weltorten und fünf Zeiten (die Front wellt sich mit beiden, das Bild steht dort, wo die Platzsuche
 *   die Rollen hinstellt);
 * - erscheinen die Rollen kurz nacheinander (verschiedene Ausblendwerte).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { coastPicture } from '../../../src/debug/kreaturenKueste';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SMOKE_PIXEL, formingFade, materializeMask, type SmokeFrame } from '../../../src/render/batch/materialize';
import { decodePng } from '../../../tools/lib/png';

const MOD = (() => {
  const m = generatedAtlasModule();
  if (m === null) throw new Error('Spielatlas fehlt – npm run assets');
  return m;
})();
const MANIFEST = manifestFromGenerated(MOD);
const ALBEDO = decodePng(readFileSync(join(process.cwd(), 'public', MOD.ATLAS.albedoUrl)));

/** The first idle frame (seen from the front) of `sprite` as the smoke sees it, its anchor at world (wx, wy). */
function frameOf(sprite: string, wx: number, wy: number): SmokeFrame {
  const s = MANIFEST.sprites[sprite];
  const f = s?.frames[s.clips['idle_down']?.frames[0] ?? -1];
  if (f === undefined) throw new Error(`${sprite}: kein Frame idle_down[0]`);
  const opaque = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < f.w && y < f.h && (ALBEDO.rgba[((f.y + y) * ALBEDO.width + f.x + x) * 4 + 3] as number) > 127;
  return { w: f.w, h: f.h, opaque, anchorX: f.ax, anchorY: f.ay, worldX: wx, worldY: wy, mirrored: false };
}

/** Counts of the frame's opaque pixels at `fade`, `seconds`: gone, rim, body (smoke tongues count as neither). */
function counts(frame: SmokeFrame, fade: number, seconds: number): { opaque: number; gone: number; rim: number; body: number } {
  const out = new Uint8Array(frame.w * frame.h);
  materializeMask(frame, fade, seconds, out);
  const c = { opaque: 0, gone: 0, rim: 0, body: 0 };
  for (let y = 0; y < frame.h; y++) {
    for (let x = 0; x < frame.w; x++) {
      if (!frame.opaque(x, y)) continue;
      c.opaque++;
      const v = out[y * frame.w + x];
      if (v === SMOKE_PIXEL.none) c.gone++;
      else if (v === SMOKE_PIXEL.rim) c.rim++;
      else if (v === SMOKE_PIXEL.body) c.body++;
    }
  }
  return c;
}

/** World places and presentation times the check runs at [px, s] (the picture freezes at 0,4 s). */
const PLACES = Array.from({ length: 60 }, (_, k) => [500 + Math.floor(k * 37.3), 300 + Math.floor(k * 13.7)] as const);
const TIMES = [0.1, 0.4, 0.75, 1.3, 2.2] as const;
/** Shares of the opaque pixels that are still gone: the top of the head at least, not more than all but the legs and a little. */
const GONE_MIN = 0.03;
const GONE_MAX = 0.9;

describe('Die Stufen des Formens im Bild (schattenbrut-materialisierung)', () => {
  const p = coastPicture('schattenbrut-materialisierung');
  const steps = p?.steps ?? 0;

  it('jede Rolle steht mitten im Formen: Körper unten, der glühende Rand darüber, oben noch fort', () => {
    expect(p).toBeDefined();
    for (const r of p?.cast ?? []) {
      const fade = formingFade(steps - (r.delay ?? 0), BALANCE.time.tickHz);
      for (const [wx, wy] of PLACES) {
        for (const t of TIMES) {
          const c = counts(frameOf(`kreatur_${r.creature}`, wx, wy), fade, t);
          const what = `${r.creature} (Ausblendung ${fade.toFixed(2)}) bei ${wx}/${wy}, ${t} s`;
          expect(c.rim, `${what}: Rand`).toBeGreaterThan(0);
          expect(c.body, `${what}: Körper`).toBeGreaterThan(0);
          expect(c.gone / c.opaque, `${what}: fort`).toBeGreaterThanOrEqual(GONE_MIN);
          expect(c.gone / c.opaque, `${what}: fort`).toBeLessThanOrEqual(GONE_MAX);
        }
      }
    }
  });

  it('die Rollen erscheinen kurz nacheinander', () => {
    const fades = (p?.cast ?? []).map((r) => formingFade(steps - (r.delay ?? 0), BALANCE.time.tickHz));
    expect(new Set(fades).size).toBeGreaterThanOrEqual(3);
  });
});
