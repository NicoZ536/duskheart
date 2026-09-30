/**
 * Qualle (Salzküste, Gegner; MASTERPROMPT §20.1, docs/ART.md §15): 32×32, türkis-heller Schirm mit
 * durchscheinenden Gonadenbögen, emissivem Schirmrand (`wasser.5*`, `eis.4*`) und jedem zweiten
 * Nesselfaden leuchtend – nachts ein kalter Lichtkranz. Angriff `nesseln`: der Schirm zieht sich zusammen
 * (Ausholen), die Fäden peitschen gespreizt nach vorn.
 */
import { kreatur } from '../../lib/creature';
import { angriffClip, todClip, trefferClip, zyklusClip } from '../../lib/creatureAnim';
import { qualle as quallenPlan } from '../../lib/creatureQualle';

const plan = quallenPlan({
  schirm: { radius: 6, hoehe: 5.4, schwebe: 11 },
  faeden: { anzahl: 8, laenge: 9 },
  arme: { anzahl: 4, laenge: 5 },
  hoeheBezug: 16,
  materialien: {
    schirm: { stufen: ['wasser.3', 'wasser.4', 'wasser.5*', 'eis.4*'], schwellen: [0.4, 0.58, 0.84] },
    rand: { stufen: ['wasser.5*', 'eis.4*'], schwellen: [0.6] },
    innen: { stufen: ['wasser.2', 'wasser.3'], schwellen: [0.6] },
    faden: { stufen: ['wasser.4', 'wasser.5*'] },
    arm: { stufen: ['eis.1', 'eis.2'] },
  },
});

const PULS = [0, 0.45, 1, 0.75, 0.4, 0.1];

export const qualle = kreatur({
  id: 'qualle',
  zelle: 32,
  anker: [16, 26],
  hoehe: 'kugel',
  plan,
  clips: [
    zyklusClip('idle', 6, 8, (ph, i) => ({ puls: PULS[i] ?? 0, phase: ph, hub: 0.8 * Math.sin(2 * Math.PI * (ph - 0.2)) })),
    zyklusClip('move', 6, 10, (ph, i) => ({ puls: PULS[i] ?? 0, phase: ph * 2, hub: 1.2 * Math.sin(2 * Math.PI * (ph - 0.2)), vor: 1 }), [2], 'stoss'),
    angriffClip({
      name: 'nesseln',
      fps: 10,
      aushol: [
        { puls: 0.6, phase: 0.1, hub: 1 },
        { puls: 1, phase: 0.2, hub: 1.8, vor: -1 },
      ],
      halten: 3,
      schlag: { puls: 0, phase: 0.35, nessel: 1, vor: 1.2, hub: -0.5 },
      schmierTeile: ['faden'],
      treffer: { puls: 0.1, phase: 0.45, nessel: 0.8, vor: 1.5, hub: -0.8 },
      nach: [{ puls: 0.4, phase: 0.6, nessel: 0.3, vor: 1 }, { puls: 0.2, phase: 0.8 }],
    }),
    trefferClip({ puls: 1, phase: 0.1, hub: 1.5, vor: -1.5, nessel: 0.3 }, { puls: 0.3, phase: 0.3, hub: -0.5 }),
    todClip(
      [
        { puls: 1, phase: 0.1, hub: 1.5, nessel: 0.4 },
        { puls: 0.4, phase: 0.2, hub: -0.5, liegen: 0.5 },
        { puls: 0, phase: 0.3, liegen: 0.8, flach: 0.4 },
        { puls: 0, phase: 0.35, liegen: 1, flach: 0.8 },
        { puls: 0, phase: 0.35, liegen: 1, flach: 0.9 },
      ],
      3,
    ),
  ],
});

export default qualle.sprite;
