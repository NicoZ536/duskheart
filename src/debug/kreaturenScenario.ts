/**
 * Screenshot scenario of the first creatures (M6-13, M6-27; MASTERPROMPT §20.1, §31.5, docs/ART.md §15):
 * `kreaturen-gruenhain` – Grünhain near its showcase at noon in clear weather: the player on the nearest spot with
 * nothing in its reach whose surroundings are open meadow on its level, around it two hares,
 * a roe deer and two quails, each on the tile the simulation stands it on nearest to its planned spot (their sprites
 * `kreatur_<id>` in the idle clip, y-sorted with the trees and grass of the meadow).
 *
 * Only commands set the state up (`setTime`, `setWeather`, `player.spawn`, `debug.god`, `creature.spawn` with explicit
 * places); the simulation steps exactly twice after the creatures appear, so none has walked off, and the wildlife of
 * the chunks is not seeded yet (that happens on the first world tick). The world is fixed, so the picture is the same
 * on every run. Registered in src/debug/scenarios.ts; stable once the view around the player is complete.
 */
import type { RenderSceneId } from '../render/scenes/ids';
import type { GameCameraStart } from '../render/world/gameScene';
import { surfaceWorldQuery, type SurfaceWorldQuery } from '../render/world/surfaceScene';
import { TILE_PX } from '../world/model/coords';
import { nothingInReach } from './biomScenarios';

/** Scenario name. */
export const CREATURES_SCENARIO = 'kreaturen-gruenhain';
/** Where the camera starts: Grünhain's showcase window (meadow, trees, grass). */
const START: GameCameraStart = { kind: 'biom', biome: 'gruenhain' };
/** Clock time of the picture: noon, the hares and quails are awake (`aktiv` Tag), short shadows. */
const TIME = { hour: 12, minute: 0 } as const;
/** Presentation time of the frozen picture [s] (idle breathing mid-cycle). */
const PICTURE_TIME = 0.4;
/** Frames until the picture counts as stable after the creatures appeared. */
const SETTLE_FRAMES = 8;
/** How far from the camera's tile the player's spot is looked for [tiles] (within the resident chunks around it). */
const SEARCH_TILES = 16;
/** Tiles south of a creature's spot that must be free too: a tree's crown reaches this far north of its trunk. */
const CROWN_TILES = 3;
/** Simulation steps after the creatures appear (their first thoughts; nobody walks off in two ticks). */
const STEPS_AFTER = 2;
/**
 * The creatures and their planned spots relative to the player [tiles]: grouped around it within the view (the view is
 * about 30 × 17 tiles), none on the player's tile.
 */
const CAST: readonly { readonly creature: string; readonly dx: number; readonly dy: number }[] = [
  { creature: 'hase', dx: 4, dy: -2 },
  { creature: 'hase', dx: 6, dy: 1 },
  { creature: 'reh', dx: -5, dy: 2 },
  { creature: 'wachtel', dx: 2, dy: 3 },
  { creature: 'wachtel', dx: 3, dy: 4 },
];

/** What the scenario needs of the renderer (`ScenarioRender`). */
interface ScenarioRenderPart {
  showScene(id: RenderSceneId): void;
  setDebugView(name: string): void;
  sceneReady(): boolean;
  startGameCamera(start: GameCameraStart): void;
  gameCamera(): { layer: number; tx: number; ty: number } | null;
}

/** What the scenario needs of its context (`ScenarioContext`). */
interface CreaturesScenarioContext {
  freezeAt(seconds: number): void;
  readonly render?: ScenarioRenderPart;
  readonly session?: { command(raw: unknown): unknown; step(): void };
}

/** A scenario (shape of `Scenario`, src/debug/scenarios.ts). */
export interface CreaturesScenario {
  readonly name: string;
  readonly description: string;
  readonly settleFrames: number;
  setup(ctx: CreaturesScenarioContext): void;
  ready(): boolean;
}

/**
 * Whether the player on (tx, ty) makes the picture: nothing in its reach (no hint over the picture), every creature's
 * planned spot open ground (dry, no rock, no object on it or on the tiles south of it whose crowns would hide it) on the
 * player's level; null while a chunk is not resident.
 */
function goodSpot(q: SurfaceWorldQuery, tx: number, ty: number): boolean | null {
  const reach = nothingInReach(q, tx, ty);
  if (reach !== true) return reach;
  const level = q.groundAt(tx, ty)?.level;
  for (const c of CAST) {
    const g = q.groundAt(tx + c.dx, ty + c.dy);
    if (g === null) return null;
    if (g.water || g.solid || g.level !== level) return false;
    // No object on the spot nor on the tiles south of it whose crown could hide the creature.
    for (let k = 0; k <= CROWN_TILES; k++) {
      const o = q.objectAt(tx + c.dx, ty + c.dy + k);
      if (o === null) return null;
      if (o !== '') return false;
    }
  }
  return true;
}

/** The spot nearest to (tx, ty) within `SEARCH_TILES` (ring by ring: deterministic); null while a chunk is missing. */
function pictureSpot(q: SurfaceWorldQuery, tx: number, ty: number): { tx: number; ty: number } | null {
  for (let r = 0; r <= SEARCH_TILES; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const good = goodSpot(q, tx + dx, ty + dy);
        if (good === null) return null;
        if (good) return { tx: tx + dx, ty: ty + dy };
      }
    }
  }
  throw new Error(`Szenario ${CREATURES_SCENARIO}: kein Platz für das Bild im Umkreis von ${SEARCH_TILES} Kacheln um (${tx}, ${ty})`);
}

/** The creature scenario of Grünhain. */
export function creaturesScenario(): CreaturesScenario {
  let render: ScenarioRenderPart | null = null;
  let session: NonNullable<CreaturesScenarioContext['session']> | null = null;
  let phase: 'welt' | 'ort' | 'tiere' | 'fertig' = 'welt';
  let steps = 0;
  let player = { tx: 0, ty: 0 };
  return {
    name: CREATURES_SCENARIO,
    description: 'M6-13/M6-27: die ersten Kreaturen in Grünhain um 12:00 bei klarem Wetter – zwei Hasen, ein Reh und zwei Wachteln um den Spieler, y-sortiert zwischen Gras und Bäumen',
    settleFrames: SETTLE_FRAMES,
    setup(ctx) {
      const r = ctx.render;
      if (r === undefined || ctx.session === undefined) throw new Error(`Szenario ${CREATURES_SCENARIO} braucht Renderer und Sitzung`);
      render = r;
      session = ctx.session;
      phase = 'welt';
      steps = 0;
      r.startGameCamera(START);
      r.showScene('spiel');
      r.setDebugView('off');
      ctx.freezeAt(PICTURE_TIME);
    },
    ready() {
      const r = render;
      const s = session;
      if (r === null || s === null || !r.sceneReady()) return false;
      switch (phase) {
        case 'welt': {
          if (r.gameCamera() === null) return false;
          s.command({ type: 'setTime', hour: TIME.hour, minute: TIME.minute });
          s.command({ type: 'setWeather', state: 'klar' });
          s.step();
          phase = 'ort';
          return false;
        }
        case 'ort': {
          const at = r.gameCamera();
          const q = surfaceWorldQuery();
          if (at === null || q === null) return false;
          q.layer = 0;
          const spot = pictureSpot(q, at.tx, at.ty);
          if (spot === null) return false;
          player = spot;
          s.command({ type: 'player.spawn', tx: spot.tx, ty: spot.ty, layer: 0 });
          s.command({ type: 'debug.god', on: true });
          s.step();
          phase = 'tiere';
          return false;
        }
        case 'tiere': {
          const q = surfaceWorldQuery();
          if (q === null) return false;
          if (steps === 0) {
            // The planned spots must be resident; the simulation stands each creature on the nearest tile it can stand on.
            if (CAST.some((c) => q.groundAt(player.tx + c.dx, player.ty + c.dy) === null)) return false;
            for (const c of CAST) {
              s.command({ type: 'creature.spawn', creature: c.creature, count: 1, x: (player.tx + c.dx + 0.5) * TILE_PX, y: (player.ty + c.dy + 0.5) * TILE_PX, layer: 0 });
            }
          }
          s.step();
          steps++;
          if (steps >= STEPS_AFTER) phase = 'fertig';
          return false;
        }
        case 'fertig':
          return true;
      }
    },
  };
}
