/**
 * Möwe (Salzküste, friedlich, Boden und Flug; MASTERPROMPT §20.1, docs/ART.md §15): 32×32, weißes
 * Gefieder (`eis`), grauer Mantel (`stein`), schwarze Flügelspitzen, gelber Schnabel, rosa Läufe.
 * `move` ist der Flug (Flügelschlag, Läufe eingezogen), `gehen` das Laufen am Boden. Angriff `picken`:
 * Kopf zurück, Schnabel stößt nach vorn unten.
 */
import { kreatur } from '../../lib/creature';
import { angriffClip, idleClip, klip, pose, todClip, trefferClip, zyklusClip } from '../../lib/creatureAnim';
import { rahmen } from '../../lib/creatureBau';
import { vogel } from '../../lib/creatureVogel';

/**
 * M6-Gate (kreaturen-kueste: von vorn ein weißer, abgerundeter Block mit zwei Augen, Schnabel und Beinen – ein „Gespenst“):
 * von vorn sitzt der Kopf höher und weiter zurück auf einem kurzen Hals, so stehen Brust und Schultern frei und der Kopf ist
 * schmaler als die Schultern; die angelegten Flügel liegen unten enger an (`fluegelAb` < 0: die breiteste Stelle an den
 * Schultern statt einer Glocke), die Augen sitzen seitlich am Kopf (kein Gesicht aus zwei Punkten). In allen Ansichten trägt
 * der Rücken den grauen Mantel und der angelegte Flügel schwarze Handschwingen (über den Schultern sichtbar, von hinten neben
 * dem weißen Bürzel). Werte im Kreaturraum (vorn, seitlich, oben; Grad).
 */
const VORN = { kopfVor: -1.5, kopfHub: 2.5, fluegelAb: -15, hals: { f: 2.6, u: 10, r: [1.7, 1.9, 2.2] } } as const;
/** Rumpfmitte (vorn, oben) und angelegter Flügel des Bauplans – die Frontansicht zeichnet ihn abgespreizt nach. */
const RUMPF_MITTE = [0, 7] as const;
const FLUEGEL = { f: 0.8, u: 7.6, s: 2.3, angelegt: [5.4, 1.2, 2.2] } as const;

const plan = vogel({
  rumpf: { f: 0, u: 7, r: [5, 3, 3], nick: 8 },
  kopf: { f: 4.4, u: 11, r: [2.7, 2.4, 2.5], gelenk: [3.4, 9] },
  schnabel: { f: 2, u: -0.6, laenge: 4, breite: 1.8, hoehe: 1.8, neigung: -18 },
  augen: { f: 1.1, s: 1.3, u: 0.5, seite: [[0, 0, 'auge', 0]], vorn: [[1, 0, 'auge', 0]], zu: [[0, 0, 'auge', 0]] },
  schwanz: { f: -4.6, u: 7.6, laenge: 3.6, breite: 3.2, winkel: 4 },
  fluegel: { ...FLUEGEL, spanne: 8, tiefe: 5, spitze: 1 },
  beine: { f: 0.2, spur: 1.2, laenge: 4, zehen: 1 },
  hoeheBezug: 11,
  materialien: {
    gefieder: { stufen: ['eis.2', 'eis.3', 'eis.4'], schwellen: [0.45, 0.78] },
    kopf: { stufen: ['eis.2', 'eis.3', 'eis.4'], schwellen: [0.45, 0.7] },
    fluegel: { stufen: ['stein.2', 'stein.3', 'stein.4'], schwellen: [0.45, 0.72] },
    spitze: { stufen: ['nacht.2'] },
    schwanz: { stufen: ['eis.2', 'eis.3'], schwellen: [0.6] },
    schnabel: { stufen: ['feuer.4'] },
    auge: { stufen: ['nacht.1'] },
    bein: { stufen: ['haut.3'] },
  },
  // Angelegt die schwarzen Handschwingen am hinteren Flügelende (Erkennungszeichen der Möwe, von vorn über den Schultern).
  zeichnung: (o) => {
    if (o.teil === 'fluegel' && o.lokal[0] < -0.55) return 'spitze';
    // Grauer Mantel über den Rücken zwischen den Flügeln (von oben, vorn und hinten sichtbar; die Brust bleibt weiß).
    if (o.teil === 'rumpf' && o.normale[2] > 0.45 && o.lokal[0] < 0.35) return 'fluegel';
    return null;
  },
  extra: (bau, { koerper, w, nur }) => {
    if (bau.richtung !== 'down') return;
    if (nur === null || nur.has('kopf')) {
      bau.teil('hals', 'kopf', 'kopf');
      const h = VORN.hals;
      bau.ellipsoid('hals', koerper, [h.f - RUMPF_MITTE[0] + (w['kopfVor'] ?? 0), 0, h.u - RUMPF_MITTE[1] + (w['kopfHub'] ?? 0) / 2], h.r);
    }
    if ((nur === null || nur.has('fluegel')) && (w['fluegel'] ?? 0) < 0.35) {
      const [a, b, c] = FLUEGEL.angelegt;
      for (const seite of [-1, 1]) {
        const schulter = rahmen(koerper, [FLUEGEL.f - RUMPF_MITTE[0], FLUEGEL.s * seite, FLUEGEL.u - RUMPF_MITTE[1]], { roll: -seite * ((w['schlag'] ?? 0) + VORN.fluegelAb) });
        bau.ellipsoid('fluegel', schulter, [-a * 0.55, 0, -c * 0.2], [a, b, c], { nick: -8 });
      }
    }
  },
});

const FLUG = { hub: 5, fluegel: 1, beineEin: 1, faecher: 0.6 };
const SCHLAG = [42, 18, -18, -40, -18, 18];

export const moewe = kreatur({
  id: 'moewe',
  zelle: 32,
  anker: [16, 25],
  hoehe: 'kugel',
  plan,
  jeRichtung: { down: { kopfVor: VORN.kopfVor, kopfHub: VORN.kopfHub } },
  clips: [
    idleClip({}, { kopfNick: 5 }, { hub: -0.6, kopfNick: 5, kopfHub: -0.5 }, { hub: -0.6, kopfNick: 2 }),
    zyklusClip('move', 6, 10, (_ph, i) => ({ ...FLUG, schlag: SCHLAG[i] ?? 0, hub: FLUG.hub + (i < 3 ? 0 : 1), nick: -4 }), [0], 'fluegelschlag'),
    zyklusClip('gehen', 4, 8, (ph) => ({ lF: 1.5 * Math.cos(2 * Math.PI * ph), rF: -1.5 * Math.cos(2 * Math.PI * ph), lU: Math.max(0, -Math.sin(2 * Math.PI * ph)) * 1.2, rU: Math.max(0, Math.sin(2 * Math.PI * ph)) * 1.2, kopfVor: 0.8 * Math.cos(4 * Math.PI * ph), hub: 0.4 * Math.cos(4 * Math.PI * ph) }), [0, 2]),
    angriffClip({
      name: 'picken',
      fps: 10,
      aushol: [
        { kopfNick: 18, kopfVor: -0.8, kopfHub: 0.5, fluegel: 0.4, schlag: 20, faecher: 0.5 },
        { kopfNick: 30, kopfVor: -1.5, kopfHub: 1, schnabel: 0.6, fluegel: 0.7, schlag: 35, faecher: 1, hub: 0.5 },
      ],
      halten: 2,
      schlag: { kopfNick: -35, kopfVor: 2, kopfHub: -2, schnabel: 1, fluegel: 0.6, schlag: 10, nick: -10, vor: 1 },
      schmierTeile: ['kopf'],
      treffer: { kopfNick: -42, kopfVor: 2.5, kopfHub: -2.5, schnabel: 0.2, nick: -12, vor: 1.2 },
      nach: [{ kopfNick: -10, kopfVor: 0.8, nick: -4 }, { kopfNick: 4 }],
    }),
    trefferClip({ kopfNick: 25, kopfVor: -1, augenZu: 1, fluegel: 0.6, schlag: 35, vor: -1, hub: 0.5 }, { kopfNick: -8, augenZu: 1, hub: -0.5, fluegel: 0.4, schlag: 10 }),
    todClip(
      [
        { kopfNick: 25, augenZu: 1, fluegel: 0.7, schlag: 40, vor: -1 },
        { kopfNick: -20, augenZu: 1, fluegel: 0.6, schlag: -10, hub: -1 },
        { roll: 40, liegen: 0.4, augenZu: 1, fluegel: 0.5, schlag: -20, kopfNick: -25 },
        { roll: 88, liegen: 1, augenZu: 1, fluegel: 0.8, schlag: -30, kopfNick: -20, beineEin: 0.6 },
        { roll: 90, liegen: 0.85, augenZu: 1, fluegel: 0.8, schlag: -35, kopfNick: -25, beineEin: 0.6 },
        { roll: 90, liegen: 1, augenZu: 1, fluegel: 0.8, schlag: -38, kopfNick: -28, beineEin: 0.6 },
      ],
      3,
    ),
    klip('landen', 10, false, [pose({ ...FLUG, schlag: 40, hub: 5 }), pose({ fluegel: 1, schlag: 30, hub: 2, beineEin: 0.3 }), pose({ fluegel: 0.6, schlag: 20, hub: -0.5 }), pose({})], [0, 1, 2, 3]),
  ],
});

export default moewe.sprite;
