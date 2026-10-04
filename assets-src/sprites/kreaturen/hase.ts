/**
 * Hase (Grünhain, friedlich; MASTERPROMPT §20.1, docs/ART.md §15): 16×16, erdbraunes Fell, heller Bauch,
 * lange Löffel mit dunklen Spitzen, weiße Blume. `move` hoppelt (Hinterläufe gemeinsam, Körper im Bogen).
 * Kein Angriff: der Hase flieht.
 */
import { kreatur } from '../../lib/creature';
import { idleClip, zyklusClip } from '../../lib/creatureAnim';
import { rahmen } from '../../lib/creatureBau';
import { gangPose, koerperTeil, vierbeiner, vierbeinerTod, vierbeinerTreffer } from '../../lib/creatureVierbeiner';

/**
 * Löffel je Ansicht (Kopfrahmen: Ansatz vorn/seitlich/oben, Länge, Breite; Neigung nach vorn +, Spreizung nach außen, Grad). Im
 * Profil und von hinten wie bisher; von vorn lang, schmal und als enges V zurückgelegt aufgestellt, die rosa Muschel zur Kamera,
 * nur die Spitze dunkel (`loeffel`, Zeichnung oben) – vorher lasen sich die kurzen, seitlich abstehenden Ohrkeile aus
 * Umrissschwarz als Katze, Kauz oder Fledermaus (M6-Gate, kreaturen-gruenhain, stationen-nacht, daemmerung-gruenhain-1845).
 * `spiel`: Anteil des Ohrenspiels der Posen; `haltung` 1: die Löffel folgen dem Nicken des Kopfes nicht; `einfallen`: Anteil,
 * um den sie liegend (Tod) kürzer werden; `muschel`: Lage der Muschel vor der Ohrfläche (Anteil der halben Breite).
 */
const LOEFFEL = {
  right: { teil: 'ohr', f: -0.8, s: 0.95, u: 1.3, laenge: 3.4, breite: 1.9, neigung: 16, spreizung: 18, spiel: 1, haltung: 0, einfallen: 0, muschel: 0.3 },
  up: { teil: 'ohr', f: -0.8, s: 0.95, u: 1.3, laenge: 3.4, breite: 1.9, neigung: 16, spreizung: 18, spiel: 1, haltung: 0, einfallen: 0, muschel: 0.3 },
  down: { teil: 'loeffel', f: -0.8, s: 1.3, u: 1.1, laenge: 5, breite: 1.6, neigung: -25, spreizung: 15, spiel: 0.5, haltung: 1, einfallen: 0.5, muschel: 0.5 },
} as const;

/** Rumpfmitte (vorn, oben): Bezug des Körperrahmens. */
const RUMPF_MITTE = [-0.6, 4.2] as const;
/** Helle Brust von vorn (Kreaturraum: vorn, oben, Radien). */
const BRUST_VORN = { f: 1, u: 2.6, r: [1.2, 1.3, 1.6] as const } as const;

const plan = vierbeiner({
  rumpf: { f: -0.6, u: 4.2, r: [2.7, 2.2, 2.3], nick: 12 },
  huefte: { f: -1.9, u: 3.8, r: [2.3, 2.3, 2.3] },
  kopf: { f: 2.2, u: 6.2, r: [2.2, 2, 2], gelenk: [1.4, 5] },
  schnauze: { f: 1.5, u: -0.5, r: [1.1, 1.1, 1] },
  augen: { f: 1.1, s: 1.25, u: 0.4, seite: [[0, 0, 'auge', 0]], vorn: [[0, 0, 'auge', 0]], zu: [[0, 0, 'auge', 0]] },
  beine: { vornF: 1.6, hintenF: -1.6, spur: 1.2, gelenkU: 2.8, dicke: [1, 1], pfote: 1, hintenKnick: -1 },
  schwanz: { form: 'stummel', f: -3.6, u: 4.8, laenge: 1.4, dicke: 1.1, winkel: 30, material: 'weiss' },
  hoeheBezug: 6.5,
  verbreiterung: 1.6,
  materialien: {
    fell: { stufen: ['erde.1', 'erde.2', 'erde.3', 'erde.4'], schwellen: [0.36, 0.52, 0.82] },
    bauch: { stufen: ['sand.3', 'sand.4'], schwellen: [0.5] },
    weiss: { stufen: ['sand.4', 'eis.4'], schwellen: [0.5] },
    spitze: { stufen: ['nacht.1'] },
    ohrInnen: { stufen: ['haut.3'] },
    bein: { stufen: ['erde.1', 'erde.2'] },
    pfote: { stufen: ['erde.2'] },
    auge: { stufen: ['nacht.1'] },
  },
  zeichnung: (o) => {
    if (o.teil === 'ohr' && o.lokal[2] > 0.55) return 'spitze';
    if (o.teil === 'loeffel' && o.lokal[2] > 0.8) return 'spitze';
    if ((koerperTeil(o.teil) || o.teil === 'kopf') && o.normale[2] < -0.5) return 'bauch';
    if (o.teil === 'schnauze' && o.normale[2] < 0) return 'bauch';
    return null;
  },
  extra: (bau, { kopf, koerper, w, nur }) => {
    // Von vorn sitzt die helle Brust zwischen den Vorderläufen (statt eines Umrisslochs zwischen den Pfoten).
    if (bau.richtung === 'down' && (nur === null || nur.has('rumpf'))) {
      bau.teil('brustVorn', 'bauch', 'koerper');
      bau.ellipsoid('brustVorn', koerper, [BRUST_VORN.f - RUMPF_MITTE[0], 0, BRUST_VORN.u - RUMPF_MITTE[1]], BRUST_VORN.r);
    }
    if (nur !== null && !nur.has('kopf')) return;
    const o = LOEFFEL[bau.richtung];
    bau.teil('loeffel', 'fell', 'ohr');
    bau.teil('muschel', 'ohrInnen', 'ohr');
    const b = o.breite / 2;
    // Liegend (Tod) fallen die langen Löffel von vorn auf die Hälfte zusammen: quer gekippt und breiter gezogen sprengten sie die Zelle.
    const liegend = Math.min(1, Math.abs(w['roll'] ?? 0) / 90) * o.einfallen;
    const laenge = (o.laenge + (w['ohrLang'] ?? 0)) * (1 - liegend);
    for (const seite of [-1, 1]) {
      const basis = rahmen(kopf, [o.f, o.s * seite, o.u], { nick: -(o.neigung + (w['ohren'] ?? 0) * o.spiel) - (w['kopfNick'] ?? 0) * o.haltung, roll: o.spreizung * seite });
      bau.ellipsoid(o.teil, basis, [0, 0, laenge / 2], [b * 0.55, b, laenge / 2]);
      bau.ellipsoid('muschel', basis, [b * o.muschel, 0, laenge * 0.5], [b * 0.3, b * 0.5, laenge * 0.36]);
    }
  },
});

export const hase = kreatur({
  id: 'hase',
  zelle: 16,
  anker: [8, 12],
  hoehe: 'kugel',
  massstab: 0.78,
  // Von vorn sitzt der Kopf etwas zurück: die helle Brust darunter wird frei, die Löffel bleiben in der Zelle.
  jeRichtung: { down: { kopfVor: -1 }, up: { ohren: -10, ohrLang: 0.2 } },
  plan,
  clips: [
    idleClip({}, { kopfNick: -4, ohren: 4 }, { hub: -0.5, kopfNick: -4, ohren: 4 }, { hub: -0.5, ohren: -3 }),
    zyklusClip('move', 6, 12, (ph) => gangPose({ art: 'hoppeln', schritt: 1.8, anheben: 1.2, koerperHub: 0.7, koerperNick: 10, kopfNick: 4 }, ph), [0], 'hoppeln'),
    vierbeinerTreffer(),
    vierbeinerTod({ ohren: 50, beineAn: 0.3, kopfVor: -1.5 }),
  ],
});

export default hase.sprite;
