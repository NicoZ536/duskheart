/**
 * The biome series of the M5 screenshot set (M5-29; MASTERPROMPT §31.5 "jedes Biom zu Tag/Dämmerung/Nacht"):
 * `biom-<id>-tag`, `biom-<id>-daemmerung`, `biom-<id>-nacht` for every surface biome of the world generator
 * (`BIOMES` with layer 0) – the game view on the session's world (seed 20260923, medium) in the biome's showcase window
 * (`showcase.ts`: height levels, cliffs, water, vegetation), with the whole M5 pipeline at quality "Hoch" (the
 * scenario's own level, the stored settings stay untouched), clear weather in every region, the presentation clock
 * frozen, HUD off (screenshot mode). The player stands on the open tile nearest to the showcase's centre with nothing
 * in reach (no object and no water within two tiles, the neighbours open and on its level; where no such tile lies
 * within eight tiles, only the neighbours clear): no interaction marker covers the land, and the view stays on the
 * showcase (farther away it would leave the biome's pure window – the Scherbenhain borders on the Glutsand). At dusk
 * and at night a torch burns in the off hand – the warm island in the cool dark of §4.1.
 *
 * - **Season** per biome (`BIOME_SEASONS`): the one its colour identity (docs/ART.md §5) is written for – summer for
 *   the Grünhain's full greens, the bright Saltcoast, the scorched Glutsand and the hot Aschenschlund; autumn for the
 *   desaturated Nebelmoor and the dying light of the Nachtherz; winter for the snow-covered Frostkamm; spring for the
 *   cool pastels of the Scherbenhain.
 * - **Clock** from the calendar of that season (`dayTimes`): the day at 12:00; the dusk 45 min after the season's
 *   sunset (spring/autumn 18:45, summer 20:15, winter 17:15 – the sun just below the horizon, daylight 0.68, the dusk
 *   grade at 0.87 of its peak, the land still readable); the night at 23:00 under a half moon (phase 2 or 6, whichever
 *   comes first: the three pictures of a biome share one calendar day).
 * - **Weather:** clear, forced in every region 50 min before the picture – its 45-minute blend has settled and the
 *   forced period (Klar lasts at least three hours) still runs.
 *
 * Only commands set the state up (season jump, day jump to the half moon, clock, weather, spawn, god mode, torch).
 * Registered in src/debug/scenarios.ts; stable once the view around the player is complete.
 */
import { BIOMES } from '../content/biomes';
import type { SeasonId } from '../content/balance';
import type { QualityLevel } from '../engine/settings';
import { equipmentRef } from '../game/items/slots';
import { daysUntilMoonPhase } from '../render/light/scenarios';
import type { RenderSceneId } from '../render/scenes/ids';
import type { GameCameraStart } from '../render/world/gameScene';
import { surfaceWorldQuery, type SurfaceWorldQuery } from '../render/world/surfaceScene';
import { dayTimes } from '../world/calendar';

/** What the scenarios need of the renderer (`ScenarioRender`). */
interface BiomRender {
  showScene(id: RenderSceneId): void;
  setDebugView(name: string): void;
  sceneReady(): boolean;
  startGameCamera(start: GameCameraStart): void;
  gameCamera(): { layer: number; tx: number; ty: number } | null;
  setQuality?(level: QualityLevel | null): void;
}

/** What the scenarios need of the session (`ScenarioSession`). */
interface BiomSession {
  command(raw: unknown): unknown;
  step(): void;
  state(): { readonly day: number };
}

/** What the scenarios need of their context (`ScenarioContext`). */
interface BiomContext {
  freezeAt(seconds: number): void;
  readonly render?: BiomRender;
  readonly session?: BiomSession;
}

/** A scenario (shape of `Scenario`, src/debug/scenarios.ts). */
export interface BiomScenario {
  readonly name: string;
  readonly description: string;
  readonly settleFrames: number;
  setup(ctx: BiomContext): void;
  ready(): boolean;
}

/** Quality level of the series (§6.3 "Hoch (Standard)"). */
const QUALITY: QualityLevel = 'high';
/** Presentation time of the frozen pictures [s] (flames mid-flicker, crowns mid-sway, water mid-wave). */
const PICTURE_TIME = 9.7;
/** Frames after the last step before the picture counts as stable (the camera has followed, the view streamed). */
const SETTLE_FRAMES = 8;
/** Minutes the clear weather is forced before the picture: longer than its 45-minute blend, shorter than any period. */
const WEATHER_LEAD_MINUTES = 50;
/** Minutes after the season's sunset of the dusk picture. */
const DUSK_AFTER_SUNSET_MINUTES = 45;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
/** Half-moon phases (world/calendar.ts: 0 Finstermond, 4 full moon; 2 waxing, 6 waning half). */
const HALF_MOON_PHASES = [2, 6] as const;
/**
 * Tiles around the player that must be clear, in the order tried: two (the interaction reach is 1.5 tiles from the feet
 * to a target's edge – nothing in reach), then one (only the neighbours clear).
 */
const CLEAR_RADII = [2, 1] as const;
/** How far from the showcase's centre the clear spot is searched [tiles]: the view (30 × 17 tiles) stays in the biome's window. */
const SEARCH_RADIUS = 8;

/** The season each surface biome is shown in (see the module comment). */
const BIOME_SEASONS: Readonly<Record<string, SeasonId>> = {
  gruenhain: 'sommer',
  salzkueste: 'sommer',
  nebelmoor: 'herbst',
  frostkamm: 'winter',
  glutsand: 'sommer',
  aschenschlund: 'sommer',
  scherbenhain: 'fruehling',
  nachtherz: 'herbst',
};

/** German names of the seasons (scenario descriptions are German like the rest of the list). */
const SEASON_NAMES: Readonly<Record<SeasonId, string>> = { fruehling: 'Frühling', sommer: 'Sommer', herbst: 'Herbst', winter: 'Winter' };

/** What each biome's pictures should show (docs/ART.md §5, colour identity and grading intent). */
const BIOME_LOOK: Readonly<Record<string, { readonly tag: string; readonly daemmerung: string; readonly nacht: string }>> = {
  gruenhain: {
    tag: 'warm-neutral, satte Grüns, weiche Kontraste, kurze Mittagsschatten nach Norden',
    daemmerung: 'orange-rosa Grading, die Fackel golden',
    nacht: 'kühles Blau mit violetten Schatten, Glühwürmchen, die Fackel als warme Insel',
  },
  salzkueste: {
    tag: 'hell und luftig, heller Sand mit türkisem Dünengras, Brandung',
    daemmerung: 'warmer Himmel im Wasser, Sand noch hell',
    nacht: 'marineblau, silbernes Mondlicht auf dem Wasser',
  },
  nebelmoor: {
    tag: 'entsättigt grünlich-grau, flacher Kontrast, nebelgraue Wiese mit petrolgrünen Halmen',
    daemmerung: 'gedämpfte Dämmerung, Lichter diffus',
    nacht: 'petrolschwarz, die Fackel diffus',
  },
  frostkamm: {
    tag: 'strahlendes Weiß, blaue Schatten, geringe Sättigung, Schnee auf Kronen und Felsen',
    daemmerung: 'kalte Dämmerung, die Fackel besonders warm',
    nacht: 'klar und stahlblau',
  },
  glutsand: {
    tag: 'gebleichte Lichter, warmgelbe Mitteltöne, harte Mittagskontraste',
    daemmerung: 'warmer Sand im letzten Licht',
    nacht: 'kalt-violett gekippt',
  },
  aschenschlund: {
    tag: 'dunkel und rauchig-entsättigt, Asche gegen Glut, Rot-Orange aus der Tiefe',
    daemmerung: 'Glut und Lava treten hervor',
    nacht: 'Glut und Lava tragen die Szene',
  },
  scherbenhain: {
    tag: 'kühl-pastellig, helle Lichter, Kristallfarben',
    daemmerung: 'pastellige Dämmerung, Kristalle leuchten auf',
    nacht: 'tiefviolett mit leuchtenden Kristallen',
  },
  nachtherz: {
    tag: 'stark entsättigt, dunkel-violett, schwere Vignette',
    daemmerung: 'die Verderbnis glüht auf',
    nacht: 'violett glühende Schatten, die Fackel kalt gegen das Dunkel',
  },
};

type TimeOfDay = 'tag' | 'daemmerung' | 'nacht';

/** A picture of the series. */
interface BiomPicture {
  readonly biome: string;
  readonly season: SeasonId;
  readonly time: TimeOfDay;
  readonly hour: number;
  readonly minute: number;
}

/** Clock minute of the day of `time` in `season` (day 12:00, dusk after the season's sunset, night 23:00). */
export function biomPictureMinute(season: SeasonId, time: TimeOfDay): number {
  switch (time) {
    case 'tag':
      return 12 * MINUTES_PER_HOUR;
    case 'daemmerung':
      return Math.round(dayTimes(season).sunset * MINUTES_PER_HOUR) + DUSK_AFTER_SUNSET_MINUTES;
    case 'nacht':
      return 23 * MINUTES_PER_HOUR;
  }
}

/** Days from night `day` until the next half moon. */
function daysUntilHalfMoon(day: number): number {
  return Math.min(...HALF_MOON_PHASES.map((p) => daysUntilMoonPhase(day, p)));
}

/**
 * Whether nothing around (tx, ty) would become the interaction focus: no object and no water (a drink target) within
 * `radius` tiles, and the neighbouring tiles open and on the player's level (not on a cliff edge); null while a chunk is
 * missing.
 */
function clearAround(q: SurfaceWorldQuery, tx: number, ty: number, radius: number): boolean | null {
  const centre = q.groundAt(tx, ty);
  if (centre === null) return null;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const g = q.groundAt(tx + dx, ty + dy);
      const o = q.objectAt(tx + dx, ty + dy);
      if (g === null || o === null) return null;
      if (o !== '' || g.water) return false;
      if (Math.max(Math.abs(dx), Math.abs(dy)) <= 1 && (g.solid || g.level !== centre.level)) return false;
    }
  }
  return true;
}

/**
 * The tile nearest to (tx, ty) that is clear within the first of `CLEAR_RADII` that any tile within `SEARCH_RADIUS`
 * satisfies, ring by ring (a fixed order: deterministic); null while a chunk of the search is not resident yet.
 */
function clearSpot(q: SurfaceWorldQuery, tx: number, ty: number): { tx: number; ty: number } | null {
  for (const radius of CLEAR_RADII) {
    for (let r = 0; r <= SEARCH_RADIUS; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const clear = clearAround(q, tx + dx, ty + dy, radius);
          if (clear === null) return null;
          if (clear) return { tx: tx + dx, ty: ty + dy };
        }
      }
    }
  }
  throw new Error(`Biom-Serie: kein freier Platz im Umkreis von ${SEARCH_RADIUS} Kacheln um (${tx}, ${ty})`);
}

/** A torch burning in the player's off hand (fresh session: it lands in hotbar slot 0). */
const TORCH_COMMANDS: readonly unknown[] = [
  { type: 'inventory.give', item: 'fackel', count: 1 },
  { type: 'inventory.move', from: { bereich: 'schnellleiste', index: 0 }, to: equipmentRef('nebenhand') },
  { type: 'light.toggle' },
];

function two(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function biomScenario(p: BiomPicture, biomeName: string): BiomScenario {
  const name = `biom-${p.biome}-${p.time}`;
  const look = BIOME_LOOK[p.biome]?.[p.time];
  if (look === undefined) throw new Error(`Szenario ${name}: keine Bildabsicht für Biom ${p.biome}`);
  const label = p.time === 'tag' ? 'Tag' : p.time === 'daemmerung' ? 'Dämmerung' : 'Nacht bei Halbmond';
  const kit = p.time === 'tag' ? '' : ', der Spieler mit Fackel';
  const description = `M5-29: ${biomeName} im ${SEASON_NAMES[p.season]} – ${label} um ${two(p.hour)}:${two(p.minute)}, klar, Qualität „Hoch“${kit}: ${look}`;
  let render: BiomRender | null = null;
  let session: BiomSession | null = null;
  let phase: 'welt' | 'kalender' | 'ort' | 'fackel' | 'warten' | 'fertig' = 'welt';
  return {
    name,
    description,
    settleFrames: SETTLE_FRAMES,
    setup(ctx) {
      const r = ctx.render;
      if (r === undefined || ctx.session === undefined || r.setQuality === undefined) throw new Error(`Szenario ${name} braucht Renderer (mit Qualitätsstufen) und Sitzung`);
      render = r;
      session = ctx.session;
      phase = 'welt';
      r.setQuality(QUALITY);
      r.startGameCamera({ kind: 'biom', biome: p.biome });
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
          const at = r.gameCamera();
          if (at === null) return false;
          s.command({ type: 'setSeason', season: p.season });
          s.step();
          phase = 'kalender';
          return false;
        }
        case 'kalender': {
          // 06:00 of the season's first day: jump whole days to the half-moon night, then to the clear weather's lead.
          const k = daysUntilHalfMoon(s.state().day);
          if (k > 0) s.command({ type: 'advanceTime', minutes: k * MINUTES_PER_DAY });
          const lead = p.hour * MINUTES_PER_HOUR + p.minute - WEATHER_LEAD_MINUTES;
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
          const spot = clearSpot(q, at.tx, at.ty);
          if (spot === null) return false;
          s.command({ type: 'player.spawn', tx: spot.tx, ty: spot.ty, layer: 0 });
          s.command({ type: 'debug.god', on: true });
          s.step();
          phase = 'fackel';
          return false;
        }
        case 'fackel':
          if (p.time !== 'tag') for (const cmd of TORCH_COMMANDS) s.command(cmd);
          s.step();
          phase = 'warten';
          return false;
        case 'warten':
          phase = 'fertig';
          return false;
        case 'fertig':
          return true;
      }
    },
  };
}

/** The biome series: three pictures for every surface biome, in the order of `BIOMES`. */
export function biomScenarios(): BiomScenario[] {
  const out: BiomScenario[] = [];
  for (const b of BIOMES) {
    if (b.layer !== 0) continue;
    const season = BIOME_SEASONS[b.id];
    if (season === undefined) throw new Error(`Biom-Serie: keine Jahreszeit für das Oberflächenbiom ${b.id} (BIOME_SEASONS)`);
    for (const time of ['tag', 'daemmerung', 'nacht'] as const) {
      const minute = biomPictureMinute(season, time);
      out.push(biomScenario({ biome: b.id, season, time, hour: Math.floor(minute / MINUTES_PER_HOUR), minute: minute % MINUTES_PER_HOUR }, b.name.de));
    }
  }
  return out;
}
