/**
 * Hand-Layer der Bronzespitzhacke (`ausruestung_bronzespitzhacke`; T1-Spitzhacke, die das Kernholz des Borkenvaters öffnet,
 * src/content/items/borkenvater.ts; M7-34, Strang F), gehalten am Sockel `hand` der Spielfigur.
 *
 * Vertrag wie die Bronzewerkzeuge (ausruestung/bronzewerkzeuge.ts) und die Steinspitzhacke (ausruestung/werkzeuge.ts):
 * dieselbe Zeichenlage (aufrecht, Griffpixel `+`), derselbe Griff- und Wirkpunkt `[3, −10]` wie die Steinspitzhacke –
 * dieselbe Zelle, derselbe Anker, dieselben zwölf Frames und Clips (`werkzeugSprite`). Im Bild: die Doppelspitze aus
 * gegossener Bronze (Tiefe `q`, Schatten `w`, Grundton `x`, Glanz `t` an den Spitzen, Metallflag), mittig die Tülle, und
 * der Stiel aus rotbraunem Kernholz (`laub.1`) statt Eiche – der Schlüssel-Drop steckt sichtbar im Werkzeug (§13.2).
 */
import { werkzeugSprite } from '../../lib/figureWerkzeug';
import { sprite } from '../../lib/sprite';

const pickel = sprite(
  werkzeugSprite({
    id: 'ausruestung_bronzespitzhacke',
    legende: { '.': null, k: 'nacht.1', o: 'laub.1', q: 'erde.1', w: 'holz.3', x: 'laub.4', t: 'sand.4' },
    griffZeichen: 'o',
    schmier: 'x',
    halten: 'unten',
    material: { metall: 'qwxt' },
    // Doppelspitze quer zum Stiel, beide Spitzen nach unten gebogen, in der Mitte die Tülle.
    raster: `..kkkkk..
             .kwxtxwk.
             kxwkqkwtk
             ktkkqkkxk
             kk.kok.kk
             ...kok...
             ...kok...
             ...kok...
             ...kok...
             ...kok...
             ...kok...
             ...k+k...
             ...kok...
             ....k....`,
    wirkpunkt: [3, -10],
  }),
);

export default { ...pickel, group: 'boss_borkenvater' };
