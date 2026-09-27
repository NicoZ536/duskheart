/**
 * M4-36 Graben ergänzen, Kiesgrund (MASTERPROMPT §14 "Graben (Schaufel): Erde, Lehm, Sand, Kies, Torf, Schnee …";
 * ADR-0032 "Kies … kommt mit seinem Item"): open ground right beside a river is a gravel bank – the shovel brings up
 * gravel (`kies`) there instead of the soil; beside a lake, the sea or two tiles off the river it is soil as before;
 * underground there are no gravel banks. The dug bank is a chunk change like every dug tile (DUG flag, chunk diff).
 * A trench on the bank (M4-36) brings up gravel as well: beside a frozen river the shovel digs a dry trench there.
 *
 * M4-40: gravel declares the grounds its banks form on (`graben:<terrain>`), so its "Herkunft" names them next to the
 * rocks; those grounds keep yielding their own material away from rivers.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { buildItemIndex } from '../../../src/content/items/usage';
import { contentGatheringRules } from '../../../src/game/gathering/rules';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { contentItemLookup, sourceGroups } from '../../../src/ui/tooltip/lookup';
import { TILE_FLAG_DUG, WATER_DEPTH_MASK, WATER_DEPTH_SHALLOW, WATER_FROZEN, WATER_LAKE, WATER_RIVER, chunkHash } from '../../../src/world/model/chunk';
import { OFFSET } from './spieler-testwelt';
import { field, gatherWorld, type GatherWorld } from './interaktion-testwelt';

/** A meadow with shallow water on map row 2 from column 3 to 6, marked as `kind` (river or lake). */
function world(kind: number, ground: 'gras' | 'sand' = 'gras'): GatherWorld {
  const rows = ['', '', '...ssss'];
  if (ground === 'sand') rows.push('...SSSS', '...SSSS');
  const w = gatherWorld(field(10, 10, rows));
  for (let x = 3; x <= 6; x++) {
    const { chunk, i } = w.at(x, 2);
    chunk.water[i] = WATER_DEPTH_SHALLOW | kind;
  }
  return w;
}

/** Digs map tile (x, y) from the tile below it with the probe shovel; returns the items that came up. */
function dig(w: GatherWorld, x: number, y: number): Map<string, number> {
  w.place(x, y + 1);
  w.body().facing = 'up';
  w.hold('probe_schaufel');
  w.run(1);
  const before = new Map<string, number>();
  for (const item of ['erde', 'sand', 'kies']) before.set(item, w.inventory.count(item));
  w.runUntil(() => !w.interaction.working, 300, [{ type: 'player.interact', on: true }]);
  w.run(1, [{ type: 'player.interact', on: false }]);
  w.collect();
  const out = new Map<string, number>();
  for (const item of ['erde', 'sand', 'kies']) {
    const n = w.inventory.count(item) - (before.get(item) ?? 0);
    if (n > 0) out.set(item, n);
  }
  return out;
}

describe('Kiesbänke an Flussufern (M4-36)', () => {
  it('die Schaufel holt am Flussufer Kies statt Erde', () => {
    expect(BALANCE.harvest.dig.gravelBankItem).toBe('kies');
    const w = world(WATER_RIVER);
    expect(w.gathering.gravelBank(0, OFFSET + 4, OFFSET + 3)).toBe(true);
    const got = dig(w, 4, 3);
    expect([...got.keys()]).toEqual(['kies']);
    expect(got.get('kies')).toBeGreaterThanOrEqual(BALANCE.harvest.dig.yieldMin);
    // The bank is dug like any tile: a path of earth, a chunk change.
    expect(w.groundAt(4, 3)).toBe('erde');
    const { chunk, i } = w.at(4, 3);
    expect((chunk.flags[i] as number) & TILE_FLAG_DUG).toBe(TILE_FLAG_DUG);
  });

  it('auch Sand am Fluss ist Kiesgrund; zwei Felder vom Fluss, am See oder unter Tage wieder der Boden selbst', () => {
    const sand = world(WATER_RIVER, 'sand');
    expect([...dig(sand, 4, 3).keys()]).toEqual(['kies']);
    expect([...dig(sand, 5, 4).keys()]).toEqual(['sand']);
    const lake = world(WATER_LAKE);
    expect(lake.gathering.gravelBank(0, OFFSET + 4, OFFSET + 3)).toBe(false);
    expect([...dig(lake, 4, 3).keys()]).toEqual(['erde']);
    expect(lake.gathering.gravelBank(-1, OFFSET + 4, OFFSET + 3)).toBe(false);
  });

  it('ein Wassergraben am Fluss bringt Kies und führt das Wasser weiter', () => {
    const w = world(WATER_RIVER);
    const hash = chunkHash(w.at(4, 3).chunk);
    dig(w, 4, 3);
    const second = dig(w, 4, 3);
    expect([...second.keys()]).toEqual(['kies']);
    const { chunk, i } = w.at(4, 3);
    expect((chunk.water[i] as number) & WATER_DEPTH_SHALLOW).toBe(WATER_DEPTH_SHALLOW);
    expect(chunkHash(chunk)).not.toBe(hash);
  });
});

describe('Gräben auf der Kiesbank (M4-36)', () => {
  it('beside a frozen river the bank deepens into a dry trench and still brings up gravel; thawed, the next stroke floods it', () => {
    const w = world(WATER_RIVER);
    for (let x = 3; x <= 6; x++) {
      const { chunk, i } = w.at(x, 2);
      chunk.water[i] = (chunk.water[i] as number) | WATER_FROZEN;
    }
    expect([...dig(w, 4, 3).keys()]).toEqual(['kies']);
    expect([...dig(w, 5, 3).keys()]).toEqual(['kies']);
    const trench = dig(w, 4, 3);
    expect([...trench.keys()]).toEqual(['kies']);
    expect(w.groundAt(4, 3)).toBe('graben');
    const { chunk, i } = w.at(4, 3);
    expect((chunk.water[i] as number) & WATER_DEPTH_MASK).toBe(0);
    // The ice melts: the dry trench on the bank opens into a water ditch (nothing left to dig out of it).
    for (let x = 3; x <= 6; x++) {
      const c = w.at(x, 2);
      c.chunk.water[c.i] = (c.chunk.water[c.i] as number) & ~WATER_FROZEN;
    }
    expect(dig(w, 4, 3).size).toBe(0);
    expect((chunk.water[i] as number) & WATER_DEPTH_MASK).toBe(WATER_DEPTH_SHALLOW);
    expect(w.groundAt(4, 3)).toBe('graben');
  });
});

describe('Kies nennt seine Kiesbänke als Herkunft (M4-40)', () => {
  it('gravel declares the grounds of its banks; they yield gravel only on a bank, else their own material', () => {
    const gravel = BALANCE.harvest.dig.gravelBankItem;
    const banks = ['duenengras', 'erde', 'gras', 'sand'];
    expect(buildItemIndex(CONTENT).sources.get(gravel)).toEqual(expect.arrayContaining(banks.map((t) => `graben:${t}`)));
    const ids = contentWorldIdTables();
    const rules = contentGatheringRules();
    const tile = (id: string) => rules.tiles[ids.terrain.runtimeId(id)];
    for (const [ground, own] of [['gras', 'erde'], ['erde', 'erde'], ['sand', 'sand'], ['duenengras', 'sand']] as const) expect(tile(ground), ground).toMatchObject({ yieldItem: own, gravel: true });
    for (const ground of ['lehm', 'torf', 'schnee', 'graben']) expect(tile(ground)?.gravel, ground).toBe(false);
    // The item lookup of the tooltips ("Herkunft") lists the grounds under digging, beside the rocks it is gathered from.
    const groups = sourceGroups(contentItemLookup(), gravel, 'de');
    expect(groups).toContainEqual({ kind: 'graben', names: ['Dünengras', 'Erde', 'Gras', 'Sand'] });
    expect(groups.find((g) => g.kind === 'welt')?.names.length).toBeGreaterThan(0);
    expect(sourceGroups(contentItemLookup(), gravel, 'en')).toContainEqual({ kind: 'graben', names: ['Dirt', 'Dune Grass', 'Grass', 'Sand'] });
    expect(CONTENT.collection('items').get(gravel).beschreibung.de).toContain('Kiesbänken');
  });
});
