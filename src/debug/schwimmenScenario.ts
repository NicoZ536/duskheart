/**
 * Screenshot scenario `schwimmen` (M3-09, M3-37; MASTERPROMPT §11.4 "Schwimmen", §31.5): the player swims in
 * the deep water nearest to the Grünhain showcase at 10:00 – only the head and shoulders above the surface,
 * a ring of ripples around them, the bank with its turquoise shallows beside them. The swimmer has turned
 * towards the viewer; the tile ahead is fresh water, so the marker offers "[E] Trinken: Süßwasser" (lifted
 * above the swimmer's head, §4.6).
 *
 * Only commands set the state up (the scenario reads the session's debug state, not the world): the player
 * spawns at the camera's tile, then the scenario tries the tiles around it ring by ring (nearest first, a
 * fixed order) with `player.teleport` and one simulation step each, until the player swims – the first deep
 * water tile, so the shore stays in the picture. One tick of walking south turns the swimmer to the viewer.
 * The world and the probe order are fixed, so the picture is the same on every run. Registered in
 * src/debug/scenarios.ts; stable once the view around the swimmer is complete.
 */
import type { SessionDebugState } from '../game/session';
import type { GameCameraStart } from '../render/world/gameScene';
import type { RenderSceneId } from '../render/scenes/ids';
import { TILE_PX } from '../world/model/coords';

/** Name of the scenario. */
export const SWIM_SCENARIO = 'schwimmen';
/** Where the camera starts: the Grünhain showcase (river and lake with deep water, fresh water to drink). */
const START: GameCameraStart = { kind: 'biom', biome: 'gruenhain' };
/** Clock time of the picture: bright morning light. */
const TIME = { hour: 10, minute: 0 } as const;
/** Presentation time of the frozen picture [s] (ripple ring and water animation mid-cycle). */
const PICTURE_TIME = 1.3;
/** Frames until the picture counts as stable after the swimmer is in place. */
const SETTLE_FRAMES = 6;
/** Largest distance from the camera's tile searched for deep water [tiles]. */
const SEARCH_RADIUS = 20;
/** Probes per rendered frame (each is a teleport and one simulation step). */
const PROBES_PER_FRAME = 24;

/** What the scenario needs of the renderer (`ScenarioRender`). */
interface ScenarioRenderPart {
  showScene(id: RenderSceneId): void;
  setDebugView(name: string): void;
  sceneReady(): boolean;
  startGameCamera(start: GameCameraStart): void;
  gameCamera(): { layer: number; tx: number; ty: number } | null;
}

/** What the scenario needs of its context (`ScenarioContext`). */
interface SwimScenarioContext {
  freezeAt(seconds: number): void;
  readonly render?: ScenarioRenderPart;
  readonly session?: { command(raw: unknown): unknown; step(): void; state?(): SessionDebugState };
}

/**
 * Tile offsets around a centre, ring by ring (Chebyshev distance 1 … `radius`), each ring clockwise from its
 * top-left corner, sorted by Euclidean distance within the ring (nearest water first, a fixed order).
 */
export function probeOrder(radius: number): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [];
  for (let r = 1; r <= radius; r++) {
    const ring: Array<readonly [number, number]> = [];
    for (let dx = -r; dx <= r; dx++) ring.push([dx, -r]);
    for (let dy = -r + 1; dy <= r; dy++) ring.push([r, dy]);
    for (let dx = r - 1; dx >= -r; dx--) ring.push([dx, r]);
    for (let dy = r - 1; dy > -r; dy--) ring.push([-r, dy]);
    ring.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
    out.push(...ring);
  }
  return out;
}

/** The scenario (shape of `Scenario`, src/debug/scenarios.ts). */
export function swimScenario(): {
  readonly name: string;
  readonly description: string;
  readonly settleFrames: number;
  setup(ctx: SwimScenarioContext): void;
  ready(): boolean;
} {
  const order = probeOrder(SEARCH_RADIUS);
  let render: ScenarioRenderPart | null = null;
  let session: NonNullable<SwimScenarioContext['session']> | null = null;
  let phase: 'welt' | 'suchen' | 'drehen' | 'fertig' = 'welt';
  let centre = { tx: 0, ty: 0, layer: 0 };
  let next = 0;
  return {
    name: SWIM_SCENARIO,
    description:
      'M3-09/M3-37: Schwimmen – der Spieler im tiefen Wasser nächst dem Grünhain-Schaufenster um 10:00: nur Kopf und Schultern über der Oberfläche, ein Wellenring um ihn, daneben das Ufer mit türkiser Flachwasserbank; zum Betrachter gewandt, der Marker „[E] Trinken: Süßwasser“ über seinem Kopf',
    settleFrames: SETTLE_FRAMES,
    setup(ctx) {
      const r = ctx.render;
      if (r === undefined || ctx.session === undefined) throw new Error(`Szenario ${SWIM_SCENARIO} braucht Renderer und Sitzung`);
      render = r;
      session = ctx.session;
      phase = 'welt';
      next = 0;
      r.startGameCamera(START);
      r.showScene('spiel');
      r.setDebugView('off');
      ctx.freezeAt(PICTURE_TIME);
    },
    ready() {
      if (render === null || session === null || !render.sceneReady()) return false;
      const read = session.state;
      if (read === undefined) throw new Error(`Szenario ${SWIM_SCENARIO} braucht den Zustand der Sitzung`);
      switch (phase) {
        case 'welt': {
          const at = render.gameCamera();
          if (at === null) return false;
          centre = at;
          session.command({ type: 'setTime', hour: TIME.hour, minute: TIME.minute });
          session.command({ type: 'player.spawn', tx: at.tx, ty: at.ty, layer: at.layer });
          session.step();
          phase = 'suchen';
          return false;
        }
        case 'suchen':
          for (let k = 0; k < PROBES_PER_FRAME; k++) {
            const offset = order[next++];
            if (offset === undefined) throw new Error(`Szenario ${SWIM_SCENARIO}: kein tiefes Wasser im Umkreis von ${SEARCH_RADIUS} Kacheln`);
            const x = (centre.tx + offset[0] + 0.5) * TILE_PX;
            const y = (centre.ty + offset[1] + 0.5) * TILE_PX;
            session.command({ type: 'player.teleport', x, y, layer: centre.layer });
            session.step();
            if (read.call(session).player?.swimming === true) {
              phase = 'drehen';
              return false;
            }
          }
          return false;
        case 'drehen':
          // One tick of swimming south turns the swimmer to the viewer; then still water.
          session.command({ type: 'player.move', dx: 0, dy: 1 });
          session.step();
          session.command({ type: 'player.move', dx: 0, dy: 0 });
          session.step();
          if (read.call(session).player?.swimming !== true) throw new Error(`Szenario ${SWIM_SCENARIO}: der Spieler schwimmt nach dem Drehen nicht mehr`);
          phase = 'fertig';
          return false;
        case 'fertig':
          return true;
      }
    },
  };
}
