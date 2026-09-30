/**
 * Scene `waffe-rotation` (M6-01 render part, M6-38; MASTERPROMPT §19.1 "Waffen frei rotiert (Rotation im Low-Res-Puffer,
 * pixelgenau)"): the player's figure aiming in eight directions (columns: east, south-east, south, … north-east, 45°
 * apart) with three weapons (rows) – the bronze sword in the smear frame of its blow, the short bow at full draw, the
 * bronze spear at the tip of its thrust. The body turns in its four directions (`nearestFacing`), the weapon turns the rest
 * of the way about its grip in the low-res G-buffer (`handAngleFor`, nearest texel: every pixel of the weapon is one pixel
 * of its sprite). A small mark 22 px out along each aim shows where the weapon has to point.
 *
 * The same rig and clip timing as the game view (`buildPlayerFigure`, `combatClipTime`); the game atlas, noon light.
 */
import { nearestFacing } from '../../game/combat/formulas';
import { defaultFigureState } from '../anim/figure';
import type { AtlasData } from '../assets/atlas';
import type { SpriteFrameRef } from '../batch/spriteList';
import type { RenderScene } from '../scene';
import type { SceneSource } from '../scenes/sceneSource';
import { setAmbient } from '../scenes/kitTools';
import { ATTACK_ACTION, combatClipTime, handAngleFor, type CombatStage } from './combatClips';
import { DOT_SPRITE, PUNKT } from './combatFeedback';
import { buildPlayerFigure, START_CLOTHING, type PlayerFigureRig } from './playerFigure';

/** Scene id. */
export const WEAPON_ROTATION_SCENE = 'waffe-rotation';
/** Aim directions [rad], 45° apart from east clockwise on screen (south = +π/2). */
export const SHOWCASE_ANGLES: readonly number[] = Array.from({ length: 8 }, (_, k) => (k * Math.PI) / 4);
/** The rows: weapon, its body action and the stage and progress of the clip shown. */
export const SHOWCASE_ROWS: readonly { readonly item: string; readonly action: string; readonly stage: CombatStage; readonly progress: number }[] = [
  { item: 'bronzeschwert', action: ATTACK_ACTION.schwert, stage: 'follow', progress: 0 },
  { item: 'kurzbogen', action: ATTACK_ACTION.bogen, stage: 'draw', progress: 1 },
  { item: 'bronzespeer', action: ATTACK_ACTION.speer, stage: 'follow', progress: 0 },
];
/** Cell size [px] and the mark's distance along the aim [px]. */
const CELL = { w: 40, h: 64 } as const;
const MARK_PX = 22;
/** Height of the aim above the feet [px] (the hand). */
const HAND_PX = 10;
/** Background: the earth of the start beach's hinterland, noon light. */
const GROUND_SPRITE = 'boden_erde';
const TILE = 16;
/** The widest internal view (§4.2: 640 × 270): the ground covers it whole. */
const VIEW = { w: 640, h: 270 } as const;

export class WeaponRotationScene implements SceneSource {
  readonly id = WEAPON_ROTATION_SCENE;
  private rigs: { readonly atlas: AtlasData; readonly rows: (PlayerFigureRig | null)[] } | null = null;
  private readonly figure = defaultFigureState();

  constructor(private readonly atlas: () => AtlasData | null) {}

  ready(): boolean {
    return this.atlas() !== null;
  }

  fill(scene: RenderScene, time: number): void {
    const atlas = this.atlas();
    scene.camera.set(0, 0).unfollow();
    setAmbient(scene.env, [1, 1, 1], 1);
    scene.env.dayFraction = 0.5;
    if (atlas === null) {
      scene.atlas = null;
      return;
    }
    scene.atlas = atlas;
    if (this.rigs?.atlas !== atlas) this.rigs = { atlas, rows: SHOWCASE_ROWS.map((r) => buildPlayerFigure(atlas.manifest, START_CLOTHING, { hand: `ausruestung_${r.item}` })) };
    const m = atlas.manifest;
    const ground = m.sprites[GROUND_SPRITE];
    const d = scene.sprite;
    const width = CELL.w * SHOWCASE_ANGLES.length;
    const height = CELL.h * SHOWCASE_ROWS.length;
    if (ground !== undefined) {
      for (let y = -VIEW.h / 2 - TILE; y < VIEW.h / 2 + TILE; y += TILE) {
        for (let x = -VIEW.w / 2 - TILE; x < VIEW.w / 2 + TILE; x += TILE) {
          d.reset();
          d.layer = 'ground';
          d.frame = ground.frames[0] as SpriteFrameRef;
          d.x = x;
          d.y = y;
          scene.sprites.push(d);
        }
      }
    }
    const dot = m.sprites[DOT_SPRITE];
    const f = this.figure;
    for (let row = 0; row < SHOWCASE_ROWS.length; row++) {
      const spec = SHOWCASE_ROWS[row];
      const rig = this.rigs.rows[row] ?? null;
      if (spec === undefined || rig === null || !rig.available.has(spec.action)) continue;
      for (let k = 0; k < SHOWCASE_ANGLES.length; k++) {
        const a = SHOWCASE_ANGLES[k] as number;
        const facing = nearestFacing(a);
        const x = -width / 2 + CELL.w * (k + 1 / 2);
        const y = -height / 2 + CELL.h * row + CELL.h * 0.62;
        const clip = rig.rig.bodyClip(spec.action, facing);
        f.x = x;
        f.y = y;
        f.direction = facing;
        f.action = spec.action;
        f.time = clip === null ? 0 : combatClipTime(clip, spec.stage, spec.progress);
        f.itemTime = time;
        f.handAngle = handAngleFor(a, facing);
        rig.rig.emit(scene.sprites, d, f);
        if (dot === undefined) continue;
        d.reset();
        d.frame = dot.frames[PUNKT.warnHell] as SpriteFrameRef;
        d.x = Math.round(x + Math.cos(a) * MARK_PX);
        d.y = Math.round(y - HAND_PX + Math.sin(a) * MARK_PX);
        d.depth = y + CELL.h;
        d.heightBase = HAND_PX;
        scene.sprites.push(d);
      }
    }
  }
}
