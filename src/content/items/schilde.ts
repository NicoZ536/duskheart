/**
 * Shields T0–T1 (MASTERPROMPT §19.2 "Schilde: Holz (40 % Blockkraft), Bronze, Eisen, Turmschild (90 %, langsam)"; §12.2
 * "Mit Schild … hängt sie am Gürtel (−40 % Radius)"; docs/SPIEL.md §10 "Schilde (M6-09)", §14; M6-09).
 *
 * A shield is worn in the off hand (slot `nebenhand`) and carries a `schild` block: the share of a blocked hit's damage it
 * absorbs, the stamina each absorbed point costs and the walking tempo while blocking with it (src/game/combat/weapons.ts
 * `blockOf`). `werte.blockkraft` shows the same share in the tooltip. Worn, the carried light hangs on the belt. Iron and
 * tower shields follow in M8-29.
 *
 * - Durability [uses] per tier (§D); a blocked hit costs one use.
 * - Trade values [trade points]: the recipe's ingredients plus about a fifth.
 */
import { BALANCE } from '../balance';
import { baseItem, defineItemGroup, ITEM_SFX } from './define';

/** Tiers (§13.2). */
const T0 = 0;
const T1 = 1;

/** Block power of the wooden shield [share of the damage]. §19.2: "Holz (40 % Blockkraft)". */
const HOLZ_BLOCKKRAFT = 0.4;
/**
 * Block power of the bronze shield [share]. §19.2 names none; docs/SPIEL.md §10 "Bronze 60 %": between wood (40 %) and the
 * tower shield (90 %), the step of a metal face over boards.
 */
const BRONZE_BLOCKKRAFT = 0.6;

/** Shields T0–T1. */
export const SCHILDE = defineItemGroup('schilde', [
  baseItem({
    id: 'holzschild',
    name: { de: 'Holzschild', en: 'Wooden Shield' },
    beschreibung: {
      de: 'Ein runder Schild aus vernagelten Brettern mit Faserseil-Rand. Rechte Maustaste blockt 40 % eines Treffers – kurz vor dem Treffer gehoben, pariert er. Die Fackel hängt dann am Gürtel.',
      en: 'A round shield of nailed boards with a fibre-rope rim. The right mouse button blocks 40 % of a hit – raised just before the hit, it parries. The torch then hangs on the belt.',
    },
    kategorie: 'schild',
    stufe: T0,
    ausruestung: 'nebenhand',
    haltbarkeit: BALANCE.items.durabilityByTier[T0] as number,
    werte: { blockkraft: HOLZ_BLOCKKRAFT },
    // One stamina point per absorbed point of damage: boards jar the arm.
    schild: { blockkraft: HOLZ_BLOCKKRAFT, ausdauerJeSchaden: 1, tempoFaktor: 1 },
    tauschwert: 10,
    // A blow on the boards (src/content/sfx/kampf.ts): the block's sound.
    sounds: { aufheben: ITEM_SFX.holz, benutzen: 'sfx_kampf_block_holz' },
  }),
  baseItem({
    id: 'bronzeschild',
    name: { de: 'Bronzeschild', en: 'Bronze Shield' },
    beschreibung: {
      de: 'Ein Brettschild mit Bronzebuckel und Bronzerand. Blockt 60 % eines Treffers und kostet dabei weniger Ausdauer als Holz; wer mit ihm blockt, geht etwas langsamer.',
      en: 'A board shield with a bronze boss and a bronze rim. Blocks 60 % of a hit and costs less stamina than wood; blocking with it slows the step a little.',
    },
    kategorie: 'schild',
    stufe: T1,
    ausruestung: 'nebenhand',
    haltbarkeit: BALANCE.items.durabilityByTier[T1] as number,
    werte: { blockkraft: BRONZE_BLOCKKRAFT },
    // 0,8 stamina per absorbed point (the boss takes the shock); 95 % walking tempo while blocking (the weight).
    schild: { blockkraft: BRONZE_BLOCKKRAFT, ausdauerJeSchaden: 0.8, tempoFaktor: 0.95 },
    tauschwert: 43,
    // A blow on the bronze boss: the block rings.
    sounds: { aufheben: ITEM_SFX.werkzeug, benutzen: 'sfx_kampf_block_metall' },
  }),
]);
