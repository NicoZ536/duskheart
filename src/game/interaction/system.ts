/**
 * Interaction system (MASTERPROMPT §11.4 "Sammeln (halten, Fortschrittsring), Interagieren (E)",
 * "Aufheben: … sonst E; volle Taschen → klarer Hinweis", §4.6 "Interagierbares unter Cursor oder in
 * Reichweite: 1-px-Outline in Akzentfarbe"; docs/SPIEL.md §3; M3-10).
 *
 * - **Focus** (every tick, after the body moved): the target the player would work – a drop, a world
 *   object or, with shovel, hoe or pickaxe in the hand, a tile – within reach (1,5 tiles from the feet to
 *   the target's edge). The aimed tile (`player.aim`, the cursor) wins when something workable lies
 *   there; otherwise the nearest target, targets in front of the player counting half a tile closer;
 *   targets that cannot be worked now (needs another tool, bare, bags full) come last. The focus is what
 *   the presentation outlines and what the HUD hint describes ("[E] Aufheben: Feuerstein ×3").
 * - **Action** (while `player.interact` is held): a drop is picked up at once; an object or tile is
 *   worked – by hand one pick of 0,5 s, with a tool one hit per swing (0,5 s, the first after 1/3 s) until
 *   its hit points are gone (§D). Hits wear the tool; the player turns to the target and counts as
 *   exerted (§11.1 satiety ×1,25 "bei Kampf/Abbau", modifier source `exertionSource`). A too weak tool
 *   swings once, strikes sparks and stops ("Zu hart"). Releasing stops (object damage stays, §14
 *   "Knoten mit Treffer-HP"); leaving the reach or the target vanishing stops too. Still held, the next
 *   target is taken – never the one just finished.
 * - **Use targets** (`addUses`, src/game/interaction/uses.ts): things E uses rather than harvests – a camp
 *   fire (feed, light), a placed torch (take), water ahead (drink), a stump (sit, stand up), the grave
 *   (recover), a bed (sleep). They compete with the other targets by the same score; a harvestable object on
 *   the same tile wins a tie (a stump is cleared with the axe in the hand). A press uses one target once,
 *   through the owning system's command, and is then spent (like a release).
 * - A press that finds nothing, or a target that cannot be worked, raises `commandRejected` with the
 *   reason (`nothingToInteract`, `needsTool`, `notRipe`, `keinBrennstoff` …).
 * - A dead or sleeping player (`PlayerSystem.incapacity`) works nothing and has no focus; a press is
 *   refused with `dead` or `asleep`.
 * - Global (the player's own action). Save participant `interaction`: aim, held state, the running action.
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';
import { NULL_ENTITY, type Entity } from '../../engine/ecs';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX, isLayer, type Layer } from '../../world/model/coords';
import type { CommandOfType } from '../commands';
import type { EquipmentSystem } from '../equipment/system';
import type { InventorySystem } from '../inventory/system';
import type { SlotRef } from '../items/slots';
import type { SaveParticipant } from '../participant';
import type { PlayerIncapacity, PlayerSystem } from '../player/system';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import type { PlayerModifierSource } from '../survival/modifiers';
import type { DropSystem } from '../drops/system';
import { isFlying } from '../drops/state';
import { createHarvestPlan, createObjectHit, type GatheringSystem, type HarvestPlan, type HeldTool, type ObjectHit } from '../gathering/system';
import { secondsToTicks } from '../gathering/formulas';
import type { DigResult } from '../gathering/events';
import { HARVEST_ACTIONS, type HarvestAction, type HarvestTool } from '../gathering/rules';
import type { UseAction } from '../../content/uses';
import type { ActionStop, InteractionRejectReason } from './events';
import { REACH_PX, actionProgress, distanceToRect, facingToward, facingUnit, hitDue, targetScore } from './formulas';
import { createUseOffer, type UseProvider, type UseRejectReason } from './uses';

/** Id of the interaction system and its save participant. */
export const INTERACTION_SYSTEM_ID = 'interaction';
/** Data version of the `interaction` participant. */
export const INTERACTION_SAVE_VERSION = 1;

const H = BALANCE.harvest;
/** Tiles searched around the player's tile for targets (reach 1,5 tiles + the largest footprint). */
const SEARCH_TILES = Math.ceil(BALANCE.interaction.reachTiles) + 1;
/** Score penalty of targets that cannot be worked now [px]: behind everything workable in reach. */
const BLOCKED_PENALTY = REACH_PX * 2;
/** Score handicap of a use target [px]: a harvestable object at the same distance wins the tie. */
const USE_TIE_PX = 1;

/** What the focus is: a drop, a world object or a tile to harvest, or a thing to use (`uses.ts`). */
export type FocusKind = 'none' | 'drop' | 'object' | 'tile' | 'use';
/** What working the focus does: pick up a drop, a harvest action, or a use action. */
export type FocusAction = 'aufheben' | HarvestAction | UseAction;
/** Why the focus cannot be worked now. */
export type FocusBlock = Exclude<InteractionRejectReason, 'nothingToInteract' | PlayerIncapacity> | UseRejectReason;

/** The target in focus with everything the outline and the hint need (sampled by the presentation). */
export interface InteractionFocus {
  kind: FocusKind;
  /** The drop entity (`NULL_ENTITY` otherwise). */
  entity: Entity;
  layer: Layer;
  /** Anchor tile of the object, the tile, or the drop's tile. */
  tx: number;
  ty: number;
  /** Centre of the target [world px]. */
  x: number;
  y: number;
  action: FocusAction;
  /** Item id (drop), world object id, terrain id, or the subject of a use target (a light kind, a `USE_SUBJECTS` id, the stump). */
  subject: string;
  /** Items in the drop (1 otherwise). */
  count: number;
  block: FocusBlock | null;
  /** Tool the target needs (`needsTool`). */
  needs: HarvestTool | null;
  /** The held tool is too weak (§13.2 "Zu hart"). */
  tooWeak: boolean;
  /** What digging makes of the tile. */
  dig: DigResult | null;
  /** The player works this target right now. */
  working: boolean;
  byHand: boolean;
  /** Progress of the action [0–1] (ring). */
  progress: number;
  hitsDone: number;
  hitsTotal: number;
}

/** A fresh, empty focus. */
export function createInteractionFocus(): InteractionFocus {
  return {
    kind: 'none',
    entity: NULL_ENTITY,
    layer: 0,
    tx: 0,
    ty: 0,
    x: 0,
    y: 0,
    action: 'aufheben',
    subject: '',
    count: 0,
    block: null,
    needs: null,
    tooWeak: false,
    dig: null,
    working: false,
    byHand: true,
    progress: 0,
    hitsDone: 0,
    hitsTotal: 0,
  };
}

/** Copies a focus (presentation samples). */
export function copyFocus(from: Readonly<InteractionFocus>, to: InteractionFocus): InteractionFocus {
  Object.assign(to, from);
  return to;
}

/** The running action (saved). */
interface Action {
  kind: 'object' | 'tile';
  layer: Layer;
  tx: number;
  ty: number;
  /** World object id (object) or terrain id (tile) – the target must still be it. */
  target: string;
  /** What the player does (feedback of the end). */
  name: HarvestAction;
  /** By hand (a pick) or with the tool (hits, exertion). */
  byHand: boolean;
  /** Ticks since the action started. */
  ticks: number;
  /** Damage already dealt to a tile [HP] (objects keep theirs in the chunk). */
  damage: number;
}

const layerSchema = z.number().int().refine(isLayer, { message: 'unknown layer' });
const tileSchema = z.object({ layer: layerSchema, tx: z.number().int(), ty: z.number().int() }).strict();
const interactionSnapshotSchema = z
  .object({
    aim: z.object({ x: z.number(), y: z.number() }).strict().nullable(),
    held: z.boolean(),
    explicit: z.object({ tx: z.number().int(), ty: z.number().int() }).strict().nullable(),
    attempted: z.boolean(),
    done: tileSchema.nullable(),
    action: z
      .object({
        kind: z.enum(['object', 'tile']),
        layer: layerSchema,
        tx: z.number().int(),
        ty: z.number().int(),
        target: z.string().min(1),
        name: z.enum(HARVEST_ACTIONS),
        byHand: z.boolean(),
        ticks: z.number().int().min(0),
        damage: z.number().min(0),
      })
      .strict()
      .nullable(),
  })
  .strict();

/** Dependencies of the interaction system (built in `createSimulation`). */
export interface InteractionDeps {
  readonly player: PlayerSystem;
  readonly inventory: InventorySystem;
  readonly equipment: EquipmentSystem;
  readonly drops: DropSystem;
  readonly gathering: GatheringSystem;
}

/** A candidate of the focus search. */
interface Candidate {
  kind: FocusKind;
  score: number;
  entity: Entity;
  layer: Layer;
  tx: number;
  ty: number;
  /** Index of the use provider (kind `use`). */
  use: number;
}

export class InteractionSystem implements SimSystem {
  readonly id = INTERACTION_SYSTEM_ID;
  readonly timeScope = 'global';
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;
  private readonly player: PlayerSystem;
  private readonly inventory: InventorySystem;
  private readonly equipment: EquipmentSystem;
  private readonly drops: DropSystem;
  private readonly gathering: GatheringSystem;
  private aim: { x: number; y: number } | null = null;
  private held = false;
  /** E was pressed in this tick (a tap pressed and released within one tick still acts once; never set between ticks). */
  private pressed = false;
  private explicit: { tx: number; ty: number } | null = null;
  /** The press already tried to start (a refused press is reported once). */
  private attempted = false;
  /** Target finished while E stayed held (not taken again until released). */
  private done: { layer: Layer; tx: number; ty: number } | null = null;
  private action: Action | null = null;
  /** The focus of the last tick. */
  readonly focus: InteractionFocus = createInteractionFocus();
  private readonly handTicks: number;
  private readonly hitTicks: number;
  private readonly swingTicks: number;
  private readonly pos = { x: 0, y: 0 };
  private readonly facing = { x: 0, y: 0 };
  /** Tile of the aimed point in the running focus search (reused, no allocation per tick). */
  private readonly aimTile = { tx: 0, ty: 0 };
  private readonly hit: ObjectHit = createObjectHit();
  private readonly plan: HarvestPlan = createHarvestPlan();
  private readonly best: Candidate = { kind: 'none', score: 0, entity: NULL_ENTITY, layer: 0, tx: 0, ty: 0, use: -1 };
  /** Providers of use targets (`addUses`), asked in order; the first offer of a tile counts. */
  private readonly uses: UseProvider[] = [];
  private readonly useOffer = createUseOffer();
  private readonly damageOut = { value: 0 };
  /** Room check cache of the focused drop (bags revision, entity, result). */
  private roomCache = { revision: -1, entity: NULL_ENTITY, count: -1, room: 0 };

  constructor(sim: Simulation, deps: InteractionDeps) {
    this.player = deps.player;
    this.inventory = deps.inventory;
    this.equipment = deps.equipment;
    this.drops = deps.drops;
    this.gathering = deps.gathering;
    const hz = sim.clock.tickHz;
    this.handTicks = secondsToTicks(H.handPickSeconds, hz);
    this.hitTicks = secondsToTicks(H.toolHitSeconds, hz);
    this.swingTicks = secondsToTicks(H.toolSwingSeconds, hz);
    this.commands = {
      'player.interact': (s, cmd, tick) => this.handleInteract(s, cmd, tick),
      'player.aim': (_s, cmd) => {
        this.aim = cmd.x === undefined || cmd.y === undefined ? null : { x: cmd.x, y: cmd.y };
      },
    };
    this.save = {
      id: INTERACTION_SYSTEM_ID,
      version: INTERACTION_SAVE_VERSION,
      serialize: () => ({
        aim: this.aim === null ? null : { ...this.aim },
        held: this.held,
        explicit: this.explicit === null ? null : { ...this.explicit },
        attempted: this.attempted,
        done: this.done === null ? null : { ...this.done },
        action: this.action === null ? null : { ...this.action },
      }),
      deserialize: (data) => {
        const parsed = interactionSnapshotSchema.safeParse(data);
        if (!parsed.success) throw new TypeError(`interaction snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        const d = parsed.data;
        if (d.action !== null) {
          const known = d.action.kind === 'object' ? this.gathering.rules.object(d.action.target) !== undefined : this.gathering.rules.ids.terrain.has(d.action.target);
          if (!known) throw new TypeError(`interaction snapshot invalid: unknown target "${d.action.target}"`);
        }
        this.aim = d.aim;
        this.held = d.held;
        this.explicit = d.explicit;
        this.attempted = d.attempted;
        this.done = d.done === null ? null : { ...d.done, layer: d.done.layer as Layer };
        this.action = d.action === null ? null : { ...d.action, layer: d.action.layer as Layer };
      },
    };
  }

  /** Adds a provider of use targets (camp fires, torches, graves, beds, stumps, water – `createUseProviders`). */
  addUses(provider: UseProvider): void {
    this.uses.push(provider);
  }

  /** Whether E is held. */
  get holding(): boolean {
    return this.held;
  }

  /** Whether the player works a target right now (tool or hand). */
  get working(): boolean {
    return this.action !== null;
  }

  /** The aimed world point [px], or null. */
  get aimPoint(): Readonly<{ x: number; y: number }> | null {
    return this.aim;
  }

  /** Modifier source of the player: working with a tool is exertion (§11.1 satiety ×1,25 "bei Kampf/Abbau"). */
  readonly exertionSource: PlayerModifierSource = (_sim, _player, out) => {
    if (this.action !== null && !this.action.byHand) out.exertion = true;
  };

  private handleInteract(sim: Simulation, cmd: CommandOfType<'player.interact'>, tick: number): void {
    if (this.player.body(sim) === undefined) {
      sim.events.push('commandRejected', { type: cmd.type, reason: 'noPlayer', tick });
      return;
    }
    if (!cmd.on) {
      this.held = false;
      this.explicit = null;
      this.done = null;
      return;
    }
    this.held = true;
    this.pressed = true;
    this.attempted = false;
    this.done = null;
    this.explicit = cmd.tx === undefined || cmd.ty === undefined ? null : { tx: cmd.tx, ty: cmd.ty };
    if (this.action !== null && this.explicit !== null && (this.action.tx !== this.explicit.tx || this.action.ty !== this.explicit.ty)) this.stop(sim, 'released');
  }

  update(sim: Simulation): void {
    const body = this.player.body(sim);
    if (body === undefined || !this.player.position(sim, this.pos)) {
      this.pressed = false;
      this.action = null;
      this.clearFocus();
      return;
    }
    const pressed = this.pressed;
    this.pressed = false;
    // Dead or asleep (§11.5, §11.6): nothing is worked, nothing in focus; a press says why.
    const unable = this.player.incapacity(sim);
    if (unable !== null) {
      this.stop(sim, 'blocked');
      if (pressed) this.refuse(sim, unable, sim.eventTick);
      this.clearFocus();
      return;
    }
    facingUnit(body.facing, this.facing);
    const tool = this.heldTool();
    if (this.action !== null) {
      if (!this.held) this.stop(sim, 'released');
      else this.work(sim, body.layer, tool);
    }
    if ((this.held || pressed) && this.action === null) this.start(sim, body.layer, tool, pressed);
    this.findFocus(sim, body.layer, tool);
  }

  // -------------------------------------------------------------------------------------------
  // Focus
  // -------------------------------------------------------------------------------------------

  private clearFocus(): void {
    const f = this.focus;
    f.kind = 'none';
    f.entity = NULL_ENTITY;
    f.working = false;
    f.progress = 0;
    f.block = null;
  }

  /** Chooses the best target around the player into `this.best` (kind `none` when there is nothing). */
  private choose(sim: Simulation, layer: Layer, tool: HeldTool | null, only: { tx: number; ty: number } | null): void {
    const b = this.best;
    b.kind = 'none';
    b.score = Number.POSITIVE_INFINITY;
    const px = this.pos.x;
    const py = this.pos.y;
    let aim = only;
    if (aim === null && this.aim !== null) {
      this.aimTile.tx = Math.floor(this.aim.x / TILE_PX);
      this.aimTile.ty = Math.floor(this.aim.y / TILE_PX);
      aim = this.aimTile;
    }
    // Drops.
    const store = this.drops.store;
    for (let i = 0; i < store.size; i++) {
      const d = store.valueAt(i);
      if (d.layer !== layer || isFlying(d)) continue;
      const dist = Math.hypot(d.x - px, d.y - py);
      if (dist > REACH_PX) continue;
      const tx = Math.floor(d.x / TILE_PX);
      const ty = Math.floor(d.y / TILE_PX);
      if (only !== null && (tx !== only.tx || ty !== only.ty)) continue;
      const aimed = aim !== null && tx === aim.tx && ty === aim.ty;
      const e = store.entityAt(i);
      const penalty = this.roomFor(e) === 0 ? BLOCKED_PENALTY : 0;
      this.offer(aimed ? -REACH_PX + penalty : targetScore(dist, this.facing.x, this.facing.y, d.x - px, d.y - py, penalty), 'drop', e, layer, tx, ty);
    }
    // Objects and tiles around.
    const ptx = Math.floor(px / TILE_PX);
    const pty = Math.floor(py / TILE_PX);
    const hit = this.hit;
    const plan = this.plan;
    for (let ty = pty - SEARCH_TILES; ty <= pty + SEARCH_TILES; ty++) {
      for (let tx = ptx - SEARCH_TILES; tx <= ptx + SEARCH_TILES; tx++) {
        if (only !== null && (tx !== only.tx || ty !== only.ty)) continue;
        const aimed = aim !== null && tx === aim.tx && ty === aim.ty;
        const ahead = tx === ptx + this.facing.x && ty === pty + this.facing.y;
        if (this.uses.length > 0) this.offerUse(sim, layer, tx, ty, aimed, ahead || only !== null);
        // An object counts once, at its anchor tile – and on the aimed (or given) tile it covers.
        if (this.gathering.objectAt(layer, tx, ty, hit) && ((hit.tx === tx && hit.ty === ty) || aimed || only !== null)) {
          const rule = hit.rule;
          if (rule !== null && this.gathering.planObject(sim, hit, tool, plan)) {
            if (!this.isDone(layer, hit.tx, hit.ty)) {
              const left = hit.tx * TILE_PX;
              const bottom = (hit.ty + 1) * TILE_PX;
              const dist = distanceToRect(px, py, left, bottom - rule.footprintH * TILE_PX, left + rule.footprintW * TILE_PX, bottom);
              if (dist <= REACH_PX) {
                const penalty = plan.block !== null ? BLOCKED_PENALTY : 0;
                this.offer(aimed ? -REACH_PX + penalty : targetScore(dist, this.facing.x, this.facing.y, plan.x - px, plan.y - py, penalty), 'object', NULL_ENTITY, layer, hit.tx, hit.ty);
              }
            }
            continue;
          }
        }
        if (tool === null || this.isDone(layer, tx, ty)) continue;
        // Tiles only where the player looks (the tile ahead) or aims: digging is never a side effect of the nearest tile.
        if (!(aimed || ahead || only !== null)) continue;
        if (!this.gathering.planTile(sim, layer, tx, ty, tool, plan)) continue;
        const dist = distanceToRect(px, py, tx * TILE_PX, ty * TILE_PX, (tx + 1) * TILE_PX, (ty + 1) * TILE_PX);
        if (dist > REACH_PX) continue;
        const penalty = plan.block !== null ? BLOCKED_PENALTY : 0;
        this.offer(aimed ? -REACH_PX + penalty : targetScore(dist, this.facing.x, this.facing.y, plan.x - px, plan.y - py, penalty) + REACH_PX, 'tile', NULL_ENTITY, layer, tx, ty);
      }
    }
  }

  /** Offers the use target of tile (tx, ty), if a provider reports one (the first provider wins). */
  private offerUse(sim: Simulation, layer: Layer, tx: number, ty: number, aimed: boolean, ahead: boolean): void {
    const o = this.useOffer;
    for (let i = 0; i < this.uses.length; i++) {
      if (!(this.uses[i] as UseProvider).offer(sim, layer, tx, ty, o)) continue;
      if (o.aimedOnly && !(aimed || ahead)) return;
      const px = this.pos.x;
      const py = this.pos.y;
      const dist = distanceToRect(px, py, tx * TILE_PX, ty * TILE_PX, (tx + 1) * TILE_PX, (ty + 1) * TILE_PX);
      if (dist > REACH_PX) return;
      const penalty = o.block !== null ? BLOCKED_PENALTY : 0;
      const score = aimed ? -REACH_PX + penalty + USE_TIE_PX : targetScore(dist, this.facing.x, this.facing.y, o.x - px, o.y - py, penalty) + (o.aimedOnly ? REACH_PX : USE_TIE_PX);
      this.offer(score, 'use', NULL_ENTITY, layer, tx, ty, i);
      return;
    }
  }

  private offer(score: number, kind: FocusKind, entity: Entity, layer: Layer, tx: number, ty: number, use = -1): void {
    const b = this.best;
    if (score >= b.score) return;
    b.kind = kind;
    b.score = score;
    b.entity = entity;
    b.layer = layer;
    b.tx = tx;
    b.ty = ty;
    b.use = use;
  }

  /** Writes the focus of this tick (the running action's target, else the best target). */
  private findFocus(sim: Simulation, layer: Layer, tool: HeldTool | null): void {
    const a = this.action;
    if (a !== null) this.describe(sim, a.kind, NULL_ENTITY, a.layer, a.tx, a.ty, tool);
    else {
      this.choose(sim, layer, tool, this.held ? this.explicit : null);
      const b = this.best;
      if (b.kind === 'none') this.clearFocus();
      else if (b.kind === 'use') this.describeUse(sim, b.use, b.layer, b.tx, b.ty);
      else this.describe(sim, b.kind, b.entity, b.layer, b.tx, b.ty, tool);
    }
  }

  /** Fills the focus with a target and its plan. */
  private describe(sim: Simulation, kind: FocusKind, entity: Entity, layer: Layer, tx: number, ty: number, tool: HeldTool | null): void {
    const f = this.focus;
    f.kind = kind;
    f.entity = entity;
    f.layer = layer;
    f.tx = tx;
    f.ty = ty;
    f.working = this.action !== null;
    f.dig = null;
    f.needs = null;
    f.tooWeak = false;
    if (kind === 'drop') {
      const d = this.drops.get(entity);
      if (d === undefined) {
        this.clearFocus();
        return;
      }
      f.x = d.x;
      f.y = d.y;
      f.action = 'aufheben';
      f.subject = d.stack.item;
      f.count = d.stack.count;
      f.block = this.roomFor(entity) === 0 ? 'bagsFull' : null;
      f.byHand = true;
      f.progress = 0;
      f.hitsDone = 0;
      f.hitsTotal = 0;
      return;
    }
    const plan = this.plan;
    const ok = kind === 'object' ? this.gathering.objectAt(layer, tx, ty, this.hit) && this.gathering.planObject(sim, this.hit, tool, plan) : this.gathering.planTile(sim, layer, tx, ty, tool, plan);
    if (!ok) {
      this.clearFocus();
      return;
    }
    f.x = plan.x;
    f.y = plan.y;
    f.action = plan.action;
    f.subject = plan.target;
    f.count = 1;
    f.block = plan.block === 'nothing' ? null : plan.block;
    f.needs = plan.needs;
    f.tooWeak = plan.tooWeak;
    f.dig = plan.dig;
    f.byHand = plan.byHand;
    const a = this.action;
    const hitsDone = kind === 'tile' ? (a === null ? 0 : this.tileHits(a.damage, tool)) : plan.hitsTotal - plan.hitsLeft;
    f.hitsDone = hitsDone;
    f.hitsTotal = plan.hitsTotal;
    f.progress = actionProgress(plan.byHand, a === null ? 0 : a.ticks, this.handTicks, hitsDone, plan.hitsTotal);
  }

  /** Fills the focus with the use target of provider `use` on tile (tx, ty). */
  private describeUse(sim: Simulation, use: number, layer: Layer, tx: number, ty: number): void {
    const o = this.useOffer;
    const provider = this.uses[use];
    if (provider === undefined || !provider.offer(sim, layer, tx, ty, o)) {
      this.clearFocus();
      return;
    }
    const f = this.focus;
    f.kind = 'use';
    f.entity = NULL_ENTITY;
    f.layer = layer;
    f.tx = tx;
    f.ty = ty;
    f.x = o.x;
    f.y = o.y;
    f.action = o.action;
    f.subject = o.subject;
    f.count = 1;
    f.block = o.block;
    f.needs = null;
    f.tooWeak = false;
    f.dig = null;
    f.working = false;
    f.byHand = true;
    f.progress = 0;
    f.hitsDone = 0;
    f.hitsTotal = 0;
  }

  /** Hits already dealt to a tile by `damage` [HP] with the held tool. */
  private tileHits(damage: number, tool: HeldTool | null): number {
    return tool === null || !(tool.power > 0) ? 0 : Math.round(damage / tool.power);
  }

  private isDone(layer: Layer, tx: number, ty: number): boolean {
    const d = this.done;
    return d !== null && d.layer === layer && d.tx === tx && d.ty === ty;
  }

  /** How many of the drop's items the bags can take (cached per bag revision). */
  private roomFor(e: Entity): number {
    const d = this.drops.get(e);
    if (d === undefined) return 0;
    const c = this.roomCache;
    const revision = this.inventory.bags.revision;
    if (c.revision === revision && c.entity === e && c.count === d.stack.count) return c.room;
    this.roomCache = { revision, entity: e, count: d.stack.count, room: this.inventory.roomFor(d.stack) };
    return this.roomCache.room;
  }

  // -------------------------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------------------------

  /** The tool in the hand: the selected hotbar item with tool data (`werkzeug`), or null. */
  heldTool(): HeldTool | null {
    const stack = this.inventory.selected();
    if (stack === null) return null;
    const def = this.inventory.bags.catalog.find(stack.item);
    if (def?.werkzeug === undefined) return null;
    return { kind: def.werkzeug.art, power: def.werkzeug.abbaukraft, broken: stack.haltbarkeit === 0 };
  }

  private handRef(): SlotRef {
    return { bereich: 'schnellleiste', index: this.inventory.state.auswahl };
  }

  /** Starts working the target in focus (E held, no action running); use targets only on a fresh press (`pressed`). */
  private start(sim: Simulation, layer: Layer, tool: HeldTool | null, pressed: boolean): void {
    this.choose(sim, layer, tool, this.explicit);
    const b = this.best;
    const tick = sim.eventTick;
    if (b.kind === 'none') {
      this.refuse(sim, 'nothingToInteract', tick);
      return;
    }
    if (b.kind === 'drop') {
      // A drop the bags cannot take is tried once per press: the inventory reports the full bags (§11.4 "klarer Hinweis").
      if (this.roomFor(b.entity) > 0 || !this.attempted) this.drops.pickUp(sim, b.entity);
      this.attempted = true;
      return;
    }
    if (b.kind === 'use') {
      // Never a side effect of E held on from a harvest: a fire is fed, a stump sat on only by pressing E at it.
      if (pressed && !this.attempted) this.use(sim, b.use, layer, b.tx, b.ty, tick);
      return;
    }
    const plan = this.plan;
    const ok = b.kind === 'object' ? this.gathering.objectAt(layer, b.tx, b.ty, this.hit) && this.gathering.planObject(sim, this.hit, tool, plan) : this.gathering.planTile(sim, layer, b.tx, b.ty, tool, plan);
    if (!ok) return;
    if (plan.block !== null) {
      if (plan.block !== 'nothing') this.refuse(sim, plan.block, tick);
      return;
    }
    this.attempted = true;
    this.action = { kind: b.kind === 'object' ? 'object' : 'tile', layer, tx: b.tx, ty: b.ty, target: plan.target, name: plan.action, byHand: plan.byHand, ticks: 0, damage: 0 };
    this.turnTo(sim, plan.x, plan.y);
    sim.events.push('actionStarted', { kind: this.action.kind, layer, tx: b.tx, ty: b.ty, target: plan.target, action: plan.action, byHand: plan.byHand, hitsNeeded: plan.hitsTotal, tick });
  }

  /** Uses a use target once; the press is spent (as if E were released), so holding E never uses the next thing. */
  private use(sim: Simulation, use: number, layer: Layer, tx: number, ty: number, tick: number): void {
    const provider = this.uses[use];
    const o = this.useOffer;
    if (provider === undefined || !provider.offer(sim, layer, tx, ty, o)) return;
    if (o.block !== null) this.refuse(sim, o.block, tick);
    else {
      this.attempted = true;
      this.turnTo(sim, o.x, o.y);
      provider.use(sim, layer, tx, ty, tick);
    }
    this.held = false;
    this.explicit = null;
    this.done = null;
  }

  /** A refused press is reported once per press. */
  private refuse(sim: Simulation, reason: InteractionRejectReason, tick: number): void {
    if (this.attempted) return;
    this.attempted = true;
    sim.events.push('commandRejected', { type: 'player.interact', reason, tick });
  }

  /** One tick of the running action. */
  private work(sim: Simulation, layer: Layer, tool: HeldTool | null): void {
    const a = this.action as Action;
    const plan = this.plan;
    if (a.layer !== layer) {
      this.stop(sim, 'gone');
      return;
    }
    let ok: boolean;
    let left: number;
    let top: number;
    let right: number;
    let bottom: number;
    if (a.kind === 'object') {
      ok = this.gathering.objectAt(layer, a.tx, a.ty, this.hit) && this.hit.tx === a.tx && this.hit.ty === a.ty && this.hit.rule?.id === a.target && this.gathering.planObject(sim, this.hit, tool, plan);
      const w = this.hit.rule?.footprintW ?? 1;
      const h = this.hit.rule?.footprintH ?? 1;
      left = a.tx * TILE_PX;
      right = left + w * TILE_PX;
      bottom = (a.ty + 1) * TILE_PX;
      top = bottom - h * TILE_PX;
    } else {
      ok = this.gathering.planTile(sim, layer, a.tx, a.ty, tool, plan) && plan.target === this.tileTarget(layer, a.tx, a.ty, a.target);
      left = a.tx * TILE_PX;
      right = left + TILE_PX;
      top = a.ty * TILE_PX;
      bottom = top + TILE_PX;
    }
    if (!ok) {
      this.stop(sim, 'gone');
      return;
    }
    if (plan.block !== null) {
      this.stop(sim, plan.block === 'toolBroken' ? 'toolBroken' : 'blocked');
      return;
    }
    if (distanceToRect(this.pos.x, this.pos.y, left, top, right, bottom) > REACH_PX) {
      this.stop(sim, 'outOfReach');
      return;
    }
    a.ticks++;
    const due = plan.byHand ? a.ticks >= this.handTicks : hitDue(a.ticks, this.hitTicks, this.swingTicks);
    if (!due) return;
    this.turnTo(sim, plan.x, plan.y);
    const outcome =
      a.kind === 'object'
        ? this.gathering.hitObject(sim, this.hit, plan, tool, this.pos.x, this.pos.y)
        : this.gathering.hitTile(sim, layer, a.tx, a.ty, plan, tool, a.damage, this.damageOut, this.pos.x, this.pos.y);
    if (a.kind === 'tile') a.damage = this.damageOut.value;
    if (outcome === 'invalid') {
      this.stop(sim, 'gone');
      return;
    }
    if (outcome === 'tooHard') {
      this.stop(sim, 'tooHard');
      return;
    }
    if (!plan.byHand && this.equipment.wear(sim, this.handRef(), H.toolWearPerHit) === 'broke' && outcome === 'hit') {
      this.stop(sim, 'toolBroken');
      return;
    }
    if (outcome === 'done') this.stop(sim, 'done');
  }

  /** The terrain id a tile action works on now (solid material first), or `fallback` when the chunk is gone. */
  private tileTarget(layer: Layer, tx: number, ty: number, fallback: string): string {
    const chunk = this.gathering.chunkOf(layer, tx, ty);
    if (chunk === undefined) return fallback;
    const i = ((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK);
    const solid = chunk.solid[i] as number;
    return this.gathering.rules.ids.terrain.stringId(solid !== 0 ? solid : (chunk.ground[i] as number));
  }

  private stop(sim: Simulation, reason: ActionStop): void {
    const a = this.action;
    if (a === null) return;
    this.action = null;
    if (reason === 'done' || reason === 'tooHard' || reason === 'toolBroken') this.done = { layer: a.layer, tx: a.tx, ty: a.ty };
    sim.events.push('actionStopped', { kind: a.kind, target: a.target, action: a.name, reason, tick: sim.eventTick });
  }

  /** Turns the player towards (x, y) (the tool clip faces the target). */
  private turnTo(sim: Simulation, x: number, y: number): void {
    const body = this.player.body(sim);
    if (body === undefined) return;
    body.facing = facingToward(x - this.pos.x, y - this.pos.y, body.facing);
  }
}
