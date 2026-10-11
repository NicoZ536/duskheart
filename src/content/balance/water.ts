/**
 * Balance values of water (MASTERPROMPT §18 "Wasser: … Abkochen macht sauber, Regensammler, … Trinkschlauch (5 Schlucke),
 * … geschmolzener Schnee, Tees"; docs/SPIEL.md §21 "Wasser"; M7-30) – group `BALANCE.water` (src/content/balance.ts
 * re-exports it): the rain collector, the water skin and the boiled bucket. The fever risk of unfiltered water is
 * `BALANCE.actions.water`. Every value states its unit and the reason for it.
 */

export const WATER_BALANCE = {
  collector: {
    /**
     * Rain a collector holds when full [game minutes of rain]. A summer shower of five hours (300 minutes) fills it once:
     * twenty sips for a day or two of thirst, so a dry week empties it.
     */
    capacityMinutes: 300,
    /** Rain one sip, one charge of a skin or one bucket takes from it [game minutes of rain]. The capacity holds twenty sips (300 / 15). */
    minutesPerSip: 15,
    /**
     * Charges a filled bucket takes from it [sips]. A wooden bucket holds as much as a skin and a sip more: five sips, like the
     * skin of §18, so filling one never leaves half a sip behind.
     */
    sipsPerBucket: 5,
  },
  skin: {
    /** Sips a full water skin holds [sips]. §18: "Trinkschlauch (5 Schlucke)" (its `ladungen.max` is the same value). */
    sips: 5,
  },
  boiled: {
    /** Sips of a bucket of boiled water [sips]. As many as the bucket takes from a collector (`collector.sipsPerBucket`): one bucket, five sips. */
    sips: 5,
  },
};
