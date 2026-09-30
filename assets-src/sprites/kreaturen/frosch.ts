/**
 * Frosch (Grünhain, friedlich; MASTERPROMPT §20.1, docs/ART.md §15): 16×16, grasgrüne Haut mit dunklen
 * Flecken, heller Bauch und Kehlsack, goldene Augenkuppeln. `move` ist ein Sprung (Hocke, Strecken,
 * Flug, Landung); das Idle bläht den Kehlsack. Kein Angriff.
 */
import { kreatur } from '../../lib/creature';
import { idleClip, klip, pose, todClip, trefferClip } from '../../lib/creatureAnim';
import { frosch as froschPlan } from '../../lib/creatureFrosch';

const plan = froschPlan({
  rumpf: { f: 0.3, u: 2.8, r: [3, 2.7, 2], nick: 22 },
  kopf: { f: 2.3, u: 0.9, r: [2.1, 2.6, 1.5] },
  augen: { f: 0.2, s: 1.5, u: 1.3, r: 1.05, seite: [[0, 0, 'pupille', 0]], vorn: [[0, 0, 'pupille', 0]], zu: [[0, 0, 'pupille', 0]] },
  kehle: { f: 2.2, u: -0.9, r: [1.4, 1.6, 0.9] },
  vorderbeine: { f: 1.6, s: 1.6, laenge: 2 },
  hinterbeine: { f: -1.4, s: 2.2, oberschenkel: [2, 0.9, 1.1], laenge: 2.4 },
  hoeheBezug: 5,
  materialien: {
    haut: { stufen: ['gras.1', 'gras.2', 'gras.3', 'gras.4'], schwellen: [0.35, 0.52, 0.78] },
    flecken: { stufen: ['gras.0', 'gras.1'], schwellen: [0.6] },
    bauch: { stufen: ['sand.2', 'sand.3', 'sand.4'], schwellen: [0.4, 0.62] },
    bein: { stufen: ['gras.1', 'gras.2'] },
    pupille: { stufen: ['nacht.1'] },
    auge: { stufen: ['sand.3', 'laub.4'], schwellen: [0.6] },
    maul: { stufen: ['laub.0'] },
  },
  zeichnung: (o) => {
    const [f, s, u] = o.lokal;
    if (o.teil === 'augenkuppel') return 'auge';
    if ((o.teil === 'rumpf' || o.teil === 'kopf') && o.normale[2] < -0.3) return 'bauch';
    if (o.teil === 'rumpf' && Math.abs(Math.sin(f * 4.2) * Math.cos(s * 3.6)) > 0.8 && u > 0.1) return 'flecken';
    if (o.teil === 'schenkel' && Math.sin(f * 5) > 0.55) return 'flecken';
    return null;
  },
});

export const froschKreatur = kreatur({
  id: 'frosch',
  zelle: 16,
  anker: [8, 11],
  hoehe: 'kugel',
  massstab: 0.98,
  plan,
  clips: [
    idleClip({}, { kehle: 0.5 }, { kehle: 1, hub: -0.3 }, { kehle: 0.4 }),
    klip(
      'move',
      10,
      true,
      [pose({ hub: -0.6, nick: -6, sprung: 0 }), pose({ hub: 1, nick: 8, sprung: 0.6, vorder: 0.8, vorderU: 1, vor: 0.3 }), pose({ hub: 1.5, nick: 4, sprung: 0.9, vorder: 1.2, vorderU: 1.6, vor: 0.5 }), pose({ hub: 0.8, nick: -8, sprung: 0.4, vorder: 1, vorderU: 0.8, vor: 0.3 }), pose({ hub: -0.4, nick: -10, sprung: 0 })],
      [0, 1, 2, 3, 4],
      [
        { frame: 1, name: 'absprung' },
        { frame: 4, name: 'landung' },
      ],
    ),
    trefferClip({ augenZu: 1, hub: 0.6, nick: 14, vor: -0.6, maul: 0.6 }, { augenZu: 1, hub: -0.5, nick: -6 }),
    todClip(
      [
        { augenZu: 1, hub: 0.8, nick: 16, maul: 0.7 },
        { augenZu: 1, hub: 0.4, roll: 60, liegen: 0.3, sprung: 0.4 },
        { augenZu: 1, roll: 150, liegen: 0.6, sprung: 0.8 },
        { augenZu: 1, roll: 178, liegen: 0.9, sprung: 1, vorderU: 1 },
        { augenZu: 1, roll: 180, liegen: 1, sprung: 1, vorderU: 1.5 },
      ],
      3,
    ),
  ],
});

export default froschKreatur.sprite;
