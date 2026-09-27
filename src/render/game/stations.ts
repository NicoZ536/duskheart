/**
 * Placed stations in the game view (MASTERPROMPT §15.1, §15.2 "Stationen", §16.1 "Objekte"; M4-05, M4-06 on screen):
 * every station the station system keeps (`StationSystem.placed`) drawn with its sprite `obj_<station>`
 * (`stationSpriteId`, docs/SPIEL.md §8; assets-src/sprites/stationen/) standing at the middle of the front edge of its
 * (turned) footprint, y-sorted with the player and the world's objects, on the height of its tile. The clip shows what
 * the station does (`stationClip`):
 * - a processing station that worked in its last tick burns or works (`brennt`, `arbeitet`: the kiln's glow, the clay
 *   oven's and the furnace's fire, the drying rack's cloth in the wind); standing still with something done in its
 *   output it shows it (`fertig`: the opened charcoal kiln, `belegt`: the rack hung full), with something in its input
 *   `belegt`, empty `leer` or cold `aus`;
 * - a hand station works (`arbeitet`: the grindstone turning, the spinning wheel) while the player's current crafting
 *   piece is made at it;
 * - a station without such clips stands in its first frame (the workbenches, the anvil).
 * A station set up mirrored (`gespiegelt`, the build mode's F) is drawn mirrored when its sprite is `spiegelbar` – its
 * normals follow (the sprite pass mirrors them), so its light still falls right.
 * Fired stations glow through their emissive pixels only (a little more while they burn): the simulation's light source
 * list holds no station light. The campfire station is the light system's camp fire (drawn by `lights.ts`), a station
 * the building grid owns as a part is drawn here all the same (the grid view leaves it out). The station the
 * interaction targets carries the outline (§4.6).
 *
 * Reads the simulation, never writes it; no allocation per frame.
 */
import { stationSpriteId } from '../../content/stations';
import { CRAFTING_SYSTEM_ID, CraftingSystem } from '../../game/crafting/system';
import type { Simulation } from '../../game/sim';
import type { PlacedStation } from '../../game/stations/state';
import { STATIONS_SYSTEM_ID, StationSystem } from '../../game/stations/system';
import { WAND_PX_JE_STUFE } from '../../world/autotile';
import type { Layer } from '../../world/model/coords';
import { clipFrameAt } from '../anim/animation';
import type { AtlasData, AtlasManifest, AtlasSprite } from '../assets/atlas';
import type { SpriteFrameRef } from '../batch/spriteList';
import type { RenderScene } from '../scene';
import { TILE_PX } from '../tilemap/chunk';

/** Clips of a station at work, in the order they are preferred (fired stations burn, the others work). */
export const WORKING_CLIPS = ['brennt', 'arbeitet'] as const;
/** Clips of a station standing still with its output done, in order. */
export const DONE_CLIPS = ['fertig', 'belegt'] as const;
/** Clip of a station standing still with something in its input. */
export const LOADED_CLIP = 'belegt';
/** Clips of an empty, cold station, in order. */
export const IDLE_CLIPS = ['leer', 'aus'] as const;
/** Extra glow of a fired station's emissive pixels while it burns (its fire, its embers). */
const BURNING_GLOW = 0.15;
/** Animation phase offset per station id [s]: neighbouring stations do not work in step. */
const PHASE_STEP = 0.29;
/** Margin around the view in which stations still draw [tiles]: the tallest station sprite (the furnace, 48 px). */
const MARGIN_TILES = 3;

/** What the station view needs of the game view's frame. */
export interface StationFrame {
  layer: Layer;
  /** Pushed rectangle [world px]. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Presentation time [s]. */
  time: number;
  /** Tile of the interaction's use target on `layer` (−1 none): the station on it carries the outline. */
  focusTx: number;
  focusTy: number;
  /** Height level of a tile (the lit height rises by 16 px per level). */
  levelAt(tx: number, ty: number): number;
}

/** A fresh frame record. */
export function createStationFrame(): StationFrame {
  return { layer: 0, left: 0, top: 0, right: 0, bottom: 0, time: 0, focusTx: -1, focusTy: -1, levelAt: () => 0 };
}

/** What the station view drew in the last frame. */
export interface StationStats {
  /** Stations drawn. */
  drawn: number;
  /** Stations at work (a working clip). */
  working: number;
  /** Stations without a sprite in the atlas. */
  missing: number;
}

/** The first of `names` that sprite `s` has, or `null`. */
function firstClip(s: AtlasSprite, names: readonly string[]): string | null {
  for (const n of names) if (s.clips[n] !== undefined) return n;
  return null;
}

/**
 * The clip of placed station `st` drawn with sprite `s` (see module comment); `crafting` whether the player's current
 * piece is made at it. `null`: the sprite has no clip for the state (it stands in its first frame).
 */
export function stationClip(s: AtlasSprite, st: Readonly<PlacedStation>, crafting: boolean): string | null {
  const p = st.proc;
  if (p === null) return crafting ? firstClip(s, WORKING_CLIPS) : firstClip(s, IDLE_CLIPS);
  if (p.laeuft) return firstClip(s, WORKING_CLIPS) ?? firstClip(s, IDLE_CLIPS);
  if (p.ausgang.some((x) => x !== null)) {
    const done = firstClip(s, DONE_CLIPS);
    if (done !== null) return done;
  }
  if (p.eingang.some((x) => x !== null) && s.clips[LOADED_CLIP] !== undefined) return LOADED_CLIP;
  return firstClip(s, IDLE_CLIPS);
}

interface Systems {
  readonly sim: Simulation;
  readonly stations: StationSystem | null;
  readonly crafting: CraftingSystem | null;
}

/** The placed stations of the game view (see module comment). */
export class StationView {
  readonly stats: StationStats = { drawn: 0, working: 0, missing: 0 };
  private systems: Systems | null = null;
  private manifest: AtlasManifest | null = null;
  private readonly sprites = new Map<string, AtlasSprite | null>();

  /** Draws the stations of the frame's layer inside its pushed rectangle. */
  draw(scene: RenderScene, atlas: AtlasData, sim: Simulation, f: StationFrame): void {
    this.stats.drawn = 0;
    this.stats.working = 0;
    this.stats.missing = 0;
    const { stations, crafting } = this.systemsOf(sim);
    if (stations === null) return;
    this.bind(atlas.manifest);
    const placed = stations.placed;
    const margin = MARGIN_TILES * TILE_PX;
    // The piece the player works now: at which placed station (0 none).
    const order = crafting?.orders[0];
    const craftingAt = order !== undefined && order.dauer > 0 && crafting?.blocked === null ? (order.platz ?? 0) : 0;
    for (let i = 0; i < placed.length; i++) {
      const st = placed[i] as Readonly<PlacedStation>;
      if (st.layer !== f.layer) continue;
      const size = stations.footprintOf(st);
      const x = (st.tx + size.b / 2) * TILE_PX;
      const y = (st.ty + size.t) * TILE_PX - 1;
      if (x < f.left - margin || x > f.right + margin || y < f.top - margin || y > f.bottom + margin) continue;
      const s = this.sprite(stationSpriteId(st.station));
      if (s === null) {
        this.stats.missing++;
        continue;
      }
      const clipName = stationClip(s, st, craftingAt === st.id);
      const clip = clipName === null ? undefined : s.clips[clipName];
      const working = clipName !== null && (WORKING_CLIPS as readonly string[]).includes(clipName);
      const d = scene.sprite.reset();
      d.frame = (s.frames[clip === undefined ? 0 : clipFrameAt(clip, f.time + st.id * PHASE_STEP)] ?? s.frames[0]) as SpriteFrameRef;
      d.x = x;
      d.y = y;
      d.heightBase = f.levelAt(st.tx, st.ty) * WAND_PX_JE_STUFE;
      // Set up mirrored (the build mode's F, `station.place {mirror}`): the whole station stands mirrored – where its
      // sprite may be mirrored (`spiegelbar`, docs/ART.md; like build parts in building.ts).
      d.mirror = st.gespiegelt === true && s.symmetric;
      d.outline = f.focusTx >= st.tx && f.focusTx < st.tx + size.b && f.focusTy >= st.ty && f.focusTy < st.ty + size.t;
      d.emissiveBoost = working && s.emissive ? BURNING_GLOW : 0;
      scene.sprites.push(d);
      this.stats.drawn++;
      if (working) this.stats.working++;
    }
  }

  private bind(m: AtlasManifest): void {
    if (this.manifest === m) return;
    this.manifest = m;
    this.sprites.clear();
  }

  private sprite(id: string): AtlasSprite | null {
    let s = this.sprites.get(id);
    if (s === undefined) {
      s = this.manifest?.sprites[id] ?? null;
      this.sprites.set(id, s);
    }
    return s;
  }

  private systemsOf(sim: Simulation): Systems {
    let s = this.systems;
    if (s === null || s.sim !== sim) {
      const stations = sim.systems.find((x) => x.id === STATIONS_SYSTEM_ID);
      const crafting = sim.systems.find((x) => x.id === CRAFTING_SYSTEM_ID);
      s = { sim, stations: stations instanceof StationSystem ? stations : null, crafting: crafting instanceof CraftingSystem ? crafting : null };
      this.systems = s;
    }
    return s;
  }
}
