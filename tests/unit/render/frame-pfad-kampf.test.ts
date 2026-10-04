/**
 * Der Frame-Pfad-Bench misst das Spielbild mit Kreaturen (M6-Gate perf:frame-path-creatures; MASTERPROMPT §30 „keine
 * Allokation im Frame-Pfad“; tools/bench/framePath.ts `FIGHT_SCENE`, ADR-0167):
 * - die Szene `spiel-kampf` gehört zu den gemessenen Szenen, mit eigenem Budget von 2 048 B je Frame wie jede Szene;
 * - sie zeigt einen Kampf: mindestens 50 Kreaturen, ein Wolfsrudel (eine Gruppe), Schattenbrut mit Nachtmahr, friedliche
 *   Tiere und Flieger – jede Kreatur aus dem Inhalt und alle im Bild (30 × 17 Kacheln um den Spieler).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import { FIGHT_GROUPS, FIGHT_SCENE } from '../../../tools/bench/framePath';
import { FRAME_PATH_BENCH, framePathMetric } from '../../../tools/bench/render';

/** Half the view around the player [tiles] (480 × 270 internal px). */
const VIEW_HALF = { x: 15, y: 8.5 } as const;

describe('Frame-Pfad im Kampf (`spiel-kampf`)', () => {
  it('ist eine gemessene Szene mit dem Budget 2 048 B je Frame', () => {
    expect(FRAME_PATH_BENCH.scenes).toContain(FIGHT_SCENE);
    const limits = (JSON.parse(readFileSync(join(process.cwd(), 'tools/bench/schwellwerte.json'), 'utf8')) as { schwellwerte: Record<string, { budget: number; einheit: string }> }).schwellwerte;
    const key = `${FRAME_PATH_BENCH.name} · ${framePathMetric(FIGHT_SCENE)}`;
    expect(limits[key]).toMatchObject({ budget: 2048, einheit: 'B' });
  });

  it('zeigt einen Kampf: ≥ 50 Kreaturen im Bild, Rudel, Schattenbrut mit Nachtmahr, Tiere an Land und in der Luft', () => {
    const creatures = CONTENT.collection('creatures');
    let total = 0;
    const families = new Set<string>();
    const movers = new Set<string>();
    for (const [id, count, dx, dy] of FIGHT_GROUPS) {
      const def = creatures.get(id);
      total += count;
      families.add(def.familie);
      movers.add(def.fortbewegung);
      expect(Math.abs(dx), id).toBeLessThan(VIEW_HALF.x);
      expect(Math.abs(dy), id).toBeLessThan(VIEW_HALF.y);
    }
    expect(total).toBeGreaterThanOrEqual(50);
    // One spawn command per group: a group of wolves is one pack.
    expect(FIGHT_GROUPS.some(([id, count]) => id === 'wolf' && count >= 3)).toBe(true);
    expect(FIGHT_GROUPS.some(([id]) => id === 'nachtmahr')).toBe(true);
    expect(families).toContain('schattenbrut');
    expect(families).toContain('friedlich');
    expect(movers).toContain('flieger');
  });
});
