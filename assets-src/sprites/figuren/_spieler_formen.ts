/**
 * Körperformen der Spielfigur (M7-53; MASTERPROMPT §26 „Charaktererstellung (Name, Körperform …)“; docs/SPIEL.md §26):
 * `schmal`, `mittel`, `kraeftig`. Eine Form ist ein eigener Rumpf je Richtung und die Schultern, an denen das Rig die Arme
 * ansetzt (`_spieler_rig.ts`); Kopf, Beine und Hüften bleiben gleich, damit Kopf-Sockel, Helme und Frisuren in jeder Form
 * auf denselben Pixeln sitzen und die Füße auf derselben Linie stehen.
 *
 * - `mittel`: die Figur bis M6 (Rumpf 10 px breit, `_spieler_teile.ts`) – die Sprites behalten ihre Namen (`spieler_basis`).
 * - `schmal`: von vorn und hinten 8 px (die Schultern je 1 px nach innen), im Profil 1 px flacher an Brust und Bauch.
 * - `kraeftig`: von vorn und hinten 12 px mit breiten Schultern (je 1 px nach außen), im Profil 1 px tiefer an Brust und
 *   Bauch und mit rundem Rücken.
 * Die Arme wandern mit den Schultern; mit ihnen Hand-Sockel, Werkzeug, Waffe und Licht (Unit-Test Sockel-Mapping,
 * tests/unit/assets/koerperformen.test.ts). Material-Zeichen wie `_spieler_teile.ts` (`b t T` Tunika/Unterkleid, `g G`
 * Gürtel, `m` Hals, `k` Kontur).
 */
import { gespiegelt, teil, type Richtung, type Teil } from '../../lib/figure';
import { RUMPFE, type RumpfVariante } from './_spieler_teile';

/** Die Körperformen in der Reihenfolge der Charaktererstellung (docs/SPIEL.md §29). */
export const KOERPERFORMEN = ['schmal', 'mittel', 'kraeftig'] as const;
/** Eine Körperform. */
export type KoerperForm = (typeof KOERPERFORMEN)[number];

/** Schulterpunkte im Körperrahmen je Richtung: [rechter Arm, linker Arm] (Profil nach links: das gespiegelte Profil). */
export type Schultern = Readonly<Record<'down' | 'up' | 'right', readonly [readonly [number, number], readonly [number, number]]>>;

/** Rumpf je Richtung (nach links das Spiegelbild des Profils nach rechts). */
type RumpfSatz = Readonly<Record<Richtung, Readonly<Record<RumpfVariante, Teil>>>>;

function satz(down: string, up: string, right: string): RumpfSatz {
  const rechts = teil(right);
  return { down: { normal: teil(down) }, up: { normal: teil(up) }, right: { normal: rechts }, left: { normal: gespiegelt(rechts) } };
}

// ---------------------------------------------------------------------------------------------
// Schmal: 8 px breit, im Profil flacher (9 Zeilen wie `mittel`: der Rock endet über zwei Zeilen Hose, M7-111)
// ---------------------------------------------------------------------------------------------

const SCHMAL = satz(
  `....kbmmmmbk....
   ....kbTTTTbk....
   ....kbTTTTbk....
   ....ktTTTTtk....
   ....kttttttk....
   ....kggGGggk....
   ....kbttttbk....
   ....kbbttbbk....
   ....kkbbbbkk....`,
  `....kbbbbbbk....
   ....kbtttTbk....
   ....kbtttTbk....
   ....kttttTtk....
   ....kttttttk....
   ....kgggggGk....
   ....kbttttbk....
   ....kbbttbbk....
   ....kkbbbbkk....`,
  `....kkbmmkk.....
   ..kkbttTTtbk....
   ..kbbttTTttk....
   ..kbbttttttk....
   ..kbbtttttbk....
   ..kgggggggGk....
   ..kbbbtttbbk....
   ...kbbtttbk.....
   ....kkbbbk......`,
);

// ---------------------------------------------------------------------------------------------
// Kräftig: 12 px breit mit breiten Schultern, unten zum Saum eingezogen; im Profil tiefer an Brust, Bauch und Rücken (9 Zeilen,
// M7-111)
// ---------------------------------------------------------------------------------------------

const KRAEFTIG = satz(
  `...kkbmmmmbkk...
   ..kbbtTTTTtbbk..
   ..kbttTTTTttbk..
   ..kbttTTTTttbk..
   ..kttttttttttk..
   ..kggggGGggggk..
   ..kbttttttttbk..
   ...kbbttttbbk...
   ...kkbbbbbbkk...`,
  `...kkbbbbbbkk...
   ..kbbtttttTbbk..
   ..kbtttttttTbk..
   ..kttttttttTtk..
   ..kttttttttttk..
   ..kgggggggggGk..
   ..kbttttttttbk..
   ...kbbttttbbk...
   ...kkbbbbbbkk...`,
  `....kkbmmmkk....
   ..kkbttTTttbkk..
   .kbbbttTTttttk..
   .kbbtttttttttk..
   .kbbtttttttttk..
   .kggggggggggGk..
   .kbbbttttttbbk..
   ..kbbttttttbk...
   ...kkbbbbbbk....`,
);

/** Rümpfe je Körperform (`mittel` = die gezeichneten Rümpfe bis M6). */
export const RUMPFE_FORM: Readonly<Record<KoerperForm, RumpfSatz>> = { schmal: SCHMAL, mittel: RUMPFE, kraeftig: KRAEFTIG };

/**
 * Schulterpunkte je Körperform (`_spieler_rig.ts` setzt die Arme dort an): von vorn und hinten sitzen die Arme am
 * Rumpfrand – schmal je 1 px innen, kräftig je 1 px außen –, im Profil bleiben sie (der Rumpf wird nur tiefer oder flacher).
 */
export const SCHULTER_FORM: Readonly<Record<KoerperForm, Schultern>> = {
  schmal: {
    down: [
      [4, 12],
      [11, 12],
    ],
    up: [
      [11, 12],
      [4, 12],
    ],
    right: [
      [7, 12],
      [6, 12],
    ],
  },
  mittel: {
    down: [
      [3, 12],
      [12, 12],
    ],
    up: [
      [12, 12],
      [3, 12],
    ],
    right: [
      [7, 12],
      [6, 12],
    ],
  },
  kraeftig: {
    down: [
      [2, 12],
      [13, 12],
    ],
    up: [
      [13, 12],
      [2, 12],
    ],
    right: [
      [7, 12],
      [6, 12],
    ],
  },
};

/** Versatz der Schultern einer Form gegen `mittel` [px] je Richtung und Arm (r = Hand, l = Nebenhand). */
export function schulterVersatz(form: KoerperForm, richtung: Richtung, seite: 'r' | 'l'): number {
  const geo = richtung === 'left' ? 'right' : richtung;
  // Nach links spielt der rechte Arm die Rolle des fernen (wie im Rig).
  const rolle = (seite === 'r') !== (richtung === 'left') ? 0 : 1;
  const d = (SCHULTER_FORM[form][geo][rolle]?.[0] ?? 0) - (SCHULTER_FORM.mittel[geo][rolle]?.[0] ?? 0);
  return richtung === 'left' ? -d : d;
}
