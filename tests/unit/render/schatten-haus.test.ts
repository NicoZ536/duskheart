/**
 * M5-02, M5-05: das Haus wirft seinen Sonnenschatten aus dem Bauraster (Wände, Türen, Fenster, Dach als Blöcke), nicht
 * aus seinen Sprites – drinnen, wo das Dach ausgeblendet und die Front gekappt ist, bleibt der Raum im Schatten des
 * Dachs, und die Sonne fällt nur durch die Fenster: durch Buntglas farbig (MASTERPROMPT §6.1 Pass 4/5, §16.2
 * „Buntglas“). Geprüft am CPU-Spiegel des Block-Shaders (`sunBlockSpan`, `paneCell`) mit dem Spiel-Atlas.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodePng } from '../../../tools/lib/png';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { MATERIAL } from '../../../src/render/gbuffer';
import { BuildingOccluders, PaneSprites, WALL_BAND } from '../../../src/render/light/buildingOccluders';
import { paneAxis, paneCell, sunBlockSpan } from '../../../src/render/light/lightMath';
import { OccluderList } from '../../../src/render/light/occluders';
import { BUILDING_SUN } from '../../../src/render/light/params';
import { SUN_CASTER_AXIS, SUN_CASTER_FLOATS, SUN_CASTER_KIND, SUN_CASTER_OFFSET, SunCasterList } from '../../../src/render/light/sunCasters';
import { SHADERS } from '../../../src/render/shaderLib';
import { createShadowVector, sunShadowAt } from '../../../src/world/calendar';
import { TILE_PX } from '../../../src/world/model/coords';
import { bauWelt, type BauWelt } from '../game/bau-testwelt';
import { meadow, OFFSET } from '../game/spieler-testwelt';

/** Inner tiles of the cabin (drawn coordinates) and its window in the east wall. */
const IN = { x0: 4, y0: 4, x1: 8, y1: 7 } as const;
const WINDOW = { x: IN.x1 + 1, y: 5 } as const;

/** A roofed cabin around the inner tiles with a door in the south wall and a stained-glass window in the east wall. */
function cabin(): BauWelt {
  const w = bauWelt(meadow(20, 16));
  w.spawn(6, 10);
  for (let x = IN.x0 - 1; x <= IN.x1 + 1; x++) {
    for (let y = IN.y0 - 1; y <= IN.y1 + 1; y++) {
      const edge = x === IN.x0 - 1 || x === IN.x1 + 1 || y === IN.y0 - 1 || y === IN.y1 + 1;
      if (!edge) continue;
      const part = x === WINDOW.x && y === WINDOW.y ? 'fenster_buntglas' : y === IN.y1 + 1 && x === 6 ? 'tuer_holz' : 'wand_holz';
      const r = w.build(part, x, y);
      if (r !== null) throw new Error(`${part} auf ${x},${y}: ${r}`);
    }
  }
  for (let y = IN.y0 - 1; y <= IN.y1 + 1; y++) {
    for (let x = IN.x0 - 1; x <= IN.x1 + 1; x++) {
      const r = w.build('dach_stroh', x, y);
      if (r !== null) throw new Error(`dach_stroh auf ${x},${y}: ${r}`);
    }
  }
  return w;
}

interface Kinds {
  opaque: number;
  pane: number;
  roofs: number;
}

function collect(w: BauWelt, panes: PaneSprites | null): SunCasterList {
  const sun = new SunCasterList();
  new BuildingOccluders().collect(w.building.structures, w.building.catalog, 0, OFFSET, OFFSET, OFFSET + 19, OFFSET + 15, () => 0, new OccluderList(), sun, panes);
  return sun;
}

function kinds(sun: SunCasterList): Kinds {
  const k: Kinds = { opaque: 0, pane: 0, roofs: 0 };
  for (let i = 0; i < sun.count; i++) {
    const o = i * SUN_CASTER_FLOATS + SUN_CASTER_OFFSET.span;
    const kind = sun.records[o + 2];
    if (kind === SUN_CASTER_KIND.paneSprite) k.pane++;
    else if (sun.records[o] === BUILDING_SUN.roofBottomPx) k.roofs++;
    else k.opaque++;
  }
  return k;
}

describe('Sonnenschatten des Hauses aus dem Bauraster (M5-02)', () => {
  it('Wände und Tür als Blöcke der Wandhöhe, das Fenster als Scheibe, jedes Dachtile als Platte darüber', () => {
    const w = cabin();
    const sun = collect(w, null);
    const k = kinds(sun);
    // 7 × 6 roof tiles over the whole house including its walls.
    expect(k.roofs).toBe(7 * 6);
    // Without the atlas the window is an open frame block (no pane sprite): still a caster.
    expect(k.pane).toBe(0);
    expect(k.opaque).toBeGreaterThan(20);
    for (let i = 0; i < sun.count; i++) {
      const o = i * SUN_CASTER_FLOATS + SUN_CASTER_OFFSET.span;
      const [bottom, top] = [sun.records[o] ?? -1, sun.records[o + 1] ?? -1];
      expect([`${bottom}-${top}`]).toContain(bottom === 0 ? `0-${BUILDING_SUN.wallTopPx}` : `${BUILDING_SUN.roofBottomPx}-${BUILDING_SUN.roofTopPx}`);
    }
    // An open door takes its block away: the sun falls in through the doorway.
    const doorTx = OFFSET + 6;
    const doorTy = OFFSET + IN.y1 + 1;
    expect(w.rejection(w.act({ type: 'build.door', tx: doorTx, ty: doorTy, open: true }))).toBeNull();
    expect(kinds(collect(w, null)).opaque).toBeLessThan(k.opaque);
  });

  it('der Block-Shader rechnet dieselbe Projektion wie der Spiegel', () => {
    const frag = (SHADERS['shadow_block.frag'] ?? '').replace(/\s+/g, ' ');
    expect(frag).toContain('float from = max(max(ix.x, iy.x), vSpan.x);');
    expect(frag).toContain('float to = min(min(ix.y, iy.y), vSpan.y);');
    expect(frag).toContain('ivec2 cell = ivec2(int(floor(along - vPane.x)), int(floor(vPane.w - (t - vSpan.x))));');
    // A caster point on or under the ground of its texel shades nothing there – and must not blacken the light of a
    // higher one (a house on a raised level: the level's own block under the window's glass).
    expect(frag).toContain('if (from > to || shadowUnderGround(to)) discard;');
    expect((SHADERS['shadow_prism.frag'] ?? '').replace(/\s+/g, ' ')).toContain('if (from > to || shadowUnderGround(to)) discard;');
    expect((SHADERS['shadow_sprite.frag'] ?? '').replace(/\s+/g, ' ')).toContain('if (shadowUnderGround(height)) discard;');
  });
});

describe('Buntglas: farbiges Licht fällt in den Raum (M5-05)', () => {
  const mod = generatedAtlasModule();
  const albedoPath = join(process.cwd(), 'public/generated/atlas-albedo.png');
  const ready = mod !== null && existsSync(albedoPath);

  it.runIf(ready)('Morgensonne: der Raum liegt im Dachschatten, hinter dem Ostfenster liegen Flecken aus Scheibenfarbe', () => {
    if (mod === null) return;
    const manifest = manifestFromGenerated(mod);
    const img = decodePng(readFileSync(albedoPath));
    const panes = new PaneSprites();
    panes.bind(manifest);
    const w = cabin();
    const sun = collect(w, panes);
    expect(kinds(sun).pane).toBeGreaterThan(0);
    // The low morning sun of the scenario `buntglas` (06:45).
    const s = sunShadowAt('sommer', 6.75, createShadowVector());
    const sx = s.dirX * s.length;
    const sy = s.dirY * s.length;
    /** What reaches a floor point: 'dark' (an opaque caster above), 'lit', or a pane texel [column, row, caster]. */
    const at = (x: number, y: number): 'dark' | 'lit' | { col: number; row: number; i: number } => {
      let pane: { col: number; row: number; i: number } | null = null;
      for (let i = 0; i < sun.count; i++) {
        const span = sunBlockSpan(sun, i, x, y, sx, sy);
        if (span === null || span[1] <= 0.5) continue;
        const kind = sun.records[i * SUN_CASTER_FLOATS + SUN_CASTER_OFFSET.span + 2];
        if (kind !== SUN_CASTER_KIND.paneSprite) return 'dark';
        const cell = paneCell(sun, i, x, y, sx, sy, span[0], span[1]);
        if (cell === null) return 'dark';
        pane = { col: cell[0], row: cell[1], i };
      }
      return pane ?? 'lit';
    };
    const texel = (p: { col: number; row: number; i: number }): { alpha: number; material: number } => {
      const o = p.i * SUN_CASTER_FLOATS + SUN_CASTER_OFFSET.pane;
      const tx = (sun.records[o + 1] ?? 0) + p.col;
      const ty = (sun.records[o + 2] ?? 0) + p.row;
      const k = (ty * img.width + tx) * 4;
      return { alpha: img.rgba[k + 3] ?? 0, material: img.rgba[k + 2] ?? 0 };
    };
    // The middle of the room: in the roof's shadow.
    const mid = { x: (OFFSET + 6) * TILE_PX + 8, y: (OFFSET + 5) * TILE_PX + 8 };
    expect(at(mid.x, mid.y)).toBe('dark');
    // Outside west of the house in the open: sunlit.
    expect(at((OFFSET + 1) * TILE_PX, (OFFSET + 12) * TILE_PX)).toBe('lit');
    // West of the east window, inside the room: the panes' texels – coloured glass (glossy `nass` = MATERIAL.wet).
    const east = (OFFSET + WINDOW.x) * TILE_PX + WALL_BAND.from;
    let glass = 0;
    let checked = 0;
    for (let dx = 4; dx <= 32; dx++) {
      for (let y = (OFFSET + WINDOW.y - 1) * TILE_PX; y < (OFFSET + WINDOW.y + 1) * TILE_PX; y++) {
        const r = at(east - dx + 0.5, y + 0.5);
        if (typeof r === 'string') continue;
        expect(paneAxis(sun, r.i)).toBe(SUN_CASTER_AXIS.y);
        checked++;
        const t = texel(r);
        if (t.alpha > 128 && (t.material & MATERIAL.wet) !== 0) glass++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(glass).toBeGreaterThan(25);
  });
});
