/**
 * Scene `spielatlas`: every sprite of the game atlas from `npm run assets`, grouped like the
 * contact sheets – animated sprites play their first clip, sprites without clips show all frames
 * (tile variants, material tiers) side by side. Shows the background colour until the atlas is
 * loaded (it arrives asynchronously) or when no generated atlas exists.
 */
import { clipFrameAt } from '../anim/animation';
import type { AtlasData, AtlasSprite } from '../assets/atlas';
import type { SpriteFrameRef } from '../batch/spriteList';
import type { RenderScene } from '../scene';
import type { SceneSource } from './sceneSource';

/** Gap between cells (world px). */
const GAP = 6;
/** Width of the laid-out sheet (fits the narrowest internal view, 360 px). */
const SHEET_WIDTH = 336;

interface Placement {
  readonly sprite: AtlasSprite;
  /** Frame shown (static sprites) or -1 to play the first clip. */
  readonly frame: number;
  readonly x: number;
  readonly y: number;
}

function layout(atlas: AtlasData): { readonly items: Placement[]; readonly width: number; readonly height: number } {
  const sprites = Object.values(atlas.manifest.sprites).sort((a, b) => a.group.localeCompare(b.group) || a.id.localeCompare(b.id));
  const items: Placement[] = [];
  let x = 0;
  let y = 0;
  let row = 0;
  let width = 0;
  const put = (sprite: AtlasSprite, frame: number, f: SpriteFrameRef): void => {
    if (x > 0 && x + f.w > SHEET_WIDTH) {
      x = 0;
      y += row + GAP;
      row = 0;
    }
    items.push({ sprite, frame, x: x + f.ax, y: y + f.ay });
    width = Math.max(width, x + f.w);
    x += f.w + GAP;
    row = Math.max(row, f.h);
  };
  for (const s of sprites) {
    const first = s.frames[0];
    if (!first) continue;
    if (Object.keys(s.clips).length > 0) put(s, -1, first);
    else s.frames.forEach((f, i) => put(s, i, f));
  }
  return { items, width, height: y + row };
}

export class GameAtlasScene implements SceneSource {
  readonly id = 'spielatlas';
  private laidOut: { readonly atlas: AtlasData; readonly items: Placement[]; readonly width: number; readonly height: number } | null = null;

  constructor(private readonly atlas: () => AtlasData | null) {}

  fill(scene: RenderScene, time: number): void {
    const atlas = this.atlas();
    scene.camera.set(0, 0).unfollow();
    if (atlas === null) {
      scene.atlas = null;
      return;
    }
    if (this.laidOut?.atlas !== atlas) this.laidOut = { atlas, ...layout(atlas) };
    scene.atlas = atlas;
    const { items, width, height } = this.laidOut;
    scene.camera.set(width / 2, height / 2);
    const d = scene.sprite;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it) continue;
      const clipName = Object.keys(it.sprite.clips).sort()[0];
      const clip = clipName === undefined ? undefined : it.sprite.clips[clipName];
      const frameIndex = it.frame >= 0 ? it.frame : clip ? clipFrameAt(clip, time) : 0;
      const frame = it.sprite.frames[frameIndex];
      if (!frame) continue;
      d.reset();
      d.frame = frame;
      d.x = it.x;
      d.y = it.y;
      scene.sprites.push(d);
    }
  }
}
