/**
 * In-memory atlas builder: turns sprite sources (docs/RENDER.md §1 format) into the same atlas data
 * `npm run assets` produces (albedo + normal RGBA8, manifest). Used by the render tests and by the
 * render debug scenes (`scenes/`), which must not depend on the generated game atlas.
 * Deterministic: same sources ⇒ same bytes.
 */
import type { AnimationClip } from '../anim/animation';
import type { SpriteFrameRef } from '../batch/spriteList';
import type { PaletteRow } from '../palette/lut';
import type { AtlasData, AtlasSprite, SocketTrack } from './atlas';
import { reliefFromHint, smoothRelief, writeNormalFrame } from './normals';
import { paletteRefResolver, parseSpriteFrames, type ParsedFrame, type SpriteSource } from './spriteSource';

/** Default atlas width (px); the height grows with the content. */
export const SYNTHETIC_ATLAS_WIDTH = 256;
/** Transparent gap between packed frames. */
export const ATLAS_PADDING = 1;
const RGBA = 4;
const BYTE_MAX = 255;
/** Name of the clip created for sprites without clips (all frames, not looping). */
export const DEFAULT_CLIP = 'standard';
/** Frame rate of the default clip. */
const DEFAULT_CLIP_FPS = 10;
/** FNV-1a (32 bit) for the source hash. */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const HEX_RADIX = 16;
const HASH_DIGITS = 8;

export interface BuildAtlasOptions {
  /** Palette ramps in palette order (resolves `rampe.stufe`). */
  readonly ramps: readonly { readonly name: string; readonly size: number }[];
  readonly paletteRows: readonly PaletteRow[];
  readonly width?: number;
}

interface PackItem {
  readonly sprite: number;
  readonly frame: number;
  readonly w: number;
  readonly h: number;
}

/** Shelf packing (tallest first, stable); returns positions and the atlas height. */
export function packFrames(items: readonly PackItem[], width: number, padding: number): { readonly positions: Map<PackItem, [number, number]>; readonly height: number } {
  const order = [...items].sort((a, b) => b.h - a.h || a.sprite - b.sprite || a.frame - b.frame);
  const positions = new Map<PackItem, [number, number]>();
  let x = padding;
  let y = padding;
  let shelf = 0;
  for (const it of order) {
    if (it.w + 2 * padding > width) throw new Error(`Atlas: Frame ${it.w}×${it.h} passt nicht in ${width} px Breite`);
    if (x + it.w + padding > width) {
      x = padding;
      y += shelf + padding;
      shelf = 0;
    }
    positions.set(it, [x, y]);
    x += it.w + padding;
    shelf = Math.max(shelf, it.h);
  }
  return { positions, height: y + shelf + padding };
}

function hashSources(sources: readonly SpriteSource[]): string {
  let h = FNV_OFFSET;
  const text = JSON.stringify(sources);
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h.toString(HEX_RADIX).padStart(HASH_DIGITS, '0');
}

function writeAlbedoFrame(f: ParsedFrame, out: Uint8Array, stride: number, ox: number, oy: number): void {
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) {
      const i = y * f.width + x;
      const idx = f.index[i] ?? 0;
      if (idx === 0) continue;
      const o = ((oy + y) * stride + ox + x) * RGBA;
      out[o] = idx;
      out[o + 1] = (f.emissive[i] ?? 0) > 0 ? BYTE_MAX : 0;
      out[o + 2] = f.material[i] ?? 0;
      out[o + 3] = BYTE_MAX;
    }
  }
}

export function buildAtlas(sources: readonly SpriteSource[], options: BuildAtlasOptions): AtlasData {
  const width = options.width ?? SYNTHETIC_ATLAS_WIDTH;
  const resolve = paletteRefResolver(options.ramps);
  const ids = new Set<string>();
  const parsed = sources.map((s) => {
    if (ids.has(s.id)) throw new Error(`Atlas: Sprite-ID ${s.id} doppelt`);
    ids.add(s.id);
    return parseSpriteFrames(s, resolve);
  });
  const items: PackItem[] = [];
  sources.forEach((s, si) => s.frames.forEach((_, fi) => items.push({ sprite: si, frame: fi, w: s.size[0], h: s.size[1] })));
  const { positions, height } = packFrames(items, width, ATLAS_PADDING);
  const albedo = new Uint8Array(width * height * RGBA);
  const normal = new Uint8Array(width * height * RGBA);
  const frameRects: SpriteFrameRef[][] = sources.map(() => []);
  for (const it of items) {
    const pos = positions.get(it);
    const src = sources[it.sprite];
    const frame = parsed[it.sprite]?.[it.frame];
    if (!pos || !src || !frame) continue;
    const [x, y] = pos;
    writeAlbedoFrame(frame, albedo, width, x, y);
    const mask = frame.index;
    const relief = smoothRelief(reliefFromHint(mask, frame.width, frame.height, src.hoehe), mask, frame.width, frame.height);
    writeNormalFrame(relief, mask, frame.width, frame.height, normal, width, x, y);
    (frameRects[it.sprite] ?? [])[it.frame] = { x, y, w: frame.width, h: frame.height, ax: src.anchor[0], ay: src.anchor[1] };
  }
  const sprites: Record<string, AtlasSprite> = {};
  sources.forEach((s, si) => {
    const frames = frameRects[si] ?? [];
    const clips: Record<string, AnimationClip> = {};
    const clipSources = s.clips ?? { [DEFAULT_CLIP]: { frames: s.frames.map((_, i) => i), fps: DEFAULT_CLIP_FPS, loop: false } };
    for (const [name, c] of Object.entries(clipSources)) {
      for (const f of c.frames) if (f < 0 || f >= frames.length) throw new Error(`Sprite ${s.id}: Clip ${name} nutzt Frame ${f}, es gibt ${frames.length}`);
      clips[name] = { name, frames: c.frames, fps: c.fps, loop: c.loop, ...(c.events ? { events: c.events } : {}) };
    }
    const sockets: Record<string, SocketTrack> = {};
    for (const [name, track] of Object.entries(s.sockets ?? {})) {
      if (track.length !== frames.length) throw new Error(`Sprite ${s.id}: Sockel ${name} hat ${track.length} Einträge für ${frames.length} Frames`);
      sockets[name] = track;
    }
    const emissive = (parsed[si] ?? []).some((f) => f.emissive.some((e) => e > 0));
    sprites[s.id] = { id: s.id, group: s.group, size: s.size, frames, clips, sockets, heightHint: s.hoehe, emissive, symmetric: s.symmetric ?? false };
  });
  return {
    manifest: { width, height, sprites, paletteRows: options.paletteRows, sourceHash: hashSources(sources) },
    albedo: { kind: 'pixels', pixels: albedo },
    normal: { kind: 'pixels', pixels: normal },
  };
}
