/**
 * The effect shaders of the sprites (MASTERPROMPT §6.2 "Outline-Shader für Interaktion, Weißblitz, Palettenwechsel-
 * Effekte, Dither-Fades", M5-24), one debug scene each (`shader-*`, screenshot scenarios of the same names):
 * - `shader-outline`: a clearing at night with two torches – an interactable figure in reach, one half hidden behind a
 *   bush (the outline hugs what can be seen of it), a rock to gather and a glowing mushroom, all outlined in the accent
 *   colour with the glint running along; the outline is drawn after the lighting and reads in the dark.
 * - `shader-weissblitz`: figures, a rock and a bush in their hit flash next to their unflashed twins, at dusk: the flash
 *   is light, not paint – full white also in the dark (softened with the flash-reduction option).
 * - `shader-palettentausch`: the palette swap of effects pixel by pixel in the order of the ramp steps (light first),
 *   spread by a world-anchored cluster noise (`creep`) – trees and rocks creeping into corruption, bushes icing over, at
 *   0, a quarter, half, three quarters and all of the way; a row of figures in their costume rows for comparison.
 * - `shader-dither`: dither fades – trees, bushes, rocks, burning torches and glowing mushrooms at 0, ¼, ½, ¾ and all
 *   of the way out, the Bayer pattern anchored to each sprite (a fading thing does not shimmer while it moves).
 * Built from the sprites of the render debug scenes (`sceneAtlas`), deterministic for a frozen time.
 */
import { clipFrameAt, type AnimationClip, type Direction } from '../anim/animation';
import { defaultFigureState, type FigureRig, type FigureState } from '../anim/figure';
import { atlasSprite, spriteClip, spriteFrame, type AtlasData, type AtlasSprite } from '../assets/atlas';
import { sceneAtlas } from '../assets/sceneSprites';
import { FIRE, MOONLIGHT } from '../light/lightColors';
import type { RenderScene } from '../scene';
import { equippedWanderer } from '../scenes/figures';
import { pushLight, setAmbient, type LightSpec } from '../scenes/kitTools';
import { fillGrass, hash01 } from '../scenes/layout';
import type { SceneSource } from '../scenes/sceneSource';

/** Ids of the effect scenes (also the names of their screenshot scenarios). */
export const EFFECT_SCENE_IDS = ['shader-outline', 'shader-weissblitz', 'shader-palettentausch', 'shader-dither'] as const;
export type EffectSceneId = (typeof EFFECT_SCENE_IDS)[number];

/** The steps shown of a swap or a fade (0 = none … 1 = all the way). */
export const EFFECT_STEPS: readonly number[] = [0, 0.25, 0.5, 0.75, 1];
/** Horizontal spacing of the steps [world px] and the first column. */
const STEP_SPACING = 88;
const FIRST_STEP = -176;
const TAU = Math.PI * 2;
/** Ambient light of the stations: night (outline), dusk (flash), day (swap, fade). */
const NIGHT = 0.16;
const DUSK = 0.5;
const DAY = 1;
const TORCH: LightSpec = { height: 14, radius: 150, color: FIRE, intensity: 1.35, flicker: 0.25, seed: 0.3 };
const CROWN_SWAY = 0.6;
const BUSH_SWAY = 1.2;

/** A placed sprite: atlas id, anchor x, y. */
type Spot = readonly [string, number, number];

export class EffectShowcaseScene implements SceneSource {
  private readonly atlas: AtlasData = sceneAtlas();
  private readonly rig: FigureRig = equippedWanderer(this.atlas);
  private readonly figure: FigureState = defaultFigureState();
  private readonly sprites = new Map<string, AtlasSprite>();
  private readonly rows: ReadonlyMap<string, number>;
  private readonly torch: AtlasSprite;
  private readonly burn: AnimationClip;

  constructor(readonly id: EffectSceneId) {
    const m = this.atlas.manifest;
    for (const s of ['laubbaum', 'fels', 'leuchtpilz', 'grasbusch', 'fackel']) this.sprites.set(s, atlasSprite(m, s));
    this.rows = new Map(m.paletteRows.map((r, i) => [r.name, i]));
    this.torch = this.sprite('fackel');
    this.burn = spriteClip(this.torch, 'brennen');
  }

  private sprite(id: string): AtlasSprite {
    const s = this.sprites.get(id);
    if (s === undefined) throw new Error(`Effekt-Szene: Sprite ${id} fehlt`);
    return s;
  }

  private row(name: string): number {
    const r = this.rows.get(name);
    if (r === undefined) throw new Error(`Effekt-Szene: Palettenzeile ${name} fehlt`);
    return r;
  }

  fill(scene: RenderScene, time: number): void {
    scene.atlas = this.atlas;
    scene.camera.set(0, 0).unfollow();
    scene.env.wind = 0.6;
    fillGrass(scene, this.atlas, 0, 0);
    switch (this.id) {
      case 'shader-outline':
        this.outline(scene, time);
        break;
      case 'shader-weissblitz':
        this.flash(scene, time);
        break;
      case 'shader-palettentausch':
        this.swap(scene, time);
        break;
      case 'shader-dither':
        this.dither(scene, time);
        break;
    }
  }

  /** Pushes sprite `id` at (x, y), with `set` adjusting its description before the push. */
  private put(scene: RenderScene, id: string, x: number, y: number, set?: (d: RenderScene['sprite']) => void): void {
    const d = scene.sprite.reset();
    const s = this.sprite(id);
    d.frame = spriteFrame(s, 0);
    d.x = x;
    d.y = y;
    if (id === 'laubbaum') d.windAmplitude = CROWN_SWAY;
    if (id === 'grasbusch') d.windAmplitude = BUSH_SWAY;
    d.windPhase = hash01(x, y) * TAU;
    set?.(d);
    scene.sprites.push(d);
  }

  private torchAt(scene: RenderScene, x: number, y: number, time: number, fade = 0): void {
    const d = scene.sprite.reset();
    d.frame = spriteFrame(this.torch, clipFrameAt(this.burn, time + hash01(x, y) * this.burn.frames.length));
    d.x = x;
    d.y = y;
    d.fade = fade;
    scene.sprites.push(d);
  }

  private walker(scene: RenderScene, x: number, y: number, dir: Direction, walk: boolean, time: number, o: { outline?: boolean; flash?: boolean; row?: number } = {}): void {
    const f = this.figure;
    f.x = x;
    f.y = y;
    f.direction = dir;
    f.action = walk ? 'walk' : 'idle';
    f.time = time;
    f.itemTime = time;
    f.outline = o.outline ?? false;
    f.flash = o.flash ?? false;
    f.paletteRow = o.row ?? 0;
    this.rig.emit(scene.sprites, scene.sprite, f);
  }

  /** Night clearing: everything interactable carries the outline, in front of and behind other things. */
  private outline(scene: RenderScene, time: number): void {
    setAmbient(scene.env, MOONLIGHT, NIGHT);
    const trees: readonly Spot[] = [
      ['laubbaum', -170, -40],
      ['laubbaum', 150, -60],
      ['laubbaum', 40, 110],
    ];
    for (const [id, x, y] of trees) this.put(scene, id, x, y);
    for (const [x, y] of [
      [-60, -30],
      [96, 30],
    ] as const) {
      this.torchAt(scene, x, y, time);
      pushLight(scene, x, y, { ...TORCH, seed: hash01(x, y) });
    }
    // In reach: a figure, a rock to gather, a glowing mushroom.
    this.walker(scene, 0, 10, 'down', false, time, { outline: true });
    this.put(scene, 'fels', -100, 40, (d) => (d.outline = true));
    this.put(scene, 'leuchtpilz', 60, 60, (d) => (d.outline = true));
    // Half behind a bush: the outline follows only what can be seen of the figure.
    this.walker(scene, 150, 36, 'left', true, time, { outline: true });
    this.put(scene, 'grasbusch', 146, 50);
    // Not interactable: no outline.
    this.walker(scene, -160, 70, 'right', true, time);
    this.put(scene, 'grasbusch', -30, 90);
  }

  /** Dusk: each thing next to its flashing twin. */
  private flash(scene: RenderScene, time: number): void {
    setAmbient(scene.env, MOONLIGHT, DUSK);
    for (const x of [-100, 100]) {
      this.torchAt(scene, x, 34, time);
      pushLight(scene, x, 34, { ...TORCH, seed: hash01(x, 34) });
    }
    const pairs: ReadonlyArray<readonly [number, number]> = [
      [-150, -10],
      [-50, -10],
      [50, -10],
      [150, -10],
    ];
    const kinds = ['figur', 'figur-geht', 'fels', 'grasbusch'] as const;
    kinds.forEach((kind, i) => {
      const [x, y] = pairs[i] as readonly [number, number];
      for (const flash of [false, true]) {
        const yy = y + (flash ? 80 : 0);
        if (kind === 'figur') this.walker(scene, x, yy, 'down', false, time, { flash });
        else if (kind === 'figur-geht') this.walker(scene, x, yy, 'right', true, time, { flash });
        else this.put(scene, kind, x, yy, (d) => (d.flash = flash));
      }
    });
  }

  /** Day: corruption creeps into trees, frost onto rocks and bushes; figures in their costume rows. */
  private swap(scene: RenderScene, time: number): void {
    setAmbient(scene.env, [1, 1, 1], DAY);
    const corrupt = this.row('verderbt');
    const frost = this.row('winter');
    EFFECT_STEPS.forEach((blend, i) => {
      const x = FIRST_STEP + i * STEP_SPACING;
      const creep = (row: number) => (d: RenderScene['sprite']) => {
        d.paletteRow2 = row;
        d.rowBlend = blend;
        d.creep = true;
      };
      this.put(scene, 'laubbaum', x, -20, creep(corrupt));
      this.put(scene, 'fels', x - 16, 40, creep(corrupt));
      this.put(scene, 'grasbusch', x + 16, 44, creep(frost));
    });
    (['grund', 'tracht_blau', 'tracht_gruen'] as const).forEach((name, i) => this.walker(scene, -88 + i * 88, 104, 'down', false, time, { row: this.row(name) }));
  }

  /** Day: the same things at 0, ¼, ½, ¾ and all of the way out. */
  private dither(scene: RenderScene, time: number): void {
    setAmbient(scene.env, [1, 1, 1], DAY);
    EFFECT_STEPS.forEach((fade, i) => {
      const x = FIRST_STEP + i * STEP_SPACING;
      this.put(scene, 'laubbaum', x, -26, (d) => (d.fade = fade));
      this.put(scene, 'fels', x - 16, 36, (d) => (d.fade = fade));
      this.put(scene, 'grasbusch', x + 14, 40, (d) => (d.fade = fade));
      this.torchAt(scene, x, 100, time, fade);
      this.put(scene, 'leuchtpilz', x + 20, 104, (d) => (d.fade = fade));
    });
  }
}
