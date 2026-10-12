/**
 * The player's figure in a fight (M6-38, M6-38a, render part of M6-01; MASTERPROMPT §19.1 "Sprites in 4 Richtungen, Waffen
 * frei rotiert (Rotation im Low-Res-Puffer, pixelgenau)", §4.5 "Angriff je Waffenklasse 4–6 … Smear-Frames"; docs/SPIEL.md
 * §13): which body clip of the armoury (`assets-src/sprites/figuren/_spieler_kampf.ts`) the figure shows, where in it, and
 * how far the weapon in the hand turns – all read from `GameSession.sampleCombat` (pure functions; `playerFigure.ts`
 * applies them, `tests/unit/render/kampf-clips.test.ts` checks them).
 *
 * - **Clip per phase** (`combatPose`): winding up a light blow → `attack_<klasse>` up to the frame before its strike
 *   event, stretched over the wind-up ticks; charging the heavy blow → `heavy_<klasse>` (the deeper anticipation) up to
 *   the frame before its strike, over the charge until the heavy blow is ready; drawing a bow or sling, winding up a
 *   throw → `attack_<klasse>` over the tension; recovering → the clip of the blow (heavy or light) from its strike frame
 *   to its end over the recovery ticks – the smear frame (`schwung`, `sehne`, `wurf`, `abzug`) stands on the very tick the
 *   blow lands or the shot leaves; blocking → `block` (its loop). A tool used as a weapon has no combat clips of its own:
 *   the figure swings it with the tool clip (`tool`, strike `treffer`). Reloading a crossbow keeps the movement clip.
 * - **Weapon rotation** (`handAngle`): while the facing follows the aim (fighting, aiming, blocking), the item in the main
 *   hand turns about its grip by the difference between the aim angle and the angle of the facing (at most the facing's
 *   quarter plus the hysteresis): the sprite frames are drawn for four directions, the rotation in the low-res G-buffer
 *   points them exactly at the cursor, pixel for pixel (nearest texel, no filtering). A reloading crossbow tips down.
 */
import { BALANCE } from '../../content/balance';
import { WEAPON_CLASSES, type WeaponClass } from '../../content/balance/tools';
import { FACING_ANGLE, FULL_TURN, degToRad } from '../../game/combat/formulas';
import type { CombatSample } from '../../game/combat/sample';
import type { Facing } from '../../game/player/state';
import type { AnimationClip } from '../anim/animation';

/** Body clip of a light attack of class `k` (`attack_<klasse>`) and of a heavy one (`heavy_<klasse>`). */
export const ATTACK_ACTION: Readonly<Record<WeaponClass, string>> = Object.fromEntries(WEAPON_CLASSES.map((k) => [k, `attack_${k}`])) as Record<WeaponClass, string>;
export const HEAVY_ACTION: Readonly<Record<WeaponClass, string>> = Object.fromEntries(WEAPON_CLASSES.map((k) => [k, `heavy_${k}`])) as Record<WeaponClass, string>;
/** The guard (`block_<richtung>`, a loop). */
export const BLOCK_ACTION = 'block';
/** The tool swing (M3-06): an improvised weapon without combat clips swings with it. */
export const TOOL_ACTION = 'tool';
/** Every combat action a player body may carry (the rig resolves the ones the atlas has). */
export const COMBAT_ACTIONS: readonly string[] = [...WEAPON_CLASSES.map((k) => ATTACK_ACTION[k]), ...WEAPON_CLASSES.map((k) => HEAVY_ACTION[k]), BLOCK_ACTION];
/** Clip events that mark the moment a blow lands or a shot leaves (the smear frame), in order of preference. */
export const STRIKE_EVENTS: readonly string[] = ['schwung', 'sehne', 'wurf', 'abzug', 'treffer'];

/** How far the hand's item may turn from its facing's axis [rad]: half a quarter plus the facing's hysteresis. */
export const MAX_HAND_ANGLE = Math.PI / 4 + degToRad(BALANCE.combat.aim.facingHysteresisDeg);
/** A reloading crossbow tips its front down by this angle [rad] at the middle of the reload (§19.2 "Armbrust: Nachladen"). */
export const RELOAD_TILT = 0.9;

/** Stages of a combat clip: which part of it the phase plays. */
export type CombatStage = 'none' | 'windup' | 'charge' | 'draw' | 'follow' | 'block';

/** What the figure shows of the fight in one frame (a record the caller owns). */
export interface CombatPose {
  /** Body action (`attack_schwert`, `block` …), or null: the movement or activity clip. */
  action: string | null;
  stage: CombatStage;
  /** Progress 0–1 through the stage (wind-up, charge, tension, recovery); the block's seconds for `block`. */
  progress: number;
  /** Rotation of the item in the main hand about its grip [rad, clockwise on screen]. */
  handAngle: number;
}

export function createCombatPose(): CombatPose {
  return { action: null, stage: 'none', progress: 0, handAngle: 0 };
}

/**
 * Slots of the combat registers of a figure (M7-112, ADR-0167: no floating-point value goes through a call of the frame path,
 * and none is read from a sample whose shape the reading site does not know): the charge 0–1 of a held blow and the
 * sample's fractional values (`combatRegisters` copies them, `combatPoseIn` reads them), the clip time [s] that
 * `combatClipTimeOf` writes, the weapon's rotation [rad] that `handAngleIn` writes, the stage's progress that `combatPoseIn`
 * writes beside `CombatPose.progress` and `combatClipTimeOf` reads.
 */
export const COMBAT_CHARGE = 0;
export const COMBAT_CLIP_TIME = 1;
export const COMBAT_PHASE_PROGRESS = 2;
export const COMBAT_TENSION = 3;
export const COMBAT_BLOCK_SECONDS = 4;
export const COMBAT_AIM_ANGLE = 5;
export const COMBAT_HAND_ANGLE = 6;
export const COMBAT_PROGRESS = 7;
export const COMBAT_REGISTERS = 8;

/**
 * Copies the fractional values of `sample` that `combatPoseIn` reads into `regs`. The figure copies them where it owns the
 * sample (one shape: its loads stay inline); a load site that has seen many sample shapes is generic, and a generic load
 * of a fractional field is a new heap number (M7-112).
 */
export function combatRegisters(sample: Readonly<CombatSample>, regs: Float64Array): void {
  regs[COMBAT_PHASE_PROGRESS] = sample.phaseProgress;
  regs[COMBAT_TENSION] = sample.tension;
  regs[COMBAT_BLOCK_SECONDS] = sample.blockSeconds;
  regs[COMBAT_AIM_ANGLE] = sample.aimAngle;
}
/** Registers and a pose for the pure forms (`combatPose`, `combatClipTime`): filled and read within one call. */
const SCRATCH = new Float64Array(COMBAT_REGISTERS);
const SCRATCH_POSE = createCombatPose();

/** Whether a clip action can be shown: the body has it and the item in the hand (if any) carries it too. */
export type ActionCheck = (action: string) => boolean;

/** `FACING_ANGLE` of each facing as module constants (`facingAngle`). */
const ANGLE_RIGHT = FACING_ANGLE.right;
const ANGLE_DOWN = FACING_ANGLE.down;
const ANGLE_LEFT = FACING_ANGLE.left;
const ANGLE_UP = FACING_ANGLE.up;

/**
 * `FACING_ANGLE[facing]` without a keyed load (M7-112): read with the facing as key, a load site that has seen two facings
 * is generic, and a generic load of a fractional field is a new heap number every frame of a fight.
 */
function facingAngle(facing: Facing): number {
  return facing === 'right' ? ANGLE_RIGHT : facing === 'down' ? ANGLE_DOWN : facing === 'left' ? ANGLE_LEFT : ANGLE_UP;
}

/**
 * The weapon's rotation for aim angle `aim` [rad] while facing `facing`: the difference to the facing's angle, clamped
 * to `MAX_HAND_ANGLE` (the hysteresis lets the aim leave the facing's quarter by a little before the sprite turns).
 */
export function handAngleFor(aim: number, facing: Facing): number {
  SCRATCH[COMBAT_AIM_ANGLE] = aim;
  handAngleIn(SCRATCH, facing);
  return SCRATCH[COMBAT_HAND_ANGLE] as number;
}

/**
 * `handAngleFor` in the registers: the aim angle from `regs[COMBAT_AIM_ANGLE]`, the rotation into `regs[COMBAT_HAND_ANGLE]`
 * (M7-112: the aim crosses no call as a number – passed to a call the frame does not inline, a fractional value is a new
 * heap number). The difference is wrapped into (−π, π] here, as `wrapAngle` (game/combat/formulas.ts) does.
 */
export function handAngleIn(regs: Float64Array, facing: Facing): void {
  let d = ((regs[COMBAT_AIM_ANGLE] as number) - facingAngle(facing)) % FULL_TURN;
  if (d <= -Math.PI) d += FULL_TURN;
  else if (d > Math.PI) d -= FULL_TURN;
  regs[COMBAT_HAND_ANGLE] = d > MAX_HAND_ANGLE ? MAX_HAND_ANGLE : d < -MAX_HAND_ANGLE ? -MAX_HAND_ANGLE : d;
}

/**
 * The combat pose of the player from `sample` (`GameSession.sampleCombat`): body action, stage and its progress, the
 * weapon's rotation. `facing` is the body's facing, `can` tells which actions the loadout can show, `charge` 0–1 how far
 * the held blow has charged towards the heavy one (the presentation times it from `attackWindup`). Fills and returns `out`.
 */
export function combatPose(sample: Readonly<CombatSample>, facing: Facing, can: ActionCheck, charge: number, out: CombatPose): CombatPose {
  SCRATCH[COMBAT_CHARGE] = charge;
  combatRegisters(sample, SCRATCH);
  return combatPoseIn(sample, facing, can, SCRATCH, out);
}

/**
 * `combatPose` with the charge and the sample's fractional values read from `regs` (`COMBAT_*`, filled by `combatRegisters`;
 * the figure's frame path, M7-112). Fills and returns `out`; the progress also in `regs[COMBAT_PROGRESS]`, where
 * `combatClipTimeOf` reads it.
 */
export function combatPoseIn(sample: Readonly<CombatSample>, facing: Facing, can: ActionCheck, regs: Float64Array, out: CombatPose): CombatPose {
  out.action = null;
  out.stage = 'none';
  out.progress = 0;
  out.handAngle = 0;
  regs[COMBAT_PROGRESS] = 0;
  if (!sample.present) return out;
  const k = sample.klasse;
  switch (sample.phase) {
    case 'ausholen':
      out.action = attackOrTool(ATTACK_ACTION[k], can);
      out.stage = 'windup';
      regs[COMBAT_PROGRESS] = regs[COMBAT_PHASE_PROGRESS] as number;
      break;
    case 'aufladen': {
      out.action = can(HEAVY_ACTION[k]) ? HEAVY_ACTION[k] : attackOrTool(ATTACK_ACTION[k], can);
      out.stage = 'charge';
      const charge = regs[COMBAT_CHARGE] as number;
      regs[COMBAT_PROGRESS] = charge < 0 ? 0 : charge > 1 ? 1 : charge;
      break;
    }
    case 'spannen':
      out.action = attackOrTool(ATTACK_ACTION[k], can);
      out.stage = 'draw';
      regs[COMBAT_PROGRESS] = regs[COMBAT_TENSION] as number;
      break;
    case 'erholung':
      out.action = sample.heavy && can(HEAVY_ACTION[k]) ? HEAVY_ACTION[k] : attackOrTool(ATTACK_ACTION[k], can);
      out.stage = 'follow';
      regs[COMBAT_PROGRESS] = regs[COMBAT_PHASE_PROGRESS] as number;
      break;
    case 'nachladen':
      // No clip of its own: the movement clip, the crossbow tipped down while the bolt goes in (and up again).
      out.stage = 'none';
      regs[COMBAT_PROGRESS] = regs[COMBAT_PHASE_PROGRESS] as number;
      out.progress = regs[COMBAT_PROGRESS] as number;
      out.handAngle = (facing === 'left' ? -RELOAD_TILT : RELOAD_TILT) * Math.sin(Math.PI * Math.min(1, regs[COMBAT_PHASE_PROGRESS] as number));
      return out;
    case 'bereit':
      if (sample.blockKind === 'block' && can(BLOCK_ACTION)) {
        out.action = BLOCK_ACTION;
        out.stage = 'block';
        regs[COMBAT_PROGRESS] = regs[COMBAT_BLOCK_SECONDS] as number;
      }
      break;
  }
  out.progress = regs[COMBAT_PROGRESS] as number;
  if (out.action === null) out.stage = 'none';
  if (sample.fighting && sample.aimed) {
    handAngleIn(regs, facing);
    out.handAngle = regs[COMBAT_HAND_ANGLE] as number;
  }
  return out;
}

/** The attack clip `action`, else the tool swing (an improvised weapon), else none. */
function attackOrTool(action: string, can: ActionCheck): string | null {
  if (can(action)) return action;
  return can(TOOL_ACTION) ? TOOL_ACTION : null;
}

/** Position of the strike event of `clip` (the smear frame): the first of `STRIKE_EVENTS` it carries, else its middle. */
export function strikePosition(clip: AnimationClip): number {
  const events = clip.events;
  if (events !== undefined) {
    for (let k = 0; k < STRIKE_EVENTS.length; k++) {
      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        if (e !== undefined && e.name === STRIKE_EVENTS[k]) return e.frame;
      }
    }
  }
  return Math.floor(clip.frames.length / 2);
}

/**
 * Clip time [s] of `clip` for stage `stage` at `progress`: wind-up, charge and draw run through the positions before the
 * strike (the last of them held at full charge or tension), the recovery from the strike to the clip's end; the block
 * loops on its seconds. Times sit in the middle of a frame, so rounding never shows the neighbour.
 */
export function combatClipTime(clip: AnimationClip, stage: CombatStage, progress: number): number {
  SCRATCH_POSE.stage = stage;
  SCRATCH_POSE.progress = progress;
  SCRATCH[COMBAT_PROGRESS] = progress;
  combatClipTimeOf(clip, SCRATCH_POSE, SCRATCH);
  return SCRATCH[COMBAT_CLIP_TIME] as number;
}

/**
 * `combatClipTime` of the stage of `pose` at the progress in `regs[COMBAT_PROGRESS]` (`combatPoseIn` writes both), written to
 * `regs[COMBAT_CLIP_TIME]` (the figure's frame path, M7-112: neither the progress nor the time goes through the call as a
 * number, and the progress is not read from a pose field – a load site that has seen poses of several shapes is generic, and
 * a generic load of a fractional field is a new heap number).
 */
export function combatClipTimeOf(clip: AnimationClip, pose: Readonly<CombatPose>, regs: Float64Array): void {
  const progress = regs[COMBAT_PROGRESS] as number;
  // Every stage runs through the same clamp and the same store: the block (the guard loops on its seconds) only skips the
  // positions. A store or a compare of its own would have no type feedback until the first guard – and the optimized code,
  // built from the blows before, would fall back to the interpreter there, which boxes the fractions until the compiler
  // has rebuilt it (M7-112; seconds under a loaded machine).
  const lower = progress < 0 ? 0 : progress;
  let time = lower;
  if (pose.stage !== 'block') {
    const n = clip.frames.length;
    const strike = strikePosition(clip);
    const p = lower > 1 ? 1 : lower;
    let position: number;
    if (pose.stage === 'follow') position = Math.min(n - 1, strike + Math.floor(p * (n - strike)));
    else position = strike <= 0 ? 0 : Math.min(strike - 1, Math.floor(p * strike));
    time = (position + 1 / 2) / clip.fps;
  }
  regs[COMBAT_CLIP_TIME] = time;
}
