/**
 * Schattenbrut (M6, MASTERPROMPT §12.4, §20.1, docs/ART.md §15): Körper aus Tinten-Rauch – keine harte
 * Kontur, sondern ein violetter Randsaum (`verderb`) auf den oberen Kanten, dunkle Masse in `nacht` mit
 * violettem Schimmer auf den Oberseiten, glühende Augen (`eis.4*` bzw. `verderb.4*`) und aufsteigende
 * Rauchfahnen, die mit der Clip-Phase wandern. Die Materialisierung (Rauschschwelle + violetter Rand)
 * rechnet später der Sprite-Shader; diese Bilder liefern Albedo, Emissiv und Form.
 *
 * Eigene Baupläne: Kriecher (kriecht auf langen Armen, packt und hält fest), Speier (gebückter Leib mit
 * glühendem Kehlsack, spuckt) und Lichtfresser (schwebender Schemen mit Tentakeln und saugendem Schlund).
 * Schleicher und Nachtmahr nutzen den Vierbeiner-Bauplan mit Schattenmaterial und Rauch als `extra`.
 *
 * Gemeinsame Posenwerte: `rauch` (0…1 Phase der Rauchfahnen), `hub`, `vor`, `nick`, `roll`/`liegen`,
 * `zerfall` (0…1: Tod – der Körper sinkt und zerfasert in Rauch).
 */
import { Rng } from '../../src/engine/rng';
import type { Bauplan } from './creature';
import type { Werte } from './creatureAnim';
import { type Bau, KOERPER, punktIn, rahmen, type Rahmen, type Stempel } from './creatureBau';
import { plus, type KreaturMaterial, type V3 } from './creatureRender';
import { fern, zeige } from './creatureVierbeiner';

/** Randsaum der Schattenbrut (statt Kontur). */
export const SCHATTEN_SAUM = 'verderb.2';

/** Materialien der Schattenbrut; `augen` z. B. `eis.4*` oder `verderb.4*`. */
export function schattenMaterialien(augen: string): Record<string, KreaturMaterial> {
  return {
    fell: { stufen: ['nacht.0', 'nacht.1', 'nacht.2', 'verderb.1'], schwellen: [0.32, 0.52, 0.86] },
    bein: { stufen: ['nacht.0', 'nacht.1'] },
    pfote: { stufen: ['nacht.0'] },
    rauch: { stufen: ['nacht.1', 'nacht.2', 'verderb.1'], schwellen: [0.45, 0.8] },
    auge: { stufen: [augen] },
    lid: { stufen: ['verderb.2'] },
    nase: { stufen: ['nacht.0'] },
    rachen: { stufen: ['verderb.2*', 'verderb.3*'], schwellen: [0.5] },
    glut: { stufen: ['verderb.3*', 'verderb.4*'], schwellen: [0.55] },
    horn: { stufen: ['nacht.1', 'nacht.2', 'verderb.2'], schwellen: [0.5, 0.8] },
    ohrInnen: { stufen: ['verderb.1'] },
    kralle: { stufen: ['verderb.2', 'verderb.3'] },
  };
}

/** Eine Quelle von Rauchfahnen: Ort im Rahmen, Streuung, Steighöhe und Dicke. */
export interface RauchQuelle {
  readonly f: number;
  readonly s: number;
  readonly u: number;
  readonly streuung: V3;
  readonly steigen: number;
  readonly dicke: number;
  readonly anzahl: number;
  /** Drift je Steighöhe nach hinten (px). */
  readonly drift?: number;
}

/**
 * Zeichnet Rauchfahnen: je Fahne ein Ellipsoid, das mit der Phase aufsteigt, nach hinten driftet und
 * an beiden Enden seiner Bahn auf null schrumpft (kein Aufploppen beim Umlauf).
 */
export function rauchFahnen(bau: Bau, r: Rahmen, phase: number, q: RauchQuelle, seed: number): void {
  const rng = new Rng(seed);
  for (let i = 0; i < q.anzahl; i++) {
    const basis: V3 = [q.f + rng.float(-1, 1) * q.streuung[0], q.s + rng.float(-1, 1) * q.streuung[1], q.u + rng.float(-1, 1) * q.streuung[2]];
    const versatz = rng.float(0, 1);
    const t = (((phase + versatz) % 1) + 1) % 1;
    const radius = q.dicke * Math.sin(Math.PI * t) * rng.float(0.8, 1.2);
    if (radius < 0.55) continue;
    const ort = plus(basis, [-(q.drift ?? 1) * q.steigen * t, 0, q.steigen * t]);
    bau.ellipsoid('rauch', r, ort, [radius * 1.1, radius, radius * 1.25]);
  }
}

const w0 = (w: Werte, k: string): number => w[k] ?? 0;

// ---------------------------------------------------------------------------------------------
// Kriecher
// ---------------------------------------------------------------------------------------------

export interface KriecherArt {
  readonly rumpf: { readonly f: number; readonly u: number; readonly r: V3 };
  readonly kopf: { readonly f: number; readonly u: number; readonly r: V3 };
  readonly arme: { readonly schulterF: number; readonly schulterS: number; readonly schulterU: number; readonly laenge: number; readonly reichweite: number };
  readonly augen: { readonly f: number; readonly s: number; readonly u: number; readonly seite: Stempel; readonly vorn: Stempel };
  readonly augenMaterial: string;
  readonly hoeheBezug: number;
}

/**
 * Kriecher: flacher Rumpf, der hinten in Rauch zerfasert, gesenkter Kopf mit glühenden Augen, zwei lange
 * Arme mit Krallen. Posenwerte zusätzlich: `lF`/`rF` (px Hand vor), `lU`/`rU` (px Hand gehoben),
 * `arme` (Grad Arme erhoben), `greifen` (0…1 Hände schließen zur Mitte), `maul` (0…1).
 */
export function kriecher(art: KriecherArt): Bauplan {
  return {
    materialien: schattenMaterialien(art.augenMaterial),
    hoeheBezug: art.hoeheBezug,
    kontur: null,
    saum: SCHATTEN_SAUM,
    haltung: (w: Werte) => ({ dreh: { roll: w0(w, 'roll') }, drehpunkt: [0, 0, art.rumpf.u] as V3, versatz: [0, 0, -w0(w, 'liegen') * (art.rumpf.u - art.rumpf.r[1])] as V3, stauch: 1 - 0.4 * w0(w, 'zerfall') }),
    baue(bau: Bau, w: Werte, nur: ReadonlySet<string> | null): void {
      bau.teil('rumpf', 'fell', 'koerper');
      bau.teil('kopf', 'fell', 'kopf');
      bau.teil('auge', 'auge', 'kopf');
      bau.teil('rachen', 'rachen', 'kopf');
      bau.teil('arm', 'bein', 'arm');
      bau.teil('kralle', 'kralle', 'arm');
      bau.teil('rauch', 'rauch', 'rauch');
      const koerper = rahmen(KOERPER, [art.rumpf.f + w0(w, 'vor'), 0, art.rumpf.u + w0(w, 'hub')], { nick: w0(w, 'nick') });
      const zerfall = w0(w, 'zerfall');
      if (zeige(nur, 'rumpf')) {
        bau.ellipsoid('rumpf', koerper, [0, 0, 0], [art.rumpf.r[0] * (1 - 0.3 * zerfall), art.rumpf.r[1], art.rumpf.r[2]], { nick: -8 });
        bau.ellipsoid('rumpf', koerper, [-art.rumpf.r[0] * 0.8, 0, -art.rumpf.r[2] * 0.3], [art.rumpf.r[0] * 0.55, art.rumpf.r[1] * 0.7, art.rumpf.r[2] * 0.6], { nick: -15 });
        rauchFahnen(bau, koerper, w0(w, 'rauch'), { f: -art.rumpf.r[0] * 0.9, s: 0, u: 0.5, streuung: [2, art.rumpf.r[1] * 0.6, 1], steigen: 6 + 4 * zerfall, dicke: 1.4 + zerfall, anzahl: 5 + Math.round(zerfall * 4), drift: 1.2 - 0.6 * zerfall }, 811);
      }
      const kopf = rahmen(koerper, [art.kopf.f - art.rumpf.f, 0, art.kopf.u - art.rumpf.u], { nick: w0(w, 'kopfNick') });
      if (zeige(nur, 'kopf')) {
        bau.ellipsoid('kopf', kopf, [0, 0, 0], art.kopf.r);
        const maul = w0(w, 'maul');
        if (maul > 0.1) bau.ellipsoid('rachen', kopf, [art.kopf.r[0] * 0.55, 0, -art.kopf.r[2] * 0.35], [art.kopf.r[0] * 0.5, art.kopf.r[1] * 0.6, 0.4 + 0.9 * maul], {}, { tiefenVersatz: -0.3 });
        for (const seite of [-1, 1]) {
          bau.punkt('auge', kopf, [art.augen.f, art.augen.s * seite, art.augen.u], [1, seite * 0.5, 0.3], bau.richtung === 'right' ? art.augen.seite : art.augen.vorn, { nachAussen: true });
        }
      }
      if (zeige(nur, 'arm')) {
        const a = art.arme;
        const greifen = w0(w, 'greifen');
        for (const seite of [-1, 1]) {
          const k = seite > 0 ? 'r' : 'l';
          const schulter = punktIn(koerper, [a.schulterF - art.rumpf.f, a.schulterS * seite, a.schulterU - art.rumpf.u]);
          const erhoben = w0(w, 'arme');
          const hand: V3 = [
            art.rumpf.f + a.reichweite + w0(w, `${k}F`) + w0(w, 'vor') + erhoben * 0.02,
            a.schulterS * seite * (1.25 - greifen * 0.9),
            w0(w, `${k}U`) + erhoben * 0.12,
          ];
          const ellbogen: V3 = plus([(schulter[0] + hand[0]) / 2, (schulter[1] + hand[1]) / 2 + seite * 1.6, (schulter[2] + hand[2]) / 2], [0, 0, a.laenge * 0.3 + erhoben * 0.05]);
          const st = fern(bau, seite, false) ? 0 : 1;
          bau.linie('arm', KOERPER, schulter, ellbogen, 2, st);
          bau.linie('arm', KOERPER, ellbogen, hand, 2, st);
          for (const d of [-0.8, 0, 0.8]) bau.linie('kralle', KOERPER, hand, plus(hand, [1.6, d * seite + greifen * -seite * 0.6, -0.4]), 1, 1);
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Speier
// ---------------------------------------------------------------------------------------------

export interface SpeierArt {
  readonly leib: { readonly f: number; readonly u: number; readonly r: V3 };
  readonly brust: { readonly f: number; readonly u: number; readonly r: V3 };
  readonly kopf: { readonly f: number; readonly u: number; readonly r: V3 };
  readonly sack: { readonly f: number; readonly u: number; readonly r: V3 };
  readonly beine: { readonly f: number; readonly spur: number; readonly u: number };
  readonly augen: { readonly f: number; readonly s: number; readonly u: number; readonly seite: Stempel; readonly vorn: Stempel };
  readonly augenMaterial: string;
  readonly hoeheBezug: number;
}

/**
 * Speier: gebückter, birnenförmiger Leib auf zwei kurzen Beinen, vorn ein glühender Kehlsack, darüber der
 * Kopf mit breitem Schlund. Posenwerte zusätzlich: `sack` (0…1 gebläht), `kopfNick` (Grad), `kopfVor`
 * (px), `maul` (0…1), `lF`/`rF`, `lU`/`rU` (Schritte).
 */
export function speier(art: SpeierArt): Bauplan {
  return {
    materialien: schattenMaterialien(art.augenMaterial),
    hoeheBezug: art.hoeheBezug,
    kontur: null,
    saum: SCHATTEN_SAUM,
    haltung: (w: Werte) => ({ dreh: { roll: w0(w, 'roll') }, drehpunkt: [0, 0, art.leib.u] as V3, versatz: [0, 0, -w0(w, 'liegen') * (art.leib.u - art.leib.r[1])] as V3, stauch: 1 - 0.45 * w0(w, 'zerfall') }),
    baue(bau: Bau, w: Werte, nur: ReadonlySet<string> | null): void {
      bau.teil('leib', 'fell', 'koerper');
      bau.teil('sack', 'glut', 'sack');
      bau.teil('kopf', 'fell', 'kopf');
      bau.teil('auge', 'auge', 'kopf');
      bau.teil('rachen', 'rachen', 'kopf');
      bau.teil('bein', 'bein', 'bein');
      bau.teil('rauch', 'rauch', 'rauch');
      const koerper = rahmen(KOERPER, [art.leib.f + w0(w, 'vor'), 0, art.leib.u + w0(w, 'hub')], { nick: w0(w, 'nick') });
      const im = (f: number, u: number): V3 => [f - art.leib.f, 0, u - art.leib.u];
      if (zeige(nur, 'leib')) {
        bau.ellipsoid('leib', koerper, [0, 0, 0], art.leib.r);
        bau.ellipsoid('leib', koerper, im(art.brust.f, art.brust.u), art.brust.r, { nick: 20 });
        const sack = w0(w, 'sack');
        const s = art.sack;
        const k = 1 + 0.4 * sack;
        bau.ellipsoid('sack', koerper, im(s.f + sack * 0.8, s.u - sack * 0.3), [s.r[0] * k, s.r[1] * k, s.r[2] * k]);
        rauchFahnen(bau, koerper, w0(w, 'rauch'), { f: -1, s: 0, u: art.leib.r[2] * 0.6, streuung: [2.5, 2, 1], steigen: 7, dicke: 1.3 + w0(w, 'zerfall'), anzahl: 4 + Math.round(w0(w, 'zerfall') * 4), drift: 0.8 }, 823);
      }
      const kopf = rahmen(koerper, plus(im(art.kopf.f, art.kopf.u), [w0(w, 'kopfVor'), 0, 0]), { nick: w0(w, 'kopfNick') });
      if (zeige(nur, 'kopf')) {
        bau.ellipsoid('kopf', kopf, [0, 0, 0], art.kopf.r);
        const maul = w0(w, 'maul');
        if (maul > 0.1) bau.ellipsoid('rachen', kopf, [art.kopf.r[0] * 0.6, 0, -art.kopf.r[2] * 0.3], [art.kopf.r[0] * 0.55, art.kopf.r[1] * 0.7, 0.5 + 1.2 * maul], {}, { tiefenVersatz: -0.3 });
        for (const seite of [-1, 1]) {
          bau.punkt('auge', kopf, [art.augen.f, art.augen.s * seite, art.augen.u], [1, seite * 0.5, 0.4], bau.richtung === 'right' ? art.augen.seite : art.augen.vorn, { nachAussen: true });
        }
      }
      if (zeige(nur, 'bein')) {
        const b = art.beine;
        for (const seite of [-1, 1]) {
          const k = seite > 0 ? 'r' : 'l';
          const huefte = punktIn(koerper, im(b.f, b.u));
          const fuss: V3 = [b.f + w0(w, `${k}F`) + w0(w, 'vor'), b.spur * seite, w0(w, `${k}U`)];
          const knie: V3 = [(huefte[0] + fuss[0]) / 2 + 1, (huefte[1] + b.spur * seite) / 2 + seite * 0.8, (huefte[2] + fuss[2]) / 2];
          const st = fern(bau, seite, false) ? 0 : 1;
          bau.linie('bein', KOERPER, plus(huefte, [0, seite * b.spur * 0.5, 0]), knie, 3, st);
          bau.linie('bein', KOERPER, knie, fuss, 2, st);
          bau.linie('bein', KOERPER, fuss, plus(fuss, [1.2, 0, 0]), 2, 0);
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Lichtfresser
// ---------------------------------------------------------------------------------------------

export interface LichtfresserArt {
  /** Schwebehöhe der Leibmitte, Leib (Tropfenform aus zwei Ellipsoiden), Kopfhaube. */
  readonly schwebe: number;
  readonly leib: V3;
  readonly haube: { readonly f: number; readonly u: number; readonly r: V3 };
  readonly schlund: { readonly f: number; readonly u: number; readonly r: V3 };
  readonly tentakel: { readonly anzahl: number; readonly laenge: number };
  readonly augen: { readonly f: number; readonly s: number; readonly u: number; readonly seite: Stempel; readonly vorn: Stempel };
  readonly augenMaterial: string;
  readonly hoeheBezug: number;
}

/**
 * Lichtfresser: schwebender Schemen – Haube über einem Schlund, der beim Saugen violett aufglüht und
 * gefangene Lichtfunken (`feuer`) hineinzieht, darunter hängende Tentakel. Posenwerte zusätzlich:
 * `phase` (0…1 Tentakelwelle), `saugen` (0…1 Schlund offen, Tentakel greifen aus), `funken` (0…1
 * Lichtfunken auf dem Weg in den Schlund), `peitsche` (0…1 ein Tentakel schlägt vor).
 */
export function lichtfresser(art: LichtfresserArt): Bauplan {
  const materialien = {
    ...schattenMaterialien(art.augenMaterial),
    funke: { stufen: ['feuer.4*'] },
  };
  return {
    materialien,
    hoeheBezug: art.hoeheBezug,
    kontur: null,
    saum: SCHATTEN_SAUM,
    haltung: (w: Werte) => ({ dreh: { roll: w0(w, 'roll') }, drehpunkt: [0, 0, art.schwebe] as V3, versatz: [0, 0, -w0(w, 'liegen') * (art.schwebe - 2)] as V3, stauch: 1 - 0.5 * w0(w, 'zerfall') }),
    baue(bau: Bau, w: Werte, nur: ReadonlySet<string> | null): void {
      bau.teil('leib', 'fell', 'koerper');
      bau.teil('haube', 'fell', 'haube');
      bau.teil('schlund', 'rachen', 'schlund');
      bau.teil('auge', 'auge', 'haube');
      bau.teil('tentakel', 'bein', 'tentakel');
      bau.teil('funke', 'funke', 'funke');
      bau.teil('rauch', 'rauch', 'rauch');
      const saugen = w0(w, 'saugen');
      const koerper = rahmen(KOERPER, [w0(w, 'vor'), 0, art.schwebe + w0(w, 'hub')], { nick: w0(w, 'nick') });
      if (zeige(nur, 'leib')) {
        const k = 1 + 0.2 * saugen;
        bau.ellipsoid('leib', koerper, [0, 0, 0], [art.leib[0] * k, art.leib[1] * k, art.leib[2]]);
        bau.ellipsoid('leib', koerper, [-0.5, 0, -art.leib[2] * 0.8], [art.leib[0] * 0.7, art.leib[1] * 0.7, art.leib[2] * 0.6]);
        const h = art.haube;
        bau.ellipsoid('haube', koerper, [h.f, 0, h.u], [h.r[0] * k, h.r[1] * k, h.r[2]], { nick: -10 });
        const s = art.schlund;
        const offen = 0.35 + 0.65 * saugen;
        bau.ellipsoid('schlund', koerper, [s.f + saugen * 0.8, 0, s.u], [s.r[0], s.r[1] * offen, s.r[2] * offen], {}, { tiefenVersatz: -0.5 });
        for (const seite of [-1, 1]) {
          bau.punkt('auge', koerper, [art.augen.f, art.augen.s * seite, art.augen.u], [1, seite * 0.4, 0.3], bau.richtung === 'right' ? art.augen.seite : art.augen.vorn, { nachAussen: true });
        }
        rauchFahnen(bau, koerper, w0(w, 'rauch'), { f: -1, s: 0, u: art.leib[2] * 0.4, streuung: [2, 2.5, 1.5], steigen: 8, dicke: 1.3 + w0(w, 'zerfall'), anzahl: 5 + Math.round(w0(w, 'zerfall') * 3), drift: 0.6 }, 839);
        // Gefangene Lichtfunken auf dem Weg in den Schlund.
        const funken = w0(w, 'funken');
        if (funken > 0.05) {
          for (let i = 0; i < 4; i++) {
            const t = (funken + i * 0.25) % 1;
            const a = i * 1.7;
            const weit = (1 - t) * 7;
            const ort: V3 = [s.f + 1 + weit, Math.cos(a) * weit * 0.6, s.u + Math.sin(a) * weit * 0.4];
            bau.punkt('funke', koerper, ort, null, [
              [0, 0, 'funke', 0],
              [1, 0, 'funke', 0],
            ], { obenauf: true });
          }
        }
      }
      if (zeige(nur, 'tentakel')) {
        const n = art.tentakel.anzahl;
        const ph = w0(w, 'phase');
        const zerfallT = w0(w, 'zerfall');
        // Höhe des Leibs über dem Boden: Tentakel reichen nie unter den Boden, sie liegen dort auf.
        const boden = art.schwebe + w0(w, 'hub') - w0(w, 'liegen') * (art.schwebe - 2);
        for (let i = 0; i < n; i++) {
          const a = (2 * Math.PI * (i + 0.5)) / n;
          const peitsche = i === 0 ? w0(w, 'peitsche') : 0;
          const pts: V3[] = [];
          for (let k = 0; k <= 4; k++) {
            const t = k / 4;
            const welle = Math.sin(2 * Math.PI * (ph + t * 0.7 + i * 0.21)) * 1.2 * t;
            const greif = saugen * 3 * t;
            // Beim Zerfall sacken die Tentakel zur Seite weg, statt in den Boden zu reichen.
            const sacken = zerfallT * 3.5 * t;
            pts.push([
              Math.cos(a) * (art.leib[0] * 0.6 + greif + sacken) + welle * 0.5 + peitsche * t * 10,
              Math.sin(a) * (art.leib[1] * 0.6 + greif + sacken) + welle,
              Math.max(-art.leib[2] * 0.9 - t * art.tentakel.laenge * (1 - 0.4 * saugen - 0.6 * peitsche - 0.65 * zerfallT) + peitsche * t * 3, 0.4 - boden),
            ]);
          }
          bau.zug('tentakel', koerper, pts, i === 0 && peitsche > 0 ? 2 : 1, i % 2);
        }
      }
    },
  };
}
