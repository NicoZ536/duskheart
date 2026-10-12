/**
 * The player's figure in the game view (M3-08; docs/SPIEL.md §5): the body `spieler_basis` with the
 * clip of what the player does and faces (`<aktion>_<richtung>`, M3-05, M3-06), the clothing as overlay
 * layers and the items in the hands on the body's hand sockets (`../anim/figure.ts`, M3-07).
 *
 * - **Action** (`figureAction`), most important first: dead → `death` (once, then lying); asleep →
 *   `sleep`; rolling, swimming, jumping, climbing → their movement clip; making music → `musizieren` (M7-31, the hands
 *   hold the instrument); fishing → `angeln` (M7-24, the main hand empty: the rod is drawn to the float); eating, drinking, sitting → `eat`, `drink`, `sit`; working a target with a tool → `tool` (the swing's hit frame meets the
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
 * - **Guard with a shield** (M6-Gate, `SHIELD_BLOCK_ACTION`, `offhandOverBody`): with a shield in the off hand the guard
 *   shows `block_schild` – in profile the shield arm holds the shield before the chest towards the attacker (its slanted
 *   view, face and boss) and the weapon is drawn back; facing right the far arm's shield is drawn over the body (then the
 *   weapon), else only its rim showed. The guard of `block` (weapon upright before the face, the off hand raised) stood the
 *   narrow shield as a strip over the helmet.
 * - **Bow** (M6-Gate, `BOGEN_LAGEN` in `_spieler_kampf.ts`, `_waffe.ts`): the bow stands across the aim – upright in profile,
 *   across in front of the body facing down, across over the head facing up – and shows its drawn frame for the facing
 *   at full tension (string pulled back, arrow along the aim); the hand layer turns it about the grip towards the aim –
 *   aimed diagonally, its frame drawn turned by 45° (`TURNED_CLIP_SUFFIX`) and turned only by the rest; aimed up and to the
 *   side in profile the body shows its turned picture too (the bow arm raised, the nock at the chin) and the bow goes behind
 *   it (`FigureRig`).
 * - **Dazzled** (M6-Gate, `PLAYER_DAZZLE`): a condition that dazzles (Geblendet) flickers the creatures' dazzle sparks at
 *   the head (ADR-0173), with a deep blue rim that carries them on bright sand (`PLAYER_DAZZLE_SPRITE`).
 * - **Frame events** of the body clip (`schritt`, `abrollen`, `zug`, `treffer`, `biss`, `schluck` …) go to
 *   `onClipEvent` as the frames are entered, with the loop of the clip they belong to (the audio kernel's
 *   clip sounds, src/audio/clipEvents.ts).
 * - **Appearance** (M7-52 … M7-54, `game/appearance`): the body of the chosen shape (`spieler_<form>_basis`: the frames of
 *   `spieler_basis` in the same order, played with its clips – `formBody`) with the shipwrecked's clothes and the armour of
 *   that shape (`ausruestung_leinentunika_<form>`, `ausruestung_lederwams_<form>` …, M7-110; a helmet of the shape where the
 *   atlas has one); a worn piece without a sprite of the shape shows the figure in `mittel`. Palette rows: the skin's (`haut_*`) on the body and everything without a row of its own, the
 *   top's and the trousers' (`kleid_*`) on the shipwrecked's clothes, the hair's (`haar_*`) on the hair. The hairstyle
 *   (`frisur_<id>`) is drawn on the head socket of the body frame shown, its head pose looked up in `frisur_kopfposen`
 *   (assets-src/sprites/frisuren/frisuren.ts) – over the body and its clothes, under the helmet and the hands in front
 *   (`PlayerRig`); under a helmet the hairstyle's mask frames (`frisur_<id>_helm`, else `frisur_scheitel_helm`).
 * Reads the session only (samples, events and the simulation's systems); allocates nothing per frame (the
 * rig of a loadout is built once per atlas manifest).
 */
import { BALANCE } from '../../content/balance';
import { CONDITIONS } from '../../content/conditions';
import { PLAYER_MOVE_STATES, type PlayerMoveState } from '../../content/balance/player';
import { itemFigureLayer, itemLayerSpriteId } from '../../content/items/index';
import { ActionsSystem } from '../../game/actions/system';
import { ConditionsSystem } from '../../game/conditions/system';
import { INSTRUMENTS_SYSTEM_ID, InstrumentsSystem } from '../../game/instruments/system';
import { AppearanceSystem } from '../../game/appearance/system';
import { APPEARANCE_SYSTEM_ID } from '../../game/appearance/state';
import type { Appearance } from '../../game/appearance/types';
import type { BodyShapeId } from '../../content/appearance/schema';
import { FISHING_SYSTEM_ID, FishingSystem } from '../../game/fishing/system';
import type { FishingPhase } from '../../game/fishing/types';
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
import { ClipEventCursor, clipDuration, clipFrameAt, clipFrameIn, directionIndex, DIRECTIONS, validateDirectional, type AnimationClip, type Direction } from '../anim/animation';
import { defaultFigureState, FIGURE_LAYER_ORDER, FigureRig, GroundedFrame, groundedFrame, HAND_SLOTS_MASK, HandPoint, slotBit, socketOffset, TURN_STEP, TURNED_CLIP_SUFFIX, type EquipmentSlot, type FigureLayerDef, type FigureState } from '../anim/figure';
import { spriteFrame, type AtlasData, type AtlasManifest, type AtlasSprite } from '../assets/atlas';
import type { SpriteDesc, SpriteList } from '../batch/spriteList';
import type { RenderScene } from '../scene';
import {
  BLOCK_ACTION,
  COMBAT_ACTIONS,
  COMBAT_AIM_ANGLE,
  COMBAT_BLOCK_SECONDS,
  COMBAT_CHARGE,
  COMBAT_CLIP_TIME,
  COMBAT_PHASE_PROGRESS,
  COMBAT_REGISTERS,
  COMBAT_TENSION,
  combatClipTimeOf,
  combatPoseIn,
  createCombatPose,
  TOOL_ACTION,
  type CombatPose,
} from './combatClips';
import { DAZZLE, HeadStars, MARK_DEPTH, STARS_CROWN, STARS_FEET, STARS_GROUND, STARS_HEADROOM, STARS_REGISTERS, STARS_TIME, STARS_X, STATUS_CLIPS, STATUS_SPRITE, hairHeadroom } from './statusMarks';
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
export const FIGURE_ACTIVITIES = ['none', 'tool', 'eat', 'drink', 'sit', 'sleep', 'death', 'music', 'fish'] as const;
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
  // Making music (M7-31, assets-src/sprites/figuren/_spieler_musik.ts): the flute or lute before the body.
  music: 'musizieren',
  // Fishing (M7-24, assets-src/sprites/figuren/_spieler_angeln.ts): both hands hold the rod's butt before the body; the rod,
  // its bend and the line are drawn by src/render/game/fishing.ts from the hand to the float.
  fish: 'angeln',
};
/** Body clip action of a fresh hit (§4.5 "Treffer 2"). */
export const HIT_ACTION = 'hit';

/** The guard with a shield in the off hand (M6-Gate, kampf-tag; `figureAction`): the body clips `block_schild_<richtung>`. */
export const SHIELD_BLOCK_ACTION = 'block_schild';

/** Every action a figure may show (movement, activities, the hit, the fight – M6-38a – and the guard with a shield). */
const BASE_ACTIONS: readonly string[] = [...new Set([...PLAYER_MOVE_STATES.flatMap((s) => PLAYER_CLIP_CHAIN[s]), ...Object.values(ACTIVITY_ACTION), HIT_ACTION, ...COMBAT_ACTIONS, SHIELD_BLOCK_ACTION])];
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
/** Index of each movement mode in the rig's per-mode tables (`modeSpeed`, `drawnSpeed`). */
const STATE_INDEX: ReadonlyMap<PlayerMoveState, number> = new Map(PLAYER_MOVE_STATES.map((s, i) => [s, i]));
/** Modes whose clip plays once over the action's progress. */
const ONE_SHOT: ReadonlySet<PlayerMoveState> = new Set<PlayerMoveState>(['roll', 'jump', 'climb']);
/** Modes that own the body whatever the player does (the action cannot show during them). */
const BODY_MODES: ReadonlySet<PlayerMoveState> = new Set<PlayerMoveState>(['roll', 'swim', 'jump', 'climb']);
/** Modes in which the hands hold nothing. */
const EMPTY_HAND_MODES: ReadonlySet<PlayerMoveState> = new Set<PlayerMoveState>(['roll', 'swim']);
/** Activities in which the hands hold nothing, and in which only the main hand is empty. */
const EMPTY_HAND_ACTIVITIES: ReadonlySet<FigureActivity> = new Set<FigureActivity>(['sleep', 'death']);
/** Activities in which only the main hand holds something: making music holds the instrument (M7-77), nothing else. */
const MAIN_HAND_ONLY_ACTIVITIES: ReadonlySet<FigureActivity> = new Set<FigureActivity>(['music']);
/**
 * The instruments' hand layers (M7-77, assets-src/sprites/figuren/instrumente.ts: `ausruestung_floete`, `ausruestung_laute`,
 * named by `itemLayerSpriteId`): the main hand holds the instrument played, its clips `musizieren_<richtung>` run with the body.
 */
export const MUSIC_ACTION = ACTIVITY_ACTION.music;
const EMPTY_MAIN_HAND_ACTIVITIES: ReadonlySet<FigureActivity> = new Set<FigureActivity>(['eat', 'drink', 'fish']);
/** Phases of the line in which the figure fishes (the rod is drawn from its hand; caught or lost, it holds the rod again). */
const FISHING_ROD_PHASES: ReadonlySet<FishingPhase> = new Set<FishingPhase>(['wurf', 'warten', 'biss', 'drill']);
/**
 * One swing of a tool [s] (§D; the simulation's hit rhythm `BALANCE.harvest`): the one-shot `tool` clip
 * (0,5 s, hit frame after ⅓ s) restarts with every swing.
 */
export const TOOL_SWING_SECONDS = BALANCE.harvest.toolSwingSeconds;
/** Simulation ticks per second: the work ticks of a running action are the clock of the tool's swing clip (M7-68). */
const TICK_HZ = BALANCE.time.tickHz;
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
 * combat action takes its steady off-hand variant (`_licht`) where the figure has one, and the guard becomes the guard
 * with the shield (`SHIELD_BLOCK_ACTION`). `byState` is the movement action per mode, `available` the actions the figure has.
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
  if (shield && combat === BLOCK_ACTION && action === BLOCK_ACTION && available.has(SHIELD_BLOCK_ACTION)) return SHIELD_BLOCK_ACTION;
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
  if (MAIN_HAND_ONLY_ACTIVITIES.has(activity)) return HAND_SLOTS_MASK & ~slotBit('waffe');
  return EMPTY_MAIN_HAND_ACTIVITIES.has(activity) ? slotBit('waffe') : 0;
}

/** What the figure holds, wears and does besides moving (sampled once per frame by `samplePlayerPose`). */
export interface PlayerPose {
  activity: FigureActivity;
  /** Work ticks of the running tool action (`InteractionSystem.workTicks`, an integer; 0 otherwise): the swing clip's clock. */
  workTicks: number;
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
  /** The chosen appearance (M7-52; `null`: a simulation without the system – the figure as drawn). Compared by identity. */
  appearance: Appearance | null;
}

/** A fresh pose: nothing held, nothing done. */
export function createPlayerPose(): PlayerPose {
  return { activity: 'none', workTicks: 0, hand: null, offhand: null, offhandLit: false, shield: null, kopf: null, koerper: null, beine: null, fuesse: null, look: createConditionLook(), dazzled: false, appearance: null };
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
  readonly instruments: InstrumentsSystem | null;
  readonly fishing: FishingSystem | null;
  readonly appearance: AppearanceSystem | null;
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
/**
 * The player's dazzle sparks (M6-Gate, zustand-geblendet): the creatures' spark crosses with a deep blue rim
 * (assets-src/sprites/figuren/spieler_blendfunke.ts) – the player often stands on bright sand, where the pale sparks of
 * `kampf_zustand` lay as a faint smudge; the creatures' sprite serves while the atlas has no such sprite.
 */
export const PLAYER_DAZZLE_SPRITE = 'spieler_blendfunke';

/**
 * Notes rising over the head while the player makes music (M7-77; sprite `spieler_noten`, assets-src/sprites/figuren/instrumente.ts):
 * a new note every `periodSeconds`, alternately an eighth and a pair, alternately `sidePx` left and right of the head's top
 * (the body's socket `last`), rising `risePxPerSecond` and swaying `swayPx` for `lifeSeconds` – the last `fadeShare` of it in
 * the faded frame. At most ⌈life / period⌉ notes at once; each is a function of the presentation time alone (no state, no
 * allocation). They glow a little (`glow`, `emissiveBoost`) so a night's music stays visible.
 */
export const PLAYER_NOTES = { periodSeconds: 0.7, lifeSeconds: 1.9, risePxPerSecond: 7, sidePx: 4, swayPx: 1.5, swayHz: 1.4, fadeShare: 0.35, liftPx: 1, glow: 0.3 } as const;
/** Sprite of the notes and its clips (frame 0 bright, frame 1 faded). */
export const PLAYER_NOTES_SPRITE = 'spieler_noten';
const NOTE_CLIPS = ['achtel', 'doppel'] as const;

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
    out.workTicks = 0;
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
    else if (s.instruments?.isPlaying() === true) out.activity = 'music';
    else if (s.fishing !== null && FISHING_ROD_PHASES.has(s.fishing.phase)) out.activity = 'fish';
    else {
      const a = s.actions?.state ?? null;
      if (a !== null && a.consumption !== null) out.activity = a.consumption.kind === 'essen' ? 'eat' : 'drink';
      else if (a !== null && a.seat !== null) out.activity = 'sit';
      else if (s.interaction !== null && s.interaction.working && !s.interaction.focus.byHand) {
        out.activity = 'tool';
        out.workTicks = s.interaction.workTicks;
      }
    }
    if (out.activity === 'music') out.hand = s.instruments?.playing()?.instrument ?? null;
    else if (s.inventory !== null) {
      const held = s.inventory.selected();
      const def = held === null ? undefined : s.inventory.bags.catalog.find(held.item);
      if (held !== null && def !== undefined && itemFigureLayer(def) === 'waffe') out.hand = held.item;
    }
    if (s.inventory !== null) {
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
    out.appearance = s.appearance?.appearance ?? null;
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
      instruments: systemOf(sim, INSTRUMENTS_SYSTEM_ID, InstrumentsSystem),
      fishing: systemOf(sim, FISHING_SYSTEM_ID, FishingSystem),
      appearance: systemOf(sim, APPEARANCE_SYSTEM_ID, AppearanceSystem),
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

/** Combat clips of the body (with and without a light in the off hand, the guard with a shield): facing up, their weapon is drawn over the back. */
const FIGHT_ACTIONS: ReadonlySet<string> = new Set([...COMBAT_ACTIONS, ...COMBAT_ACTIONS.map((a) => `${a}${LIGHT_CLIP_SUFFIX}`), SHIELD_BLOCK_ACTION]);
/** Bits of the main and the off hand in `FigureState.hidden`. */
const WEAPON_BIT = slotBit('waffe');
const OFFHAND_BIT = slotBit('nebenhand');

/**
 * Whether the item in the main hand is drawn over the body for `action` towards `direction` (M6-01b): facing up in a fight
 * (attack, heavy blow, guard) – elsewhere the rig's order holds (behind the back facing away, in front facing the viewer).
 */
export function weaponOverBody(direction: Direction, action: string): boolean {
  // Making music (M7-77): the instrument is before the face in every facing it is seen in (in the far-hand profile too);
  // from behind the body hides it (its frames are empty there).
  if (action === MUSIC_ACTION) return direction !== 'up';
  return direction === 'up' && FIGHT_ACTIONS.has(action);
}

/**
 * Whether the item in the off hand is drawn over the body for `action` towards `direction` (M6-Gate, kampf-tag): guarding
 * with a shield in profile to the right (`SHIELD_BLOCK_ACTION`), the far arm holds the shield before the chest towards the
 * attacker – drawn behind the body (the rig's order for the far hand) only its rim showed. Facing left the off hand is the
 * near one, in front anyway.
 */
export function offhandOverBody(direction: Direction, action: string): boolean {
  return direction === 'right' && action === SHIELD_BLOCK_ACTION;
}

/**
 * The player's rig: a `FigureRig` whose hands may come after the body and its clothes instead of the rig's order – the main
 * hand facing up in a fight (`weaponOverBody`, M6-01b), the off hand (and the main hand after it) blocking in profile
 * (`offhandOverBody`) – at exactly the place, frame and turn the rig gives them (`FigureRig.emitSlot`).
 */
/** Half a `TURN_STEP` [rad]: beyond it the main hand's item shows its turned clip (`FigureRig`). */
const HALF_TURN = TURN_STEP / 2;
/** `PlayerRig.turn` before `PlayerFigure.place` set it (a rig drawn by a showcase): the rig reads the hand angle itself. */
const TURN_UNSET = 2;

export class PlayerRig extends FigureRig {
  /**
   * Which way the main hand's item is turned in the frame drawn: 1 (clockwise) or −1 beyond half a `TURN_STEP`, else 0 – set
   * by `PlayerFigure.place` every frame, so the rig's emit reads no floating-point field for it (a double read in a function
   * that runs unoptimised allocates its box, ADR-0167); `TURN_UNSET` until then.
   */
  turn = TURN_UNSET;
  /** Where the hair sits in the frame drawn (`socketOffset` of the head socket) and its frame grounded on the feet. */
  private readonly hairOffset = { x: 0, y: 0 };
  private readonly hairGrounded = new GroundedFrame();
  /** Clock register of the turned-clip check (`clipFrameIn`: no floating-point value through a call, ADR-0167). */
  private readonly hairClock = new Float64Array(1);
  /** The body's clips per action and facing, unturned and turned both ways (the check of `turnedWeapon`). */
  private readonly plainClips = new Map<string, Partial<Record<Direction, AnimationClip>>>();
  private readonly turnedClips = { cw: new Map<string, Partial<Record<Direction, AnimationClip>>>(), ccw: new Map<string, Partial<Record<Direction, AnimationClip>>>() };

  constructor(
    body: AtlasSprite,
    actionNames: readonly string[],
    layers: readonly FigureLayerDef[],
    /** The item in the main hand (layer `waffe`), or null. */
    private readonly hand: AtlasSprite | null,
    /** Whether the off hand holds an item (layer `nebenhand`). */
    private readonly offhand: boolean = layers.some((l) => l.slot === 'nebenhand'),
    /** The hairstyle drawn on the head socket (M7-54), or null (the body's own hair). */
    private readonly hair: HairLayer | null = null,
  ) {
    super(body, actionNames, layers);
    if (hair !== null && hand !== null) {
      for (const action of actionNames) {
        const plain: Partial<Record<Direction, AnimationClip>> = {};
        const cw: Partial<Record<Direction, AnimationClip>> = {};
        const ccw: Partial<Record<Direction, AnimationClip>> = {};
        for (const d of DIRECTIONS) {
          const c = body.clips[`${action}_${d}`];
          if (c !== undefined) plain[d] = c;
          const tcw = body.clips[`${action}_${d}${TURNED_CLIP_SUFFIX.cw}`];
          if (tcw !== undefined) cw[d] = tcw;
          const tccw = body.clips[`${action}_${d}${TURNED_CLIP_SUFFIX.ccw}`];
          if (tccw !== undefined) ccw[d] = tccw;
        }
        this.plainClips.set(action, plain);
        this.turnedClips.cw.set(action, cw);
        this.turnedClips.ccw.set(action, ccw);
      }
    }
  }

  override emit(list: SpriteList, d: SpriteDesc, s: FigureState): void {
    const hidden = s.hidden;
    const offLate = this.offhand && (hidden & OFFHAND_BIT) === 0 && offhandOverBody(s.direction, s.action);
    const weaponLate = this.hand !== null && (hidden & WEAPON_BIT) === 0 && (offLate || weaponOverBody(s.direction, s.action));
    const hair = this.hair;
    if (hair === null) {
      if (!offLate && !weaponLate) {
        super.emit(list, d, s);
        return;
      }
      s.hidden = hidden | (offLate ? OFFHAND_BIT : 0) | (weaponLate ? WEAPON_BIT : 0);
      super.emit(list, d, s);
      s.hidden = hidden;
      if (offLate) this.emitSlot(list, d, s, 'nebenhand');
      if (weaponLate) this.emitSlot(list, d, s, 'waffe');
      return;
    }
    // The hair comes after the body and its clothes and before the helmet and the hands in front of the head (the rig's
    // order from `kopf` on); a weapon gripped behind the body by a turned arm stays where the rig draws it.
    let over = OVER_HAIR_MASK[s.direction];
    if (this.turnedWeapon(s)) over &= ~WEAPON_BIT;
    s.hidden = hidden | over | (offLate ? OFFHAND_BIT : 0) | (weaponLate ? WEAPON_BIT : 0);
    super.emit(list, d, s);
    s.hidden = hidden;
    const index = this.bodyFrameIndex;
    if (index < 0) return;
    this.emitHair(list, d, s, hair, index);
    const slots = OVER_HAIR[s.direction];
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i] as EquipmentSlot;
      const bit = OVER_HAIR_BITS[s.direction][i] as number;
      if ((hidden & bit) !== 0 || (over & bit) === 0 || (offLate && bit === OFFHAND_BIT) || (weaponLate && bit === WEAPON_BIT)) continue;
      this.emitSlot(list, d, s, slot);
    }
    if (offLate) this.emitSlot(list, d, s, 'nebenhand');
    if (weaponLate) this.emitSlot(list, d, s, 'waffe');
  }

  /**
   * Whether the body shows a turned picture with the main hand's item behind it (`FigureRig.begin`: aimed beyond half a step,
   * the turned clip's frame differs from the unturned one's) – the player is never mirrored.
   */
  private turnedWeapon(s: FigureState): boolean {
    if (this.hand === null) return false;
    let turn = this.turn;
    if (turn === TURN_UNSET) {
      const angle = s.handAngle;
      turn = angle > HALF_TURN ? 1 : angle < -HALF_TURN ? -1 : 0;
    }
    if (turn === 0) return false;
    const turned = (turn > 0 ? this.turnedClips.cw : this.turnedClips.ccw).get(s.action)?.[s.direction];
    const plain = this.plainClips.get(s.action)?.[s.direction];
    if (turned === undefined || plain === undefined) return false;
    const clock = this.hairClock;
    clock[0] = s.time;
    return clipFrameIn(turned, clock, 0) !== clipFrameIn(plain, clock, 0);
  }

  /** Pushes the hairstyle's head pose of body frame `index` on the head socket, grounded on the feet like a socket item. */
  private emitHair(list: SpriteList, d: SpriteDesc, s: FigureState, hair: HairLayer, index: number): void {
    const pose = hair.poses[index];
    const point = this.body.sockets['kopf']?.[index];
    if (pose === undefined || pose < 0 || pose >= hair.sprite.frames.length || !point) return;
    socketOffset(spriteFrame(this.body, index), point, false, this.hairOffset);
    d.reset();
    d.x = s.x + this.hairOffset.x;
    d.y = s.y;
    d.layer = s.layer;
    d.outline = s.outline;
    d.flash = s.flash;
    d.heightBase = s.heightBase;
    d.paletteRow = hair.paletteRow;
    if (s.tintStrength > 0) {
      d.tintR = (s.tint >> 16) & 0xff;
      d.tintG = (s.tint >> 8) & 0xff;
      d.tintB = s.tint & 0xff;
      d.tintStrength = s.tintStrength;
    }
    // On the body's depth: everything pushed before it lies at the feet (the hands that swing in front come after it).
    d.depth = s.y;
    d.mirror = false;
    d.frame = groundedFrame(spriteFrame(hair.sprite, pose), -this.hairOffset.y, this.hairGrounded);
    list.push(d);
  }
}

/** The parts drawn over the hair facing `dir`: the rig's order from the helmet on (`FIGURE_LAYER_ORDER`). */
function overHair(dir: Direction): EquipmentSlot[] {
  const order = FIGURE_LAYER_ORDER[dir];
  return order.slice(order.indexOf('kopf')).filter((p): p is EquipmentSlot => p !== 'body');
}
const OVER_HAIR: Readonly<Record<Direction, readonly EquipmentSlot[]>> = { down: overHair('down'), up: overHair('up'), right: overHair('right'), left: overHair('left') };
const bitsOf = (slots: readonly EquipmentSlot[]): number[] => slots.map((slot) => slotBit(slot));
const OVER_HAIR_BITS: Readonly<Record<Direction, readonly number[]>> = { down: bitsOf(OVER_HAIR.down), up: bitsOf(OVER_HAIR.up), right: bitsOf(OVER_HAIR.right), left: bitsOf(OVER_HAIR.left) };
const maskOf = (bits: readonly number[]): number => bits.reduce((m, b) => m | b, 0);
const OVER_HAIR_MASK: Readonly<Record<Direction, number>> = { down: maskOf(OVER_HAIR_BITS.down), up: maskOf(OVER_HAIR_BITS.up), right: maskOf(OVER_HAIR_BITS.right), left: maskOf(OVER_HAIR_BITS.left) };

/** The hairstyle of a rig (M7-54): its layer sprite, the head pose of every body frame and its palette row. */
export interface HairLayer {
  readonly sprite: AtlasSprite;
  /** Head pose (frame of `sprite`) per body frame (`frisur_kopfposen`, the table of the body's shape). */
  readonly poses: readonly number[];
  readonly paletteRow: number;
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
  /**
   * Duration of the mode's clip per facing [s] (one-shot modes play over their progress), indexed by `directionIndex` – a
   * typed array, so the frame reads no fractional value by a facing key (M7-112).
   */
  readonly durations: Readonly<Record<PlayerMoveState, Float64Array>>;
  /** Duration of every available action's clip per facing [s] (the hit, the limp's walk cycle), indexed by `directionIndex`. */
  readonly actionDurations: ReadonlyMap<string, Float64Array>;
  /**
   * Per movement mode (`STATE_INDEX`) the ground speed it moves at and the one its clip is drawn for [tiles/s] (NaN: the clip
   * runs on the mode's seconds) – the clock of a looping movement clip, read from typed arrays (M7-112).
   */
  readonly modeSpeed: Float64Array;
  readonly drawnSpeed: Float64Array;
  /** Whether the main hand holds a drawn item, and the combat and tool actions that item carries clips for (M6-38a). */
  readonly handHeld: boolean;
  readonly handActions: ReadonlySet<string>;
  /**
   * Combat actions that grip the weapon with both hands: the body has them but no steady off-hand variant (`_licht`) –
   * two-hander, bow, crossbow; the guard excepted. A shield is not drawn in them (M6-09b).
   */
  readonly bothHands: ReadonlySet<string>;
  /** The body shape drawn (`mittel` where the chosen one has no sprite for a worn piece, M7-53). */
  readonly form: BodyShapeId;
  /** The hairstyle's sprite drawn on the head (M7-54), or null (the body's own hair). */
  readonly hair: string | null;
  /** Palette row of the skin (`haut_*`): the body and every layer without a row of its own (M7-52). */
  readonly skinRow: number;
}

const HELD_SLOTS = [
  ['hand', 'waffe'],
  ['offhand', 'nebenhand'],
  ['load', 'last'],
] as const;

/** The look of the figure (M7-52): body shape, hairstyle and palette rows by name (`Appearance` without the name). */
export interface FigureLook {
  readonly form: BodyShapeId;
  readonly frisur: string;
  readonly haut: string;
  readonly haar: string;
  readonly oberteil: string;
  readonly hose: string;
}

/** The figure as drawn up to M6 (`defaultAppearance`). */
export const DRAWN_LOOK: FigureLook = { form: 'mittel', frisur: 'scheitel', haut: 'haut_1', haar: 'haar_1', oberteil: 'kleid_1', hose: 'kleid_1' };

/** Sprite of the head poses' table (assets-src/sprites/frisuren/frisuren.ts `KOPFPOSEN_SPRITE`). */
export const HEAD_POSES_SPRITE = 'frisur_kopfposen';
/** Hairstyle shown under a helmet by the hairstyles without mask frames (`frisur_<id>_helm`). */
const HAIR_UNDER_HELMET = 'scheitel';

/** Sprite of the body of shape `form` (`spieler_basis` for `mittel`, assets-src/sprites/figuren/spieler_formen.ts). */
export function formBodySpriteId(form: BodyShapeId): string {
  return form === 'mittel' ? PLAYER_BODY_SPRITE : `spieler_${form}_basis`;
}

/** Sprite of a clothing layer in shape `form` (`ausruestung_<item>` for `mittel`). */
export function formLayerSpriteId(sprite: string, form: BodyShapeId): string {
  return form === 'mittel' ? sprite : `${sprite}_${form}`;
}

/** Sprite of hairstyle `frisur`, under a helmet its mask frames (or the short hair's where it has none). */
export function hairSpriteId(manifest: AtlasManifest, frisur: string, helmet: boolean): string {
  if (!helmet) return `frisur_${frisur}`;
  const own = `frisur_${frisur}_helm`;
  return manifest.sprites[own] !== undefined ? own : `frisur_${HAIR_UNDER_HELMET}_helm`;
}

/** The palettes that show the figure as drawn (the first of each kind, src/content/appearance): the master palette, row 0. */
const DRAWN_PALETTES: ReadonlySet<string> = new Set([DRAWN_LOOK.haut, DRAWN_LOOK.haar, DRAWN_LOOK.oberteil]);

/** Index of palette row `name` in the manifest (0, the master palette, for a palette as drawn or while the atlas has no such row). */
export function paletteRowOf(manifest: AtlasManifest, name: string): number {
  if (DRAWN_PALETTES.has(name)) return 0;
  const i = manifest.paletteRows.findIndex((r) => r.name === name);
  return i < 0 ? 0 : i;
}

/** Head pose tables per manifest and shape (read once from `frisur_kopfposen`'s clips `<form>_<n>`). */
const POSE_TABLES = new WeakMap<AtlasManifest, Map<BodyShapeId, readonly number[] | null>>();

/** The head pose of every body frame of shape `form`, or null while the atlas has no table for it. */
export function headPoses(manifest: AtlasManifest, form: BodyShapeId): readonly number[] | null {
  let byForm = POSE_TABLES.get(manifest);
  if (byForm === undefined) {
    byForm = new Map();
    POSE_TABLES.set(manifest, byForm);
  }
  const known = byForm.get(form);
  if (known !== undefined) return known;
  const table = manifest.sprites[HEAD_POSES_SPRITE];
  let poses: number[] | null = null;
  if (table !== undefined) {
    const out: number[] = [];
    for (let n = 0; ; n++) {
      const clip = table.clips[`${form}_${n}`];
      if (clip === undefined) break;
      out.push(...clip.frames);
    }
    poses = out.length > 0 ? out : null;
  }
  byForm.set(form, poses);
  return poses;
}

/**
 * The body of shape `form` played with the clips of `spieler_basis` (`formBody`): the shape's sprite has the same frames in
 * the same order and its own sockets, but only the clips of its contact sheet. Null when the atlas lacks it or its frames
 * do not match.
 */
function formBody(manifest: AtlasManifest, basis: AtlasSprite, form: BodyShapeId): AtlasSprite | null {
  if (form === 'mittel') return basis;
  const own = manifest.sprites[formBodySpriteId(form)];
  if (own === undefined || own.frames.length !== basis.frames.length) return null;
  return { ...own, clips: basis.clips };
}

/**
 * Builds the player's rig from an atlas: `spieler_basis` with clothing and the held items, else the
 * dressed idle figure; null without either. Clothing whose sprite is missing or has the wrong frame
 * count, and held items without a sprite, are left out. `look` (M7-52 … M7-54) chooses the body's shape, the hairstyle and the
 * palette rows; a worn piece without a sprite of that shape shows the figure in `mittel`.
 */
export function buildPlayerFigure(manifest: AtlasManifest, clothing: readonly ClothingLayer[], held: HeldLayers = {}, look: FigureLook = DRAWN_LOOK): PlayerFigureRig | null {
  const basis = manifest.sprites[PLAYER_BODY_SPRITE];
  const layers: FigureLayerDef[] = [];
  let body: AtlasSprite | undefined = basis;
  let form: BodyShapeId = 'mittel';
  let hair: HairLayer | null = null;
  if (basis !== undefined) {
    // The shape where the atlas has its body and every overlay worn in it (else `mittel`, where every piece has its layer).
    const shaped = formBody(manifest, basis, look.form);
    const overlays = clothing.filter((c) => c.slot === 'koerper' || c.slot === 'beine' || c.slot === 'fuesse');
    if (shaped !== null && overlays.every((c) => manifest.sprites[formLayerSpriteId(c.sprite, look.form)]?.frames.length === basis.frames.length)) {
      body = shaped;
      form = look.form;
    }
    const startRows: Readonly<Record<string, number>> = Object.fromEntries(START_CLOTHING.map((c) => [c.sprite, paletteRowOf(manifest, c.slot === 'koerper' ? look.oberteil : look.hose)]));
    for (const c of clothing) {
      const overlay = c.slot === 'koerper' || c.slot === 'beine' || c.slot === 'fuesse';
      // A helmet of the shape where the atlas has one (open where the shape's arms cover the head, M7-110), else the drawn one.
      const shaped = manifest.sprites[formLayerSpriteId(c.sprite, form)];
      const sprite = overlay ? shaped : (shaped ?? manifest.sprites[c.sprite]);
      if (sprite === undefined) continue;
      const paletteRow = startRows[c.sprite];
      if (!overlay || sprite.frames.length === basis.frames.length) layers.push(paletteRow === undefined ? { slot: c.slot, sprite } : { slot: c.slot, sprite, paletteRow });
    }
    for (const [key, slot] of HELD_SLOTS) {
      const id = held[key] ?? null;
      // An item drawn between the hands of the shape where the atlas has it (the instruments, M7-113), else the drawn one.
      const sprite = id === null ? undefined : (manifest.sprites[formLayerSpriteId(id, form)] ?? manifest.sprites[id]);
      if (sprite !== undefined && basis.sockets[slot === 'waffe' ? 'hand' : slot] !== undefined) layers.push({ slot, sprite });
    }
    const helmet = layers.some((l) => l.slot === 'kopf');
    // The side parting in the drawn brown is the body's own hair (up to M6): no layer over it.
    const ownHair = look.frisur === DRAWN_LOOK.frisur && look.haar === DRAWN_LOOK.haar;
    const hairSprite = manifest.sprites[hairSpriteId(manifest, look.frisur, helmet)];
    const poses = headPoses(manifest, form);
    if (!ownHair && hairSprite !== undefined && poses !== null && poses.length === basis.frames.length && body?.sockets['kopf'] !== undefined) hair = { sprite: hairSprite, poses, paletteRow: paletteRowOf(manifest, look.haar) };
  } else body = manifest.sprites[PLAYER_DRESSED_SPRITE];
  if (body === undefined) return null;
  const shown = body;
  const symmetric = shown.symmetric && layers.every((l) => l.sprite.symmetric);
  const actions = figureActions(shown, symmetric);
  if (!actions.includes('idle')) throw new Error(`Spielerfigur: ${shown.id} hat keine Idle-Clips in allen Richtungen`);
  const available = new Set(actions);
  const byState = Object.fromEntries(PLAYER_MOVE_STATES.map((s) => [s, playerAction(s, available)])) as Record<PlayerMoveState, string>;
  const durationsOf = (action: string): Float64Array => Float64Array.from(DIRECTIONS, (d) => clipDuration(clipOf(shown, action, d)));
  const durations = Object.fromEntries(PLAYER_MOVE_STATES.map((s) => [s, durationsOf(byState[s])])) as Record<PlayerMoveState, Float64Array>;
  const actionDurations = new Map(actions.map((a) => [a, durationsOf(a)]));
  const modeSpeed = Float64Array.from(PLAYER_MOVE_STATES, (s) => MODE_SPEED[s]);
  const drawnSpeed = Float64Array.from(PLAYER_MOVE_STATES, (s) => CLIP_GROUND_SPEED[byState[s]] ?? Number.NaN);
  const clothingIds = layers.filter((l) => l.slot === 'kopf' || l.slot === 'koerper' || l.slot === 'beine' || l.slot === 'fuesse').map((l) => l.sprite.id);
  const heldIds = layers.filter((l) => l.slot === 'waffe' || l.slot === 'nebenhand' || l.slot === 'last').map((l) => l.sprite.id);
  const hand = layers.find((l) => l.slot === 'waffe')?.sprite ?? null;
  const handActions = new Set(hand === null ? [] : [...COMBAT_ACTIONS, TOOL_ACTION].filter((a) => DIRECTIONS.some((d) => hand.clips[`${a}_${d}`] !== undefined)));
  const bothHands = new Set(COMBAT_ACTIONS.filter((a) => a !== BLOCK_ACTION && available.has(a) && !available.has(`${a}${LIGHT_CLIP_SUFFIX}`)));
  const offhand = layers.some((l) => l.slot === 'nebenhand');
  return {
    rig: new PlayerRig(shown, actions, layers, hand, offhand, hair),
    body: shown,
    clothing: clothingIds,
    held: heldIds,
    byState,
    available,
    durations,
    actionDurations,
    modeSpeed,
    drawnSpeed,
    handHeld: hand !== null,
    handActions,
    bothHands,
    form,
    hair: hair?.sprite.id ?? null,
    skinRow: basis === undefined ? 0 : paletteRowOf(manifest, look.haut),
  };
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
 * `FigureDrawn` as a class of its own (M7-112): an object literal `{ x, y, heightBase }` shares its hidden class with every
 * literal of the same keys in the program, and one of them that ever held something else than a number makes the fields
 * generic – then every frame's store of a fractional position is a new heap number (42 B per frame in `spiel-kampf`).
 */
class DrawnRecord implements FigureDrawn {
  x = 0;
  y = 0;
  heightBase = 0;
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
  private loadLook: Appearance | null = null;
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
  /** The charge of a held blow and the combat clip's time (`COMBAT_*`, M7-112: no floating-point value crosses a call). */
  private readonly combatRegs = new Float64Array(COMBAT_REGISTERS);
  /** The body clip's time for the clip events (`ClipEventCursor.updateIn`). */
  private readonly eventTime = new Float64Array(1);
  /** Where the bare main hand sits in the body frame drawn (`rodHand`; held, no allocation per frame). */
  private readonly handOffset = { x: 0, y: 0 };
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
  /** The stun's stars over the head (M7-69, `statusMarks.ts`) and their registers (`STARS_*`: no float crosses the call). */
  private readonly stunStars = new HeadStars();
  private readonly starRegisters = new Float64Array(STARS_REGISTERS);
  private eventSink: FigureClipEventSink | null = null;
  private readonly forward = (name: string, _position: number, cycle: number): void => {
    const f = this.figureState;
    this.eventSink?.(name, f.x, f.y, this.sample.layer, cycle);
  };
  /** Where the figure was drawn last. */
  readonly drawn: FigureDrawn = new DrawnRecord();

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
    const facing = directionIndex(s.facing);
    // Spelled out, not `get(…)?.[facing] ?? 0`: a value that is a number or `undefined` is boxed – a heap number every frame
    // as soon as the site has seen a rig without the clip (M7-112).
    const hitDurations = built.actionDurations.get(HIT_ACTION);
    const hitDuration = hitDurations === undefined ? 0 : (hitDurations[facing] as number);
    const hit = clock >= this.hitAt && clock - this.hitAt < hitDuration;
    const withLight = pose.offhand !== null;
    // A shield in the off hand (no light there: the simulation hangs it on the belt), M6-09b.
    const shield = !withLight && pose.shield !== null;
    this.charge(session.sim?.tick ?? -1);
    // The sample's fractional values into the registers here, where the sample is always this one (`combatRegisters`).
    const regs = this.combatRegs;
    regs[COMBAT_PHASE_PROGRESS] = combat.phaseProgress;
    regs[COMBAT_TENSION] = combat.tension;
    regs[COMBAT_BLOCK_SECONDS] = combat.blockSeconds;
    regs[COMBAT_AIM_ANGLE] = combat.aimAngle;
    const cp = combatPoseIn(combat, s.facing, this.canAction, regs, this.combatPoseValue);
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
      if (clip === null) f.time = 0;
      else {
        combatClipTimeOf(clip, cp, regs);
        f.time = regs[COMBAT_CLIP_TIME] as number;
      }
    } else if (shown === 'tool') {
      // A tool swings again and again while the target is worked: its one-shot clip restarts with every swing of the
      // simulation. It runs on the action's work ticks (M7-68 `InteractionSystem.workTicks`: the first hit after
      // `toolHitSeconds` of work, then one every `toolSwingSeconds`), so its hit frame meets every hit – also at a slower pace
      // (Erschöpft, Verlangsamt, Frierend), where the work ticks fall behind the world clock. Computed here, not in a helper:
      // no fraction crosses a call in the figure's frame path (M7-112).
      f.time = (pose.workTicks / TICK_HZ) % TOOL_SWING_SECONDS;
    } else if (!moving) f.time = Math.max(0, clock - this.activitySince);
    else if (ONE_SHOT.has(s.state) && action !== 'idle') f.time = s.actionProgress * (built.durations[s.state][facing] as number);
    else {
      const mode = STATE_INDEX.get(s.state) ?? 0;
      const drawnFor = built.drawnSpeed[mode] as number;
      f.time = Number.isNaN(drawnFor) ? s.stateSeconds : (s.stateSeconds * (built.modeSpeed[mode] as number)) / drawnFor;
    }
    // Hitstop: the clip stands on the frame it showed (the movement clock carries the frame's alpha, which would creep on).
    // A combat clip needs no hold – the fight's phase clock stands in the simulation – and must reach its strike frame on
    // the tick of the blow, the first frozen one.
    if (frozen && shown !== 'kampf' && action === f.action) f.time = this.lastTime;
    this.lastTime = f.time;
    const look = pose.look;
    let dip = 0;
    if (look.limp && LIMPING.has(action)) {
      const cycles = built.actionDurations.get(action);
      const cycle = cycles === undefined ? 0 : (cycles[facing] as number);
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
    // The angle stays in a local: read back from the field, an unoptimised `place` would box it once per read (ADR-0167).
    const angle = shown === 'kampf' || (shown === 'none' && !BODY_MODES.has(s.state)) ? cp.handAngle : 0;
    f.handAngle = angle;
    const rig = built.rig;
    if (rig instanceof PlayerRig) rig.turn = angle > HALF_TURN ? 1 : angle < -HALF_TURN ? -1 : 0;
    figureTint(look, time, this.tint);
    f.tint = this.tint.color;
    f.tintStrength = this.tint.strength;
    const level = s.transitFromLevel === s.transitToLevel ? s.level : s.transitFromLevel + (s.transitToLevel - s.transitFromLevel) * s.actionProgress;
    f.heightBase = level * WAND_PX_JE_STUFE;
    f.flash = time - this.flashAt < HIT_FLASH_SECONDS && time >= this.flashAt;
    this.lastFlash = f.flash;
    // The skin's palette row on the body and every layer without its own (the clothes and the hair carry theirs, M7-52).
    f.paletteRow = built.skinRow;
    built.rig.emit(scene.sprites, scene.sprite, f);
    if (pose.dazzled) this.dazzle(scene, atlas.manifest, built, f, time);
    if (look.stars) {
      this.starRegisters[STARS_TIME] = time;
      this.stars(scene, atlas.manifest, built, f);
    }
    if (pose.activity === 'music') this.notes(scene, atlas.manifest, built, f, time);
    const hand = built.rig.handPoint;
    const head = combat.weaponHead;
    head.x = hand.x;
    head.y = hand.y;
    head.z = hand.z;
    head.drawn = hand.drawn;
    head.item = hand.item;
    if (pose.activity === 'fish') this.rodHand(built, f, head);
    this.drawn.x = f.x;
    this.drawn.y = f.y;
    this.drawn.heightBase = f.heightBase;
    const clip = built.rig.bodyClip(action, s.facing);
    if (clip !== null && this.eventSink !== null) {
      this.eventTime[0] = f.time;
      this.events.updateIn(clip, this.eventTime, 0, this.forward);
    }
    return true;
  }

  /**
   * The stun's stars over the head of the figure drawn as `f` (M7-69, `HeadStars`): centred on the crown – the body's socket
   * `last` of the frame the rig drew –, above the hair drawn (`hairHeadroom`), the clock in `starRegisters[STARS_TIME]`;
   * nothing without the socket.
   */
  private stars(scene: RenderScene, manifest: AtlasManifest, built: PlayerFigureRig, f: FigureState): void {
    const index = built.rig.bodyFrameIndex;
    if (index < 0) return;
    const top = built.body.sockets['last']?.[index] ?? null;
    if (top === null) return;
    const frame = spriteFrame(built.body, index);
    const r = this.starRegisters;
    r[STARS_X] = f.x + top[0] - frame.ax;
    r[STARS_CROWN] = f.y + top[1] - frame.ay;
    r[STARS_GROUND] = f.heightBase;
    r[STARS_FEET] = f.y;
    r[STARS_HEADROOM] = hairHeadroom(manifest, built.body, built.hair);
    this.stunStars.draw(scene, manifest, r);
  }

  /** The dazzle sparks at the head of the figure drawn as `f` (`PLAYER_DAZZLE`); nothing without the sprite or the socket. */
  private dazzle(scene: RenderScene, manifest: AtlasManifest, built: PlayerFigureRig, f: FigureState, time: number): void {
    const sprite = manifest.sprites[PLAYER_DAZZLE_SPRITE] ?? manifest.sprites[STATUS_SPRITE];
    const clip = sprite?.clips[STATUS_CLIPS.dazzle];
    // The body frame the rig drew (a turned body clip's where it showed one, `FigureRig.bodyFrameIndex`).
    const index = built.rig.bodyFrameIndex;
    if (sprite === undefined || clip === undefined || index < 0) return;
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
   * While fishing the main hand draws no item (the rod is the fishing view's, src/render/game/fishing.ts), yet the rod starts
   * in it: the bare hand's socket of the body frame drawn becomes the hand point the fishing view reads (M7-77; without it
   * the rod would start at a fixed point inside the torso and show only from the shoulder on).
   */
  private rodHand(built: PlayerFigureRig, f: FigureState, out: HandPoint): void {
    const index = built.rig.bodyFrameIndex;
    const point = index < 0 ? null : (built.body.sockets['hand']?.[index] ?? null);
    if (point === null) return;
    socketOffset(spriteFrame(built.body, index), point, false, this.handOffset);
    out.x = f.x + this.handOffset.x + 0.5;
    out.y = f.y + this.handOffset.y + 0.5;
    out.z = f.y - out.y;
    out.drawn = true;
    out.item = false;
  }

  /** The notes over the head of the figure drawn as `f` (`PLAYER_NOTES`); nothing without the sprite or the socket. */
  private notes(scene: RenderScene, manifest: AtlasManifest, built: PlayerFigureRig, f: FigureState, time: number): void {
    const sprite = manifest.sprites[PLAYER_NOTES_SPRITE];
    const index = built.rig.bodyFrameIndex;
    if (sprite === undefined || index < 0) return;
    const top = built.body.sockets['last']?.[index] ?? null;
    if (top === null) return;
    const frame = spriteFrame(built.body, index);
    const x = f.x + top[0] - frame.ax;
    const y = f.y + top[1] - frame.ay - PLAYER_NOTES.liftPx;
    const N = PLAYER_NOTES;
    const newest = Math.floor(time / N.periodSeconds);
    for (let k = 0; k * N.periodSeconds < N.lifeSeconds; k++) {
      const n = newest - k;
      const age = time - n * N.periodSeconds;
      if (age < 0 || age >= N.lifeSeconds) continue;
      const clip = sprite.clips[NOTE_CLIPS[n & 1] as string];
      if (clip === undefined) continue;
      const faded = age > N.lifeSeconds * (1 - N.fadeShare);
      const d = scene.sprite.reset();
      d.frame = spriteFrame(sprite, clip.frames[faded ? 1 : 0] ?? 0);
      d.x = Math.round(x + ((n & 2) === 0 ? -N.sidePx : N.sidePx) + Math.sin(age * N.swayHz * 2 * Math.PI) * N.swayPx);
      d.y = Math.round(y - age * N.risePxPerSecond);
      d.depth = f.y + MARK_DEPTH;
      d.heightBase = f.heightBase + f.y - d.y;
      d.emissiveBoost = N.glow;
      scene.sprites.push(d);
    }
  }

  /**
   * How far a held blow has charged towards the heavy one at simulation tick `tick`, 0–1 (the `attackWindup` of the heavy
   * hold names its ready tick); 1 without a tick or once ready – written to `combatRegs[COMBAT_CHARGE]` (M7-112).
   */
  private charge(tick: number): void {
    const from = this.chargeFrom;
    const to = this.chargeTo;
    const c = tick < 0 || from < 0 || to <= from ? 1 : (tick - from) / (to - from);
    this.combatRegs[COMBAT_CHARGE] = c < 0 ? 0 : c > 1 ? 1 : c;
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
    if (this.loadValid && pose.hand === this.loadHand && off === this.loadOff && offLit === this.loadOffLit && pose.kopf === this.loadKopf && pose.koerper === this.loadKoerper && pose.beine === this.loadBeine && pose.fuesse === this.loadFuesse && pose.appearance === this.loadLook) return this.built;
    this.loadHand = pose.hand;
    this.loadOff = off;
    this.loadOffLit = offLit;
    this.loadKopf = pose.kopf;
    this.loadKoerper = pose.koerper;
    this.loadBeine = pose.beine;
    this.loadFuesse = pose.fuesse;
    this.loadLook = pose.appearance;
    this.loadValid = true;
    const clothing = this.clothingFor(pose);
    const held: HeldLayers = { hand: pose.hand === null ? null : itemLayerSpriteId(pose.hand), offhand: this.offSprite(pose) };
    const look: FigureLook = pose.appearance ?? DRAWN_LOOK;
    const key = `${clothing.map((c) => `${c.slot}:${c.sprite}`).join(',')}|${held.hand ?? ''}|${held.offhand ?? ''}|${look.form}:${look.frisur}:${look.haut}:${look.haar}:${look.oberteil}:${look.hose}`;
    let rig = this.rigs.get(key);
    if (rig === undefined) {
      rig = buildPlayerFigure(manifest, clothing, held, look);
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
