/**
 * Balance values of the perks (MASTERPROMPT §23.2 "Bei 30/60/90 Wahl zwischen 2 Perks …, alle spürbar"; M6-34) – group
 * `BALANCE.perks` (src/content/balance.ts re-exports it). The perks and their effect values are content
 * (src/content/perks.ts); what no single perk carries – the thresholds and limits their effects work against – lives here.
 * Every value states its unit and the reason for it.
 */
export const PERK_BALANCE = {
  /**
   * Health below which a foe counts as nearly beaten for `nahkampf_gnadenstoss` [share of its maximum health]. Three tenths:
   * a normal foe of a tier falls after 4–6 hits (§D), so the last one or two hits are the finishing blows.
   */
  lowHealthShare: 0.3,
  /**
   * Highest block power a perk can raise a block to [share of the damage]. A block never becomes invulnerability: 5 % of
   * every blocked hit still lands (the tower shield's 90 % leaves room for one step, §19.2).
   */
  blockPowerMax: 0.95,
};
