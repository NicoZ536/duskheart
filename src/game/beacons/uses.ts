/**
 * E at a beacon (MASTERPROMPT §11.4 "Interagieren (E)", §8; docs/SPIEL.md §22 "Leuchtfeuer", "Schnellreise"; M7-35, M7-37):
 * the 3 × 3 beacon as a use target of the interaction system – "Entzünden: Leuchtfeuer" while it waits for the flame
 * (blocked "das Leuchtfeuer schläft …" until the guardian of its biome falls, "ein Boss ist erwacht …" during a fight),
 * "Reisen: Leuchtfeuer" once it burns (the travel screen, `travel.open`). Nothing during the ignition sequence. Each through
 * the owning system's command, so every refusal is that command's.
 */
import { TILE_PX, type Layer } from '../../world/model/coords';
import type { BossesApi } from '../bosses/types';
import { setOffer, type UseOffer, type UseProvider } from '../interaction/uses';
import type { CommandHandlers } from '../sim';
import type { BeaconsSystem } from './system';

/** The beacons as use targets; `travel` is the travel system's command table (`travel.open`). */
export function beaconUses(beacons: BeaconsSystem, bosses: Pick<BossesApi, 'awake'>, travel: { readonly commands: CommandHandlers }): UseProvider {
  const ignite = beacons.commands['beacon.ignite'];
  const open = travel.commands['travel.open'];
  if (ignite === undefined || open === undefined) throw new Error('beaconUses: no handler for beacon.ignite or travel.open');
  return {
    offer: (sim, layer: Layer, tx: number, ty: number, out: UseOffer) => {
      const i = beacons.beaconOnTile(layer, tx, ty);
      if (i < 0) return false;
      const st = beacons.state(i + 1);
      if (st.state === 'entzuendung') return false;
      const site = beacons.site(sim, i + 1);
      if (site === null) return false;
      if (st.state === 'entzuendet') setOffer(out, 'reisen', 'leuchtfeuer', null, site.tx, site.ty);
      else setOffer(out, 'entzuenden', 'leuchtfeuer', st.state === 'erloschen' ? 'leuchtfeuerSchlaeft' : bosses.awake() !== null ? 'bossWacht' : null, site.tx, site.ty);
      // The hint's marker sits on the flame bowl, the middle of the beacon.
      out.x = site.x;
      out.y = site.y - TILE_PX;
      return true;
    },
    use: (sim, layer, tx, ty, tick) => {
      const i = beacons.beaconOnTile(layer, tx, ty);
      if (i < 0) return;
      if (beacons.state(i + 1).state === 'entzuendet') open(sim, { type: 'travel.open' }, tick);
      else ignite(sim, { type: 'beacon.ignite', beacon: i + 1 }, tick);
    },
  };
}
