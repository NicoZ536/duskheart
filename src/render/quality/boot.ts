/**
 * The quality level on the page (M5-25, M5-26): binds the player settings to the renderer's `QualityController` –
 * every change of the graphics or accessibility settings reaches every strand in the next frame – and decides at boot
 * whether the first-start benchmark runs.
 *
 * - **Choosing a level** sets its preset: a change of `graphics.quality` alone (the console's `set graphics.quality ultra`,
 *   later the settings screen) brings every detail option of the level along (`qualityPatch`); single options changed
 *   afterwards stay until the next level is chosen (§29 "Qualitätsstufe, Einzeloptionen").
 * - **First start** (`graphics.autoDetected` false): the benchmark measures the scene behind the title and stores the
 *   level it found together with `autoDetected: true` (§6.3). A level the player (or a test) chooses before it ends
 *   wins: the benchmark stops, and the first-start detection counts as settled (`autoDetected: true`), so the next
 *   start does not overrule the choice.
 * - **Screenshot scenarios** (`?scenario=`) never benchmark: their pictures are deterministic (§31.5) and render at
 *   the stored level or at the scenario's own (`ScenarioRender.setQuality`).
 * - **Debug pages** (`?debug=1`) may name the level in the URL, `?quality=low|medium|high|ultra`: it is stored like a
 *   choice of the player, so no benchmark runs; E2E tests that judge an effect set the level they judge this way (or
 *   with `__dh.call('quality', level)`). The light buffer of a debug page stays at full resolution – its frames must be
 *   reproducible – unless `?lightBuffer=auto|half` or `__dh.call('lightBuffer', mode)` says otherwise; the game halves
 *   it on frame drops when the setting `graphics.adaptiveLightBuffer` allows.
 */
import { isQualityLevel, matchesQualityPreset, QUALITY_DETAIL_KEYS, qualityPatch, type DeepPartial, type GraphicsSettings, type SettingsStore } from '../../engine/settings';
import type { AutoPresetResult } from './autoPreset';
import { isLightBufferMode, type QualityController } from './controller';

/** URL parameters of debug pages (see the module comment). */
export const QUALITY_URL_PARAM = 'quality';
export const LIGHT_BUFFER_URL_PARAM = 'lightBuffer';

export interface QualityBootOptions {
  readonly settings: SettingsStore;
  readonly quality: QualityController;
  /** `location.search` of the page. */
  readonly search: string;
  /** Debug mode (`?debug=1` or developer mode). */
  readonly debug: boolean;
  /** Page time [ms] (`performance.now`). */
  now(): number;
}

/** Why a first-start benchmark stops when the player picks a level first. */
export const OWN_CHOICE = 'eigene-wahl';

/** Whether `next` differs from `prev` only in the level, not in a detail option (a level was chosen, its preset is due). */
export function levelChosenAlone(next: GraphicsSettings, prev: GraphicsSettings): boolean {
  return next.quality !== prev.quality && QUALITY_DETAIL_KEYS.every((k) => next[k] === prev[k]);
}

/** Applies the settings to the renderer now and on every change; starts the first-start benchmark where due. */
export function startRenderQuality(opts: QualityBootOptions): void {
  const { settings, quality } = opts;
  const url = new URLSearchParams(opts.search);
  const scenario = opts.debug && url.get('scenario') !== null;
  quality.apply(settings.get());
  settings.subscribe((next, prev) => {
    const g = next.graphics;
    const levelChanged = g.quality !== prev.graphics.quality;
    const running = quality.benchmarkPhase === 'wartet' || quality.benchmarkPhase === 'misst';
    if (running && levelChanged) quality.cancelBenchmark(OWN_CHOICE);
    const patch: DeepPartial<GraphicsSettings> = levelChosenAlone(g, prev.graphics) && !matchesQualityPreset(g) ? { ...qualityPatch(g.quality).graphics } : {};
    if (running && levelChanged && !g.autoDetected) patch.autoDetected = true;
    if (Object.keys(patch).length > 0) {
      // The level's preset (and the settled detection) follow at once; this listener runs again with the result.
      settings.update({ graphics: patch });
      return;
    }
    if (g !== prev.graphics || next.accessibility !== prev.accessibility) quality.apply(next);
  });
  if (opts.debug) {
    const mode = url.get(LIGHT_BUFFER_URL_PARAM);
    quality.setLightBufferMode(isLightBufferMode(mode) ? mode : 'full');
    const level = url.get(QUALITY_URL_PARAM);
    if (isQualityLevel(level)) settings.update({ graphics: { ...qualityPatch(level).graphics, autoDetected: true } });
  }
  if (!settings.get().graphics.autoDetected && !scenario) {
    quality.startBenchmark((result: AutoPresetResult) => {
      settings.update({ graphics: { ...qualityPatch(result.level).graphics, autoDetected: true } });
    }, opts.now());
  }
}
