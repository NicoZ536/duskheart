/**
 * The build mode's controller (MASTERPROMPT §16.6, §26 "Standardbelegung … R Drehen, B Bauen"; M4-22, M4-23):
 * what the player chose and what the input of a frame does with it. DOM-free; the build mode's screen
 * (`BauModus.tsx`) renders its signals and calls `frame` once per rendered frame while the world is in front.
 *
 * - **Choice:** category, piece, search text; the piece goes to the shared ghost record (`BuildGhost`), which the
 *   game view draws and judges. Rotation only for pieces with directions (stairs, gate), mirror only for pieces
 *   with a mirrorable sprite (furniture, stations); a new piece keeps what applies to it.
 * - **Placing** (context `build`): the primary button (LMB, RT) places one piece at once, or starts a drag for
 *   walls, fences (line, outline) and floors, roofs, jetties (filled area) that places everything the ghost found
 *   placeable on release; the secondary button (RMB, LT) cancels a drag or turns (§26 "R Drehen", M4-38 "RMB
 *   drehen"), R/X turns, F/Y mirrors, the middle button/RS takes the piece under the cursor (pipette), Ctrl+Z/B
 *   takes back the newest step (`BauVerlauf`). With a gamepad the right stick moves the cursor tile by tile around
 *   the player (held: repeating). A click that would place nothing sends its first anchor anyway: the simulation
 *   answers with the reason, which the screen shows (§26 "Fehlermeldungen sagen, was fehlt").
 * - **Blueprints** (§16.6 "Blaupausen: Pläne ohne Material platzieren", M4-24): G (pad RB, action `blueprint`) or
 *   the panel's switch turns blueprint mode on and off; in it a click or a drag plans the ghost's anchors with
 *   `build.blueprint` – no material, the same undo – and stations, which have no plan, are refused.
 * - **Tools** (§16.6 "Aufwerten an Ort und Stelle (Holz → Stein), Flächenreparatur, Abbauen (100 % zurück in den
 *   ersten 30 s, danach 60 %)"): 1–4 (actions `toolPlace` … `toolRepair`), the pad's LB (`toolNext`, in turn) or the
 *   tool bar choose placing, dismantling, upgrading or repairing. The ghost judges the targets (src/render/game/ghost.ts);
 *   a click acts on the one under the cursor, a drag on a rectangle (upgrading: the chosen piece's line or area) on
 *   release:
 *   - `abbauen` sends `build.remove` with the target's build layer, `station.remove` for a station, `light.take` for a
 *     standing torch – more than `BESTAETIGEN_AB` at once wait for a second click (the secondary button cancels);
 *   - `aufwerten` sends `build.upgrade` with the chosen piece for every part it may replace;
 *   - `reparieren` sends `build.repair` for the rectangle; choosing the tool takes a hammer from the hotbar into the hand
 *     (`player.selectHotbar`), because the simulation mends only with a hammer in the hand.
 *   Nothing to act on: the first target is sent anyway, so the simulation names the reason (the status line shows it).
 * - **Selecting by keys:** Tab/I (D-pad up) opens the piece selection with focus navigation (context `ui`); a
 *   choice or back returns to placing.
 */
import { signal, type ReadonlySignal } from '@preact/signals';
import type { Action } from '../../../engine/input/actions';
import type { BagsState } from '../../../game/inventory/bags';
import type { SlotRef } from '../../../game/items/slots';
import { BALANCE } from '../../../content/balance';
import type { BuildLayer } from '../../../content/buildParts';
import { CONTENT } from '../../../content/index';
import { BUILD_TOOLS, type BuildGhost, type BuildTool, type ToolTarget } from '../../../render/game/ghost';
import type { BuildOverlay } from '../../../render/game/overlays';
import type { UiInput } from '../../bridge';
import { bauKatalog, eintraegeDer, platzMit, sichtbareKategorien, vorrat, type BauEintrag, type BauKategorie } from './katalog';
import { BauVerlauf, UNDO_SECONDS } from './werkzeuge';

/** The commands the build mode sends (`bridge.actions.build`, and the hand's hotbar slot for the repair tool). */
export interface BauBefehle {
  place(part: string, tx: number, ty: number, rot?: number, mirror?: boolean): void;
  blueprint(part: string, tx: number, ty: number, rot?: number, mirror?: boolean): void;
  remove(tx: number, ty: number, ebene?: BuildLayer): void;
  placeStation(from: SlotRef, tx: number, ty: number, mirror?: boolean): void;
  removeStation(station: number): void;
  upgrade(tx: number, ty: number, part: string): void;
  repair(tx0: number, ty0: number, tx1: number, ty1: number): void;
  takeLight(light: number): void;
  /** Takes hotbar slot `index` into the hand (`player.selectHotbar`). */
  selectHotbar(index: number): void;
}

/** A command of the dismantle tool: a part on its build layer, a station, a standing light. */
export type Abbau = { readonly art: 'bauteil'; readonly tx: number; readonly ty: number; readonly ebene: BuildLayer } | { readonly art: 'station'; readonly id: number } | { readonly art: 'licht'; readonly id: number };

/** Dismantling that waits for a second click (more than `BESTAETIGEN_AB` pieces at once). */
export interface Bestaetigung {
  readonly befehle: readonly Abbau[];
}

/** More pieces than this dismantled by one drag wait for a confirming click (a stray drag takes nothing down); a balance value. */
export const BESTAETIGEN_AB = BALANCE.building.dismantleConfirmAbove;
/** The tool actions (1–4) in tool order. */
const TOOL_ACTIONS: ReadonlyArray<readonly [Action, BuildTool]> = [
  ['toolPlace', 'setzen'],
  ['toolDismantle', 'abbauen'],
  ['toolUpgrade', 'aufwerten'],
  ['toolRepair', 'reparieren'],
];

/** The input the controller reads (the session's `ActionReader`). */
export type BauEingabe = Pick<UiInput, 'wasPressed' | 'wasPressedAnyContext' | 'isDown' | 'lastDevice' | 'setContext'>;

/** A short message of the screen: an i18n key with parameters, shown until `bis` [ms]. */
export interface BauMeldung {
  readonly key: string;
  readonly params?: Readonly<Record<string, string | number>>;
  readonly bis: number;
  /** Shown in the warning colour. */
  readonly warnung: boolean;
}

/** How long a message stays [ms]. */
export const MELDUNG_MS = 2600;
/** Farthest the gamepad cursor goes from the player [tiles] (the build reach, §16.1). */
const CURSOR_REACH = BALANCE.building.reachTiles;
/** Gamepad cursor repeat: delay and interval while the stick is held [ms]. */
const REPEAT_DELAY_MS = 320;
const REPEAT_INTERVAL_MS = 90;
/** Right stick directions and their cursor steps. */
const AIM: ReadonlyArray<readonly [Action, number, number]> = [
  ['aimUp', 0, -1],
  ['aimDown', 0, 1],
  ['aimLeft', -1, 0],
  ['aimRight', 1, 0],
];
/** Quarter turns of a full turn. */
const TURNS = 4;

export class BauSteuerung {
  readonly eintraege: readonly BauEintrag[];
  readonly kategorien: readonly BauKategorie[];
  private readonly kategorieS = signal<BauKategorie>('fundament');
  private readonly auswahlS = signal<string | null>(null);
  private readonly sucheS = signal('');
  private readonly katalogS = signal(false);
  private readonly overlayS = signal<BuildOverlay | null>(null);
  private readonly meldungS = signal<BauMeldung | null>(null);
  /** Rotation and mirror as signals (the hint shows them). */
  private readonly drehungS = signal(0);
  private readonly spiegelS = signal(false);
  private readonly blaupauseS = signal(false);
  private readonly werkzeugS = signal<BuildTool>('setzen');
  private readonly bestaetigungS = signal<Bestaetigung | null>(null);
  readonly verlauf = new BauVerlauf();
  private readonly byId: ReadonlyMap<string, BauEintrag>;
  private repeatAt = 0;
  private repeatDir = -1;
  /** A drag no button holds (a screenshot scenario shows one under way, `zeigeZug`): it stays until a press or cancel. */
  private zugOhneTaste = false;

  constructor(
    private readonly ghost: BuildGhost,
    private readonly befehle: BauBefehle,
    private readonly now: () => number = () => performance.now(),
    eintraege: readonly BauEintrag[] = bauKatalog(),
  ) {
    this.eintraege = eintraege;
    this.kategorien = sichtbareKategorien(eintraege);
    this.byId = new Map(eintraege.map((e) => [e.id, e]));
    this.kategorieS.value = this.kategorien[0] ?? 'fundament';
  }

  get kategorie(): ReadonlySignal<BauKategorie> {
    return this.kategorieS;
  }
  get auswahl(): ReadonlySignal<string | null> {
    return this.auswahlS;
  }
  get suche(): ReadonlySignal<string> {
    return this.sucheS;
  }
  get katalog(): ReadonlySignal<boolean> {
    return this.katalogS;
  }
  get overlay(): ReadonlySignal<BuildOverlay | null> {
    return this.overlayS;
  }
  get meldung(): ReadonlySignal<BauMeldung | null> {
    return this.meldungS;
  }
  get drehung(): ReadonlySignal<number> {
    return this.drehungS;
  }
  get gespiegelt(): ReadonlySignal<boolean> {
    return this.spiegelS;
  }
  /** Blueprint mode (M4-24). */
  get blaupause(): ReadonlySignal<boolean> {
    return this.blaupauseS;
  }
  /** The tool in use (§16.6). */
  get werkzeug(): ReadonlySignal<BuildTool> {
    return this.werkzeugS;
  }
  /** Dismantling that waits for a confirming click, or `null`. */
  get bestaetigung(): ReadonlySignal<Bestaetigung | null> {
    return this.bestaetigungS;
  }

  /** The entry of `id`, or `undefined`. */
  eintrag(id: string | null): BauEintrag | undefined {
    return id === null ? undefined : this.byId.get(id);
  }

  /** The chosen entry. */
  gewaehlt(): BauEintrag | undefined {
    return this.eintrag(this.auswahlS.peek());
  }

  /** Build mode opens: the ghost is drawn with the last piece, or the first one the bags hold. */
  oeffnen(bags: BagsState | null): void {
    const g = this.ghost;
    g.active = true;
    g.overlay = this.overlayS.peek();
    g.blueprint = this.blaupauseS.peek();
    g.tool = this.werkzeugS.peek();
    const last = this.gewaehlt();
    const first = last ?? this.eintraege.find((e) => vorrat(bags, e.id) > 0) ?? this.eintraege[0];
    if (first !== undefined) this.waehle(first.id);
  }

  /** Build mode closes: nothing is drawn, a drag is dropped, the selection by keys ends. */
  schliessen(): void {
    const g = this.ghost;
    g.active = false;
    g.dragTx = Number.NaN;
    g.dragTy = Number.NaN;
    g.lockTx = Number.NaN;
    g.lockTy = Number.NaN;
    g.toolLabel = null;
    g.clearResults();
    this.katalogS.value = false;
    this.bestaetigungS.value = null;
  }

  /** Chooses the piece `id` (its category follows); rotation and mirror stay where they apply. */
  waehle(id: string): void {
    const e = this.byId.get(id);
    if (e === undefined) return;
    this.auswahlS.value = id;
    if (this.sucheS.peek() === '') this.kategorieS.value = e.kategorie;
    const g = this.ghost;
    g.piece = e.id;
    g.source = e.source;
    g.dragTx = Number.NaN;
    g.dragTy = Number.NaN;
    if (!e.drehbar) this.setzeDrehung(0);
    if (!e.spiegelbar) this.setzeSpiegel(false);
  }

  /**
   * The player takes piece `id` from the panel (a click, Enter in the selection or the search): chosen, and while
   * dismantling or repairing the build mode returns to placing it – upgrading keeps its tool (the piece is what the
   * parts become).
   */
  nimm(id: string): void {
    if (!this.byId.has(id)) return;
    this.waehle(id);
    const tool = this.werkzeugS.peek();
    if (tool === 'abbauen' || tool === 'reparieren') this.waehleWerkzeug('setzen', null, false);
  }

  /** Shows category `k` (and chooses its first piece when the chosen one lies elsewhere). */
  zeigeKategorie(k: BauKategorie): void {
    this.kategorieS.value = k;
    this.sucheS.value = '';
    if (this.gewaehlt()?.kategorie !== k) {
      const first = eintraegeDer(this.eintraege, k)[0];
      if (first !== undefined) this.waehle(first.id);
    }
  }

  /** The next or previous visible category (Q/E, LB/RB in the selection). */
  blaettere(schritt: number): void {
    const ks = this.kategorien;
    if (ks.length === 0) return;
    const i = ks.indexOf(this.kategorieS.peek());
    this.zeigeKategorie(ks[(((i + schritt) % ks.length) + ks.length) % ks.length] as BauKategorie);
  }

  setzeSuche(text: string): void {
    this.sucheS.value = text;
  }

  /** Shows the overlay `kind` (the same again: off). */
  schalteOverlay(kind: BuildOverlay | null): void {
    const next = kind === this.overlayS.peek() ? null : kind;
    this.overlayS.value = next;
    this.ghost.overlay = next;
  }

  /**
   * Blueprint mode on or off (without `an`: switched); the drag under way is judged again, its message says what now.
   * Planning is placing: another tool gives way to placing.
   */
  schalteBlaupause(an: boolean = !this.blaupauseS.peek()): void {
    if (this.werkzeugS.peek() !== 'setzen') this.waehleWerkzeug('setzen', null, false);
    if (an === this.blaupauseS.peek()) return;
    this.blaupauseS.value = an;
    this.ghost.blueprint = an;
    this.melde(an ? 'ui.bau.meldung.blaupauseAn' : 'ui.bau.meldung.blaupauseAus');
  }

  /**
   * Chooses tool `tool` (1–4, the tool bar): a drag or a waiting confirmation is dropped. Repairing needs a hammer in
   * the hand: one from the hotbar is taken into it (`bags`: the player's bags; the message says which, or that none is
   * there). `melden`: say which tool is on.
   */
  waehleWerkzeug(tool: BuildTool, bags: BagsState | null, melden = true): void {
    const before = this.werkzeugS.peek();
    this.abbrechen();
    this.bestaetigungS.value = null;
    this.werkzeugS.value = tool;
    this.ghost.tool = tool;
    this.ghost.toolLabel = null;
    if (tool === 'reparieren' && this.hammerNehmen(bags)) return;
    if (melden && tool !== before) this.melde('ui.bau.meldung.werkzeug', { werkzeug: tool });
  }

  /** The next tool in tool order (the pad's LB). */
  naechstesWerkzeug(bags: BagsState | null): void {
    const i = BUILD_TOOLS.indexOf(this.werkzeugS.peek());
    this.waehleWerkzeug(BUILD_TOOLS[(i + 1) % BUILD_TOOLS.length] as BuildTool, bags);
  }

  /**
   * Repairing: a hammer from the hotbar into the hand when the hand holds none (`player.selectHotbar`); the message
   * names it, or says that none lies in the hotbar. True when it said something.
   */
  private hammerNehmen(bags: BagsState | null): boolean {
    if (bags === null) return false;
    const leiste = bags.schnellleiste;
    if (istHammer(leiste[bags.auswahl]?.item)) return false;
    const i = leiste.findIndex((st) => istHammer(st?.item));
    if (i < 0) {
      this.melde('ui.bau.meldung.hammerFehlt', undefined, true);
      return true;
    }
    this.befehle.selectHotbar(i);
    this.melde('ui.bau.meldung.hammerGenommen', { teil: (leiste[i] as { readonly item: string }).item });
    return true;
  }

  /** Opens or closes the selection by keys (the input context follows). */
  setzeKatalog(offen: boolean, input: Pick<BauEingabe, 'setContext'> | null): void {
    if (this.katalogS.peek() === offen) return;
    this.katalogS.value = offen;
    input?.setContext(offen ? 'ui' : 'build');
    if (offen) this.abbrechen();
  }

  /** Turns the chosen piece a quarter clockwise (pieces with directions only). */
  drehe(): boolean {
    const e = this.gewaehlt();
    if (e === undefined || !e.drehbar) {
      this.melde('ui.bau.meldung.nichtDrehbar', undefined, true);
      return false;
    }
    this.setzeDrehung((this.ghost.rot + 1) % TURNS);
    return true;
  }

  /** Mirrors the chosen piece (mirrorable sprites only). */
  spiegle(): boolean {
    const e = this.gewaehlt();
    if (e === undefined || !e.spiegelbar) {
      this.melde('ui.bau.meldung.nichtSpiegelbar', undefined, true);
      return false;
    }
    this.setzeSpiegel(!this.ghost.mirror);
    return true;
  }

  /** Pipette (§16.6 "Pipette (Mittelklick)"): the piece under the cursor, standing as it stands. */
  pipette(): boolean {
    const h = this.ghost.hovered;
    const e = this.eintrag(h.piece);
    if (e === undefined) {
      this.melde('ui.bau.meldung.pipetteLeer', undefined, true);
      return false;
    }
    this.sucheS.value = '';
    this.waehle(e.id);
    this.setzeDrehung(e.drehbar ? h.rot : 0);
    this.setzeSpiegel(e.spiegelbar ? h.mirror : false);
    this.melde('ui.bau.meldung.pipette', { teil: e.id });
    return true;
  }

  /**
   * Shows a drag under way from tile (tx, ty) to the cursor without a button held – the screenshot scenarios' pictures of
   * a drag: it neither places nor acts until the primary button is pressed (or the drag is cancelled).
   */
  zeigeZug(tx: number, ty: number): void {
    this.ghost.dragTx = tx;
    this.ghost.dragTy = ty;
    this.zugOhneTaste = true;
  }

  /** Drops a drag without placing (and a dismantling that waited for its confirmation). */
  abbrechen(): void {
    this.zugOhneTaste = false;
    this.ghost.dragTx = Number.NaN;
    this.ghost.dragTy = Number.NaN;
    this.ghost.lockTx = Number.NaN;
    this.ghost.lockTy = Number.NaN;
    if (this.bestaetigungS.peek() !== null) this.bestaetigungS.value = null;
  }

  /** Takes back the newest step placed within `UNDO_SECONDS` (§16.6 "innerhalb von 10 s"). */
  rueckgaengig(tick: number): boolean {
    const cmds = this.verlauf.rueckgaengig(tick);
    if (cmds === null) {
      this.melde('ui.bau.meldung.nichtsRueckgaengig', { sekunden: UNDO_SECONDS }, true);
      return false;
    }
    for (const c of cmds) {
      if (c.type === 'build.remove') this.befehle.remove(c.tx, c.ty, c.ebene);
      else this.befehle.removeStation(c.station);
    }
    // Blueprints give nothing back: their message says they are gone.
    const plaene = cmds.every((c) => c.type === 'build.remove' && c.plan === true);
    this.melde(plaene ? 'ui.bau.meldung.rueckgaengigPlan' : 'ui.bau.meldung.rueckgaengig', { count: cmds.length });
    return true;
  }

  /**
   * The placing input of one frame (context `build`, no selection open). `tick` is the simulation's tick (the undo
   * window), `bags` the player's bags (stations are set up from a bag slot).
   */
  frame(input: BauEingabe, tick: number, bags: BagsState | null): void {
    const g = this.ghost;
    g.pad = input.lastDevice === 'gamepad';
    if (g.pad) this.padCursor(input);
    for (const [action, tool] of TOOL_ACTIONS) if (input.wasPressed(action)) this.waehleWerkzeug(tool, bags);
    if (input.wasPressed('toolNext')) this.naechstesWerkzeug(bags);
    if (input.wasPressed('undo')) this.rueckgaengig(tick);
    if (input.wasPressed('blueprint')) this.schalteBlaupause();
    const tool = this.werkzeugS.peek();
    if (tool !== 'setzen') {
      this.werkzeugFrame(input, tool);
      return;
    }
    if (input.wasPressed('rotate')) this.drehe();
    if (input.wasPressed('block')) {
      if (g.dragging) this.abbrechen();
      else this.drehe();
    }
    if (input.wasPressed('mirror')) this.spiegle();
    if (input.wasPressed('pipette')) this.pipette();
    const e = this.gewaehlt();
    if (input.wasPressed('attack')) {
      this.zugOhneTaste = false;
      if (e === undefined || !g.cursorValid) return;
      if (e.ziehen === 'einzeln') this.setze(e, bags);
      else {
        g.dragTx = g.cursorTx;
        g.dragTy = g.cursorTy;
      }
      return;
    }
    if (g.dragging && !input.isDown('attack') && !this.zugOhneTaste) {
      if (e !== undefined) this.setze(e, bags);
      this.abbrechen();
    }
  }

  /**
   * The input of a frame with the dismantle, upgrade or repair tool: the primary button starts a drag (a click is a
   * drag of one tile) and acts on release, or confirms a waiting dismantling; the secondary button cancels either;
   * the pipette chooses the piece to upgrade to.
   */
  private werkzeugFrame(input: BauEingabe, tool: Exclude<BuildTool, 'setzen'>): void {
    const g = this.ghost;
    if (input.wasPressed('block')) {
      this.abbrechen();
      return;
    }
    if (input.wasPressed('pipette') && tool === 'aufwerten') this.pipette();
    const warten = this.bestaetigungS.peek();
    if (input.wasPressed('attack')) {
      this.zugOhneTaste = false;
      if (warten !== null) {
        this.bestaetigungS.value = null;
        this.sendeAbbau(warten.befehle);
        this.abbrechen();
        return;
      }
      if (!g.cursorValid) return;
      g.dragTx = g.cursorTx;
      g.dragTy = g.cursorTy;
      return;
    }
    if (warten === null && g.dragging && !input.isDown('attack') && !this.zugOhneTaste) {
      // The ghost judged this drag in the last frame (its tool, up to the cursor): act on what it found.
      if (g.judgedTool === tool) {
        if (tool === 'abbauen') this.baueAb();
        else if (tool === 'aufwerten') this.werteAuf();
        else this.repariere();
      }
      if (this.bestaetigungS.peek() === null) this.abbrechen();
      else {
        // The area stays marked while the confirmation waits.
        g.lockTx = g.cursorTx;
        g.lockTy = g.cursorTy;
      }
    }
  }

  /** Dismantles what the ghost found (more than `BESTAETIGEN_AB` wait for a confirming click). */
  private baueAb(): void {
    const g = this.ghost;
    const befehle: Abbau[] = [];
    for (let i = 0; i < g.targetCount; i++) {
      const t = g.targets[i] as ToolTarget;
      if (t.reason === null) befehle.push(abbauVon(t));
    }
    if (befehle.length === 0) {
      // Nothing that can come down: the simulation names the reason of the first target (a station too far …).
      const first = g.targets[0];
      if (g.targetCount > 0 && first !== undefined) this.sendeAbbau([abbauVon(first)]);
      else this.melde('ui.bau.meldung.nichtsAbzubauen', undefined, true);
      return;
    }
    if (befehle.length > BESTAETIGEN_AB) {
      this.bestaetigungS.value = { befehle };
      return;
    }
    this.sendeAbbau(befehle);
  }

  private sendeAbbau(befehle: readonly Abbau[]): void {
    for (const b of befehle) {
      if (b.art === 'bauteil') this.befehle.remove(b.tx, b.ty, b.ebene);
      else if (b.art === 'station') this.befehle.removeStation(b.id);
      else this.befehle.takeLight(b.id);
    }
  }

  /** Upgrades what the ghost found to the chosen piece (nothing: the first target anyway, for the reason). */
  private werteAuf(): void {
    const g = this.ghost;
    const e = this.gewaehlt();
    if (e === undefined || e.source !== 'bauteil') {
      this.melde('ui.bau.meldung.aufwertenWaehlen', undefined, true);
      return;
    }
    let gesendet = 0;
    for (let i = 0; i < g.targetCount; i++) {
      const t = g.targets[i] as ToolTarget;
      if (t.reason !== null || t.to === null) continue;
      this.befehle.upgrade(t.tx, t.ty, t.to);
      gesendet++;
    }
    if (gesendet > 0) return;
    const first = g.targets[0];
    if (g.targetCount > 0 && first !== undefined) this.befehle.upgrade(first.tx, first.ty, e.id);
    else this.melde('ui.bau.meldung.nichtsAufzuwerten', { teil: e.id }, true);
  }

  /** Repairs the rectangle (the simulation mends and pays, or names why not). */
  private repariere(): void {
    const q = this.ghost.repair;
    this.befehle.repair(q.x0, q.y0, q.x1, q.y1);
  }

  /**
   * Places (in blueprint mode: plans) what the ghost found placeable, as one undo step; nothing placeable: the first
   * anchor, for the reason.
   */
  private setze(e: BauEintrag, bags: BagsState | null): void {
    const g = this.ghost;
    const plan = g.plan;
    const n = Math.min(plan.length / 2, g.verdicts.length);
    if (n === 0) return;
    this.verlauf.beginne();
    let gesendet = 0;
    for (let i = 0; i < n; i++) {
      if (g.verdicts[i] !== null) continue;
      if (this.sende(e, plan[2 * i] as number, plan[2 * i + 1] as number, bags)) gesendet++;
    }
    if (gesendet > 0) return;
    // Nothing placeable: the simulation names the reason of the first anchor (a station without its item: the ghost's).
    if (!this.sende(e, plan[0] as number, plan[1] as number, bags)) this.melde(`ui.bau.grund.${g.verdicts[0] ?? 'noMaterial'}`, undefined, true);
  }

  private sende(e: BauEintrag, tx: number, ty: number, bags: BagsState | null): boolean {
    const g = this.ghost;
    const plan = g.blueprint;
    if (e.source === 'station') {
      // A station has no plan: blueprint mode sends nothing (the ghost names why). F sets it up mirrored.
      const from = plan ? null : platzMit(bags, e.id);
      if (from === null) return false;
      if (e.spiegelbar && g.mirror) this.befehle.placeStation(from, tx, ty, true);
      else this.befehle.placeStation(from, tx, ty);
    } else if (plan) this.befehle.blueprint(e.id, tx, ty, e.drehbar ? g.rot : undefined, e.spiegelbar && g.mirror ? true : undefined);
    else this.befehle.place(e.id, tx, ty, e.drehbar ? g.rot : undefined, e.spiegelbar && g.mirror ? true : undefined);
    this.verlauf.erwarte(e.id, tx, ty, plan && e.source === 'bauteil');
    return true;
  }

  /** Moves the gamepad cursor with the right stick (a press moves one tile, holding repeats). */
  private padCursor(input: BauEingabe): void {
    const t = this.now();
    let held = -1;
    for (let i = 0; i < AIM.length; i++) {
      const [action, dx, dy] = AIM[i] as readonly [Action, number, number];
      if (input.wasPressed(action)) {
        this.stepCursor(dx, dy);
        this.repeatDir = i;
        this.repeatAt = t + REPEAT_DELAY_MS;
        return;
      }
      if (held < 0 && input.isDown(action)) held = i;
    }
    if (held < 0 || held !== this.repeatDir) {
      this.repeatDir = held;
      this.repeatAt = t + REPEAT_DELAY_MS;
      return;
    }
    if (t >= this.repeatAt) {
      const [, dx, dy] = AIM[held] as readonly [Action, number, number];
      this.stepCursor(dx, dy);
      this.repeatAt = t + REPEAT_INTERVAL_MS;
    }
  }

  private stepCursor(dx: number, dy: number): void {
    const g = this.ghost;
    g.padDx = Math.max(-CURSOR_REACH, Math.min(CURSOR_REACH, g.padDx + dx));
    g.padDy = Math.max(-CURSOR_REACH, Math.min(CURSOR_REACH, g.padDy + dy));
  }

  private setzeDrehung(rot: number): void {
    this.ghost.rot = rot;
    this.drehungS.value = rot;
  }

  private setzeSpiegel(on: boolean): void {
    this.ghost.mirror = on;
    this.spiegelS.value = on;
  }

  /** Shows a short message. */
  melde(key: string, params?: Readonly<Record<string, string | number>>, warnung = false): void {
    this.meldungS.value = { key, ...(params === undefined ? {} : { params }), bis: this.now() + MELDUNG_MS, warnung };
  }

  /** Drops the message once its time ran out (the screen asks once per frame; the status line returns). */
  verwerfeMeldung(): void {
    const m = this.meldungS.peek();
    if (m !== null && this.now() >= m.bis) this.meldungS.value = null;
  }
}

/** The dismantle command of target `t`. */
function abbauVon(t: ToolTarget): Abbau {
  return t.art === 'bauteil' ? { art: 'bauteil', tx: t.tx, ty: t.ty, ebene: t.ebene } : { art: t.art, id: t.id };
}

/** Whether `item` is a hammer (the tool that finishes blueprints and mends, `BALANCE.building.blueprintTool`). */
function istHammer(item: string | undefined): boolean {
  return item !== undefined && CONTENT.collection('items').find(item)?.werkzeug?.art === BALANCE.building.blueprintTool;
}
