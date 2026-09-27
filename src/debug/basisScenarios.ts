/**
 * Screenshot scenarios of the base (MASTERPROMPT §31.5; M4-31 "Screenshots `basis-innen`, `basis-aussen`", M4-05,
 * M4-06, M4-20, M4-28 in the game view): a small homestead in the Grünhain meadow by the showcase lake, built with
 * the game's commands on the session's world.
 *
 * - `basis-aussen`: late morning – a log cabin with a straw roof, a door and two glass windows in its front, a
 *   wooden chest beside it, a workbench and a drying rack hung with fibres in the yard, the hearth fire burning in
 *   front of the door, a wooden fence along the yard; the player by the hearth (its marker with the key cap).
 * - `basis-innen`: the same kind of cabin at night from inside – a bedroom with a bed, a lit resin lamp, a table
 *   with a chair, a straw rug, a window and a picture on the back wall; the roof faded out, the front walls cut.
 * - `stationen-nacht`: every station T0–T1 set up in three rows at night – the charcoal kiln, the clay oven and the
 *   smelting furnace fired and working, the camp fire burning, the drying rack drying fibres, the spinning wheel
 *   spinning the player's yarn; the workbenches, the sawhorse, the mason's bench, the anvil and the grindstone
 *   standing by. The player carries a torch.
 * - `brand`: a wooden wall (the back and sides of an open shed) set alight in its middle at night, 27 s later: the
 *   middle burned down to embers, its neighbours in full blaze, the next ones just caught.
 *
 * Only commands set the state up, played through the page's session (fixed seed, frozen loop): the player spawns at
 * the Grünhain showcase; the scenario tries sites ring by ring around it (a fixed order) by laying floor blueprints on
 * every tile the layout covers (they obey the ground rules and cost nothing) and counting the placed events. Like a
 * player it clears a site first: on the first site where only a few tiles refuse, it finds them one by one and picks
 * what grows there by hand (`player.interact` on the tile: fibre grass, flowers, pebbles, mushrooms – trees and rocks
 * stay, and such a site is given up); what the player picked up is thrown away (`inventory.discard` on every slot).
 * Then it builds for real: stations from their bag slots (given first, one slot each), build parts as given, then fuel,
 * loads and lights. Grass tufts and flowers between the pieces stay where they grow. Registered in
 * src/debug/scenarios.ts; stable once the view is complete and the roof has faded.
 */
import { equipmentRef } from '../game/items/slots';
import type { SessionDebugState } from '../game/session';
import { FADE_FRAMES } from '../render/game/roofs';
import type { GameCameraStart } from '../render/world/gameScene';
import type { RenderSceneId } from '../render/scenes/ids';
import { TILE_PX } from '../world/model/coords';

/** Scenario names. */
export const BASIS_AUSSEN = 'basis-aussen';
export const BASIS_INNEN = 'basis-innen';
export const STATIONEN_NACHT = 'stationen-nacht';
export const BRAND = 'brand';

/** What the scenarios need of the renderer (`ScenarioRender`). */
interface BasisRender {
  showScene(id: RenderSceneId): void;
  setDebugView(name: string): void;
  sceneReady(): boolean;
  startGameCamera(start: GameCameraStart): void;
  gameCamera(): { layer: number; tx: number; ty: number } | null;
}

/** What the scenarios need of the session (`ScenarioSession`). */
interface BasisSitzung {
  command(raw: unknown): unknown;
  step(): void;
  state(): SessionDebugState;
}

/** What the scenarios need of their context (`ScenarioContext`). */
interface BasisKontext {
  freezeAt(seconds: number): void;
  readonly render?: BasisRender;
  readonly session?: BasisSitzung;
}

/** The scenario (shape of `Scenario`, src/debug/scenarios.ts). */
export interface BasisSzenario {
  readonly name: string;
  readonly description: string;
  readonly settleFrames: number;
  setup(ctx: BasisKontext): void;
  ready(): boolean;
}

/** Where the camera starts and the player spawns: the Grünhain showcase (meadow, lake, trees). */
const START: GameCameraStart = { kind: 'biom', biome: 'gruenhain' };
/**
 * Presentation time while the base is set up and of the frozen picture [s]: the effects of clearing (falling trees,
 * chips, leaves) start at the first and are long over at the second, the flames stand mid-flicker.
 */
const AUFBAU_ZEIT = 1.3;
const BILD_ZEIT = 91.3;
/** Frames until the picture counts as stable (the view streams in around the site, the roof fades). */
const RUHE_FRAMES = 8;
/**
 * Largest distance of a site from the showcase [tiles] and the step between sites: the showcase lies in the Grünhain
 * forest, open meadow for a whole yard is found a few dozen tiles off.
 */
const SUCHRADIUS = 40;
const SUCHSCHRITT = 4;
/** Sites probed per rendered frame (each: its probes, one step, their removal, one step). */
const SITES_JE_FRAME = 32;
/** Most tiles of a site that may be cleared before it is built on. */
const RAEUMEN_HOECHSTENS = 40;
/**
 * Longest hold of E on one tile [ticks]: flowers, pebbles, leaves and fibre grass come off by hand in half a second,
 * a tree falls to five axe blows in 140 ticks and its stump goes in 50, a large rock breaks in 290 ticks.
 */
const RAEUMEN_TICKS = 320;
/** Longest wait for a felled tree to land [ticks]. */
const FALL_TICKS = 180;
/** Ticks after picking until what fell nearby is in the bags (flight 0,45 s, settling 0,25 s, the magnet). */
const AUFSAMMELN_TICKS = 50;
/** Tools of the clearing, in hotbar order (slot 0 the axe – it also picks by hand –, slot 1 the pickaxe for rocks). */
const WERKZEUGE = ['steinaxt', 'steinspitzhacke'] as const;
/** Harvests of one tile with one tool at most (a tree: the trunk, then its stump). */
const ERNTEN_JE_WERKZEUG = 3;
/** Beyond the covered tiles, the ground swept for what fell (the logs of a felled tree lie along its trunk) [tiles]. */
const KEHREN_RAND = 4;
/** Step of the sweep [tiles] and the ticks the player stands at each spot (the magnet pulls within 1,5 tiles). */
const KEHREN_SCHRITT = 2;
const KEHREN_TICKS = 20;
/** Bag slots emptied after clearing (inventory and hotbar, `BALANCE.items.bags`). */
const TASCHEN = { inventar: 30, schnellleiste: 10 } as const;
/** The player stands this far south of what it places [tiles] (in build reach, never on the piece). */
const STAND_ABSTAND = 2;
/** Ticks stepped per rendered frame while the base works (keeps every frame short). */
const TICKS_JE_FRAME = 240;
/** Bag slots: stations and the camp fire are given first, one inventory slot each; loads come one at a time into slot 0. */
const INVENTAR = 'inventar';

/** A build part of a layout: anchor relative to the site's north-west corner, its build layer (for removal). */
interface Teil {
  readonly teil: string;
  readonly x: number;
  readonly y: number;
  /** Footprint [tiles] (probed with floor blueprints). */
  readonly b: number;
  readonly t: number;
}

/** A station of a layout (placed with `station.place` from its bag slot). */
interface Station {
  readonly station: string;
  readonly x: number;
  readonly y: number;
  readonly b: number;
  readonly t: number;
}

/** A load of a processing station: `item` × `anzahl` into `bereich` of the station at `index` of the layout's stations. */
interface Ladung {
  readonly station: number;
  readonly item: string;
  readonly anzahl: number;
  readonly bereich: 'eingang' | 'brennstoff';
}

/** What a picture shows. */
interface Bild {
  readonly name: string;
  readonly description: string;
  readonly stunde: number;
  readonly minute: number;
  /** Build parts in building order (floors, walls, roofs, furniture, fences). */
  readonly teile: readonly Teil[];
  readonly stationen: readonly Station[];
  /** A camp fire of the light system, fuelled and lit. */
  readonly lagerfeuer?: { readonly x: number; readonly y: number };
  readonly ladungen: readonly Ladung[];
  /** The hearth fire of the layout (its anchor), fuelled with logs and lit. */
  readonly herdfeuer?: { readonly x: number; readonly y: number };
  /** Furniture lights of the layout (their anchors, in placing order) with their fuel, filled and lit. */
  readonly lampen: ReadonlyArray<{ readonly x: number; readonly y: number; readonly brennstoff: string; readonly anzahl: number }>;
  /** Torches set on stakes (relative tiles), burning. */
  readonly fackeln?: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  /** A recipe the player crafts at a station while the picture is taken. */
  readonly handwerk?: { readonly rezept: string; readonly zutat: string; readonly anzahl: number };
  /** Tiles set alight (`fire.ignite`) and the ticks the fire burns before the picture. */
  readonly brand?: { readonly x: number; readonly y: number; readonly ticks: number };
  /** Ticks the base works before the picture (batches start, the hearth settles). */
  readonly nachlauf: number;
  /**
   * Ground that must be open too (relative rectangles; plants are picked there like on the layout's own tiles): the
   * yard before the cabin, where a tree would hide it.
   */
  readonly frei?: ReadonlyArray<{ readonly x: number; readonly y: number; readonly b: number; readonly t: number }>;
  /** Where the player stands (relative tile) and which way it looks. */
  readonly spieler: { readonly x: number; readonly y: number; readonly blick: 'links' | 'rechts' | 'oben' | 'unten' };
  /** The player carries a burning torch. */
  readonly fackel: boolean;
  /** What the player carries at the end (the hint then offers what it can do with it). */
  readonly tasche?: { readonly item: string; readonly anzahl: number };
}

const BLICK = { links: [-1, 0], rechts: [1, 0], oben: [0, -1], unten: [0, 1] } as const;
/** Season of the pictures: summer – full foliage, and the night is mild enough for a player without clothes. */
const JAHRESZEIT = 'sommer';
/** Hour a night picture is set up at (late morning: warm, hours of daylight ahead). */
const AUFBAU_STUNDE = 10;
/** Hours of a night picture: from dusk to dawn. */
const NACHT = { ab: 19, bis: 5 } as const;

/** Whether `bild` is taken at night (set up by day, the clock jumps to its hour). */
function nachtBild(bild: Bild): boolean {
  return bild.stunde >= NACHT.ab || bild.stunde <= NACHT.bis;
}

/** A cabin: floors inside, walls round with the given openings, a straw roof over all of it. */
function huette(x0: number, y0: number, b: number, t: number, oeffnungen: ReadonlyArray<{ readonly teil: string; readonly x: number; readonly y: number }>): Teil[] {
  const out: Teil[] = [];
  for (let y = 1; y < t - 1; y++) for (let x = 1; x < b - 1; x++) out.push({ teil: 'boden_holz', x: x0 + x, y: y0 + y, b: 1, t: 1 });
  for (let y = 0; y < t; y++) {
    for (let x = 0; x < b; x++) {
      if (x !== 0 && x !== b - 1 && y !== 0 && y !== t - 1) continue;
      const o = oeffnungen.find((p) => p.x === x && p.y === y);
      out.push({ teil: o?.teil ?? 'wand_holz', x: x0 + x, y: y0 + y, b: 1, t: 1 });
    }
  }
  for (let y = 0; y < t; y++) for (let x = 0; x < b; x++) out.push({ teil: 'dach_stroh', x: x0 + x, y: y0 + y, b: 1, t: 1 });
  return out;
}

/** A fence from (x0, y0) to (x1, y1) along one axis. */
function zaun(x0: number, y0: number, x1: number, y1: number): Teil[] {
  const out: Teil[] = [];
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) out.push({ teil: 'zaun_holz', x, y, b: 1, t: 1 });
  return out;
}

/**
 * `basis-aussen`: cabin 7 × 5 (door and two windows in its front), a chest by its side, workbench and drying rack beside
 * it, the hearth in front, a fence along the yard.
 */
const AUSSEN: Bild = {
  name: BASIS_AUSSEN,
  description:
    'M4-31: Basis von außen um 10:00 im Grünhain – Blockhütte mit Strohdach, Tür und zwei Glasfenstern in der Front, daneben eine Holzkiste, im Hof Werkbank und Trockengestell mit Fasern, vor der Tür das brennende Herdfeuer, ein Holzzaun um den Hof; der Spieler am Herdfeuer mit dem Marker „[E] Öffnen: Herdfeuer“ (Tastenkappe als Sprite, M4-38)',
  stunde: 10,
  minute: 0,
  teile: [
    ...huette(0, 0, 7, 5, [
      { teil: 'tuer_holz', x: 3, y: 4 },
      { teil: 'fenster_glas', x: 1, y: 4 },
      { teil: 'fenster_glas', x: 5, y: 4 },
    ]),
    { teil: 'kiste_holz', x: 7, y: 3, b: 1, t: 1 },
    { teil: 'herdfeuer', x: 4, y: 6, b: 3, t: 3 },
    ...zaun(0, 10, 12, 10),
  ],
  stationen: [
    { station: 'werkbank', x: 8, y: 1, b: 2, t: 1 },
    { station: 'trockengestell', x: 11, y: 1, b: 2, t: 1 },
  ],
  ladungen: [{ station: 1, item: 'fasern', anzahl: 12, bereich: 'eingang' }],
  herdfeuer: { x: 4, y: 6 },
  lampen: [],
  frei: [
    { x: 0, y: 5, b: 13, t: 8 },
    { x: 7, y: 2, b: 6, t: 3 },
  ],
  nachlauf: 120,
  spieler: { x: 8, y: 7, blick: 'links' },
  fackel: false,
};

/** `basis-innen`: cabin 8 × 6 furnished as a bedroom with a fireplace, the player inside at night. */
const INNEN: Bild = {
  name: BASIS_INNEN,
  description:
    'M4-31: Basis von innen um 23:00 – ein Schlafzimmer in der Blockhütte: Holzbett, brennende Harzlampe, Tisch mit Stuhl, Strohteppich, Fenster und Landschaftsbild an der Rückwand; das Strohdach ausgeblendet (nur sein Rand bleibt), die Wände davor gekappt, warmes Lampenlicht im kühlen Mondlicht; der Spieler auf dem Teppich',
  stunde: 23,
  minute: 0,
  teile: [
    ...huette(0, 0, 8, 6, [
      { teil: 'tuer_holz', x: 4, y: 5 },
      { teil: 'fenster_glas', x: 3, y: 0 },
    ]),
    { teil: 'holzbett', x: 1, y: 1, b: 1, t: 2 },
    { teil: 'harzlampe', x: 2, y: 1, b: 1, t: 1 },
    { teil: 'kamin_stein', x: 4, y: 1, b: 2, t: 1 },
    { teil: 'bild_landschaft', x: 6, y: 1, b: 1, t: 1 },
    { teil: 'laterne_stehend', x: 1, y: 3, b: 1, t: 1 },
    { teil: 'tisch_holz', x: 5, y: 3, b: 2, t: 1 },
    { teil: 'stuhl_holz', x: 6, y: 4, b: 1, t: 1 },
    { teil: 'teppich_stroh', x: 2, y: 3, b: 2, t: 2 },
  ],
  stationen: [],
  ladungen: [],
  lampen: [
    { x: 2, y: 1, brennstoff: 'harz', anzahl: 2 },
    { x: 4, y: 1, brennstoff: 'holz', anzahl: 12 },
    { x: 1, y: 3, brennstoff: 'harz', anzahl: 2 },
  ],
  frei: [{ x: -1, y: 6, b: 10, t: 3 }],
  nachlauf: 60,
  spieler: { x: 4, y: 3, blick: 'oben' },
  tasche: { item: 'holz', anzahl: 4 },
  fackel: false,
};

/** `stationen-nacht`: the stations T0–T1 in three rows, the fired ones working. */
const STATIONEN: Bild = {
  name: STATIONEN_NACHT,
  description:
    'M4-05/M4-06: alle Stationen T0–T1 bei Nacht um 22:00 – oben Köhlermeiler, Lehmofen und Schmelzofen befeuert und arbeitend (Glut und Flammen leuchten), daneben das brennende Lagerfeuer; in der Mitte Werkbank I und II, Sägebock und Steinmetzbank; unten das Trockengestell mit Fasern, Schleifstein, Bronzeamboss und das Spinnrad, an dem der Spieler Garn spinnt (Rad dreht sich); drei Fackeln auf Pfählen, der Spieler trägt eine Fackel',
  stunde: 22,
  minute: 0,
  teile: [],
  stationen: [
    { station: 'koehlermeiler', x: 0, y: 0, b: 2, t: 2 },
    { station: 'lehmofen', x: 3, y: 0, b: 2, t: 2 },
    { station: 'schmelzofen', x: 6, y: 0, b: 2, t: 2 },
    { station: 'werkbank', x: 0, y: 4, b: 2, t: 1 },
    { station: 'werkbank_2', x: 3, y: 4, b: 2, t: 1 },
    { station: 'saegebock', x: 6, y: 4, b: 2, t: 1 },
    { station: 'steinmetzbank', x: 9, y: 4, b: 2, t: 1 },
    { station: 'trockengestell', x: 0, y: 7, b: 2, t: 1 },
    { station: 'schleifstein', x: 3, y: 7, b: 2, t: 1 },
    { station: 'amboss_bronze', x: 6, y: 7, b: 1, t: 1 },
    { station: 'spinnrad', x: 8, y: 7, b: 1, t: 1 },
  ],
  lagerfeuer: { x: 9, y: 1 },
  ladungen: [
    { station: 0, item: 'holz', anzahl: 8, bereich: 'eingang' },
    { station: 0, item: 'holz', anzahl: 4, bereich: 'brennstoff' },
    { station: 1, item: 'lehm', anzahl: 6, bereich: 'eingang' },
    { station: 1, item: 'holz', anzahl: 4, bereich: 'brennstoff' },
    { station: 2, item: 'kupfererz', anzahl: 6, bereich: 'eingang' },
    { station: 2, item: 'holzkohle', anzahl: 4, bereich: 'brennstoff' },
    { station: 7, item: 'fasern', anzahl: 12, bereich: 'eingang' },
  ],
  lampen: [],
  handwerk: { rezept: 'rezept_garn', zutat: 'fasern', anzahl: 8 },
  frei: [{ x: -1, y: 2, b: 15, t: 10 }],
  fackeln: [
    { x: -1, y: 3 },
    { x: 11, y: 3 },
    { x: 2, y: 9 },
  ],
  nachlauf: 90,
  spieler: { x: 9, y: 7, blick: 'links' },
  fackel: true,
};

/** `brand`: the back and sides of an open wooden shed, set alight in the middle of its back wall. */
const BRAND_BILD: Bild = {
  name: BRAND,
  description:
    'M4-28: Brand bei Nacht um 22:00 – die Rückwand eines offenen Holzschuppens brennt, 27 s nach dem Entzünden in ihrer Mitte: die Mitte zur Glut heruntergebrannt, die Nachbarn in vollen Flammen, die nächsten eben erfasst; das Feuer erhellt Wand und Boden (Licht der Feuersimulation), die Flammen sitzen auf den Wänden',
  stunde: 22,
  minute: 0,
  teile: [...zaunLos(0, 0, 6, 0), ...zaunLos(0, 1, 0, 2), ...zaunLos(6, 1, 6, 2)],
  stationen: [],
  ladungen: [],
  lampen: [],
  brand: { x: 3, y: 0, ticks: 27 * 60 },
  frei: [{ x: -3, y: 1, b: 13, t: 6 }],
  nachlauf: 0,
  spieler: { x: 3, y: 3, blick: 'oben' },
  fackel: false,
};

/** A line of wooden walls from (x0, y0) to (x1, y1) (the shed of `brand`). */
function zaunLos(x0: number, y0: number, x1: number, y1: number): Teil[] {
  return zaun(x0, y0, x1, y1).map((z) => ({ ...z, teil: 'wand_holz' }));
}

/** Sites around the centre, nearest first (rings of `SUCHSCHRITT`, a fixed order). */
function suchreihe(): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [[0, 0]];
  for (let r = SUCHSCHRITT; r <= SUCHRADIUS; r += SUCHSCHRITT) {
    for (let dy = -r; dy <= r; dy += SUCHSCHRITT) for (let dx = -r; dx <= r; dx += SUCHSCHRITT) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) out.push([dx, dy]);
  }
  return out;
}

/** Every tile a layout covers (relative), once. */
function belegung(b: Bild): Array<readonly [number, number]> {
  const seen = new Set<string>();
  const out: Array<readonly [number, number]> = [];
  const add = (x: number, y: number): void => {
    const k = `${x},${y}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push([x, y]);
  };
  for (const p of [...b.teile, ...b.stationen]) for (let y = 0; y < p.t; y++) for (let x = 0; x < p.b; x++) add(p.x + x, p.y + y);
  if (b.lagerfeuer !== undefined) add(b.lagerfeuer.x, b.lagerfeuer.y);
  for (const r of b.frei ?? []) for (let y = 0; y < r.t; y++) for (let x = 0; x < r.b; x++) add(r.x + x, r.y + y);
  return out;
}

/** Items a layout's build parts take. */
function material(b: Bild): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of b.teile) m.set(p.teil, (m.get(p.teil) ?? 0) + 1);
  return m;
}

type Phase = 'welt' | 'suchen' | 'raeumen' | 'stationen' | 'bauen' | 'einrichten' | 'laufen' | 'stellen' | 'fertig';

function basisSzenario(bild: Bild): BasisSzenario {
  const reihe = suchreihe();
  const felder = belegung(bild);
  let render: BasisRender | null = null;
  let session: BasisSitzung | null = null;
  let phase: Phase = 'welt';
  let mitte = { tx: 0, ty: 0 };
  let naechste = 0;
  let ox = 0;
  let oy = 0;
  let vorher = 0;
  let gelaufen = 0;
  let warten = 0;
  let frieren: (seconds: number) => void = () => undefined;
  /** Sites with few refusing tiles (index in `reihe`, how many refuse), fewest first once all are probed. */
  let kandidaten: Array<{ readonly i: number; readonly zu: number }> = [];
  const s = (): BasisSitzung => session as BasisSitzung;
  const teleport = (x: number, y: number): void => {
    s().command({ type: 'player.teleport', x: (ox + x + 0.5) * TILE_PX, y: (oy + y + 0.5) * TILE_PX, layer: 0 });
  };
  const zahl = (e: keyof SessionDebugState['events']): number => s().state().events[e];
  /** Floor blueprints on `tiles` of the site at (ox, oy), then their removal; returns how many lay. */
  const probe = (tiles: ReadonlyArray<readonly [number, number]>): number => {
    const zuvor = zahl('partPlaced');
    // Standing on the tile loads its chunk for the check (a teleport makes the ground around the player resident).
    for (const [x, y] of tiles) {
      teleport(x, y);
      s().command({ type: 'build.blueprint', part: 'boden_holz', tx: ox + x, ty: oy + y });
    }
    s().step();
    const lagen = zahl('partPlaced') - zuvor;
    for (const [x, y] of tiles) {
      teleport(x, y);
      s().command({ type: 'build.remove', tx: ox + x, ty: oy + y, ebene: 'boden' });
    }
    s().step();
    return lagen;
  };
  /**
   * The covered tiles that refuse a floor, one probe per tick: the blueprint of the tile before is taken away in the
   * same tick the next is laid.
   */
  const sperrend = (): Array<readonly [number, number]> => {
    const out: Array<readonly [number, number]> = [];
    let zuvor: readonly [number, number] | null = null;
    for (const f of felder) {
      const n = zahl('partPlaced');
      if (zuvor !== null) s().command({ type: 'build.remove', tx: ox + zuvor[0], ty: oy + zuvor[1], ebene: 'boden' });
      teleport(f[0], f[1]);
      s().command({ type: 'build.blueprint', part: 'boden_holz', tx: ox + f[0], ty: oy + f[1] });
      s().step();
      if (zahl('partPlaced') === n) out.push(f);
      zuvor = f;
    }
    if (zuvor !== null) {
      s().command({ type: 'build.remove', tx: ox + zuvor[0], ty: oy + zuvor[1], ebene: 'boden' });
      s().step();
    }
    return out;
  };
  /** Tries the site at offset `off`: how many covered tiles refuse a floor. */
  const versuche = (off: readonly [number, number]): number => {
    ox = mitte.tx + off[0];
    oy = mitte.ty + off[1];
    return felder.length - probe(felder);
  };
  /**
   * Holds E on relative tile (x, y) with the tool in the hand until something comes off (true) or the simulation refuses
   * or nothing happens (false); a felled tree is waited for until it lies, then what fell nearby flies into the bags.
   */
  const ernte = (x: number, y: number): boolean => {
    const ss = s();
    teleport(x, y + 1);
    const geerntet = zahl('harvested');
    const abgelehnt = zahl('commandRejected');
    const gefaellt = zahl('treeFelled');
    const gelandet = zahl('treeLanded');
    ss.command({ type: 'player.interact', on: true, tx: ox + x, ty: oy + y });
    for (let i = 0; i < RAEUMEN_TICKS && zahl('harvested') === geerntet && zahl('commandRejected') === abgelehnt; i++) ss.step();
    ss.command({ type: 'player.interact', on: false });
    ss.step();
    if (zahl('harvested') === geerntet) return false;
    if (zahl('treeFelled') !== gefaellt) for (let i = 0; i < FALL_TICKS && zahl('treeLanded') === gelandet; i++) ss.step();
    for (let i = 0; i < AUFSAMMELN_TICKS; i++) ss.step();
    return true;
  };
  /**
   * Whether every one of `tiles` can be cleared: a short press of E with the axe, then with the pickaxe – what the
   * simulation refuses with both (moss, unripe mushrooms, a bush, water) stays. Two ticks per tool and tile.
   */
  const raeumbar = (tiles: ReadonlyArray<readonly [number, number]>): boolean => {
    const ss = s();
    for (const [x, y] of tiles) {
      let geht = false;
      for (let slot = 0; slot < WERKZEUGE.length && !geht; slot++) {
        ss.command({ type: 'player.selectHotbar', index: slot });
        teleport(x, y + 1);
        const abgelehnt = zahl('commandRejected');
        ss.command({ type: 'player.interact', on: true, tx: ox + x, ty: oy + y });
        ss.step();
        ss.step();
        geht = zahl('commandRejected') === abgelehnt;
        ss.command({ type: 'player.interact', on: false });
        ss.step();
      }
      if (!geht) return false;
    }
    return true;
  };
  /** Clears relative tile (x, y): by hand and axe (a tree, then its stump), else with the pickaxe (a rock, an ore). */
  const raeume = (x: number, y: number): void => {
    for (let slot = 0; slot < WERKZEUGE.length; slot++) {
      s().command({ type: 'player.selectHotbar', index: slot });
      let n = 0;
      while (n < ERNTEN_JE_WERKZEUG && ernte(x, y)) n++;
      if (n > 0) return;
    }
  };
  /** Walks the site and its margin so the magnet takes what fell (logs of felled trees); then the bags are emptied. */
  const kehre = (): void => {
    const ss = s();
    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    for (const [x, y] of felder) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    for (let y = y0 - KEHREN_RAND; y <= y1 + KEHREN_RAND; y += KEHREN_SCHRITT) {
      for (let x = x0 - KEHREN_RAND; x <= x1 + KEHREN_RAND; x += KEHREN_SCHRITT) {
        teleport(x, y);
        for (let i = 0; i < KEHREN_TICKS; i++) ss.step();
      }
    }
    leere();
  };
  /** Throws away everything in the bags: they start empty for the stations and loads. */
  const leere = (): void => {
    for (const [bereich, n] of Object.entries(TASCHEN)) for (let i = 0; i < n; i++) s().command({ type: 'inventory.discard', from: { bereich, index: i } });
    s().step();
  };
  return {
    name: bild.name,
    description: bild.description,
    settleFrames: RUHE_FRAMES,
    setup(ctx) {
      const r = ctx.render;
      if (r === undefined || ctx.session === undefined) throw new Error(`Szenario ${bild.name} braucht Renderer und Sitzung`);
      render = r;
      session = ctx.session;
      phase = 'welt';
      naechste = 0;
      gelaufen = 0;
      warten = 0;
      r.startGameCamera(START);
      r.showScene('spiel');
      r.setDebugView('off');
      frieren = (t) => ctx.freezeAt(t);
      frieren(AUFBAU_ZEIT);
    },
    ready() {
      if (render === null || session === null || !render.sceneReady()) return false;
      const ss = s();
      switch (phase) {
        case 'welt': {
          const at = render.gameCamera();
          if (at === null) return false;
          mitte = { tx: at.tx, ty: at.ty };
          // A day picture begins at its hour (searching and clearing take an hour or two of it); a night picture is set up by
          // day and the clock jumps to its hour before the fires are lit – a jump of the clock neither tires nor chills the
          // player, hours of clearing in the cold night would.
          ss.command({ type: 'setSeason', season: JAHRESZEIT });
          ss.command({ type: 'setTime', hour: nachtBild(bild) ? AUFBAU_STUNDE : bild.stunde, minute: nachtBild(bild) ? 0 : bild.minute });
          ss.command({ type: 'setWeather', state: 'klar' });
          ss.command({ type: 'player.spawn', tx: at.tx, ty: at.ty, layer: 0 });
          // Searching and clearing take game hours: the player neither hungers nor thirsts meanwhile.
          ss.command({ type: 'debug.god', on: true });
          ss.step();
          naechste = 0;
          kandidaten = [];
          phase = 'suchen';
          return false;
        }
        case 'suchen': {
          // Ring by ring: how many tiles of each site refuse a floor; a free site is built on at once.
          for (let k = 0; k < SITES_JE_FRAME; k++) {
            const i = naechste++;
            const off = reihe[i];
            if (off === undefined) {
              kandidaten.sort((a, b) => a.zu - b.zu || a.i - b.i);
              phase = 'raeumen';
              return false;
            }
            const zu = versuche(off);
            if (zu === 0) {
              phase = 'stationen';
              return false;
            }
            if (zu <= RAEUMEN_HOECHSTENS) kandidaten.push({ i, zu });
          }
          return false;
        }
        case 'raeumen': {
          // The site with the fewest refusing tiles (then the nearest) is cleared: plants by hand, trees and their stumps
          // with the axe, rocks with the pickaxe; if something stays (a bush, water), the next site is tried.
          const c = kandidaten.shift();
          if (c === undefined) throw new Error(`Szenario ${bild.name}: kein Bauplatz im Umkreis von ${SUCHRADIUS} Kacheln, der sich räumen lässt`);
          const off = reihe[c.i] as readonly [number, number];
          ox = mitte.tx + off[0];
          oy = mitte.ty + off[1];
          // Fresh tools for each site (the bags are emptied before: a worn axe stays behind).
          leere();
          for (const w of WERKZEUGE) ss.command({ type: 'inventory.give', item: w, count: 1 });
          // Two rounds: a tile covered by a tree standing on another tile frees up once that tree is down.
          const sperren = sperrend();
          if (!raeumbar(sperren)) return false;
          for (const [x, y] of sperren) raeume(x, y);
          for (const [x, y] of sperrend()) raeume(x, y);
          if (probe(felder) !== felder.length) return false;
          kehre();
          phase = 'stationen';
          return false;
        }
        case 'stationen': {
          // Stations and the camp fire first, one inventory slot each (in this order: slots 0 …).
          for (const st of bild.stationen) ss.command({ type: 'inventory.give', item: st.station, count: 1 });
          if (bild.lagerfeuer !== undefined) ss.command({ type: 'inventory.give', item: 'lagerfeuer', count: 1 });
          vorher = zahl('stationPlaced');
          bild.stationen.forEach((st, i) => {
            teleport(st.x, st.y + st.t + 1);
            ss.command({ type: 'station.place', from: { bereich: INVENTAR, index: i }, tx: ox + st.x, ty: oy + st.y });
          });
          if (bild.lagerfeuer !== undefined) {
            teleport(bild.lagerfeuer.x, bild.lagerfeuer.y + STAND_ABSTAND);
            ss.command({ type: 'light.place', from: { bereich: INVENTAR, index: bild.stationen.length }, tx: ox + bild.lagerfeuer.x, ty: oy + bild.lagerfeuer.y });
          }
          ss.step();
          if (zahl('stationPlaced') - vorher !== bild.stationen.length) throw new Error(`Szenario ${bild.name}: nicht alle Stationen stehen`);
          phase = 'bauen';
          return false;
        }
        case 'bauen': {
          for (const [item, count] of material(bild)) ss.command({ type: 'inventory.give', item, count });
          vorher = zahl('partPlaced');
          for (const p of bild.teile) {
            teleport(p.x, p.y + p.t - 1 + STAND_ABSTAND);
            ss.command({ type: 'build.place', part: p.teil, tx: ox + p.x, ty: oy + p.y });
          }
          ss.step();
          if (zahl('partPlaced') - vorher !== bild.teile.length) throw new Error(`Szenario ${bild.name}: ${zahl('partPlaced') - vorher} von ${bild.teile.length} Bauteilen stehen`);
          phase = 'einrichten';
          return false;
        }
        case 'einrichten': {
          // The night's hour, clear sky (the weather may have turned while searching); then loads, fuel and lights: each
          // given into the emptied first inventory slot and used from there at once.
          // The jump runs in a tick of its own (the world catches up in it): nothing may be loaded or lit before.
          if (nachtBild(bild)) {
            ss.command({ type: 'setTime', hour: bild.stunde, minute: bild.minute });
            ss.step();
          }
          ss.command({ type: 'setWeather', state: 'klar' });
          const slot = { bereich: INVENTAR, index: 0 };
          const stationIds = vorherStationen(ss, bild);
          for (const l of bild.ladungen) {
            const st = bild.stationen[l.station];
            if (st === undefined) continue;
            teleport(st.x, st.y + st.t + 1);
            ss.command({ type: 'inventory.give', item: l.item, count: l.anzahl });
            ss.command({ type: 'station.put', station: stationIds + l.station, from: slot, bereich: l.bereich, count: l.anzahl });
          }
          if (bild.lagerfeuer !== undefined) {
            const f = bild.lagerfeuer;
            teleport(f.x, f.y + 1);
            ss.command({ type: 'inventory.give', item: 'holz', count: 6 });
            ss.command({ type: 'light.fuel', light: zahl('lightPlaced'), from: slot, count: 6 });
            ss.command({ type: 'light.ignite', tx: ox + f.x, ty: oy + f.y });
          }
          if (bild.herdfeuer !== undefined) {
            const h = bild.herdfeuer;
            teleport(h.x + 1, h.y + 3);
            ss.command({ type: 'inventory.give', item: 'holz', count: 6 });
            ss.command({ type: 'hearth.fuel', hearth: zahl('hearthBuilt'), from: slot, count: 6 });
            ss.command({ type: 'hearth.ignite', hearth: zahl('hearthBuilt') });
          }
          const ersteLampe = zahl('lightPlaced') - bild.lampen.length + 1;
          bild.lampen.forEach((l, i) => {
            teleport(l.x, l.y + 1);
            ss.command({ type: 'inventory.give', item: l.brennstoff, count: l.anzahl });
            ss.command({ type: 'light.fuel', light: ersteLampe + i, from: slot, count: l.anzahl });
            ss.command({ type: 'light.ignite', tx: ox + l.x, ty: oy + l.y });
          });
          // Torches on stakes: given into the emptied hotbar (one slot each), set and burning.
          const fackeln = bild.fackeln ?? [];
          if (fackeln.length > 0) ss.command({ type: 'inventory.give', item: 'fackel', count: fackeln.length });
          fackeln.forEach((f, i) => {
            teleport(f.x, f.y + STAND_ABSTAND);
            ss.command({ type: 'light.place', from: { bereich: 'schnellleiste', index: i }, tx: ox + f.x, ty: oy + f.y });
          });
          const sp = bild.spieler;
          teleport(sp.x, sp.y);
          if (bild.handwerk !== undefined) {
            ss.command({ type: 'inventory.give', item: bild.handwerk.zutat, count: bild.handwerk.anzahl });
            ss.command({ type: 'debug.unlock' });
            ss.command({ type: 'craft.start', recipe: bild.handwerk.rezept, count: 2 });
          }
          if (bild.fackel) {
            ss.command({ type: 'inventory.give', item: 'fackel', count: 1 });
            ss.command({ type: 'inventory.move', from: { bereich: 'schnellleiste', index: 0 }, to: equipmentRef('nebenhand') });
            ss.command({ type: 'light.toggle' });
          }
          if (bild.tasche !== undefined) ss.command({ type: 'inventory.give', item: bild.tasche.item, count: bild.tasche.anzahl });
          if (bild.brand !== undefined) ss.command({ type: 'fire.ignite', tx: ox + bild.brand.x, ty: oy + bild.brand.y, layer: 0 });
          const abgelehnt = zahl('commandRejected');
          ss.step();
          if (zahl('commandRejected') !== abgelehnt) throw new Error(`Szenario ${bild.name}: ${zahl('commandRejected') - abgelehnt} Befehle beim Einrichten abgelehnt`);
          phase = 'laufen';
          return false;
        }
        case 'laufen': {
          const soll = bild.nachlauf + (bild.brand?.ticks ?? 0);
          const k = Math.min(TICKS_JE_FRAME, soll - gelaufen);
          for (let i = 0; i < k; i++) ss.step();
          gelaufen += k;
          if (gelaufen >= soll) phase = 'stellen';
          return false;
        }
        case 'stellen': {
          // The player turns to where the picture looks: one tick of walking that way, then it stands.
          const [dx, dy] = BLICK[bild.spieler.blick];
          teleport(bild.spieler.x, bild.spieler.y);
          ss.command({ type: 'player.move', dx, dy });
          ss.step();
          ss.command({ type: 'player.move', dx: 0, dy: 0 });
          teleport(bild.spieler.x, bild.spieler.y);
          ss.step();
          // The picture's moment: everything the setup set off (falling trees, chips, leaves) is over by then.
          frieren(BILD_ZEIT);
          phase = 'fertig';
          return false;
        }
        case 'fertig':
          // The roof of an interior lifts frame by frame while the picture's clock stands still.
          if (warten < FADE_FRAMES + 2) {
            warten++;
            return false;
          }
          return true;
      }
    },
  };
}

/** Id of the station before the layout's first (station ids count from 1 in the order they were placed). */
function vorherStationen(ss: BasisSitzung, bild: Bild): number {
  return ss.state().events.stationPlaced - bild.stationen.length + 1;
}

/** The scenarios of the base (registered in src/debug/scenarios.ts). */
export function basisSzenarien(): BasisSzenario[] {
  return [basisSzenario(AUSSEN), basisSzenario(INNEN), basisSzenario(STATIONEN), basisSzenario(BRAND_BILD)];
}

/** The tiles every picture's layout covers, relative to its site (the probes of the site search; tests, tools). */
export function basisBelegungen(): Record<string, Array<readonly [number, number]>> {
  return Object.fromEntries([AUSSEN, INNEN, STATIONEN, BRAND_BILD].map((b) => [b.name, belegung(b)]));
}
