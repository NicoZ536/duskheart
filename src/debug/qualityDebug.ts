/**
 * Debug access to the quality level (M5-25 … M5-27, M5-30): `__dh.call('quality', level?)` switches the level like
 * the player would (stored, every detail option of its preset, from the next frame on) and returns the controller's
 * state – the level rendered and where it comes from, the GI slot, the light buffer, the first-start benchmark, the
 * settings every strand got. The F3 overlay's render panel reads the same state and the pass table
 * (`RenderPanelInfo`).
 */
import { isQualityLevel, QUALITY_LEVELS, qualityPatch, type SettingsStore } from '../engine/settings';
import type { QualityState } from '../render/quality/controller';
import type { PassTimings } from '../render/quality/profiler';

/** What the render panel of the F3 overlay shows (refreshed a few times per second while the overlay is open). */
export interface RenderPanelInfo {
  readonly quality: QualityState;
  readonly passes: PassTimings;
}

export interface QualityDebugDeps {
  readonly settings: SettingsStore;
  readonly render: { qualityState(): QualityState; passTimings(): PassTimings };
}

/** The `__dh.call` extensions of the quality level. */
export function qualityExtensions(deps: QualityDebugDeps): Readonly<Record<string, (...args: never[]) => unknown>> {
  return {
    quality: (level?: string) => {
      if (level !== undefined) {
        if (!isQualityLevel(level)) throw new TypeError(`quality: unbekannte Stufe „${String(level)}“ (${QUALITY_LEVELS.join(', ')})`);
        deps.settings.update(qualityPatch(level));
      }
      return deps.render.qualityState();
    },
  };
}

/** A fresh render panel snapshot. */
export function renderPanelInfo(render: QualityDebugDeps['render']): RenderPanelInfo {
  return { quality: render.qualityState(), passes: render.passTimings() };
}
