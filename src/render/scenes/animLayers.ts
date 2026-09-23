/**
 * Scenario `anim-layers` (M1-16): the equipped figure in all four directions (rows) – idle and the
 * four walk frames side by side (columns). Helmet, sword and torch follow the head and hand sockets
 * of every frame; the draw order changes with the direction; the torch flame animates on its own.
 */
import { clipDuration } from '../anim/animation';
import { defaultFigureState, type FigureRig } from '../anim/figure';
import { DIRECTIONS } from '../anim/animation';
import { atlasSprite, spriteClip, type AtlasData } from '../assets/atlas';
import { sceneAtlas } from '../assets/sceneSprites';
import type { RenderScene } from '../scene';
import { equippedWanderer } from './figures';
import { fillGrass } from './layout';
import type { SceneSource } from './sceneSource';

const COLUMN_SPACING = 48;
const ROW_SPACING = 56;
const FIRST_ROW_Y = -64;
/** Columns: idle, then the walk cycle's frames 0–3. */
const WALK_COLUMNS = 4;

export class AnimLayersScene implements SceneSource {
  readonly id = 'anim-layers';
  private readonly atlas: AtlasData = sceneAtlas();
  private readonly rig: FigureRig = equippedWanderer(this.atlas);
  private readonly figure = defaultFigureState();
  private readonly walkFrameTime: number;

  constructor() {
    const walk = spriteClip(atlasSprite(this.atlas.manifest, 'wanderer'), 'walk_down');
    this.walkFrameTime = clipDuration(walk) / walk.frames.length;
  }

  fill(scene: RenderScene, time: number): void {
    scene.atlas = this.atlas;
    scene.camera.set(0, 0).unfollow();
    fillGrass(scene, this.atlas, 0, 0);
    const f = this.figure;
    const columns = WALK_COLUMNS + 1;
    const firstX = -((columns - 1) * COLUMN_SPACING) / 2;
    DIRECTIONS.forEach((dir, row) => {
      for (let c = 0; c < columns; c++) {
        f.x = firstX + c * COLUMN_SPACING;
        f.y = FIRST_ROW_Y + row * ROW_SPACING;
        f.direction = dir;
        f.action = c === 0 ? 'idle' : 'walk';
        // Middle of the walk frame, so rounding never lands on the neighbour.
        f.time = c === 0 ? 0 : (c - 1 + 0.5) * this.walkFrameTime;
        f.itemTime = time;
        this.rig.emit(scene.sprites, scene.sprite, f);
      }
    });
  }
}
