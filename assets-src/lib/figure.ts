/**
 * Figuren-Rig (M3-05 … M3-07, MASTERPROMPT §4.5, docs/ART.md §4): setzt handgezeichnete Körperteile
 * (Kopf, Rumpf, Arme, Beine, Sonderposen) je Frame zu Index-Rastern zusammen. Die Teile sind von Hand
 * gesetzt; das Rig verschiebt, spiegelt und stapelt sie nur – so bleiben alle Posen einer Figur in
 * Proportion, Farbe und Kontur deckungsgleich, und Ausrüstungs-Layer entstehen pixelgenau aus
 * demselben Bild.
 *
 * - **Semantische Zeichen:** Teile zeichnen mit Material-Zeichen (Tunika, Hose, Haut …). Welche Farbe ein
 *   Zeichen bekommt, entscheidet erst die Legende des Ausgabe-Sprites (Grundkörper oder Layer).
 * - **Marken:** Die Zeichen aus `MARKEN` stehen für einen Sockel und malen dabei ein Hautpixel
 *   (`H`/`h` Hand, `N`/`n` Nebenhand; Groß = helle, Klein = dunkle Haut). Der Sockel gilt auch, wenn ein
 *   späteres Teil die Hand verdeckt (ferne Hand im Profil).
 * - **Punkte:** Teile können benannte Punkte tragen (`kopf`, `last` …); sie werden mit dem Teil
 *   verschoben und gespiegelt und landen als Sockel im Frame.
 * - **Radierer:** `_` im Raster löscht darunterliegende Pixel (Aussparungen, Wasserlinie).
 * - **Spiegeln** (`gespiegelt`) tauscht Hand- und Nebenhand-Marken; es ist für symmetrische Teile
 *   gedacht (Arme, Beine, Profil-Rumpf). Köpfe mit Scheitel werden je Richtung eigens gezeichnet.
 */
import { rasterRows, resolveColor } from './sprite';

/** Pixelpunkt `[x, y]` (0,0 = linke obere Ecke). */
export type Punkt = readonly [number, number];

/** Blickrichtungen in der Reihenfolge der Kontaktbögen. */
export const RICHTUNGEN = ['down', 'up', 'right', 'left'] as const;
export type Richtung = (typeof RICHTUNGEN)[number];

/** Transparent im Raster. */
export const LEER = '.';
/** Löscht beim Setzen das Pixel darunter. */
export const RADIERER = '_';

/** Marken-Zeichen → [Sockel, gemaltes Zeichen]. */
export const MARKEN: Readonly<Record<string, readonly [string, string]>> = {
  H: ['hand', 'S'],
  h: ['hand', 'm'],
  N: ['nebenhand', 'S'],
  n: ['nebenhand', 'm'],
};
/** Spiegeln tauscht die Hände. */
const SPIEGEL_TAUSCH: Readonly<Record<string, string>> = { H: 'N', N: 'H', h: 'n', n: 'h' };

/** Ein gezeichnetes Teil: Raster, Drehpunkt (Platzierungspunkt) und benannte Punkte. */
export interface Teil {
  readonly zeilen: readonly string[];
  readonly w: number;
  readonly h: number;
  readonly pivot: Punkt;
  readonly punkte: Readonly<Record<string, Punkt>>;
}

/** Parst ein Raster (Template-String, Einrückung wird entfernt); alle Zeilen müssen gleich lang sein. */
export function teil(raster: string, pivot: Punkt = [0, 0], punkte: Readonly<Record<string, Punkt>> = {}): Teil {
  const zeilen = rasterRows(raster);
  const w = zeilen[0]?.length ?? 0;
  if (zeilen.length === 0 || w === 0) throw new Error('Figuren-Teil: leeres Raster');
  zeilen.forEach((z, i) => {
    if (z.length !== w) throw new Error(`Figuren-Teil: Zeile ${i} hat ${z.length} Zeichen, erwartet ${w}\n${raster}`);
  });
  return { zeilen, w, h: zeilen.length, pivot, punkte };
}

/**
 * Waagerecht gespiegeltes Teil (Drehpunkt und Punkte mitgespiegelt). `tauschen`: Hand- und
 * Nebenhand-Marken tauschen (Standard; der rechte Arm wird zum linken). Ohne Tausch bleibt es dieselbe
 * Körperseite, nur von der anderen Seite gesehen (Rückenansicht).
 */
export function gespiegelt(t: Teil, tauschen = true): Teil {
  const zeilen = t.zeilen.map((z) => [...z].reverse().map((c) => (tauschen ? (SPIEGEL_TAUSCH[c] ?? c) : c)).join(''));
  const punkte: Record<string, Punkt> = {};
  for (const [name, [x, y]] of Object.entries(t.punkte)) punkte[name] = [t.w - 1 - x, y];
  return { zeilen, w: t.w, h: t.h, pivot: [t.w - 1 - t.pivot[0], t.pivot[1]], punkte };
}

/** Ersetzt Zeichen eines Teils (z. B. Augen zu, andere Stoffschattierung). */
export function umgezeichnet(t: Teil, ersatz: Readonly<Record<string, string>>): Teil {
  return { ...t, zeilen: t.zeilen.map((z) => [...z].map((c) => ersatz[c] ?? c).join('')) };
}

/** Ein Teil an einer Stelle: der Drehpunkt landet auf (x, y). */
export interface Platz {
  readonly teil: Teil;
  readonly x: number;
  readonly y: number;
}

/** Zusammengesetztes Bild: Zeichenraster und Sockel. */
export interface Bild {
  readonly w: number;
  readonly h: number;
  /** Zeichen je Pixel (Zeile für Zeile), `LEER` = transparent. */
  readonly pixel: string[];
  readonly sockel: Record<string, Punkt>;
}

export function leeresBild(w: number, h: number): Bild {
  return { w, h, pixel: new Array<string>(w * h).fill(LEER), sockel: {} };
}

/** Setzt ein Teil ins Bild; Marken werden zu Sockeln, `_` radiert. */
export function setze(bild: Bild, p: Platz): void {
  const { teil: t } = p;
  const x0 = p.x - t.pivot[0];
  const y0 = p.y - t.pivot[1];
  for (let ty = 0; ty < t.h; ty++) {
    const zeile = t.zeilen[ty] ?? '';
    for (let tx = 0; tx < t.w; tx++) {
      const c = zeile.charAt(tx);
      if (c === LEER) continue;
      const x = x0 + tx;
      const y = y0 + ty;
      const marke = MARKEN[c];
      if (marke !== undefined && bild.sockel[marke[0]] === undefined) bild.sockel[marke[0]] = [x, y];
      if (x < 0 || y < 0 || x >= bild.w || y >= bild.h) continue;
      bild.pixel[y * bild.w + x] = c === RADIERER ? LEER : (marke?.[1] ?? c);
    }
  }
  for (const [name, [px, py]] of Object.entries(t.punkte)) bild.sockel[name] = [x0 + px, y0 + py];
}

/** Löscht alle Pixel unterhalb der Zeile `y` (Wasserlinie: Unterkörper verborgen). */
export function schneideUnter(bild: Bild, y: number): void {
  for (let yy = y + 1; yy < bild.h; yy++) for (let x = 0; x < bild.w; x++) bild.pixel[yy * bild.w + x] = LEER;
}

/** Waagerecht gespiegeltes Bild (für Sonderposen, deren Seitenwechsel unsichtbar ist). */
export function bildGespiegelt(b: Bild): Bild {
  const pixel = new Array<string>(b.w * b.h).fill(LEER);
  for (let y = 0; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) {
      const c = b.pixel[y * b.w + x] ?? LEER;
      pixel[y * b.w + (b.w - 1 - x)] = c;
    }
  }
  const sockel: Record<string, Punkt> = {};
  for (const [name, [x, y]] of Object.entries(b.sockel)) {
    const getauscht = name === 'hand' ? 'nebenhand' : name === 'nebenhand' ? 'hand' : name;
    sockel[getauscht] = [b.w - 1 - x, y];
  }
  return { w: b.w, h: b.h, pixel, sockel };
}

/**
 * Um 90° gedrehtes Bild (`cw` = im Uhrzeigersinn), danach so verschoben, dass die unterste deckende
 * Zeile auf `boden` liegt und die Figur waagerecht um `mitteX` zentriert ist – für liegende Posen
 * (Schlafen, Tod) und die Rolle, die aus einer stehenden bzw. geduckten Pose entstehen. Ganzzahlige
 * 90°-Drehungen sind verlustfrei.
 */
export function bildGedreht(b: Bild, cw: boolean, boden: number, mitteX: number): Bild {
  const dreh = (x: number, y: number): [number, number] => (cw ? [b.h - 1 - y, x] : [y, b.w - 1 - x]);
  let x0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) {
      if ((b.pixel[y * b.w + x] ?? LEER) === LEER) continue;
      const [nx, ny] = dreh(x, y);
      x0 = Math.min(x0, nx);
      x1 = Math.max(x1, nx);
      y1 = Math.max(y1, ny);
    }
  }
  if (!Number.isFinite(x0)) return leeresBild(b.h, b.w);
  const dx = mitteX - Math.floor((x0 + x1 + 1) / 2);
  const dy = boden - y1;
  const out = leeresBild(b.h, b.w);
  for (let y = 0; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) {
      const c = b.pixel[y * b.w + x] ?? LEER;
      if (c === LEER) continue;
      const [nx, ny] = dreh(x, y);
      const tx = nx + dx;
      const ty = ny + dy;
      if (tx >= 0 && ty >= 0 && tx < out.w && ty < out.h) out.pixel[ty * out.w + tx] = c;
    }
  }
  for (const [name, [x, y]] of Object.entries(b.sockel)) {
    const [nx, ny] = dreh(x, y);
    out.sockel[name] = [nx + dx, ny + dy];
  }
  return out;
}

/** Verschiebt den Bildinhalt (Pixel und Sockel) um (dx, dy). */
export function bildVerschoben(b: Bild, dx: number, dy: number): Bild {
  const out = leeresBild(b.w, b.h);
  for (let y = 0; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) {
      const c = b.pixel[y * b.w + x] ?? LEER;
      const tx = x + dx;
      const ty = y + dy;
      if (c !== LEER && tx >= 0 && ty >= 0 && tx < b.w && ty < b.h) out.pixel[ty * b.w + tx] = c;
    }
  }
  for (const [name, [x, y]] of Object.entries(b.sockel)) out.sockel[name] = [x + dx, y + dy];
  return out;
}

/**
 * Entfernt verwaiste Einzelpixel, die beim Stapeln durch Verdeckung übrig bleiben (z. B. ein
 * Handpixel, das hinter dem Rumpf hervorlugt), nach derselben Regel wie der Paletten-Validator
 * (`tools/assets/spriteChecks.ts`): ein Pixel ohne gleichfarbigen Nachbarn (8er-Nachbarschaft), das
 * höchstens einen deckenden Nachbarn hat oder dessen Farbe im Bild nur einmal vorkommt. Hängt es nur an
 * einem Nachbarn, fällt es weg; sonst übernimmt es das häufigste Nachbarzeichen (meist die Kontur).
 * Jede Abbildung in `farben` (Zeichen → Farbe; Zeichen mit gleicher Farbe zählen als gleich) steht für
 * ein Ausgabe-Sprite; ein Pixel wird bereinigt, sobald es in einer davon verwaist ist.
 */
export function bereinigeEinzelpixel(b: Bild, farben: readonly ((c: string) => string)[]): void {
  const n = b.w * b.h;
  // Je Abbildung: Zeichen → Farbnummer (0 = leer); danach rechnet alles auf Zahlen.
  const karten = farben.map((farbe) => {
    const nummer = new Map<string, number>([[LEER, 0]]);
    const farbNummer = new Map<string, number>();
    return (c: string): number => {
      let k = nummer.get(c);
      if (k === undefined) {
        const f = farbe(c);
        k = farbNummer.get(f) ?? farbNummer.size + 1;
        farbNummer.set(f, k);
        nummer.set(c, k);
      }
      return k;
    };
  });
  const codes = karten.map((karte) => {
    const code = new Int32Array(n);
    for (let p = 0; p < n; p++) code[p] = karte(b.pixel[p] ?? LEER);
    return code;
  });
  const anzahlen = codes.map(() => new Map<number, number>());
  for (let runde = 0; runde < 4; runde++) {
    codes.forEach((code, i) => {
      const anzahl = anzahlen[i];
      if (anzahl === undefined) return;
      anzahl.clear();
      for (let p = 0; p < n; p++) {
        const k = code[p] ?? 0;
        if (k !== 0) anzahl.set(k, (anzahl.get(k) ?? 0) + 1);
      }
    });
    let geaendert = false;
    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) {
        const p = y * b.w + x;
        if ((b.pixel[p] ?? LEER) === LEER) continue;
        let verwaist = false;
        let deckend = 0;
        for (let i = 0; i < codes.length && !verwaist; i++) {
          const code = codes[i] as Int32Array;
          const f = code[p] ?? 0;
          let gleich = 0;
          deckend = 0;
          for (let dy = -1; dy <= 1; dy++) {
            const ny = y + dy;
            if (ny < 0 || ny >= b.h) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              if ((dx === 0 && dy === 0) || nx < 0 || nx >= b.w) continue;
              const k = code[ny * b.w + nx] ?? 0;
              if (k === 0) continue;
              deckend++;
              if (k === f) gleich++;
            }
          }
          verwaist = gleich === 0 && (deckend <= 1 || (anzahlen[i]?.get(f) ?? 0) <= 1);
        }
        if (!verwaist) continue;
        const ersatz = deckend > 1 ? haeufigsterNachbar(b, x, y) : LEER;
        b.pixel[p] = ersatz;
        karten.forEach((karte, i) => {
          const code = codes[i];
          if (code !== undefined) code[p] = karte(ersatz);
        });
        geaendert = true;
      }
    }
    if (!geaendert) return;
  }
}

/** Häufigstes deckende Nachbarzeichen (8er-Nachbarschaft; bei Gleichstand das kleinste). */
function haeufigsterNachbar(b: Bild, x: number, y: number): string {
  const zaehl = new Map<string, number>();
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= b.w || ny >= b.h) continue;
      const c = b.pixel[ny * b.w + nx] ?? LEER;
      if (c !== LEER) zaehl.set(c, (zaehl.get(c) ?? 0) + 1);
    }
  }
  return [...zaehl.entries()].sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1))[0]?.[0] ?? LEER;
}

/** Legende eines Figuren-Sprites: Zeichen → `rampe.stufe[*]` oder `null` (transparent). */
export type FigurLegende = Readonly<Record<string, string | null>>;

/**
 * Bild als Pixelpuffer für `spriteFromPixels` (Palettenindex und Emissiv je Pixel) – spart das Schreiben
 * und erneute Parsen von Text-Rastern bei Figuren mit Hunderten Frames. Mit `nur` entsteht in einem
 * Durchgang ein Layer-Auszug: nur die Pixel mit Zeichen aus `nur.zeichen` bleiben, dazu Konturpixel, die
 * an ein solches Pixel grenzen (4er-Nachbarschaft) – so hat der Layer an dieser Stelle dieselbe
 * Silhouette wie der Körper (gleiche Zylinder-Normalen) und deckt beim Überzeichnen nichts anderes. Ein Zeichen ohne Legende oder mit einer Farbe außerhalb der
 * Palette ist ein Fehler.
 */
export function bildPixel(b: Bild, legende: FigurLegende, nur?: { readonly zeichen: ReadonlySet<string>; readonly kontur: string }): { index: Uint8Array; emissive?: Uint8Array } {
  const n = b.w * b.h;
  const index = new Uint8Array(n);
  const emissive = new Uint8Array(n);
  const cache = new Map<string, { i: number; e: number }>();
  let leuchtet = false;
  const an = (x: number, y: number): string => (x < 0 || y < 0 || x >= b.w || y >= b.h ? LEER : (b.pixel[y * b.w + x] ?? LEER));
  for (let p = 0; p < n; p++) {
    const c = b.pixel[p] ?? LEER;
    if (c === LEER) continue;
    if (nur !== undefined && !nur.zeichen.has(c)) {
      if (c !== nur.kontur) continue;
      const x = p % b.w;
      const y = (p - x) / b.w;
      if (!nur.zeichen.has(an(x - 1, y)) && !nur.zeichen.has(an(x + 1, y)) && !nur.zeichen.has(an(x, y - 1)) && !nur.zeichen.has(an(x, y + 1))) continue;
    }
    let farbe = cache.get(c);
    if (farbe === undefined) {
      const ref = legende[c];
      if (ref === undefined) throw new Error(`Figur: Zeichen "${c}" fehlt in der Legende`);
      if (ref === null) farbe = { i: 0, e: 0 };
      else {
        const r = resolveColor(ref);
        if ('error' in r) throw new Error(`Figur: ${r.error}`);
        farbe = { i: r.index, e: r.emissive ? 1 : 0 };
      }
      cache.set(c, farbe);
    }
    index[p] = farbe.i;
    emissive[p] = farbe.e;
    leuchtet ||= farbe.e > 0;
  }
  // Ohne leuchtende Pixel entfällt der Puffer (spriteFromPixels legt dann einen leeren an).
  return leuchtet ? { index, emissive } : { index };
}
