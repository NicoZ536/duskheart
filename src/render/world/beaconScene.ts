/**
 * The beacons in the atmosphere of the game view (MASTERPROMPT §4.1 "Farben, die mit jedem entzündeten Leuchtfeuer lebendiger
 * werden – die Welt heilt sichtbar", §6.2 "Verderbnis: Paletten-Shift … weicht mit jedem Leuchtfeuer", §8; docs/ART.md §5;
 * docs/SPIEL.md §22; strand F, M7-35). Called by `atmosphereScene.ts` once per frame with two lines:
 *
 * - `beaconCorruption`: the corruption at the camera – the biome's base value scaled by the world's healing step
 *   (`BEACON_HEALING[lit].verderbnis`) and the corrupted stretch around every beacon site that does not burn yet
 *   (`BeaconsSystem.corruptionAt`: strongest at the site, washed away behind a lit beacon's wave). The stronger counts.
 * - `addBeaconHealing`: the grade of the healed world – the global step of the lit beacons (saturation and warmth rise
 *   with every one, §4.1) and, where the camera stands in land a wave has healed, the fresh light of that land
 *   (`HEALED_GRADING` × how far the wave healed it, `BeaconsSystem.healingAt`). Returns a key of what it added (0 nothing):
 *   the grade eases again only when it moved.
 *
 * Reads the simulation, never writes it; the beacon system is found once per simulation. No allocation per frame.
 */
import { BeaconsSystem } from '../../game/beacons/system';
import { healingStep } from '../../game/beacons/formulas';
import type { Simulation } from '../../game/sim';
import { TILE_PX, type Layer } from '../../world/model/coords';
import { addGradingDelta, GRADING_INDEX, type GradingPartial } from '../post/grading';
import type { RenderScene } from '../scene';

/**
 * The grade of land a beacon's wave has just healed, at full healing: a little more colour and warmth and contrast than the
 * world's step alone – the light lies freshly on the land (§8 "die Region heilt sichtbar").
 */
export const HEALED_GRADING: GradingPartial = { saturation: 1.12, temperature: 0.06, contrast: 1.03 };
/** Steps of the local healing in the grade's key (a wave moving by less changes no LUT node). */
const HEAL_KEY_STEPS = 64;
/** Packed indices of the grade's saturation and white balance (the world's step adds to them directly). */
const GRADING_SATURATION = GRADING_INDEX.saturation;
const GRADING_TEMPERATURE = GRADING_INDEX.temperature;

let cachedSim: Simulation | null = null;
let cachedSystem: BeaconsSystem | null = null;

function systemOf(sim: Simulation): BeaconsSystem | null {
  if (cachedSim !== sim) {
    const s = sim.systems.find((x) => x instanceof BeaconsSystem);
    cachedSystem = s instanceof BeaconsSystem ? s : null;
    cachedSim = sim;
  }
  return cachedSystem;
}

/**
 * Writes the corruption at the camera into `scene.corruption.strength` (the biome's value already there, or 0) and tells
 * whether any is left.
 */
export function beaconCorruption(scene: RenderScene, sim: Simulation, layer: Layer, cameraX: number, cameraY: number, tick: number): boolean {
  const s = systemOf(sim);
  if (s === null) return scene.corruption.strength !== 0;
  const base = scene.corruption.strength * healingStep(s.litCount()).verderbnis;
  const site = s.corruptionAt(layer, Math.floor(cameraX / TILE_PX), Math.floor(cameraY / TILE_PX), tick);
  const c = site > base ? site : base;
  scene.corruption.strength = c;
  return c !== 0;
}

/** Adds the healed world's grade at the camera to `target`; returns the key of what it added (0: nothing). */
export function addBeaconHealing(target: Float32Array, sim: Simulation, layer: Layer, cameraX: number, cameraY: number, tick: number): number {
  const s = systemOf(sim);
  if (s === null) return 0;
  const lit = s.litCount();
  let key = 0;
  if (lit > 0) {
    const step = healingStep(lit);
    target[GRADING_SATURATION] = (target[GRADING_SATURATION] as number) + (step.saettigung - 1);
    target[GRADING_TEMPERATURE] = (target[GRADING_TEMPERATURE] as number) + step.waerme;
    key = lit * (HEAL_KEY_STEPS + 2);
  }
  const healed = s.healingAt(layer, Math.floor(cameraX / TILE_PX), Math.floor(cameraY / TILE_PX), tick);
  if (healed > 0) {
    const q = Math.round(healed * HEAL_KEY_STEPS);
    addGradingDelta(target, HEALED_GRADING, q / HEAL_KEY_STEPS);
    key += q + 1;
  }
  return key;
}
