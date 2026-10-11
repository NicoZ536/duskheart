/**
 * Bauplan der Erbauer-Konstrukte (Gewölbe-Gegner, M7-15, Strang C; docs/ART.md §15): ein gedrungener Steinleib (Rumpf, Kopf,
 * Arme mit großen Fäusten, kurze Säulenbeine) mit Bronzegelenken an Schultern und Hüften, einem Augenschlitz und einem
 * Glutkern in der Brust (emissiv). Der Wurzelhüter ist dasselbe Konstrukt, doppelt so groß und von Wurzeln überwuchert:
 * Wurzelstränge umschlingen Rumpf und Glieder, Moos sitzt auf Schultern und Kopf, der rechte Arm ist ein Wurzelbündel
 * (die Peitsche).
 *
 * Kreaturraum wie überall: `f` vorn, `s` rechts, `u` oben, Ursprung = Mitte der Standfläche. Posenwerte: `hub`, `vor`, `nick`,
 * `wackeln` (Rollen), `gang` (Phase 0…1), `schritt` (px Schrittweite), `armL`/`armR` (0 hängend … 1 über dem Kopf, in der
 * Ebene vorn–oben), `schlag` (0…1: beide Fäuste vor und nieder), `duck` (Stauchung der Antizipation), `peitsche` (0…1: der
 * Wurzelarm schnellt vor), `liegen`/`roll` (Tod), `zerfall` (0…1: die Glieder fallen vom Rumpf).
 */
import { Rng } from '../../../src/engine/rng';
import type { Bauplan } from '../../lib/creature';
import type { Werte } from '../../lib/creatureAnim';
import { type Bau, KOERPER, punktIn, rahmen, type Rahmen } from '../../lib/creatureBau';
import { plus, type KreaturMaterial, type V3 } from '../../lib/creatureRender';
import { fern, zeige } from '../../lib/creatureVierbeiner';

const w0 = (w: Werte, k: string): number => w[k] ?? 0;
const GRAD = Math.PI / 180;

export interface KonstruktArt {
  /** Maßstab: 1,25 für die 32er-Zelle, 2 für den Wurzelhüter in der 64er-Zelle (ab 2 breitere Augen, Kern und Wurzeln). */
  readonly k: number;
  readonly materialien: Readonly<Record<string, KreaturMaterial>>;
  /** Wurzelstränge um Rumpf und Glieder (0: das reine Konstrukt). */
  readonly wurzeln: number;
  /** Moospolster auf Schultern und Kopf. */
  readonly moos: number;
  /** Der rechte Arm ist ein Wurzelbündel (Peitsche) statt einer Steinfaust. */
  readonly wurzelArm: boolean;
  readonly seed: number;
}

/** Ein Arm von der Schulter: Oberarm, Unterarm, Faust entlang einer Richtung in der Ebene vorn–oben. */
function arm(bau: Bau, a: KonstruktArt, schulter: V3, seite: number, heben: number, schlag: number, st: number): V3 {
  const k = a.k;
  // Hängend zeigt der Arm leicht nach vorn unten; gehoben über den Kopf; der Schlag führt ihn vor und nieder.
  const winkel = (14 + 150 * heben - 120 * schlag) * GRAD;
  const d: V3 = [Math.sin(winkel), seite * 0.12, -Math.cos(winkel)];
  const ellbogen = plus(schulter, [d[0] * 2.6 * k, d[1] * 2.6 * k, d[2] * 2.6 * k]);
  const faust = plus(ellbogen, [d[0] * 2.4 * k, d[1] * 2.4 * k, d[2] * 2.4 * k]);
  bau.ellipsoid('arm', KOERPER, plus(schulter, [d[0] * 1.3 * k, d[1] * 1.3 * k, d[2] * 1.3 * k]), [1.3 * k, 1.3 * k, 1.5 * k], {}, st === 0 ? { stufe: 0 } : {});
  bau.ellipsoid('arm', KOERPER, plus(ellbogen, [d[0] * 1.1 * k, d[1] * 1.1 * k, d[2] * 1.1 * k]), [1.2 * k, 1.2 * k, 1.4 * k], {}, st === 0 ? { stufe: 0 } : {});
  // Das Bronzegelenk am Ellbogen trennt Ober- und Unterarm auch dort, wo der Arm vor dem Rumpf hängt (Seitenansicht).
  bau.ellipsoid('gelenk', KOERPER, ellbogen, [0.8 * k, 0.8 * k, 0.8 * k]);
  bau.ellipsoid('faust', KOERPER, faust, [1.7 * k, 1.6 * k, 1.5 * k]);
  return faust;
}

export function konstrukt(a: KonstruktArt): Bauplan {
  const k = a.k;
  const rng = new Rng(a.seed);
  // Höhen [px] im Kreaturraum.
  const HUEFTE = 3.4 * k;
  const RUMPF = 7.4 * k;
  const SCHULTER = 9.6 * k;
  const KOPF = 12.6 * k;
  // Wurzelstränge: Startpunkte auf dem Rumpf (fest je Seed), sie laufen schräg um ihn herum nach unten.
  const straenge = Array.from({ length: a.wurzeln }, () => ({ start: rng.float(0, 2 * Math.PI), dreh: rng.float(0.6, 1.4) * (rng.bool() ? 1 : -1), hoch: rng.float(0.2, 0.9) }));
  const moos = Array.from({ length: a.moos }, () => ({ s: rng.float(-1, 1), f: rng.float(-0.4, 0.8), r: rng.float(0.8, 1.3) }));
  return {
    materialien: a.materialien,
    hoeheBezug: KOPF + 2 * k,
    kontur: 'nacht.1',
    verbreiterung: 1.15,
    haltung: (w: Werte) => ({
      dreh: { roll: w0(w, 'wackeln') + w0(w, 'roll'), nick: w0(w, 'nick') },
      drehpunkt: [0, 0, HUEFTE] as V3,
      versatz: [w0(w, 'vor'), 0, w0(w, 'hub') - w0(w, 'liegen') * RUMPF * 0.55] as V3,
      stauch: 1 - 0.1 * w0(w, 'duck') - 0.35 * w0(w, 'liegen'),
    }),
    baue(bau: Bau, w: Werte, nur: ReadonlySet<string> | null): void {
      bau.teil('rumpf', 'stein', 'rumpf');
      bau.teil('kopf', 'stein', 'kopf');
      bau.teil('arm', 'stein', 'arm');
      bau.teil('faust', 'stein', 'arm');
      bau.teil('gelenk', 'bronze', 'gelenk');
      bau.teil('bein', 'stein', 'bein');
      bau.teil('auge', 'auge', 'kopf');
      bau.teil('kern', 'kern', 'rumpf');
      bau.teil('rinne', 'rinne', 'rumpf');
      bau.teil('wurzel', 'wurzel', 'wurzel');
      bau.teil('moos', 'moos', 'moos');
      const zerfall = w0(w, 'zerfall');
      // Beine: zwei kurze Säulen; im Gehen schwingen sie vor und zurück.
      if (zeige(nur, 'bein')) {
        for (const seite of [-1, 1]) {
          const phase = w0(w, 'gang') + (seite > 0 ? 0.5 : 0);
          const schritt = Math.cos(2 * Math.PI * phase) * w0(w, 'schritt');
          const heben = Math.max(0, Math.sin(2 * Math.PI * phase)) * w0(w, 'schritt') * 0.5;
          const st = fern(bau, seite, false) ? { stufe: 0 } : {};
          bau.ellipsoid('bein', KOERPER, [schritt * 0.5, seite * 2 * k, HUEFTE * 0.62 + heben * 0.5], [1.5 * k, 1.4 * k, 1.9 * k], {}, st);
          bau.ellipsoid('bein', KOERPER, [schritt, seite * 2.1 * k, 1.1 * k + heben], [1.8 * k, 1.6 * k, 1.2 * k], {}, st);
          bau.ellipsoid('gelenk', KOERPER, [0, seite * 1.9 * k, HUEFTE], [0.9 * k, 0.9 * k, 0.8 * k]);
        }
      }
      if (zeige(nur, 'rumpf')) {
        // Rumpf: ein breiter Block mit Brustplatte; vorn der Glutkern hinter einer Rinne.
        bau.ellipsoid('rumpf', KOERPER, [0, 0, RUMPF], [3.6 * k, 4.4 * k, 4.2 * k]);
        bau.ellipsoid('rumpf', KOERPER, [0.8 * k, 0, RUMPF + 1.2 * k], [3 * k, 4.6 * k, 2.4 * k]);
        const brust = rahmen(KOERPER, [3.5 * k, 0, RUMPF + 0.6 * k]);
        bau.linie('rinne', brust, [0.2, -1.8 * k, 0.8 * k], [0.2, 1.8 * k, 0.8 * k], 1, 0);
        bau.punkt('kern', brust, [0.4, 0, -0.4 * k], [1, 0, 0.3], k >= 2 ? [
          [0, 0, 'kern', 0],
          [1, 0, 'kern', 0],
          [0, 1, 'kern', 0],
          [1, 1, 'kern', 0],
        ] : [[0, 0, 'kern', 0]], { nachAussen: true });
        // Wurzelstränge um den Rumpf (Wurzelhüter).
        for (const s of straenge) {
          const pts: V3[] = [];
          for (let i = 0; i <= 8; i++) {
            const t = i / 8;
            const a2 = s.start + s.dreh * t * Math.PI;
            const u = RUMPF + (s.hoch * 2 - 1) * 3 * k - t * 7 * k;
            const rr = (u > HUEFTE ? 3.6 : 2.4) * k + 0.4 * k;
            pts.push([Math.cos(a2) * rr * 0.85, Math.sin(a2) * rr * 1.2, Math.max(0.3, u)]);
          }
          bau.zug('wurzel', KOERPER, pts, k >= 2 ? 2 : 1, 1);
        }
        for (const m of moos) bau.ellipsoid('moos', KOERPER, [m.f * 2 * k, m.s * 3.6 * k, SCHULTER + 0.8 * k], [m.r * k, m.r * 1.2 * k, 0.6 * k]);
      }
      if (zeige(nur, 'kopf')) {
        const kopf = rahmen(KOERPER, [0.8 * k, 0, KOPF - zerfall * 4 * k], { nick: w0(w, 'kopfNick') });
        bau.ellipsoid('kopf', kopf, [0, 0, 0], [2 * k, 2.3 * k, 1.9 * k]);
        // Der Augenschlitz: ein glimmender Streifen vorn im Kopf.
        bau.punkt(
          'auge',
          kopf,
          [1.9 * k, 0, 0.2 * k],
          // Etwas nach oben geneigt, damit der Schlitz auch von der Seite (Blick quer zur Normale) als Pixel vorn am Kopf glimmt.
          [1, 0, 0.4],
          bau.richtung === 'right'
            ? [[0, 0, 'auge', 0]]
            : k >= 2
              ? [
                  [-2, 0, 'auge', 0],
                  [-1, 0, 'auge', 0],
                  [1, 0, 'auge', 0],
                  [2, 0, 'auge', 0],
                ]
              : [
                  [-1, 0, 'auge', 0],
                  [1, 0, 'auge', 0],
                ],
          { nachAussen: true },
        );
        if (a.moos > 0) bau.ellipsoid('moos', kopf, [-0.4 * k, 0, 1.6 * k], [1.4 * k, 1.8 * k, 0.6 * k]);
      }
      if (zeige(nur, 'arm')) {
        for (const seite of [-1, 1]) {
          const schulter = punktIn(KOERPER, [0.2 * k, seite * (4.6 + zerfall * 2) * k, SCHULTER - zerfall * 5 * k]);
          bau.ellipsoid('gelenk', KOERPER, schulter, [1.2 * k, 1.2 * k, 1.1 * k]);
          const heben = w0(w, seite < 0 ? 'armL' : 'armR');
          if (a.wurzelArm && seite > 0) wurzelPeitsche(bau, a, schulter, w);
          else arm(bau, a, schulter, seite, heben, w0(w, 'schlag'), fern(bau, seite, false) ? 0 : 1);
        }
      }
    },
  };
}

/** Der Wurzelarm: ein Bündel aus Wurzelsträngen, das bei `peitsche` weit nach vorn schnellt. */
function wurzelPeitsche(bau: Bau, a: KonstruktArt, schulter: V3, w: Werte): void {
  const k = a.k;
  const p = w0(w, 'peitsche');
  const heben = w0(w, 'armR');
  const laenge = (5 + 9 * p) * k;
  const r: Rahmen = rahmen(KOERPER, schulter);
  for (const versatz of [-0.9, 0, 0.9]) {
    const pts: V3[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const bogen = Math.sin(t * Math.PI) * (1.5 + 3 * heben) * k;
      pts.push([t * laenge * (0.3 + 0.7 * p + 0.2 * heben), versatz * k + Math.sin(t * 3 + versatz) * 0.6 * k, -t * (4 - 6 * heben) * k * (1 - p * 0.6) + bogen * heben - t * p * 3 * k]);
    }
    bau.zug('wurzel', r, pts, 2, 1);
  }
  bau.ellipsoid('moos', r, [0.4 * k, 0, 0.6 * k], [1.2 * k, 1.2 * k, 0.8 * k]);
}
