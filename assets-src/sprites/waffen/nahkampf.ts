/**
 * Hand-Layer der Nahkampfwaffen T0–T1 (M6-11; Items src/content/items/waffen.ts, docs/SPIEL.md §14 „Waffen“), gehalten am
 * Sockel `hand`: je Klasse eine Metallform (Rampe `stein`, wird Bronze) und – wo die Klasse eine T0-Waffe hat – deren
 * eigene Form mit derselben Zelle, demselben Griff und Wirkpunkt (Generator `_waffe.ts`).
 *
 * - Schwert: Bronzeschwert mit Blattklinge (breiteste Stelle im oberen Drittel, heller Mittelgrat), gegossenem Heft und
 *   Lederwicklung · Feuersteinklinge: lange, beidseitig geschlagene Klinge (gezahnte Kante, helle Abschlagflächen
 *   zwischen dunklen Narben), mit Schnur an den Holzgriff gebunden.
 * - Axt: Bronzekampfaxt mit Halbmondblatt und Tülle · Steinkampfaxt: schwerer Steinkeil, mit Schnur an den Stiel
 *   geschnürt (größer als die Werkzeugaxt). Beide fällen Bäume und behalten die Werkzeugschlag-Clips.
 * - Keule: Bronzestreitkolben mit Schlagblättern · Knochenkeule: Oberschenkelknochen mit Gelenkkopf, Griff mit Schnur
 *   umwickelt · Holzkeule: knorriger Knüppel, der zum Schlagende hin dicker wird (nur Holz, keine Stufe).
 * - Speer: Bronzespeer mit Blattspitze und Tülle, so lang wie der Steinspeer (`werkzeuge.ts`), aufrecht gehalten.
 * - Dolch: Bronzedolch mit Heft und Knauf · Knochendolch: zugeschliffener Knochensplitter mit Schnurgriff.
 * - Zweihand: Bronzekriegshammer (Hammerbahn vorn, Dorn hinten) · Felsbrecher: roher Steinblock, mit Schnur kreuzweise an
 *   den langen Stiel gebunden · Bronzezweihänder (lange Klinge, Parierstange, langer Griff) · Bronzegroßaxt (breites
 *   Bartblatt).
 *
 * Maßstab: Figur 16×24, die Klinge des Schwerts reicht 11 px über die Faust, der Zweihänder 15, der Dolch 6.
 */
import { sprite, type Sprite } from '../../lib/sprite';
import { stufenSprites, waffenQuelle, type WaffenForm } from './_waffe';

const LEGENDE = {
  '.': null,
  k: 'nacht.1',
  // Metall bzw. Stein (Rampe `stein`, wird in der Bronzestufe umgefärbt).
  a: 'stein.0',
  b: 'stein.1',
  c: 'stein.2',
  d: 'stein.3',
  e: 'stein.4',
  f: 'stein.5',
  // Holz.
  h: 'holz.1',
  o: 'holz.2',
  O: 'holz.3',
  H: 'holz.4',
  // Lederwicklung.
  W: 'erde.2',
  w: 'erde.1',
  // Schnur.
  r: 'sand.3',
  R: 'sand.1',
  // Knochen.
  u: 'sand.2',
  v: 'sand.4',
  V: 'eis.4',
} as const;

const HIEB = { legende: LEGENDE, schmier: 'e', halten: 'unten' } as const;

/** Form → Sprite (Id der Form; die Stufen benennt `stufenSprites` um). */
const form = (f: WaffenForm): Sprite => sprite(waffenQuelle(f));

// ---------------------------------------------------------------------------------------------
// Schwert
// ---------------------------------------------------------------------------------------------

const SCHWERT = { ...HIEB, klasse: 'schwert', wirkpunkt: [0, -8] } as const;

const bronzeschwert = form({
  ...SCHWERT,
  id: 'form_schwert',
  griffZeichen: 'W',
  raster: `...k...
           ..kfk..
           .kfedk.
           .kfedk.
           kfeedck
           kfeedck
           .kfedk.
           .kedck.
           .kedck.
           .kedck.
           kbdddbk
           .kkWkk.
           ..kwk..
           ..k+k..
           ..kwk..
           .kbdbk.
           ..kkk..`,
});

const feuersteinklinge = form({
  ...SCHWERT,
  id: 'form_feuersteinklinge',
  griffZeichen: 'o',
  raster: `...k...
           ..kek..
           ..kfdk.
           .kfedk.
           .kedck.
           .kfdck.
           ..kdbk.
           .kedck.
           .kfdbk.
           .kecbk.
           .krRrk.
           .kRrRk.
           ..kok..
           ..k+k..
           ..kok..
           ..kok..
           ...k...`,
});

// ---------------------------------------------------------------------------------------------
// Axt (auch Werkzeug)
// ---------------------------------------------------------------------------------------------

const AXT = { ...HIEB, klasse: 'axt', werkzeug: true, wirkpunkt: [5, -9] } as const;

const bronzekampfaxt = form({
  ...AXT,
  id: 'form_kampfaxt',
  griffZeichen: 'w',
  raster: `.k....kk.
           kok..kfek
           kokkkfeek
           kobcdeeek
           kobccdeek
           kokkkdeek
           kok..kdek
           kok...kk.
           kok......
           kok......
           kok......
           kwk......
           k+k......
           kwk......
           kok......
           .k.......`,
});

const steinkampfaxt = form({
  ...AXT,
  id: 'form_steinkampfaxt',
  griffZeichen: 'o',
  raster: `.k.......
           kok.kkk..
           korkfeek.
           kRrfeddek
           krRedddck
           kRrdccbak
           korkcbak.
           kok.kkk..
           kok......
           kok......
           kok......
           krk......
           k+k......
           kRk......
           kok......
           .k.......`,
});

// ---------------------------------------------------------------------------------------------
// Keule
// ---------------------------------------------------------------------------------------------

const KEULE = { ...HIEB, klasse: 'keule', wirkpunkt: [0, -9] } as const;

const bronzestreitkolben = form({
  ...KEULE,
  id: 'form_streitkolben',
  griffZeichen: 'w',
  raster: `.k.k.k.
           kfkekdk
           kfeedck
           kfedcck
           kedccbk
           .kdcbk.
           ..kbk..
           ..kok..
           ..kok..
           ..kok..
           ..kok..
           ..kwk..
           ..k+k..
           ..kwk..
           ..kbk..
           ...k...`,
});

const knochenkeule = form({
  ...KEULE,
  id: 'form_knochenkeule',
  griffZeichen: 'r',
  raster: `.kk.kk.
           kvVkVvk
           kuvVvuk
           .kuvuk.
           ..kuvk.
           ..kuvk.
           ..kuvk.
           ..kuvk.
           ..kuvk.
           ..kuvk.
           .krRrk.
           ..kRk..
           ..k+k..
           ..kRk..
           .kuvuk.
           ..kkk..`,
});

const holzkeule = form({
  ...KEULE,
  schmier: 'H',
  id: 'ausruestung_holzkeule',
  griffZeichen: 'o',
  raster: `..kkk..
           .kOHOk.
           kOHOOok
           kHOoohk
           kOOoohk
           .kOohk.
           .kOohk.
           ..kok..
           ..kok..
           ..kok..
           ..kok..
           ..kok..
           ..k+k..
           ..kok..
           ...k...`,
});

// ---------------------------------------------------------------------------------------------
// Speer
// ---------------------------------------------------------------------------------------------

const bronzespeer = form({
  ...HIEB,
  klasse: 'speer',
  id: 'form_speer',
  griffZeichen: 'o',
  halten: 'oben',
  spiegelbar: true,
  wirkpunkt: [0, -15],
  raster: `..k..
           .kfk.
           kfedk
           kfedk
           kfddk
           .kdk.
           .kbk.
           .kok.
           .kok.
           .kok.
           .kok.
           .kok.
           .kok.
           .kok.
           .kok.
           .kok.
           .kwk.
           .k+k.
           .kwk.
           .kok.
           ..k..`,
});

// ---------------------------------------------------------------------------------------------
// Dolch
// ---------------------------------------------------------------------------------------------

const DOLCH = { ...HIEB, klasse: 'dolch', wirkpunkt: [0, -5] } as const;

const bronzedolch = form({
  ...DOLCH,
  id: 'form_dolch',
  griffZeichen: 'w',
  raster: `..k..
           .kek.
           kfedk
           kfedk
           kfdck
           kbcbk
           .kwk.
           .kwk.
           .k+k.
           .kwk.
           .kck.
           ..k..`,
});

const knochendolch = form({
  ...DOLCH,
  id: 'form_knochendolch',
  griffZeichen: 'r',
  schmier: 'v',
  raster: `..k..
           .kvk.
           kVvuk
           kVvuk
           .kvuk
           .kvk.
           krRrk
           .kRk.
           .k+k.
           .kRk.
           .kvk.
           ..k..`,
});

// ---------------------------------------------------------------------------------------------
// Zweihand
// ---------------------------------------------------------------------------------------------

const ZWEIHAND = { ...HIEB, klasse: 'zweihand' } as const;
const HAMMER = { ...ZWEIHAND, wirkpunkt: [0, -15] } as const;

const bronzekriegshammer = form({
  ...HAMMER,
  id: 'form_kriegshammer',
  griffZeichen: 'w',
  raster: `....kkkk.
           .kkkfeedk
           kdkkfeedk
           kcddeddck
           .kbbedcbk
           ..kkkdcbk
           ....kbkk.
           ....kok..
           ....kok..
           ....kok..
           ....kok..
           ....kok..
           ....kok..
           ....kok..
           ....kok..
           ....kwk..
           ....kwk..
           ....k+k..
           ....kwk..
           ....kwk..
           ....kbk..
           .....k...`,
});

const felsbrecher = form({
  ...HAMMER,
  id: 'form_felsbrecher',
  griffZeichen: 'o',
  schmier: 'f',
  raster: `..kkkkkk.
           .kfeeedck
           kfeedrdck
           kedrRrcbk
           kddcrcbak
           kdcbbbaak
           .kkkokkk.
           ....kok..
           ....kok..
           ....kok..
           ....kok..
           ....kok..
           ....kok..
           ....kok..
           ....kok..
           ....krk..
           ....kRk..
           ....k+k..
           ....kRk..
           ....krk..
           ....kok..
           .....k...`,
});

const bronzezweihaender = form({
  ...ZWEIHAND,
  id: 'form_zweihaender',
  griffZeichen: 'W',
  wirkpunkt: [0, -12],
  raster: `...k...
           ..kfk..
           .kfedk.
           .kfedk.
           .kfedk.
           .kfedk.
           .kfedk.
           .kfedk.
           .kedck.
           .kedck.
           .kedck.
           .kedck.
           .kedck.
           .kedck.
           kbddddk
           kkbddbk
           ..kwk..
           ..kWk..
           ..k+k..
           ..kWk..
           ..kwk..
           .kbdbk.
           ..kkk..`,
});

const bronzegrossaxt = form({
  ...ZWEIHAND,
  id: 'form_grossaxt',
  griffZeichen: 'W',
  werkzeug: true,
  wirkpunkt: [5, -14],
  raster: `.k.....kk.
           kok...kfek
           kok..kfeek
           kokkkfeeek
           kobbcdeeek
           kobccddeek
           kokkkcddek
           kok..kcdek
           kok...kcek
           kok....kk.
           kok.......
           kok.......
           kok.......
           kok.......
           kok.......
           kwk.......
           kWk.......
           k+k.......
           kWk.......
           kwk.......
           kok.......
           .k........`,
});

export default [
  ...stufenSprites({ metall: bronzeschwert, bronze: 'bronzeschwert', stein: { form: feuersteinklinge, id: 'feuersteinklinge' } }, 'ausruestung_'),
  ...stufenSprites({ metall: bronzekampfaxt, bronze: 'bronzekampfaxt', stein: { form: steinkampfaxt, id: 'steinkampfaxt' } }, 'ausruestung_'),
  ...stufenSprites({ metall: bronzestreitkolben, bronze: 'bronzestreitkolben', stein: { form: knochenkeule, id: 'knochenkeule' } }, 'ausruestung_'),
  holzkeule,
  ...stufenSprites({ metall: bronzespeer, bronze: 'bronzespeer' }, 'ausruestung_'),
  ...stufenSprites({ metall: bronzedolch, bronze: 'bronzedolch', stein: { form: knochendolch, id: 'knochendolch' } }, 'ausruestung_'),
  ...stufenSprites({ metall: bronzekriegshammer, bronze: 'bronzekriegshammer', stein: { form: felsbrecher, id: 'felsbrecher' } }, 'ausruestung_'),
  ...stufenSprites({ metall: bronzezweihaender, bronze: 'bronzezweihaender' }, 'ausruestung_'),
  ...stufenSprites({ metall: bronzegrossaxt, bronze: 'bronzegrossaxt' }, 'ausruestung_'),
];
