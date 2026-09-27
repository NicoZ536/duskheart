/**
 * The search tab of the chest screen (MASTERPROMPT §16.7 "Suche über alle Kisten der Basis", §26; M4-21): searches every
 * chest of the base from any chest – the zone of the hearth covering this chest, or without a hearth the chests within
 * `BALANCE.storage.searchRadiusTiles` of it (src/game/samples/kistensuche.ts).
 *
 * A search field (German or English name or id, umlauts and case forgiven – the hearth overview's rule `suchItems`), a
 * line naming the base and how many chests it holds, then the finds grouped per chest, nearest first – one row per
 * chest: its label icon, its name over where it stands ("diese Kiste", "8 Felder nordwestlich") and, to the right, the
 * stacks found (three to a row), highlighted, each with the item tooltip. The finds of the open chest are highlighted in its own slots too, and a click takes such a stack
 * into the bags like a click on the chest's slot; the other chests are only shown (walk there to open them).
 *
 * Keyboard: typing in the field searches; Enter, Tab and ↓ go to the first find, Esc empties the field and leaves it.
 */
import type { RefObject } from 'preact';
import { useRef } from 'preact/hooks';
import type { ItemCatalog } from '../../../game/items/catalog';
import type { I18n } from '../../../i18n';
import type { FocusElement, FocusManager } from '../../focus/manager';
import { Frame, ScrollArea, Slot } from '../../kit';
import { Zeichen } from '../handwerk/glyphen';
import { ItemBild } from '../handwerk/teile';
import { basisText, kistenName, ortText } from './modell';
import type { SucheAnsicht } from './sucheQuelle';

/** Height of the finds' scroll area [design px] and its scroll step (one group row). */
const FUNDE_HOEHE = 104;
const FUND_ZEILE = 22;

export interface SucheTafelProps {
  readonly i18n: I18n;
  readonly focus: FocusManager;
  /** The screen's root (where the focus goes when the field is left). */
  readonly root: RefObject<HTMLElement>;
  readonly ansicht: SucheAnsicht | null;
  readonly text: string;
  readonly setText: (text: string) => void;
  /** The items the query names, or `null` for an empty query. */
  readonly suchSet: ReadonlySet<string> | null;
  readonly catalog: ItemCatalog;
  /** Takes the stack in slot `index` of the open chest into the bags. */
  readonly nehmen: (index: number) => void;
}

export function SucheTafel({ i18n, focus, root, ansicht, text, setText, suchSet, catalog, nehmen }: SucheTafelProps) {
  const t = i18n.t;
  const lang = i18n.lang;
  const feld = useRef<HTMLInputElement>(null);
  const kisten = suchSet === null ? [] : (ansicht?.kisten ?? []);
  const verlassen = (): void => {
    feld.current?.blur();
    const ziel = root.current?.querySelector('.dh-ki__fund[data-fokus]') ?? root.current?.querySelector('[data-testid="kiste-reiter-suche"]');
    if (ziel instanceof HTMLElement) {
      focus.keysUsed();
      focus.focus(ziel as unknown as FocusElement);
    }
  };
  return (
    <Frame art="holz" class="dh-hw__tafel dh-ki__tafel--suche" data-testid="kiste-suche">
      <label class="dh-hw__suche">
        <Zeichen id="lupe" class="dh-hw__suche-symbol" />
        <input
          ref={feld}
          class="dh-hw__suchfeld"
          type="text"
          value={text}
          placeholder={t('ui.kiste.suche.platzhalter')}
          aria-label={t('ui.kiste.suche')}
          spellcheck={false}
          autocomplete="off"
          data-fokus=""
          data-testid="kiste-suchfeld"
          onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape' || e.key === 'Tab' || e.key === 'ArrowDown') {
              e.preventDefault();
              if (e.key === 'Escape') setText('');
              verlassen();
            }
          }}
        />
      </label>
      <p class="dh-ki__basis" data-testid="kiste-suche-basis" data-herd={ansicht?.herd === true ? '' : undefined}>
        {ansicht === null ? '' : basisText(i18n, ansicht)}
      </p>
      <ScrollArea height={FUNDE_HOEHE} zeile={FUND_ZEILE} labelHoch={t('ui.kit.scroll.hoch')} labelRunter={t('ui.kit.scroll.runter')} class="dh-ki__funde">
        <div data-testid="kiste-funde">
          {suchSet === null ? (
            <p class="dh-ki__erklaerung" data-testid="kiste-suche-erklaerung">
              {t('ui.kiste.suche.erklaerung', { radius: ansicht?.radius ?? 0 })}
            </p>
          ) : kisten.length === 0 ? (
            <p class="dh-ki__erklaerung" data-testid="kiste-suche-keine">
              {t('ui.kiste.suche.keine', { text: text.trim() })}
            </p>
          ) : (
            kisten.map((k) => {
              const itemName = catalog.find(k.item)?.name[lang] ?? k.item;
              const titel = kistenName(k.name, itemName);
              const ort = ortText(i18n, k);
              return (
                <section
                  key={k.id}
                  class="dh-ki__gruppe"
                  data-kiste={k.id}
                  data-offen={k.offen ? '' : undefined}
                  data-testid={`kiste-suche-kiste-${k.id}`}
                  aria-label={t('ui.kiste.suche.gruppe', { name: titel, ort, anzahl: k.stueck })}
                >
                  <span class="dh-ki__gruppe-bild" data-tip={k.label === null ? undefined : `item:${k.label}`}>
                    <ItemBild item={k.label ?? k.item} name={titel} />
                  </span>
                  <p class="dh-ki__gruppe-text">
                    <span class="dh-ki__gruppe-name">{titel}</span>
                    <span class="dh-ki__gruppe-ort" data-testid={`kiste-suche-ort-${k.id}`}>
                      {ort}
                    </span>
                  </p>
                  <div class="dh-ki__fundraster">
                    {k.funde.map((f) => {
                      const def = catalog.find(f.stack.item);
                      const name = def?.name[lang] ?? f.stack.item;
                      return (
                        <Slot
                          key={f.index}
                          class="dh-st__slot dh-ki__fund"
                          data-fern={k.offen ? undefined : ''}
                          label={t('ui.inventory.stapel', { item: name, anzahl: f.stack.count })}
                          anzahl={f.stack.count}
                          data-fokus=""
                          data-tip={`fund:${k.id}:${f.index}`}
                          data-item={f.stack.item}
                          data-testid={`kiste-fund-${k.id}-${f.index}`}
                          onClick={() => {
                            if (k.offen) nehmen(f.index);
                          }}
                        >
                          <ItemBild item={f.stack.item} name={name} />
                        </Slot>
                      );
                    })}
                  </div>
                </section>
              );
            })
          )}
        </div>
      </ScrollArea>
    </Frame>
  );
}
