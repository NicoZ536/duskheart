/**
 * The picture of strand A (M7-31; MASTERPROMPT §31.5): the game view on the session's world near the Grünhain showcase,
 * summer, 22:30 of a full-moon night, clear, quality "Hoch", the presentation clock frozen, HUD off.
 *
 * - `musizieren`: full-moon night on open meadow. Four firefly jars stand lit around the player – two in front, two behind
 *   to the sides (radius 3, faint green: the only light besides the moon) –, a swarm of fireflies hovers a few tiles off,
 *   the player plays the flute (`instrument.play`, the clip `musizieren` facing down), the net lies ready in the hotbar. The
 *   jars' light falls on the front and the flanks of the figure – the hand at the mouth, the flute, the notes rising
 *   (M7-114: one jar behind the player, who faced the swarm, left the pose a silhouette at the edge of its light).
 *
 * Only commands set the state up (season, clock, weather, spawn, items, building, fuelling, lighting, playing); the
 * simulation is read (`ScenarioSession.sim`) only to find the jars' lights. Registered in src/debug/scenarios.ts.
 */
import type { QualityLevel } from '../engine/settings';
import { MINUTES_PER_DAY } from '../engine/time';
import type { InventorySystem } from '../game/inventory/system';
import type { LightSystem } from '../game/light/system';
import type { Simulation } from '../game/sim';
import type { RenderSceneId } from '../render/scenes/ids';
import type { GameCameraStart } from '../render/world/gameScene';
import { daysUntilMoonPhase } from '../render/light/scenarios';
import { surfaceWorldQuery } from '../render/world/surfaceScene';
import { FULL_MOON_PHASE } from '../world/calendar';
import { TILE_PX } from '../world/model/coords';

interface KlangRender {
  showScene(id: RenderSceneId): void;
  setDebugView(name: string): void;
  sceneReady(): boolean;
  startGameCamera(start: GameCameraStart): void;
  gameCamera(): { layer: number; tx: number; ty: number } | null;
  setQuality?(level: QualityLevel | null): void;
}

interface KlangSession {
  command(raw: unknown): unknown;
  step(): void;
  state(): { readonly day: number };
  sim?(): Simulation;
}

interface KlangContext {
  freezeAt(seconds: number): void;
  readonly render?: KlangRender;
  readonly session?: KlangSession;
}

/** A scenario (shape of `Scenario`, src/debug/scenarios.ts). */
export interface KlangScenario {
  readonly name: string;
  readonly description: string;
  readonly settleFrames: number;
  setup(ctx: KlangContext): void;
  ready(): boolean;
}

const QUALITY: QualityLevel = 'high';
const START: GameCameraStart = { kind: 'biom', biome: 'gruenhain' };
/** Presentation time of the frozen picture [s]. */
const PICTURE_TIME = 3.2;
const SETTLE_FRAMES = 8;
/** How far from the camera the spot is searched [tiles]. */
const SEARCH_RADIUS = 30;
/**
 * Where the jars stand from the player's tile [tiles]: two in front (one column to each side, two rows down) and two
 * behind to the sides (two columns out, one row up) – each just beyond the hand's reach of 1,5 tiles (the nearest edge of
 * each is 1,58 tiles from the feet: no interaction marker on them). A jar's faint light falls off steeply (§12.1, about a
 * fifth of it at 2,2 tiles): one alone left the figure in the dark, four together light its front and its flanks (M7-114).
 */
const JARS: readonly (readonly [dx: number, dy: number])[] = [
  [-1, 2],
  [1, 2],
  [-2, -1],
  [2, -1],
];
/** Fireflies fuelled into each jar (`light.fuel`). */
const FIREFLIES_PER_JAR = 2;
/** The columns and rows the jars take, relative to the player's tile [tiles]. */
const JARS_LEFT = Math.min(...JARS.map(([dx]) => dx));
const JARS_RIGHT = Math.max(...JARS.map(([dx]) => dx));
const JARS_BACK = Math.min(...JARS.map(([, dy]) => dy));
const JARS_FRONT = Math.max(...JARS.map(([, dy]) => dy));
/** Tiles around the camera that must be resident before the search counts [tiles]. */
const VIEW_TILES = 8;
/**
 * Free tiles beyond the jars [tiles]: beside them, behind the back ones and in front of the front ones. The rectangle of
 * the jars and these margins holds every tile within the hand's reach (1,5 tiles from the feet to the edge of a tile):
 * what lies there would carry an interaction marker.
 */
const FREE_SIDE = 0;
const FREE_ABOVE = 1;
const FREE_BELOW = 0;
/**
 * Where a tree would reach over a jar or the figure with its crown [tiles]: the columns beside the jars and the rows in
 * front of the front ones. The Grünhain is a forest – a spot with all of them open is rare –, so the search takes the spot
 * with the fewest of them taken.
 */
const CROWN_SIDE = 1;
const CROWN_FRONT = 3;
/** Steps for the swarm to settle into its hover. */
const SWARM_STEPS = 30;

function slotOf(sim: Simulation, item: string): { bereich: 'schnellleiste' | 'inventar'; index: number } | null {
  const state = (sim.system('inventory') as InventorySystem).state;
  for (const bereich of ['schnellleiste', 'inventar'] as const) {
    const index = state[bereich].findIndex((s) => s?.item === item);
    if (index >= 0) return { bereich, index };
  }
  return null;
}

/**
 * A spot for the picture around (tx, ty) (rings outwards): grass under the player, and the tiles around the player and the
 * jars (`JARS`) free, dry and on one level – `FREE_SIDE` beside the jars, `FREE_ABOVE` behind the back ones, `FREE_BELOW`
 * in front of the front ones; nothing gatherable within the player's reach, so no interaction marker covers the picture.
 * Of these the first with the fewest tiles taken where a crown would cover the jars (`crownCover`); null while the view
 * streams in.
 */
function spot(tx: number, ty: number): { x: number; y: number } | null | undefined {
  const q = surfaceWorldQuery();
  if (q === null) return null;
  q.layer = 0;
  let best: { x: number; y: number } | undefined;
  let bestCovered = Number.POSITIVE_INFINITY;
  for (let r = 0; r <= SEARCH_RADIUS; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = tx + dx;
        const y = ty + dy;
        const g = q.groundAt(x, y);
        // The view's own tiles must have streamed in; farther out a tile not yet resident is no spot.
        if (g === null) {
          if (r <= VIEW_TILES) return null;
          continue;
        }
        if (g.terrain !== 'gras') continue;
        let ok = true;
        for (let yy = y + JARS_BACK - FREE_ABOVE; yy <= y + JARS_FRONT + FREE_BELOW && ok; yy++) {
          for (let xx = x + JARS_LEFT - FREE_SIDE; xx <= x + JARS_RIGHT + FREE_SIDE && ok; xx++) {
            const h = q.groundAt(xx, yy);
            ok = h !== null && q.freeAt(xx, yy) && h.level === g.level;
          }
        }
        if (!ok) continue;
        const covered = crownCover(q, x, y);
        if (covered < bestCovered) {
          best = { x, y };
          bestCovered = covered;
          if (covered === 0) return best;
        }
      }
    }
  }
  return best;
}

/** Tiles taken (not open ground) around the jars of the spot (x, y) where a tree would reach over them with its crown. */
function crownCover(q: NonNullable<ReturnType<typeof surfaceWorldQuery>>, x: number, y: number): number {
  let taken = 0;
  for (let yy = y + JARS_BACK; yy <= y + JARS_FRONT + CROWN_FRONT; yy++) {
    for (let xx = x + JARS_LEFT - CROWN_SIDE; xx <= x + JARS_RIGHT + CROWN_SIDE; xx++) if (!q.freeAt(xx, yy)) taken++;
  }
  return taken;
}

function musizierenScenario(): KlangScenario {
  let render: KlangRender | null = null;
  let session: KlangSession | null = null;
  let phase: 'welt' | 'aufbau' | 'schwarm' | 'fertig' = 'welt';
  let centre = { tx: 0, ty: 0 };
  let steps = 0;
  return {
    name: 'musizieren',
    description:
      'M7-31: Sommernacht 22:30 bei Vollmond auf der Grünhain-Wiese, klar, Qualität „Hoch“ – der Spieler spielt Flöte (Clip musizieren, von vorn) zwischen vier brennenden Glühwürmchengläsern, zwei vor, zwei seitlich hinter ihm (Radius 3, schwach grün: ihr Licht fällt auf Pose, Hände und Flöte – M7-114), ein Glühwürmchenschwarm schwebt einige Kacheln entfernt, der Kescher liegt in der Schnellleiste',
    settleFrames: SETTLE_FRAMES,
    setup(ctx) {
      const r = ctx.render;
      if (r === undefined || ctx.session?.sim === undefined || r.setQuality === undefined) throw new Error('Szenario musizieren braucht Renderer (mit Qualitätsstufen) und Sitzung mit Simulation');
      render = r;
      session = ctx.session;
      phase = 'welt';
      steps = 0;
      r.setQuality(QUALITY);
      r.startGameCamera(START);
      r.showScene('spiel');
      r.setDebugView('off');
      ctx.freezeAt(PICTURE_TIME);
    },
    ready() {
      const r = render;
      const s = session;
      if (r === null || s === null || s.sim === undefined || !r.sceneReady()) return false;
      const sim = s.sim();
      switch (phase) {
        case 'welt': {
          const at = r.gameCamera();
          if (at === null) return false;
          centre = { tx: at.tx, ty: at.ty };
          s.command({ type: 'setSeason', season: 'sommer' });
          s.step();
          // The full-moon night (the brightest: ambient 0,12, §12.1) – whole days ahead, then the evening.
          const days = daysUntilMoonPhase(s.state().day, FULL_MOON_PHASE);
          if (days > 0) s.command({ type: 'advanceTime', minutes: days * MINUTES_PER_DAY });
          s.command({ type: 'setTime', hour: 21, minute: 40 });
          s.command({ type: 'setWeather', state: 'klar' });
          s.command({ type: 'advanceTime', minutes: 50 });
          s.command({ type: 'player.spawn', tx: centre.tx, ty: centre.ty, layer: 0 });
          s.command({ type: 'debug.god', on: true });
          s.step();
          phase = 'aufbau';
          return false;
        }
        case 'aufbau': {
          const at = spot(centre.tx, centre.ty);
          if (at === null) return false;
          if (at === undefined) throw new Error(`Szenario musizieren: keine freie Wiese für Spieler und Gläser im Umkreis von ${SEARCH_RADIUS} Kacheln`);
          const px = at.x;
          const py = at.y;
          s.command({ type: 'creature.kill', radius: 24 });
          s.command({ type: 'player.teleport', x: (px + 0.5) * TILE_PX, y: (py + 0.5) * TILE_PX, layer: 0 });
          s.command({ type: 'inventory.give', item: 'floete', count: 1 });
          s.command({ type: 'inventory.give', item: 'netz', count: 1 });
          s.command({ type: 'inventory.give', item: 'gluehwuermchen', count: FIREFLIES_PER_JAR * JARS.length });
          s.command({ type: 'inventory.give', item: 'gluehwuermchenglas', count: JARS.length });
          s.step();
          // The jars (`JARS`), each fuelled with two fireflies and lit from the tile beside it towards the player's column
          // (fuelling and lighting need the hand's reach); then back to the player's spot.
          for (const [dx, dy] of JARS) {
            s.command({ type: 'build.place', part: 'gluehwuermchenglas', tx: px + dx, ty: py + dy });
            s.step();
          }
          for (const [dx, dy] of JARS) {
            s.command({ type: 'player.teleport', x: (px + dx - Math.sign(dx) + 0.5) * TILE_PX, y: (py + dy + 0.5) * TILE_PX, layer: 0 });
            s.step();
            const light = (sim.system('light') as LightSystem).lightAt(0, px + dx, py + dy);
            if (light === undefined) throw new Error(`Szenario musizieren: das Glühwürmchenglas bei (${dx}, ${dy}) steht nicht`);
            const fireflies = slotOf(sim, 'gluehwuermchen');
            if (fireflies === null) throw new Error('Szenario musizieren: keine Glühwürmchen');
            s.command({ type: 'light.fuel', light: light.id, from: fireflies, count: FIREFLIES_PER_JAR });
            s.step();
            s.command({ type: 'light.ignite', tx: px + dx, ty: py + dy });
            s.step();
            if ((sim.system('light') as LightSystem).lightAt(0, px + dx, py + dy)?.torch?.lit !== true) throw new Error(`Szenario musizieren: das Glühwürmchenglas bei (${dx}, ${dy}) brennt nicht`);
          }
          s.command({ type: 'player.teleport', x: (px + 0.5) * TILE_PX, y: (py + 0.5) * TILE_PX, layer: 0 });
          // The swarm hovers beyond the back left jar.
          s.command({ type: 'creature.spawn', creature: 'gluehwuermchen', count: 1, x: (px - 4.5) * TILE_PX, y: (py - 2) * TILE_PX, layer: 0 });
          s.step();
          const flute = slotOf(sim, 'floete');
          if (flute === null) throw new Error('Szenario musizieren: keine Flöte');
          // The aim (the cursor) rests between the front jars: the player faces down, the pose seen from the front.
          s.command({ type: 'player.aim', x: Math.round((px + 0.5) * TILE_PX), y: Math.round((py + JARS_FRONT + 0.5) * TILE_PX) });
          s.command({ type: 'instrument.play', from: flute, lied: 'lied_1' });
          s.step();
          phase = 'schwarm';
          return false;
        }
        case 'schwarm':
          s.step();
          if (++steps < SWARM_STEPS) return false;
          phase = 'fertig';
          return false;
        case 'fertig':
          return true;
      }
    },
  };
}

/** The pictures of strand A. */
export function klangScenarios(): KlangScenario[] {
  return [musizierenScenario()];
}
