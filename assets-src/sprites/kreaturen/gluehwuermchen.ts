/**
 * Glühwürmchen (Grünhain, friedlich; MASTERPROMPT §20.1, docs/ART.md §15): 16×16, drei Leuchtkäfer
 * (dunkler Körper, helle Flügel) mit emissivem Hinterleib (`feuer.5*` Kern, `gras.5*` Schein) wie das
 * Umgebungs-Glühwürmchen (`gluehwuermchen`, M5-23). Das Leuchten pulsiert im Idle; getroffen und im
 * Tod erlischt es. Kein Angriff; keine Beute (docs/SPIEL.md §11).
 */
import { kreatur } from '../../lib/creature';
import { todClip, trefferClip, zyklusClip } from '../../lib/creatureAnim';
import { schwarm } from '../../lib/creatureSchwarm';

const plan = schwarm({
  anzahl: 3,
  wolke: [4.2, 4.2, 3.4],
  bahn: 0.12,
  hoehe: 5,
  seed: 5303,
  insekt: {
    oben: [
      [0, 0, 'koerper', 0],
      [1, 0, 'hinterleib', 0],
      [0, -1, 'fluegel', 0],
    ],
    unten: [
      [0, 0, 'koerper', 0],
      [1, 0, 'hinterleib', 0],
      [0, 1, 'fluegel', 0],
    ],
    liegend: [
      [0, 0, 'koerper', 0],
      [1, 0, 'hinterleib', 0],
    ],
    hell: {
      oben: [
        [0, 0, 'koerper', 0],
        [1, 0, 'licht', 1],
        [2, 0, 'licht', 0],
        [0, -1, 'fluegel', 0],
      ],
      unten: [
        [0, 0, 'koerper', 0],
        [1, 0, 'licht', 1],
        [2, 0, 'licht', 0],
        [0, 1, 'fluegel', 0],
      ],
    },
  },
  materialien: {
    koerper: { stufen: ['erde.0'] },
    hinterleib: { stufen: ['sand.1'] },
    licht: { stufen: ['gras.5*', 'feuer.5*'] },
    fluegel: { stufen: ['eis.2'] },
  },
});

export const gluehwuermchen = kreatur({
  id: 'gluehwuermchen',
  zelle: 16,
  anker: [8, 13],
  hoehe: 'flach',
  plan,
  clips: [
    zyklusClip('idle', 8, 8, (ph, i) => ({ phase: ph, leuchten: [1, 1, 0.6, 0, 0, 0.6, 1, 1][i] ?? 1, hub: 0.5 * Math.sin(2 * Math.PI * ph) })),
    zyklusClip('move', 6, 10, (ph, i) => ({ phase: ph, vor: 1, leuchten: i % 3 === 0 ? 1 : 0.6 }), [0], 'summen'),
    trefferClip({ phase: 0.1, streuung: 0.6, hub: 0.5, leuchten: 0 }, { phase: 0.2, streuung: 0.4, leuchten: 0 }),
    todClip(
      [
        { phase: 0.1, streuung: 0.6, hub: 0.5, leuchten: 0 },
        { phase: 0.15, streuung: 0.7, fall: 0.4 },
        { phase: 0.2, streuung: 0.7, fall: 0.8 },
        { phase: 0.22, streuung: 0.7, fall: 1 },
      ],
      3,
    ),
  ],
  einzelpixel: 'Glühwürmchen sind 2–3 px große Stempel; Flügel und Leuchtpunkt sind einzelne Pixel je Tier',
});

export default gluehwuermchen.sprite;
