/**
 * Binding model: which physical inputs trigger which action (MASTERPROMPT §26:
 * "Alles umbelegbar"). Keyboard bindings use `KeyboardEvent.code` (physical key
 * position), so WASD works on QWERTY, QWERTZ and AZERTY alike.
 */
import { z } from 'zod';
import { ACTIONS, isAction, sharedContexts, type Action, type InputContext } from './actions';

export interface KeyBinding {
  readonly kind: 'key';
  /** `KeyboardEvent.code`, e.g. "KeyW", "Space", "ShiftLeft". */
  readonly code: string;
  /** Chord modifiers; a binding without modifiers fires regardless of held modifiers. */
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
}
export interface MouseBinding {
  readonly kind: 'mouse';
  /** `MouseEvent.button`: 0 left, 1 middle, 2 right, 3 back, 4 forward. */
  readonly button: number;
}
export interface WheelBinding {
  readonly kind: 'wheel';
  /** −1 = wheel up (away from the user), +1 = wheel down. */
  readonly dir: -1 | 1;
}
export interface PadButtonBinding {
  readonly kind: 'padButton';
  /** Button index in the W3C "standard" gamepad mapping. */
  readonly index: number;
}
export interface PadAxisBinding {
  readonly kind: 'padAxis';
  /** Axis index in the W3C "standard" mapping (0/1 left stick, 2/3 right stick). */
  readonly index: number;
  /** Half-axis: −1 = negative direction (left/up), +1 = positive (right/down). */
  readonly dir: -1 | 1;
}
export type Binding = KeyBinding | MouseBinding | WheelBinding | PadButtonBinding | PadAxisBinding;
export type BindingDevice = 'keyboardMouse' | 'gamepad';
export type BindingMap = Readonly<Record<Action, readonly Binding[]>>;

/** Largest mouse button index we accept (5 buttons + some headroom for gaming mice). */
export const MAX_MOUSE_BUTTON = 15;
/** Largest gamepad button index we accept (standard mapping has 17; extra buttons on some pads). */
export const MAX_PAD_BUTTON = 31;
/** Largest gamepad axis index we accept (standard mapping has 4). */
export const MAX_PAD_AXIS = 15;
/** Longest accepted `KeyboardEvent.code` string (real codes are ≤ 20 chars). */
const MAX_KEY_CODE_LENGTH = 32;

/** W3C standard gamepad mapping, named for readability of the default table. */
export const PAD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  SELECT: 8,
  START: 9,
  LS: 10,
  RS: 11,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
  HOME: 16,
} as const;
/** Standard-mapping axis indices. */
export const PAD_AXIS = { LX: 0, LY: 1, RX: 2, RY: 3 } as const;

const signSchema = z.union([z.literal(-1), z.literal(1)]);

/** zod schema for a single binding (strict: unknown kinds are rejected). */
export const bindingSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('key'),
    code: z.string().min(1).max(MAX_KEY_CODE_LENGTH),
    ctrl: z.boolean().optional(),
    shift: z.boolean().optional(),
    alt: z.boolean().optional(),
  }),
  z.object({ kind: z.literal('mouse'), button: z.number().int().min(0).max(MAX_MOUSE_BUTTON) }),
  z.object({ kind: z.literal('wheel'), dir: signSchema }),
  z.object({ kind: z.literal('padButton'), index: z.number().int().min(0).max(MAX_PAD_BUTTON) }),
  z.object({ kind: z.literal('padAxis'), index: z.number().int().min(0).max(MAX_PAD_AXIS), dir: signSchema }),
]);

// ---------------------------------------------------------------------------
// Constructors (keep the default table readable)

export function key(code: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}): KeyBinding {
  const b: { kind: 'key'; code: string; ctrl?: boolean; shift?: boolean; alt?: boolean } = { kind: 'key', code };
  if (mods.ctrl) b.ctrl = true;
  if (mods.shift) b.shift = true;
  if (mods.alt) b.alt = true;
  return b;
}
export function mouse(button: number): MouseBinding {
  return { kind: 'mouse', button };
}
export function wheel(dir: -1 | 1): WheelBinding {
  return { kind: 'wheel', dir };
}
export function padButton(index: number): PadButtonBinding {
  return { kind: 'padButton', index };
}
export function padAxis(index: number, dir: -1 | 1): PadAxisBinding {
  return { kind: 'padAxis', index, dir };
}

// ---------------------------------------------------------------------------
// Helpers

/** Structural equality (missing modifier flags equal `false`). */
export function bindingsEqual(a: Binding, b: Binding): boolean {
  switch (a.kind) {
    case 'key':
      return (
        b.kind === 'key' &&
        a.code === b.code &&
        !!a.ctrl === !!b.ctrl &&
        !!a.shift === !!b.shift &&
        !!a.alt === !!b.alt
      );
    case 'mouse':
      return b.kind === 'mouse' && a.button === b.button;
    case 'wheel':
      return b.kind === 'wheel' && a.dir === b.dir;
    case 'padButton':
      return b.kind === 'padButton' && a.index === b.index;
    case 'padAxis':
      return b.kind === 'padAxis' && a.index === b.index && a.dir === b.dir;
  }
}

/** Which device family a binding belongs to (rebinding UI columns, button prompts). */
export function bindingDevice(b: Binding): BindingDevice {
  return b.kind === 'padButton' || b.kind === 'padAxis' ? 'gamepad' : 'keyboardMouse';
}

/** Stable string id of a binding, e.g. "key:KeyZ+ctrl", "padAxis:1:-1". */
export function bindingId(b: Binding): string {
  switch (b.kind) {
    case 'key':
      return `key:${b.code}${b.ctrl ? '+ctrl' : ''}${b.shift ? '+shift' : ''}${b.alt ? '+alt' : ''}`;
    case 'mouse':
      return `mouse:${b.button}`;
    case 'wheel':
      return `wheel:${b.dir}`;
    case 'padButton':
      return `padButton:${b.index}`;
    case 'padAxis':
      return `padAxis:${b.index}:${b.dir}`;
  }
}

function dedupe(list: readonly Binding[]): Binding[] {
  const out: Binding[] = [];
  for (const b of list) if (!out.some((o) => bindingsEqual(o, b))) out.push(b);
  return out;
}

// ---------------------------------------------------------------------------
// Default bindings (§26 Standardbelegung + gamepad standard mapping)

export interface DefaultBindingOptions {
  /**
   * Keyboard layout map (`code` → produced character), e.g. from
   * `navigator.keyboard.getLayoutMap()`. Used so that "Ctrl+Z" means the key
   * labelled Z on the user's layout. Without it, both QWERTY (KeyZ) and QWERTZ
   * (KeyY) positions are bound, covering the two shipped languages.
   */
  readonly layout?: ReadonlyMap<string, string>;
}

/** Find the physical code that produces `char` on the given layout. */
export function codeForCharacter(layout: ReadonlyMap<string, string>, char: string): string | undefined {
  const wanted = char.toLowerCase();
  for (const [code, produced] of layout) {
    if (produced.toLowerCase() === wanted && code.startsWith('Key')) return code;
  }
  return undefined;
}

/** Build the default binding table. */
export function createDefaultBindings(opts: DefaultBindingOptions = {}): BindingMap {
  const zCode = opts.layout ? codeForCharacter(opts.layout, 'z') : undefined;
  const undo = zCode ? [key(zCode, { ctrl: true })] : [key('KeyZ', { ctrl: true }), key('KeyY', { ctrl: true })];
  const digitCodes = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'];
  const hotbar = (slot: number): readonly Binding[] => [key(digitCodes[slot] ?? 'Digit0')];

  return {
    moveUp: [key('KeyW'), key('ArrowUp'), padAxis(PAD_AXIS.LY, -1)],
    moveDown: [key('KeyS'), key('ArrowDown'), padAxis(PAD_AXIS.LY, 1)],
    moveLeft: [key('KeyA'), key('ArrowLeft'), padAxis(PAD_AXIS.LX, -1)],
    moveRight: [key('KeyD'), key('ArrowRight'), padAxis(PAD_AXIS.LX, 1)],
    aimUp: [padAxis(PAD_AXIS.RY, -1)],
    aimDown: [padAxis(PAD_AXIS.RY, 1)],
    aimLeft: [padAxis(PAD_AXIS.RX, -1)],
    aimRight: [padAxis(PAD_AXIS.RX, 1)],
    sprint: [key('ShiftLeft'), key('ShiftRight'), padButton(PAD.LS)],
    sneak: [key('ControlLeft'), padButton(PAD.RS)],
    roll: [key('Space'), padButton(PAD.B)],
    attack: [mouse(0), padButton(PAD.RT)],
    block: [mouse(2), padButton(PAD.LT)],
    interact: [key('KeyE'), padButton(PAD.A)],
    belt: [key('KeyQ'), padButton(PAD.X)],
    toggleLight: [key('KeyF'), padButton(PAD.Y)],
    build: [key('KeyB'), padButton(PAD.DPAD_DOWN)],
    rotate: [key('KeyR'), padButton(PAD.X)],
    mirror: [key('KeyF'), padButton(PAD.Y)],
    pipette: [mouse(1), padButton(PAD.RS)],
    undo: [...undo, padButton(PAD.B)],
    inventory: [key('Tab'), key('KeyI'), padButton(PAD.DPAD_UP)],
    crafting: [key('KeyC'), padButton(PAD.DPAD_RIGHT)],
    map: [key('KeyM'), padButton(PAD.SELECT)],
    chronicle: [key('KeyJ'), padButton(PAD.DPAD_LEFT)],
    settlers: [key('KeyK')],
    pause: [key('Escape'), padButton(PAD.START)],
    hotbar1: hotbar(0),
    hotbar2: hotbar(1),
    hotbar3: hotbar(2),
    hotbar4: hotbar(3),
    hotbar5: hotbar(4),
    hotbar6: hotbar(5),
    hotbar7: hotbar(6),
    hotbar8: hotbar(7),
    hotbar9: hotbar(8),
    hotbar10: hotbar(9),
    hotbarNext: [wheel(1), padButton(PAD.RB)],
    hotbarPrev: [wheel(-1), padButton(PAD.LB)],
    uiUp: [key('ArrowUp'), key('KeyW'), padButton(PAD.DPAD_UP), padAxis(PAD_AXIS.LY, -1)],
    uiDown: [key('ArrowDown'), key('KeyS'), padButton(PAD.DPAD_DOWN), padAxis(PAD_AXIS.LY, 1)],
    uiLeft: [key('ArrowLeft'), key('KeyA'), padButton(PAD.DPAD_LEFT), padAxis(PAD_AXIS.LX, -1)],
    uiRight: [key('ArrowRight'), key('KeyD'), padButton(PAD.DPAD_RIGHT), padAxis(PAD_AXIS.LX, 1)],
    uiConfirm: [key('Enter'), key('NumpadEnter'), key('Space'), padButton(PAD.A)],
    uiBack: [key('Escape'), padButton(PAD.B)],
    uiTabNext: [key('KeyE'), padButton(PAD.RB)],
    uiTabPrev: [key('KeyQ'), padButton(PAD.LB)],
    debugOverlay: [key('F3')],
    debugConsole: [key('Backquote'), key('IntlBackslash')],
    screenshotMode: [key('F10')],
  };
}

/** Default table for an unknown layout. */
export const DEFAULT_BINDINGS: BindingMap = createDefaultBindings();

// ---------------------------------------------------------------------------
// Conflicts & rebinding

export interface BindingConflict {
  /** The action that is being (re)bound. */
  readonly action: Action;
  /** The action that already uses the binding. */
  readonly other: Action;
  readonly binding: Binding;
  /** Contexts in which both actions would fire. */
  readonly contexts: readonly InputContext[];
}

/**
 * What to do when a new binding is already used by another action in an
 * overlapping context: `reject` leaves everything unchanged, `unbindOther`
 * removes it from the other action, `swap` gives the other action the binding
 * that is being replaced (or unbinds it when nothing is replaced).
 */
export type ConflictPolicy = 'reject' | 'unbindOther' | 'swap';

export interface RebindOptions {
  /** Existing binding of `action` to replace; without it the binding is added. */
  readonly replace?: Binding;
  readonly policy?: ConflictPolicy;
}
export interface RebindResult {
  readonly ok: boolean;
  readonly conflicts: readonly BindingConflict[];
}

/** Serialized form: only actions that differ from the defaults. */
export type SerializedBindings = Partial<Record<Action, Binding[]>>;

/** Lenient cleanup of untrusted data: unknown actions and invalid entries are dropped. */
export function sanitizeSerializedBindings(raw: unknown): SerializedBindings {
  const out: SerializedBindings = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  for (const [name, list] of Object.entries(raw)) {
    if (!isAction(name) || !Array.isArray(list)) continue;
    const valid: Binding[] = [];
    for (const entry of list) {
      const parsed = bindingSchema.safeParse(entry);
      if (parsed.success) valid.push(parsed.data);
    }
    // An intentionally emptied action stays unbound; a list with only garbage falls back to the default.
    if (list.length > 0 && valid.length === 0) continue;
    out[name] = dedupe(valid);
  }
  return out;
}

/** zod schema for persisted bindings (used by the settings schema); sanitizes leniently. */
export const serializedBindingsSchema = z
  .record(z.string(), z.unknown())
  .transform((raw): SerializedBindings => sanitizeSerializedBindings(raw));

/** Mutable, rebindable binding table. */
export class BindingSet {
  private readonly defaults: BindingMap;
  private readonly map = new Map<Action, Binding[]>();
  private revisionCounter = 0;

  constructor(defaults: BindingMap = DEFAULT_BINDINGS, overrides: SerializedBindings = {}) {
    this.defaults = defaults;
    for (const a of ACTIONS) this.map.set(a, dedupe(overrides[a] ?? defaults[a]));
  }

  /** Incremented on every change (lets consumers cache derived data). */
  get revision(): number {
    return this.revisionCounter;
  }

  get(action: Action): readonly Binding[] {
    return this.map.get(action) ?? [];
  }

  /** Replace all bindings of an action (duplicates removed, no conflict check). */
  set(action: Action, bindings: readonly Binding[]): void {
    this.map.set(action, dedupe(bindings));
    this.revisionCounter++;
  }

  /** First binding of the given device family (button prompts like "[E] Pick up"). */
  primary(action: Action, device: BindingDevice): Binding | undefined {
    return this.get(action).find((b) => bindingDevice(b) === device);
  }

  /** Actions using this exact binding. */
  actionsFor(binding: Binding): Action[] {
    return ACTIONS.filter((a) => this.get(a).some((b) => bindingsEqual(b, binding)));
  }

  /** Conflicts that binding `binding` to `action` would create. */
  findConflicts(action: Action, binding: Binding): BindingConflict[] {
    const out: BindingConflict[] = [];
    for (const other of ACTIONS) {
      if (other === action) continue;
      const contexts = sharedContexts(action, other);
      if (contexts.length === 0) continue;
      if (this.get(other).some((b) => bindingsEqual(b, binding))) out.push({ action, other, binding, contexts });
    }
    return out;
  }

  /** Every conflict in the current table (each pair reported once). */
  allConflicts(): BindingConflict[] {
    const out: BindingConflict[] = [];
    ACTIONS.forEach((a, i) => {
      for (const b of this.get(a)) {
        for (const other of ACTIONS.slice(i + 1)) {
          const contexts = sharedContexts(a, other);
          if (contexts.length > 0 && this.get(other).some((o) => bindingsEqual(o, b))) {
            out.push({ action: a, other, binding: b, contexts });
          }
        }
      }
    });
    return out;
  }

  /** Bind (or replace a binding of) an action with conflict handling per `policy`. */
  rebind(action: Action, binding: Binding, opts: RebindOptions = {}): RebindResult {
    const policy = opts.policy ?? 'reject';
    const conflicts = this.findConflicts(action, binding);
    if (conflicts.length > 0 && policy === 'reject') return { ok: false, conflicts };

    const list = [...this.get(action)];
    const replaceIdx = opts.replace ? list.findIndex((b) => opts.replace !== undefined && bindingsEqual(b, opts.replace)) : -1;
    if (replaceIdx >= 0) list[replaceIdx] = binding;
    else list.push(binding);
    this.map.set(action, dedupe(list));

    for (const c of conflicts) {
      const otherList = this.get(c.other);
      const swapIn = policy === 'swap' && replaceIdx >= 0 ? opts.replace : undefined;
      const next = otherList.map((b) => (bindingsEqual(b, binding) ? swapIn : b)).filter((b): b is Binding => b !== undefined);
      this.map.set(c.other, dedupe(next));
    }
    this.revisionCounter++;
    return { ok: true, conflicts };
  }

  /** Remove one binding from an action. Returns false if it was not bound. */
  unbind(action: Action, binding: Binding): boolean {
    const list = this.get(action);
    const next = list.filter((b) => !bindingsEqual(b, binding));
    if (next.length === list.length) return false;
    this.map.set(action, next);
    this.revisionCounter++;
    return true;
  }

  /** Restore defaults for one action, or for all actions when omitted. */
  reset(action?: Action): void {
    const targets: readonly Action[] = action ? [action] : ACTIONS;
    for (const a of targets) this.map.set(a, dedupe(this.defaults[a]));
    this.revisionCounter++;
  }

  isDefault(action: Action): boolean {
    const cur = this.get(action);
    const def = dedupe(this.defaults[action]);
    return cur.length === def.length && cur.every((b, i) => {
      const d = def[i];
      return d !== undefined && bindingsEqual(b, d);
    });
  }

  /** All keyboard codes that are bound to anything (the DOM adapter suppresses their browser default). */
  keyboardCodes(): Set<string> {
    const out = new Set<string>();
    for (const a of ACTIONS) for (const b of this.get(a)) if (b.kind === 'key') out.add(b.code);
    return out;
  }

  /** Full table snapshot (immutable copy). */
  snapshot(): BindingMap {
    const out = {} as Record<Action, readonly Binding[]>;
    for (const a of ACTIONS) out[a] = [...this.get(a)];
    return out;
  }

  /** Overrides only: actions whose bindings differ from the defaults. */
  serialize(): SerializedBindings {
    const out: SerializedBindings = {};
    for (const a of ACTIONS) if (!this.isDefault(a)) out[a] = this.get(a).map((b) => ({ ...b }));
    return out;
  }

  /** Rebuild from persisted data (validated with zod; invalid parts fall back to defaults). */
  static deserialize(raw: unknown, defaults: BindingMap = DEFAULT_BINDINGS): BindingSet {
    return new BindingSet(defaults, sanitizeSerializedBindings(raw));
  }
}

// ---------------------------------------------------------------------------
// Labels for prompts and the rebinding screen (i18n keys resolved by the UI)

export type GamepadFamily = 'xbox' | 'playstation' | 'generic';

/** One piece of a binding label: literal text or an i18n key (with params). */
export type BindingLabelPart =
  | { readonly text: string }
  | { readonly i18n: string; readonly params?: Readonly<Record<string, string | number>> };

/** Key codes that have a translated name under `input.key.<code>`. */
export const NAMED_KEY_CODES = [
  'Space',
  'Tab',
  'Escape',
  'Enter',
  'NumpadEnter',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'CapsLock',
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Backquote',
  'IntlBackslash',
] as const;
const NAMED_KEYS: ReadonlySet<string> = new Set<string>(NAMED_KEY_CODES);

const XBOX_BUTTONS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS'];
const PS_BUTTONS = ['cross', 'circle', 'square', 'triangle', 'L1', 'R1', 'L2', 'R2', 'Create', 'Options', 'L3', 'R3'];
const PS_FACE: ReadonlySet<string> = new Set(['cross', 'circle', 'square', 'triangle']);
const GENERIC_BUTTON_KEYS = [
  'faceDown',
  'faceRight',
  'faceLeft',
  'faceUp',
  'shoulderLeft',
  'shoulderRight',
  'triggerLeft',
  'triggerRight',
  'select',
  'start',
  'stickLeft',
  'stickRight',
];
const DPAD_KEYS = ['dpadUp', 'dpadDown', 'dpadLeft', 'dpadRight'];
const STICK_AXIS_KEYS: Readonly<Record<string, string>> = {
  '0:-1': 'leftStickLeft',
  '0:1': 'leftStickRight',
  '1:-1': 'leftStickUp',
  '1:1': 'leftStickDown',
  '2:-1': 'rightStickLeft',
  '2:1': 'rightStickRight',
  '3:-1': 'rightStickUp',
  '3:1': 'rightStickDown',
};

function keyCodeLabel(code: string, layout?: ReadonlyMap<string, string>): BindingLabelPart {
  const fromLayout = layout?.get(code);
  if (fromLayout && fromLayout.trim().length > 0 && !NAMED_KEYS.has(code)) return { text: fromLayout.toUpperCase() };
  if (NAMED_KEYS.has(code)) return { i18n: `input.key.${code}` };
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter?.[1]) return { text: letter[1] };
  const digit = /^Digit(\d)$/.exec(code);
  if (digit?.[1]) return { text: digit[1] };
  const numpad = /^Numpad(\d)$/.exec(code);
  if (numpad?.[1]) return { i18n: 'input.key.numpadDigit', params: { digit: numpad[1] } };
  return { text: code };
}

function padButtonLabel(index: number, family: GamepadFamily): BindingLabelPart {
  if (index >= PAD.DPAD_UP && index <= PAD.DPAD_RIGHT) return { i18n: `input.pad.${DPAD_KEYS[index - PAD.DPAD_UP] ?? 'dpadUp'}` };
  if (index === PAD.HOME) return { i18n: 'input.pad.home' };
  if (family === 'xbox') {
    const name = XBOX_BUTTONS[index];
    if (name) return { text: name };
  } else if (family === 'playstation') {
    const name = PS_BUTTONS[index];
    if (name) return PS_FACE.has(name) ? { i18n: `input.pad.ps.${name}` } : { text: name };
  } else {
    const name = GENERIC_BUTTON_KEYS[index];
    if (name) return { i18n: `input.pad.generic.${name}` };
  }
  return { i18n: 'input.pad.button', params: { n: index } };
}

/**
 * Label parts for a binding. Chord modifiers come first; the UI joins parts with "+".
 * `layout` (code → character) makes letter keys show the user's actual key caps.
 */
export function bindingLabel(b: Binding, family: GamepadFamily = 'generic', layout?: ReadonlyMap<string, string>): BindingLabelPart[] {
  switch (b.kind) {
    case 'key': {
      const parts: BindingLabelPart[] = [];
      if (b.ctrl) parts.push({ i18n: 'input.key.ctrl' });
      if (b.shift) parts.push({ i18n: 'input.key.shift' });
      if (b.alt) parts.push({ i18n: 'input.key.alt' });
      parts.push(keyCodeLabel(b.code, layout));
      return parts;
    }
    case 'mouse': {
      const names = ['left', 'middle', 'right', 'back', 'forward'];
      const name = names[b.button];
      return [name ? { i18n: `input.mouse.${name}` } : { i18n: 'input.mouse.button', params: { n: b.button + 1 } }];
    }
    case 'wheel':
      return [{ i18n: b.dir < 0 ? 'input.wheel.up' : 'input.wheel.down' }];
    case 'padButton':
      return [padButtonLabel(b.index, family)];
    case 'padAxis': {
      const name = STICK_AXIS_KEYS[`${b.index}:${b.dir}`];
      return [name ? { i18n: `input.pad.${name}` } : { i18n: 'input.pad.axis', params: { n: b.index, dir: b.dir < 0 ? '−' : '+' } }];
    }
  }
}

/** Every action that has no binding at all (the settings screen warns about these). */
export function unboundActions(set: BindingSet): Action[] {
  return ACTIONS.filter((a) => set.get(a).length === 0);
}
