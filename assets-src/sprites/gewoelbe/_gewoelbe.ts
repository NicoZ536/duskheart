/**
 * Baustein der Gewölbe-Sprites (M7-11 … M7-14, Strang C; docs/SPIEL.md §19, §29): die Welt-Objekte der Gewölbe (`ort_gw_*`,
 * `ort_erbauer_tafel`), die beweglichen Teile, die die Spielansicht zeichnet (`gw_*`: Tore, Hebel, Schalen, Glocken, Risswände,
 * Kisten, Platten, Sockel, Hinweis-Stelen), und die Fallen (`gw_falle_*`). Alle landen im Kontaktbogen `gewoelbe.png`.
 *
 * Konventionen wie die Ortsobjekte (assets-src/sprites/orte/_ort.ts): Erbauer-Stein `stein` mit Kontur `stein.0`, Bodenkontakt
 * `nacht.1`; Moos `gras`, Wurzeln `holz`; Bronze der Metallrampe (`Q W X T P` = `METALL_RAMPEN.bronze`, Materialflag `metall`).
 * Emissiv nur Glut, Lumen-Runen und die Warnung der Fallen: `{ } + =` Glut `feuer.2*`–`feuer.5*`, `@ ^` kaltes Runenlicht
 * `eis.3*`/`eis.4*`. Flache Stücke (`hoehe: 'flach'`) liegen auf dem Boden (Ebene `ground`), Anker = Mitte der Unterkante ihrer
 * Kachel. Gefahren-Bildsprache der Fallen (docs/ART.md §7, Zeile „Erbauer-Fallen“): Bronze-Mechanik in behauenem Stein, Warnung
 * als glühende Rune `feuer.4*` mit Glint, bevor etwas zuschlägt.
 */
import { sprite, type HeightHint, type Sprite, type SpriteSource } from '../../lib/sprite';
import { METALL_RAMPEN, METALL_ZEICHEN } from '../icons/verarbeitung';
import { ORT_LEGENDE } from '../orte/_ort';

/** Kontaktbogen `gewoelbe.png`. */
export const GEWOELBE_GRUPPE = 'gewoelbe';

/** Legende der Gewölbe: die der Orte, dazu kaltes Runenlicht und die Bronze der Metallrampe. */
export const GW_LEGENDE: Readonly<Record<string, string | null>> = {
  ...ORT_LEGENDE,
  '@': 'eis.3*',
  ...METALL_RAMPEN.bronze,
};

export interface GwQuelle {
  /** Volle Sprite-Id (`ort_gw_saeule`, `gw_hebel`, `gw_falle_speer` …). */
  readonly id: string;
  readonly size: [number, number];
  readonly anchor: [number, number];
  readonly hoehe: HeightHint;
  readonly frames: readonly string[];
  readonly clips?: SpriteSource['clips'];
  readonly occluder?: SpriteSource['occluder'];
  readonly einzelpixel?: string;
  readonly spiegelbar?: boolean;
  readonly legende?: Readonly<Record<string, string | null>>;
}

/** Ein Gewölbe-Sprite in der Gruppe `gewoelbe`; Bronzezeichen tragen das Materialflag `metall`. */
export function gw(q: GwQuelle): Sprite {
  const zeichen = new Set(q.frames.join(''));
  const metall = [...METALL_ZEICHEN].filter((c) => zeichen.has(c)).join('');
  return sprite({
    id: q.id,
    group: GEWOELBE_GRUPPE,
    size: q.size,
    anchor: q.anchor,
    hoehe: q.hoehe,
    legende: { ...GW_LEGENDE, ...q.legende },
    frames: [...q.frames],
    ...(q.clips === undefined ? {} : { clips: q.clips }),
    ...(q.occluder === undefined ? {} : { occluder: q.occluder }),
    ...(q.einzelpixel === undefined ? {} : { einzelpixel: q.einzelpixel }),
    ...(metall.length === 0 ? {} : { material: { metall } }),
    spiegelbar: q.spiegelbar ?? false,
  });
}
