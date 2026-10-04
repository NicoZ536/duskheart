/**
 * Bauplan Vierbeiner (M6, docs/ART.md §15): klein (Hase, Eichhörnchen), mittel (Reh, Keiler, Dachs, Wolf),
 * groß (Nachtmahr nutzt ihn mit eigenem Material). Rumpf aus bis zu drei Ellipsoiden (Brust, Mitte, Hüfte),
 * Hals, Kopf mit Schnauze und beweglichem Unterkiefer, Ohren als Flächen, vier Beine als Gelenkketten
 * (Schulter → Ellbogen → Pfote, Hüfte → Sprunggelenk → Pfote; die Pfoten stehen am Boden, die Gelenke
 * folgen per Zwei-Glied-Kinematik), Schwanz als Ellipsoidkette oder Linie. Artmerkmale (Geweih, Hauer,
 * Mähne, Borstenkamm) hängt die Art über `extra` an Kopf- und Körperrahmen.
 *
 * Posenwerte (Versätze gegenüber der Grundhaltung, fehlend = 0):
 * - Körper: `hub`, `vor` (px), `nick` (Grad, Brust hoch +), `seite` (px, Kreaturraum), `stauch` (Anteil,
 *   −0,1 = 10 % niedriger), `roll` (Grad: ganzer Körper kippt auf die Seite – Tod), `liegen` (0…1: senkt
 *   den gekippten Körper auf den Boden).
 * - Kopf: `kopfNick`, `kopfGier` (Grad), `kopfVor`, `kopfHub` (px), `maul` (0…1), `augenZu` (0/1),
 *   `ohren` (Grad nach hinten), `ohrLang` (px längere Ohren – Blickrichtungs-Zuschlag).
 * - Beine `vl`, `vr`, `hl`, `hr` (vorn/hinten, links/rechts): `<bein>F` Pfote nach vorn, `<bein>U` Pfote
 *   angehoben (px); `spreiz` (px): alle Pfoten seitlich weiter auseinander (breiter, gestemmter Stand – von vorn und
 *   hinten die lesbare Ausholphase); `beineSchlaff` (0…1): Pfoten folgen dem Körper statt dem Boden (Sprung, Tod);
 *   `beineAn` (0…1): Läufe angewinkelt, die Pfote rückt zum Gelenk (Liegen).
 * - Schwanz: `schwanz` (Grad hoch +), `wedel` (Grad seitlich).
 */
import type { Bauplan } from './creature';
import { mische, plusW, todClip, trefferClip, type KlipPlan, type Werte } from './creatureAnim';
import { type Bau, KOERPER, punktIn, rahmen, type Rahmen, type Stempel } from './creatureBau';
import { minus, normiere, plus, type KreaturMaterial, type V3, type Zeichnung } from './creatureRender';

export interface Kugel {
  /** Mitte im Kreaturraum (vorn, oben); seitlich immer 0. */
  readonly f: number;
  readonly u: number;
  /** Radien vorn, seitlich, oben. */
  readonly r: V3;
  /** Eigene Neigung (Grad, vorn hoch +). */
  readonly nick?: number;
}

export interface VierbeinerArt {
  readonly rumpf: Kugel;
  readonly brust?: Kugel;
  readonly huefte?: Kugel;
  /** Hals (Kreaturraum); gehört zur Körpergruppe. */
  readonly hals?: Kugel;
  /** Kopf: Mitte, Radien und Gelenk (Drehpunkt am Hals, Kreaturraum). */
  readonly kopf: Kugel & { readonly gelenk: readonly [number, number] };
  /** Schnauze relativ zur Kopfmitte (vorn, oben). */
  readonly schnauze?: Kugel;
  /** Unterkiefer relativ zur Kopfmitte; öffnet mit `maul`. */
  readonly kiefer?: Kugel & { readonly gelenk: readonly [number, number]; readonly oeffnen: number };
  readonly ohren?: {
    readonly form: 'spitz' | 'lang' | 'rund';
    /** Ansatz relativ zur Kopfmitte. */
    readonly f: number;
    readonly s: number;
    readonly u: number;
    readonly laenge: number;
    readonly breite: number;
    /** Neigung nach hinten (Grad). */
    readonly neigung: number;
    /** Spreizung nach außen (Grad). */
    readonly spreizung?: number;
    readonly material?: string;
    /** Material der Ohrmuschel (die nach vorn gewandte Fläche spitzer Ohren). */
    readonly innen?: string;
  };
  readonly augen: {
    /** Ort relativ zur Kopfmitte (vorn, seitlich, oben). */
    readonly f: number;
    readonly s: number;
    readonly u: number;
    /** Stempel im Profil und von vorn (dx nach außen); Material `auge`. */
    readonly seite: Stempel;
    readonly vorn: Stempel;
    /** Geschlossen (Tod, Treffer). */
    readonly zu?: Stempel;
  };
  /** Nasenspitze relativ zur Kopfmitte, Stempel im Profil und von vorn. */
  readonly nase?: { readonly f: number; readonly u: number; readonly seite: Stempel; readonly vorn: Stempel };
  readonly beine: {
    readonly vornF: number;
    readonly hintenF: number;
    /** Seitlicher Abstand der Beine von der Mitte. */
    readonly spur: number;
    /** Höhe der Schulter- und Hüftgelenke (Kreaturraum, Grundhaltung). */
    readonly gelenkU: number;
    /** Pixelbreite oben/unten. */
    readonly dicke: readonly [number, number];
    /** Pfote: Länge nach vorn (px) und Stufe im Material `pfote`. */
    readonly pfote: number;
    /** Knickrichtung der Hinterbeine: −1 Sprunggelenk nach hinten (Hund, Reh), +1 nach vorn. */
    readonly hintenKnick?: 1 | -1;
    /** Oberschenkel als Ellipsoid (Hüfte muskulös, Radien) – sonst nur Linien. */
    readonly keule?: V3;
    readonly schulter?: V3;
    /** Nur Vorderbeine (Robbe: hinten Flossen über `extra`). */
    readonly nurVorn?: boolean;
  };
  readonly schwanz?: {
    readonly form: 'buschig' | 'stummel' | 'duenn' | 'wedel';
    /** Ansatz (Kreaturraum). */
    readonly f: number;
    readonly u: number;
    readonly laenge: number;
    readonly dicke: number;
    /** Grundwinkel (Grad, hoch +, 0 = waagerecht nach hinten). */
    readonly winkel: number;
    /** Krümmung je Glied (Grad). */
    readonly kruemmung?: number;
    readonly material?: string;
  };
  readonly materialien: Readonly<Record<string, KreaturMaterial>>;
  readonly zeichnung?: Zeichnung;
  readonly kontur?: string | null;
  readonly saum?: string;
  readonly hoeheBezug: number;
  /** Verbreiterung von vorn und hinten (Standard `VERBREITERUNG`; kleine Tiere breiter, damit sie lesbar bleiben). */
  readonly verbreiterung?: number;
  /** Artmerkmale an Kopf- und Körperrahmen (Geweih, Hauer, Mähne …). */
  readonly extra?: (bau: Bau, r: { readonly kopf: Rahmen; readonly koerper: Rahmen; readonly w: Werte; readonly nur: ReadonlySet<string> | null }) => void;
}

/** Teile der Körpergruppe (Rumpf, Brust, Hüfte, Hals) – für Zeichnungen wie Bauch oder Sattel. */
const KOERPER_TEILE: ReadonlySet<string> = new Set(['rumpf', 'brust', 'huefte', 'hals']);

/** Ob ein Teil zur Körpergruppe gehört. */
export function koerperTeil(teil: string): boolean {
  return KOERPER_TEILE.has(teil);
}

/** Beine in Zeichenreihenfolge: vorn links/rechts, hinten links/rechts. */
export const BEINE = ['vl', 'vr', 'hl', 'hr'] as const;
export type Bein = (typeof BEINE)[number];

const w0 = (w: Werte, k: string): number => w[k] ?? 0;

/** Kniepunkt zweier gleich langer Glieder zwischen Gelenk `j` und Pfote `p` (Knick in der Vorn-Oben-Ebene). */
export function knie(j: V3, p: V3, laenge: number, knick: number): V3 {
  const d = minus(p, j);
  const dist = Math.hypot(d[0], d[1], d[2]) || 1e-6;
  const halb = laenge / 2;
  const hub = Math.sqrt(Math.max(0, halb * halb - (dist / 2) * (dist / 2)));
  const senk = normiere([-d[2], 0, d[0]]);
  const mitte: V3 = [(j[0] + p[0]) / 2, (j[1] + p[1]) / 2, (j[2] + p[2]) / 2];
  return plus(mitte, [senk[0] * hub * knick, 0, senk[2] * hub * knick]);
}

/** Ob ein Teil gezeichnet wird (Nachzieher im Smear: nur die genannten). */
export function zeige(nur: ReadonlySet<string> | null, teil: string): boolean {
  return nur === null || nur.has(teil);
}

/** Ob die Körperseite `s` (> 0 rechts) in dieser Richtung die ferne Seite ist. */
export function fern(bau: Bau, s: number, hinten: boolean): boolean {
  if (bau.richtung === 'right') return s < 0;
  if (bau.richtung === 'down') return hinten;
  return !hinten;
}

/** Körperrahmen einer Pose: Mitte des Rumpfes, versetzt und geneigt. */
export function koerperRahmen(a: { readonly rumpf: Kugel }, w: Werte): Rahmen {
  return rahmen(KOERPER, [a.rumpf.f + w0(w, 'vor'), w0(w, 'seite'), a.rumpf.u + w0(w, 'hub')], { nick: w0(w, 'nick') });
}

/** Haltung des ganzen Körpers (Kippen beim Tod, Stauchen beim Ausholen). */
export function haltungVon(a: { readonly rumpf: Kugel }, w: Werte): { dreh: { roll: number }; drehpunkt: V3; versatz: V3; stauch: number } {
  const roll = w0(w, 'roll');
  const liegen = w0(w, 'liegen');
  const senken = (a.rumpf.u - a.rumpf.r[1]) * liegen;
  return { dreh: { roll }, drehpunkt: [0, 0, a.rumpf.u], versatz: [0, 0, -senken], stauch: 1 + w0(w, 'stauch') };
}

/** Vierbeiner-Bauplan aus einer Artbeschreibung. */
export function vierbeiner(art: VierbeinerArt): Bauplan {
  const C: V3 = [art.rumpf.f, 0, art.rumpf.u];
  const imKoerper = (f: number, s: number, u: number): V3 => [f - C[0], s, u - C[2]];
  return {
    materialien: art.materialien,
    hoeheBezug: art.hoeheBezug,
    kontur: art.kontur === undefined ? 'nacht.1' : art.kontur,
    ...(art.saum === undefined ? {} : { saum: art.saum }),
    ...(art.zeichnung === undefined ? {} : { zeichnung: art.zeichnung }),
    ...(art.verbreiterung === undefined ? {} : { verbreiterung: art.verbreiterung }),
    haltung: (w: Werte) => haltungVon(art, w),
    baue(bau: Bau, w: Werte, nur: ReadonlySet<string> | null): void {
      bau.teil('rumpf', 'fell', 'koerper');
      bau.teil('brust', 'fell', 'koerper');
      bau.teil('huefte', 'fell', 'koerper');
      bau.teil('hals', 'fell', 'koerper');
      bau.teil('kopf', 'fell', 'kopf');
      bau.teil('schnauze', art.materialien['schnauze'] === undefined ? 'fell' : 'schnauze', 'kopf');
      bau.teil('kiefer', art.materialien['schnauze'] === undefined ? 'fell' : 'schnauze', 'kiefer');
      bau.teil('rachen', art.materialien['rachen'] === undefined ? 'fell' : 'rachen', 'rachen');
      bau.teil('ohr', art.ohren?.material ?? 'fell', 'ohr');
      bau.teil('ohrInnen', art.ohren?.innen ?? art.ohren?.material ?? 'fell', 'ohr');
      bau.teil('bein', art.materialien['bein'] === undefined ? 'fell' : 'bein', 'bein');
      bau.teil('schwanz', art.schwanz?.material ?? 'fell', 'schwanz');
      bau.teil('auge', 'auge', 'kopf');
      bau.teil('keule', 'fell', 'keule');

      const koerper = koerperRahmen(art, w);
      // Rumpf, Brust, Hüfte, Hals.
      if (zeige(nur, 'rumpf')) {
        bau.ellipsoid('rumpf', koerper, [0, 0, 0], art.rumpf.r, { nick: art.rumpf.nick ?? 0 });
        const glieder: readonly (readonly [string, Kugel | undefined])[] = [
          ['brust', art.brust],
          ['huefte', art.huefte],
          ['hals', art.hals],
        ];
        for (const [name, k] of glieder) if (k !== undefined) bau.ellipsoid(name, koerper, imKoerper(k.f, 0, k.u), k.r, { nick: k.nick ?? 0 });
      }

      // Kopf: Drehpunkt am Halsgelenk, folgt dem Körper.
      const [gf, gu] = art.kopf.gelenk;
      const kopfGelenk = rahmen(koerper, imKoerper(gf + w0(w, 'kopfVor'), 0, gu + w0(w, 'kopfHub')), { nick: w0(w, 'kopfNick'), gier: w0(w, 'kopfGier') });
      const kopf = rahmen(kopfGelenk, [art.kopf.f - gf, 0, art.kopf.u - gu]);
      if (zeige(nur, 'kopf')) {
        bau.ellipsoid('kopf', kopf, [0, 0, 0], art.kopf.r, { nick: art.kopf.nick ?? 0 });
        if (art.schnauze !== undefined) bau.ellipsoid('schnauze', kopf, [art.schnauze.f, 0, art.schnauze.u], art.schnauze.r, { nick: art.schnauze.nick ?? 0 });
        if (art.kiefer !== undefined) {
          const k = art.kiefer;
          const gelenk = rahmen(kopf, [k.gelenk[0], 0, k.gelenk[1]], { nick: -k.oeffnen * w0(w, 'maul') });
          bau.ellipsoid('kiefer', gelenk, [k.f - k.gelenk[0], 0, k.u - k.gelenk[1]], k.r, { nick: k.nick ?? 0 });
          if (w0(w, 'maul') > 0.05 && art.schnauze !== undefined) {
            const sn = art.schnauze;
            bau.ellipsoid('rachen', kopf, [sn.f - sn.r[0] * 0.25, 0, sn.u - sn.r[2] * 0.55], [sn.r[0] * 0.8, sn.r[1] * 0.75, sn.r[2] * 0.55], {}, { tiefenVersatz: 0.3 });
          }
        }
        if (art.ohren !== undefined) {
          const o = { ...art.ohren, laenge: art.ohren.laenge + w0(w, 'ohrLang') };
          for (const seite of [-1, 1]) {
            const basis = rahmen(kopf, [o.f, o.s * seite, o.u], { nick: -(o.neigung + w0(w, 'ohren')), roll: (o.spreizung ?? 0) * seite });
            const b = o.breite / 2;
            if (o.form === 'spitz') {
              // Kegel aus zwei gekreuzten Dreiecken: von vorn und im Profil spitz.
              bau.flaeche('ohr', basis, [
                [0, -b, 0],
                [0, b, 0],
                [0, 0, o.laenge],
              ]);
              if (o.innen !== undefined)
                bau.flaeche('ohrInnen', basis, [
                  [0.3, -b * 0.45, o.laenge * 0.1],
                  [0.3, b * 0.45, o.laenge * 0.1],
                  [0.3, 0, o.laenge * 0.65],
                ]);
              bau.flaeche('ohr', basis, [
                [-b * 0.7, 0, 0],
                [b * 0.7, 0, 0],
                [0, 0, o.laenge * 0.96],
              ]);
            } else {
              const lang = o.form === 'lang';
              bau.ellipsoid('ohr', basis, [0, 0, o.laenge / 2], [lang ? b * 0.55 : b * 0.7, b, o.laenge / 2]);
              // Ohrmuschel: eine flache, schmalere Mulde vorn auf dem Ohr.
              if (o.innen !== undefined) bau.ellipsoid('ohrInnen', basis, [b * 0.3, 0, o.laenge * 0.5], [b * 0.3, b * 0.5, o.laenge * 0.36]);
            }
          }
        }
        // Augen und Nase (Merkmale).
        const au = art.augen;
        for (const seite of [-1, 1]) {
          const ort: V3 = [au.f, au.s * seite, au.u];
          const [rf, rs, ru] = art.kopf.r;
          const n = normiere([au.f / (rf * rf), (au.s * seite) / (rs * rs), au.u / (ru * ru)]);
          const zu = w0(w, 'augenZu') > 0.5;
          const st = zu ? (au.zu ?? au.seite) : bau.richtung === 'right' ? au.seite : au.vorn;
          bau.punkt('auge', kopf, ort, n, st, { nachAussen: true });
        }
        if (art.nase !== undefined) {
          const nz = art.nase;
          bau.punkt('schnauze', kopf, [nz.f, 0, nz.u], [1, 0, 0.2], bau.richtung === 'right' ? nz.seite : nz.vorn);
        }
      }

      // Beine: Pfoten am Boden (oder am Körper, wenn schlaff), Gelenke am Körper.
      if (zeige(nur, 'bein')) {
        const b = art.beine;
        const schlaff = w0(w, 'beineSchlaff');
        for (const bein of BEINE) {
          const vorn = bein[0] === 'v';
          if (!vorn && b.nurVorn === true) continue;
          const seite = bein[1] === 'r' ? 1 : -1;
          const jf = vorn ? b.vornF : b.hintenF;
          const gelenk = punktIn(koerper, imKoerper(jf, b.spur * seite, b.gelenkU));
          const boden: V3 = [jf + w0(w, `${bein}F`) + w0(w, 'vor'), (b.spur + w0(w, 'spreiz')) * seite + w0(w, 'seite'), w0(w, `${bein}U`)];
          const amKoerper = punktIn(koerper, imKoerper(jf + w0(w, `${bein}F`), b.spur * seite, w0(w, `${bein}U`)));
          const lose = schlaff > 0 ? mischeV3(boden, amKoerper, schlaff) : boden;
          // `beineAn` zieht die Pfote zum Gelenk (angewinkelte Läufe im Liegen).
          const an = w0(w, 'beineAn');
          const pfote = an > 0 ? mischeV3(lose, punktIn(koerper, imKoerper(jf + b.gelenkU * 0.25 * (vorn ? 1 : -1), b.spur * seite, b.gelenkU * 0.35)), an) : lose;
          const laenge = b.gelenkU * 1.08;
          const k = knie(gelenk, pfote, laenge, vorn ? 1 : (b.hintenKnick ?? -1));
          const dunkel = fern(bau, seite, !vorn);
          const stufe = dunkel ? 0 : 1;
          bau.linie('bein', KOERPER, gelenk, k, b.dicke[0], stufe);
          bau.linie('bein', KOERPER, k, pfote, b.dicke[1], stufe);
          if (b.pfote > 0) bau.linie('bein', KOERPER, pfote, plus(pfote, [b.pfote, 0, 0]), b.dicke[1], 0, { material: art.materialien['pfote'] === undefined ? undefined : 'pfote' });
          const keule = vorn ? b.schulter : b.keule;
          if (keule !== undefined) bau.ellipsoid('keule', koerper, imKoerper(jf, b.spur * seite * 0.9, b.gelenkU + keule[2] * 0.2), keule, { nick: 0 });
        }
      }

      // Schwanz.
      const sw = art.schwanz;
      if (sw !== undefined && zeige(nur, 'schwanz')) {
        const ansatz = rahmen(koerper, imKoerper(sw.f, 0, sw.u), { nick: 180 - sw.winkel - w0(w, 'schwanz'), gier: w0(w, 'wedel') });
        if (sw.form === 'stummel') bau.ellipsoid('schwanz', ansatz, [sw.laenge * 0.4, 0, 0], [sw.laenge * 0.6, sw.dicke, sw.dicke]);
        else if (sw.form === 'duenn') {
          const kr = sw.kruemmung ?? 0;
          const mitte = rahmen(ansatz, [sw.laenge / 2, 0, 0], { nick: -kr });
          bau.linie('schwanz', ansatz, [0, 0, 0], [sw.laenge / 2, 0, 0], sw.dicke, 1);
          bau.linie('schwanz', mitte, [0, 0, 0], [sw.laenge / 2, 0, 0], Math.max(1, sw.dicke - 1), 1);
        } else {
          // Buschig/wedel: drei Glieder, jedes etwas weiter gekrümmt.
          const kr = sw.kruemmung ?? 0;
          let r = ansatz;
          const glied = sw.laenge / 3;
          for (let i = 0; i < 3; i++) {
            const dicke = sw.form === 'buschig' ? sw.dicke * [0.8, 1, 0.8][i]! : sw.dicke * [1, 0.85, 0.65][i]!;
            bau.ellipsoid('schwanz', r, [glied * 0.55, 0, 0], [glied * 0.75, dicke, dicke]);
            r = rahmen(r, [glied, 0, 0], { nick: -kr });
          }
        }
      }

      art.extra?.(bau, { kopf, koerper, w, nur });
    },
  };
}

function mischeV3(a: V3, b: V3, t: number): V3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// ---------------------------------------------------------------------------------------------
// Gangarten und Standard-Clips
// ---------------------------------------------------------------------------------------------

export type Gangart = 'galopp' | 'trab' | 'hoppeln' | 'schleichen' | 'huepfen';

export interface GangParameter {
  readonly art: Gangart;
  /** Schrittweite der Pfoten (± px). */
  readonly schritt: number;
  /** Hub der Pfoten in der Schwungphase (px). */
  readonly anheben: number;
  /** Körperhub (px) und Nicken (Grad). */
  readonly koerperHub: number;
  readonly koerperNick: number;
  /** Kopfnicken gegen den Körper (Nachziehen, Grad). */
  readonly kopfNick?: number;
  /** Schwanzschwingen (Grad). */
  readonly schwanz?: number;
}

/** Phasenversatz je Bein. */
const PHASEN: Readonly<Record<Gangart, Readonly<Record<Bein, number>>>> = {
  galopp: { vl: 0, vr: 0.1, hl: 0.5, hr: 0.6 },
  trab: { vl: 0, hr: 0, vr: 0.5, hl: 0.5 },
  schleichen: { vl: 0, hr: 0.25, vr: 0.5, hl: 0.75 },
  hoppeln: { vl: 0.35, vr: 0.4, hl: 0.85, hr: 0.9 },
  huepfen: { vl: 0, vr: 0, hl: 0, hr: 0 },
};

/** Posenwerte einer Gangphase (0 ≤ phase < 1). */
export function gangPose(g: GangParameter, phase: number): Werte {
  const out: Record<string, number> = {};
  const tau = 2 * Math.PI;
  for (const bein of BEINE) {
    const ph = phase + PHASEN[g.art][bein];
    out[`${bein}F`] = g.schritt * Math.cos(tau * ph);
    out[`${bein}U`] = g.anheben * Math.max(0, -Math.sin(tau * ph));
  }
  if (g.art === 'galopp' || g.art === 'hoppeln' || g.art === 'huepfen') {
    out['hub'] = g.koerperHub * Math.max(0, Math.sin(tau * (phase + 0.15)));
    out['nick'] = g.koerperNick * Math.sin(tau * phase);
    out['kopfNick'] = -(g.kopfNick ?? 0) * Math.sin(tau * phase);
  } else {
    out['hub'] = g.koerperHub * Math.cos(2 * tau * phase);
    out['nick'] = g.koerperNick * Math.sin(tau * phase);
    out['kopfNick'] = (g.kopfNick ?? 0) * Math.cos(2 * tau * phase);
  }
  out['schwanz'] = (g.schwanz ?? 0) * Math.sin(tau * phase);
  return out;
}

/** Mischt Posen und rundet Körperversätze nicht (Rasterung entscheidet pixelgenau). */
export function zwischen(a: Werte, b: Werte, t: number): Werte {
  return mische(a, b, t);
}

/** Standard-Treffer eines Vierbeiners: zurückgeworfen (Kopf hoch, Augen zu, Ohren an), eingesackt. */
export function vierbeinerTreffer(zusatz: Werte = {}): KlipPlan {
  return trefferClip(plusW({ vor: -1.5, hub: 0.5, kopfNick: 18, augenZu: 1, ohren: 35, schwanz: -10 }, zusatz), plusW({ vor: -0.5, hub: -1, kopfNick: -6, augenZu: 1, ohren: 25 }, zusatz));
}

/**
 * Standard-Tod eines Vierbeiners (6 Frames, 8 fps): Treffer, Einknicken, Kippen, Aufschlag auf der Seite,
 * Nachfedern, Liegen; Event `aufprall` auf dem Aufschlag. Der Körper kippt so, dass die Läufe vom
 * Betrachter weg nach oben stehen (das lesbare „tot“), Hals und Kopf sinken dabei nach vorn auf den Boden.
 */
export function vierbeinerTod(zusatz: Werte = {}): KlipPlan {
  const z = (w: Werte): Werte => plusW(w, zusatz);
  return todClip(
    [
      z({ vor: -1.5, hub: 0.5, kopfNick: 18, augenZu: 1, ohren: 35 }),
      z({ hub: -2, stauch: -0.12, kopfNick: -14, augenZu: 1, ohren: 30, vlF: 1, vrF: 1 }),
      z({ roll: 35, liegen: 0.35, beineSchlaff: 0.4, kopfNick: -24, kopfHub: -1, augenZu: 1, ohren: 30 }),
      z({ roll: 84, liegen: 1, beineSchlaff: 1, beineAn: 0.2, kopfNick: -36, kopfHub: -2, augenZu: 1, ohren: 30, maul: 0.3 }),
      z({ roll: 90, liegen: 0.85, beineSchlaff: 1, beineAn: 0.3, kopfNick: -36, kopfHub: -2, augenZu: 1, ohren: 30, maul: 0.3 }),
      z({ roll: 90, liegen: 1, beineSchlaff: 1, beineAn: 0.35, kopfNick: -38, kopfHub: -2, augenZu: 1, ohren: 30, maul: 0.2, schwanz: -8 }),
    ],
    3,
  );
}
