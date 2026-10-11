/**
 * Frisuren der Spielfigur (M7-54; MASTERPROMPT §26 „Charaktererstellung (… 12 Frisuren …)“; docs/SPIEL.md §26 „Frisuren“).
 *
 * **Zeichnung:** Eine Frisur ist je Blickrichtung (`down`, `up`, `right`, `left` – ohne `left` das Spiegelbild von `right`)
 * ein Raster über dem gezeichneten Kopf der Figur (`_spieler_teile.ts`, 16 × 11): `links`/`oben` sagen, wie weit das Raster
 * links neben und über den Kopf reicht. Es zählen nur Haarzeichen (`0`–`4` = `holz.0`–`holz.4`, die Rampe der Haarfarbe,
 * docs/ART.md §2.6) und `K` (Kontur der Haare, `nacht.1`); alle übrigen Zeichen (das abgepauste Gesicht `S`, `m`, die
 * Augen `k`, `.`) lassen den Kopf, wie er ist – so zeigen geschlossene Augen (`zu`) und Schmerz ihr eigenes Gesicht. Haare
 * dürfen über den Kopf hinausreichen (Volumen, Zöpfe, Dutt) und das Gesicht teils decken (Pony).
 *
 * **Jede Kopfpose** (`frisierterKopf`): `auf`, `zu`, `schmerz` tragen die Zeichnung unverändert; `nacken` (von vorn
 * eingerollt) zeigt den Hinterkopf, also die Zeichnung `up`; `hoch` (Kopf in den Nacken, Trinken) verschiebt die Zeichnung
 * wie der gezeichnete Kopf (von vorn fällt die Stirnzeile weg) und lässt im Profil das gehobene Gesicht frei. Jedes Haarpixel
 * des gezeichneten Kopfes ist danach Haar der Frisur (wo die Zeichnung es nicht deckt, setzt sich der nächste Haarton der
 * Spalte darüber fort): der Körper trägt die Haare der Figur bis M6 in `holz` ohne eigene Palettenzeile, der Haar-Layer
 * deckt sie in jedem Frame (tests/unit/assets/frisuren.test.ts).
 *
 * **Unter einem Helm** (`unterHelm`): `verdeckt` – die Frisur verschwindet unter der Kopfbedeckung, es bleibt das kurze Haar
 * der Figur (`frisur_scheitel`, nur in der Kopfform); `maske` – unter der Krempe (`HELM_KREMPE`) zeigt sich, was unter dem
 * Helm hervorfällt (Zöpfe, langes Haar): die Maskenframes `frisur_<id>_helm` behalten die Haare innerhalb des Kopfes und
 * darunter, nicht, was darüber hinausragt (Dutt, Locken oben).
 */
import { LEER, gespiegelt, type Richtung, type Teil } from '../../lib/figure';
import type { KopfStil } from '../figuren/_spieler_rig';
import { KOEPFE, type KopfVariante } from '../figuren/_spieler_teile';

/** Haarzeichen der Frisuren (`holz.0`–`holz.4`); `1`–`3` trägt schon der gezeichnete Kopf. */
export const HAAR_ZEICHEN: ReadonlySet<string> = new Set(['0', '1', '2', '3', '4']);
/** Haarzeichen des gezeichneten Kopfes. */
const KOPF_HAAR: ReadonlySet<string> = new Set(['1', '2', '3']);
/** Kontur der Haare in der Zeichnung (wird `k`). */
export const HAAR_KONTUR = 'K';
/** Hautzeichen des Kopfes. */
const HAUT: ReadonlySet<string> = new Set(['S', 'm']);
/** Kopfmaß (Breite, Höhe) des gezeichneten Kopfes. */
const KOPF_W = 16;
const KOPF_H = 11;
/** Erste Kopfzeile unter der Krempe einer Kopfbedeckung (Kappen decken die Zeilen 0–3, `ruestung_*.ts`). */
export const HELM_KREMPE = 4;

/** Ein Raster der Frisur über dem Kopf. */
export interface FrisurBild {
  /** Spalten links neben dem Kopf. */
  readonly links: number;
  /** Zeilen über dem Kopf. */
  readonly oben: number;
  readonly raster: string;
}

/** Ein Raster oder eine schon gebaute Zeichnung (aus dem Kopf abgeleitet, `kopfZeichnung`, `umgefaerbteZeichnung`). */
export type FrisurQuelle = FrisurBild | Zeichnung;

export interface FrisurDef {
  /** Name (die Sprite-Id ist `frisur_<id>`). */
  readonly id: string;
  readonly unterHelm: 'verdeckt' | 'maske';
  readonly down: FrisurQuelle;
  readonly up: FrisurQuelle;
  readonly right: FrisurQuelle;
  /** Ohne: das Spiegelbild von `right` (symmetrische Frisuren). */
  readonly left?: FrisurQuelle;
}

/** Eine geparste Zeichnung: Zeichen je Kopfkoordinate (x, y; auch negativ und jenseits des Kopfes). */
export interface Zeichnung {
  readonly pixel: ReadonlyMap<number, string>;
}

/** Schlüssel einer Kopfkoordinate. */
function schluessel(x: number, y: number): number {
  return (y + 64) * 256 + (x + 64);
}
/** Kopfkoordinate eines Schlüssels (`Zeichnung.pixel`). */
export function ausSchluessel(k: number): [number, number] {
  return [(k % 256) - 64, Math.floor(k / 256) - 64];
}

/**
 * Liest ein Raster (Einrückung entfernt; kürzere Zeilen enden rechts mit Leerraum); nur Haarzeichen und `K` zählen, andere
 * Zeichen als `.`, Haar, Kontur und das abgepauste Gesicht (`S`, `m`, `k`) sind ein Fehler.
 */
export function zeichnung(b: FrisurBild, spiegeln = false): Zeichnung {
  const zeilen = b.raster
    .split('\n')
    .map((z) => z.trim())
    .filter((z) => z.length > 0);
  for (const z of zeilen) for (const c of z) if (c !== LEER && c !== HAAR_KONTUR && !HAAR_ZEICHEN.has(c) && c !== 'S' && c !== 'm' && c !== 'k') throw new Error(`Frisur: Zeichen "${c}" im Raster\n${b.raster}`);
  const pixel = new Map<number, string>();
  zeilen.forEach((z, ry) => {
    [...z].forEach((c, rx) => {
      if (!HAAR_ZEICHEN.has(c) && c !== HAAR_KONTUR) return;
      let x = rx - b.links;
      if (spiegeln) x = KOPF_W - 1 - x;
      pixel.set(schluessel(x, ry - b.oben), c);
    });
  });
  return { pixel };
}

/** Die Zeichnung des gezeichneten Kopfes (die Frisur bis M6): seine Haare und deren angrenzende Kontur. */
export function kopfZeichnung(richtung: Richtung): Zeichnung {
  const t = KOEPFE[richtung].auf;
  const pixel = new Map<number, string>();
  const an = (x: number, y: number): string => (x < 0 || y < 0 || x >= t.w || y >= t.h ? LEER : (t.zeilen[y]?.charAt(x) ?? LEER));
  for (let y = 0; y < t.h; y++) {
    for (let x = 0; x < t.w; x++) {
      const c = an(x, y);
      if (KOPF_HAAR.has(c)) pixel.set(schluessel(x, y), c);
      else if (c === 'k' && [an(x - 1, y), an(x + 1, y), an(x, y - 1), an(x, y + 1)].some((n) => KOPF_HAAR.has(n))) pixel.set(schluessel(x, y), HAAR_KONTUR);
    }
  }
  return { pixel };
}

/** Die Zeichnungen einer Frisur je Richtung. */
export interface FrisurZeichnungen {
  readonly down: Zeichnung;
  readonly up: Zeichnung;
  readonly right: Zeichnung;
  readonly left: Zeichnung;
}

/** Eine Quelle als Zeichnung (`spiegeln`: das Spiegelbild über die Kopfmitte). */
function alsZeichnung(q: FrisurQuelle, spiegeln = false): Zeichnung {
  if ('raster' in q) return zeichnung(q, spiegeln);
  if (!spiegeln) return q;
  const pixel = new Map<number, string>();
  for (const [k, c] of q.pixel) {
    const [x, y] = ausSchluessel(k);
    pixel.set(schluessel(KOPF_W - 1 - x, y), c);
  }
  return { pixel };
}

export function zeichnungenVon(f: FrisurDef): FrisurZeichnungen {
  return { down: alsZeichnung(f.down), up: alsZeichnung(f.up), right: alsZeichnung(f.right), left: f.left === undefined ? alsZeichnung(f.right, true) : alsZeichnung(f.left) };
}

/** Zeichnung `z` mit umgefärbten Haarzeichen (`ton(c, x, y)` → neues Haarzeichen; die Kontur bleibt). */
export function umgefaerbteZeichnung(z: Zeichnung, ton: (c: string, x: number, y: number) => string): Zeichnung {
  const pixel = new Map<number, string>();
  for (const [k, c] of z.pixel) {
    const [x, y] = ausSchluessel(k);
    pixel.set(k, HAAR_ZEICHEN.has(c) ? ton(c, x, y) : c);
  }
  return { pixel };
}

/** `oben` über `unten` gelegt: wo beide zeichnen, gilt `oben` (Kopfkoordinaten). */
export function ueberlagert(unten: Zeichnung, oben: Zeichnung): Zeichnung {
  const pixel = new Map(unten.pixel);
  for (const [k, c] of oben.pixel) pixel.set(k, c);
  return { pixel };
}

/**
 * Die Maskenzeichnung unter einem Helm (`maske`): was innerhalb des Kopfes liegt (der Helm deckt es, darunter bleibt die
 * richtige Haarfarbe) oder unter der Krempe (`HELM_KREMPE`); was oben über den Kopf hinausragt, fällt weg, und wo es abgeschnitten
 * ist, schließt eine Kontur die Haare.
 */
export function helmZeichnung(z: Zeichnung, richtung: Richtung): Zeichnung {
  const kopf = KOEPFE[richtung].auf;
  const imKopf = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < KOPF_W && y < KOPF_H && (kopf.zeilen[y]?.charAt(x) ?? LEER) !== LEER;
  const pixel = new Map<number, string>();
  for (const [k, c] of z.pixel) {
    const [x, y] = ausSchluessel(k);
    if (y >= HELM_KREMPE || imKopf(x, y)) pixel.set(k, c);
  }
  for (const [k, c] of z.pixel) {
    const [x, y] = ausSchluessel(k);
    if (pixel.has(k) || !HAAR_ZEICHEN.has(c) || imKopf(x, y)) continue;
    const unten = pixel.get(schluessel(x, y + 1));
    if (unten !== undefined && HAAR_ZEICHEN.has(unten)) pixel.set(k, HAAR_KONTUR);
  }
  return { pixel };
}

/** Welche Zeichnung und welcher gezeichnete `auf`-Kopf zu Richtung und Kopfpose gehören (`nacken` von vorn: der Hinterkopf). */
function zeichnungsRichtung(richtung: Richtung, variante: KopfVariante): Richtung {
  return variante === 'nacken' && richtung === 'down' ? 'up' : richtung;
}

/**
 * Der gezeichnete Kopf `kopf` (Richtung, Pose) mit der Frisur `z` (siehe Modulkommentar): ein Teil, das über den Kopf
 * hinausreichen darf; Drehpunkt und Punkte sitzen auf denselben Kopfpixeln wie in `kopf`.
 */
export function frisierterKopf(zs: FrisurZeichnungen, kopf: Teil, richtung: Richtung, variante: KopfVariante): Teil {
  const neu = frisierteKopfPixel(zs, kopf, richtung, variante);
  let x0 = 0;
  let y0 = 0;
  let x1 = kopf.w - 1;
  let y1 = kopf.h - 1;
  for (const [k, c] of neu) {
    if (c === LEER) continue;
    const [x, y] = ausSchluessel(k);
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const zeilen: string[] = [];
  for (let y = y0; y <= y1; y++) {
    let z2 = '';
    for (let x = x0; x <= x1; x++) z2 += neu.get(schluessel(x, y)) ?? LEER;
    zeilen.push(z2);
  }
  const punkte: Record<string, readonly [number, number]> = {};
  for (const [name, [px, py]] of Object.entries(kopf.punkte)) punkte[name] = [px - x0, py - y0];
  return { zeilen, w: x1 - x0 + 1, h: y1 - y0 + 1, pivot: [kopf.pivot[0] - x0, kopf.pivot[1] - y0], punkte };
}

/** Der frisierte Kopf als Nachschlagen in Kopfkoordinaten (`frisierterKopf` ohne das Zuschneiden; auch negativ). */
export function frisierterKopfAn(zs: FrisurZeichnungen, kopf: Teil, richtung: Richtung, variante: KopfVariante): (x: number, y: number) => string {
  const neu = frisierteKopfPixel(zs, kopf, richtung, variante);
  return (x, y) => neu.get(schluessel(x, y)) ?? LEER;
}

/** Rand einer Zeichnung in Kopfkoordinaten [x0, y0, x1, y1] (mit dem Kopf 16 × 11). */
export function zeichnungsRand(z: Zeichnung): readonly [number, number, number, number] {
  let x0 = 0;
  let y0 = 0;
  let x1 = KOPF_W - 1;
  let y1 = KOPF_H - 1;
  for (const k of z.pixel.keys()) {
    const [x, y] = ausSchluessel(k);
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

/** Die Pixel des frisierten Kopfes je Kopfkoordinate (`frisierterKopf`). */
function frisierteKopfPixel(zs: FrisurZeichnungen, kopf: Teil, richtung: Richtung, variante: KopfVariante): Map<number, string> {
  const zr = zeichnungsRichtung(richtung, variante);
  const z = zs[zr];
  const an = (t: Teil, x: number, y: number): string => (x < 0 || y < 0 || x >= t.w || y >= t.h ? LEER : (t.zeilen[y]?.charAt(x) ?? LEER));
  const neu = new Map<number, string>();
  for (let y = 0; y < kopf.h; y++) for (let x = 0; x < kopf.w; x++) neu.set(schluessel(x, y), an(kopf, x, y));
  const hoch = variante === 'hoch';
  for (const [k, c] of z.pixel) {
    let [x, y] = ausSchluessel(k);
    if (hoch && zr === 'down') {
      // Kopf in den Nacken: die Stirnzeile 4 verschwindet, darunter rückt alles eine Zeile hinauf (wie der gezeichnete Kopf).
      if (y === 4) continue;
      if (y > 4) y--;
    }
    const unter = neu.get(schluessel(x, y)) ?? LEER;
    // Im Profil hebt sich das Gesicht: kein Haar fällt darauf (ein Pony fällt mit dem Kopf in den Nacken zurück).
    if (hoch && zr !== 'down' && HAUT.has(unter)) continue;
    // Die Kontur der Haare legt sich nie über das Gesicht (Augen, Haut).
    if (c === HAAR_KONTUR && (HAUT.has(unter) || (unter === 'k' && innen(kopf, x, y)))) continue;
    neu.set(schluessel(x, y), c === HAAR_KONTUR ? 'k' : c);
  }
  // Jedes Haar des gezeichneten Kopfes ist Haar der Frisur (der Layer deckt den Körper ganz).
  for (let y = 0; y < kopf.h; y++) {
    for (let x = 0; x < kopf.w; x++) {
      if (!KOPF_HAAR.has(an(kopf, x, y)) || HAAR_ZEICHEN.has(neu.get(schluessel(x, y)) ?? LEER)) continue;
      let ton = '1';
      for (let yy = y - 1; yy >= y - 4; yy--) {
        const o = neu.get(schluessel(x, yy)) ?? LEER;
        if (HAAR_ZEICHEN.has(o)) {
          ton = o;
          break;
        }
      }
      neu.set(schluessel(x, y), ton);
    }
  }
  return neu;
}

/** Ob (x, y) im Teil `t` ein inneres Pixel ist (alle vier Nachbarn deckend: ein Auge, kein Umriss). */
function innen(t: Teil, x: number, y: number): boolean {
  const an = (xx: number, yy: number): string => (xx < 0 || yy < 0 || xx >= t.w || yy >= t.h ? LEER : (t.zeilen[yy]?.charAt(xx) ?? LEER));
  return an(x - 1, y) !== LEER && an(x + 1, y) !== LEER && an(x, y - 1) !== LEER && an(x, y + 1) !== LEER;
}

/** Der Kopfstil einer Frisur für `mitFigur` (`_spieler_rig.ts`). */
export function kopfStil(zs: FrisurZeichnungen): KopfStil {
  const cache = new Map<Teil, Map<string, Teil>>();
  return (t, richtung, variante) => {
    let je = cache.get(t);
    if (je === undefined) {
      je = new Map();
      cache.set(t, je);
    }
    const key = `${richtung}|${variante}`;
    let out = je.get(key);
    if (out === undefined) {
      out = frisierterKopf(zs, t, richtung, variante);
      je.set(key, out);
    }
    return out;
  };
}

/** Spiegelbild eines Teils ohne Händetausch (für Tests der Spiegelfrisuren). */
export function kopfGespiegelt(t: Teil): Teil {
  return gespiegelt(t, false);
}
