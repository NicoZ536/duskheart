/** Inventory, equipment and stats screen (M3-30): the screen, its gesture rules, the stats panel and the DOM item icons. */
export { InventoryScreen, type InventoryScreenProps } from './InventoryScreen';
export {
  carryConfirm,
  clickIntent,
  comparisonSlot,
  discardIntent,
  DISCARD_CONFIRM_FROM,
  DOLL_LEFT,
  DOLL_RIGHT,
  dropIntent,
  equipmentSlotRef,
  GRID_COLUMNS,
  gridRows,
  hotbarIntent,
  needsDiscardConfirm,
  parseSlotKey,
  slotKey,
  stackAt,
  type CarryStep,
  type ClickGesture,
  type SlotIntent,
} from './model';
export { statGroups, type StatGroup, type StatRow, type StatTone, type VitalsValues } from './stats';
export { atlasImagesVersion, ensureAtlasImages, hasSprite, itemIconUrl, layeredImage, spriteImageUrl, type LayeredImage } from './itemIcons';
export { Glyph, glyphRuns, GLYPH_SIZE, type GlyphId } from './glyphs';
