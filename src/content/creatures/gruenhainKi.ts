/**
 * AI profiles of the Grünhain creatures of M6-20 … M6-22 (MASTERPROMPT §19.4 "Verhalten", "Gruppentaktik"; docs/SPIEL.md
 * §11 "KI (M6-13)"): how each behaves towards the player, read by the utility AI of src/game/creatures/ai/brain.ts with the
 * scores of `BALANCE.ai.utility`. The group file src/content/creatures/gruenhain.ts registers them.
 *
 * - `eichhoernchen` – shy and quick: forages on the ground, flees up and away at five tiles, awake by day only.
 * - `frosch` – shy, sits still most of the time at dusk and night; hops off when one comes within three tiles.
 * - `gluehwuermchen` – a drifting swarm at night: it roams slowly, hardly notices anything and drifts aside when touched.
 * - `keiler` – territorial (`revier`): it roots about near its wallow and charges whoever comes within six tiles of it or
 *   hits it; a boar fights to the end (no courage threshold).
 * - `dachs` – territorial round its sett (four tiles); it gives up and retreats when badly hurt.
 * - `wolf` – aggressive pack hunter at dusk and night: it notices far, alerts its pack, circles the prey on the ring and only
 *   one wolf goes in at a time (`rudel`, M6-18: the others flank); a badly hurt wolf breaks off.
 * - `dornling` – aggressive but rooted: camouflaged as a bush (`tarnung`) it waits for prey to come within the reach of its
 *   ambush; revealed it fights close to its spot (short leash) and hides again after a while in peace.
 * - `wespenschwarm` – territorial round its nest (four tiles), relentless in its short range, and shy of fire: a torch or a
 *   camp fire within three tiles drives it off (`scheutFeuer` – smoke).
 */
import type { z } from 'zod';
import { defineCreatureRecords } from './define';
import { aiProfileSchema } from './schema';

type ProfileInput = z.input<typeof aiProfileSchema>;

/** Neither ranged, summoner, door breaker nor light avoider. */
const SCHLICHT = { schuetztSich: false, brichtTueren: false, meidetLicht: null, unerbittlich: false } as const satisfies Partial<ProfileInput>;

/** The AI profiles of the Grünhain creatures, validated and frozen. */
export const GRUENHAIN_PROFILE = defineCreatureRecords('aiProfiles', aiProfileSchema, [
  {
    id: 'eichhoernchen',
    haltung: 'scheu',
    sicht: 10,
    gehoer: 1.3,
    fluchtDistanz: 5,
    mut: 0,
    leine: 14,
    streifen: 6,
    // Forever busy: foraging and dashing about, seldom still.
    gewichte: { ruhen: 1, grasen: 3, umherstreifen: 3 },
    untersuchen: 2,
    gedaechtnis: 4,
    ...SCHLICHT,
  },
  {
    id: 'frosch',
    haltung: 'scheu',
    sicht: 6,
    gehoer: 1,
    fluchtDistanz: 3,
    mut: 0,
    leine: 10,
    streifen: 4,
    // Mostly sits and waits for insects.
    gewichte: { ruhen: 4, grasen: 1, umherstreifen: 1 },
    untersuchen: 2,
    gedaechtnis: 3,
    ...SCHLICHT,
  },
  {
    id: 'gluehwuermchen',
    haltung: 'scheu',
    sicht: 4,
    gehoer: 0.5,
    fluchtDistanz: 1.5,
    mut: 0,
    leine: 8,
    streifen: 4,
    // Drifts on and on over the grass.
    gewichte: { ruhen: 1, grasen: 0, umherstreifen: 4 },
    untersuchen: 1,
    gedaechtnis: 2,
    ...SCHLICHT,
  },
  {
    id: 'keiler',
    haltung: 'revier',
    sicht: 10,
    gehoer: 1.2,
    // Its wallow: who comes this close to its home is charged.
    fluchtDistanz: 6,
    mut: 0,
    leine: 20,
    streifen: 8,
    gewichte: { ruhen: 2, grasen: 4, umherstreifen: 2 },
    untersuchen: 4,
    gedaechtnis: 8,
    ...SCHLICHT,
  },
  {
    id: 'dachs',
    haltung: 'revier',
    sicht: 8,
    gehoer: 1.4,
    // Its sett.
    fluchtDistanz: 4,
    mut: 0.3,
    leine: 16,
    streifen: 6,
    gewichte: { ruhen: 2, grasen: 4, umherstreifen: 1 },
    untersuchen: 4,
    gedaechtnis: 6,
    ...SCHLICHT,
  },
  {
    id: 'wolf',
    haltung: 'aggressiv',
    sicht: 14,
    gehoer: 1.6,
    fluchtDistanz: 0,
    mut: 0.25,
    leine: 32,
    streifen: 10,
    gewichte: { ruhen: 2, grasen: 0, umherstreifen: 3 },
    untersuchen: 6,
    gedaechtnis: 12,
    // Three and a half tiles round the prey, beyond a bite's reach; one goes in, the others circle and flank.
    rudel: { ringTiles: 3.5, angreiferZugleich: 1 },
    ...SCHLICHT,
  },
  {
    id: 'dornling',
    haltung: 'aggressiv',
    // A plant: it sees little and hears less, it feels what steps close.
    sicht: 6,
    gehoer: 0.8,
    fluchtDistanz: 0,
    mut: 0,
    // Rooted: it never strays far from its spot.
    leine: 8,
    streifen: 3,
    gewichte: { ruhen: 4, grasen: 0, umherstreifen: 1 },
    untersuchen: 3,
    gedaechtnis: 6,
    // The reveal is the sprite's clip `erwachen` (5 positions at 10 fps); ten seconds in peace and it is a bush again.
    tarnung: { erwachen: 0.5, tarnenNach: 10 },
    ...SCHLICHT,
  },
  {
    id: 'wespenschwarm',
    haltung: 'revier',
    sicht: 8,
    gehoer: 1,
    // Its nest.
    fluchtDistanz: 4,
    mut: 0,
    leine: 12,
    streifen: 3,
    gewichte: { ruhen: 2, grasen: 0, umherstreifen: 3 },
    untersuchen: 3,
    gedaechtnis: 5,
    // Smoke drives wasps off: a torch or a fire within three tiles.
    scheutFeuer: 3,
    ...SCHLICHT,
  },
]);
