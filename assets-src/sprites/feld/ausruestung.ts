/**
 * Hand-Layer der Feld- und Fang-Werkzeuge (M7-19, M7-24, Strang D; kanonische Ids docs/SPIEL.md §29 „Feld & Fang“):
 * `ausruestung_<itemId>`, gehalten am Sockel `hand` der Spielfigur wie die T0-Werkzeuge (assets-src/sprites/ausruestung/
 * werkzeuge.ts, gleiche Formsprache und Legende; Lagen, Spiegelbilder und Clips baut `werkzeugSprite`).
 *
 * - `ausruestung_giesskanne`: Holzkanne aus Dauben mit zwei Schnurreifen, Bügel oben (Griffpixel am Bügelscheitel), die
 *   Tülle schräg nach rechts oben; hängt wie der Eimer am Bügel und dreht sich nicht (kein Schlag, `halten: 'oben'`).
 * - `ausruestung_angel_holz`: die Stockangel aufrecht wie ein Stab getragen – ein langer, nach oben dünner werdender Stock,
 *   unter der Mitte die aufgewickelte Fasernschnur, unten der umwickelte Griff. Beim Angeln zeichnet die Figur keinen
 *   Hand-Layer: Rute, Biegung und Schnur zeichnet dann `src/render/game/fishing.ts` von der Hand zur Pose.
 */
import { werkzeugSprite, type WerkzeugForm } from '../../lib/figureWerkzeug';
import { sprite } from '../../lib/sprite';

const LEGENDE = {
  '.': null,
  k: 'nacht.1',
  h: 'holz.1',
  o: 'holz.2',
  O: 'holz.3',
  r: 'sand.3',
  R: 'sand.1',
} as const;

const FORMEN: readonly WerkzeugForm[] = [
  {
    id: 'ausruestung_giesskanne',
    legende: LEGENDE,
    griffZeichen: 'r',
    schmier: null,
    spiegelbar: true,
    halten: 'oben',
    // Bügel, Daubenkörper mit zwei Schnurreifen, Tülle nach rechts oben.
    raster: `..r+r.....
             .r...r....
             .kkkkk...k
             kohhhok.kk
             kOoooOkkok
             kRrRrRkok.
             kOoooOok..
             .kkkkkk...`,
    wirkpunkt: [5, 3],
  },
  {
    id: 'ausruestung_angel_holz',
    legende: LEGENDE,
    griffZeichen: 'h',
    schmier: null,
    spiegelbar: true,
    halten: 'oben',
    // Langer Stock, oben heller und dünn auslaufend, die aufgewickelte Schnur, der umwickelte Griff.
    raster: `..k..
             .kOk.
             .kOk.
             .kOk.
             .kOk.
             .kok.
             .kok.
             .kok.
             .kok.
             .kok.
             .kok.
             kkRkk
             kRrRk
             kkRkk
             .khk.
             .krk.
             .k+k.
             .krk.
             .khk.
             ..k..`,
    wirkpunkt: [0, -16],
  },
];

export default FORMEN.map((f) => sprite(werkzeugSprite(f)));
