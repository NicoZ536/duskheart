/**
 * Helpers of the scenes built on the game atlas (`KitScene`): placing single sprite frames and
 * pushing point lights with their colours. Shared by the light scenes, the Grünhain showcase of the
 * title screen, the palette and the world-UI scenes.
 */
import { spriteFrame, type AtlasSprite } from '../assets/atlas';
import type { RenderScene } from '../scene';

export type Rgb = readonly [number, number, number];

/** Light colours (linear): warm lamp, fire, the cold glow of lumenite. */
export const WARM: Rgb = [1, 0.84, 0.6];
export const FIRE: Rgb = [1, 0.58, 0.26];
export const LUMEN: Rgb = [0.45, 0.78, 1];

/** A point light without its position. */
export interface LightSpec {
  readonly height: number;
  readonly radius: number;
  readonly color: Rgb;
  readonly intensity: number;
  readonly flicker: number;
  readonly seed: number;
}

/** Pushes a point light at world (x, y). */
export function pushLight(scene: RenderScene, x: number, y: number, s: LightSpec): void {
  const l = scene.light.reset();
  l.x = x;
  l.y = y;
  l.height = s.height;
  l.radius = s.radius;
  l.r = s.color[0];
  l.g = s.color[1];
  l.b = s.color[2];
  l.intensity = s.intensity;
  l.flicker = s.flicker;
  l.seed = s.seed;
  scene.lights.push(l);
}

/** Options of `placeSprite` beyond position and frame. */
export interface PlaceOptions {
  /** Interaction outline (§4.6). */
  readonly outline?: boolean;
  readonly paletteRow?: number;
  readonly mirror?: boolean;
  /** Wind sway at the top of the sprite (px). */
  readonly wind?: number;
  readonly windPhase?: number;
}

const NO_OPTIONS: PlaceOptions = {};

/** Pushes frame `frame` of `sprite` with its anchor at world (x, y). */
export function placeSprite(scene: RenderScene, sprite: AtlasSprite, frame: number, x: number, y: number, options: PlaceOptions = NO_OPTIONS): void {
  const d = scene.sprite.reset();
  d.frame = spriteFrame(sprite, frame);
  d.x = x;
  d.y = y;
  d.outline = options.outline ?? false;
  d.paletteRow = options.paletteRow ?? 0;
  d.mirror = options.mirror ?? false;
  d.windAmplitude = options.wind ?? 0;
  d.windPhase = options.windPhase ?? 0;
  scene.sprites.push(d);
}
