/**
 * The bestiary (MASTERPROMPT §20.1 "Bestiarium-Eintrag DE/EN"; docs/SPIEL.md §11 "Bestiarium (M6-32)").
 *
 * Every creature has an entry that opens in stages (`bestiaryUnlocked`):
 * - `gesichtet`: it was in view for `BALANCE.creatures.bestiary.sightSeconds` in all – within `sightRadiusTiles` of the
 *   player on its layer, standing in light of at least `sightMinLight` or showing glowing eyes in the dark (§12.1:
 *   in the dark one sees only the eyes). The entry's text and the creature's values open.
 * - `resistenzen`: defeated `killsForResistances` times – its resistances and weaknesses open, and the hint.
 * - `beute`: defeated `killsForLoot` times – its loot table opens.
 * The system looks `checkHz` times a second who is in view (each kind counts once per look) and counts every defeat
 * the creature system reports (`CreatureSystem.onDeath`). The UI shows it in the chronicle (M7). Global (the player's
 * knowledge). Save participant `bestiary` (version 1).
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';
import { NULL_ENTITY } from '../../engine/ecs';
import { TILE_PX } from '../../world/model/coords';
import type { SaveParticipant } from '../participant';
import type { PlayerSystem } from '../player/system';
import type { SimSystem, Simulation } from '../sim';
import type { CreatureCatalog } from './catalog';
import type { BestiaryStage } from './events';
import type { CreatureLight } from './light';
import type { CreatureSystem } from './system';

/** Id of the bestiary system and its save participant. */
export const BESTIARY_SYSTEM_ID = 'bestiary';
/** Data version of the `bestiary` participant. */
export const BESTIARY_SAVE_VERSION = 1;

const B = BALANCE.creatures.bestiary;
const CHECK_TICKS = Math.max(1, Math.round(BALANCE.time.tickHz / B.checkHz));
const SIGHT_TICKS = Math.round(B.sightSeconds * BALANCE.time.tickHz);
const SIGHT_PX = B.sightRadiusTiles * TILE_PX;

/** What the player knows of one creature. */
export interface BestiaryEntry {
  /** Ticks it was in view (counted per look). */
  seenTicks: number;
  sighted: boolean;
  /** Defeats. */
  kills: number;
}

/** The stages an entry has opened. */
export interface BestiaryStages {
  readonly gesichtet: boolean;
  readonly resistenzen: boolean;
  readonly beute: boolean;
}

const snapshotSchema = z
  .object({
    entries: z.array(
      z
        .object({
          creature: z.string().min(1),
          seenTicks: z.number().int().min(0),
          sighted: z.boolean(),
          kills: z.number().int().min(0),
        })
        .strict(),
    ),
  })
  .strict();

/** Dependencies of the bestiary. */
export interface BestiaryDeps {
  readonly creatures: Pick<CreatureSystem, 'store' | 'positionOf' | 'onDeath' | 'catalog'>;
  readonly player: PlayerSystem;
  /** The light map (absent: everything in range counts as seen). */
  readonly light?: CreatureLight | null;
}

/** The bestiary (see module comment). */
export class BestiarySystem implements SimSystem {
  readonly id = BESTIARY_SYSTEM_ID;
  readonly timeScope = 'global';
  readonly save: SaveParticipant;
  private readonly creatures: BestiaryDeps['creatures'];
  private readonly catalog: CreatureCatalog;
  private readonly player: PlayerSystem;
  private readonly light: CreatureLight | null;
  private readonly entries = new Map<string, BestiaryEntry>();
  /** Tick each kind was last counted (one count per kind and look). */
  private readonly looked = new Map<string, number>();
  private readonly at = { x: 0, y: 0 };
  private readonly other = { x: 0, y: 0 };

  constructor(deps: BestiaryDeps) {
    this.creatures = deps.creatures;
    this.catalog = deps.creatures.catalog;
    this.player = deps.player;
    this.light = deps.light ?? null;
    deps.creatures.onDeath((sim, creature) => this.defeated(sim, creature));
    this.save = {
      id: BESTIARY_SYSTEM_ID,
      version: BESTIARY_SAVE_VERSION,
      // A save from before M6 knows no creature yet.
      migrations: [{ from: 0, migrate: () => ({ entries: [] }) }],
      serialize: () => ({
        entries: [...this.entries.keys()].sort().map((creature) => ({ creature, ...(this.entries.get(creature) as BestiaryEntry) })),
      }),
      deserialize: (data) => this.restore(data),
    };
  }

  /** The entry of `creature` (a fresh one when it was never seen). */
  entry(creature: string): Readonly<BestiaryEntry> {
    return this.entries.get(creature) ?? { seenTicks: 0, sighted: false, kills: 0 };
  }

  /** The stages `creature`'s entry has opened. */
  stages(creature: string): BestiaryStages {
    const e = this.entry(creature);
    return { gesichtet: e.sighted, resistenzen: e.kills >= B.killsForResistances, beute: e.kills >= B.killsForLoot };
  }

  update(sim: Simulation): void {
    const tick = sim.eventTick;
    if (tick % CHECK_TICKS !== 0 || sim.player === NULL_ENTITY) return;
    const body = this.player.body(sim);
    if (body === undefined || !this.player.position(sim, this.at)) return;
    const store = this.creatures.store;
    for (let i = 0; i < store.size; i++) {
      const s = store.valueAt(i);
      // A camouflaged creature that hides is a bush to the eye (M6-22): it is not sighted until it shows itself.
      if (s.layer !== body.layer || s.health <= 0 || s.fadeTick >= 0 || s.hidden || this.looked.get(s.creature) === tick) continue;
      if (!this.creatures.positionOf(store.entityAt(i), this.other)) continue;
      const dx = this.other.x - this.at.x;
      const dy = this.other.y - this.at.y;
      if (dx * dx + dy * dy > SIGHT_PX * SIGHT_PX) continue;
      if (this.light !== null && this.catalog.get(s.creature).def.augen === null) {
        const level = this.light.tileLevel(sim, s.layer, Math.floor(this.other.x / TILE_PX), Math.floor(this.other.y / TILE_PX));
        if (level < B.sightMinLight) continue;
      }
      this.looked.set(s.creature, tick);
      const e = this.ensure(s.creature);
      e.seenTicks += CHECK_TICKS;
      if (!e.sighted && e.seenTicks >= SIGHT_TICKS) {
        e.sighted = true;
        this.unlocked(sim, s.creature, 'gesichtet');
      }
    }
  }

  private defeated(sim: Simulation, creature: string): void {
    const e = this.ensure(creature);
    e.kills++;
    if (e.kills === B.killsForResistances) this.unlocked(sim, creature, 'resistenzen');
    if (e.kills === B.killsForLoot) this.unlocked(sim, creature, 'beute');
  }

  private unlocked(sim: Simulation, creature: string, stage: BestiaryStage): void {
    sim.events.push('bestiaryUnlocked', { creature, stage, tick: sim.eventTick });
  }

  private ensure(creature: string): BestiaryEntry {
    let e = this.entries.get(creature);
    if (e === undefined) {
      e = { seenTicks: 0, sighted: false, kills: 0 };
      this.entries.set(creature, e);
    }
    return e;
  }

  private restore(data: unknown): void {
    const parsed = snapshotSchema.safeParse(data);
    if (!parsed.success) throw new TypeError(`bestiary snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    const seen = new Set<string>();
    for (const e of parsed.data.entries) {
      if (!this.catalog.has(e.creature)) throw new TypeError(`bestiary snapshot invalid: unknown creature "${e.creature}"`);
      if (seen.has(e.creature)) throw new TypeError(`bestiary snapshot invalid: "${e.creature}" twice`);
      seen.add(e.creature);
    }
    this.entries.clear();
    this.looked.clear();
    for (const { creature, ...rest } of parsed.data.entries) this.entries.set(creature, { ...rest });
  }
}
