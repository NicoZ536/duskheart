/**
 * Baustein der Zustands-Icons `zustand_<id>` (docs/SPIEL.md §5/§6, MASTERPROMPT §11.3, M3-20).
 *
 * Bildsprache: Die Art des Zustands steckt in der **Form** des Rahmens, nicht nur in seiner Farbe – so
 * bleibt sie auch bei Farbfehlsichtigkeit und in Graustufen lesbar:
 * - `gut` (Stärkung): **Kreis**, Goldrand (`sand.4`/`sand.2`), Grund Nachtblau (`wasser.1`).
 * - `schlecht` (Schwächung ohne Schaden): **Quadrat** mit gebrochenen Ecken, Rostrand (`laub.2`/`laub.1`),
 *   Grund Weinrot (`laub.0`).
 * - `kritisch` (kostet Leben): **Raute**, Glutrand (`feuer.3`/`feuer.2`), Grund Schwarz (`nacht.0`); ein
 *   zweiter Frame hebt den Rand auf `feuer.5`/`feuer.4` (Clip `puls`, 4 fps), damit die HUD-Leiste
 *   Lebensgefahr blinkend zeigen kann.
 * Kontur überall `nacht.1`, oben heller Rand, unten dunkler (Licht von oben wie bei allen Sprites). Der
 * Rahmen ist je Art von Hand gezeichnet (Rahmenzeichen `<` Rand hell, `>` Rand dunkel, `=` Grund), das
 * Motiv liegt als eigenes 16×16-Raster darüber (`.` = Rahmen sichtbar) und nutzt die Icon-Legende.
 * Stufen einer Reihe (frierend → unterkühlt → erfrierend, erhitzt → überhitzt → Hitzschlag, hungrig →
 * verhungernd, durstig → verdurstend) behalten ihr Motiv und wechseln Rahmen und Zusatzzeichen.
 */
import { sprite, type Sprite } from '../../lib/sprite';
import { ICON_LEGENDE } from '../icons/_icon';

/** Kontaktbogen `zustaende.png`. */
export const ZUSTAND_GRUPPE = 'zustaende';

export type ZustandArt = 'gut' | 'schlecht' | 'kritisch';

/** Handgezeichnete Rahmen (Kontur `k`, Rand `<` oben / `>` unten, Grund `=`). */
export const RAHMEN: Readonly<Record<ZustandArt, string>> = {
  gut: `................
     .....kkkkkk.....
     ...kk<<<<<<kk...
     ..k<<======<<k..
     ..k<========<k..
     .k<==========<k.
     .k<==========<k.
     .k<==========<k.
     .k>==========>k.
     .k>==========>k.
     .k>==========>k.
     ..k>========>k..
     ..k>>======>>k..
     ...kk>>>>>>kk...
     .....kkkkkk.....
     ................`,
  schlecht: `................
     ..kkkkkkkkkkkk..
     .k<<<<<<<<<<<<k.
     .k<==========<k.
     .k<==========<k.
     .k<==========<k.
     .k<==========<k.
     .k<==========<k.
     .k>==========>k.
     .k>==========>k.
     .k>==========>k.
     .k>==========>k.
     .k>==========>k.
     .k>>>>>>>>>>>>k.
     ..kkkkkkkkkkkk..
     ................`,
  kritisch: `................
     .......kk.......
     ......k<<k......
     .....k<==<k.....
     ....k<====<k....
     ...k<======<k...
     ..k<========<k..
     .k<==========<k.
     .k>==========>k.
     ..k>========>k..
     ...k>======>k...
     ....k>====>k....
     .....k>==>k.....
     ......k>>k......
     .......kk.......
     ................`,
};

/** Rahmenfarben je Art; Frame 1 von `kritisch` ist der helle Puls. */
const FARBEN: Readonly<Record<ZustandArt, ReadonlyArray<Readonly<Record<'<' | '>' | '=', string>>>>> = {
  gut: [{ '<': 'sand.4', '>': 'sand.2', '=': 'wasser.1' }],
  schlecht: [{ '<': 'laub.2', '>': 'laub.1', '=': 'laub.0' }],
  kritisch: [
    { '<': 'feuer.3', '>': 'feuer.2', '=': 'nacht.0' },
    { '<': 'feuer.5', '>': 'feuer.4', '=': 'nacht.0' },
  ],
};

/** Takt des Pulses kritischer Zustände (Bilder je Sekunde). */
export const PULS_FPS = 4;

/** Zellgröße (wie Item-Icons, docs/ART.md §3). */
const GROESSE = 16;

function zeilen(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Legt das Motiv über den Rahmen (`.` im Motiv lässt den Rahmen stehen). */
export function ueberlagere(rahmen: string, motiv: string): string {
  const r = zeilen(rahmen);
  const m = zeilen(motiv);
  if (r.length !== GROESSE || m.length !== GROESSE) throw new Error(`Zustands-Raster: ${GROESSE} Zeilen erwartet (Rahmen ${r.length}, Motiv ${m.length})`);
  return r
    .map((zeile, y) => {
      const mz = m[y] ?? '';
      if (mz.length !== GROESSE || zeile.length !== GROESSE) throw new Error(`Zustands-Raster Zeile ${y}: ${GROESSE} Zeichen erwartet (Motiv „${mz}“)`);
      return [...zeile].map((c, x) => (mz[x] === '.' ? c : (mz[x] ?? c))).join('');
    })
    .join('\n');
}

export interface ZustandOptionen {
  readonly legende?: Readonly<Record<string, string>>;
  readonly einzelpixel?: string;
}

/** Zustands-Icon `zustand_<id>`: Rahmen der Art + Motiv. */
export function zustand(id: string, art: ZustandArt, motiv: string, o: ZustandOptionen = {}): Sprite {
  const farben = FARBEN[art];
  const raster = ueberlagere(RAHMEN[art], motiv);
  // Jede Farbvariante des Rahmens ist ein eigener Frame. Ein Legendenzeichen steht für genau eine Farbe,
  // deshalb bekommt jeder Frame eigene Ersatzzeichen für `<`, `>` und `=`.
  const ersatz = ['<>=', '{}|'] as const;
  const legende: Record<string, string | null> = { ...ICON_LEGENDE, ...o.legende };
  const frames = farben.map((f, i) => {
    const z = ersatz[i] ?? ersatz[0];
    legende[z[0] as string] = f['<'];
    legende[z[1] as string] = f['>'];
    legende[z[2] as string] = f['='];
    return raster.replace(/[<>=]/g, (c) => (c === '<' ? z[0] : c === '>' ? z[1] : z[2]) as string);
  });
  return sprite({
    id: `zustand_${id}`,
    group: ZUSTAND_GRUPPE,
    size: [GROESSE, GROESSE],
    anchor: [GROESSE / 2, GROESSE / 2],
    hoehe: 'flach',
    legende,
    frames,
    ...(frames.length > 1 ? { clips: { puls: { frames: frames.map((_, i) => i), fps: PULS_FPS, loop: true } } } : {}),
    schatten: 'none',
    occluder: { kind: 'none' },
    ...(o.einzelpixel === undefined ? {} : { einzelpixel: o.einzelpixel }),
  });
}
