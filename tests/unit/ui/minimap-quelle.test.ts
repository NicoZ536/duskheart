/**
 * M3-28 Minimap-Quelle einer Sitzung (src/ui/hud/minimap/quelle.ts) und ihre Symbole im Spielatlas: Die
 * Quelle liest Lage, Blickrichtung, Kalender und Wetter nur lesend, erzeugt Weltplan und Welt nie selbst,
 * liefert residente Chunks und die Marker (Startstrand, Gräber). Jedes Symbol, das Minimap, Kompass und
 * Meldungen zeichnen, liegt im Atlas (16×16; Mond acht Phasen, Pfeil acht Richtungen, Zustands-Icons für
 * jede Warnstufe).
 */
import { describe, expect, it } from 'vitest';
import { SPRITES } from '../../../src/generated/atlas';
import { WEATHER_STATE_IDS } from '../../../src/content/weather';
import { GameSession } from '../../../src/game/session';
import { TILE_PX, tileToChunk } from '../../../src/world/model/coords';
import { WARN_STUFEN } from '../../../src/ui/hud/meldungen/inhalte';
import { neueMinimapLage, type KartenMarker } from '../../../src/ui/hud/minimap/lage';
import { WETTER_KLAR_NACHT, WETTER_SYMBOL } from '../../../src/ui/hud/minimap/Minimap';
import { minimapQuelle } from '../../../src/ui/hud/minimap/quelle';
import { MARKER_SYMBOL, MOND_SYMBOL, SONNE_SYMBOL, SPIELER_SYMBOL } from '../../../src/ui/hud/minimap/zeichnung';

const SEED = 20_260_923;

describe('Minimap-Quelle einer Sitzung', () => {
  it('ohne Figur: Kalender und Uhr, kein Wetter, keine Welt erzeugt', () => {
    const s = new GameSession({ config: { seed: SEED, worldSize: 'small' } });
    const q = minimapQuelle(s);
    const l = q.lage(neueMinimapLage());
    expect(l.vorhanden).toBe(false);
    expect(l.wetter).toBeNull();
    expect([l.tag, l.jahreszeit, l.tagDerJahreszeit]).toEqual([1, 'fruehling', 1]);
    expect(l.sonnenaufgang).toBeLessThan(l.sonnenuntergang);
    expect(l.morgenBeginn).toBeLessThan(l.sonnenaufgang);
    expect(l.nachtBeginn).toBeGreaterThan(l.sonnenuntergang);
    expect(q.chunk(0, 0, 0)).toBeUndefined();
    expect(q.marker()).toEqual([]);
    // Nur gelesen: weder Weltplan noch Welt entstanden.
    expect(s.sim.world.planned).toBe(false);
    expect(s.sim.world.materialized).toBe(false);
  });

  it('mit Spieler: Lage in Kacheln, Blickrichtung, Wetter am Standort, Chunks und Marker', () => {
    const s = new GameSession({ config: { seed: SEED, worldSize: 'small' } });
    const grab: KartenMarker = { art: 'grab', x: 3.5, y: 4.5, ebene: 0 };
    const q = minimapQuelle(s, { graeber: () => [grab] });
    s.command({ type: 'player.spawn' });
    s.step();
    s.command({ type: 'player.move', dx: 0, dy: -1 });
    s.step();
    s.command({ type: 'player.move', dx: 0, dy: 0 });
    s.command({ type: 'setWeather', state: 'regen' });
    s.command({ type: 'setTime', hour: 21, minute: 30 });
    s.step();
    const l = q.lage(neueMinimapLage());
    const dbg = s.debugState();
    expect(l.vorhanden).toBe(true);
    expect(l.x).toBeCloseTo((dbg.player?.x ?? 0) / TILE_PX, 5);
    expect(l.y).toBeCloseTo((dbg.player?.y ?? 0) / TILE_PX, 5);
    expect(l.ebene).toBe(0);
    expect(l.richtung).toBe(0);
    expect(l.minute).toBe(21 * 60 + 30);
    expect(l.mondphase).toBe(dbg.world.moonPhase);
    expect(l.wetter).toBe(dbg.world.weather?.state ?? null);
    expect(l.wetter).toBe('regen');
    const cx = tileToChunk(Math.floor(l.x));
    const cy = tileToChunk(Math.floor(l.y));
    expect(q.chunk(0, cx, cy)).toBe(s.sim.world.chunks.get(0, cx, cy));
    const spawn = s.sim.world.generated.spawn;
    expect(q.marker()).toEqual([{ art: 'startstrand', x: spawn.x + 0.5, y: spawn.y + 0.5, ebene: 0 }, grab]);
  });

  it('im Spiel markiert die Minimap das Grab des Spielers, bis es geleert ist (§11.6), ohne `graeber` von außen', () => {
    const s = new GameSession({ config: { seed: SEED, worldSize: 'small' } });
    const q = minimapQuelle(s);
    s.command({ type: 'player.spawn' });
    s.step();
    s.command({ type: 'inventory.give', item: 'feuerstein', count: 3 });
    s.step();
    const at = s.debugState().player;
    s.command({ type: 'death.kill' });
    s.step();
    s.step();
    const marken = q.marker().filter((m) => m.art === 'grab');
    expect(marken).toHaveLength(1);
    expect(marken[0]?.x).toBeCloseTo((at?.x ?? 0) / TILE_PX, 5);
    expect(marken[0]?.y).toBeCloseTo((at?.y ?? 0) / TILE_PX, 5);
    expect(marken[0]?.ebene).toBe(0);
    // Wiedereinstieg am Strand, das Grab geleert: der Marker verschwindet.
    s.command({ type: 'death.respawn' });
    s.step();
    s.command({ type: 'player.teleport', x: at?.x ?? 0, y: at?.y ?? 0, layer: 0 });
    s.step();
    const grab = s.sim.system('death') as unknown as { state: { graves: ReadonlyArray<{ id: number }> } };
    s.command({ type: 'death.lootGrave', grave: grab.state.graves[0]?.id ?? -1 });
    s.step();
    expect(q.marker().filter((m) => m.art === 'grab')).toEqual([]);
  });

  it('Blickrichtung folgt der Figur (Süden, Westen)', () => {
    const s = new GameSession({ config: { seed: SEED, worldSize: 'small' } });
    const q = minimapQuelle(s);
    s.command({ type: 'player.spawn' });
    s.step();
    const l = neueMinimapLage();
    for (const [dx, dy, grad] of [
      [0, 1, 180],
      [-1, 0, 270],
    ] as const) {
      s.command({ type: 'player.move', dx, dy });
      s.step();
      expect(q.lage(l).richtung).toBe(grad);
    }
  });
});

describe('HUD-Symbole im Spielatlas', () => {
  const sprite = (id: string) => (SPRITES as Readonly<Record<string, { size: readonly [number, number]; frames: readonly unknown[] }>>)[id];

  it('Wetter (jeder Zustand und die klare Nacht), Gestirne, Pfeil, Marker, Meldungen: 16×16', () => {
    const ids = [
      ...WEATHER_STATE_IDS.map((w) => WETTER_SYMBOL[w]),
      WETTER_KLAR_NACHT,
      SONNE_SYMBOL,
      MOND_SYMBOL,
      SPIELER_SYMBOL,
      ...Object.values(MARKER_SYMBOL),
      'ui_meldung_dunkelheit',
      'ui_meldung_entdeckung',
      'ui_meldung_taschen_voll',
    ];
    for (const id of ids) {
      expect(sprite(id), id).toBeDefined();
      expect(sprite(id)?.size, id).toEqual([16, 16]);
    }
    expect(sprite(MOND_SYMBOL)?.frames).toHaveLength(8);
    expect(sprite(SPIELER_SYMBOL)?.frames).toHaveLength(8);
  });

  it('jede Warnstufe hat ihr Zustands-Icon', () => {
    for (const stufe of WARN_STUFEN) expect(sprite(`zustand_${stufe}`), stufe).toBeDefined();
  });
});
