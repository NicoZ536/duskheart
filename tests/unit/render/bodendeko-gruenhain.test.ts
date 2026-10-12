/**
 * M7-61: Bodendeko des ersten Bioms. Die Wiese des Grünhains bekommt Grashorste, Gänseblümchen und Butterblumen, der Strand
 * der Salzküste Strandgut (Muscheln, Kiesel, Seesterne) – in Gruppen über die Kachelgrenzen wie die Dünengras-Horste
 * (`groundDecor.ts`, M3-40). Die Regeln gelten nur in ihren Biomen (Gras und Sand teilen sich mehrere Biome), die Blüten nur
 * im Frühling und Sommer, und alle vier nur auf wildem, ebenem, trockenem Boden: nicht an Klippenkanten, nicht neben
 * Höhenstufen oder Wasser, nicht in der Fläche eines Ortes.
 */
import { describe, expect, it } from 'vitest';
import { SEASON_IDS } from '../../../src/content/balance';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { DECOR_SIZES, GROUND_DECOR_RULES, type GroundDecorRule } from '../../../src/render/world/groundDecor';
import { WorldObjectLayer } from '../../../src/render/world/objects';
import { ChunkSignatures } from '../../../src/render/world/signature';
import { decorSeasonMask, WorldRenderTables } from '../../../src/render/world/tables';
import { ChunkData, TILE_FLAG_CLIFF_EDGE, TILE_FLAG_PLACE, WATER_DEPTH_SHALLOW } from '../../../src/world/model/chunk';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';

const ids = contentWorldIdTables();
const T = (id: string): number => ids.terrain.runtimeId(id);
const B = (id: string): number => ids.biomes.runtimeId(id);
const CS = 32;
const TILE = 16;

const MANIFEST = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
const tables = new WorldRenderTables(MANIFEST);

const MEADOW = ['bodendeko_wiesengras', 'bodendeko_gaensebluemchen', 'bodendeko_butterblumen'] as const;
const FLOWERS = ['bodendeko_gaensebluemchen', 'bodendeko_butterblumen'] as const;
const BEACH = 'bodendeko_strandgut';

function ruleOf(sprite: string): GroundDecorRule {
  const r = GROUND_DECOR_RULES.find((x) => x.sprite === sprite);
  if (r === undefined) throw new Error(`Bodendeko-Regel ${sprite} fehlt`);
  return r;
}

/** A surface chunk of one ground and biome, flat and dry (patched by `fill`). */
function chunkOf(terrain: string, biome: string, cx = 2, cy = 3, fill?: (c: ChunkData) => void): ChunkData {
  const c = new ChunkData(0, cx, cy);
  c.ground.fill(T(terrain));
  c.biome.fill(B(biome));
  fill?.(c);
  return c;
}

/** The decor of `chunk` with its sprite id, anchor and tile index, in season `season` (`SEASON_IDS` index). */
function decorOf(chunk: ChunkData, season = 1): { sprite: string; x: number; y: number; tile: number }[] {
  const layer = new WorldObjectLayer(tables);
  layer.season = season;
  const sigs = new ChunkSignatures();
  sigs.beginFrame();
  const list = layer.listOf(chunk, sigs);
  return Array.from({ length: list.decorCount }, (_, k) => {
    const x = list.decorX[k] ?? 0;
    const y = list.decorY[k] ?? 0;
    return { sprite: tables.decorDefs[list.decorDef[k] ?? 0]?.sprite.id ?? '', x, y, tile: (Math.floor(y / TILE) - chunk.cy * CS) * CS + (Math.floor(x / TILE) - chunk.cx * CS) };
  });
}

function count(decor: { sprite: string }[], sprite: string): number {
  return decor.filter((d) => d.sprite === sprite).length;
}

describe('M7-61: Bodendeko des Grünhains und der Salzküste', () => {
  it('jede Regel nutzt ein Sprite mit drei Größen; Gras trägt Horste und zwei Blumen, Sand das Strandgut', () => {
    for (const sprite of [...MEADOW, BEACH]) {
      const def = tables.decorDefs.find((d) => d.sprite.id === sprite);
      expect(def?.frames, sprite).toHaveLength(DECOR_SIZES.length);
      expect(def?.rule.wildOnly, sprite).toBe(true);
    }
    expect((tables.groundDecor[T('gras')] ?? []).map((d) => d.sprite.id)).toEqual([...MEADOW]);
    expect((tables.groundDecor[T('sand')] ?? []).map((d) => d.sprite.id)).toEqual([BEACH]);
    // Salts far apart: no two rules read the same hash stream (the channel adds 0x01000000 per draw, at most 21 draws).
    const salts = GROUND_DECOR_RULES.map((r) => r.salt);
    for (const a of salts) for (const b of salts) if (a !== b) expect(Math.abs(a - b) % 0x01000000, `${a} ${b}`).not.toBe(0);
  });

  it('die Wiese des Grünhains wird dicht: Horste überall, Blütenflecken im Sommer; dasselbe bei jedem Aufbau', () => {
    const chunk = chunkOf('gras', 'gruenhain');
    const decor = decorOf(chunk);
    // A chunk is 64 cells of 4×4 tiles: more than half hold a clump of 8–15 tufts.
    expect(count(decor, 'bodendeko_wiesengras')).toBeGreaterThan(250);
    expect(count(decor, 'bodendeko_gaensebluemchen')).toBeGreaterThan(20);
    expect(count(decor, 'bodendeko_butterblumen')).toBeGreaterThan(5);
    expect(decorOf(chunkOf('gras', 'gruenhain'))).toEqual(decor);
    // Clumps lie across tile borders, anchors anywhere in their tiles.
    const inTile = new Set(decor.map((d) => `${((d.x % TILE) + TILE) % TILE},${((d.y % TILE) + TILE) % TILE}`));
    expect(inTile.size).toBeGreaterThan(100);
  });

  it('nur im eigenen Biom: Gras im Nebelmoor, Frostkamm und Scherbenhain bleibt ohne Wiesendeko, Sand im Glutsand ohne Strandgut', () => {
    for (const biome of ['nebelmoor', 'frostkamm', 'scherbenhain']) expect(decorOf(chunkOf('gras', biome)), biome).toEqual([]);
    expect(count(decorOf(chunkOf('sand', 'salzkueste')), BEACH)).toBeGreaterThan(40);
    expect(decorOf(chunkOf('sand', 'glutsand'))).toEqual([]);
    // A transition strip mixes by the tile's own biome.
    const mixed = chunkOf('gras', 'nebelmoor', 2, 3, (c) => {
      for (let i = 0; i < CS * CS; i++) if (i % CS < CS / 2) c.biome[i] = B('gruenhain');
    });
    const decor = decorOf(mixed);
    expect(decor.length).toBeGreaterThan(0);
    for (const d of decor) expect(mixed.biome[d.tile]).toBe(B('gruenhain'));
  });

  it('Blüten nur im Frühling und Sommer, Horste und Strandgut das ganze Jahr', () => {
    expect(decorSeasonMask(ruleOf('bodendeko_gaensebluemchen').seasons)).toBe(0b0011);
    expect(decorSeasonMask(undefined)).toBe(0b1111);
    for (let season = 0; season < SEASON_IDS.length; season++) {
      const meadow = decorOf(chunkOf('gras', 'gruenhain'), season);
      const blooming = SEASON_IDS[season] === 'fruehling' || SEASON_IDS[season] === 'sommer';
      for (const f of FLOWERS) expect(count(meadow, f) > 0, `${f} ${SEASON_IDS[season]}`).toBe(blooming);
      expect(count(meadow, 'bodendeko_wiesengras'), SEASON_IDS[season]).toBeGreaterThan(250);
      expect(count(decorOf(chunkOf('sand', 'salzkueste'), season), BEACH), SEASON_IDS[season]).toBeGreaterThan(40);
    }
  });

  it('nur auf wildem, ebenem, trockenem Boden: nicht an Klippenkanten, neben Stufen oder Wasser, nicht in Orten', () => {
    const at = (x: number, y: number): number => y * CS + x;
    const chunk = chunkOf('gras', 'gruenhain', 2, 3, (c) => {
      for (let i = 0; i < CS * CS; i++) {
        const x = i % CS;
        const y = Math.floor(i / CS);
        // A plateau of height 1 in the north-west with its rim flagged as cliff edge.
        if (x < 12 && y < 12) {
          c.height[i] = 1;
          if (x === 11 || y === 11) c.flags[i] = (c.flags[i] as number) | TILE_FLAG_CLIFF_EDGE;
        }
        // A pond in the east and a brook down the middle, a place's yard in the south.
        if ((x >= 24 && y < 8) || (x === 18 && y < 24)) c.water[i] = WATER_DEPTH_SHALLOW;
        if (y >= 24) c.flags[i] = (c.flags[i] as number) | TILE_FLAG_PLACE;
      }
    });
    const decor = decorOf(chunk);
    expect(decor.length).toBeGreaterThan(100);
    for (const d of decor) {
      const x = d.tile % CS;
      const y = Math.floor(d.tile / CS);
      expect(chunk.flags[d.tile], `${x},${y}`).toBe(0);
      for (let ny = Math.max(0, y - 1); ny <= Math.min(CS - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(CS - 1, x + 1); nx++) {
          expect(chunk.height[at(nx, ny)], `${x},${y} neben ${nx},${ny}`).toBe(chunk.height[d.tile]);
          expect(chunk.water[at(nx, ny)], `${x},${y} neben ${nx},${ny}`).toBe(0);
        }
      }
    }
    // The plateau's inside and the open meadow keep their decor; the rim, the banks of pond and brook and the yard stay bare.
    expect(decor.some((d) => d.tile % CS < 10 && Math.floor(d.tile / CS) < 10)).toBe(true);
    expect(decor.some((d) => Math.floor(d.tile / CS) >= 24)).toBe(false);
    expect(decor.some((d) => Math.abs((d.tile % CS) - 18) <= 1 && Math.floor(d.tile / CS) < 24)).toBe(false);
    // Beside the brook stands meadow on both banks one tile further out.
    expect(decor.some((d) => (d.tile % CS === 16 || d.tile % CS === 20) && Math.floor(d.tile / CS) < 23)).toBe(true);
  });

  it('die Dünengras-Horste bleiben, wie sie waren: auch an Stufen und Wasser (ohne wildOnly)', () => {
    const dune = ruleOf('bodendeko_duenengras');
    expect(dune.wildOnly).toBeUndefined();
    expect(dune.biomes).toBeUndefined();
    expect(dune.seasons).toBeUndefined();
    const chunk = chunkOf('duenengras', 'salzkueste', 2, 3, (c) => {
      for (let i = 0; i < CS * CS; i++) if (i % CS === 16) c.flags[i] = (c.flags[i] as number) | TILE_FLAG_CLIFF_EDGE;
    });
    expect(decorOf(chunk).some((d) => d.tile % CS === 16)).toBe(true);
  });
});
