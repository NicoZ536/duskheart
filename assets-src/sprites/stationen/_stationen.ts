/**
 * Gemeinsamer Baustein der Stations-, Lager- und Herdfeuer-Sprites (M4-05, M4-06, M4-20, M4-21;
 * docs/SPIEL.md §8 „Möbel/Deko/Stationen `obj_<id>`“). Alle landen im Kontaktbogen `stationen.png`.
 *
 * Konventionen (docs/ART.md §2–§3, wie die Werkbank):
 * - **Stellfläche** `breite × tiefe` Tiles; die Zelle ist `16 · breite` breit, hohe Stationen ragen über
 *   die Stellfläche nach oben. Anker = Mitte der Vorderkante der Stellfläche (Fußpunkt, y-Sortierung,
 *   Zeile `h − 2`), darunter 1 px Luft für die Interaktions-Outline des Shaders.
 * - **Kontur** `nacht.1` (Objekte trennen sich so auf jedem Boden), Holz `holz`, Stein `stein`, Lehm
 *   und Erde `erde`/`sand`, Stoff `laub`, Bronze in den Farben der Stufenzeile `stufe_bronze` mit
 *   Materialflag `metall`.
 * - **Zustände als Clips:** `aus` (kalt), `brennt`/`arbeitet` (läuft; Flammen 10–12 fps, Glut langsamer),
 *   `fertig` u. a.; nur Flammen und Glut sind emissiv, der Kern heller als der Rand. Sockel `licht` im
 *   hellsten Punkt jeder leuchtenden Station, `arbeit` dort, wo die Hand der Figur arbeitet.
 *
 * Legende = Bau-Legende (`BAU_LEGENDE`, dieselbe wie die Icons) plus:
 * - leuchtend: `{` feuer.1 · `}` feuer.2 · `+` feuer.3 · `=` feuer.4 · `@` feuer.5 · `^` laub.3 (Glut)
 * - Bronze (Metallflag): `Q` erde.1 · `W` laub.2 · `T` laub.3 · `P` sand.2
 */
import { sprite, type HeightHint, type Sprite, type SpriteSource } from '../../lib/sprite';
import { BAU_LEGENDE } from '../bau/_bau';

/** Kontaktbogen `stationen.png`. */
export const STATIONEN_GRUPPE = 'stationen';
/** Präfix der Objekt-Sprites (docs/SPIEL.md §8). */
export const OBJ_PRAEFIX = 'obj_';
/** Zeichen der Bronzebeschläge (Metallflag). */
export const BRONZE = 'QWTP';

export const STATION_LEGENDE: Readonly<Record<string, string | null>> = {
  ...BAU_LEGENDE,
  '{': 'feuer.1*',
  '}': 'feuer.2*',
  '+': 'feuer.3*',
  '=': 'feuer.4*',
  '@': 'feuer.5*',
  '^': 'laub.3*',
  Q: 'erde.1',
  W: 'laub.2',
  T: 'laub.3',
  P: 'sand.2',
};

export interface StationQuelle {
  /** Item-/Stations-Id ohne Präfix. */
  readonly item: string;
  readonly size: [number, number];
  readonly anchor: [number, number];
  readonly hoehe: HeightHint;
  readonly frames: readonly string[];
  readonly clips?: SpriteSource['clips'];
  readonly sockets?: SpriteSource['sockets'];
  readonly hitbox?: [number, number, number, number];
  readonly occluder?: SpriteSource['occluder'];
  readonly material?: SpriteSource['material'];
  readonly einzelpixel?: string;
  readonly legende?: Readonly<Record<string, string | null>>;
  /**
   * The build mode's F may stand it mirrored (docs/ART.md "Spiegeln ist nur mit `spiegelbar: true` erlaubt"). A
   * station is a thing, not a handed figure: mirrored it is the same thing standing the other way round, so the
   * default is `true`; a station with a detail that must keep its side (writing, a coat of arms) says `false`.
   */
  readonly spiegelbar?: boolean;
}

/** Stations-Sprite `obj_<item>` in der Gruppe `stationen`. */
export function station(q: StationQuelle): Sprite {
  return sprite({
    id: `${OBJ_PRAEFIX}${q.item}`,
    group: STATIONEN_GRUPPE,
    size: q.size,
    anchor: q.anchor,
    hoehe: q.hoehe,
    legende: { ...STATION_LEGENDE, ...q.legende },
    frames: [...q.frames],
    ...(q.clips === undefined ? {} : { clips: q.clips }),
    ...(q.sockets === undefined ? {} : { sockets: q.sockets }),
    ...(q.hitbox === undefined ? {} : { hitbox: q.hitbox }),
    ...(q.occluder === undefined ? {} : { occluder: q.occluder }),
    ...(q.material === undefined ? {} : { material: q.material }),
    ...(q.einzelpixel === undefined ? {} : { einzelpixel: q.einzelpixel }),
    spiegelbar: q.spiegelbar ?? true,
  });
}

/** Zeilen eines Rasters ohne Einrückung und Leerzeilen. */
function zeilen(text: string): string[] {
  return text
    .split('\n')
    .map((z) => z.trim())
    .filter((z) => z.length > 0);
}

/**
 * Legt `oben` über `unten` (`.` lässt das Grundbild stehen, `_` stanzt aus). `oben` darf weniger Zeilen
 * haben und wird an Zeile `dy` gesetzt; seine Zeilen dürfen kürzer sein (ab Spalte `dx`).
 */
export function ueber(unten: string, oben: string, dx = 0, dy = 0): string {
  const u = zeilen(unten);
  const o = zeilen(oben);
  return u
    .map((z, y) => {
      const oz = o[y - dy];
      if (oz === undefined) return z;
      return [...z]
        .map((c, x) => {
          const n = oz.charAt(x - dx);
          if (n === '' || n === '.') return c;
          return n === '_' ? '.' : n;
        })
        .join('');
    })
    .join('\n');
}
