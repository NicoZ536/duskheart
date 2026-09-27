/**
 * The crafting menu (MASTERPROMPT §15.1 "Ohne Station herstellbar: Grundlagen", §26 "C Handwerk"; M4-32), opened
 * with C (D-pad right): the recipe book (`RezeptBuch`) over the recipes made in the hand – rope, stone tools,
 * torch, campfire, workbench, bandage, grass bed, spear – with search, quantity, queue, pinning and the missing
 * ingredients with their solution hints. The world keeps running while it is open. Without a crafting sample
 * of the session (tests) it shows nothing.
 */
import { useMemo } from 'preact/hooks';
import type { I18n } from '../../../i18n';
import type { UiBridge } from '../../bridge';
import { ScreenLayer } from '../../focus/Layer';
import type { FocusManager } from '../../focus/manager';
import { contentRezeptKontext, type RezeptKontext } from './modell';
import { werkstattQuelle } from './quelle';
import { RezeptBuch } from './RezeptBuch';

export interface HandwerkScreenProps {
  readonly i18n: I18n;
  readonly bridge: UiBridge;
  readonly focus: FocusManager;
  readonly close: () => void;
  readonly ctx?: RezeptKontext;
}

export function HandwerkScreen({ i18n, bridge, focus, close, ctx = contentRezeptKontext() }: HandwerkScreenProps) {
  const quelle = werkstattQuelle(bridge);
  const rezepte = useMemo(() => ctx.book.list.filter((r) => r.station === null), [ctx]);
  if (quelle === null) return null;
  return (
    <ScreenLayer focus={focus} label={i18n.t('ui.handwerk.titel')} testId="ui-handwerk">
      <RezeptBuch i18n={i18n} bridge={bridge} focus={focus} quelle={quelle} rezepte={rezepte} titel={i18n.t('ui.handwerk.titel')} leer={i18n.t('ui.handwerk.leer')} close={close} testId="handwerk" ctx={ctx} />
    </ScreenLayer>
  );
}
