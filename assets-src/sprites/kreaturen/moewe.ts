/**
 * Möwe (Salzküste, friedlich, Boden und Flug; MASTERPROMPT §20.1, docs/ART.md §15): 32×32, weißes
 * Gefieder (`eis`), grauer Mantel (`stein`), schwarze Flügelspitzen, gelber Schnabel, rosa Läufe.
 * `move` ist der Flug (Flügelschlag, Läufe eingezogen), `gehen` das Laufen am Boden. Angriff `picken`:
 * Kopf zurück, Schnabel stößt nach vorn unten.
 */
import { kreatur } from '../../lib/creature';
import { angriffClip, idleClip, klip, pose, todClip, trefferClip, zyklusClip } from '../../lib/creatureAnim';
import { vogel } from '../../lib/creatureVogel';

const plan = vogel({
  rumpf: { f: 0, u: 7, r: [5, 3, 3], nick: 8 },
  kopf: { f: 4.4, u: 11, r: [2.7, 2.4, 2.5], gelenk: [3.4, 9] },
  schnabel: { f: 2, u: -0.6, laenge: 4, breite: 1.8, hoehe: 1.8, neigung: -18 },
  augen: { f: 1.1, s: 1.3, u: 0.5, seite: [[0, 0, 'auge', 0]], vorn: [[0, 0, 'auge', 0]], zu: [[0, 0, 'auge', 0]] },
  schwanz: { f: -4.6, u: 7.6, laenge: 3.6, breite: 3.2, winkel: 4 },
  fluegel: { f: 0.8, u: 7.6, s: 2.3, spanne: 8, tiefe: 5, angelegt: [5.4, 1.2, 2.2], spitze: 1 },
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
});

const FLUG = { hub: 5, fluegel: 1, beineEin: 1, faecher: 0.6 };
const SCHLAG = [42, 18, -18, -40, -18, 18];

export const moewe = kreatur({
  id: 'moewe',
  zelle: 32,
  anker: [16, 25],
  hoehe: 'kugel',
  plan,
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
