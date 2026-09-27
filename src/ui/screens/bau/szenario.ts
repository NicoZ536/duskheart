/**
 * Screenshot scenarios of building (MASTERPROMPT §31.5; M4-22, M4-26, M4-27, M4-38): a small wooden house in the
 * Grünhain showcase – 7 × 6 tiles of plank walls with a door to the south and two glass windows, a plank floor, a
 * straw roof over everything, a bed, a resin lamp, a table with a chair, a shelf and a picture on the back wall, a
 * torch burning inside – and the build mode over it.
 *
 * - `ui-baumenue`: the build mode's bar (category bar, search, pieces with their stock, costs), its hints with the
 *   glyph sprites and a plank wall as green ghost east of the house.
 * - `bau-vorschau`: a straw roof tile far from any wall – the red ghost with its reason over the cursor and in the
 *   status line, the hints with mouse and key cap glyphs (M4-38).
 * - `bau-blaupause` (M4-24): blueprint mode on – an annex east of the house planned as wall blueprints (more than the
 *   bags hold), the ghost of its next wall in the plan blue on a blue field, the switch "Blaupause" lit, the status
 *   "Frei – hier kannst du eine Blaupause planen." with the plan's edge, the line of what the blueprints still need,
 *   the hint G lit.
 * - `bau-abbauen`, `bau-aufwerten`, `bau-reparieren` (§16.6, Review M4 #1): a garden wall of four plank walls east of
 *   the house and the tool bar with the tool lit – dismantling the house's south-east corner half a minute after it was
 *   built (amber fields over roof, walls and floor, "60 % zurück" over the cursor and what comes back in the status
 *   line); upgrading the garden wall to stone in one drag (the stone walls drawn green over the planks, "» Steinwand",
 *   the cost); repairing it after a short fire (the debug command `fire.ignite`, put out by rain; the sky has cleared
 *   since) with the stone hammer taken into the hand (the damaged walls green in the ice-blue rectangle, the planks it
 *   costs).
 * - `overlay-raeume`, `overlay-raumtemperatur`, `overlay-licht`, `overlay-behaglichkeit`, `overlay-stuetzen`: the
 *   build overlays over the house – its room and type, the room warmer than the night outside, the light map's stages
 *   by night, its comfort, the roof's distances to its walls (`overlay-temperatur` is the M2 debug overlay of the
 *   temperature field).
 * - `haus-aussen`, `haus-innen`: the player south of the house with its roof, and inside, where the roof has faded
 *   out and the walls in front are cut (M4-27).
 *
 * Only commands set the state up, played through the page's session: the player spawns at the showcase camera;
 * the scenario tries sites ring by ring (a fixed order) by laying the house's floor as blueprints (they cost
 * nothing and obey the same ground rules as parts) and counting the placed events – the first site where all of it
 * lies is built on for real. Registered in src/debug/scenarios.ts.
 */
import { BALANCE } from '../../../content/balance';
import type { SessionDebugState } from '../../../game/session';
import type { BuildOverlay } from '../../../render/game/overlays';
import { FADE_FRAMES } from '../../../render/game/roofs';
import type { GameCameraStart } from '../../../render/world/gameScene';
import type { RenderSceneId } from '../../../render/scenes/ids';
import { TILE_PX } from '../../../world/model/coords';
import { activeGameScreens } from '../../focus/GameScreens';
import { aktiveHudWelt, hudVorgabe } from '../../hud/Hud';
import { atlasImagesVersion } from '../inventar/itemIcons';
import { aktiverBauModus, BAU_SCREEN } from './BauModus';
import { platzMit } from './katalog';

/** What the scenarios need of the renderer (`ScenarioRender`). */
interface SzenarioRender {
  showScene(id: RenderSceneId): void;
  setDebugView(name: string): void;
  sceneReady(): boolean;
  startGameCamera(start: GameCameraStart): void;
  gameCamera(): { layer: number; tx: number; ty: number } | null;
}

/** What the scenarios need of their context (`ScenarioContext`). */
interface SzenarioKontext {
  freezeAt(seconds: number): void;
  readonly render?: SzenarioRender;
  readonly session?: { command(raw: unknown): unknown; step(): void; state(): SessionDebugState };
}

/** The scenario (shape of `Scenario`, src/debug/scenarios.ts). */
export interface BauSzenario {
  readonly name: string;
  readonly description: string;
  readonly settleFrames: number;
  setup(ctx: SzenarioKontext): void;
  ready(): boolean;
}

/** Where the camera starts: the start beach (the player spawns there; the land behind it is open). */
const START: GameCameraStart = { kind: 'titel' };
/** Presentation time of the frozen picture [s] (the torch mid-flicker). */
const BILD_ZEIT = 1.3;
/** Frames until the picture counts as stable (roof fade, font, UI graphics). */
const RUHE_FRAMES = 30;
/** The house: outer size [tiles] and the player's tile inside it (offset from the north-west corner). */
const HAUS = { b: 7, t: 6, innenX: 3, innenY: 3 } as const;
/** How far east of the door the player stands in the pictures of the build mode [tiles]. */
const SEITE = 2;
/** Largest distance of a site from the spawn tile [tiles] and the step between sites. */
const SUCHRADIUS = 24;
const SUCHSCHRITT = 2;
/** What the house takes, given before building. */
const MATERIAL: ReadonlyArray<readonly [string, number]> = [
  ['wand_holz', 24],
  ['boden_holz', 24],
  ['dach_stroh', 48],
  ['tuer_holz', 1],
  ['fenster_glas', 2],
  ['holzbett', 1],
  ['harzlampe', 1],
  ['tisch_holz', 1],
  ['stuhl_holz', 1],
  ['regal_wand', 1],
  ['bild_landschaft', 1],
  ['fackel', 1],
];

type Art = 'baumenue' | 'vorschau' | 'blaupause' | 'overlay' | 'aussen' | 'innen' | 'abbauen' | 'aufwerten' | 'reparieren';

/** The pictures of the build mode's tools (§16.6): they get the garden wall east of the house. */
function mitWerkzeug(art: Art): art is 'abbauen' | 'aufwerten' | 'reparieren' {
  return art === 'abbauen' || art === 'aufwerten' || art === 'reparieren';
}

interface Einstellung {
  readonly art: Art;
  /** Clock time of the picture. */
  readonly stunde: number;
  readonly overlay?: BuildOverlay;
}

/** Pictures of the build mode show the playing HUD under it; the house from outside and inside shows the world alone. */
function mitHud(art: Art): boolean {
  return art === 'baumenue' || art === 'vorschau' || art === 'blaupause' || art === 'overlay' || mitWerkzeug(art);
}

/** The garden wall of the tool pictures: plank walls in a column east of the house (offset from its north-west corner). */
const GARTENMAUER = { dx: HAUS.b + 2, dy0: 1, laenge: 4 } as const;
/** How long the dismantle picture waits after building: past the full refund window [s] (the late share shows). */
const NACH_DER_FRIST_S = BALANCE.building.refund.fullSeconds + 1;
/**
 * The fire of the repair picture: rain blends in over `BALANCE.climate.weatherBlendMinutes` (one game minute per real
 * second at the default day length); the walls catch fire this long after it began [s] – a few seconds before it
 * falls hard enough to put fires out (`BALANCE.fire.rainFromPrecipitation`), so they burn briefly: damaged, not burned
 * down, and nothing spreads (`BALANCE.fire.spreadSeconds`).
 */
const REGEN_VOR_DEM_BRAND_S = 16;
/** Longest the scenario waits for the rain to put both fires out [s]. */
const LOESCHEN_BIS_S = 30;
/** After the fire the sky clears: the rain blends out over the weather blend [s]. */
const AUFKLAREN_S = BALANCE.climate.weatherBlendMinutes + 1;
/** The walls of the garden wall that burn in the repair picture (index from its north end). */
const BRENNENDE_WAENDE = [0, 2] as const;
/** Planks given for the repair picture (more than mending two walls costs). */
const REPARATUR_BRETTER = 6;

/** The ghost's tile in the annex's south side (offset from the annex's west column and the house's north row). */
const ANBAU_GEIST = [1, 4] as const;
/** Outer width of the annex [tiles] (it ends before the pebbles east of it). */
const ANBAU_B = 3;

/**
 * The annex of `bau-blaupause` east of the house at north-west corner (x0, y0): an outline of 3 × 4 wall blueprints
 * next to the east wall, its south side open for one wall – the ghost's tile (`ANBAU_GEIST`). Nine walls, the bags
 * hold five after the house.
 */
function anbauPlan(x0: number, y0: number): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [];
  const ax = x0 + HAUS.b;
  for (let y = y0 + 1; y <= y0 + 4; y++) {
    for (let x = ax; x < ax + ANBAU_B; x++) {
      const rand = x === ax || x === ax + ANBAU_B - 1 || y === y0 + 1 || y === y0 + 4;
      if (rand && !(x === ax + ANBAU_GEIST[0] && y === y0 + ANBAU_GEIST[1])) out.push([x, y]);
    }
  }
  return out;
}

type Phase = 'welt' | 'geben' | 'suchen' | 'pruefen' | 'bauen' | 'einrichten' | 'stellen' | 'bau' | 'fertig';

/** The anchors of the house at north-west corner (x0, y0), in building order: floor, walls, openings, roof, furniture. */
export function hausPlan(x0: number, y0: number): Array<{ readonly part: string; readonly tx: number; readonly ty: number }> {
  const x1 = x0 + HAUS.b - 1;
  const y1 = y0 + HAUS.t - 1;
  const tuer = { tx: x0 + HAUS.innenX, ty: y1 };
  const fenster = [
    { tx: x0 + HAUS.innenX, ty: y0 },
    { tx: x0, ty: y0 + 2 },
  ];
  const out: Array<{ part: string; tx: number; ty: number }> = [];
  for (let y = y0 + 1; y < y1; y++) for (let x = x0 + 1; x < x1; x++) out.push({ part: 'boden_holz', tx: x, ty: y });
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (x !== x0 && x !== x1 && y !== y0 && y !== y1) continue;
      const istTuer = x === tuer.tx && y === tuer.ty;
      const istFenster = fenster.some((f) => f.tx === x && f.ty === y);
      out.push({ part: istTuer ? 'tuer_holz' : istFenster ? 'fenster_glas' : 'wand_holz', tx: x, ty: y });
    }
  }
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ part: 'dach_stroh', tx: x, ty: y });
  out.push({ part: 'holzbett', tx: x0 + 1, ty: y0 + 1 });
  out.push({ part: 'harzlampe', tx: x0 + 2, ty: y0 + 1 });
  out.push({ part: 'regal_wand', tx: x0 + 4, ty: y0 + 1 });
  out.push({ part: 'bild_landschaft', tx: x0 + 5, ty: y0 + 1 });
  out.push({ part: 'tisch_holz', tx: x0 + 4, ty: y0 + 3 });
  out.push({ part: 'stuhl_holz', tx: x0 + 4, ty: y0 + 4 });
  return out;
}

/** Sites around the centre, nearest first (rings of `SUCHSCHRITT`, a fixed order). */
function suchreihe(): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [[0, 0]];
  for (let r = SUCHSCHRITT; r <= SUCHRADIUS; r += SUCHSCHRITT) {
    for (let dy = -r; dy <= r; dy += SUCHSCHRITT) for (let dx = -r; dx <= r; dx += SUCHSCHRITT) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) out.push([dx, dy]);
  }
  return out;
}

function bauSzenario(name: string, description: string, e: Einstellung): BauSzenario {
  const reihe = suchreihe();
  let render: SzenarioRender | null = null;
  let session: NonNullable<SzenarioKontext['session']> | null = null;
  let phase: Phase = 'welt';
  let mitte = { tx: 0, ty: 0, layer: 0 };
  let naechste = 0;
  let ecke = { x0: 0, y0: 0 };
  let zuvor = 0;
  let warten = 0;
  const schritte = (n: number): void => {
    for (let i = 0; i < n; i++) session?.step();
  };
  const teleport = (tx: number, ty: number): void => {
    session?.command({ type: 'player.teleport', x: (tx + 0.5) * TILE_PX, y: (ty + 0.5) * TILE_PX, layer: mitte.layer });
  };
  const gesetzt = (): number => session?.state().events.partPlaced ?? 0;
  const geloescht = (): number => session?.state().events.fireOut ?? 0;
  return {
    name,
    description,
    settleFrames: RUHE_FRAMES,
    setup(ctx) {
      const r = ctx.render;
      if (r === undefined || ctx.session === undefined) throw new Error(`Szenario ${name} braucht Renderer und Sitzung`);
      render = r;
      session = ctx.session;
      phase = 'welt';
      naechste = 0;
      warten = 0;
      // The build mode lies over the playing HUD (values, minimap, notifications): the pictures of the bar show it too.
      if (mitHud(e.art)) hudVorgabe.value = { modus: 'full' };
      r.startGameCamera(START);
      r.showScene('spiel');
      r.setDebugView('off');
      ctx.freezeAt(BILD_ZEIT);
    },
    ready() {
      const s = session;
      if (render === null || s === null || !render.sceneReady()) return false;
      const ui = activeGameScreens();
      if (ui === null) return false;
      switch (phase) {
        case 'welt': {
          s.command({ type: 'player.spawn' });
          s.command({ type: 'setTime', hour: e.stunde, minute: 0 });
          s.command({ type: 'setWeather', state: 'klar' });
          for (const [item, count] of MATERIAL) s.command({ type: 'inventory.give', item, count });
          schritte(1);
          phase = 'geben';
          return false;
        }
        case 'geben': {
          // The build mode needs the player on the bridge (one published frame after the spawn).
          const p = s.state().player;
          if (p === null || !ui.controller.open(BAU_SCREEN)) return false;
          mitte = { tx: Math.floor(p.x / TILE_PX), ty: Math.floor(p.y / TILE_PX), layer: p.layer };
          phase = 'suchen';
          return false;
        }
        case 'suchen': {
          const off = reihe[naechste++];
          if (off === undefined) throw new Error(`Szenario ${name}: kein ebener, freier Bauplatz im Umkreis von ${SUCHRADIUS} Kacheln`);
          const cx = mitte.tx + off[0];
          const cy = mitte.ty + off[1];
          ecke = { x0: cx - HAUS.innenX, y0: cy - HAUS.innenY };
          teleport(cx, cy);
          schritte(1);
          zuvor = gesetzt();
          // The whole footprint as floor blueprints: they obey the ground rules and cost nothing.
          for (let y = 0; y < HAUS.t; y++) for (let x = 0; x < HAUS.b; x++) s.command({ type: 'build.blueprint', part: 'boden_holz', tx: ecke.x0 + x, ty: ecke.y0 + y });
          schritte(1);
          phase = 'pruefen';
          return false;
        }
        case 'pruefen': {
          const alle = gesetzt() - zuvor === HAUS.b * HAUS.t;
          for (let y = 0; y < HAUS.t; y++) for (let x = 0; x < HAUS.b; x++) s.command({ type: 'build.remove', tx: ecke.x0 + x, ty: ecke.y0 + y, ebene: 'boden' });
          schritte(1);
          phase = alle ? 'bauen' : 'suchen';
          return false;
        }
        case 'bauen':
          for (const p of hausPlan(ecke.x0, ecke.y0)) s.command({ type: 'build.place', part: p.part, tx: p.tx, ty: p.ty });
          schritte(1);
          phase = 'einrichten';
          return false;
        case 'einrichten': {
          // A torch burns inside by the door: light for the room (its type, the glowing windows, the comfort).
          const bau = aktiverBauModus();
          const bags = bau?.bridge.state.bags.peek() ?? null;
          const fackel = platzMit(bags, 'fackel');
          if (fackel === null) return false;
          s.command({ type: 'light.place', from: fackel, tx: ecke.x0 + 1, ty: ecke.y0 + HAUS.t - 2 });
          schritte(1);
          phase = 'stellen';
          return false;
        }
        case 'stellen': {
          const aussen = e.art !== 'innen';
          // Building, the player stands aside of the door (no interaction marker over the house and its labels).
          teleport(ecke.x0 + HAUS.innenX + (mitHud(e.art) ? SEITE : 0), aussen ? ecke.y0 + HAUS.t + 1 : ecke.y0 + HAUS.innenY);
          schritte(1);
          // The annex planned as blueprints (no material needed; more walls than the bags hold).
          if (e.art === 'blaupause') {
            for (const [tx, ty] of anbauPlan(ecke.x0, ecke.y0)) s.command({ type: 'build.blueprint', part: 'wand_holz', tx, ty });
            schritte(1);
          }
          if (mitWerkzeug(e.art)) {
            // The garden wall east of the house (the plank walls the house left in the bags).
            for (let i = 0; i < GARTENMAUER.laenge; i++) s.command({ type: 'build.place', part: 'wand_holz', tx: ecke.x0 + GARTENMAUER.dx, ty: ecke.y0 + GARTENMAUER.dy0 + i });
            schritte(1);
            if (e.art === 'abbauen') schritte(NACH_DER_FRIST_S * BALANCE.time.tickHz);
            if (e.art === 'aufwerten') {
              s.command({ type: 'inventory.give', item: 'wand_stein', count: GARTENMAUER.laenge });
              schritte(1);
            }
            if (e.art === 'reparieren') {
              // Rain sets in; two of the walls catch fire (debug `fire.ignite`) shortly before it puts them out.
              s.command({ type: 'setWeather', state: 'regen' });
              schritte(REGEN_VOR_DEM_BRAND_S * BALANCE.time.tickHz);
              const aus = geloescht();
              for (const i of BRENNENDE_WAENDE) s.command({ type: 'fire.ignite', tx: ecke.x0 + GARTENMAUER.dx, ty: ecke.y0 + GARTENMAUER.dy0 + i });
              for (let t = 0; geloescht() - aus < BRENNENDE_WAENDE.length; t++) {
                if (t >= LOESCHEN_BIS_S) throw new Error(`Szenario ${name}: der Regen hat das Feuer der Gartenmauer nicht in ${LOESCHEN_BIS_S} s gelöscht`);
                schritte(BALANCE.time.tickHz);
              }
              s.command({ type: 'setWeather', state: 'klar' });
              schritte(AUFKLAREN_S * BALANCE.time.tickHz);
              s.command({ type: 'inventory.give', item: 'steinhammer', count: 1 });
              s.command({ type: 'inventory.give', item: 'brett', count: REPARATUR_BRETTER });
              schritte(1);
            }
          }
          if (e.art === 'aussen' || e.art === 'innen') ui.controller.close(BAU_SCREEN);
          phase = 'bau';
          return false;
        }
        case 'bau': {
          if (e.art === 'aussen' || e.art === 'innen') {
            phase = 'fertig';
            return false;
          }
          const bau = aktiverBauModus();
          if (bau === null) return false;
          const st = bau.steuerung;
          const g = bau.ghost;
          if (e.art === 'baumenue') {
            // A plank wall as green ghost east of the house, level with the player (the cursor follows the player
            // without a mouse).
            st.waehle('wand_holz');
            g.padDx = HAUS.b - HAUS.innenX - SEITE + 1;
            g.padDy = 0;
          } else if (e.art === 'blaupause') {
            // Blueprint mode on, the ghost on the annex's open wall (relative to the player's tile).
            st.waehle('wand_holz');
            st.schalteBlaupause(true);
            g.padDx = HAUS.b + ANBAU_GEIST[0] - HAUS.innenX - SEITE;
            g.padDy = ANBAU_GEIST[1] - HAUS.t - 1;
          } else if (e.art === 'vorschau') {
            // South-west of the house, three tiles west and four south of its corner: beyond the straw roof's reach of
            // 3, within the build reach, clear of the panels at the screen's edges.
            st.waehle('dach_stroh');
            g.padDx = -(HAUS.innenX + SEITE + 3);
            g.padDy = 2;
          } else if (mitWerkzeug(e.art)) {
            // The cursor relative to the player (south of the house, `SEITE` east of the door); drags from a tile of the
            // house or of the garden wall.
            const spieler = { x: ecke.x0 + HAUS.innenX + SEITE, y: ecke.y0 + HAUS.t + 1 };
            const mauerX = ecke.x0 + GARTENMAUER.dx;
            const mauerY0 = ecke.y0 + GARTENMAUER.dy0;
            if (e.art === 'abbauen') {
              st.waehleWerkzeug('abbauen', null, false);
              // The house's south-east corner: two columns, two rows – three walls, four roof tiles, a floor tile.
              st.zeigeZug(ecke.x0 + HAUS.b - 2, ecke.y0 + HAUS.t - 2);
              g.padDx = ecke.x0 + HAUS.b - 1 - spieler.x;
              g.padDy = ecke.y0 + HAUS.t - 1 - spieler.y;
            } else if (e.art === 'aufwerten') {
              st.waehle('wand_stein');
              st.waehleWerkzeug('aufwerten', null, false);
              st.zeigeZug(mauerX, mauerY0);
              g.padDx = mauerX - spieler.x;
              g.padDy = mauerY0 + GARTENMAUER.laenge - 1 - spieler.y;
            } else {
              // From the north-east to the south-west: the cost over the cursor stays clear of the clock's buttons.
              st.waehleWerkzeug('reparieren', bau.bridge.state.bags.peek(), true);
              st.zeigeZug(mauerX + 1, mauerY0 - 1);
              g.padDx = mauerX - 1 - spieler.x;
              g.padDy = mauerY0 + GARTENMAUER.laenge - spieler.y;
            }
          } else if (e.overlay !== undefined) {
            // The ghost stands aside, east of the house, where the overlay has nothing to say.
            st.waehle('wand_holz');
            g.padDx = HAUS.b - HAUS.innenX - SEITE + 1;
            g.padDy = 0;
            st.schalteOverlay(e.overlay);
          }
          phase = 'fertig';
          return false;
        }
        case 'fertig':
          // The roof of the interior lifts frame by frame while the picture's clock stands still.
          if (warten < FADE_FRAMES + 2) {
            warten++;
            return false;
          }
          if (mitHud(e.art)) {
            // The pickups of the given materials run their course (their own scenario is hud-meldungen).
            const w = aktiveHudWelt()?.warteschlange;
            if (w !== undefined && (w.sichtbar.length > 0 || w.wartend > 0)) return false;
            // The message of the blueprint switch has run out: the status line shows the ghost's verdict.
            const meldung = aktiverBauModus()?.steuerung.meldung.peek();
            if (meldung !== undefined && meldung !== null) return false;
          }
          return atlasImagesVersion.value > 0;
      }
    },
  };
}

/** The scenarios of building (registered in src/debug/scenarios.ts). */
export function bauSzenarien(): BauSzenario[] {
  return [
    bauSzenario('ui-baumenue', 'M4-22: Baumodus über einem Holzhaus am Startstrand um 11:00 (HUD Voll) – Bautafel rechts unter der Minimap: Kategorienleiste (nur Kategorien mit Bauteilen), Suche, Holzwände mit Vorrat und Kosten; unten Statuszeile „Frei“ und die Gesten mit Maus- und Tastenglyphen; eine Holzwand als grüner Geist östlich des Hauses', { art: 'baumenue', stunde: 11 }),
    bauSzenario('bau-vorschau', 'M4-22/M4-38: Geister-Vorschau rot mit Grund – ein Strohdach südwestlich des Hauses, weit weg von jeder Wand: „Keine Stütze in Reichweite“ mittig über dem Geist und mit Lösung in der Statuszeile; Gesten mit Maus-Glyphe (LMB setzen; RMB drehen entfällt: Dächer haben eine Richtung) und Tastenkappen', { art: 'vorschau', stunde: 11 }),
    bauSzenario('bau-blaupause', 'M4-24: Baumodus mit Blaupause an (G) – ein Anbau östlich des Hauses als Holzwand-Blaupausen geplant (mehr, als die Taschen haben), der Geist seiner nächsten Wand im Planblau auf blauem Feld; Schalter „Blaupause“ leuchtet, Statuszeile „Frei – hier kannst du eine Blaupause planen.“ mit blauer Kante, darüber „Blaupausen brauchen noch: 4× Holzwand“, Hinweis G leuchtet', { art: 'blaupause', stunde: 11 }),
    bauSzenario('bau-abbauen', 'Review M4 #1 (§16.6 Abbauen): Werkzeug Abbauen, eine halbe Minute nach dem Bau – die Südostecke des Hauses als Fläche gezogen (Dach, Wände, Boden bernsteinfarben), „60 % zurück“ über dem Zeiger, in der Statuszeile wie viele Teile und was zurückkommt; die Werkzeugleiste mit Abbauen hervorgehoben, darunter nur dessen Gesten', { art: 'abbauen', stunde: 11 }),
    bauSzenario('bau-aufwerten', 'Review M4 #1 (§16.6 Aufwerten): Werkzeug Aufwerten mit Steinwand gewählt – die Gartenmauer aus vier Holzwänden östlich des Hauses in einem Zug gezogen, die Steinwände grün über den Brettern, „» Steinwand“ und die Kosten (4× Steinwand)', { art: 'aufwerten', stunde: 11 }),
    bauSzenario('bau-reparieren', 'Review M4 #1 (§16.6 Flächenreparatur): Werkzeug Reparieren nach einem kurzen Brand der Gartenmauer (debug fire.ignite, Regen löscht) – der Steinhammer in der Hand, die Fläche eisblau, die beschädigten Wände grün, „2 beschädigte Teile reparieren – kostet …× Brett“', { art: 'reparieren', stunde: 11 }),
    bauSzenario('overlay-raeume', 'M4-26: Overlay Räume/Typen – das Holzhaus als Schlafraum (Bett und Licht) in seiner Typfarbe mit Name und Größe, Legende der Raumtypen', { art: 'overlay', stunde: 11, overlay: 'raeume' }),
    // `overlay-temperatur` is the debug overlay of the temperature field (M2-29); the build overlay is the room temperature.
    bauSzenario('overlay-raumtemperatur', 'M4-26: Overlay Temperatur in einer Frühlingsnacht um 23:00 – der Innenraum (Holzwände, Strohdach, Fackel) wärmer als die Luft draußen, in den Stufen Frost … heiß (Legende), Werte je Raum und alle acht Felder draußen', { art: 'overlay', stunde: 23, overlay: 'temperatur' }),
    bauSzenario('overlay-licht', 'M4-26: Overlay Licht bei Nacht um 23:00 – die Stufen der Lichtkarte (dunkel, dämmrig, hell, gleißend) um die Fackel im Haus und die Figur', { art: 'overlay', stunde: 23, overlay: 'licht' }),
    bauSzenario('overlay-behaglichkeit', 'M4-26: Overlay Behaglichkeit – das Holzhaus in der Farbe seiner Behaglichkeit 0–20 mit dem Wert', { art: 'overlay', stunde: 11, overlay: 'behaglichkeit' }),
    bauSzenario('overlay-stuetzen', 'M4-26: Overlay Stützen – jedes Dachfeld in der Farbe seines Abstands zur nächsten Wand (Stroh: Reichweite 3), die Stützen markiert, Legende', { art: 'overlay', stunde: 11, overlay: 'stuetzen' }),
    bauSzenario('haus-aussen', 'M4-27: Holzhaus von außen um 11:00 – Strohdach über Wänden, Tür und Fenstern, der Spieler südlich vor der Tür', { art: 'aussen', stunde: 11 }),
    bauSzenario('haus-innen', 'M4-27: dasselbe Haus von innen – das Dach ist ausgeblendet (nur sein Rand bleibt), die Wände vor dem Raum sind gekappt: Bett, Lampe, Tisch, Stuhl, Regal, Bild und Fackel sichtbar', { art: 'innen', stunde: 11 }),
  ];
}
