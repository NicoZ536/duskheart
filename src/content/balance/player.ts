/**
 * Balance values of the player's body (MASTERPROMPT §11.4, M3-08, M3-09): movement speeds, armour
 * weight, the dodge roll, cliffs and water, the spawn on the start beach. Every value states its unit
 * and the reason for it; `BALANCE.player` (src/content/balance.ts) re-exports the group. Stamina costs
 * of these actions belong to the vitals (`BALANCE.survival.stamina`, §11.1).
 */

/** Armour weight classes (§11.4 "Rüstungsgewicht: leicht, mittel, schwer"). */
export const ARMOR_WEIGHTS = ['leicht', 'mittel', 'schwer'] as const;
/** One armour weight class. */
export type ArmorWeight = (typeof ARMOR_WEIGHTS)[number];

/** Movement modes of the player's body (state machine of src/game/player/system.ts). */
export const PLAYER_MOVE_STATES = ['idle', 'walk', 'sprint', 'sneak', 'roll', 'swim', 'jump', 'climb'] as const;
/** One movement mode. */
export type PlayerMoveState = (typeof PLAYER_MOVE_STATES)[number];

export const PLAYER_BALANCE = {
  movement: {
    /** Walking speed [tiles/s]. §11.4: "Gehen 4,5 Tiles/s". */
    walkTilesPerSecond: 4.5,
    /** Sprinting speed [tiles/s]. §11.4: "Sprint 7"; costs stamina (§11.1 "Sprint 12/s"). */
    sprintTilesPerSecond: 7,
    /** Sneaking speed [tiles/s]. §11.4: "Schleichen 2,5 (Geräusch −70 %)". */
    sneakTilesPerSecond: 2.5,
    /** Swimming speed in deep water [tiles/s]. §11.4: "Schwimmen 2,5 (Tiefwasser zehrt Ausdauer)". */
    swimTilesPerSecond: 2.5,
    /** Speed factor per armour weight class [factor]. §11.4: "leicht 0 %, mittel −5 %, schwer −10 % Tempo". */
    armorWeightFactor: { leicht: 1, mittel: 0.95, schwer: 0.9 } satisfies Record<ArmorWeight, number>,
    /**
     * Noise of each movement mode relative to walking [factor], read by creature perception (§19.4).
     * §11.4 "Schleichen … Geräusch −70 %" ⇒ 0,3; standing makes no sound; running feet are heard half
     * again as far; climbing a ladder is careful and quieter than walking; a splashing swimmer, a roll
     * and a landing are as loud as steps.
     */
    noise: { idle: 0, walk: 1, sprint: 1.5, sneak: 0.3, roll: 1, swim: 1, jump: 1, climb: 0.5 } satisfies Record<PlayerMoveState, number>,
    /**
     * Radius of the player's collision circle [px]. The feet of `spieler_koerper` are 8 px wide (its
     * hitbox 8 × 5 px); a 10 px circle keeps 3 px free on each side of a one-tile gap between two trees,
     * so the player slips through the gaps a 16 px tile promises (the M2-23 collision tests use it too).
     */
    colliderRadiusPx: 5,
    /**
     * Distance between two footstep events [tiles]. The walk clip (M3-05: 6 frames at 10 fps, two
     * footfalls per cycle) sets ≈ 3,3 steps per second at 4,5 tiles/s ⇒ 1,35 tiles; 1,5 tiles keeps the
     * step sounds of walking and sprinting (4,7 per second) from blurring into a rattle.
     */
    stepLengthTiles: 1.5,
    /**
     * Change of movement direction below which the facing stays [input units]. A diagonal input keeps
     * the facing of its larger axis; only a turn clearly past the diagonal switches the four-way sprite,
     * so a stick near 45° does not flicker between two directions.
     */
    facingHysteresis: 0.1,
  },
  roll: {
    /** Distance of a dodge roll [tiles]. §11.4: "Rolle 3 Tiles". */
    distanceTiles: 3,
    /**
     * Duration of a roll [s]. The roll clip has 5 frames (M3-05) at 12 fps ≈ 0,42 s; 0,4 s (24 ticks)
     * gives 7,5 tiles/s – a dodge outruns a sprint (7 tiles/s), so rolling away from a blow pays off.
     */
    durationSeconds: 0.4,
    /** Invulnerability at the start of a roll [s]. §11.4/§19.1: "Rolle … 0,25 s Unverwundbarkeit". */
    invulnerableSeconds: 0.25,
  },
  cliffs: {
    /** Levels a jump down is harmless for [levels]. §11.4: "1 Stufe gefahrlos". */
    safeDropLevels: 1,
    /**
     * Fall damage per level beyond the safe one [HP/level]. §11.4 "2 Stufen Schaden": a two-level jump
     * costs 15 % of the base health (noticeable, never dangerous from full health); the highest cliff of
     * the world (4 levels, §9.1) costs 45 HP.
     */
    damagePerExtraLevel: 15,
    /** Drop from which a bone may break [levels]. §11.4: "ab 3 Knochenbruch-Risiko". */
    fractureMinLevels: 3,
    /** Chance of a bone fracture at `fractureMinLevels` [probability]. A three-level jump is a real gamble: less than even, but far from rare. */
    fractureChanceAtMin: 0.4,
    /** Additional fracture chance per level beyond `fractureMinLevels` [probability/level]. The four-level drop (the highest, §9.1) breaks a bone in 7 of 10 jumps. */
    fractureChancePerExtraLevel: 0.3,
    /**
     * How long the player must push against a cliff face from its top edge before jumping [s]. Brushing
     * along an edge while walking never throws the player off; a deliberate push jumps after 12 ticks.
     */
    jumpHoldSeconds: 0.2,
    /**
     * Input component towards the cliff needed to push against it [input units]. A diagonal input
     * (0,71) counts, a stick that only grazes the edge while walking along it does not.
     */
    pushInputMin: 0.5,
    /** Flight time of a jump down per level [s]. One level is a quick hop (0,18 s), the highest cliff a clearly visible fall (0,72 s). */
    jumpSecondsPerLevel: 0.18,
    /** Climbing time on a placed ladder per level [s]. Climbing is slow and leaves the player exposed; a two-level ladder takes two seconds. */
    climbSecondsPerLevel: 1,
  },
  spawn: {
    /**
     * Search radius around the start beach centre for a free tile [tiles]. The beach disc has a radius of
     * 6 tiles (src/world/gen/locations.ts `startRadius`); four times that finds open ground even when a
     * rock or driftwood sits on the centre.
     */
    searchRadiusTiles: 24,
  },
};
