/**
 * The pictures of the natural wonders of M7-82 (MASTERPROMPT §21 "Naturwunder", §31.5; docs/SPIEL.md §18):
 * `ort-naturwunder-geysirfeld` and `ort-naturwunder-kristallbogen` – the game view on the session's world (seed 20260923,
 * medium) at the slot of that wonder (`LocationSlot.variant`; `ort-naturwunder` of src/debug/orteScenarios.ts shows the
 * Grünhain's ancient tree), at quality "Hoch", clear weather, the presentation clock frozen, HUD off (screenshot mode).
 *
 * - **Where:** the figure stands on the nearest tile from `from` (tiles from the middle of the stamped layout) with nothing in
 *   the interaction's reach (`nothingInReach` of the biome series) and no focus after a tick, else on the first such tile,
 *   else on the start of the search: between the two geysers of the geyser field, south of the crystal arch with the way
 *   beneath it in view. A `creature.kill` around the figure clears the guards and wanderers for a calm picture.
 * - **When:** in the season of the biome (the colour identity of docs/ART.md §5, as the biome series): the geyser field at
 *   noon in summer (white steam over the sulphur crust, the hot pools), the crystal arch at dusk in spring (its ridge glows
 *   cold against the warm sky).
 *
 * Only commands set the state up (season, clock, weather, spawn, god mode, kill); the simulation is read (`ScenarioSession.sim`)
 * only to find the slot and the interaction's focus. Registered in src/debug/scenarios.ts.
 */
import type { SeasonId } from '../content/balance';
import type { QualityLevel } from '../engine/settings';
import { InteractionSystem } from '../game/interaction/system';
import type { Simulation } from '../game/sim';
import type { RenderSceneId } from '../render/scenes/ids';
import type { GameCameraStart } from '../render/world/gameScene';
import { surfaceWorldQuery } from '../render/world/surfaceScene';
import type { PlacePlacement } from '../world/gen/places/types';
import { TILE_PX } from '../world/model/coords';
import { biomPictureMinute, nothingInReach } from './biomScenarios';

interface WunderRender {
  showScene(id: RenderSceneId): void;
  setDebugView(name: string): void;
  sceneReady(): boolean;
  startGameCamera(start: GameCameraStart): void;
  gameCamera(): { layer: number; tx: number; ty: number } | null;
  setQuality?(level: QualityLevel | null): void;
}

interface WunderSession {
  command(raw: unknown): unknown;
  step(): void;
  sim?(): Simulation;
}

interface WunderContext {
  freezeAt(seconds: number): void;
  readonly render?: WunderRender;
  readonly session?: WunderSession;
}

/** A scenario (shape of `Scenario`, src/debug/scenarios.ts). */
export interface WunderScenario {
  readonly name: string;
  readonly description: string;
  readonly settleFrames: number;
  setup(ctx: WunderContext): void;
  ready(): boolean;
}

const QUALITY: QualityLevel = 'high';
/** Presentation time of the frozen pictures [s] (as the place pictures: steam and glow mid-cycle). */
const PICTURE_TIME = 9.7;
const SETTLE_FRAMES = 8;
/** Minutes the clear weather is forced before the picture (as the biome series). */
const WEATHER_LEAD_MINUTES = 50;
const MINUTES_PER_HOUR = 60;
/** How far from `from` the figure's clear spot is searched [tiles]. */
const SEARCH_RADIUS = 6;
/** Radius of the kill that clears the place's guards and wanderers [tiles]. */
const CLEAR_RADIUS = 24;

interface WunderPicture {
  /** The slot variant (`LOCATION_RULES.naturwunder.variants`). */
  readonly variant: string;
  readonly season: SeasonId;
  readonly time: 'tag' | 'daemmerung';
  readonly look: string;
  /** Where the search for the figure's clear spot starts [tiles from the layout's middle]. */
  readonly from: { readonly dx: number; readonly dy: number };
}

const PICTURES: readonly WunderPicture[] = [
  {
    variant: 'geysirfeld',
    season: 'sommer',
    time: 'tag',
    look: 'das Geysirfeld im Aschenschlund: zwei Sinterkegel mit Dampfsäulen, heiße Sinterbecken, Dampfspalten in der Schwefelkruste, die Figur steht zwischen ihnen',
    from: { dx: 0, dy: 0 },
  },
  {
    variant: 'kristallbogen',
    season: 'fruehling',
    time: 'daemmerung',
    look: 'der Kristallbogen im Scherbenhain: zwei große Kristallscherben lehnen über dem Weg aneinander, Kristallnadeln ringsum, der Grat leuchtet kalt in der Dämmerung, die Figur steht davor',
    from: { dx: 0, dy: 3 },
  },
];

/** The placement of the natural wonder of `variant`: the first stamped wonder slot of that variant, or null. */
export function wonderPlacement(sim: Simulation, variant: string): PlacePlacement | null {
  const g = sim.world.generated;
  for (const p of g.placeLayouts) if (p.type === 'naturwunder' && g.locations[p.slot]?.variant === variant) return p;
  return null;
}

/** The command that moves the spawned figure onto tile (tx, ty) of the surface. */
function moveTo(tx: number, ty: number): unknown {
  return { type: 'player.teleport', x: (tx + 0.5) * TILE_PX, y: (ty + 0.5) * TILE_PX, layer: 0 };
}

function wunderScenario(p: WunderPicture): WunderScenario {
  const name = `ort-naturwunder-${p.variant}`;
  const description = `M7-82: ${p.time === 'tag' ? 'Tag, 12:00' : 'Dämmerung'}, klar, Qualität „Hoch“ – ${p.look}`;
  let render: WunderRender | null = null;
  let session: WunderSession | null = null;
  let phase: 'welt' | 'anflug' | 'probe' | 'platz' | 'ruhe' | 'fertig' = 'welt';
  let spots: { tx: number; ty: number }[] = [];
  let tried = 0;
  let start = { tx: 0, ty: 0 };
  return {
    name,
    description,
    settleFrames: SETTLE_FRAMES,
    setup(ctx) {
      const r = ctx.render;
      if (r === undefined || ctx.session?.sim === undefined || r.setQuality === undefined) throw new Error(`Szenario ${name} braucht Renderer (mit Qualitätsstufen) und Sitzung mit Simulation`);
      render = r;
      session = ctx.session;
      phase = 'welt';
      r.setQuality(QUALITY);
      r.startGameCamera({ kind: 'biom', biome: 'gruenhain' });
      r.showScene('spiel');
      r.setDebugView('off');
      ctx.freezeAt(PICTURE_TIME);
    },
    ready() {
      const r = render;
      const s = session;
      if (r === null || s === null || s.sim === undefined || !r.sceneReady()) return false;
      switch (phase) {
        case 'welt': {
          if (r.gameCamera() === null) return false;
          const placement = wonderPlacement(s.sim(), p.variant);
          if (placement === null) throw new Error(`Szenario ${name}: die Welt hat kein Naturwunder ${p.variant}`);
          start = { tx: placement.x0 + (placement.width >> 1) + p.from.dx, ty: placement.y0 + (placement.height >> 1) + p.from.dy };
          s.command({ type: 'setSeason', season: p.season });
          const lead = biomPictureMinute(p.season, p.time) - WEATHER_LEAD_MINUTES;
          s.command({ type: 'setTime', hour: Math.floor(lead / MINUTES_PER_HOUR), minute: lead % MINUTES_PER_HOUR });
          s.command({ type: 'setWeather', state: 'klar' });
          s.command({ type: 'advanceTime', minutes: WEATHER_LEAD_MINUTES });
          s.command({ type: 'player.spawn', tx: start.tx, ty: start.ty, layer: 0 });
          s.command({ type: 'debug.god', on: true });
          s.step();
          phase = 'anflug';
          return false;
        }
        case 'anflug': {
          // The view streams around the place; then the clear tiles around the start, ring by ring.
          const q = surfaceWorldQuery();
          if (q === null) return false;
          q.layer = 0;
          const found: { tx: number; ty: number }[] = [];
          for (let rad = 0; rad <= SEARCH_RADIUS; rad++) {
            for (let dy = -rad; dy <= rad; dy++) {
              for (let dx = -rad; dx <= rad; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
                const clear = nothingInReach(q, start.tx + dx, start.ty + dy);
                if (clear === null) return false;
                if (clear) found.push({ tx: start.tx + dx, ty: start.ty + dy });
              }
            }
          }
          spots = found;
          tried = 0;
          const at = spots[0] ?? start;
          s.command(moveTo(at.tx, at.ty));
          s.step();
          phase = spots.length > 0 ? 'probe' : 'platz';
          return false;
        }
        case 'probe': {
          // A spot where the interaction focuses nothing; the next one when it does, the first when none is free.
          const interaction = s.sim().systems.find((x) => x instanceof InteractionSystem);
          const focused = interaction instanceof InteractionSystem && interaction.focus.kind !== 'none';
          if (focused && tried + 1 < spots.length) {
            tried++;
            const at = spots[tried] as { tx: number; ty: number };
            s.command(moveTo(at.tx, at.ty));
            s.step();
            return false;
          }
          if (focused) {
            const at = spots[0] as { tx: number; ty: number };
            s.command(moveTo(at.tx, at.ty));
            s.step();
          }
          phase = 'platz';
          return false;
        }
        case 'platz':
          s.command({ type: 'creature.kill', radius: CLEAR_RADIUS });
          s.step();
          phase = 'ruhe';
          return false;
        case 'ruhe':
          phase = 'fertig';
          return false;
        case 'fertig':
          return true;
      }
    },
  };
}

/** The two natural wonder pictures of M7-82. */
export function naturwunderScenarios(): WunderScenario[] {
  return PICTURES.map(wunderScenario);
}
