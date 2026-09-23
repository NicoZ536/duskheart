/**
 * Scenario `ysort` (M1-15): layer order ground → water mask → y-sorted objects → canopy, sorted by
 * anchor (foot point). A figure stands behind the tree (hidden by trunk and crown), one in front of
 * it; a row of objects shares nearly the same depth; the player under a canopy tree is revealed by
 * the dithered see-through circle.
 */
import { defaultFigureState, type FigureRig } from '../anim/figure';
import type { Direction } from '../anim/animation';
import type { AtlasData } from '../assets/atlas';
import { sceneAtlas } from '../assets/sceneSprites';
import type { RenderScene } from '../scene';
import { equippedWanderer } from './figures';
import { fillGrass, place } from './layout';
import type { SceneSource } from './sceneSource';

/** Placements: sprite id, x, y (anchor), layer. */
const OBJECTS: readonly (readonly [string, number, number])[] = [
  ['laubbaum', -120, 30],
  ['fels', -84, 44],
  ['fels', 4, 6],
  ['fackel', -30, -8],
  ['grasbusch', 14, 2],
  ['fackel', 40, 12],
  ['grasbusch', -150, 58],
  ['leuchtpilz', 96, 88],
];
/** Figures: x, y, direction, walking. */
const FIGURES: readonly (readonly [number, number, Direction, boolean])[] = [
  [-114, 6, 'down', false],
  [-130, 54, 'right', true],
  [0, 0, 'left', true],
  [104, 70, 'down', false],
];
const POND: readonly [number, number] = [120, 76];
const CANOPY_TREE: readonly [number, number] = [130, -30];
const PLAYER: readonly [number, number] = [132, -44];
/** Radius of the see-through circle around the player (world px) and its centre above the feet. */
const FADE_RADIUS = 16;
const FADE_LIFT = 12;
const DIRT: readonly [number, number] = [-20, 60];

export class YSortScene implements SceneSource {
  readonly id = 'ysort';
  private readonly atlas: AtlasData = sceneAtlas();
  private readonly rig: FigureRig = equippedWanderer(this.atlas);
  private readonly figure = defaultFigureState();

  fill(scene: RenderScene, time: number): void {
    const a = this.atlas;
    scene.atlas = a;
    scene.camera.set(0, 0).unfollow();
    fillGrass(scene, a, 0, 0);
    place(scene, a, 'erdfleck', 0, DIRT[0], DIRT[1], 'ground');
    place(scene, a, 'teich_ufer', 0, POND[0], POND[1], 'ground');
    place(scene, a, 'teich', 0, POND[0], POND[1], 'water');
    for (const [id, x, y] of OBJECTS) place(scene, a, id, 0, x, y);
    const f = this.figure;
    for (const [x, y, dir, walking] of FIGURES) {
      f.x = x;
      f.y = y;
      f.direction = dir;
      f.action = walking ? 'walk' : 'idle';
      f.time = time;
      f.itemTime = time;
      this.rig.emit(scene.sprites, scene.sprite, f);
    }
    place(scene, a, 'laubbaum', 0, CANOPY_TREE[0], CANOPY_TREE[1], 'canopy');
    f.x = PLAYER[0];
    f.y = PLAYER[1];
    f.direction = 'down';
    f.action = 'idle';
    this.rig.emit(scene.sprites, scene.sprite, f);
    scene.fadeX = PLAYER[0];
    scene.fadeY = PLAYER[1] - FADE_LIFT;
    scene.fadeRadius = FADE_RADIUS;
  }
}
