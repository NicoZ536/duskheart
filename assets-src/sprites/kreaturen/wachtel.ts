/**
 * Wachtel (Grünhain, friedlich, Bodenvogel; MASTERPROMPT §20.1, docs/ART.md §15): 16×16, rundlicher
 * Körper in Erdbraun mit hellem Rückenstreif, heller Kehle und Brust, dunkler Scheitel, kurzer Schwanz. `move` trippelt mit
 * nickendem Kopf; `flug` ist das kurze Auffliegen, wenn sie aufgescheucht wird. Kein Angriff.
 */
import { kreatur } from '../../lib/creature';
import { idleClip, todClip, trefferClip, zyklusClip } from '../../lib/creatureAnim';
import { vogel } from '../../lib/creatureVogel';

const plan = vogel({
  rumpf: { f: -0.4, u: 3.6, r: [3.1, 2.6, 2.5], nick: 4 },
  kopf: { f: 2.4, u: 6, r: [1.9, 1.7, 1.8], gelenk: [1.8, 4.8] },
  schnabel: { f: 1.6, u: -0.3, laenge: 1.1, breite: 0.9, hoehe: 0.9, neigung: -10 },
  augen: { f: 1, s: 1.05, u: 0.3, seite: [[0, 0, 'auge', 0]], vorn: [[0, 0, 'auge', 0]], zu: [[0, 0, 'auge', 0]] },
  schwanz: { f: -3.3, u: 3.9, laenge: 1.6, breite: 1.8, winkel: 15 },
  fluegel: { f: -0.3, u: 4, s: 2, spanne: 2.8, tiefe: 3, angelegt: [2.6, 0.8, 1.5], spitze: 0 },
  beine: { f: 0.3, spur: 0.9, laenge: 2, zehen: 0.8 },
  hoeheBezug: 6,
  materialien: {
    gefieder: { stufen: ['erde.1', 'erde.2', 'erde.3', 'erde.4'], schwellen: [0.36, 0.52, 0.82] },
    streifen: { stufen: ['sand.3', 'sand.4'], schwellen: [0.6] },
    kopf: { stufen: ['erde.1', 'erde.2', 'erde.3'], schwellen: [0.4, 0.7] },
    scheitel: { stufen: ['erde.1'] },
    fluegel: { stufen: ['erde.1', 'erde.2', 'erde.3'], schwellen: [0.4, 0.72] },
    spitze: { stufen: ['erde.1'] },
    schwanz: { stufen: ['erde.1', 'erde.2'], schwellen: [0.6] },
    schnabel: { stufen: ['erde.0'] },
    auge: { stufen: ['nacht.1'] },
    bein: { stufen: ['haut.2', 'haut.3'] },
  },
  zeichnung: (o) => {
    const [f, s, u] = o.lokal;
    // Heller Längsstreif über den Rücken, helle Kehle und Brust, dunkler Scheitel.
    if (o.teil === 'rumpf' && u > 0.55 && Math.abs(s) < 0.28) return 'streifen';
    if (o.teil === 'rumpf' && o.normale[2] < -0.35) return 'streifen';
    if (o.teil === 'kopf' && f > 0.35 && u < 0.1) return 'streifen';
    if (o.teil === 'kopf' && u > 0.6) return 'scheitel';
    return null;
  },
});

export const wachtel = kreatur({
  id: 'wachtel',
  zelle: 16,
  anker: [8, 12],
  hoehe: 'kugel',
  plan,
  clips: [
    idleClip({}, { kopfNick: -5, kopfVor: 0.4 }, { hub: -0.5, kopfNick: -5, kopfVor: 0.4 }, { hub: -0.5, kopfNick: 4 }),
    zyklusClip('move', 4, 12, (ph) => ({ lF: 1.2 * Math.cos(2 * Math.PI * ph), rF: -1.2 * Math.cos(2 * Math.PI * ph), lU: Math.max(0, -Math.sin(2 * Math.PI * ph)), rU: Math.max(0, Math.sin(2 * Math.PI * ph)), kopfVor: 0.6 * Math.cos(4 * Math.PI * ph), hub: 0.3 * Math.cos(4 * Math.PI * ph), nick: -6 }), [0, 2]),
    zyklusClip('flug', 4, 12, (_ph, i) => ({ hub: 0.8 + 0.4 * (i % 2), fluegel: 1, schlag: [28, 4, -30, 4][i] ?? 0, beineEin: 1, nick: -8 }), [0], 'fluegelschlag'),
    trefferClip({ kopfNick: 20, augenZu: 1, fluegel: 0.6, schlag: 30, vor: -0.6, hub: 0.4 }, { kopfNick: -8, augenZu: 1, hub: -0.4 }),
    todClip(
      [
        { kopfNick: 20, augenZu: 1, fluegel: 0.6, schlag: 30 },
        { kopfNick: -18, augenZu: 1, hub: -0.6, fluegel: 0.4, schlag: -10 },
        { roll: 50, liegen: 0.5, augenZu: 1, kopfNick: -20, beineEin: 0.5 },
        { roll: 90, liegen: 1, augenZu: 1, kopfNick: -22, beineEin: 0.7 },
        { roll: 90, liegen: 1, augenZu: 1, kopfNick: -24, beineEin: 0.7, fluegel: 0.5, schlag: -30 },
      ],
      3,
    ),
  ],
});

export default wachtel.sprite;
