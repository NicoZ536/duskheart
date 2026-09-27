/**
 * Hand-Layer der Bronzewerkzeuge T1 (M4-10; Items in src/content/items/verarbeitung_bronzewerkzeuge.ts):
 * `ausruestung_bronzeaxt`, `_bronzeschaufel`, `_bronzehacke`, `_bronzesichel`, `_bronzehammer`,
 * `_bronzemesser`, gehalten am Sockel `hand` der Spielfigur.
 *
 * Vertrag wie bei den Steinwerkzeugen (`werkzeuge.ts`, `werkzeugSprite` in assets-src/lib/figureWerkzeug.ts):
 * dieselbe Zeichenlage (aufrecht, Griffpixel `+`, Kopf zur rechten Seite), derselbe Griffpunkt und
 * derselbe Wirkpunkt wie das Steinwerkzeug derselben Art – damit entstehen dieselbe Zelle, derselbe Anker,
 * dieselben zwölf Frames (vier Lagen, Spiegelbilder, Smear-Frames), dieselben Halte- und Schlag-Clips und
 * dieselben Wirkpunkt-Sockel (`tests/unit/assets/bronzewerkzeuge.test.ts` vergleicht das Sprite für Sprite).
 *
 * Unterschied im Bild: ein gegossener Bronzekopf statt geschlagenen Steins – Axt mit ausgestelltem,
 * bogigem Blatt, Schaufel breit mit Mittelgrat, Hacke mit abgewinkeltem Blatt, Hammer als Quader mit zwei
 * Bahnen, Sichel und Messer mit schlanker Klinge. Die Tülle aus Bronze umfasst den Stiel dort, wo beim
 * Steinwerkzeug die Schnur sitzt; Sichel und Messer haben einen Griff aus Leinengarn (hell/dunkel im Wechsel
 * wie gewickeltes Garn, dieselben Farben wie `icon_garn`). Bronze in den Tönen des Icons
 * (`METALL_RAMPEN.bronze` ohne dessen Schatten `holz.2`, der Farbe des Stiels, damit sich der Kopf abhebt):
 * `q` Tiefe · `w` Schatten · `x` Grundton (Honiggold) · `t` Glanz an der Schneide; Metallflag auf allen
 * Bronzepixeln. Der Smear-Bogen läuft im Grundton `x`.
 */
import { werkzeugSprite, type WerkzeugForm } from '../../lib/figureWerkzeug';
import { sprite } from '../../lib/sprite';

const LEGENDE = {
  '.': null,
  k: 'nacht.1',
  o: 'holz.2',
  q: 'erde.1',
  w: 'holz.3',
  x: 'laub.4',
  t: 'sand.4',
  // Garnwicklung (Sichel, Messer).
  g: 'stein.5',
  G: 'stein.3',
} as const;

/** Bronzepixel (Materialflag `metall`). */
const BRONZE = 'qwxt';

const HOLZSTIEL = { legende: LEGENDE, griffZeichen: 'o', schmier: 'x', halten: 'unten', material: { metall: BRONZE } } as const;
const GARNGRIFF = { ...HOLZSTIEL, griffZeichen: 'G' } as const;

export const BRONZE_FORMEN: readonly WerkzeugForm[] = [
  {
    ...HOLZSTIEL,
    id: 'ausruestung_bronzeaxt',
    // Blatt mit ausgestellten Hörnern oben und unten, Schneide hell, Tülle um den Stiel; Knauf oben.
    raster: `.k..kk.
             kokkxtk
             kwxxxtk
             kqxxwtk
             kqwwwtk
             kokkwtk
             kok.kk.
             kok....
             kok....
             kok....
             kok....
             kok....
             k+k....
             kok....
             .k.....`,
    wirkpunkt: [2, -9],
  },
  {
    ...HOLZSTIEL,
    id: 'ausruestung_bronzeschaufel',
    // Breites Blatt in Verlängerung des Stiels, Schneide oben hell, Mittelgrat, Tülle am Blattfuß.
    raster: `.kkkkk.
             kxtttxk
             kwxtxwk
             kwxtxwk
             kqwxwqk
             .kqwqk.
             ..kwk..
             ..kok..
             ..kok..
             ..kok..
             ..kok..
             ..kok..
             ..k+k..
             ..kok..
             ...k...`,
    wirkpunkt: [0, -10],
  },
  {
    ...HOLZSTIEL,
    id: 'ausruestung_bronzehacke',
    // Querarm aus der Tülle nach vorn, an seinem Ende das nach unten gezogene Blatt mit heller Schneide.
    raster: `.kkkk..
             kwxxxkk
             kqwxxxk
             kqwwxtk
             kokkktk
             kok..k.
             kok....
             kok....
             kok....
             kok....
             kok....
             k+k....
             kok....
             .k.....`,
    wirkpunkt: [3, -9],
  },
  {
    ...GARNGRIFF,
    id: 'ausruestung_bronzesichel',
    // Schlanker Bogen nach vorn, Schneide innen hell, Bronzezwinge, Garngriff.
    raster: `.kkkk.
             kwxxtk
             kwkktk
             kgk.kk
             kGk...
             kgk...
             k+k...
             kgk...
             .k....`,
    wirkpunkt: [2, -5],
  },
  {
    ...HOLZSTIEL,
    id: 'ausruestung_bronzehammer',
    // Gegossener Quader quer auf dem Stiel, beide Bahnen hell, Tülle darunter.
    raster: `.kkkkk.
             ktxxxtk
             kxwxwxk
             kqwwwqk
             .kkwkk.
             ..kok..
             ..kok..
             ..kok..
             ..kok..
             ..kok..
             ..k+k..
             ..kok..
             ...k...`,
    wirkpunkt: [0, -9],
  },
  {
    ...GARNGRIFF,
    id: 'ausruestung_bronzemesser',
    // Blattklinge mit hellem Grat, Zwinge, Garngriff.
    raster: `.k..
             ktk.
             kxtk
             kxtk
             kwxk
             kwwk
             kgk.
             k+k.
             kgk.
             kGk.
             .k..`,
    wirkpunkt: [1, -5],
  },
];

export default BRONZE_FORMEN.map((f) => sprite(werkzeugSprite(f)));
