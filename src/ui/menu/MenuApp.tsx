/**
 * The main menu's screens (MASTERPROMPT §26; docs/SPIEL.md §25 "Boot-Ablauf"; M7-50, M7-51, M7-55, M7-56): one focus
 * manager and one screen stack (`MenuController`) over the menu scene. The main menu lies at the bottom; the world
 * selection, the new-world flow and the settings open above it. The frame hook of the menu session's bridge polls the
 * menu input once per rendered frame.
 *
 * The new-world flow (src/ui/menu/ablauf.ts) keeps its form while the player goes back and forth; after its last step
 * the menu starts the world (`HauptmenueHooks.starten` with a `new` request). "Weiter" and "Laden" start a stored world
 * (a `load` request). Screens of later steps (the character creation, M7-52) add a case to `MenuScreen`.
 *
 * Sounds (§2.7): opening and closing a screen, the focus frame moving (keys, controller) and pressing a navigable
 * element play their UI sounds (`SCREEN_SFX`).
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { I18n } from '../../i18n';
import type { UiBridge } from '../bridge';
import { SCREEN_SFX } from '../focus/GameScreens';
import { FOCUS_ATTR, FocusManager } from '../focus/manager';
import { EinstellungenBildschirm } from '../screens/einstellungen/Einstellungen';
import { Hauptmenue } from '../screens/hauptmenue/Hauptmenue';
import { entwurfAus, neueWeltStandard, seedAus, type NeueWeltForm } from '../screens/neue-welt/modell';
import { NeueWelt } from '../screens/neue-welt/NeueWelt';
import { Weltauswahl } from '../screens/weltauswahl/Weltauswahl';
import { entwurfBefehle, naechsterSchritt, NEUE_WELT_ABLAUF, type WeltEntwurf } from './ablauf';
import { MAIN_MENU, MenuController } from './controller';
import type { HauptmenueHooks, WeltEintrag } from './hooks';
import { newWorldId, type StartRequest } from './start';

/** The menu's screen ids. */
export const MENU_SCREENS = { welten: 'weltauswahl', neueWelt: 'neue-welt', einstellungen: 'einstellungen' } as const;

/** The menu of the page while it is mounted (debug scenarios open its screens), or null. */
export interface MenuHandle {
  readonly controller: MenuController;
  readonly focus: FocusManager;
  /** Reads the stored worlds again (the main menu's "Weiter"). */
  aktualisieren(): void;
}
let active: MenuHandle | null = null;

/** The mounted menu, or null. */
export function activeMenu(): MenuHandle | null {
  return active;
}

export interface MenuAppProps {
  readonly i18n: I18n;
  readonly bridge: Pick<UiBridge, 'input' | 'onFrame'>;
  readonly hooks: HauptmenueHooks;
}

/** The start request of a finished draft (its commands in the flow's order). */
export function startAuftrag(entwurf: WeltEntwurf): StartRequest {
  return { kind: 'new', worldId: entwurf.worldId, name: entwurf.name, config: entwurf.config, commands: entwurfBefehle(entwurf) };
}

export function MenuApp({ i18n, bridge, hooks }: MenuAppProps) {
  const t = i18n.t;
  const focus = useMemo(() => new FocusManager(), []);
  const controller = useMemo(() => new MenuController({ focus, input: bridge.input }), [focus, bridge]);
  const [zuletzt, setZuletzt] = useState<WeltEintrag | null>(null);
  const [form, setForm] = useState<NeueWeltForm>(() => neueWeltStandard(hooks.zufallsSeed(), t('ui.newWorld.standardName')));
  const [geprueft, setGeprueft] = useState(false);
  // Bumped to read the stored worlds again.
  const [listenStand, setListenStand] = useState(0);
  // The draft the later steps of the flow add to (the character creation reads and extends it, M7-52).
  const [, setEntwurf] = useState<WeltEntwurf | null>(null);
  const stack = controller.stack.value;
  const top = stack[stack.length - 1] ?? MAIN_MENU;

  useEffect(() => bridge.onFrame(() => controller.poll()), [bridge, controller]);
  useEffect(() => {
    const handle: MenuHandle = { controller, focus, aktualisieren: () => setListenStand((n) => n + 1) };
    active = handle;
    return () => {
      if (active === handle) active = null;
    };
  }, [controller, focus]);
  // The world "Weiter" continues: read whenever the main menu is on top again (a world may have been deleted or imported).
  useEffect(() => {
    if (top !== MAIN_MENU) return;
    let alive = true;
    hooks.welten.liste().then(
      (liste) => {
        if (alive) setZuletzt(liste[0] ?? null);
      },
      () => {
        if (alive) setZuletzt(null);
      },
    );
    return () => {
      alive = false;
    };
  }, [hooks, top, listenStand]);
  useEffect(() => {
    const klang = hooks.klang;
    if (klang === undefined) return;
    let depth = controller.stack.peek().length;
    const stopStack = controller.stack.subscribe((s) => {
      if (s.length > depth) klang.play({ id: SCREEN_SFX.open });
      else if (s.length < depth) klang.play({ id: SCREEN_SFX.close });
      depth = s.length;
    });
    let last = focus.focused.peek();
    const stopFocus = focus.focused.subscribe((el) => {
      if (el !== null && el !== last && focus.keys.peek()) klang.play({ id: SCREEN_SFX.focus });
      last = el;
    });
    const onPress = (ev: Event): void => {
      const target = ev.target;
      if (target instanceof Element && target.closest(`[${FOCUS_ATTR}]`) !== null) klang.play({ id: SCREEN_SFX.press });
    };
    document.addEventListener('click', onPress, true);
    return () => {
      stopStack();
      stopFocus();
      document.removeEventListener('click', onPress, true);
    };
  }, [controller, focus, hooks]);

  const laden = (welt: WeltEintrag): void => hooks.starten({ kind: 'load', worldId: welt.id });
  const neueWelt = (): void => {
    setGeprueft(false);
    controller.open(NEUE_WELT_ABLAUF[0]?.screen ?? MENU_SCREENS.neueWelt);
  };
  /** The form passed: the next step of the flow, or the start of the world after the last. */
  const weltWeiter = (f: NeueWeltForm): void => {
    const seed = seedAus(f);
    if (seed === null) return;
    const entwurf = entwurfAus(f, newWorldId(hooks.jetzt(), seed));
    setEntwurf(entwurf);
    const next = naechsterSchritt('welt');
    if (next !== null) controller.replace(next.screen);
    else hooks.starten(startAuftrag(entwurf));
  };

  return (
    <>
      <Hauptmenue
        i18n={i18n}
        focus={focus}
        input={bridge.input}
        zuletzt={zuletzt}
        version={hooks.version}
        meldung={hooks.meldung ?? null}
        onWeiter={laden}
        onNeueWelt={neueWelt}
        onWelten={() => controller.open(MENU_SCREENS.welten)}
        onEinstellungen={() => controller.open(MENU_SCREENS.einstellungen)}
      />
      {stack.slice(1).map((id) =>
        id === MENU_SCREENS.welten ? (
          <Weltauswahl
            key={id}
            i18n={i18n}
            focus={focus}
            input={bridge.input}
            welten={hooks.welten}
            kopieren={hooks.kopieren}
            onLaden={laden}
            onNeueWelt={() => {
              controller.back();
              neueWelt();
            }}
            onZurueck={() => controller.back()}
          />
        ) : id === MENU_SCREENS.neueWelt ? (
          <NeueWelt
            key={id}
            i18n={i18n}
            focus={focus}
            input={bridge.input}
            form={form}
            setForm={setForm}
            geprueft={geprueft}
            zufallsSeed={hooks.zufallsSeed}
            onWeiter={weltWeiter}
            onFehler={() => setGeprueft(true)}
            onZurueck={() => controller.back()}
          />
        ) : id === MENU_SCREENS.einstellungen ? (
          <EinstellungenBildschirm key={id} i18n={i18n} focus={focus} input={bridge.input} settings={hooks.settings} onZurueck={() => controller.back()} />
        ) : null,
      )}
    </>
  );
}
