/**
 * Balance values of fear (MASTERPROMPT §12.3, M3-23) – group `BALANCE.fear` (src/content/balance.ts
 * re-exports it). Every value states its unit and the reason for it. Rates are per simulated second like
 * the survival stats (src/content/balance/survival.ts); the sleep rate is per game hour, as §12.3 states it.
 */

/**
 * Fear stages (§12.3 "Effekte"): `ruhig` below the HUD eye, `unruhig` from 20 (the eye shows, §26),
 * `fluestern` from 40 (whispers, shadows at the screen edge), `trugbilder` from 60 (hallucinations,
 * desaturation), `bedrohlich` from 80 (hallucinations can hurt), `nachtmahr` at 100 (the Nachtmahr hunts).
 */
export const FEAR_STAGES = ['ruhig', 'unruhig', 'fluestern', 'trugbilder', 'bedrohlich', 'nachtmahr'] as const;
/** One fear stage. */
export type FearStage = (typeof FEAR_STAGES)[number];

export const FEAR_BALANCE = {
  /** Full fear [points]. §11.1: "Furcht 0–100". */
  max: 100,
  rise: {
    /** In the dark at night on the surface [points/s]. §12.3: "Dunkel +1,0/s nachts". */
    darkNightPerSecond: 1,
    /** In the dark underground [points/s]. §12.3: "+0,5/s in Höhlen". */
    darkCavePerSecond: 0.5,
    /** In a corrupted area [points/s]. §12.3: "Verderbnisgebiet +0,5/s". */
    corruptionPerSecond: 0.5,
    /** Sighting an elite or a boss [points]. §12.3: "Sichtung Elite/Boss +10". */
    sighting: 10,
    /** Eating raw or spoiled food [points]. §12.3: "rohe oder verdorbene Nahrung +5". */
    badFood: 5,
    /** A settler died [points]. §12.3: "Tod eines Siedlers +20". */
    settlerDeath: 20,
  },
  decay: {
    /** In bright light [points/s]. §12.3: "Hell −0,5/s". */
    brightPerSecond: 0.5,
    /** At a fire or hearth [points/s]. §12.3: "am Feuer/Herd −1/s". */
    firePerSecond: 1,
    /** In a cosy room at full comfort [points/s]. §12.3: "behaglicher Raum bis −1,5/s (skaliert mit Behaglichkeit)". */
    roomMaxPerSecond: 1.5,
    /** Comfort at which a room calms at its full rate [comfort points]. §16.4: "Behaglichkeit 0–20". */
    roomComfortForMax: 20,
    /** While asleep [points per game hour]. §12.3: "Schlaf −5 pro Spielstunde". */
    sleepPerGameHour: 5,
    /** Music played nearby [points/s]. §12.3: "Musizieren (Flöte, Laute) −2/s im Umkreis". */
    musicPerSecond: 2,
    /** A companion nearby [points/s]. §12.3: "Begleiter in der Nähe −0,2/s". */
    companionPerSecond: 0.2,
    /** Least and most a comfort food calms [points]. §12.3: "Wohlfühlessen −10 bis −25". */
    comfortFoodMin: 10,
    comfortFoodMax: 25,
  },
  /** Stage thresholds [points]. §12.3 "Effekte" and §26 "Furcht-Auge (ab 20)". */
  stages: { eyeFrom: 20, whisperFrom: 40, hallucinationFrom: 60, harmfulFrom: 80, nightmareAt: 100 },
  hallucinations: {
    /** Hallucinations at once [count]. More than three shapes at the edge of the light would read as a real attack, not as a mind playing tricks. */
    max: 3,
    /** Mean time between two hallucinations from fear 60 [s]. One every few breaths keeps the player looking over the shoulder without flooding the screen. */
    intervalSeconds: 10,
    /** Mean time between two hallucinations from fear 80 [s]. §12.3 "ab 80 können Trugbilder echten Schaden anrichten": the danger comes faster. */
    harmfulIntervalSeconds: 6,
    /** Spawn ring around the player [tiles]. Just outside a torch's 6-tile circle (§12.2): they come out of the dark, where light cannot dissolve them at once. */
    spawnMinTiles: 6.5,
    spawnMaxTiles: 10,
    /** Approach speed [tiles/s]. Slower than walking (4,5 tiles/s, §11.4): the player can always step into light or away. */
    speedTilesPerSecond: 1.5,
    /** Life of one hallucination [s]. It fades if it has not reached the player by then. */
    lifetimeSeconds: 12,
    /** Distance at which a hallucination reaches the player [tiles]. Contact: the player's body and the shape overlap. */
    reachTiles: 0.75,
    /** Damage of a harmful hallucination that reaches the player [HP]. §12.3 "ab 80 … echten Schaden": a scratch (5 % of the base health), dangerous only in numbers. */
    damage: 5,
  },
};
