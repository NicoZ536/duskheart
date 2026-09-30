/**
 * Wespenschwarm (Grünhain, Gegner; MASTERPROMPT §20.1, docs/ART.md §15): 32×32, sieben Wespen (gelb-
 * dunkel gestreifter Körper, helle Flügel) auf geschlossenen Bahnen. Tagaktiv – keine emissiven Augen;
 * lesbar über den Gelb-Schwarz-Kontrast und die Bewegung. Angriff `stechen`: der Schwarm zieht sich
 * zusammen (Ausholen), stößt als gestreckte Wolke vor und zerstreut sich.
 */
import { kreatur } from '../../lib/creature';
import { angriffClip, todClip, trefferClip, zyklusClip } from '../../lib/creatureAnim';
import { schwarm } from '../../lib/creatureSchwarm';

const KOERPER: readonly (readonly [number, number, string, number])[] = [
  [-1, 0, 'kopf', 0],
  [0, 0, 'koerper', 1],
  [1, 0, 'streifen', 0],
  [2, 0, 'koerper', 0],
];

const plan = schwarm({
  anzahl: 7,
  wolke: [9, 7, 5],
  hoehe: 9,
  seed: 7101,
  insekt: {
    oben: [...KOERPER, [0, -1, 'fluegel', 0], [1, -1, 'fluegel', 0]],
    unten: [...KOERPER, [0, 1, 'fluegel', 0], [1, 1, 'fluegel', 0]],
    liegend: [
      [0, 0, 'koerper', 0],
      [1, 0, 'streifen', 0],
      [2, 0, 'koerper', 0],
    ],
  },
  materialien: {
    koerper: { stufen: ['feuer.3', 'feuer.4'] },
    streifen: { stufen: ['erde.0'] },
    kopf: { stufen: ['erde.0'] },
    fluegel: { stufen: ['eis.3'] },
  },
});

export const wespenschwarm = kreatur({
  id: 'wespenschwarm',
  zelle: 32,
  anker: [16, 26],
  hoehe: 'flach',
  plan,
  clips: [
    zyklusClip('idle', 8, 12, (ph) => ({ phase: ph, hub: 0.6 * Math.sin(2 * Math.PI * ph) })),
    zyklusClip('move', 6, 12, (ph) => ({ phase: ph, vor: 1.5, dichte: 0.15 }), [0], 'summen'),
    angriffClip({
      name: 'stechen',
      fps: 10,
      aushol: [
        { phase: 0.1, dichte: 0.5, hub: 0.5 },
        { phase: 0.2, dichte: 0.9, hub: 1, vor: -1.5 },
      ],
      halten: 3,
      schlag: { phase: 0.3, dichte: 0.6, vor: 3.5, hub: -1.5 },
      treffer: { phase: 0.4, dichte: 0.2, vor: 4, hub: -2, streuung: 0.3 },
      nach: [{ phase: 0.55, vor: 2, streuung: 0.2 }, { phase: 0.7, vor: 1 }],
    }),
    trefferClip({ phase: 0.1, streuung: 1, hub: 1 }, { phase: 0.2, streuung: 0.5 }),
    todClip(
      [
        { phase: 0.1, streuung: 0.8, hub: 1 },
        { phase: 0.15, streuung: 0.6, fall: 0.35 },
        { phase: 0.2, streuung: 0.4, fall: 0.7 },
        { phase: 0.22, streuung: 0.3, fall: 1 },
        { phase: 0.22, streuung: 0.3, fall: 1 },
      ],
      3,
    ),
  ],
  einzelpixel: 'Wespen sind 1–2 px große Stempel (Kopf, Streifen, Flügel); einzelne Farbpunkte gehören zu je einem Tier',
});

export default wespenschwarm.sprite;
