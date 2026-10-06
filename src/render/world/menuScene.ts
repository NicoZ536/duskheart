/**
 * The main menu's living pixel scene (MASTERPROMPT §26 "Hauptmenü mit lebendiger Pixel-Szene"; docs/SPIEL.md §25
 * "Boot-Ablauf": "kleine feste Welt „Klein“, Kamera auf einem Küstenlager, Zeitraffer von Tag, Wetter und Licht, keine
 * Figur"; M7-50).
 *
 * The menu runs a session of its own on a small fixed world (`MENU_WORLD`) and shows it through the game view: the free
 * title camera (`titleCamera`, the start beach turned towards the sea) looks at a coast camp – a camp fire and two
 * torches on their stakes – beside the picture's centre, right of the menu's column. The scene is set up only through
 * commands, like the screenshot scenarios (`MenuScene` never writes simulation state):
 *
 * - the world is peaceful (`world.setSettings {friedlich}`: no foes, no shadow brood – the animals stay), the player is
 *   spawned in god mode, builds the camp in one tick and then waits out of the picture (`MENU_CAMP.hideoutTiles`
 *   inland, inside the active zone, so the camp's lights burn and are simulated);
 * - time runs `MENU_TIME_SCALE` times faster (day and night pass in minutes; 1× with reduced motion, §29), the weather
 *   is forced through `MENU_WEATHER` every `MENU_CAMP.weatherEveryGameHours` – none of them puts a fire out;
 * - the keeper (`frame`): the fire gets a log whenever one has burned (`MENU_CAMP.fuelEverySeconds`), a torch that
 *   burned down is set up again where it stood, a fire the rain put out after all is lit again once it is dry – each
 *   done by the player stepping to the camp and back within one tick, never seen.
 *
 * The game view never sees the player (`menuRenderView`: no focus, no player sample – free camera, no figure); the
 * audio kernel hears the camp from its middle (`menuAudioView`) without the keeper's own events (placing, fuelling,
 * stepping, refusals).
 */
import type { WeatherStateId } from '../../content/weather';
import type { DayLengthMinutes } from '../../engine/time';
import type { GameSession, SessionEventHandler, SessionFocus } from '../../game/session';
import type { SimEventMap } from '../../game/sim';
import type { GeneratedWorld } from '../../world/gen/world';
import { TILE_PX } from '../../world/model/coords';
import { worldDimensions } from '../../world/model/worldSize';
import type { GameWorldBinding } from './gameScene';
import { titleCamera } from './gameScene';

/** The menu's world: small and fixed (the same coast every start), the shortest day. */
export const MENU_WORLD = { seed: 7_202_407, worldSize: 'small', dayLengthMinutes: 12 as DayLengthMinutes } as const;
/** Time-lapse of the menu [× game speed]: a 12-minute day passes in 3 minutes. */
export const MENU_TIME_SCALE = 4;
/** Clock when the scene starts: the late afternoon light turns to dusk and the camp's lights take over (§4.1). */
export const MENU_START = { hour: 17, minute: 30 } as const;
/** The forced weather, in turn: none of them puts a fire out (a drizzle does not, `BALANCE.fire.rainFromPrecipitation`). */
export const MENU_WEATHER: readonly WeatherStateId[] = ['klar', 'bewoelkt', 'niesel', 'nebel', 'klar', 'schnee'];

/** The camp and its keeping. */
export const MENU_CAMP = {
  /** Camp centre from the title camera's tile [tiles]: right of the picture's centre, clear of the menu's column. */
  offset: [6, 1] as const,
  /** Fire tiles tried around the centre, in order (the first free one takes the camp fire) [tiles]. */
  fireSpots: [
    [0, 0],
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
    [2, 1],
    [-2, 1],
    [1, -2],
  ] as ReadonlyArray<readonly [number, number]>,
  /**
   * Torch stakes tried from the fire, in order; two of them take a torch [tiles]. On the menu world's beach the first two
   * flank the fire on open sand – right of it and up-left (a stake further left stood under a pine's crown, only its flame
   * showed above the needles); the others are the fallbacks of a refused spot.
   */
  torchSpots: [
    [3, 1],
    [-1, -3],
    [0, -3],
    [3, -2],
    [-3, 2],
    [-4, 0],
    [4, 0],
  ] as ReadonlyArray<readonly [number, number]>,
  /** Torches the camp has. */
  torches: 2,
  /** Logs the fire starts with (§15.4: 45 s each; the fire holds 6 min, so one log more always fits). */
  startLogs: 5,
  /** Seconds of fuel one log gives [s] (§15.4 "Holzscheit 45 s"): the keeper adds one each time that much has burned. */
  fuelEverySeconds: 45,
  /** How far inland the player waits [tiles]: out of the picture at every aspect, inside the active zone (radius 2 chunks). */
  hideoutTiles: 30,
  /** Game hours between two weather changes. */
  weatherEveryGameHours: 3,
} as const;

/** Simulation ticks per second (the fixed step, `BALANCE.time.tickHz`). */
const TICKS_PER_SECOND = 60;
/** Game minutes per hour. */
const MINUTES_PER_HOUR = 60;

/** Events of the keeper's own doing: the audio kernel does not hear them (nobody is seen doing it). */
export const MENU_SILENT_EVENTS: ReadonlySet<keyof SimEventMap> = new Set<keyof SimEventMap>([
  'commandRejected',
  'playerSpawned',
  'playerStateChanged',
  'playerLanded',
  'playerStep',
  'inventoryChanged',
  'lightPlaced',
  'lightRemoved',
  'lightIgnited',
  'fireFueled',
  'carriedLightChanged',
  'worldSettingsChanged',
]);

/** What the menu scene needs of the session. */
export type MenuSceneSession = Pick<GameSession, 'command' | 'onEvent' | 'sim'>;

type Phase = 'wartet' | 'spieler' | 'feuer' | 'lager' | 'fackeln' | 'laeuft';

/** A torch stake of the camp and the light standing on it now (null while burned down). */
interface Stake {
  readonly tx: number;
  readonly ty: number;
  light: number | null;
  /** Tick from which a burned-down stake is tried again (a refused try waits `STAKE_RETRY_TICKS`). */
  retryAt: number;
}

/** Frames (each after a tick) the scene waits for the camp fire before it sets up the torches without one (its tries took one tick). */
const FIRE_WAIT_TICKS = 3;
/** Ticks a refused torch waits before its stake is tried again (a second). */
const STAKE_RETRY_TICKS = TICKS_PER_SECOND;

let active: MenuScene | null = null;

/** The menu scene of the page while it runs (the screenshot scenarios drive it), or null. */
export function activeMenuScene(): MenuScene | null {
  return active;
}

/** Starts the page's menu scene on `session` (`activeMenuScene` until it is disposed). */
export function startMenuScene(session: MenuSceneSession): MenuScene {
  const scene = new MenuScene(session);
  active = scene;
  return scene;
}

export class MenuScene {
  private phase: Phase = 'wartet';
  private centre = { tx: 0, ty: 0 };
  private hideout = { x: 0, y: 0 };
  private fire: { light: number; tx: number; ty: number } | null = null;
  private fireOut = false;
  private readonly stakes: Stake[] = [];
  /** Next torch spot to try while the camp is set up, and the stake tried last (its result comes with the next tick). */
  private torchTry = 0;
  private tried: Stake | null = null;
  /** Frames waited for the fire's `lightPlaced` (each after a tick). */
  private waited = 0;
  /** Simulation tick when the scene last sent commands (they take effect in the tick after it). */
  private sentAt = -1;
  private fuelAt = 0;
  private weatherAt = 0;
  private weatherIndex = 0;
  private readonly stops: Array<() => void> = [];

  constructor(private readonly session: MenuSceneSession) {
    this.stops.push(
      session.onEvent('playerSpawned', () => {
        if (this.phase === 'spieler') this.phase = 'feuer';
      }),
      session.onEvent('lightPlaced', (e) => this.placed(e)),
      session.onEvent('lightRemoved', (e) => {
        for (const s of this.stakes) if (s.light === e.light) s.light = null;
      }),
      session.onEvent('lightExtinguished', (e) => {
        if (this.fire !== null && e.light === this.fire.light) this.fireOut = true;
      }),
      session.onEvent('lightIgnited', (e) => {
        if (this.fire !== null && e.light === this.fire.light) this.fireOut = false;
      }),
    );
  }

  /** Whether the camp stands and the scene runs. */
  get ready(): boolean {
    return this.phase === 'laeuft';
  }

  /** The camp's centre tile (the audio listener's place). */
  get campTile(): { readonly tx: number; readonly ty: number } {
    return this.centre;
  }

  /** The time scale of the menu: the time-lapse, or 1× with reduced motion (§29). */
  timeScale(reducedMotion: boolean): number {
    return reducedMotion ? 1 : MENU_TIME_SCALE;
  }

  /** The world is there: the scene sets itself up from the next frame on. */
  start(world: GeneratedWorld): void {
    if (this.phase !== 'wartet') return;
    const cam = titleCamera(world);
    this.centre = { tx: cam.x + MENU_CAMP.offset[0], ty: cam.y + MENU_CAMP.offset[1] };
    // Inland: from the camera back towards the start beach (the title camera moved from there towards the sea).
    let dx = world.spawn.x - cam.x;
    let dy = world.spawn.y - cam.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) {
      dx = 0;
      dy = -1;
    } else {
      dx /= len;
      dy /= len;
    }
    const tiles = worldDimensions(MENU_WORLD.worldSize).tiles;
    const htx = Math.min(tiles - 1, Math.max(0, Math.round(this.centre.tx + dx * MENU_CAMP.hideoutTiles)));
    const hty = Math.min(tiles - 1, Math.max(0, Math.round(this.centre.ty + dy * MENU_CAMP.hideoutTiles)));
    this.hideout = { x: (htx + 0.5) * TILE_PX, y: (hty + 0.5) * TILE_PX };
    this.command({ type: 'world.setSettings', friedlich: true });
    this.command({ type: 'debug.god', on: true });
    this.command({ type: 'setTime', hour: MENU_START.hour, minute: MENU_START.minute });
    this.command({ type: 'setWeather', state: MENU_WEATHER[0] ?? 'klar' });
    this.command({ type: 'player.spawn' });
    this.phase = 'spieler';
  }

  /** Once per rendered frame (also while time is frozen: the scenario steps the session itself). */
  frame(): void {
    // Commands sent in an earlier frame take effect in the next tick: until it ran (time may be frozen – the screenshot
    // scenarios step the session themselves) nothing more is sent, so no try is ever sent twice.
    if (this.session.sim.tick <= this.sentAt) return;
    switch (this.phase) {
      case 'wartet':
      case 'spieler':
        return;
      case 'feuer':
        this.buildFire();
        return;
      case 'lager':
        // No free fire spot at all: the camp makes do with its torches.
        if (this.fire === null) {
          if (++this.waited >= FIRE_WAIT_TICKS) this.phase = 'fackeln';
          return;
        }
        this.lightFire();
        return;
      case 'fackeln':
        this.setUpTorches();
        return;
      case 'laeuft':
        this.keep();
        return;
    }
  }

  /** Stops listening (the page leaves the menu). */
  dispose(): void {
    for (const stop of this.stops.splice(0)) stop();
    if (active === this) active = null;
  }

  private command(raw: unknown): void {
    this.session.command(raw);
    this.sentAt = this.session.sim.tick;
  }

  private standBeside(tx: number, ty: number): void {
    this.command({ type: 'player.teleport', x: (tx + 0.5) * TILE_PX, y: (ty - 0.5) * TILE_PX, layer: 0 });
  }

  private hide(): void {
    this.command({ type: 'player.teleport', x: this.hideout.x, y: this.hideout.y, layer: 0 });
  }

  /** The camp fire on the first free spot: tried from beside each spot in one tick; the item is gone after the first. */
  private buildFire(): void {
    this.command({ type: 'inventory.give', item: 'lagerfeuer', count: 1 });
    for (const [ox, oy] of MENU_CAMP.fireSpots) {
      const tx = this.centre.tx + ox;
      const ty = this.centre.ty + oy;
      this.standBeside(tx, ty);
      this.command({ type: 'light.place', from: { bereich: 'inventar', index: 0 }, tx, ty });
    }
    this.hide();
    this.phase = 'lager';
  }

  /** Fuel and light the fire. */
  private lightFire(): void {
    const fire = this.fire;
    if (fire === null) return;
    this.standBeside(fire.tx, fire.ty);
    this.command({ type: 'inventory.give', item: 'holz', count: MENU_CAMP.startLogs });
    this.command({ type: 'light.fuel', light: fire.light, from: { bereich: 'inventar', index: 0 }, count: MENU_CAMP.startLogs });
    this.command({ type: 'light.ignite', tx: fire.tx, ty: fire.ty });
    this.hide();
    this.phase = 'fackeln';
  }

  /**
   * One torch spot per frame (its result – `lightPlaced` or a refusal – comes with the next tick) until the camp has its
   * torches or no spot is left; then the keeper starts.
   */
  private setUpTorches(): void {
    const anchor = this.fire ?? this.centre;
    const tried = this.tried;
    this.tried = null;
    if (tried !== null && tried.light !== null) this.stakes.push(tried);
    if (this.stakes.length < MENU_CAMP.torches && this.torchTry < MENU_CAMP.torchSpots.length) {
      const spot = MENU_CAMP.torchSpots[this.torchTry++] as readonly [number, number];
      const stake: Stake = { tx: anchor.tx + spot[0], ty: anchor.ty + spot[1], light: null, retryAt: 0 };
      this.tried = stake;
      this.placeTorch(stake);
      this.hide();
      return;
    }
    const tick = this.session.sim.tick;
    this.fuelAt = tick + MENU_CAMP.fuelEverySeconds * TICKS_PER_SECOND;
    this.weatherAt = tick + this.weatherTicks();
    this.phase = 'laeuft';
  }

  /** A torch onto `stake` from beside it (the torch given into the first free hotbar slot). */
  private placeTorch(stake: Stake): void {
    this.standBeside(stake.tx, stake.ty);
    this.command({ type: 'inventory.give', item: 'fackel', count: 1 });
    this.command({ type: 'light.place', from: { bereich: 'schnellleiste', index: 0 }, tx: stake.tx, ty: stake.ty });
  }

  private placed(e: SimEventMap['lightPlaced']): void {
    if (e.kind === 'lagerfeuer' && this.fire === null) {
      this.fire = { light: e.light, tx: e.tx, ty: e.ty };
      return;
    }
    const stake = this.tried !== null && this.tried.tx === e.tx && this.tried.ty === e.ty ? this.tried : this.stakes.find((s) => s.tx === e.tx && s.ty === e.ty);
    if (stake !== undefined) stake.light = e.light;
  }

  /** Ticks between two weather changes. */
  private weatherTicks(): number {
    const ticksPerDay = MENU_WORLD.dayLengthMinutes * MINUTES_PER_HOUR * TICKS_PER_SECOND;
    return Math.round((ticksPerDay / 24) * MENU_CAMP.weatherEveryGameHours);
  }

  /** The keeper: fuel, torches, a fire the rain put out, the weather. */
  private keep(): void {
    const fire = this.fire;
    const tick = this.session.sim.tick;
    let away = false;
    if (fire !== null && tick >= this.fuelAt) {
      this.fuelAt = tick + MENU_CAMP.fuelEverySeconds * TICKS_PER_SECOND;
      this.standBeside(fire.tx, fire.ty);
      this.command({ type: 'inventory.give', item: 'holz', count: 1 });
      this.command({ type: 'light.fuel', light: fire.light, from: { bereich: 'inventar', index: 0 }, count: 1 });
      // A fire the rain put out lights again once the rain is gone (in the rain the ignition is refused, unheard).
      if (this.fireOut) this.command({ type: 'light.ignite', tx: fire.tx, ty: fire.ty });
      away = true;
    }
    for (const stake of this.stakes) {
      if (stake.light !== null || tick < stake.retryAt) continue;
      stake.retryAt = tick + STAKE_RETRY_TICKS;
      this.placeTorch(stake);
      away = true;
    }
    if (away) this.hide();
    if (tick >= this.weatherAt) {
      this.weatherAt = tick + this.weatherTicks();
      this.weatherIndex = (this.weatherIndex + 1) % MENU_WEATHER.length;
      this.command({ type: 'setWeather', state: MENU_WEATHER[this.weatherIndex] ?? 'klar' });
    }
  }
}

/**
 * The session as the game view of the menu sees it: no focus and no player – the free title camera stays on the camp
 * and no figure is drawn – everything else as the session has it.
 */
export function menuRenderView(session: GameSession): GameWorldBinding['session'] {
  return {
    get sim() {
      return session.sim;
    },
    sampleFocus: () => false,
    samplePlayer: () => false,
    sampleSight: () => session.sampleSight(),
    onEvent: <K extends keyof SimEventMap>(type: K, handler: SessionEventHandler<K>) => session.onEvent(type, handler),
    command: (raw: unknown) => session.command(raw),
    get input() {
      return session.input;
    },
    get reader() {
      return session.reader;
    },
    get renderAlpha() {
      return session.renderAlpha;
    },
  };
}

/** The session as the audio kernel of the menu hears it: from the camp's middle, without the keeper's own events. */
export function menuAudioView(session: GameSession, scene: MenuScene): { onEvent: GameSession['onEvent']; sampleFocus(out: SessionFocus): boolean; readonly sim: GameSession['sim'] } {
  return {
    onEvent: <K extends keyof SimEventMap>(type: K, handler: SessionEventHandler<K>) => (MENU_SILENT_EVENTS.has(type) ? () => undefined : session.onEvent(type, handler)),
    sampleFocus(out: SessionFocus): boolean {
      const c = scene.campTile;
      out.x = (c.tx + 0.5) * TILE_PX;
      out.y = (c.ty + 0.5) * TILE_PX;
      out.layer = 0;
      return true;
    },
    get sim() {
      return session.sim;
    },
  };
}
