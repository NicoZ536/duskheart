/**
 * Weather particles and lightning (M5-12; schema in `schema.ts`). The game view picks the record from the weather at
 * the camera (src/render/world/particlesScene.ts): rain and drizzle `regen`, snow and blizzard `schnee`, ashfall
 * `asche`, a sandstorm `sand`; the precipitation of the weather (or the sandstorm's share of it) scales the density,
 * the wind of the weather carries the particles.
 */
import type { Lightning, WeatherParticlesInput } from './schema';

export const WEATHER_PARTICLE_DATA: readonly WeatherParticlesInput[] = [
  {
    // Streaks slanting with the wind (rain's breeze ≈ 18°, a thunderstorm's gale ≈ 30°); far ones short and faint,
    // near ones long; the ground layer splashes.
    id: 'regen',
    arten: [{ art: 'regentropfen', anteil: 1 }],
    dichte: 60,
    fall: { min: 290, max: 360 },
    hoehe: 200,
    wind: 1.6,
    schichten: [
      { parallaxe: 0.8, anteil: 0.3, groesse: 0.7, deckung: 0.55 },
      { parallaxe: 1, anteil: 0.5, groesse: 1, deckung: 1 },
      { parallaxe: 1.3, anteil: 0.2, groesse: 1.45, deckung: 0.8 },
    ],
  },
  {
    // Slow flakes swaying down; far ones single pixels, near ones small crosses; they lie a moment on the ground.
    id: 'schnee',
    arten: [{ art: 'schneeflocke', anteil: 1 }],
    dichte: 120,
    fall: { min: 18, max: 38 },
    hoehe: 280,
    wind: 0.7,
    schichten: [
      { parallaxe: 0.75, anteil: 0.35, groesse: 0.6, deckung: 0.65 },
      { parallaxe: 1, anteil: 0.45, groesse: 1, deckung: 1 },
      { parallaxe: 1.35, anteil: 0.2, groesse: 1.8, deckung: 1 },
    ],
  },
  {
    // Ash drifting down like dark snow, every tenth flake a glowing ember.
    id: 'asche',
    arten: [
      { art: 'ascheflocke', anteil: 0.9 },
      { art: 'aschenglut', anteil: 0.1 },
    ],
    dichte: 100,
    fall: { min: 14, max: 30 },
    hoehe: 260,
    wind: 0.6,
    schichten: [
      { parallaxe: 0.8, anteil: 0.35, groesse: 0.8, deckung: 0.7 },
      { parallaxe: 1, anteil: 0.5, groesse: 1, deckung: 1 },
      { parallaxe: 1.3, anteil: 0.15, groesse: 1.5, deckung: 1 },
    ],
  },
  {
    // Grains and dust veils racing low along the storm's direction, dense enough to veil the ground.
    id: 'sand',
    arten: [
      { art: 'sandkorn', anteil: 0.45 },
      { art: 'sandkorn_dunkel', anteil: 0.35 },
      { art: 'sandschleier', anteil: 0.2 },
    ],
    dichte: 150,
    fall: { min: 6, max: 30 },
    hoehe: 70,
    wind: 1.8,
    schichten: [
      { parallaxe: 0.8, anteil: 0.3, groesse: 0.8, deckung: 0.6 },
      { parallaxe: 1, anteil: 0.5, groesse: 1, deckung: 1 },
      { parallaxe: 1.4, anteil: 0.2, groesse: 1.3, deckung: 0.9 },
    ],
  },
];

/**
 * Lightning of a thunderstorm: a strike every 3–11 s, a sharp flash and a weaker after-flash in the lightning's cold
 * white-blue; nearly half of its light washes over the whole picture, so the flash reads cold and stark, not as daylight.
 */
export const LIGHTNING_DATA: Lightning = {
  abstand: { min: 3, max: 11 },
  blitz: 0.06,
  pause: 0.07,
  nachblitz: 0.24,
  nachblitzStaerke: 0.55,
  staerke: 1.2,
  schleier: 0.45,
  farbe: 'eis.2',
  reduziert: 0.25,
  reduziertDauer: 0.6,
};
