/**
 * M5-60: puddles by day have a rim and mirror the sky (terrain.frag `puddleLook`, TS mirror `puddleLookAt` in
 * src/render/surface/rules.ts) – before, the ground two steps darker under the flat sky sheen read as a pale patch:
 *
 * - the rim mask: exactly the dry pixels one puddle cell beside the water (in one of the four directions) are rim –
 *   every puddle is closed by it, and it is one cell wide;
 * - in the puddle: the north bank's dark image where the cell above is dry, the light lip where the cell below is dry,
 *   glints of the sky in world-fixed dashes (a few percent of the water), else water – in the water ramp (blue), the
 *   bank darker, the lip lighter; the rim is soaked ground, darker than the ground and glossy;
 * - by night the mirrored sky is dark: the puddle's tones go up to `puddleNightSteps` ramp steps darker by the scene's
 *   daylight level (`puddleNightShift`, `uSurface.w`) – none by day, all of them on a rainy night; lit by a torch the
 *   water stays dark instead of a pale diffuse patch (`regen-nacht-pfuetzen`);
 * - the shader decides the same (source: the same neighbours, salts, defines).
 */
import { describe, expect, it } from 'vitest';
import { SHADERS } from '../../../src/render/shaderLib';
import { SURFACE_PARAMS, rampIndex, surfaceDefines } from '../../../src/render/surface/params';
import { NOISE_SALT, PUDDLE_LOOK, puddleAtWorld, puddleGlint, puddleLookAt, puddleNightShift } from '../../../src/render/surface/rules';
import { dayLevel } from '../../../src/render/light/banding';
import { MOONLIGHT } from '../../../src/render/light/lightColors';
import { NIGHT_AMBIENT } from '../../../src/render/world/gameScene';

const W = SURFACE_PARAMS.wet;
const C = W.puddleCellPx;
/** A patch of the world [px] with several puddles at full fill (pixel centres). */
const X0 = 1000;
const Y0 = 2000;
const SIZE = 320;

function looks(fill: number): Uint8Array {
  const out = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) out[y * SIZE + x] = puddleLookAt(X0 + x + 0.5, Y0 + y + 0.5, fill);
  return out;
}

/** The mask of 100 000 pixels (up to five noise lookups each): room for a loaded machine. */
const MASK_TIMEOUT_MS = 30_000;

describe('M5-60: Pfützen mit Rand und Spiegelung', { timeout: MASK_TIMEOUT_MS }, () => {
  const full = looks(1);
  const at = (x: number, y: number): number => full[y * SIZE + x] as number;
  const wet = (x: number, y: number): boolean => puddleAtWorld(X0 + x + 0.5, Y0 + y + 0.5, 1);

  it('Randmaske: genau die trockenen Pixel eine Pfützenzelle neben dem Wasser sind Rand – jede Pfütze ist geschlossen umrandet', () => {
    let rims = 0;
    let water = 0;
    for (let y = C; y < SIZE - C; y++) {
      for (let x = C; x < SIZE - C; x++) {
        const l = at(x, y);
        const beside = wet(x - C, y) || wet(x + C, y) || wet(x, y - C) || wet(x, y + C);
        if (wet(x, y)) {
          water++;
          expect(l).toBeGreaterThanOrEqual(PUDDLE_LOOK.bank);
          // Walking out of the water in any direction, the first dry pixel is rim.
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            let k = 1;
            while (k < C * 40 && x + dx * k >= 0 && x + dx * k < SIZE && y + dy * k >= 0 && y + dy * k < SIZE && wet(x + dx * k, y + dy * k)) k++;
            const ox = x + dx * k;
            const oy = y + dy * k;
            if (ox >= 0 && ox < SIZE && oy >= 0 && oy < SIZE && !wet(ox, oy)) expect(at(ox, oy), `${ox},${oy}`).toBe(PUDDLE_LOOK.rim);
          }
        } else {
          expect(l).toBe(beside ? PUDDLE_LOOK.rim : PUDDLE_LOOK.dry);
          if (beside) rims++;
        }
      }
    }
    expect(water).toBeGreaterThan(SIZE * SIZE * 0.05);
    expect(rims).toBeGreaterThan(0);
    // One cell wide: fewer rim pixels than water pixels (the puddles are clusters, not specks).
    expect(rims).toBeLessThan(water);
  });

  it('der Rand ist eine Zelle breit: zwei Zellen neben dem Wasser ist der Boden trocken; ohne Wasser kein Rand', () => {
    let far = 0;
    for (let y = 2 * C; y < SIZE - 2 * C; y++) {
      for (let x = 2 * C; x < SIZE - 2 * C; x++) {
        if (wet(x, y) || wet(x - C, y) || wet(x + C, y) || wet(x, y - C) || wet(x, y + C)) continue;
        if (!(wet(x - 2 * C, y) || wet(x + 2 * C, y) || wet(x, y - 2 * C) || wet(x, y + 2 * C))) continue;
        far++;
        expect(at(x, y), `${x},${y}`).toBe(PUDDLE_LOOK.dry);
      }
    }
    expect(far).toBeGreaterThan(0);
    expect(looks(0).every((l) => l === PUDDLE_LOOK.dry)).toBe(true);
  });

  it('Spiegelung: Ufer oben dunkel, Lippe unten hell, Glanzstriche weltfest auf wenigen Prozent des Wassers', () => {
    let glints = 0;
    let inner = 0;
    for (let y = C; y < SIZE - C; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (!wet(x, y)) continue;
        const l = at(x, y);
        if (!wet(x, y - C)) expect(l).toBe(PUDDLE_LOOK.bank);
        else if (!wet(x, y + C)) expect(l).toBe(PUDDLE_LOOK.lip);
        else {
          inner++;
          expect(l).toBe(puddleGlint(X0 + x + 0.5, Y0 + y + 0.5) ? PUDDLE_LOOK.glint : PUDDLE_LOOK.water);
          if (l === PUDDLE_LOOK.glint) glints++;
        }
      }
    }
    const share = glints / inner;
    const expected = (W.puddleGlintShare * W.puddleGlintLengthPx) / (W.puddleGlintCellPx[0] * W.puddleGlintCellPx[1]);
    expect(share).toBeGreaterThan(expected * 0.5);
    expect(share).toBeLessThan(expected * 1.6);
    // A glint is a dash of `puddleGlintLengthPx` on one row: never two rows of a cell.
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) if (puddleGlint(x + 0.5, y + 0.5)) expect(puddleGlint(x + 0.5, y + 1.5)).toBe(false);
  });

  it('Farben: Wasserrampe (blau) statt Boden, Ufer dunkler, Lippe heller; der Rand dunkler als der Boden', () => {
    const water = rampIndex('wasser', 0);
    const last = rampIndex('wasser', 5);
    for (const ref of [W.puddleWater, W.puddleBank, W.puddleLip]) expect(ref[0]).toBe('wasser');
    expect(W.puddleBank[1]).toBeLessThan(W.puddleWater[1]);
    expect(W.puddleLip[1]).toBeGreaterThan(W.puddleWater[1]);
    expect(W.puddleGlint[0]).not.toBe('verderb');
    expect(W.puddleRimSteps).toBeGreaterThan(W.darkenSteps);
    expect(W.puddleRimGloss).toBeGreaterThan(W.gloss);
    const d = surfaceDefines();
    const idx = Number(d['DH_PUDDLE_WATER']);
    expect(idx).toBeGreaterThanOrEqual(water);
    expect(idx).toBeLessThanOrEqual(last);
    expect(d['DH_PUDDLE_BANK']).toBe(`${rampIndex(...W.puddleBank)}`);
    expect(d['DH_PUDDLE_LIP']).toBe(`${rampIndex(...W.puddleLip)}`);
    expect(d['DH_PUDDLE_GLINT']).toBe(`${rampIndex(...W.puddleGlint)}`);
    expect(d['DH_PUDDLE_RIM_STEPS']).toBe(`${W.puddleRimSteps}`);
    expect(d['DH_PUDDLE_GLINT_CELL']).toBe(`vec2(${W.puddleGlintCellPx[0]}.0, ${W.puddleGlintCellPx[1]}.0)`);
    expect(d['DH_PUDDLE_STEPS']).toBeUndefined();
  });

  it('bei Nacht dunkler: bei Tag keine Stufe, in einer Regennacht alle – ganze Stufen, fallend mit dem Tageslicht', () => {
    // The ambient of the game scene (src/render/world/gameScene.ts): daylight white × weather, night moonlight × (base + full moon share) × weather.
    const rain = 0.7;
    const day = dayLevel(rain, rain, rain);
    const moon = (share: number): number => dayLevel(MOONLIGHT[0] * share * rain, MOONLIGHT[1] * share * rain, MOONLIGHT[2] * share * rain);
    expect(puddleNightShift(dayLevel(1, 1, 1))).toBe(0);
    expect(puddleNightShift(day)).toBe(0);
    expect(puddleNightShift(moon(NIGHT_AMBIENT.base))).toBe(W.puddleNightSteps);
    expect(puddleNightShift(moon(NIGHT_AMBIENT.base + NIGHT_AMBIENT.fullMoon))).toBe(W.puddleNightSteps);
    expect(puddleNightShift(0)).toBe(W.puddleNightSteps);
    expect(W.puddleNightSteps).toBeGreaterThan(0);
    let last: number = W.puddleNightSteps;
    for (let l = 0; l <= 1.0001; l += 0.01) {
      const n = puddleNightShift(l);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeLessThanOrEqual(last);
      last = n;
    }
  });

  it('der Shader entscheidet genauso (Nachbarn, Salze, Reihenfolge)', () => {
    const src = SHADERS['world/terrain.frag'] ?? '';
    expect(src).toContain('return puddleAtWorld(w - cx, fill) || puddleAtWorld(w + cx, fill) || puddleAtWorld(w - cy, fill) || puddleAtWorld(w + cy, fill) ? PUDDLE_RIM : PUDDLE_DRY;');
    expect(src).toContain('if (!puddleAtWorld(w - cy, fill)) return PUDDLE_BANK;');
    expect(src).toContain('if (!puddleAtWorld(w + cy, fill)) return PUDDLE_LIP;');
    expect(src).toContain('return puddleGlint(w) ? PUDDLE_GLINT : PUDDLE_WATER;');
    expect(src).toContain(`if (cellHash(c, ${NOISE_SALT.glint}u) >= DH_PUDDLE_GLINT_SHARE) return false;`);
    expect(src).toContain(`floor(cellHash(c, ${NOISE_SALT.glintAt}u) * (DH_PUDDLE_GLINT_CELL.x - DH_PUDDLE_GLINT_LENGTH + 1.0))`);
    expect(src).toContain(`clusterNoise(w, DH_PUDDLE_WAVELENGTH, DH_PUDDLE_WAVELENGTH * 0.3, DH_PUDDLE_CELL, ${NOISE_SALT.puddle}u)`);
    expect(src).toContain('index = shift(index, DH_PUDDLE_RIM_STEPS);');
    expect(src).toContain('index = shift(tone, steps + int(uSurface.w + 0.5));');
    expect(src).toContain('mask |= DH_MASK_PUDDLE;');
    // One puddle look per pixel, only while puddles fill (the weather variant's rain branch).
    expect(src).toContain('(vGround & DH_GROUND_PUDDLES) != 0u && (puddle = puddleLook(world, fill)) != PUDDLE_DRY) {');
    // The rim is ground, not water: the mirror of the lights stays on the puddle.
    const rimAt = src.indexOf('if (puddle == PUDDLE_RIM) {');
    expect(rimAt).toBeGreaterThan(0);
    const rim = src.slice(rimAt, src.indexOf('} else {', rimAt));
    expect(rim).toContain('index = shift(index, DH_PUDDLE_RIM_STEPS);');
    expect(rim).not.toContain('DH_MASK_PUDDLE');
    const water = src.slice(src.indexOf('} else {', rimAt), src.indexOf('} else if (wet > 0.0) {', rimAt));
    expect(water).toContain('mask |= DH_MASK_PUDDLE;');
  });
});
