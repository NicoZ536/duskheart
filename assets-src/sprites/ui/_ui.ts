/**
 * Baustein der HUD-Symbole (M3-28 Minimap, Kompassbalken, Tageszeit-Scheibe; M3-29 Meldungen): 16×16-Zellen
 * wie die Item-Icons (docs/ART.md §3 „Icons 16×16, Motiv ≤ 14×14, 1 px Luft“), Gruppe und Kontaktbogen `ui`.
 *
 * Die Symbole liegen im Spielatlas (palettenindiziert) und werden im DOM-Overlay über
 * `src/ui/hud/minimap/spriteBild.ts` mit den Grundfarben der Palette aufgelöst – dieselbe Quelle für die
 * Minimap-Leinwand und für die Symbole in Textzeilen. Sie liegen nie in der Welt: flach, ohne Schatten,
 * ohne Verdecker.
 *
 * Bildsprache (docs/ART.md §2): Kontur `nacht.1` rundum, Oberseiten hell, Unterseiten dunkel (Licht von
 * oben wie bei den Zustands-Icons), Flächen statt Streupixel, höchstens zwölf Farben. Es gilt die
 * gemeinsame Icon-Legende (`../icons/_icon.ts`), damit dieselbe Farbe überall dasselbe Zeichen hat.
 */
import { sprite, type Sprite } from '../../lib/sprite';
import { ICON_LEGENDE } from '../icons/_icon';

/** Kontaktbogen `ui.png`. */
export const UI_GRUPPE = 'ui';
/** Zellgröße (docs/ART.md §3). */
export const UI_SYMBOL_GROESSE = 16;

export interface UiSymbolOptionen {
  /** Bezugspunkt, an dem die Präsentation das Symbol ausrichtet (Standard: Zellmitte links oben [7, 7]). */
  readonly anker?: [number, number];
  /** Begründung für gewollte Einzelpixel (Sterne, Funken). */
  readonly einzelpixel?: string;
  /** Zusätzliche oder ersetzte Legendenzeichen. */
  readonly legende?: Readonly<Record<string, string | null>>;
}

/**
 * Ein HUD-Symbol mit einem oder mehreren Frames (Frames wählt die Präsentation direkt, z. B. Mondphase oder
 * Blickrichtung – kein Clip mit Takt).
 */
export function uiSymbol(id: string, frames: readonly string[], o: UiSymbolOptionen = {}): Sprite {
  return sprite({
    id,
    group: UI_GRUPPE,
    size: [UI_SYMBOL_GROESSE, UI_SYMBOL_GROESSE],
    anchor: o.anker ?? [7, 7],
    hoehe: 'flach',
    legende: { ...ICON_LEGENDE, ...o.legende },
    frames: [...frames],
    schatten: 'none',
    occluder: { kind: 'none' },
    ...(o.einzelpixel === undefined ? {} : { einzelpixel: o.einzelpixel }),
  });
}
