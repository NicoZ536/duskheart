/**
 * The place pictures of M7 (M7-08, M7-09; MASTERPROMPT §21, §31.5; docs/SPIEL.md §18): `ort-<ortstyp>` for the ten place
 * types of strand B – the game view on the session's world (seed 20260923, medium) at the place of that type, preferably
 * in the Grünhain (else the first one the world has), at quality "Hoch", clear weather, the presentation clock frozen, HUD
 * off (screenshot mode).
 *
 * - **Where:** the middle of the place's stamped rectangle (the slot centre, kept walkable by the layouts, validator rule
 *   `orte`; the bridgehead of a bridge ruin); the player stands on the nearest tile within `SEARCH_RADIUS` that has nothing
 *   in the interaction's reach (`nothingInReach` of the biome series) and where the interaction finds no focus after a tick
 *   (the place's marks – tower, altar, note – and the beacon are use targets without a footprint: their use line would
 *   cross the picture), else on the first such tile, else on the centre. The place's guards rise when the player comes close (discovery) – a `creature.kill` around the player clears
 *   them for a calm picture.
 * - **When:** by day at 12:00 in the season of the place's biome (as the biome series); the shrine and the graveyard at
 *   dusk (the shrine's candles, the long shadows over the stones) and so the meteorite crater (the meteorite's veins glow
 *   cold in the warm dusk; at night the torch's island showed only the crater's middle).
 *
 * Only commands set the state up (season, day jump, clock, weather, spawn, god mode, kill, torch); the simulation is read
 * (`ScenarioSession.sim`) only to find the place and the interaction's focus.
 *
 * The world event pictures (M7-39, M7-40) `lumenregen`, `sonnenfinsternis` and `waldbrand` stand at the Grünhain's camera
 * start in summer: the event started from the console (`worldEvent.start`), the simulation run on for the event's script
 * (the shards fall, the eclipse darkens, the struck forest burns – the forest fire's last strike comes in the final ticks,
 * so its bolt stands in the picture). Registered in src/debug/scenarios.ts.
 */
import type { SeasonId } from '../content/balance';
import type { QualityLevel } from '../engine/settings';
import { equipmentRef } from '../game/items/slots';
import type { Simulation } from '../game/sim';
import { InteractionSystem } from '../game/interaction/system';
import { daysUntilMoonPhase } from '../render/light/scenarios';
import type { RenderSceneId } from '../render/scenes/ids';
import type { GameCameraStart } from '../render/world/gameScene';
import { surfaceWorldQuery } from '../render/world/surfaceScene';
import type { PlacePlacement } from '../world/gen/places/types';
import { biomPictureMinute, nothingInReach } from './biomScenarios';

interface OrtRender {
  showScene(id: RenderSceneId): void;
  setDebugView(name: string): void;
  sceneReady(): boolean;
  startGameCamera(start: GameCameraStart): void;
  gameCamera(): { layer: number; tx: number; ty: number } | null;
  setQuality?(level: QualityLevel | null): void;
}

interface OrtSession {
  command(raw: unknown): unknown;
  step(): void;
  state(): { readonly day: number };
  sim?(): Simulation;
}

interface OrtContext {
  freezeAt(seconds: number): void;
  readonly render?: OrtRender;
  readonly session?: OrtSession;
}

/** A scenario (shape of `Scenario`, src/debug/scenarios.ts). */
export interface OrtScenario {
  readonly name: string;
  readonly description: string;
  readonly settleFrames: number;
  setup(ctx: OrtContext): void;
  ready(): boolean;
}

const QUALITY: QualityLevel = 'high';
/** Presentation time of the frozen pictures [s] (flames mid-flicker, crowns mid-sway). */
const PICTURE_TIME = 9.7;
const SETTLE_FRAMES = 8;
/** Minutes the clear weather is forced before the picture (as the biome series). */
const WEATHER_LEAD_MINUTES = 50;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
/** How far from the place's centre the player's clear spot is searched [tiles]. */
const SEARCH_RADIUS = 6;
/** Radius of the kill that clears the place's guards [tiles] (a place disc and its marks). */
const CLEAR_RADIUS = 24;
/** Half-moon phases (world/calendar.ts). */
const HALF_MOON_PHASES = [2, 6] as const;
/** Season of a place's picture by its biome (the colour identity of docs/ART.md §5, as the biome series). */
const BIOME_SEASONS: Readonly<Record<string, SeasonId>> = {
  gruenhain: 'sommer',
  salzkueste: 'sommer',
  nebelmoor: 'herbst',
  frostkamm: 'winter',
  glutsand: 'sommer',
  aschenschlund: 'sommer',
  scherbenhain: 'fruehling',
};

type TimeOfDay = 'tag' | 'daemmerung' | 'nacht';

interface OrtPicture {
  readonly type: string;
  /** The task that made the place type (M7-08 or M7-09). */
  readonly task: 'M7-08' | 'M7-09';
  readonly time: TimeOfDay;
  readonly look: string;
  /**
   * Where the search for the figure's clear spot starts, in tiles from the place's centre (default: the centre). The beacon's
   * plaza starts south of the beacon: beside it the figure would focus it, and its use line would cross the picture.
   */
  readonly from?: { readonly dx: number; readonly dy: number };
}

/** The pictures: what each should show (§21, docs/SPIEL.md §18). */
const PICTURES: readonly OrtPicture[] = [
  {
    type: 'leuchtfeuer',
    task: 'M7-08',
    time: 'tag',
    look: 'die Leuchtfeuer-Stätte: Platz der Erbauer mit Säulenstümpfen, Geröll und der Truhe, die Straße führt hinein',
    from: { dx: 0, dy: 5 },
  },
  { type: 'aussichtsturm', task: 'M7-08', time: 'tag', look: 'der Aussichtsturm aus Erbauer-Stein mit Ziegeldach, davor die Aussichtsmarke und eine Holztruhe' },
  { type: 'gehoeft', task: 'M7-08', time: 'tag', look: 'das verlassene Gehöft: Mauerreste um den Erdboden, Heuballen, Brunnen, zerbrochener Karren, morscher Zaun, der Pfahl mit der Notiz' },
  { type: 'schrein', task: 'M7-08', time: 'daemmerung', look: 'der Schrein der Erbauer auf seinen Stufen, die goldene Sonne der Stele, die Kerzen brennen warm in der Dämmerung' },
  { type: 'naturwunder', task: 'M7-08', time: 'tag', look: 'der Uraltbaum: eine Eiche, die jede andere überragt, ihre Wurzeln brechen ringsum aus der Erde' },
  { type: 'buddelstelle', task: 'M7-09', time: 'tag', look: 'die Buddelstelle: ein Hügel lockerer Erde mit einem Kreuz heller Kiesel' },
  { type: 'eremitenhuette', task: 'M7-09', time: 'tag', look: 'die Eremitenhütte: Blockhütte unter bemoostem Strohdach, kalte Feuerstelle, der Pfahl mit der Notiz' },
  { type: 'brueckenruine', task: 'M7-09', time: 'tag', look: 'die Brückenruine: gebrochene Pfeiler am Brückenkopf, Geröll, eine beschlagene Truhe' },
  { type: 'friedhof', task: 'M7-09', time: 'daemmerung', look: 'der Erbauer-Friedhof: Reihen von Grabsteinen, der Obelisk mit der Inschrift, der rostige Eisenzaun' },
  {
    type: 'meteoritenkrater',
    task: 'M7-09',
    time: 'daemmerung',
    look: 'der Meteoritenkrater in der Dämmerung: Aschekrater im Ring nackter Erde, der Meteorit mit kalt leuchtenden Adern, Sternenerz ringsum',
  },
];

const TORCH_COMMANDS: readonly unknown[] = [
  { type: 'inventory.give', item: 'fackel', count: 1 },
  { type: 'inventory.move', from: { bereich: 'schnellleiste', index: 0 }, to: equipmentRef('nebenhand') },
  { type: 'light.toggle' },
];

/** The placement of `type` the picture shows: the first in the Grünhain, else the first of the world. */
export function picturePlacement(sim: Simulation, type: string): PlacePlacement | null {
  const g = sim.world.generated;
  let first: PlacePlacement | null = null;
  for (const p of g.placeLayouts) {
    if (p.type !== type) continue;
    if (g.locations[p.slot]?.biome === 'gruenhain') return p;
    first ??= p;
  }
  return first;
}

function ortScenario(p: OrtPicture): OrtScenario {
  const name = `ort-${p.type}`;
  const label = p.time === 'tag' ? 'Tag, 12:00' : p.time === 'daemmerung' ? 'Dämmerung' : 'Nacht bei Halbmond, mit Fackel';
  const description = `${p.task}: ${label}, klar, Qualität „Hoch“ – ${p.look}`;
  let render: OrtRender | null = null;
  let session: OrtSession | null = null;
  let phase: 'welt' | 'kalender' | 'anflug' | 'probe' | 'platz' | 'ruhe' | 'fertig' = 'welt';
  /** Clear tiles by distance from the search's start, and the one being tried. */
  let spots: { tx: number; ty: number }[] = [];
  let tried = 0;
  let centre = { tx: 0, ty: 0 };
  let season: SeasonId = 'sommer';
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
          const sim = s.sim();
          const placement = picturePlacement(sim, p.type);
          if (placement === null) throw new Error(`Szenario ${name}: die Welt hat keinen Ort ${p.type}`);
          const slot = sim.world.generated.locations[placement.slot];
          if (slot === undefined) throw new Error(`Szenario ${name}: Slot ${placement.slot} fehlt`);
          // The middle of the stamped rectangle: the slot centre for the places in their disc, the bridgehead for the bridge ruin.
          centre = { tx: placement.x0 + (placement.width >> 1), ty: placement.y0 + (placement.height >> 1) };
          season = BIOME_SEASONS[slot.biome] ?? 'sommer';
          s.command({ type: 'setSeason', season });
          s.step();
          phase = 'kalender';
          return false;
        }
        case 'kalender': {
          const minute = biomPictureMinute(season, p.time);
          if (p.time === 'nacht') {
            const k = Math.min(...HALF_MOON_PHASES.map((ph) => daysUntilMoonPhase(s.state().day, ph)));
            if (k > 0) s.command({ type: 'advanceTime', minutes: k * MINUTES_PER_DAY });
          }
          const lead = minute - WEATHER_LEAD_MINUTES;
          s.command({ type: 'setTime', hour: Math.floor(lead / MINUTES_PER_HOUR), minute: lead % MINUTES_PER_HOUR });
          s.command({ type: 'setWeather', state: 'klar' });
          s.command({ type: 'advanceTime', minutes: WEATHER_LEAD_MINUTES });
          s.command({ type: 'player.spawn', tx: centre.tx, ty: centre.ty, layer: 0 });
          s.command({ type: 'debug.god', on: true });
          s.step();
          phase = 'anflug';
          return false;
        }
        case 'anflug': {
          // The view streams around the place; then the clear tiles near the centre, ring by ring.
          const q = surfaceWorldQuery();
          if (q === null) return false;
          q.layer = 0;
          const found: { tx: number; ty: number }[] = [];
          for (let rad = 0; rad <= SEARCH_RADIUS; rad++) {
            for (let dy = -rad; dy <= rad; dy++) {
              for (let dx = -rad; dx <= rad; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
                const tx = centre.tx + (p.from?.dx ?? 0) + dx;
                const ty = centre.ty + (p.from?.dy ?? 0) + dy;
                const clear = nothingInReach(q, tx, ty);
                if (clear === null) return false;
                if (clear) found.push({ tx, ty });
              }
            }
          }
          spots = found;
          tried = 0;
          const at = spots[0] ?? centre;
          s.command({ type: 'player.spawn', tx: at.tx, ty: at.ty, layer: 0 });
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
            s.command({ type: 'player.spawn', tx: at.tx, ty: at.ty, layer: 0 });
            s.step();
            return false;
          }
          if (focused) {
            const at = spots[0] as { tx: number; ty: number };
            s.command({ type: 'player.spawn', tx: at.tx, ty: at.ty, layer: 0 });
            s.step();
          }
          phase = 'platz';
          return false;
        }
        case 'platz':
          s.command({ type: 'creature.kill', radius: CLEAR_RADIUS });
          if (p.time === 'nacht') for (const cmd of TORCH_COMMANDS) s.command(cmd);
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

// ---------------------------------------------------------------------------------------------
// The world event pictures (M7-39, M7-40): `lumenregen`, `sonnenfinsternis`, `waldbrand`
// ---------------------------------------------------------------------------------------------

/** One step of an event picture's script: commands, then simulation ticks. */
interface EreignisSchritt {
  readonly commands: readonly unknown[];
  readonly ticks: number;
}

interface EreignisPicture {
  readonly name: string;
  readonly task: 'M7-39' | 'M7-40';
  /** Clock of the picture's day (summer, Grünhain) before the script runs [h]. */
  readonly hour: number;
  readonly torch: boolean;
  readonly look: string;
  readonly script: readonly EreignisSchritt[];
}

/** Simulation ticks per second of the pictures' scripts (60 Hz). */
const TICKS_PER_SECOND = 60;
/** Most simulation ticks a script runs per rendered frame. */
const TICKS_PER_FRAME = 240;

/**
 * The event pictures: each at the Grünhain's camera start in summer, on the nearest clear tile, the event started from the
 * console and the simulation run on for its script; the presentation clock frozen as the place pictures'.
 */
const EVENT_PICTURES: readonly EreignisPicture[] = [
  {
    name: 'lumenregen',
    task: 'M7-39',
    hour: 23,
    torch: true,
    look: 'Lumenregen über dem Grünhain: Sternschnuppen kreuzen den Nachthimmel, glühende Scherben fallen und liegen kalt leuchtend im Gras, die Fackel als warme Insel',
    script: [{ commands: [{ type: 'worldEvent.start', event: 'lumenregen' }], ticks: 25 * TICKS_PER_SECOND }],
  },
  {
    name: 'sonnenfinsternis',
    task: 'M7-39',
    hour: 12,
    torch: true,
    look: 'Sonnenfinsternis am Mittag: eine Stunde Nacht mitten am Tag, kaltes, entsättigtes Licht, die Fackel brennt',
    script: [{ commands: [{ type: 'worldEvent.start', event: 'sonnenfinsternis' }], ticks: 15 * TICKS_PER_SECOND }],
  },
  {
    name: 'waldbrand',
    task: 'M7-40',
    hour: 14,
    torch: false,
    look: 'Waldbrand im Sommer: ein trockenes Gewitter, der Blitz schlägt in den Wald, Bäume brennen und das Feuer springt weiter, rauchiges Orange über allem',
    script: [
      {
        commands: [
          { type: 'setWeather', state: 'gewitter' },
          { type: 'worldEvent.start', event: 'waldbrand' },
          { type: 'lightning.strike', dx: 4, dy: -3 },
          { type: 'lightning.strike', dx: -5, dy: -2 },
        ],
        ticks: 50 * TICKS_PER_SECOND,
      },
      { commands: [{ type: 'lightning.strike', dx: 2, dy: -5 }], ticks: 4 },
    ],
  },
];

function ereignisScenario(p: EreignisPicture): OrtScenario {
  const description = `${p.task}: Grünhain, Sommer, ${String(p.hour).padStart(2, '0')}:00, Qualität „Hoch“ – ${p.look}`;
  let render: OrtRender | null = null;
  let session: OrtSession | null = null;
  let phase: 'welt' | 'kalender' | 'ort' | 'ereignis' | 'ruhe' | 'fertig' = 'welt';
  let schritt = 0;
  let getickt = 0;
  return {
    name: p.name,
    description,
    settleFrames: SETTLE_FRAMES,
    setup(ctx) {
      const r = ctx.render;
      if (r === undefined || ctx.session === undefined || r.setQuality === undefined) throw new Error(`Szenario ${p.name} braucht Renderer (mit Qualitätsstufen) und Sitzung`);
      render = r;
      session = ctx.session;
      phase = 'welt';
      schritt = 0;
      getickt = 0;
      r.setQuality(QUALITY);
      r.startGameCamera({ kind: 'biom', biome: 'gruenhain' });
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
          s.command({ type: 'setSeason', season: 'sommer' });
          s.step();
          phase = 'kalender';
          return false;
        }
        case 'kalender': {
          const lead = p.hour * MINUTES_PER_HOUR - WEATHER_LEAD_MINUTES;
          s.command({ type: 'setTime', hour: Math.floor(lead / MINUTES_PER_HOUR), minute: lead % MINUTES_PER_HOUR });
          s.command({ type: 'setWeather', state: 'klar' });
          s.command({ type: 'advanceTime', minutes: WEATHER_LEAD_MINUTES });
          s.step();
          phase = 'ort';
          return false;
        }
        case 'ort': {
          const at = r.gameCamera();
          const q = surfaceWorldQuery();
          if (at === null || q === null) return false;
          q.layer = 0;
          let spot: { tx: number; ty: number } | null = null;
          for (let rad = 0; rad <= SEARCH_RADIUS && spot === null; rad++) {
            for (let dy = -rad; dy <= rad && spot === null; dy++) {
              for (let dx = -rad; dx <= rad && spot === null; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
                const clear = nothingInReach(q, at.tx + dx, at.ty + dy);
                if (clear === null) return false;
                if (clear) spot = { tx: at.tx + dx, ty: at.ty + dy };
              }
            }
          }
          const where = spot ?? { tx: at.tx, ty: at.ty };
          s.command({ type: 'player.spawn', tx: where.tx, ty: where.ty, layer: 0 });
          s.command({ type: 'debug.god', on: true });
          if (p.torch) for (const cmd of TORCH_COMMANDS) s.command(cmd);
          s.step();
          phase = 'ereignis';
          return false;
        }
        case 'ereignis': {
          // The script: a step's commands, then its ticks – at most `TICKS_PER_FRAME` per frame (the page stays responsive).
          const step = p.script[schritt];
          if (step === undefined) {
            phase = 'ruhe';
            return false;
          }
          if (getickt === 0) for (const cmd of step.commands) s.command(cmd);
          const n = Math.min(TICKS_PER_FRAME, step.ticks - getickt);
          for (let t = 0; t < n; t++) s.step();
          getickt += n;
          if (getickt >= step.ticks) {
            schritt++;
            getickt = 0;
          }
          return false;
        }
        case 'ruhe':
          phase = 'fertig';
          return false;
        case 'fertig':
          return true;
      }
    },
  };
}

/** The place pictures, one per place type of strand B, and the world event pictures. */
export function orteScenarios(): OrtScenario[] {
  return [...PICTURES.map(ortScenario), ...EVENT_PICTURES.map(ereignisScenario)];
}
