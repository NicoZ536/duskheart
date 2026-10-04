/**
 * Noise events (docs/SPIEL.md §11 "Wahrnehmung (M6-14)": source, layer, place, radius; MASTERPROMPT §19.4 "Gehör
 * (Geräuschereignisse mit Radius: Sprinten, Kampf, Holzhacken, Abbau, Türen; Regen dämpft)").
 *
 * The bus holds the noises of the current tick. The creature system fills it once per tick from the events the other
 * systems pushed earlier in the same tick (`collect`: steps with the body's `noise` – sprinting 1,5, sneaking 0,3 = −70 % –,
 * blows and hits, chopping, felling, mining, digging, doors, building; `BALANCE.ai.noise` radii) and adds its own (a
 * creature's alarm call); creatures then hear what lies within their hearing radius (`hearingRadiusTiles`). Nothing is
 * saved: noises last one tick. Columns grow and are reused – no allocation per tick.
 */
import { BALANCE } from '../../content/balance';
import { NULL_ENTITY, type Entity } from '../../engine/ecs';
import { TILE_PX, type Layer } from '../../world/model/coords';
import type { Simulation } from '../sim';

const N = BALANCE.ai.noise;

/** Initial capacity of the bus [noises]. */
const INITIAL = 16;

/** Where the player stands (steps carry no position). */
export interface NoiseListenerPosition {
  (sim: Simulation, out: { x: number; y: number; layer: Layer }): boolean;
}

/** The noises of a tick as columns: layer, place [px], radius [tiles], source entity (`NoiseBus.columns`). */
export class NoiseColumns {
  layers = new Int8Array(0);
  xs = new Float64Array(0);
  ys = new Float64Array(0);
  radii = new Float64Array(0);
  sources = new Float64Array(0);
}

/** The noises of one tick. */
export class NoiseBus {
  private tickValue = -1;
  private countValue = 0;
  private layers = new Int8Array(INITIAL);
  private xs = new Float64Array(INITIAL);
  private ys = new Float64Array(INITIAL);
  private radii = new Float64Array(INITIAL);
  private sources = new Float64Array(INITIAL);
  private readonly pos = { x: 0, y: 0, layer: 0 as Layer };
  private readonly cols = new NoiseColumns();
  private sim: Simulation | null = null;
  private playerPosition: NoiseListenerPosition | null = null;

  // Bound once: no closure per tick for the event queue.
  private readonly onStep = (p: { readonly entity: Entity; readonly noise: number; readonly tick: number }): void => {
    if (p.tick !== this.tickValue || this.sim === null || this.playerPosition === null || !(p.noise > 0)) return;
    if (this.playerPosition(this.sim, this.pos)) this.emit(this.pos.layer, this.pos.x, this.pos.y, N.step * p.noise, p.entity);
  };
  private readonly onAttack = (p: { readonly entity: Entity; readonly layer: Layer; readonly x: number; readonly y: number; readonly tick: number }): void => {
    if (p.tick === this.tickValue) this.emit(p.layer, p.x, p.y, N.attack, p.entity);
  };
  private readonly onHit = (p: { readonly attacker: Entity; readonly layer: Layer; readonly x: number; readonly y: number; readonly tick: number }): void => {
    if (p.tick === this.tickValue) this.emit(p.layer, p.x, p.y, N.hit, p.attacker);
  };
  private readonly onHarvest = (p: { readonly layer: Layer; readonly x: number; readonly y: number; readonly action: string; readonly tick: number }): void => {
    if (p.tick !== this.tickValue) return;
    const r = p.action === 'faellen' || p.action === 'roden' ? N.chop : p.action === 'abbauen' || p.action === 'hacken' ? N.mine : p.action === 'graben' ? N.dig : 0;
    if (r > 0) this.emit(p.layer, p.x, p.y, r, NULL_ENTITY);
  };
  private readonly onFelled = (p: { readonly layer: Layer; readonly tx: number; readonly ty: number; readonly tick: number }): void => {
    if (p.tick === this.tickValue) this.emit(p.layer, (p.tx + 1 / 2) * TILE_PX, (p.ty + 1 / 2) * TILE_PX, N.treeFall, NULL_ENTITY);
  };
  private readonly onDug = (p: { readonly layer: Layer; readonly tx: number; readonly ty: number; readonly tick: number }): void => {
    if (p.tick === this.tickValue) this.emit(p.layer, (p.tx + 1 / 2) * TILE_PX, (p.ty + 1 / 2) * TILE_PX, N.dig, NULL_ENTITY);
  };
  private readonly onDoor = (p: { readonly layer: number; readonly tx: number; readonly ty: number; readonly tick: number }): void => {
    if (p.tick === this.tickValue) this.emit(p.layer as Layer, (p.tx + 1 / 2) * TILE_PX, (p.ty + 1 / 2) * TILE_PX, N.door, NULL_ENTITY);
  };
  private readonly onBuild = (p: { readonly layer: number; readonly tx: number; readonly ty: number; readonly tick: number }): void => {
    if (p.tick === this.tickValue) this.emit(p.layer as Layer, (p.tx + 1 / 2) * TILE_PX, (p.ty + 1 / 2) * TILE_PX, N.build, NULL_ENTITY);
  };

  /** Tick of the noises held. */
  get tick(): number {
    return this.tickValue;
  }

  /** Number of noises held. */
  get count(): number {
    return this.countValue;
  }

  /** Where steps are heard (the player's feet). */
  usePlayerPosition(fn: NoiseListenerPosition): void {
    this.playerPosition = fn;
  }

  /** Starts tick `tick` (drops the noises of an earlier tick). */
  begin(tick: number): void {
    if (tick === this.tickValue) return;
    this.tickValue = tick;
    this.countValue = 0;
  }

  /** Adds the noises of this tick's events (steps, fights, work, doors, building). */
  collect(sim: Simulation): void {
    this.begin(sim.eventTick);
    this.sim = sim;
    const ev = sim.events;
    ev.forEachOfType('playerStep', this.onStep);
    ev.forEachOfType('attackStarted', this.onAttack);
    ev.forEachOfType('hitLanded', this.onHit);
    ev.forEachOfType('harvestHit', this.onHarvest);
    ev.forEachOfType('treeFelled', this.onFelled);
    ev.forEachOfType('tileDug', this.onDug);
    ev.forEachOfType('doorToggled', this.onDoor);
    ev.forEachOfType('partPlaced', this.onBuild);
  }

  /** Adds a noise of radius `radiusTiles` at (x, y) on `layer`, made by `source` (`NULL_ENTITY`: the world). */
  emit(layer: Layer, x: number, y: number, radiusTiles: number, source: Entity): void {
    if (this.countValue === this.xs.length) this.grow();
    const i = this.countValue++;
    this.layers[i] = layer;
    this.xs[i] = x;
    this.ys[i] = y;
    this.radii[i] = radiusTiles;
    this.sources[i] = source;
  }

  layer(i: number): Layer {
    return this.layers[i] as Layer;
  }

  x(i: number): number {
    return this.xs[i] as number;
  }

  /**
   * The columns of the noises held (indices 0 … `count` − 1; a growing bus replaces them, so read them anew each tick) –
   * the creatures' hearing reads them directly (M6-16d: no number crosses a call per noise and creature).
   */
  get columns(): NoiseColumns {
    const c = this.cols;
    c.layers = this.layers;
    c.xs = this.xs;
    c.ys = this.ys;
    c.radii = this.radii;
    c.sources = this.sources;
    return c;
  }

  y(i: number): number {
    return this.ys[i] as number;
  }

  /** Radius of noise `i` [tiles]. */
  radius(i: number): number {
    return this.radii[i] as number;
  }

  source(i: number): Entity {
    return this.sources[i] as number;
  }

  private grow(): void {
    const n = this.xs.length * 2;
    const layers = new Int8Array(n);
    layers.set(this.layers);
    this.layers = layers;
    for (const key of ['xs', 'ys', 'radii', 'sources'] as const) {
      const a = new Float64Array(n);
      a.set(this[key]);
      this[key] = a;
    }
  }
}
