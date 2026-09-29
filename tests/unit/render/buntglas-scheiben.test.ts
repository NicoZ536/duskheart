/**
 * M5-58: das farbige Sonnenlicht des Buntglases im Endbild. Vorher war der Fleck im Puffer `sun` deutlich, im Endbild ein
 * trüber Fleck (Szenario `buntglas`). Drei Ursachen, drei Korrekturen (MASTERPROMPT §6.1 Pass 4/6, §16.2 „Buntglas“):
 * - **Eine Scheibe je Strahl:** das Fenster einer Nord-Süd-Wand besteht aus drei Blöcken (Knoten und zwei Arme zu den
 *   Nachbarwänden); jeder tastete die Scheibe in der Mitte seines eigenen Wegs ab, ein Strahl durch zwei Blöcke bekam das
 *   MIN zweier Texel – Blau × Gold wurde Türkis, Rot und Grün verdunkelten. Jetzt tastet jeder Block dort ab, wo der
 *   Strahl die Fensterebene kreuzt (`paneCell`, shadow_block.frag).
 * - **Scharfe Scheiben:** der Halbschatten mischte die 2–3 px kleinen Scheiben mit ihren dunklen Ruten; ein Empfänger im
 *   farbigen Licht behält jetzt die Farbe seiner Scheibe (`glassTint`, `sunVisibility`); graue Schatten bleiben weich.
 * - **Reiner Farbton:** `GLASS.whiten` 0 – aufgehellt las sich Blau auf braunen Dielen grüngrau. Klarglas (Rampe `eis`,
 *   der Himmelsreflex) lässt die Sonne grau durch (`paneLight`) statt sie bläulich zu färben.
 *
 * M5-68: die blaue Scheibe zeigte sich auf den Dielen nur als 2 × 2-px-Fleck in Türkis (137° statt 197°). Drei Ursachen:
 * - **Scheibengröße:** die Scheiben fallen 1 : 1 auf den Boden; Blau war eine Ecke aus 3 + 2 + 1 Texeln, deren oberste
 *   Reihe um 06:45 die Traufe abschnitt. Jetzt trägt die Raute (18 Texel, 6 breit) das Blau, und das Szenario steht um
 *   06:00 (Sonne 19°: die Reihen liegen 2,7 px auseinander, die Traufe lässt die oberste frei).
 * - **Warme Diele × blaues Licht:** die Komposition spiegelte Himmel und Scheibenlicht als ein Licht mit dem
 *   Spektralanteil des Tageslichts – der Himmel verdünnte die Sättigung, das Braun der Diele blieb im Zusatz. Licht einer
 *   Buntglasscheibe wird jetzt mit `GLASS.spectralShare` 1 im eigenen Farbton gespiegelt (`reflectGlassLight`).
 * - **Scheibenfarbe:** das gemalte Blau (Rot 29 %, Grün 80 % des Blaus) ist heller Himmelsreflex, kein Durchlicht; die
 *   Scheibe lässt ihre Farbe hoch `GLASS.density` 2,5 durch (Beer–Lambert).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodePng } from '../../../tools/lib/png';
import { buntglasBild } from '../../../src/debug/basisScenarios';
import { PALETTE_HEX, PALETTE_RAMPS } from '../../../src/generated/palette';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { lightBandLevel } from '../../../src/render/light/banding';
import { BuildingOccluders, PaneSprites } from '../../../src/render/light/buildingOccluders';
import { glassChannel, glassThrough, glassTint, paneLight, reflectGlassLight } from '../../../src/render/light/glass';
import { paneCell, sunBlockSpan } from '../../../src/render/light/lightMath';
import { OccluderList } from '../../../src/render/light/occluders';
import { BUILDING_SUN, DAYLIGHT, DAYLIGHT_STEPS, GLASS, glassClearIndices, lightStrandDefines } from '../../../src/render/light/params';
import { splitDaylight } from '../../../src/render/light/skyMath';
import { SkyState } from '../../../src/render/light/sky';
import { reflectLight } from '../../../src/render/light/spectral';
import { SUN_CASTER_FLOATS, SUN_CASTER_KIND, SUN_CASTER_OFFSET, SunCasterList } from '../../../src/render/light/sunCasters';
import { SHADERS } from '../../../src/render/shaderLib';
import { createShadowVector, sunShadowAt, type Season } from '../../../src/world/calendar';
import { TILE_PX } from '../../../src/world/model/coords';
import { bauWelt, type BauWelt } from '../game/bau-testwelt';
import { meadow, OFFSET } from '../game/spieler-testwelt';
import { glslScalar } from './grading-glslScalar';

type Rgb = readonly [number, number, number];

/** Palette colour of `ramp.step` (0-based step) as linear 0 … 1 (the renderer's albedo). */
function colour(ref: string): Rgb {
  const [name, step] = ref.split('.');
  let index = 0;
  for (const r of PALETTE_RAMPS) {
    if (r.name === name) break;
    index += r.size;
  }
  const hex = PALETTE_HEX[index + Number(step)] ?? '#000000';
  return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
}

/** Hue [°] of an rgb colour. */
function hue(c: Rgb): number {
  const [r, g, b] = c;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (mx - mn <= 0) return Number.NaN;
  let h = mx === r ? ((g - b) / (mx - mn)) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** Smallest angle between two hues [°]. */
function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

const luma = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** The panes of `bau_fenster_buntglas` (assets-src/sprites/bau/fenster.ts: `BUNT_LEGENDE`). */
const PANES = { rot: 'feuer.2', blau: 'wasser.3', gruen: 'gras.3', gold: 'sand.3' } as const;
type Pane = keyof typeof PANES;
/** The boards of `bau_boden_holz` (assets-src/sprites/bau/boeden.ts): planks `holz.2`/`holz.3`, seams `holz.1`, grain `holz.4`. */
const BOARDS = ['holz.1', 'holz.2', 'holz.3', 'holz.4'] as const;

/** Inner tiles of the cabin (drawn coordinates) and its stained-glass window in the east wall. */
const IN = { x0: 4, y0: 4, x1: 8, y1: 7 } as const;
const WINDOW = { x: IN.x1 + 1, y: 5 } as const;

/** A roofed cabin with a stained-glass window in its east wall – a north–south wall: the window's knot and two arms. */
function cabin(): BauWelt {
  const w = bauWelt(meadow(20, 16));
  w.spawn(6, 10);
  for (let x = IN.x0 - 1; x <= IN.x1 + 1; x++) {
    for (let y = IN.y0 - 1; y <= IN.y1 + 1; y++) {
      const edge = x === IN.x0 - 1 || x === IN.x1 + 1 || y === IN.y0 - 1 || y === IN.y1 + 1;
      if (!edge) continue;
      const r = w.build(x === WINDOW.x && y === WINDOW.y ? 'fenster_buntglas' : 'wand_holz', x, y);
      if (r !== null) throw new Error(`${x},${y}: ${r}`);
    }
  }
  for (let y = IN.y0 - 1; y <= IN.y1 + 1; y++) {
    for (let x = IN.x0 - 1; x <= IN.x1 + 1; x++) {
      const r = w.build('dach_stroh', x, y);
      if (r !== null) throw new Error(`dach_stroh ${x},${y}: ${r}`);
    }
  }
  return w;
}

/** Where the scenario's cabin stands in the test world (its tile (0, 0)); the player stands inside it. */
const SITE = { x: 2, y: 2 } as const;

/** The cabin of the scenario `buntglas`, rebuilt from its parts (floors, walls with door and windows, roof). */
function scenarioCabin(): BauWelt {
  const w = bauWelt(meadow(20, 16));
  w.spawn(SITE.x + 3, SITE.y + 2);
  for (const t of buntglasBild().teile) {
    const r = w.build(t.teil, SITE.x + t.x, SITE.y + t.y);
    if (r !== null) throw new Error(`${t.teil} ${t.x},${t.y}: ${r}`);
  }
  return w;
}

/** The pane cell caster `i` sampled before M5-58: in the middle of the ray's own path through its block. */
function paneCellBefore(list: SunCasterList, i: number, x: number, y: number, sx: number, sy: number, from: number, to: number): [number, number] | null {
  const r = list.records;
  const o = i * SUN_CASTER_FLOATS;
  const t = 0.5 * (from + to);
  const along = (r[o + SUN_CASTER_OFFSET.span + 3] ?? 0) > 0.5 ? y - sy * t : x - sx * t;
  const col = Math.floor(along - (r[o + SUN_CASTER_OFFSET.pane] ?? 0));
  const row = Math.floor((r[o + SUN_CASTER_OFFSET.pane + 3] ?? 0) - (t - (r[o + SUN_CASTER_OFFSET.span] ?? 0)));
  const w = r[o + SUN_CASTER_OFFSET.frame + 1] ?? 0;
  const h = r[o + SUN_CASTER_OFFSET.frame + 2] ?? 0;
  return col >= 0 && row >= 0 && col < w && row < h ? [col, row] : null;
}

/** The atlas, its albedo image and the pane sprites (null before `npm run assets`). */
function atlas(): { img: ReturnType<typeof decodePng>; panes: PaneSprites } | null {
  const mod = generatedAtlasModule();
  const albedoPath = join(process.cwd(), 'public/generated/atlas-albedo.png');
  if (mod === null || !existsSync(albedoPath)) return null;
  const panes = new PaneSprites();
  panes.bind(manifestFromGenerated(mod));
  return { img: decodePng(readFileSync(albedoPath)), panes };
}

/** Which pane (or `null`: frame, rod, hole) frame cell (col, row) of caster `i` shows: from the atlas, or from `layout`. */
type PaneAt = (i: number, col: number, row: number) => Pane | null;

function atlasPanes(sun: SunCasterList, img: ReturnType<typeof decodePng>): PaneAt {
  const byRgb = new Map(Object.entries(PANES).map(([k, ref]) => [colour(ref).map((v) => Math.round(v * 255)).join(','), k as Pane]));
  return (i, col, row) => {
    const o = i * SUN_CASTER_FLOATS + SUN_CASTER_OFFSET.pane;
    const k = (((sun.records[o + 2] ?? 0) + row) * img.width + (sun.records[o + 1] ?? 0) + col) * 4;
    if ((img.rgba[k + 3] ?? 0) < 128) return null;
    const hex = PALETTE_HEX[(img.rgba[k] ?? 0) - 1] ?? '';
    return byRgb.get([1, 3, 5].map((p) => parseInt(hex.slice(p, p + 2), 16)).join(',')) ?? null;
  };
}

/** The opening of the window sprite: frame columns 4–11, rows 13–19 (assets-src/sprites/bau/fenster.ts `oeffnung`). */
const OPENING = { col: 4, row: 13, w: 8, h: 7 } as const;
/** The pane layout before M5-68: a gold diamond, blue only as the top-right corner (3 + 2 + 1 texels). */
const LAYOUT_BEFORE = ['RRR##BBB', 'RR#YY#BB', 'R#YYYY#B', '#YYYYYY#', 'G#YYYY#R', 'GG#YY#RR', 'GGG##RRR'] as const;
const LAYOUT_KEYS: Readonly<Record<string, Pane>> = { R: 'rot', B: 'blau', G: 'gruen', Y: 'gold' };

function layoutPanes(layout: readonly string[]): PaneAt {
  return (_i, col, row) => {
    const c = layout[row - OPENING.row]?.charAt(col - OPENING.col) ?? '';
    return LAYOUT_KEYS[c] ?? null;
  };
}

/**
 * The floor under the cabin's roof as the shadow target shows it (the CPU mirror of shadow_block.frag, MIN over the
 * casters): per pixel the pane whose light reaches it, or null (shadow, rod, frame). Also the frame rows that reach it.
 */
function patchMap(sun: SunCasterList, season: Season, hour: number, paneAt: PaneAt, x0: number, y0: number, w: number, h: number): { map: (Pane | null)[][]; rows: Set<number> } {
  const s = sunShadowAt(season, hour, createShadowVector());
  const sx = s.dirX * s.length;
  const sy = s.dirY * s.length;
  const rows = new Set<number>();
  const map: (Pane | null)[][] = [];
  for (let y = y0; y < y0 + h; y++) {
    const line: (Pane | null)[] = [];
    for (let x = x0; x < x0 + w; x++) {
      let pane: Pane | null = null;
      let dark = false;
      const cells: number[] = [];
      for (let i = 0; i < sun.count && !dark; i++) {
        const span = sunBlockSpan(sun, i, x + 0.5, y + 0.5, sx, sy);
        if (span === null || span[1] <= 0.5) continue;
        if (sun.records[i * SUN_CASTER_FLOATS + SUN_CASTER_OFFSET.span + 2] !== SUN_CASTER_KIND.paneSprite) {
          dark = true;
          continue;
        }
        const c = paneCell(sun, i, x + 0.5, y + 0.5, sx, sy, span[0], span[1]);
        const p = c === null ? null : paneAt(i, c[0], c[1]);
        if (c === null || p === null || (pane !== null && pane !== p)) dark = true;
        else {
          pane = p;
          cells.push(c[1]);
        }
      }
      if (!dark && pane !== null) for (const r of cells) rows.add(r);
      line.push(dark ? null : pane);
    }
    map.push(line);
  }
  return { map, rows };
}

/** Side of the largest solid square of `pane` in `map` [px]. */
function largestSquare(map: readonly (readonly (Pane | null)[])[], pane: Pane): number {
  let best = 0;
  const run = map.map((line) => line.map(() => 0));
  for (let y = 0; y < map.length; y++) {
    for (let x = 0; x < (map[y]?.length ?? 0); x++) {
      if (map[y]?.[x] !== pane) continue;
      const v = y > 0 && x > 0 ? 1 + Math.min(run[y - 1]?.[x - 1] ?? 0, run[y - 1]?.[x] ?? 0, run[y]?.[x - 1] ?? 0) : 1;
      (run[y] as number[])[x] = v;
      best = Math.max(best, v);
    }
  }
  return best;
}

describe('Buntglas im Endbild (M5-58, M5-68)', () => {
  const ready = atlas() !== null;

  it.runIf(ready)('ein Strahl tastet eine Scheibe ab, auch durch zwei Blöcke des Fensters – alle vier Farben liegen auf dem Boden', () => {
    const a = atlas();
    if (a === null) return;
    const { img, panes } = a;
    const w = cabin();
    const sun = new SunCasterList();
    new BuildingOccluders().collect(w.building.structures, w.building.catalog, 0, OFFSET, OFFSET, OFFSET + 19, OFFSET + 15, () => 0, new OccluderList(), sun, panes);
    const paneCasters: number[] = [];
    for (let i = 0; i < sun.count; i++) if (sun.records[i * SUN_CASTER_FLOATS + SUN_CASTER_OFFSET.span + 2] === SUN_CASTER_KIND.paneSprite) paneCasters.push(i);
    // The window of a north–south wall: its knot and the arms to both neighbours.
    expect(paneCasters.length).toBe(3);
    const east = (OFFSET + WINDOW.x) * TILE_PX;
    const paneAt = atlasPanes(sun, img);
    /** Over the floor west of the window: points whose ray samples two different cells, and the pane colours met. */
    const walk = (season: Season, hour: number, cell: typeof paneCell) => {
      const s = sunShadowAt(season, hour, createShadowVector());
      const sx = s.dirX * s.length;
      const sy = s.dirY * s.length;
      let conflicts = 0;
      const met = new Set<string>();
      for (let y = (OFFSET + WINDOW.y - 3) * TILE_PX; y < (OFFSET + WINDOW.y + 3) * TILE_PX; y++) {
        for (let x = east - 48; x < east; x++) {
          const cells = new Set<string>();
          let opaque = false;
          for (let i = 0; i < sun.count; i++) {
            const span = sunBlockSpan(sun, i, x + 0.5, y + 0.5, sx, sy);
            if (span === null || span[1] <= 0.5) continue;
            if (!paneCasters.includes(i)) {
              opaque = true;
              continue;
            }
            const c = cell(sun, i, x + 0.5, y + 0.5, sx, sy, span[0], span[1]);
            cells.add(c === null ? 'aussen' : c.join(','));
            if (c === null) continue;
            const p = paneAt(i, c[0], c[1]);
            if (!opaque && p !== null) met.add(p);
          }
          if (cells.size > 1) conflicts++;
        }
      }
      return { conflicts, met };
    };
    // The scenario's early sun (summer 06:00) and others: never two cells, every pane on the floor.
    const scene = buntglasBild();
    for (const [season, hour] of [
      [scene.jahreszeit, scene.stunde],
      ['sommer', 6.75],
      ['sommer', 8],
      ['fruehling', 7.5],
      ['winter', 9.5],
    ] as const) {
      const now = walk(season, hour, paneCell);
      expect(now.conflicts, `${season} ${hour}`).toBe(0);
      if (hour === scene.stunde) expect([...now.met].sort()).toEqual(['blau', 'gold', 'gruen', 'rot']);
    }
    // Before: the middle of each block's own path – rays through two blocks sampled two cells (MIN: blue × gold = teal).
    expect(walk('sommer', 6.75, paneCellBefore).conflicts).toBeGreaterThan(10);
  });

  it.runIf(ready)('Szenario: jede Scheibe liegt als Fleck auf den Dielen, der blaue mindestens 4 × 4 px; die Traufe lässt um 06:00 die oberste Reihe frei', () => {
    const a = atlas();
    if (a === null) return;
    const w = scenarioCabin();
    const sun = new SunCasterList();
    new BuildingOccluders().collect(w.building.structures, w.building.catalog, 0, OFFSET, OFFSET, OFFSET + 19, OFFSET + 15, () => 0, new OccluderList(), sun, a.panes);
    // The room's floor (inside the walls) of the scenario's cabin: 8 × 6 tiles, walls round.
    const x0 = (OFFSET + SITE.x + 1) * TILE_PX;
    const y0 = (OFFSET + SITE.y + 1) * TILE_PX;
    const scene = buntglasBild();
    const now = patchMap(sun, scene.jahreszeit, scene.stunde, atlasPanes(sun, a.img), x0, y0, 6 * TILE_PX, 4 * TILE_PX);
    const squares = Object.fromEntries((Object.keys(PANES) as Pane[]).map((p) => [p, largestSquare(now.map, p)]));
    expect(squares['blau'], 'blauer Fleck').toBeGreaterThanOrEqual(4);
    for (const p of ['rot', 'gruen', 'gold'] as const) expect(squares[p], p).toBeGreaterThanOrEqual(2);
    // The pane's top row (frame row 13) reaches the floor: the eave lets it pass at 06:00 – and cut it off at 06:45.
    expect(now.rows.has(OPENING.row)).toBe(true);
    expect(patchMap(sun, 'sommer', 6.75, atlasPanes(sun, a.img), x0, y0, 6 * TILE_PX, 4 * TILE_PX).rows.has(OPENING.row)).toBe(false);
    // Before: blue as the top-right corner – at most 2 × 2 px on the floor at 06:45 and at 06:00.
    for (const hour of [6.75, scene.stunde]) expect(largestSquare(patchMap(sun, 'sommer', hour, layoutPanes(LAYOUT_BEFORE), x0, y0, 6 * TILE_PX, 4 * TILE_PX).map, 'blau'), `vorher ${hour}`).toBeLessThanOrEqual(2);
  });

  /**
   * The composition's pixel under a pane on the room's floor (composite.frag): the sky under the roof reflected with the
   * daylight's spectral colour, the sun through the pane (its visibility stepped by the dither: `level`) with the pane's
   * (`reflectGlassLight`). `split`: the sun's warmth over the morning.
   */
  const pixel = (albedo: Rgb, through: Rgb, warmth: number, level = 1): Rgb => {
    const d = new SkyState().directional;
    splitDaylight(1 - DAYLIGHT.skyShare, warmth, d);
    const roof = BUILDING_SUN.roofSkyShare;
    const sky = reflectLight(albedo[0], albedo[1], albedo[2], d.skyR * roof, d.skyG * roof, d.skyB * roof, [0, 0, 0]);
    const glass = reflectGlassLight(albedo[0], albedo[1], albedo[2], d.dirR * through[0] * level, d.dirG * through[1] * level, d.dirB * through[2] * level);
    return [sky[0] + glass[0], sky[1] + glass[1], sky[2] + glass[2]];
  };
  /** Before M5-68: the painted colour (no density) in one reflection with the sky (the daylight's spectral share). */
  const pixelBefore = (albedo: Rgb, pane: Rgb, warmth: number): Rgb => {
    const d = new SkyState().directional;
    splitDaylight(1 - DAYLIGHT.skyShare, warmth, d);
    const roof = BUILDING_SUN.roofSkyShare;
    const peak = Math.max(...pane);
    const t = pane.map((v) => (v / peak) * GLASS.transmission);
    return reflectLight(albedo[0], albedo[1], albedo[2], d.skyR * roof + d.dirR * (t[0] ?? 0), d.skyG * roof + d.dirG * (t[1] ?? 0), d.skyB * roof + d.dirB * (t[2] ?? 0), [0, 0, 0]);
  };
  /** The sun's warmth from high morning to the horizon (skyScene: `skyCoolness` + up to 0.12 for a low sun). */
  const WARMTHS = [DAYLIGHT.skyCoolness, DAYLIGHT.skyCoolness + 0.06, 2 * DAYLIGHT.skyCoolness] as const;
  /** The sun visibility 0.85 stepped by the dither (⅛ steps of its brightest channel): down to 6/8, up to 7/8. */
  const LEVELS = [lightBandLevel(GLASS.transmission, DAYLIGHT_STEPS.levels, 0) / GLASS.transmission, 1, lightBandLevel(GLASS.transmission, DAYLIGHT_STEPS.levels, 1) / GLASS.transmission] as const;

  it('Pixelprobe am Spiegel: jede Scheibe auf den Dielen im Farbton ihres Glases (± 20°), der Fleck doppelt so hell wie der Boden', () => {
    let worst = 0;
    for (const board of BOARDS) {
      const albedo = colour(board);
      for (const warmth of WARMTHS) {
        const floor = pixel(albedo, [0, 0, 0], warmth);
        let patch = 0;
        for (const level of LEVELS) {
          for (const [name, ref] of Object.entries(PANES)) {
            const glass = colour(ref);
            const on = pixel(albedo, glassThrough(glass), warmth, level);
            const gap = hueGap(hue(on), hue(glass));
            worst = Math.max(worst, gap);
            expect(gap, `${board} ${name} Wärme ${warmth} Stufe ${level}`).toBeLessThanOrEqual(20);
            if (level === 1) patch += luma(on) / Object.keys(PANES).length;
          }
          // Brighter than the floor beside it, whatever the step.
          for (const ref of Object.values(PANES)) expect(luma(pixel(albedo, glassThrough(colour(ref)), warmth, level)), `${board} ${ref}`).toBeGreaterThan(1.4 * luma(floor));
        }
        expect(patch / luma(floor), `${board} ${warmth}`).toBeGreaterThanOrEqual(2);
      }
    }
    expect(worst).toBeGreaterThan(5);
    // Before (the painted colour in one reflection with the sky): blue teal on the planks, more than 40° off its glass.
    for (const board of ['holz.2', 'holz.3']) {
      for (const warmth of WARMTHS) expect(hueGap(hue(pixelBefore(colour(board), colour(PANES.blau), warmth)), hue(colour(PANES.blau))), `${board} ${warmth}`).toBeGreaterThan(40);
    }
    // Each correction alone falls short on some board: the density without the pane's own reflection, and the reverse.
    const partial = (dense: boolean, own: boolean): number => {
      let gap = 0;
      for (const board of BOARDS) {
        const albedo = colour(board);
        for (const warmth of WARMTHS) {
          const d = new SkyState().directional;
          splitDaylight(1 - DAYLIGHT.skyShare, warmth, d);
          const roof = BUILDING_SUN.roofSkyShare;
          for (const ref of Object.values(PANES)) {
            const glass = colour(ref);
            const peak = Math.max(...glass);
            const t = glass.map((v) => (dense ? Math.pow(v / peak, GLASS.density) : v / peak) * GLASS.transmission);
            const sun = [d.dirR * (t[0] ?? 0), d.dirG * (t[1] ?? 0), d.dirB * (t[2] ?? 0)] as const;
            const on: Rgb = own
              ? (() => {
                  const s = reflectLight(albedo[0], albedo[1], albedo[2], d.skyR * roof, d.skyG * roof, d.skyB * roof, [0, 0, 0]);
                  const g = reflectGlassLight(albedo[0], albedo[1], albedo[2], ...sun);
                  return [s[0] + g[0], s[1] + g[1], s[2] + g[2]];
                })()
              : reflectLight(albedo[0], albedo[1], albedo[2], d.skyR * roof + sun[0], d.skyG * roof + sun[1], d.skyB * roof + sun[2], [0, 0, 0]);
            gap = Math.max(gap, hueGap(hue(on), hue(glass)));
          }
        }
      }
      return gap;
    };
    expect(partial(true, false)).toBeGreaterThan(20);
    expect(partial(false, true)).toBeGreaterThan(20);
    expect(partial(true, true)).toBeLessThanOrEqual(worst);
  });

  it('Klarglas lässt die Sonne grau durch, Buntglas in seinem Farbton, fast gesättigt', () => {
    // Clear glass (the ramp `eis`: the sky's reflex painted on the pane) lets the sun through grey; stained glass its hue.
    const { first, last } = glassClearIndices();
    expect(last - first + 1).toBe(PALETTE_RAMPS.find((r) => r.name === GLASS.clearRamp)?.size);
    for (let k = first; k <= last; k++) {
      const through = paneLight(k, colour(`eis.${k - first}`));
      expect(through).toEqual([GLASS.transmission, GLASS.transmission, GLASS.transmission]);
      expect(glassTint(Math.min(...through), Math.max(...through))).toBe(0);
    }
    // Before: the reflex of clear glass threw blue light (its red a quarter below its blue).
    const reflex = colour('eis.1');
    expect(reflex[0] / reflex[2]).toBeLessThan(0.75);
    const red = paneLight(first - 10, colour(PANES.rot));
    expect(glassTint(Math.min(...red), Math.max(...red))).toBe(1);
    expect(red).toEqual(glassThrough(colour(PANES.rot)));
    // Pure hue at full brightness (whiten 0): the red pane's peak is the transmission, its blue nearly nothing.
    expect(Math.max(...red)).toBeCloseTo(GLASS.transmission, 12);
    expect(red[2]).toBeLessThan(0.2);
    // Beer–Lambert (M5-68): each pane keeps its brightest channel and hue family, its others sink to the density's power –
    // the blue pane's red from 29 % to 5 % of its blue, its green from 80 % to 58 %.
    const blue = colour(PANES.blau);
    const bt = glassThrough(blue);
    expect(bt[2]).toBeCloseTo(GLASS.transmission, 12);
    expect(bt[0] / bt[2]).toBeCloseTo(Math.pow(blue[0] / blue[2], GLASS.density), 12);
    expect(bt[0] / bt[2]).toBeLessThan(0.06);
    expect(bt[1] / bt[2]).toBeGreaterThan(0.5);
    for (const ref of Object.values(PANES)) {
      const glass = colour(ref);
      expect(hueGap(hue(glassThrough(glass)), hue(glass)), ref).toBeLessThan(15);
      expect(glassTint(Math.min(...glassThrough(glass)), Math.max(...glassThrough(glass))), ref).toBe(1);
    }
    // Reflected in its own hue: on any albedo exactly the light's hue (share 1), scaled by the reflectance.
    const light: Rgb = [0.02, 0.2, 0.35];
    const on = reflectGlassLight(0.52, 0.34, 0.21, ...light);
    expect(hue(on)).toBeCloseTo(hue(light), 9);
    expect(reflectGlassLight(0.52, 0.34, 0.21, 0, 0, 0)).toEqual([0, 0, 0]);
  });

  it('GLSL = Spiegel: glassTint, Dichte der Scheibe, scharfe Scheiben in sunVisibility, Ebene und Klarglas im Block-Shader, eigener Farbton in der Komposition', () => {
    const tint = glslScalar('shadow.glsl', 'glassTint', lightStrandDefines());
    for (const [lo, hi] of [
      [0, 0],
      [1, 1],
      [0.85, 0.85],
      [0.84, 0.85],
      [0.1, 0.85],
      [0.5, 0.52],
      [0.5, 0.53],
    ] as const) {
      expect(tint(lo, hi), `${lo} ${hi}`).toBe(glassTint(lo, hi));
    }
    expect(glassTint(0.5, 0.5 + 1 / 255)).toBe(0);
    const channel = glslScalar('shadow_glass.glsl', 'glassChannel', lightStrandDefines());
    for (const [c, peak] of [
      [0, 1],
      [0.18, 0.62],
      [0.5, 0.62],
      [0.62, 0.62],
      [0.3, 0.9],
    ] as const) {
      expect(channel(c, peak), `${c} ${peak}`).toBeCloseTo(glassChannel(c, peak), 12);
    }
    const glassSrc = (SHADERS['shadow_glass.glsl'] ?? '').replace(/\s+/g, ' ');
    expect(glassSrc).toContain('return vec3(glassChannel(pane.r, peak), glassChannel(pane.g, peak), glassChannel(pane.b, peak));');
    const shadow = (SHADERS['shadow.glsl'] ?? '').replace(/\s+/g, ' ');
    expect(shadow).toContain('vec3 own = sunTap(map, at, z, tolerance); if (glassTint(min(min(own.r, own.g), own.b), max(max(own.r, own.g), own.b)) > 0.5) return own; vec3 sum = own * 2.0;');
    // The composition: sky and sun add up to the daylight (the point light's soft add reads all of it); what came through
    // a stained-glass pane is reflected in the pane's own hue, the rest with the daylight's spectral colour.
    const comp = (SHADERS['composite.frag'] ?? '').replace(/\s+/g, ' ');
    expect(comp).toContain('vec3 direct = uDirLight * shade * sun * cloud; day += direct;');
    expect(comp).toContain('if (glassTint(min(min(sun.r, sun.g), sun.b), max(max(sun.r, sun.g), sun.b)) > 0.5) glassLight = direct;');
    expect(comp).toContain('float over = pointOverDaylight(day, uDayLevel);');
    expect(comp).toContain('lit = reflectLight(albedo, day - glassLight) + reflectGlassLight(albedo, glassLight) + reflectLight(albedo, warmLight(dynamic));');
    expect(comp).toContain('vec3 reflectGlassLight(vec3 albedo, vec3 light) { if (!(light.r + light.g + light.b > 0.0)) return vec3(0.0); return mix(albedo * light, light * lightReflectance(albedo, light), DH_GLASS_SPECTRAL); }');
    const block = (SHADERS['shadow_block.frag'] ?? '').replace(/\s+/g, ' ');
    expect(block).toContain('float plane = alongY ? 0.5 * (vBox.x + vBox.z) : 0.5 * (vBox.y + vBox.w);');
    expect(block).toContain('float t = abs(across) < PARALLEL ? 0.5 * (from + to) : clamp(((alongY ? vWorld.x : vWorld.y) - plane) / across, vSpan.x, vSpan.y);');
    expect(block).toContain('if (glass) through = clearPane ? vec3(DH_GLASS_TRANSMISSION) : glassThrough(paletteColor(uPaletteLut, index, int(vFrame.x + 0.5)));');
    const defines = lightStrandDefines();
    expect(defines['DH_GLASS_CLEAR_FIRST']).toBe(String(glassClearIndices().first));
    expect(defines['DH_GLASS_CLEAR_LAST']).toBe(String(glassClearIndices().last));
    expect(defines['DH_GLASS_WHITEN']).toBe('0.0');
    expect(Number(defines['DH_GLASS_DENSITY'])).toBe(GLASS.density);
    expect(Number(defines['DH_GLASS_SPECTRAL'])).toBe(GLASS.spectralShare);
  });
});
