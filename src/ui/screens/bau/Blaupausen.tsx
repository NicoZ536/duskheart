/**
 * The build mode's line of the blueprints in view (MASTERPROMPT §16.6 "Blaupausen"; M4-24): what they still need
 * ("Blaupausen brauchen noch: 4× Holzwand …") or that everything is at hand – above the status line, in the
 * blueprint blue. Samples the session's blueprint needs (`UiBridge.basis.sampleBlueprintNeeds`) over the view around
 * the player a few times a second (`ABTAST_FRAMES`), not every frame: the needs count the bags and the chests near
 * the sites.
 */
import { useSignal } from '@preact/signals';
import { useEffect, useMemo } from 'preact/hooks';
import { PALETTE_HEX, PALETTE_RAMPS } from '../../../generated/palette';
import { contentItemCatalog } from '../../../game/items/catalog';
import { createBlueprintNeedsSample } from '../../../game/samples/basis';
import type { I18n } from '../../../i18n';
import { paletteRefHex } from '../../../render/palette/rows';
import type { UiBridge } from '../../bridge';
import { blaupausenBereich, blaupausenZeile, type BlaupausenBedarf } from './blaupausen';

/** Frames between two samples of the needs (≈ 4 per second at 60 fps). */
export const ABTAST_FRAMES = 15;
/** The blueprint blue (the colour of a planned piece, palette reference): the line's edge, the plan switch and status. */
export const BLAUPAUSE_FARBE: Readonly<Record<string, string>> = { '--dh-bau-blaupause': paletteRefHex('wasser.4', PALETTE_RAMPS, PALETTE_HEX) };

export function BlaupausenZeile({ i18n, bridge }: { readonly i18n: I18n; readonly bridge: UiBridge }) {
  const bedarf = useSignal<readonly BlaupausenBedarf[]>([]);
  const catalog = useMemo(() => contentItemCatalog(), []);
  useEffect(() => {
    const basis = bridge.basis;
    if (basis === null) return undefined;
    const sample = createBlueprintNeedsSample();
    let frame = 0;
    let stand = -1;
    const abtasten = (): void => {
      const { halbB, halbH } = blaupausenBereich(window.innerWidth, window.innerHeight);
      basis.sampleBlueprintNeeds(halbB, halbH, sample);
      if (sample.stand === stand) return;
      stand = sample.stand;
      bedarf.value = sample.teile.slice(0, sample.anzahl).map((t) => ({ part: t.part, blueprints: t.blueprints, atHand: t.atHand, missing: t.missing }));
    };
    abtasten();
    return bridge.onFrame(() => {
      if (++frame % ABTAST_FRAMES === 0) abtasten();
    });
  }, [bridge, bedarf]);
  const zeile = blaupausenZeile(i18n, bedarf.value, (part) => catalog.find(part)?.name[i18n.lang] ?? part);
  if (zeile === null) return null;
  return (
    <div class={`dh-bau__status dh-bau__blaupausen dh-hud-platte${zeile.fehlt ? ' dh-bau__blaupausen--fehlt' : ''}`} style={BLAUPAUSE_FARBE} role="status" data-testid="bau-blaupausen" data-fehlt={zeile.fehlt ? '' : undefined}>
      {zeile.text}
    </div>
  );
}
