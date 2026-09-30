/**
 * AI profiles (docs/SPIEL.md §11 "KI (M6-13)"; MASTERPROMPT §19.4): how a kind of creature behaves – its stance towards
 * the player, its senses, courage and leash, the weights of its idle states and its special rules. Several creatures may
 * share a profile; the scores themselves are `BALANCE.ai.utility`, the formulas src/game/creatures/ai/.
 *
 * The first profiles are the reference for the creature content that follows (M6-19 ff.):
 * - `hase` – shy small game: grazes and hops about, bolts at a few tiles, hears well.
 * - `reh` – shy but defiant: flees early, but a deer that was hit and has the attacker in reach kicks back until its
 *   courage runs out.
 * - `wachtel` – a ground bird: pecks about in cover, flutters up a few tiles when flushed.
 * - `nachtmahr` – the Nachtmahr of fear 100 (§12.3): hunts the player relentlessly, breaks doors, only glaring light
 *   (> 0,9) drives it off.
 */
import { defineCreatureRecords } from './define';
import { aiProfileSchema } from './schema';

/** Every AI profile, validated and frozen. */
export const AI_PROFILES = defineCreatureRecords('aiProfiles', aiProfileSchema, [
  {
    id: 'hase',
    haltung: 'scheu',
    sicht: 9,
    gehoer: 1.3,
    fluchtDistanz: 5,
    mut: 0,
    leine: 20,
    streifen: 8,
    gewichte: { ruhen: 2, grasen: 3, umherstreifen: 2 },
    untersuchen: 3,
    gedaechtnis: 4,
    schuetztSich: false,
    brichtTueren: false,
    meidetLicht: null,
    unerbittlich: false,
  },
  {
    id: 'reh',
    haltung: 'wehrhaft',
    sicht: 12,
    gehoer: 1.2,
    fluchtDistanz: 7,
    mut: 0.4,
    leine: 24,
    streifen: 10,
    gewichte: { ruhen: 2, grasen: 4, umherstreifen: 2 },
    untersuchen: 4,
    gedaechtnis: 5,
    schuetztSich: false,
    brichtTueren: false,
    meidetLicht: null,
    unerbittlich: false,
  },
  {
    id: 'wachtel',
    haltung: 'scheu',
    sicht: 7,
    gehoer: 1.4,
    fluchtDistanz: 4,
    mut: 0,
    leine: 14,
    streifen: 6,
    gewichte: { ruhen: 2, grasen: 4, umherstreifen: 1 },
    untersuchen: 2,
    gedaechtnis: 3,
    fluchtFlug: 1.2,
    schuetztSich: false,
    brichtTueren: false,
    meidetLicht: null,
    unerbittlich: false,
  },
  {
    id: 'nachtmahr',
    haltung: 'jaeger',
    sicht: 22,
    gehoer: 2,
    fluchtDistanz: 0,
    mut: 0,
    leine: 64,
    streifen: 6,
    gewichte: { ruhen: 0, grasen: 0, umherstreifen: 1 },
    untersuchen: 8,
    gedaechtnis: 30,
    schuetztSich: false,
    brichtTueren: true,
    meidetLicht: 0.9,
    unerbittlich: true,
  },
]);
