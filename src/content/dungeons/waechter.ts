/**
 * The guards of the vaults (docs/SPIEL.md §29 "Wächter …", M7-15): a construct in the guard chambers, a trap ghost in the trap
 * rooms, the Wurzelhüter in the end chamber and the mimic among the chests. The vault plan (src/world/gen/vaults/plan.ts)
 * leaves out a creature the content does not have; they rise as owned creatures `gewoelbe:<slot>` (VaultsSystem), never from a
 * spawn table – the content validator reads this list for that. A module without imports, so tools can read it cheaply.
 */
export const VAULT_GUARDS = { chamber: 'erbauer_konstrukt_1', trapRoom: 'fallengeist', boss: 'wurzelhueter', mimic: 'mimik_truhe' } as const;
