/**
 * Hand-Layer der Fernkampfwaffen T0–T1 (M6-11; Items src/content/items/waffen.ts): Kurzbogen, Kompositbogen, Schleuder
 * und Armbrust, gehalten am Sockel `hand` (Generator `_waffe.ts`).
 *
 * - Kurzbogen: schlichter Holzstab, der Bauch zeigt nach vorn, die Sehne (heller Strich ohne Kontur) hinten; Griff mit
 *   Leder umwickelt. Gespannt: die Sehne läuft als V zur Nockhand zurück, ein Pfeil liegt auf.
 * - Kompositbogen: Reflexbogen mit nach vorn geschwungenen Knochenspitzen und Sehnenbelag auf dem Rücken.
 * - Schleuder: Lederschlaufe mit Stein an zwei Schnüren; sie hängt in der Hand und wirbelt im Schwung.
 * - Armbrust: Holzsäule mit querem Bogen, Bronzebeschläge (Bügel vorn, Nuss, Abzug) in der Rampe `stein` – die
 *   Bronzestufe färbt sie um (die Armbrust ist T1).
 *
 * Bögen stehen aufrecht in der Hand und drehen sich im Schuss nicht; die Armbrust zielt im Anschlag nach vorn.
 */
import { sprite, type Sprite } from '../../lib/sprite';
import { stufenSprites, waffenQuelle, type WaffenForm } from './_waffe';

const LEGENDE = {
  '.': null,
  k: 'nacht.1',
  // Beschläge bzw. Stein (Rampe `stein`).
  c: 'stein.2',
  d: 'stein.3',
  e: 'stein.4',
  // Holz.
  h: 'holz.1',
  o: 'holz.2',
  O: 'holz.3',
  H: 'holz.4',
  // Leder.
  W: 'erde.2',
  w: 'erde.1',
  // Sehne, Schnur.
  y: 'sand.4',
  r: 'sand.3',
  R: 'sand.1',
  // Knochen.
  u: 'sand.2',
  v: 'eis.4',
} as const;

const form = (f: WaffenForm): Sprite => sprite(waffenQuelle(f));

const BOGEN = { legende: LEGENDE, klasse: 'bogen', schmier: null, halten: 'oben', griffZeichen: 'w', wirkpunkt: [0, -8] } as const;

const kurzbogen = form({
  ...BOGEN,
  id: 'ausruestung_kurzbogen',
  raster: `.kk...
           ykOk..
           y.kOk.
           y.kOk.
           y..kOk
           y..kOk
           y..kok
           y..kwk
           y..k+k
           y..kwk
           y..kok
           y..kOk
           y..kOk
           y.kOk.
           y.kOk.
           ykOk..
           .kk...`,
  gespannt: `....kk.....
             ...ykOk....
             ...y.kOk...
             ..y..kOk...
             ..y...kOk..
             .y....kOk..
             .y....kok..
             yRRRRRkwkee
             y.....k+k..
             y.....kwk..
             .y....kok..
             .y....kOk..
             ..y...kOk..
             ..y..kOk...
             ...y.kOk...
             ...ykOk....
             ....kk.....`,
});

const kompositbogen = form({
  ...BOGEN,
  id: 'ausruestung_kompositbogen',
  raster: `...kk..
           ..kvuk.
           .ykuk..
           y.kOk..
           y..kOk.
           y..krk.
           y..kok.
           y..kwk.
           y..k+k.
           y..kwk.
           y..kok.
           y..krk.
           y..kOk.
           y.kOk..
           .ykuk..
           ..kvuk.
           ...kk..`,
  gespannt: `......kk..
             .....kvuk.
             ....ykuk..
             ...y.kOk..
             ..y...kOk.
             ..y...krk.
             .y....koke
             yRRRRRkwke
             y.....k+k.
             y.....kwk.
             .y....kok.
             ..y...krk.
             ..y...kOk.
             ...y.kOk..
             ....ykuk..
             .....kvuk.
             ......kk..`,
});

const schleuder = form({
  legende: LEGENDE,
  klasse: 'schleuder',
  id: 'ausruestung_schleuder',
  griffZeichen: 'r',
  schmier: 'y',
  halten: 'unten',
  wirkpunkt: [0, -7],
  raster: `.kkk.
           kwdwk
           kWdWk
           .kwk.
           .r.r.
           .r.r.
           .r.r.
           .r.r.
           ..r..
           .k+k.
           ..k..`,
});

const armbrust = form({
  legende: LEGENDE,
  klasse: 'armbrust',
  id: 'form_armbrust',
  griffZeichen: 'o',
  schmier: null,
  halten: 'unten',
  wirkpunkt: [0, -9],
  raster: `....kkk....
           ...kdedk...
           kkkkkeokkkk
           kOOOOoOOOOk
           kok.kok.kok
           .y..kok..y.
           ..y.kok.y..
           ...ykdky...
           ....kok....
           ....kok....
           ....kdk....
           ....k+k....
           ....kok....
           ....kok....
           .....k.....`,
});

export default [kurzbogen, kompositbogen, schleuder, ...stufenSprites({ metall: armbrust, bronze: 'armbrust' }, 'ausruestung_')];
