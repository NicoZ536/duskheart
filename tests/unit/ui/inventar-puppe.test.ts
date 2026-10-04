/**
 * M6-42: the paper doll of the inventory (src/ui/screens/inventar/puppe.ts) – the helmet on the head socket, overlays on the
 * body's frame, the shipwrecked's own clothes only where no worn piece covers the layer, the rig's draw order; checked with
 * fixtures and with the game atlas (the same sprites the game view draws).
 */
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../../../src/content/items/index';
import type { ItemDef } from '../../../src/content/schema/item';
import { SPRITES } from '../../../src/generated/atlas';
import { FIGURE_LAYER_ORDER, SLOT_SOCKET } from '../../../src/render/anim/figure';
import { PLAYER_BODY_SPRITE, START_CLOTHING } from '../../../src/render/game/playerFigure';
import { DOLL_CLIP, dollLayers, dollPlacements, wornDollPieces, type DollSlot, type DollSprite } from '../../../src/ui/screens/inventar/puppe';

const item = (id: string): ItemDef => {
  const def = ITEMS.find((i) => i.id === id);
  if (def === undefined) throw new Error(`item ${id} missing`);
  return def;
};
const wearing = (slots: Partial<Record<DollSlot, string>>) => (slot: DollSlot) => (slots[slot] === undefined ? undefined : item(slots[slot]));

/** A fake atlas: a 32×32 body with a head socket per frame, a 32×32 tunic, a 19×19 helmet with anchor [9, 9]. */
const FAKE: Readonly<Record<string, DollSprite>> = {
  koerper: { size: [32, 32], anchor: [16, 31], sockets: { kopf: [[16, 13], [16, 14], [15, 12]] }, frames: { length: 3 }, clips: { idle_down: { frames: [2, 0, 1] } } },
  ausruestung_leinentunika: { size: [32, 32], anchor: [16, 31], sockets: {}, frames: { length: 3 }, clips: {} },
  ausruestung_leinenhose: { size: [32, 32], anchor: [16, 31], sockets: {}, frames: { length: 3 }, clips: {} },
  ausruestung_helm: { size: [19, 19], anchor: [9, 9], sockets: {}, frames: { length: 2 }, clips: { idle_down: { frames: [1, 1] }, down: { frames: [0] } } },
  ausruestung_kappe: { size: [19, 19], anchor: [9, 8], sockets: {}, frames: { length: 1 }, clips: { down: { frames: [0] } } },
  ausruestung_klein: { size: [16, 16], anchor: [8, 15], sockets: {}, frames: { length: 3 }, clips: {} },
};
const find = (id: string): DollSprite | undefined => FAKE[id];

describe('Papierpuppe: Schichten', () => {
  it('ohne Rüstung trägt die Figur ihre eigene Kleidung (Hose unter der Tunika)', () => {
    expect(dollLayers({})).toEqual([
      { slot: 'beine', sprite: 'ausruestung_leinenhose' },
      { slot: 'koerper', sprite: 'ausruestung_leinentunika' },
    ]);
    expect(START_CLOTHING.map((c) => c.sprite).sort()).toEqual(['ausruestung_leinenhose', 'ausruestung_leinentunika']);
  });

  it('getragene Rüstung ersetzt die Startkleidung ihrer Schicht, der Helm kommt zuletzt (Reihenfolge des Rigs)', () => {
    const pieces = wornDollPieces(wearing({ kopf: 'bronzehelm', brust: 'lederwams', fuesse: 'lederstiefel' }));
    expect(pieces).toEqual({ kopf: 'bronzehelm', koerper: 'lederwams', fuesse: 'lederstiefel' });
    const layers = dollLayers(pieces);
    expect(layers).toEqual([
      { slot: 'beine', sprite: 'ausruestung_leinenhose' },
      { slot: 'fuesse', sprite: 'ausruestung_lederstiefel' },
      { slot: 'koerper', sprite: 'ausruestung_lederwams' },
      { slot: 'kopf', sprite: 'ausruestung_bronzehelm' },
    ]);
    expect(layers.some((l) => l.sprite === 'ausruestung_leinentunika')).toBe(false);
    // The order is the rig's facing the viewer.
    const order = FIGURE_LAYER_ORDER.down;
    const idx = layers.map((l) => order.indexOf(l.slot));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    // Full set: nothing of the own clothes is left.
    const full = dollLayers(wornDollPieces(wearing({ kopf: 'lederkappe', brust: 'lederwams', beine: 'lederhose', fuesse: 'lederstiefel' })));
    expect(full.map((l) => l.sprite)).toEqual(['ausruestung_lederhose', 'ausruestung_lederstiefel', 'ausruestung_lederwams', 'ausruestung_lederkappe']);
  });

  it('nur was auf seiner Schicht gezeichnet wird: Schmuck, Schild und Rucksack nicht', () => {
    expect(wornDollPieces(wearing({ kopf: 'holzschild' }))).toEqual({});
  });
});

describe('Papierpuppe: Platzierung', () => {
  it('der Helm sitzt mit seinem Anker auf dem Kopfsockel des Körperbilds, Overlays teilen das Körperbild', () => {
    const placed = dollPlacements(find, 'koerper', [
      { slot: 'koerper', sprite: 'ausruestung_leinentunika' },
      { slot: 'kopf', sprite: 'ausruestung_helm' },
    ]);
    // Body: first frame of idle_down (2); its head socket there is (15, 12).
    expect(placed).toEqual([
      { sprite: 'koerper', frame: 2, x: 0, y: 0 },
      { sprite: 'ausruestung_leinentunika', frame: 2, x: 0, y: 0 },
      { sprite: 'ausruestung_helm', frame: 1, x: 15 - 9, y: 12 - 9 },
    ]);
    expect(SLOT_SOCKET.kopf).toBe('kopf');
  });

  it('ein Helm ohne Clip der Aktion zeigt seinen Halteclip; falsche Zellgröße und fehlende Sprites fallen weg', () => {
    const placed = dollPlacements(find, 'koerper', [
      { slot: 'beine', sprite: 'ausruestung_klein' },
      { slot: 'koerper', sprite: 'ausruestung_fehlt' },
      { slot: 'kopf', sprite: 'ausruestung_kappe' },
    ]);
    expect(placed).toEqual([
      { sprite: 'koerper', frame: 2, x: 0, y: 0 },
      { sprite: 'ausruestung_kappe', frame: 0, x: 15 - 9, y: 12 - 8 },
    ]);
    expect(dollPlacements(find, 'fehlt', [])).toEqual([]);
    expect(dollPlacements(find, 'koerper', [], 'walk_down')).toEqual([]);
  });

  it('mit dem Spielatlas: der Bronzehelm sitzt auf dem Kopf der Figur, nicht über ihrer ganzen Zelle', () => {
    const sprites: Readonly<Record<string, DollSprite | undefined>> = SPRITES;
    const atlas = (id: string): DollSprite | undefined => sprites[id];
    const body = atlas(PLAYER_BODY_SPRITE);
    expect(body).toBeDefined();
    const helm = atlas('ausruestung_bronzehelm');
    expect(helm).toBeDefined();
    if (body === undefined || helm === undefined) return;
    // The helmet is a small socket sprite (a 32×32 overlay would have been drawn by the old doll – or left out).
    expect(helm.size[0]).toBeLessThan(body.size[0]);
    const layers = dollLayers(wornDollPieces(wearing({ kopf: 'bronzehelm', brust: 'bronzebrustpanzer', beine: 'bronzebeinschienen', fuesse: 'bronzestiefel' })));
    const placed = dollPlacements(atlas, PLAYER_BODY_SPRITE, layers);
    expect(placed.map((p) => p.sprite)).toEqual([PLAYER_BODY_SPRITE, 'ausruestung_bronzebeinschienen', 'ausruestung_bronzestiefel', 'ausruestung_bronzebrustpanzer', 'ausruestung_bronzehelm']);
    const frame = body.clips[DOLL_CLIP]?.frames[0] ?? -1;
    const socket = body.sockets.kopf?.[frame];
    expect(socket).toBeDefined();
    const helmPlaced = placed.at(-1);
    expect(helmPlaced).toEqual({ sprite: 'ausruestung_bronzehelm', frame: helm.clips[DOLL_CLIP]?.frames[0] ?? 0, x: (socket?.[0] ?? 0) - helm.anchor[0], y: (socket?.[1] ?? 0) - helm.anchor[1] });
    // The helmet covers the head: its cell lies in the upper half of the body's cell.
    expect(helmPlaced?.y ?? 99).toBeLessThan(body.size[1] / 2);
  });
});
