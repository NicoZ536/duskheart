/**
 * Keyboard panning of the world debug camera (M2-28 "freie Debug-Kamera"): while a world scene is
 * shown, the arrow keys move its camera by a fixed step per rendered frame (Shift: faster). The
 * world scenes are debug scenes (`?scenario=` or `__dh.call('renderScene', …)`), so the listener
 * only exists while one of them is active; game input never sees it (the arrow keys are no default
 * binding of the player, §26).
 */

/** Pan step per rendered frame [world px]: normal and with Shift held. */
export const DEBUG_PAN_STEP = { normal: 3, fast: 12 } as const;

const KEY_DIRECTIONS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};
const PAN_KEYS: readonly string[] = Object.keys(KEY_DIRECTIONS);

/** Minimal event target (the page's window). */
export interface KeyEventTarget {
  addEventListener(type: 'keydown' | 'keyup' | 'blur', listener: (e: Event) => void): void;
  removeEventListener(type: 'keydown' | 'keyup' | 'blur', listener: (e: Event) => void): void;
}

interface KeyLike {
  readonly key?: string;
  readonly shiftKey?: boolean;
}

export class DebugPanKeys {
  private readonly held = new Set<string>();
  private fast = false;
  private target: KeyEventTarget | null = null;
  private readonly onDown = (e: Event): void => {
    const k = e as unknown as KeyLike;
    this.fast = k.shiftKey === true;
    if (k.key !== undefined && KEY_DIRECTIONS[k.key] !== undefined) this.held.add(k.key);
  };
  private readonly onUp = (e: Event): void => {
    const k = e as unknown as KeyLike;
    this.fast = k.shiftKey === true;
    if (k.key !== undefined) this.held.delete(k.key);
  };
  private readonly onBlur = (): void => {
    this.held.clear();
    this.fast = false;
  };

  get attached(): boolean {
    return this.target !== null;
  }

  attach(target: KeyEventTarget): void {
    if (this.target === target) return;
    this.detach();
    this.target = target;
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    const t = this.target;
    if (t === null) return;
    t.removeEventListener('keydown', this.onDown);
    t.removeEventListener('keyup', this.onUp);
    t.removeEventListener('blur', this.onBlur);
    this.target = null;
    this.onBlur();
  }

  /** Pan of this frame into `out` (world px); (0, 0) while no arrow key is held. */
  step(out: [number, number]): [number, number] {
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < PAN_KEYS.length; i++) {
      const key = PAN_KEYS[i] as string;
      const d = KEY_DIRECTIONS[key];
      if (d === undefined || !this.held.has(key)) continue;
      dx += d[0];
      dy += d[1];
    }
    const step = this.fast ? DEBUG_PAN_STEP.fast : DEBUG_PAN_STEP.normal;
    out[0] = Math.sign(dx) * step;
    out[1] = Math.sign(dy) * step;
    return out;
  }
}
