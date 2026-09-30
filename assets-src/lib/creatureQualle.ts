/**
 * Bauplan Qualle (M6, docs/ART.md §15): glockenförmiger Schirm (obere Hälfte eines Ellipsoids) in hellen,
 * kühlen Tönen mit durchscheinender Innenzeichnung (vier Gonadenbögen), emissivem Schirmrand und
 * Nesselfäden, dazu vier gewellte Mundarme. Der Schirm pulsiert (Stoß: flacher und breiter, Erholung:
 * höher und schmaler); die Fäden schwingen phasenversetzt nach.
 *
 * Durchscheinend ist im Palettenatlas nicht möglich (Deckung 0/255): Transluzenz wird gemalt – helle
 * Außenhaut, dunklere Innenzeichnung, die durch den Schirm „scheint“, und ein leuchtender Rand.
 *
 * Posenwerte: `puls` (0…1 zusammengezogen), `hub` (px), `phase` (0…1 Fadenwelle), `nessel` (0…1 Fäden
 * gespreizt und nach vorn gepeitscht), `vor` (px), `roll`/`liegen` (Tod: sackt flach zusammen),
 * `flach` (0…1 zerfließt am Boden).
 */
import type { Bauplan } from './creature';
import type { Werte } from './creatureAnim';
import { type Bau, KOERPER, rahmen } from './creatureBau';
import type { KreaturMaterial, V3, Zeichnung } from './creatureRender';

export interface QuallenArt {
  /** Schirmradius (waagerecht) und -höhe, Schwebehöhe des Schirmrands. */
  readonly schirm: { readonly radius: number; readonly hoehe: number; readonly schwebe: number };
  readonly faeden: { readonly anzahl: number; readonly laenge: number };
  readonly arme: { readonly anzahl: number; readonly laenge: number };
  readonly materialien: Readonly<Record<string, KreaturMaterial>>;
  readonly hoeheBezug: number;
}

const w0 = (w: Werte, k: string): number => w[k] ?? 0;

export function qualle(art: QuallenArt): Bauplan {
  const zeichnung: Zeichnung = (o) => {
    if (o.teil !== 'schirm') return null;
    const [f, s, u] = o.lokal;
    // Rand leuchtet (untere Kante des Schirms).
    if (u < 0.22) return 'rand';
    // Vier Gonadenbögen scheinen durch: Ringe um die Mitte in vier Lappen.
    const winkel = Math.atan2(s, f);
    const r = Math.hypot(f, s);
    const lappen = Math.cos(4 * winkel);
    if (r > 0.25 && r < 0.55 && lappen > 0.35 && u > 0.5) return 'innen';
    return null;
  };
  return {
    materialien: art.materialien,
    hoeheBezug: art.hoeheBezug,
    kontur: 'nacht.1',
    zeichnung,
    verbreiterung: 1,
    haltung: (w: Werte) => ({ dreh: { roll: w0(w, 'roll') }, drehpunkt: [0, 0, art.schirm.schwebe] as V3, versatz: [0, 0, -(art.schirm.schwebe - 1) * w0(w, 'liegen')] as V3, stauch: 1 - 0.55 * w0(w, 'flach') }),
    baue(bau: Bau, w: Werte, nur: ReadonlySet<string> | null): void {
      bau.teil('schirm', 'schirm', 'schirm');
      bau.teil('faden', 'faden', 'faden');
      bau.teil('arm', 'arm', 'arm');
      const puls = w0(w, 'puls');
      const rad = art.schirm.radius * (1 + 0.18 * puls);
      const hoe = art.schirm.hoehe * (1 - 0.3 * puls);
      const rand = art.schirm.schwebe + w0(w, 'hub');
      const mitte = rahmen(KOERPER, [w0(w, 'vor'), 0, rand]);
      if (nur === null || nur.has('schirm')) bau.ellipsoid('schirm', mitte, [0, 0, 0], [rad, rad, hoe], {}, { schnitt: 0 });
      if (nur !== null && !nur.has('faden')) return;
      const ph = w0(w, 'phase');
      const nessel = w0(w, 'nessel');
      // Am Boden (Tod) liegen Fäden und Arme flach ausgebreitet statt in den Boden zu reichen.
      const lieg = w0(w, 'liegen');
      // Höhe des Schirmrands über dem Boden nach dem Absacken (Haltung `liegen`).
      const boden = rand - (art.schirm.schwebe - 1) * lieg;
      // Nesselfäden rings um den Rand; vordere und seitliche sieht man vor dem Schirm.
      const n = art.faeden.anzahl;
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * (i + 0.5)) / n;
        const f0 = Math.cos(a) * rad * 0.82;
        const s0 = Math.sin(a) * rad * 0.82;
        const pts: V3[] = [];
        const glieder = 4;
        for (let k = 0; k <= glieder; k++) {
          const t = k / glieder;
          const welle = Math.sin(2 * Math.PI * (ph + t * 0.8 + i * 0.13)) * 1.1 * t;
          const spreiz = 1 + nessel * 1.2 * t + lieg * 0.5 * t;
          const fall = t * art.faeden.laenge * (1 - 0.35 * nessel - 0.8 * lieg) + 0.3;
          pts.push([f0 * spreiz + welle * Math.cos(a + 1.3) + nessel * 2.4 * t, s0 * spreiz + welle * Math.sin(a + 1.3), rand - (lieg > 0 ? Math.min(fall, Math.max(0.3, boden - 0.3)) : fall)]);
        }
        bau.zug('faden', mitte, pts.map((p) => [p[0] - w0(w, 'vor'), p[1], p[2] - rand] as V3), 1, i % 2);
      }
      // Mundarme: kürzer, breiter, in der Mitte.
      for (let i = 0; i < art.arme.anzahl; i++) {
        const a = (2 * Math.PI * i) / art.arme.anzahl + 0.4;
        const pts: V3[] = [];
        for (let k = 0; k <= 3; k++) {
          const t = k / 3;
          const welle = Math.sin(2 * Math.PI * (ph + 0.3 + t * 0.6 + i * 0.25)) * 0.8 * t;
          pts.push([Math.cos(a) * (0.8 + welle + lieg * 1.2 * t), Math.sin(a) * (0.8 + welle + lieg * 1.2 * t), -0.2 - t * art.arme.laenge * (1 - 0.75 * lieg)]);
        }
        bau.zug('arm', mitte, pts, 2, 1);
      }
    },
  };
}
