/**
 * The player's appearance (MASTERPROMPT §26 "Charaktererstellung"; docs/SPIEL.md §26 "Aussehen"; M7-52): name, body shape,
 * skin palette, hairstyle, hair palette and the palettes of top and trousers – ids of the content collections `bodyShapes`,
 * `hairstyles` and the palettes `APPEARANCE_PALETTES` (src/content/appearance/). The renderer draws the body of the shape with the skin's
 * palette row, the hairstyle's layer with the hair's and the clothing with theirs (src/render/game/playerFigure.ts).
 */
import type { BodyShapeId } from '../../content/appearance/schema';

export interface Appearance {
  /** The figure's name (1–20 characters, `BALANCE.appearance`); empty in a world from before M7 that never chose one. */
  readonly name: string;
  readonly form: BodyShapeId;
  /** Palette `haut_<n>`. */
  readonly haut: string;
  /** Hairstyle id (sprite `frisur_<id>`). */
  readonly frisur: string;
  /** Palette `haar_<n>`. */
  readonly haar: string;
  /** Palette `kleid_<n>` of the top (tunic). */
  readonly oberteil: string;
  /** Palette `kleid_<n>` of the trousers. */
  readonly hose: string;
  /** Whether the appearance was chosen (the character creation's `appearance.set`); a chosen one stays (§26). */
  readonly gewaehlt: boolean;
}

/** Read access for the renderer and the UI (`GameSession`'s sampler, `systemOf('appearance')`). */
export interface AppearanceApi {
  /** The current appearance; a new object after every change (compare by identity to notice one). */
  readonly appearance: Appearance;
}
