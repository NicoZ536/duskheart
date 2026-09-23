/**
 * Scene `gruenhain` – the picture behind the title card of the default boot (MASTERPROMPT §4.1
 * "warme Lichtinseln in kühler, bedrohlicher Dunkelheit", §26 "Hauptmenü mit lebendiger
 * Pixel-Szene"): a Grünhain clearing at dusk on the chunk tile map – meadow in its variants, a dirt
 * road with grass edges, rocks, deciduous trees swaying in a light wind – and the player idling
 * between two burning torches whose flickering light pools warm the cold blue evening.
 *
 * Everything comes from the game atlas of `npm run assets` (in-memory scene atlas as fallback) and
 * runs through the full pipeline: G-buffer, normal-mapped point lights, composition with light bands
 * and dither, tonemapping, presentation. The upper third stays calm for the title card; the camera
 * rests on whole pixels, so the scene is also the reference for the resolution screenshots.
 */
import { clipFrameAt } from '../anim/animation';
import type { AtlasData } from '../assets/atlas';
import type { RenderScene } from '../scene';
import { KitScene, meadowWithRoad } from '../tilemap/kitScene';
import type { SceneKit } from '../tilemap/sceneKit';
import { FIRE, placeSprite, pushLight, type LightSpec, type PlaceOptions, type Rgb } from './kitTools';

/** World tile row of the road's north edge (road over world px 48…96). */
const ROAD_ROW = 3;
/** Camera centre (world px, whole pixels: no subpixel offset in the reference screenshots). */
export const GRUENHAIN_CAMERA: readonly [number, number] = [0, 0];

/** Dusk: a cold blue-violet evening sky light, dim enough that the torch light carries the picture. */
const AMBIENT: Rgb = [0.42, 0.5, 1];
const AMBIENT_INTENSITY = 0.34;
/** Wind strength (sign = direction) and the crowns' sway at their top (px). */
const WIND = 1;
const CROWN_SWAY = 1;

/** Height of a torch flame above the torch's foot (px; the sprite's `licht` socket). */
const FLAME_HEIGHT = 9;
const TORCH_NEAR: LightSpec = { height: FLAME_HEIGHT, radius: 112, color: FIRE, intensity: 1.45, flicker: 0.28, seed: 2.3 };
const TORCH_FAR: LightSpec = { height: FLAME_HEIGHT, radius: 92, color: FIRE, intensity: 1.25, flicker: 0.32, seed: 5.9 };

/** Anchors (world px). */
const TORCHES: readonly (readonly [number, number, LightSpec])[] = [
  [-44, 52, TORCH_NEAR],
  [132, 50, TORCH_FAR],
];
const PLAYER: readonly [number, number] = [-14, 60];
const ROCK_BIG: readonly [number, number] = [64, 36];
const ROCKS_SMALL: readonly (readonly [number, number])[] = [
  [96, 42],
  [-120, 116],
  [168, 120],
  [-176, 50],
];
/**
 * Trees framing the clearing on both sides: x, y, wind phase (rad). None stands behind the title
 * card (|x| < 110 with the crown above y = −40).
 */
const TREES: readonly (readonly [number, number, number])[] = [
  [-150, 22, 0],
  [-216, -34, 1.9],
  [-150, -86, 3.7],
  [-272, 58, 0.8],
  [172, -14, 3.1],
  [232, 44, 4.4],
  [214, -92, 5.2],
];

export class GruenhainScene extends KitScene {
  readonly id = 'gruenhain';
  private readonly crown: PlaceOptions[] = TREES.map(([, , phase]) => ({ wind: CROWN_SWAY, windPhase: phase }));

  constructor(gameAtlas: () => AtlasData | null) {
    super(gameAtlas, { first: -1, last: 0 }, { first: -1, last: 0 });
  }

  protected terrain(kit: SceneKit): (wx: number, wy: number) => number {
    return meadowWithRoad(kit, ROAD_ROW);
  }

  protected environment(scene: RenderScene): void {
    const env = scene.env;
    env.ambientR = AMBIENT[0];
    env.ambientG = AMBIENT[1];
    env.ambientB = AMBIENT[2];
    env.ambientIntensity = AMBIENT_INTENSITY;
    env.wind = WIND;
  }

  protected compose(scene: RenderScene, kit: SceneKit, time: number): void {
    scene.camera.set(GRUENHAIN_CAMERA[0], GRUENHAIN_CAMERA[1]).unfollow();
    for (let i = 0; i < TREES.length; i++) {
      const t = TREES[i];
      if (t) placeSprite(scene, kit.tree, 0, t[0], t[1], this.crown[i]);
    }
    placeSprite(scene, kit.rockBig, 0, ROCK_BIG[0], ROCK_BIG[1]);
    for (let i = 0; i < ROCKS_SMALL.length; i++) {
      const r = ROCKS_SMALL[i];
      if (r) placeSprite(scene, kit.rockSmall, 0, r[0], r[1]);
    }
    for (let i = 0; i < TORCHES.length; i++) {
      const t = TORCHES[i];
      if (!t) continue;
      // Each torch burns in its own rhythm (phase = light seed).
      placeSprite(scene, kit.torch, clipFrameAt(kit.torchClip, time + t[2].seed), t[0], t[1]);
      pushLight(scene, t[0], t[1], t[2]);
    }
    placeSprite(scene, kit.figure, clipFrameAt(kit.idle.down, time), PLAYER[0], PLAYER[1]);
  }
}
