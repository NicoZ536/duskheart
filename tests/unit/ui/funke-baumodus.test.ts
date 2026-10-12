/**
 * Funke und Hinweisschild im Baumodus (M7-134; MASTERPROMPT §26 „HUD“, docs/SPIEL.md §21 Baumodus): außerhalb des Baumodus
 * stehen Funke und der Kontext-Hinweis links unter den Überlebenswerten; im Baumodus stehen dort die Overlay-Schalter, und die
 * Schilder reichten über die Figur und die Weltlabels (`bau-vorschau`, `bau-abbauen-rot`, `bau-aufwerten`, `bau-blaupause`).
 * Dann stehen sie oben rechts neben der Werte-Reihe, auf ihrer Höhe, zwischen Werten und Minimap; Bossleiste und
 * Ereigniszeilen rücken darunter. Die Komponente misst beide Plätze (src/ui/hud/funke/Funke.tsx `fuehrungsLage`), das
 * Stylesheet wählt (src/ui/hud/funke/funke.css, Klasse `dh-hud--bau` des HUD).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fuehrungsLage } from '../../../src/ui/hud/funke/Funke';

const CSS = readFileSync(new URL('../../../src/ui/hud/funke/funke.css', import.meta.url), 'utf8');

/** The declarations of the rule with exactly `selector` (whitespace-normalised), or null. */
function regel(selector: string): string | null {
  const norm = CSS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
  const at = norm.indexOf(`${selector} {`);
  if (at < 0) return null;
  const start = norm.indexOf('{', at) + 1;
  return norm.slice(start, norm.indexOf('}', start)).trim();
}

describe('Plätze der Führungsspalte (Funke.tsx `fuehrungsLage`)', () => {
  it('unter den Werten (ihre Unterkante) und auf Höhe ihrer Reihe, an deren rechtem Rand', () => {
    // The values' box 12 px from the HUD's top and 8 px from its left, 46 px high (the row and the conditions below it); its
    // row 4 px into the box, 6 px from its left, 180 px wide.
    const lage = fuehrungsLage({ offsetTop: 12, offsetLeft: 8, offsetHeight: 46 }, { offsetTop: 4, offsetLeft: 6, offsetWidth: 180 });
    expect(lage).toEqual({ unten: 58, oben: 16, rechts: 194 });
    // More conditions make the box taller: the place below moves down, the one beside the row stays.
    const hoeher = fuehrungsLage({ offsetTop: 12, offsetLeft: 8, offsetHeight: 70 }, { offsetTop: 4, offsetLeft: 6, offsetWidth: 180 });
    expect(hoeher).toEqual({ unten: 82, oben: 16, rechts: 194 });
  });
});

describe('Stylesheet (funke.css): außerhalb des Baumodus darunter, im Baumodus daneben', () => {
  it('die Spalte steht an der gemessenen Unterkante; im Baumodus oben rechts neben der Reihe, ohne Abstand nach oben', () => {
    expect(regel('.dh-hud-fuehrung')).toContain('top: var(--dh-fuehrung-unten, 0px)');
    const bau = regel('.dh-hud--bau .dh-hud-fuehrung');
    expect(bau).not.toBeNull();
    expect(bau).toContain('top: var(--dh-fuehrung-oben, 0px)');
    expect(bau).toContain('left: calc(var(--dh-fuehrung-rechts, 0px)');
    expect(bau).toContain('margin-top: 0');
  });

  it('Bossleiste und Ereigniszeilen rücken im Baumodus unter die zwei Schilder (je zwei Zeilen: bis 58 px)', () => {
    const unter = regel('.dh-hud--bau .dh-hud-fuehrung ~ .dh-hud-boss, .dh-hud--bau .dh-hud-fuehrung ~ .dh-hud-ereignisse');
    expect(unter).toBe('top: calc(62px * var(--dh-ui-scale));');
    // With a boss bar the event lines go below it as well.
    expect(regel('.dh-hud--bau .dh-hud-fuehrung ~ .dh-hud-boss ~ .dh-hud-ereignisse')).toBe('top: calc(90px * var(--dh-ui-scale));');
  });
});
