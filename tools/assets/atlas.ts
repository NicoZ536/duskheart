/**
 * Atlas-Builder (M1-05/M1-06, docs/RENDER.md §2): Frames aller Sprites → Albedo-Atlas (R Palettenindex,
 * G Emissiv, B Materialflags, A Deckung) und Normal-Atlas (RG Normale, B Höhe, A Deckung) plus
 * Manifest-Daten (Frames, Anker, Hitbox, Sockel, Clips, Occluder, Sonnenschatten). Identische Frames
 * (gleiche Albedo- und Normal-Pixel) teilen sich ein Atlas-Rechteck.
 *
 * Zuschnitt (M7-110, Sprite-Angabe `zuschnitt`): die Frames eines solchen Sprites liegen nur mit dem Rechteck ihrer deckenden
 * Pixel im Atlas (Albedo und Normalen in der ganzen Zelle berechnet, dann ausgeschnitten); das Manifest nennt je Frame den
 * Anker in diesem Rechteck (`ax`, `ay`). Ein leerer Frame wird ein 1×1-Rechteck an der linken oberen Zellecke. Nur ohne
 * Sockel und Occluder – beide stehen in Zellkoordinaten und würden gegen den Anker des Frames verrutschen.
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

/**
 * Atlas-Rechteck eines Frames mit dem Anker in diesem Rechteck (`ax`, `ay`): bei einem beschnittenen Sprite (`zuschnitt`) der
 * Zell-Anker minus Schnitt, sonst der Zell-Anker selbst – jeder Frame nennt ihn (M7-130), die Laufzeit liest ihn ohne Rückfall.
 */
export interface ManifestFrame extends Rect {
  readonly ax: number;
  readonly ay: number;
}

export interface ManifestSprite {
  readonly id: string;
  readonly group: string;
  readonly size: readonly [number, number];
  readonly anchor: Point;
  readonly hitbox: Rect | null;
  readonly sockets: Readonly<Record<string, readonly Point[]>>;
  readonly frames: readonly ManifestFrame[];
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

/** Das Rechteck der deckenden Pixel eines Frames in der Zelle (`zuschnitt`); ein leerer Frame: 1×1 an der linken oberen Ecke. */
export function frameCrop(px: FramePixels, w: number, h: number): Rect {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((px.albedo[(y * w + x) * RGBA_BYTES + 3] ?? 0) === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? { x: 0, y: 0, w: 1, h: 1 } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Der Ausschnitt `r` der Frame-Pixel (Zelle w breit). */
function cropPixels(px: FramePixels, w: number, r: Rect): FramePixels {
  const cut = (src: Uint8Array): Uint8Array => {
    const out = new Uint8Array(r.w * r.h * RGBA_BYTES);
    for (let row = 0; row < r.h; row++) out.set(src.subarray(((r.y + row) * w + r.x) * RGBA_BYTES, ((r.y + row) * w + r.x + r.w) * RGBA_BYTES), row * r.w * RGBA_BYTES);
    return out;
  };
  return { albedo: cut(px.albedo), normal: cut(px.normal) };
}

/** Baut beide Atlanten und die Manifest-Daten. Sprites mit Farbfehlern brechen den Build ab. */
export function buildAtlas(loaded: readonly LoadedSprite[], pack: PackOptions = {}): AtlasBuild {
  const bad = loaded.filter((l) => l.sprite.farbFehler.length > 0);
  if (bad.length > 0) throw new Error(`Atlas: Farben außerhalb der Palette in ${bad.map((b) => `${b.sprite.id} (${b.sprite.farbFehler.join('; ')})`).join(', ')}`);

  const pixels = new Map<string, FramePixels[]>();
  const keysOf = new Map<string, string[]>();
  /** Zuschnitt je Frame der beschnittenen Sprites (Zellkoordinaten). */
  const cropsOf = new Map<string, Rect[]>();
  const unique = new Map<string, { w: number; h: number; px: FramePixels }>();
  let frameCount = 0;
  for (const { sprite: s } of loaded) {
    const occluder = s.occluder.kind !== 'none';
    if (s.zuschnitt && (Object.keys(s.sockets).length > 0 || occluder)) throw new Error(`Atlas: ${s.id} – Zuschnitt nur ohne Sockel und Occluder (beide in Zellkoordinaten)`);
    const list = s.frames.map((f) => ({ albedo: albedoFrameRgba(f, s.w, s.h, occluder), normal: normalFrameRgba(f, s.w, s.h, s.hoehe) }));
    pixels.set(s.id, list);
    const crops = s.zuschnitt ? list.map((px) => frameCrop(px, s.w, s.h)) : null;
    if (crops !== null) cropsOf.set(s.id, crops);
    keysOf.set(
      s.id,
      list.map((full, i) => {
        const crop = crops?.[i];
        const px = crop === undefined ? full : cropPixels(full, s.w, crop);
        const w = crop === undefined ? s.w : crop.w;
        const h = crop === undefined ? s.h : crop.h;
        const key = frameKey(px, w, h);
        if (!unique.has(key)) unique.set(key, { w, h, px });
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
    const crops = cropsOf.get(s.id);
    const frames = (keysOf.get(s.id) ?? []).map((k, i): ManifestFrame => {
      const r = rectOf.get(k);
      if (r === undefined) throw new Error(`Atlas: Frame von ${s.id} fehlt im Packing`);
      const crop = crops?.[i];
      return crop === undefined ? { x: r.x, y: r.y, w: r.w, h: r.h, ax: s.anchor[0], ay: s.anchor[1] } : { x: r.x, y: r.y, w: r.w, h: r.h, ax: s.anchor[0] - crop.x, ay: s.anchor[1] - crop.y };
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
