/**
 * Die zwölf Frisuren als Kopf-Layer der Spielfigur (M7-54; docs/SPIEL.md §26 „Frisuren“, §29 `frisur_<name>` (12)).
 *
 * **Kopfposen.** Jede Frisur wird über allen Posen der Figur gezeichnet (`spielerBilderFuer` mit dem Kopfstil der Frisur, in
 * jeder Körperform) und je Körper-Frame als Haar-Layer ausgeschnitten (Haarzeichen und die angrenzende Kontur; was Arme,
 * Hände oder Werkzeug decken, fehlt im Layer wie im Bild). Die Bilder liegen relativ zum Kopfsockel (`kopf`) in einer Zelle
 * um ihn. Eine **Kopfpose** ist, was an einem Körper-Frame aller Frisuren zusammen zu sehen ist: Körper-Frames mit denselben
 * Haarbildern in jeder Frisur und jeder Körperform teilen sich eine Kopfpose. Alle Frisur-Sprites haben dieselben Frames in
 * derselben Reihenfolge – Frame i ist Kopfpose i –, gleiche Bilder teilt der Atlas.
 *
 * **Zuordnung.** Das Sprite `frisur_kopfposen` trägt keine Bilder (Zellen 1 × 1 mit einem Konturpixel), nur je Körperform die
 * Zuordnung Körper-Frame → Kopfpose in Clips zu je `KOPFPOSEN_JE_CLIP` Frames (`<form>_<n>`: Körper-Frames
 * n · KOPFPOSEN_JE_CLIP …). Der Renderer liest sie einmal (`src/render/game/playerFigure.ts`) und zeichnet die Frisur am
 * Kopfsockel des gezeigten Körper-Frames über Körper und Kleidung, unter dem Helm.
 *
 * **Sprites:** `frisur_<id>` (12; `scheitel` ist die Frisur bis M6); `frisur_<id>_helm` für die Frisuren mit `unterHelm:
 * 'maske'` und `scheitel` (unter einer Kopfbedeckung zeigen `verdeckt`-Frisuren `frisur_scheitel_helm`); `frisur_<id>_ansicht`
 * (12): die angezogene Figur (`mittel`) mit der Frisur in den vier Richtungen – Auswahlbild der Charaktererstellung und
 * Kontaktbogen `frisuren.png`. Haarfarbe: Rampe `holz` (Palettenzeilen `haar_*`, assets-src/paletteRows.ts).
 */
import { LEER, RICHTUNGEN, bildPixel, type Bild, type FigurLegende, type Richtung, type Teil } from '../../lib/figure';
import { resolveColor, spriteFromPixels, type Sprite } from '../../lib/sprite';
import { spielerBilderFuer, spielerRohbilder } from '../figuren/_spieler_bilder';
import { LEGENDE_ANGEZOGEN } from '../figuren/_spieler_farben';
import { KOERPERFORMEN, type KoerperForm } from '../figuren/_spieler_formen';
import type { KopfStil } from '../figuren/_spieler_rig';
import { SPIELER_META } from '../figuren/_spieler_sprite';
import type { KopfVariante } from '../figuren/_spieler_teile';
import { HAAR_ZEICHEN, frisierterKopfAn, helmZeichnung, kopfZeichnung, zeichnungenVon, zeichnungsRand, type FrisurZeichnungen } from './_frisuren';
import { FRISUR_ZEICHNUNGEN, SCHEITEL } from './_zeichnungen';

/** Die zwölf Frisuren in der Reihenfolge der Charaktererstellung (`scheitel` = die Frisur bis M6). */
export const FRISUREN: readonly string[] = [SCHEITEL, ...FRISUR_ZEICHNUNGEN.map((f) => f.id)];
/** Körper-Frames je Zuordnungs-Clip von `frisur_kopfposen` (Clips bleiben im Kontaktbogen lesbar). */
export const KOPFPOSEN_JE_CLIP = 100;
/** Sprite der Zuordnung Körper-Frame → Kopfpose. */
export const KOPFPOSEN_SPRITE = 'frisur_kopfposen';
/** Kontur der Figur (Umriss der Haare im zusammengesetzten Bild). */
const KONTUR = 'k';

/** Das Pixel der Zuordnungstabelle (eine Zelle braucht ein deckendes Pixel; gezeichnet wird sie nie). */
const TABELLEN_PIXEL = farbIndex('nacht.1');

function farbIndex(ref: string): number {
  const r = resolveColor(ref);
  if ('error' in r) throw new Error(`Frisuren: ${r.error}`);
  return r.index;
}

/** Haarfarben des Layers: `holz` (Haarzeilen `haar_*`), Kontur `nacht.1`. */
const LEGENDE_HAAR: FigurLegende = { '0': 'holz.0', '1': 'holz.1', '2': 'holz.2', '3': 'holz.3', '4': 'holz.4', k: 'nacht.1' };
/** Die angezogene Figur mit Frisur (Ansicht): wie `spieler_koerper`, dazu die Haartöne `0` und `4`. */
const LEGENDE_ANSICHT: FigurLegende = { ...LEGENDE_ANGEZOGEN, '0': 'holz.0', '4': 'holz.4' };

/** Sprite-Id des Haar-Layers einer Frisur (`helm`: unter einer Kopfbedeckung). */
export function frisurSpriteId(id: string, helm = false): string {
  return helm ? `frisur_${id}_helm` : `frisur_${id}`;
}

/** Sprite-Id des Auswahlbilds einer Frisur. */
export function frisurAnsichtId(id: string): string {
  return `frisur_${id}_ansicht`;
}

/** Ob eine Frisur unter einer Kopfbedeckung eigene Maskenframes hat (sonst zeigt sie `frisur_scheitel_helm`). */
export function hatHelmMaske(id: string): boolean {
  return id === SCHEITEL || FRISUR_ZEICHNUNGEN.some((f) => f.id === id && f.unterHelm === 'maske');
}

/** Zeichnungen einer Frisur je Richtung. */
export function frisurZeichnungen(id: string): FrisurZeichnungen {
  if (id === SCHEITEL) return { down: kopfZeichnung('down'), up: kopfZeichnung('up'), right: kopfZeichnung('right'), left: kopfZeichnung('left') };
  const def = FRISUR_ZEICHNUNGEN.find((f) => f.id === id);
  if (def === undefined) throw new Error(`Frisur ${id} unbekannt`);
  return zeichnungenVon(def);
}

/** Maskenzeichnungen unter einer Kopfbedeckung. */
function helmZeichnungen(zs: FrisurZeichnungen): FrisurZeichnungen {
  return { down: helmZeichnung(zs.down, 'down'), up: helmZeichnung(zs.up, 'up'), right: helmZeichnung(zs.right, 'right'), left: helmZeichnung(zs.left, 'left') };
}

/** Ein Haar-Layer: Sprite-Id und Zeichnungen. */
interface Variante {
  readonly sprite: string;
  readonly zs: FrisurZeichnungen;
}

function varianten(): Variante[] {
  const out: Variante[] = [];
  for (const id of FRISUREN) {
    const zs = frisurZeichnungen(id);
    out.push({ sprite: frisurSpriteId(id), zs });
    if (hatHelmMaske(id)) out.push({ sprite: frisurSpriteId(id, true), zs: helmZeichnungen(zs) });
  }
  return out;
}

/** Haarpixel eines Frames relativ zum Kopfsockel: [dx, dy, Palettenindex] … */
type Haarbild = readonly number[];

function haarbild(b: Bild, i: number, sprite: string): Haarbild {
  const sockel = b.sockel.kopf;
  if (sockel === undefined) throw new Error(`${sprite}: Körper-Frame ${i} ohne Kopfsockel`);
  const px = bildPixel(b, LEGENDE_HAAR, { zeichen: HAAR_ZEICHEN, kontur: KONTUR }).index;
  const out: number[] = [];
  for (let p = 0; p < px.length; p++) {
    const v = px[p] ?? 0;
    if (v === 0) continue;
    out.push((p % b.w) - sockel[0], Math.floor(p / b.w) - sockel[1], v);
  }
  return out;
}

/** Zeichen der Sonde: ein eigenes Zeichen je Kopfpixel (außerhalb der Zeichen der Figur, eine UTF-16-Einheit). */
const SONDE_ERSTES = 0x4e00;
const SONDE_LETZTES = 0xd7ff;

/** Ein gezeichneter Kopf, wie ihn die Figur in einem Frame trägt. */
interface SondenKopf {
  readonly kopf: Teil;
  readonly richtung: Richtung;
  readonly variante: KopfVariante;
}

/**
 * Die Sonde: ein Kopfstil, der statt des Kopfes ein Rechteck über alle Frisuren (`rand`, Kopfkoordinaten) setzt, jedes Pixel
 * mit eigenem Zeichen. Zusammengesetzt (ohne Bereinigung, `spielerRohbilder`) zeigt jedes Bild, welches Kopfpixel welches
 * Kopfes an welcher Stelle zu sehen ist – was Arme, Hände und Last davor decken, fehlt; gedreht wird nach dem Umriss des
 * Körpers (`bildDerPoseBezug`), also wie mit jeder Frisur. Eine Frisur ist in jedem Frame der Körper mit ihrem frisierten
 * Kopf an diesen Stellen (`frisurBilder`): eine Zusammensetzung je Körperform statt je Frisur.
 */
function sonde(rand: readonly [number, number, number, number]): { readonly stil: KopfStil; readonly koepfe: readonly SondenKopf[]; readonly pixel: readonly (readonly [number, number, number])[] } {
  const [x0, y0, x1, y1] = rand;
  const koepfe: SondenKopf[] = [];
  const pixel: [number, number, number][] = [];
  const cache = new Map<Teil, Map<string, Teil>>();
  const stil: KopfStil = (t, richtung, variante) => {
    let je = cache.get(t);
    if (je === undefined) {
      je = new Map();
      cache.set(t, je);
    }
    const key = `${richtung}|${variante}`;
    const bekannt = je.get(key);
    if (bekannt !== undefined) return bekannt;
    const k = koepfe.length;
    koepfe.push({ kopf: t, richtung, variante });
    const zeilen: string[] = [];
    for (let y = y0; y <= y1; y++) {
      let z = '';
      for (let x = x0; x <= x1; x++) {
        const code = SONDE_ERSTES + pixel.length;
        if (code > SONDE_LETZTES) throw new Error('Frisuren: Sonde hat mehr Kopfpixel als Zeichen');
        pixel.push([k, x, y]);
        z += String.fromCharCode(code);
      }
      zeilen.push(z);
    }
    const punkte: Record<string, readonly [number, number]> = {};
    for (const [name, [px, py]] of Object.entries(t.punkte)) punkte[name] = [px - x0, py - y0];
    const out: Teil = { zeilen, w: x1 - x0 + 1, h: y1 - y0 + 1, pivot: [t.pivot[0] - x0, t.pivot[1] - y0], punkte };
    je.set(key, out);
    return out;
  };
  return { stil, koepfe, pixel };
}

/** Rand aller Frisuren und Helm-Masken in Kopfkoordinaten. */
function sondenRand(vs: readonly Variante[]): [number, number, number, number] {
  const r: [number, number, number, number] = [0, 0, 0, 0];
  for (const v of vs) {
    for (const z of [v.zs.down, v.zs.up, v.zs.right, v.zs.left]) {
      const [x0, y0, x1, y1] = zeichnungsRand(z);
      r[0] = Math.min(r[0], x0);
      r[1] = Math.min(r[1], y0);
      r[2] = Math.max(r[2], x1);
      r[3] = Math.max(r[3], y1);
    }
  }
  return r;
}

/**
 * Die Bilder der Figur in Körperform `form` mit jeder Variante (`varianten`), Frame für Frame wie `spielerBilderFuer`:
 * der bereinigte Körper, wo die Sonde einen Kopf zeigt, der frisierte Kopf der Variante (wo er leer ist, bleibt, was dahinter
 * liegt). `je(vi, i, bild)` bekommt jedes Bild einmal (es wird danach überschrieben).
 */
function frisurBilder(form: KoerperForm, vs: readonly Variante[], nur: readonly number[] | null, je: (vi: number, i: number, bild: Bild) => void): void {
  const s = sonde(sondenRand(vs));
  const roh = spielerRohbilder({ form, kopf: s.stil });
  const koerper = spielerBilderFuer({ form }).bilder;
  const frames = nur ?? koerper.map((_, i) => i);
  // Je Frame die sichtbaren Kopfpixel: [Bildpixel, Sondenpixel] …
  const sichtbar = frames.map((i) => {
    const r = roh[i];
    if (r === undefined) throw new Error(`Frisuren: Rohbild ${i} fehlt`);
    const out: number[] = [];
    r.pixel.forEach((c, p) => {
      const code = c.charCodeAt(0) - SONDE_ERSTES;
      if (code >= 0 && code < s.pixel.length) out.push(p, code);
    });
    return out;
  });
  vs.forEach((v, vi) => {
    const an = s.koepfe.map((k) => frisierterKopfAn(v.zs, k.kopf, k.richtung, k.variante));
    frames.forEach((i, fi) => {
      const b = koerper[i];
      const sp = sichtbar[fi];
      if (b === undefined || sp === undefined) throw new Error(`Frisuren: Körper-Frame ${i} fehlt`);
      const pixel = [...b.pixel];
      for (let k = 0; k < sp.length; k += 2) {
        const [kopf, x, y] = s.pixel[sp[k + 1] ?? 0] ?? [0, 0, 0];
        const c = an[kopf]?.(x, y) ?? LEER;
        if (c !== LEER) pixel[sp[k] ?? 0] = c;
      }
      je(vi, i, { ...b, pixel });
    });
  });
}

/** Haar-Layer je Variante und Kopfpose, die Zuordnung je Form (eine Rechnung für alle Sprites dieses Moduls). */
interface Kopfposen {
  readonly varianten: readonly Variante[];
  /** Je Variante die Haarbilder der Kopfposen. */
  readonly bilder: readonly (readonly Haarbild[])[];
  /** Je Körperform: Körper-Frame → Kopfpose. */
  readonly zuordnung: Readonly<Record<KoerperForm, readonly number[]>>;
}

function kopfposen(): Kopfposen {
  const vs = varianten();
  const posen = new Map<string, number>();
  const bilder: Haarbild[][] = vs.map(() => []);
  const zuordnung = {} as Record<KoerperForm, number[]>;
  for (const form of KOERPERFORMEN) {
    const jeVariante: Haarbild[][] = vs.map(() => []);
    frisurBilder(form, vs, null, (vi, i, b) => {
      const liste = jeVariante[vi];
      if (liste !== undefined) liste[i] = haarbild(b, i, vs[vi]?.sprite ?? '');
    });
    const n = jeVariante[0]?.length ?? 0;
    const z: number[] = [];
    for (let i = 0; i < n; i++) {
      const key = jeVariante.map((hb) => (hb[i] ?? []).join(',')).join('|');
      let pose = posen.get(key);
      if (pose === undefined) {
        pose = posen.size;
        posen.set(key, pose);
        jeVariante.forEach((hb, vi) => bilder[vi]?.push(hb[i] ?? []));
      }
      z.push(pose);
    }
    zuordnung[form] = z;
  }
  return { varianten: vs, bilder, zuordnung };
}

/** Haar-Layer einer Variante: Zelle um den Kopfsockel (Rand aller Kopfposen), Halte-Clips je Richtung (Idle, `mittel`). */
function haarSprite(v: Variante, bilder: readonly Haarbild[], idle: Readonly<Record<string, number>>): Sprite {
  let x0 = 0;
  let y0 = 0;
  let x1 = 0;
  let y1 = 0;
  for (const hb of bilder) {
    for (let k = 0; k < hb.length; k += 3) {
      const dx = hb[k] ?? 0;
      const dy = hb[k + 1] ?? 0;
      x0 = Math.min(x0, dx);
      y0 = Math.min(y0, dy);
      x1 = Math.max(x1, dx);
      y1 = Math.max(y1, dy);
    }
  }
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const frames = bilder.map((hb) => {
    const index = new Uint8Array(w * h);
    for (let k = 0; k < hb.length; k += 3) index[((hb[k + 1] ?? 0) - y0) * w + ((hb[k] ?? 0) - x0)] = hb[k + 2] ?? 0;
    return { index };
  });
  const clips = Object.fromEntries(RICHTUNGEN.map((r) => [r, { frames: [idle[r] ?? 0], fps: 8, loop: true }]));
  return spriteFromPixels(
    {
      id: v.sprite,
      group: 'frisuren',
      size: [w, h],
      anchor: [-x0, -y0],
      hoehe: 'kugel',
      clips,
      occluder: { kind: 'none' },
      spiegelbar: false,
      einzelpixel: 'Layer-Auszug aus dem Kopf: einzeln stehende Haar- und Konturpixel setzen Flächen des Kopfes fort, ein Arm oder eine Hand davor teilt Strähnen (geprüft in tests/unit/assets/frisuren.test.ts)',
    },
    frames,
  );
}

/** Die Zuordnung Körper-Frame → Kopfpose je Form (ohne Bilder: Zellen 1 × 1, durchsichtig). */
function zuordnungsSprite(posen: number, zuordnung: Readonly<Record<KoerperForm, readonly number[]>>): Sprite {
  const clips: Record<string, { frames: number[]; fps: number; loop: boolean }> = {};
  for (const form of KOERPERFORMEN) {
    const z = zuordnung[form];
    for (let n = 0; n * KOPFPOSEN_JE_CLIP < z.length; n++) clips[`${form}_${n}`] = { frames: z.slice(n * KOPFPOSEN_JE_CLIP, (n + 1) * KOPFPOSEN_JE_CLIP), fps: 1, loop: false };
  }
  return spriteFromPixels(
    {
      id: KOPFPOSEN_SPRITE,
      group: 'frisuren',
      size: [1, 1],
      anchor: [0, 0],
      hoehe: 'flach',
      clips,
      occluder: { kind: 'none' },
      schatten: 'none',
      spiegelbar: false,
      einzelpixel: 'Zuordnungstabelle ohne Bild: jede Zelle ein einzelnes Konturpixel, nie gezeichnet (der Renderer liest nur die Clips)',
    },
    Array.from({ length: posen }, () => ({ index: Uint8Array.of(TABELLEN_PIXEL) })),
  );
}

/** Die Auswahlbilder der Frisuren: die angezogene Figur (`mittel`, Idle) in den vier Richtungen. */
function ansichtSprites(): Sprite[] {
  const { clips } = spielerBilderFuer({ form: 'mittel' });
  const idle = RICHTUNGEN.map((r) => {
    const f = clips[`idle_${r}`]?.frames[0];
    if (f === undefined) throw new Error(`Frisuren: Idle ${r} fehlt`);
    return f;
  });
  const vs = FRISUREN.map((id) => ({ sprite: frisurAnsichtId(id), zs: frisurZeichnungen(id) }));
  const frames: { index: Uint8Array }[][] = vs.map(() => []);
  frisurBilder('mittel', vs, idle, (vi, _i, b) => frames[vi]?.push(bildPixel(b, LEGENDE_ANSICHT)));
  return vs.map((v, vi) =>
    spriteFromPixels(
      {
        ...SPIELER_META,
        id: v.sprite,
        group: 'frisuren',
        clips: { ansicht: { frames: [0, 1, 2, 3], fps: 2, loop: true } },
        einzelpixel: 'Zusammengesetzte Figur: Zopfspitzen und Haarsträhnen enden in einem Pixel über Arm und Rumpf (wie im Spiel)',
        ausnahmeFarben: 'Auswahlbild der Charaktererstellung: die angezogene Figur mit den zwei Haartönen der Frisuren (Licht holz.4, Tiefe holz.0) – im Spiel liegen sie im eigenen Haar-Layer (≤ 12 Farben)',
      },
      frames[vi] ?? [],
    ),
  );
}

/** Alle Frisur-Sprites: Haar-Layer (mit Helm-Masken), die Zuordnung der Kopfposen und die Auswahlbilder. */
export function frisurSprites(): Sprite[] {
  const k = kopfposen();
  const { clips } = spielerBilderFuer({ form: 'mittel' });
  const idle: Record<string, number> = {};
  for (const r of RICHTUNGEN) {
    const f = clips[`idle_${r}`]?.frames[0];
    if (f === undefined) throw new Error(`Frisuren: Idle ${r} fehlt`);
    idle[r] = k.zuordnung.mittel[f] ?? 0;
  }
  const posen = k.bilder[0]?.length ?? 0;
  return [...k.varianten.map((v, i) => haarSprite(v, k.bilder[i] ?? [], idle)), zuordnungsSprite(posen, k.zuordnung), ...ansichtSprites()];
}

export default frisurSprites();
