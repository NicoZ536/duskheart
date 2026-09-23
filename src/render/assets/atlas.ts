/**
 * Sprite atlases (docs/RENDER.md §2): an albedo atlas (R = palette index 1…64, 0 = transparent,
 * G = emissive 0/255, B = material bits, A = coverage), a normal atlas (RG = normal XY as
 * 0.5 + 0.5·n with +y up on screen, B = relief height 0…255 ≙ 0…32 px, A = coverage) and a manifest
 * with frames, anchors, sockets, clips and the palette row table.
 *
 * Sources: `npm run assets` (`src/generated/atlas.ts` + `public/generated/atlas-*.png`, see
 * `generated.ts`) or the in-memory builder `synthetic.ts` (render tests and debug scenes).
 */
import type { AnimationClip } from '../anim/animation';
import type { SpriteFrameRef } from '../batch/spriteList';
import type { GpuResourceRegistry } from '../gl/resources';
import { Texture2D, type TexturePixels } from '../gl/texture';
import type { PaletteRow } from '../palette/lut';

export type HeightHint = 'flach' | 'zylinder' | 'kugel' | 'block' | 'custom';

/** A socket point per frame (pixel edges from the frame's top-left corner); `null` = hidden in that frame. */
export type SocketTrack = readonly (readonly [number, number] | null)[];

export interface AtlasSprite {
  readonly id: string;
  readonly group: string;
  /** Cell size of every frame. */
  readonly size: readonly [number, number];
  readonly frames: readonly SpriteFrameRef[];
  readonly clips: Readonly<Record<string, AnimationClip>>;
  readonly sockets: Readonly<Record<string, SocketTrack>>;
  readonly heightHint: HeightHint;
  readonly emissive: boolean;
  /** Looks right when mirrored (left/right clips may be derived from each other). */
  readonly symmetric: boolean;
}

export interface AtlasManifest {
  readonly width: number;
  readonly height: number;
  readonly sprites: Readonly<Record<string, AtlasSprite>>;
  /** Palette rows (row 0 = master palette). */
  readonly paletteRows: readonly PaletteRow[];
  /** Hash of the sources the atlas was built from. */
  readonly sourceHash: string;
}

/** Pixel data of an atlas: raw RGBA8 (top row first) or decoded images. */
export type AtlasImage = { readonly kind: 'pixels'; readonly pixels: TexturePixels } | { readonly kind: 'image'; readonly image: TexImageSource };

export interface AtlasData {
  readonly manifest: AtlasManifest;
  readonly albedo: AtlasImage;
  readonly normal: AtlasImage;
}

/** Looks up a sprite, with a readable error. */
export function atlasSprite(manifest: AtlasManifest, id: string): AtlasSprite {
  const s = manifest.sprites[id];
  if (s === undefined) throw new Error(`Atlas: Sprite ${id} fehlt (Atlas ${manifest.sourceHash})`);
  return s;
}

export function spriteFrame(sprite: AtlasSprite, index: number): SpriteFrameRef {
  const f = sprite.frames[index];
  if (f === undefined) throw new RangeError(`Sprite ${sprite.id}: Frame ${index} fehlt (${sprite.frames.length} Frames)`);
  return f;
}

export function spriteClip(sprite: AtlasSprite, name: string): AnimationClip {
  const c = sprite.clips[name];
  if (c === undefined) throw new Error(`Sprite ${sprite.id}: Clip ${name} fehlt (vorhanden: ${Object.keys(sprite.clips).join(', ')})`);
  return c;
}

/** GPU textures of an atlas (restored from the retained pixels/images after a context loss). */
export class AtlasTextures {
  readonly albedo: Texture2D;
  readonly normal: Texture2D;

  constructor(
    registry: GpuResourceRegistry,
    gl: WebGL2RenderingContext,
    readonly data: AtlasData,
    label: string,
  ) {
    const { width, height } = data.manifest;
    const make = (name: string, img: AtlasImage): Texture2D =>
      registry.add(
        new Texture2D(gl, {
          label: `${label}.${name}`,
          width,
          height,
          format: 'RGBA8',
          ...(img.kind === 'pixels' ? { pixels: img.pixels } : { image: img.image }),
        }),
      );
    this.albedo = make('albedo', data.albedo);
    this.normal = make('normal', data.normal);
  }

  get manifest(): AtlasManifest {
    return this.data.manifest;
  }

  release(registry: GpuResourceRegistry): void {
    registry.remove(this.albedo);
    registry.remove(this.normal);
  }
}
