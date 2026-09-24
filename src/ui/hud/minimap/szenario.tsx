/**
 * Screenshot-Szenarien der HUD-Weltanzeigen (M3-28 `hud-minimap`, M3-29 `hud-meldungen`; MASTERPROMPT
 * §31.5): Über der Spielansicht (die Szenarien in `src/debug/scenarios.ts` stellen Kamera, Uhrzeit und
 * Wetter der Sitzung) liegen Minimap, Kompassbalken und Meldungen – in einer eigenen Ebene, weil der
 * Screenshot-Modus das Overlay der Seite ausblendet (wie die Kit-Galerien).
 *
 * Die Szenarien bekommen von der Seite nur Commands und Einzelschritte der Sitzung, keinen Lesezugriff.
 * Die Anzeigen lesen deshalb eine zweite, ruhende Sitzung derselben Welt (gleicher Seed und dieselbe
 * Weltinstanz aus dem Welt-Cache, `src/game/worldCache.ts` – nichts wird neu erzeugt), in die dieselben
 * Commands gehen: Spieler an der Kamerakachel, ein Schritt nach Norden (Blickrichtung), Uhrzeit, Wetter.
 * Ein Grab-Marker steht als Beispiel für die Gräber des Todessystems (M3-26) nordöstlich; die Meldungen
 * kommen im Szenario `hud-meldungen` als feste Folge auf einer festen Uhr (deterministisch).
 *
 * Für E2E-Tests hängt am Wirt (`[data-hud-szenario]`) `dhSzenario`: Uhr stellen, Meldungen einspeisen.
 */
import { render } from 'preact';
import { contentItemCatalog } from '../../../game/items/catalog';
import { BOOT_SESSION_SEED, GameSession } from '../../../game/session';
import { createI18n, FALLBACK_LANG, isLang, type I18n } from '../../../i18n';
import { CONTENT } from '../../../content/index';
import { uiPx } from '../../kit/geometry';
import '../../kit/index';
import { aufsammeln, dunkelheitNaht, entdeckung, stufenWarnung, type MeldungInhalt } from '../meldungen/inhalte';
import type { MeldungEingabe } from '../meldungen/warteschlange';
import type { KartenMarker } from './lage';
import { spriteBilder } from './spriteBild';
import { hudSchrift } from './schrift';
import type { FrameTakt } from './takt';
import { HudWeltanzeigen, hudWeltdienste } from './Weltanzeigen';

export type HudSzenarioArt = 'minimap' | 'meldungen';

/** Command-Zugang der Szenarien zur Sitzung der Seite. */
export interface HudSzenarioSitzung {
  command(raw: unknown): unknown;
  step(): void;
}

export interface HudSzenarioOptionen {
  readonly art: HudSzenarioArt;
  /** Seed der Sitzung der Seite (die zweite Sitzung liest dieselbe Welt); Standard: wie `src/main.tsx`. */
  readonly seed?: number;
  /** Kamerakachel der Spielansicht, `null` solange die Welt lädt. */
  readonly kachel: () => { readonly layer: number; readonly tx: number; readonly ty: number } | null;
  /** Sitzung der Seite: bekommt dieselben Commands (Uhrzeit, Wetter). */
  readonly seite?: HudSzenarioSitzung;
}

export interface HudSzenario {
  /** Welt da, Symbole dekodiert, Schrift gebacken, Bild gezeichnet. */
  readonly bereit: boolean;
  dispose(): void;
}

/** Steuerung für E2E-Tests (am Wirt als `dhSzenario`). */
export interface HudSzenarioSteuerung {
  /** Stellt die Meldungsuhr [s]. */
  uhr(sekunden: number): void;
  /** Speist eine Aufsammel-Meldung ein. */
  aufsammeln(item: string, anzahl: number): void;
  /** Speist eine Stufen-Warnung ein (`hungrig`, `frierend` …). */
  warnung(stufe: Parameters<typeof stufenWarnung>[0]): void;
  /** Sichtbare und wartende Meldungen. */
  zaehle(): { sichtbar: number; wartend: number };
}

/** Uhrzeit und Wetter der Szenarien: später Nachmittag im Frühling, die Sonne steht tief im Westen. */
const STUNDE = 17;
const MINUTE = 20;
/** Grab relativ zur Figur [Kacheln]: nordöstlich, auf Karte und Kompass sichtbar. */
const GRAB_VERSATZ = [12, -9] as const;
/** Bilder, die nach „alles geladen“ noch gezeichnet werden, bevor das Szenario als stabil gilt. */
const MAL_FRAMES = 4;
/** Uhrzeit der festen Meldungsfolge [s] (Aufsammel-Stapel, Entdeckung, Warnung – je ein Beispiel). */
const MELDUNGEN_ZEIT = 10;
const MITTE = 0.5;

class RafTakt implements FrameTakt {
  private readonly hoerer = new Set<() => void>();
  private laeuft = true;

  constructor(private readonly win: Window) {
    const tick = (): void => {
      if (!this.laeuft) return;
      for (const h of this.hoerer) h();
      this.win.requestAnimationFrame(tick);
    };
    this.win.requestAnimationFrame(tick);
  }

  onFrame(listener: () => void): () => void {
    this.hoerer.add(listener);
    return () => {
      this.hoerer.delete(listener);
    };
  }

  stop(): void {
    this.laeuft = false;
  }
}

/** Seed der Sitzung der Seite: `?seed=` im Debug-Modus, sonst der Start-Seed (wie `src/main.tsx`). */
function seitenSeed(win: Window): number {
  const n = Number(new URLSearchParams(win.location.search).get('seed') ?? Number.NaN);
  return Number.isSafeInteger(n) ? n : BOOT_SESSION_SEED;
}

function seitenI18n(doc: Document): I18n {
  const lang = doc.documentElement.lang;
  const i18n = createI18n(isLang(lang) ? lang : FALLBACK_LANG);
  i18n.onMissing((key, l) => console.error(`i18n: Schlüssel „${key}“ fehlt (${l})`));
  return i18n;
}

function naechsterFrame(win: Window): Promise<void> {
  return new Promise((resolve) => win.requestAnimationFrame(() => resolve()));
}

/**
 * Die feste Meldungsfolge von `hud-meldungen`: Entdeckung, „Dunkelheit naht“, Funde mit Stapel „Feuerstein
 * ×3“ und seltenem Leuchtpilz; Holz und die Kälte-Warnung warten (höchstens vier sichtbar), die Kälte vor
 * dem Holz.
 */
function meldungsFolge(): MeldungEingabe<MeldungInhalt>[] {
  const katalog = contentItemCatalog();
  const item = (id: string, n: number): MeldungEingabe<MeldungInhalt> => {
    const def = katalog.get(id);
    return aufsammeln(id, n, def.name, def.raritaet);
  };
  const salzkueste = CONTENT.collection('biomes').get('salzkueste');
  return [
    ...(salzkueste === undefined ? [] : [entdeckung('biom_salzkueste', salzkueste.name)]),
    dunkelheitNaht(false),
    item('feuerstein', 1),
    item('leuchtpilz', 2),
    item('feuerstein', 2),
    item('holz', 4),
    stufenWarnung('frierend'),
  ];
}

/** Legt die Weltanzeigen über die Seite und bereitet sie vor. */
export function mountHudSzenario(doc: Document, o: HudSzenarioOptionen): HudSzenario {
  const win = doc.defaultView;
  if (win === null) throw new Error('HUD-Szenario: Dokument ohne Fenster');
  const wirt = doc.body.appendChild(doc.createElement('div'));
  wirt.className = 'dh-hud-szenario';
  wirt.dataset['hudSzenario'] = o.art;
  Object.assign(wirt.style, { position: 'fixed', inset: '0', zIndex: '10', overflow: 'hidden', pointerEvents: 'none' });
  const takt = new RafTakt(win);
  const i18n = seitenI18n(doc);
  const zustand = { bereit: false, uhr: MELDUNGEN_ZEIT };
  let beendet = false;

  const bereite = async (): Promise<void> => {
    let kachel = o.kachel();
    while (kachel === null) {
      await naechsterFrame(win);
      if (beendet) return;
      kachel = o.kachel();
    }
    // Zweite Sitzung derselben Welt; beide bekommen dieselben Commands und Schritte: Spieler an der
    // Kamerakachel, ein Tick nach Norden (Blick nach Norden), dann Uhrzeit und Wetter.
    const sitzung = new GameSession({ config: { seed: o.seed ?? seitenSeed(win) } });
    const schritt = (...cmds: unknown[]): void => {
      for (const cmd of cmds) {
        sitzung.command(cmd);
        o.seite?.command(cmd);
      }
      sitzung.step();
      o.seite?.step();
    };
    schritt({ type: 'player.spawn', tx: kachel.tx, ty: kachel.ty });
    schritt({ type: 'player.move', dx: 0, dy: -1 });
    schritt({ type: 'player.move', dx: 0, dy: 0 }, { type: 'setTime', hour: STUNDE, minute: MINUTE }, { type: 'setWeather', state: 'klar' });
    const grab: KartenMarker = { art: 'grab', x: kachel.tx + GRAB_VERSATZ[0] + MITTE, y: kachel.ty + GRAB_VERSATZ[1] + MITTE, ebene: 0 };
    const dienste = hudWeltdienste(sitzung, { graeber: () => [grab], uhr: () => zustand.uhr });
    const steuerung: HudSzenarioSteuerung = {
      uhr: (s) => {
        zustand.uhr = s;
      },
      aufsammeln: (item, n) => {
        const def = contentItemCatalog().get(item);
        dienste.warteschlange.melde(aufsammeln(item, n, def.name, def.raritaet), zustand.uhr);
      },
      warnung: (stufe) => dienste.warteschlange.melde(stufenWarnung(stufe), zustand.uhr),
      zaehle: () => ({ sichtbar: dienste.warteschlange.sichtbar.length, wartend: dienste.warteschlange.wartend }),
    };
    Object.defineProperty(wirt, 'dhSzenario', { value: steuerung, configurable: true });
    if (o.art === 'meldungen') for (const m of meldungsFolge()) dienste.warteschlange.melde(m, zustand.uhr);
    const bilder = spriteBilder(doc);
    render(
      <div class="dh-kit-skala" style={{ position: 'absolute', inset: 0, padding: uiPx(0) }}>
        <HudWeltanzeigen i18n={i18n} lang={i18n.lang} takt={takt} dienste={dienste} kompass bilder={bilder} />
      </div>,
      wirt,
    );
    await Promise.all([hudSchrift(doc), new Promise<void>((resolve) => {
      const warte = (): void => (bilder.bereit.value || bilder.fehler.value !== null ? resolve() : void win.requestAnimationFrame(warte));
      warte();
    })]);
    // Meldungen: eine Sekunde später steht die Folge ohne Einblenden, zwei warten noch.
    if (o.art === 'meldungen') zustand.uhr = MELDUNGEN_ZEIT + 1;
    for (let i = 0; i < MAL_FRAMES; i++) await naechsterFrame(win);
    zustand.bereit = true;
    wirt.dataset['bereit'] = '1';
  };
  bereite().catch((err: unknown) => console.error(`HUD-Szenario ${o.art}: ${err instanceof Error ? err.message : String(err)}`));

  return {
    get bereit() {
      return zustand.bereit;
    },
    dispose() {
      beendet = true;
      takt.stop();
      render(null, wirt);
      wirt.remove();
    },
  };
}
