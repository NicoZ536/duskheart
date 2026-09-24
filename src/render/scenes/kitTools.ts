/**
 * Helpers of the scenes built on the game atlas (`KitScene`): placing single sprite frames, pushing
 * point lights (a torch's at the height of its flame) and setting the ambient light (colours from `light/lightColors.ts`). Shared by the
 * light scenes, the Grünhain showcase of the title screen, the palette and the world-UI scenes.
 */
import { spriteFrame, type AtlasSprite } from '../assets/atlas';
import type { Rgb } from '../light/lightColors';
import type { RenderEnvironment, RenderScene } from '../scene';
import type { SceneKit } from '../tilemap/sceneKit';

/** Sets the ambient light of `env` to colour `color` at `intensity` (§6.1 pass 5). */
export function setAmbient(env: RenderEnvironment, color: Rgb, intensity: number): void {
  env.ambientR = color[0];
  env.ambientG = color[1];
  env.ambientB = color[2];
  env.ambientIntensity = intensity;
}

/** A point light without its position. */
export interface LightSpec {
  readonly height: number;
  readonly radius: number;
  readonly color: Rgb;
  readonly intensity: number;
  readonly flicker: number;
  readonly seed: number;
}

/** The light of a torch: its height is the flame of the kit's torch sprite (`SceneKit.torchFlameHeight`). */
export type TorchLightSpec = Omit<LightSpec, 'height'>;

/** Pushes a point light at world (x, y). */
export function pushLight(scene: RenderScene, x: number, y: number, s: LightSpec): void {
  pushLightAt(scene, x, y, s.height, s);
}

/** Pushes the light of the kit's torch standing at world (x, y): in the heart of its flame. */
export function pushTorchLight(scene: RenderScene, kit: SceneKit, x: number, y: number, s: TorchLightSpec): void {
  pushLightAt(scene, x, y, kit.torchFlameHeight, s);
}

function pushLightAt(scene: RenderScene, x: number, y: number, height: number, s: TorchLightSpec): void {
  const l = scene.light.reset();
  l.x = x;
  l.y = y;
  l.height = height;
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
