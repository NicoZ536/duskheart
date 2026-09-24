/**
 * World content (M2): biomes, ores, terrain types and world objects against the binding lists of
 * docs/WORLD.md §7, the tables of MASTERPROMPT §9.3/§13.2/§D, the glossary names and the colour
 * identity of docs/ART.md §5 (assets-src/paletteRows.ts).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { paletteIndex } from '../../../assets-src/palette';
import { BIOME_TINTS } from '../../../assets-src/paletteRows';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { WEATHER_STATES } from '../../../src/content/weather';

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), 'utf8');
const WORLD_MD = read('docs/WORLD.md');
const GLOSSAR = read('docs/GLOSSAR.md');

/** The EN name of the first glossary row whose DE column is `de` (undefined without a row). */
function glossaryEn(de: string): string | undefined {
  return GLOSSAR.split('\n')
    .find((l) => l.startsWith(`| ${de} |`))
    ?.split('|')[2]
    ?.trim();
}

/** Backticked snake_case ids of the WORLD.md §7 bullet that starts with `**label**`. */
function worldListIds(label: string): string[] {
  const line = WORLD_MD.split('\n').find((l) => l.startsWith(`- **${label}**`));
  if (line === undefined) throw new Error(`WORLD.md §7 has no bullet "${label}"`);
  return [...line.matchAll(/`([a-z_]+)`/g)].map((m) => m[1] as string);
}

const biomes = CONTENT.collection('biomes');
const ores = CONTENT.collection('ores');
const terrain = CONTENT.collection('terrain');
const objects = CONTENT.collection('worldObjects');

describe('biomes (§9.3, WORLD.md §7)', () => {
  it('are exactly the 11 biomes of WORLD.md §7 in order', () => {
    expect(biomes.ids()).toEqual(worldListIds('Biome'));
    expect(biomes.size).toBe(11);
  });

  it('carry tier range, spring-day temperature, day amplitude and layer of §9.3', () => {
    const table = biomes.values().map((b) => [b.id, b.layer, b.tierMin, b.tierMax, b.baseTemperatureC, b.dayAmplitudeC]);
    expect(table).toEqual([
      ['gruenhain', 0, 0, 1, 16, 6],
      ['salzkueste', 0, 0, 2, 17, 6],
      ['nebelmoor', 0, 2, 2, 14, 6],
      ['frostkamm', 0, 3, 3, -8, 6],
      ['glutsand', 0, 4, 4, 34, 18],
      ['aschenschlund', 0, 5, 5, 38, 6],
      ['scherbenhain', 0, 6, 6, 12, 6],
      ['nachtherz', 0, 7, 7, 5, 6],
      ['wurzelhoehlen', -1, 1, 2, 12, 0],
      ['tiefgrund', -2, 2, 4, 14, 0],
      ['glutadern', -3, 4, 6, 30, 0],
    ]);
  });

  it('use the glossary names (DE/EN)', () => {
    for (const b of biomes.values()) {
      const row = GLOSSAR.split('\n').find((l) => l.startsWith(`| ${b.name.de} |`));
      expect(row, b.id).toBeDefined();
      expect(row?.split('|')[2]?.trim(), b.id).toBe(b.name.en);
    }
  });

  it('mirror the colour identity of docs/ART.md §5 (BIOME_TINTS) with valid palette references', () => {
    expect(BIOME_TINTS.map((t) => t.biom)).toEqual(biomes.ids());
    for (const b of biomes.values()) {
      const tint = BIOME_TINTS.find((t) => t.biom === b.id);
      expect(tint, b.id).toBeDefined();
      expect(b.colorIdentity.paletteRow).toBe(tint?.zeile);
      expect(b.colorIdentity.ground).toEqual(tint?.grundton);
      expect(b.colorIdentity.accent).toEqual(tint?.akzent);
      expect(b.colorIdentity.night).toBe(tint?.nacht);
      expect(b.layer).toBe(tint?.ebene);
      for (const ref of [...b.colorIdentity.ground, ...b.colorIdentity.accent, b.colorIdentity.night]) expect(() => paletteIndex(ref), `${b.id}: ${ref}`).not.toThrow();
    }
  });
});

describe('ores (§13.2, WORLD.md §7)', () => {
  it('are the 16 ores of WORLD.md §7', () => {
    expect([...ores.ids()].sort()).toEqual(worldListIds('Erze').sort());
  });

  it('have the hardness of the tier that opens them ("Abbaukraft ≥ Härte")', () => {
    const hardness = Object.fromEntries(ores.values().map((o) => [o.id, o.hardness]));
    expect(hardness).toMatchObject({ kupfer: 1, zinn: 1, raseneisen: 2, eisen: 2, kohle: 3, silber: 3, gold: 4, klarquarz: 4, obsidian: 5, magmit: 5, schwefel: 5, lumenit: 6, prismenquarz: 6, nachtstahl: 7 });
  });

  it('occur in the biomes of the §9.3 resource column; veins only where an underground biome has them', () => {
    const underground = new Set(biomes.values().filter((b) => b.layer < 0).map((b) => b.id));
    for (const o of ores.values()) {
      for (const b of o.biomes) expect(biomes.has(b), `${o.id}: ${b}`).toBe(true);
      expect(o.vein, o.id).toBe(o.biomes.some((b) => underground.has(b)));
    }
    expect(ores.get('kupfer').biomes).toEqual(['gruenhain', 'wurzelhoehlen']);
    expect(ores.get('lumenit').biomes).toContain('glutadern');
  });
});

describe('terrain types (WORLD.md §3, §7)', () => {
  it('contain every type of WORLD.md §7 plus one vein per vein-forming ore', () => {
    // The bullet also names the chunk fields `solid` and `water` in backticks.
    const listed = worldListIds('Terrain-Typen').filter((id) => id !== 'solid' && id !== 'water');
    const veins = ores.values().filter((o) => o.vein).map((o) => `ader_${o.id}`);
    expect([...terrain.ids()].sort()).toEqual([...listed, ...veins].sort());
  });

  it('solid material is never walkable, is mined with a pickaxe and clears the field', () => {
    for (const id of ['fels', 'tiefenfels', 'glutfels', ...terrain.ids().filter((t) => t.startsWith('ader_'))]) {
      const t = terrain.get(id);
      expect([t.kind, t.walkable, t.dig?.tool, t.dig?.becomes], id).toEqual(['fest', false, 'spitzhacke', null]);
    }
    for (const t of terrain.values().filter((v) => v.ore !== undefined)) expect(t.dig?.hardness, t.id).toBe(ores.get(t.ore as string).hardness);
  });

  it('ground types: walkable with footstep and speed, lava is not; digging leads to walkable ground', () => {
    for (const t of terrain.values().filter((v) => v.kind === 'boden')) {
      if (t.id === 'lava') {
        expect([t.walkable, t.speedFactor, t.footstep]).toEqual([false, 0, null]);
        continue;
      }
      expect(t.walkable, t.id).toBe(true);
      expect(t.speedFactor, t.id).toBeGreaterThan(0);
      if (t.dig !== null) {
        const after = terrain.get(t.dig.becomes as string);
        expect([after.kind, after.walkable], t.id).toEqual(['boden', true]);
      }
    }
    // §14 "Graben (Schaufel): Erde, Sand, Torf, Schnee"; §13.2: peat needs T1 tools.
    for (const id of ['erde', 'sand', 'torf', 'schnee', 'gras']) expect(terrain.get(id).dig?.tool, id).toBe('schaufel');
    expect(terrain.get('torf').dig?.hardness).toBe(2);
    expect(terrain.get('strasse').speedFactor).toBeGreaterThan(1);
    // §9.3 Wurzelhöhlen resource "Lehm", §14 "Graben (Schaufel): … Lehm": clay pockets are dug out down to the cave floor.
    expect([terrain.get('lehm').kind, terrain.get('lehm').dig]).toEqual(['boden', { tool: 'schaufel', hardness: 1, becomes: 'hoehlenboden' }]);
  });

  it('ground types carry the scattering of their tileset variants (3–4 weights), solid material none', () => {
    for (const t of terrain.values()) {
      if (t.kind === 'fest') {
        expect(t.tileset, t.id).toBeNull();
        continue;
      }
      expect(t.tileset?.variantWeights.length, t.id).toBeGreaterThanOrEqual(3);
      expect(t.tileset?.variantWeights.length, t.id).toBeLessThanOrEqual(4);
      // Calm variants first and often, the striking last one rarely (docs/ART.md §3).
      const w = t.tileset?.variantWeights ?? [];
      expect(w[w.length - 1], t.id).toBe(Math.min(...w));
    }
    expect(terrain.values().filter((t) => t.tileset?.mirror === false).map((t) => t.id)).toEqual(['strasse']);
  });
});

describe('glossary names of the world content (docs/GLOSSAR.md, MASTERPROMPT §2.11)', () => {
  it('ores, terrain types, world objects and weather states have a DE/EN row with the content names', () => {
    const named = [...ores.values(), ...terrain.values(), ...objects.values(), ...WEATHER_STATES];
    for (const r of named) expect(glossaryEn(r.name.de), `${r.id}: ${r.name.de}`).toBe(r.name.en);
  });
});

describe('world objects (WORLD.md §7, §14, §D)', () => {
  const kind = (k: string) => objects.values().filter((o) => o.kind === k);

  it('have the 14 tree species of WORLD.md §7, counted as §C "Baumarten"', () => {
    const species = WORLD_MD.match(/14 Arten: ([^)]*)\)/)?.[1] ?? '';
    const expected = [...species.matchAll(/`([a-z]+)`/g)].map((m) => `baum_${m[1] as string}`);
    expect(expected).toHaveLength(14);
    expect(kind('baum').map((o) => o.id)).toEqual(expected);
    expect(CONTENT.countsByCategory().trees).toBe(14);
    for (const t of kind('baum')) expect([t.tool, t.blocking, t.regrowDays], t.id).toEqual(['axt', true, BALANCE.gathering.treeRegrowDays]);
  });

  it('ids start with their kind prefix and reference existing biomes and ores', () => {
    for (const o of objects.values()) {
      expect(o.id.startsWith(`${o.kind}_`), o.id).toBe(true);
      for (const b of o.biomes) expect(biomes.has(b), `${o.id}: ${b}`).toBe(true);
    }
    expect(CONTENT.references().filter((r) => !CONTENT.has(r.target, r.value as string))).toEqual([]);
  });

  it('one ore node per ore with the ore’s hardness and biomes (§13.2)', () => {
    expect(kind('erz').map((o) => o.ore).sort()).toEqual([...ores.ids()].sort());
    for (const node of kind('erz')) {
      const ore = ores.get(node.ore as string);
      expect(node.id).toBe(`erz_${ore.id}`);
      expect([node.hardness, node.biomes, node.tool], node.id).toEqual([ore.hardness, ore.biomes, 'spitzhacke']);
    }
  });

  it('a small and a large rock for every biome', () => {
    for (const b of biomes.ids()) {
      expect(objects.has(`fels_klein_${b}`), b).toBe(true);
      expect(objects.has(`fels_gross_${b}`), b).toBe(true);
      expect(objects.get(`fels_gross_${b}`).footprint).toEqual({ w: 2, h: 1 });
    }
  });

  it('§D hit counts: Grünhain tree 5 hits with the stone axe, 3 with bronze; every node 5 hits at its tier', () => {
    const hits = (hp: number, power: number): number => Math.ceil(hp / power);
    for (const id of ['baum_eiche', 'baum_birke', 'baum_buche', 'baum_apfelbaum']) {
      const tree = objects.get(id);
      expect([hits(tree.hp, 1), hits(tree.hp, 2)], id).toEqual([5, 3]);
    }
    for (const o of objects.values().filter((v) => v.tool !== 'hand' && v.hp > 1)) {
      const factor = o.id.startsWith('fels_gross_') ? 2 : 1;
      expect(hits(o.hp, o.hardness), o.id).toBe(BALANCE.gathering.hitsWithTierTool * factor);
    }
  });

  it('surface nodes regrow after 7 days, cave-only nodes and scatter never', () => {
    const surface = new Set(biomes.values().filter((b) => b.layer === 0).map((b) => b.id));
    for (const o of objects.values().filter((v) => v.kind === 'fels' || v.kind === 'erz' || v.kind === 'kristall')) {
      expect(o.regrowDays, o.id).toBe(o.biomes.some((b) => surface.has(b)) ? 7 : null);
    }
    for (const o of kind('deko')) expect([o.regrowDays, o.blocking, o.tool, o.hardness], o.id).toEqual([null, false, 'hand', 0]);
  });

  it('every biome has vegetation, rock and at least 4 scatter types (M2-19, M2-21)', () => {
    for (const b of biomes.ids()) {
      const here = objects.values().filter((o) => o.biomes.includes(b));
      expect(here.some((o) => o.kind === 'baum' || o.kind === 'busch' || o.kind === 'pflanze'), `${b}: vegetation`).toBe(true);
      expect(here.some((o) => o.kind === 'fels'), `${b}: rock`).toBe(true);
      expect(here.filter((o) => o.kind === 'deko').length, `${b}: scatter`).toBeGreaterThanOrEqual(4);
    }
  });
});
