/**
 * The unlock registry (MASTERPROMPT §23.1 "Leuchtfeuer-Wissen", §15.1 "Baupläne"; docs/SPIEL.md §22 "Freischaltungen";
 * strand F, system `unlocks`, M7-36): which entries of the content collection `unlocks` are granted, when and from where –
 * a lit beacon (`leuchtfeuer:<n>`), a blueprint (`bauplan:<item>`, strand C), research (`forschung:<relikt>`), the trader
 * (M9) or the console (`debug`). Recipes with `freischaltung` wait for theirs: crafting asks `recipeAllowed` and is told
 * about every grant (`onGrant`, also after a load – silently, the bags and recipes restore earlier in the order).
 *
 * No tick hooks (nothing happens with time). Save participant `unlocks` (version 1).
 */
import { CONTENT } from '../../content/index';
import type { RecipeDef } from '../../content/recipes/schema';
import type { UnlockDef } from '../../content/unlocks/schema';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import type { SaveParticipant } from '../participant';
import { unlocksSnapshotSchema, type UnlocksSnapshot } from './state';
import type { UnlockGrant, UnlockRegistry, UnlockSource } from './types';

/** Id of the unlock system and its save participant. */
export const UNLOCKS_SYSTEM_ID = 'unlocks';
/** Data version of the `unlocks` participant. */
export const UNLOCKS_SAVE_VERSION = 1;

/** Told about every grant (`sim` null: restored from a save, silently). */
export type UnlockListener = (sim: Simulation | null) => void;

/** Dependencies of the unlock system (tests hand in their own unlocks and recipes). */
export interface UnlocksSystemDeps {
  /** The unlocks of §23.1; default: the content collection `unlocks`. */
  readonly unlocks?: readonly UnlockDef[];
  /** Recipe id → the unlock it waits for; default: the content's recipes with `freischaltung`. */
  readonly recipes?: readonly Pick<RecipeDef, 'id' | 'freischaltung'>[];
}

export class UnlocksSystem implements SimSystem, UnlockRegistry {
  readonly id = UNLOCKS_SYSTEM_ID;
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;
  private readonly defs: ReadonlyMap<string, UnlockDef>;
  /** Recipe id → its `freischaltung` (only recipes that wait for one). */
  private readonly recipeLocks: ReadonlyMap<string, string>;
  private readonly grants: UnlockGrant[] = [];
  private readonly byId = new Map<string, UnlockGrant>();
  private readonly listeners: UnlockListener[] = [];

  constructor(deps: UnlocksSystemDeps = {}) {
    const list = deps.unlocks ?? CONTENT.collection('unlocks').values();
    this.defs = new Map(list.map((u) => [u.id, u]));
    const recipes = deps.recipes ?? CONTENT.collection('recipes').values();
    const locks = new Map<string, string>();
    for (const r of recipes) if (r.freischaltung !== undefined) locks.set(r.id, r.freischaltung);
    this.recipeLocks = locks;
    this.commands = {
      'unlock.grant': (sim, cmd, tick) => {
        const reason = !this.defs.has(cmd.unlock) ? 'unknownUnlock' : this.byId.has(cmd.unlock) ? 'alreadyUnlocked' : null;
        if (reason !== null) {
          sim.events.push('commandRejected', { type: cmd.type, reason, tick });
          return;
        }
        this.grant(sim, cmd.unlock, 'debug');
      },
    };
    this.save = {
      id: UNLOCKS_SYSTEM_ID,
      version: UNLOCKS_SAVE_VERSION,
      // Saves before M7 know no unlocks: nothing granted.
      migrations: [{ from: 0, migrate: (): UnlocksSnapshot => ({ granted: [] }) }],
      serialize: (): UnlocksSnapshot => ({ granted: this.grants.map((g) => ({ id: g.id, tick: g.tick, source: g.source })) }),
      deserialize: (data) => this.restore(data),
    };
  }

  /** The unlock record `id`, or `undefined`. */
  def(id: string): UnlockDef | undefined {
    return this.defs.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  grant(sim: Simulation, id: string, source: UnlockSource): boolean {
    if (!this.defs.has(id) || this.byId.has(id)) return false;
    const g: UnlockGrant = { id, tick: sim.eventTick, source };
    this.grants.push(g);
    this.byId.set(id, g);
    sim.events.push('unlockGranted', { unlock: id, quelle: source, tick: sim.eventTick });
    for (const l of this.listeners) l(sim);
    return true;
  }

  granted(): readonly UnlockGrant[] {
    return this.grants;
  }

  recipeAllowed(recipe: string): boolean {
    const lock = this.recipeLocks.get(recipe);
    return lock === undefined || this.byId.has(lock);
  }

  /** Tells `listener` about every grant and every restore (crafting shows the recipes that wait). */
  onGrant(listener: UnlockListener): void {
    this.listeners.push(listener);
  }

  private restore(data: unknown): void {
    const parsed = unlocksSnapshotSchema.safeParse(data);
    if (!parsed.success) throw new TypeError(`unlocks snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    for (const g of parsed.data.granted) if (!this.defs.has(g.id)) throw new TypeError(`unlocks snapshot invalid: unknown unlock "${g.id}"`);
    this.grants.length = 0;
    this.byId.clear();
    for (const g of parsed.data.granted) {
      const grant: UnlockGrant = { id: g.id, tick: g.tick, source: g.source };
      this.grants.push(grant);
      this.byId.set(g.id, grant);
    }
    for (const l of this.listeners) l(null);
  }
}
