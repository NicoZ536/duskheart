/**
 * Telegraphs of the creatures in the game view (M6-15 presentation, M6-15c; MASTERPROMPT §19.4 "Telegraphs: Ausholzeit
 * 0,3–0,8 s, klar sichtbar und hörbar; Boss-Flächenangriffe mit Bodenmarkierung", §4.6 "Ausholpose + kurzer Glint + Sound",
 * §2.8 "Effekte verdecken nie … Telegraphs"; docs/ART.md §8 "Telegraphs"). From every `creatureTelegraph`:
 *
 * - **Glint**: a short star (`kampf_glint`, emissive `eis.4*`) at the creature's head on the side it attacks, when its
 *   wind-up begins – the pose itself is the creature's attack clip (`creatures.ts`), the sound the audio kernel's.
 * - **Ground marker** of an area attack (`flaeche`: centre and radius): the danger zone on the ground in the warning colour
 *   (`kampf_punkt`, `feuer.2*` ≈ `UI_COLORS.warnung`), set pixel for pixel on the midpoint circle – a dashed ring that
 *   marches slowly, a second ring growing from the centre that meets the first on the tick the blow lands, and a sparse
 *   Bayer-dithered fill that thickens with it; the landing lights the ring bright for a moment. The marker follows the
 *   simulation: it keeps pace with a wind-up the hitstop stretches and vanishes when the wind-up breaks off (the creature
 *   staggered, fell or faded).
 *
 * Drawn on the ground layer (under every body: the marker never hides the creature, §2.8), emissive (readable at
 * night). Timed in simulation ticks like the rest of the fight (`combatFeedback.ts`). Fixed pools; no allocation per frame.
 */
import type { CreatureEventMap } from '../../game/creatures/events';
import type { CreatureSystem } from '../../game/creatures/system';
import { WAND_PX_JE_STUFE } from '../../world/autotile';
import { TILE_PX, type Layer } from '../../world/model/coords';
import type { AtlasManifest, AtlasSprite } from '../assets/atlas';
import type { SpriteFrameRef } from '../batch/spriteList';
import type { RenderScene } from '../scene';
import { CircleCache, DOT_SPRITE, PUNKT, type CombatFeedback } from './combatFeedback';

/** Telegraphs shown at once (a pack winding up together fits several times). */
const CAPACITY = 16;
/** The glint sits this share of the creature's size above its feet and this share of it towards the attack. */
const GLINT_HEIGHT = 0.6;
const GLINT_FORWARD = 0.3;
/** Ground marker: dash pattern (lit pixels of each period along the ring), march speed [ticks per pixel]. */
const DASH = { period: 8, lit: 6, ticksPerStep: 4 } as const;
/** Largest share of the disc the dithered fill covers (at the blow) – a hint, never a carpet. */
const FILL_MAX = 0.25;
/** Ticks the ring flashes bright after the blow landed. */
const IMPACT_TICKS = 8;
/** Emissive boost of the marker (0…1 → ×4): bright enough to read by day, glowing at night. */
const MARKER_GLOW = 0.5;
/** 4×4 Bayer thresholds (0…15)/16 of the fill. */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

/** Counters of the last frame (debug info, tests). */
export interface TelegraphStats {
  /** Telegraphs whose ground marker or glint is shown. */
  markers: number;
  /** Pixels of the markers. */
  markerPixels: number;
  glints: number;
}

export class TelegraphView {
  private readonly entity = new Float64Array(CAPACITY);
  private readonly tick = new Float64Array(CAPACITY).fill(Number.NEGATIVE_INFINITY);
  /** The tick the blow lands (stretched by hitstop while the wind-up runs). */
  private readonly end = new Float64Array(CAPACITY);
  private readonly layerOf = new Int8Array(CAPACITY);
  private readonly cx = new Float32Array(CAPACITY);
  private readonly cy = new Float32Array(CAPACITY);
  private readonly radius = new Float32Array(CAPACITY);
  private readonly level = new Int8Array(CAPACITY);
  private next = 0;
  /** Entries still winding up or flashing: a frame without any skips the pool (nothing is computed per slot). */
  private active = 0;
  private readonly circles = new CircleCache();
  private manifest: AtlasManifest | null = null;
  private dot: AtlasSprite | null = null;
  readonly stats: TelegraphStats = { markers: 0, markerPixels: 0, glints: 0 };

  clear(): void {
    this.tick.fill(Number.NEGATIVE_INFINITY);
    this.active = 0;
  }

  /**
   * A creature began to wind up (`creatureTelegraph`): its glint now (into `feedback`, `size` px tall creature on height
   * level `level`), and a ground marker for an area attack.
   */
  add(e: CreatureEventMap['creatureTelegraph'], size: number, level: number, feedback: CombatFeedback): void {
    feedback.glint(e.x + Math.cos(e.angle) * size * GLINT_FORWARD, e.y, size * GLINT_HEIGHT, e.layer, e.tick, level * WAND_PX_JE_STUFE);
    this.stats.glints++;
    const f = e.flaeche;
    if (f === null) return;
    const i = this.next;
    this.next = (i + 1) % CAPACITY;
    if (this.tick[i] === Number.NEGATIVE_INFINITY) this.active++;
    this.entity[i] = e.entity;
    this.tick[i] = e.tick;
    this.end[i] = e.tick + e.ticks;
    this.layerOf[i] = e.layer;
    this.cx[i] = f.x;
    this.cy[i] = f.y;
    this.radius[i] = f.radius;
    this.level[i] = level;
  }

  /**
   * Draws the ground markers of `layer` at simulation time `now` [ticks, fractional]; `creatures` tells whether each wind-up
   * still runs (and how long the hitstop stretched it).
   */
  draw(scene: RenderScene, manifest: AtlasManifest, creatures: CreatureSystem | null, layer: Layer, now: number): void {
    if (this.manifest !== manifest) {
      this.manifest = manifest;
      this.dot = manifest.sprites[DOT_SPRITE] ?? null;
    }
    const st = this.stats;
    st.markers = 0;
    st.markerPixels = 0;
    if (this.active === 0) return;
    const dot = this.dot;
    for (let i = 0; i < CAPACITY; i++) {
      const start = this.tick[i] as number;
      if (!(now >= start)) continue;
      let end = this.end[i] as number;
      if (now < end) {
        // Still winding up? The simulation's state decides (a stagger breaks it off, a hitstop stretches it).
        const s = creatures?.store.get(this.entity[i] as number);
        if (s === undefined || s.attackPhase !== 'ausholen' || s.attackTick !== start) {
          this.retire(i);
          continue;
        }
        end = s.attackEndTick;
        this.end[i] = end;
      } else if (now >= end + IMPACT_TICKS) {
        this.retire(i);
        continue;
      }
      if (this.layerOf[i] !== layer || dot === null) continue;
      st.markers++;
      this.marker(scene, dot, i, now, start, end);
    }
  }

  /** Telegraph `i` is over (broken off, or its landing's flash faded). */
  private retire(i: number): void {
    this.tick[i] = Number.NEGATIVE_INFINITY;
    this.active--;
  }

  /** The ground marker of telegraph `i` at `now` (wind-up from `start` to `end`, then the landing's flash). */
  private marker(scene: RenderScene, dot: AtlasSprite, i: number, now: number, start: number, end: number): void {
    const cx = Math.round(this.cx[i] as number);
    const cy = Math.round(this.cy[i] as number);
    const r = this.radius[i] as number;
    const base = (this.level[i] as number) * WAND_PX_JE_STUFE;
    const landed = now >= end;
    const progress = landed ? 1 : (now - start) / Math.max(1, end - start);
    // The outer ring: dashes marching around it; bright all round once the blow landed.
    const ring = this.circles.of(r);
    const march = Math.floor(now / DASH.ticksPerStep);
    for (let k = 0; k < ring.length; k++) {
      if (!landed && (k + march) % DASH.period >= DASH.lit) continue;
      const p = ring[k] as { dx: number; dy: number };
      this.pixel(scene, dot, cx + p.dx, cy + p.dy, base, landed ? PUNKT.warnHell : PUNKT.warn);
    }
    if (landed) return;
    // The inner ring grows to meet the outer one on the tick of the blow.
    const inner = this.circles.of(r * progress);
    for (let k = 0; k < inner.length; k++) {
      const p = inner[k] as { dx: number; dy: number };
      this.pixel(scene, dot, cx + p.dx, cy + p.dy, base, PUNKT.warnHell);
    }
    // The dithered fill thickens with the wind-up.
    const share = FILL_MAX * progress;
    const rr = Math.floor(r) - 1;
    for (let dy = -rr; dy <= rr; dy++) {
      for (let dx = -rr; dx <= rr; dx++) {
        if (dx * dx + dy * dy > rr * rr) continue;
        const x = cx + dx;
        const y = cy + dy;
        if ((BAYER4[((y & 3) << 2) | (x & 3)] as number) / 16 >= share) continue;
        this.pixel(scene, dot, x, y, base, PUNKT.warnFuell);
      }
    }
  }

  private pixel(scene: RenderScene, dot: AtlasSprite, x: number, y: number, heightBase: number, frame: number): void {
    const d = scene.sprite.reset();
    d.frame = dot.frames[frame] as SpriteFrameRef;
    d.x = x;
    d.y = y;
    d.layer = 'ground';
    d.heightBase = heightBase;
    d.emissiveBoost = MARKER_GLOW;
    scene.sprites.push(d);
    this.stats.markerPixels++;
  }
}

/** Height level of the tile under world px (x, y) read through `levelAt` (tile coordinates). */
export function levelUnder(x: number, y: number, levelAt: (tx: number, ty: number) => number): number {
  return levelAt(Math.floor(x / TILE_PX), Math.floor(y / TILE_PX));
}
