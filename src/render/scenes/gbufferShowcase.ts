/**
 * Scenarios `gbuffer-*` (M1-17): a small glade that fills every G-buffer channel – relief of tree,
 * rocks and figures (normals, height), torches and glowing mushrooms (emissive), metal helmet and
 * sword (gloss), the pond and its muddy shore (water mask, wetness), swaying grass (wind material),
 * an outlined interactable figure and one in its hit flash.
 */
import { defaultFigureState, type FigureRig } from '../anim/figure';
import type { Direction } from '../anim/animation';
import { atlasSprite, spriteClip, spriteFrame, type AtlasData, type AtlasSprite } from '../assets/atlas';
import { clipFrameAt, type AnimationClip } from '../anim/animation';
import { sceneAtlas } from '../assets/sceneSprites';
import type { RenderScene } from '../scene';
import { equippedWanderer } from './figures';
import { fillGrass, hash01, place } from './layout';
import type { SceneSource } from './sceneSource';

const STATIC: readonly (readonly [string, number, number])[] = [
  ['laubbaum', -150, 10],
  ['laubbaum', 170, -30],
  ['fels', -110, 26],
  ['fels', -60, -70],
  ['fels', 150, 96],
  ['leuchtpilz', -128, 34],
  ['leuchtpilz', 196, -12],
  ['leuchtpilz', -40, 104],
];
const TORCHES: readonly (readonly [number, number])[] = [
  [-40, -20],
  [60, -44],
  [110, 40],
];
const BUSHES: readonly (readonly [number, number])[] = [
  [-90, -40],
  [-20, 70],
  [30, 96],
  [90, -90],
  [200, 30],
  [-190, 90],
];
const FIGURES: readonly (readonly [number, number, Direction, boolean, 'none' | 'outline' | 'flash'])[] = [
  [0, 20, 'down', true, 'none'],
  [-70, 60, 'right', false, 'outline'],
  [70, 70, 'left', true, 'flash'],
];
const POND: readonly [number, number] = [20, 132];
const DIRT: readonly (readonly [number, number])[] = [
  [-10, 40],
  [90, 10],
];
/** Wind for the grass and crowns (signed strength, see sprite_gbuffer.vert). */
const WIND = 1;
const BUSH_SWAY = 1.5;
const CROWN_SWAY = 0.6;
const TAU = Math.PI * 2;

export class GBufferShowcaseScene implements SceneSource {
  readonly id = 'gbuffer';
  private readonly atlas: AtlasData = sceneAtlas();
  private readonly rig: FigureRig = equippedWanderer(this.atlas);
  private readonly figure = defaultFigureState();
  private readonly staticSprites: readonly AtlasSprite[];
  private readonly staticPhases: Float32Array;
  private readonly bushPhases: Float32Array;
  private readonly bush: AtlasSprite;
  private readonly torch: AtlasSprite;
  private readonly burn: AnimationClip;

  constructor() {
    const m = this.atlas.manifest;
    this.staticSprites = STATIC.map(([id]) => atlasSprite(m, id));
    this.staticPhases = Float32Array.from(STATIC, ([, x, y]) => hash01(x, y) * TAU);
    this.bushPhases = Float32Array.from(BUSHES, ([x, y]) => hash01(x, y) * TAU);
    this.bush = atlasSprite(m, 'grasbusch');
    this.torch = atlasSprite(m, 'fackel');
    this.burn = spriteClip(this.torch, 'brennen');
  }

  fill(scene: RenderScene, time: number): void {
    const a = this.atlas;
    scene.atlas = a;
    scene.env.wind = WIND;
    scene.camera.set(0, 0).unfollow();
    fillGrass(scene, a, 0, 0);
    for (let i = 0; i < DIRT.length; i++) place(scene, a, 'erdfleck', 0, DIRT[i]?.[0] ?? 0, DIRT[i]?.[1] ?? 0, 'ground');
    place(scene, a, 'teich_ufer', 0, POND[0], POND[1], 'ground');
    place(scene, a, 'teich', 0, POND[0], POND[1], 'water');
    const d = scene.sprite;
    for (let i = 0; i < STATIC.length; i++) {
      const sprite = this.staticSprites[i];
      const entry = STATIC[i];
      if (!sprite || !entry) continue;
      d.reset();
      d.frame = spriteFrame(sprite, 0);
      d.x = entry[1];
      d.y = entry[2];
      // Crowns sway a little in the wind; rocks and mushrooms stand still.
      if (sprite.id === 'laubbaum') d.windAmplitude = CROWN_SWAY;
      d.windPhase = this.staticPhases[i] ?? 0;
      scene.sprites.push(d);
    }
    for (let i = 0; i < BUSHES.length; i++) {
      d.reset();
      d.frame = spriteFrame(this.bush, 0);
      d.x = BUSHES[i]?.[0] ?? 0;
      d.y = BUSHES[i]?.[1] ?? 0;
      d.windAmplitude = BUSH_SWAY;
      d.windPhase = this.bushPhases[i] ?? 0;
      scene.sprites.push(d);
    }
    for (let i = 0; i < TORCHES.length; i++) {
      d.reset();
      d.frame = spriteFrame(this.torch, clipFrameAt(this.burn, time + i * this.burn.frames.length));
      d.x = TORCHES[i]?.[0] ?? 0;
      d.y = TORCHES[i]?.[1] ?? 0;
      scene.sprites.push(d);
    }
    const f = this.figure;
    for (let i = 0; i < FIGURES.length; i++) {
      const fig = FIGURES[i];
      if (!fig) continue;
      f.x = fig[0];
      f.y = fig[1];
      f.direction = fig[2];
      f.action = fig[3] ? 'walk' : 'idle';
      f.time = time;
      f.itemTime = time;
      f.outline = fig[4] === 'outline';
      f.flash = fig[4] === 'flash';
      this.rig.emit(scene.sprites, scene.sprite, f);
    }
  }
}
