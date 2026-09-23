/**
 * Spieler-Grundkörper, Idle in vier Richtungen (M1-22, MASTERPROMPT §4.4/§4.5, docs/ART.md §4):
 * 32×32-Zelle, Körper 16×24 (Kopf 11, Rumpf 10, Beine 3 Zeilen), schlichte Tunika. Jede Richtung ist
 * eigens gezeichnet; links ist kein Spiegelbild, weil der Scheitel zur linken Kopfseite fällt
 * (`spiegelbar: false`).
 *
 * Farben (11 inkl. Kontur) liegen je Material auf einer eigenen Rampe, damit Palettenzeilen Haar,
 * Haut, Tunika und Leder unabhängig umfärben können (Charakteranpassung, §4.3): Haar `holz`,
 * Haut `haut`, Tunika `wasser`, Gürtel/Stiefel `erde`, Kontur und Augen `nacht.1`.
 *
 * Idle-Atmung als Welle durch den Körper (Überlappung, §4.5 Antizipation/Nachschwingen): Kopf sinkt
 * vor (1), Rumpf folgt (2), Kopf hebt sich, während der Rumpf noch unten ist (3), dann Ruhe (0).
 * Der Clip hält Ruhe- und Tiefpunkt je drei Bilder: 4 Frames, 8 Bilder je Zyklus bei 8 fps = 1 s.
 * Sockel je Frame: `hand` (rechte Hand, Waffe), `nebenhand` (linke Hand, Licht §12.2), `kopf` (Helm).
 */
import { sprite } from '../../lib/sprite';

const LEGENDE = {
  '.': null,
  k: 'nacht.1',
  '1': 'holz.1',
  '2': 'holz.2',
  '3': 'holz.3',
  m: 'haut.2',
  S: 'haut.3',
  b: 'wasser.1',
  t: 'wasser.2',
  T: 'wasser.3',
  e: 'erde.1',
  E: 'erde.2',
} as const;

type Richtung = 'down' | 'up' | 'right' | 'left';
const RICHTUNGEN: readonly Richtung[] = ['down', 'up', 'right', 'left'];

/** Kopf (11 Zeilen) je Richtung: Haar oben hell, zum Nacken dunkler; Scheitel zur linken Kopfseite. */
const KOPF: Readonly<Record<Richtung, string>> = {
  down: `.....kkkkkk.....
         ...kk333333kk...
         ..k2333333332k..
         .k223333333322k.
         .k222333332222k.
         .k122221222211k.
         .k1SS12SSS21S1k.
         .k1SSkSSSSkSS1k.
         .k1SSkSSSSkSS1k.
         .kmSSSSSSSSSSmk.
         ..kmmSSSSSSmmk..`,
  up: `.....kkkkkk.....
       ...kk333333kk...
       ..k2333333332k..
       .k223333333322k.
       .k222233332222k.
       .k222222222222k.
       .k122222222221k.
       .k112221122211k.
       .k111221112111k.
       .kk1111111111kk.
       ..kk11mmmm11kk..`,
  right: `.....kkkkkk.....
          ...kk333333kk...
          ..k2333333333k..
          .k223333333332k.
          .k222223332222k.
          .k1222222222SSk.
          .k122222221SSSk.
          .k11222mSSSkSSk.
          .k1122mmSSSkSSSk
          .k112SSSSSSSSSk.
          ..k1mSSSSSSSmk..`,
  left: `.....kkkkkk.....
         ...kk333333kk...
         ..k3333333332k..
         .k233333333322k.
         .k222233322222k.
         .kS22222222221k.
         .kSS2122222221k.
         .kSSkSSSm22211k.
         kSSSkSSSmm2211k.
         .kSSSSSSSSS211k.
         ..kmSSSSSSSm1k..`,
};

/** Rumpf (10 Zeilen): Kragen, Tunika mit hellerer Brust, Gürtel, Hände, Rocksaum. */
const RUMPF: Readonly<Record<Richtung, string>> = {
  down: `....kbmmmmbk....
         ..kkbtTTTTtbkk..
         .ktbbtTTTTtbbtk.
         .ktbttTTTTttbtk.
         .ktbttttttttbtk.
         .kSmeeeEEeeemSk.
         .kmmbttttttbmmk.
         ..kkbttttttbkk..
         ...kbbttttbbk...
         ...kkbbbbbbkk...`,
  up: `....kbbbbbbk....
       ..kkbtttttTbkk..
       .ktbbtttttTbbtk.
       .ktbtttttttbbtk.
       .ktbttttttttbtk.
       .kSmeeeeeeeemSk.
       .kmmbttttttbmmk.
       ..kkbttttttbkk..
       ...kbbttttbbk...
       ...kkbbbbbbkk...`,
  right: `....kkbmmmkk....
          ..kkbttTTtbbk...
          ..kbbbtTTtbtk...
          ..kbbbtTTtbtk...
          ..kbbbtTTttbk...
          ..keeebTTbeek...
          ..kbbbbSSbbbk...
          ..kbbttmmttbk...
          ...kbbttttbk....
          ....kkbbbbk.....`,
  left: `....kkmmmbkk....
         ...kbbtTTttbkk..
         ...ktbtTTtbbbk..
         ...ktbtTTtbbbk..
         ...kbttTTtbbbk..
         ...keebTTbeeek..
         ...kbbbSSbbbbk..
         ...kbttmmttbbk..
         ....kbttttbbk...
         .....kbbbbkk....`,
};

/** Beine (3 Zeilen): Hosenbein, Stiefel, Sohle; im Profil steht das ferne Bein dunkler dahinter. */
const BEINE: Readonly<Record<Richtung, string>> = {
  down: `....kbbkkbbk....
         ....kEekkeEk....
         ...kkeekkeekk...`,
  up: `....kbbkkbbk....
       ....kEekkeEk....
       ...kkeekkeekk...`,
  right: `....kbbkbbk.....
          ....keekEEk.....
          ...kkeekEEEk....`,
  left: `.....kbbkbbk....
         .....kEEkeek....
         ....kEEEkeekk...`,
};

/** Zellgröße und Lage des 16×24-Körpers in der Zelle (Füße auf der letzten Zeile). */
const ZELLE = 32;
const KOERPER_X = 8;
const KOERPER_Y = 8;
/** Erste Körperzeile von Rumpf und Beinen. */
const RUMPF_Y = 11;
const BEINE_Y = 21;
/** Idle-Posen: [Kopf-Versatz, Rumpf-Versatz] in px nach unten. */
const POSEN: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
/** Clip-Folge der Posen (Ruhe und Tiefpunkt je drei Bilder) und Bildrate (§4.5: Figuren 8–12 fps). */
const IDLE_FOLGE = [0, 0, 0, 1, 2, 2, 2, 3];
const IDLE_FPS = 8;

/** Griffpunkte der Hände im Körperrahmen (vor dem Rumpf-Versatz); im Profil liegt die ferne Hand verdeckt hinter dem Körper. */
const HAENDE: Readonly<Record<Richtung, { hand: readonly [number, number]; nebenhand: readonly [number, number] }>> = {
  down: { hand: [2, 17], nebenhand: [13, 17] },
  up: { hand: [13, 17], nebenhand: [2, 17] },
  right: { hand: [8, 18], nebenhand: [5, 17] },
  left: { hand: [10, 17], nebenhand: [7, 18] },
};
/** Helm-Sockel: Kopfmitte im Körperrahmen (folgt dem Kopf-Versatz). */
const KOPF_PUNKT: readonly [number, number] = [8, 5];

function zeilen(raster: string): string[] {
  return raster
    .split('\n')
    .map((z) => z.trim())
    .filter((z) => z.length > 0);
}

/** Setzt Beine, Rumpf und Kopf einer Pose in die Zelle; zieht der Rumpf nach, füllt der Kragen die Halslücke. */
function pose(richtung: Richtung, kopfY: number, rumpfY: number): string {
  const zelle = Array.from({ length: ZELLE }, () => Array.from({ length: ZELLE }, () => '.'));
  const malen = (teil: readonly string[], y0: number): void => {
    teil.forEach((zeile, y) => {
      [...zeile].forEach((c, x) => {
        const reihe = zelle[KOERPER_Y + y0 + y];
        if (c !== '.' && reihe !== undefined) reihe[KOERPER_X + x] = c;
      });
    });
  };
  const rumpf = zeilen(RUMPF[richtung]);
  malen(zeilen(BEINE[richtung]), BEINE_Y);
  malen(rumpf, RUMPF_Y + rumpfY);
  if (rumpfY > kopfY) malen(rumpf.slice(0, 1), RUMPF_Y);
  malen(zeilen(KOPF[richtung]), kopfY);
  return zelle.map((r) => r.join('')).join('\n');
}

const frames: string[] = [];
const hand: [number, number][] = [];
const nebenhand: [number, number][] = [];
const kopf: [number, number][] = [];
for (const r of RICHTUNGEN) {
  for (const [kopfY, rumpfY] of POSEN) {
    frames.push(pose(r, kopfY, rumpfY));
    const h = HAENDE[r];
    hand.push([KOERPER_X + h.hand[0], KOERPER_Y + h.hand[1] + rumpfY]);
    nebenhand.push([KOERPER_X + h.nebenhand[0], KOERPER_Y + h.nebenhand[1] + rumpfY]);
    kopf.push([KOERPER_X + KOPF_PUNKT[0], KOERPER_Y + KOPF_PUNKT[1] + kopfY]);
  }
}

const clips = Object.fromEntries(
  RICHTUNGEN.map((r, i) => [`idle_${r}`, { frames: IDLE_FOLGE.map((p) => i * POSEN.length + p), fps: IDLE_FPS, loop: true }]),
);

export default sprite({
  id: 'spieler_koerper',
  group: 'figuren',
  size: [ZELLE, ZELLE],
  anchor: [ZELLE / 2, ZELLE - 1],
  hoehe: 'zylinder',
  legende: LEGENDE,
  frames,
  clips,
  sockets: { hand, nebenhand, kopf },
  hitbox: [12, 27, 8, 5],
  occluder: { kind: 'none' },
  spiegelbar: false,
});
