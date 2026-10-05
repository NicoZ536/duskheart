/**
 * Kampfanimationen der Spielfigur (M6-10; MASTERPROMPT §4.5 „Angriff je Waffenklasse 4–6, … je 4 Richtungen“, „Animation
 * mit Antizipation, Überschwingen und Smear-Frames“; docs/SPIEL.md §13 „Spieler-Kampfclips“; docs/ART.md §4).
 *
 * Clips `<aktion>_<richtung>` auf demselben Rig wie alle Körper-Clips (`_spieler_rig.ts`, Hand-Sockel je Frame), dazu
 * `<aktion>_licht` für die einhändigen Angriffe mit einem Licht in der Nebenhand:
 * - `attack_<klasse>` – der leichte Schlag bzw. Schuss je Waffenklasse (`WEAPON_CLASSES`: Faust, Schwert, Axt, Keule,
 *   Speer, Dolch, Zweihand, Bogen, Armbrust, Schleuder, Wurf): Ausholen über zwei Bilder (Antizipation, gehalten),
 *   Smear-Bild (gestreckter Arm mit heller Bewegungsspur; die Waffe zeigt ihren Schmierbogen), Treffer/Durchschwung
 *   (Körper federt nach), Erholung.
 * - `heavy_<klasse>` – der schwere Angriff der Nahkampfklassen: tiefere Antizipation und längeres Halten, ein größerer
 *   Bogen, stärkeres Nachfedern; das Schwert dreht sich einmal um sich selbst (Rundumhieb, §19.2), der Speer wird
 *   geworfen, der Dolch stößt im Ausfallschritt.
 * - `block` – Deckung: die Nebenhand (Schild) hebt sich vor den Körper, die Waffenhand quer davor; zweites Bild geduckt.
 * - `attack_bogen` – Bogen: Pfeil auflegen, spannen (die Nebenhand zieht die Sehne zum Kinn, gehalten), lösen (die Hand
 *   schnellt zurück), Erholung. Der Bogen liegt in der Waffenhand (Sockel `hand`), die Nebenhand zieht. Schräg nach oben
 *   gezielt zeigt das Profil eigene gedrehte Bilder (`KAMPF_GEDREHT`, Clips `_linksrum`/`_rechtsrum`): der Bogenarm gehoben.
 * - `attack_wurf` – Werfen (Wurfmesser, Brandflasche): Ausholen über den Kopf, Smear, Nachschwung.
 *
 * Takt (Figurentakt 8–12 fps): Angriffe 12 fps (0,3–0,9 s, die schweren länger), Block 8 fps, Bogen 10 fps. Events: `schwung` auf dem
 * Smear-Bild (der Klang des Schlags, das Kampfsystem meldet den Treffer selbst), `sehne` beim Lösen, `wurf` beim Werfen.
 * Die Waffen im Hand-Layer folgen je Bild mit ihrer Lage (`assets-src/sprites/waffen/_waffe.ts`, `KAMPF_WAFFEN_LAGEN`).
 */
import { bildDerPose, type Pose } from './_spieler_rig';
import { type Aktion, type AktionsEvent, type FrameDef, type Sonder } from './_spieler_aktionen';
import type { Richtung } from '../../lib/figure';

/** Stehen mit hängenden Armen (Grundlage aller Kampfposen). */
const STEHEN = { armR: ['haengen'], armL: ['haengen'], beinR: ['stand'], beinL: ['stand'] } as const satisfies Omit<Pose, 'kopf' | 'rumpf'>;

type Arme = Pick<Pose, 'armR' | 'armL'>;
type Beine = Pick<Pose, 'beinR' | 'beinL'>;

/** Leicht in die Knie (Antizipation, Nachfedern). */
const GEDUCKT: Beine = { beinR: ['hocke'], beinL: ['stand'] };
const TIEF: Beine = { beinR: ['hocke'], beinL: ['hocke'] };
/** Ausfallschritt im Profil (nahes Bein weit vor, fernes weit zurück). */
const AUSFALL: Beine = { beinR: ['vorWeit'], beinL: ['zurueckWeit'] };
const SCHRITT: Beine = { beinR: ['vor'], beinL: ['zurueck'] };

/**
 * Eine Kampfpose: Arme, Beine, Kopf- und Rumpfversatz [dx, dy] (im Profil zählt dx nach vorn); `folge` wie im Rig.
 */
function pose(arme: Arme, beine: Beine = STEHEN, k: readonly [number, number] = [0, 0], r: readonly [number, number] = [0, 0], folge?: Pose['folge']): Pose {
  return { armR: arme.armR, armL: arme.armL, beinR: beine.beinR, beinL: beine.beinL, kopf: ['auf', k[0], k[1]], rumpf: ['normal', r[0], r[1]], ...(folge === undefined ? {} : { folge }) };
}

const SCHWUNG = 'schwung';

/** Eine Kampfaktion aus Frames von vorn, hinten und im Profil; Event `schwung` auf dem Smear-Bild `smear`. */
function kampf(name: string, fps: number, folge: readonly number[], smear: number, vorn: readonly FrameDef[], hinten: readonly FrameDef[], profil: readonly FrameDef[], event = SCHWUNG): Aktion {
  const pos = folge.indexOf(smear);
  const events: AktionsEvent[] = pos < 0 ? [] : [{ frame: pos, name: event }];
  return { name, fps, loop: false, folge, events, vorn, hinten, profil };
}

// ---------------------------------------------------------------------------------------------
// Leichte Angriffe
// ---------------------------------------------------------------------------------------------

/** Faust: Gerade – der Arm zieht zurück, die Deckhand hebt sich, der Schlag schnellt nach vorn (Stoß-Smear). */
const faust = kampf(
  'attack_faust',
  12,
  [0, 1, 2, 3, 3],
  2,
  [
    pose({ armR: ['pumpeZurueck'], armL: ['brust'] }, GEDUCKT, [0, 1], [0, 1]),
    pose({ armR: ['pumpeZurueck', 0, -1], armL: ['brust'] }, GEDUCKT, [0, 1], [0, 1]),
    pose({ armR: ['stoss'], armL: ['brust'] }, STEHEN, [0, 0], [0, 0]),
    pose({ armR: ['pumpeVor'], armL: ['brust'] }, STEHEN, [0, 1], [0, 0]),
  ],
  [
    pose({ armR: ['pumpeZurueck'], armL: ['brust'] }, GEDUCKT, [0, 1], [0, 1], 'armeHinten'),
    pose({ armR: ['pumpeZurueck', 0, -1], armL: ['brust'] }, GEDUCKT, [0, 1], [0, 1], 'armeHinten'),
    pose({ armR: ['stoss'], armL: ['brust'] }, STEHEN, [0, 0], [0, 0], 'armeHinten'),
    pose({ armR: ['pumpeVor'], armL: ['brust'] }, STEHEN, [0, 1], [0, 0], 'armeHinten'),
  ],
  [
    pose({ armR: ['pumpeZurueck'], armL: ['pumpeVor'] }, SCHRITT, [-1, 1], [-1, 1]),
    pose({ armR: ['zurueck'], armL: ['pumpeVor'] }, SCHRITT, [-1, 1], [-1, 1]),
    pose({ armR: ['stoss'], armL: ['pumpeZurueck'] }, AUSFALL, [1, 0], [1, 0]),
    pose({ armR: ['paddelVor'], armL: ['pumpeZurueck'] }, SCHRITT, [1, 1], [0, 0]),
  ],
);

/**
 * Schwert: schräger Hieb von der Schulter der Waffenhand quer über den Körper – Ausholen zur Seite, Smear, Durchschwung
 * nach unten, zurück in die Mitte.
 */
const schwert = kampf(
  'attack_schwert',
  12,
  [0, 1, 1, 2, 3, 3, 4],
  2,
  [
    pose({ armR: ['weg'], armL: ['haengen'] }, GEDUCKT, [-1, 0], [0, 1], 'armeHinterKopf'),
    pose({ armR: ['heben'], armL: ['haengen'] }, GEDUCKT, [-1, 0], [0, 1], 'armeHinterKopf'),
    pose({ armR: ['hieb'], armL: ['zurueck'] }, STEHEN, [1, 1], [0, 1]),
    pose({ armR: ['treffer'], armL: ['zurueck'] }, GEDUCKT, [1, 2], [0, 1]),
    pose({ armR: ['vor'], armL: ['haengen'] }, STEHEN, [0, 1], [0, 0]),
  ],
  [
    pose({ armR: ['weg'], armL: ['haengen'] }, GEDUCKT, [1, 0], [0, 1]),
    pose({ armR: ['heben'], armL: ['haengen'] }, GEDUCKT, [1, 0], [0, 1], 'armeHinterKopf'),
    pose({ armR: ['ueberkopf'], armL: ['zurueck'] }, STEHEN, [0, 0], [0, 0], 'armeHinterKopf'),
    pose({ armR: ['heben', 0, 1], armL: ['zurueck'] }, GEDUCKT, [0, 1], [0, 1], 'armeHinterKopf'),
    pose({ armR: ['vor'], armL: ['haengen'] }, STEHEN, [0, 1], [0, 0], 'armeHinten'),
  ],
  [
    pose({ armR: ['zurueck'], armL: ['vor'] }, SCHRITT, [-1, 0], [-1, 1]),
    pose({ armR: ['heben'], armL: ['vor'] }, SCHRITT, [-1, 0], [-1, 1], 'armeHinterKopf'),
    pose({ armR: ['hieb'], armL: ['zurueck'] }, AUSFALL, [1, 1], [1, 1]),
    pose({ armR: ['treffer'], armL: ['zurueck'] }, AUSFALL, [1, 2], [1, 1]),
    pose({ armR: ['vor'], armL: ['haengen'] }, SCHRITT, [1, 1], [0, 0]),
  ],
);

/** Axt: Hieb von oben – anheben, weit über den Kopf ausholen (gehalten), Smear, Einschlag mit gebeugtem Knie. */
const HOLZHACKEN_VORN: readonly Pose[] = [
  pose({ armR: ['heben'], armL: ['haengen'] }, STEHEN, [0, 0], [0, 0], 'armeHinterKopf'),
  pose({ armR: ['hoch'], armL: ['haengen'] }, STEHEN, [0, -1], [0, 0], 'armeHinterKopf'),
  pose({ armR: ['schlag'], armL: ['haengen'] }, GEDUCKT, [0, 1], [0, 1]),
  pose({ armR: ['treffer'], armL: ['haengen'] }, TIEF, [0, 3], [0, 2]),
  pose({ armR: ['vor'], armL: ['haengen'] }, GEDUCKT, [0, 1], [0, 1]),
];
const axt = kampf(
  'attack_axt',
  12,
  [0, 1, 1, 2, 3, 3, 4],
  2,
  HOLZHACKEN_VORN,
  [
    pose({ armR: ['heben'], armL: ['haengen'] }, STEHEN, [0, 0], [0, 0], 'armeHinterKopf'),
    pose({ armR: ['hoch'], armL: ['haengen'] }, STEHEN, [0, -1], [0, 0], 'armeHinterKopf'),
    pose({ armR: ['ueberkopf'], armL: ['haengen'] }, GEDUCKT, [0, 1], [0, 1], 'armeHinterKopf'),
    pose({ armR: ['treffer'], armL: ['haengen'] }, TIEF, [0, 3], [0, 2], 'armeHinten'),
    pose({ armR: ['vor'], armL: ['haengen'] }, GEDUCKT, [0, 1], [0, 1], 'armeHinten'),
  ],
  [
    pose({ armR: ['heben'], armL: ['vor'] }, STEHEN, [-1, 0], [0, 0], 'armeHinterKopf'),
    pose({ armR: ['hoch'], armL: ['vor'] }, STEHEN, [-1, -1], [-1, 0], 'armeHinterKopf'),
    pose({ armR: ['schlag'], armL: ['zurueck'] }, SCHRITT, [1, 1], [1, 1]),
    pose({ armR: ['treffer'], armL: ['zurueck'] }, AUSFALL, [1, 3], [1, 2]),
    pose({ armR: ['vor'], armL: ['haengen'] }, SCHRITT, [1, 1], [0, 1]),
  ],
);

/** Keule: weiter Seitschwung – tief hinter den Körper ausholen, flach durchziehen (Smear), der Körper dreht nach. */
const keule = kampf(
  'attack_keule',
  12,
  [0, 1, 1, 2, 3, 3, 4],
  2,
  [
    pose({ armR: ['weg', 0, 1], armL: ['brust'] }, GEDUCKT, [-1, 1], [-1, 1]),
    pose({ armR: ['weg'], armL: ['brust'] }, TIEF, [-1, 2], [-1, 2]),
    pose({ armR: ['hieb'], armL: ['zurueck'] }, GEDUCKT, [1, 1], [1, 1]),
    pose({ armR: ['deckung'], armL: ['zurueck'] }, STEHEN, [1, 1], [1, 0]),
    pose({ armR: ['vor'], armL: ['haengen'] }, STEHEN, [0, 1], [0, 0]),
  ],
  [
    pose({ armR: ['weg', 0, 1], armL: ['brust'] }, GEDUCKT, [1, 1], [1, 1], 'armeHinten'),
    pose({ armR: ['weg'], armL: ['brust'] }, TIEF, [1, 2], [1, 2], 'armeHinten'),
    pose({ armR: ['ueberkopf'], armL: ['zurueck'] }, GEDUCKT, [0, 1], [0, 1], 'armeHinterKopf'),
    pose({ armR: ['heben', 0, 1], armL: ['zurueck'] }, STEHEN, [0, 1], [0, 0], 'armeHinterKopf'),
    pose({ armR: ['vor'], armL: ['haengen'] }, STEHEN, [0, 1], [0, 0], 'armeHinten'),
  ],
  [
    pose({ armR: ['zurueck'], armL: ['pumpeVor'] }, SCHRITT, [-1, 1], [-1, 1]),
    pose({ armR: ['zurueck', -1, 0], armL: ['pumpeVor'] }, TIEF, [-2, 2], [-1, 2]),
    pose({ armR: ['hieb'], armL: ['zurueck'] }, AUSFALL, [1, 1], [1, 1]),
    pose({ armR: ['paddelVor'], armL: ['zurueck'] }, AUSFALL, [2, 1], [1, 1]),
    pose({ armR: ['vor'], armL: ['haengen'] }, SCHRITT, [1, 1], [0, 0]),
  ],
);

/** Speer: Stoß – zurückziehen, sinken, der Arm schnellt gestreckt nach vorn (Stoß-Smear), gestreckt gehalten. */
const speer = kampf(
  'attack_speer',
  12,
  [0, 1, 2, 3, 3, 4],
  2,
  [
    pose({ armR: ['brust'], armL: ['pumpeVor'] }, STEHEN, [0, 0], [0, 0]),
    pose({ armR: ['brust', 0, -1], armL: ['pumpeVor'] }, GEDUCKT, [0, 1], [0, 1]),
    pose({ armR: ['stoss'], armL: ['zurueck'] }, STEHEN, [0, 0], [0, 0]),
    pose({ armR: ['pumpeVor'], armL: ['zurueck'] }, STEHEN, [0, 1], [0, 0]),
    pose({ armR: ['vor'], armL: ['haengen'] }, STEHEN, [0, 1], [0, 0]),
  ],
  [
    pose({ armR: ['brust'], armL: ['pumpeVor'] }, STEHEN, [0, 0], [0, 0], 'armeHinten'),
    pose({ armR: ['brust', 0, -1], armL: ['pumpeVor'] }, GEDUCKT, [0, 1], [0, 1], 'armeHinten'),
    pose({ armR: ['hochstoss'], armL: ['zurueck'] }, STEHEN, [0, 0], [0, 0], 'armeHinterKopf'),
    pose({ armR: ['heben', 0, -1], armL: ['zurueck'] }, STEHEN, [0, 1], [0, 0], 'armeHinterKopf'),
    pose({ armR: ['vor'], armL: ['haengen'] }, STEHEN, [0, 1], [0, 0], 'armeHinten'),
  ],
  [
    pose({ armR: ['zurueck'], armL: ['pumpeVor'] }, SCHRITT, [-1, 0], [-1, 0]),
    pose({ armR: ['zurueck', -1, 1], armL: ['pumpeVor'] }, TIEF, [-1, 2], [-1, 2]),
    pose({ armR: ['stoss'], armL: ['zurueck'] }, AUSFALL, [2, 1], [1, 1]),
    pose({ armR: ['paddelVor'], armL: ['zurueck'] }, AUSFALL, [1, 1], [1, 1]),
    pose({ armR: ['vor'], armL: ['haengen'] }, SCHRITT, [0, 1], [0, 0]),
  ],
);

/** Dolch: kurzer, schneller Stich aus der Brust (vier Bilder). */
const dolch = kampf(
  'attack_dolch',
  12,
  [0, 1, 2, 3],
  1,
  [
    pose({ armR: ['brust'], armL: ['haengen'] }, GEDUCKT, [0, 1], [0, 1]),
    pose({ armR: ['stoss'], armL: ['haengen'] }, STEHEN, [0, 0], [0, 0]),
    pose({ armR: ['pumpeVor'], armL: ['haengen'] }, STEHEN, [0, 1], [0, 0]),
    pose({ armR: ['vor'], armL: ['haengen'] }, STEHEN, [0, 0], [0, 0]),
  ],
  [
    pose({ armR: ['brust'], armL: ['haengen'] }, GEDUCKT, [0, 1], [0, 1], 'armeHinten'),
    pose({ armR: ['hochstoss'], armL: ['haengen'] }, STEHEN, [0, 0], [0, 0], 'armeHinterKopf'),
    pose({ armR: ['heben', 0, -1], armL: ['haengen'] }, STEHEN, [0, 1], [0, 0], 'armeHinterKopf'),
    pose({ armR: ['vor'], armL: ['haengen'] }, STEHEN, [0, 0], [0, 0], 'armeHinten'),
  ],
  [
    pose({ armR: ['pumpeZurueck'], armL: ['vor'] }, GEDUCKT, [0, 1], [0, 1]),
    pose({ armR: ['stoss'], armL: ['zurueck'] }, SCHRITT, [1, 0], [1, 0]),
    pose({ armR: ['paddelVor'], armL: ['zurueck'] }, SCHRITT, [1, 1], [0, 0]),
    pose({ armR: ['vor'], armL: ['haengen'] }, STEHEN, [0, 0], [0, 0]),
  ],
);

/** Zweihand: beide Hände am Griff, langsam hoch über den Kopf (gehalten), Smear, schwerer Einschlag tief in den Knien. */
const zweihand = kampf(
  'attack_zweihand',
  12,
  [0, 1, 1, 1, 2, 3, 3, 3, 4],
  2,
  [
    pose({ armR: ['heben'], armL: ['brust'] }, GEDUCKT, [0, 1], [0, 1], 'armeHinterKopf'),
    pose({ armR: ['hoch'], armL: ['hoch'] }, STEHEN, [0, -1], [0, 0], 'armeHinterKopf'),
    pose({ armR: ['schlag'], armL: ['brust'] }, GEDUCKT, [0, 1], [0, 1]),
    pose({ armR: ['treffer'], armL: ['vor'] }, TIEF, [0, 4], [0, 3]),
    pose({ armR: ['vor'], armL: ['vor'] }, GEDUCKT, [0, 2], [0, 1]),
  ],
  [
    pose({ armR: ['heben'], armL: ['brust'] }, GEDUCKT, [0, 1], [0, 1], 'armeHinterKopf'),
    pose({ armR: ['hoch'], armL: ['hoch'] }, STEHEN, [0, -1], [0, 0], 'armeHinterKopf'),
    pose({ armR: ['ueberkopf'], armL: ['brust'] }, GEDUCKT, [0, 1], [0, 1], 'armeHinterKopf'),
    pose({ armR: ['treffer'], armL: ['vor'] }, TIEF, [0, 4], [0, 3], 'armeHinten'),
    pose({ armR: ['vor'], armL: ['vor'] }, GEDUCKT, [0, 2], [0, 1], 'armeHinten'),
  ],
  [
    pose({ armR: ['heben'], armL: ['heben'] }, GEDUCKT, [-1, 1], [-1, 1], 'armeHinterKopf'),
    pose({ armR: ['hoch'], armL: ['hoch'] }, SCHRITT, [-1, -1], [-1, 0], 'armeHinterKopf'),
    pose({ armR: ['schlag'], armL: ['schlag'] }, AUSFALL, [1, 1], [1, 1]),
    pose({ armR: ['treffer'], armL: ['treffer'] }, TIEF, [1, 4], [1, 3]),
    pose({ armR: ['vor'], armL: ['vor'] }, SCHRITT, [1, 2], [0, 1]),
  ],
);

/** Armbrust: anlegen (beide Hände vorn), zielen (gehalten), Rückstoß beim Abzug, wieder anlegen. */
const armbrust = kampf(
  'attack_armbrust',
  12,
  [0, 1, 2, 3, 3],
  2,
  [
    pose({ armR: ['vor'], armL: ['vor'] }, STEHEN, [0, 0], [0, 0]),
    pose({ armR: ['pumpeVor'], armL: ['pumpeVor'] }, STEHEN, [0, 0], [0, 0]),
    pose({ armR: ['pumpeVor', 0, -1], armL: ['pumpeVor', 0, -1] }, STEHEN, [0, -1], [0, -1]),
    pose({ armR: ['pumpeVor'], armL: ['pumpeVor'] }, STEHEN, [0, 0], [0, 0]),
  ],
  [
    pose({ armR: ['vor'], armL: ['vor'] }, STEHEN, [0, 0], [0, 0], 'armeHinten'),
    pose({ armR: ['pumpeVor'], armL: ['pumpeVor'] }, STEHEN, [0, 0], [0, 0], 'armeHinten'),
    pose({ armR: ['pumpeVor', 0, -1], armL: ['pumpeVor', 0, -1] }, STEHEN, [0, -1], [0, -1], 'armeHinten'),
    pose({ armR: ['pumpeVor'], armL: ['pumpeVor'] }, STEHEN, [0, 0], [0, 0], 'armeHinten'),
  ],
  [
    pose({ armR: ['vor'], armL: ['vor'] }, SCHRITT, [0, 0], [0, 0]),
    pose({ armR: ['strecken'], armL: ['paddelVor'] }, SCHRITT, [1, 0], [0, 0]),
    pose({ armR: ['strecken', -1, 0], armL: ['paddelVor', -1, 0] }, SCHRITT, [-1, 0], [-1, 0]),
    pose({ armR: ['strecken'], armL: ['paddelVor'] }, SCHRITT, [1, 0], [0, 0]),
  ],
  'abzug',
);

/** Schleuder: die Hand kreist über dem Kopf (drei Bilder), Smear beim Lösen, Nachschwung. */
const schleuder = kampf(
  'attack_schleuder',
  12,
  [0, 1, 2, 3, 4],
  3,
  [
    pose({ armR: ['heben'], armL: ['haengen'] }, STEHEN, [0, 0], [0, 0], 'armeHinterKopf'),
    pose({ armR: ['hoch'], armL: ['haengen'] }, STEHEN, [0, -1], [0, 0], 'armeHinterKopf'),
    pose({ armR: ['tragen'], armL: ['haengen'] }, STEHEN, [0, 0], [0, 0], 'armeHinterKopf'),
    pose({ armR: ['schlag'], armL: ['vor'] }, GEDUCKT, [0, 1], [0, 1]),
    pose({ armR: ['treffer'], armL: ['haengen'] }, GEDUCKT, [0, 1], [0, 1]),
  ],
  [
    pose({ armR: ['heben'], armL: ['haengen'] }, STEHEN, [0, 0], [0, 0], 'armeHinterKopf'),
    pose({ armR: ['hoch'], armL: ['haengen'] }, STEHEN, [0, -1], [0, 0], 'armeHinterKopf'),
    pose({ armR: ['tragen'], armL: ['haengen'] }, STEHEN, [0, 0], [0, 0], 'armeHinterKopf'),
    pose({ armR: ['heben', 0, 1], armL: ['vor'] }, GEDUCKT, [0, 1], [0, 1], 'armeHinten'),
    pose({ armR: ['treffer'], armL: ['haengen'] }, GEDUCKT, [0, 1], [0, 1], 'armeHinten'),
  ],
  [
    pose({ armR: ['heben'], armL: ['vor'] }, SCHRITT, [0, 0], [0, 0], 'armeHinterKopf'),
    pose({ armR: ['hoch'], armL: ['vor'] }, SCHRITT, [-1, -1], [0, 0], 'armeHinterKopf'),
    pose({ armR: ['tragen'], armL: ['vor'] }, SCHRITT, [0, 0], [0, 0], 'armeHinterKopf'),
    pose({ armR: ['schlag'], armL: ['zurueck'] }, AUSFALL, [1, 1], [1, 1]),
    pose({ armR: ['treffer'], armL: ['zurueck'] }, SCHRITT, [1, 1], [0, 1]),
  ],
  'wurf',
);

// ---------------------------------------------------------------------------------------------
// Schwere Angriffe
// ---------------------------------------------------------------------------------------------

/** Richtungsfolge einer Drehung im Uhrzeigersinn von oben gesehen (Blick: unten → links → oben → rechts). */
const DREHUNG: readonly Richtung[] = ['down', 'left', 'up', 'right'];

/** Die Blickrichtung nach `schritte` Vierteldrehungen im Uhrzeigersinn. */
export function gedrehteRichtung(r: Richtung, schritte: number): Richtung {
  return DREHUNG[(DREHUNG.indexOf(r) + schritte) % DREHUNG.length] as Richtung;
}

/** Ein Bild, das die Figur in eine andere Richtung gedreht zeigt (Rundumhieb); Pose und Drehung bleiben lesbar (Waffenlage). */
export interface GedrehtesBild extends Sonder {
  readonly gedreht: number;
  readonly pose: Pose;
}

export function istGedreht(f: FrameDef): f is GedrehtesBild {
  return 'gedreht' in f;
}

function gedreht(schritte: number, p: Pose): GedrehtesBild {
  return { gedreht: schritte, pose: p, sonder: (r) => bildDerPose(gedrehteRichtung(r, schritte), p) };
}

/** Schwert, schwer: Rundumhieb – tief ausholen (gehalten), einmal um sich selbst drehen mit gestreckter Klinge, auffangen. */
const RUNDUM: readonly FrameDef[] = [
  pose({ armR: ['weg'], armL: ['brust'] }, TIEF, [-1, 2], [0, 2]),
  gedreht(1, pose({ armR: ['hieb'], armL: ['zurueck'] }, GEDUCKT, [0, 1], [0, 1])),
  gedreht(2, pose({ armR: ['weg'], armL: ['zurueck'] }, GEDUCKT, [0, 1], [0, 1])),
  gedreht(3, pose({ armR: ['hieb'], armL: ['zurueck'] }, GEDUCKT, [0, 1], [0, 1])),
  pose({ armR: ['treffer'], armL: ['zurueck'] }, TIEF, [1, 3], [0, 2]),
  pose({ armR: ['vor'], armL: ['haengen'] }, GEDUCKT, [0, 1], [0, 1]),
];
const RUNDUM_PROFIL: readonly FrameDef[] = [
  pose({ armR: ['zurueck'], armL: ['pumpeVor'] }, TIEF, [-1, 2], [-1, 2]),
  gedreht(1, pose({ armR: ['hieb'], armL: ['zurueck'] }, GEDUCKT, [0, 1], [0, 1])),
  gedreht(2, pose({ armR: ['weg'], armL: ['zurueck'] }, GEDUCKT, [0, 1], [0, 1])),
  gedreht(3, pose({ armR: ['hieb'], armL: ['zurueck'] }, GEDUCKT, [0, 1], [0, 1])),
  pose({ armR: ['hieb'], armL: ['zurueck'] }, AUSFALL, [1, 2], [1, 2]),
  pose({ armR: ['vor'], armL: ['haengen'] }, SCHRITT, [0, 1], [0, 1]),
];
const heavySchwert = kampf('heavy_schwert', 12, [0, 0, 0, 1, 2, 3, 4, 4, 5], 1, RUNDUM, RUNDUM, RUNDUM_PROFIL);

/** Axt, schwer: Rüstungsbrecher – noch höher und länger ausholen, auf die Zehen, dann ein tiefer Einschlag. */
const heavyAxt = kampf(
  'heavy_axt',
  12,
  [0, 1, 1, 1, 2, 3, 4, 4, 4, 5],
  3,
  [
    pose({ armR: ['heben'], armL: ['brust'] }, TIEF, [0, 2], [0, 2], 'armeHinterKopf'),
    pose({ armR: ['hoch'], armL: ['hoch'] }, STEHEN, [0, -2], [0, -1], 'armeHinterKopf'),
    pose({ armR: ['hoch', 0, -1], armL: ['hoch', 0, -1] }, STEHEN, [0, -2], [0, -1], 'armeHinterKopf'),
    pose({ armR: ['schlag'], armL: ['brust'] }, GEDUCKT, [0, 1], [0, 1]),
    pose({ armR: ['treffer'], armL: ['vor'] }, TIEF, [0, 4], [0, 3]),
    pose({ armR: ['vor'], armL: ['haengen'] }, GEDUCKT, [0, 2], [0, 1]),
  ],
  [
    pose({ armR: ['heben'], armL: ['brust'] }, TIEF, [0, 2], [0, 2], 'armeHinterKopf'),
    pose({ armR: ['hoch'], armL: ['hoch'] }, STEHEN, [0, -2], [0, -1], 'armeHinterKopf'),
    pose({ armR: ['hoch', 0, -1], armL: ['hoch', 0, -1] }, STEHEN, [0, -2], [0, -1], 'armeHinterKopf'),
    pose({ armR: ['ueberkopf'], armL: ['brust'] }, GEDUCKT, [0, 1], [0, 1], 'armeHinterKopf'),
    pose({ armR: ['treffer'], armL: ['vor'] }, TIEF, [0, 4], [0, 3], 'armeHinten'),
    pose({ armR: ['vor'], armL: ['haengen'] }, GEDUCKT, [0, 2], [0, 1], 'armeHinten'),
  ],
  [
    pose({ armR: ['heben'], armL: ['vor'] }, TIEF, [-1, 2], [-1, 2], 'armeHinterKopf'),
    pose({ armR: ['hoch'], armL: ['vor'] }, SCHRITT, [-2, -2], [-1, -1], 'armeHinterKopf'),
    pose({ armR: ['hoch', -1, -1], armL: ['vor'] }, SCHRITT, [-2, -2], [-1, -1], 'armeHinterKopf'),
    pose({ armR: ['schlag'], armL: ['zurueck'] }, AUSFALL, [1, 1], [1, 1]),
    pose({ armR: ['treffer'], armL: ['zurueck'] }, TIEF, [2, 4], [1, 3]),
    pose({ armR: ['vor'], armL: ['haengen'] }, SCHRITT, [1, 2], [0, 1]),
  ],
);

/** Keule, schwer: Wuchtschlag von oben mit beiden Händen am Griff und tiefem Nachfedern. */
const heavyKeule = kampf(
  'heavy_keule',
  12,
  [0, 1, 1, 1, 2, 3, 3, 3, 4],
  2,
  [
    pose({ armR: ['weg'], armL: ['brust'] }, TIEF, [-1, 2], [-1, 2]),
    pose({ armR: ['hoch'], armL: ['hoch'] }, STEHEN, [0, -2], [0, -1], 'armeHinterKopf'),
    pose({ armR: ['schlag'], armL: ['brust'] }, GEDUCKT, [0, 1], [0, 1]),
    pose({ armR: ['treffer'], armL: ['vor'] }, TIEF, [0, 4], [0, 3]),
    pose({ armR: ['vor'], armL: ['haengen'] }, GEDUCKT, [0, 2], [0, 1]),
  ],
  [
    pose({ armR: ['weg'], armL: ['brust'] }, TIEF, [1, 2], [1, 2], 'armeHinten'),
    pose({ armR: ['hoch'], armL: ['hoch'] }, STEHEN, [0, -2], [0, -1], 'armeHinterKopf'),
    pose({ armR: ['ueberkopf'], armL: ['brust'] }, GEDUCKT, [0, 1], [0, 1], 'armeHinterKopf'),
    pose({ armR: ['treffer'], armL: ['vor'] }, TIEF, [0, 4], [0, 3], 'armeHinten'),
    pose({ armR: ['vor'], armL: ['haengen'] }, GEDUCKT, [0, 2], [0, 1], 'armeHinten'),
  ],
  [
    pose({ armR: ['zurueck', -1, 0], armL: ['pumpeVor'] }, TIEF, [-2, 2], [-1, 2]),
    pose({ armR: ['hoch'], armL: ['vor'] }, SCHRITT, [-1, -2], [-1, -1], 'armeHinterKopf'),
    pose({ armR: ['schlag'], armL: ['zurueck'] }, AUSFALL, [1, 1], [1, 1]),
    pose({ armR: ['treffer'], armL: ['zurueck'] }, TIEF, [2, 4], [1, 3]),
    pose({ armR: ['vor'], armL: ['haengen'] }, SCHRITT, [1, 2], [0, 1]),
  ],
);

/** Speer, schwer: Wurf – weit zurück über die Schulter (gehalten, die Nebenhand zielt), Smear, die Hand fliegt leer nach vorn. */
const WURF_VORN: readonly Pose[] = [
  pose({ armR: ['heben'], armL: ['pumpeVor'] }, GEDUCKT, [0, 1], [0, 1], 'armeHinterKopf'),
  pose({ armR: ['hoch'], armL: ['pumpeVor'] }, STEHEN, [0, -1], [0, 0], 'armeHinterKopf'),
  pose({ armR: ['schlag'], armL: ['zurueck'] }, GEDUCKT, [0, 1], [0, 1]),
  pose({ armR: ['pumpeVor'], armL: ['zurueck'] }, STEHEN, [0, 1], [0, 0]),
  pose({ armR: ['vor'], armL: ['haengen'] }, STEHEN, [0, 0], [0, 0]),
];
const WURF_HINTEN: readonly Pose[] = [
  pose({ armR: ['heben'], armL: ['pumpeVor'] }, GEDUCKT, [0, 1], [0, 1], 'armeHinterKopf'),
  pose({ armR: ['hoch'], armL: ['pumpeVor'] }, STEHEN, [0, -1], [0, 0], 'armeHinterKopf'),
  pose({ armR: ['heben', 0, 1], armL: ['zurueck'] }, GEDUCKT, [0, 1], [0, 1], 'armeHinten'),
  pose({ armR: ['pumpeVor'], armL: ['zurueck'] }, STEHEN, [0, 1], [0, 0], 'armeHinten'),
  pose({ armR: ['vor'], armL: ['haengen'] }, STEHEN, [0, 0], [0, 0], 'armeHinten'),
];
const WURF_PROFIL: readonly Pose[] = [
  pose({ armR: ['zurueck'], armL: ['vor'] }, SCHRITT, [-1, 1], [-1, 1]),
  pose({ armR: ['hoch'], armL: ['paddelVor'] }, SCHRITT, [-2, -1], [-1, 0], 'armeHinterKopf'),
  pose({ armR: ['schlag'], armL: ['zurueck'] }, AUSFALL, [1, 1], [1, 1]),
  pose({ armR: ['paddelVor'], armL: ['zurueck'] }, AUSFALL, [2, 1], [1, 1]),
  pose({ armR: ['vor'], armL: ['haengen'] }, SCHRITT, [1, 0], [0, 0]),
];
const heavySpeer = kampf('heavy_speer', 12, [0, 1, 1, 1, 2, 3, 3, 4], 2, WURF_VORN, WURF_HINTEN, WURF_PROFIL, 'wurf');

/** Dolch, schwer: Ausfallstich – geduckt sammeln, weit nach vorn schnellen. */
const heavyDolch = kampf(
  'heavy_dolch',
  12,
  [0, 0, 1, 2, 3, 3, 4],
  2,
  [
    pose({ armR: ['brust'], armL: ['brust'] }, TIEF, [0, 3], [0, 2]),
    pose({ armR: ['pumpeZurueck'], armL: ['brust'] }, TIEF, [0, 3], [0, 2]),
    pose({ armR: ['stoss'], armL: ['zurueck'] }, GEDUCKT, [0, 1], [0, 1]),
    pose({ armR: ['pumpeVor'], armL: ['zurueck'] }, GEDUCKT, [0, 2], [0, 1]),
    pose({ armR: ['vor'], armL: ['haengen'] }, STEHEN, [0, 0], [0, 0]),
  ],
  [
    pose({ armR: ['brust'], armL: ['brust'] }, TIEF, [0, 3], [0, 2], 'armeHinten'),
    pose({ armR: ['pumpeZurueck'], armL: ['brust'] }, TIEF, [0, 3], [0, 2], 'armeHinten'),
    pose({ armR: ['hochstoss'], armL: ['zurueck'] }, GEDUCKT, [0, 1], [0, 1], 'armeHinterKopf'),
    pose({ armR: ['heben', 0, -1], armL: ['zurueck'] }, GEDUCKT, [0, 2], [0, 1], 'armeHinterKopf'),
    pose({ armR: ['vor'], armL: ['haengen'] }, STEHEN, [0, 0], [0, 0], 'armeHinten'),
  ],
  [
    pose({ armR: ['pumpeZurueck'], armL: ['pumpeVor'] }, TIEF, [-1, 3], [-1, 2]),
    pose({ armR: ['zurueck'], armL: ['pumpeVor'] }, TIEF, [-1, 3], [-1, 2]),
    pose({ armR: ['stoss'], armL: ['zurueck'] }, AUSFALL, [3, 2], [2, 2]),
    pose({ armR: ['paddelVor'], armL: ['zurueck'] }, AUSFALL, [2, 2], [2, 2]),
    pose({ armR: ['vor'], armL: ['haengen'] }, SCHRITT, [0, 1], [0, 0]),
  ],
);

/** Zweihand, schwer: das größte Ausholen – beide Arme hoch, auf den Zehen gehalten, Smear, der Körper sackt tief ein. */
const heavyZweihand = kampf(
  'heavy_zweihand',
  12,
  [0, 1, 1, 2, 2, 2, 3, 4, 4, 4, 5],
  3,
  [
    pose({ armR: ['heben'], armL: ['brust'] }, TIEF, [0, 3], [0, 2], 'armeHinterKopf'),
    pose({ armR: ['hoch'], armL: ['hoch'] }, STEHEN, [0, -1], [0, 0], 'armeHinterKopf'),
    pose({ armR: ['hoch', 0, -1], armL: ['hoch', 0, -1] }, STEHEN, [0, -2], [0, -1], 'armeHinterKopf'),
    pose({ armR: ['schlag'], armL: ['brust'] }, GEDUCKT, [0, 2], [0, 1]),
    pose({ armR: ['treffer'], armL: ['vor'] }, TIEF, [0, 5], [0, 4]),
    pose({ armR: ['vor'], armL: ['vor'] }, GEDUCKT, [0, 2], [0, 1]),
  ],
  [
    pose({ armR: ['heben'], armL: ['brust'] }, TIEF, [0, 3], [0, 2], 'armeHinterKopf'),
    pose({ armR: ['hoch'], armL: ['hoch'] }, STEHEN, [0, -1], [0, 0], 'armeHinterKopf'),
    pose({ armR: ['hoch', 0, -1], armL: ['hoch', 0, -1] }, STEHEN, [0, -2], [0, -1], 'armeHinterKopf'),
    pose({ armR: ['ueberkopf'], armL: ['brust'] }, GEDUCKT, [0, 2], [0, 1], 'armeHinterKopf'),
    pose({ armR: ['treffer'], armL: ['vor'] }, TIEF, [0, 5], [0, 4], 'armeHinten'),
    pose({ armR: ['vor'], armL: ['vor'] }, GEDUCKT, [0, 2], [0, 1], 'armeHinten'),
  ],
  [
    pose({ armR: ['heben'], armL: ['heben'] }, TIEF, [-1, 3], [-1, 2], 'armeHinterKopf'),
    pose({ armR: ['hoch'], armL: ['hoch'] }, SCHRITT, [-1, -1], [-1, 0], 'armeHinterKopf'),
    pose({ armR: ['hoch', -1, -1], armL: ['hoch', -1, -1] }, SCHRITT, [-2, -2], [-1, -1], 'armeHinterKopf'),
    pose({ armR: ['schlag'], armL: ['schlag'] }, AUSFALL, [1, 2], [1, 1]),
    pose({ armR: ['treffer'], armL: ['treffer'] }, TIEF, [2, 5], [1, 4]),
    pose({ armR: ['vor'], armL: ['vor'] }, SCHRITT, [1, 2], [0, 1]),
  ],
);

/** Faust, schwer: Schwinger – weit zur Seite ausholen, der Körper dreht mit, flacher Hieb-Smear. */
const heavyFaust = kampf(
  'heavy_faust',
  12,
  [0, 1, 1, 2, 3, 3, 4],
  2,
  [
    pose({ armR: ['weg'], armL: ['brust'] }, GEDUCKT, [-1, 1], [-1, 1]),
    pose({ armR: ['weg', 0, 1], armL: ['brust'] }, TIEF, [-1, 2], [-1, 2]),
    pose({ armR: ['hieb'], armL: ['zurueck'] }, GEDUCKT, [1, 1], [1, 1]),
    pose({ armR: ['deckung'], armL: ['zurueck'] }, STEHEN, [1, 1], [1, 0]),
    pose({ armR: ['haengen'], armL: ['haengen'] }, STEHEN, [0, 0], [0, 0]),
  ],
  [
    pose({ armR: ['weg'], armL: ['brust'] }, GEDUCKT, [1, 1], [1, 1], 'armeHinten'),
    pose({ armR: ['weg', 0, 1], armL: ['brust'] }, TIEF, [1, 2], [1, 2], 'armeHinten'),
    pose({ armR: ['quer'], armL: ['zurueck'] }, GEDUCKT, [-1, 1], [-1, 1], 'armeHinten'),
    pose({ armR: ['quer', 0, 1], armL: ['zurueck'] }, STEHEN, [-1, 1], [-1, 0], 'armeHinten'),
    pose({ armR: ['haengen'], armL: ['haengen'] }, STEHEN, [0, 0], [0, 0], 'armeHinten'),
  ],
  [
    pose({ armR: ['zurueck'], armL: ['pumpeVor'] }, SCHRITT, [-1, 1], [-1, 1]),
    pose({ armR: ['zurueck', -1, 0], armL: ['pumpeVor'] }, TIEF, [-2, 2], [-1, 2]),
    pose({ armR: ['hieb'], armL: ['pumpeZurueck'] }, AUSFALL, [2, 1], [1, 1]),
    pose({ armR: ['stoss'], armL: ['pumpeZurueck'] }, AUSFALL, [2, 1], [1, 1]),
    pose({ armR: ['haengen'], armL: ['haengen'] }, STEHEN, [0, 0], [0, 0]),
  ],
);

// ---------------------------------------------------------------------------------------------
// Block, Bogen, Werfen
// ---------------------------------------------------------------------------------------------

/** Block: die Nebenhand (Schild) hebt sich vor den Körper, die Waffe liegt quer davor; das zweite Bild ist geduckt. */
const block: Aktion = {
  name: 'block',
  fps: 8,
  loop: true,
  folge: [0, 1, 1, 1],
  events: [],
  vorn: [pose({ armR: ['deckung'], armL: ['fackel'] }, GEDUCKT, [0, 1], [0, 1]), pose({ armR: ['deckung'], armL: ['fackel'] }, TIEF, [0, 2], [0, 1])],
  hinten: [pose({ armR: ['deckung'], armL: ['fackel'] }, GEDUCKT, [0, 1], [0, 1], 'armeHinten'), pose({ armR: ['deckung'], armL: ['fackel'] }, TIEF, [0, 2], [0, 1], 'armeHinten')],
  profil: [pose({ armR: ['deckung'], armL: ['fackel'] }, SCHRITT, [0, 1], [0, 1]), pose({ armR: ['deckung'], armL: ['fackel'] }, AUSFALL, [0, 2], [0, 2])],
};

/**
 * Block mit Schild (M6-Gate, kampf-tag): von vorn und hinten wie `block`. Im Profil hält der Schildarm den Schild gestreckt
 * vor die Brust zum Angreifer – der Schild zeigt dort seine Schrägansicht mit Fläche und Buckel (`schilde.ts`, Clip
 * `block_schild_<richtung>`) –, die Waffe ist nach hinten weggenommen (`weg`): Schild vorn, Klinge hinten auf Brusthöhe, frei
 * von Helm und Beinschienen. Mit der Deckung des Blocks (Arm über dem Kopf, Waffe aufrecht vor dem Gesicht) stand der
 * schmale Profilschild als Streifen über dem Helm (las sich als Helmkamm) und die Klinge vor den Beinschienen.
 */
const blockSchild: Aktion = {
  ...block,
  name: 'block_schild',
  profil: [pose({ armR: ['weg'], armL: ['stoss', 0, -2] }, SCHRITT, [0, 1], [0, 1]), pose({ armR: ['weg'], armL: ['stoss', 0, -2] }, AUSFALL, [0, 2], [0, 2])],
};

/**
 * Bogen: die Waffenhand streckt den Bogen vor, die Nebenhand legt den Pfeil auf, zieht zum Kinn (gehalten) und schnellt
 * beim Lösen zurück. Der Bogen steht dabei quer zur Schussrichtung (`BOGEN_LAGEN`): im Profil aufrecht, nach unten und
 * oben waagerecht (Stilmittel der Aufsicht wie auf dem SNES – nur so liest sich von vorn und hinten die gespannte Sehne
 * und der Pfeil entlang des Ziels).
 */
const bogen = kampf(
  'attack_bogen',
  10,
  [0, 1, 2, 2, 2, 3, 4],
  3,
  // Von vorn hält der Unterarm den Bogen quer vor dem Bauch (`deckung`, zur Körpermitte versetzt), die Nebenhand zieht die
  // Sehne zum Kinn.
  [
    pose({ armR: ['pumpeVor'], armL: ['brust'] }, STEHEN, [0, 0], [0, 0]),
    pose({ armR: ['deckung', 1, 2], armL: ['brust'] }, GEDUCKT, [0, 1], [0, 1]),
    pose({ armR: ['deckung', 1, 2], armL: ['mund', -1, 0] }, GEDUCKT, [0, 1], [0, 1]),
    pose({ armR: ['deckung', 1, 2], armL: ['weg'] }, STEHEN, [0, 0], [0, 0]),
    pose({ armR: ['pumpeVor'], armL: ['haengen'] }, STEHEN, [0, 0], [0, 0]),
  ],
  // Von hinten (M6-01b): der Bogenarm streckt sich nach vorn, vom Kopf verdeckt (`tragen` zur Mitte versetzt) – der Bogen
  // liegt quer über dem Kopf, der Ellbogen der Zughand steht zur Seite.
  [
    pose({ armR: ['pumpeVor'], armL: ['brust'] }, STEHEN, [0, 0], [0, 0], 'armeHinten'),
    pose({ armR: ['tragen', -6, -2], armL: ['weg', 2, 1] }, GEDUCKT, [0, 1], [0, 1], 'armeHinten'),
    pose({ armR: ['tragen', -6, -2], armL: ['heben'] }, GEDUCKT, [0, 1], [0, 1], 'armeHinten'),
    pose({ armR: ['tragen', -6, -2], armL: ['weg'] }, STEHEN, [0, 0], [0, 0], 'armeHinten'),
    pose({ armR: ['pumpeVor'], armL: ['haengen'] }, STEHEN, [0, 0], [0, 0], 'armeHinten'),
  ],
  [
    pose({ armR: ['paddelVor'], armL: ['pumpeVor'] }, SCHRITT, [0, 0], [0, 0]),
    pose({ armR: ['strecken'], armL: ['brust'] }, AUSFALL, [0, 0], [-1, 0]),
    pose({ armR: ['strecken'], armL: ['mund'] }, AUSFALL, [-1, 0], [-1, 0]),
    pose({ armR: ['strecken'], armL: ['zurueck'] }, AUSFALL, [-1, -1], [-1, 0]),
    pose({ armR: ['vor'], armL: ['haengen'] }, SCHRITT, [0, 0], [0, 0]),
  ],
  'sehne',
);

/** Lage des Bogens in einem Bild des Schusses: gehalten (aufrecht), angelegt (quer zum Ziel) oder gespannt (mit Pfeil). */
export type BogenLage = 'gehalten' | 'angelegt' | 'gespannt';

/** Lage des Bogens je Bild von `attack_bogen` (Index in `vorn`, `hinten`, `profil`; der Hand-Layer folgt, `_waffe.ts`). */
export const BOGEN_LAGEN: Readonly<Record<'vorn' | 'hinten' | 'profil', readonly BogenLage[]>> = {
  vorn: ['gehalten', 'angelegt', 'gespannt', 'angelegt', 'gehalten'],
  hinten: ['gehalten', 'angelegt', 'gespannt', 'angelegt', 'gehalten'],
  profil: ['gehalten', 'angelegt', 'gespannt', 'angelegt', 'gehalten'],
};

/**
 * Suffixe der um 45° gedrehten Clips (Vertrag mit dem Rig, `TURNED_CLIP_SUFFIX` in src/render/anim/figure.ts): `_rechtsrum`
 * im Uhrzeigersinn, `_linksrum` dagegen – Position für Position der Clip `<aktion>_<richtung>`.
 */
export const GEDREHT_SUFFIX = { rechtsrum: '_rechtsrum', linksrum: '_linksrum' } as const;

/**
 * Bilder einer Aktion, die der Körper zeigt, wenn das Ziel mehr als eine halbe Achteldrehung neben der Blickrichtung liegt
 * (M6-Gate; Clip `<aktion>_<richtung><suffix>`, Position für Position wie `<aktion>_<richtung>`, `_spieler_bilder.ts`):
 * `bilder` ersetzt Bilder der Frame-Tabelle der Richtung (Schlüssel = Index), an den übrigen Positionen zeigt der Clip die
 * ungedrehten Bilder. Das Rig wählt den Clip wie die gedrehten Clips der Waffe (`TURNED_CLIP_SUFFIX`).
 */
export interface GedrehteBilder {
  readonly aktion: Aktion;
  readonly richtung: Richtung;
  readonly suffix: string;
  readonly bilder: Readonly<Record<number, FrameDef>>;
}

/**
 * Bogen schräg nach oben gespannt (M6-Gate, waffe-rotation NO/NW): der Bogenarm streckt sich nach vorn oben (`streckenHoch`),
 * der Griff steht vor der Stirn, die Zughand bleibt am Kinn – die Nocke des schräg gezeichneten Bogens (`_waffe.ts`, Lagen
 * `gespanntNO`/`gespanntNW`) sitzt dort, der Pfeil steigt vom Kinn entlang des Ziels, der Bogen steht in Schulter- bis
 * Kopfhöhe. Mit dem waagerecht gestreckten Arm drehte der Bogen um den Griff auf Hüfthöhe: die Nocke lag am Gürtel, Holz und
 * Sehne reichten bis zu den Füßen, und der Schuss nach oben las sich als einer nach vorn unten. Schräg nach unten bleibt der
 * gestreckte Arm (die Nocke liegt dort schon am Kinn).
 */
const BOGEN_SCHRAEG_HOCH = pose({ armR: ['streckenHoch', 1, 0], armL: ['mund', -1, 0] }, AUSFALL, [-2, 0], [-1, 0]);

/** Die Bilder des Profils, in denen der Bogen gespannt ist (`BOGEN_LAGEN`), mit `bild` ersetzt. */
function gespannteBilder(bild: FrameDef): Record<number, FrameDef> {
  const out: Record<number, FrameDef> = {};
  BOGEN_LAGEN.profil.forEach((lage, i) => {
    if (lage === 'gespannt') out[i] = bild;
  });
  return out;
}

/**
 * Gedrehte Körperbilder (`GedrehteBilder`): der Bogen schräg nach oben – nach rechts gegen den Uhrzeigersinn (`_linksrum`),
 * nach links im Uhrzeigersinn (`_rechtsrum`).
 */
export const KAMPF_GEDREHT: readonly GedrehteBilder[] = [
  { aktion: bogen, richtung: 'right', suffix: GEDREHT_SUFFIX.linksrum, bilder: gespannteBilder(BOGEN_SCHRAEG_HOCH) },
  { aktion: bogen, richtung: 'left', suffix: GEDREHT_SUFFIX.rechtsrum, bilder: gespannteBilder(BOGEN_SCHRAEG_HOCH) },
];

/** Werfen: über den Kopf ausholen (gehalten), Smear, Nachschwung, zurück. */
const wurf = kampf('attack_wurf', 12, [0, 1, 1, 2, 3, 3, 4], 2, WURF_VORN, WURF_HINTEN, WURF_PROFIL, 'wurf');

// ---------------------------------------------------------------------------------------------
// Licht in der Nebenhand
// ---------------------------------------------------------------------------------------------

/** Suffix der Licht-Varianten (wie `_spieler_aktionen.ts`). */
const LICHT = '_licht';

/**
 * Licht-Variante eines einhändigen Angriffs: die Nebenhand hält das Licht ruhig neben den Kopf (`fackel`), statt
 * mitzuschwingen; gedrehte Bilder (Rundumhieb) behalten ihre Pose.
 */
function mitLicht(a: Aktion): Aktion {
  const halten = (f: FrameDef): FrameDef => ('sonder' in f ? f : { ...f, armL: ['fackel'] });
  return { ...a, name: `${a.name}${LICHT}`, vorn: a.vorn.map(halten), ...(a.hinten === undefined ? {} : { hinten: a.hinten.map(halten) }), profil: a.profil.map(halten) };
}

/** Leichte Angriffe je Klasse (Nahkampf und die Schüsse aus Armbrust und Schleuder). */
export const KAMPF_ANGRIFFE: readonly Aktion[] = [faust, schwert, axt, keule, speer, dolch, zweihand, armbrust, schleuder];
/** Schwere Angriffe der Nahkampfklassen. */
export const KAMPF_SCHWER: readonly Aktion[] = [heavyFaust, heavySchwert, heavyAxt, heavyKeule, heavySpeer, heavyDolch, heavyZweihand];
/** Block, Bogen, Werfen. */
export const KAMPF_SONST: readonly Aktion[] = [block, blockSchild, bogen, wurf];
/** Einhändige Aktionen, deren Nebenhand ein Licht halten kann (Zweihand, Bogen, Armbrust, Schild hängen es an den Gürtel). */
export const KAMPF_MIT_LICHT: readonly Aktion[] = [faust, schwert, axt, keule, speer, dolch, schleuder, heavyFaust, heavySchwert, heavyAxt, heavyKeule, heavySpeer, heavyDolch, wurf].map(mitLicht);
/** Alle Kampfaktionen in Frame-Reihenfolge des Sprites (nach den Aktionen aus `_spieler_aktionen.ts`). */
export const KAMPF_AKTIONEN: readonly Aktion[] = [...KAMPF_ANGRIFFE, ...KAMPF_SCHWER, ...KAMPF_SONST, ...KAMPF_MIT_LICHT];
