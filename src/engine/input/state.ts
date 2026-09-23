/**
 * Raw input state for one frame: keys, mouse, wheel, gamepad and touch.
 *
 * Event adapters (`dom.ts`, `gamepad.ts`, the touch UI) write into it; the
 * `ActionReader` turns it into actions. Edges (pressed/released) accumulate
 * until `endFrame()` so that a key tapped and released between two frames is
 * still seen as pressed once.
 */
import type { Action } from './actions';

export type DeviceType = 'keyboard' | 'gamepad' | 'touch';
export type TouchStickId = 'move' | 'aim';
export type Modifier = 'ctrl' | 'shift' | 'alt';

export interface Vec2 {
  x: number;
  y: number;
}

/** Default radial deadzone of analog sticks (fraction of full deflection). */
export const DEFAULT_STICK_DEADZONE = 0.2;
/** Upper limit for a configurable deadzone; beyond this a stick becomes unusable. */
export const MAX_STICK_DEADZONE = 0.9;
/** Analog button value at which a gamepad button (e.g. a trigger) counts as held. */
export const BUTTON_PRESS_THRESHOLD = 0.5;
/** Deflection (after deadzone) at which stick movement marks the gamepad as the active device. */
export const GAMEPAD_ACTIVITY_THRESHOLD = 0.35;
/** Pixel-mode wheel delta per wheel notch (Chromium and Safari report 100 px per notch). */
export const WHEEL_PIXELS_PER_STEP = 100;
/** Line-mode wheel delta per wheel notch (Firefox reports 3 lines per notch). */
export const WHEEL_LINES_PER_STEP = 3;
/** Page-mode wheel delta per wheel notch. */
export const WHEEL_PAGES_PER_STEP = 1;
/** Mouse travel (CSS px) needed to switch button prompts back to keyboard/mouse (ignores jitter). */
export const MOUSE_DEVICE_SWITCH_PX = 4;
/** Number of gamepad axes tracked (standard mapping uses 4; some pads expose triggers as axes). */
export const PAD_AXIS_SLOTS = 16;
/** Number of gamepad buttons tracked (standard mapping uses 17). */
export const PAD_BUTTON_SLOTS = 32;

/** DOM `WheelEvent.deltaMode` values. */
export const WHEEL_DELTA_PIXEL = 0;
export const WHEEL_DELTA_LINE = 1;
export const WHEEL_DELTA_PAGE = 2;

const MODIFIER_CODES: Readonly<Record<Modifier, readonly string[]>> = {
  // Meta counts as Ctrl so that Cmd+Z works on macOS.
  ctrl: ['ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight'],
  shift: ['ShiftLeft', 'ShiftRight'],
  alt: ['AltLeft', 'AltRight'],
};

/** Minimal structural view of `Gamepad` (tests pass plain objects). */
export interface GamepadButtonLike {
  readonly pressed: boolean;
  readonly value: number;
}
export interface GamepadHapticsLike {
  playEffect(
    type: 'dual-rumble',
    params: { duration: number; startDelay?: number; strongMagnitude: number; weakMagnitude: number },
  ): Promise<unknown>;
}
export interface GamepadLike {
  readonly id: string;
  readonly index: number;
  readonly connected: boolean;
  readonly mapping?: string;
  readonly axes: readonly number[];
  readonly buttons: readonly GamepadButtonLike[];
  readonly vibrationActuator?: GamepadHapticsLike | null;
}

/**
 * Radial deadzone: magnitudes below `deadzone` become 0, the rest is rescaled
 * to 0..1 so there is no jump at the edge. Direction is preserved.
 */
export function applyRadialDeadzone(x: number, y: number, deadzone: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
  const mag = Math.hypot(x, y);
  if (!Number.isFinite(mag) || mag <= deadzone || mag === 0) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const scaled = Math.min(1, (mag - deadzone) / (1 - deadzone));
  out.x = (x / mag) * scaled;
  out.y = (y / mag) * scaled;
  return out;
}

/** Deadzone for a single axis (used for axes that are not part of a stick pair). */
export function applyAxialDeadzone(v: number, deadzone: number): number {
  const mag = Math.abs(v);
  if (!Number.isFinite(mag) || mag <= deadzone) return 0;
  return Math.sign(v) * Math.min(1, (mag - deadzone) / (1 - deadzone));
}

/** Clamp a vector to the unit circle (in place). */
function clampUnit(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  if (len > 1) {
    v.x /= len;
    v.y /= len;
  }
  return v;
}

export interface MouseState {
  /** Position relative to the input target, CSS pixels. */
  cssX: number;
  cssY: number;
  /** Position in internal render pixels (set via the renderer's mapper). */
  x: number;
  y: number;
  /** Relative movement this frame (CSS px, includes pointer-lock movement). */
  dx: number;
  dy: number;
  /** Whether the pointer is over the input target. */
  inside: boolean;
}

export interface PadState {
  connected: boolean;
  index: number;
  id: string;
  mapping: string;
  axisCount: number;
  buttonCount: number;
  /** Deadzone-processed axes (sticks radially). */
  readonly axes: Float32Array;
  /** Analog button values 0..1. */
  readonly buttons: Float32Array;
  readonly buttonsDown: Set<number>;
  readonly buttonsPressed: Set<number>;
  readonly buttonsReleased: Set<number>;
}

/** Maps CSS pixel coordinates to internal render pixels (provided by the renderer). */
export type MouseMapper = (cssX: number, cssY: number, out: Vec2) => void;

export class InputState {
  readonly keysDown = new Set<string>();
  readonly keysPressed = new Set<string>();
  readonly keysReleased = new Set<string>();

  readonly mouse: MouseState = { cssX: 0, cssY: 0, x: 0, y: 0, dx: 0, dy: 0, inside: false };
  readonly mouseDown = new Set<number>();
  readonly mousePressed = new Set<number>();
  readonly mouseReleased = new Set<number>();
  /** Completed wheel notches this frame, per direction. */
  wheelUp = 0;
  wheelDown = 0;

  readonly pad: PadState = {
    connected: false,
    index: -1,
    id: '',
    mapping: '',
    axisCount: 0,
    buttonCount: 0,
    axes: new Float32Array(PAD_AXIS_SLOTS),
    buttons: new Float32Array(PAD_BUTTON_SLOTS),
    buttonsDown: new Set<number>(),
    buttonsPressed: new Set<number>(),
    buttonsReleased: new Set<number>(),
  };

  readonly touchSticks: Record<TouchStickId, Vec2> = { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 } };
  readonly touchButtonsDown = new Set<Action>();
  readonly touchButtonsPressed = new Set<Action>();
  readonly touchButtonsReleased = new Set<Action>();

  /** Device of the most recent meaningful input (drives button prompts). */
  lastDevice: DeviceType = 'keyboard';

  private deadzoneValue = DEFAULT_STICK_DEADZONE;
  private wheelRemainder = 0;
  private mouseTravel = 0;
  private mapper: MouseMapper | null = null;
  private readonly scratch: Vec2 = { x: 0, y: 0 };

  get deadzone(): number {
    return this.deadzoneValue;
  }

  /** Configure the stick deadzone (clamped to 0..MAX_STICK_DEADZONE). */
  setDeadzone(value: number): void {
    this.deadzoneValue = Number.isFinite(value) ? Math.min(MAX_STICK_DEADZONE, Math.max(0, value)) : DEFAULT_STICK_DEADZONE;
  }

  // -- keyboard -------------------------------------------------------------

  /** Key went down. Auto-repeat events (`repeat`) produce no new edge. */
  keyDown(code: string, repeat = false): void {
    this.lastDevice = 'keyboard';
    if (repeat || this.keysDown.has(code)) return;
    this.keysDown.add(code);
    this.keysPressed.add(code);
  }

  keyUp(code: string): void {
    if (!this.keysDown.delete(code)) return;
    this.keysReleased.add(code);
  }

  /** Whether any key of the modifier is held (called per frame by the reader: no allocation). */
  modifierDown(mod: Modifier): boolean {
    const codes = MODIFIER_CODES[mod];
    for (let i = 0; i < codes.length; i++) if (this.keysDown.has(codes[i] as string)) return true;
    return false;
  }

  // -- mouse ----------------------------------------------------------------

  /** Install the renderer's CSS → internal pixel mapping and remap the current position. */
  setMouseMapper(mapper: MouseMapper | null): void {
    this.mapper = mapper;
    this.remapMouse();
  }

  /** Recompute internal coordinates (call after the canvas was resized). */
  remapMouse(): void {
    if (this.mapper) {
      this.mapper(this.mouse.cssX, this.mouse.cssY, this.scratch);
      this.mouse.x = this.scratch.x;
      this.mouse.y = this.scratch.y;
    } else {
      this.mouse.x = this.mouse.cssX;
      this.mouse.y = this.mouse.cssY;
    }
  }

  /** Pointer moved to (cssX, cssY) relative to the target; movement deltas are optional (pointer lock). */
  mouseMove(cssX: number, cssY: number, movementX?: number, movementY?: number): void {
    const dx = movementX ?? cssX - this.mouse.cssX;
    const dy = movementY ?? cssY - this.mouse.cssY;
    this.mouse.cssX = cssX;
    this.mouse.cssY = cssY;
    this.mouse.dx += dx;
    this.mouse.dy += dy;
    this.mouse.inside = true;
    this.remapMouse();
    if (this.lastDevice !== 'keyboard') {
      this.mouseTravel += Math.hypot(dx, dy);
      if (this.mouseTravel >= MOUSE_DEVICE_SWITCH_PX) {
        this.lastDevice = 'keyboard';
        this.mouseTravel = 0;
      }
    }
  }

  mouseLeave(): void {
    this.mouse.inside = false;
  }

  mouseButtonDown(button: number): void {
    this.lastDevice = 'keyboard';
    if (this.mouseDown.has(button)) return;
    this.mouseDown.add(button);
    this.mousePressed.add(button);
  }

  mouseButtonUp(button: number): void {
    if (!this.mouseDown.delete(button)) return;
    this.mouseReleased.add(button);
  }

  /**
   * Accumulate wheel movement. `deltaMode` follows `WheelEvent`
   * (0 pixels, 1 lines, 2 pages). Trackpads send many small deltas; they are
   * summed until a full notch is reached.
   */
  wheel(deltaY: number, deltaMode: number = WHEEL_DELTA_PIXEL): void {
    if (!Number.isFinite(deltaY) || deltaY === 0) return;
    this.lastDevice = 'keyboard';
    const perStep =
      deltaMode === WHEEL_DELTA_LINE ? WHEEL_LINES_PER_STEP : deltaMode === WHEEL_DELTA_PAGE ? WHEEL_PAGES_PER_STEP : WHEEL_PIXELS_PER_STEP;
    const notches = deltaY / perStep;
    // A direction change discards the partial notch in the old direction.
    if (Math.sign(notches) !== Math.sign(this.wheelRemainder)) this.wheelRemainder = 0;
    this.wheelRemainder += notches;
    while (this.wheelRemainder >= 1) {
      this.wheelDown++;
      this.wheelRemainder -= 1;
    }
    while (this.wheelRemainder <= -1) {
      this.wheelUp++;
      this.wheelRemainder += 1;
    }
  }

  // -- gamepad --------------------------------------------------------------

  /** Copy one polled gamepad into the state (null = no gamepad). Computes edges and deadzones. */
  applyGamepad(gp: GamepadLike | null): void {
    const pad = this.pad;
    if (!gp || !gp.connected) {
      if (pad.connected) this.releasePad();
      pad.connected = false;
      pad.index = -1;
      pad.id = '';
      pad.mapping = '';
      return;
    }
    if (pad.connected && (pad.index !== gp.index || pad.id !== gp.id)) this.releasePad();
    pad.connected = true;
    pad.index = gp.index;
    pad.id = gp.id;
    pad.mapping = gp.mapping ?? '';

    let active = false;
    const axisCount = Math.min(gp.axes.length, PAD_AXIS_SLOTS);
    pad.axisCount = axisCount;
    for (let i = 0; i < axisCount; i += 2) {
      const ax = gp.axes[i] ?? 0;
      if (i + 1 < axisCount && i < 4) {
        // Standard mapping: (0,1) left stick, (2,3) right stick → radial deadzone.
        applyRadialDeadzone(ax, gp.axes[i + 1] ?? 0, this.deadzoneValue, this.scratch);
        pad.axes[i] = this.scratch.x;
        pad.axes[i + 1] = this.scratch.y;
      } else {
        pad.axes[i] = applyAxialDeadzone(ax, this.deadzoneValue);
        if (i + 1 < axisCount) pad.axes[i + 1] = applyAxialDeadzone(gp.axes[i + 1] ?? 0, this.deadzoneValue);
      }
    }
    for (let i = axisCount; i < PAD_AXIS_SLOTS; i++) pad.axes[i] = 0;
    for (let i = 0; i < axisCount; i++) {
      if (Math.abs(pad.axes[i] ?? 0) >= GAMEPAD_ACTIVITY_THRESHOLD) active = true;
    }

    const buttonCount = Math.min(gp.buttons.length, PAD_BUTTON_SLOTS);
    pad.buttonCount = buttonCount;
    for (let i = 0; i < PAD_BUTTON_SLOTS; i++) {
      const b = i < buttonCount ? gp.buttons[i] : undefined;
      const value = b ? (Number.isFinite(b.value) ? Math.min(1, Math.max(0, b.value)) : 0) : 0;
      const down = b ? b.pressed || value >= BUTTON_PRESS_THRESHOLD : false;
      pad.buttons[i] = b?.pressed && value === 0 ? 1 : value;
      if (down && !pad.buttonsDown.has(i)) {
        pad.buttonsDown.add(i);
        pad.buttonsPressed.add(i);
        active = true;
      } else if (!down && pad.buttonsDown.has(i)) {
        pad.buttonsDown.delete(i);
        pad.buttonsReleased.add(i);
      }
    }
    if (active) {
      this.lastDevice = 'gamepad';
      this.mouseTravel = 0;
    }
  }

  private releasePad(): void {
    const pad = this.pad;
    for (const b of pad.buttonsDown) pad.buttonsReleased.add(b);
    pad.buttonsDown.clear();
    pad.axes.fill(0);
    pad.buttons.fill(0);
  }

  // -- touch ----------------------------------------------------------------

  /** Set a virtual stick (values in −1..1, clamped to the unit circle). */
  setTouchStick(id: TouchStickId, x: number, y: number): void {
    const s = this.touchSticks[id];
    s.x = Number.isFinite(x) ? x : 0;
    s.y = Number.isFinite(y) ? y : 0;
    clampUnit(s);
    if (s.x !== 0 || s.y !== 0) this.lastDevice = 'touch';
  }

  /** A contextual on-screen action button was pressed or released. */
  setTouchButton(action: Action, down: boolean): void {
    if (down) {
      this.lastDevice = 'touch';
      if (this.touchButtonsDown.has(action)) return;
      this.touchButtonsDown.add(action);
      this.touchButtonsPressed.add(action);
    } else if (this.touchButtonsDown.delete(action)) {
      this.touchButtonsReleased.add(action);
    }
  }

  /** Mark touch as the active device (e.g. on any touch start). */
  noteTouch(): void {
    this.lastDevice = 'touch';
  }

  // -- lifecycle ------------------------------------------------------------

  /** Release everything that is held (window blur, tab switch). Produces released edges. */
  releaseAll(): void {
    for (const k of this.keysDown) this.keysReleased.add(k);
    this.keysDown.clear();
    for (const b of this.mouseDown) this.mouseReleased.add(b);
    this.mouseDown.clear();
    for (const a of this.touchButtonsDown) this.touchButtonsReleased.add(a);
    this.touchButtonsDown.clear();
    this.touchSticks.move.x = 0;
    this.touchSticks.move.y = 0;
    this.touchSticks.aim.x = 0;
    this.touchSticks.aim.y = 0;
    this.wheelRemainder = 0;
  }

  /** Clear per-frame edges and deltas. Call once at the end of every frame. */
  endFrame(): void {
    clearIfUsed(this.keysPressed);
    clearIfUsed(this.keysReleased);
    clearIfUsed(this.mousePressed);
    clearIfUsed(this.mouseReleased);
    this.wheelUp = 0;
    this.wheelDown = 0;
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    clearIfUsed(this.pad.buttonsPressed);
    clearIfUsed(this.pad.buttonsReleased);
    clearIfUsed(this.touchButtonsPressed);
    clearIfUsed(this.touchButtonsReleased);
  }
}

/**
 * Empties a per-frame edge set. `Set.prototype.clear` gives the set a fresh hash table in V8, so an
 * empty set is left alone: a frame without input edges allocates nothing (§30 no allocation per frame).
 */
function clearIfUsed<T>(set: Set<T>): void {
  if (set.size > 0) set.clear();
}
