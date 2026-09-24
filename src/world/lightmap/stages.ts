/**
 * Light stages of the gameplay light map (MASTERPROMPT §12.1): Dunkel < 0,15 · Dämmrig 0,15–0,4 ·
 * Hell 0,4–0,9 · Gleißend > 0,9 (`BALANCE.light.map.stages`). Spawning, fear, perception and the
 * Schattenbrut read the stage of a point instead of comparing raw levels.
 */
import { BALANCE } from '../../content/balance';

/** The four stages, darkest first. */
export const LIGHT_STAGES = ['dunkel', 'daemmrig', 'hell', 'gleissend'] as const;
/** One light stage. */
export type LightStage = (typeof LIGHT_STAGES)[number];

/** Stage of a light level (levels above 1 – next to a fire – are glaring like full daylight). */
export function lightStage(level: number): LightStage {
  const s = BALANCE.light.map.stages;
  if (level < s.darkBelow) return 'dunkel';
  if (level < s.brightFrom) return 'daemmrig';
  return level > s.glaringAbove ? 'gleissend' : 'hell';
}

/** Index of a stage in `LIGHT_STAGES` (0 = dunkel … 3 = gleissend). */
export function lightStageIndex(stage: LightStage): number {
  return LIGHT_STAGES.indexOf(stage);
}
