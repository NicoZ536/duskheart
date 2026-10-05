/** Tooltips of the UI (MASTERPROMPT §26): item tooltip model and panel, placement, rarity colours, "Verwendet in"/"Herkunft" lookup and index. */
export { armorSetOf, itemTooltip, formatStat, setBonusText, statValue, MAX_NAMES, STALE_FRESHNESS, type ItemTooltipInput, type ItemTooltipModel, type TooltipComparison, type TooltipLine, type TooltipSection, type TooltipTone } from './itemTooltip';
export { contentItemLookup, createItemLookup, sourceGroups, useGroups, type ItemLookup, type SourceGroup, type UseGroup } from './lookup';
export { placeTooltip, type TooltipFrame, type TooltipGlyph, type TooltipObstacles, type TooltipPlacement, type TooltipSize } from './place';
export { breaksWord, FONT_BOX, FONT_INK, fontInk, glyphBox, glyphInk, readObstacles, wordInk, type Edges, type FoundObstacles, type GlyphInk, type MeasuredChar } from './obstacles';
export { rarityHex, rarityRank, rarityTokens, rarityVar } from './rarity';
export { ItemTooltip, tooltipTokens, type ItemTooltipProps } from './Tooltip';
export {
  brennstellenNamen,
  buildVerwendungsindex,
  contentBrennstellen,
  contentVerwendungsindex,
  herkunftsGruppen,
  stationRepariert,
  verwendungsGruppen,
  type Bauteil,
  type Bezug,
  type Brennstelle,
  type Eintrag,
  type VerwendungsDaten,
  type Verwendungsindex,
} from './verwendung';
