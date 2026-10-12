/**
 * The game atlas of `npm run assets` (docs/RENDER.md §2: `src/generated/atlas.ts` +
 * `public/generated/atlas-albedo.png` / `atlas-normal.png`), adapted to the renderer's
 * `AtlasManifest`. The manifest module is looked up through an eager glob, so the renderer also
 * builds before the assets exist (fresh checkout). It is a build artefact of another tool: its whole
 * shape is checked against the contract when it is built – `checkGeneratedAtlasModule` in the unit
 * tests after every `npm run assets` –, at runtime only its header (M7-115). The images are decoded
 * without premultiplication or colour conversion – their channels are palette indices, flags and
 * normals, not colours.
 */
import { z } from 'zod';
import type { AnimationClip } from '../anim/animation';
import type { SpriteFrameRef } from '../batch/spriteList';
import type { AtlasData, AtlasManifest, AtlasSprite, ObjectRowRule, SocketTrack } from './atlas';
import { SpriteEntry } from './spriteTable';

const modules = import.meta.glob('../../generated/atlas.ts', { eager: true });

const point = z.tuple([z.number(), z.number()]);
const rect = z.object({ x: z.number().int(), y: z.number().int(), w: z.number().int().positive(), h: z.number().int().positive() });
/**
 * A frame's atlas rectangle with its anchor within that rectangle (M7-130): the cell anchor, for a trimmed frame (sprite
 * `zuschnitt`, M7-110) the cell anchor minus the cut. Every frame carries it – the renderer uses the module's frames as they are.
 */
const frameRect = rect.extend({ ax: z.number().int(), ay: z.number().int() });
/** A clip, named with its key (the renderer's `AnimationClip`, used as it is). */
const clip = z.object({
  name: z.string(),
  frames: z.array(z.number().int().nonnegative()).min(1),
  fps: z.number().positive(),
  loop: z.boolean(),
  events: z.array(z.object({ frame: z.number().int().nonnegative(), name: z.string() })),
});
const sprite = z.object({
  id: z.string(),
  group: z.string(),
  size: point,
  anchor: point,
  sockets: z.record(z.string(), z.array(point)),
  frames: z.array(frameRect).min(1),
  clips: z.record(z.string(), clip),
  hoehe: z.enum(['flach', 'zylinder', 'kugel', 'block', 'custom']),
  emissiv: z.boolean(),
  spiegelbar: z.boolean(),
  material: z.number().int().nonnegative(),
  bounds: rect,
  occluder: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('none') }),
    z.object({ kind: z.literal('rect'), x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
    z.object({ kind: z.literal('ellipse'), x: z.number(), y: z.number(), rx: z.number(), ry: z.number() }),
    z.object({ kind: z.literal('sprite') }),
  ]).optional(),
  schatten: z.discriminatedUnion('kind', [z.object({ kind: z.literal('none') }), z.object({ kind: z.literal('silhouette') })]).optional(),
});
const seasonRows = z.tuple([z.string(), z.string(), z.string(), z.string()]);
const objectRowRule = z.discriminatedUnion('regel', [z.object({ regel: z.literal('jahreszeit'), zeilen: seasonRows }), z.object({ regel: z.literal('biom') })]);
const moduleSchema = z.object({
  ATLAS: z.object({ width: z.number().int().positive(), height: z.number().int().positive(), albedoUrl: z.string(), normalUrl: z.string(), sourceHash: z.string() }),
  SPRITES: z.record(z.string(), sprite),
  PALETTE_ROWS: z.array(z.object({ id: z.string(), map: z.array(z.number().int()) })),
  OBJEKT_ZEILEN: z.record(z.string(), objectRowRule),
});

export type GeneratedAtlasModule = z.infer<typeof moduleSchema>;

/** The module whose header was checked (`generatedAtlasModule`). */
let checked: unknown = null;

/** Whether `value` is a positive whole number. */
function positiveInt(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** Whether `value` is a non-null object that is no array. */
function plainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The runtime check of the manifest module: its four exports have their kind and the atlas header its fields. Constant
 * time and no allocation – the sprites are not walked.
 */
function headerFits(mod: unknown): mod is GeneratedAtlasModule {
  if (!plainObject(mod)) return false;
  const m = mod as Readonly<Record<string, unknown>>;
  const atlas = m['ATLAS'];
  if (!plainObject(atlas)) return false;
  const a = atlas as Readonly<Record<string, unknown>>;
  return (
    positiveInt(a['width']) &&
    positiveInt(a['height']) &&
    typeof a['albedoUrl'] === 'string' &&
    typeof a['normalUrl'] === 'string' &&
    typeof a['sourceHash'] === 'string' &&
    plainObject(m['SPRITES']) &&
    Array.isArray(m['PALETTE_ROWS']) &&
    plainObject(m['OBJEKT_ZEILEN'])
  );
}

/**
 * The whole contract check of a manifest module (docs/RENDER.md §2): every sprite with its frames, clips and sockets. It
 * builds a full copy of the manifest – some 40 MB of short-lived objects for ≈ 1 200 sprites with 55 000 frames – so it
 * runs where the module is built and checked (`tests/unit/render/atlas-generated.test.ts` after every `npm run assets`),
 * never in the game (M7-115). Returns the module itself; throws naming every issue.
 */
export function checkGeneratedAtlasModule(mod: unknown): GeneratedAtlasModule {
  const parsed = moduleSchema.safeParse(mod);
  if (!parsed.success) throw new Error(`src/generated/atlas.ts passt nicht zum Atlas-Vertrag (docs/RENDER.md §2): ${parsed.error.message}`);
  const misnamed: string[] = [];
  for (const s of Object.values(parsed.data.SPRITES)) for (const [key, c] of Object.entries(s.clips)) if (c.name !== key) misnamed.push(`${s.id}.${key} heißt „${c.name}“`);
  if (misnamed.length > 0) throw new Error(`src/generated/atlas.ts passt nicht zum Atlas-Vertrag (docs/RENDER.md §2): Clip-Name ≠ Schlüssel – ${misnamed.join(', ')}`);
  // A sprite table (M7-151): every value an entry of it under its own id, and every socket track as long as the frames.
  const sprites = (mod as GeneratedAtlasModule).SPRITES;
  const wrong: string[] = [];
  for (const [key, s] of Object.entries(sprites)) {
    if (s instanceof SpriteEntry && s.id !== key) wrong.push(`${key} trägt die Id ${s.id}`);
    for (const [name, track] of Object.entries(s.sockets)) if (track.length !== s.frames.length) wrong.push(`${key}.${name} hat ${track.length} Punkte für ${s.frames.length} Frames`);
  }
  if (wrong.length > 0) throw new Error(`src/generated/atlas.ts passt nicht zum Atlas-Vertrag (docs/RENDER.md §2): ${wrong.join(', ')}`);
  return mod as GeneratedAtlasModule;
}

/**
 * The generated manifest module, `null` before `npm run assets` ran; throws if its header is not the contract's.
 *
 * Handed out as it is – the module's own data, held once: a zod check here built a full copy of every sprite (some 40 MB of
 * short-lived objects on the loading screen, plus the retained copy), which V8's memory reducer later swept up in one long
 * collection in the middle of play (M7-115). The full contract is checked where the module is built
 * (`checkGeneratedAtlasModule`). Callers only read it.
 */
export function generatedAtlasModule(): GeneratedAtlasModule | null {
  const mod = Object.values(modules)[0];
  if (mod === undefined) return null;
  if (checked === mod) return mod as GeneratedAtlasModule;
  if (!headerFits(mod)) throw new Error('src/generated/atlas.ts passt nicht zum Atlas-Vertrag (docs/RENDER.md §2): Kopf ATLAS, SPRITES, PALETTE_ROWS oder OBJEKT_ZEILEN fehlt oder hat die falsche Art');
  checked = mod;
  return mod;
}

/**
 * Converts the generated manifest into the renderer's model. An entry of the module's sprite table (M7-151, `SpriteEntry`)
 * is the renderer's sprite itself – it carries both contracts, and its frames, clips and sockets are decoded from the
 * table's columns when first read. A module of plain data (tests) gets one sprite record per sprite whose frames (with
 * their anchor), clips (named) and sockets are the module's own objects (M7-130: no second copy on the heap).
 */
export function manifestFromGenerated(mod: GeneratedAtlasModule): AtlasManifest {
  const sprites: Record<string, AtlasSprite> = {};
  for (const [id, s] of Object.entries(mod.SPRITES)) {
    if (s instanceof SpriteEntry) {
      sprites[id] = s;
      continue;
    }
    const frames: readonly SpriteFrameRef[] = s.frames;
    const clips: Readonly<Record<string, AnimationClip>> = s.clips;
    const sockets: Readonly<Record<string, SocketTrack>> = s.sockets;
    sprites[id] = {
      id,
      group: s.group,
      size: s.size,
      frames,
      clips,
      sockets,
      heightHint: s.hoehe,
      emissive: s.emissiv,
      symmetric: s.spiegelbar,
      material: s.material,
      bounds: s.bounds,
      occluder: s.occluder ?? { kind: 'none' },
      sunShadow: s.schatten?.kind === 'silhouette',
    };
  }
  const objectRows: Record<string, ObjectRowRule> = {};
  for (const [id, r] of Object.entries(mod.OBJEKT_ZEILEN)) objectRows[id] = r.regel === 'biom' ? { kind: 'biome' } : { kind: 'season', rows: r.zeilen };
  return {
    width: mod.ATLAS.width,
    height: mod.ATLAS.height,
    sprites,
    paletteRows: mod.PALETTE_ROWS.map((r) => ({ name: r.id, map: r.map })),
    sourceHash: mod.ATLAS.sourceHash,
    objectRows,
  };
}

async function decode(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Atlas-Bild ${url}: HTTP ${res.status}`);
  return createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}

/** Loads the generated atlas (manifest + both images); `null` when `npm run assets` has not produced one. */
export async function loadGeneratedAtlas(baseUrl: string = import.meta.env.BASE_URL): Promise<AtlasData | null> {
  const mod = generatedAtlasModule();
  if (mod === null) return null;
  const [albedo, normal] = await Promise.all([decode(baseUrl + mod.ATLAS.albedoUrl), decode(baseUrl + mod.ATLAS.normalUrl)]);
  return { manifest: manifestFromGenerated(mod), albedo: { kind: 'image', image: albedo }, normal: { kind: 'image', image: normal } };
}
