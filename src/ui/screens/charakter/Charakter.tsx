/**
 * Character creation (MASTERPROMPT §26 "Charaktererstellung (Name, Körperform, Haut-/Haarpaletten, Kleidungsfarben)";
 * docs/SPIEL.md §25 "Boot-Ablauf: Neue Welt → Charaktererstellung → Ladebildschirm", §26 "Aussehen"; M7-52): the second step
 * of the new-world flow (src/ui/menu/ablauf.ts). On a wooden board: the name as a pixel text field, the live preview –
 * the figure in its four facings, walking or standing (the key "Gehen/Stehen"), composed from the game atlas exactly as the
 * game view draws it (`vorschauBild`) – and the rows body shape, skin, hairstyle, hair colour, top and trousers, stepped
 * with left/right. "Welt betreten" checks the name and hands the command `appearance.set` to the flow (the world's first
 * command); "Zurück" goes back to the world's form with this form kept.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { PALETTE_ROWS, SPRITES } from '../../../generated/atlas';
import type { I18n } from '../../../i18n';
import type { GameCommand } from '../../../game/commands';
import type { UiInput } from '../../bridge';
import { ScreenLayer } from '../../focus/Layer';
import type { FocusElement, FocusManager } from '../../focus/manager';
import { actionPrompt } from '../../focus/prompts';
import { focusable, useFocusScope } from '../../focus/useFocusScope';
import { PALETTE_RGBA32 } from '../../hud/minimap/palette';
import { spriteBilder, type SymbolQuelle } from '../../hud/minimap/spriteBild';
import { Button, Frame } from '../../kit';
import { ZeilenListe, zeileVon, type MenuZeile } from '../../menu/Zeilen';
import { aussehenBefehl, CHARAKTER_FELDER, gewaehlt, NAME_MAX, namensFehler, schritt, type CharakterFeld, type CharakterForm } from './modell';
import { vorschauBild, type VorschauSprite, type VorschauZeile } from './vorschau';
import './charakter.css';

/** The facings of the preview, left to right. */
export const VORSCHAU_RICHTUNGEN = ['down', 'right', 'up', 'left'] as const;
/** Frame time of the preview [ms]: the clips' 8 frames per second. */
const BILD_MS = 125;
/** Fewest rows the list shows (with less room the layer draws smaller). */
const MIN_ZEILEN = 3;

export interface CharakterProps {
  readonly i18n: I18n;
  readonly focus: FocusManager;
  readonly input: UiInput | null;
  readonly form: CharakterForm;
  readonly setForm: (form: CharakterForm) => void;
  /** Whether "Welt betreten" was pressed once (errors show from then on). */
  readonly geprueft: boolean;
  /** The form passed: the world's first command. */
  readonly onWeiter: (befehl: GameCommand) => void;
  /** Pressed with a wrong name (the screen shows it). */
  readonly onFehler: () => void;
  readonly onZurueck: () => void;
  /** The atlas as palette indices (tests, scenarios); default the document's (`spriteBilder`). */
  readonly quelle?: SymbolQuelle & { readonly bereit?: { readonly value: boolean } };
  /** A still picture at this clip position (screenshot scenarios); without it the preview runs. */
  readonly standbild?: { readonly gehen: boolean; readonly position: number };
}

/** One facing of the preview drawn into its canvas (palette indices → colours). */
function Figur({ quelle, form, aktion, richtung, position, stand, label }: { quelle: SymbolQuelle; form: CharakterForm; aktion: string; richtung: string; position: number; stand: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (c === null) return;
    const ctx = c.getContext('2d');
    if (ctx === null) return;
    const px = vorschauBild(quelle, SPRITES as unknown as Readonly<Record<string, VorschauSprite>>, PALETTE_ROWS as readonly VorschauZeile[], form, aktion, richtung, position);
    ctx.clearRect(0, 0, c.width, c.height);
    if (px === null) return;
    const img = ctx.createImageData(c.width, c.height);
    const ziel = new Uint32Array(img.data.buffer);
    for (let i = 0; i < px.length && i < ziel.length; i++) ziel[i] = PALETTE_RGBA32[px[i] ?? 0] ?? 0;
    ctx.putImageData(img, 0, 0);
  }, [quelle, form, aktion, richtung, position, stand]);
  return <canvas ref={ref} class="dh-charakter__figur" width={32} height={32} role="img" aria-label={label} data-testid={`charakter-vorschau-${richtung}`} />;
}

export function Charakter({ i18n, focus, input, form, setForm, geprueft, onWeiter, onFehler, onZurueck, quelle, standbild }: CharakterProps) {
  const t = i18n.t;
  const ref = useRef<HTMLDivElement>(null);
  const atlas = quelle ?? spriteBilder(document);
  const [gehen, setGehen] = useState(standbild?.gehen ?? true);
  const [takt, setTakt] = useState(standbild?.position ?? 0);
  // The atlas decodes once; its signal re-renders the preview when the pixels are there.
  const stand = (atlas as { readonly bereit?: { readonly value: boolean } }).bereit?.value === true ? 1 : 0;
  useEffect(() => {
    if (standbild !== undefined) return;
    const id = setInterval(() => setTakt((n) => n + 1), BILD_MS);
    return () => clearInterval(id);
  }, [standbild]);
  const step = (id: string, dir: 1 | -1): void => {
    const feld = CHARAKTER_FELDER.find((f) => f === id);
    if (feld !== undefined) setForm(schritt(form, feld, dir));
  };
  useFocusScope(focus, ref, {
    initial: () => focusable(ref, '[data-testid="charakter-los"]'),
    onAction(action, focused: FocusElement | null) {
      const id = zeileVon(focused);
      if (id === null || (action !== 'left' && action !== 'right')) return false;
      step(id, action === 'right' ? 1 : -1);
      return true;
    },
    onBack: onZurueck,
  });
  const fehler = namensFehler(form.name);
  const los = (): void => {
    const befehl = aussehenBefehl(form);
    if (befehl === null) onFehler();
    else onWeiter(befehl);
  };
  /** Keys inside the text field: the field keeps typing, these move the focus on (as in the new-world form). */
  const feldTaste = (e: KeyboardEvent): void => {
    const el = e.currentTarget;
    if (!(el instanceof HTMLElement)) return;
    const nav = e.key === 'Enter' || e.key === 'ArrowDown' ? 'down' : e.key === 'ArrowUp' ? 'up' : e.key === 'Escape' ? 'back' : null;
    if (nav === null) return;
    e.preventDefault();
    focus.keysUsed();
    focus.focus(el as unknown as FocusElement);
    focus.handle(nav);
    if (nav !== 'back') el.blur();
  };
  const wert = (feld: CharakterFeld): string => gewaehlt(form, feld)?.name[i18n.lang] ?? '-';
  const zeilen: MenuZeile[] = CHARAKTER_FELDER.map((feld) => ({ id: feld, name: t(`ui.charakter.${feld}`), wert: wert(feld), testId: `charakter-${feld}` }));
  const aktion = gehen ? 'walk' : 'idle';
  const hint = t('ui.pause.hinweis', { waehlen: actionPrompt(i18n, input, 'uiConfirm') ?? '-', zurueck: actionPrompt(i18n, input, 'uiBack') ?? '-' });
  return (
    <ScreenLayer focus={focus} label={t('ui.charakter.titel')} testId="ui-charakter">
      <div ref={ref}>
        <Frame art="holz" class="dh-charakter__tafel">
          <h2 class="dh-charakter__titel">{t('ui.charakter.titel')}</h2>
          <label class="dh-charakter__feld">
            <span class="dh-charakter__feldname">{t('ui.charakter.name')}</span>
            <input
              type="text"
              class={geprueft && fehler !== null ? 'dh-charakter__eingabe dh-charakter__eingabe--fehler' : 'dh-charakter__eingabe'}
              data-fokus=""
              data-testid="charakter-name"
              maxLength={NAME_MAX}
              value={form.name}
              spellcheck={false}
              autocomplete="off"
              onInput={(e) => setForm({ ...form, name: e.currentTarget.value })}
              onKeyDown={feldTaste}
            />
          </label>
          {geprueft && fehler !== null ? (
            <p class="dh-charakter__fehler" data-testid="charakter-fehler" role="alert">
              {t(fehler, { max: NAME_MAX })}
            </p>
          ) : null}
          <Frame art="pergament" class="dh-charakter__vorschau">
            <div class="dh-charakter__figuren" data-testid="charakter-vorschau" data-aktion={aktion}>
              {VORSCHAU_RICHTUNGEN.map((r) => (
                <Figur key={r} quelle={atlas} form={form} aktion={aktion} richtung={r} position={takt} stand={stand} label={t(`ui.charakter.richtung.${r}`)} />
              ))}
            </div>
          </Frame>
          <ZeilenListe
            zeilen={zeilen}
            schritt={step}
            bildschirm={ref}
            mindestens={MIN_ZEILEN}
            labelHoch={t('ui.kit.scroll.hoch')}
            labelRunter={t('ui.kit.scroll.runter')}
            ariaLabel={(z) => t('ui.pause.einstellungWert', { name: z.name, wert: z.wert })}
            testId="charakter-zeilen"
          />
          <div class="dh-charakter__leiste">
            <Button data-fokus="" data-testid="charakter-los" onClick={los}>
              {t('ui.charakter.los')}
            </Button>
            <Button data-fokus="" data-testid="charakter-gehen" onClick={() => setGehen(!gehen)}>
              {t(gehen ? 'ui.charakter.stehen' : 'ui.charakter.gehen')}
            </Button>
            <Button data-fokus="" data-testid="charakter-zurueck" onClick={onZurueck}>
              {t('common.back')}
            </Button>
          </div>
        </Frame>
      </div>
      <p class="dh-charakter__hinweis">{hint}</p>
    </ScreenLayer>
  );
}
