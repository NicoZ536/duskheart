/**
 * Layout of the light probe scene `licht-probe` (E2E `render-light`): empty flat ground, no ambient
 * light, one white point light and one white spot light at known places. The E2E test reads the
 * light buffer through the render debugger and compares every probed pixel with the canonical
 * model (`src/engine/lightFalloff.ts`). Kept free of renderer imports, so the test can load it.
 */
import { LIGHT_FULL_CIRCLE, type LightSource } from '../../engine/lightFalloff';

/** Camera centre (whole pixels: no subpixel offset, internal pixel = world pixel − view corner). */
export const LIGHT_PROBE_CAMERA: readonly [number, number] = [0, 0];

const SPOT_OPENING = Math.PI / 3;

/** The probe lights (flicker 0, so the frame does not depend on time). */
export const LIGHT_PROBE_LIGHTS: readonly LightSource[] = [
  { x: -110, y: 4, height: 18, radius: 96, intensity: 1, flicker: 0, seed: 0, coneDirection: 0, coneAngle: LIGHT_FULL_CIRCLE },
  { x: 90, y: -30, height: 12, radius: 120, intensity: 1, flicker: 0, seed: 0, coneDirection: Math.PI / 4, coneAngle: SPOT_OPENING },
];
