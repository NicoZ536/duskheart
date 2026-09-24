/**
 * Balance values of tools and weapons by tier (MASTERPROMPT §13.2 "Abbaukraft", §14 "Werkzeuge", §D
 * "Waffenschaden Basis je Stufe", "Klassenfaktor"; M3-15) – group `BALANCE.tools` (src/content/balance.ts
 * re-exports it). Durability per tier stays with the items (`BALANCE.items.durabilityByTier`, §D). Every
 * value states its unit and the reason for it.
 */

/** Weapon classes of §D with their damage factor. */
export const WEAPON_CLASSES = ['dolch', 'schwert', 'speer', 'keule', 'axt', 'bogen', 'armbrust', 'zweihand'] as const;
/** One weapon class. */
export type WeaponClass = (typeof WEAPON_CLASSES)[number];

export const TOOL_BALANCE = {
  /**
   * Mining power of a tool per tier T0–T7 [power]. §13.2 table "Abbaukraft": T0 1 · T1 2 · T2 3 · T3 4 ·
   * T4 5 · T5 6 · T6 7 · T7 8 – a tool opens resources whose hardness is at most its power.
   */
  miningPowerByTier: [1, 2, 3, 4, 5, 6, 7, 8],
  /** Base weapon damage per tier T0–T7 [HP per hit]. §D: "T0 8 · T1 12 · T2 17 · T3 24 · T4 33 · T5 45 · T6 60 · T7 78". */
  weaponDamageByTier: [8, 12, 17, 24, 33, 45, 60, 78],
  /**
   * Damage factor of each weapon class [factor on the base damage]. §D: "Dolch ×0,6 (schnell) · Schwert
   * ×1,0 · Speer ×0,95 · Keule ×1,1 · Axt ×1,15 · Bogen ×1,1 (voll gespannt) · Armbrust ×1,6 · Zweihand ×1,8".
   */
  weaponClassFactor: { dolch: 0.6, schwert: 1, speer: 0.95, keule: 1.1, axt: 1.15, bogen: 1.1, armbrust: 1.6, zweihand: 1.8 } satisfies Record<WeaponClass, number>,
};
