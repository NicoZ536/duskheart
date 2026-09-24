/**
 * Focus navigation of the UI screens (MASTERPROMPT §26 "Controller: vollständige Navigation mit
 * Fokusrahmen", §29; M3-31): every screen is usable with keyboard or controller alone.
 *
 * - Screens mark navigable elements with `data-fokus` (`FOCUS_ATTR`) and push a scope (`push`) with
 *   their root element. Only the top scope is navigable (dialogs trap the focus); popping a scope
 *   returns to the element that was focused in the scope below.
 * - `handle(action)` runs one menu action of the frame (`ScreenController` reads them from the input
 *   bindings): the scope's own `onAction` gets the first chance (e.g. the inventory's keyboard
 *   "carry"); otherwise directions move the focus spatially (`pickInDirection`), `confirm` activates
 *   the focused element (`click()`), `back` calls the scope's `onBack`.
 * - Visible focus frame: while the keyboard or controller is used, the focused element carries
 *   `data-fokus-sichtbar` (`FOCUS_VISIBLE_ATTR`) – focus.css draws a 1-px accent frame between two
 *   dark pixel rings around it. Using the pointer hides the frame; hovering an element makes it the
 *   focused one, so keys continue from where the mouse was.
 * - The DOM focus follows (`focus({ preventScroll: true })`), so screen readers read the element.
 */
import { signal, type ReadonlySignal } from '@preact/signals';
import { pickInDirection, type NavDirection, type NavRect } from './nav';

/** Attribute marking a navigable element. */
export const FOCUS_ATTR = 'data-fokus';
/** Attribute of the focused element while the focus frame is visible (keyboard/controller). */
export const FOCUS_VISIBLE_ATTR = 'data-fokus-sichtbar';

/** Menu actions of a frame (from `uiUp` … `uiTabPrev` and the hotbar keys). */
export type NavAction = NavDirection | 'confirm' | 'back' | 'next' | 'prev' | 'hotbar';

/** What the focus manager needs of an element (an `HTMLElement`; tests pass small fakes). */
export interface FocusElement {
  getBoundingClientRect(): NavRect;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  hasAttribute(name: string): boolean;
  focus(options?: { preventScroll?: boolean }): void;
  click(): void;
  scrollIntoView?(options?: { block?: 'nearest' }): void;
}

/** What the focus manager needs of a scope root. */
export interface FocusRoot {
  querySelectorAll(selector: string): ArrayLike<FocusElement>;
  contains(node: FocusElement | null): boolean;
}

/** A navigable region: a screen or a dialog. */
export interface FocusScope {
  readonly root: FocusRoot;
  /** Element focused when the scope opens by keys or when nothing is focused (default: the first navigable one). */
  readonly initial?: () => FocusElement | null;
  /**
   * First chance at every action (`index` = hotbar slot for `hotbar`); return true when handled. The
   * inventory uses it for carrying stacks with the keyboard, the settings rows for left/right.
   */
  readonly onAction?: (action: NavAction, focused: FocusElement | null, index: number) => boolean;
  /** `back` (Esc, B): close the screen or dialog. */
  readonly onBack?: () => void;
}

interface ScopeEntry {
  readonly scope: FocusScope;
  /** Element focused in this scope when another scope was pushed above it. */
  last: FocusElement | null;
}

const NAVIGABLE = `[${FOCUS_ATTR}]`;

function navigable(el: FocusElement): boolean {
  if (el.hasAttribute('disabled') || el.hasAttribute('aria-disabled')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

export class FocusManager {
  private readonly scopes: ScopeEntry[] = [];
  private readonly focusedSignal = signal<FocusElement | null>(null);
  private readonly keysSignal = signal(false);
  private framed: FocusElement | null = null;

  /** The focused element of the top scope (also while the frame is hidden), or `null`. */
  get focused(): ReadonlySignal<FocusElement | null> {
    return this.focusedSignal;
  }

  /** Whether the focus frame is visible (keyboard or controller in use). */
  get keys(): ReadonlySignal<boolean> {
    return this.keysSignal;
  }

  /** Number of open scopes. */
  get depth(): number {
    return this.scopes.length;
  }

  /** The top scope, or `null`. */
  top(): FocusScope | null {
    return this.scopes[this.scopes.length - 1]?.scope ?? null;
  }

  /**
   * Opens `scope` above the others. In keyboard mode its initial element gets the focus at once.
   * Returns a function that removes the scope again (idempotent) and restores the focus below.
   */
  push(scope: FocusScope): () => void {
    const below = this.scopes[this.scopes.length - 1];
    if (below !== undefined) below.last = this.focusedSignal.peek();
    const entry: ScopeEntry = { scope, last: null };
    this.scopes.push(entry);
    this.setFocused(null);
    if (this.keysSignal.peek()) this.focusInitial();
    return () => this.remove(entry);
  }

  /** Navigable elements of the top scope in document order. */
  targets(): FocusElement[] {
    const top = this.top();
    if (top === null) return [];
    const out: FocusElement[] = [];
    const list = top.root.querySelectorAll(NAVIGABLE);
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      if (el !== undefined && navigable(el)) out.push(el);
    }
    return out;
  }

  /** Focuses `el` (keyboard or program); `null` clears the focus. */
  focus(el: FocusElement | null): void {
    this.setFocused(el);
    if (el !== null) {
      el.focus({ preventScroll: true });
      if (this.keysSignal.peek()) el.scrollIntoView?.({ block: 'nearest' });
    }
  }

  /** The pointer is over `el` (a navigable element of the top scope): it becomes the focused one, the frame stays hidden. */
  hover(el: FocusElement | null): void {
    const top = this.top();
    if (el === null || top === null || !top.root.contains(el)) return;
    this.setKeys(false);
    this.setFocused(el);
  }

  /** The pointer moved: hide the focus frame. */
  pointerUsed(): void {
    this.setKeys(false);
  }

  /** A key or button opened a screen: the frame shows, and scopes pushed next start focused. */
  keysUsed(): void {
    this.setKeys(true);
  }

  /** Runs one menu action; returns whether anything handled it. */
  handle(action: NavAction, index = 0): boolean {
    const top = this.top();
    if (top === null) return false;
    const current = this.currentIn(top);
    if (action !== 'back' && action !== 'hotbar') this.setKeys(true);
    if (top.onAction?.(action, current, index) === true) return true;
    switch (action) {
      case 'up':
      case 'down':
      case 'left':
      case 'right': {
        if (current === null) return this.focusInitial();
        const list = this.targets();
        const from = list.indexOf(current);
        const next = pickInDirection(current.getBoundingClientRect(), list.map((el) => el.getBoundingClientRect()), action, from);
        const target = list[next];
        if (target !== undefined) this.focus(target);
        return true;
      }
      case 'confirm':
        if (current === null) return this.focusInitial();
        current.click();
        return true;
      case 'back':
        if (top.onBack === undefined) return false;
        top.onBack();
        return true;
      case 'next':
      case 'prev':
      case 'hotbar':
        return false;
    }
  }

  /** Focuses the initial element of the top scope; returns whether there was one. */
  focusInitial(): boolean {
    const top = this.top();
    if (top === null) return false;
    const el = top.initial?.() ?? this.targets()[0] ?? null;
    this.focus(el);
    return el !== null;
  }

  private currentIn(scope: FocusScope): FocusElement | null {
    const el = this.focusedSignal.peek();
    return el !== null && scope.root.contains(el) && navigable(el) ? el : null;
  }

  private remove(entry: ScopeEntry): void {
    const i = this.scopes.indexOf(entry);
    if (i < 0) return;
    const wasTop = i === this.scopes.length - 1;
    this.scopes.splice(i, 1);
    if (!wasTop) return;
    const below = this.scopes[this.scopes.length - 1];
    const restore = below?.last ?? null;
    if (below !== undefined) below.last = null;
    if (restore !== null && below !== undefined && below.scope.root.contains(restore)) this.focus(restore);
    else this.setFocused(null);
  }

  private setKeys(on: boolean): void {
    if (this.keysSignal.peek() === on) return;
    this.keysSignal.value = on;
    this.updateFrame();
  }

  private setFocused(el: FocusElement | null): void {
    if (this.focusedSignal.peek() !== el) this.focusedSignal.value = el;
    this.updateFrame();
  }

  /** Moves the visible-frame attribute to the focused element (only while keys are in use). */
  private updateFrame(): void {
    const want = this.keysSignal.peek() ? this.focusedSignal.peek() : null;
    if (want === this.framed) return;
    this.framed?.removeAttribute(FOCUS_VISIBLE_ATTR);
    want?.setAttribute(FOCUS_VISIBLE_ATTR, '');
    this.framed = want;
  }
}
