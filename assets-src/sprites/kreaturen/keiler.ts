/**
 * Keiler (Grünhain, Gegner; MASTERPROMPT §20.1, docs/ART.md §15): 32×32, massige Schultern, dunkles
 * Borstenkleid (`erde`) mit Borstenkamm, Rüsselscheibe, helle Hauer; Nachtaktiv – Augen `feuer.3*`.
 * Angriffe: `ansturm` (senkt den Kopf, scharrt – 0,6 s Ausholphase –, stürmt 0,2 s vor, reißt den Kopf hoch; der Schlag
 * nach 0,8 s liegt am oberen Rand von §19.4) und `hauer` (kurzer Hieb mit den Hauern, 0,3 s).
 */
import { kreatur } from '../../lib/creature';
import { angriffClip, idleClip, zyklusClip } from '../../lib/creatureAnim';
import { KOERPER, punktIn, rahmen } from '../../lib/creatureBau';
import { gangPose, koerperTeil, vierbeiner, vierbeinerTod, vierbeinerTreffer } from '../../lib/creatureVierbeiner';

// Breit gebaut (M6-21b): Rumpf, Brust und Hüfte sind seitlich breiter als hoch, die Beine stehen weiter
// auseinander, die Ansicht von vorn und hinten ist etwas breiter gezogen (1,6 statt 1,3) – von vorn 18 statt 12 px breit
// bei 22 px Länge im Profil: die Silhouette eines schweren Keilers statt einer Säule. Der Körper selbst ist breit, nicht
// nur die Ansicht: auf der Seite liegend (Tod) bleibt er in der Zelle, statt die Beine quer über den Rand zu strecken.
const plan = vierbeiner({
  rumpf: { f: -0.6, u: 8.6, r: [6.2, 5.2, 3.8] },
  brust: { f: 3, u: 9.4, r: [4, 5.6, 4.6] },
  huefte: { f: -4.6, u: 8.4, r: [3.4, 4.8, 3.4] },
  kopf: { f: 7, u: 8, r: [3.2, 2.9, 3], gelenk: [5, 9.4], nick: -12 },
  schnauze: { f: 3.1, u: -1.3, r: [2.4, 1.8, 1.7], nick: -14 },
  kiefer: { f: 2.6, u: -2.3, r: [2, 1.5, 0.8], gelenk: [0.6, -1.8], oeffnen: 25 },
  ohren: { form: 'spitz', f: -1.4, s: 1.8, u: 1.9, laenge: 2.4, breite: 2.1, neigung: 18, spreizung: 32, innen: 'ohrInnen' },
  augen: {
    f: 1.9,
    s: 1.5,
    u: 0.6,
    seite: [
      [0, 0, 'auge', 0],
      [1, 0, 'auge', 0],
    ],
    vorn: [[0, 0, 'auge', 0], [0, -1, 'auge', 0]],
    zu: [
      [0, 0, 'lid', 0],
      [1, 0, 'lid', 0],
    ],
  },
  nase: { f: 5.4, u: -1.8, seite: [[0, 0, 'ruessel', 0], [0, 1, 'ruessel', 0]], vorn: [[0, 0, 'ruessel', 0], [1, 0, 'ruessel', 0]] },
  beine: { vornF: 3.6, hintenF: -4.8, spur: 3.2, gelenkU: 5.6, dicke: [2, 2], pfote: 0.8, hintenKnick: -1 },
  schwanz: { form: 'duenn', f: -7.4, u: 9.8, laenge: 3.2, dicke: 1, winkel: -45 },
  verbreiterung: 1.6,
  hoeheBezug: 13,
  materialien: {
    fell: { stufen: ['erde.0', 'erde.1', 'erde.2', 'erde.3'], schwellen: [0.36, 0.52, 0.82] },
    borsten: { stufen: ['nacht.2', 'erde.0'], schwellen: [0.6] },
    ohrInnen: { stufen: ['erde.0'] },
    bein: { stufen: ['erde.0', 'erde.1'] },
    pfote: { stufen: ['nacht.2'] },
    ruessel: { stufen: ['haut.1'] },
    hauer: { stufen: ['eis.3', 'eis.4'] },
    auge: { stufen: ['feuer.3*'] },
    lid: { stufen: ['erde.0'] },
    rachen: { stufen: ['laub.0'] },
  },
  // Dunkles Borstenkleid nur als Streifen über dem Rückgrat (|seitlich| < 0,5): auf dem breiten Rücken würde die ganze
  // Oberseite in der Rückansicht zu einem dunklen Querband (M6-21b).
  zeichnung: (o) => (koerperTeil(o.teil) && o.normale[2] > 0.7 && Math.abs(o.lokal[1]) < 0.5 ? 'borsten' : null),
  extra: (bau, { kopf, koerper, nur }) => {
    if (nur === null || nur.has('kopf')) {
      bau.teil('hauer', 'hauer', 'hauer');
      for (const seite of [-1, 1]) {
        const fuss = punktIn(kopf, [3.4, 1.3 * seite, -1.6]);
        const r = rahmen(KOERPER, fuss);
        bau.zug('hauer', r, [
          [0, 0, 0],
          [0.6, 0.2 * seite, 0.9],
          [0.2, 0.3 * seite, 1.7],
        ], 1, 1);
      }
    }
    if (nur === null || nur.has('rumpf')) {
      bau.teil('kamm', 'borsten', 'koerper');
      for (let i = 0; i < 5; i++) {
        const f = 3.4 - i * 2.1;
        bau.flaeche('kamm', koerper, [
          [f - 1, -0.5, 3.4 + (i === 0 ? 1 : 0.5)],
          [f + 1, 0.5, 3.4 + (i === 0 ? 1 : 0.5)],
          [f - 0.2, 0, 5.4 + (i < 2 ? 0.8 : 0)],
        ]);
      }
    }
  },
});

const RUHE = { vlF: 1, hlF: -1 };

export const keiler = kreatur({
  id: 'keiler',
  zelle: 32,
  anker: [16, 24],
  hoehe: 'kugel',
  massstab: 0.92,
  plan,
  clips: [
    idleClip(RUHE, { ...RUHE, kopfNick: -8 }, { ...RUHE, hub: -0.6, kopfNick: -8, kopfHub: -0.5 }, { ...RUHE, hub: -0.6, kopfNick: 3 }),
    zyklusClip('move', 6, 12, (ph) => gangPose({ art: 'trab', schritt: 2.6, anheben: 1.8, koerperHub: 0.6, koerperNick: 3, kopfNick: 4, schwanz: 20 }, ph), [0, 3]),
    angriffClip({
      name: 'ansturm',
      fps: 10,
      // Scharren mit dem Vorderlauf (in der Frontansicht der gehobene Huf), Kopf tief, die Augen bleiben im Profil sichtbar.
      aushol: [
        { kopfNick: -12, kopfHub: -1, hub: -0.5, vrF: 1.4, vrU: 1.6, ohren: 20 },
        { kopfNick: -15, kopfHub: -1.5, hub: -1, vrF: -1.2, vrU: 0.4, hrF: -1, ohren: 30, vor: -0.5 },
        { kopfNick: -15, kopfHub: -1.5, hub: -1, vrF: 1.2, vrU: 1.4, hrF: -1, hlF: -1, ohren: 30, vor: -0.4 },
      ],
      // Drei Posen plus drei Haltebilder = 0,6 s Ausholen, dazu 0,2 s Anlauf: der Schlag kommt nach 0,8 s (§19.4 „0,3–0,8 s“).
      halten: 3,
      anlauf: [gangPose({ art: 'galopp', schritt: 3, anheben: 2, koerperHub: 1, koerperNick: 5 }, 0), gangPose({ art: 'galopp', schritt: 3, anheben: 2, koerperHub: 1, koerperNick: 5 }, 0.5)].map((w) => ({ ...w, kopfNick: -18, kopfHub: -1.5, vor: 1 })),
      schlag: { ...gangPose({ art: 'galopp', schritt: 3, anheben: 2, koerperHub: 1, koerperNick: 5 }, 0.25), kopfNick: -14, kopfHub: -1, vor: 2 },
      schmierTeile: [],
      treffer: { kopfNick: 18, kopfHub: 1, vor: 2.5, nick: 8, maul: 0.6, vlF: 2, vrF: 2 },
      nach: [{ kopfNick: 6, vor: 1.2, nick: 2 }, { ...RUHE }],
    }),
    angriffClip({
      name: 'hauer',
      fps: 10,
      aushol: [
        { kopfNick: -10, kopfGier: -12, kopfHub: -1, hub: -0.5, vor: -0.5 },
        { kopfNick: -16, kopfGier: -20, kopfHub: -1.5, hub: -1, vor: -1 },
      ],
      halten: 1,
      schlag: { kopfNick: 16, kopfGier: 10, kopfHub: 0.5, vor: 1.2, maul: 0.5 },
      schmierTeile: ['kopf'],
      treffer: { kopfNick: 22, kopfGier: 14, kopfHub: 1, vor: 1.5, maul: 0.4 },
      nach: [{ kopfNick: 6, vor: 0.6 }, { ...RUHE }],
    }),
    vierbeinerTreffer(),
    vierbeinerTod(),
  ],
});

export default keiler.sprite;
