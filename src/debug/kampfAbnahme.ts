/**
 * Acceptance pictures of the fight (M6-37; MASTERPROMPT §32 M6 "Screenshots `kampf-tag`, `kampf-nacht`", §4.5, §4.6,
 * §19.1, §19.4, §12.4):
 *
 * - `kampf-tag`: Grünhain in the last daylight before the evening twilight (18:05 in spring – the sun still full, the wolves
 *   awake: they hunt in the twilight and at night, docs/SPIEL.md §15). The player in the full bronze set with the bronze sword
 *   and the bronze shield, on open ground (the ring of the pack, 3,5 tiles, free of trees and crowns); a pack of three wolves
 *   (one `spawn wolf 3`: one pack) rests south of it. A swing into the air calls them (its noise, §19.4 Gehör): they come
 *   and spread around the player (M6-18), and the third wind-up – the pack by then on its ring north-west, north-east and
 *   south of the player, more than 90° apart (M6 gate visual:kampf-tag-no-flank; the first wind-up came while they still
 *   ran up in one file) – comes from the north-east wolf, crouched, the glint at its head (§4.6 "Telegraphs"), in profile:
 *   the picture is three ticks into it, the shield raised towards it.
 * - `kampf-nacht`: a Grünhain night (23:00), the player in the bronze set with a lit torch in the off hand and the bronze
 *   sword. A first swing into the dark calls the shadow brood (its noise, §19.4 Gehör); it comes up to the rim of the torch's
 *   light and keeps there (§12.4 "meidet Licht > 0,5") – glowing eyes and inky bodies at the rim, the Speier further out.
 *   The Speier's glob is in flight towards the player, who swings towards it.
 *
 * Both are built on the combat scenarios' driver (src/debug/kampfScenarios.ts `kampfScenario`): commands only, a fixed
 * world and fixed tick counts or event counts, god mode – every run draws the same picture. Registered in
 * src/debug/scenarios.ts.
 */
import { equipmentRef, type EquipmentSlot } from '../game/items/slots';
import type { GameCameraStart } from '../render/world/gameScene';
import { TILE_PX } from '../world/model/coords';
import { aim, kampfScenario, type KampfScenario, type Spot } from './kampfScenarios';

/** Scenario names (§32 M6). */
export const KAMPF_TAG = 'kampf-tag';
export const KAMPF_NACHT = 'kampf-nacht';

const GRUENHAIN: GameCameraStart = { kind: 'biom', biome: 'gruenhain' };

/** The bronze set (helmet, cuirass, greaves, boots) and the slots its pieces go to, in this order. */
const BRONZE_SET: readonly (readonly [string, EquipmentSlot])[] = [
  ['bronzehelm', 'kopf'],
  ['bronzebrustpanzer', 'brust'],
  ['bronzebeinschienen', 'beine'],
  ['bronzestiefel', 'fuesse'],
];

/**
 * The commands that put the bronze set on a player whose hand holds the sword (hotbar slot 0) and whose bags are empty
 * otherwise: the pieces land in the inventory slots 0–3 in order and go onto head, chest, legs and feet; with `shield`
 * the bronze shield lands in the hotbar's next slot (shields go to the hotbar first) and goes into the off hand.
 */
function bronzeKit(shield: boolean): unknown[] {
  return [
    ...BRONZE_SET.map(([item]) => ({ type: 'inventory.give', item, count: 1 })),
    ...BRONZE_SET.map(([, slot], i) => ({ type: 'inventory.move', from: { bereich: 'inventar', index: i }, to: equipmentRef(slot) })),
    ...(shield
      ? [
          { type: 'inventory.give', item: 'bronzeschild', count: 1 },
          { type: 'inventory.move', from: { bereich: 'schnellleiste', index: 1 }, to: equipmentRef('nebenhand') },
        ]
      : []),
  ];
}

/** Clock time of `kampf-tag`: five minutes after sunset in spring (daylight 0,99, the twilight's wolves awake). */
const DAY_TIME = { hour: 18, minute: 5 } as const;
/** Clock time of `kampf-nacht`: deep night. */
const NIGHT_TIME = { hour: 23, minute: 0 } as const;
/** Where the wolf pack appears, relative to the player [tiles]: south – a new creature faces south, it does not see the player. */
const PACK_AT: readonly [number, number] = [0, 5];
/** Wolves of the pack. */
const PACK_SIZE = 3;
/** Where the player swings to call the pack: south, towards it. */
const GUARD: readonly [number, number] = [0, 1];
/** The ring of the pack around the player [tiles] must be open ground: its wolves stand in the picture, not under crowns. */
const PACK_RING: readonly (readonly [number, number])[] = [
  [3, 0],
  [-3, 0],
  [2, 2],
  [-2, 2],
  [3, -2],
  [-3, -2],
];
/** The wind-up of the picture: the third – by then the pack circles on its ring (the first came while it ran up in one file). */
const PICTURE_WINDUP = 3;
/** Where the shield goes up at the picture: towards the north-east wolf that winds up then (the run is deterministic). */
const SHIELD_TOWARDS: readonly [number, number] = [2, -1];
/** Ticks of the swing that calls the pack (press, then the release and its wind-up and blow). */
const CALL_TICKS = 20;
/** Ticks into the first wind-up when the picture is taken (the glint lives 12 ticks, the wolf's wind-up 24). */
const WINDUP_TICKS = 3;
/** Longest wait for the pack's first wind-up, or the Speier's glob [ticks]. */
const WAIT_TICKS = 900;
/** Ticks for the brood to form (0,9 s materialisation, §19.4 fairness) before the player makes a noise. */
const BROOD_FORM_TICKS = 60;
/** Ticks the brood takes from the noise of the player's first swing to the rim of the torch's light. */
const BROOD_RIM_TICKS = 150;
/** Where the Speier stands, relative to the player [tiles]: north-east – the glob comes from there, the player swings there. */
const SPEIER_AT: readonly [number, number] = [1, -6];
/** Points of the rim of the torch's light around the player [tiles] (light 0,5 lies 2–2,5 tiles out, §12.4). */
const RIM: readonly (readonly [number, number])[] = [
  [3, 0],
  [-3, 0],
  [0, 3],
  [2, 2],
  [-2, 2],
];
/** Ticks of the swing and the glob's flight before the picture (the swing lands after its 8-tick wind-up, its trail stands). */
const GLOB_TICKS = 12;

/** A pack of `count` creatures `creature` (one spawn command: one pack) `at` tiles from the player. */
function packAt(at: Spot, creature: string, count: number, o: readonly [number, number]): unknown {
  return { type: 'creature.spawn', creature, count, x: Math.round(at.x + o[0] * TILE_PX), y: Math.round(at.y + o[1] * TILE_PX), layer: 0 };
}

/** The acceptance pictures `kampf-tag` and `kampf-nacht`. */
export function kampfAbnahmeScenarios(): KampfScenario[] {
  return [
    kampfScenario({
      name: KAMPF_TAG,
      description:
        'M6-37: Grünhain kurz nach Sonnenuntergang (18:05, volles Tageslicht) – der Spieler in Bronzerüstung mit Bronzeschwert und Bronzeschild auf offenem Grund; ein Hieb in die Luft lockt ein Wolfsrudel (drei Wölfe), es kreist um ihn – nordwestlich, nordöstlich und südlich, über 90° verteilt (flankiert) –, und der Wolf im Nordosten holt aus, geduckt im Profil, der Glint am Kopf; der Spieler hebt ihm den Schild entgegen: Bild drei Ticks in die dritte Ausholphase',
      start: GRUENHAIN,
      time: DAY_TIME,
      weather: 'klar',
      items: [{ item: 'bronzeschwert', count: 1 }],
      cast: [],
      targets: [PACK_AT, ...PACK_RING],
      // Grey wolves on grey builder paving keep only their outline (M6 gate): the pack's ring lies on the meadow.
      naturalGround: true,
      script: [
        { commands: (at) => [...bronzeKit(true), packAt(at, 'wolf', PACK_SIZE, PACK_AT)], ticks: 2 },
        // A swing towards the pack: they hear it and come.
        { commands: (at) => [aim(at, GUARD[0], GUARD[1]), { type: 'combat.attack', on: true }], ticks: 1 },
        { commands: () => [{ type: 'combat.attack', on: false }], ticks: CALL_TICKS },
        // The pack circles; at its third wind-up the shield goes up towards the wolf that winds up.
        { commands: () => [], ticks: PICTURE_WINDUP * WAIT_TICKS, until: { event: 'creatureTelegraph', count: PICTURE_WINDUP } },
        { commands: (at) => [aim(at, SHIELD_TOWARDS[0], SHIELD_TOWARDS[1]), { type: 'combat.block', on: true }], ticks: WINDUP_TICKS },
      ],
    }),
    kampfScenario({
      name: KAMPF_NACHT,
      description:
        'M6-37: Grünhain-Nacht (23:00) – der Spieler in Bronzerüstung mit brennender Fackel und Bronzeschwert; ein erster Hieb ins Dunkel lockt die Schattenbrut, sie kommt bis an den Rand des Fackellichts und bleibt dort (meidet Licht > 0,5): glühende Augen und Tintenleiber am Lichtrand, weiter draußen der Speier, dessen Geschoss auf den Spieler zufliegt, während der Spieler ihm entgegenschlägt',
      start: GRUENHAIN,
      time: NIGHT_TIME,
      weather: 'klar',
      items: [{ item: 'bronzeschwert', count: 1 }],
      torch: true,
      cast: [
        { creature: 'schleicher', dx: 4, dy: 0 },
        { creature: 'schleicher', dx: -4, dy: -1 },
        { creature: 'kriecher', dx: -2, dy: 4 },
        { creature: 'speier', dx: SPEIER_AT[0], dy: SPEIER_AT[1] },
      ],
      castAnywhere: true,
      // The Speier's line and the rim of the light around the player are open ground without crowns over them: the glob flies
      // in the open, the brood at the rim is not hidden under trees.
      targets: [SPEIER_AT, ...RIM],
      script: [
        { commands: () => bronzeKit(false), ticks: BROOD_FORM_TICKS },
        // A swing into the dark: its noise (§19.4 Gehör) calls the brood, which comes up to the rim of the torch's light.
        { commands: (at) => [aim(at, SPEIER_AT[0], SPEIER_AT[1]), { type: 'combat.attack', on: true }], ticks: 1 },
        { commands: () => [{ type: 'combat.attack', on: false }], ticks: BROOD_RIM_TICKS },
        // The Speier spits; the player swings towards it as the glob flies.
        { commands: () => [], ticks: WAIT_TICKS, until: { event: 'projectileFired', count: 1 } },
        { commands: (at) => [aim(at, SPEIER_AT[0], SPEIER_AT[1]), { type: 'combat.attack', on: true }], ticks: 1 },
        { commands: () => [{ type: 'combat.attack', on: false }], ticks: GLOB_TICKS },
      ],
    }),
  ];
}
