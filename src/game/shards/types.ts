/**
 * Heart and ember shards (docs/SPIEL.md §22 "Splitter", MASTERPROMPT §20.2, §21; ADR-0175; strand F, system `shards`): using
 * one (`ToolsSystem.addItemUse`) consumes it for good – a heart shard +10 max. health, an ember shard +5 max. stamina, as a
 * modifier source of the player (`PlayerInfluences.addModifierSource`); the used ones are saved (participant `shards`).
 */
export interface ShardsApi {
  used(kind: 'herz' | 'glut'): number;
}
