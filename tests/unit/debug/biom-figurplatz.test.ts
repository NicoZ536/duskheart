/**
 * Figurplatz der Biombilder (M7-145; MASTERPROMPT §31.5; src/debug/biomScenarios.ts `clearSpot`): die Figur steht auf freiem
 * Boden – keine Ortsfläche (`TILE_FLAG_PLACE`: dort liegt keine Bodendeko, die Figur stand in einer kahlen rechteckigen Grube,
 * `biom-gruenhain-tag`) in zwei Kacheln Umkreis, und keine Baumkrone über ihr (ein Baum vor ihr, also südlich und später
 * gezeichnet, dessen Krone bis zu fünf Reihen hoch und zwei Kacheln zu jeder Seite der Stammmitte reicht – die Figur stand
 * unter einer Kiefernkrone, `biom-salzkueste-tag`) und keine höhere Ebene in drei Kacheln Umkreis (`inHollow`: am Seeufer des
 * Grünhains stand die Figur auf Ebene 0 unter den Klippen der Ebene 1 im Norden und Westen – keine Ortsfläche, aber eine
 * rechteckige Grube). Geprüft an Kunstwelten und an der Welt der Biom-Serie (Seed 20260923, mittel): dort steht die Figur
 * jedes Oberflächenbioms auf freiem Boden, und nichts liegt in Reichweite (der Strand der Salzküste findet den Platz erst
 * neun Kacheln von der Mitte – die Suche nach freiem Boden reicht dafür weiter, statt die leere Reichweite aufzugeben).
 */
import { describe, expect, it } from 'vitest';
import { WORLD_OBJECTS } from '../../../src/content/worldObjects';
import { BIOMES } from '../../../src/content/biomes';
import { clearSpot, crownOver, inHollow, KLIPPEN_STAGES, nothingInReach, placeNear } from '../../../src/debug/biomScenarios';
import { surfaceShowcase } from '../../../src/render/world/showcase';
import { SurfaceWorldQuery } from '../../../src/render/world/surfaceScene';
import { generateChunk } from '../../../src/world/gen/chunk';
import { generateWorld } from '../../../src/world/gen/world';
import type { Layer } from '../../../src/world/model/coords';
import { ChunkData, TILE_FLAG_PLACE, TILE_FLAG_ROAD } from '../../../src/world/model/chunk';
import { CHUNK_SIZE } from '../../../src/world/model/coords';

/** Objects at [x, y, id]; everything else open. */
function objects(list: ReadonlyArray<readonly [number, number, string]>): Pick<SurfaceWorldQuery, 'objectAt'> {
  const at = new Map(list.map(([x, y, id]) => [`${x},${y}`, id]));
  return { objectAt: (x: number, y: number) => at.get(`${x},${y}`) ?? '' };
}

/** A world of one surface chunk (0, 0) with `flag` on the tiles `marked`; other chunks not resident. */
function flagged(marked: ReadonlyArray<readonly [number, number]>, flag = TILE_FLAG_PLACE): Pick<SurfaceWorldQuery, 'sim' | 'layer'> {
  const chunk = new ChunkData(0, 0, 0);
  for (const [x, y] of marked) chunk.flags[y * CHUNK_SIZE + x] = flag;
  const sim = { world: { chunks: { get: (_l: number, cx: number, cy: number) => (cx === 0 && cy === 0 ? chunk : undefined) } } };
  return { sim: sim as unknown as SurfaceWorldQuery['sim'], layer: 0 };
}

describe('Baumkrone über der Figur (crownOver)', () => {
  it('ein Baum vor der Figur bis fünf Reihen tief und zwei Kacheln seitlich deckt sie; dahinter, weiter weg oder kein Baum nicht', () => {
    const trees = WORLD_OBJECTS.filter((o) => o.kind === 'baum');
    const narrow = trees.find((o) => o.footprint.w === 1);
    const wide = trees.find((o) => o.footprint.w === 2);
    if (narrow === undefined || wide === undefined) throw new Error('Bäume fehlen');
    // In front (south), one to five rows: covered; six rows: its crown ends below the figure's head.
    for (let k = 1; k <= 5; k++) expect(crownOver(objects([[10, 10 + k, narrow.id]]), 10, 10), `k=${k}`).toBe(true);
    expect(crownOver(objects([[10, 16, narrow.id]]), 10, 10)).toBe(false);
    // Behind it (north) the figure stands in front of the tree.
    expect(crownOver(objects([[10, 8, narrow.id]]), 10, 10)).toBe(false);
    // Sideways: two tiles off the trunk the crown still reaches, three not.
    expect(crownOver(objects([[12, 12, narrow.id]]), 10, 10)).toBe(true);
    expect(crownOver(objects([[13, 12, narrow.id]]), 10, 10)).toBe(false);
    expect(crownOver(objects([[7, 12, narrow.id]]), 10, 10)).toBe(false);
    // A two-tile tree stands on its anchor and the tile east of it: its middle is half a tile further east.
    expect(crownOver(objects([[8, 12, wide.id]]), 10, 10)).toBe(true);
    expect(crownOver(objects([[7, 12, wide.id]]), 10, 10)).toBe(false);
    expect(crownOver(objects([[12, 12, wide.id]]), 10, 10)).toBe(false);
    // A rock in front is no crown.
    const rock = WORLD_OBJECTS.find((o) => o.kind !== 'baum' && o.blocking);
    expect(crownOver(objects([[10, 12, rock?.id ?? '']]), 10, 10)).toBe(false);
  });

  it('ohne Chunk (Objekt unbekannt) wartet die Suche', () => {
    expect(crownOver({ objectAt: () => null }, 10, 10)).toBeNull();
  });
});

describe('Ortsfläche nahe der Figur (placeNear)', () => {
  it('eine Ortskachel bis zwei Kacheln weit schließt den Platz aus, drei nicht; andere Kachelmarken zählen nicht', () => {
    expect(placeNear(flagged([[12, 12]]), 10, 10)).toBe(true);
    expect(placeNear(flagged([[10, 10]]), 10, 10)).toBe(true);
    expect(placeNear(flagged([[13, 10]]), 10, 10)).toBe(false);
    expect(placeNear(flagged([[10, 7]]), 10, 10)).toBe(false);
    expect(placeNear(flagged([[11, 11]], TILE_FLAG_ROAD), 10, 10)).toBe(false);
    // At the chunk's edge the neighbour chunk is not resident: wait.
    expect(placeNear(flagged([]), 1, 10)).toBeNull();
  });
});

/** Ground of level `level(x, y)` everywhere (null outside `[0, 64)²`: the chunk is missing). */
function levels(level: (x: number, y: number) => number): Pick<SurfaceWorldQuery, 'groundAt'> {
  return {
    groundAt: (x: number, y: number) => (x < 0 || y < 0 || x >= 64 || y >= 64 ? null : { terrain: 'gras', level: level(x, y), water: false, solid: false }),
  };
}

describe('Mulde unter Klippen (inHollow)', () => {
  it('höherer Boden bis drei Kacheln weit macht den Platz zur Mulde, vier nicht; tieferer Boden und gleiche Ebene nicht', () => {
    // A plateau of level 1 north of row 20.
    const north = levels((_x, y) => (y < 20 ? 1 : 0));
    expect(inHollow(north, 30, 22)).toBe(true);
    expect(inHollow(north, 30, 23)).toBe(false);
    // On the plateau itself the lower ground beside it is no hollow.
    expect(inHollow(north, 30, 19)).toBe(false);
    // A cliff to the west, diagonal included (the square round the spot).
    expect(inHollow(levels((x, y) => (x < 10 && y < 10 ? 2 : 0)), 12, 12)).toBe(true);
    expect(inHollow(levels((x, y) => (x < 10 && y < 10 ? 2 : 0)), 13, 12)).toBe(false);
    expect(inHollow(levels(() => 0), 30, 30)).toBe(false);
  });

  it('ohne Chunk wartet die Suche', () => {
    expect(inHollow(levels(() => 0), 1, 30)).toBeNull();
  });
});

describe('Figurplatz auf der Welt der Biom-Serie (Seed 20260923, mittel)', { timeout: 120_000 }, () => {
  it('jedes Oberflächenbiom: freier Boden (keine Ortsfläche, keine Krone, keine Mulde) und nichts in Reichweite; das Klippenbild am Fuß der Klippe', () => {
    const world = generateWorld(20260923, 'medium');
    const chunks = new Map<string, ChunkData>();
    const get = (layer: number, cx: number, cy: number): ChunkData => {
      const key = `${layer},${cx},${cy}`;
      let c = chunks.get(key);
      if (c === undefined) {
        c = generateChunk(world, layer as Layer, cx, cy);
        chunks.set(key, c);
      }
      return c;
    };
    const q = new SurfaceWorldQuery({ world: { chunks: { get } } } as unknown as SurfaceWorldQuery['sim']);
    q.layer = 0;
    const surface = BIOMES.filter((b) => b.layer === 0);
    expect(surface.length).toBeGreaterThanOrEqual(8);
    for (const b of surface) {
      const centre = surfaceShowcase(world, b.id);
      const spot = clearSpot(q, centre.tx, centre.ty);
      if (spot === null) throw new Error(`${b.id}: kein Platz`);
      expect(nothingInReach(q, spot.tx, spot.ty), `${b.id} Reichweite`).toBe(true);
      expect(placeNear(q, spot.tx, spot.ty), `${b.id} Ortsfläche`).toBe(false);
      expect(crownOver(q, spot.tx, spot.ty), `${b.id} Krone`).toBe(false);
      expect(inHollow(q, spot.tx, spot.ty), `${b.id} Mulde`).toBe(false);
    }
    // The cliff picture (M7-146): the same free ground, but at the foot of the Grünhain's cliffs.
    const centre = surfaceShowcase(world, 'gruenhain');
    const klippe = clearSpot(q, centre.tx, centre.ty, KLIPPEN_STAGES);
    if (klippe === null) throw new Error('gruenhain: kein Platz unter der Klippe');
    expect(inHollow(q, klippe.tx, klippe.ty)).toBe(true);
    expect(nothingInReach(q, klippe.tx, klippe.ty)).toBe(true);
    expect(crownOver(q, klippe.tx, klippe.ty)).toBe(false);
    expect(placeNear(q, klippe.tx, klippe.ty)).toBe(false);
  });
});
