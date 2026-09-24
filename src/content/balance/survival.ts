/**
 * Balance values of the survival stats (MASTERPROMPT §11.1, M3-17) and the temperature model (§11.2,
 * M3-18). Every value states its unit and the reason for it; `BALANCE.survival` (src/content/balance.ts)
 * re-exports the group.
 *
 * Time base: the rates of §11.1 ("−100 in 36 min", "+25/s") are simulation time – ticks at 60 Hz, one
 * simulated second is one real second at full game speed. A stat that empties "in 36 min" loses
 * 100 / (36 × 60) per simulated second; at the default day length (24 real minutes per day, §10) that is
 * one and a half game days.
 */
import type { WeatherStateId } from '../weather';

/** Stages of the core temperature (§11.2), coldest to hottest; `normal` between 36,0 and 38,0 °C. */
export const TEMPERATURE_STAGES = ['erfrierend', 'unterkuehlt', 'frierend', 'normal', 'erhitzt', 'ueberhitzt', 'hitzschlag'] as const;
/** One temperature stage (ids equal the condition ids of docs/SPIEL.md §6). */
export type TemperatureStage = (typeof TEMPERATURE_STAGES)[number];

export const SURVIVAL_BALANCE = {
  health: {
    /** Base maximum health [HP]. §11.1: "Leben 100 (+10 je Boss-Herzsplitter; + Ausrüstung/Mahlzeit)". */
    base: 100,
    /** Health regeneration [HP/s]. §11.1: "Regeneration 0,5/s, wenn Sättigung > 50, Durst > 30 und 5 s kein Schaden". */
    regenPerSecond: 0.5,
    /** Satiety above which health regenerates [points]. §11.1: "Sättigung > 50". */
    regenAboveSatiety: 50,
    /** Thirst above which health regenerates [points]. §11.1: "Durst > 30". */
    regenAboveThirst: 30,
    /** Time without damage before health regenerates [s]. §11.1: "5 s kein Schaden". */
    regenDamageFreeSeconds: 5,
    /** Regeneration factor while resting [factor]. §11.1: "×2 sitzend am Feuer oder im Bett". */
    restingRegenFactor: 2,
  },
  stamina: {
    /** Base maximum stamina [points]. §11.1: "Ausdauer 100 (+5 je Glutsplitter)". */
    base: 100,
    /** Stamina regeneration [points/s]. §11.1: "+25/s nach 0,8 s Pause". */
    regenPerSecond: 25,
    /** Pause after the last stamina use before it regenerates [s]. §11.1: "nach 0,8 s Pause". */
    regenDelaySeconds: 0.8,
    /** Satiety below which stamina regenerates slower [points]. §11.1: "−50 % bei Sättigung < 20". */
    hungryBelowSatiety: 20,
    /** Regeneration factor while hungry [factor]. §11.1: "−50 % bei Sättigung < 20". */
    hungryRegenFactor: 0.5,
    /** Sprinting cost [points/s]. §11.1: "Sprint 12/s". */
    sprintPerSecond: 12,
    /** Cost of a dodge roll [points]. §11.1: "Rolle 20"; a roll needs the full cost in reserve. */
    rollCost: 20,
    /** Swimming in deep water [points/s]. §11.1/§11.4: "Schwimmen 5/s", "Tiefwasser zehrt Ausdauer". */
    swimPerSecond: 5,
    /**
     * Stamina a sprint that ran dry needs back before it starts again [points]. Without it an emptied
     * bar would flicker between sprinting and walking every regeneration step; a quarter bar is one
     * second of recovery after the 0,8 s pause and two seconds of sprint.
     */
    sprintResumeStamina: 25,
  },
  satiety: {
    /** Satiety of a new character [points]. The shipwrecked starts fed (§8): the first hunger comes after a day of gathering, not in the first minutes. */
    start: 100,
    /** Time a full bar lasts without modifiers [min]. §11.1: "Sättigung −100 in 36 min" (simulated minutes). */
    minutesToEmpty: 36,
    /** Consumption factor while sprinting [factor]. §11.1: "×2 beim Sprinten". */
    sprintFactor: 2,
    /** Consumption factor while fighting or mining [factor]. §11.1: "×1,25 bei Kampf/Abbau". */
    exertionFactor: 1.25,
    /** Consumption factor under cold stress [factor]. §11.1: "×1,3 bei Kältestress" (felt temperature below the comfort band). */
    coldFactor: 1.3,
    /** Consumption factor while sleeping [factor]. §11.1: "×0,5 im Schlaf". */
    sleepFactor: 0.5,
    /** Satiety below which the player is hungry [points]. §11.1: "< 20 Hungrig". */
    hungryBelow: 20,
    /** Damage while starving (satiety 0) [HP/s]. §11.1: "0 Verhungernd (−1 HP/2 s)". */
    starvingDamagePerSecond: 0.5,
  },
  thirst: {
    /** Thirst of a new character [points]. As satiety: the first drink is needed on the first day, not at once. */
    start: 100,
    /** Time a full bar lasts without modifiers [min]. §11.1: "Durst −100 in 24 min" – one default day. */
    minutesToEmpty: 24,
    /** Consumption factor in heat [factor]. §11.1 "×1,5 bei Hitze", §11.2 "Erhitzt (Durst ×1,5)": the same factor, applied once. */
    heatFactor: 1.5,
    /** Thirst below which the player is thirsty [points]. As "Hungrig" (§11.1 "< 20"): the warning comes with a fifth of the bar left. */
    thirstyBelow: 20,
    /** Damage while dehydrating (thirst 0) [HP/s]. §11.1: "0 Verdurstend (−1 HP/s)". */
    dehydratedDamagePerSecond: 1,
  },
  wetness: {
    /** Wetting in rain [%/s]. §11.1: "Regen +2 %/s" – in the weather state `rainReference`, scaled by its precipitation. */
    rainPercentPerSecond: 2,
    /** Weather state whose precipitation wets at exactly `rainPercentPerSecond` [weather state]. §11.1 names "Regen"; drizzle wets less, a thunderstorm more. */
    rainReference: 'regen' as WeatherStateId,
    /** Drying next to a fire [%/s]. §11.1: "trocknet 1 %/s am Feuer" (inside the warmth of a heat source). */
    dryAtFirePercentPerSecond: 1,
    /** Drying indoors [%/s]. §11.1: "0,2 %/s innen". */
    dryIndoorsPercentPerSecond: 0.2,
    /** Drying outdoors [%/s]. §11.1: "0,1 %/s draußen". */
    dryOutdoorsPercentPerSecond: 0.1,
    /** Wetness from which the player counts as soaked [%]. Half wet: clothes have lost more than a third of their insulation (§11.2), worth a warning. */
    soakedFromPercent: 50,
  },
  exhaustion: {
    /** Time awake until exhaustion is full [min]. §11.1: "Erschöpfung +100 in 36 min Wachzeit". */
    minutesToFull: 36,
    /** Exhaustion above which the player is tired [points]. §11.1: "> 70 Müde". */
    tiredAbove: 70,
    /** Stamina regeneration factor while tired [factor]. §11.1: "Müde (−15 % Ausdauerregeneration)". */
    tiredStaminaRegenFactor: 0.85,
    /** Exhaustion above which the player is exhausted [points]. §11.1: "> 90 Erschöpft". */
    exhaustedAbove: 90,
    /** Action speed factor while exhausted [factor]. §11.1: "Erschöpft (−25 % Aktionstempo)". */
    exhaustedActionFactor: 0.75,
  },
  drowning: {
    /** Damage while swimming without stamina [HP/s]. §11.4: "bei 0 Ertrinken −5 HP/s". */
    damagePerSecond: 5,
  },
  temperature: {
    /** Normal core temperature [°C]. §11.1: "Kern 37,0 °C". */
    coreNormalC: 37,
    /** Lower edge of the comfort band without clothing [°C]. §11.2: "[18 − Isolation × (1 − 0,7 × Nässe), …]". */
    comfortLowC: 18,
    /** Upper edge of the comfort band without clothing [°C]. §11.2: "[…, 26 + Kühlung]". */
    comfortHighC: 26,
    /** Largest clothing insulation [°C]. §11.2: "Kleidung liefert Isolation (0–40)". */
    maxInsulation: 40,
    /** Largest clothing cooling [°C]. §11.2: "Kühlung (0–15)". */
    maxCooling: 15,
    /** Share of the insulation a soaked player loses [factor]. §11.2 "Isolation × (1 − 0,7 × Nässe)", §11.1 "senkt Isolation um bis zu 70 %". */
    wetInsulationLoss: 0.7,
    /** Core change per degree of stress [°C/s per °C]. §11.2: "Kerntemperatur ändert sich um 0,002 °C/s × Stress". */
    stressRatePerSecond: 0.002,
    /** Return towards the normal core temperature inside the band [°C/s]. §11.2: "im Band Rückkehr zu 37,0 mit 0,01 °C/s". */
    returnRatePerSecond: 0.01,
    /**
     * Lowest core temperature [°C]. The deepest stage (Erfrierend < 33 °C) applies well above it; the
     * bound keeps the way back finite after long exposure (debug god mode, a long death screen).
     */
    coreMinC: 28,
    /** Highest core temperature [°C]. As `coreMinC`: Hitzschlag starts at 40,5 °C, the bound keeps recovery finite. */
    coreMaxC: 44,
    /** Stage thresholds [°C]. §11.2: "< 36,0 Frierend · < 35,0 Unterkühlt · < 33,0 Erfrierend · > 38,0 Erhitzt · > 39,0 Überhitzt · > 40,5 Hitzschlag". */
    stages: { frierendBelow: 36, unterkuehltBelow: 35, erfrierendBelow: 33, erhitztAbove: 38, ueberhitztAbove: 39, hitzschlagAbove: 40.5 },
    /** Precision and work speed factor from Frierend on [factor]. §11.2: "Frierend (−10 % Präzision und Arbeitstempo, Zittern)". */
    coldWorkFactor: 0.9,
    /** Maximum stamina factor from Unterkühlt on [factor]. §11.2: "Unterkühlt (−30 % max. Ausdauer …)". */
    hypothermiaStaminaFactor: 0.7,
    /** Stamina regeneration factor from Überhitzt on [factor]. §11.2: "Überhitzt (−50 % Ausdauerregeneration …)". */
    overheatedStaminaRegenFactor: 0.5,
    /** Damage per stage [HP/s]. §11.2: "Unterkühlt −0,5 HP/s · Erfrierend −2 HP/s · Überhitzt −0,5 HP/s · Hitzschlag −2 HP/s" (the stage's own rate, not summed). */
    stageDamagePerSecond: { erfrierend: 2, unterkuehlt: 0.5, frierend: 0, normal: 0, erhitzt: 0, ueberhitzt: 0.5, hitzschlag: 2 } satisfies Record<TemperatureStage, number>,
    /**
     * Warmth of a fire [°C, tiles]. §11.2 "Feuer +15 °C im Kern, zum Rand abfallend": the full 15 °C on
     * the fire's tile and the seats around it (1,5 tiles), falling linearly to nothing at 5 tiles –
     * well inside the 8-tile light circle of a camp fire (§12.2), so the warm spot is visibly lit.
     */
    fire: { coreHeatC: 15, coreRadiusTiles: 1.5, radiusTiles: 5 },
    /**
     * The castaway's own clothes (§8: shipwrecked on the start beach; the figure wears them as the layers
     * `ausruestung_leinentunika` and `ausruestung_leinenhose` under any armour) – insulation per piece [°C],
     * always worn, never an item (no source of linen before spinning and tailoring). Together 6 °C lower
     * the comfort band to 12 °C: the start beach in spring (≈ 8 °C at dawn, 20 °C in the afternoon) chills
     * the core only a little in the first morning hours (≈ 36,1 °C, never Frierend) and is comfortable all
     * day, while a night without a fire still sinks it to 33–35 °C by dawn (Unterkühlt) – the first fire
     * stays the goal of day 1 (§32 M3 "Nacht überleben"). Without them the player froze to death on the
     * beach before noon of day 1.
     */
    ownClothing: { tunicInsulationC: 4, trousersInsulationC: 2 },
  },
};
