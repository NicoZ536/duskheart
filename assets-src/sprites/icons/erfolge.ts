/**
 * Die Symbole der Erfolge (M7-47; docs/SPIEL.md §23 „Erfolge … Symbol `erfolg_<id>`“, MASTERPROMPT §23.3): je Erfolg eine
 * Medaille 16×16 im Stil der Item-Icons (docs/ART.md §3: Motiv ≤ 14×14, Kontur `nacht.1` rundum, oben hell, unten dunkel) –
 * ein rotes Band oben, darunter die goldene Scheibe (Rand `feuer` mit Lichtkante oben links, Fläche `sand.3`/`sand.2`) mit dem
 * Motiv des Erfolgs in der Mitte (7×7, dunkle Tinte, wo es hilft mit seiner Farbe: Flamme, Mond, Fisch, Spross, Bronze).
 * Noch nicht erreichte Erfolge zeigt die Chronik als versiegelte graue Medaille mit Fragezeichen (`erfolg_gesperrt`).
 *
 * Gebaut aus einem gemeinsamen Raster (Band, Scheibe) und dem Motiv je Erfolg: so tragen alle dieselbe Form und
 * unterscheiden sich nur im Motiv – wie ein Satz geprägter Abzeichen.
 */
import { sprite, type Sprite } from '../../lib/sprite';
import { ICON_LEGENDE } from './_icon';

/** Kontaktbogen der Erfolge. */
const GRUPPE = 'erfolge';
const GROESSE = 16;
/** Mitte der Scheibe [px] und ihr Radius bis zur Außenkante der Kontur. */
const MX = 7.5;
const MY = 8.5;
const RADIUS = 7;
/** Linke obere Ecke des 7×7-Motivs. */
const MOTIV_X = 4;
const MOTIV_Y = 5;

/** Farben einer Medaille: Kontur, Rand hell/mittel/dunkel, Fläche hell/dunkel, Band hell/dunkel. */
interface Praegung {
  readonly kontur: string;
  readonly randHell: string;
  readonly rand: string;
  readonly randDunkel: string;
  readonly flaeche: string;
  readonly flaecheDunkel: string;
  readonly band: string;
  readonly bandDunkel: string;
}

/** Gold: Rand `feuer.5`/`feuer.4`/`laub.3` (Lichtkante, Goldton, Schattenkante), Fläche `sand.3`/`sand.2`, Band `feuer.2`/`feuer.1`. */
const GOLD: Praegung = { kontur: 'k', randHell: 'V', rand: 'v', randDunkel: 'M', flaeche: 'D', flaecheDunkel: 'C', band: 'u', bandDunkel: 'F' };
/** Versiegelt: Stein statt Gold, das Band in Nacht. */
const STEIN: Praegung = { kontur: 'k', randHell: '5', rand: '4', randDunkel: '2', flaeche: '3', flaecheDunkel: '2', band: 'N', bandDunkel: 'n' };

/** Das gemeinsame Raster (Band und Scheibe) als Zeichen-Gitter. */
function grundraster(p: Praegung): string[][] {
  const g: string[][] = Array.from({ length: GROESSE }, () => Array.from({ length: GROESSE }, () => '.'));
  // Band: zwei Enden, die schräg zur Öse über der Scheibe laufen – links hell, rechts im Schatten.
  const BAND = ['...kbbk..kddk...', '....kbbkkddk....', '.....kbbddk.....'];
  BAND.forEach((zeile, y) => {
    [...zeile].forEach((ch, x) => {
      if (ch !== '.') g[y]![x] = ch === 'b' ? p.band : ch === 'd' ? p.bandDunkel : p.kontur;
    });
  });
  for (let y = 0; y < GROESSE; y++) {
    for (let x = 0; x < GROESSE; x++) {
      const dx = x + 0.5 - (MX + 0.5);
      const dy = y + 0.5 - (MY + 0.5);
      const r = Math.hypot(dx, dy);
      if (r > RADIUS + 0.2) continue;
      // Licht von oben links: Rand und Fläche hell oben links, dunkel unten rechts.
      const licht = -(dx + dy) / Math.max(r, 0.001);
      if (r > RADIUS - 0.8) g[y]![x] = p.kontur;
      else if (r > RADIUS - 2) g[y]![x] = licht > 0.35 ? p.randHell : licht < -0.35 ? p.randDunkel : p.rand;
      else g[y]![x] = licht < -0.55 && r > RADIUS - 3.2 ? p.flaecheDunkel : p.flaeche;
    }
  }
  return g;
}

/** Eine Medaille `id` mit dem 7×7-Motiv `motiv` (`.` = Fläche bleibt). */
function medaille(id: string, motiv: string, p: Praegung = GOLD, einzelpixel?: string): Sprite {
  const g = grundraster(p);
  const zeilen = motiv
    .split('\n')
    .map((z) => z.trim())
    .filter((z) => z.length > 0);
  if (zeilen.length !== 7 || zeilen.some((z) => z.length !== 7)) throw new Error(`erfolge: Motiv von ${id} ist nicht 7×7`);
  zeilen.forEach((z, y) => {
    [...z].forEach((ch, x) => {
      if (ch !== '.') g[MOTIV_Y + y]![MOTIV_X + x] = ch;
    });
  });
  return sprite({
    id,
    group: GRUPPE,
    size: [GROESSE, GROESSE],
    anchor: [8, 8],
    hoehe: 'flach',
    legende: ICON_LEGENDE,
    frames: [g.map((r) => r.join('')).join('\n')],
    schatten: 'none',
    occluder: { kind: 'none' },
    ...(einzelpixel === undefined ? {} : { einzelpixel }),
  });
}

export default [
  // Die erste Nacht: die Mondsichel.
  medaille(
    'erfolg_erste_nacht',
    `..kkk..
     .k99k..
     k99k...
     k9k....
     k99k...
     .k99k..
     ..kkk..`,
  ),
  // Feuermacher: die Flamme.
  medaille(
    'erfolg_feuermacher',
    `...k...
     ..kUk..
     ..kvUk.
     .kvVvk.
     .kvVVUk
     .kUvvUk
     ..kkkk.`,
  ),
  // Steinzeit: die Steinaxt – Klinge oben links, Stiel quer.
  medaille(
    'erfolg_steinzeit',
    `kkk....
     k44k...
     k434k..
     .kkcbk.
     ...kcbk
     ....kck
     .....k.`,
    GOLD,
    'Schneide der Steinklinge: ein heller Schliffpunkt zwischen den zwei Steintönen des Keils',
  ),
  // Baumeister: das Haus mit Tür.
  medaille(
    'erfolg_baumeister',
    `...k...
     ..kdk..
     .kdddk.
     kkkkkkk
     .kdkdk.
     .kdkdk.
     .kkkkk.`,
  ),
  // Behaglich: das Herz.
  medaille(
    'erfolg_gemuetlich',
    `.kk.kk.
     kUVkVUk
     kUvVvUk
     kuUvUuk
     .kuUuk.
     ..kuk..
     ...k...`,
  ),
  // Jäger: der Pfotenabdruck.
  medaille(
    'erfolg_jaeger',
    `.kk.kk.
     .kk.kk.
     .......
     ..kkk..
     .kkkkk.
     .kkkkk.
     ..k.k..`,
  ),
  // Bronzezeit: der Bronzebarren.
  medaille(
    'erfolg_bronzezeit',
    `.......
     ..kkkk.
     .koooMk
     koooMmk
     kMMMmmk
     kkkkkk.
     .......`,
  ),
  // Gärtner: der Spross.
  medaille(
    'erfolg_gaertner',
    `.GG.GG.
     GiiGiiG
     .GihiG.
     ..GhG..
     ...G...
     .ksssk.
     ..kkk..`,
  ),
  // Koch: der Kessel mit Dampf.
  medaille(
    'erfolg_koch',
    `..k.k..
     .k.k...
     .......
     kkkkkkk
     .k454k.
     .k343k.
     ..kkk..`,
    GOLD,
    'Die Dampfschwaden über dem Kessel sind einzelne, schräg versetzte Tintenpunkte – zwei Fäden, die aufsteigen.',
  ),
  // Angler: der Fisch.
  medaille(
    'erfolg_angler',
    `.......
     ..kkk.k
     .kyzykk
     kyZyyyk
     .kyyykk
     ..kkk.k
     .......`,
    GOLD,
    'Fischauge und Kiemenglanz: je ein Punkt im Fischleib, sonst liest das 7-px-Motiv nicht als Fisch',
  ),
  // Entdecker: die Windrose.
  medaille(
    'erfolg_entdecker',
    `...k...
     ...k...
     ..kVk..
     kkVkVkk
     ..kVk..
     ...k...
     ...k...`,
  ),
  // Gewölbe bezwungen: der Torbogen der Erbauer.
  medaille(
    'erfolg_gewoelbe_bezwungen',
    `..kkk..
     .k444k.
     k4kkk4k
     k4k.k4k
     k3k.k3k
     k3k.k3k
     kkk.kkk`,
  ),
  // Borkenvater besiegt: die Baumkrone mit Borkenstamm.
  medaille(
    'erfolg_borkenvater_besiegt',
    `..kkk..
     .kMoMk.
     kMoMmMk
     .kmMmk.
     ..kak..
     ..kak..
     .kkkkk.`,
  ),
  // Das erste Feuer: die Leuchtfeuer-Säule mit Flamme.
  medaille(
    'erfolg_erstes_feuer',
    `..kVk..
     .kVvVk.
     .kvUvk.
     ..kkk..
     .k454k.
     .k343k.
     kkkkkkk`,
    GOLD,
    'Glutkern der Flamme und Feuerschein in der Schale: je ein heller Punkt, das Licht des Leuchtfeuers',
  ),
  // Forscher: das Auge.
  medaille(
    'erfolg_forscher',
    `.......
     .kkkkk.
     k99k99k
     k9kkk9k
     k99k99k
     .kkkkk.
     .......`,
  ),
  // Noch nicht erreicht: die versiegelte Steinmedaille mit Fragezeichen.
  medaille(
    'erfolg_gesperrt',
    `..kkk..
     .k...k.
     .....k.
     ...kk..
     ...k...
     .......
     ...k...`,
    STEIN,
    'Der Punkt des Fragezeichens steht für sich – ohne ihn wäre es ein Haken.',
  ),
];
