/**
 * Screenshot and bench scenarios of the quality strand (MASTERPROMPT §31.5; M5-25, M5-27, M5-30), registered in
 * src/debug/scenarios.ts:
 *
 * - `qualitaet-niedrig`, `-mittel`, `-hoch`, `-ultra` (M5-25): one and the same picture at each §6.3 level – a clear
 *   full-moon night at the Grünhain showcase's lake, a camp fire and a torch on its stake by the cliff, the player
 *   with a torch. What changes: the point lights' shadows (Niedrig only walls and cliffs, Mittel hard, Hoch and Ultra
 *   soft), the water (Niedrig simplified, Mittel without reflection – no moon, no stars in the lake –, Hoch and Ultra
 *   full), sparks, smoke and fireflies (reduced on Niedrig), particle light on Ultra. The level is the scenario's own
 *   (`ScenarioRender.setQuality`), the stored settings stay untouched.
 * - `hoch-gruenhain-nacht` (M5-30): the same night camp at "Hoch" – the bench scenario of §30's budgets (frame CPU,
 *   render preparation, draw calls).
 * - `debug-albedo`, `debug-normalen`, `debug-hoehe`, `debug-emissiv`, `debug-sonnenschatten`, `debug-licht`,
 *   `debug-gi`, `debug-lichtkarte` (M5-27): the render debugger's buffers on the Grünhain showcase at 17:30 – low sun,
 *   long silhouette shadows, the camp fire and the torches already burning; the light map as its sources' comparison
 *   (the view with ambient differs at dusk by design); `debug-sdf` is the light strand's. `debug-naesse` on the rainy
 *   night with puddles (`regen-nacht-pfuetzen`), `debug-nebel` on the foggy moor (`nebel-nacht-fackel`): each buffer
 *   where it has something to show. The debugger's caption names the buffer in every picture.
 */
import type { QualityLevel } from '../../engine/settings';
import { GI_DEBUG_VIEW } from '../debug/giSlot';
import { LIGHTMAP_SOURCES_VIEW } from '../debug/lightmapPass';
import type { lightScenarios } from '../game/lightsSzenario';
import { skyScenario, type SkyPicture } from '../light/scenarios';
import { atmosphereScenarios } from '../post/scenarios';
import { surfaceScenarios } from '../surface/scenarios';

/** The shape of a scenario (`Scenario`, src/debug/scenarios.ts), over the context `C` its setup reads. */
export interface ScenarioLike<C> {
  readonly name: string;
  readonly description: string;
  readonly settleFrames: number;
  setup(ctx: C): void;
  ready?(): boolean;
}

/** The context of a scenario setup, as each of the wrapped strands' scenarios reads it (the page's `ScenarioContext` is all of them). */
type SetupContext<F extends () => ReadonlyArray<{ setup(ctx: never): void }>> = Parameters<ReturnType<F>[number]['setup']>[0];
export type QualityScenarioContext = SetupContext<typeof lightScenarios> &
  SetupContext<typeof atmosphereScenarios> &
  SetupContext<typeof surfaceScenarios> &
  Parameters<ReturnType<typeof skyScenario>['setup']>[0] & { readonly render?: QualityScenarioRender };

/** What the wrappers need of the renderer (`ScenarioRender`). */
interface QualityScenarioRender {
  setDebugView(name: string): void;
  setQuality?(level: QualityLevel | null): void;
}

/** Frames the debugger's buffer is drawn before a picture of it counts as stable (the view's pass draws in the next frame). */
const VIEW_SETTLE_FRAMES = 3;

/** `base` rendered at quality `level` (the scenario's own; the stored settings stay untouched). */
export function atQuality<C extends { readonly render?: QualityScenarioRender }>(base: ScenarioLike<C>, name: string, description: string, level: QualityLevel): ScenarioLike<C> {
  return {
    name,
    description,
    settleFrames: base.settleFrames,
    setup(ctx) {
      const set = ctx.render?.setQuality;
      if (ctx.render === undefined || set === undefined) throw new Error(`Szenario ${name} braucht den Renderer mit Qualitätsstufen (ScenarioRender.setQuality)`);
      set.call(ctx.render, level);
      base.setup(ctx);
    },
    ready: () => base.ready?.() ?? true,
  };
}

/** `base` through the render debugger's buffer `view`, switched on once the picture stands. */
export function throughDebugView<C extends { readonly render?: QualityScenarioRender }>(base: ScenarioLike<C>, name: string, description: string, view: string): ScenarioLike<C> {
  let render: QualityScenarioRender | null = null;
  let shown = -1;
  return {
    name,
    description,
    settleFrames: base.settleFrames,
    setup(ctx) {
      if (ctx.render === undefined) throw new Error(`Szenario ${name} braucht den Renderer`);
      render = ctx.render;
      shown = -1;
      base.setup(ctx);
    },
    ready() {
      if (render === null || !(base.ready?.() ?? true)) return false;
      if (shown < 0) {
        render.setDebugView(view);
        shown = 0;
      }
      return ++shown > VIEW_SETTLE_FRAMES;
    },
  };
}

/** The night camp of the level comparison and the bench (a clear full-moon night, camp fire and torches by the lake). */
function nightCamp(name: string, description: string): SkyPicture {
  return { name, description, hour: 23, minute: 30, weather: 'klar', moon: 'voll', camp: true };
}

/** The level comparison (M5-25): name, level, what the level changes in the picture. */
const LEVEL_PICTURES: ReadonlyArray<readonly [string, QualityLevel, string]> = [
  [
    'qualitaet-niedrig',
    'low',
    'M5-25: Qualitätsstufe „Niedrig“ – dasselbe Nachtlager am See: 32 Punktlichter, Schatten nur von Sonne und Mond (Punktlichter sperren nur Wände und Klippen), Wasser vereinfacht (keine Spiegelung, keine Brechung), halb so viele Funken, Rauchwölkchen und Glühwürmchen',
  ],
  [
    'qualitaet-mittel',
    'medium',
    'M5-25: Qualitätsstufe „Mittel“ – 64 Punktlichter, harte SDF-Schatten der Stämme und Felsen im Feuerschein, Wasser voll ohne Spiegelung (kein Mond, keine Sterne im See), Partikel voll',
  ],
  [
    'qualitaet-hoch',
    'high',
    'M5-25: Qualitätsstufe „Hoch“ (Standard) – 128 Punktlichter, weiche SDF-Schatten mit Halbschatten, Wasser voll: Vollmond mit Glitzerpfad und Sterne im See, Partikel voll',
  ],
  [
    'qualitaet-ultra',
    'ultra',
    'M5-25: Qualitätsstufe „Ultra“ – 256 Punktlichter, weiche Schatten, Wasser voll, Partikellicht (Funken und Glut werfen Licht); GI verlangt, aber nicht aktiv: der Renderer berechnet kein indirektes Licht (der GI-Puffer bleibt leer)',
  ],
];

/** The render debugger's buffers on the evening showcase (M5-27): name, view, what it shows. */
const EVENING_BUFFERS: ReadonlyArray<readonly [string, string, string]> = [
  ['debug-albedo', 'albedo', 'M5-27: Render-Debugger „albedo“ – G0, die Palettenfarbe jedes Pixels ohne Licht, im Grünhain-Schaufenster um 17:30 mit Lager'],
  ['debug-normalen', 'normal', 'M5-27: Render-Debugger „normal“ – G1-Normalen: Rot nach rechts, Grün nach oben, flacher Boden lavendel; Stämme, Kronen, Felsen und Klippen mit Relief'],
  ['debug-hoehe', 'height', 'M5-27: Render-Debugger „height“ – G1-Höhe über dem Boden: Boden schwarz, Stämme und Kronen hell nach ihrer Höhe'],
  ['debug-emissiv', 'emissive', 'M5-27: Render-Debugger „emissive“ – G2: nur Lagerfeuer, Fackelflammen und Glut leuchten in ihrer Farbe'],
  ['debug-sonnenschatten', 'sun', 'M5-27: Render-Debugger „sun“ – das Licht der tief stehenden Abendsonne: lange Silhouettenschatten der Bäume, Felsen und Klippen nach Osten, weiß = volle Sonne'],
  ['debug-licht', 'light', 'M5-27: Render-Debugger „light“ – das Punktlicht des Lichtpasses allein: Lagerfeuer, Fackel am Pfahl und in der Hand, mit den weichen Schatten der Stämme'],
  [
    'debug-gi',
    GI_DEBUG_VIEW,
    'M5-27: Render-Debugger „gi“ – der Puffer der Radiance-Cascades-GI (Stufe Ultra): leer (schwarz), die Beschriftung sagt, dass GI nicht aktiv ist und der Renderer kein indirektes Licht berechnet',
  ],
  [
    'debug-lichtkarte',
    LIGHTMAP_SOURCES_VIEW,
    'M5-27: Render-Debugger „lightmap-quellen“ – die Gameplay-Lichtkarte der Lichtquellen (rot) gegen das gerenderte Licht (grün) am Lager unter der Klippe: gelb bis oliv, wo beide übereinstimmen, dunkelblau, was nicht vergleichbar ist (Sprites); die Ansicht `lightmap` rechnet das Umgebungslicht dazu, das in der Dämmerung gewollt abweicht',
  ],
];

/** Screenshot and bench scenarios of the quality strand. */
export function qualityScenarios(): ScenarioLike<QualityScenarioContext>[] {
  const out: ScenarioLike<QualityScenarioContext>[] = [];
  for (const [name, level, description] of LEVEL_PICTURES) out.push(atQuality(skyScenario(nightCamp(`${name}-basis`, description)), name, description, level));
  out.push(
    atQuality(
      skyScenario(nightCamp('hoch-gruenhain-nacht-basis', '')),
      'hoch-gruenhain-nacht',
      'M5-30: Bench-Szene der Stufe „Hoch“ – klare Vollmondnacht im Grünhain, Lagerfeuer, Fackel am Pfahl und in der Hand am See: Frame-CPU ≤ 8 ms, Render-Vorbereitung ≤ 3 ms, Draw-Calls ≤ 150',
      'high',
    ),
  );
  for (const [name, view, description] of EVENING_BUFFERS) {
    out.push(skyScenario({ name, description, hour: 17, minute: 30, weather: 'klar', camp: true, debugView: view }));
  }
  const byName = <T extends { readonly name: string }>(list: readonly T[], name: string): T => {
    const s = list.find((x) => x.name === name);
    if (s === undefined) throw new Error(`Szenario ${name} fehlt – der Render-Debugger zeigt seinen Puffer darauf`);
    return s;
  };
  out.push(
    throughDebugView(
      byName(surfaceScenarios(), 'regen-nacht-pfuetzen'),
      'debug-naesse',
      'M5-27: Render-Debugger „wet“ – G2-Nässe nach zwei Stunden Regen: der nasse Boden hell, die Pfützen in den Senken am hellsten, trockene Stellen unter den Kronen dunkel',
      'wet',
    ),
    throughDebugView(
      byName(atmosphereScenarios(), 'nebel-nacht-fackel'),
      'debug-nebel',
      'M5-27: Render-Debugger „fog“ – die Nebeldichte im Nebelmoor um 22:00: driftende Nebelbänke hell, höheres Gelände ragt dunkel heraus',
      'fog',
    ),
  );
  return out;
}
