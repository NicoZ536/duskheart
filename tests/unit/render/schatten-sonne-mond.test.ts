/**
 * M5-02 … M5-04: Sonnen- und Mondschatten, Wolkenschatten, Blätterdach-Sprenkel und die Aufteilung des Tageslichts
 * (MASTERPROMPT §6.1 Pässe 4–5, §6.2 „Nacht“). Reine Funktionen: die Scherung der Silhouette nach dem Sonnenstand
 * (morgens lang nach Westen, mittags kurz nach Norden, abends lang nach Osten), die Richtung des gerichteten Lichts
 * für das Normal-Mapping, der Anteil von Sonne und Mond am Umgebungslicht (Mondphase = Helligkeit), die Aufteilung in
 * kühles Himmelslicht und warmes gerichtetes Licht, die Drift der Wolken mit dem Wind und die Bedeckung.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { cloudShade, valueNoise } from '../../../src/render/light/lightMath';
import { CLOUDS, DAPPLE, DAYLIGHT, MOONLIGHT_PARAMS, SUN_SHADOW } from '../../../src/render/light/params';
import { SkyState } from '../../../src/render/light/sky';
import { cloudCover, cloudOffset, lightDirection, moonShare, shearedShadowPoint, splitDaylight, sunShare } from '../../../src/render/light/skyMath';
import { drawnShadowLength } from '../../../src/render/passes/shadowPass';
import { SHADERS } from '../../../src/render/shaderLib';
import { SKY_REFRESH_TICKS, skyRefreshDue } from '../../../src/render/world/skyScene';
import { createShadowVector, moonShadowAt, sunShadowAt } from '../../../src/world/calendar';

const MOON = { neu: 0, voll: 4 } as const;

describe('Silhouettenschatten: Scherung nach dem Sonnenstand (M5-02)', () => {
  it('ein Pixel wird um seine Höhe entlang des Schattenvektors verschoben', () => {
    expect(shearedShadowPoint(100, 200, 0, 1, 0, 2)).toEqual([100, 200]);
    expect(shearedShadowPoint(100, 200, 10, -1, 0, 2)).toEqual([80, 200]);
    expect(shearedShadowPoint(100, 200, 10, 0.6, -0.8, 0.5)).toEqual([103, 196]);
    // The vertex shader of the silhouettes shears exactly so (anchor + x offset + shadow vector × length × height; a
    // swaying crown's rows moved on the ground plane by their sway, M5 review Minor 14 – tests/unit/render/wind.test.ts).
    const vert = (SHADERS['shadow_sprite.vert'] ?? '').replace(/\s+/g, ' ');
    expect(vert).toContain('float h = aParams.x - rel.y;');
    expect(vert).toContain('vec2 anchorWorld = floor(aPos + 0.5);');
    expect(vert).toContain('vec2 world = anchorWorld + vec2(rel.x, 0.0) + sway * (up * up) + uShadow.xy * (uShadow.z * h);');
  });

  it('Sommertag: 08:00 lang nach Westen, 12:00 kurz nach Norden, 17:00 lang nach Osten', () => {
    const at = (hour: number): ReturnType<typeof createShadowVector> => sunShadowAt('sommer', hour, createShadowVector());
    const morning = at(8);
    const noon = at(12);
    const evening = at(17);
    expect(morning.dirX).toBeLessThan(-0.5);
    expect(evening.dirX).toBeGreaterThan(0.5);
    expect(noon.dirY).toBeLessThan(-0.9);
    expect(Math.abs(noon.dirX)).toBeLessThan(0.3);
    // Long in the morning and the evening, short at noon.
    expect(morning.length).toBeGreaterThan(2 * noon.length);
    expect(evening.length).toBeGreaterThan(2 * noon.length);
    // A 48-px tree's top: its shadow reaches this far from the trunk [px] (the renderer caps the horizon's).
    const tip = (s: typeof morning): number => Math.hypot(...shearedShadowPoint(0, 0, 48, s.dirX, s.dirY, drawnShadowLength(s.length)));
    expect(tip(noon)).toBeLessThan(40);
    expect(tip(morning)).toBeGreaterThan(48);
    expect(tip(evening)).toBeGreaterThan(48);
    // The shadow wanders: the direction turns from west over north to east through the day.
    let last = -Infinity;
    for (let h = 7; h <= 18; h += 0.5) {
      const s = at(h);
      const angle = Math.atan2(s.dirX, -s.dirY);
      expect(angle, `${h} Uhr`).toBeGreaterThanOrEqual(last);
      last = angle;
    }
  });

  it('die Schattenlänge wird für den Horizont gedeckelt, nie negativ', () => {
    expect(drawnShadowLength(BALANCE.calendar.maxShadowLength)).toBe(SUN_SHADOW.maxLength);
    expect(drawnShadowLength(1.2)).toBe(1.2);
    expect(drawnShadowLength(-1)).toBe(0);
  });
});

describe('Gerichtetes Licht: Richtung für das Normal-Mapping', () => {
  it('steht dem Schatten gegenüber, ist ein Einheitsvektor und steigt mit der Sonne', () => {
    const d = new SkyState().directional;
    for (const [sx, sy, e] of [
      [-0.8, -0.6, 20],
      [0, -1, 62],
      [0.9, -0.4, 10],
    ] as const) {
      lightDirection(sx, sy, e, d);
      expect(Math.hypot(d.lx, d.ly, d.lz)).toBeCloseTo(1, 9);
      // Screen x: opposite to where the shadows fall.
      expect(Math.sign(d.lx)).toBe(-Math.sign(sx));
      expect(d.lz).toBeGreaterThan(0);
    }
    lightDirection(0, -1, 10, d);
    const low = d.lz;
    lightDirection(0, -1, 60, d);
    expect(d.lz).toBeGreaterThan(low);
  });
});

describe('Tageslicht: Himmel + Sonne = Umgebungslicht (M5-04)', () => {
  it('auf einem flachen, besonnten Pixel summieren sich Himmel und Sonne je Kanal genau zum Umgebungslicht', () => {
    const d = new SkyState().directional;
    for (const share of [0.1, 0.25, 0.5]) {
      for (const warmth of [-0.2, 0, DAYLIGHT.skyCoolness, 0.3]) {
        splitDaylight(share, warmth, d);
        expect(d.skyR + d.dirR).toBeCloseTo(1, 12);
        expect(d.skyG + d.dirG).toBeCloseTo(1, 12);
        expect(d.skyB + d.dirB).toBeCloseTo(1, 12);
        for (const v of [d.skyR, d.skyG, d.skyB, d.dirR, d.dirG, d.dirB]) expect(v).toBeGreaterThanOrEqual(-1e-12);
        // The shadow keeps the sky part: cooler (bluer) than the sunlit ground.
        if (warmth > 0) expect(d.skyB).toBeGreaterThan(d.skyR);
        if (warmth < 0) expect(d.dirB).toBeGreaterThan(d.dirR);
      }
    }
    splitDaylight(0, 0.2, d);
    expect([d.share, d.dirR, d.dirG, d.dirB, d.skyR, d.skyG, d.skyB]).toEqual([0, 0, 0, 0, 1, 1, 1]);
  });

  it('die Sonne gibt ab der Dämmerung Licht, am meisten hoch am Himmel; Bewölkung streut es in den Himmel', () => {
    expect(sunShare(0, 1, 1)).toBe(0);
    expect(sunShare(DAYLIGHT.lowSunDeg / 2, 1, 1)).toBeLessThan(sunShare(DAYLIGHT.lowSunDeg, 1, 1));
    expect(sunShare(60, 1, 1)).toBeCloseTo(1 - DAYLIGHT.skyShare, 12);
    expect(sunShare(60, 1, 0.55)).toBe(0);
    expect(sunShare(60, 1, 0.8)).toBeLessThan(sunShare(60, 1, 1));
  });

  it('Mondphase = Helligkeit: Vollmond wirft gerichtetes, kühles Licht, der Finstermond keines', () => {
    const full = moonShadowAt('sommer', 'sommer', 23.5, MOON.voll, createShadowVector());
    const none = moonShadowAt('sommer', 'sommer', 23.5, MOON.neu, createShadowVector());
    expect(full.strength).toBeGreaterThan(0);
    expect(none.strength).toBe(0);
    const c = BALANCE.calendar.moonShadowStrength;
    expect(moonShare(full.strength, c)).toBeGreaterThan(0);
    expect(moonShare(full.strength, c)).toBeLessThanOrEqual(MOONLIGHT_PARAMS.directedShareFullMoon + 1e-12);
    expect(moonShare(none.strength, c)).toBe(0);
    // A half-full moon lies between.
    const half = moonShadowAt('sommer', 'sommer', 23.5, 2, createShadowVector());
    expect(moonShare(half.strength, c)).toBeGreaterThan(0);
    expect(moonShare(half.strength, c)).toBeLessThan(moonShare(full.strength, c));
    // Moonlight is cooler than the sky it comes through (negative warmth: the directed part leans blue).
    const d = new SkyState().directional;
    splitDaylight(moonShare(full.strength, c), -0.06, d);
    expect(d.dirB).toBeGreaterThan(d.dirR);
  });
});

describe('Himmel des Spiels: berechnet, wenn fällig, sonst übernommen (§30: keine Allokation je Frame)', () => {
  it('neu bei einer neuen Spielminute, alle SKY_REFRESH_TICKS Ticks, nach einem Sprung zurück und einmal nach dem Anhalten', () => {
    // Computed at tick 100, minute 480 (08:00).
    const due = (previous: number, tick: number, minute = 480): boolean => skyRefreshDue(100, 480, previous, tick, minute);
    // The simulation runs: frames in between take the last result …
    expect(due(100, 101)).toBe(false);
    expect(due(110, 111)).toBe(false);
    // … until half a second passed or the game minute changed.
    expect(due(129, 100 + SKY_REFRESH_TICKS)).toBe(true);
    expect(due(110, 111, 481)).toBe(true);
    // Stopped on a tick not yet computed (a scenario's commands): once, the next frame.
    expect(due(105, 105)).toBe(true);
    // Stopped on the computed tick (paused): nothing to do.
    expect(due(100, 100)).toBe(false);
    // Another simulation or a loaded game (tick back): at once.
    expect(due(100, 40)).toBe(true);
    expect(SKY_REFRESH_TICKS).toBeLessThanOrEqual(60);
  });
});

describe('Wolkenschatten (M5-03)', () => {
  it('klarer Himmel ohne, bedeckter mit Wolkenschatten: der beschattete Anteil folgt der Bedeckung', () => {
    expect(cloudCover(0)).toBe(CLOUDS.clearCover);
    expect(cloudCover(1)).toBe(CLOUDS.overcastCover);
    const covered = (cover: number): number => {
      let n = 0;
      let k = 0;
      for (let y = 0; y < 2400; y += 8) for (let x = 0; x < 2400; x += 8, n++) if (cloudShade(x, y, cover, 0, 0) < 0.99) k++;
      return k / n;
    };
    expect(cloudShade(10, 10, 0, 0, 0)).toBe(1);
    for (const cover of [0.15, 0.5, 0.8]) expect(Math.abs(covered(cover) - cover), `Bedeckung ${cover}`).toBeLessThan(0.12);
    // A cloud takes at most `density` of the sun.
    for (let x = 0; x < 3000; x += 37) expect(cloudShade(x, 400, 1, 0, 0)).toBeGreaterThanOrEqual(1 - CLOUDS.density - 1e-9);
  });

  it('die Wolken ziehen mit dem Wind: das Muster von t₀ liegt zu t₁ windabwärts verschoben', () => {
    for (const [wx, wy] of [
      [1, 0],
      [0, -1],
      [-0.7071, 0.7071],
    ] as const) {
      const a = { offsetX: 0, offsetY: 0 };
      const b = { offsetX: 0, offsetY: 0 };
      cloudOffset(wx, wy, 1, 10, a);
      cloudOffset(wx, wy, 1, 20, b);
      const dx = wx * CLOUDS.speedPxPerSecond * 10;
      const dy = wy * CLOUDS.speedPxPerSecond * 10;
      for (const [x, y] of [
        [50, 80],
        [400, 120],
        [777, 555],
      ] as const) {
        expect(cloudShade(x + dx, y + dy, 0.6, b.offsetX, b.offsetY)).toBeCloseTo(cloudShade(x, y, 0.6, a.offsetX, a.offsetY), 9);
      }
    }
    // Without wind the clouds still creep (calm speed), with wind they drift faster.
    const calm = { offsetX: 0, offsetY: 0 };
    const gale = { offsetX: 0, offsetY: 0 };
    cloudOffset(1, 0, 0, 10, calm);
    cloudOffset(1, 0, 1, 10, gale);
    expect(Math.abs(calm.offsetX)).toBeCloseTo(CLOUDS.calmSpeedPxPerSecond * 10, 9);
    expect(Math.abs(gale.offsetX)).toBeGreaterThan(Math.abs(calm.offsetX));
  });

  it('der Shader rechnet dieselbe Wolke wie der Spiegel', () => {
    const glsl = (SHADERS['shadow.glsl'] ?? '').replace(/\s+/g, ' ');
    expect(glsl).toContain('vec2 p = (world + uClouds.yz) / DH_CLOUD_SCALE;');
    expect(glsl).toContain(
      'float n = 0.55 * cloudNoise(p, DH_CLOUD_PERIOD_0) + 0.3 * cloudNoise(p * DH_CLOUD_OCTAVE_1 + vec2(17.1, 5.3), DH_CLOUD_PERIOD_1) + 0.15 * cloudNoise(p * DH_CLOUD_OCTAVE_2 + vec2(3.7, 11.9), DH_CLOUD_PERIOD_2);',
    );
    // The noise on the wrapped lattice (the mirror's `cloudNoise`): the corners taken modulo the period, in integers.
    expect(glsl).toContain('ivec2 a = (ivec2(i) + period) % period; ivec2 b = (a + 1) % period;');
    expect(glsl).toContain('return mix(mix(lightHash(vec2(a)), lightHash(vec2(b.x, a.y)), f.x), mix(lightHash(vec2(a.x, b.y)), lightHash(vec2(b)), f.x), f.y);');
    expect(glsl).toContain('return 1.0 - DH_CLOUD_DENSITY * smoothstep(threshold - DH_CLOUD_EDGE, threshold + DH_CLOUD_EDGE, n);');
    const noise = (SHADERS['shadow_noise.glsl'] ?? '').replace(/\s+/g, ' ');
    expect(noise).toContain('p = fract(p * vec2(0.1031, 0.1030));');
    expect(noise).toContain('return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);');
  });
});

describe('Blätterdach-Sprenkel (M5-03)', () => {
  it('etwa der eingestellte Anteil des Kronenschattens lässt die Sonne in Flecken durch', () => {
    let n = 0;
    let open = 0;
    for (let y = 0; y < 900; y++) {
      for (let x = 0; x < 900; x++, n++) if (valueNoise(Math.floor(x) / DAPPLE.cellPx, Math.floor(y) / DAPPLE.cellPx) > DAPPLE.threshold) open++;
    }
    expect(Math.abs(open / n - DAPPLE.openShare)).toBeLessThan(0.03);
    const frag = (SHADERS['shadow_sprite.frag'] ?? '').replace(/\s+/g, ' ');
    expect(frag).toContain('if (valueNoise(floor(world + uDapple.xy * sway) / DH_DAPPLE_CELL) > DH_DAPPLE_THRESHOLD) discard;');
  });
});
