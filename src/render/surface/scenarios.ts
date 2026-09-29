/**
 * Screenshot scenarios of the world surface (MASTERPROMPT §31.5; M5-17 … M5-20, M5-23): the game view on the session's
 * world, set up with the game's commands only (fixed seed, frozen loop) and registered in src/debug/scenarios.ts.
 * - `gras-interaktiv`: the player walks east into the densest clump of dune grass near the coast on a breezy day – the
 *   tufts around its feet lean away and are pressed down, behind it they spring back (M5-69: the spot is scored by the
 *   tufts the feet reach, `GRASS_SPOT`).
 * - `kronen-dither`: the player stands behind a broad crown; the crown opens in a dithered circle around it.
 * - `herbst`: the first morning of autumn – the forest is half-way through its turn, tree by tree, light leaves first.
 * - `winter-schnee`: the Grünhain's first snow – after a bare morning it snows until the cover is half grown: snow in
 *   world-fixed clusters on the meadow, caps on crowns, branches, rock tops; the player stands on open ground with
 *   nothing in reach (`clearOf`: no interaction marker over the picture).
 * - `fussspuren`: a snowy Frostkamm path; an hour-old track has faded to shallow prints, the fresh one is deep.
 * - `regen-nacht-pfuetzen`: a rainy night at a camp with a torch – puddles in the hollows mirror the flames.
 * - `gruenhain-nacht`: a clear summer night in the Grünhain – fireflies over the meadow, the player's torch.
 * - `hoehle-fackeln`: the Wurzelhöhlen (layer −1) – no ambient light, only the torch in the hand, a torch on its stake
 *   and the breathing glow of the glowing mushrooms.
 * - `shader-outline`, `shader-weissblitz`, `shader-palettentausch`, `shader-dither`: the effect shaders of the sprites
 *   in their debug scenes (`effectShowcase.ts`, M5-24).
 * The scenario drives the presentation clock with the ticks it steps (the grass springs back in that rhythm) and
 * counts as stable once the view is complete after its last step.
 */
import { BALANCE, type SeasonId } from '../../content/balance';
import { CLIMATE_BALANCE, type WeatherStateId } from '../../content/weather';
import type { GameCameraStart } from '../world/gameScene';
import type { RenderSceneId } from '../scenes/ids';
import { TERRAIN } from '../../content/terrain';
import { GROUND_SURFACE, SURFACE_PARAMS } from './params';
import { GROUND_DECOR_RULES, tuftsNear } from '../world/groundDecor';
import { FOOTPRINT_MAX_TILES, WORLD_OBJECTS } from '../../content/worldObjects';
import { clusterNoise, NOISE_SALT, puddleAt } from './rules';
import { surfaceWorldQuery, type SurfaceTile, type SurfaceWorldQuery } from '../world/surfaceScene';
import { CHUNK_TILES } from '../tilemap/chunk';
import { equipmentRef } from '../../game/items/slots';
import { EFFECT_SCENE_IDS } from './effectShowcase';
import type { Layer } from '../../world/model/coords';

const TILE = 16;
const TICK_HZ = 60;
/** Presentation time at the start of every scenario [s] (trees mid-sway). */
const START_TIME = 1.3;
/** Ticks stepped per rendered frame while the scenario walks. */
const TICKS_PER_FRAME = 6;
/** Frames the scenario waits after its last step before it trusts the view (streaming around the new place). */
const SETTLE_FRAMES = 8;
/** Game minutes the weather runs before the picture: longer than its blend (`CLIMATE_BALANCE.weatherBlendMinutes`). */
const WEATHER_SETTLE_MINUTES = CLIMATE_BALANCE.weatherBlendMinutes + 15;
const DAY_MINUTES = 24 * 60;
/** How far the scenario searches for its spot around the showcase [tiles]. */
const SEARCH_RADIUS = 40;
/** Frames a scenario asks for its spot again while it is not found (chunks of its search still streaming in). */
const PLACE_FRAMES = 600;

/** What the scenarios need of the renderer (`ScenarioRender`). */
interface SurfaceRender {
  showScene(id: RenderSceneId): void;
  setDebugView(name: string): void;
  sceneReady(): boolean;
  startGameCamera(start: GameCameraStart): void;
  gameCamera(): { layer: number; tx: number; ty: number } | null;
}

/** What the scenarios need of their context (`ScenarioContext`). */
interface SurfaceContext {
  freezeAt(seconds: number): void;
  readonly render?: SurfaceRender;
  readonly session?: { command(raw: unknown): unknown; step(): void; state(): { player: { x: number; y: number } | null } };
}

/** The scenario (shape of `Scenario`, src/debug/scenarios.ts). */
export interface SurfaceScenario {
  readonly name: string;
  readonly description: string;
  readonly settleFrames: number;
  setup(ctx: SurfaceContext): void;
  ready(): boolean;
}

/**
 * One step of a scenario's script: walk for `ticks` in (dx, dy); give commands (one step after them) – `at` is the
 * player's tile, `q` the world query on the camera's layer; or wait until the view is complete again (a new place
 * streamed in).
 */
type Step =
  | { readonly walk: readonly [number, number]; readonly ticks: number }
  | { readonly commands: (at: SurfaceTile, q: SurfaceWorldQuery) => unknown[] }
  | { readonly settle: true }
  | { readonly wait: number };

interface Spec {
  readonly name: string;
  readonly description: string;
  readonly biome: string;
  /** Season to jump to first (its first day at 06:00), or none. */
  readonly season?: SeasonId;
  readonly time: { readonly hour: number; readonly minute: number };
  readonly weather: WeatherStateId;
  /** World layer of the spawn (default the surface; −1 the Wurzelhöhlen). */
  readonly layer?: number;
  /** Game minutes the weather runs before the picture (it blends in, the ground reacts); default `WEATHER_SETTLE_MINUTES`. */
  readonly settleMinutes?: number;
  /** The spawn tile near the showcase `at`, or null while the spot is not found yet (chunks streaming). */
  place(q: SurfaceWorldQuery, at: SurfaceTile): SurfaceTile | null;
  readonly script: readonly Step[];
}

/** A tile with object `id` near `at` and the tile beside it the player stands on. */
function besideObject(q: SurfaceWorldQuery, at: SurfaceTile, id: string, dx: number, dy: number): SurfaceTile | null {
  const o = q.nearestObject(at.tx, at.ty, id, SEARCH_RADIUS);
  return o === null ? null : { tx: o.tx + dx, ty: o.ty + dy };
}

/**
 * Where `gras-interaktiv` walks (M5-69): `ticks` eastwards at walking speed, on a run of `length` tiles of which at least
 * `needed` are the rule's ground, within `searchTiles` of the showcase (inside the surface load radius). The spot is
 * scored by the dune grass the figure bends – the tufts within its push (`SURFACE_PARAMS.grass.benderRadiusPx`) at the
 * end of the walk, which lean away on every side of the figure and count most (`feetWeight`), those at every
 * `trailStepPx` along the last `trailPx` behind it (springing back), and the tufts within `aroundPx` (the clump it stands
 * in); a tuft counts by its size (`sizeWeights`, small to large: a large one shows the bend best). Before, the scenario stood next to the first marram tuft three tiles along a
 * run of dune grass ground – since the coast showcase (M5-64) in sparse grass, the bending read only on the outlined
 * marram.
 */
export const GRASS_SPOT = {
  terrain: 'duenengras',
  ticks: 45,
  length: 6,
  needed: 5,
  searchTiles: 56,
  feetWeight: 8,
  trailStepPx: 8,
  trailPx: 32,
  aroundPx: 24,
  sizeWeights: [1, 2, 3] as readonly number[],
} as const;

/** How far the walk of `gras-interaktiv` takes the player east [px] (walking speed × its ticks). */
export function grassWalkPx(): number {
  return (BALANCE.player.movement.walkTilesPerSecond * TILE * GRASS_SPOT.ticks) / TICK_HZ;
}

/** What the placement of `gras-interaktiv` reads of the world (the game view's world query, or a test's). */
export type GrassQuery = Pick<SurfaceWorldQuery, 'groundAt' | 'objectAt'>;

/** Footprint and blocking of every world object (anchored at its tile, reaching east and north). */
const OBJECT_SHAPES: ReadonlyMap<string, { readonly w: number; readonly h: number; readonly blocking: boolean }> = new Map(WORLD_OBJECTS.map((o) => [o.id, { ...o.footprint, blocking: o.blocking }]));

/**
 * The object whose footprint covers tile (tx, ty) – '' for none, null while a chunk is missing; `blocking` only those
 * that block the way.
 */
function objectCovering(q: GrassQuery, tx: number, ty: number, blocking: boolean): string | null {
  for (let i = 0; i < FOOTPRINT_MAX_TILES; i++) {
    for (let j = 0; j < FOOTPRINT_MAX_TILES; j++) {
      const o = q.objectAt(tx - i, ty + j);
      if (o === null) return null;
      const f = o === '' ? undefined : OBJECT_SHAPES.get(o);
      if (f !== undefined && i < f.w && j < f.h && (f.blocking || !blocking)) return o;
    }
  }
  return '';
}

/** Distance from (x, y) to the rectangle [x0, x1] × [y0, y1] [tiles]. */
function rectDistance(x: number, y: number, x0: number, y0: number, x1: number, y1: number): number {
  return Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1));
}

/**
 * Whether the interaction offers nothing to feet at (fx, fy) [tiles]: no object's footprint and no water tile within its
 * reach (`BALANCE.interaction.reachTiles`) – no marker over the picture.
 */
function nothingToOffer(q: GrassQuery, fx: number, fy: number): boolean {
  const reach = BALANCE.interaction.reachTiles;
  const r = Math.ceil(reach) + FOOTPRINT_MAX_TILES;
  const tx = Math.floor(fx);
  const ty = Math.floor(fy);
  for (let y = ty - r; y <= ty + r; y++) {
    for (let x = tx - r; x <= tx + r; x++) {
      const g = q.groundAt(x, y);
      const o = q.objectAt(x, y);
      if (g === null || o === null) return false;
      if (g.water && rectDistance(fx, fy, x, y, x + 1, y + 1) <= reach) return false;
      const f = o === '' ? undefined : OBJECT_SHAPES.get(o);
      if (f !== undefined && rectDistance(fx, fy, x, y + 1 - f.h, x + f.w, y + 1) <= reach) return false;
    }
  }
  return true;
}

/**
 * The start tile near `at` of the walk through the densest dune grass (`GRASS_SPOT`): open ground to spawn on (it and
 * its eight neighbours dry, on its level, under no blocking footprint – else the spawn moves the player, `openAt`), a run
 * of `length` tiles eastwards on that level, dry and under no blocking footprint, and nothing the interaction offers
 * where the walk ends; the best score wins, the nearer spot (ring by ring, a fixed order) on a tie. Null while a chunk
 * of the search is not resident (the scenario asks again) or when no run qualifies.
 */
export function denseGrassRun(q: GrassQuery, at: SurfaceTile): SurfaceTile | null {
  const G = GRASS_SPOT;
  // Every chunk the search reads must be resident: the choice may not depend on how far the streaming got.
  const reach = G.searchTiles + G.length + Math.ceil(BALANCE.interaction.reachTiles) + FOOTPRINT_MAX_TILES + Math.ceil(G.aroundPx / TILE) + 1;
  for (let y = at.ty - reach; y <= at.ty + reach + CHUNK_TILES; y += CHUNK_TILES) {
    for (let x = at.tx - reach; x <= at.tx + reach + CHUNK_TILES; x += CHUNK_TILES) if (q.groundAt(Math.min(x, at.tx + reach), Math.min(y, at.ty + reach)) === null) return null;
  }
  const rule = GROUND_DECOR_RULES.find((r) => r.terrain === G.terrain);
  if (rule === undefined) throw new Error(`Szenario gras-interaktiv: keine Bodendeko auf ${G.terrain}`);
  const stands = (tx: number, ty: number): boolean => {
    const g = q.groundAt(tx, ty);
    return g !== null && g.terrain === G.terrain && !g.water && q.objectAt(tx, ty) === '';
  };
  const walkable = (tx: number, ty: number, level: number): boolean => {
    const g = q.groundAt(tx, ty);
    return g !== null && !g.water && !g.solid && g.level === level && objectCovering(q, tx, ty, true) === '';
  };
  const push = SURFACE_PARAMS.grass.benderRadiusPx;
  const walk = grassWalkPx();
  let best: SurfaceTile | null = null;
  let bestScore = 0;
  for (let r = 0; r <= G.searchTiles; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = at.tx + dx;
        const ty = at.ty + dy;
        const start = q.groundAt(tx, ty);
        if (start === null) continue;
        let ok = true;
        for (let y = ty - 1; y <= ty + 1 && ok; y++) for (let x = tx - 1; x <= tx + 1 && ok; x++) ok = walkable(x, y, start.level);
        let grass = 0;
        for (let k = 0; k < G.length && ok; k++) {
          ok = walkable(tx + k, ty, start.level);
          if (ok && q.groundAt(tx + k, ty)?.terrain === G.terrain) grass++;
        }
        if (!ok || grass < G.needed) continue;
        const ex = tx * TILE + TILE / 2 + walk;
        const ey = ty * TILE + TILE / 2;
        if (!nothingToOffer(q, ex / TILE, ey / TILE)) continue;
        const w = G.sizeWeights;
        let score = G.feetWeight * tuftsNear(rule, ex, ey, push, stands, w) + tuftsNear(rule, ex, ey, G.aroundPx, stands, w);
        for (let s = G.trailStepPx; s <= G.trailPx; s += G.trailStepPx) score += tuftsNear(rule, ex - s, ey, push, stands, w);
        if (score > bestScore) {
          bestScore = score;
          best = { tx, ty };
        }
      }
    }
  }
  return best;
}

/**
 * An L-shaped path on ground `terrain` near `at`: `east` tiles eastwards from the start, then `south` tiles southwards,
 * all on one level, dry and free of blocking objects (the footprint trail: first leg east, second south).
 */
function trailPath(q: SurfaceWorldQuery, at: SurfaceTile, terrain: string, east: number, south: number): SurfaceTile | null {
  const free = (tx: number, ty: number, level: number): boolean => {
    const g = q.groundAt(tx, ty);
    const o = q.objectAt(tx, ty);
    return g !== null && o !== null && !g.water && g.level === level && g.terrain === terrain && (o === '' || o.startsWith('deko_'));
  };
  for (let r = 0; r <= SEARCH_RADIUS; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = at.tx + dx;
        const ty = at.ty + dy;
        const g = q.groundAt(tx, ty);
        if (g === null) continue;
        let ok = true;
        // One tile of margin around the path: the prints of both feet stay on the same ground.
        for (let k = -1; k <= east + 1 && ok; k++) for (let m = -1; m <= 1 && ok; m++) ok = free(tx + k, ty + m, g.level);
        for (let k = 0; k <= south + 1 && ok; k++) for (let m = -1; m <= 1 && ok; m++) ok = free(tx + east + m, ty + k, g.level);
        if (ok) return { tx, ty };
      }
    }
  }
  return null;
}

/** Tiles around the player kept free of objects and water: the interaction reaches 1.5 tiles from the feet. */
const CLEAR_RADIUS = 2;

/**
 * The tile nearest to `at` (ring by ring, a fixed order) with nothing in the interaction's reach: no object and no
 * water within `CLEAR_RADIUS` tiles, the neighbours open and on its level – no gathering or drinking marker covers the
 * picture (M5-64: "Sammeln: Wildblumen – trägt gerade nichts – komm zu seiner Zeit wieder" ran across half of
 * `winter-schnee`).
 */
function clearOf(q: SurfaceWorldQuery, at: SurfaceTile): SurfaceTile | null {
  const clear = (tx: number, ty: number): boolean => {
    const centre = q.groundAt(tx, ty);
    if (centre === null) return false;
    for (let dy = -CLEAR_RADIUS; dy <= CLEAR_RADIUS; dy++) {
      for (let dx = -CLEAR_RADIUS; dx <= CLEAR_RADIUS; dx++) {
        const g = q.groundAt(tx + dx, ty + dy);
        if (g === null || g.water || q.objectAt(tx + dx, ty + dy) !== '') return false;
        if (Math.max(Math.abs(dx), Math.abs(dy)) <= 1 && (g.solid || g.level !== centre.level)) return false;
      }
    }
    return true;
  };
  for (let r = 0; r <= SEARCH_RADIUS; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === r && clear(at.tx + dx, at.ty + dy)) return { tx: at.tx + dx, ty: at.ty + dy };
      }
    }
  }
  return null;
}

/** Whether the ground type `terrain` gathers puddles (`GROUND_SURFACE` of its footstep material). */
function puddleGround(terrain: string): boolean {
  const footstep = TERRAIN.find((t) => t.id === terrain)?.footstep ?? null;
  return footstep !== null && GROUND_SURFACE[footstep].puddles;
}

/** Puddle pixels (the terrain program's rule, mirrored) in the px box [x0, x1) × [y0, y1) on level `level`. */
function puddlePixels(q: SurfaceWorldQuery, fill: number, level: number, x0: number, y0: number, x1: number, y1: number): number {
  const W = SURFACE_PARAMS.wet;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const g = q.groundAt(Math.floor(x / TILE), Math.floor(y / TILE));
      const o = q.objectAt(Math.floor(x / TILE), Math.floor(y / TILE));
      if (g === null || g.water || g.level !== level || !puddleGround(g.terrain) || (o !== null && o !== '' && !o.startsWith('deko_'))) continue;
      if (puddleAt(fill, clusterNoise(x, y, W.puddleWavelengthPx, W.puddleWavelengthPx * 0.3, W.puddleCellPx, NOISE_SALT.puddle))) n++;
    }
  }
  return n;
}

/**
 * Where a torch-bearer stands on dry ground with a puddle in front of it (to the south: a light at height h mirrors
 * at its footprint + h – the hand's torch a little beside the figure's centre, the stake's above the tile's centre)
 * and a second puddle a few tiles west for the stake torch; the stake's tile is `stake`. A figure stands in the middle
 * of its tile (`player.spawn`).
 */
function puddleCamp(q: SurfaceWorldQuery, at: SurfaceTile, stake: { dx: number; dy: number }): SurfaceTile | null {
  const fill = q.last.puddles;
  const mirrored = (tx: number, ty: number, level: number): boolean => {
    const cx = tx * TILE + TILE / 2;
    const cy = ty * TILE + TILE / 2;
    return puddlePixels(q, fill, level, cx - 5, cy + 4, cx + 9, cy + 28) >= PUDDLE_MIRROR_PIXELS && puddlePixels(q, fill, level, cx - 6, cy - 8, cx + 7, cy + 3) === 0;
  };
  for (let r = 0; r <= SEARCH_RADIUS; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = at.tx + dx;
        const ty = at.ty + dy;
        const g = q.groundAt(tx, ty);
        const o = q.objectAt(tx, ty);
        if (g === null || g.water || (o !== '' && o !== null && !o.startsWith('deko_'))) continue;
        const sg = q.groundAt(tx + stake.dx, ty + stake.dy);
        const so = q.objectAt(tx + stake.dx, ty + stake.dy);
        if (sg === null || sg.water || sg.level !== g.level || so !== '') continue;
        if (mirrored(tx, ty, g.level) && mirrored(tx + stake.dx, ty + stake.dy, g.level)) return { tx, ty };
      }
    }
  }
  return null;
}

/** Puddle pixels the mirror image of a light needs below it (a streak of about 6 × 22 px). */
const PUDDLE_MIRROR_PIXELS = 40;

/** The torch on its stake of the rainy camp, relative to the player [tiles]. */
const PUDDLE_STAKE = { dx: -4, dy: 1 } as const;

function surfaceScenario(spec: Spec): SurfaceScenario {
  let render: SurfaceRender | null = null;
  let session: NonNullable<SurfaceContext['session']> | null = null;
  let freeze: ((s: number) => void) | null = null;
  let phase: 'welt' | 'ort' | 'skript' | 'ruhe' | 'fertig' = 'welt';
  let spot: SurfaceTile | null = null;
  let step = 0;
  let stepTicks = 0;
  let tick = 0;
  let waited = 0;
  let placeTries = 0;
  const advance = (n: number): void => {
    for (let i = 0; i < n; i++) (session as NonNullable<typeof session>).step();
    tick += n;
    freeze?.(START_TIME + tick / TICK_HZ);
  };
  return {
    name: spec.name,
    description: spec.description,
    settleFrames: SETTLE_FRAMES,
    setup(ctx) {
      const r = ctx.render;
      if (r === undefined || ctx.session === undefined) throw new Error(`Szenario ${spec.name} braucht Renderer und Sitzung`);
      render = r;
      session = ctx.session;
      freeze = (s) => ctx.freezeAt(s);
      phase = 'welt';
      step = 0;
      stepTicks = 0;
      tick = 0;
      waited = 0;
      placeTries = 0;
      r.startGameCamera({ kind: 'biom', biome: spec.biome });
      r.showScene('spiel');
      r.setDebugView('off');
      ctx.freezeAt(START_TIME);
    },
    ready() {
      if (render === null || session === null) return false;
      const s = session;
      switch (phase) {
        case 'welt':
          if (!render.sceneReady()) return false;
          {
            // The weather blends in over `weatherBlendMinutes`: set it early enough that it has settled at the picture's time.
            const settle = spec.settleMinutes ?? WEATHER_SETTLE_MINUTES;
            const start = (((spec.time.hour * 60 + spec.time.minute - settle) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
            if (spec.season !== undefined) s.command({ type: 'setSeason', season: spec.season });
            s.command({ type: 'setTime', hour: Math.floor(start / 60), minute: start % 60 });
            s.command({ type: 'setWeather', state: spec.weather });
            advance(1);
            s.command({ type: 'advanceTime', minutes: settle });
            advance(1);
          }
          phase = 'ort';
          return false;
        case 'ort': {
          const at = render.gameCamera();
          const q = surfaceWorldQuery();
          if (at === null || q === null || !render.sceneReady()) return false;
          spot = spec.place(q, at);
          if (spot === null) {
            // A search that needs more of the world than has streamed in asks again (the streaming goes on meanwhile).
            if (++placeTries < PLACE_FRAMES) return false;
            throw new Error(`Szenario ${spec.name}: kein passender Ort um (${at.tx}, ${at.ty})`);
          }
          s.command({ type: 'player.spawn', tx: spot.tx, ty: spot.ty, layer: spec.layer ?? 0 });
          advance(1);
          phase = 'skript';
          return false;
        }
        case 'skript': {
          const st = spec.script[step];
          if (st === undefined) {
            phase = 'ruhe';
            return false;
          }
          if ('wait' in st) {
            // Time passes without input (a transition of the picture ends, the figure comes to rest).
            const n = Math.min(TICKS_PER_FRAME, st.wait - stepTicks);
            advance(n);
            stepTicks += n;
            if (stepTicks >= st.wait) {
              stepTicks = 0;
              step++;
            }
            return false;
          }
          if ('settle' in st) {
            // The camera has reached the new place and every chunk in view is drawn.
            const cam = render.gameCamera();
            if (cam === null || cam.layer !== (spec.layer ?? 0) || !render.sceneReady()) {
              advance(1);
              return false;
            }
            step++;
            return false;
          }
          if ('commands' in st) {
            const p = s.state().player;
            const here = p === null ? (spot as SurfaceTile) : { tx: Math.floor(p.x / TILE), ty: Math.floor(p.y / TILE) };
            const q = surfaceWorldQuery();
            if (q === null) return false;
            q.layer = (render.gameCamera()?.layer ?? 0) as Layer;
            for (const cmd of st.commands(here, q)) s.command(cmd);
            advance(1);
            step++;
            return false;
          }
          if (stepTicks === 0) s.command({ type: 'player.move', dx: st.walk[0], dy: st.walk[1] });
          const n = Math.min(TICKS_PER_FRAME, st.ticks - stepTicks);
          advance(n);
          stepTicks += n;
          if (stepTicks >= st.ticks) {
            s.command({ type: 'player.move', dx: 0, dy: 0 });
            advance(1);
            stepTicks = 0;
            step++;
          }
          return false;
        }
        case 'ruhe':
          if (++waited < SETTLE_FRAMES || !render.sceneReady()) return false;
          phase = 'fertig';
          return false;
        case 'fertig':
          return render.sceneReady();
      }
    },
  };
}

/** The free tile nearest to (tx, ty) within `radius` tiles whose neighbours in `around` are free as well, or null. */
function freeSpot(q: SurfaceWorldQuery, tx: number, ty: number, radius: number, around: readonly (readonly [number, number])[]): SurfaceTile | null {
  for (let r = 0; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = tx + dx;
        const y = ty + dy;
        if (q.freeAt(x, y) && around.every(([ax, ay]) => q.freeAt(x + ax, y + ay))) return { tx: x, ty: y };
      }
    }
  }
  return null;
}

/** Where the cave scenario stands: beside a glowing mushroom, with room for the stake torch to the west. */
const CAVE_MUSHROOM = 'pflanze_leuchtpilz';
const CAVE_STAKE = { dx: -3, dy: 0 } as const;
const CAVE_SEARCH_TILES = 40;
/** Ticks the cave scenario waits after arriving (longer than the cover of a change of layer, `LAYER_TRANSITION_SECONDS`). */
const CAVE_ARRIVAL_TICKS = 2 * TICK_HZ;

/** The player to the free tile beside the nearest glowing mushroom (debug teleport in world px). */
function toTheMushrooms(here: SurfaceTile, q: SurfaceWorldQuery): unknown[] {
  const m = q.nearestObject(here.tx, here.ty, CAVE_MUSHROOM, CAVE_SEARCH_TILES);
  if (m === null) throw new Error(`Szenario hoehle-fackeln: kein ${CAVE_MUSHROOM} um (${here.tx}, ${here.ty}) auf Ebene ${q.layer}`);
  const spot = freeSpot(q, m.tx + 1, m.ty + 1, 4, [[CAVE_STAKE.dx, CAVE_STAKE.dy]]);
  if (spot === null) throw new Error(`Szenario hoehle-fackeln: kein freier Platz beim Leuchtpilz (${m.tx}, ${m.ty})`);
  return [{ type: 'player.teleport', x: spot.tx * TILE + TILE / 2, y: spot.ty * TILE + TILE / 2, layer: q.layer }];
}

/** Commands giving the player a burning torch in the off hand (hotbar slot 0 → off hand, lit). */
function torchInHand(): unknown[] {
  return [{ type: 'inventory.give', item: 'fackel', count: 1 }, { type: 'inventory.move', from: { bereich: 'schnellleiste', index: 0 }, to: equipmentRef('nebenhand') }, { type: 'light.toggle' }];
}

/** The world surface's screenshot scenarios. */
export function surfaceScenarios(): SurfaceScenario[] {
  return [
    surfaceScenario({
      name: 'gras-interaktiv',
      description:
        'M5-17/M5-69: Wind und interaktives Gras – ein windiger Sommermittag in den Dünen der Salzküste, der Spieler geht nach Osten mitten in den dichtesten Horst des Dünengrases nahe der Küste: um seine Füße neigen sich die Büschel weg und werden niedergedrückt, hinter ihm richten sie sich wieder auf; Strandhafer und Büsche lehnen sich in die Windrichtung des Wetters, Böen laufen über die Dünen; nichts in Reichweite, kein Marker',
      biome: 'salzkueste',
      season: 'sommer',
      time: { hour: 12, minute: 0 },
      weather: 'bewoelkt',
      // The walk ends in the densest clump of dune grass around the showcase (`GRASS_SPOT`).
      place: (q, at) => denseGrassRun(q, at),
      script: [{ walk: [1, 0], ticks: GRASS_SPOT.ticks }],
    }),
    surfaceScenario({
      name: 'kronen-dither',
      description:
        'M5-18: Blätterdach-Durchblick – der Spieler steht im Grünhain hinter einer breiten Eichenkrone; die Krone öffnet sich um ihn in einem Kreis, dessen Rand weltfest im Bayer-Muster ausfranst, Stamm und Schatten bleiben',
      biome: 'gruenhain',
      season: 'sommer',
      time: { hour: 11, minute: 0 },
      weather: 'klar',
      place: (q, at) => besideObject(q, at, 'baum_eiche', 0, -1),
      script: [],
    }),
    surfaceScenario({
      name: 'herbst',
      description:
        'M5-19: Jahreszeitenwechsel – der erste Herbstmorgen im Grünhain (Tag 1, 10:00): das Laub ist mitten im Übergang über zwei Tage, Baum für Baum, die hellen Blätter zuerst, von Sommergrün zu Herbstrot und -gold',
      biome: 'gruenhain',
      season: 'herbst',
      time: { hour: 10, minute: 0 },
      weather: 'klar',
      place: (_q, at) => at,
      script: [],
    }),
    surfaceScenario({
      name: 'winter-schnee',
      description:
        'M5-19: Der erste Schnee im Grünhain – ein klarer Wintermorgen, dann schneit es dreieinhalb Stunden: die weltfeste Schneemaske ist zu gut der Hälfte gewachsen und liegt in Clustern auf der Wiese (Vorderkante bläulich, Oberkante hell); Schneehauben auf den Kronen der Kiefern, auf Ästen, Felsoberseiten und Grasbüscheln; kahle Laubbäume; der Spieler steht auf freier Wiese ohne Ziel in Reichweite (M5-64: kein Markertext über dem Bild)',
      biome: 'gruenhain',
      season: 'winter',
      time: { hour: 13, minute: 0 },
      weather: 'klar',
      // Nothing in reach: no marker over the snow.
      place: (q, at) => clearOf(q, at),
      // The next morning (still bare: no snow has fallen), then snowfall until the cover is half grown.
      script: [
        { commands: () => [{ type: 'advanceTime', minutes: 21 * 60 }] },
        { commands: () => [{ type: 'setWeather', state: 'schnee' }] },
        { commands: () => [{ type: 'advanceTime', minutes: 210 }] },
      ],
    }),
    surfaceScenario({
      name: 'fussspuren',
      description:
        'M5-19: Fußspuren im Schnee des Frostkamms – eine Spur nach Osten ist eine Stunde alt und nur noch flach, die frische Spur nach Süden ist tief (blauer Schatten), beide weltfest',
      biome: 'frostkamm',
      time: { hour: 11, minute: 0 },
      weather: 'klar',
      // 70 ticks east ≈ 5 tiles, 60 ticks south ≈ 4.5 tiles, on snow all the way.
      place: (q, at) => trailPath(q, at, 'schnee', 6, 5),
      script: [
        { walk: [1, 0], ticks: 70 },
        { commands: () => [{ type: 'advanceTime', minutes: 60 }] },
        { walk: [0, 1], ticks: 60 },
      ],
    }),
    surfaceScenario({
      name: 'regen-nacht-pfuetzen',
      description:
        'M5-20: Regennacht im Grünhain nach zwei Stunden Regen – der Boden ist dunkel und nass, in den Senken stehen Pfützen, die den Himmel und die Flammen der Fackel in der Hand und der Fackel am Pfahl als gebrochene, im Regen zitternde Lichtstreifen spiegeln; Nässe glänzt im Fackelschein',
      biome: 'gruenhain',
      season: 'sommer',
      time: { hour: 23, minute: 0 },
      weather: 'regen',
      // Two hours of rain: the ground is soaked, the puddles have filled.
      settleMinutes: 120,
      place: (q, at) => puddleCamp(q, at, PUDDLE_STAKE),
      script: [{ commands: (here) => [...torchInHand(), { type: 'inventory.give', item: 'fackel', count: 1 }, { type: 'light.place', from: { bereich: 'schnellleiste', index: 0 }, tx: here.tx + PUDDLE_STAKE.dx, ty: here.ty + PUDDLE_STAKE.dy }] }],
    }),
    surfaceScenario({
      name: 'gruenhain-nacht',
      description:
        'M5-23: Klare Sommernacht im Grünhain – Glühwürmchen schweben pulsierend über der Wiese, kühles Mondlicht, der Spieler mit Fackel in einer warmen Lichtinsel',
      biome: 'gruenhain',
      season: 'sommer',
      time: { hour: 23, minute: 30 },
      weather: 'klar',
      place: (_q, at) => at,
      script: [{ commands: () => torchInHand() }],
    }),
    surfaceScenario({
      name: 'hoehle-fackeln',
      description:
        'M5-23: Die Wurzelhöhlen (Ebene −1) – Umgebungslicht ≈ 0, nur echte Lichtquellen zählen: die Fackel in der Hand, eine Fackel am Pfahl und das atmende Leuchten der Leuchtpilze; dazwischen tiefe Dunkelheit',
      biome: 'gruenhain',
      season: 'sommer',
      time: { hour: 12, minute: 0 },
      weather: 'klar',
      layer: -1,
      place: (_q, at) => at,
      script: [
        { settle: true },
        { commands: (here, q) => toTheMushrooms(here, q) },
        { settle: true },
        { commands: (here) => [...torchInHand(), { type: 'inventory.give', item: 'fackel', count: 1 }, { type: 'light.place', from: { bereich: 'schnellleiste', index: 0 }, tx: here.tx + CAVE_STAKE.dx, ty: here.ty + CAVE_STAKE.dy }] },
        // The picture's cover after the change of layer has faded (atmosphere & post, `layerTransition`).
        { wait: CAVE_ARRIVAL_TICKS },
      ],
    }),
    ...EFFECT_SCENE_IDS.map((id) => effectScenario(id)),
  ];
}

/** Descriptions of the effect scenarios (M5-24). */
const EFFECT_DESCRIPTIONS: Readonly<Record<(typeof EFFECT_SCENE_IDS)[number], string>> = {
  'shader-outline':
    'M5-24: Interaktions-Outline (final) – nachts auf einer Lichtung mit zwei Fackeln: Figur, Felsbrocken und Leuchtpilz in Reichweite tragen die 1-px-Outline in der Akzentfarbe, ein Glanz läuft weltfest diagonal an ihr entlang; die Figur halb hinter dem Busch nur um ihren sichtbaren Teil; unbeleuchtet, auch im Dunkeln lesbar',
  'shader-weissblitz':
    'M5-24: Weißblitz – Figur, gehende Figur, Fels und Busch oben ohne, unten im Trefferblitz: voll weiß und emissiv, in der Dämmerung so hell wie am Tag',
  'shader-palettentausch':
    'M5-24: Palettenwechsel-Effekte – Bäume gehen in die Verderbnis über, Felsen und Büsche vereisen, je zu 0, ¼, ½, ¾ und ganz: Pixel für Pixel in der Reihenfolge ihrer Rampenstufe (helle zuerst) und des Sprite-Seeds, nie als Überblendung; unten die Figur in vier Trachten-Zeilen',
  'shader-dither':
    'M5-24: Dither-Fades – Baum, Fels, Busch, brennende Fackel und Leuchtpilz zu 0, ¼, ½, ¾ und ganz ausgeblendet: das 4×4-Bayer-Muster hängt am Sprite (es flimmert nicht, wenn sich das Ding bewegt), keine Halbtransparenz',
};

/** Presentation time of the effect scenes (torches mid-flicker, the glint along the outline mid-run). */
const EFFECT_TIME = 1.7;

/** A screenshot scenario of an effect scene: the scene, frozen, the debugger off. */
function effectScenario(id: (typeof EFFECT_SCENE_IDS)[number]): SurfaceScenario {
  let render: SurfaceRender | null = null;
  return {
    name: id,
    description: EFFECT_DESCRIPTIONS[id],
    settleFrames: SETTLE_FRAMES,
    setup(ctx) {
      const r = ctx.render;
      if (r === undefined) throw new Error(`Szenario ${id} braucht den Renderer`);
      render = r;
      r.showScene(id);
      r.setDebugView('off');
      ctx.freezeAt(EFFECT_TIME);
    },
    ready: () => render?.sceneReady() ?? false,
  };
}
