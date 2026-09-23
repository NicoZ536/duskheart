/**
 * DOM adapter: translates browser events into `InputState` updates.
 * Only called in the browser; the module itself touches no DOM globals at
 * import time, and all targets are injected (tests pass fakes).
 */
import { BindingSet, DEFAULT_BINDINGS } from './bindings';
import type { InputState, TouchStickId } from './state';

/** Anything we can attach listeners to (`window`, `HTMLElement`, fakes). */
export interface DomEventSource {
  addEventListener(type: string, listener: (event: Event) => void, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, listener: (event: Event) => void, options?: boolean | EventListenerOptions): void;
}

/** The game canvas (or its container). `HTMLElement` satisfies this. */
export interface DomInputTarget extends DomEventSource {
  getBoundingClientRect(): { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
  readonly style?: { touchAction: string };
}

/** Decides whether a key's browser default (scrolling, focus change, quick find …) is suppressed. */
export type KeyPreventFilter = (code: string, ctrlOrMeta: boolean) => boolean;

export interface DomInputOptions {
  /** Receives keyboard, mouse-move, mouse-up and blur events; normally `window`. Defaults to the target. */
  readonly windowTarget?: DomEventSource;
  /** Which keys get `preventDefault()`. Defaults to every key bound in the default bindings. */
  readonly preventKey?: KeyPreventFilter;
  /** Radius of a virtual stick in CSS px (full deflection). */
  readonly touchStickRadius?: number;
  /** Fraction of the target width (from the left) that starts the movement stick; the rest aims. */
  readonly touchMoveZone?: number;
}

/** Full deflection distance of a virtual touch stick, CSS px (comfortable thumb travel on tablets). */
export const TOUCH_STICK_RADIUS_PX = 56;
/** Left part of the screen that spawns the movement stick; touches further right spawn the aim stick. */
export const TOUCH_MOVE_ZONE_FRACTION = 0.5;

/**
 * Key filter derived from a binding set: bound keys lose their browser default,
 * but browser shortcuts with Ctrl/Cmd (reload, new tab …) stay intact unless
 * the exact chord is bound (e.g. Ctrl+Z for undo in build mode).
 */
export function createKeyFilter(bindings: BindingSet): KeyPreventFilter {
  let revision = -1;
  const plain = new Set<string>();
  const chords = new Set<string>();
  return (code, ctrlOrMeta) => {
    if (revision !== bindings.revision) {
      revision = bindings.revision;
      plain.clear();
      chords.clear();
      for (const code of bindings.keyboardCodes()) plain.add(code);
      for (const list of Object.values(bindings.snapshot())) {
        for (const b of list) if (b.kind === 'key' && b.ctrl) chords.add(b.code);
      }
    }
    return ctrlOrMeta ? chords.has(code) : plain.has(code);
  };
}

interface KeyEventLike {
  readonly code: string;
  readonly repeat: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly target: unknown;
  preventDefault(): void;
}
interface MouseEventLike {
  readonly clientX: number;
  readonly clientY: number;
  readonly movementX?: number;
  readonly movementY?: number;
  readonly button: number;
  preventDefault(): void;
}
interface WheelEventLike {
  readonly deltaY: number;
  readonly deltaMode: number;
  preventDefault(): void;
}
interface PointerEventLike {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly clientX: number;
  readonly clientY: number;
  preventDefault(): void;
}

/** True for text fields: typing there (e.g. the debug console or a seed input) must not move the player. */
export function isEditableTarget(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const t = target as { tagName?: unknown; isContentEditable?: unknown };
  if (t.isContentEditable === true) return true;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}

/**
 * Attach keyboard, mouse, wheel and touch listeners. Returns `detach()`, which
 * removes every listener and restores the target's `touch-action`.
 */
export function attachDomInput(target: DomInputTarget, state: InputState, opts: DomInputOptions = {}): () => void {
  const win = opts.windowTarget ?? target;
  const preventKey = opts.preventKey ?? createKeyFilter(new BindingSet(DEFAULT_BINDINGS));
  const stickRadius = opts.touchStickRadius ?? TOUCH_STICK_RADIUS_PX;
  const moveZone = opts.touchMoveZone ?? TOUCH_MOVE_ZONE_FRACTION;
  const touches = new Map<number, { stick: TouchStickId; ox: number; oy: number }>();
  const removers: Array<() => void> = [];

  function listen(source: DomEventSource, type: string, handler: (e: Event) => void, options?: AddEventListenerOptions): void {
    source.addEventListener(type, handler, options);
    removers.push(() => source.removeEventListener(type, handler, options?.capture ?? false));
  }

  function local(clientX: number, clientY: number): { x: number; y: number; inside: boolean; width: number } {
    const r = target.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    return { x, y, inside: x >= 0 && y >= 0 && x < r.width && y < r.height, width: r.width };
  }

  listen(win, 'keydown', (ev) => {
    const e = ev as unknown as KeyEventLike;
    if (isEditableTarget(e.target)) return;
    state.keyDown(e.code, e.repeat);
    if (preventKey(e.code, e.ctrlKey || e.metaKey)) e.preventDefault();
  });
  listen(win, 'keyup', (ev) => {
    const e = ev as unknown as KeyEventLike;
    // Always record releases, even from text fields, so no key can get stuck.
    state.keyUp(e.code);
    if (!isEditableTarget(e.target) && preventKey(e.code, e.ctrlKey || e.metaKey)) e.preventDefault();
  });

  listen(win, 'mousemove', (ev) => {
    const e = ev as unknown as MouseEventLike;
    const p = local(e.clientX, e.clientY);
    state.mouseMove(p.x, p.y, e.movementX, e.movementY);
    if (!p.inside) state.mouseLeave();
  });
  listen(target, 'mousedown', (ev) => {
    const e = ev as unknown as MouseEventLike;
    const p = local(e.clientX, e.clientY);
    state.mouseMove(p.x, p.y, 0, 0);
    state.mouseButtonDown(e.button);
    // Keeps focus on the game and suppresses middle-click autoscroll and text selection.
    e.preventDefault();
  });
  listen(win, 'mouseup', (ev) => {
    state.mouseButtonUp((ev as unknown as MouseEventLike).button);
  });
  listen(
    target,
    'wheel',
    (ev) => {
      const e = ev as unknown as WheelEventLike;
      state.wheel(e.deltaY, e.deltaMode);
      e.preventDefault();
    },
    { passive: false },
  );
  listen(target, 'contextmenu', (ev) => ev.preventDefault());
  listen(win, 'blur', () => {
    state.releaseAll();
    touches.clear();
  });

  // Touch: virtual sticks with a floating origin where the thumb lands.
  listen(target, 'pointerdown', (ev) => {
    const e = ev as unknown as PointerEventLike;
    if (e.pointerType !== 'touch') return;
    e.preventDefault(); // suppresses compatibility mouse events
    state.noteTouch();
    const p = local(e.clientX, e.clientY);
    const stick: TouchStickId = p.x < p.width * moveZone ? 'move' : 'aim';
    for (const t of touches.values()) if (t.stick === stick) return;
    touches.set(e.pointerId, { stick, ox: p.x, oy: p.y });
  });
  listen(target, 'pointermove', (ev) => {
    const e = ev as unknown as PointerEventLike;
    const t = touches.get(e.pointerId);
    if (!t) return;
    e.preventDefault();
    const p = local(e.clientX, e.clientY);
    state.setTouchStick(t.stick, (p.x - t.ox) / stickRadius, (p.y - t.oy) / stickRadius);
  });
  const endTouch = (ev: Event): void => {
    const e = ev as unknown as PointerEventLike;
    const t = touches.get(e.pointerId);
    if (!t) return;
    touches.delete(e.pointerId);
    state.setTouchStick(t.stick, 0, 0);
  };
  listen(target, 'pointerup', endTouch);
  listen(target, 'pointercancel', endTouch);

  const previousTouchAction = target.style?.touchAction;
  if (target.style) target.style.touchAction = 'none';

  return () => {
    for (const remove of removers.splice(0)) remove();
    touches.clear();
    if (target.style && previousTouchAction !== undefined) target.style.touchAction = previousTouchAction;
  };
}
