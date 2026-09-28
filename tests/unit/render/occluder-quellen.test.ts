/**
 * M5-01, M5-34: woher die Occluder eines Frames kommen (MASTERPROMPT §6.1 Pass 3 „Wände, Stämme, Klippen, Felsen,
 * große Objekte“) – die Sprites mit Occluder-Form aus dem Atlas-Manifest (Stämme, Felsen, Möbel, Stationen), das
 * Gelände (erhöhte Stufen, Klippenwände, Fels) und das Bauraster (Wände und geschlossene Türen massiv, offene Türen
 * und Fenster frei, Zäune als Deko ihrer Höhe). Dazu das Occluder-Bit der Atlas-Pixel (G1.A `occluder` = 32).
 */
import { describe, expect, it } from 'vitest';
import { MATERIAL_BITS, type SpriteFrame } from '../../../assets-src/lib/sprite';
import { ATLAS_OCCLUDER_BIT, albedoFrameRgba } from '../../../tools/assets/normals';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import type { AtlasManifest, AtlasSprite } from '../../../src/render/assets/atlas';
import { SpriteDesc, SpriteList } from '../../../src/render/batch/spriteList';
import { MATERIAL } from '../../../src/render/gbuffer';
import { BuildingOccluders, FENCE_OCCLUDER, WALL_BAND, wallFootprint } from '../../../src/render/light/buildingOccluders';
import { castsSunShadow, glassSpriteIds, gridCastSpriteIds, LIGHT_CLASS, lightClassPixels } from '../../../src/render/light/lightClasses';
import { OCCLUDER_FLOATS, OCCLUDER_OFFSET, OCCLUDER_SHAPE, OccluderList, SpriteOccluders } from '../../../src/render/light/occluders';
import { OCCLUDER_CLASS, OPENING_MARK, ROOF_MARK, SDF, STRUCTURAL_TOP_PX } from '../../../src/render/light/params';
import { OccluderField, lightShadow, throughOpening } from '../../../src/render/light/lightMath';
import { jumpFloodSteps } from '../../../src/render/passes/occluderPass';
import { SHADERS } from '../../../src/render/shaderLib';
import { terrainOccluderOf, type TerrainTile } from '../../../src/render/light/terrainOccluders';
import { BLOCK_SOLID, BLOCK_VOID, BLOCK_WALL, packTileInfo } from '../../../src/world/collision/tiles';
import { WAND_PX_JE_STUFE } from '../../../src/world/autotile';
import { TILE_PX } from '../../../src/world/model/coords';
import { bauWelt, hut } from '../game/bau-testwelt';
import { meadow, OFFSET } from '../game/spieler-testwelt';

interface Record8 {
  cx: number;
  cy: number;
  hx: number;
  hy: number;
  top: number;
  cls: number;
  shape: number;
  ground: number;
}

function records(list: OccluderList): Record8[] {
  const out: Record8[] = [];
  const r = list.records;
  for (let i = 0; i < list.count; i++) {
    const o = i * OCCLUDER_FLOATS;
    out.push({
      cx: r[o] ?? 0,
      cy: r[o + 1] ?? 0,
      hx: r[o + 2] ?? 0,
      hy: r[o + 3] ?? 0,
      top: r[o + OCCLUDER_OFFSET.top] ?? 0,
      cls: r[o + OCCLUDER_OFFSET.cls] ?? 0,
      shape: r[o + OCCLUDER_OFFSET.shapePrism] ?? 0,
      ground: r[o + OCCLUDER_OFFSET.ground] ?? 0,
    });
  }
  return out;
}

/** A synthetic atlas sprite with one 16×32 frame at (fx, 0), anchor (8, 31). */
function sprite(id: string, fx: number, occluder: AtlasSprite['occluder'], boundsY = 4): AtlasSprite {
  return {
    id,
    group: 'probe',
    size: [16, 32],
    frames: [{ x: fx, y: 0, w: 16, h: 32, ax: 8, ay: 31 }],
    clips: {},
    sockets: {},
    heightHint: 'zylinder',
    emissive: false,
    symmetric: true,
    bounds: { x: 2, y: boundsY, w: 12, h: 32 - boundsY },
    occluder,
  };
}

const MANIFEST: AtlasManifest = {
  width: 64,
  height: 32,
  paletteRows: [],
  sourceHash: 'probe',
  sprites: {
    stamm: sprite('stamm', 0, { kind: 'ellipse', x: 9, y: 30, rx: 2, ry: 1.5 }),
    kiste: sprite('kiste', 16, { kind: 'rect', x: 2, y: 24, w: 12, h: 8 }, 12),
    wand: sprite('wand', 32, { kind: 'sprite' }),
    blume: sprite('blume', 48, { kind: 'none' }),
  },
};

function push(list: SpriteList, id: string, x: number, y: number, opts: { mirror?: boolean; layer?: SpriteDesc['layer']; heightBase?: number } = {}): void {
  const d = new SpriteDesc();
  const s = MANIFEST.sprites[id];
  if (s === undefined) throw new Error(id);
  d.frame = s.frames[0] ?? null;
  d.x = x;
  d.y = y;
  d.mirror = opts.mirror ?? false;
  d.layer = opts.layer ?? 'objects';
  d.heightBase = opts.heightBase ?? 0;
  list.push(d);
}

describe('Occluder der Sprites (Atlas-Manifest)', () => {
  it('Stamm (Ellipse) und Kiste (Rechteck) stehen am Anker, gespiegelt am Anker gespiegelt; Bauteile, Blumen und Kronen nicht', () => {
    const occ = new SpriteOccluders();
    occ.bind(MANIFEST);
    expect(occ.size).toBe(2);
    const list = new SpriteList();
    push(list, 'stamm', 100, 200);
    push(list, 'stamm', 150, 200, { mirror: true });
    push(list, 'kiste', 300, 400, { heightBase: 16 });
    push(list, 'wand', 400, 400);
    push(list, 'blume', 500, 400);
    push(list, 'stamm', 600, 400, { layer: 'canopy' });
    const out = new OccluderList();
    expect(occ.collect(list, out)).toBe(3);
    const [a, b, c] = records(out);
    // Ellipse centre 1 px east of the anchor column (9 − 8) and 1 px above the anchor row (30 − 31); mirrored: west.
    expect(a).toEqual({ cx: 101, cy: 199, hx: 2, hy: 1.5, top: 31 - 4, cls: OCCLUDER_CLASS.decor, shape: OCCLUDER_SHAPE.ellipse, ground: 0 });
    expect(b?.cx).toBe(149);
    // Rectangle (2…14, 24…32) around (8, 28) relative to the frame: 4 px above the anchor; its top counts from the
    // height base (a crate on a raised level).
    expect(c).toEqual({ cx: 300, cy: 397, hx: 6, hy: 4, top: 16 + 31 - 12, cls: OCCLUDER_CLASS.decor, shape: OCCLUDER_SHAPE.rect, ground: 0 });
  });

  it('das Spiel-Atlas-Manifest: Bäume, Felsen, Zäune werfen als Sprite, Wände, Türen, Fenster, Dächer aus dem Bauraster, Buntglas ist Glas', () => {
    const mod = generatedAtlasModule();
    if (mod === null) return;
    const m = manifestFromGenerated(mod);
    const s = (id: string): AtlasSprite => {
      const x = m.sprites[id];
      if (x === undefined) throw new Error(`${id} fehlt`);
      return x;
    };
    expect(s('bau_wand_holz').occluder?.kind).toBe('sprite');
    expect(s('bau_tuer_holz').occluder?.kind).toBe('sprite');
    expect(s('obj_kamin_stein').occluder?.kind).toBe('rect');
    // Standing trees, stumps and saplings (the felled trunks of `baumfall` lie flat and cast nothing).
    const trees = Object.values(m.sprites).filter((x) => x.group === 'baeume');
    expect(trees.length).toBeGreaterThan(0);
    for (const t of trees) expect(castsSunShadow(t), t.id).toBe(true);
    const glass = glassSpriteIds();
    expect(glass.has('bau_fenster_buntglas')).toBe(true);
    expect(glass.has('bau_wand_holz')).toBe(false);
    const classes = lightClassPixels(m);
    const pane = s('bau_fenster_buntglas').frames[0];
    const wall = s('bau_wand_holz').frames[0];
    if (pane === undefined || wall === undefined) throw new Error('Frames fehlen');
    expect((classes[pane.y * m.width + pane.x] ?? 0) & LIGHT_CLASS.glass).toBe(LIGHT_CLASS.glass);
    expect((classes[wall.y * m.width + wall.x] ?? 0) & LIGHT_CLASS.glass).toBe(0);
    // Walls, doors, windows and roofs cast from the build grid (sun casters), not as sprites; fences and pillars do.
    expect((classes[wall.y * m.width + wall.x] ?? 0) & LIGHT_CLASS.caster).toBe(0);
    const grid = gridCastSpriteIds();
    for (const id of ['bau_wand_stein', 'bau_tuer_holz', 'bau_tor_holz', 'bau_tor_holz_seite', 'bau_fenster_glas', 'bau_dach_stroh']) expect(grid.has(id), id).toBe(true);
    expect(castsSunShadow(s('bau_zaun_holz'), grid)).toBe(true);
    expect(castsSunShadow(s('bau_saeule_holz'), grid)).toBe(true);
    const fence = s('bau_zaun_holz').frames[0];
    if (fence === undefined) throw new Error('Frame fehlt');
    expect((classes[fence.y * m.width + fence.x] ?? 0) & LIGHT_CLASS.caster).toBe(LIGHT_CLASS.caster);
  });
});

describe('Occluder-Bit der Atlas-Pixel (G1.A)', () => {
  it('setzt Bit 32 auf deckenden Pixeln eines Sprites mit Occluder, nicht auf Dach-Pixeln und nicht ohne Occluder', () => {
    expect(ATLAS_OCCLUDER_BIT).toBe(MATERIAL.occluder);
    const frame: SpriteFrame = {
      index: Uint8Array.from([0, 5, 6, 7]),
      emissive: new Uint8Array(4),
      material: Uint8Array.from([0, MATERIAL_BITS.metall, MATERIAL_BITS.dach, 0]),
    } as unknown as SpriteFrame;
    const withOcc = albedoFrameRgba(frame, 2, 2, true);
    const without = albedoFrameRgba(frame, 2, 2, false);
    const b = (px: Uint8Array, i: number): number => px[i * 4 + 2] ?? 0;
    expect([b(withOcc, 0), b(withOcc, 1), b(withOcc, 2), b(withOcc, 3)]).toEqual([0, MATERIAL_BITS.metall | 32, MATERIAL_BITS.dach, 32]);
    expect([b(without, 1), b(without, 3)]).toEqual([MATERIAL_BITS.metall, 0]);
  });
});

describe('Occluder des Geländes', () => {
  const tile: TerrainTile = { top: 0, cls: OCCLUDER_CLASS.terrain, ground: 0 };

  it('erhöhte Stufe = Gelände ihrer Höhe, Klippenwand bis zur Kante auf ihrer unteren Stufe, Fels massiv', () => {
    terrainOccluderOf(packTileInfo(0, 2), tile);
    expect(tile).toEqual({ top: 2 * WAND_PX_JE_STUFE, cls: OCCLUDER_CLASS.terrain, ground: 2 * WAND_PX_JE_STUFE });
    terrainOccluderOf(packTileInfo(BLOCK_WALL, 1, 3), tile);
    expect(tile).toEqual({ top: 3 * WAND_PX_JE_STUFE, cls: OCCLUDER_CLASS.terrain, ground: WAND_PX_JE_STUFE });
    terrainOccluderOf(packTileInfo(BLOCK_SOLID, 0), tile);
    expect(tile).toEqual({ top: WAND_PX_JE_STUFE, cls: OCCLUDER_CLASS.structural, ground: 0 });
    terrainOccluderOf(packTileInfo(0, 0), tile);
    expect(tile.top).toBe(0);
    terrainOccluderOf(BLOCK_VOID, tile);
    expect([tile.top, tile.ground]).toEqual([0, 0]);
  });
});

describe('Occluder des Bauraster (M5-34)', () => {
  it('ein Wandstück liegt im Band 5–10 seiner Kachel und reicht zu verbundenen Nachbarn bis an den Kachelrand', () => {
    const out = new OccluderList();
    // Unconnected: east–west across the whole tile.
    wallFootprint(2, 3, 0, STRUCTURAL_TOP_PX, OCCLUDER_CLASS.structural, out);
    // North–south run (N | S): the band across plus arms to both edges.
    wallFootprint(5, 5, 1 | 4, STRUCTURAL_TOP_PX, OCCLUDER_CLASS.structural, out);
    const [ew, knot, north, south] = records(out);
    const x = 2 * TILE_PX;
    const y = 3 * TILE_PX;
    expect(ew).toMatchObject({ cx: x + TILE_PX / 2, cy: y + (WALL_BAND.from + WALL_BAND.to) / 2, hx: TILE_PX / 2, hy: (WALL_BAND.to - WALL_BAND.from) / 2, cls: OCCLUDER_CLASS.structural });
    expect(knot).toMatchObject({ cx: 5 * TILE_PX + (WALL_BAND.from + WALL_BAND.to) / 2, hx: (WALL_BAND.to - WALL_BAND.from) / 2 });
    expect(north).toMatchObject({ cy: 5 * TILE_PX + WALL_BAND.from / 2 });
    expect(south).toMatchObject({ cy: 5 * TILE_PX + (WALL_BAND.to + TILE_PX) / 2 });
  });

  it('eine geschlossene Hütte: Wände und die geschlossene Tür massiv; geöffnet ist die Tür frei (nur als Öffnung markiert)', () => {
    const w = bauWelt(meadow(20, 20));
    w.spawn(5, 9);
    hut(w, 4, 4, 7, 6, 'wand_holz', 'tuer_holz', null);
    const occ = new BuildingOccluders();
    const collect = (): Record8[] => {
      const out = new OccluderList();
      occ.collect(w.building.structures, w.building.catalog, 0, OFFSET, OFFSET, OFFSET + 19, OFFSET + 19, () => 0, out);
      return records(out);
    };
    const closed = collect();
    expect(closed.length).toBeGreaterThan(0);
    for (const r of closed) expect([r.cls, r.top]).toEqual([OCCLUDER_CLASS.structural, STRUCTURAL_TOP_PX]);
    // The door (middle of the south wall) is part of the ring while closed.
    const doorTx = OFFSET + 5;
    const doorTy = OFFSET + 7;
    const inDoor = (r: Record8): boolean => Math.abs(r.cx - (doorTx * TILE_PX + TILE_PX / 2)) < TILE_PX / 2 && Math.floor(r.cy / TILE_PX) === doorTy;
    expect(closed.some(inDoor)).toBe(true);
    const events = w.act({ type: 'build.door', tx: doorTx, ty: doorTy, open: true });
    expect(w.rejection(events)).toBeNull();
    const open = collect();
    const blocking = (list: readonly Record8[]): Record8[] => list.filter((r) => r.cls !== OCCLUDER_CLASS.opening);
    expect(blocking(open).some(inDoor)).toBe(false);
    expect(blocking(open).length).toBeLessThan(closed.length);
    // The doorway is marked as an opening of the wall (no blocker: the light map comparison skips light through it).
    const doorway = open.filter(inDoor);
    expect(doorway.length).toBeGreaterThan(0);
    for (const r of doorway) expect(r.cls).toBe(OCCLUDER_CLASS.opening);
  });

  it('Fenster und offene Türen: Öffnungen der Wand – kein Sperrer, Licht durch sie ist im Abgleich nicht vergleichbar', () => {
    const f = new OccluderField(0, 0, 96, 64);
    const list = new OccluderList();
    // A wall along y 20…26 with a window tile at x 32…48; a roof over all of it.
    list.rect(0, 20, 32, 26, STRUCTURAL_TOP_PX, OCCLUDER_CLASS.structural);
    list.rect(32, 20, 48, 26, 0, OCCLUDER_CLASS.opening);
    list.rect(48, 20, 96, 26, STRUCTURAL_TOP_PX, OCCLUDER_CLASS.structural);
    list.rect(0, 0, 96, 40, 0, OCCLUDER_CLASS.roof);
    f.draw(list);
    f.flood(jumpFloodSteps(SDF.firstStepPx));
    const [i, j] = f.texel(40.5, 23.5);
    // No wall, no seed, still under the roof; the opening's mark wins over the roof's.
    expect(f.maskAt(i, j).structural).toBe(false);
    expect(f.isSeed(i, j)).toBe(false);
    expect(f.roofed(40.5, 23.5)).toBe(true);
    expect(f.opening(i, j)).toBe(true);
    expect(f.opening(...f.texel(40.5, 10.5))).toBe(false);
    expect(f.opening(...f.texel(10.5, 23.5))).toBe(false);
    // Light through the window: not comparable; beside it the wall blocks, and a ray inside the room passes no opening.
    expect(throughOpening(f, [30.5, 5.5], [44, 50])).toBe(true);
    expect(lightShadow(f, [30.5, 5.5], 0, false, false, [44, 50], 12, 0, -1, true)[1]).toBeGreaterThan(0);
    expect(throughOpening(f, [10.5, 50.5], [70, 50])).toBe(false);
    const glsl = (SHADERS['lighting_point.frag'] ?? '').replace(/\s+/g, ' ');
    expect(glsl).toContain('if (vis.y > 0.0 && throughOpening(uMask, ground, vGeom.xy)) unsure += 1.0;');
    const mask = (SHADERS['occluder_mask.frag'] ?? '').replace(/\s+/g, ' ');
    expect(mask).toContain('if (cls > DH_OCC_OPENING - 0.5) m.g = DH_OPENING_MARK;');
    expect(OPENING_MARK).toBeGreaterThan(ROOF_MARK);
    expect(OPENING_MARK).toBeLessThan(0.5);
  });

  it('Zäune sind Deko: ein Holzzaun sperrt nur an seinen Pfosten (die Riegel lassen Licht durch), eine Steinmauer als Band', () => {
    const w = bauWelt(meadow(20, 20));
    w.spawn(5, 10);
    for (let x = 3; x <= 6; x++) {
      for (const [part, y] of [
        ['zaun_holz', 8],
        ['zaun_stein', 12],
      ] as const) {
        const r = w.build(part, x, y);
        if (r !== null) throw new Error(`${part} at ${x},${y} refused: ${r}`);
      }
    }
    const out = new OccluderList();
    new BuildingOccluders().collect(w.building.structures, w.building.catalog, 0, OFFSET, OFFSET, OFFSET + 19, OFFSET + 19, () => 0, out);
    const all = records(out);
    const inRow = (y: number): Record8[] => all.filter((r) => Math.floor(r.cy / TILE_PX) === OFFSET + y);
    const wood = inRow(8);
    const post = FENCE_OCCLUDER.holz?.postPx ?? 0;
    expect(wood).toHaveLength(4);
    for (const [i, r] of wood.entries()) {
      expect(r).toMatchObject({ cx: (OFFSET + 3 + i) * TILE_PX + TILE_PX / 2, cy: (OFFSET + 8) * TILE_PX + WALL_BAND.to - post / 2, hx: post / 2, hy: post / 2, cls: OCCLUDER_CLASS.decor, top: FENCE_OCCLUDER.holz?.topPx });
    }
    // Between two posts the run is open: 16 − 4 px of every tile.
    expect(post).toBeLessThan(TILE_PX / 2);
    const stone = inRow(12);
    expect(stone.length).toBeGreaterThanOrEqual(4);
    for (const r of stone) expect([r.cls, r.top, r.hy]).toEqual([OCCLUDER_CLASS.decor, FENCE_OCCLUDER.stein?.topPx, (WALL_BAND.to - WALL_BAND.from) / 2]);
    // The stone run is closed from its first to its last tile.
    const west = Math.min(...stone.map((r) => r.cx - r.hx));
    const east = Math.max(...stone.map((r) => r.cx + r.hx));
    expect(east - west).toBeGreaterThanOrEqual(3 * TILE_PX);
  });
});
