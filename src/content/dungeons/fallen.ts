/**
 * The vault traps (MASTERPROMPT §21 "Fallen: Speerfallen, Pfeilwerfer, Rollsteine, Fallgruben, Giftgas, Flammenwerfer, einstürzende
 * Böden, Pendelklingen"; docs/SPIEL.md §19 "Fallen M7", §29; M7-14; collection `vaultTraps`, named apart from the M6 traps
 * `traps`). Every trap warns at least 0.4 s before it strikes (§4.6, ART §7 "Vorwarnung"), hurts with cause `falle`, and
 * creatures trigger it too (src/game/vaults/traps.ts). Damage fits §D: a trap costs a fifth of the start health, the boulder
 * a third – painful, never a death from full health on Normal. Giftgas and Flammenwerfer come with M8-19.
 *
 * - `speerfalle`: holes in a floor plate; stepping on it raises the spear tips (click, glint), then they thrust.
 * - `pfeilwerfer`: a Builder head in the wall line; anyone in its line within reach makes its eyes glow, then a bolt flies.
 * - `rollstein`: a boulder at the end of a lane; anyone in the lane starts it rumbling, it rolls to the wall and comes back.
 * - `fallgrube`: a cracked cover; it sags and crumbles under a step, then gives way – the pit stays open a while.
 * - `einsturzboden`: dust trickles and cracks grow for two seconds, then the floor falls in and stays a hole.
 * - `pendelklinge`: a blade swings on its beat across three tiles; its arc is the warning.
 */
import type { VaultTrapInput } from './schema';

export const VAULT_TRAPS: readonly VaultTrapInput[] = [
  {
    id: 'speerfalle',
    name: { de: 'Speerfalle', en: 'Spear Trap' },
    schaden: 18,
    schadensart: 'stich',
    telegraphSekunden: 0.5,
    abklingSekunden: 2.5,
    ausloeser: 'platte',
    sprite: 'gw_falle_speer',
    sound: 'sfx_falle_speer',
  },
  {
    id: 'pfeilwerfer',
    name: { de: 'Pfeilwerfer', en: 'Dart Thrower' },
    schaden: 12,
    schadensart: 'stich',
    telegraphSekunden: 0.6,
    abklingSekunden: 3,
    ausloeser: 'naehe',
    sprite: 'gw_falle_pfeilwerfer',
    sound: 'sfx_falle_pfeil',
  },
  {
    id: 'rollstein',
    name: { de: 'Rollstein', en: 'Rolling Boulder' },
    schaden: 30,
    schadensart: 'wucht',
    telegraphSekunden: 1,
    abklingSekunden: 2,
    ausloeser: 'naehe',
    resetSekunden: 8,
    sprite: 'gw_falle_rollstein',
    sound: 'sfx_falle_rollstein',
  },
  {
    id: 'fallgrube',
    name: { de: 'Fallgrube', en: 'Pit Trap' },
    schaden: 15,
    schadensart: 'wucht',
    telegraphSekunden: 0.5,
    abklingSekunden: 6,
    ausloeser: 'platte',
    sprite: 'gw_falle_grube',
    sound: 'sfx_falle_grube',
  },
  {
    id: 'einsturzboden',
    name: { de: 'Einstürzender Boden', en: 'Collapsing Floor' },
    schaden: 20,
    schadensart: 'wucht',
    telegraphSekunden: 2,
    abklingSekunden: 1,
    ausloeser: 'platte',
    bleibtOffen: true,
    sprite: 'gw_falle_einsturz',
    sound: 'sfx_falle_einsturz',
  },
  {
    id: 'pendelklinge',
    name: { de: 'Pendelklinge', en: 'Pendulum Blade' },
    schaden: 16,
    schadensart: 'hieb',
    telegraphSekunden: 0.6,
    abklingSekunden: 1.2,
    ausloeser: 'takt',
    sprite: 'gw_falle_pendel',
    sound: 'sfx_falle_pendel',
  },
];
