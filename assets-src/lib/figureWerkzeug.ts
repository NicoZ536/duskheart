/**
 * Ausrüstungs-Layer für Hand und Nebenhand (M3-07, MASTERPROMPT §4.5 „Ausrüstung als Layer … mit
 * Hand-Sockeln pro Frame“): Ein Werkzeug wird einmal aufrecht von Hand gezeichnet (Griffpunkt `+`,
 * Klinge/Kopf zur rechten Seite = in Schlagrichtung vorn). Daraus entstehen verlustfrei (90°-Drehungen
 * um den Griffpixel, Spiegeln an der Senkrechten durch den Griff) die Lagen N, O, S, W und ihre
 * Spiegelbilder, dazu Smear-Frames (Bewegungsbogen des Kopfes in der hellsten Kopffarbe) für den
 * Werkzeugschlag.
 *
 * Vertrag mit dem Figuren-Rig (`src/render/anim/figure.ts`): Anker = Griffpixel, er landet auf dem
 * Sockel `hand`/`nebenhand` des Körper-Frames. Clips `down`/`up`/`right`/`left` halten das Werkzeug
 * (hängend mit der Klinge in Blickrichtung oder aufrecht, siehe `halten`). Clips `<aktion>_<richtung>` (z. B. `tool_right`, `tool_licht_right`)
 * haben dieselbe Länge und Bildrate wie der Körper-Clip der Aktion und laufen mit dessen Zeit: Frame i
 * des Item-Clips gehört zu Position i des Körper-Clips. Sockel `wirkpunkt` je Frame = Mitte des Werkzeugkopfs
 * (Treffer-Partikel, Funken).
 */
import { rasterRows, type SpriteSource } from './sprite';

/** Lage eines Werkzeug-Frames. */
export const LAGEN = ['n', 'o', 's', 'w', 'n_gespiegelt', 'w_gespiegelt', 's_gespiegelt', 'o_gespiegelt'] as const;
/** Frame-Indizes der Lagen und Smear-Frames. */
export const WERKZEUG_FRAME = {
  n: 0,
  o: 1,
  s: 2,
  w: 3,
  /** Spiegelbilder (Klinge zur anderen Seite): `n_` zeigt nach oben, `o_` nach rechts, `w_` nach links. */
  n_: 4,
  w_: 5,
  s_: 6,
  o_: 7,
  schmierRechts: 8,
  schmierLinks: 9,
  schmierVorn: 10,
  schmierHinten: 11,
} as const;

type Raster = string[][];

/** Körper-Aktionen, zu denen jedes Schlagwerkzeug einen eigenen Clip `<aktion>_<richtung>` trägt. */
export const SCHLAG_AKTIONEN = ['tool', 'tool_licht'] as const;

/** Winkelbereich eines Smear-Bogens in Grad (Bildschirm: 0° = rechts, 90° = unten). */
interface Bogen {
  readonly von: number;
  readonly bis: number;
}

export interface WerkzeugForm {
  readonly id: string;
  /** Aufrechte Zeichnung, `+` = Griffpixel (wird mit `griffZeichen` gemalt). */
  readonly raster: string;
  readonly griffZeichen: string;
  readonly legende: SpriteSource['legende'];
  /** Mitte des Werkzeugkopfs relativ zum Griff in der aufrechten Lage (y nach unten). */
  readonly wirkpunkt: readonly [number, number];
  /** Zeichen des Smear-Bogens (hellste Kopffarbe); `null` = kein Schlagwerkzeug (Eimer). */
  readonly schmier: string | null;
  readonly material?: SpriteSource['material'];
  readonly spiegelbar?: boolean;
  /**
   * Haltung außerhalb des Schlags: `unten` = Kopf nach unten hängend (kurze und mittlere Werkzeuge; der
   * Kopf verdeckt so nie das Gesicht), `oben` = aufrecht wie gezeichnet (Speer als Stab, Eimer am Bügel).
   */
  readonly halten: 'unten' | 'oben';
}

function parse(form: WerkzeugForm): { raster: Raster; gx: number; gy: number } {
  const rows = rasterRows(form.raster).map((r) => [...r]);
  let gx = -1;
  let gy = -1;
  rows.forEach((r, y) =>
    r.forEach((c, x) => {
      if (c === '+') {
        gx = x;
        gy = y;
        r[x] = form.griffZeichen;
      }
    }),
  );
  if (gx < 0) throw new Error(`Werkzeug ${form.id}: Griffpixel "+" fehlt`);
  const w = rows[0]?.length ?? 0;
  rows.forEach((r, i) => {
    if (r.length !== w) throw new Error(`Werkzeug ${form.id}: Zeile ${i} hat ${r.length} Zeichen, erwartet ${w}`);
  });
  return { raster: rows, gx, gy };
}

const LEER = '.';

/** Quadratische Zelle mit dem Griff in der Mitte (Kantenlänge 2R + 1, R = größter Abstand + Bogen). */
function zentriert(form: WerkzeugForm): { zelle: Raster; r: number } {
  const { raster, gx, gy } = parse(form);
  let r = 0;
  raster.forEach((row, y) => row.forEach((c, x) => (c === LEER ? undefined : (r = Math.max(r, Math.abs(x - gx), Math.abs(y - gy))))));
  const bogenR = Math.ceil(Math.hypot(form.wirkpunkt[0], form.wirkpunkt[1])) + 2;
  r = Math.max(r, form.schmier === null ? 0 : bogenR) + 1;
  const n = 2 * r + 1;
  const zelle: Raster = Array.from({ length: n }, () => Array.from({ length: n }, () => LEER));
  raster.forEach((row, y) =>
    row.forEach((c, x) => {
      const zy = zelle[y - gy + r];
      if (zy !== undefined && c !== LEER) zy[x - gx + r] = c;
    }),
  );
  return { zelle, r };
}

/** Um 90° im Uhrzeigersinn um die Zellmitte gedreht (quadratische Zelle, verlustfrei). */
function drehe(z: Raster): Raster {
  const n = z.length;
  return Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => z[n - 1 - x]?.[y] ?? LEER));
}

function spiegle(z: Raster): Raster {
  return z.map((row) => [...row].reverse());
}

function punktGedreht([x, y]: readonly [number, number], viertel: number): [number, number] {
  let px = x;
  let py = y;
  for (let i = 0; i < viertel; i++) [px, py] = [-py, px];
  return [px, py];
}

/** Malt den Smear-Bogen (Band um den Kopfradius) unter das Werkzeug. */
function mitBogen(z: Raster, r: number, radius: number, bogen: Bogen, zeichen: string): Raster {
  const out = z.map((row) => [...row]);
  const n = z.length;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = x - r;
      const dy = y - r;
      const d = Math.hypot(dx, dy);
      if (d < radius - 1.2 || d > radius + 0.8) continue;
      let a = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (a < bogen.von) a += 360;
      if (a > bogen.bis) continue;
      const row = out[y];
      if (row !== undefined && row[x] === LEER) row[x] = zeichen;
    }
  }
  return out;
}

const alsText = (z: Raster): string => z.map((r) => r.join('')).join('\n');

/**
 * Sprite-Quelle eines Hand-Werkzeugs: Frames nach `WERKZEUG_FRAME`, Halte-Clips je Richtung und
 * Schlag-Clips `tool_<richtung>` passend zum Körper-Clip `tool_<richtung>` (Folge [0, 1, 1, 2, 3, 3]
 * der Körperframes Anheben, Ausholen, Schlag, Durchschlag bei 12 fps).
 */
export function werkzeugSprite(form: WerkzeugForm): SpriteSource {
  const { zelle: n, r } = zentriert(form);
  const lagen: Raster[] = [n];
  for (let i = 1; i < 4; i++) lagen.push(drehe(lagen[i - 1] ?? n));
  const [ln, lo, ls, lw] = lagen as [Raster, Raster, Raster, Raster];
  const radius = Math.hypot(form.wirkpunkt[0], form.wirkpunkt[1]);
  const schmierZeichen = form.schmier;
  const smear = (z: Raster, b: Bogen): Raster => (schmierZeichen === null ? z : mitBogen(z, r, radius, b, schmierZeichen));
  const schmierRechts = smear(lo, { von: -90, bis: 0 });
  const frames: Raster[] = [
    ln,
    lo,
    ls,
    lw,
    spiegle(ln),
    spiegle(lo),
    spiegle(ls),
    spiegle(lw),
    schmierRechts,
    spiegle(schmierRechts),
    smear(ls, { von: 90, bis: 180 }),
    smear(ln, { von: -90, bis: 0 }),
  ];
  const wirk = (viertel: number, gespiegelt: boolean): [number, number] => {
    const [x, y] = punktGedreht(form.wirkpunkt, viertel);
    return [r + (gespiegelt ? -x : x), r + y];
  };
  const wirkpunkt: [number, number][] = [wirk(0, false), wirk(1, false), wirk(2, false), wirk(3, false), wirk(0, true), wirk(1, true), wirk(2, true), wirk(3, true), wirk(1, false), wirk(1, true), wirk(2, false), wirk(0, false)];
  const F = WERKZEUG_FRAME;
  const halten = (f: number): { frames: number[]; fps: number; loop: boolean } => ({ frames: [f], fps: 8, loop: true });
  const schlagClip = (seq: readonly number[]): { frames: number[]; fps: number; loop: boolean } => ({ frames: [...seq], fps: 12, loop: false });
  const ohneSchlag = form.schmier === null;
  const unten = form.halten === 'unten';
  const schlagClips = {
    down: schlagClip(ohneSchlag ? [F.n, F.n, F.n, F.n, F.n, F.n] : [F.n, F.n, F.n, F.schmierVorn, F.s, F.s]),
    up: schlagClip(ohneSchlag ? [F.n, F.n, F.n, F.n, F.n, F.n] : [F.n, F.n, F.n, F.schmierHinten, F.n, F.n]),
    right: schlagClip(ohneSchlag ? [F.n, F.n, F.n, F.n, F.n, F.n] : [F.n, F.w, F.w, F.schmierRechts, F.o, F.o]),
    left: schlagClip(ohneSchlag ? [F.n_, F.n_, F.n_, F.n_, F.n_, F.n_] : [F.n_, F.o_, F.o_, F.schmierLinks, F.w_, F.w_]),
  };
  // Der Schlag gilt für `tool` und seine Licht-Variante `tool_licht` (gleiche Körperfolge).
  const schlag = Object.fromEntries(
    SCHLAG_AKTIONEN.flatMap((aktion) => Object.entries(schlagClips).map(([richtung, clip]) => [`${aktion}_${richtung}`, { ...clip, frames: [...clip.frames] }])),
  );
  return {
    id: form.id,
    group: 'ausruestung',
    size: [2 * r + 1, 2 * r + 1],
    anchor: [r, r],
    hoehe: 'zylinder',
    legende: form.legende,
    frames: frames.map(alsText),
    clips: {
      down: halten(unten ? F.s : F.n),
      up: halten(unten ? F.s : F.n),
      right: halten(unten ? F.s_ : F.n),
      left: halten(unten ? F.s : F.n_),
      ...schlag,
    },
    sockets: { wirkpunkt },
    occluder: { kind: 'none' },
    spiegelbar: form.spiegelbar ?? false,
    ...(form.material === undefined ? {} : { material: form.material }),
  };
}
