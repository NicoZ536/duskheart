/**
 * Dropped items in the game view (M3-10, M3-15; MASTERPROMPT §14 "fliegende Drops mit Magnet",
 * docs/SPIEL.md §2 "Welt-Drop nutzt dasselbe Icon"): every drop of the drop system is its item's icon
 * `icon_<item>` over the flat shadow `drop_schatten` (M3-10 art). In flight the icon rises and falls on
 * the arc of `flightArc` above its ground track while the shadow stays on the ground; lying, it bobs with
 * the shadow's clip `wippen`; pulled by the magnet it follows the drop's position. The drop in focus and
 * the one under the cursor carry the interaction outline (§4.6). Reads the drop components only;
 * allocates nothing per frame.
 *
 * Lying where the gameplay light map is dark or dim (M3-39, §4.6 readability), a drop glints: a faint
 * glimmer point at its upper edge, and every `DROP_GLINT.period` s – each drop in its own rhythm – a small
 * star flashes (`drop_glitzer`). The glint is emissive, so the night cannot swallow it, yet it lights
 * nothing (it is no light source, §12.1) and stays small and cool.
 */
import type { Entity } from '../../engine/ecs';
import { entityIndex } from '../../engine/ecs';
import { hash3, hashToUnit } from '../../engine/rng';
import type { DropSystem } from '../../game/drops/system';
import { flightArc } from '../../game/drops/formulas';
import { isFlying } from '../../game/drops/state';
import type { Layer } from '../../world/model/coords';
import { clipDuration, clipFrameAt, type AnimationClip } from '../anim/animation';
import type { AtlasData, AtlasManifest, AtlasSprite } from '../assets/atlas';
import type { SpriteFrameRef } from '../batch/spriteList';
import type { RenderScene } from '../scene';

/** Shadow under every drop. */
export const DROP_SHADOW_SPRITE = 'drop_schatten';
/** Clip of the bobbing shadow (frame 0 on the ground, frame 1 at the top of the bob). */
const BOB_CLIP = 'wippen';
/** Peak of the flight arc above the ground track [px]: a toss over a hand's height. */
export const DROP_ARC_PEAK_PX = 10;
/** Height of the icon's bottom above the ground while lying [px], and at the top of the bob. */
const REST_LIFT_PX = 2;
const BOB_LIFT_PX = 3;
/** Bob phase offset per entity index [s]: neighbouring drops do not bob in step. */
const BOB_PHASE_STEP = 0.37;
/** Dither fade of the drop shadow (0 opaque … 1 gone; the icons agent's `drop_schatten` asks for it). */
const DROP_SHADOW_FADE = 0.4;
/** The glint sorts just in front of its drop's icon. */
const GLINT_DEPTH_BIAS = 0.1;

/**
 * Glint of a drop in the dark (M3-39): sprite, clips, the period of the star flash [s], where it sits
 * relative to the icon's ground point [px: right, up], and the salt of each drop's own phase.
 */
export const DROP_GLINT = { sprite: 'drop_glitzer', glimmer: 'glimmen', flash: 'funkeln', period: 2.2, offsetX: 4, offsetY: 9, salt: 0x9117 } as const;

/** Whether world point (x, y) on `layer` is dark enough for lying drops to glint. */
export type DarkQuery = (layer: Layer, x: number, y: number) => boolean;

/**
 * Glint frame of a drop at `time`: the star clip while it flashes, else the glimmer point. `phase` 0–1 is
 * the drop's own offset in the rhythm.
 */
export function glintFrame(time: number, phase: number, glimmer: AnimationClip, flash: AnimationClip): number {
  const u = (((Math.max(0, time) + phase * DROP_GLINT.period) % DROP_GLINT.period) + DROP_GLINT.period) % DROP_GLINT.period;
  return u < clipDuration(flash) ? clipFrameAt(flash, u) : clipFrameAt(glimmer, u);
}

/** Sprite id of an item's icon (docs/SPIEL.md §2). */
export function iconSprite(item: string): string {
  return `icon_${item}`;
}

/** Height of a drop's icon above its ground point [px] at flight progress `t` (0…1), or lying with the bob frame. */
export function dropLift(flying: boolean, t: number, bobTop: boolean): number {
  if (flying) return REST_LIFT_PX + Math.round(flightArc(t) * DROP_ARC_PEAK_PX);
  return bobTop ? BOB_LIFT_PX : REST_LIFT_PX;
}

export class DropSprites {
  private manifest: AtlasManifest | null = null;
  private shadow: AtlasSprite | null = null;
  private glint: { sprite: AtlasSprite; glimmer: AnimationClip; flash: AnimationClip } | null = null;
  /** Drops that glinted in the last frame. */
  glinting = 0;
  private readonly icons = new Map<string, AtlasSprite | null>();
  /** Drops drawn in the last frame. */
  drawn = 0;

  /** Draws the drops of `layer`; `focused` and `hovered` get the outline; drops lying where `dark` says so glint. */
  draw(scene: RenderScene, atlas: AtlasData, drops: DropSystem, layer: Layer, time: number, focused: Entity, hovered: Entity, dark: DarkQuery | null = null): void {
    this.bind(atlas.manifest);
    this.drawn = 0;
    this.glinting = 0;
    const glint = this.glint;
    const shadow = this.shadow;
    const store = drops.store;
    const clip = shadow?.clips[BOB_CLIP];
    for (let i = 0; i < store.size; i++) {
      const d = store.valueAt(i);
      if (d.layer !== layer) continue;
      const icon = this.icon(d.stack.item);
      if (icon === null) continue;
      const e = store.entityAt(i);
      const flying = isFlying(d);
      const bobFrame = flying || clip === undefined ? 0 : clipFrameAt(clip, time + i * BOB_PHASE_STEP);
      const lift = dropLift(flying, flying ? d.flightTicks / d.flightTotal : 0, bobFrame === 1);
      const x = Math.round(d.x);
      const y = Math.round(d.y);
      if (shadow !== null) {
        const s = scene.sprite.reset();
        s.frame = (shadow.frames[bobFrame] ?? shadow.frames[0]) as SpriteFrameRef;
        s.x = x;
        s.y = y;
        s.layer = 'ground';
        // Dithered half away: the shadow reads as a soft darkening of the ground, not a dark disc.
        s.fade = DROP_SHADOW_FADE;
        scene.sprites.push(s);
      }
      const s = scene.sprite.reset();
      s.frame = icon.frames[0] as SpriteFrameRef;
      s.x = x;
      s.y = y - lift;
      s.depth = y;
      s.heightBase = lift;
      s.outline = e === focused || e === hovered;
      scene.sprites.push(s);
      this.drawn++;
      if (flying || glint === null || dark === null || !dark(layer, d.x, d.y)) continue;
      const g = scene.sprite.reset();
      const phase = hashToUnit(hash3(entityIndex(e), 0, DROP_GLINT.salt));
      g.frame = (glint.sprite.frames[glintFrame(time, phase, glint.glimmer, glint.flash)] ?? glint.sprite.frames[0]) as SpriteFrameRef;
      g.x = x + DROP_GLINT.offsetX;
      g.y = y - lift - DROP_GLINT.offsetY;
      g.depth = y + GLINT_DEPTH_BIAS;
      g.heightBase = lift + DROP_GLINT.offsetY;
      scene.sprites.push(g);
      this.glinting++;
    }
  }

  private bind(manifest: AtlasManifest): void {
    if (this.manifest === manifest) return;
    this.manifest = manifest;
    this.shadow = manifest.sprites[DROP_SHADOW_SPRITE] ?? null;
    const g = manifest.sprites[DROP_GLINT.sprite];
    const glimmer = g?.clips[DROP_GLINT.glimmer];
    const flash = g?.clips[DROP_GLINT.flash];
    this.glint = g === undefined || glimmer === undefined || flash === undefined ? null : { sprite: g, glimmer, flash };
    this.icons.clear();
  }

  private icon(item: string): AtlasSprite | null {
    let s = this.icons.get(item);
    if (s === undefined) {
      s = this.manifest?.sprites[iconSprite(item)] ?? null;
      this.icons.set(item, s);
    }
    return s;
  }
}
