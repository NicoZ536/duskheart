/**
 * Handgezeichnete Körperteile der Spielfigur (M3-05 … M3-07), aus denen `_spieler_rig.ts` jede Pose
 * zusammensetzt. Köpfe stammen aus dem M1-Grundkörper (`spieler_koerper`) und sind je Richtung eigens
 * gezeichnet (Scheitel zur linken Kopfseite). Arme und Beine sind für die rechte Körperseite gezeichnet
 * und für die linke gespiegelt; der Profil-Körper nach links ist das Spiegelbild des Profils nach
 * rechts (nur der Kopf nicht). Arme und Beine der fernen Körperseite im Profil liegen im Schatten
 * (eine Stufe dunkler).
 *
 * Material-Zeichen (Farbe erst über die Legende des Ausgabe-Sprites, `_spieler_farben.ts`):
 * `k` Kontur · `1 2 3` Haar · `m S` Haut dunkel/hell · `b t T` Tunika dunkel/mittel/hell ·
 * `g G` Gürtel · `p P` Hose · `e E` Stiefel · Marken `H h N n` (Hand/Nebenhand, siehe lib/figure.ts).
 */
import { gespiegelt, teil, umgezeichnet, type Punkt, type Richtung, type Teil } from '../../lib/figure';

export type KopfVariante = 'auf' | 'zu' | 'schmerz' | 'hoch' | 'nacken';
export type RumpfVariante = 'normal';
export type ArmPose =
  | 'haengen'
  | 'vor'
  | 'zurueck'
  | 'pumpeVor'
  | 'pumpeZurueck'
  | 'heben'
  | 'hoch'
  | 'schlag'
  | 'treffer'
  | 'brust'
  | 'mund'
  | 'weg'
  | 'tragen'
  | 'paddelVor'
  | 'paddelSeite'
  | 'paddelZurueck'
  | 'fackel';
export type BeinPose = 'stand' | 'heben1' | 'heben2' | 'heben3' | 'vor' | 'zurueck' | 'mitte' | 'vorWeit' | 'zurueckWeit' | 'knieHoch' | 'hocke' | 'knie' | 'sitz' | 'weg';

/**
 * Kopf-Varianten: `auf` (M1), `zu` (Augen geschlossen: Schlaf, Tod), `schmerz` (zusammengekniffen:
 * Treffer), `hoch` (in den Nacken gelegt: Trinken), `nacken` (von vorn eingezogen, Haar voraus: Rolle).
 * Kopfpunkte: Helm-Sockel (Kopfmitte) und Oberkante (Last beim Tragen).
 */
const KOPF_PUNKTE: Readonly<Record<string, Punkt>> = { kopf: [8, 5], last: [8, 0] };
const kopf = (raster: string): Teil => teil(raster, [0, 0], KOPF_PUNKTE);

// ---------------------------------------------------------------------------------------------
// Köpfe (16×11)
// ---------------------------------------------------------------------------------------------

const KOPF_DOWN = `.....kkkkkk.....
                   ...kk333333kk...
                   ..k2333333332k..
                   .k223333333322k.
                   .k222333332222k.
                   .k122221222211k.
                   .k1SS12SSS21S1k.
                   .k1SSkSSSSkSS1k.
                   .k1SSkSSSSkSS1k.
                   .kmSSSSSSSSSSmk.
                   ..kmmSSSSSSmmk..`;
const KOPF_DOWN_ZU = `.....kkkkkk.....
                      ...kk333333kk...
                      ..k2333333332k..
                      .k223333333322k.
                      .k222333332222k.
                      .k122221222211k.
                      .k1SS12SSS21S1k.
                      .k1SSSSSSSSSS1k.
                      .k1SkkSSSSkkS1k.
                      .kmSSSSSSSSSSmk.
                      ..kmmSSSSSSmmk..`;
const KOPF_DOWN_SCHMERZ = `.....kkkkkk.....
                           ...kk333333kk...
                           ..k2333333332k..
                           .k223333333322k.
                           .k222333332222k.
                           .k122221222211k.
                           .k1SS12SSS21S1k.
                           .k1SkSSSSSSkS1k.
                           .k1SSkSSSSkSS1k.
                           .kmSSSSSSSSSSmk.
                           ..kmmSSSSSSmmk..`;
const KOPF_DOWN_HOCH = `.....kkkkkk.....
                        ...kk333333kk...
                        ..k2333333332k..
                        .k223333333322k.
                        .k122221222211k.
                        .k1SS12SSS21S1k.
                        .k1SSkSSSSkSS1k.
                        .k1SSkSSSSkSS1k.
                        .kmSSSSSSSSSSmk.
                        .kmmSSSSSSSSmmk.
                        ..kkmmSSSSmmkk..`;

const KOPF_UP = `.....kkkkkk.....
                 ...kk333333kk...
                 ..k2333333332k..
                 .k223333333322k.
                 .k222233332222k.
                 .k222222222222k.
                 .k122222222221k.
                 .k112221122211k.
                 .k111221112111k.
                 .kk1111111111kk.
                 ..kk11mmmm11kk..`;
const KOPF_UP_HOCH = `.....kkkkkk.....
                      ...kk333333kk...
                      ..k2333333332k..
                      .k223333333322k.
                      .k222233332222k.
                      .k222222222222k.
                      .k122222222221k.
                      .k112221122211k.
                      .k111221112111k.
                      .kk1111111111kk.
                      ..kkk111111kkk..`;

const KOPF_RIGHT = `.....kkkkkk.....
                    ...kk333333kk...
                    ..k2333333333k..
                    .k223333333332k.
                    .k222223332222k.
                    .k1222222222SSk.
                    .k122222221SSSk.
                    .k11222mSSSkSSk.
                    .k1122mmSSSkSSSk
                    .k112SSSSSSSSSk.
                    ..k1mSSSSSSSmk..`;
const KOPF_RIGHT_ZU = `.....kkkkkk.....
                       ...kk333333kk...
                       ..k2333333333k..
                       .k223333333332k.
                       .k222223332222k.
                       .k1222222222SSk.
                       .k122222221SSSk.
                       .k11222mSSSSSSk.
                       .k1122mmSSkkSSSk
                       .k112SSSSSSSSSk.
                       ..k1mSSSSSSSmk..`;
const KOPF_RIGHT_SCHMERZ = `.....kkkkkk.....
                            ...kk333333kk...
                            ..k2333333333k..
                            .k223333333332k.
                            .k222223332222k.
                            .k1222222222SSk.
                            .k122222221SSSk.
                            .k11222mSSkSSSk.
                            .k1122mmSSSkSSSk
                            .k112SSSSSSSSSk.
                            ..k1mSSSSSSSmk..`;
const KOPF_RIGHT_HOCH = `.....kkkkkk.....
                         ...kk333333kk...
                         ..k2333333333k..
                         .k223333333332kk
                         .k2222233322SSSk
                         .k12222222SSkSSk
                         .k1222222mSSkSSk
                         .k1122mmSSSSSSk.
                         .k112mSSSSSSSk..
                         .k112SSSSSSSSk..
                         ..k1mmSSSSSSmk..`;

const KOPF_LEFT = `.....kkkkkk.....
                   ...kk333333kk...
                   ..k3333333332k..
                   .k233333333322k.
                   .k222233322222k.
                   .kS22222222221k.
                   .kSS2122222221k.
                   .kSSkSSSm22211k.
                   kSSSkSSSmm2211k.
                   .kSSSSSSSSS211k.
                   ..kmSSSSSSSm1k..`;
const KOPF_LEFT_ZU = `.....kkkkkk.....
                      ...kk333333kk...
                      ..k3333333332k..
                      .k233333333322k.
                      .k222233322222k.
                      .kS22222222221k.
                      .kSS2122222221k.
                      .kSSSSSSm22211k.
                      kSSSkkSSmm2211k.
                      .kSSSSSSSSS211k.
                      ..kmSSSSSSSm1k..`;
const KOPF_LEFT_SCHMERZ = `.....kkkkkk.....
                           ...kk333333kk...
                           ..k3333333332k..
                           .k233333333322k.
                           .k222233322222k.
                           .kS22222222221k.
                           .kSS2122222221k.
                           .kSSSkSSm22211k.
                           kSSSkSSSmm2211k.
                           .kSSSSSSSSS211k.
                           ..kmSSSSSSSm1k..`;
const KOPF_LEFT_HOCH = `.....kkkkkk.....
                        ...kk333333kk...
                        ..k3333333332k..
                        kk233333333322k.
                        kSSS2233322222k.
                        kSSkSS2222221k..
                        kSSkSSm2222221k.
                        .kSSSSSSmm2211k.
                        ..kSSSSSSSm211k.
                        ..kSSSSSSSS211k.
                        ..kmSSSSSSmm1k..`;

export const KOEPFE: Readonly<Record<Richtung, Readonly<Record<KopfVariante, Teil>>>> = {
  down: { auf: kopf(KOPF_DOWN), zu: kopf(KOPF_DOWN_ZU), schmerz: kopf(KOPF_DOWN_SCHMERZ), hoch: kopf(KOPF_DOWN_HOCH), nacken: kopf(KOPF_UP) },
  up: { auf: kopf(KOPF_UP), zu: kopf(KOPF_UP), schmerz: kopf(KOPF_UP), hoch: kopf(KOPF_UP_HOCH), nacken: kopf(KOPF_UP) },
  right: { auf: kopf(KOPF_RIGHT), zu: kopf(KOPF_RIGHT_ZU), schmerz: kopf(KOPF_RIGHT_SCHMERZ), hoch: kopf(KOPF_RIGHT_HOCH), nacken: kopf(KOPF_RIGHT) },
  left: { auf: kopf(KOPF_LEFT), zu: kopf(KOPF_LEFT_ZU), schmerz: kopf(KOPF_LEFT_SCHMERZ), hoch: kopf(KOPF_LEFT_HOCH), nacken: kopf(KOPF_LEFT) },
};

// ---------------------------------------------------------------------------------------------
// Rümpfe (16×10, Kragen bis Rocksaum; ohne Arme)
// ---------------------------------------------------------------------------------------------

const RUMPF_DOWN = `....kbmmmmbk....
                    ...kbtTTTTtbk...
                    ...kbtTTTTtbk...
                    ...kttTTTTttk...
                    ...kttttttttk...
                    ...kgggGGgggk...
                    ...kbttttttbk...
                    ...kbttttttbk...
                    ...kbbttttbbk...
                    ...kkbbbbbbkk...`;
const RUMPF_UP = `....kbbbbbbk....
                  ...kbtttttTbk...
                  ...kbtttttTbk...
                  ...kttttttTtk...
                  ...kttttttttk...
                  ...kgggggggGk...
                  ...kbttttttbk...
                  ...kbttttttbk...
                  ...kbbttttbbk...
                  ...kkbbbbbbkk...`;
const RUMPF_RIGHT = `....kkbmmmkk....
                     ..kkbttTTttbk...
                     ..kbbttTTtttk...
                     ..kbbtttttttk...
                     ..kbbttttttbk...
                     ..kggggggggGk...
                     ..kbbbttttbbk...
                     ..kbbttttttbk...
                     ...kbbttttbk....
                     ....kkbbbbk.....`;

const rumpfRechts = teil(RUMPF_RIGHT);
/** Rümpfe je Richtung; nach links das Spiegelbild des Profils nach rechts. */
export const RUMPFE: Readonly<Record<Richtung, Readonly<Record<RumpfVariante, Teil>>>> = {
  down: { normal: teil(RUMPF_DOWN) },
  up: { normal: teil(RUMPF_UP) },
  right: { normal: rumpfRechts },
  left: { normal: gespiegelt(rumpfRechts) },
};

// ---------------------------------------------------------------------------------------------
// Arme – von vorn (rechter Arm liegt links im Bild; Drehpunkt = Schulter innen oben)
// ---------------------------------------------------------------------------------------------

type ArmSatz = Readonly<Partial<Record<ArmPose, Teil>>>;

const armVorn = (raster: string, px: number): Teil => teil(raster, [px, 0]);

const ARM_VORN: ArmSatz = {
  haengen: armVorn(
    `.kk
     ktb
     ktb
     ktb
     kSm
     khm
     .kk`,
    2,
  ),
  vor: armVorn(
    `.kk
     ktb
     ktb
     ktb
     ktb
     kSm
     khm
     .kk`,
    2,
  ),
  zurueck: armVorn(
    `.kk
     ktb
     ktb
     kSm
     khm
     .kk`,
    2,
  ),
  pumpeVor: armVorn(
    `.kk..
     ktb..
     ktb..
     kbtk.
     .kSmk
     .khmk
     ..kk.`,
    2,
  ),
  pumpeZurueck: armVorn(
    `.kk
     ktb
     kSm
     khm
     .kk`,
    2,
  ),
  heben: teil(
    `.kk...
     kSSk..
     kmhk..
     .kttk.
     ..ktbk
     ...ktb
     ...ktb
     ....kk`,
    [5, 5],
  ),
  hoch: teil(
    `.kk....
     kSSk...
     kmhk...
     .kttk..
     .ktbk..
     ..ktbk.
     ..ktbk.
     ...ktbk
     ...ktbk
     ...ktb.
     ....kk.`,
    [5, 9],
  ),
  schlag: teil(
    `kk........
     kTk.......
     kTtk......
     .kTtk.....
     .kTttk....
     ..kTttk...
     ..ktTtbk..
     ...ktTtbk.
     ....ktTtk.
     .....ktSSk
     ......kmhk
     .......kk.`,
    [4, 7],
  ),
  treffer: teil(
    `ktb....
     ktbk...
     .ktbk..
     .kttk..
     ..ktbk.
     ..kttk.
     ...kSSk
     ...kmhk
     ....kk.`,
    [2, 0],
  ),
  brust: teil(
    `.kk...
     ktbk..
     ktTtk.
     kbtSSk
     .kkmhk
     ...kk.`,
    [2, 0],
  ),
  mund: teil(
    `....kk.
     ...kSHk
     ..ktmk.
     .ktTk..
     ktTtk..
     ktbk...
     .kk....`,
    [2, 3],
  ),
  weg: teil(
    `.kk...
     kSSkk.
     kmhttb
     .kkktb
     ....kk`,
    [5, 2],
  ),
  tragen: teil(
    `.kk..
     kSSk.
     kmhk.
     kttk.
     kttk.
     kttk.
     ktbk.
     ktbk.
     ktbk.
     .ktbk
     .ktbk
     .ktbk
     ..ktb
     ..ktb
     ..ktb
     ...kk`,
    [4, 14],
  ),
  paddelVor: armVorn(
    `ktb....
     ktTkk..
     .ktSSk.
     ..kmhk.
     ...kk..`,
    2,
  ),
  paddelSeite: teil(
    `....ktb
     .kkkttb
     kSStkkk
     kmhk...
     .kk....`,
    [6, 0],
  ),
  paddelZurueck: armVorn(
    `.kk
     ktb
     kSm
     khm
     .kk`,
    2,
  ),
  fackel: teil(
    `....kk
     ...ktb
     ..kttb
     .kttkk
     kSSk..
     kmhk..
     .kk...`,
    [5, 0],
  ),
};

// ---------------------------------------------------------------------------------------------
// Arme – Profil nach rechts (naher = rechter Arm; Drehpunkt = Schulter hinten oben)
// ---------------------------------------------------------------------------------------------

const armSeite = (raster: string, px: number): Teil => teil(raster, [px, 0]);

const ARM_NAH: ArmSatz = {
  haengen: armSeite(
    `btTb
     btTb
     btTb
     btTb
     btTb
     kSSk
     kmHk
     .kk.`,
    0,
  ),
  vor: armSeite(
    `btTb..
     btTb..
     .btTb.
     .btTb.
     ..kTTk
     ..kSSk
     ..kmHk
     ...kk.`,
    0,
  ),
  zurueck: armSeite(
    `..btTb
     ..btTb
     .btTb.
     .btTb.
     kTTk..
     kSSk..
     kHmk..
     .kk...`,
    2,
  ),
  pumpeVor: armSeite(
    `ktTk...
     ktTk...
     ktTkkk.
     .kTTSSk
     ..kkmHk
     ....kk.`,
    0,
  ),
  pumpeZurueck: armSeite(
    `...ktTk
     ..ktTk.
     .ktTk..
     kTTk...
     kSSk...
     kHSk...
     .kk....`,
    3,
  ),
  heben: teil(
    `.kk..........
     kSSk.........
     kHmtk........
     .kttTk.......
     ..kkttk......
     ....kttk.....
     .....kttk....
     ......kttTk..
     ........ktTk.
     .........kk..`,
    [8, 8],
  ),
  hoch: teil(
    `.kk.........
     kSSk........
     kHmk........
     .ktk........
     .kttk.......
     ..ktk.......
     ..kttk......
     ...ktk......
     ...kttk.....
     ....ktk.....
     ....kttk....
     .....kttk...
     ......kttk..
     .......kttk.
     .......ktTk.
     .......ktTk.
     ........kk..`,
    [7, 15],
  ),
  schlag: teil(
    `.kkkkkkkkk.
     ktTTttTtSSk
     ktttttkkmHk
     .kkkkk..kk.`,
    [0, 1],
  ),
  treffer: armSeite(
    `ktTk....
     ktTtk...
     .ktTk...
     ..ktTk..
     ..ktTk..
     ...kSSk.
     ...kmHk.
     ....kk..`,
    0,
  ),
  brust: armSeite(
    `ktTk...
     ktTk...
     ktTtkk.
     .ktTSSk
     ..kkmHk
     ....kk.`,
    0,
  ),
  mund: teil(
    `.......kk.
     ......kSHk
     .....ktmk.
     ....ktTk..
     ktTkkTk...
     ktTtTk....
     .ktTk.....
     ..kk......`,
    [0, 4],
  ),
  weg: teil(
    `.kk.....
     kSSkkkk.
     kHmtttTk
     .kkkkkk.`,
    [4, 2],
  ),
  tragen: teil(
    `........kk.
     .......kSSk
     .......kmHk
     .......ktTk
     .......ktTk
     .......ktTk
     .......ktTk
     .......ktTk
     ......ktTk.
     .....ktTk..
     ....ktTk...
     ...ktTk....
     ..ktTk.....
     .ktTk......
     ktTk.......
     .kk........`,
    [0, 14],
  ),
  paddelVor: armSeite(
    `ktTk....
     ktTtkkk.
     .ktTTSSk
     ..kkkmHk
     .....kk.`,
    0,
  ),
  paddelSeite: armSeite(
    `ktTk.....
     ktTtkkkk.
     .kttTTSSk
     ..kkkkmHk
     ......kk.`,
    0,
  ),
  paddelZurueck: teil(
    `...ktTk
     .kkktTk
     kSStTk.
     kHmkk..
     .kk....`,
    [3, 0],
  ),
  fackel: armSeite(
    `ktTk.......
     ktTtk......
     .ktTtkkkkk.
     ..kttTTtSSk
     ...kkkkkmHk
     ........kk.`,
    0,
  ),
};

/** Ferner Arm im Profil: eine Stufe dunkler (Schatten hinter dem Körper), Marke = Nebenhand. */
const FERN_UMFAERBUNG: Readonly<Record<string, string>> = { t: 'b', T: 't', S: 'm', H: 'n', h: 'n' };

function satz(s: ArmSatz, f: (t: Teil) => Teil): ArmSatz {
  const out: Partial<Record<ArmPose, Teil>> = {};
  for (const [k, v] of Object.entries(s) as Array<[ArmPose, Teil]>) out[k] = f(v);
  return out;
}

const ARM_FERN = satz(ARM_NAH, (t) => umgezeichnet(t, FERN_UMFAERBUNG));

/** Arm-Raster je Richtung und Körperseite (r = Hand, l = Nebenhand). */
export const ARME: Readonly<Record<Richtung, { readonly r: ArmSatz; readonly l: ArmSatz }>> = {
  down: { r: ARM_VORN, l: satz(ARM_VORN, (t) => gespiegelt(t)) },
  up: { r: satz(ARM_VORN, (t) => gespiegelt(t, false)), l: satz(satz(ARM_VORN, (t) => gespiegelt(t)), (t) => gespiegelt(t, false)) },
  right: { r: ARM_NAH, l: ARM_FERN },
  left: { r: satz(ARM_FERN, (t) => gespiegelt(t)), l: satz(ARM_NAH, (t) => gespiegelt(t)) },
};

// ---------------------------------------------------------------------------------------------
// Beine – von vorn (rechtes Bein links im Bild; Drehpunkt = Fuß innen auf der Bodenzeile)
// ---------------------------------------------------------------------------------------------

type BeinSatz = Readonly<Partial<Record<BeinPose, Teil>>>;

/** Beinsäule von vorn: Drehpunkt rechts unten (Innenkante, Bodenzeile). */
const beinVorn = (raster: string): Teil => {
  const t = teil(raster);
  return { ...t, pivot: [t.w - 1, t.h - 1] };
};

const BEIN_VORN: BeinSatz = {
  stand: beinVorn(
    `.kppk
     .kppk
     .kppk
     .kppk
     .kEEk
     kkeek`,
  ),
  heben1: beinVorn(
    `.kppk
     .kppk
     .kppk
     .kppk
     .kEEk
     kkeek
     .....`,
  ),
  heben2: beinVorn(
    `.kppk
     .kppk
     .kppk
     .kppk
     .kEEk
     .keek
     .....
     .....`,
  ),
  heben3: beinVorn(
    `.kppk
     .kppk
     .kPPk
     .kPPk
     .kEEk
     .kkkk
     .....
     .....
     .....`,
  ),
  hocke: beinVorn(
    `..kppk
     ..kppk
     ..kppk
     .kEEEk
     kkeeek`,
  ),
  knie: beinVorn(`.`),
  sitz: beinVorn(
    `.kkk.
     kPPPk
     kpPpk
     .kppk
     kkEEk`,
  ),
  weg: beinVorn(`.`),
};

// ---------------------------------------------------------------------------------------------
// Beine – Profil nach rechts (Drehpunkt = Hüftspalte hinten auf der Bodenzeile)
// ---------------------------------------------------------------------------------------------

/** Beinsäule im Profil: Drehpunkt in Spalte `px` der untersten Zeile. */
const beinSeite = (raster: string, px: number): Teil => {
  const t = teil(raster);
  return { ...t, pivot: [px, t.h - 1] };
};

const BEIN_NAH: BeinSatz = {
  stand: beinSeite(
    `kppk.
     kppk.
     kppk.
     kppk.
     kEEk.
     kEEEk`,
    0,
  ),
  vor: beinSeite(
    `kppk...
     kppk...
     kppk...
     .kppk..
     ..kEEk.
     ..kEEEk`,
    0,
  ),
  zurueck: beinSeite(
    `..kppk
     ..kppk
     ..kppk
     .kppk.
     kEEk..
     .kEEk.`,
    2,
  ),
  mitte: beinSeite(
    `kppk.
     kppk.
     kppk.
     kEEk.
     kEEEk
     .....`,
    0,
  ),
  vorWeit: beinSeite(
    `kppk....
     kppk....
     .kppk...
     ..kppk..
     ...kEEk.
     ...kEEEk`,
    0,
  ),
  zurueckWeit: beinSeite(
    `...kppk
     ...kppk
     ..kppk.
     .kppk..
     kEEk...
     kEEk...
     .......`,
    3,
  ),
  knieHoch: beinSeite(
    `kppk..
     kpPPk.
     .kPPk.
     .kEEk.
     ..kEEk
     ......
     ......`,
    0,
  ),
  hocke: beinSeite(
    `kppk...
     kpppk..
     .kpPPk.
     ..kppk.
     ..kEEk.
     ..kEEEk`,
    0,
  ),
  knie: beinSeite(
    `.....kppk.
     ....kppPk.
     kEEkkpppPk
     kkkkkkkkkk`,
    5,
  ),
  sitz: beinSeite(
    `kppppk...
     kpppPPk..
     .kkkpPk..
     ....kppk.
     ....kEEk.
     ....kEEEk`,
    0,
  ),
  weg: beinSeite(`.`, 0),
};

/** Fernes Bein im Profil: eine Stufe dunkler. */
const BEIN_FERN = satzBein(BEIN_NAH, (t) => umgezeichnet(t, { E: 'e', P: 'p' }));

function satzBein(s: BeinSatz, f: (t: Teil) => Teil): BeinSatz {
  const out: Partial<Record<BeinPose, Teil>> = {};
  for (const [k, v] of Object.entries(s) as Array<[BeinPose, Teil]>) out[k] = f(v);
  return out;
}

/** Bein-Raster je Richtung und Körperseite. */
export const BEINE: Readonly<Record<Richtung, { readonly r: BeinSatz; readonly l: BeinSatz }>> = {
  down: { r: BEIN_VORN, l: satzBein(BEIN_VORN, (t) => gespiegelt(t)) },
  up: { r: satzBein(BEIN_VORN, (t) => gespiegelt(t)), l: BEIN_VORN },
  right: { r: BEIN_NAH, l: BEIN_FERN },
  left: { r: satzBein(BEIN_FERN, (t) => gespiegelt(t)), l: satzBein(BEIN_NAH, (t) => gespiegelt(t)) },
};
