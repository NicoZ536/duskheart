/**
 * The vision screen's model (MASTERPROMPT §8 "Story-Vision", §23.1; docs/SPIEL.md §22 "Vision (`visionen`, Pixel-Standbilder +
 * Zeilen DE/EN, eigener Bildschirm, pausiert)", §30; M7-35): the stills of the lit beacon's vision with their lines in the
 * player's language, then one page of the knowledge the beacon gave (the names of its unlocks). Pure – the screen pages
 * through it.
 */
import { CONTENT } from '../../../content/index';
import type { Lang } from '../../../i18n';

/** One page of a vision. */
export interface VisionSeite {
  /** The still (`vision_<n>_<k>`), or null for the closing page of knowledge. */
  readonly bild: string | null;
  readonly zeilen: readonly string[];
  /** How long the page stays before it turns by itself [s] (the closing page waits). */
  readonly sekunden: number | null;
}

/** The pages of beacon `nummer`'s vision in `lang`, closing with its knowledge; empty for a beacon without one. */
export function visionSeiten(nummer: number, lang: Lang): VisionSeite[] {
  const beacon = CONTENT.collection('beacons').values().find((b) => b.nummer === nummer);
  if (beacon === undefined) return [];
  const vision = CONTENT.collection('visions').find(beacon.vision);
  if (vision === undefined) return [];
  const seiten: VisionSeite[] = vision.bilder.map((b) => ({ bild: b.sprite, zeilen: b.zeilen.map((z) => z[lang]), sekunden: b.sekunden }));
  const unlocks = CONTENT.collection('unlocks');
  const wissen = beacon.freischaltungen.map((id) => unlocks.find(id)?.name[lang] ?? id);
  seiten.push({ bild: null, zeilen: wissen, sekunden: null });
  return seiten;
}
