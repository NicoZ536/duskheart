/**
 * Bauplan Buschwesen (M6, docs/ART.md §15): der Dornling – getarnt ein runder Laubbusch in den Farben der
 * Grünhain-Büsche (Blattmassen mit gebuchteten Lichtkappen aus Blattbündeln, Kontur `gras.0`, ein paar
 * rote Beeren als Köder). Enthüllt öffnet sich vorn eine dunkle Höhle mit glühenden Augen, Wurzelbeine
 * heben den Busch an, Dornen stellen sich auf; angreifend schnellt eine Dornenranke vor.
 *
 * Posenwerte: `offen` (0 getarnt … 1 enthüllt), `hub`, `vor` (px), `nick`, `wackeln` (Grad Rollen),
 * `gang` (Phase 0…1 der Wurzelbeine), `schritt` (px Schrittweite, 0 = stehen), `ranke` (0…1
 * ausgestreckt), `rankeHub` (px), `maul` (0…1), `dornen` (0…1: die Dornen sträuben sich über die Silhouette hinaus,
 * bis doppelt so lang – das Ausholen aus jeder Richtung), `lugen` (0…1: die Augen lugen über die Krone – von hinten
 * gesehen, wo die Höhle vorn verdeckt ist; erscheint mit `offen` wie die Augen in der Höhle),
 * `roll`/`liegen` (Tod), `welk` (0…1 Laub verwelkt).
 */
import { Rng } from '../../src/engine/rng';
import type { Bauplan } from './creature';
import type { Werte } from './creatureAnim';
import { type Bau, KOERPER, punktIn, rahmen, type Stempel } from './creatureBau';
import { normiere, plus, type KreaturMaterial, type V3 } from './creatureRender';
import { fern, zeige } from './creatureVierbeiner';

export interface Blattmasse3 {
  readonly f: number;
  readonly s: number;
  readonly u: number;
  readonly r: V3;
}

export interface BuschArt {
  readonly massen: readonly Blattmasse3[];
  readonly buendel: { readonly anzahl: number; readonly radius: number };
  readonly dornen: { readonly anzahl: number; readonly laenge: number };
  readonly beeren: number;
  /** Höhle vorn (Kreaturraum) und Augen darin (relativ zur Höhlenmitte). */
  readonly hoehle: { readonly f: number; readonly u: number; readonly r: V3 };
  /**
   * Augenspalt oben auf der Krone (Kreaturraum: Mitte vorn/oben, Radien), durch den die Augen bei `lugen` über die Krone
   * sehen; die Augen sitzen darin im Abstand `augen.s`.
   */
  readonly spalt?: { readonly f: number; readonly u: number; readonly r: V3 };
  readonly augen: { readonly s: number; readonly u: number; readonly seite: Stempel; readonly vorn: Stempel };
  readonly beine: { readonly f: readonly number[]; readonly spur: number; readonly laenge: number };
  readonly ranke: { readonly laenge: number; readonly u: number };
  readonly seed: number;
  readonly materialien: Readonly<Record<string, KreaturMaterial>>;
  readonly hoeheBezug: number;
}

const w0 = (w: Werte, k: string): number => w[k] ?? 0;

interface Punkt3 {
  readonly masse: number;
  readonly richtung: V3;
}

export function busch(art: BuschArt): Bauplan {
  const rng = new Rng(art.seed);
  // Blattbündel und Dornen auf der oberen Hälfte der Massen (fest je Seed).
  const aufMasse = (anzahl: number, minHoehe: number): Punkt3[] =>
    Array.from({ length: anzahl }, (_, i) => {
      const masse = i % art.massen.length;
      const a = rng.float(0, 2 * Math.PI);
      const h = rng.float(minHoehe, 0.95);
      const r = Math.sqrt(1 - h * h);
      return { masse, richtung: [Math.cos(a) * r, Math.sin(a) * r, h] as V3 };
    });
  const buendel = aufMasse(art.buendel.anzahl, -0.1);
  const dornen = aufMasse(art.dornen.anzahl, -0.35);
  const beeren = aufMasse(art.beeren, 0.1);
  const unterkante = Math.min(...art.massen.map((m) => m.u - m.r[2]));
  return {
    materialien: art.materialien,
    hoeheBezug: art.hoeheBezug,
    kontur: 'gras.0',
    verbreiterung: 1.1,
    haltung: (w: Werte) => ({
      dreh: { roll: w0(w, 'roll') + w0(w, 'wackeln'), nick: w0(w, 'nick') },
      drehpunkt: [0, 0, art.hoeheBezug * 0.4] as V3,
      versatz: [w0(w, 'vor'), 0, w0(w, 'hub') - w0(w, 'liegen') * (art.hoeheBezug * 0.35)] as V3,
      stauch: 1 - 0.3 * w0(w, 'liegen'),
    }),
    baue(bau: Bau, w: Werte, nur: ReadonlySet<string> | null): void {
      const welk = w0(w, 'welk') > 0.5;
      const laubMat = welk ? 'welk' : 'laub';
      bau.teil('laub', laubMat, 'laub');
      bau.teil('buendel', laubMat, 'buendel');
      bau.teil('dorn', 'dorn', 'dorn');
      bau.teil('beere', 'beere', 'laub');
      bau.teil('hoehle', 'hoehle', 'hoehle');
      bau.teil('auge', 'auge', 'hoehle');
      bau.teil('bein', 'rinde', 'bein');
      bau.teil('ranke', 'ranke', 'ranke');
      bau.teil('maul', 'maul', 'hoehle');
      const offen = w0(w, 'offen');
      if (zeige(nur, 'laub')) {
        for (const m of art.massen) bau.ellipsoid('laub', KOERPER, [m.f, m.s, m.u], m.r);
        for (const b of buendel) {
          const m = art.massen[b.masse];
          if (m === undefined) continue;
          const p: V3 = [m.f + b.richtung[0] * m.r[0] * 0.92, m.s + b.richtung[1] * m.r[1] * 0.92, m.u + b.richtung[2] * m.r[2] * 0.92];
          bau.ellipsoid('buendel', KOERPER, p, [art.buendel.radius, art.buendel.radius, art.buendel.radius * 0.8]);
        }
        // Dornen: kurz im Tarnzustand, aufgestellt beim Enthüllen, gesträubt beim Ausholen (`dornen`).
        const lang = art.dornen.laenge * (0.45 + 0.55 * offen) * (1 + w0(w, 'dornen'));
        for (const d of dornen) {
          const m = art.massen[d.masse];
          if (m === undefined) continue;
          const fuss: V3 = [m.f + d.richtung[0] * m.r[0] * 0.95, m.s + d.richtung[1] * m.r[1] * 0.95, m.u + d.richtung[2] * m.r[2] * 0.95];
          bau.linie('dorn', KOERPER, fuss, plus(fuss, [d.richtung[0] * lang, d.richtung[1] * lang, d.richtung[2] * lang]), 1, 0);
        }
        if (!welk)
          for (const b of beeren) {
            const m = art.massen[b.masse];
            if (m === undefined) continue;
            const p: V3 = [m.f + b.richtung[0] * m.r[0], m.s + b.richtung[1] * m.r[1], m.u + b.richtung[2] * m.r[2]];
            bau.punkt('beere', KOERPER, p, normiere(b.richtung), [
              [0, 0, 'beere', 0],
              [1, 0, 'beere', 0],
            ]);
          }
      }
      // Höhle mit Augen und Maul: schiebt sich beim Enthüllen nach vorn an die Oberfläche.
      if (offen > 0.2 && zeige(nur, 'laub')) {
        const h = art.hoehle;
        const vorn = h.f + (offen - 1) * h.r[0] * 1.2;
        const hoehle = rahmen(KOERPER, [vorn, 0, h.u]);
        bau.ellipsoid('hoehle', hoehle, [0, 0, 0], [h.r[0], h.r[1] * (0.6 + 0.4 * offen), h.r[2] * (0.5 + 0.5 * offen)], {}, { tiefenVersatz: -0.4 });
        for (const seite of [-1, 1]) {
          bau.punkt('auge', hoehle, [h.r[0] * 0.9, art.augen.s * seite, art.augen.u], [1, seite * 0.3, 0.2], bau.richtung === 'right' ? art.augen.seite : art.augen.vorn, { nachAussen: true });
        }
        const maul = w0(w, 'maul');
        if (maul > 0.1) bau.ellipsoid('maul', hoehle, [h.r[0] * 0.5, 0, -h.r[2] * 0.55], [h.r[0] * 0.6, h.r[1] * 0.55, 0.5 + maul], {}, { tiefenVersatz: -0.8 });
        // Über die Krone lugende Augen: ein dunkler Spalt oben im Laub, die Augen blicken nach oben hinaus.
        const lugen = w0(w, 'lugen');
        const sp = art.spalt;
        if (lugen > 0 && sp !== undefined) {
          const auf = Math.min(1, lugen * offen);
          const spalt = rahmen(KOERPER, [sp.f, 0, sp.u]);
          bau.ellipsoid('hoehle', spalt, [0, 0, 0], [sp.r[0], sp.r[1] * (0.6 + 0.4 * auf), sp.r[2] * (0.5 + 0.5 * auf)], {}, { tiefenVersatz: -0.4 });
          for (const seite of [-1, 1]) bau.punkt('auge', spalt, [0, art.augen.s * seite, sp.r[2] * 0.6], [0.2, seite * 0.2, 1], art.augen.vorn, { nachAussen: true });
        }
      }
      // Wurzelbeine: kommen beim Enthüllen unter dem Busch hervor.
      if (offen > 0.15 && zeige(nur, 'bein')) {
        const b = art.beine;
        b.f.forEach((f, i) => {
          for (const seite of [-1, 1]) {
            const phase = w0(w, 'gang') + i * 0.5 + (seite > 0 ? 0.5 : 0);
            const schritt = Math.cos(2 * Math.PI * phase) * w0(w, 'schritt');
            const hubBein = Math.max(0, -Math.sin(2 * Math.PI * phase)) * w0(w, 'schritt') * 0.8;
            const oben = punktIn(KOERPER, [f, b.spur * seite * 0.6, unterkante + 1.5]);
            // Eingezogen stehen die Füße unter dem Laub; enthüllt am Boden.
            const fuss: V3 = [f + schritt * offen, b.spur * seite, hubBein + (1 - offen) * (unterkante + 1)];
            const knie: V3 = plus(oben, [0.6 * (i === 0 ? 1 : -1), b.spur * seite * 0.4, -(unterkante + 1.5) * 0.4]);
            const st = fern(bau, seite, i > 0) ? 0 : 1;
            bau.linie('bein', KOERPER, oben, knie, 2, st);
            bau.linie('bein', KOERPER, knie, fuss, 1, st);
          }
        });
      }
      // Dornenranke (Peitsche).
      const ranke = w0(w, 'ranke');
      if (ranke > 0.05 && zeige(nur, 'ranke')) {
        const h = art.hoehle;
        const pts: V3[] = [];
        const glieder = 5;
        for (let k = 0; k <= glieder; k++) {
          const t = k / glieder;
          pts.push([h.f + t * art.ranke.laenge * ranke, Math.sin(t * Math.PI * 1.5) * 1.2, art.ranke.u + w0(w, 'rankeHub') * Math.sin(t * Math.PI) - t * 2 * ranke]);
        }
        bau.zug('ranke', KOERPER, pts, 2, 1);
        for (let k = 1; k < glieder; k++) {
          const p = pts[k] as V3;
          bau.linie('dorn', KOERPER, p, plus(p, [0.3, k % 2 === 0 ? 1.2 : -1.2, 1]), 1, 0);
        }
      }
    },
  };
}
