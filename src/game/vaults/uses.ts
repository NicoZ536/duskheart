/**
 * E in and at a vault (MASTERPROMPT §11.4 "Interagieren (E)", §21; docs/SPIEL.md §19; M7-10 … M7-16, M7-46): the vault's things
 * as use targets of the interaction system, each through the vaults' commands, so every refusal is the command's –
 * "Hinabsteigen: Gewölbe-Abgang" at the entrance on the surface, "Hinaufsteigen: Gewölbe-Aufgang" in the start room,
 * "Aufschließen: Gewölbetür" (blocked without the vault's key), "Abtasten: Rissige Wand", "Ziehen: Hebel", "Entzünden:
 * Feuerschale" (blocked without a burning light in the hand), "Läuten: Glocke", "Anhören: Glockeninschrift", "Schieben: Kiste",
 * "Zurücksetzen: Rückstellrune", "Öffnen: Gewölbetruhe", "Nehmen: Gewölbeschlüssel / Glutsplitter", "Lesen: Erbauer-Tafel".
 * A solved puzzle's parts, an open door, an opened chest and a taken key offer nothing.
 */
import { lightKindOfItem } from '../../content/lights';
import { TILE_PX, type Layer } from '../../world/model/coords';
import type { InventorySystem } from '../inventory/system';
import type { UseOffer, UseProvider } from '../interaction/uses';
import { VAULT_KEY_ITEM, VAULT_LAYER, VAULT_PART_STRIDE, VAULT_SHARD_ITEM, VAULT_USE_KINDS, type VaultsSystem } from './system';

/** The vaults' things as use targets. */
export function vaultUses(vaults: VaultsSystem, inventory: InventorySystem): UseProvider {
  const use = vaults.commands['vault.use'];
  const push = vaults.commands['vault.push'];
  const enter = vaults.commands['vault.enter'];
  if (use === undefined || push === undefined || enter === undefined) throw new Error('vaultUses: the vaults handle no vault.use, vault.push or vault.enter');
  const hit = { slot: 0, kind: 0, index: 0 };
  return {
    offer: (sim, layer: Layer, tx: number, ty: number, out: UseOffer) => {
      out.block = null;
      out.detail = null;
      out.x = (tx + 0.5) * TILE_PX;
      out.y = (ty + 0.5) * TILE_PX;
      out.aimedOnly = false;
      if (layer === 0) {
        if (vaults.entranceAt(sim, tx, ty) < 0) return false;
        out.action = 'hinabsteigen';
        out.subject = 'gewoelbe_abgang';
        return true;
      }
      if (layer !== VAULT_LAYER || !vaults.partAtTile(sim, tx, ty, hit)) return false;
      const plan = vaults.planOf(hit.slot);
      if (plan === undefined) return false;
      switch (hit.kind) {
        case VAULT_USE_KINDS.up:
          out.action = 'hinaufsteigen';
          out.subject = 'gewoelbe_aufgang';
          return true;
        case VAULT_USE_KINDS.door: {
          const d = plan.doors[hit.index];
          if (d === undefined || vaults.isDoorOpen(hit.slot, d.id)) return false;
          if (d.kind === 'verborgen') {
            out.action = 'abtasten';
            out.subject = 'risswand';
            return true;
          }
          out.action = 'aufschliessen';
          out.subject = 'gewoelbetuer';
          if (d.kind === 'raetsel') out.block = 'raetselTuer';
          else if (!vaults.hasKey(hit.slot)) out.block = 'keinSchluessel';
          return true;
        }
        case VAULT_USE_KINDS.part: {
          const puzzle = Math.floor(hit.index / VAULT_PART_STRIDE);
          const part = plan.puzzles[puzzle]?.parts[hit.index % VAULT_PART_STRIDE];
          if (part === undefined) return false;
          if (part.role === 'hinweis') {
            out.action = 'anhoeren';
            out.subject = 'glockeninschrift';
            return true;
          }
          if (vaults.isSolved(hit.slot, puzzle)) return false;
          switch (part.role) {
            case 'hebel':
              out.action = 'ziehen';
              out.subject = 'hebel';
              return true;
            case 'schale': {
              out.action = 'entzuenden';
              out.subject = 'feuerschale';
              const hand = inventory.selected();
              if (hand === null || lightKindOfItem(hand.item) === undefined) out.block = 'keineFackel';
              return true;
            }
            case 'glocke':
              out.action = 'laeuten';
              out.subject = 'glocke';
              return true;
            case 'risswand':
              out.action = 'abtasten';
              out.subject = 'risswand';
              return true;
            case 'ruecksetzer':
              out.action = 'zuruecksetzen';
              out.subject = 'rueckstellrune';
              return true;
            default:
              return false;
          }
        }
        case VAULT_USE_KINDS.crate:
          if (vaults.isSolved(hit.slot, hit.index)) return false;
          out.action = 'schieben';
          out.subject = 'gewoelbekiste';
          return true;
        case VAULT_USE_KINDS.chest: {
          const c = plan.chests[hit.index];
          if (c === undefined || c.mimic || vaults.chestOpen(hit.slot, c.id)) return false;
          out.action = 'oeffnen';
          out.subject = 'gewoelbetruhe';
          return true;
        }
        case VAULT_USE_KINDS.key:
          if (vaults.keyTaken(hit.slot, hit.index)) return false;
          out.action = 'nehmen';
          out.subject = VAULT_KEY_ITEM;
          return true;
        case VAULT_USE_KINDS.shard:
          if (vaults.state(hit.slot)?.shardTaken === true) return false;
          out.action = 'nehmen';
          out.subject = VAULT_SHARD_ITEM;
          return true;
        case VAULT_USE_KINDS.tablet:
          out.action = 'lesen';
          out.subject = 'erbauer_tafel';
          return true;
        default:
          return false;
      }
    },
    use: (sim, layer, tx, ty, tick) => {
      if (layer === 0) {
        const slot = vaults.entranceAt(sim, tx, ty);
        if (slot >= 0) enter(sim, { type: 'vault.enter', vault: slot }, tick);
        return;
      }
      if (layer !== VAULT_LAYER || !vaults.partAtTile(sim, tx, ty, hit)) return;
      if (hit.kind === VAULT_USE_KINDS.crate) push(sim, { type: 'vault.push', tx, ty }, tick);
      else use(sim, { type: 'vault.use', tx, ty }, tick);
    },
  };
}
