/**
 * Baustein der Ortsobjekt-Sprites `ort_<name>` (M7-08, M7-09; docs/SPIEL.md §18 "Ortsobjekte", §29; Strang B). Alle landen im
 * Kontaktbogen `orte.png`.
 *
 * Konventionen (docs/ART.md §2–§3, wie Stationen und Felsen):
 * - **Stellfläche** `breite × tiefe` Kacheln laut Content (src/content/places/objekte.ts); die Zelle ist `16 · breite` breit,
 *   hohe Stücke (Turm, Säule, Obelisk) ragen nach oben. Anker = Mitte der Vorderkante der Stellfläche (Fußpunkt, y-Sortierung),
 *   Zeile `h − 2`, darunter 1 px Luft für die Interaktions-Outline. Ortsstücke stehen ohne Versatz auf ihren Kacheln
 *   (src/render/world/objects.ts, `jitter`), damit Mauern und Zäune fluchten.
 * - **Material:** Erbauer-Stein `stein` (Kontur `stein.0`), Holz `holz` (Kontur `holz.0`), Moos und Efeu `gras`, Eisen und
 *   Rost `nacht`/`laub`, Gold `sand`/`feuer`; die Kontur ist die dunkelste Stufe der eigenen Rampe, an Bodenkontakt `nacht.1`.
 * - **Licht:** Oberseiten hell, Fugen und Fuß dunkel (AO), kein Richtungslicht; emissiv nur Kerzen, Glut und die Adern des
 *   Meteoriten. Die Legende ist die Icon-Legende (`ICON_LEGENDE`) plus emissive Zeichen.
 * - **Varianten:** Ohne Clips wählt der Renderer je Kachel einen Frame (Grabsteine, Säulen, Geröll); Stücke mit Zustand
 *   tragen Clips.
 */
import { sprite, type HeightHint, type Sprite, type SpriteSource } from '../../lib/sprite';
import { ICON_LEGENDE } from '../icons/_icon';

/** Kontaktbogen `orte.png`. */
export const ORTE_GRUPPE = 'orte';

/** Emissive Zeichen der Orte: Kerzen- und Glutfarben, kaltes Sternenlicht. */
export const ORT_LEGENDE: Readonly<Record<string, string | null>> = {
  ...ICON_LEGENDE,
  '{': 'feuer.2*',
  '}': 'feuer.3*',
  '+': 'feuer.4*',
  '=': 'feuer.5*',
  '<': 'wasser.4*',
  '>': 'wasser.5*',
  '^': 'eis.4*',
};

export interface OrtQuelle {
  /** Id ohne Präfix `ort_`. */
  readonly id: string;
  readonly size: [number, number];
  readonly anchor: [number, number];
  readonly hoehe: HeightHint;
  readonly frames: readonly string[];
  readonly clips?: SpriteSource['clips'];
  readonly occluder?: SpriteSource['occluder'];
  readonly material?: SpriteSource['material'];
  readonly hoehenRaster?: SpriteSource['hoehenRaster'];
  readonly einzelpixel?: string;
  readonly ausnahmeFarben?: string;
  readonly legende?: Readonly<Record<string, string | null>>;
  readonly spiegelbar?: boolean;
  /** Volle Id (für `erz_sternenerz` u. Ä. ohne Präfix `ort_`). */
  readonly volleId?: string;
}

/** Ortsobjekt-Sprite `ort_<id>` in der Gruppe `orte`. */
export function ort(q: OrtQuelle): Sprite {
  return sprite({
    id: q.volleId ?? `ort_${q.id}`,
    group: ORTE_GRUPPE,
    size: q.size,
    anchor: q.anchor,
    hoehe: q.hoehe,
    legende: { ...ORT_LEGENDE, ...q.legende },
    frames: [...q.frames],
    ...(q.clips === undefined ? {} : { clips: q.clips }),
    ...(q.occluder === undefined ? {} : { occluder: q.occluder }),
    ...(q.material === undefined ? {} : { material: q.material }),
    ...(q.hoehenRaster === undefined ? {} : { hoehenRaster: q.hoehenRaster }),
    ...(q.einzelpixel === undefined ? {} : { einzelpixel: q.einzelpixel }),
    ...(q.ausnahmeFarben === undefined ? {} : { ausnahmeFarben: q.ausnahmeFarben }),
    spiegelbar: q.spiegelbar ?? false,
  });
}
