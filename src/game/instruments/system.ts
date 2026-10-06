/**
 * Making music and the net (M7-31; MASTERPROMPT §11.4 "Musizieren", §12.3 "Musizieren (Flöte, Laute) −2/s im Umkreis", §14
 * "Netz (Insekten, Glühwürmchen …)"; docs/SPIEL.md §24).
 *
 * - **Playing** (`instrument.play {from, lied?}`, or the hand's use of an instrument through `player.useItem` – a second use
 *   stops): the flute or the lute in slot `from` plays a song of its `instrument.lieder` (the next one in turn without
 *   `lied`); `instrumentPlayed`, and the audio plays the song (src/audio/music). While it plays the player does nothing
 *   else and stands still (a motion hold); everyone within `BALANCE.instruments.radiusTiles` of the musician is calmed by
 *   music (the fear system's `music`, −2/s, `FearSystem.addSurroundings`). A step, a roll, a jump or deep water
 *   (`bewegung`), another action – a blow, eating, sitting, a swing, crafting, a throw (`handlung`) –, a hit (`treffer`),
 *   sleep, death or the instrument leaving its slot (`weg`) end it, and `instrument.stop` (`gestoppt`): `instrumentStopped`.
 * - **The net** (tool kind `netz`; `player.useItem` with the net in the hand): a swing over the aimed tile within
 *   `net.reachTiles` (else around the player). A firefly swarm (`gluehwuermchen`) hovering within `net.swarmRadiusTiles`
 *   gives one firefly into the bags – at most `net.firefliesPerSwarmPerNight` per swarm and night: the swarm thins but stays
 *   (its lights belong to the meadow). Without a swarm, a swing through grass may catch a cricket (`grille`, bait), more
 *   likely at night – drawn from a hash of the saved swing counter. Every swing wears the net by `net.wearPerSwing`; a worn
 *   out net is not swung. `netSwung` with the catch (or null).
 *
 * Global (no state in chunks; a swarm is a creature of the creature system, read only). Save participant `instruments`
 * (version 1, src/game/instruments/state.ts).
 */
import { BALANCE } from '../../content/balance';
import { CONTENT } from '../../content/index';
import type { ItemDef } from '../../content/schema/item';
import { NULL_ENTITY, isEntityHandle } from '../../engine/ecs';
import { nightOf } from '../../world/calendar';
import { CHUNK_SHIFT, TILE_PX, tileLocalIndex, type Layer } from '../../world/model/coords';
import { contentWorldIdTables } from '../../world/model/runtimeIds';
import type { ChunkSource } from '../../world/collision/chunkSource';
import type { CommandOfType, GameCommandType } from '../commands';
import type { CreatureSystem } from '../creatures/system';
import type { FearSurroundingsProvider } from '../fear/system';
import { isValidRef, slotAt, withSlot } from '../inventory/bags';
import type { InventorySystem } from '../inventory/system';
import { wornDurability } from '../items/formulas';
import type { SlotRef } from '../items/slots';
import type { SaveParticipant } from '../participant';
import type { MotionHold, PlayerSystem } from '../player/system';
import type { StepEvents } from '../observe';
import type { CommandHandlers, SimEventMap, SimSystem, Simulation } from '../sim';
import type { ItemUseContext, ItemUseHandler, ItemUseOutcome } from '../tools/itemUses';
import type { InstrumentRejectReason, InstrumentStopReason } from './events';
import { catchesCricket, nextSong, swarmGives } from './formulas';
import { copyInstrumentsState, createInstrumentsState, instrumentsStateSchema, type InstrumentsState } from './state';

/** Id of the instruments system and its save participant. */
export const INSTRUMENTS_SYSTEM_ID = 'instruments';
/** Data version of the `instruments` participant. */
export const INSTRUMENTS_SAVE_VERSION = 1;
/** The firefly creature and the items the net catches (docs/SPIEL.md §29). */
export const FIREFLY_CREATURE = 'gluehwuermchen';
export const FIREFLY_ITEM = 'gluehwuermchen';
export const CRICKET_ITEM = 'grille';

const I = BALANCE.instruments;
const RADIUS_PX = I.radiusTiles * TILE_PX;
const NET_REACH_PX = I.net.reachTiles * TILE_PX;
const SWARM_PX = I.net.swarmRadiusTiles * TILE_PX;
/** Footstep material of the ground crickets sit in (the meadow's grass, src/content/terrain.ts). */
const CRICKET_GROUND = 'gras';

/** Events of the step that end the music, and why (anything else the player does). */
const ENDING_EVENTS: ReadonlyArray<readonly [keyof SimEventMap, InstrumentStopReason]> = [
  ['playerDamaged', 'treffer'],
  ['attackStarted', 'handlung'],
  ['activityStarted', 'handlung'],
  ['actionStarted', 'handlung'],
  ['itemThrown', 'handlung'],
  ['craftStarted', 'handlung'],
  ['netSwung', 'handlung'],
  ['sleepStarted', 'schlaf'],
  ['playerDied', 'tod'],
];

/** Dependencies of the instruments system. */
export interface InstrumentsSystemDeps {
  readonly player: PlayerSystem;
  readonly inventory: InventorySystem;
  /** The creatures (firefly swarms for the net); without them the net catches only crickets. */
  readonly creatures?: Pick<CreatureSystem, 'store' | 'positionOf'> | null;
  /** The ground the crickets sit in (the chunks of the collision grid, read when swung); without it no crickets. */
  readonly collision?: { readonly chunks: ChunkSource } | null;
  /** Whether it is night (crickets are caught more easily; default: the world calendar's day phase). */
  readonly night?: (sim: Simulation) => boolean;
}

type Refusal = InstrumentRejectReason | null;

export class InstrumentsSystem implements SimSystem {
  readonly id = INSTRUMENTS_SYSTEM_ID;
  readonly timeScope = 'global' as const;
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;

  private readonly player: PlayerSystem;
  private readonly inventory: InventorySystem;
  private readonly creatures: Pick<CreatureSystem, 'store' | 'positionOf'> | null;
  private readonly collision: { readonly chunks: ChunkSource } | null;
  private readonly night: (sim: Simulation) => boolean;
  private stateValue: InstrumentsState = createInstrumentsState();
  private readonly pos = { x: 0, y: 0 };
  private readonly other = { x: 0, y: 0 };
  /** Terrain runtime ids crickets live in (grass). */
  private readonly cricketGround: ReadonlySet<number>;
  /** Why the step's events end the music (found in `observeStep`). */
  private ending: InstrumentStopReason | null = null;
  private readonly onEnding = new Map<keyof SimEventMap, () => void>();

  constructor(deps: InstrumentsSystemDeps) {
    this.player = deps.player;
    this.inventory = deps.inventory;
    this.creatures = deps.creatures ?? null;
    this.collision = deps.collision ?? null;
    this.night = deps.night ?? ((sim) => sim.world.calendar.dayPhase === 'nacht');
    const tables = contentWorldIdTables();
    const ground = new Set<number>();
    for (const t of CONTENT.collection('terrain').values()) if (t.footstep === CRICKET_GROUND) ground.add(tables.terrain.runtimeId(t.id));
    this.cricketGround = ground;
    for (const [type, reason] of ENDING_EVENTS) {
      this.onEnding.set(type, () => {
        this.ending ??= reason;
      });
    }
    this.commands = {
      'instrument.play': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.play(sim, cmd.from, cmd.lied ?? null, tick)),
      'instrument.stop': (sim, cmd, tick) => this.refuse(sim, cmd.type, tick, this.stateValue.spielt === null ? 'notPlaying' : (this.stop(sim, 'gestoppt', tick), null)),
    };
    this.save = {
      id: INSTRUMENTS_SYSTEM_ID,
      version: INSTRUMENTS_SAVE_VERSION,
      migrations: [{ from: 0, migrate: () => createInstrumentsState() }],
      serialize: () => copyInstrumentsState(this.stateValue),
      deserialize: (data) => {
        const parsed = instrumentsStateSchema.safeParse(data);
        if (!parsed.success) throw new TypeError(`instruments snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        this.stateValue = copyInstrumentsState(parsed.data);
      },
    };
  }

  /** The saved state (read only). */
  get state(): Readonly<InstrumentsState> {
    return this.stateValue;
  }

  /** Whether the player is making music (the presentation: music, figure clip). */
  isPlaying(): boolean {
    return this.stateValue.spielt !== null;
  }

  /** The instrument and song being played, or null (read only). */
  playing(): InstrumentsState['spielt'] {
    return this.stateValue.spielt;
  }

  /** The player stands still while making music (`PlayerSystem.addMotionHold`). */
  readonly holdsPlayer: MotionHold = () => this.stateValue.spielt !== null;

  /**
   * Music calms everyone within `radiusTiles` of the musician (`FearSystem.addSurroundings`). The fear system asks for the
   * player – the musician himself, always within the radius; settlers and companions (M9) ask with their own position
   * through `calmsAt`.
   */
  fearSurroundings(): FearSurroundingsProvider {
    return (sim, _player, out) => {
      if (this.calmsAt(sim, this.pos.x, this.pos.y, true)) out.music = true;
    };
  }

  /** Whether the music being played reaches (x, y) [px] (`atMusician`: the musician's own position). */
  calmsAt(sim: Simulation, x: number, y: number, atMusician = false): boolean {
    if (this.stateValue.spielt === null || !this.player.position(sim, this.other)) return false;
    if (atMusician) return true;
    const dx = x - this.other.x;
    const dy = y - this.other.y;
    return dx * dx + dy * dy <= RADIUS_PX * RADIUS_PX;
  }

  /** The item uses of the hand (`ToolsSystem.addItemUse`): instruments play or stop, the net swings. */
  itemUses(): readonly ItemUseHandler[] {
    return [
      { id: 'instrument', handles: (def) => def.instrument !== undefined, use: (sim, ctx) => this.useInstrument(sim, ctx) },
      { id: 'netz', handles: (def) => def.werkzeug?.art === 'netz', use: (sim, ctx) => this.swingNet(sim, ctx) },
    ];
  }

  update(sim: Simulation): void {
    const s = this.stateValue.spielt;
    if (s === null) return;
    const body = this.player.body(sim);
    const unable = this.player.incapacity(sim);
    let reason: InstrumentStopReason | null = null;
    if (body === undefined || unable === 'dead') reason = 'tod';
    else if (unable === 'asleep') reason = 'schlaf';
    else if (body.inputX !== 0 || body.inputY !== 0 || body.rollTicks > 0 || body.transit !== 'none' || body.swimming) reason = 'bewegung';
    else {
      const state = this.inventory.state;
      const held = isValidRef(state, s.from) ? slotAt(state, s.from) : null;
      if (held === null || held.item !== s.instrument) reason = 'weg';
    }
    if (reason !== null) this.stop(sim, reason, sim.eventTick);
  }

  /** Anything else the player did in this step ends the music. */
  observeStep(sim: Simulation, events: StepEvents): void {
    const s = this.stateValue.spielt;
    if (s === null) return;
    this.ending = null;
    for (const [type] of ENDING_EVENTS) events.forEachOfType(type, this.onEnding.get(type) as () => void);
    // The step that began the music may have pushed its own events (the hand's use): they do not end it.
    if (this.ending !== null && sim.eventTick > s.startTick) this.stop(sim, this.ending, sim.eventTick);
  }

  // -------------------------------------------------------------------------------------------

  private refuse(sim: Simulation, type: GameCommandType, tick: number, reason: Refusal): void {
    if (reason !== null) sim.events.push('commandRejected', { type, reason, tick });
  }

  private play(sim: Simulation, from: SlotRef, lied: string | null, tick: number): Refusal {
    const body = this.player.body(sim);
    if (sim.player === NULL_ENTITY || body === undefined || !this.player.position(sim, this.pos)) return 'noPlayer';
    const unable = this.player.incapacity(sim);
    if (unable !== null) return unable;
    if (this.player.stunned()) return 'stunned';
    if (body.swimming) return 'swimming';
    const state = this.inventory.state;
    if (!isValidRef(state, from)) return 'invalidSlot';
    const stack = slotAt(state, from);
    const def = stack === null ? undefined : this.inventory.bags.catalog.find(stack.item);
    if (stack === null || def?.instrument === undefined) return 'notAnInstrument';
    const songs = def.instrument.lieder;
    if (lied !== null && !songs.includes(lied)) return 'unknownSong';
    const song = lied ?? nextSong(songs, this.stateValue.gespielt);
    if (this.stateValue.spielt !== null) this.stop(sim, 'gestoppt', tick);
    this.stateValue.spielt = { instrument: stack.item, lied: song, startTick: tick, from: { ...from } };
    this.stateValue.gespielt++;
    sim.events.push('instrumentPlayed', { instrument: stack.item, lied: song, layer: body.layer, x: this.pos.x, y: this.pos.y, tick });
    return null;
  }

  private stop(sim: Simulation, grund: InstrumentStopReason, tick: number): void {
    const s = this.stateValue.spielt;
    if (s === null) return;
    this.stateValue.spielt = null;
    sim.events.push('instrumentStopped', { instrument: s.instrument, lied: s.lied, grund, tick });
  }

  /** The hand's use of an instrument: play it, or stop when it already plays. */
  private useInstrument(sim: Simulation, ctx: ItemUseContext): ItemUseOutcome {
    const s = this.stateValue.spielt;
    if (s !== null && s.instrument === ctx.stack.item) {
      this.stop(sim, 'gestoppt', ctx.tick);
      return 'used';
    }
    const reason = this.play(sim, ctx.slot, null, ctx.tick);
    return reason === null ? 'used' : { reject: reason };
  }

  /** A swing of the net (see module comment). */
  private swingNet(sim: Simulation, ctx: ItemUseContext): ItemUseOutcome {
    const body = this.player.body(sim);
    if (body === undefined || !this.player.position(sim, this.pos)) return { reject: 'noPlayer' };
    if (ctx.stack.haltbarkeit === 0) return { reject: 'notUsable' };
    // The swept point: the aimed tile within reach, else around the player.
    let x = this.pos.x;
    let y = this.pos.y;
    const t = ctx.target;
    if (t !== null && t.layer === body.layer) {
      const cx = t.tx * TILE_PX + TILE_PX / 2;
      const cy = t.ty * TILE_PX + TILE_PX / 2;
      const d2 = (cx - this.pos.x) ** 2 + (cy - this.pos.y) ** 2;
      if (d2 <= NET_REACH_PX * NET_REACH_PX) {
        x = cx;
        y = cy;
      } else if (ctx.named) return { reject: 'outOfReach' };
    }
    const layer = body.layer;
    const st = this.stateValue;
    const swing = st.netzZuege++;
    // Wear: one use per swing (§D).
    this.wear(sim, ctx.slot, ctx.def, ctx.tick);
    const clock = sim.clock;
    const night = nightOf(clock.day, clock.minuteOfDay / 60);
    let fang: string | null = null;
    const swarm = this.swarmNear(layer, x, y);
    if (swarm >= 0) {
      const entry = this.swarmEntry(swarm, night);
      if (swarmGives(entry.gefangen)) {
        entry.gefangen++;
        fang = FIREFLY_ITEM;
      }
    } else if (this.grassAt(layer, Math.floor(x / TILE_PX), Math.floor(y / TILE_PX)) && catchesCricket(sim.config.seed, swing, Math.floor(x / TILE_PX), Math.floor(y / TILE_PX), this.night(sim))) {
      fang = CRICKET_ITEM;
    }
    if (fang !== null) {
      const r = this.inventory.give(sim, fang, 1);
      if (r.added === 0) fang = null;
    }
    sim.events.push('netSwung', { fang, layer, x, y, tick: ctx.tick });
    return 'used';
  }

  /** Wears the net in `ref` by one swing; a net worn out raises `itemBroken`. */
  private wear(sim: Simulation, ref: SlotRef, def: ItemDef, tick: number): void {
    const state = this.inventory.state;
    const stack = slotAt(state, ref);
    if (stack === null || stack.haltbarkeit === undefined || def.haltbarkeit === undefined) return;
    const left = wornDurability(stack.haltbarkeit, I.net.wearPerSwing);
    this.inventory.bags.replace(withSlot(state, ref, { ...stack, haltbarkeit: left }));
    if (left === 0) sim.events.push('itemBroken', { at: { ...ref }, item: stack.item, tick });
  }

  /** Serial number of the living firefly swarm nearest to (x, y) within `swarmRadiusTiles`, or −1. */
  private swarmNear(layer: Layer, x: number, y: number): number {
    const c = this.creatures;
    if (c === null) return -1;
    const store = c.store;
    let best = SWARM_PX * SWARM_PX;
    let serial = -1;
    for (let i = 0; i < store.size; i++) {
      const s = store.valueAt(i);
      if (s.creature !== FIREFLY_CREATURE || s.layer !== layer || s.health <= 0) continue;
      const e = store.entityAt(i);
      if (!isEntityHandle(e) || !c.positionOf(e, this.other)) continue;
      const d2 = (this.other.x - x) ** 2 + (this.other.y - y) ** 2;
      if (d2 <= best) {
        best = d2;
        serial = s.serial;
      }
    }
    return serial;
  }

  /** The catch record of swarm `serial` in night `night` (made, and the oldest dropped, as needed). */
  private swarmEntry(serial: number, night: number): InstrumentsState['schwaerme'][number] {
    const list = this.stateValue.schwaerme;
    for (const w of list) if (w.serial === serial && w.nacht === night) return w;
    // Earlier nights are forgotten: a swarm gives again the next night.
    for (let i = list.length - 1; i >= 0; i--) if ((list[i] as InstrumentsState['schwaerme'][number]).nacht !== night) list.splice(i, 1);
    if (list.length >= I.maxRememberedSwarms) list.shift();
    const entry = { serial, nacht: night, gefangen: 0 };
    list.push(entry);
    return entry;
  }

  /** Whether tile (tx, ty) of `layer` is grass (a resident chunk). */
  private grassAt(layer: Layer, tx: number, ty: number): boolean {
    const chunk = this.collision?.chunks.get(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    if (chunk === undefined) return false;
    return this.cricketGround.has(chunk.ground[tileLocalIndex(tx, ty)] as number);
  }
}

/** Commands this system handles (for the console's documentation). */
export type InstrumentCommand = CommandOfType<'instrument.play'> | CommandOfType<'instrument.stop'>;
