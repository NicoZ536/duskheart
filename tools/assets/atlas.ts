/**
 * Atlas-Builder (M1-05/M1-06, docs/RENDER.md §2): Frames aller Sprites → Albedo-Atlas (R Palettenindex,
 * G Emissiv, B Materialflags, A Deckung) und Normal-Atlas (RG Normale, B Höhe, A Deckung) plus
 * Manifest-Daten (Frames, Anker, Hitbox, Sockel, Clips, Occluder, Sonnenschatten). Identische Frames
 * (gleiche Albedo- und Normal-Pixel) teilen sich ein Atlas-Rechteck.
 */
import { createHash } from 'node:crypto';
import { spriteColorCount, spriteHasEmissive, spriteMaterialFlags, type HeightHint, type Occluder, type Point, type Sprite, type SpriteClip } from '../../assets-src/lib/sprite';
import { RGBA_BYTES } from '../lib/image';
import { albedoFrameRgba, frameMask, normalFrameRgba } from './normals';
import { packRects, type PackOptions } from './pack';
import type { LoadedSprite } from './sources';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Sonnenschatten: Silhouette des Sprites, am Fußpunkt geschert (Renderer, §6.1 Pass 4). */
export type SunShadow = { readonly kind: 'none' } | { readonly kind: 'silhouette'; readonly basisY: number; readonly bounds: Rect };

export interface ManifestSprite {
  readonly id: string;
  readonly group: string;
  readonly size: readonly [number, number];
  readonly anchor: Point;
  readonly hitbox: Rect | null;
  readonly sockets: Readonly<Record<string, readonly Point[]>>;
  readonly frames: readonly Rect[];
  readonly clips: Readonly<Record<string, SpriteClip>>;
  readonly occluder: Occluder;
  readonly schatten: SunShadow;
  readonly hoehe: HeightHint;
  readonly emissiv: boolean;
  readonly material: number;
  /** Deckende Pixel aller Frames (Zellkoordinaten). */
  readonly bounds: Rect;
  readonly spiegelbar: boolean;
  readonly farben: number;
}

/** Pixel eines Frames für Atlas und Kontaktbögen. */
export interface FramePixels {
  readonly albedo: Uint8Array;
  readonly normal: Uint8Array;
}

export interface AtlasBuild {
  readonly width: number;
  readonly height: number;
  readonly albedo: Uint8Array;
  readonly normal: Uint8Array;
  readonly sprites: readonly ManifestSprite[];
  /** Frame-Pixel je Sprite-Id (für Kontaktbögen). */
  readonly pixels: ReadonlyMap<string, readonly FramePixels[]>;
  /** Anzahl Frames insgesamt und eindeutige Atlas-Rechtecke. */
  readonly frameCount: number;
  readonly uniqueFrames: number;
}

/** Vereinigung der deckenden Pixel aller Frames; leeres Sprite → Rechteck 0×0 am Anker. */
export function opaqueBounds(s: Sprite): Rect {
  let x0 = s.w;
  let y0 = s.h;
  let x1 = -1;
  let y1 = -1;
  for (const f of s.frames) {
    const mask = frameMask(f);
    mask.forEach((v, p) => {
      if (v === 0) return;
      const x = p % s.w;
      const y = (p - x) / s.w;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    });
  }
  if (x1 < 0) return { x: s.anchor[0], y: s.anchor[1], w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function frameKey(p: FramePixels, w: number, h: number): string {
  return createHash('sha1').update(`${w}x${h}`).update(p.albedo).update(p.normal).digest('hex');
}

function blit(dst: Uint8Array, dstW: number, src: Uint8Array, w: number, h: number, x: number, y: number): void {
  for (let row = 0; row < h; row++) dst.set(src.subarray(row * w * RGBA_BYTES, (row + 1) * w * RGBA_BYTES), ((y + row) * dstW + x) * RGBA_BYTES);
}

/** Baut beide Atlanten und die Manifest-Daten. Sprites mit Farbfehlern brechen den Build ab. */
export function buildAtlas(loaded: readonly LoadedSprite[], pack: PackOptions = {}): AtlasBuild {
  const bad = loaded.filter((l) => l.sprite.farbFehler.length > 0);
  if (bad.length > 0) throw new Error(`Atlas: Farben außerhalb der Palette in ${bad.map((b) => `${b.sprite.id} (${b.sprite.farbFehler.join('; ')})`).join(', ')}`);

  const pixels = new Map<string, FramePixels[]>();
  const keysOf = new Map<string, string[]>();
  const unique = new Map<string, { w: number; h: number; px: FramePixels }>();
  let frameCount = 0;
  for (const { sprite: s } of loaded) {
    const list = s.frames.map((f) => ({ albedo: albedoFrameRgba(f, s.w, s.h), normal: normalFrameRgba(f, s.w, s.h, s.hoehe) }));
    pixels.set(s.id, list);
    keysOf.set(
      s.id,
      list.map((px) => {
        const key = frameKey(px, s.w, s.h);
        if (!unique.has(key)) unique.set(key, { w: s.w, h: s.h, px });
        return key;
      }),
    );
    frameCount += list.length;
  }

  const packed = packRects(
    [...unique.entries()].map(([key, u]) => ({ key, w: u.w, h: u.h })),
    pack,
  );
  const albedo = new Uint8Array(packed.width * packed.height * RGBA_BYTES);
  const normal = new Uint8Array(packed.width * packed.height * RGBA_BYTES);
  const rectOf = new Map<string, Rect>();
  for (const r of packed.rects) {
    const u = unique.get(r.key);
    if (u === undefined) continue;
    blit(albedo, packed.width, u.px.albedo, r.w, r.h, r.x, r.y);
    blit(normal, packed.width, u.px.normal, r.w, r.h, r.x, r.y);
    rectOf.set(r.key, { x: r.x, y: r.y, w: r.w, h: r.h });
  }

  const sprites = loaded.map(({ sprite: s, group }): ManifestSprite => {
    const bounds = opaqueBounds(s);
    const frames = (keysOf.get(s.id) ?? []).map((k) => {
      const r = rectOf.get(k);
      if (r === undefined) throw new Error(`Atlas: Frame von ${s.id} fehlt im Packing`);
      return r;
    });
    return {
      id: s.id,
      group,
      size: [s.w, s.h],
      anchor: s.anchor,
      hitbox: s.hitbox === null ? null : { x: s.hitbox[0], y: s.hitbox[1], w: s.hitbox[2], h: s.hitbox[3] },
      sockets: s.sockets,
      frames,
      clips: s.clips,
      occluder: s.occluder,
      schatten: s.schatten === 'none' ? { kind: 'none' } : { kind: 'silhouette', basisY: s.anchor[1], bounds },
      hoehe: s.hoehe,
      emissiv: spriteHasEmissive(s),
      material: spriteMaterialFlags(s),
      bounds,
      spiegelbar: s.spiegelbar,
      farben: spriteColorCount(s),
    };
  });

  return { width: packed.width, height: packed.height, albedo, normal, sprites, pixels, frameCount, uniqueFrames: unique.size };
}
