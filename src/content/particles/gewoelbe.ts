/**
 * Particles of the vaults (MASTERPROMPT §21 "verborgene Wände (Luftzug-Partikel)", §6.2 "Emitter als Daten"; docs/SPIEL.md §19,
 * §30 "C … Luftzug-Emitter"; M7-13, strand C). Placed by the vault view (src/render/game/vaults.ts):
 *
 * - `gw_staubkorn`: a mote of stone dust – a single pale pixel, lit by the scene (it shows only by torchlight, which is the hint:
 *   "Achte im Fackelschein auf den Staub im Luftzug"), drifting slowly and settling; no wind underground.
 * - `gewoelbe_luftzug`: the draft through the crack of a real cracked wall or a hidden door – a few motes a second blown out of
 *   the crack's height towards the room, most of them southwards (the walls face the room the player stands in).
 * - `gewoelbe_schale`: the sparks over a burning fire bowl of a puzzle – a small, steady throw (a bowl, not a camp fire).
 */
import type { ParticleEmitterInput, ParticleKindInput } from './schema';

export const PARTICLE_KINDS_GEWOELBE: readonly ParticleKindInput[] = [
  {
    // Stone dust in a draft: one pale pixel, fading as it settles – visible where the torch falls on it.
    id: 'gw_staubkorn',
    form: 'punkt',
    groesse: { min: 1, max: 1 },
    wachstum: 1,
    farben: ['stein.4', 'stein.3'],
    deckung: { start: 0.9, ende: 0 },
    emissiv: 0,
    flackern: 0.2,
    leben: { min: 1.2, max: 2.4 },
    schwerkraft: 5,
    widerstand: 1.2,
    wind: 0,
    wirbel: 5,
    wirbelTakt: 1.5,
    boden: 'vergehen',
  },
];

export const PARTICLE_EMITTERS_GEWOELBE: readonly ParticleEmitterInput[] = [
  { id: 'gewoelbe_luftzug', art: 'gw_staubkorn', rate: 7, flaeche: { form: 'rechteck', breite: 8, tiefe: 2 }, hoehe: { min: 0, max: 8 }, tempo: { min: 4, max: 11 }, richtung: 90, streuung: 150, steigen: { min: -2, max: 3 } },
  { id: 'gewoelbe_schale', art: 'funke', rate: 5, flaeche: { form: 'kreis', breite: 6, tiefe: 3 }, hoehe: { min: 0, max: 3 }, tempo: { min: 2, max: 7 }, richtung: 0, streuung: 360, steigen: { min: 28, max: 55 } },
];
