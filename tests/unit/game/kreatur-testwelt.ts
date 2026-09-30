/**
 * Test support for the creature tests (ki, wahrnehmung, telegraph, steering, spawn, schattenbrut, nachtmahr, loot, fallen,
 * bestiarium, rudel, schattenbrut-licht, the roundtrips of creatures, traps and the bestiary): the combat test world of
 * kampf-testwelt.ts (hand-drawn chunks, player, bags, combat, the player's life) plus the creature system, traps and the
 * bestiary, with
 * - a zone (every chunk active, or only the chunks a test names),
 * - a fixed time of day, season, weather and biome the test can change,
 * - a light map of discs (ambient plus lights of a level and radius) the creatures and fear read,
 * - recorders for drops and door blows,
 * - fixture creatures validated with the real schemas: `probe_wolf` (a pack hunter), `probe_schleicher` (shadow brood
 *   that avoids light above 0,5), `probe_fisch` (a swimmer), `probe_brecher` (breaks doors), next to the content's.
 */
import { AI_PROFILES } from '../../../src/content/creatures/profile';
import { CREATURES } from '../../../src/content/creatures/kreaturen';
import { LOOT_TABLES } from '../../../src/content/creatures/beute';
import { SPAWN_TABLES } from '../../../src/content/creatures/spawn';
import { TRAPS } from '../../../src/content/creatures/fallen';
import { defineCreatureRecords } from '../../../src/content/creatures/define';
import { aiProfileSchema, creatureSchema, lootTableSchema, spawnTableSchema, type AiProfileDef, type CreatureDef, type LootTableDef, type SpawnTableDef } from '../../../src/content/creatures/schema';
import { NULL_ENTITY, type Entity } from '../../../src/engine/ecs';
import { BestiarySystem } from '../../../src/game/creatures/bestiary';
import { CreatureCatalog } from '../../../src/game/creatures/catalog';
import type { CreatureEnvironment } from '../../../src/game/creatures/environment';
import type { CreatureLight } from '../../../src/game/creatures/light';
import { CreatureSystem } from '../../../src/game/creatures/system';
import type { CreatureState } from '../../../src/game/creatures/state';
import { TrapSystem } from '../../../src/game/creatures/traps';
import type { CreatureZone } from '../../../src/game/creatures/zone';
import type { ItemStack } from '../../../src/game/items/stack';
import type { Simulation } from '../../../src/game/sim';
import type { DayPhase, Season } from '../../../src/world/calendar';
import type { ChunkData } from '../../../src/world/model/chunk';
import { CHUNK_SHIFT, TILE_PX, type Layer } from '../../../src/world/model/coords';
import { tileLevelSampler } from '../../../src/world/path/light';
import { kampfWelt, meadow, OFFSET, T, type KampfWelt } from './kampf-testwelt';

export { OFFSET, T, meadow };

/** Fixture AI profiles. */
export const PROBE_PROFILE = defineCreatureRecords('aiProfiles', aiProfileSchema, [
  {
    id: 'probe_wolf',
    haltung: 'aggressiv',
    sicht: 14,
    gehoer: 1.5,
    fluchtDistanz: 0,
    mut: 0,
    leine: 40,
    streifen: 8,
    gewichte: { ruhen: 1, grasen: 0, umherstreifen: 1 },
    untersuchen: 6,
    gedaechtnis: 10,
    rudel: { ringTiles: 4, angreiferZugleich: 1 },
    schuetztSich: false,
    brichtTueren: false,
    meidetLicht: null,
    unerbittlich: false,
  },
  {
    id: 'probe_schleicher',
    haltung: 'jaeger',
    sicht: 16,
    gehoer: 1.5,
    fluchtDistanz: 0,
    mut: 0,
    leine: 60,
    streifen: 8,
    gewichte: { ruhen: 1, grasen: 0, umherstreifen: 2 },
    untersuchen: 8,
    gedaechtnis: 12,
    schuetztSich: false,
    brichtTueren: false,
    meidetLicht: 0.5,
    unerbittlich: false,
  },
  {
    id: 'probe_fisch',
    haltung: 'scheu',
    sicht: 6,
    gehoer: 1,
    fluchtDistanz: 3,
    mut: 0,
    leine: 12,
    streifen: 6,
    gewichte: { ruhen: 0, grasen: 0, umherstreifen: 1 },
    untersuchen: 2,
    gedaechtnis: 2,
    schuetztSich: false,
    brichtTueren: false,
    meidetLicht: null,
    unerbittlich: false,
  },
  {
    id: 'probe_brecher',
    haltung: 'jaeger',
    sicht: 20,
    gehoer: 1,
    fluchtDistanz: 0,
    mut: 0,
    leine: 60,
    streifen: 4,
    gewichte: { ruhen: 1, grasen: 0, umherstreifen: 0 },
    untersuchen: 8,
    gedaechtnis: 30,
    schuetztSich: false,
    brichtTueren: true,
    meidetLicht: null,
    unerbittlich: true,
  },
]);

const BISS = { name: 'biss', art: 'nahkampf', schadensart: 'stich', schaden: 6, reichweite: 12, bogen: 90, ausholzeit: 0.4, abklingzeit: 1.5, gewicht: 1, wucht: 2, stagger: 0.2, sound: 'sfx_kreatur_reh_tritt' } as const;
const SOUNDS = { laut: 'sfx_kreatur_hase_laut', treffer: 'sfx_kreatur_hase_treffer', tod: 'sfx_kreatur_hase_tod' } as const;
const TEXT = { de: 'Probe', en: 'Probe' } as const;
const BESTIARY = { text: TEXT, hinweis: TEXT } as const;

/** Fixture creatures. */
export const PROBE_KREATUREN = defineCreatureRecords('creatures', creatureSchema, [
  {
    id: 'probe_wolf',
    name: { de: 'Probewolf', en: 'Probe wolf' },
    beschreibung: TEXT,
    familie: 'gegner',
    team: 'feind',
    biome: ['gruenhain'],
    groesse: 32,
    stufe: 0,
    leben: 40,
    tempo: { gehen: 2, rennen: 6 },
    radius: 6,
    ruestung: 0,
    resistenzen: {},
    material: 'fell',
    angriffe: [BISS],
    ki: 'probe_wolf',
    beute: 'probe_wolf',
    sounds: SOUNDS,
    aktiv: ['tag', 'daemmerung', 'nacht'],
    fortbewegung: 'land',
    augen: 'feuer',
    fangbar: false,
    bestiarium: BESTIARY,
  },
  {
    id: 'probe_schleicher',
    name: { de: 'Probeschleicher', en: 'Probe creeper' },
    beschreibung: TEXT,
    familie: 'schattenbrut',
    team: 'schattenbrut',
    biome: [],
    groesse: 32,
    stufe: 1,
    leben: 30,
    tempo: { gehen: 2, rennen: 5 },
    radius: 6,
    ruestung: 0,
    resistenzen: { licht: -0.5 },
    material: 'schatten',
    angriffe: [BISS],
    ki: 'probe_schleicher',
    beute: 'probe_schleicher',
    sounds: SOUNDS,
    aktiv: ['nacht', 'daemmerung'],
    fortbewegung: 'land',
    augen: 'verderb',
    fangbar: false,
    bestiarium: BESTIARY,
  },
  {
    id: 'probe_fisch',
    name: { de: 'Probefisch', en: 'Probe fish' },
    beschreibung: TEXT,
    familie: 'friedlich',
    team: 'tier',
    biome: ['gruenhain'],
    groesse: 16,
    stufe: 0,
    leben: 5,
    tempo: { gehen: 2, rennen: 5 },
    radius: 3,
    ruestung: 0,
    resistenzen: {},
    material: 'fleisch',
    angriffe: [],
    ki: 'probe_fisch',
    beute: null,
    ohneBeute: 'Probe ohne Beute',
    sounds: SOUNDS,
    aktiv: ['tag', 'daemmerung', 'nacht'],
    fortbewegung: 'schwimmer',
    augen: null,
    fangbar: false,
    bestiarium: BESTIARY,
  },
  {
    id: 'probe_brecher',
    name: { de: 'Probebrecher', en: 'Probe breaker' },
    beschreibung: TEXT,
    familie: 'gegner',
    team: 'feind',
    biome: ['gruenhain'],
    groesse: 32,
    stufe: 0,
    leben: 60,
    tempo: { gehen: 2, rennen: 4 },
    radius: 6,
    ruestung: 0,
    resistenzen: {},
    material: 'holz',
    angriffe: [BISS],
    ki: 'probe_brecher',
    beute: 'probe_brecher',
    sounds: SOUNDS,
    aktiv: ['tag', 'daemmerung', 'nacht'],
    fortbewegung: 'land',
    augen: null,
    fangbar: false,
    bestiarium: BESTIARY,
  },
]);

/** Loot of the fixtures. */
export const PROBE_BEUTE = defineCreatureRecords('lootTables', lootTableSchema, [
  { id: 'probe_wolf', ziehungen: [1, 1], beute: [{ item: 'knochen', gewicht: 1, anzahl: [1, 1] }], zerlegen: [{ item: 'fell', chance: 1, anzahl: [1, 1] }] },
  { id: 'probe_schleicher', ziehungen: [1, 1], beute: [{ item: 'lumen_scherbe', gewicht: 1, anzahl: [1, 2] }], zerlegen: [] },
  { id: 'probe_brecher', ziehungen: [1, 1], beute: [{ item: 'knochen', gewicht: 1, anzahl: [1, 1] }], zerlegen: [] },
]);

/** A night table of the fixture shadow brood in the test biome (the real Grünhain table for the day). */
export const PROBE_SPAWN = defineCreatureRecords('spawnTables', spawnTableSchema, [
  {
    id: 'gruenhain',
    tag: [{ kreatur: 'hase', gewicht: 1, gruppe: [1, 1] }],
    nacht: [
      { kreatur: 'hase', gewicht: 1, gruppe: [1, 1] },
      { kreatur: 'probe_schleicher', gewicht: 1, gruppe: [1, 2] },
    ],
    jahreszeiten: { fruehling: 1, sommer: 1, herbst: 1, winter: 1 },
  },
]);

/** The content's creatures with the fixtures; `spawn`: the content's tables or the fixture night table. */
export function probeCatalog(spawn: 'inhalt' | 'probe' = 'probe'): CreatureCatalog {
  const creatures: CreatureDef[] = [...CREATURES, ...PROBE_KREATUREN];
  const profiles: AiProfileDef[] = [...AI_PROFILES, ...PROBE_PROFILE];
  const loot: LootTableDef[] = [...LOOT_TABLES, ...PROBE_BEUTE];
  const tables: SpawnTableDef[] = spawn === 'probe' ? [...PROBE_SPAWN] : [...SPAWN_TABLES];
  return new CreatureCatalog(creatures, profiles, loot, tables, TRAPS);
}

/** Time, weather and biome of a test (changeable). */
export interface TestCreatureEnvironment extends CreatureEnvironment {
  phase: DayPhase;
  season: Season;
  finster: boolean;
  haze: number;
  rain: number;
  biomeId: string | null;
}

export function testCreatureEnvironment(): TestCreatureEnvironment {
  const env: TestCreatureEnvironment = {
    phase: 'tag',
    season: 'sommer',
    finster: false,
    haze: 0,
    rain: 0,
    biomeId: 'gruenhain',
    timeAt: (_s, _t, out) => {
      out.phase = env.phase;
      out.season = env.season;
      return out;
    },
    finstermond: () => env.finster,
    weather: (_s, _l, _x, _y, out) => {
      out.haze = env.haze;
      out.precipitation = env.rain;
      return out;
    },
    biome: () => env.biomeId,
  };
  return env;
}

/** A disc of light: its level [0–1] within `radius` tiles of a point [px]. */
export interface Disc {
  x: number;
  y: number;
  radius: number;
  level: number;
}

/** A light map of an ambient level (default 0,8: bright day, below glaring) plus discs (tile levels at the tile centre). */
export class TestLight implements CreatureLight {
  ambient = 0.8;
  lit = false;
  readonly discs: Disc[] = [];
  readonly paths = tileLevelSampler(() => ({ tileLevel: (layer, tx, ty) => this.tileLevel(null, layer, tx, ty) }));

  tileLevel(_sim: Simulation | null, _layer: Layer, tx: number, ty: number): number {
    return this.levelAt(null, _layer, (tx + 1 / 2) * TILE_PX, (ty + 1 / 2) * TILE_PX);
  }

  levelAt(_sim: Simulation | null, _layer: Layer, x: number, y: number): number {
    let v = this.ambient;
    for (const d of this.discs) {
      const dx = x - d.x;
      const dy = y - d.y;
      if (dx * dx + dy * dy <= (d.radius * TILE_PX) ** 2) v += d.level;
    }
    return v;
  }

  playerLit(): boolean {
    return this.lit;
  }
}

/** A zone of the named chunks on every layer (all chunks when `only` is null). */
export class TestZone implements CreatureZone {
  only: Set<string> | null = null;
  readonly list: ChunkData[] = [];

  isActive(_layer: Layer, cx: number, cy: number): boolean {
    return this.only === null || this.only.has(`${cx},${cy}`);
  }

  chunks(): readonly ChunkData[] {
    return this.list;
  }
}

/** A drop handed to the drop system. */
export interface Spilled {
  readonly stack: ItemStack;
  readonly layer: number;
  readonly x: number;
  readonly y: number;
}

/** The world of a creature test. */
export interface KreaturWelt extends KampfWelt {
  readonly creatures: CreatureSystem;
  readonly traps: TrapSystem;
  readonly bestiary: BestiarySystem;
  readonly cenv: TestCreatureEnvironment;
  readonly light: TestLight;
  readonly zone: TestZone;
  readonly spilled: Spilled[];
  /** A creature of `id` at map tile (x, y) (through `creature.spawn`); returns its entity. */
  creature(id: string, x: number, y: number): Entity;
  /** The state of creature `e`. */
  state(e: Entity): CreatureState;
  /** Position of creature `e` [px]. */
  where(e: Entity): { x: number; y: number };
}

/** A creature test world on `rows` (default: an open meadow of 40 × 30 tiles), the player at map tile (x, y). */
export function kreaturWelt(rows: readonly string[] = meadow(40, 30), spawnAt: { x: number; y: number } = { x: 20, y: 15 }, seed = 1, spawn: 'inhalt' | 'probe' = 'probe'): KreaturWelt {
  const k = kampfWelt(rows, spawnAt, seed);
  const cenv = testCreatureEnvironment();
  const light = new TestLight();
  const zone = new TestZone();
  const spilled: Spilled[] = [];
  const catalog = probeCatalog(spawn);
  const creatures = k.sim.addSystem(
    new CreatureSystem(k.sim, {
      player: k.player,
      motion: k.motion,
      collision: k.collision,
      combat: k.combat,
      inventory: k.inventory,
      equipment: k.equipment,
      drops: {
        spawn: (_s, stack, layer, x, y) => {
          spilled.push({ stack, layer, x, y });
          return NULL_ENTITY;
        },
      },
      zone,
      catalog,
      environment: cenv,
      light,
    }),
  );
  const traps = k.sim.addSystem(new TrapSystem({ player: k.player, inventory: k.inventory, collision: k.collision, creatures, catalog }));
  creatures.useTraps(traps);
  const bestiary = k.sim.addSystem(new BestiarySystem({ creatures, player: k.player, light }));
  creatures.useLife(k.life);
  k.life.fear.useLight((_s, layer, x, y) => light.levelAt(null, layer, x, y));
  // The combat world itself grows (its `aim` is an accessor a copy would lose).
  const w: KreaturWelt = Object.assign(k, {
    creatures,
    traps,
    bestiary,
    cenv,
    light,
    zone,
    spilled,
    creature(id: string, x: number, y: number): Entity {
      const before = new Set<Entity>();
      for (let i = 0; i < creatures.store.size; i++) before.add(creatures.store.entityAt(i));
      const c = k.centre(x, y);
      const ev = k.run(1, [{ type: 'creature.spawn', creature: id, count: 1, x: c.x, y: c.y, layer: 0 }]);
      const rejected = ev.get('commandRejected');
      if (rejected !== undefined) throw new Error(`creature.spawn rejected: ${JSON.stringify(rejected)}`);
      for (let i = 0; i < creatures.store.size; i++) {
        const e = creatures.store.entityAt(i);
        if (!before.has(e)) return e;
      }
      throw new Error(`no ${id} spawned`);
    },
    state(e: Entity): CreatureState {
      const s = creatures.store.get(e);
      if (s === undefined) throw new Error(`creature ${e} is gone`);
      return s;
    },
    where(e: Entity): { x: number; y: number } {
      const p = { x: 0, y: 0 };
      if (!creatures.positionOf(e, p)) throw new Error(`creature ${e} has no position`);
      return p;
    },
  });
  return w;
}

/** Tile of a position [px]. */
export function tileOf(p: { x: number; y: number }): { tx: number; ty: number } {
  return { tx: Math.floor(p.x / TILE_PX), ty: Math.floor(p.y / TILE_PX) };
}

/** Chunk key "cx,cy" of map tile (x, y). */
export function chunkOfMap(x: number, y: number): string {
  return `${(OFFSET + x) >> CHUNK_SHIFT},${(OFFSET + y) >> CHUNK_SHIFT}`;
}
