/**
 * Screenshot scenarios of the atmosphere and post effects (M5-10, M5-13 … M5-16, M5-22; MASTERPROMPT §31.5),
 * all in the game view on the session's world. Each sets up the place (a biome's showcase window or the
 * start beach), the clock time, the weather of the camera's region (forced an hour before the picture, so
 * its 45-minute blend is complete), the player (with a burning torch or the night camp of
 * `lightsSzenario.ts`) and – for effects without a command of the simulation – debug pins
 * (`PostOverrides`: low health, heat and cold stages, exhaustion, a region's corruption, a shock wave, the
 * transition cover, the CRT filter). Registered in src/debug/scenarios.ts; stable once the view around the
 * player is complete.
 *
 * - `nebel-nacht-fackel` (M5-10): Nebelmoor at 22:00 in fog – banks of mist in the moonlight, the camp's
 *   torches and fire glow in rings of scattered light.
 * - `nebel-tag-fackel` (M5-41): the same camp in the Nebelmoor's fog at noon – the point light adds softly over the
 *   daylight in the fog too (`pointOverDaylight`): no warm halo in the sunlit mist, as none on the ground beside it.
 * - `hitzeflimmern` (M5-10): Glutsand at 13:00 in a heat wave – rising patches of shimmer shift the rows.
 * - `bloom` (M5-13): the night camp on the start beach – flames and the brightest ground glow over.
 * - `schockwelle` (M5-13): Grünhain at 11:00 – a shock wave ring 57 px out from the player bends the ground.
 * - `daemmerung-gruenhain-1700` … `-2030` (M5-14): the same Grünhain spot through the evening; `-1845-roh`
 *   the same minute without grading.
 * - `effekt-furcht`, `-leben`, `-kaelte`, `-hitze`, `-erschoepfung`, `-gift`, `-rausch`, `-uebergang` (M5-15).
 * - `crt` (M5-16): Grünhain at dusk through the CRT filter.
 * - `verderbnis-voll`, `verderbnis-halb` (M5-22): Grünhain at dusk as fully and half corrupted land.
 */
import type { WeatherStateId } from '../../content/weather';
import { equipmentRef } from '../../game/items/slots';
import type { ScenarioRender } from '../runtime';
import type { GameCameraStart } from '../world/gameScene';
import { campCommands } from '../game/lightsSzenario';
import type { PostOverrides } from './overrides';

/** Frames after the setup before the picture counts as stable (the camera has followed, the view streamed). */
const SETTLE_FRAMES = 8;
/** Presentation time of the frozen pictures [s] (flames mid-flicker, fog mid-drift). */
const PICTURE_TIME = 1.3;
const TILE = 16;
/** Minutes the weather is forced before the picture (its blend takes 45). */
const WEATHER_LEAD_MINUTES = 60;

/** What the scenarios need of their context (`ScenarioContext`, src/debug/scenarios.ts). */
interface AtmosphereScenarioContext {
  freezeAt(seconds: number): void;
  readonly render?: ScenarioRender;
  readonly session?: { command(raw: unknown): unknown; step(): void; state?(): { readonly player: { readonly x: number; readonly y: number } | null } };
}

/** A scenario (shape of `Scenario`, src/debug/scenarios.ts). */
export interface AtmosphereScenario {
  readonly name: string;
  readonly description: string;
  readonly settleFrames: number;
  setup(ctx: AtmosphereScenarioContext): void;
  ready(): boolean;
}

/** What the player carries into the picture. */
type Kit = 'none' | 'torch' | 'camp';

interface Recipe {
  readonly start: GameCameraStart;
  readonly time: { readonly hour: number; readonly minute: number };
  readonly weather: WeatherStateId;
  readonly kit: Kit;
  /** Where the player spawns relative to the camera's tile [tiles] (clear of trees for a camp). */
  readonly spawn?: readonly [number, number];
  /** Commands once the player stands (conditions, fear). */
  readonly commands?: readonly unknown[];
  /** Debug pins, given the player's world position. */
  readonly pins?: (pins: PostOverrides, x: number, y: number) => void;
}

/** A torch burning in the player's off hand (the first steps of the night camp). */
const TORCH_COMMANDS: readonly unknown[] = [
  { type: 'inventory.give', item: 'fackel', count: 1 },
  { type: 'inventory.move', from: { bereich: 'schnellleiste', index: 0 }, to: equipmentRef('nebenhand') },
  { type: 'light.toggle' },
];

function scenario(name: string, description: string, recipe: Recipe): AtmosphereScenario {
  let render: ScenarioRender | null = null;
  let session: NonNullable<AtmosphereScenarioContext['session']> | null = null;
  let phase: 'welt' | 'spieler' | 'ausstattung' | 'fertig' = 'welt';
  return {
    name,
    description,
    settleFrames: SETTLE_FRAMES,
    setup(ctx) {
      const r = ctx.render;
      if (r === undefined || ctx.session === undefined || r.postDebug === undefined) throw new Error(`Szenario ${name} braucht Renderer (mit postDebug) und Sitzung`);
      render = r;
      session = ctx.session;
      phase = 'welt';
      r.postDebug().clear();
      r.startGameCamera(recipe.start);
      r.showScene('spiel');
      r.setDebugView('off');
      ctx.freezeAt(PICTURE_TIME);
    },
    ready() {
      if (render === null || session === null || !render.sceneReady()) return false;
      switch (phase) {
        case 'welt': {
          const at = render.gameCamera();
          if (at === null) return false;
          session.command({ type: 'setWeather', state: recipe.weather, tx: at.tx, ty: at.ty });
          session.command({ type: 'advanceTime', minutes: WEATHER_LEAD_MINUTES });
          session.command({ type: 'setTime', hour: recipe.time.hour, minute: recipe.time.minute });
          const [dx, dy] = recipe.spawn ?? [0, 0];
          session.command({ type: 'player.spawn', tx: at.tx + dx, ty: at.ty + dy, layer: at.layer });
          session.step();
          phase = 'spieler';
          return false;
        }
        case 'spieler': {
          const at = render.gameCamera();
          if (at === null) return false;
          const kit = recipe.kit === 'camp' ? campCommands(at.tx, at.ty) : recipe.kit === 'torch' ? TORCH_COMMANDS : [];
          for (const cmd of kit) session.command(cmd);
          for (const cmd of recipe.commands ?? []) session.command(cmd);
          session.step();
          phase = 'ausstattung';
          return false;
        }
        case 'ausstattung': {
          const p = session.state?.().player ?? null;
          const at = render.gameCamera();
          const x = p?.x ?? ((at?.tx ?? 0) + 0.5) * TILE;
          const y = p?.y ?? ((at?.ty ?? 0) + 0.5) * TILE;
          const pins = render.postDebug?.();
          if (pins !== undefined) recipe.pins?.(pins, x, y);
          phase = 'fertig';
          return false;
        }
        case 'fertig':
          return true;
      }
    },
  };
}

const GRUENHAIN: GameCameraStart = { kind: 'biom', biome: 'gruenhain' };
/** The Grünhain pictures' spot: a clearing north-west of the showcase's centre (no crown over the player). */
const GRUENHAIN_SPOT: readonly [number, number] = [-4, -4];
const BEACH: GameCameraStart = { kind: 'titel' };

/** The dusk series of M5-14: clock times from late afternoon into the night (spring: sunset 18:00, night from 20:00). */
const DUSK_SERIES: readonly (readonly [number, number])[] = [
  [17, 0],
  [18, 0],
  [18, 45],
  [19, 30],
  [20, 30],
];

function two(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** The atmosphere and post scenarios. */
export function atmosphereScenarios(): AtmosphereScenario[] {
  return [
    scenario(
      'nebel-nacht-fackel',
      'M5-10: Nebelmoor um 22:00 im Nebel – Nebelbänke aus drei driftenden Schichten im Mondlicht in feinen Bayer-Stufen, höheres Gelände ragt heraus; das Licht von Fackel, Lagerfeuer und Pfahlfackel streut im Nebel zu warmen Höfen (aus dem Lichtpuffer: es endet, wo das Licht endet)',
      { start: { kind: 'biom', biome: 'nebelmoor' }, time: { hour: 22, minute: 0 }, weather: 'nebel', kit: 'camp' },
    ),
    scenario(
      'nebel-tag-fackel',
      'M5-41: dasselbe Lager im Nebelmoor um 12:00 im Nebel – Lagerfeuer, Fackel in der Hand und Pfahlfackel streuen über dem Tageslicht kein Licht in den Nebel (Streulicht × pointOverDaylight wie in der Komposition): kein warmer Hof im mittäglichen Dunst, wie keiner auf dem Boden daneben',
      { start: { kind: 'biom', biome: 'nebelmoor' }, time: { hour: 12, minute: 0 }, weather: 'nebel', kit: 'camp' },
    ),
    scenario(
      'hitzeflimmern',
      'M5-10: Glutsand um 13:00 in einer Hitzewelle – aufsteigende Flimmerflecken verschieben Pixelzeilen seitlich (ganze Pixel), dazu die heiße Glutsand-Tönung',
      { start: { kind: 'biom', biome: 'glutsand' }, time: { hour: 13, minute: 0 }, weather: 'hitzewelle', kit: 'none' },
    ),
    scenario(
      'bloom',
      'M5-13: das Nachtlager am Startstrand (22:00) – Lagerfeuer, Fackel in der Hand und Pfahlfackel glühen über (Schwelle 1,3, vier Stufen ab halber interner Auflösung), der Schein bleibt in feinen Bayer-Stufen',
      { start: BEACH, time: { hour: 22, minute: 0 }, weather: 'klar', kit: 'camp', spawn: [-4, 0] },
    ),
    scenario(
      'schockwelle',
      'M5-13: Grünhain um 11:00 – ein Schockwellenring 57 px um den Spieler verbiegt Boden, Gras und Bäume in ganzen Pixeln (Verzerrungspuffer): eine dunkle Linse mit hellen Rändern, wo das Bild gestaucht und gedehnt wird',
      {
        start: GRUENHAIN,
        spawn: GRUENHAIN_SPOT,
        time: { hour: 11, minute: 0 },
        weather: 'klar',
        kit: 'none',
        pins: (o, x, y) => {
          o.shockwave = { x, y: y - 8, start: PICTURE_TIME - 0.3, period: 10, speed: 190, life: 1.2, width: 24, strength: 8 };
        },
      },
    ),
    ...DUSK_SERIES.map(([h, m]) =>
      scenario(
        `daemmerung-gruenhain-${two(h)}${two(m)}`,
        `M5-14: Grünhain um ${two(h)}:${two(m)}, klar, der Spieler mit Fackel – Color-Grading aus der 3D-LUT (Tag neutral → Dämmerung orange-rosa → Nacht kühles Blau mit violetten Schatten), weich überblendet`,
        { start: GRUENHAIN, spawn: GRUENHAIN_SPOT, time: { hour: h, minute: m }, weather: 'klar', kit: 'torch' },
      ),
    ),
    scenario('daemmerung-gruenhain-1845-roh', 'M5-14: derselbe Grünhain-Ort um 18:45 ohne Color-Grading (Vergleich zur Reihe)', {
      start: GRUENHAIN,
      spawn: GRUENHAIN_SPOT,
      time: { hour: 18, minute: 45 },
      weather: 'klar',
      kit: 'torch',
      pins: (o) => {
        o.grading = false;
      },
    }),
    scenario('effekt-furcht', 'M5-15: Furcht 90 (fear.set) in Grünhain um 18:00 – dunkle Ranken kriechen vom Bildrand herein und atmen, die Farben laufen aus (ab 60)', {
      start: GRUENHAIN,
      spawn: GRUENHAIN_SPOT,
      time: { hour: 18, minute: 0 },
      weather: 'klar',
      kit: 'torch',
      commands: [{ type: 'fear.set', value: 90 }],
    }),
    scenario('effekt-leben', 'M5-15: niedriges Leben (Anheftung 0,85) am Startstrand um 15:00 – dunkelroter Rand im Herzschlag (hier im Schlag festgehalten), die Farben laufen aus', {
      start: BEACH,
      time: { hour: 15, minute: 0 },
      weather: 'klar',
      kit: 'none',
      pins: (o) => o.set('hurt', 0.85),
    }),
    scenario('effekt-kaelte', 'M5-15: Kälte im Frostkamm um 12:00 (unterkühlt: Kältestich 0,65, Frostrand 0,55) – kalte Entsättigung, Eis kriecht in Fingern vom Rand', {
      start: { kind: 'biom', biome: 'frostkamm' },
      time: { hour: 12, minute: 0 },
      weather: 'klar',
      kit: 'none',
      pins: (o) => {
        o.set('cold', 0.65);
        o.set('frost', 0.55);
      },
    }),
    scenario('effekt-hitze', 'M5-15: Hitzschlag im Glutsand um 14:00 (Hitze 1) – warmer Stich, das ganze Bild flimmert in Zeilen', {
      start: { kind: 'biom', biome: 'glutsand' },
      time: { hour: 14, minute: 0 },
      weather: 'klar',
      kit: 'none',
      pins: (o) => o.set('heat', 1),
    }),
    scenario('effekt-erschoepfung', 'M5-15: Erschöpft am Startstrand um 16:00 – schwere Randabdunklung, die Lider halb geschlossen (0,4)', {
      start: BEACH,
      time: { hour: 16, minute: 0 },
      weather: 'klar',
      kit: 'none',
      pins: (o) => {
        o.set('tired', 0.75);
        o.set('lid', 0.4);
      },
    }),
    scenario('effekt-gift', 'M5-15: Vergiftung (conditions.apply) am Startstrand um 15:00 – fahlgrüner Rand, der langsam anschwillt, und ein flaues Schwanken des Bildes', {
      start: BEACH,
      time: { hour: 15, minute: 0 },
      weather: 'klar',
      kit: 'none',
      commands: [{ type: 'conditions.apply', id: 'vergiftung' }],
    }),
    scenario('effekt-rausch', 'M5-15: Beschwipst (conditions.apply) am Startstrand um 15:00 – das Bild schwimmt in langsamen Wellen, ein blasses Doppelbild driftet daneben', {
      start: BEACH,
      time: { hour: 15, minute: 0 },
      weather: 'klar',
      kit: 'none',
      commands: [{ type: 'conditions.apply', id: 'beschwipst' }],
    }),
    scenario('effekt-uebergang', 'M5-15: Bayer-Dither-Übergang zur Hälfte (Ebenenwechsel) – die Nacht deckt das Bild vom Rand her in 2 × 2-Zellen zu', {
      start: GRUENHAIN,
      spawn: GRUENHAIN_SPOT,
      time: { hour: 11, minute: 0 },
      weather: 'klar',
      kit: 'none',
      pins: (o) => o.set('transition', 0.5),
    }),
    scenario('crt', 'M5-16: optionaler CRT-Filter (Einstellung, standardmäßig aus; hier angeheftet) – Grünhain um 19:00: gewölbter Schirm, eine Scanline je interner Zeile, Streifenmaske, dunkle runde Ecken', {
      start: GRUENHAIN,
      spawn: GRUENHAIN_SPOT,
      time: { hour: 19, minute: 0 },
      weather: 'klar',
      kit: 'torch',
      pins: (o) => {
        o.crt = true;
      },
    }),
    scenario('verderbnis-voll', 'M5-22: volle Verderbnis in Grünhain um 18:30 – der Boden kippt in die Palettenzeile „verderbnis“ (dunkel-violett, fahl), emissive Adern pulsieren violett im flachen Boden, das Grading zieht mit; die Fackel bleibt warm', {
      start: GRUENHAIN,
      spawn: GRUENHAIN_SPOT,
      time: { hour: 18, minute: 30 },
      weather: 'klar',
      kit: 'torch',
      pins: (o) => o.set('corruption', 1),
    }),
    scenario('verderbnis-halb', 'M5-22: halbe Verderbnis am selben Ort – etwa die Hälfte des Landes in Flecken mit Bayer-Säumen verdorben, dünnere Adern, schwächeres Grading', {
      start: GRUENHAIN,
      spawn: GRUENHAIN_SPOT,
      time: { hour: 18, minute: 30 },
      weather: 'klar',
      kit: 'torch',
      pins: (o) => o.set('corruption', 0.5),
    }),
  ];
}
