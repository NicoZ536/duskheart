/**
 * Gamepad polling and rumble. The Gamepad API is poll-based, so
 * `pollGamepads()` is called once per frame before `ActionReader.update()`.
 * The getter is injected (`() => navigator.getGamepads()` in the browser).
 */
import type { GamepadLike, InputState } from './state';

export type GamepadGetter = () => ReadonlyArray<GamepadLike | null>;

/** Longest rumble a single call may request (Chromium caps effects at 5 s). */
export const MAX_RUMBLE_MS = 5000;

export interface RumbleEffect {
  /** Duration in milliseconds (clamped to 0..MAX_RUMBLE_MS). */
  readonly durationMs: number;
  /** Low-frequency (heavy) motor, 0..1. */
  readonly strong: number;
  /** High-frequency (light) motor, 0..1. */
  readonly weak: number;
}

function safeList(getGamepads: GamepadGetter): ReadonlyArray<GamepadLike | null> {
  try {
    return getGamepads();
  } catch {
    // getGamepads throws when blocked by a permissions policy; treat as "no gamepads".
    return [];
  }
}

function anyButtonDown(gp: GamepadLike): boolean {
  const buttons = gp.buttons;
  for (let i = 0; i < buttons.length; i++) if (buttons[i]?.pressed) return true;
  return false;
}

/**
 * Poll all gamepads and feed the active one into the state. The active pad is
 * kept while it stays connected; another pad takes over as soon as one of its
 * buttons is pressed (couch hand-over). Returns the active pad or null.
 * Runs every frame, so it walks the list once without allocating.
 */
export function pollGamepads(state: InputState, getGamepads: GamepadGetter): GamepadLike | null {
  const list = safeList(getGamepads);
  let current: GamepadLike | null = null;
  let firstStandard: GamepadLike | null = null;
  let first: GamepadLike | null = null;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!p || !p.connected) continue;
    if (first === null) first = p;
    if (firstStandard === null && p.mapping === 'standard') firstStandard = p;
    if (current === null && p.index === state.pad.index && p.id === state.pad.id) current = p;
  }
  let takingOver: GamepadLike | null = null;
  for (let i = 0; i < list.length && takingOver === null; i++) {
    const p = list[i];
    if (p && p.connected && p !== current && anyButtonDown(p)) takingOver = p;
  }
  const chosen = takingOver ?? current ?? firstStandard ?? first;
  state.applyGamepad(chosen);
  return chosen;
}

/** Fire a rumble effect on a pad if vibration is enabled (setting) and supported. Returns true if started. */
export function vibrate(pad: GamepadLike | null | undefined, effect: RumbleEffect, enabled: boolean): boolean {
  if (!enabled || !pad) return false;
  const actuator = pad.vibrationActuator;
  if (!actuator) return false;
  const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
  const duration = Number.isFinite(effect.durationMs) ? Math.min(MAX_RUMBLE_MS, Math.max(0, effect.durationMs)) : 0;
  if (duration === 0) return false;
  try {
    actuator
      .playEffect('dual-rumble', { duration, startDelay: 0, strongMagnitude: clamp01(effect.strong), weakMagnitude: clamp01(effect.weak) })
      // Rejected when the page is hidden or another effect preempts it: nothing to do.
      .catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/** Rumble the pad that is currently active in `state`. */
export function vibrateActive(
  state: InputState,
  getGamepads: GamepadGetter,
  effect: RumbleEffect,
  enabled: boolean,
): boolean {
  if (!enabled || !state.pad.connected) return false;
  const pad = safeList(getGamepads).find((p) => p !== null && p.index === state.pad.index) ?? null;
  return vibrate(pad, effect, enabled);
}
