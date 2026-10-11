/**
 * The vaults' rewards (M7-16; MASTERPROMPT §21 "Belohnungen: Truhen nach Stufe, einzigartige Baupläne, Relikte, Erbauer-Tafeln,
 * Glutsplitter (12 in der Welt)"; docs/SPIEL.md §19 "Belohnungen"): chests by tier drawn with `hash(seed, vault, chest)` (the
 * same world gives the same loot, the deeper tier the richer table, relics only in the end tier), the end chest's unique
 * blueprint (each of the list once per world, in slot order), the ember shard on its pedestal (a `glut` shard of F's item use),
 * the twelve shard slots reserved round by round over the vault slots of every biome with the Grünhain share, the tablets placed.
 */
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import { VAULT_UNIQUE_BLUEPRINTS } from '../../../src/content/dungeons/belohnungen';
import type { PlaceLootDef } from '../../../src/content/places/schema';
import { uniqueBlueprintOf } from '../../../src/game/vaults/formulas';
import { VAULT_SHARD_ITEM } from '../../../src/game/vaults/system';
import { LOCATION_RULES, type LocationSlot } from '../../../src/world/gen/locations';
import { shardSlots } from '../../../src/world/gen/vaults/plan';
import type { VaultPlan } from '../../../src/world/gen/vaults/types';
import { BALANCE } from '../../../src/content/balance';
import { gewoelbeWelt, VAULT_SLOT, type GewoelbeWelt } from './gewoelbe-testwelt';

function events<T>(map: Map<string, unknown[]>, type: string): T[] {
  return (map.get(type) ?? []) as T[];
}

function enter(w: GewoelbeWelt): void {
  w.goToTile(w.plan.entrance.tx, w.plan.entrance.ty + 1, 0);
  w.run(1, [{ type: 'vault.enter', vault: VAULT_SLOT }]);
}

/** Opens every chest of the vault; the loot per chest (item × count, sorted). */
function openAll(w: GewoelbeWelt): string[][] {
  const out: string[][] = [];
  for (const c of w.plan.chests) {
    if (c.mimic) continue;
    const before = w.spilledVault.length;
    expect(events(w.useAt(c.tx, c.ty), 'vaultChestOpened')).toEqual([expect.objectContaining({ chest: c.id, stufe: c.tier, mimik: false })]);
    out.push(w.spilledVault.slice(before).map((s) => `${s.stack.item}×${s.stack.count}`).sort());
  }
  return out;
}

describe('vault rewards: chests', () => {
  it('a chest opens once, becomes an open chest and spills the loot of its tier – the same in the same world', () => {
    const a = gewoelbeWelt();
    enter(a);
    const lootA = openAll(a);
    expect(lootA.every((l) => l.length > 0)).toBe(true);
    const c = a.plan.chests.find((x) => !x.mimic)!;
    expect(a.objectAt(c.tx, c.ty)).toBe('ort_truhe_offen');
    expect(a.rejections(a.useAt(c.tx, c.ty))).toEqual(['nothingThere']);
    const b = gewoelbeWelt();
    enter(b);
    expect(openAll(b)).toEqual(lootA);
    // Another world seed draws other loot.
    const other = gewoelbeWelt({ worldSeed: 99 });
    enter(other);
    expect(openAll(other)).not.toEqual(lootA);
  });

  it('the tables grow with the tier; relics only in the end tier; the end chest adds the vault’s unique blueprint', () => {
    const table = (tier: number) => CONTENT.collection('placeLoot').get(`gewoelbe_gruenhain_${tier}`) as PlaceLootDef;
    const items = (t: PlaceLootDef) => t.beute.map((b) => b.item);
    for (const tier of [1, 2]) expect(items(table(tier)).some((i) => i.startsWith('relikt_'))).toBe(false);
    expect(items(table(3)).filter((i) => i.startsWith('relikt_')).length).toBeGreaterThanOrEqual(3);
    expect(table(3).ziehungen[1]).toBeGreaterThanOrEqual(table(1).ziehungen[1] - 1);
    // No blueprint lies in a random table: they are unique.
    for (const tier of [1, 2, 3]) expect(items(table(tier)).some((i) => i.startsWith('bauplan_'))).toBe(false);
    const w = gewoelbeWelt();
    enter(w);
    const blueprint = uniqueBlueprintOf([w.plan], VAULT_SLOT, VAULT_UNIQUE_BLUEPRINTS);
    expect(blueprint).toBe(VAULT_UNIQUE_BLUEPRINTS[0]);
    openAll(w);
    expect(w.spilledVault.filter((s) => s.stack.item.startsWith('bauplan_')).map((s) => s.stack.item)).toEqual([blueprint]);
  });

  it('unique blueprints: each of the list once per world, to the vaults in slot order; vaults beyond it hold none', () => {
    const plans = [41, 7, 19, 33].map((slot) => ({ slot }) as VaultPlan);
    const got = plans.map((p) => uniqueBlueprintOf(plans, p.slot, VAULT_UNIQUE_BLUEPRINTS));
    expect(got).toEqual([null, VAULT_UNIQUE_BLUEPRINTS[0], VAULT_UNIQUE_BLUEPRINTS[1], VAULT_UNIQUE_BLUEPRINTS[2]]);
    for (const id of VAULT_UNIQUE_BLUEPRINTS) expect(CONTENT.collection('items').get(id).bauplan).toBeDefined();
  });
});

describe('vault rewards: ember shards', () => {
  it('the shard on its pedestal goes into the bags once; it is an ember shard of the shard use (+ stamina)', () => {
    const w = gewoelbeWelt();
    enter(w);
    const at = w.plan.shard!;
    expect(w.vaults.blocks(-1, at.tx, at.ty)).toBe(true);
    expect(events(w.useAt(at.tx, at.ty), 'vaultShardTaken')).toHaveLength(1);
    expect(w.inventory.count(VAULT_SHARD_ITEM)).toBe(1);
    expect(w.rejections(w.useAt(at.tx, at.ty))).toEqual(['nothingThere']);
    expect(CONTENT.collection('items').get(VAULT_SHARD_ITEM).splitter?.art).toBe('glut');
  });

  it('twelve slots reserved round by round over the vault slots of every biome, the Grünhain share first, none in the clearing', () => {
    const biomes = LOCATION_RULES.gewoelbe?.biomes ?? [];
    expect(biomes[0]).toBe('gruenhain');
    let id = 0;
    const slots: LocationSlot[] = biomes.flatMap((biome, b) =>
      [0, 1, 2].map((k) => ({ id: id++, type: 'gewoelbe', variant: '', x: 1000 + b * 300 + k * 100, y: 1000, radius: 5, level: 0, region: 0, biome, tier: 0, landmass: 0, link: -1 }) as LocationSlot),
    );
    const clearing = { x: 1000, y: 1000, radius: 40 };
    const picked = shardSlots(slots, clearing);
    expect(picked.size).toBe(BALANCE.vaults.emberShards);
    // The first Grünhain slot lies in the clearing: never a shard there.
    expect(picked.has(0)).toBe(false);
    const perBiome = new Map<string, number>();
    for (const s of picked) perBiome.set(slots[s]!.biome, (perBiome.get(slots[s]!.biome) ?? 0) + 1);
    expect(perBiome.get('gruenhain')).toBeGreaterThan(0);
    // Round by round: no biome has two more than another with slots left.
    const counts = [...perBiome.values()];
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });
});
