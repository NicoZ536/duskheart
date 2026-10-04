/**
 * M6-16f Lichtkarte ohne Allokation je Kachelauswertung (§30 „Keine Allokationen in Hot-Loops“): vorher legte jede
 * Auswertung an – `Math.hypot` seine Argumentliste (in `lightDistance` und `coneCosine`), die nicht eingebetteten
 * `tileSources`/`steadyLightLevel` ihre Gleitkomma-Argumente und -Rückgaben, `refreshEntries` mit `length = 0` und `push`
 * die Listen neu (≈ 75 B je Kachelabfrage, ≈ 16,5 KB je Lichtanfrage der Pfade). Gemessen mit Stichproben-Heap-Profilen von
 * `node:inspector` (wie `chunkmanager-schluessel.test.ts`) im eingeschwungenen Zustand, jede Abfrage eine echte Auswertung
 * (neuer Stempel je Runde, jede Kachel einmal je Stempel):
 * - die Auswertung einer Kachel (Lichtsumme, Umgebung) < 1 B je Abfrage, Schwellenabfragen (`brighter`, was die
 *   Pfad-Abtaster fragen) < 1 B je Abfrage alles eingerechnet;
 * - Punktabfragen (`levelAt`) < 1 B je Abfrage in der Karte (die Koordinaten übergibt der Aufrufer);
 * - der Pfad-Abtaster je Kachel (Dämmerung: Umgebung über der Schwelle) < 1 B je Kachel des Fensters, mit Lichtliste
 *   (Nacht) < 1 B je Kachel des Fensters.
 * Die Lichter: 16 Fackeln und Feuer, zwei davon Kegel (Laternen), Umgebung über den Ausgabeparameter.
 */
import { Session } from 'node:inspector/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { heapProfileOf, pathAllocation } from '../../../tools/bench/heap';
import { LIGHT_FULL_CIRCLE } from '../../../src/engine/lightFalloff';
import { GameplayLightMap, type MapLight } from '../../../src/world/lightmap/lightmap';
import { TILE_PX, type Layer } from '../../../src/world/model/coords';
import { lightListSampler } from '../../../src/world/path/light';

/** Mittlerer Abstand zweier Heap-Stichproben [B]. */
const SAMPLING_INTERVAL = 16;
/** Grenze [B je Abfrage bzw. je Kachel]. */
const MAX_BYTES = 1;
/** Kacheln je Runde (40 × 40, jede einmal je Stempel). */
const SIDE = 40;
const ROUNDS = 150;
/** Path requests per measurement (an 80 × 80 window each). */
const PATH_ROUNDS = 40;
/** Time limit of a measurement under the load of a full test run (warm-up and sampling) [ms]. */
const TIMEOUT_MS = 30_000;

const lights: MapLight[] = Array.from({ length: 16 }, (_, i) => ({
  id: i + 1,
  layer: 0,
  windowTiles: 9,
  x: (24 + (i % 4) * 10 + 0.5) * TILE_PX,
  y: (24 + Math.floor(i / 4) * 10 + 0.5) * TILE_PX,
  height: 19,
  radius: (i < 4 ? 8 : 6) * TILE_PX,
  intensity: i < 4 ? 1.2 : 0.95,
  flicker: 0.2,
  seed: i,
  coneDirection: i === 5 || i === 10 ? 0.7 * i : 0,
  coneAngle: i === 5 || i === 10 ? 1.4 : LIGHT_FULL_CIRCLE,
}));
const ambient = new Float64Array([0.12]);
const map = new GameplayLightMap(
  {
    lights: () => lights,
    ambient: (_layer, tx, ty, out, i) => {
      out[i] = (ambient[0] as number) * (0.8 + 0.2 * ((tx + ty) & 1));
      return undefined;
    },
    occluders: { beginQuery: () => undefined, info: (_layer: Layer, tx: number, ty: number) => ((tx * 7 + ty * 3) % 29 === 0 ? 1 : 0) },
  },
  4,
);
const sampler = lightListSampler({ lights: () => lights, levels: () => map, ambientBound: () => ambient[0] as number });
const mask = new Uint8Array(SIDE * SIDE * 4);
const sink = new Float64Array(1);
let stamp = 0;

/** `n` rounds of tile levels over a new stamp each: every query evaluates. */
function tileQueries(n: number): void {
  for (let k = 0; k < n; k++) {
    map.setStamp(++stamp);
    for (let ty = 0; ty < SIDE; ty++) for (let tx = 0; tx < SIDE; tx++) sink[0] = (sink[0] as number) + map.tileLevel(0, 20 + tx, 20 + ty);
  }
}

/** `n` rounds of threshold queries (`brighter`, what the path samplers ask) over a new stamp each. */
function brighterQueries(n: number): number {
  let bright = 0;
  for (let k = 0; k < n; k++) {
    map.setStamp(++stamp);
    for (let ty = 0; ty < SIDE; ty++) for (let tx = 0; tx < SIDE; tx++) if (map.brighter(0, 20 + tx, 20 + ty, 0.5)) bright++;
  }
  return bright;
}

/** Point samples per stamp (32 × 32 points across the lights). */
const POINTS = 1024;

/** `n` rounds of `POINTS` point samples (a new stamp each). */
function pointQueries(n: number): void {
  for (let k = 0; k < n; k++) {
    map.setStamp(++stamp);
    for (let i = 0; i < POINTS; i++) sink[0] = (sink[0] as number) + map.levelAt(0, (21 + (i & 31) * 1.19) * TILE_PX, (21 + (i >> 5) * 1.21) * TILE_PX);
  }
}

/** `n` path light requests over an 80 × 80 window (a new stamp each). */
function pathQueries(n: number): void {
  for (let k = 0; k < n; k++) {
    map.setStamp(++stamp);
    sampler.markBright(0, 10, 10, 2 * SIDE, 2 * SIDE, 0.5, mask);
  }
}

let session: Session;
beforeAll(async () => {
  session = new Session();
  session.connect();
  await session.post('HeapProfiler.enable');
});
afterAll(() => session.disconnect());

/**
 * Bytes allocated while `fn` runs `n` rounds (after a warm-up of `3n`) below a frame `inPath` accepts – by default the
 * measuring function itself (`name`).
 */
async function measured(name: string, fn: (n: number) => unknown, n: number, inPath: (f: { functionName: string; url: string }) => boolean = (f) => f.functionName === name && /lichtkarte-allokation\.test/.test(f.url)): Promise<{ bytes: number; top: string }> {
  fn(3 * n);
  await session.post('HeapProfiler.collectGarbage');
  await session.post('HeapProfiler.startSampling', { samplingInterval: SAMPLING_INTERVAL, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  fn(n);
  const profile = heapProfileOf((await session.post('HeapProfiler.stopSampling')).profile);
  const alloc = pathAllocation(profile, inPath);
  return { bytes: alloc.inPath, top: JSON.stringify(alloc.top) };
}

describe('Lichtkarte ohne Allokation je Kachelauswertung (M6-16f)', () => {
  it('Kachelauswertung (Lichtsumme und Umgebung je Kachel): < 1 B je Abfrage', async () => {
    // What evaluating a tile allocates (`memo`: the lights' sum, the ambient, the columns once per stamp). The level
    // `tileLevel` hands back is the caller's number – one that does not inline it gets a heap number; the samplers ask
    // `brighter` instead (next test).
    const { bytes, top } = await measured('tileQueries', tileQueries, ROUNDS, (f) => f.functionName === 'memo' && /lightmap\/lightmap\.ts/.test(f.url));
    expect(bytes / (ROUNDS * SIDE * SIDE), `Allokation unter memo: ${top}`).toBeLessThan(MAX_BYTES);
  }, TIMEOUT_MS);

  it('Schwellenabfragen (brighter): < 1 B je Abfrage, alles eingerechnet', async () => {
    expect(brighterQueries(1)).toBeGreaterThan(0);
    const { bytes, top } = await measured('brighterQueries', brighterQueries, ROUNDS);
    expect(bytes / (ROUNDS * SIDE * SIDE), `Allokation unter den Abfragen: ${top}`).toBeLessThan(MAX_BYTES);
  }, TIMEOUT_MS);

  it('Punktabfragen (levelAt): < 1 B je Abfrage in der Karte', async () => {
    // What the map allocates below `levelAt` (the point's two coordinates are the caller's numbers: a caller that does not
    // inline `levelAt` hands them over as heap numbers – the game asks a few points per tick, the player's light).
    const { bytes, top } = await measured('pointQueries', pointQueries, ROUNDS, (f) => f.functionName === 'levelAt' && /lightmap\/lightmap\.ts/.test(f.url));
    expect(bytes / (ROUNDS * POINTS), `Allokation unter levelAt: ${top}`).toBeLessThan(MAX_BYTES);
  }, TIMEOUT_MS);

  it('Pfad-Abtaster in der Dämmerung (je Kachel gefragt) und nachts (Lichtliste): < 1 B je Kachel des Fensters', async () => {
    const tiles = 4 * SIDE * SIDE;
    // Dusk: the ambient bound lies above the threshold – every tile of the window is asked (the brighter half of the
    // ambient pattern, 0,55, lies above 0,5 everywhere; the darker, 0,44, only near a light).
    ambient[0] = 0.55;
    pathQueries(1);
    expect(mask.reduce((a, b) => a + b, 0)).toBeGreaterThan(tiles / 2);
    const dusk = await measured('pathQueries', pathQueries, PATH_ROUNDS);
    expect(dusk.bytes / (PATH_ROUNDS * tiles), `Dämmerung: ${dusk.top}`).toBeLessThan(MAX_BYTES);
    // Night: only the tiles the lights may brighten above the threshold are asked.
    ambient[0] = 0.12;
    pathQueries(1);
    const lit = mask.reduce((a, b) => a + b, 0);
    expect(lit).toBeGreaterThan(0);
    expect(lit).toBeLessThan(tiles / 4);
    const night = await measured('pathQueries', pathQueries, PATH_ROUNDS);
    expect(night.bytes / (PATH_ROUNDS * tiles), `Nacht: ${night.top}`).toBeLessThan(MAX_BYTES);
  }, TIMEOUT_MS);
});
