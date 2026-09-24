/**
 * Screen stack of the running game (MASTERPROMPT §26 "Bildschirme", §29 "Pausieren jederzeit;
 * automatische Pause beim Tab-Wechsel"; M3-30, M3-31).
 *
 * - Open screens form a stack (`stack`): the inventory can lie under the pause menu. While any screen
 *   is open the input context is `ui` – movement and world actions stop (the input translator sends
 *   the stop), menu navigation is active; with the last screen closed it returns to `play`.
 * - Pausing screens (the pause menu) pause the simulation through `setPaused` while they are open;
 *   the inventory does not pause (the world keeps running, as in the rest of the game).
 * - `poll()` runs once per rendered frame (after the bridge published the frame): with no screen open
 *   an opener action opens its screen (Tab/I/D-pad up → inventory, Esc/Start → pause menu); with a
 *   screen open the frame's menu actions go to the focus manager (`uiUp` … `uiTabPrev`, the hotbar
 *   keys), and the opener of the top screen closes it again (Tab/I close the inventory) unless the
 *   same input also navigates (the D-pad up opens the inventory and moves the focus up in it).
 * - Holding a direction repeats it (after `REPEAT_DELAY_MS`, every `REPEAT_INTERVAL_MS`), so long
 *   lists are quick to walk with keys and sticks.
 * - `tabHidden()`: the page went to the background – while a game runs (`autoPause`) the pause menu
 *   opens (the loop's own `hidden` pause ends when the tab returns; the menu keeps the game paused
 *   until "Weiter").
 */
import { signal, type ReadonlySignal } from '@preact/signals';
import type { Action, InputContext } from '../../engine/input/actions';
import type { FocusManager, NavAction } from './manager';
import type { NavDirection } from './nav';

/** Id of a screen (`inventar`, `pause`, later `handwerk`, `karte` …). */
export type ScreenId = string;

/** The input the screens read once per frame (the session's `ActionReader`). */
export interface ScreenInput {
  wasPressed(action: Action): boolean;
  wasPressedAnyContext(action: Action): boolean;
  isDown(action: Action): boolean;
  setContext(context: InputContext): void;
}

/** A screen the stack knows. */
export interface ScreenSpec {
  readonly id: ScreenId;
  /** Action that opens it while no screen is open, and closes it while it is the top screen. */
  readonly opener: Action;
  /** Pauses the simulation while open. */
  readonly pauses: boolean;
}

export interface ScreenControllerOptions {
  readonly screens: readonly ScreenSpec[];
  readonly focus: FocusManager;
  /** Menu input of the frame; `null` = pointer only (tests, sessions without input). */
  readonly input: ScreenInput | null;
  /** Pause (true) or resume (false) the simulation for pausing screens. */
  readonly setPaused?: (paused: boolean) => void;
  /** Whether a screen may open now (the inventory needs a player). */
  readonly canOpen?: (id: ScreenId) => boolean;
  /**
   * Whether a tab switch opens the pause menu now (a game is running: the player exists). Without a
   * running game (title, debug world views) the loop's own pause while hidden is enough.
   */
  readonly autoPause?: () => boolean;
  /** Clock for key repeat [ms]; default `performance.now`. */
  readonly now?: () => number;
}

/** Hold time before a held direction repeats [ms]. */
export const REPEAT_DELAY_MS = 350;
/** Interval of the repeat [ms]. */
export const REPEAT_INTERVAL_MS = 110;

/** Menu actions of the bindings and the focus action they trigger. */
const NAV_BINDINGS: ReadonlyArray<readonly [Action, NavAction]> = [
  ['uiUp', 'up'],
  ['uiDown', 'down'],
  ['uiLeft', 'left'],
  ['uiRight', 'right'],
  ['uiConfirm', 'confirm'],
  ['uiBack', 'back'],
  ['uiTabNext', 'next'],
  ['uiTabPrev', 'prev'],
];
const DIRECTION_ACTIONS: ReadonlyArray<readonly [Action, NavDirection]> = [
  ['uiUp', 'up'],
  ['uiDown', 'down'],
  ['uiLeft', 'left'],
  ['uiRight', 'right'],
];
const HOTBAR_KEYS: readonly Action[] = ['hotbar1', 'hotbar2', 'hotbar3', 'hotbar4', 'hotbar5', 'hotbar6', 'hotbar7', 'hotbar8', 'hotbar9', 'hotbar10'];

export class ScreenController {
  private readonly stackSignal = signal<readonly ScreenId[]>([]);
  private readonly specs: ReadonlyMap<ScreenId, ScreenSpec>;
  /** The specs in order (indexed loops in `poll`: nothing is allocated per frame). */
  private readonly specList: readonly ScreenSpec[];
  private readonly now: () => number;
  private paused = false;
  private repeatAction: NavDirection | null = null;
  private repeatAt = 0;

  constructor(private readonly options: ScreenControllerOptions) {
    this.specs = new Map(options.screens.map((s) => [s.id, s]));
    this.specList = options.screens;
    this.now = options.now ?? (() => performance.now());
  }

  /** Open screens, bottom first. */
  get stack(): ReadonlySignal<readonly ScreenId[]> {
    return this.stackSignal;
  }

  /** The top screen, or `null`. */
  top(): ScreenId | null {
    const s = this.stackSignal.peek();
    return s[s.length - 1] ?? null;
  }

  isOpen(id: ScreenId): boolean {
    return this.stackSignal.peek().includes(id);
  }

  /** Opens `id` on top (no-op when it is open or may not open now); returns whether it is open afterwards. */
  open(id: ScreenId): boolean {
    if (this.isOpen(id)) return true;
    if (!this.specs.has(id) || this.options.canOpen?.(id) === false) return false;
    this.apply([...this.stackSignal.peek(), id]);
    return true;
  }

  /** Closes `id` and every screen above it. */
  close(id: ScreenId): void {
    const s = this.stackSignal.peek();
    const i = s.indexOf(id);
    if (i >= 0) this.apply(s.slice(0, i));
  }

  /** Closes every screen. */
  closeAll(): void {
    this.apply([]);
  }

  /** The page went to the background: open the pause menu (every pausing screen) on top while a game runs. */
  tabHidden(): void {
    if (this.options.autoPause?.() === false) return;
    for (const spec of this.specList) if (spec.pauses) this.open(spec.id);
  }

  /** Reads the frame's menu input (once per rendered frame; allocates nothing while no key is pressed). */
  poll(): void {
    const input = this.options.input;
    if (input === null) return;
    const top = this.top();
    if (top === null) {
      for (let i = 0; i < this.specList.length; i++) {
        const spec = this.specList[i] as ScreenSpec;
        if (!input.wasPressed(spec.opener)) continue;
        this.options.focus.keysUsed();
        if (this.open(spec.id)) return;
      }
      return;
    }
    const focus = this.options.focus;
    const spec = this.specs.get(top);
    // The opener closes its screen again – unless the same input navigates (D-pad up is both).
    if (spec !== undefined && input.wasPressedAnyContext(spec.opener) && !this.anyNavPressed(input)) {
      this.close(top);
      return;
    }
    for (let i = 0; i < NAV_BINDINGS.length; i++) {
      const [action, nav] = NAV_BINDINGS[i] as readonly [Action, NavAction];
      if (!input.wasPressed(action)) continue;
      if (!focus.handle(nav) && nav === 'back') this.close(top);
      if (this.top() !== top) return;
    }
    for (let i = 0; i < HOTBAR_KEYS.length; i++) {
      const key = HOTBAR_KEYS[i];
      if (key !== undefined && input.wasPressed(key)) focus.handle('hotbar', i);
    }
    this.repeat(input);
  }

  private anyNavPressed(input: ScreenInput): boolean {
    for (let i = 0; i < NAV_BINDINGS.length; i++) if (input.wasPressed((NAV_BINDINGS[i] as readonly [Action, NavAction])[0])) return true;
    return false;
  }

  /** Repeats a held direction (the first press went through `NAV_BINDINGS`). */
  private repeat(input: ScreenInput): void {
    const now = this.now();
    let held: NavDirection | null = null;
    for (let i = 0; i < DIRECTION_ACTIONS.length; i++) {
      const [action, dir] = DIRECTION_ACTIONS[i] as readonly [Action, NavDirection];
      if (input.wasPressed(action)) {
        this.repeatAction = dir;
        this.repeatAt = now + REPEAT_DELAY_MS;
        return;
      }
      if (held === null && input.isDown(action)) held = dir;
    }
    if (held === null || held !== this.repeatAction) {
      this.repeatAction = held;
      this.repeatAt = now + REPEAT_DELAY_MS;
      return;
    }
    if (now >= this.repeatAt) {
      this.repeatAt = now + REPEAT_INTERVAL_MS;
      this.options.focus.handle(held);
    }
  }

  private apply(next: readonly ScreenId[]): void {
    const before = this.stackSignal.peek();
    if (before.length === next.length && before.every((id, i) => id === next[i])) return;
    this.stackSignal.value = next;
    this.options.input?.setContext(next.length > 0 ? 'ui' : 'play');
    const pause = next.some((id) => this.specs.get(id)?.pauses === true);
    if (pause !== this.paused) {
      this.paused = pause;
      this.options.setPaused?.(pause);
    }
    this.repeatAction = null;
  }
}
