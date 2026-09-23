/**
 * DUSKHEARTH Master-Palette (MASTERPROMPT §4.3).
 * 64 Farben in 12 Rampen (je 5–6 Stufen, dunkel → hell) mit Hue-Shifting:
 * Schatten wandern Richtung Blau/Violett, Lichter Richtung Warmgelb.
 * Dazu 8 UI-Farben. Sprites referenzieren Farben als `rampe.stufe` (z. B. `holz.2`).
 */

/** §4.3: Größe der Master-Palette (ohne UI-Farben). */
export const PALETTE_SIZE = 64;
/** §4.3: Stufen je Rampe. */
export const RAMP_STEPS_MIN = 5;
export const RAMP_STEPS_MAX = 7;
/** §4.3: Anzahl der UI-Farben. */
export const UI_COLOR_COUNT = 8;

export interface Ramp {
  readonly name: string;
  readonly colors: readonly string[];
}

export const RAMPS: readonly Ramp[] = [
  // Outline & tiefe Schatten: blauviolette Neutraltöne statt Schwarz; die hellen Stufen kippen leicht
  // Richtung Malve, damit auch diese Rampe zum Licht hin wärmer wird (tests/unit/assets/palette.test.ts).
  { name: 'nacht', colors: ['#0d0a14', '#1a1426', '#2a2238', '#403451', '#5e4e6a'] },
  // Stein: kühles Blaugrau im Schatten, warmes Hellgrau im Licht.
  { name: 'stein', colors: ['#2b2d3a', '#43465a', '#5f6377', '#7e8393', '#a3a6ad', '#cbc9c3'] },
  // Erde: Schatten Richtung Pflaume.
  { name: 'erde', colors: ['#2e1c24', '#4a2e2e', '#6e4a3c', '#93694f', '#b98f6a'] },
  // Holz: warm, Lichter Richtung Honig.
  { name: 'holz', colors: ['#3a2320', '#5c3a2a', '#845636', '#ab7a45', '#d1a466'] },
  // Gras: tiefes Petrol → Gelbgrün.
  { name: 'gras', colors: ['#14302e', '#1f4a35', '#2f6b3a', '#4b8c3c', '#78ad45', '#b3cf5e'] },
  // Herbstlaub: Weinrot → Gold.
  { name: 'laub', colors: ['#4a1f2a', '#7a2f2c', '#a8492f', '#cf7a37', '#e8b04e'] },
  // Wasser: Marine → Türkis → Schaum.
  { name: 'wasser', colors: ['#10203f', '#16355e', '#1f5680', '#2e7f9e', '#4fb0b8', '#9ee0d6'] },
  // Sand & Gold.
  { name: 'sand', colors: ['#7a5a3e', '#a07b4f', '#c49e62', '#dcc27f', '#efe0a8'] },
  // Feuer & Glut: Tiefrot → Orange → Gelb → Weißgelb.
  { name: 'feuer', colors: ['#5a1420', '#9a2424', '#d4471e', '#f07c1f', '#fbb938', '#fff0a0'] },
  // Haut.
  { name: 'haut', colors: ['#5e3a3a', '#8a5446', '#b8775a', '#dca37e', '#f3cfa8'] },
  // Eis, Schnee & Lumen-Kristall.
  { name: 'eis', colors: ['#5a7aa6', '#7ea3c9', '#a8c9e2', '#d2e7f2', '#f4fbff'] },
  // Verderbnis & Schattenbrut.
  { name: 'verderb', colors: ['#1e0f2e', '#3a1850', '#62207a', '#9435a8', '#c96bd6'] },
];

/** UI-Farben (Holz, Eisen, Pergament – §26). */
export const UI_COLORS = {
  dunkel: '#120e18',
  rahmen: '#3b2a1e',
  rahmenHell: '#7a5534',
  pergament: '#e8d5a8',
  pergamentDunkel: '#b89a68',
  text: '#f4ecd8',
  akzent: '#f0a83a',
  warnung: '#d4473a',
} as const;

/** Raritätsfarben (§4.5) als Palettenreferenzen. */
export const RARITY_COLORS = {
  gewoehnlich: 'eis.4',
  ungewoehnlich: 'gras.4',
  selten: 'wasser.4',
  episch: 'verderb.4',
  legendaer: 'feuer.4',
} as const;

export const MASTER_COLOR_COUNT = RAMPS.reduce((n, r) => n + r.colors.length, 0);

/** Flat list: index 0 = transparent, then all ramp colours in order. */
export function flatPalette(): string[] {
  return RAMPS.flatMap((r) => r.colors);
}

/** Resolve `rampe.stufe` to a flat palette index (1-based; 0 = transparent). */
export function paletteIndex(ref: string): number {
  const [name, stepStr] = ref.split('.');
  let offset = 1;
  for (const r of RAMPS) {
    if (r.name === name) {
      const step = Number(stepStr);
      if (!Number.isInteger(step) || step < 0 || step >= r.colors.length) throw new Error(`Palette: Stufe ${stepStr} fehlt in Rampe ${name}`);
      return offset + step;
    }
    offset += r.colors.length;
  }
  throw new Error(`Palette: unbekannte Rampe ${name}`);
}

/** Ramp with the given name, or `undefined`. */
export function findRamp(name: string): Ramp | undefined {
  return RAMPS.find((r) => r.name === name);
}

/** Flat palette index (1-based) of step 0 of ramp `name`. Throws for unknown ramps. */
export function rampStart(name: string): number {
  let offset = 1;
  for (const r of RAMPS) {
    if (r.name === name) return offset;
    offset += r.colors.length;
  }
  throw new Error(`Palette: unbekannte Rampe ${name}`);
}

/** Inverse of `paletteIndex`: flat index 1…64 → `rampe.stufe`. Throws outside the palette. */
export function paletteRef(index: number): string {
  let offset = 1;
  for (const r of RAMPS) {
    if (index >= offset && index < offset + r.colors.length) return `${r.name}.${index - offset}`;
    offset += r.colors.length;
  }
  throw new Error(`Palette: Index ${index} liegt außerhalb 1…${MASTER_COLOR_COUNT}`);
}

export function hexToRgb(hex: string): [number, number, number] {
  const v = Number.parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
