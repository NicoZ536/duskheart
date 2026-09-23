/**
 * UI kit (MASTERPROMPT §26 "eigener Pixel-UI-Look (Holz, Eisen, Pergament – passend zur Welt),
 * einheitliche 9-Slice-Rahmen, eine Pixelschrift, ganzzahlige UI-Skalierung (Auto oder 1×–4×).
 * Keine Standard-Web-Widgets, eigene Pixel-Scrollbars."):
 *
 * - `Frame` (Holz/Eisen/Pergament), `Button` (normal/hover/gedrückt/gesperrt), `Slot`, `Bar`
 *   (Leben/Ausdauer), `ScrollArea` (Pixel-Scrollbar) – components inside a `.dh-kit` root;
 * - pixel math (`uiPx`, `barFillPx`, `thumbGeometry`, `snapScroll`);
 * - `mountGallery` for the screenshot scenarios `schrift` and `ui-kit`.
 *
 * Graphics, their CSS classes and the font tokens are build artefacts of `npm run assets`
 * (`assets-src/ui/**` → `public/generated/ui/*.png`, `src/generated/ui-kit.css`, `src/generated/ui.ts`).
 */
import '../../generated/ui-kit.css';
import './kit.css';

export { barFillPx, scrollForThumb, snapScroll, thumbGeometry, uiPx, type ThumbGeometry } from './geometry';
export { GALLERY_KINDS, mountGallery, SCHRIFTPROBE, type GalleryHandle, type GalleryKind } from './gallery';
export { MIN_THUMB, ScrollArea, type ScrollAreaProps } from './ScrollArea';
export {
  BAR_ARTEN,
  Bar,
  barInnerWidth,
  Button,
  Frame,
  FRAME_ARTEN,
  Slot,
  type BarArt,
  type BarProps,
  type ButtonProps,
  type ForcedState,
  type FrameArt,
  type FrameProps,
  type SlotProps,
} from './widgets';
