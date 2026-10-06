/**
 * Item-Icons der Beute des Borkenvaters und der Spitzhacke, die sie öffnet (M7-32/M7-34, Strang F;
 * src/content/items/borkenvater.ts): Kernholz, Borkenharz, Krone des Borkenvaters (Trophäe), Herzsplitter,
 * Bronzespitzhacke.
 *
 * - **Kernholz**: ein kurzer Klotz von schräg oben – die Schnittfläche hell (Splintholz `d`), darin der
 *   rotbraune Kern (`laub.1`/`laub.2`) und in seiner Mitte die Glut (emissiv `feuer.3*`/`feuer.4*`); an der
 *   Borke eine glimmende Rissader. So liest es sich als Holz und zugleich als „glimmendes Herz“.
 * - **Borkenharz**: ein Bernsteintropfen (`laub.3`/`laub.4`, Glanz `sand.4` oben links, Schatten `laub.1`
 *   unten rechts) mit einem eingeschlossenen Borkensplitter – das Harz der Rinde.
 * - **Krone des Borkenvaters**: der Kranz aus Borkenzacken mit den drei erloschenen Glutknoten (`feuer.1`,
 *   nicht emissiv – sie glühen nicht mehr) auf einem Brett mit Nagel: das Wandmöbel `trophaee_borkenvater`.
 * - **Herzsplitter**: ein herzförmiger Kristall, dessen Kern warm glüht (emissiv `feuer.3*` … `feuer.5*`),
 *   die Kanten im Weinrot des Herbstlaubs – kein Lumen-Blau, damit er neben der Lumen-Scherbe nicht verwechselt
 *   wird.
 * - **Bronzespitzhacke**: dieselbe Silhouette wie die Steinspitzhacke (werkzeuge.ts), der Kopf aber
 *   gegossene Bronze (`METALL_RAMPEN.bronze`) mit Tülle statt Schnur, der Stiel aus rotbraunem Kernholz
 *   (`laub.1`/`laub.2`) – der Schlüssel des Bosses steckt sichtbar im Werkzeug (§13.2).
 */
import { icon } from './_icon';
import { METALL_RAMPEN, METALL_ZEICHEN } from './verarbeitung';

/** Emissive Glut (Kernholz-Kern, Herzsplitter). */
const GLUT = { U: 'feuer.3*', v: 'feuer.4*', V: 'feuer.5*' } as const;

export default [
  icon(
    'kernholz',
    `................
     ................
     .....kkkkkk.....
     ...kkbbbbbbkk...
     ..kbbeeddddbbk..
     .kbdemmmmmmddbk.
     .kbdmlUvvUlmdbk.
     .kbddmmmmmmddbk.
     .kabbddddddbbak.
     .kaabbbbbbbbaak.
     .kaabcbUbcbbaak.
     .kaabbcUcbbcaak.
     ..kaabbbbbbaak..
     ...kkkkkkkkkk...
     ................
     ................`,
    { legende: GLUT, einzelpixel: 'Jahresringe der Schnittfläche: jede Ringstufe liegt als Band um den Glutkern' },
  ),
  icon(
    'borkenharz',
    `................
     .......kk.......
     ......kMMk......
     ......kMok......
     .....kMoMk......
     ....kMoEoMk.....
     ....kMEEoMk.....
     ...kMoEoMMmk....
     ...kMooMMMmk....
     ..kmMMMbbMmlk...
     ..kmMMMbbmmlk...
     ..klmMMMmmllk...
     ...kllmmmllk....
     ....kklllkk.....
     ......kkk.......
     ................`,
  ),
  icon(
    'trophaee_borkenvater',
    `................
     ..k....kk....k..
     .kck..kcck..kck.
     .kcbk.kcbk.kbck.
     ..kbbkbbbbkbbk..
     .kbuFbbuFbbuFbk.
     .kaFFbaFFabFFak.
     .kkaabbaabbaakk.
     .kdeeeeeeeeeedk.
     .kdddddddddddck.
     .kcdddd4ddddcck.
     .kcccccccccccbk.
     .kbcccccccccbbk.
     .kbbbbbbbbbbbak.
     ..kkkkkkkkkkkk..
     ................`,
    { einzelpixel: 'Nagelkopf mitten im Brett und Lichtkante je Glutknoten' },
  ),
  icon(
    'herzsplitter',
    `................
     ................
     ...kkk....kkk...
     ..kmUUk..kmUUk..
     .kmUvvUkkmUvUmk.
     .kmUvVvUmUvvUmk.
     .klmUvvUUvvUmlk.
     .klmmUUvvUUmmlk.
     ..klmmUUUUmmlk..
     ...klmmUUmmlk...
     ....klmmmmlk....
     .....klmmlk.....
     ......kllk......
     .......kk.......
     ................
     ................`,
    { legende: GLUT, einzelpixel: 'Glanzpunkt im linken Herzbogen: der hellste Kern des Kristalls' },
  ),
  icon(
    'bronzespitzhacke',
    // Kopf wie die Steinspitzhacke, gegossen: helle Oberkante (`P`/`T`), Bauch `X`, Tülle `Q`/`W` um den Stiel.
    `................
     ...kkkkkkk......
     ..kXTPPPPTk.....
     ...kkkWXTPPk....
     ......kkWXTPk...
     ........kQXTPk..
     .......kWQWXTPk.
     .......kmlkWXTk.
     ......kmlk.kWTk.
     .....kmlk..kWTk.
     ....kmlk....kXk.
     ...kDBk.....kWk.
     ..kBDk.......k..
     .kmlk...........
     ..kk............
     ................`,
    { legende: METALL_RAMPEN.bronze, material: { metall: METALL_ZEICHEN } },
  ),
];
