/**
 * The player's appearance at runtime (docs/SPIEL.md §26 "Aussehen", ADR-0207; strand I, system `appearance`): name, body shape,
 * palettes of skin, hair and clothes, hairstyle – set by `appearance.set` (the first command of a new world), saved
 * (participant `appearance`), drawn by the player figure's layers.
 */
import type { BodyShape } from '../../content/appearance/schema';

export interface Appearance {
  name: string;
  body: BodyShape;
  /** Palette rows haut_1…6, haar_1…8, kleid_1…8 (1-based). */
  skin: number;
  hairstyle: string;
  hair: number;
  top: number;
  trousers: number;
}
