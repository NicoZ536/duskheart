/**
 * Hand-Layer der T0-Werkzeuge und der Steinspeer (M3-07; kanonische Ids docs/SPIEL.md §6):
 * `ausruestung_<itemId>`, gehalten am Sockel `hand` der Spielfigur. Jede Form ist einmal aufrecht
 * gezeichnet (Griffpixel `+`, Klinge zur rechten Seite); Lagen, Spiegelbilder, Smear-Frames und Clips
 * baut `werkzeugSprite` (assets-src/lib/figureWerkzeug.ts).
 *
 * Maßstab: Figur 16×24, Hand 2×2 – die Stiele sind 1 px Holz mit Kontur (3 px breit), Werkzeugköpfe
 * 3–7 px, damit Axt, Hacke und Spitzhacke in der Hand auf einen Blick verschieden sind (Keil, Winkel,
 * Doppelspitze). Köpfe aus geschlagenem Stein in `stein` (Schneide `stein.4`, Unterseite `stein.1` als
 * Umgebungsverdeckung), mit gedrehter Schnur (`sand`, Drall als Wechsel hell/dunkel) gebunden – dieselbe
 * Formsprache wie die T0-Steinaxt im Werkzeugbogen (docs/ART.md §11). Eimer hängen am Bügel und drehen
 * sich nicht (kein Schlag, Halte-Frame in allen Clips).
 */
import { werkzeugSprite, type WerkzeugForm } from '../../lib/figureWerkzeug';
import { sprite } from '../../lib/sprite';

const LEGENDE = {
  '.': null,
  k: 'nacht.1',
  h: 'holz.1',
  o: 'holz.2',
  O: 'holz.3',
  b: 'stein.1',
  c: 'stein.2',
  d: 'stein.3',
  e: 'stein.4',
  r: 'sand.3',
  R: 'sand.1',
} as const;

const STEIN = { legende: LEGENDE, griffZeichen: 'o', schmier: 'e', halten: 'unten' } as const;

const FORMEN: readonly WerkzeugForm[] = [
  {
    ...STEIN,
    id: 'ausruestung_steinaxt',
    // Geschlagener Keil, an den Stiel geschnürt; der Stiel steht oben als Knauf über.
    raster: `.k....
             kokkk.
             kRddek
             krcdek
             kRcdek
             krbbk.
             kokk..
             kok...
             kok...
             kok...
             kok...
             kok...
             k+k...
             kok...
             .k....`,
    wirkpunkt: [2, -9],
  },
  {
    ...STEIN,
    id: 'ausruestung_steinspitzhacke',
    // Doppelspitze quer zum Stiel, beide Spitzen nach unten gebogen, Mitte geschnürt.
    raster: `..kkkkk..
             .kddrdek.
             kdckrkdek
             kckkrkkdk
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
  },
  {
    ...STEIN,
    id: 'ausruestung_steinschaufel',
    // Flaches Steinblatt in Verlängerung des Stiels, Schneide oben hell, Bindung am Blattfuß.
    raster: `.kkkkk.
             kdeeedk
             kcdedck
             kcdddck
             kbcccbk
             .kkrkk.
             ..krk..
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
    ...STEIN,
    id: 'ausruestung_steinhacke',
    // Querblatt nach vorn, zur Schneide hin länger und nach unten gezogen.
    raster: `.kkk...
             kRddkk.
             kRcdddk
             kRccdek
             kokkkek
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
    ...STEIN,
    id: 'ausruestung_steinsichel',
    // Kurzer Griff, Steinklinge als Haken nach vorn gebogen, Schneide innen hell.
    raster: `.kkkk.
             keddek
             kdkkdk
             kok.kk
             kok...
             kok...
             k+k...
             kok...
             .k....`,
    wirkpunkt: [2, -5],
  },
  {
    ...STEIN,
    id: 'ausruestung_steinhammer',
    // Steinblock quer auf dem Stiel, mittig geschnürt.
    raster: `.kkkkk.
             kedRdek
             kcdRdck
             kbcRcbk
             .kkokk.
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
    ...STEIN,
    id: 'ausruestung_steinmesser',
    // Kurze Steinklinge, Schneide rechts hell, Griff mit Schnur.
    raster: `.k..
             kek.
             kdek
             kdek
             kcck
             kRRk
             kok.
             k+k.
             kok.
             .k..`,
    wirkpunkt: [1, -5],
  },
  {
    ...STEIN,
    id: 'ausruestung_steinspeer',
    // Langer Schaft, blattförmige Steinspitze mit Mittelgrat, Schnurbindung.
    raster: `..k..
             .kek.
             kdedk
             kcdck
             kcdck
             .kRk.
             .kRk.
             .kok.
             .kok.
             .kok.
             .kok.
             .kok.
             .kok.
             .kok.
             .kok.
             .kok.
             .kok.
             .k+k.
             .kok.
             .kok.
             ..k..`,
    wirkpunkt: [0, -15],
    spiegelbar: true,
    halten: 'oben',
  },
];

const EIMER_LEGENDE = { ...LEGENDE, w: 'wasser.3', W: 'wasser.4' } as const;
const EIMER = { legende: EIMER_LEGENDE, griffZeichen: 'r', schmier: null, spiegelbar: true, halten: 'oben' } as const;

/** Holzeimer am Schnurbügel; der Griffpixel ist der Bügelscheitel. Mit Wasser: Spiegel in `wasser`. */
const EIMER_FORMEN: readonly WerkzeugForm[] = [
  {
    ...EIMER,
    id: 'ausruestung_holzeimer',
    raster: `..r+r..
             .r...r.
             .kkkkk.
             kohhhok
             kOoooOk
             kRrRrRk
             kOoooOk
             .kkkkk.`,
    wirkpunkt: [0, 4],
  },
  {
    ...EIMER,
    id: 'ausruestung_holzeimer_wasser',
    raster: `..r+r..
             .r...r.
             .kkkkk.
             kwwWWwk
             kOoooOk
             kRrRrRk
             kOoooOk
             .kkkkk.`,
    wirkpunkt: [0, 4],
  },
];

export default [...FORMEN, ...EIMER_FORMEN].map((f) => sprite(werkzeugSprite(f)));
