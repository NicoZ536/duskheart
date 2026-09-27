/**
 * M4-24 in the build mode: the line of the blueprints in view (src/ui/screens/bau/blaupausen.ts, Blaupausen.tsx)
 * and the session's sample behind it (`GameSession.sampleBlueprintNeeds`, src/game/samples/basis.ts) – the view
 * around the player in tiles by the window's aspect, "Blaupausen brauchen noch: 4× Holzwand …" while pieces are
 * missing (most missing first, at most three names), "Material da" once the bags and nearby chests hold them all,
 * nothing without blueprints; on a real session the sample counts the blueprints within the view (not one beyond
 * it), what the bags hold for them, and only counts a change when something changed.
 */
import { describe, expect, it } from 'vitest';
import { createBlueprintNeedsSample } from '../../../src/game/samples/basis';
import { BOOT_SESSION_SEED, GameSession } from '../../../src/game/session';
import { createI18n } from '../../../src/i18n';
import { TILE_PX } from '../../../src/world/model/coords';
import { blaupausenBereich, blaupausenZeile, NAMEN_MAX } from '../../../src/ui/screens/bau/blaupausen';

const de = createI18n('de', { strict: true });
const en = createI18n('en', { strict: true });
const NAMEN: Record<string, string> = { wand_holz: 'Holzwand', dach_stroh: 'Strohdach', boden_holz: 'Holzboden', tuer_holz: 'Holztür', fenster_offen: 'Fensteröffnung' };
const name = (part: string): string => NAMEN[part] ?? part;
const FULL_SIM_TIMEOUT_MS = 30_000;

describe('Zeile der Blaupausen', () => {
  it('ohne Blaupausen keine Zeile', () => {
    expect(blaupausenZeile(de, [], name)).toBeNull();
  });

  it('nennt, was fehlt – die meisten fehlenden zuerst', () => {
    const z = blaupausenZeile(
      de,
      [
        { part: 'dach_stroh', blueprints: 2, atHand: 0, missing: 2 },
        { part: 'wand_holz', blueprints: 6, atHand: 2, missing: 4 },
        { part: 'boden_holz', blueprints: 3, atHand: 3, missing: 0 },
      ],
      name,
    );
    expect(z).toEqual({ text: 'Blaupausen brauchen noch: 4× Holzwand, 2× Strohdach', fehlt: true });
  });

  it(`höchstens ${NAMEN_MAX} Namen, dann „und n weitere“`, () => {
    const bedarf = ['boden_holz', 'dach_stroh', 'fenster_offen', 'tuer_holz', 'wand_holz'].map((part) => ({ part, blueprints: 1, atHand: 0, missing: 1 }));
    expect(blaupausenZeile(de, bedarf, name)?.text).toBe('Blaupausen brauchen noch: 1× Holzboden, 1× Strohdach, 1× Fensteröffnung und 2 weitere');
    expect(blaupausenZeile(en, bedarf, name)?.text).toBe('Blueprints still need: 1× Holzboden, 1× Strohdach, 1× Fensteröffnung and 2 more');
  });

  it('ist alles da, sagt sie, dass der Hammer sie fertigstellt', () => {
    expect(blaupausenZeile(de, [{ part: 'wand_holz', blueprints: 4, atHand: 5, missing: 0 }], name)).toEqual({ text: '4 Blaupausen: Material da – mit dem Hammer in der Hand fertigstellen.', fehlt: false });
    expect(blaupausenZeile(en, [{ part: 'wand_holz', blueprints: 1, atHand: 1, missing: 0 }], name)?.text).toBe('Blueprint: materials at hand – finish it with a hammer in your hand.');
  });
});

describe('Sichtbereich', () => {
  it('die halbe interne Ansicht in Kacheln (270 px hoch, 360–640 px breit nach dem Seitenverhältnis)', () => {
    expect(blaupausenBereich(1920, 1080)).toEqual({ halbB: 15, halbH: 9 });
    expect(blaupausenBereich(1280, 720)).toEqual({ halbB: 15, halbH: 9 });
    expect(blaupausenBereich(3440, 1440)).toEqual({ halbB: 20, halbH: 9 });
    expect(blaupausenBereich(1000, 1000)).toEqual({ halbB: 12, halbH: 9 });
  });
});

describe('Abtastung der Blaupausen', () => {
  it(
    'zählt die Blaupausen im Blick, was die Taschen für sie halten, und meldet Änderungen nur, wenn sich etwas ändert',
    () => {
      const s = new GameSession({ config: { seed: BOOT_SESSION_SEED } });
      s.command({ type: 'player.spawn' });
      s.step();
      const at = s.debugState().player;
      if (at === null) throw new Error('no player');
      const tx = Math.floor(at.x / TILE_PX);
      const ty = Math.floor(at.y / TILE_PX);
      const out = createBlueprintNeedsSample();
      expect(s.sampleBlueprintNeeds(15, 9, out)).toBe(true);
      expect(out.anzahl).toBe(0);
      // Four wall blueprints north of the player (no material needed to plan them), one tile after the other.
      let placed = 0;
      s.onEvent('partPlaced', (e) => {
        if (e.blueprint) placed++;
      });
      for (let dy = -3; dy >= -6 && placed < 4; dy--) {
        for (let dx = -2; dx <= 2 && placed < 4; dx++) {
          s.command({ type: 'build.blueprint', part: 'wand_holz', tx: tx + dx, ty: ty + dy });
          s.step();
        }
      }
      expect(placed).toBe(4);
      const stand = out.stand;
      s.sampleBlueprintNeeds(15, 9, out);
      expect(out.stand).toBeGreaterThan(stand);
      expect(out.teile.slice(0, out.anzahl)).toEqual([{ part: 'wand_holz', blueprints: 4, atHand: 0, missing: 4 }]);
      expect(blaupausenZeile(de, out.teile.slice(0, out.anzahl), () => 'Holzwand')?.text).toBe('Blaupausen brauchen noch: 4× Holzwand');
      // Nothing changed: no new stand.
      const still = out.stand;
      s.sampleBlueprintNeeds(15, 9, out);
      expect(out.stand).toBe(still);
      // One wall in the bags: three missing.
      s.command({ type: 'inventory.give', item: 'wand_holz', count: 1 });
      s.step();
      s.sampleBlueprintNeeds(15, 9, out);
      expect(out.teile[0]).toEqual({ part: 'wand_holz', blueprints: 4, atHand: 1, missing: 3 });
      // A view too small to reach them: none in view.
      s.sampleBlueprintNeeds(1, 1, out);
      expect(out.anzahl).toBe(0);
      // Far away from them: none in view either.
      s.command({ type: 'player.teleport', x: at.x + 40 * TILE_PX, y: at.y, layer: 0 });
      s.step();
      s.sampleBlueprintNeeds(15, 9, out);
      expect(out.anzahl).toBe(0);
    },
    FULL_SIM_TIMEOUT_MS,
  );
});
