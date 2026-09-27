/**
 * Sprite-Namenskonventionen des Bauens (docs/SPIEL.md §8 „Sprites“; M4-13, M4-19 … M4-21): Das Spiel bildet die
 * Sprite-Ids platzierter Bauteile und Stationen aus ihren Content-Ids – modulare Bauteile `bau_<id>` (das Tor dazu
 * `bau_<id>_seite`, die Falltür `bau_<id>_klappe`), Möbel, Kisten und Herdfeuer `obj_<id>`, Stationen `obj_<id>`.
 * Der Content-Validator zählt genau diese Sprites als verwendet (`conventionSpriteIds`), damit sie nicht als
 * „nirgends verwendet“ warnen – und nur solche, die die Spielansicht wirklich so auflöst
 * (src/render/game/building.ts, ghost.ts). Dazu die Symbole der Glutkern-Nischen des Herdfeuerbildschirms (M4-20):
 * er lädt `icon_<kern>` je Nische mit berechneter Id aus `BALANCE.hearth.coreItems` – die Glutkerne selbst sind noch
 * keine Items (sie kommen mit den Leuchtfeuern in M7).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { itemIconId, ITEMS } from '../../../src/content/items/index';
import { buildPartSecondSpriteId, buildPartSpriteId, OBJECT_SPRITE_KINDS, PART_KINDS } from '../../../src/content/buildParts';
import { ALL_BUILD_PARTS } from '../../../src/content/buildPartsAlle';
import { CONTENT } from '../../../src/content/index';
import { STATIONS, stationSpriteId } from '../../../src/content/stations';
import { generatedAtlasModule } from '../../../src/render/assets/generated';
import { partSecondSpriteId, partSpriteId } from '../../../src/render/game/building';
import { conventionSpriteIds } from '../../../tools/validator/checks';

describe('Sprites der Bauteile und Stationen', () => {
  it('modulare Bauteile bau_<id>, Möbel obj_<id>; Tor und Falltür haben ein zweites Sprite', () => {
    expect(buildPartSpriteId('wand_holz', 'wand')).toBe('bau_wand_holz');
    expect(buildPartSpriteId('tisch_holz', 'moebel')).toBe('obj_tisch_holz');
    expect(buildPartSpriteId('harzlampe_wand', 'wandmoebel')).toBe('obj_harzlampe_wand');
    expect(buildPartSecondSpriteId('tor_holz', 'tor')).toBe('bau_tor_holz_seite');
    expect(buildPartSecondSpriteId('falltuer_holz', 'falltuer')).toBe('bau_falltuer_holz_klappe');
    expect(PART_KINDS.filter((k) => buildPartSecondSpriteId('x', k) !== null)).toEqual(['falltuer', 'tor']);
    expect(OBJECT_SPRITE_KINDS).toEqual(['moebel', 'wandmoebel']);
    expect(stationSpriteId('werkbank_2')).toBe('obj_werkbank_2');
  });

  it('die Spielansicht löst jedes Bauteil der Registry unter demselben Namen auf', () => {
    expect(ALL_BUILD_PARTS.map((p) => p.id)).toEqual(CONTENT.collection('buildParts').ids());
    for (const p of ALL_BUILD_PARTS) {
      expect(partSpriteId({ id: p.id, kind: p.art }), p.id).toBe(buildPartSpriteId(p.id, p.art));
      expect(partSecondSpriteId({ id: p.id, kind: p.art }), p.id).toBe(buildPartSecondSpriteId(p.id, p.art));
    }
  });

  it('der Validator zählt Bauteil- und Stations-Sprites als verwendet, nichts darüber hinaus', () => {
    const ids = new Set(conventionSpriteIds());
    for (const p of ALL_BUILD_PARTS) expect(ids.has(buildPartSpriteId(p.id, p.art)), p.id).toBe(true);
    for (const s of STATIONS) expect(ids.has(stationSpriteId(s.id)), s.id).toBe(true);
    // Structure, the gate's side and the trapdoor's flap; furniture, wall objects, storage, the hearth; stations.
    for (const id of ['bau_wand_holz', 'bau_dach_stroh', 'bau_tor_holz_seite', 'bau_falltuer_holz_klappe', 'obj_tisch_holz', 'obj_harzlampe_wand', 'obj_truhe', 'obj_kiste_holz', 'obj_lagerregal', 'obj_herdfeuer', 'obj_lagerfeuer', 'obj_werkbank_2']) {
      expect(ids.has(id), id).toBe(true);
    }
    // No other kind of name: no `obj_` for structure, no `bau_` for furniture, no second sprite for a plain door;
    // the ember core insert has no convention (the game view names it once it draws the hearth's sockets).
    for (const id of ['obj_wand_holz', 'bau_tisch_holz', 'bau_tuer_holz_seite', 'bau_tor_holz_klappe', 'obj_herdfeuer_glutkern']) expect(ids.has(id), id).toBe(false);
  });

  it('die Glutkern-Symbole der Herdfeuer-Nischen zählen als verwendet – abgeleitet aus BALANCE.hearth.coreItems, jede Id ein vorhandenes Sprite', () => {
    const ids = new Set(conventionSpriteIds());
    expect(BALANCE.hearth.coreItems.length).toBeGreaterThan(0);
    for (const kern of BALANCE.hearth.coreItems) expect(ids.has(itemIconId(kern)), kern).toBe(true);
    expect(ids.has('icon_glutkern_1')).toBe(true);
    expect(ids.has(`icon_glutkern_${BALANCE.hearth.coreItems.length + 1}`)).toBe(false);
    // Not by being items: the cores have no item yet (the convention of items would not cover their icons).
    for (const kern of BALANCE.hearth.coreItems) expect(ITEMS.some((i) => i.id === kern), kern).toBe(false);
    // Each is a sprite of the game atlas (the screen shows it; the validator's sprite check skips convention ids).
    const atlas = generatedAtlasModule();
    expect(atlas).not.toBeNull();
    for (const kern of BALANCE.hearth.coreItems) expect(atlas?.SPRITES[itemIconId(kern)], kern).toBeDefined();
  });
});
