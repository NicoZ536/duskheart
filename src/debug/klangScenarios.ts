/**
 * The picture of strand A (M7-31; MASTERPROMPT §31.5): the game view on the session's world near the Grünhain showcase,
 * summer, 22:30, clear, quality "Hoch", the presentation clock frozen, HUD off.
 *
 * - `musizieren`: night on open meadow. A firefly jar stands lit beside the player (radius 3, faint green: the only light
 *   besides the moon), a swarm of fireflies hovers a few tiles off, the player plays the flute (`instrument.play`; the body
 *   shows the clip `musizieren` once the atlas has it, the idle pose before), the net lies ready in the hotbar.
 *
 * Only commands set the state up (season, clock, weather, spawn, items, building, fuelling, lighting, playing); the
 * simulation is read (`ScenarioSession.sim`) only to find the jar's light. Registered in src/debug/scenarios.ts.
 */
import type { QualityLevel } from '../engine/settings';
import type { InventorySystem } from '../game/inventory/system';
import type { LightSystem } from '../game/light/system';
import type { Simulation } from '../game/sim';
import type { RenderSceneId } from '../render/scenes/ids';
import type { GameCameraStart } from '../render/world/gameScene';
import { surfaceWorldQuery } from '../render/world/surfaceScene';
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
/** The jar stands this many tiles right of the player (beyond the hand's reach of 1,5 tiles: no interaction marker on it) [tiles]. */
const JAR_DX = 3;
/** Tiles around the camera that must be resident before the search counts [tiles]. */
const VIEW_TILES = 8;
/** Free tiles around the player and the jar [tiles]. */
const FREE_SIDE = 1;
const FREE_ABOVE = 3;
const FREE_BELOW = 1;
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
 * jar `JAR_DX` to its right free, dry and on one level – `FREE_SIDE` to the sides, `FREE_ABOVE` above (no tree's crown hides the
 * jar), `FREE_BELOW` below; nothing gatherable within the player's reach, so no interaction marker covers the picture; null
 * while the view streams in.
 */
function spot(tx: number, ty: number): { x: number; y: number } | null | undefined {
  const q = surfaceWorldQuery();
  if (q === null) return null;
  q.layer = 0;
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
        for (let yy = y - FREE_ABOVE; yy <= y + FREE_BELOW && ok; yy++) {
          for (let xx = x - FREE_SIDE; xx <= x + JAR_DX + FREE_SIDE && ok; xx++) {
            const h = q.groundAt(xx, yy);
            ok = h !== null && q.freeAt(xx, yy) && h.level === g.level;
          }
        }
        if (ok) return { x, y };
      }
    }
  }
  return undefined;
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
      'M7-31: Sommernacht 22:30 auf der Grünhain-Wiese, klar, Qualität „Hoch“ – der Spieler spielt Flöte (Clip musizieren), neben ihm ein brennendes Glühwürmchenglas (Radius 3, schwach grün), ein Glühwürmchenschwarm schwebt einige Kacheln entfernt, der Kescher liegt in der Schnellleiste',
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
          if (at === undefined) throw new Error(`Szenario musizieren: keine freie Wiese für Spieler und Glas im Umkreis von ${SEARCH_RADIUS} Kacheln`);
          const px = at.x;
          const py = at.y;
          s.command({ type: 'creature.kill', radius: 24 });
          s.command({ type: 'player.teleport', x: (px + 0.5) * TILE_PX, y: (py + 0.5) * TILE_PX, layer: 0 });
          s.command({ type: 'inventory.give', item: 'floete', count: 1 });
          s.command({ type: 'inventory.give', item: 'netz', count: 1 });
          s.command({ type: 'inventory.give', item: 'gluehwuermchen', count: 2 });
          s.command({ type: 'inventory.give', item: 'gluehwuermchenglas', count: 1 });
          s.step();
          // The jar `JAR_DX` tiles right of the player, fuelled with two fireflies and lit.
          s.command({ type: 'build.place', part: 'gluehwuermchenglas', tx: px + JAR_DX, ty: py });
          s.step();
          const light = (sim.system('light') as LightSystem).lightAt(0, px + JAR_DX, py);
          if (light === undefined) throw new Error('Szenario musizieren: das Glühwürmchenglas steht nicht');
          const fireflies = slotOf(sim, 'gluehwuermchen');
          if (fireflies === null) throw new Error('Szenario musizieren: keine Glühwürmchen');
          // Fuelled and lit from beside it (both need the hand's reach), then back to the player's spot.
          s.command({ type: 'player.teleport', x: (px + JAR_DX - 0.5) * TILE_PX, y: (py + 0.5) * TILE_PX, layer: 0 });
          s.step();
          s.command({ type: 'light.fuel', light: light.id, from: fireflies, count: 2 });
          s.step();
          s.command({ type: 'light.ignite', tx: px + JAR_DX, ty: py });
          s.step();
          if ((sim.system('light') as LightSystem).lightAt(0, px + JAR_DX, py)?.torch?.lit !== true) throw new Error('Szenario musizieren: das Glühwürmchenglas brennt nicht');
          s.command({ type: 'player.teleport', x: (px + 0.5) * TILE_PX, y: (py + 0.5) * TILE_PX, layer: 0 });
          s.command({ type: 'creature.spawn', creature: 'gluehwuermchen', count: 1, x: (px - 2.5) * TILE_PX, y: (py - 1) * TILE_PX, layer: 0 });
          s.step();
          const flute = slotOf(sim, 'floete');
          if (flute === null) throw new Error('Szenario musizieren: keine Flöte');
          // The player looks towards the swarm (the hand's focus away from the jar: no interaction marker on it).
          s.command({ type: 'player.aim', x: Math.round((px - 3) * TILE_PX), y: Math.round((py - 1) * TILE_PX) });
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
