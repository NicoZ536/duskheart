/**
 * Scenario `palette-swap` (M1-11): the same tree in four palette rows (summer, autumn, winter,
 * corruption) and the same figure in four costume rows – one sprite, colours only from the LUT.
 */
import { defaultFigureState, type FigureRig } from '../anim/figure';
import type { AtlasData } from '../assets/atlas';
import { sceneAtlas } from '../assets/sceneSprites';
import type { RenderScene } from '../scene';
import { bareWanderer } from './figures';
import { fillGrass, place } from './layout';
import type { SceneSource } from './sceneSource';

/** Horizontal spacing of the four columns and the rows' anchor lines (world px). */
const COLUMN_SPACING = 100;
const FIRST_COLUMN = -150;
const TREE_Y = -8;
const FIGURE_Y = 62;
const FIGURE_OFFSET_X = -14;
const ROCK_OFFSET_X = 22;
const ROCK_Y = 52;
const TREE_ROWS = ['grund', 'herbst', 'winter', 'verderbt'] as const;
const FIGURE_ROWS = ['grund', 'tracht_blau', 'tracht_gruen', 'verderbt'] as const;

export class PaletteSwapScene implements SceneSource {
  readonly id = 'palette-swap';
  private readonly atlas: AtlasData = sceneAtlas();
  private readonly rig: FigureRig = bareWanderer(this.atlas);
  private readonly figure = defaultFigureState();
  private readonly rows: ReadonlyMap<string, number>;

  constructor() {
    this.rows = new Map(this.atlas.manifest.paletteRows.map((r, i) => [r.name, i]));
  }

  private row(name: string): number {
    const r = this.rows.get(name);
    if (r === undefined) throw new Error(`Palettenzeile ${name} fehlt`);
    return r;
  }

  fill(scene: RenderScene, time: number): void {
    scene.atlas = this.atlas;
    scene.camera.set(0, 0).unfollow();
    fillGrass(scene, this.atlas, 0, 0);
    TREE_ROWS.forEach((name, i) => {
      const x = FIRST_COLUMN + i * COLUMN_SPACING;
      place(scene, this.atlas, 'laubbaum', 0, x, TREE_Y, 'objects', this.row(name));
      place(scene, this.atlas, 'fels', 0, x + ROCK_OFFSET_X, ROCK_Y, 'objects', this.row(name));
      const f = this.figure;
      f.x = x + FIGURE_OFFSET_X;
      f.y = FIGURE_Y;
      f.direction = 'down';
      f.action = 'idle';
      f.time = time;
      f.paletteRow = this.row(FIGURE_ROWS[i] ?? 'grund');
      this.rig.emit(scene.sprites, scene.sprite, f);
    });
  }
}
