/**
 * Scene `palette` (M1-11/M1-25, MASTERPROMPT §4.3 "Paletten-LUT … ohne neue Sprites: Jahreszeiten-
 * Laub, Biom-Tönung, …"): the same Grünhain sprites and ground tiles of the game atlas in four
 * palette rows side by side – summer, autumn, winter and corruption. Only the row index differs
 * between the columns; the colours come from the palette LUT in the shader. Full daylight, so every
 * pixel shows exactly its palette colour; each column is named by a world-UI label (DE/EN).
 */
import { clipFrameAt, clipPositionAt, type AnimationClip } from '../anim/animation';
import type { AtlasData } from '../assets/atlas';
import type { RenderScene } from '../scene';
import { TILE_PX } from '../tilemap/chunk';
import { KitScene, meadowWithRoad } from '../tilemap/kitScene';
import type { SceneKit } from '../tilemap/sceneKit';
import { placeSprite, type PlaceOptions } from './kitTools';

/** The palette rows shown (ids of `assets-src/paletteRows.ts`) and their label keys. */
export const PALETTE_SCENE_ROWS: readonly { readonly row: string; readonly label: string }[] = [
  { row: 'sommer', label: 'render.palette.sommer' },
  { row: 'herbst', label: 'render.palette.herbst' },
  { row: 'winter', label: 'render.palette.winter' },
  { row: 'verderbnis', label: 'render.palette.verderbnis' },
];
/** Width of one column (world px, a whole number of tiles) and the camera. */
const COLUMN_PX = 7 * TILE_PX;
const CAMERA: readonly [number, number] = [0, 0];
/** World tile row of the road's north edge (the road runs through all four columns). */
const ROAD_ROW = 3;
/** Positions inside a column, relative to its centre (world px). */
const TREE: readonly [number, number] = [-14, 8];
const ROCK_BIG: readonly [number, number] = [28, 38];
const ROCK_SMALL: readonly [number, number] = [-34, 44];
const FIGURE: readonly [number, number] = [8, 58];
/** Baseline of the column labels (world y). */
const LABEL_Y = -84;

/** Left edge of the first column (world px): the four columns are centred on the camera. */
const FIRST_COLUMN_LEFT = CAMERA[0] - ((PALETTE_SCENE_ROWS.length * COLUMN_PX) >> 1);
/**
 * Centre of each column (world px, whole numbers: the frame's positions are sums of small integers – no float is formed
 * per frame, §30, M6-05h).
 */
const COLUMN_CENTRES: readonly number[] = PALETTE_SCENE_ROWS.map((_, c) => FIRST_COLUMN_LEFT + c * COLUMN_PX + (COLUMN_PX >> 1));

/** Column index of world px x (clamped to the outer columns). */
function columnOf(x: number): number {
  const c = Math.floor((x - FIRST_COLUMN_LEFT) / COLUMN_PX);
  return Math.min(PALETTE_SCENE_ROWS.length - 1, Math.max(0, c));
}

/**
 * Frame of `clip` `seconds` (a whole number) after a moment t ≥ 0 at which it stood at `position`: for a looping clip with
 * whole fps `seconds × fps` steps on – the frame `clipFrameAt(clip, t + seconds)` shows, counted in whole steps instead of a
 * float per column (§30, M6-05h); any other clip is asked at the later moment itself.
 */
export function frameLater(clip: AnimationClip, t: number, position: number, seconds: number): number {
  const fps = clip.fps;
  if (!clip.loop || !Number.isInteger(fps)) return clipFrameAt(clip, t + seconds);
  return clip.frames[(position + seconds * fps) % clip.frames.length] ?? 0;
}

export class PaletteRowsScene extends KitScene {
  readonly id = 'palette';
  /** Palette row index of each column in the atlas (0 = master palette when the atlas lacks the row). */
  private rows: readonly number[] = [];
  private options: readonly PlaceOptions[] = [];
  private rowsFor: AtlasData | null = null;

  constructor(
    gameAtlas: () => AtlasData | null,
    private readonly t: (key: string) => string,
  ) {
    super(gameAtlas, { first: -1, last: 0 }, { first: -1, last: 0 });
  }

  protected terrain(kit: SceneKit): (wx: number, wy: number) => number {
    return meadowWithRoad(kit, ROAD_ROW);
  }

  protected override terrainRow(kit: SceneKit): (wx: number, wy: number) => number {
    const rows = this.rowsOf(kit.atlas);
    return (wx) => rows[columnOf(wx * TILE_PX)] ?? 0;
  }

  protected environment(scene: RenderScene): void {
    const env = scene.env;
    env.ambientR = 1;
    env.ambientG = 1;
    env.ambientB = 1;
    env.ambientIntensity = 1;
    env.wind = 0;
  }

  protected compose(scene: RenderScene, kit: SceneKit, time: number): void {
    scene.camera.set(CAMERA[0], CAMERA[1]).unfollow();
    this.rowsOf(kit.atlas);
    // The figure idles a second later in each column: its clip's position once per frame, the columns' in whole steps on.
    const idle = kit.idle.down;
    const position = clipPositionAt(idle, time);
    for (let c = 0; c < PALETTE_SCENE_ROWS.length; c++) {
      const x = COLUMN_CENTRES[c] as number;
      const o = this.options[c];
      placeSprite(scene, kit.tree, 0, x + TREE[0], TREE[1], o);
      placeSprite(scene, kit.rockBig, 0, x + ROCK_BIG[0], ROCK_BIG[1], o);
      placeSprite(scene, kit.rockSmall, 0, x + ROCK_SMALL[0], ROCK_SMALL[1], o);
      placeSprite(scene, kit.figure, frameLater(idle, time, position, c), x + FIGURE[0], FIGURE[1], o);
      const label = PALETTE_SCENE_ROWS[c]?.label;
      if (label !== undefined) scene.worldUi.label(x, LABEL_Y, this.t(label));
    }
  }

  private rowsOf(atlas: AtlasData): readonly number[] {
    if (this.rowsFor !== atlas) {
      this.rowsFor = atlas;
      const names = atlas.manifest.paletteRows.map((r) => r.name);
      this.rows = PALETTE_SCENE_ROWS.map(({ row }) => Math.max(0, names.indexOf(row)));
      this.options = this.rows.map((paletteRow) => ({ paletteRow }));
    }
    return this.rows;
  }
}
