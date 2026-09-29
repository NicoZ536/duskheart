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
 * Die Komposition bleibt unverändert: der Raum bekommt Himmel × Dachanteil, der Fleck dazu Sonne × Scheibe
 * (reflectLight mit der Spektralfarbe des Tageslichts, ADR-0018).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodePng } from '../../../tools/lib/png';
import { PALETTE_HEX, PALETTE_RAMPS } from '../../../src/generated/palette';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { BuildingOccluders, PaneSprites } from '../../../src/render/light/buildingOccluders';
import { glassThrough, glassTint, paneLight } from '../../../src/render/light/glass';
import { paneCell, sunBlockSpan } from '../../../src/render/light/lightMath';
import { OccluderList } from '../../../src/render/light/occluders';
import { BUILDING_SUN, DAYLIGHT, GLASS, glassClearIndices, lightStrandDefines } from '../../../src/render/light/params';
import { splitDaylight } from '../../../src/render/light/skyMath';
import { SkyState } from '../../../src/render/light/sky';
import { reflectLight } from '../../../src/render/light/spectral';
import { SUN_CASTER_FLOATS, SUN_CASTER_KIND, SUN_CASTER_OFFSET, SunCasterList } from '../../../src/render/light/sunCasters';
import { SHADERS } from '../../../src/render/shaderLib';
import { createShadowVector, sunShadowAt } from '../../../src/world/calendar';
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

describe('Buntglas im Endbild (M5-58)', () => {
  const mod = generatedAtlasModule();
  const albedoPath = join(process.cwd(), 'public/generated/atlas-albedo.png');
  const ready = mod !== null && existsSync(albedoPath);

  it.runIf(ready)('ein Strahl tastet eine Scheibe ab, auch durch zwei Blöcke des Fensters – alle vier Farben liegen auf dem Boden', () => {
    if (mod === null) return;
    const manifest = manifestFromGenerated(mod);
    const img = decodePng(readFileSync(albedoPath));
    const panes = new PaneSprites();
    panes.bind(manifest);
    const w = cabin();
    const sun = new SunCasterList();
    new BuildingOccluders().collect(w.building.structures, w.building.catalog, 0, OFFSET, OFFSET, OFFSET + 19, OFFSET + 15, () => 0, new OccluderList(), sun, panes);
    const paneCasters: number[] = [];
    for (let i = 0; i < sun.count; i++) if (sun.records[i * SUN_CASTER_FLOATS + SUN_CASTER_OFFSET.span + 2] === SUN_CASTER_KIND.paneSprite) paneCasters.push(i);
    // The window of a north–south wall: its knot and the arms to both neighbours.
    expect(paneCasters.length).toBe(3);
    const east = (OFFSET + WINDOW.x) * TILE_PX;
    const refs = Object.fromEntries(Object.entries(PANES).map(([k, ref]) => [colour(ref).map((v) => Math.round(v * 255)).join(','), k]));
    /** Over the floor west of the window: points whose ray samples two different cells, and the pane colours met. */
    const walk = (season: 'sommer' | 'fruehling' | 'winter', hour: number, cell: typeof paneCell) => {
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
            const o = i * SUN_CASTER_FLOATS + SUN_CASTER_OFFSET.pane;
            const k = (((sun.records[o + 2] ?? 0) + c[1]) * img.width + (sun.records[o + 1] ?? 0) + c[0]) * 4;
            const hex = PALETTE_HEX[(img.rgba[k] ?? 0) - 1] ?? '';
            const rgb = [1, 3, 5].map((p) => parseInt(hex.slice(p, p + 2), 16)).join(',');
            if (!opaque && refs[rgb] !== undefined && (img.rgba[k + 3] ?? 0) > 128) met.add(refs[rgb] ?? '');
          }
          if (cells.size > 1) conflicts++;
        }
      }
      return { conflicts, met };
    };
    // The scenario's low morning sun (summer 06:45) and others: never two cells, every pane on the floor.
    for (const [season, hour] of [
      ['sommer', 6.75],
      ['sommer', 8],
      ['fruehling', 7.5],
      ['winter', 9.5],
    ] as const) {
      const now = walk(season, hour, paneCell);
      expect(now.conflicts, `${season} ${hour}`).toBe(0);
      if (season === 'sommer' && hour === 6.75) expect([...now.met].sort()).toEqual(['blau', 'gold', 'gruen', 'rot']);
    }
    // Before: the middle of each block's own path – rays through two blocks sampled two cells (MIN: blue × gold = teal).
    expect(walk('sommer', 6.75, paneCellBefore).conflicts).toBeGreaterThan(10);
  });

  it('Pixelprobe am Spiegel: der Fleck auf den Dielen doppelt so hell wie der Boden daneben, jede Scheibe in ihrem Farbton', () => {
    // The scenario's light: the sun's full share at 06:45, the room under its roof (sky × roof share), flat floor boards –
    // the composition's daylight (composite.frag): reflectLight(albedo, sky × roof + directed × sun).
    const d = new SkyState().directional;
    splitDaylight(0.5, DAYLIGHT.skyCoolness, d);
    const roof = BUILDING_SUN.roofSkyShare;
    const lit = (albedo: Rgb, sun: Rgb): Rgb => reflectLight(albedo[0], albedo[1], albedo[2], d.skyR * roof + d.dirR * sun[0], d.skyG * roof + d.dirG * sun[1], d.skyB * roof + d.dirB * sun[2], [0, 0, 0]);
    for (const board of ['holz.2', 'holz.3']) {
      const albedo = colour(board);
      const floor = lit(albedo, [0, 0, 0]);
      const added = (ref: string): Rgb => {
        const c = lit(albedo, paneLight(1, colour(ref)));
        return [c[0] - floor[0], c[1] - floor[1], c[2] - floor[2]];
      };
      let patch = 0;
      for (const [name, ref] of Object.entries(PANES)) {
        patch += luma(lit(albedo, glassThrough(colour(ref)))) / 4;
        // What the pane adds on the boards: its own hue, not the boards' brown (within 45°; gold is a warm yellow).
        const a = added(ref);
        expect(hueGap(hue(a), hue(glassThrough(colour(ref)))), `${board} ${name}`).toBeLessThan(45);
        // Blue stays blue-ish (bluer than the red of the boards), green green.
        if (name === 'blau') expect(a[2], board).toBeGreaterThan(a[0]);
        if (name === 'gruen') expect(a[1], board).toBeGreaterThan(a[0]);
      }
      expect(patch / luma(floor), board).toBeGreaterThanOrEqual(2);
      // The four hues stay apart on the boards in the panes' order (red 9°, gold 26°, green 77°, blue 167° on holz.2);
      // red and gold, 17° apart, differ in their green as well: gold's is at least twice red's share.
      const hues = [PANES.rot, PANES.gold, PANES.gruen, PANES.blau].map((ref) => hue(added(ref)));
      for (let k = 1; k < hues.length; k++) expect((hues[k] ?? 0) - (hues[k - 1] ?? 0), `${board} ${k}`).toBeGreaterThan(12);
      const greenShare = (c: Rgb): number => c[1] / c[0];
      expect(greenShare(added(PANES.gold)), board).toBeGreaterThan(2 * greenShare(added(PANES.rot)));
    }
  });

  it('Klarglas lässt die Sonne grau durch, Buntglas in reinem Farbton', () => {
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
  });

  it('GLSL = Spiegel: glassTint, scharfe Scheiben in sunVisibility, Ebene und Klarglas im Block-Shader', () => {
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
    const shadow = (SHADERS['shadow.glsl'] ?? '').replace(/\s+/g, ' ');
    expect(shadow).toContain('vec3 own = sunTap(map, at, z, tolerance); if (glassTint(min(min(own.r, own.g), own.b), max(max(own.r, own.g), own.b)) > 0.5) return own; vec3 sum = own * 2.0;');
    // The composition reflects sky and sun as one daylight, the pane's colour included.
    const comp = (SHADERS['composite.frag'] ?? '').replace(/\s+/g, ' ');
    expect(comp).toContain('day += uDirLight * shade * sun * cloud;');
    expect(comp).toContain('lit = reflectLight(albedo, day) + reflectLight(albedo, warmLight(dynamic));');
    const block = (SHADERS['shadow_block.frag'] ?? '').replace(/\s+/g, ' ');
    expect(block).toContain('float plane = alongY ? 0.5 * (vBox.x + vBox.z) : 0.5 * (vBox.y + vBox.w);');
    expect(block).toContain('float t = abs(across) < PARALLEL ? 0.5 * (from + to) : clamp(((alongY ? vWorld.x : vWorld.y) - plane) / across, vSpan.x, vSpan.y);');
    expect(block).toContain('if (glass) through = clearPane ? vec3(DH_GLASS_TRANSMISSION) : glassThrough(paletteColor(uPaletteLut, index, int(vFrame.x + 0.5)));');
    const defines = lightStrandDefines();
    expect(defines['DH_GLASS_CLEAR_FIRST']).toBe(String(glassClearIndices().first));
    expect(defines['DH_GLASS_CLEAR_LAST']).toBe(String(glassClearIndices().last));
    expect(defines['DH_GLASS_WHITEN']).toBe('0.0');
  });
});
