/**
 * Legend of the build overlay shown (M4-26, src/render/game/overlays.ts): what each colour of the fields means,
 * in the same palette colours the game view draws. Rooms list their types (src/content/roomTypes.ts, with the
 * type's description as tooltip), the plain interior and the room without roof; temperature its steps from Frost to
 * heiß with their edges; light the four stages of the light map (§12.1); comfort its five steps of 0–20 (§16.4); supports the
 * distance to the next support relative to the reach (§16.3) and the support mark. Pixel tooltips (`BauTipp`, never the
 * browser's `title`): the overlay's explanation on its title, a room type's description on its entry.
 */
import { BALANCE } from '../../../content/balance';
import { ROOM_TYPES } from '../../../content/roomTypes';
import { PALETTE_HEX, PALETTE_RAMPS } from '../../../generated/palette';
import type { I18n } from '../../../i18n';
import { COMFORT_REFS, LIGHT_STAGE_REFS, ROOM_REFS, ROOM_TEMPERATURE_STEPS, roomTypeColorRef, SUPPORT_REFS, type BuildOverlay } from '../../../render/game/overlays';
import { paletteRefHex } from '../../../render/palette/rows';
import { LIGHT_STAGES } from '../../../world/lightmap/stages';

function hex(ref: string): string {
  return paletteRefHex(ref, PALETTE_RAMPS, PALETTE_HEX);
}

interface Eintrag {
  readonly farbe: string;
  readonly text: string;
  /** The pixel tooltip of the entry (`BauTipp`: a room type's description), or none. */
  readonly tipp?: string;
}

export function BauLegende({ i18n, kind }: { readonly i18n: I18n; readonly kind: BuildOverlay }) {
  const t = i18n.t;
  const lang = i18n.lang;
  let eintraege: Eintrag[];
  switch (kind) {
    case 'raeume':
      eintraege = [
        ...ROOM_TYPES.map((r) => ({ farbe: hex(roomTypeColorRef(r.id)), text: r.name[lang], tipp: `raumtyp:${r.id}` })),
        { farbe: hex(ROOM_REFS.plain), text: t('ui.bau.overlay.raum.innenraum') },
        { farbe: hex(ROOM_REFS.roofless), text: t('ui.bau.overlay.raum.ohneDach') },
      ];
      break;
    case 'temperatur':
      eintraege = ROOM_TEMPERATURE_STEPS.map((st, i) => ({
        farbe: hex(st.ref),
        text: t(`ui.bau.legende.temperatur.${st.id}`, { von: i === 0 ? st.bisC : (ROOM_TEMPERATURE_STEPS[i - 1] as { bisC: number }).bisC, bis: st.bisC }),
      }));
      break;
    case 'licht':
      eintraege = LIGHT_STAGES.map((st) => ({ farbe: hex(LIGHT_STAGE_REFS[st]), text: t(`ui.bau.legende.licht.${st}`) }));
      break;
    case 'behaglichkeit': {
      const max = BALANCE.rooms.comfort.max;
      const schritt = max / COMFORT_REFS.length;
      eintraege = COMFORT_REFS.map((ref, i) => ({ farbe: hex(ref), text: t('ui.bau.legende.behaglichkeit', { von: Math.ceil(i * schritt), bis: i === COMFORT_REFS.length - 1 ? max : Math.ceil((i + 1) * schritt) - 1 }) }));
      break;
    }
    case 'stuetzen':
      eintraege = (['nah', 'mittel', 'weit', 'stuetze'] as const).map((k) => ({ farbe: hex(SUPPORT_REFS[k]), text: t(`ui.bau.legende.stuetzen.${k}`) }));
      break;
  }
  const titel = t(`ui.bau.overlay.${kind}.name`);
  const erklaerung = t(`ui.bau.overlay.${kind}.erklaerung`);
  return (
    <div class="dh-bau__legende dh-hud-platte" data-testid="bau-legende" data-overlay={kind} role="note" aria-label={`${titel}: ${erklaerung}`}>
      <span class="dh-bau__legendentitel" data-tipp={`overlay:${kind}`}>
        {titel}
      </span>
      {eintraege.map((e) => (
        <span class="dh-bau__legendeneintrag" key={e.text} data-tipp={e.tipp}>
          <span class="dh-bau__farbe" style={{ background: e.farbe }} aria-hidden="true" />
          <span>{e.text}</span>
        </span>
      ))}
    </div>
  );
}
