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
 * - **Shield in the off hand** (M6-09b, §19.2; the light then hangs on the belt, −40 % radius): `ausruestung_<schild>` on the
 *   socket `nebenhand` in every pose and facing, in the rig's order (in front facing the viewer and in the near-hand profile,
 *   behind the body facing away and in the far-hand profile). Moving, working and resting the arm carries it at the side;
 *   the guard (`block`) raises it; the fight's clips take their steady off-hand variant (`_licht`, where the atlas has one:
 *   the arm holds the shield up while the weapon hand strikes). A combat clip without one grips the weapon with both hands
 *   (two-hander, bow, crossbow): there the shield is not drawn. Rolling, swimming, asleep or dead the hands hold nothing.
 * - **Main hand**: the selected hotbar item when it is drawn on the figure (tools, weapons: layer
 *   `waffe`, sprite `ausruestung_<item>`); its `tool_<richtung>` clips swing with the body.
 * - **Hidden hands**: nothing in the hands while rolling, swimming, asleep or dead; the main hand is empty
 *   while eating or drinking (the hand is at the mouth).
 * - **Clothing**: worn armour (`ausruestung_<item>` on the head, body, legs and feet layers); a layer nobody
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
 * - **Fight** (M6-38, M6-38a, `combatClips.ts`): with `GameSession.sampleCombat` the body shows the combat clip of the
 *   phase – `attack_<klasse>`, `heavy_<klasse>`, `block` (and their `_licht` variants) – timed so its smear frame stands
 *   on the tick the blow lands; before a fresh hit, after the activities and body modes. The item in the main hand plays
 *   its clip of the same action (its combat clips from the armoury) and turns about its grip towards the aim
 *   (`FigureState.handAngle`, the rotation in the low-res buffer). An item without combat clips (a tool as a weapon)
 *   swings with the tool clip.
 * - **Hitstop** (M6-05): while the simulation holds the body still, the figure's clocks stand too – the clip time of the
 *   frame before and the body clock of activities and hits (the white flash keeps its two frames).
 * - **Weapon facing up** (M6-01b, `weaponOverBody`, `PlayerRig`): the rig draws the main hand behind the back when the
 *   figure faces away (`FIGURE_LAYER_ORDER.up`) – right for a tool on the way or a club at rest, but in a fight the spear,
 *   bow and club vanished behind the body. While the body shows a combat clip facing up, the weapon is drawn over the back
 *   (the bow lies across over the head, `_spieler_kampf.ts`), like the 16-bit games do it: what the player fights with
 *   stays readable (§2.8, §19.1). Same place, frame and rotation as the rig's, only later in the draw order.
 * - **Shield in a block** (M6-Gate, `offhandOverBody`): blocking in profile to the right, the far arm raises the shield
 *   before the chest towards the attacker; it is drawn over the body (then the weapon), else only its rim showed.
 * - **Bow** (M6-Gate, `BOGEN_LAGEN` in `_spieler_kampf.ts`, `_waffe.ts`): the bow stands across the aim – upright in profile,
 *   across in front of the body facing down, across over the head facing up – and shows its drawn frame for the facing
 *   at full tension (string pulled back, arrow along the aim); the hand layer turns it about the grip towards the aim –
 *   aimed diagonally, its frame drawn turned by 45° (`TURNED_CLIP_SUFFIX`) and turned only by the rest.
 * - **Dazzled** (M6-Gate, `PLAYER_DAZZLE`): a condition that dazzles (Geblendet) flickers the creatures' dazzle sparks at
 *   the head (ADR-0173).
 * - **Frame events** of the body clip (`schritt`, `abrollen`, `zug`, `treffer`, `biss`, `schluck` …) go to
 *   `onClipEvent` as the frames are entered, with the loop of the clip they belong to (the audio kernel's
 *   clip sounds, src/audio/clipEvents.ts).
 * Reads the session only (samples, events and the simulation's systems); allocates nothing per frame (the
 * rig of a loadout is built once per atlas manifest).
 */
import { BALANCE } from '../../content/balance';
import { CONDITIONS } from '../../content/conditions';
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
import { createCombatSample, type CombatSample } from '../../game/combat/sample';
import { ClipEventCursor, clipDuration, clipFrameAt, DIRECTIONS, validateDirectional, type AnimationClip, type Direction } from '../anim/animation';
import { defaultFigureState, FigureRig, HAND_SLOTS_MASK, HandPoint, slotBit, type EquipmentSlot, type FigureLayerDef, type FigureState } from '../anim/figure';
import { spriteFrame, type AtlasData, type AtlasManifest, type AtlasSprite } from '../assets/atlas';
import type { SpriteDesc, SpriteList } from '../batch/spriteList';
import type { RenderScene } from '../scene';
import { BLOCK_ACTION, COMBAT_ACTIONS, combatClipTime, combatPose, createCombatPose, TOOL_ACTION, type CombatPose } from './combatClips';
import { DAZZLE, MARK_DEPTH, STATUS_CLIPS, STATUS_SPRITE } from './statusMarks';
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

/** Every action a figure may show (movement, activities, the hit, the fight – M6-38a). */
const BASE_ACTIONS: readonly string[] = [...new Set([...PLAYER_MOVE_STATES.flatMap((s) => PLAYER_CLIP_CHAIN[s]), ...Object.values(ACTIVITY_ACTION), HIT_ACTION, ...COMBAT_ACTIONS])];
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
 * off hand (`withLight`) – see the module comment for the order; `combat` is the combat action of the frame
 * (`combatPose`, null: none), shown after the activities and before a fresh hit; with a `shield` in the off hand the
 * combat action takes its steady off-hand variant (`_licht`) where the figure has one. `byState` is the movement
 * action per mode, `available` the actions the figure has.
 */
export function figureAction(
  state: PlayerMoveState,
  activity: FigureActivity,
  hit: boolean,
  withLight: boolean,
  byState: Readonly<Record<PlayerMoveState, string>>,
  available: ReadonlySet<string>,
  combat: string | null = null,
  shield = false,
): string {
  let action = byState[state];
  if (activity === 'death' || activity === 'sleep') action = ACTIVITY_ACTION[activity];
  else if (BODY_MODES.has(state)) action = byState[state];
  else if (activity !== 'none') action = ACTIVITY_ACTION[activity];
  else if (combat !== null) action = combat;
  else if (hit) action = HIT_ACTION;
  if (!available.has(action)) action = byState[state];
  // A light takes the steady off-hand variant wherever there is one; a shield only in the fight (M6-09b).
  if (withLight || (shield && combat !== null && action === combat)) {
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
  /** Shield worn in the off hand (equipment slot `nebenhand`, M6-09b), or null; the carried light then hangs on the belt. */
  shield: string | null;
  /** Worn pieces drawn on the head, body, legs and feet layers (item ids), or null. */
  kopf: string | null;
  koerper: string | null;
  beine: string | null;
  fuesse: string | null;
  /** Visible effects of the active conditions (M3-20). */
  readonly look: ConditionLook;
  /** A condition dazzles the player (`sichtbar: 'blendung'`, Geblendet): sparks flicker at the head (M6-Gate, as on creatures). */
  dazzled: boolean;
}

/** A fresh pose: nothing held, nothing done. */
export function createPlayerPose(): PlayerPose {
  return { activity: 'none', hand: null, offhand: null, offhandLit: false, shield: null, kopf: null, koerper: null, beine: null, fuesse: null, look: createConditionLook(), dazzled: false };
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

/** Conditions whose visual hook is the dazzle (`sichtbar: 'blendung'`, Geblendet): the player shows the sparks creatures do. */
const DAZZLING: ReadonlySet<string> = new Set(CONDITIONS.filter((c) => c.sichtbar === 'blendung').map((c) => c.id));

/**
 * The dazzle sparks at the player's head (M6-Gate, ADR-0173 for creatures; `kampf_zustand`, clip `blendung`): two slanted
 * sparks, their centres `spreadPx` to each side of the head's top (the body's socket `last`) and `DAZZLE.liftPx` above it –
 * 7 px: just beside the 12-px head (a creature's orbit half width 0,28 × 32 px ≈ 9 px × `DAZZLE.spreadShare`) –, the
 * second `risePx` higher (not a level line), flickering `flickerSeconds` apart; emissive with `DAZZLE.glow` like a
 * creature's.
 */
export const PLAYER_DAZZLE = { spreadPx: 7, risePx: 2, flickerSeconds: 0.05 } as const;

/** Item category of shields (src/content/items/schilde.ts): worn in the off hand, drawn there (M6-09b). */
const SHIELD_CATEGORY = 'schild';

/** Figure layer of each worn equipment slot drawn on the figure (§4.5 "Kopf, Körper, Beine"). */
const WORN_LAYERS = [
  ['kopf', 'kopf'],
  ['brust', 'koerper'],
  ['beine', 'beine'],
  ['fuesse', 'fuesse'],
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
    out.shield = null;
    out.kopf = null;
    out.koerper = null;
    out.beine = null;
    out.fuesse = null;
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
        // A shield in the off hand (M6-09b): drawn on the off hand's socket (a light there is carried in the hand instead).
        const off = s.equipment.worn('nebenhand');
        const offDef = off === null ? undefined : s.inventory.bags.catalog.find(off.item);
        if (off !== null && offDef !== undefined && offDef.kategorie === SHIELD_CATEGORY) out.shield = off.item;
      }
    }
    const carried = s.light?.carried ?? null;
    if (carried !== null && carried.mode === 'hand') {
      out.offhand = carried.item;
      out.offhandLit = carried.burn.lit;
    }
    const active = s.conditions?.active() ?? [];
    sampleConditionLook(active, active.length, out.look);
    out.dazzled = false;
    for (let i = 0; i < active.length; i++) if (DAZZLING.has((active[i] as { readonly id: string }).id)) out.dazzled = true;
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

/** Combat clips of the body (with and without a light in the off hand): facing up, their weapon is drawn over the back. */
const FIGHT_ACTIONS: ReadonlySet<string> = new Set([...COMBAT_ACTIONS, ...COMBAT_ACTIONS.map((a) => `${a}${LIGHT_CLIP_SUFFIX}`)]);
/** Bits of the main and the off hand in `FigureState.hidden`. */
const WEAPON_BIT = slotBit('waffe');
const OFFHAND_BIT = slotBit('nebenhand');

/**
 * Whether the item in the main hand is drawn over the body for `action` towards `direction` (M6-01b): facing up in a fight
 * (attack, heavy blow, guard) – elsewhere the rig's order holds (behind the back facing away, in front facing the viewer).
 */
export function weaponOverBody(direction: Direction, action: string): boolean {
  return direction === 'up' && FIGHT_ACTIONS.has(action);
}

/**
 * Whether the item in the off hand is drawn over the body for `action` towards `direction` (M6-Gate, kampf-tag): blocking in
 * profile to the right, the shield on the far arm is raised before the chest towards the attacker – drawn behind the body
 * (the rig's order for the far hand) only its rim showed beside the face. Facing left the off hand is the near one, in
 * front anyway.
 */
export function offhandOverBody(direction: Direction, action: string): boolean {
  return direction === 'right' && action === BLOCK_ACTION;
}

/**
 * The player's rig: a `FigureRig` whose hands may come after the body and its clothes instead of the rig's order – the main
 * hand facing up in a fight (`weaponOverBody`, M6-01b), the off hand (and the main hand after it) blocking in profile
 * (`offhandOverBody`) – at exactly the place, frame and turn the rig gives them (`FigureRig.emitSlot`).
 */
export class PlayerRig extends FigureRig {
  constructor(
    body: AtlasSprite,
    actionNames: readonly string[],
    layers: readonly FigureLayerDef[],
    /** The item in the main hand (layer `waffe`), or null. */
    private readonly hand: AtlasSprite | null,
    /** Whether the off hand holds an item (layer `nebenhand`). */
    private readonly offhand: boolean = layers.some((l) => l.slot === 'nebenhand'),
  ) {
    super(body, actionNames, layers);
  }

  override emit(list: SpriteList, d: SpriteDesc, s: FigureState): void {
    const hidden = s.hidden;
    const offLate = this.offhand && (hidden & OFFHAND_BIT) === 0 && offhandOverBody(s.direction, s.action);
    const weaponLate = this.hand !== null && (hidden & WEAPON_BIT) === 0 && (offLate || weaponOverBody(s.direction, s.action));
    if (!offLate && !weaponLate) {
      super.emit(list, d, s);
      return;
    }
    s.hidden = hidden | (offLate ? OFFHAND_BIT : 0) | (weaponLate ? WEAPON_BIT : 0);
    super.emit(list, d, s);
    s.hidden = hidden;
    if (offLate) this.emitSlot(list, d, s, 'nebenhand');
    if (weaponLate) this.emitSlot(list, d, s, 'waffe');
  }
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
  /** Whether the main hand holds a drawn item, and the combat and tool actions that item carries clips for (M6-38a). */
  readonly handHeld: boolean;
  readonly handActions: ReadonlySet<string>;
  /**
   * Combat actions that grip the weapon with both hands: the body has them but no steady off-hand variant (`_licht`) –
   * two-hander, bow, crossbow; the guard excepted. A shield is not drawn in them (M6-09b).
   */
  readonly bothHands: ReadonlySet<string>;
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
      const overlay = c.slot === 'koerper' || c.slot === 'beine' || c.slot === 'fuesse';
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
  const clothingIds = layers.filter((l) => l.slot === 'kopf' || l.slot === 'koerper' || l.slot === 'beine' || l.slot === 'fuesse').map((l) => l.sprite.id);
  const heldIds = layers.filter((l) => l.slot === 'waffe' || l.slot === 'nebenhand' || l.slot === 'last').map((l) => l.sprite.id);
  const hand = layers.find((l) => l.slot === 'waffe')?.sprite ?? null;
  const handActions = new Set(hand === null ? [] : [...COMBAT_ACTIONS, TOOL_ACTION].filter((a) => DIRECTIONS.some((d) => hand.clips[`${a}_${d}`] !== undefined)));
  const bothHands = new Set(COMBAT_ACTIONS.filter((a) => a !== BLOCK_ACTION && available.has(a) && !available.has(`${a}${LIGHT_CLIP_SUFFIX}`)));
  return { rig: new PlayerRig(body, actions, layers, hand), body, clothing: clothingIds, held: heldIds, byState, available, durations, actionDurations, handHeld: hand !== null, handActions, bothHands };
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

/**
 * The player's fight as the figure sampled it (`GameSession.sampleCombat`), with where its main hand pointed in the frame
 * drawn (`FigureRig.handPoint`: the `wirkpunkt` of the weapon – blade, club head, spear tip – turned with it; else the bare hand):
 * the charged blow's glint sits there (`combat.ts`).
 */
export interface FigureCombatSample extends CombatSample {
  readonly weaponHead: HandPoint;
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
  /** The off hand's item (a light in the hand, else a shield) and whether the light burns. */
  private loadOff: string | null = null;
  private loadOffLit = false;
  private loadKopf: string | null = null;
  private loadKoerper: string | null = null;
  private loadBeine: string | null = null;
  private loadFuesse: string | null = null;
  private loadValid = false;
  private subscribedTo: Pick<GameSession, 'onEvent'> | null = null;
  private unsubscribe: (() => void) | null = null;
  private hitPending = false;
  /** When the last hit came: on the body clock (its clip) and in presentation time (its two-frame flash). */
  private hitAt = Number.NEGATIVE_INFINITY;
  private flashAt = Number.NEGATIVE_INFINITY;
  private lastAction = '';
  private lastFlash = false;
  /** The pose's activity of the last frame and when it began [body clock s]. */
  private activityShown: FigureActivity | 'hit' | 'kampf' = 'none';
  private activitySince = 0;
  /**
   * The body clock [s]: presentation time that stands still while the simulation holds the body in hitstop (M6-05), and
   * the presentation time it last advanced from (NaN: not yet).
   */
  private bodyClock = 0;
  private clockFrom = Number.NaN;
  /** Clip time of the last frame (a body in hitstop keeps it). */
  private lastTime = 0;
  /** The player's fight of the frame (`GameSession.sampleCombat`) and the pose the figure shows of it (M6-38). */
  private readonly combat: FigureCombatSample = { ...createCombatSample(), weaponHead: new HandPoint() };
  private readonly combatPoseValue: CombatPose = createCombatPose();
  /** The charge of a held blow: the tick it began to charge and the tick the heavy blow is ready (`attackWindup`, schwer). */
  private chargeFrom = -1;
  private chargeTo = -1;
  /** Whether the current rig can show `action` (the body has it; an attack also the item in the hand). */
  private readonly canAction = (action: string): boolean => {
    const b = this.built;
    if (b === null || !b.available.has(action)) return false;
    return !b.handHeld || action === BLOCK_ACTION || b.handActions.has(action);
  };
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

  /** The player's fight as sampled for the last frame (`present` false without `sampleCombat`). */
  get lastCombat(): Readonly<FigureCombatSample> {
    return this.combat;
  }

  /** The combat clip, stage and weapon rotation of the last frame (M6-38). */
  get combatPose(): Readonly<CombatPose> {
    return this.combatPoseValue;
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
  place(
    scene: RenderScene,
    atlas: AtlasData,
    session: Pick<GameSession, 'samplePlayer' | 'onEvent'> & Partial<Pick<GameSession, 'sim' | 'sampleCombat'>>,
    time: number,
    x: number,
    y: number,
  ): boolean {
    this.follow(session);
    const s = this.sample;
    if (!session.samplePlayer(s)) return false;
    const pose = this.poseValue;
    if (session.sim !== undefined) this.poses.sample(session.sim, pose);
    const built = this.figureFor(atlas.manifest, pose);
    if (built === null) return false;
    const combat = this.combat;
    if (session.sampleCombat === undefined || !session.sampleCombat(combat)) combat.present = false;
    const frozen = combat.present && combat.hitstop;
    // The body clock runs with presentation time, except while the body stands in hitstop.
    const step = Number.isNaN(this.clockFrom) ? 0 : time - this.clockFrom;
    this.clockFrom = time;
    if (!frozen && step > 0) this.bodyClock += step;
    const clock = this.bodyClock;
    if (this.hitPending) {
      this.hitPending = false;
      this.hitAt = clock;
      this.flashAt = time;
    }
    const hitDuration = built.actionDurations.get(HIT_ACTION)?.[s.facing] ?? 0;
    const hit = clock >= this.hitAt && clock - this.hitAt < hitDuration;
    const withLight = pose.offhand !== null;
    // A shield in the off hand (no light there: the simulation hangs it on the belt), M6-09b.
    const shield = !withLight && pose.shield !== null;
    const cp = combatPose(combat, s.facing, this.canAction, this.charge(session.sim?.tick ?? -1), this.combatPoseValue);
    const action = figureAction(s.state, pose.activity, hit, withLight, built.byState, built.available, cp.action, shield);
    // Which clock the body runs on: the movement mode's, the fight's phase, or the time since the activity (or hit) began.
    let shown: FigureActivity | 'hit' | 'kampf';
    if (pose.activity === 'death' || pose.activity === 'sleep') shown = pose.activity;
    else if (BODY_MODES.has(s.state)) shown = 'none';
    else if (pose.activity !== 'none') shown = pose.activity;
    else if (cp.action !== null) shown = 'kampf';
    else shown = hit ? 'hit' : 'none';
    const moving = shown === 'none';
    if (shown !== this.activityShown) {
      this.activityShown = shown;
      this.activitySince = shown === 'hit' ? this.hitAt : clock;
    }
    this.lastAction = action;
    const f = this.figureState;
    if (shown === 'kampf') {
      const clip = built.rig.bodyClip(action, s.facing);
      f.time = clip === null ? 0 : combatClipTime(clip, cp.stage, cp.progress);
    } else if (!moving) {
      f.time = Math.max(0, clock - this.activitySince);
      // A tool swings again and again while the target is worked: its one-shot clip restarts with every swing of the simulation.
      if (shown === 'tool') f.time %= TOOL_SWING_SECONDS;
    }
    else if (ONE_SHOT.has(s.state) && action !== 'idle') f.time = s.actionProgress * built.durations[s.state][s.facing];
    else {
      const base = built.byState[s.state];
      const drawnFor = CLIP_GROUND_SPEED[base];
      f.time = drawnFor === undefined ? s.stateSeconds : (s.stateSeconds * MODE_SPEED[s.state]) / drawnFor;
    }
    // Hitstop: the clip stands on the frame it showed (the movement clock carries the frame's alpha, which would creep on).
    // A combat clip needs no hold – the fight's phase clock stands in the simulation – and must reach its strike frame on
    // the tick of the blow, the first frozen one.
    if (frozen && shown !== 'kampf' && action === f.action) f.time = this.lastTime;
    this.lastTime = f.time;
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
    // The shield is not drawn while both hands grip the weapon (two-hander, bow, crossbow).
    f.hidden = hiddenSlots(s.state, pose.activity) | (shield && built.bothHands.has(action) ? OFFHAND_BIT : 0);
    // The weapon turns towards the aim only while the fight owns the body (not in a roll, a swim, an activity).
    f.handAngle = shown === 'kampf' || (shown === 'none' && !BODY_MODES.has(s.state)) ? cp.handAngle : 0;
    figureTint(look, time, this.tint);
    f.tint = this.tint.color;
    f.tintStrength = this.tint.strength;
    const level = s.transitFromLevel === s.transitToLevel ? s.level : s.transitFromLevel + (s.transitToLevel - s.transitFromLevel) * s.actionProgress;
    f.heightBase = level * WAND_PX_JE_STUFE;
    f.flash = time - this.flashAt < HIT_FLASH_SECONDS && time >= this.flashAt;
    this.lastFlash = f.flash;
    built.rig.emit(scene.sprites, scene.sprite, f);
    if (pose.dazzled) this.dazzle(scene, atlas.manifest, built, f, time);
    const hand = built.rig.handPoint;
    const head = combat.weaponHead;
    head.x = hand.x;
    head.y = hand.y;
    head.z = hand.z;
    head.drawn = hand.drawn;
    head.item = hand.item;
    this.drawn.x = f.x;
    this.drawn.y = f.y;
    this.drawn.heightBase = f.heightBase;
    const clip = built.rig.bodyClip(action, s.facing);
    if (clip !== null && this.eventSink !== null) this.events.update(clip, f.time, this.forward);
    return true;
  }

  /** The dazzle sparks at the head of the figure drawn as `f` (`PLAYER_DAZZLE`); nothing without the sprite or the socket. */
  private dazzle(scene: RenderScene, manifest: AtlasManifest, built: PlayerFigureRig, f: FigureState, time: number): void {
    const sprite = manifest.sprites[STATUS_SPRITE];
    const clip = sprite?.clips[STATUS_CLIPS.dazzle];
    const body = built.rig.bodyClip(f.action, f.direction);
    if (sprite === undefined || clip === undefined || body === null) return;
    const index = clipFrameAt(body, f.time);
    const top = built.body.sockets['last']?.[index] ?? null;
    if (top === null) return;
    const frame = spriteFrame(built.body, index);
    const x = f.x + top[0] - frame.ax;
    const y = f.y + top[1] - frame.ay - DAZZLE.liftPx;
    for (let i = 0; i < DAZZLE.sparks; i++) {
      const d = scene.sprite.reset();
      d.frame = spriteFrame(sprite, clipFrameAt(clip, time + i * PLAYER_DAZZLE.flickerSeconds));
      d.x = x + ((i & 1) === 0 ? -PLAYER_DAZZLE.spreadPx : PLAYER_DAZZLE.spreadPx);
      d.y = y - ((i & 1) === 0 ? 0 : PLAYER_DAZZLE.risePx);
      d.depth = f.y + MARK_DEPTH;
      d.heightBase = f.heightBase + f.y - d.y;
      d.emissiveBoost = DAZZLE.glow;
      scene.sprites.push(d);
    }
  }

  /**
   * How far a held blow has charged towards the heavy one at simulation tick `tick`, 0–1 (the `attackWindup` of the heavy
   * hold names its ready tick); 1 without a tick or once ready.
   */
  private charge(tick: number): number {
    const from = this.chargeFrom;
    const to = this.chargeTo;
    if (tick < 0 || from < 0 || to <= from) return 1;
    const c = (tick - from) / (to - from);
    return c < 0 ? 0 : c > 1 ? 1 : c;
  }

  /** Stops listening to the session's events. */
  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.subscribedTo = null;
    this.events.reset();
  }

  /** Listens to the damage events of `session` (re-subscribes when the view gets another session; the listeners' closures live in `subscribe`, so the check that runs every frame allocates no context (§30)). */
  private follow(session: Pick<GameSession, 'onEvent'>): void {
    if (this.subscribedTo !== session) this.subscribe(session);
  }

  private subscribe(session: Pick<GameSession, 'onEvent'>): void {
    this.dispose();
    this.subscribedTo = session;
    const offDamage = session.onEvent('playerDamaged', () => {
      this.hitPending = true;
    });
    // The heavy hold: the charge runs from this tick to the one the heavy blow is ready (`ticks` later).
    const offWindup = session.onEvent('attackWindup', (e) => {
      if (!e.schwer || e.entity !== this.sample.entity) return;
      this.chargeFrom = e.tick;
      this.chargeTo = e.tick + e.ticks;
    });
    this.unsubscribe = () => {
      offDamage();
      offWindup();
    };
  }

  /** The rig of the pose's loadout (built once per manifest and loadout). */
  private figureFor(manifest: AtlasManifest, pose: PlayerPose): PlayerFigureRig | null {
    if (this.manifest !== manifest) {
      this.manifest = manifest;
      this.rigs.clear();
      this.loadValid = false;
    }
    // Item ids are compared (no sprite id is built per frame); the rig's sprites are named only when the loadout changes.
    const off = pose.offhand !== null ? pose.offhand : pose.shield;
    const offLit = pose.offhand !== null && pose.offhandLit;
    if (this.loadValid && pose.hand === this.loadHand && off === this.loadOff && offLit === this.loadOffLit && pose.kopf === this.loadKopf && pose.koerper === this.loadKoerper && pose.beine === this.loadBeine && pose.fuesse === this.loadFuesse) return this.built;
    this.loadHand = pose.hand;
    this.loadOff = off;
    this.loadOffLit = offLit;
    this.loadKopf = pose.kopf;
    this.loadKoerper = pose.koerper;
    this.loadBeine = pose.beine;
    this.loadFuesse = pose.fuesse;
    this.loadValid = true;
    const clothing = this.clothingFor(pose);
    const held: HeldLayers = { hand: pose.hand === null ? null : itemLayerSpriteId(pose.hand), offhand: this.offSprite(pose) };
    const key = `${clothing.map((c) => `${c.slot}:${c.sprite}`).join(',')}|${held.hand ?? ''}|${held.offhand ?? ''}`;
    let rig = this.rigs.get(key);
    if (rig === undefined) {
      rig = buildPlayerFigure(manifest, clothing, held);
      this.rigs.set(key, rig);
    }
    this.built = rig;
    return rig;
  }

  /** Sprite in the off hand: the light – burning, or its put-out form –, else the shield (M6-09b), else none. */
  private offSprite(pose: PlayerPose): string | null {
    if (pose.offhand === null) return pose.shield === null ? null : itemLayerSpriteId(pose.shield);
    const id = itemLayerSpriteId(pose.offhand);
    return pose.offhandLit ? id : `${id}${LIGHT_OUT_SUFFIX}`;
  }

  /** Worn pieces on their layers; the shipwrecked's clothes where nothing is worn. */
  private clothingFor(pose: PlayerPose): ClothingLayer[] {
    const out: ClothingLayer[] = [];
    if (pose.kopf !== null) out.push({ slot: 'kopf', sprite: itemLayerSpriteId(pose.kopf) });
    if (pose.fuesse !== null) out.push({ slot: 'fuesse', sprite: itemLayerSpriteId(pose.fuesse) });
    for (const slot of ['koerper', 'beine'] as const) {
      const worn = pose[slot];
      if (worn !== null) out.push({ slot, sprite: itemLayerSpriteId(worn) });
      else for (const c of this.clothing) if (c.slot === slot) out.push(c);
    }
    for (const c of this.clothing) if (c.slot !== 'koerper' && c.slot !== 'beine' && !out.some((o) => o.slot === c.slot)) out.push(c);
    return out;
  }
}
