/**
 * The player's figure in the game view (M3-08; docs/SPIEL.md §5): the body `spieler_basis` with the
 * clip of what the player does and faces (`<aktion>_<richtung>`, M3-05, M3-06), the clothing as overlay
 * layers and the items in the hands on the body's hand sockets (`../anim/figure.ts`, M3-07).
 *
 * - **Action** (`figureAction`), most important first: dead → `death` (once, then lying); asleep →
 *   `sleep`; rolling, swimming, jumping, climbing → their movement clip; eating, drinking, sitting →
 *   `eat`, `drink`, `sit`; working a target with a tool → `tool` (the swing's hit frame meets the
 *   simulation's hit: both start with the action and run 0,5 s per swing, the first hit after ⅓ s – the
 *   one-shot clip restarts with every swing); a
 *   fresh hit → `hit` (2 frames); otherwise the clip of the movement mode, in order of preference idle →
 *   `idle`; walk → `walk`; sprint → `run`, `walk`; sneak → `sneak`, `walk` – each chain ends in `idle`.
 *   An action the atlas lacks shows the movement clip (`clipAction` tells which one is drawn).
 * - **Torch in the off hand** (§12.2): with a carried light in the hand the body uses the `<aktion>_licht`
 *   clips where they exist (the arm holds the torch still beside the head, in front of the face in
 *   profile) and the off hand carries `ausruestung_<item>` – burning – or `ausruestung_<item>_aus` while
 *   it is put out. On the belt (shield or two-hander) the hand stays free.
 * - **Main hand**: the selected hotbar item when it is drawn on the figure (tools, weapons: layer
 *   `waffe`, sprite `ausruestung_<item>`); its `tool_<richtung>` clips swing with the body.
 * - **Hidden hands**: nothing in the hands while rolling, swimming, asleep or dead; the main hand is empty
 *   while eating or drinking (the hand is at the mouth).
 * - **Clothing**: worn armour (`ausruestung_<item>` on the head, body and legs layers); a layer nobody
 *   wears shows the shipwrecked's own clothes (`ausruestung_leinentunika`, `ausruestung_leinenhose`, §8)
 *   – `setClothing` replaces those.
 * - **Clock**: movement clips run with the mode's time, scaled by the ground speed the clip was drawn for
 *   (a walk clip under a sprint runs faster, under sneaking slower); roll, jump and climb play once over
 *   their progress; every other action runs from the frame it began.
 * - **Conditions** (M3-20, `conditionLook.ts`): shivering jitters the figure a pixel and turns it pale blue,
 *   a broken bone makes it limp (slow bad-leg step, a pixel dip), a tipsy one sways; poison, nausea, fever
 *   and shock tint the complexion.
 * - **Height**: the terrain level under the feet (a jump sinks from the plateau to the landing).
 * - **Hit flash**: two frames white after every `playerDamaged` event (§6.2 "2-Frame-Trefferblitz").
 * - **Frame events** of the body clip (`schritt`, `abrollen`, `zug`, `treffer`, `biss`, `schluck` …) go to
 *   `onClipEvent` as the frames are entered, with the loop of the clip they belong to (the audio kernel's
 *   clip sounds, src/audio/clipEvents.ts).
 * Reads the session only (samples, events and the simulation's systems); allocates nothing per frame (the
 * rig of a loadout is built once per atlas manifest).
 */
import { BALANCE } from '../../content/balance';
import { PLAYER_MOVE_STATES, type PlayerMoveState } from '../../content/balance/player';
import { itemFigureLayer, itemLayerSpriteId } from '../../content/items/index';
import { ActionsSystem } from '../../game/actions/system';
import { ConditionsSystem } from '../../game/conditions/system';
import { DeathSystem } from '../../game/death/system';
import { EquipmentSystem } from '../../game/equipment/system';
import { InteractionSystem } from '../../game/interaction/system';
import { InventorySystem } from '../../game/inventory/system';
import { LightSystem } from '../../game/light/system';
import { createPlayerSample, type GameSession, type PlayerSample } from '../../game/session';
import type { Simulation } from '../../game/sim';
import { SleepSystem } from '../../game/sleep/system';
import { WAND_PX_JE_STUFE } from '../../world/autotile';
import { ClipEventCursor, clipDuration, DIRECTIONS, validateDirectional, type AnimationClip, type Direction } from '../anim/animation';
import { defaultFigureState, FigureRig, HAND_SLOTS_MASK, slotBit, type EquipmentSlot, type FigureLayerDef } from '../anim/figure';
import type { AtlasData, AtlasManifest, AtlasSprite } from '../assets/atlas';
import type { RenderScene } from '../scene';
import { createConditionLook, figureTint, limpDip, limpTime, sampleConditionLook, shiverOffset, swayOffset, type ConditionLook } from './conditionLook';

/** Body of the player with every movement and action clip (M3-05, M3-06). */
export const PLAYER_BODY_SPRITE = 'spieler_basis';
/** The dressed idle figure (M1-22): the body while the atlas has no `spieler_basis`. */
export const PLAYER_DRESSED_SPRITE = 'spieler_koerper';
/** Suffix of the body clips with a light in the off hand (`idle_licht_down`, M3-07). */
export const LIGHT_CLIP_SUFFIX = '_licht';
/** Suffix of an off-hand light's sprite while it is put out (`ausruestung_fackel_aus`). */
export const LIGHT_OUT_SUFFIX = '_aus';

/** A piece of clothing drawn as an overlay layer of the body (same frame index). */
export interface ClothingLayer {
  readonly slot: EquipmentSlot;
  /** Sprite id (`ausruestung_<itemId>`, docs/SPIEL.md §5). */
  readonly sprite: string;
}

/** The shipwrecked's own clothes (§8): linen tunic and trousers of the start figure. */
export const START_CLOTHING: readonly ClothingLayer[] = [
  { slot: 'koerper', sprite: 'ausruestung_leinentunika' },
  { slot: 'beine', sprite: 'ausruestung_leinenhose' },
];

/** Clip actions per movement mode, most specific first (docs/SPIEL.md §5; M3-05 names walk, run, roll, swim). */
export const PLAYER_CLIP_CHAIN: Readonly<Record<PlayerMoveState, readonly string[]>> = {
  idle: ['idle'],
  walk: ['walk', 'idle'],
  sprint: ['run', 'walk', 'idle'],
  sneak: ['sneak', 'walk', 'idle'],
  roll: ['roll', 'idle'],
  swim: ['swim', 'idle'],
  jump: ['jump', 'idle'],
  climb: ['climb', 'idle'],
};

/** What the player does besides moving (§11.4 "Aktionen"), read from the simulation (`samplePlayerPose`). */
export const FIGURE_ACTIVITIES = ['none', 'tool', 'eat', 'drink', 'sit', 'sleep', 'death'] as const;
/** One activity. */
export type FigureActivity = (typeof FIGURE_ACTIVITIES)[number];

/** Body clip action of each activity (M3-06). */
export const ACTIVITY_ACTION: Readonly<Record<Exclude<FigureActivity, 'none'>, string>> = {
  tool: 'tool',
  eat: 'eat',
  drink: 'drink',
  sit: 'sit',
  sleep: 'sleep',
  death: 'death',
};
/** Body clip action of a fresh hit (§4.5 "Treffer 2"). */
export const HIT_ACTION = 'hit';

/** Every action a figure may show. */
const BASE_ACTIONS: readonly string[] = [...new Set([...PLAYER_MOVE_STATES.flatMap((s) => PLAYER_CLIP_CHAIN[s]), ...Object.values(ACTIVITY_ACTION), HIT_ACTION])];
/** The light variant of every action (built once: the frame path concatenates nothing). */
const LIGHT_VARIANT: ReadonlyMap<string, string> = new Map(BASE_ACTIONS.map((a) => [a, `${a}${LIGHT_CLIP_SUFFIX}`]));
const CLIP_ACTIONS: readonly string[] = [...BASE_ACTIONS, ...LIGHT_VARIANT.values()];

const M = BALANCE.player.movement;
/** Ground speed each looping movement clip is drawn for [tiles/s] (the clip's steps match the ground at this speed). */
const CLIP_GROUND_SPEED: Readonly<Record<string, number>> = { walk: M.walkTilesPerSecond, run: M.sprintTilesPerSecond, sneak: M.sneakTilesPerSecond, swim: M.swimTilesPerSecond };
/** Nominal speed of each movement mode [tiles/s] (0: the mode does not steer). */
const MODE_SPEED: Readonly<Record<PlayerMoveState, number>> = {
  idle: 0,
  walk: M.walkTilesPerSecond,
  sprint: M.sprintTilesPerSecond,
  sneak: M.sneakTilesPerSecond,
  roll: 0,
  swim: M.swimTilesPerSecond,
  jump: 0,
  climb: 0,
};
/** Modes whose clip plays once over the action's progress. */
const ONE_SHOT: ReadonlySet<PlayerMoveState> = new Set<PlayerMoveState>(['roll', 'jump', 'climb']);
/** Modes that own the body whatever the player does (the action cannot show during them). */
const BODY_MODES: ReadonlySet<PlayerMoveState> = new Set<PlayerMoveState>(['roll', 'swim', 'jump', 'climb']);
/** Modes in which the hands hold nothing. */
const EMPTY_HAND_MODES: ReadonlySet<PlayerMoveState> = new Set<PlayerMoveState>(['roll', 'swim']);
/** Activities in which the hands hold nothing, and in which only the main hand is empty. */
const EMPTY_HAND_ACTIVITIES: ReadonlySet<FigureActivity> = new Set<FigureActivity>(['sleep', 'death']);
const EMPTY_MAIN_HAND_ACTIVITIES: ReadonlySet<FigureActivity> = new Set<FigureActivity>(['eat', 'drink']);
/**
 * One swing of a tool [s] (§D; the simulation's hit rhythm `BALANCE.harvest`): the one-shot `tool` clip
 * (0,5 s, hit frame after ⅓ s) restarts with every swing.
 */
export const TOOL_SWING_SECONDS = BALANCE.harvest.toolSwingSeconds;
/** Walking clips that limp with a broken bone. */
const LIMPING: ReadonlySet<string> = new Set(['walk', 'run', 'sneak', 'walk_licht', 'run_licht', 'sneak_licht']);
/**
 * Duration of the hit flash [s]: two frames at 60 Hz (§6.2 "2-Frame-Trefferblitz") – the frame of the hit
 * and the next; the half tick of margin keeps the third frame out despite the rounding of the clock.
 */
export const HIT_FLASH_SECONDS = 1.5 / BALANCE.time.tickHz;

/** Actions of `sprite` that the rig can show in every direction (own clips, or mirrored ones of a symmetric figure). */
export function figureActions(sprite: AtlasSprite, symmetric: boolean): string[] {
  return CLIP_ACTIONS.filter((action) => {
    const clips: Partial<Record<Direction, AnimationClip>> = {};
    for (const d of DIRECTIONS) {
      const c = sprite.clips[`${action}_${d}`];
      if (c !== undefined) clips[d] = c;
    }
    try {
      validateDirectional({ name: `${sprite.id}.${action}`, symmetric, clips }, 'figure');
      return true;
    } catch {
      return false;
    }
  });
}

/** The action shown for a mode: the first of its chain the figure has. */
export function playerAction(state: PlayerMoveState, available: ReadonlySet<string>): string {
  for (const action of PLAYER_CLIP_CHAIN[state]) if (available.has(action)) return action;
  throw new Error(`Spielerfigur: kein Clip für ${state} (auch nicht idle)`);
}

/**
 * The body action for movement mode `state`, activity `activity`, a fresh hit (`hit`) and a light in the
 * off hand (`withLight`) – see the module comment for the order. `byState` is the movement action per
 * mode, `available` the actions the figure has.
 */
export function figureAction(state: PlayerMoveState, activity: FigureActivity, hit: boolean, withLight: boolean, byState: Readonly<Record<PlayerMoveState, string>>, available: ReadonlySet<string>): string {
  let action = byState[state];
  if (activity === 'death' || activity === 'sleep') action = ACTIVITY_ACTION[activity];
  else if (BODY_MODES.has(state)) action = byState[state];
  else if (activity !== 'none') action = ACTIVITY_ACTION[activity];
  else if (hit) action = HIT_ACTION;
  if (!available.has(action)) action = byState[state];
  if (withLight) {
    const lit = LIGHT_VARIANT.get(action);
    if (lit !== undefined && available.has(lit)) return lit;
  }
  return action;
}

/** Slots hidden for mode `state` and activity `activity` (bits of `slotBit`). */
export function hiddenSlots(state: PlayerMoveState, activity: FigureActivity): number {
  if (EMPTY_HAND_MODES.has(state) || EMPTY_HAND_ACTIVITIES.has(activity)) return HAND_SLOTS_MASK;
  return EMPTY_MAIN_HAND_ACTIVITIES.has(activity) ? slotBit('waffe') : 0;
}

/** What the figure holds, wears and does besides moving (sampled once per frame by `samplePlayerPose`). */
export interface PlayerPose {
  activity: FigureActivity;
  /** Item in the main hand drawn on the figure (layer `waffe`), or null. */
  hand: string | null;
  /** Light item in the off hand (§12.2), or null (none, or on the belt). */
  offhand: string | null;
  /** Whether that light burns. */
  offhandLit: boolean;
  /** Worn pieces drawn on the head, body and legs layers (item ids), or null. */
  kopf: string | null;
  koerper: string | null;
  beine: string | null;
  /** Visible effects of the active conditions (M3-20). */
  readonly look: ConditionLook;
}

/** A fresh pose: nothing held, nothing done. */
export function createPlayerPose(): PlayerPose {
  return { activity: 'none', hand: null, offhand: null, offhandLit: false, kopf: null, koerper: null, beine: null, look: createConditionLook() };
}

/** The systems a pose is read from (looked up once per simulation). */
interface PoseSystems {
  readonly sim: Simulation;
  readonly inventory: InventorySystem | null;
  readonly equipment: EquipmentSystem | null;
  readonly light: LightSystem | null;
  readonly actions: ActionsSystem | null;
  readonly sleep: SleepSystem | null;
  readonly death: DeathSystem | null;
  readonly interaction: InteractionSystem | null;
  readonly conditions: ConditionsSystem | null;
}

function systemOf<T>(sim: Simulation, id: string, type: abstract new (...args: never[]) => T): T | null {
  const s = sim.systems.find((x) => x.id === id);
  return s instanceof type ? s : null;
}

/** Figure layer of each worn equipment slot drawn on the figure (§4.5 "Kopf, Körper, Beine"). */
const WORN_LAYERS = [
  ['kopf', 'kopf'],
  ['brust', 'koerper'],
  ['beine', 'beine'],
  ['fuesse', 'beine'],
] as const;

/**
 * Reads what the player holds, wears and does from the simulation's systems (read only). Systems a
 * simulation lacks count as idle. Returns `out`.
 */
export class PlayerPoseReader {
  private systems: PoseSystems | null = null;

  sample(sim: Simulation, out: PlayerPose): PlayerPose {
    const s = this.systemsOf(sim);
    out.activity = 'none';
    out.hand = null;
    out.offhand = null;
    out.offhandLit = false;
    out.kopf = null;
    out.koerper = null;
    out.beine = null;
    if (s.death?.dead === true) out.activity = 'death';
    else if (s.sleep?.asleep === true) out.activity = 'sleep';
    else {
      const a = s.actions?.state ?? null;
      if (a !== null && a.consumption !== null) out.activity = a.consumption.kind === 'essen' ? 'eat' : 'drink';
      else if (a !== null && a.seat !== null) out.activity = 'sit';
      else if (s.interaction !== null && s.interaction.working && !s.interaction.focus.byHand) out.activity = 'tool';
    }
    if (s.inventory !== null) {
      const held = s.inventory.selected();
      const def = held === null ? undefined : s.inventory.bags.catalog.find(held.item);
      if (held !== null && def !== undefined && itemFigureLayer(def) === 'waffe') out.hand = held.item;
      if (s.equipment !== null) {
        for (const [slot, layer] of WORN_LAYERS) {
          const worn = s.equipment.worn(slot);
          if (worn === null || out[layer] !== null) continue;
          const wornDef = s.inventory.bags.catalog.find(worn.item);
          if (wornDef !== undefined && itemFigureLayer(wornDef) === layer) out[layer] = worn.item;
        }
      }
    }
    const carried = s.light?.carried ?? null;
    if (carried !== null && carried.mode === 'hand') {
      out.offhand = carried.item;
      out.offhandLit = carried.burn.lit;
    }
    const active = s.conditions?.active() ?? [];
    sampleConditionLook(active, active.length, out.look);
    return out;
  }

  private systemsOf(sim: Simulation): PoseSystems {
    if (this.systems?.sim === sim) return this.systems;
    this.systems = {
      sim,
      inventory: systemOf(sim, 'inventory', InventorySystem),
      equipment: systemOf(sim, 'equipment', EquipmentSystem),
      light: systemOf(sim, 'light', LightSystem),
      actions: systemOf(sim, 'actions', ActionsSystem),
      sleep: systemOf(sim, 'sleep', SleepSystem),
      death: systemOf(sim, 'death', DeathSystem),
      interaction: systemOf(sim, 'interaction', InteractionSystem),
      conditions: systemOf(sim, 'conditions', ConditionsSystem),
    };
    return this.systems;
  }
}

/** Items held in the hands of a rig (sprite ids; null = empty). */
export interface HeldLayers {
  readonly hand?: string | null;
  readonly offhand?: string | null;
  readonly load?: string | null;
}

/** A built figure: rig, body and the action shown per mode. */
export interface PlayerFigureRig {
  readonly rig: FigureRig;
  readonly body: AtlasSprite;
  /** Clothing layers the rig draws. */
  readonly clothing: readonly string[];
  /** Sprites in the hands the rig draws (main hand, off hand, load). */
  readonly held: readonly string[];
  /** The action per mode (resolved once). */
  readonly byState: Readonly<Record<PlayerMoveState, string>>;
  /** Actions the body has in every direction. */
  readonly available: ReadonlySet<string>;
  /** Duration of the mode's clip per facing [s] (one-shot modes play over their progress). */
  readonly durations: Readonly<Record<PlayerMoveState, Readonly<Record<Direction, number>>>>;
  /** Duration of every available action's clip per facing [s] (the limp's walk cycle). */
  readonly actionDurations: ReadonlyMap<string, Readonly<Record<Direction, number>>>;
}

const HELD_SLOTS = [
  ['hand', 'waffe'],
  ['offhand', 'nebenhand'],
  ['load', 'last'],
] as const;

/**
 * Builds the player's rig from an atlas: `spieler_basis` with clothing and the held items, else the
 * dressed idle figure; null without either. Clothing whose sprite is missing or has the wrong frame
 * count, and held items without a sprite, are left out.
 */
export function buildPlayerFigure(manifest: AtlasManifest, clothing: readonly ClothingLayer[], held: HeldLayers = {}): PlayerFigureRig | null {
  const basis = manifest.sprites[PLAYER_BODY_SPRITE];
  const layers: FigureLayerDef[] = [];
  let body: AtlasSprite | undefined = basis;
  if (basis !== undefined) {
    for (const c of clothing) {
      const sprite = manifest.sprites[c.sprite];
      if (sprite === undefined) continue;
      const overlay = c.slot === 'koerper' || c.slot === 'beine';
      if (!overlay || sprite.frames.length === basis.frames.length) layers.push({ slot: c.slot, sprite });
    }
    for (const [key, slot] of HELD_SLOTS) {
      const id = held[key] ?? null;
      const sprite = id === null ? undefined : manifest.sprites[id];
      if (sprite !== undefined && basis.sockets[slot === 'waffe' ? 'hand' : slot] !== undefined) layers.push({ slot, sprite });
    }
  } else body = manifest.sprites[PLAYER_DRESSED_SPRITE];
  if (body === undefined) return null;
  const symmetric = body.symmetric && layers.every((l) => l.sprite.symmetric);
  const actions = figureActions(body, symmetric);
  if (!actions.includes('idle')) throw new Error(`Spielerfigur: ${body.id} hat keine Idle-Clips in allen Richtungen`);
  const available = new Set(actions);
  const byState = Object.fromEntries(PLAYER_MOVE_STATES.map((s) => [s, playerAction(s, available)])) as Record<PlayerMoveState, string>;
  const durationsOf = (action: string): Record<Direction, number> => Object.fromEntries(DIRECTIONS.map((d) => [d, clipDuration(clipOf(body, action, d))])) as Record<Direction, number>;
  const durations = Object.fromEntries(PLAYER_MOVE_STATES.map((s) => [s, durationsOf(byState[s])])) as Record<PlayerMoveState, Record<Direction, number>>;
  const actionDurations = new Map(actions.map((a) => [a, durationsOf(a)]));
  const clothingIds = layers.filter((l) => l.slot === 'kopf' || l.slot === 'koerper' || l.slot === 'beine').map((l) => l.sprite.id);
  const heldIds = layers.filter((l) => l.slot === 'waffe' || l.slot === 'nebenhand' || l.slot === 'last').map((l) => l.sprite.id);
  return { rig: new FigureRig(body, actions, layers), body, clothing: clothingIds, held: heldIds, byState, available, durations, actionDurations };
}

/** The body clip of `action` towards `facing` (the mirrored side for a symmetric figure). */
function clipOf(body: AtlasSprite, action: string, facing: Direction): AnimationClip {
  const own = body.clips[`${action}_${facing}`];
  if (own !== undefined) return own;
  const other = body.clips[`${action}_${facing === 'left' ? 'right' : 'left'}`];
  if (other === undefined) throw new Error(`Spielerfigur: ${body.id} hat keinen Clip ${action}_${facing}`);
  return other;
}

/** Receives a frame event of the body clip at world px (x, y) on `layer`, in loop `cycle` of the clip (0 = first pass). */
export type FigureClipEventSink = (event: string, x: number, y: number, layer: number, cycle: number) => void;

/** What the figure drew last (the view's particles and post effects follow it). */
export interface FigureDrawn {
  /** Where the body stands after the condition offsets [world px]. */
  x: number;
  y: number;
  heightBase: number;
}

/** Places the player's figure into the scene (see module comment). */
export class PlayerFigure {
  private readonly sample: PlayerSample = createPlayerSample();
  private readonly figureState = defaultFigureState();
  private readonly poseValue: PlayerPose = createPlayerPose();
  private readonly poses = new PlayerPoseReader();
  private clothing: readonly ClothingLayer[] = START_CLOTHING;
  private manifest: AtlasManifest | null = null;
  private built: PlayerFigureRig | null = null;
  /** Rigs by loadout key (built once per atlas manifest and loadout). */
  private readonly rigs = new Map<string, PlayerFigureRig | null>();
  private loadHand: string | null = null;
  private loadOff: string | null = null;
  private loadKopf: string | null = null;
  private loadKoerper: string | null = null;
  private loadBeine: string | null = null;
  private loadValid = false;
  private subscribedTo: Pick<GameSession, 'onEvent'> | null = null;
  private unsubscribe: (() => void) | null = null;
  private hitPending = false;
  private hitAt = Number.NEGATIVE_INFINITY;
  private lastAction = '';
  private lastFlash = false;
  /** The pose's activity of the last frame and when it began [presentation s]. */
  private activityShown: FigureActivity | 'hit' = 'none';
  private activitySince = 0;
  private readonly events = new ClipEventCursor();
  private readonly tint = { color: 0, strength: 0 };
  private eventSink: FigureClipEventSink | null = null;
  private readonly forward = (name: string, _position: number, cycle: number): void => {
    const f = this.figureState;
    this.eventSink?.(name, f.x, f.y, this.sample.layer, cycle);
  };
  /** Where the figure was drawn last. */
  readonly drawn: FigureDrawn = { x: 0, y: 0, heightBase: 0 };

  /** Action of the clip drawn last (e.g. `idle` while the art of a mode is missing). */
  get clipAction(): string {
    return this.lastAction;
  }

  /** Whether the figure drawn last flashed white (hit feedback). */
  get flashing(): boolean {
    return this.lastFlash;
  }

  /** The last sample (valid after a `place` that returned true). */
  get lastSample(): Readonly<PlayerSample> {
    return this.sample;
  }

  /** What the player held, wore and did in the last frame drawn. */
  get pose(): Readonly<PlayerPose> {
    return this.poseValue;
  }

  /** The rig in use (null before the atlas is there). */
  get figure(): PlayerFigureRig | null {
    return this.built;
  }

  /** The shipwrecked's clothes, drawn on every layer no worn piece covers. */
  setClothing(layers: readonly ClothingLayer[]): void {
    this.clothing = layers;
    this.manifest = null;
  }

  /** Receives the frame events of the body clip (`null` stops). */
  onClipEvent(sink: FigureClipEventSink | null): void {
    this.eventSink = sink;
  }

  /**
   * Draws the player at (x, y) world px (the interpolated focus of the view) for presentation time
   * `time`. Returns false – drawing nothing – while the session has no player or the atlas no figure.
   */
  place(scene: RenderScene, atlas: AtlasData, session: Pick<GameSession, 'samplePlayer' | 'onEvent'> & Partial<Pick<GameSession, 'sim'>>, time: number, x: number, y: number): boolean {
    this.follow(session);
    const s = this.sample;
    if (!session.samplePlayer(s)) return false;
    const pose = this.poseValue;
    if (session.sim !== undefined) this.poses.sample(session.sim, pose);
    const built = this.figureFor(atlas.manifest, pose);
    if (built === null) return false;
    if (this.hitPending) {
      this.hitPending = false;
      this.hitAt = time;
    }
    const hitDuration = built.actionDurations.get(HIT_ACTION)?.[s.facing] ?? 0;
    const hit = time >= this.hitAt && time - this.hitAt < hitDuration;
    const withLight = pose.offhand !== null;
    const action = figureAction(s.state, pose.activity, hit, withLight, built.byState, built.available);
    // Which clock the body runs on: the movement mode's, or the time since the activity (or hit) began.
    let shown: FigureActivity | 'hit';
    if (pose.activity === 'death' || pose.activity === 'sleep') shown = pose.activity;
    else if (BODY_MODES.has(s.state)) shown = 'none';
    else if (pose.activity !== 'none') shown = pose.activity;
    else shown = hit ? 'hit' : 'none';
    const moving = shown === 'none';
    if (shown !== this.activityShown) {
      this.activityShown = shown;
      this.activitySince = shown === 'hit' ? this.hitAt : time;
    }
    this.lastAction = action;
    const f = this.figureState;
    if (!moving) {
      f.time = Math.max(0, time - this.activitySince);
      // A tool swings again and again while the target is worked: its one-shot clip restarts with every swing of the simulation.
      if (shown === 'tool') f.time %= TOOL_SWING_SECONDS;
    }
    else if (ONE_SHOT.has(s.state) && action !== 'idle') f.time = s.actionProgress * built.durations[s.state][s.facing];
    else {
      const base = built.byState[s.state];
      const drawnFor = CLIP_GROUND_SPEED[base];
      f.time = drawnFor === undefined ? s.stateSeconds : (s.stateSeconds * MODE_SPEED[s.state]) / drawnFor;
    }
    const look = pose.look;
    let dip = 0;
    if (look.limp && LIMPING.has(action)) {
      const cycle = built.actionDurations.get(action)?.[s.facing] ?? 0;
      dip = limpDip(f.time, cycle);
      f.time = limpTime(f.time, cycle);
    }
    f.x = x + shiverOffset(look.shiver, time) + (look.sway ? swayOffset(time) : 0);
    f.y = y + dip;
    f.direction = s.facing;
    f.action = action;
    f.itemTime = time;
    f.hidden = hiddenSlots(s.state, pose.activity);
    figureTint(look, time, this.tint);
    f.tint = this.tint.color;
    f.tintStrength = this.tint.strength;
    const level = s.transitFromLevel === s.transitToLevel ? s.level : s.transitFromLevel + (s.transitToLevel - s.transitFromLevel) * s.actionProgress;
    f.heightBase = level * WAND_PX_JE_STUFE;
    f.flash = time - this.hitAt < HIT_FLASH_SECONDS && time >= this.hitAt;
    this.lastFlash = f.flash;
    built.rig.emit(scene.sprites, scene.sprite, f);
    this.drawn.x = f.x;
    this.drawn.y = f.y;
    this.drawn.heightBase = f.heightBase;
    const clip = built.rig.bodyClip(action, s.facing);
    if (clip !== null && this.eventSink !== null) this.events.update(clip, f.time, this.forward);
    return true;
  }

  /** Stops listening to the session's events. */
  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.subscribedTo = null;
    this.events.reset();
  }

  /** Listens to the damage events of `session` (re-subscribes when the view gets another session). */
  private follow(session: Pick<GameSession, 'onEvent'>): void {
    if (this.subscribedTo === session) return;
    this.dispose();
    this.subscribedTo = session;
    this.unsubscribe = session.onEvent('playerDamaged', () => {
      this.hitPending = true;
    });
  }

  /** The rig of the pose's loadout (built once per manifest and loadout). */
  private figureFor(manifest: AtlasManifest, pose: PlayerPose): PlayerFigureRig | null {
    if (this.manifest !== manifest) {
      this.manifest = manifest;
      this.rigs.clear();
      this.loadValid = false;
    }
    if (this.loadValid && pose.hand === this.loadHand && this.offSprite(pose) === this.loadOff && pose.kopf === this.loadKopf && pose.koerper === this.loadKoerper && pose.beine === this.loadBeine) return this.built;
    this.loadHand = pose.hand;
    this.loadOff = this.offSprite(pose);
    this.loadKopf = pose.kopf;
    this.loadKoerper = pose.koerper;
    this.loadBeine = pose.beine;
    this.loadValid = true;
    const clothing = this.clothingFor(pose);
    const held: HeldLayers = { hand: pose.hand === null ? null : itemLayerSpriteId(pose.hand), offhand: this.loadOff };
    const key = `${clothing.map((c) => `${c.slot}:${c.sprite}`).join(',')}|${held.hand ?? ''}|${held.offhand ?? ''}`;
    let rig = this.rigs.get(key);
    if (rig === undefined) {
      rig = buildPlayerFigure(manifest, clothing, held);
      this.rigs.set(key, rig);
    }
    this.built = rig;
    return rig;
  }

  /** Sprite of the off-hand light: burning, or its put-out form. */
  private offSprite(pose: PlayerPose): string | null {
    if (pose.offhand === null) return null;
    const id = itemLayerSpriteId(pose.offhand);
    return pose.offhandLit ? id : `${id}${LIGHT_OUT_SUFFIX}`;
  }

  /** Worn pieces on their layers; the shipwrecked's clothes where nothing is worn. */
  private clothingFor(pose: PlayerPose): ClothingLayer[] {
    const out: ClothingLayer[] = [];
    if (pose.kopf !== null) out.push({ slot: 'kopf', sprite: itemLayerSpriteId(pose.kopf) });
    for (const slot of ['koerper', 'beine'] as const) {
      const worn = pose[slot];
      if (worn !== null) out.push({ slot, sprite: itemLayerSpriteId(worn) });
      else for (const c of this.clothing) if (c.slot === slot) out.push(c);
    }
    for (const c of this.clothing) if (c.slot !== 'koerper' && c.slot !== 'beine' && !out.some((o) => o.slot === c.slot)) out.push(c);
    return out;
  }
}
