/**
 * Damage numbers of the fight in the world UI (M6-05; MASTERPROMPT §19.1 "Schadenszahlen (abschaltbar)", §29 "Spiel:
 * … Schadenszahlen"; docs/SPIEL.md §13): every `hitLanded` with damage puts its amount – rounded to whole points, at
 * least 1 – above the body it hit, a crit in the accent colour; a parry says so ("Parade!"). The number rises and fades
 * in the world UI's hard steps (`WorldUiList.damage`, pass `welt-ui`: unlit, crisp, readable by night). The setting
 * `game.damageNumbers` switches them off (the existing §29 game setting; default on).
 *
 * Timed in simulation ticks like the rest of the fight: a paused game holds them, a frozen picture whose simulation
 * stepped shows them risen that far. Texts are formatted once per value and kept; a fixed ring of entries – nothing is
 * allocated per frame.
 */
import type { Layer } from '../../world/model/coords';
import type { DamageKind, WorldUiList } from '../worldUi/worldUi';
import { DAMAGE_LIFETIME } from '../worldUi/worldUi';

/** Numbers shown at once (the oldest gives way). */
const CAPACITY = 32;
/** Largest value with a kept text (bigger hits show this; §D keeps hits far below). */
const MAX_TEXT = 9999;

/** Counters of the last frame (debug info, E2E). */
export interface DamageNumberStats {
  /** Numbers and labels drawn in the last frame. */
  shown: number;
  /** Numbers added since the view began (with the setting on or off). */
  added: number;
}

export class DamageNumbers {
  private readonly x = new Float32Array(CAPACITY);
  private readonly y = new Float32Array(CAPACITY);
  private readonly layerOf = new Int8Array(CAPACITY);
  private readonly tick = new Float64Array(CAPACITY).fill(Number.NEGATIVE_INFINITY);
  private readonly text: string[] = Array.from({ length: CAPACITY }, () => '');
  private readonly kind: DamageKind[] = Array.from({ length: CAPACITY }, (): DamageKind => 'treffer');
  private next = 0;
  /** Tick of the newest entry: once its lifetime ran out, a frame skips the ring. */
  private newest = Number.NEGATIVE_INFINITY;
  /**
   * The same as a whole tick (−1: nothing added since `clear`) and the whole tick after which no entry can be alive any
   * more at `quietHz` ticks per second (computed for `quietFor`): a frame past it – almost every frame – skips the ring
   * without forming a float (§30).
   */
  private newestTick = -1;
  private quietFor = -1;
  private quietHz = -1;
  private quietAfter = -1;
  /** Texts of whole numbers (formatted on first use). */
  private readonly texts: string[] = [];
  readonly stats: DamageNumberStats = { shown: 0, added: 0 };

  clear(): void {
    this.tick.fill(Number.NEGATIVE_INFINITY);
    this.newest = Number.NEGATIVE_INFINITY;
    this.newestTick = -1;
  }

  /** The text of `amount` damage: whole points, at least 1 for any damage (0 or less: none). */
  static textOf(amount: number, texts: string[] = []): string | null {
    if (!(amount > 0)) return null;
    const n = Math.min(MAX_TEXT, Math.max(1, Math.round(amount)));
    let t = texts[n];
    if (t === undefined) {
      t = String(n);
      texts[n] = t;
    }
    return t;
  }

  /** A hit of `amount` damage at (x, y) [the number's foot, world px] on `layer` at simulation tick `tick`. */
  add(x: number, y: number, layer: Layer, amount: number, crit: boolean, tick: number): void {
    const text = DamageNumbers.textOf(amount, this.texts);
    if (text === null) return;
    this.put(x, y, layer, text, crit ? 'kritisch' : 'treffer', tick);
  }

  /** A word instead of a number (a parry): `text` is a string the caller keeps (translated once). */
  label(x: number, y: number, layer: Layer, text: string, tick: number): void {
    this.put(x, y, layer, text, 'kritisch', tick);
  }

  private put(x: number, y: number, layer: Layer, text: string, kind: DamageKind, tick: number): void {
    const i = this.next;
    this.next = (i + 1) % CAPACITY;
    this.x[i] = x;
    this.y[i] = y;
    this.layerOf[i] = layer;
    this.tick[i] = tick;
    this.text[i] = text;
    this.kind[i] = kind;
    if (tick > this.newest) this.newest = tick;
    if (tick > this.newestTick) this.newestTick = Math.ceil(tick);
    this.stats.added++;
  }

  /**
   * Whether `draw` shows nothing at any moment of the frame before whole tick `tick` (in [tick − 1, tick]): nothing added
   * since `clear`, or the newest entry's lifetime over – whole numbers only (§30); `draw` then only resets the counter.
   */
  restingAt(tick: number, tickHz: number): boolean {
    return this.newestTick < 0 || tick - 1 > this.quietAfterAt(tickHz);
  }

  /** The whole tick after which no entry is alive at `tickHz` ticks per second (computed once per newest entry and rate). */
  private quietAfterAt(tickHz: number): number {
    if (this.quietFor !== this.newestTick || this.quietHz !== tickHz) {
      this.quietFor = this.newestTick;
      this.quietHz = tickHz;
      this.quietAfter = this.newestTick + Math.ceil(DAMAGE_LIFETIME * tickHz) + 1;
    }
    return this.quietAfter;
  }

  /** Puts the numbers of `layer` alive at simulation time `now` [ticks] into the world UI (nothing while `enabled` is false). */
  draw(ui: WorldUiList, layer: Layer, now: number, tickHz: number, enabled: boolean): void {
    this.stats.shown = 0;
    if (!enabled || this.newestTick < 0) return;
    if (now > this.quietAfterAt(tickHz) || !(now - this.newest < DAMAGE_LIFETIME * tickHz)) return;
    for (let i = 0; i < CAPACITY; i++) {
      const age = (now - (this.tick[i] as number)) / tickHz;
      if (!(age >= 0) || age >= DAMAGE_LIFETIME || this.layerOf[i] !== layer) continue;
      ui.damage(this.x[i] as number, this.y[i] as number, this.text[i] as string, age, this.kind[i] as DamageKind);
      this.stats.shown++;
    }
  }
}
