/**
 * Render tables of the world (M2-28): what the terrain mesh and the object layer look up per tile,
 * resolved once per atlas against the runtime ids of the content (docs/WORLD.md §4, §7).
 *
 * - Terrain runtime id → frames of `tileset_<terrain>` (47 blob frames + full-tile variants with the
 *   scatter weights and mirror rule of the terrain content, `tileset`), the transition table of the
 *   autotiler (`Uebergaenge`) and the ids the renderer substitutes: water shows as `meeresgrund`,
 *   frozen water as `eis`. Solid rock (`fels`, veins) has no tileset. A ground type whose tileset
 *   sprite or transition rank is missing is listed in `missingTilesets` (its tiles stay empty) – a
 *   content/art gap the unit tests report instead of a blank picture.
 * - Biome runtime id → its palette row `biom_<id>` (ground tiles carry the biome row, docs/ART.md §5)
 *   and its cliff group `tileset_klippe_<gruppe>` (`KLIPPEN_GRUPPE_JE_BIOM`).
 * - World object runtime id → sprite of the same id (WORLD.md §7), frame per season (tree clips
 *   `fruehling` … `winter`), harvested frame (`abgeerntet`), variants (scatter picks one per tile),
 *   draw layer, wind, canopy flag and palette row rule (manifest `OBJEKT_ZEILEN`); a tree's stump sprite
 *   `<id>_stumpf` (M2-20 art) for felled trees (M3-11).
 *
 * A world content id without its sprite is a content error: the tables refuse to build and name it.
 */
import { DECOR_SIZES, GROUND_DECOR_RULES, type GroundDecorRule } from './groundDecor';
import { BIOMES } from '../../content/biomes';
import { WORLD_OBJECTS, treeStumpSpriteId } from '../../content/worldObjects';
import { TERRAIN } from '../../content/terrain';
import { SEASON_IDS, type SeasonId } from '../../content/balance';
import { KLIPPE_FRAME, KLIPPEN_GRUPPE_JE_BIOM, KLIPPEN_GRUPPEN, klippenTilesetId, TERRAIN_REIHENFOLGE, TILESET_VARIANTEN_START, tilesetId, Uebergaenge, type KlippenGruppe } from '../../world/autotile';
import { contentWorldIdTables, type WorldIdTables } from '../../world/model/runtimeIds';
import { atlasSprite, type AtlasManifest, type AtlasSprite } from '../assets/atlas';
import type { SpriteFrameRef } from '../batch/spriteList';
import { MATERIAL } from '../gbuffer';
import type { SpriteLayer } from '../batch/spriteLayout';
import { TILE_PX } from '../tilemap/chunk';

/** Frames per tileset: 47 blob frames, then the full-tile variants. */
export const BLOB_FRAMES = TILESET_VARIANTEN_START;
/** Frames of a cliff tileset (`KLIPPE_FRAME.anzahl`). */
export const CLIFF_FRAMES = KLIPPE_FRAME.anzahl;
/** Upper bound of full-tile variants the tables store per tileset. */
export const MAX_VARIANTS = 8;
/** Frame slots per terrain in the frame tables (blob frames + variants). */
export const TERRAIN_FRAME_SLOTS = BLOB_FRAMES + MAX_VARIANTS;
/** Row of the master palette (objects drawn in their final colours, `basis`). */
export const BASE_ROW = 0;

/** Season whose frame objects without season clips show (the drawn state of every sprite). */
const DRAWN_SEASON: SeasonId = 'sommer';
/** Clip of harvested bushes and fruit trees. */
const HARVESTED_CLIP = 'abgeerntet';
/** Sway at the top of a sprite with wind-flagged pixels, by object kind [px] (§6.2 "Wind"). */
const WIND_SWAY: Readonly<Record<string, number>> = { baum: 1, busch: 0.75, pflanze: 1, deko: 0.5 };

/** One world object as the object layer draws it. */
export interface ObjectDef {
  readonly id: string;
  readonly sprite: AtlasSprite;
  /** Sprite frame per season (`SEASON_IDS` order). */
  readonly seasonFrames: readonly [number, number, number, number];
  /** Frame after harvesting, or −1. */
  readonly harvestedFrame: number;
  /** Sprite of the stump a felled tree leaves (`<id>_stumpf`), or null. */
  readonly stump: AtlasSprite | null;
  /** Frames a tile hash picks from (scatter variants); 1 = the season frame. */
  readonly variants: number;
  readonly layer: SpriteLayer;
  /** Wind sway at the top [px] (0 = rigid). */
  readonly wind: number;
  /** Crown pixels that fade around the focus (material `canopy`). */
  readonly canopy: boolean;
  /** Footprint width [tiles]: the sprite stands centred on it. */
  readonly footprintW: number;
  readonly blocking: boolean;
  readonly mirror: boolean;
  /** Palette row per season (`SEASON_IDS` order); −1 = the biome row of the tile. */
  readonly seasonRows: readonly [number, number, number, number];
  /** Height of the sprite's opaque part above its anchor [px] (culling, canopy fade). */
  readonly top: number;
  /** Half width of the opaque part around the anchor [px]. */
  readonly halfWidth: number;
}

/** Palette row index of a named row; throws with the available names. */
function rowOf(manifest: AtlasManifest, name: string): number {
  const i = manifest.paletteRows.findIndex((r) => r.name === name);
  if (i < 0) throw new Error(`Welt-Darstellung: Palettenzeile ${name} fehlt im Atlas`);
  return i;
}

function frameOfClip(sprite: AtlasSprite, clip: string, fallback: number): number {
  return sprite.clips[clip]?.frames[0] ?? fallback;
}

/** A ground decor rule resolved against the atlas (`groundDecor.ts`, M3-40). */
export interface GroundDecorDef {
  readonly rule: GroundDecorRule;
  readonly sprite: AtlasSprite;
  /** Sprite frame per size (`DECOR_SIZES` order). */
  readonly frames: readonly number[];
  /** Height of the opaque part above the anchor and half width around it [px] (culling). */
  readonly top: number;
  readonly halfWidth: number;
}

/** Resolved lookup tables of one atlas for the world renderer. */
export class WorldRenderTables {
  readonly ids: WorldIdTables;
  /** Transition table over the terrain runtime ids (index 0 = "no ground"). */
  readonly transitions: Uebergaenge;
  /** Atlas position of frame f of terrain t at `(t × TERRAIN_FRAME_SLOTS + f)`. */
  readonly terrainFrameX: Uint16Array;
  readonly terrainFrameY: Uint16Array;
  /** Whether terrain t has a tileset. */
  readonly hasTileset: Uint8Array;
  /** Full-tile variants of terrain t and their cumulative weights at `(t × MAX_VARIANTS + v)`. */
  readonly variantCount: Uint8Array;
  readonly variantCumulative: Float32Array;
  readonly variantMirror: Uint8Array;
  /** Atlas position of frame f of cliff group g at `(g × CLIFF_FRAMES + f)`. */
  readonly cliffFrameX: Uint16Array;
  readonly cliffFrameY: Uint16Array;
  /** Palette row and cliff group per biome runtime id. */
  readonly biomeRow: Uint8Array;
  readonly biomeCliff: Uint8Array;
  /** Ground types of the content that cannot be drawn: `<terrain>: <reason>`. */
  readonly missingTilesets: readonly string[];
  /** Terrain runtime ids the renderer substitutes. */
  readonly waterTerrain: number;
  readonly iceTerrain: number;
  /** Object definitions per object runtime id (index 0 = none). */
  readonly objects: readonly (ObjectDef | null)[];
  /** Ground decor per terrain runtime id (null: none), and the rules in use (`GROUND_DECOR_RULES` order). */
  readonly groundDecor: readonly (GroundDecorDef | null)[];
  readonly decorDefs: readonly GroundDecorDef[];

  constructor(
    readonly manifest: AtlasManifest,
    ids: WorldIdTables = contentWorldIdTables(),
  ) {
    this.ids = ids;
    const terrain = ids.terrain.ids();
    const terrainCount = terrain.length + 1;
    this.transitions = new Uebergaenge(['', ...terrain]);
    this.terrainFrameX = new Uint16Array(terrainCount * TERRAIN_FRAME_SLOTS);
    this.terrainFrameY = new Uint16Array(terrainCount * TERRAIN_FRAME_SLOTS);
    this.hasTileset = new Uint8Array(terrainCount);
    this.variantCount = new Uint8Array(terrainCount);
    this.variantCumulative = new Float32Array(terrainCount * MAX_VARIANTS);
    this.variantMirror = new Uint8Array(terrainCount);
    const ordered = new Set<string>(TERRAIN_REIHENFOLGE);
    const missing: string[] = [];
    terrain.forEach((id, i) => {
      const content = TERRAIN.find((t) => t.id === id);
      const tileset = content?.tileset ?? null;
      if (tileset === null) return;
      const sprite = manifest.sprites[tilesetId(id)];
      if (sprite === undefined) missing.push(`${id}: Sprite ${tilesetId(id)} fehlt im Atlas`);
      else if (!ordered.has(id)) missing.push(`${id}: kein Übergangsrang (TERRAIN_REIHENFOLGE in src/world/autotile.ts)`);
      else this.loadTileset(i + 1, sprite, tileset.variantWeights, tileset.mirror);
    });
    this.missingTilesets = missing;
    this.waterTerrain = ids.terrain.runtimeId('meeresgrund');
    this.iceTerrain = ids.terrain.runtimeId('eis');

    this.cliffFrameX = new Uint16Array(KLIPPEN_GRUPPEN.length * CLIFF_FRAMES);
    this.cliffFrameY = new Uint16Array(KLIPPEN_GRUPPEN.length * CLIFF_FRAMES);
    KLIPPEN_GRUPPEN.forEach((g, gi) => {
      const s = atlasSprite(manifest, klippenTilesetId(g));
      if (s.frames.length < CLIFF_FRAMES) throw new Error(`Welt-Darstellung: ${s.id} hat ${s.frames.length} statt ${CLIFF_FRAMES} Frames`);
      for (let f = 0; f < CLIFF_FRAMES; f++) {
        const fr = s.frames[f] as SpriteFrameRef;
        this.cliffFrameX[gi * CLIFF_FRAMES + f] = fr.x;
        this.cliffFrameY[gi * CLIFF_FRAMES + f] = fr.y;
      }
    });

    const biomes = ids.biomes.ids();
    this.biomeRow = new Uint8Array(biomes.length + 1);
    this.biomeCliff = new Uint8Array(biomes.length + 1);
    biomes.forEach((id, i) => {
      const content = BIOMES.find((b) => b.id === id);
      this.biomeRow[i + 1] = rowOf(manifest, content?.colorIdentity.paletteRow ?? `biom_${id}`);
      const group: KlippenGruppe | undefined = KLIPPEN_GRUPPE_JE_BIOM[id];
      if (group === undefined) throw new Error(`Welt-Darstellung: Biom ${id} hat keine Klippen-Gruppe (KLIPPEN_GRUPPE_JE_BIOM)`);
      this.biomeCliff[i + 1] = KLIPPEN_GRUPPEN.indexOf(group);
    });

    const objectIds = ids.objects.ids();
    this.objects = [null, ...objectIds.map((id) => this.objectDef(id))];

    const decor: (GroundDecorDef | null)[] = new Array<GroundDecorDef | null>(terrainCount).fill(null);
    const decorDefs: GroundDecorDef[] = [];
    for (const rule of GROUND_DECOR_RULES) {
      const sprite = atlasSprite(manifest, rule.sprite);
      const frames = DECOR_SIZES.map((size) => {
        const f = sprite.clips[size]?.frames[0];
        if (f === undefined) throw new Error(`Welt-Darstellung: ${sprite.id} hat keinen Clip ${size}`);
        return f;
      });
      const frame = sprite.frames[0] as SpriteFrameRef;
      const b = sprite.bounds ?? { x: 0, y: 0, w: frame.w, h: frame.h };
      const def: GroundDecorDef = { rule, sprite, frames, top: frame.ay - b.y, halfWidth: Math.max(frame.ax - b.x, b.x + b.w - frame.ax) };
      decor[ids.terrain.runtimeId(rule.terrain)] = def;
      decorDefs.push(def);
    }
    this.groundDecor = decor;
    this.decorDefs = decorDefs;
  }

  private loadTileset(t: number, s: AtlasSprite, weights: readonly number[], mirror: boolean): void {
    const variants = s.frames.length - BLOB_FRAMES;
    if (variants !== weights.length || variants > MAX_VARIANTS) throw new Error(`Welt-Darstellung: ${s.id} hat ${s.frames.length} Frames, der Content nennt ${weights.length} Varianten (erwartet ${BLOB_FRAMES} Blob-Frames + Varianten)`);
    for (let f = 0; f < s.frames.length; f++) {
      const fr = s.frames[f] as SpriteFrameRef;
      if (fr.w !== TILE_PX || fr.h !== TILE_PX) throw new Error(`Welt-Darstellung: ${s.id} Frame ${f} ist ${fr.w}×${fr.h} statt ${TILE_PX}×${TILE_PX}`);
      this.terrainFrameX[t * TERRAIN_FRAME_SLOTS + f] = fr.x;
      this.terrainFrameY[t * TERRAIN_FRAME_SLOTS + f] = fr.y;
    }
    const total = weights.reduce((a, b) => a + b, 0);
    let sum = 0;
    for (let i = 0; i < variants; i++) {
      sum += weights[i] ?? 0;
      this.variantCumulative[t * MAX_VARIANTS + i] = i === variants - 1 ? 1 : sum / total;
    }
    this.variantCount[t] = variants;
    this.variantMirror[t] = mirror ? 1 : 0;
    this.hasTileset[t] = 1;
  }

  private objectDef(id: string): ObjectDef {
    const o = WORLD_OBJECTS.find((w) => w.id === id);
    if (o === undefined) throw new Error(`Welt-Darstellung: Welt-Objekt ${id} fehlt im Content`);
    const s = atlasSprite(this.manifest, id);
    // Trees carry one clip per season, named after it (M2-20).
    const f0 = s.clips[DRAWN_SEASON]?.frames[0] ?? 0;
    const seasonFrames = SEASON_IDS.map((season) => frameOfClip(s, season, f0)) as [number, number, number, number];
    const hasSeasons = SEASON_IDS.some((season) => s.clips[season] !== undefined);
    const harvestedFrame = frameOfClip(s, HARVESTED_CLIP, -1);
    // Scatter without clips shows one of its frames per tile; everything else its season frame.
    const variants = !hasSeasons && harvestedFrame < 0 && Object.keys(s.clips).length === 0 ? s.frames.length : 1;
    const material = s.material ?? 0;
    const rule = this.manifest.objectRows?.[id];
    const seasonRows = SEASON_IDS.map((_, i) => (rule === undefined ? BASE_ROW : rule.kind === 'biome' ? -1 : rowOf(this.manifest, rule.rows[i] ?? 'basis'))) as [number, number, number, number];
    const frame = s.frames[0] as SpriteFrameRef;
    const b = s.bounds ?? { x: 0, y: 0, w: frame.w, h: frame.h };
    return {
      id,
      sprite: s,
      seasonFrames,
      harvestedFrame,
      stump: this.manifest.sprites[treeStumpSpriteId(id)] ?? null,
      variants,
      layer: s.heightHint === 'flach' ? 'ground' : 'objects',
      wind: (material & MATERIAL.wind) !== 0 ? (WIND_SWAY[o.kind] ?? 0) : 0,
      canopy: (material & MATERIAL.canopy) !== 0,
      footprintW: o.footprint.w,
      blocking: o.blocking,
      mirror: s.symmetric,
      seasonRows,
      top: frame.ay - b.y,
      halfWidth: Math.max(frame.ax - b.x, b.x + b.w - frame.ax),
    };
  }

  /** Palette row of object `def` in season index `season` on a tile of biome `biome`. */
  objectRow(def: ObjectDef, season: number, biome: number): number {
    const r = def.seasonRows[season] ?? BASE_ROW;
    return r < 0 ? (this.biomeRow[biome] ?? BASE_ROW) : r;
  }
}

/** Index of a season in `SEASON_IDS` (tables and object caches store seasons by index). */
export function seasonIndex(season: SeasonId): number {
  return SEASON_IDS.indexOf(season);
}
