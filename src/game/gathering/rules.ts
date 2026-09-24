/**
 * How each piece of the world is harvested (MASTERPROMPT §13.2, §14; M3-11 … M3-14), resolved once from
 * the content per runtime id:
 *
 * - **World objects** (src/content/worldObjects.ts): the object kind decides the action and what stays
 *   behind – trees are felled with the axe (the stump stays, `roden` clears it; fruit trees are picked by
 *   hand in their season), picked bushes stay bare until they carry again, everything else leaves the
 *   tile (rocks, ore nodes and crystals with the pickaxe, cut bushes and plants with sickle or axe,
 *   plants and scatter by hand). Tool, hardness, hit points, regrow days and drops come from the object.
 *   Objects that yield nothing and need no tool (moss, dune tufts) are not interactable.
 * - **Tiles**: solid rock and ore veins under ground are mined with the pickaxe (§14 "Erzadern im
 *   Untergrund als grabbares Tile-Material"); a vein yields what its ore node `erz_<ore>` yields, host rock
 *   what a small rock of the tile's biome yields. Open ground is dug with the shovel (`dig` of the terrain
 *   content) and yields the item that declares `graben:<terrain>` as its source; the hoe prepares fields.
 *
 * Material (particles and sounds of the hit, §14 "Partikel je Material, materialspezifische
 * Treffersounds") and skill (§23.2 learning by doing) belong to every rule.
 */
import { BALANCE } from '../../content/balance';
import { CONTENT } from '../../content/index';
import { parseItemSource, type ItemDef } from '../../content/schema/item';
import type { ToolKind } from '../../content/terrain';
import type { DropOccasion, WorldObject, WorldObjectDrop } from '../../content/worldObjects';
import { contentWorldIdTables, type WorldIdTables } from '../../world/model/runtimeIds';
import { stumpHp } from './formulas';

/** What the player does to a target (hint verb, feedback). */
export const HARVEST_ACTIONS = ['faellen', 'roden', 'ernten', 'pfluecken', 'schneiden', 'abbauen', 'aufsammeln', 'graben', 'hacken'] as const;
export type HarvestAction = (typeof HARVEST_ACTIONS)[number];

/** Material of a hit: particles and hit sounds (§14 "Partikel je Material"). */
export const HARVEST_MATERIALS = ['holz', 'stein', 'erz', 'kristall', 'pflanze', 'erde', 'sand', 'schnee'] as const;
export type HarvestMaterial = (typeof HARVEST_MATERIALS)[number];

/** Skill a harvest trains (§23.2 "Holzfällen, Bergbau, Sammeln & Kräuter, … Landwirtschaft"). */
export const HARVEST_SKILLS = ['holzfaellen', 'bergbau', 'sammeln', 'landwirtschaft'] as const;
export type HarvestSkill = (typeof HARVEST_SKILLS)[number];

/** What stays on the tile after the harvest. */
export type HarvestResult = 'stump' | 'harvested' | 'removed';

/** Tools a harvest may need (`hand` = none); the hoe prepares fields. */
export type HarvestTool = ToolKind | 'hacke';

/** One way to harvest a world object in its current stage. */
export interface ObjectHarvest {
  readonly action: HarvestAction;
  readonly tool: HarvestTool;
  /** Required mining power (§13.2); 0 by hand. */
  readonly hardness: number;
  /** Hit points of the stage when untouched [HP]. */
  readonly hp: number;
  /** Drops that fall. */
  readonly occasion: DropOccasion;
  readonly result: HarvestResult;
  /** Game days until the object is back (`null` = never). */
  readonly regrowDays: number | null;
  /** Whether a base keeps it from coming back (§14: forests and surface nodes regrow "außerhalb von Basen"). */
  readonly baseBlocksRegrow: boolean;
  readonly material: HarvestMaterial;
  readonly skill: HarvestSkill;
  /** Experience source of a tool hit (src/content/skills.ts `quellen`), `null` by hand. */
  readonly xpHit: string | null;
  /** Experience source of the finished harvest. */
  readonly xpDone: string;
}

/** Everything the gathering rules know about one world object. */
export interface ObjectRule {
  readonly id: string;
  readonly runtimeId: number;
  readonly def: WorldObject;
  readonly drops: readonly WorldObjectDrop[];
  /** The standing object: felling, mining, cutting or picking (`null`: not interactable). */
  readonly standing: ObjectHarvest | null;
  /** Fruit of a fruit tree, picked by hand without felling it (`null`: no fruit). */
  readonly fruit: ObjectHarvest | null;
  /** Clearing the stump of a felled tree (`null`: not a tree). */
  readonly stump: ObjectHarvest | null;
  /** Footprint [tiles] (east and north of the anchor tile). */
  readonly footprintW: number;
  readonly footprintH: number;
  readonly blocking: boolean;
}

/** How a tile is mined or dug. */
export interface TileRule {
  readonly terrain: string;
  readonly runtimeId: number;
  readonly action: HarvestAction;
  readonly tool: HarvestTool;
  readonly hardness: number;
  readonly hp: number;
  /** Ground written after digging (runtime id), 0 for solid material that is cleared. */
  readonly becomes: number;
  readonly material: HarvestMaterial;
  readonly skill: HarvestSkill;
  /** Experience sources of a hit and of the finished tile (src/content/skills.ts `quellen`). */
  readonly xpHit: string | null;
  readonly xpDone: string;
  /** Solid material: ore of a vein (its node `erz_<ore>` gives the drops) or `null` for host rock. */
  readonly ore: string | null;
  /** Ground: the item digging it yields (the item declaring `graben:<terrain>`), or `null`. */
  readonly yieldItem: string | null;
}

const HARVEST = BALANCE.harvest;
const GATHERING = BALANCE.gathering;

/** Material of scatter picked by hand, from the handling sound of its first drop (`sfx_item_<material>`). */
const ITEM_SOUND_MATERIAL: Readonly<Record<string, HarvestMaterial>> = {
  sfx_item_holz: 'holz',
  sfx_item_stein: 'stein',
  sfx_item_erde: 'erde',
  sfx_item_erz: 'erz',
  sfx_item_pflanze: 'pflanze',
  sfx_item_frucht: 'pflanze',
  sfx_item_pilz: 'pflanze',
  sfx_item_muschel: 'stein',
};

/** Material of dug ground by its footstep family. */
const GROUND_MATERIAL: Readonly<Record<string, HarvestMaterial>> = { sand: 'sand', schnee: 'schnee' };

/** Experience sources of harvesting (ids of src/content/skills.ts: Holzfällen, Bergbau, Sammeln & Kräuter). */
export const HARVEST_XP = {
  treeHit: 'baum_treffer',
  treeFelled: 'baum_gefaellt',
  stumpCleared: 'stumpf_gerodet',
  rockHit: 'gestein_treffer',
  rockMined: 'gestein_abgebaut',
  oreMined: 'erz_abgebaut',
  plantGathered: 'pflanze_gesammelt',
  herbGathered: 'kraut_gesammelt',
  groundDug: 'boden_gegraben',
} as const;

/** Wild herbs: picking them trains "Sammeln & Kräuter" as herbs (world objects whose drops are herbs). */
const HERB_OBJECTS: ReadonlySet<string> = new Set(['pflanze_kraeuter']);

function itemMaterial(items: ReadonlyMap<string, ItemDef>, drops: readonly WorldObjectDrop[]): HarvestMaterial {
  const first = drops[0];
  const item = first === undefined ? undefined : items.get(first.item);
  return item === undefined ? 'pflanze' : (ITEM_SOUND_MATERIAL[item.sounds.aufheben] ?? 'pflanze');
}

/** The ways to harvest a world object (see module comment). */
function objectRule(o: WorldObject, runtimeId: number, items: ReadonlyMap<string, ItemDef>): ObjectRule {
  const drops = o.drops ?? [];
  const has = (occasion: DropOccasion): boolean => drops.some((d) => d.anlass === occasion);
  const base = { hardness: o.hardness, hp: o.hp, tool: o.tool as HarvestTool };
  let standing: ObjectHarvest | null = null;
  let fruit: ObjectHarvest | null = null;
  let stump: ObjectHarvest | null = null;
  switch (o.kind) {
    case 'baum':
      standing = { ...base, action: 'faellen', occasion: 'abbau', result: 'stump', regrowDays: o.regrowDays, baseBlocksRegrow: true, material: 'holz', skill: 'holzfaellen', xpHit: HARVEST_XP.treeHit, xpDone: HARVEST_XP.treeFelled };
      stump = { ...base, hp: stumpHp(o.hp), action: 'roden', occasion: 'roden', result: 'removed', regrowDays: null, baseBlocksRegrow: false, material: 'holz', skill: 'holzfaellen', xpHit: HARVEST_XP.treeHit, xpDone: HARVEST_XP.stumpCleared };
      if (has('ernte')) fruit = { action: 'ernten', tool: 'hand', hardness: 0, hp: 1, occasion: 'ernte', result: 'harvested', regrowDays: HARVEST.fruitRegrowDays, baseBlocksRegrow: false, material: 'pflanze', skill: 'sammeln', xpHit: null, xpDone: HARVEST_XP.plantGathered };
      break;
    case 'busch':
      standing =
        o.tool === 'hand'
          ? { ...base, action: 'pfluecken', occasion: 'abbau', result: 'harvested', regrowDays: o.regrowDays ?? GATHERING.bushRegrowDays, baseBlocksRegrow: false, material: 'pflanze', skill: 'sammeln', xpHit: null, xpDone: HARVEST_XP.plantGathered }
          : { ...base, action: 'schneiden', occasion: 'abbau', result: 'removed', regrowDays: o.regrowDays, baseBlocksRegrow: false, material: 'holz', skill: 'sammeln', xpHit: null, xpDone: HARVEST_XP.plantGathered };
      break;
    case 'pflanze':
      if (o.tool !== 'hand' || drops.length > 0)
        standing = {
          ...base,
          action: o.tool === 'hand' ? 'pfluecken' : 'schneiden',
          occasion: 'abbau',
          result: 'removed',
          regrowDays: o.regrowDays,
          baseBlocksRegrow: false,
          material: 'pflanze',
          skill: 'sammeln',
          xpHit: null,
          xpDone: HERB_OBJECTS.has(o.id) ? HARVEST_XP.herbGathered : HARVEST_XP.plantGathered,
        };
      break;
    case 'fels':
    case 'erz':
    case 'kristall':
      standing = {
        ...base,
        action: 'abbauen',
        occasion: 'abbau',
        result: 'removed',
        regrowDays: o.regrowDays,
        baseBlocksRegrow: true,
        material: o.kind === 'fels' ? 'stein' : o.kind,
        skill: 'bergbau',
        xpHit: HARVEST_XP.rockHit,
        xpDone: o.kind === 'erz' ? HARVEST_XP.oreMined : HARVEST_XP.rockMined,
      };
      break;
    case 'deko':
      if (drops.length > 0)
        standing = { ...base, action: 'aufsammeln', occasion: 'abbau', result: 'removed', regrowDays: o.regrowDays, baseBlocksRegrow: false, material: itemMaterial(items, drops), skill: 'sammeln', xpHit: null, xpDone: HARVEST_XP.plantGathered };
      break;
  }
  return { id: o.id, runtimeId, def: o, drops, standing, fruit, stump, footprintW: o.footprint.w, footprintH: o.footprint.h, blocking: o.blocking };
}

/** Item that digging `terrain` yields: the first item declaring `graben:<terrain>` (content order). */
function digYieldItems(items: readonly ItemDef[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const item of items) {
    for (const source of item.quellen ?? []) {
      const s = parseItemSource(source);
      if (s !== null && s.kind === 'graben' && s.id !== null && !out.has(s.id)) out.set(s.id, item.id);
    }
  }
  return out;
}

/** The gathering rules of the content, per runtime id. */
export class GatheringRules {
  readonly ids: WorldIdTables;
  /** Object rules by object runtime id (index 0 = none). */
  readonly objects: readonly (ObjectRule | null)[];
  /** Tile rules by terrain runtime id (index 0 = none, `null` = cannot be dug or mined). */
  readonly tiles: readonly (TileRule | null)[];
  /** Largest footprint of any object [tiles] (the search for objects covering a tile looks that far). */
  readonly maxFootprintW: number;
  readonly maxFootprintH: number;
  private readonly objectsById = new Map<string, ObjectRule>();

  constructor(ids: WorldIdTables = contentWorldIdTables()) {
    this.ids = ids;
    const items = CONTENT.collection('items').values();
    const itemById = new Map(items.map((i) => [i.id, i]));
    const objects = CONTENT.collection('worldObjects');
    const list: (ObjectRule | null)[] = [null];
    let fw = 1;
    let fh = 1;
    ids.objects.ids().forEach((id, k) => {
      const rule = objectRule(objects.get(id), k + 1, itemById);
      list.push(rule);
      this.objectsById.set(id, rule);
      fw = Math.max(fw, rule.footprintW);
      fh = Math.max(fh, rule.footprintH);
    });
    this.objects = list;
    this.maxFootprintW = fw;
    this.maxFootprintH = fh;
    const yields = digYieldItems(items);
    const terrain = CONTENT.collection('terrain');
    const tiles: (TileRule | null)[] = [null];
    ids.terrain.ids().forEach((id, k) => {
      const t = terrain.get(id);
      const dig = t.dig;
      if (dig === null) {
        tiles.push(null);
        return;
      }
      const solid = t.kind === 'fest';
      const hits = solid ? (t.ore !== undefined ? HARVEST.solid.veinHitsWithTierTool : HARVEST.solid.rockHitsWithTierTool) : HARVEST.dig.hitsWithTierTool;
      tiles.push({
        terrain: id,
        runtimeId: k + 1,
        action: solid ? 'abbauen' : 'graben',
        tool: dig.tool,
        hardness: dig.hardness,
        hp: hits * dig.hardness,
        becomes: dig.becomes === null ? 0 : ids.terrain.runtimeId(dig.becomes),
        material: solid ? (t.ore !== undefined ? 'erz' : 'stein') : (GROUND_MATERIAL[t.footstep ?? ''] ?? 'erde'),
        skill: solid ? 'bergbau' : 'sammeln',
        xpHit: solid ? HARVEST_XP.rockHit : null,
        xpDone: solid ? (t.ore !== undefined ? HARVEST_XP.oreMined : HARVEST_XP.rockMined) : HARVEST_XP.groundDug,
        ore: t.ore ?? null,
        yieldItem: solid ? null : (yields.get(id) ?? null),
      });
    });
    this.tiles = tiles;
  }

  /** Rule of a world object by string id. */
  object(id: string): ObjectRule | undefined {
    return this.objectsById.get(id);
  }

  /** Drops a mined solid tile yields: the node of its ore, or a small rock of the tile's biome (`[]` when there is none yet). */
  solidDrops(rule: TileRule, biome: string | null): readonly WorldObjectDrop[] {
    const node = rule.ore !== null ? this.objectsById.get(`erz_${rule.ore}`) : biome === null ? undefined : this.objectsById.get(`fels_klein_${biome}`);
    return node?.drops ?? [];
  }
}

let contentRules: GatheringRules | null = null;

/** The gathering rules of the game's content (built once). */
export function contentGatheringRules(): GatheringRules {
  contentRules ??= new GatheringRules();
  return contentRules;
}
