/**
 * The creature catalogue of a simulation (docs/SPIEL.md §11 "Daten"): the content's creatures with their AI profile, loot
 * table, resolved movement rules and attacks, the spawn tables by biome and the traps – everything the creature system
 * reads per tick, resolved once. `contentCreatureCatalog()` builds it from the registry (src/content/index.ts); tests build
 * one over fixture creatures (packs, shadow brood) with `new CreatureCatalog(…)`.
 */
import { BALANCE } from '../../content/balance';
import { DIFFICULTIES, type Difficulty } from '../../content/balance/death';
import { CONTENT } from '../../content/index';
import type { AiProfileDef, CreatureAttack, CreatureDef, LootTableDef, SpawnTableDef, TrapDef } from '../../content/creatures/schema';
import { LAND_CREATURE_RULES, type MoverRules } from '../../world/collision/tiles';
import { TILE_PX } from '../../world/model/coords';
import { moverBlockMask } from '../../world/path/grid';
import type { MoverClass } from '../../world/path/types';
import { secondsToTicks } from '../combat/formulas';
import { windupPoseTicks, windupTicks } from './formulas';

const TICK_HZ = BALANCE.time.tickHz;

/** One creature kind, resolved. */
export interface CreatureKind {
  readonly id: string;
  readonly def: CreatureDef;
  readonly profile: AiProfileDef;
  /** Loot table, or `null` (`ohneBeute`). */
  readonly loot: LootTableDef | null;
  readonly attacks: readonly CreatureAttack[];
  /** Shortest reach of its attacks apart from the ambush [px] (`Infinity` without one): how close it closes in to strike. */
  readonly approachReach: number;
  /**
   * Telegraph of each attack by difficulty [ticks]: `windupTicks` and `windupPoseTicks`, resolved once (the attack's tick
   * reads them every tick of its wind-up, M6-16d).
   */
  readonly windup: Readonly<Record<Difficulty, Int32Array>>;
  readonly windupPose: Readonly<Record<Difficulty, Int32Array>>;
  /** Its profile's times in ticks, resolved once (the tick and its decisions read them, M6-16d): memory, investigation. */
  readonly memoryTicks: number;
  readonly investigateTicks: number;
  /** Camouflage (`tarnung`) in ticks: the reveal (at least 1) and the calm before it hides again; 0 without camouflage. */
  readonly revealTicks: number;
  readonly hideTicks: number;
  readonly mover: MoverClass;
  /** Collision rules of its walk (`moverBlockMask`, docs/SPIEL.md §11 "Regeln je Fortbewegung"). */
  readonly rules: MoverRules;
  /** Collision rules while it flutters or flies. */
  readonly flyRules: MoverRules;
  /** Pace walking and running [px/tick]. */
  readonly walkPx: number;
  readonly runPx: number;
  /** Shadow brood (fights on its side, fades at sunrise, spawned by the night spawner). */
  readonly shadow: boolean;
  /** Leaves a carcass to carve. */
  readonly carcass: boolean;
}

/** Collision rules of flying (fliers, fluttering ground birds): over objects, water and lava, at their level. */
const FLY_RULES: MoverRules = Object.freeze({ blockMask: moverBlockMask('flieger'), mode: 'fly', dropDown: false });

/** Collision rules of a mover class (the same table as the path finding, M6-17b). */
export function moverRules(mover: MoverClass): MoverRules {
  if (mover === 'land') return LAND_CREATURE_RULES;
  if (mover === 'flieger') return FLY_RULES;
  return Object.freeze({ blockMask: moverBlockMask(mover), mode: 'walk', dropDown: false });
}

/** The shortest reach of the attacks that do not spring from camouflage [px] (`Infinity` without one). */
function approachReachOf(attacks: readonly CreatureAttack[]): number {
  let reach = Number.POSITIVE_INFINITY;
  for (const a of attacks) if (a.ausTarnung !== true) reach = Math.min(reach, a.reichweite);
  return reach;
}

/** `ticks(attack, difficulty)` of every attack, by difficulty. */
function perDifficulty(attacks: readonly CreatureAttack[], ticks: (a: CreatureAttack, d: Difficulty) => number): Record<Difficulty, Int32Array> {
  const out = {} as Record<Difficulty, Int32Array>;
  for (const d of DIFFICULTIES) out[d] = Int32Array.from(attacks, (a) => ticks(a, d));
  return out;
}

/** The creatures, profiles, loot, spawn tables and traps of a simulation. */
export class CreatureCatalog {
  private readonly byId = new Map<string, CreatureKind>();
  private readonly tables = new Map<string, SpawnTableDef>();
  private readonly trapDefs = new Map<string, TrapDef>();
  /** Every kind in id order. */
  readonly kinds: readonly CreatureKind[];

  constructor(creatures: readonly CreatureDef[], profiles: readonly AiProfileDef[], loot: readonly LootTableDef[], spawnTables: readonly SpawnTableDef[], traps: readonly TrapDef[]) {
    const profileById = new Map(profiles.map((p) => [p.id, p]));
    const lootById = new Map(loot.map((t) => [t.id, t]));
    const kinds: CreatureKind[] = [];
    for (const def of [...creatures].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      const profile = profileById.get(def.ki);
      if (profile === undefined) throw new RangeError(`CreatureCatalog: ${def.id} names the unknown AI profile ${def.ki}`);
      const table = def.beute === null ? null : lootById.get(def.beute);
      if (table === undefined) throw new RangeError(`CreatureCatalog: ${def.id} names the unknown loot table ${String(def.beute)}`);
      // An ambush springs only from camouflage (M6-15d): without `tarnung` in the profile it could never come.
      if (profile.tarnung === undefined && def.angriffe.some((a) => a.ausTarnung === true)) throw new RangeError(`CreatureCatalog: ${def.id} has an ambush (ausTarnung) but its AI profile ${profile.id} no tarnung`);
      const mover = def.fortbewegung;
      const kind: CreatureKind = {
        id: def.id,
        def,
        profile,
        loot: table,
        attacks: def.angriffe,
        approachReach: approachReachOf(def.angriffe),
        windup: perDifficulty(def.angriffe, windupTicks),
        windupPose: perDifficulty(def.angriffe, windupPoseTicks),
        memoryTicks: secondsToTicks(profile.gedaechtnis),
        investigateTicks: secondsToTicks(profile.untersuchen),
        revealTicks: profile.tarnung === undefined ? 0 : secondsToTicks(profile.tarnung.erwachen, 1),
        hideTicks: profile.tarnung === undefined ? 0 : secondsToTicks(profile.tarnung.tarnenNach),
        mover,
        rules: moverRules(mover),
        flyRules: FLY_RULES,
        walkPx: (def.tempo.gehen * TILE_PX) / TICK_HZ,
        runPx: (def.tempo.rennen * TILE_PX) / TICK_HZ,
        shadow: def.familie === 'schattenbrut',
        carcass: table !== null && table.zerlegen.length > 0,
      };
      kinds.push(kind);
      this.byId.set(def.id, kind);
    }
    this.kinds = kinds;
    for (const t of spawnTables) this.tables.set(t.id, t);
    for (const t of traps) this.trapDefs.set(t.id, t);
  }

  /** The kind `id`; throws for an unknown creature. */
  get(id: string): CreatureKind {
    const k = this.byId.get(id);
    if (k === undefined) throw new RangeError(`CreatureCatalog: unknown creature "${id}"`);
    return k;
  }

  /** The kind `id`, or `undefined`. */
  find(id: string): CreatureKind | undefined {
    return this.byId.get(id);
  }

  /** Whether `id` is a creature. */
  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** The spawn table of a biome, or `undefined`. */
  spawnTable(biome: string): SpawnTableDef | undefined {
    return this.tables.get(biome);
  }

  /** The trap of a trap item, or `undefined`. */
  trap(item: string): TrapDef | undefined {
    return this.trapDefs.get(item);
  }
}

let contentCatalog: CreatureCatalog | null = null;

/** The catalogue of the game's content (built once). */
export function contentCreatureCatalog(): CreatureCatalog {
  contentCatalog ??= new CreatureCatalog(
    CONTENT.collection('creatures').values(),
    CONTENT.collection('aiProfiles').values(),
    CONTENT.collection('lootTables').values(),
    CONTENT.collection('spawnTables').values(),
    CONTENT.collection('traps').values(),
  );
  return contentCatalog;
}
