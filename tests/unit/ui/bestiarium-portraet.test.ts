/**
 * Die Porträts des Bestiariums (M7-108; MASTERPROMPT §23.3 „Bestiarium“, §20.1; src/ui/screens/chronik/ChronikScreen.tsx
 * `KreaturPortraet`): jede Kreatur hat ein Porträt – ihre Standpose zum Betrachter (`kreatur_<id>`, erstes Bild von
 * `idle_down`), so wie das Papierpuppen-Bild es zusammensetzt (`dollPlacements` ohne Schichten: nur der Körper) –, und ihre
 * gedeckten Pixel passen 1 : 1 in den Rahmen von vier Seitenzeilen über seiner Bodenlinie: keine Kreatur wird beschnitten
 * oder verkleinert, und die Seite scrollt weiter in ganzen Zeilen.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import { creatureSpriteId } from '../../../src/content/creatures/schema';
import { generatedAtlasModule } from '../../../src/render/assets/generated';
import { PORTRAET_PX } from '../../../src/ui/screens/chronik/modell';
import { DOLL_CLIP, dollPlacements } from '../../../src/ui/screens/inventar/puppe';
import { decodePng } from '../../../tools/lib/png';

const MOD = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return mod;
})();
const ALBEDO = decodePng(readFileSync(new URL(`../../../public/${MOD.ATLAS.albedoUrl}`, import.meta.url)));
const CSS = readFileSync(new URL('../../../src/ui/screens/chronik/chronik.css', import.meta.url), 'utf8');
/** Height of a line of the chronicle's page [design px] (`.dh-chronik__tafel` line-height). */
const ZEILE = Number(/line-height: calc\((\d+)px \* var\(--dh-ui-scale\)\)/.exec(CSS)?.[1]);
/** The frame's floor rule [design px] (`.dh-chronik__portraet` border-bottom). */
const BODEN = Number(/\.dh-chronik__portraet \{[^}]*border-bottom: calc\((\d+)px/.exec(CSS)?.[1]);

/** The covered pixels of atlas rectangle `r`: their bounding box. */
function gedeckt(r: { x: number; y: number; w: number; h: number }): { w: number; h: number } {
  let x0 = r.w;
  let y0 = r.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      if ((ALBEDO.rgba[((r.y + y) * ALBEDO.width + r.x + x) * 4 + 3] ?? 0) === 0) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return x1 < 0 ? { w: 0, h: 0 } : { w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

describe('Bestiarium: Porträts der Kreaturen (M7-108)', () => {
  it('der Rahmen ist vier Seitenzeilen hoch (die Seite scrollt in ganzen Zeilen)', () => {
    expect(ZEILE).toBe(11);
    expect(PORTRAET_PX % ZEILE).toBe(0);
    expect(PORTRAET_PX / ZEILE).toBe(4);
    expect(BODEN).toBe(1);
  });

  it('jede Kreatur hat ihr Porträt: die Standpose zum Betrachter, 1 : 1 im Rahmen über der Bodenlinie', () => {
    const kreaturen = CONTENT.collection('creatures').values();
    expect(kreaturen.length).toBeGreaterThanOrEqual(29);
    const groessen: Record<string, string> = {};
    for (const c of kreaturen) {
      const id = creatureSpriteId(c.id);
      const placed = dollPlacements((s) => MOD.SPRITES[s], id, []);
      // The body alone, at the first frame of its standing pose facing the viewer.
      const body = MOD.SPRITES[id];
      expect(placed, c.id).toEqual([{ sprite: id, frame: body?.clips[DOLL_CLIP]?.frames[0], x: 0, y: 0 }]);
      const rect = body?.frames[placed[0]?.frame ?? -1];
      if (rect === undefined) throw new Error(`${c.id}: kein Bild`);
      const g = gedeckt(rect);
      expect(g.w, c.id).toBeGreaterThan(0);
      expect(g.w, c.id).toBeLessThanOrEqual(PORTRAET_PX);
      expect(g.h, c.id).toBeLessThanOrEqual(PORTRAET_PX - BODEN);
      groessen[c.id] = `${g.w}x${g.h}`;
    }
    // The sizes keep to each other: the hare small, the root warden filling the frame.
    expect(groessen['hase']).toBe('10x12');
    expect(groessen['wurzelhueter']).toBe('41x43');
  });
});
