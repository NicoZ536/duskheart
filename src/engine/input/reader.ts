/**
 * ActionReader: turns raw `InputState` + `BindingSet` into per-frame action
 * states (held / pressed / released / analog value), respecting the current
 * input context and the hold/toggle settings for sprint, sneak and block.
 *
 * Frame order: adapters write into the state → `pollGamepads()` →
 * `reader.update()` → game reads actions → `state.endFrame()`.
 */
import {
  ACTIONS,
  ACTION_INDEX,
  isActionActive,
  isModalAction,
  MODAL_ACTIONS,
  type Action,
  type ActivationMode,
  type InputContext,
  type ModalAction,
} from './actions';
import { bindingDevice, type Binding, type BindingSet, type GamepadFamily } from './bindings';
import type { DeviceType, InputState, TouchStickId, Vec2 } from './state';

/** Analog value (after deadzone) at which an axis or stick direction counts as held. */
export const ANALOG_DOWN_THRESHOLD = 0.5;
/** Minimum cursor distance (internal px) from the player before the mouse defines the aim direction. */
export const MIN_MOUSE_AIM_DISTANCE = 1;
/** Facing used before any aim input was seen (down / towards the camera). */
export const DEFAULT_AIM_DIRECTION: Readonly<Vec2> = { x: 0, y: 1 };
/** Sensitivity multipliers are clamped to this range. */
export const MIN_SENSITIVITY = 0.1;
export const MAX_SENSITIVITY = 5;

/** Which touch stick feeds which directional action, and along which axis/sign. */
const TOUCH_STICK_ACTIONS: Partial<Record<Action, { stick: TouchStickId; axis: 'x' | 'y'; sign: -1 | 1 }>> = {
  moveUp: { stick: 'move', axis: 'y', sign: -1 },
  moveDown: { stick: 'move', axis: 'y', sign: 1 },
  moveLeft: { stick: 'move', axis: 'x', sign: -1 },
  moveRight: { stick: 'move', axis: 'x', sign: 1 },
  aimUp: { stick: 'aim', axis: 'y', sign: -1 },
  aimDown: { stick: 'aim', axis: 'y', sign: 1 },
  aimLeft: { stick: 'aim', axis: 'x', sign: -1 },
  aimRight: { stick: 'aim', axis: 'x', sign: 1 },
};

/**
 * Detect the controller family from `Gamepad.id` for button symbols.
 * Chromium: "… (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)", Firefox: "054c-0ce6-…".
 */
export function detectGamepadFamily(id: string): GamepadFamily {
  const s = id.toLowerCase();
  if (/playstation|dualshock|dualsense|sony|vendor:\s*054c|^054c-/.test(s)) return 'playstation';
  if (/xbox|xinput|microsoft|vendor:\s*045e|^045e-/.test(s)) return 'xbox';
  return 'generic';
}

export interface ActionReaderOptions {
  readonly context?: InputContext;
  readonly modes?: Partial<Record<ModalAction, ActivationMode>>;
  readonly mouseSensitivity?: number;
  readonly stickSensitivity?: number;
}

function clampSensitivity(v: number): number {
  return Number.isFinite(v) ? Math.min(MAX_SENSITIVITY, Math.max(MIN_SENSITIVITY, v)) : 1;
}

export class ActionReader {
  readonly state: InputState;
  bindings: BindingSet;

  private ctx: InputContext;
  private readonly modes: Record<ModalAction, ActivationMode> = { sprint: 'hold', sneak: 'hold', block: 'hold' };
  private mouseSens = 1;
  private stickSens = 1;

  // Per-action frame results (typed arrays: no allocation per frame).
  private readonly values = new Float32Array(ACTIONS.length);
  private readonly downs = new Uint8Array(ACTIONS.length);
  private readonly presses = new Uint16Array(ACTIONS.length);
  private readonly releases = new Uint8Array(ACTIONS.length);
  private readonly rawPresses = new Uint16Array(ACTIONS.length);
  private readonly prevAnalogDown = new Uint8Array(ACTIONS.length);
  private readonly latched = new Uint8Array(ACTIONS.length);

  private readonly lastAim: Vec2 = { x: DEFAULT_AIM_DIRECTION.x, y: DEFAULT_AIM_DIRECTION.y };
  private familyCacheId = '';
  private familyCache: GamepadFamily = 'generic';

  constructor(state: InputState, bindings: BindingSet, opts: ActionReaderOptions = {}) {
    this.state = state;
    this.bindings = bindings;
    this.ctx = opts.context ?? 'play';
    for (const a of MODAL_ACTIONS) {
      const m = opts.modes?.[a];
      if (m) this.modes[a] = m;
    }
    this.setSensitivity(opts.mouseSensitivity ?? 1, opts.stickSensitivity ?? 1);
  }

  get context(): InputContext {
    return this.ctx;
  }

  /** Switch input context (play / build / ui). Toggle latches of actions inactive in the new context are released. */
  setContext(context: InputContext): void {
    if (context === this.ctx) return;
    this.ctx = context;
    for (const a of ACTIONS) if (!isActionActive(a, context)) this.latched[ACTION_INDEX[a]] = 0;
  }

  mode(action: ModalAction): ActivationMode {
    return this.modes[action];
  }

  /** Hold vs toggle for sprint/sneak/block (setting). Changing the mode clears the latch. */
  setMode(action: ModalAction, mode: ActivationMode): void {
    this.modes[action] = mode;
    this.latched[ACTION_INDEX[action]] = 0;
  }

  setSensitivity(mouse: number, stick: number): void {
    this.mouseSens = clampSensitivity(mouse);
    this.stickSens = clampSensitivity(stick);
  }

  /** Device of the most recent input (for button prompts). */
  get lastDevice(): DeviceType {
    return this.state.lastDevice;
  }

  /** Controller family for button symbols. */
  get gamepadFamily(): GamepadFamily {
    const id = this.state.pad.id;
    if (id !== this.familyCacheId) {
      this.familyCacheId = id;
      this.familyCache = detectGamepadFamily(id);
    }
    return this.familyCache;
  }

  /** The binding to show in prompts for the active device ("[E] Pick up" / "[A] Pick up"). */
  promptBinding(action: Action): Binding | undefined {
    const device = this.state.lastDevice === 'gamepad' ? 'gamepad' : 'keyboardMouse';
    return this.bindings.primary(action, device) ?? this.bindings.get(action).find((b) => bindingDevice(b) === 'keyboardMouse');
  }

  /** Evaluate all actions for this frame. Call once per frame after polling, before reading. */
  update(): void {
    const s = this.state;
    const pad = s.pad;
    // Indexed loops: this runs every frame for every action and must not allocate iterators.
    for (let ai = 0; ai < ACTIONS.length; ai++) {
      const action = ACTIONS[ai] as Action;
      const i = ACTION_INDEX[action];
      let value = 0;
      let down = false;
      let pressed = 0;
      let released = false;
      let analogDown = false;

      const bindings = this.bindings.get(action);
      for (let bi = 0; bi < bindings.length; bi++) {
        const b = bindings[bi] as Binding;
        switch (b.kind) {
          case 'key': {
            const modsOk = (!b.ctrl || s.modifierDown('ctrl')) && (!b.shift || s.modifierDown('shift')) && (!b.alt || s.modifierDown('alt'));
            if (modsOk && s.keysDown.has(b.code)) {
              down = true;
              value = 1;
            }
            if (modsOk && s.keysPressed.has(b.code)) pressed++;
            if (s.keysReleased.has(b.code)) released = true;
            break;
          }
          case 'mouse':
            if (s.mouseDown.has(b.button)) {
              down = true;
              value = 1;
            }
            if (s.mousePressed.has(b.button)) pressed++;
            if (s.mouseReleased.has(b.button)) released = true;
            break;
          case 'wheel': {
            // A wheel notch is an instantaneous tap: pressed and released in the same frame.
            const n = b.dir > 0 ? s.wheelDown : s.wheelUp;
            if (n > 0) {
              pressed += n;
              released = true;
            }
            break;
          }
          case 'padButton':
            // Disconnecting releases all buttons in the state, so no connection check is needed.
            if (pad.buttonsDown.has(b.index)) {
              down = true;
              value = Math.max(value, pad.buttons[b.index] ?? 1);
            }
            if (pad.buttonsPressed.has(b.index)) pressed++;
            if (pad.buttonsReleased.has(b.index)) released = true;
            break;
          case 'padAxis': {
            const v = Math.max(0, (pad.axes[b.index] ?? 0) * b.dir);
            value = Math.max(value, v);
            if (v >= ANALOG_DOWN_THRESHOLD) analogDown = true;
            break;
          }
        }
      }

      const touch = TOUCH_STICK_ACTIONS[action];
      if (touch) {
        const v = Math.max(0, s.touchSticks[touch.stick][touch.axis] * touch.sign);
        value = Math.max(value, v);
        if (v >= ANALOG_DOWN_THRESHOLD) analogDown = true;
      }
      if (s.touchButtonsDown.has(action)) {
        down = true;
        value = 1;
      }
      if (s.touchButtonsPressed.has(action)) pressed++;
      if (s.touchButtonsReleased.has(action)) released = true;

      // Analog sources get frame-to-frame edges.
      const wasAnalogDown = this.prevAnalogDown[i] === 1;
      if (analogDown && !wasAnalogDown) pressed++;
      if (!analogDown && wasAnalogDown) released = true;
      this.prevAnalogDown[i] = analogDown ? 1 : 0;
      if (analogDown) down = true;
      // Still held through another binding → not released.
      if (down) released = false;

      this.rawPresses[i] = pressed;

      if (!isActionActive(action, this.ctx)) {
        this.values[i] = 0;
        this.downs[i] = 0;
        this.presses[i] = 0;
        this.releases[i] = 0;
        continue;
      }

      if (isModalAction(action) && this.modes[action] === 'toggle') {
        const before = this.latched[i] === 1;
        const after = pressed % 2 === 1 ? !before : before;
        this.latched[i] = after ? 1 : 0;
        this.values[i] = after ? 1 : 0;
        this.downs[i] = after ? 1 : 0;
        this.presses[i] = after && !before ? 1 : 0;
        this.releases[i] = before && !after ? 1 : 0;
        continue;
      }

      this.values[i] = value;
      this.downs[i] = down ? 1 : 0;
      this.presses[i] = pressed;
      this.releases[i] = released ? 1 : 0;
    }
  }

  /** Held this frame (or latched on, in toggle mode). */
  isDown(action: Action): boolean {
    return this.downs[ACTION_INDEX[action]] === 1;
  }

  /** Became active this frame. */
  wasPressed(action: Action): boolean {
    return (this.presses[ACTION_INDEX[action]] ?? 0) > 0;
  }

  /** Became inactive this frame. */
  wasReleased(action: Action): boolean {
    return this.releases[ACTION_INDEX[action]] === 1;
  }

  /** Number of press edges this frame (several wheel notches can arrive in one frame). */
  pressCount(action: Action): number {
    return this.presses[ACTION_INDEX[action]] ?? 0;
  }

  /** Analog strength 0..1 (1 for digital inputs). */
  value(action: Action): number {
    return this.values[ACTION_INDEX[action]] ?? 0;
  }

  /**
   * Press edge regardless of the current context and toggle mode. Lets screens
   * close with the key that opened them (e.g. I closes the inventory) without
   * making the action conflict with menu navigation.
   */
  wasPressedAnyContext(action: Action): boolean {
    return (this.rawPresses[ACTION_INDEX[action]] ?? 0) > 0;
  }

  /**
   * Movement direction merged from keyboard, left stick and touch stick.
   * Length is at most 1: digital diagonals are normalized, partial stick
   * deflection keeps its magnitude (walk slower).
   */
  moveVector(out: Vec2 = { x: 0, y: 0 }): Vec2 {
    out.x = this.value('moveRight') - this.value('moveLeft');
    out.y = this.value('moveDown') - this.value('moveUp');
    return normalizeMax1(out);
  }

  /**
   * Aim direction (unit vector) relative to the player's position in internal
   * pixels. Right stick / touch aim stick wins; otherwise the mouse cursor when
   * keyboard/mouse is active; with a gamepad or touch and no aim input, the aim
   * follows the movement direction. Falls back to the last known direction.
   */
  aimVector(playerX: number, playerY: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    const sx = this.value('aimRight') - this.value('aimLeft');
    const sy = this.value('aimDown') - this.value('aimUp');
    const stickLen = Math.hypot(sx, sy);
    if (stickLen > 0) {
      this.lastAim.x = sx / stickLen;
      this.lastAim.y = sy / stickLen;
    } else if (this.state.lastDevice === 'keyboard') {
      const dx = this.state.mouse.x - playerX;
      const dy = this.state.mouse.y - playerY;
      const len = Math.hypot(dx, dy);
      if (len >= MIN_MOUSE_AIM_DISTANCE) {
        this.lastAim.x = dx / len;
        this.lastAim.y = dy / len;
      }
    } else {
      const mx = this.value('moveRight') - this.value('moveLeft');
      const my = this.value('moveDown') - this.value('moveUp');
      const len = Math.hypot(mx, my);
      if (len > 0) {
        this.lastAim.x = mx / len;
        this.lastAim.y = my / len;
      }
    }
    out.x = this.lastAim.x;
    out.y = this.lastAim.y;
    return out;
  }

  /** Right-stick deflection scaled by stick sensitivity (virtual cursor, map panning). */
  aimStick(out: Vec2 = { x: 0, y: 0 }): Vec2 {
    out.x = (this.value('aimRight') - this.value('aimLeft')) * this.stickSens;
    out.y = (this.value('aimDown') - this.value('aimUp')) * this.stickSens;
    return out;
  }

  /** Relative mouse movement this frame scaled by mouse sensitivity (map panning, pointer lock). */
  mouseDelta(out: Vec2 = { x: 0, y: 0 }): Vec2 {
    out.x = this.state.mouse.dx * this.mouseSens;
    out.y = this.state.mouse.dy * this.mouseSens;
    return out;
  }
}

function normalizeMax1(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  if (len > 1) {
    v.x /= len;
    v.y /= len;
  }
  return v;
}
