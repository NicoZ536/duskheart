/**
 * Geschoss `spucken` des Speiers (M6, docs/ART.md §15): 16×16, ein Klumpen violett glühender Tinte (Kern
 * `verderb.4*`, Hülle `verderb.3*`, dunkler Rand `verderb.1`) mit nachziehendem Tropfen; im Flug nach rechts
 * gezeichnet (der Kampf-Renderer dreht ihn). Clips `flug` (Schleife: Klumpen wabert, Tropfen reißt ab)
 * und `aufprall` (zerplatzt in Spritzer).
 */
import { geschoss } from '../../lib/creature';
import { klip, pose, type Werte } from '../../lib/creatureAnim';
import type { Bau } from '../../lib/creatureBau';
import { KOERPER } from '../../lib/creatureBau';

const w0 = (w: Werte, k: string): number => w[k] ?? 0;

const plan = {
  hoeheBezug: 8,
  kontur: null,
  saum: 'verderb.2',
  verbreiterung: 1,
  materialien: {
    glut: { stufen: ['verderb.1', 'verderb.3*', 'verderb.4*'], schwellen: [0.38, 0.62] },
    tropfen: { stufen: ['verderb.1', 'verderb.3*'], schwellen: [0.5] },
  },
  baue(bau: Bau, w: Werte): void {
    bau.teil('klumpen', 'glut', 'klumpen');
    bau.teil('tropfen', 'tropfen', 'tropfen');
    const platz = w0(w, 'platz');
    const wabern = w0(w, 'wabern');
    const r = 2.6 * (1 - 0.5 * platz);
    if (platz < 0.95) bau.ellipsoid('klumpen', KOERPER, [0, 0, 6 - platz * 4], [r * (1.15 + 0.15 * wabern), r * (1 - 0.1 * wabern), r * (1 - 0.15 * wabern)]);
    // Nachziehende Tropfen im Flug, Spritzer beim Aufprall.
    const t = w0(w, 'tropfen');
    if (platz === 0) {
      bau.ellipsoid('tropfen', KOERPER, [-3.2 - t * 1.6, 0, 6 + 0.4 * t], [1.1 - 0.4 * t, 1, 1 - 0.3 * t]);
      if (t > 0.3) bau.ellipsoid('tropfen', KOERPER, [-5.6 - t, 0, 6.4], [0.7, 0.7, 0.7]);
    } else {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.3;
        const d = 1.5 + platz * 4.5;
        bau.ellipsoid('tropfen', KOERPER, [Math.cos(a) * d, Math.sin(a) * d * 0.6, 2 + Math.sin(a) * 2 * (1 - platz)], [1.1 - platz * 0.4, 1, 0.9]);
      }
    }
  },
};

export default geschoss({
  name: 'spucken',
  zelle: 16,
  anker: [8, 12],
  plan,
  clips: [
    klip('flug', 12, true, [pose({ wabern: 0, tropfen: 0 }), pose({ wabern: 1, tropfen: 0.4 }), pose({ wabern: 0.5, tropfen: 0.8 }), pose({ wabern: -0.6, tropfen: 1 })], [0, 1, 2, 3]),
    klip('aufprall', 12, false, [pose({ platz: 0.3 }), pose({ platz: 0.6 }), pose({ platz: 0.85 }), pose({ platz: 1 })], [0, 1, 2, 3], [{ frame: 0, name: 'aufprall' }]),
  ],
});
