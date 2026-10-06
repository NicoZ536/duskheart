/**
 * Screen stack of the main menu (MASTERPROMPT §26 "Bildschirme: Hauptmenü, Weltauswahl, Neue Welt, Einstellungen";
 * docs/SPIEL.md §25 "Boot-Ablauf"; M7-50).
 *
 * The main menu lies at the bottom and never closes; the other screens open from its buttons (`open`) or replace the
 * top screen as the next step of the new-world flow (`replace`). `poll()` reads the frame's menu input once per rendered
 * frame (the menu session's `ActionReader` in context `ui`): the menu actions go to the focus manager – Esc/B first to
 * the top screen's focus scope (a dialog inside a screen closes before the screen), and when nothing handles `back` the
 * top screen closes (`back`). Holding a direction repeats it like in the game's screens (`REPEAT_DELAY_MS`,
 * `REPEAT_INTERVAL_MS`, src/ui/focus/screens.ts). Nothing is allocated per frame while no key is pressed.
 */
import { signal, type ReadonlySignal } from '@preact/signals';
import type { Action } from '../../engine/input/actions';
import type { FocusManager, NavAction } from '../focus/manager';
import type { NavDirection } from '../focus/nav';
import { REPEAT_DELAY_MS, REPEAT_INTERVAL_MS, type ScreenInput } from '../focus/screens';

/** The screen at the bottom of the menu. */
export const MAIN_MENU = 'hauptmenue';

/** Menu actions of the bindings and the focus action they trigger (the same as in the game's screens). */
const NAV: ReadonlyArray<readonly [Action, NavAction]> = [
  ['uiUp', 'up'],
  ['uiDown', 'down'],
  ['uiLeft', 'left'],
  ['uiRight', 'right'],
  ['uiConfirm', 'confirm'],
  ['uiBack', 'back'],
  ['uiTabNext', 'next'],
  ['uiTabPrev', 'prev'],
];
const DIRECTIONS: ReadonlyArray<readonly [Action, NavDirection]> = [
  ['uiUp', 'up'],
  ['uiDown', 'down'],
  ['uiLeft', 'left'],
  ['uiRight', 'right'],
];

export interface MenuControllerOptions {
  readonly focus: FocusManager;
  /** The frame's menu input; `null` = pointer only (tests). */
  readonly input: Omit<ScreenInput, 'pressedTogether'> | null;
  /** Clock of the key repeat [ms]; `performance.now` when absent. */
  readonly now?: () => number;
}

export class MenuController {
  private readonly stackSignal = signal<readonly string[]>([MAIN_MENU]);
  private readonly now: () => number;
  private repeatDir: NavDirection | null = null;
  private repeatAt = 0;

  constructor(private readonly options: MenuControllerOptions) {
    this.now = options.now ?? (() => performance.now());
    options.input?.setContext('ui');
  }

  /** Open screens, the main menu first. */
  get stack(): ReadonlySignal<readonly string[]> {
    return this.stackSignal;
  }

  /** The top screen. */
  top(): string {
    const s = this.stackSignal.peek();
    return s[s.length - 1] ?? MAIN_MENU;
  }

  /** Opens `id` on top (no-op when it is the top already). */
  open(id: string): void {
    if (this.top() === id) return;
    this.set([...this.stackSignal.peek(), id]);
  }

  /** Replaces the top screen with `id` (the next or previous step of a flow); the main menu itself is never replaced. */
  replace(id: string): void {
    const s = this.stackSignal.peek();
    if (s.length <= 1) this.open(id);
    else this.set([...s.slice(0, -1), id]);
  }

  /** Closes the top screen (the main menu stays). */
  back(): void {
    const s = this.stackSignal.peek();
    if (s.length > 1) this.set(s.slice(0, -1));
  }

  /** Back to the main menu alone. */
  home(): void {
    if (this.stackSignal.peek().length > 1) this.set([MAIN_MENU]);
  }

  /** Reads the frame's menu input (once per rendered frame). */
  poll(): void {
    const input = this.options.input;
    if (input === null) return;
    const focus = this.options.focus;
    const depth = this.stackSignal.peek().length;
    for (let i = 0; i < NAV.length; i++) {
      const [action, nav] = NAV[i] as readonly [Action, NavAction];
      if (!input.wasPressed(action)) continue;
      if (!focus.handle(nav) && nav === 'back') this.back();
      // A screen opened or closed: the rest of the frame's input belongs to the next one.
      if (this.stackSignal.peek().length !== depth) {
        this.repeatDir = null;
        return;
      }
    }
    this.repeat(input, focus);
  }

  private repeat(input: NonNullable<MenuControllerOptions['input']>, focus: FocusManager): void {
    const now = this.now();
    let held: NavDirection | null = null;
    for (let i = 0; i < DIRECTIONS.length; i++) {
      const [action, dir] = DIRECTIONS[i] as readonly [Action, NavDirection];
      if (input.wasPressed(action)) {
        this.repeatDir = dir;
        this.repeatAt = now + REPEAT_DELAY_MS;
        return;
      }
      if (held === null && input.isDown(action)) held = dir;
    }
    if (held === null || held !== this.repeatDir) {
      this.repeatDir = held;
      this.repeatAt = now + REPEAT_DELAY_MS;
      return;
    }
    if (now >= this.repeatAt) {
      this.repeatAt = now + REPEAT_INTERVAL_MS;
      focus.handle(held);
    }
  }

  private set(next: readonly string[]): void {
    this.stackSignal.value = next;
    this.repeatDir = null;
  }
}
