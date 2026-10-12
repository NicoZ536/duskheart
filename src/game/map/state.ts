/**
 * Saved state of the map (participant `map`, data version 1; docs/SPIEL.md §27 "Aufdeckung je Ebene (RLE/Base64), eigene
 * Marker"): the cell raster it was written with, every layer the player revealed something on (`formulas.ts` `encodeMask`),
 * the own markers and the next marker id. Derived markers (places, beacons, grave, bases) are never saved.
 */
import { z } from 'zod';
import { DEEPEST_LAYER, SURFACE_LAYER } from '../../world/model/coords';
import { MAP_MARKER_SYMBOLS } from './types';

const layerSchema = z.number().int().min(DEEPEST_LAYER).max(SURFACE_LAYER);

export const mapMarkerSchema = z
  .object({
    id: z.number().int().min(0),
    symbol: z.enum(MAP_MARKER_SYMBOLS),
    name: z.string(),
    layer: layerSchema,
    tx: z.number().int(),
    ty: z.number().int(),
  })
  .strict();

export const mapSnapshotSchema = z
  .object({
    /** Edge of a cell [tiles] and cells per side the masks were written with. */
    cellTiles: z.number().int().positive(),
    side: z.number().int().positive(),
    /** Revealed cells per layer (only layers with a reveal), surface first. */
    layers: z.array(z.object({ layer: layerSchema, cells: z.string() }).strict()),
    markers: z.array(mapMarkerSchema),
    nextId: z.number().int().min(0),
    /**
     * Cell, layer and height level of the player's last reveal (absent before the first one, and in saves from before it was
     * kept – optional, ADR-0038): the disc centres on the player's tile when they enter a cell, so a loaded map must not
     * reveal again until they leave it, just like the running one (otherwise the first tick after loading reveals around
     * wherever in the cell they stand – a save point mid-walk diverged).
     */
    zuletzt: z.object({ cx: z.number().int(), cy: z.number().int(), layer: layerSchema, level: z.number().int().min(0) }).strict().optional(),
  })
  .strict();

export type MapSnapshot = z.infer<typeof mapSnapshotSchema>;

/** The state of a map before anything was revealed (a save without the participant migrates to it). */
export function emptyMapSnapshot(cellTiles: number, side: number): MapSnapshot {
  return { cellTiles, side, layers: [], markers: [], nextId: 0 };
}
