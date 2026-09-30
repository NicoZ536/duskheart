/**
 * Which combat preset sounds for which event (M6-33; presets in src/content/sfx/kampf.ts): the swing by damage type and
 * the heavy swing, the hit by damage type (§19.3) with the accent of a critical hit, drawing/reloading and releasing
 * by ranged class, an arrow stuck in ground or wall, and the defence (block on wood, metal or the bare hand, the guard
 * breaking, the parry). Read by the event table (`eventMap.ts`); weapons name their own swing in `sounds.benutzen`.
 */
/** Swing sound of a damage type, and of the heavy attack. */
export const KAMPF_SCHWUNG_SFX = {
  hieb: 'sfx_kampf_schwung_hieb',
  stich: 'sfx_kampf_schwung_stich',
  wucht: 'sfx_kampf_schwung_wucht',
  schwer: 'sfx_kampf_schwung_schwer',
} as const;

/** Hit sound per damage type (§19.3), and the accent of a critical hit. */
export const KAMPF_TREFFER_SFX = {
  hieb: 'sfx_kampf_treffer_hieb',
  stich: 'sfx_kampf_treffer_stich',
  wucht: 'sfx_kampf_treffer_wucht',
  feuer: 'sfx_kampf_treffer_feuer',
  frost: 'sfx_kampf_treffer_frost',
  gift: 'sfx_kampf_treffer_gift',
  licht: 'sfx_kampf_treffer_licht',
  schatten: 'sfx_kampf_treffer_schatten',
} as const;

/** The accent of a critical hit. */
export const KAMPF_KRITISCH_SFX = 'sfx_kampf_kritisch';

/** Ranged weapons: drawing or reloading (`attackWindup`) and releasing (`projectileFired`) by class. */
export const KAMPF_FERN_SFX = {
  spannen: { bogen: 'sfx_kampf_bogen_spannen', armbrust: 'sfx_kampf_armbrust_laden', schleuder: 'sfx_kampf_schleuder_wirbel' },
  loslassen: { bogen: 'sfx_kampf_bogen_sehne', armbrust: 'sfx_kampf_armbrust_schuss', schleuder: 'sfx_kampf_schleuder_wurf', wurf: 'sfx_kampf_wurf' },
  /** An arrow or bolt stuck in ground or wall. */
  steckt: 'sfx_kampf_pfeil_steckt',
} as const;

/** Defence: a block on wood, on metal, on the bare hand or a haft; the guard breaking; the parry. */
export const KAMPF_ABWEHR_SFX = {
  holz: 'sfx_kampf_block_holz',
  metall: 'sfx_kampf_block_metall',
  hand: 'sfx_kampf_block_faust',
  bricht: 'sfx_kampf_deckung_bricht',
  parade: 'sfx_kampf_parade',
} as const;
