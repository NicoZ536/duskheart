/**
 * Light of the fired stations (MASTERPROMPT §12.1 "gespeist aus derselben Lichtquellenliste wie der Renderer", §12.2
 * "Feuerschale/Kohlebecken"; M5-35): a charcoal kiln, clay oven or smelting furnace with a fuel piece burning in it is
 * a light source of the light system's list – the gameplay light map (fear, spawn rules, perception) and the renderer
 * read it like a camp fire. Radius, brightness, flicker, where its fire sits and its colour are the station's content
 * (`licht`, src/content/stations.ts): behind the middle of the station's front edge (where the station's sprite
 * stands), inside its body – the renderer lights that body only through its openings. It burns as long as the fuel
 * piece glows (`glut`). Only stations in the active zone light (frozen
 * chunks catch up without light, like hearths and fires).
 */
import { BALANCE } from '../../content/balance';
import { CHUNK_SHIFT, TILE_PX } from '../../world/model/coords';
import type { ExtraLightProvider } from '../light/system';
import { worldStationEnvironment, type StationEnvironment, type StationSystem } from './system';
import type { PlacedStation } from './state';

/** Bits below the stations' light ids: placed lights count from 1, hearths from 2^20, burning tiles from 2^24. */
const LIGHT_ID_BITS = 22;
/** Light ids of stations start at 2^22. */
export const STATION_LIGHT_ID_BASE = 1 << LIGHT_ID_BITS;
const TICK_HZ = BALANCE.time.tickHz;

/**
 * Ground point of a placed station's light [world px]: `depthPx` behind the middle of its footprint's front edge (the
 * front row's last pixel, where its sprite's anchor stands).
 */
export function stationLightPoint(p: Pick<PlacedStation, 'tx' | 'ty'>, size: { readonly b: number; readonly t: number }, depthPx: number, out: { x: number; y: number }): void {
  out.x = (p.tx + size.b / 2) * TILE_PX;
  out.y = (p.ty + size.t) * TILE_PX - 1 - depthPx;
}

/** Puts the light of every fired station with a burning fuel piece into the light source list. */
export function stationLightProvider(stations: StationSystem, env: StationEnvironment = worldStationEnvironment()): ExtraLightProvider {
  const at = { x: 0, y: 0 };
  return (sim, emit) => {
    const placed = stations.placed;
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i] as Readonly<PlacedStation>;
      const proc = p.proc;
      if (proc === null || !(proc.glut > 0)) continue;
      const l = stations.stations.find(p.station)?.licht;
      if (l === undefined || !env.active(sim, p.layer, p.tx >> CHUNK_SHIFT, p.ty >> CHUNK_SHIFT)) continue;
      stationLightPoint(p, stations.footprintOf(p), l.tiefePx, at);
      emit(STATION_LIGHT_ID_BASE + p.id, p.station, l.farbe, p.layer, at.x, at.y, l.hoehePx, l.radiusTiles * TILE_PX, l.intensitaet, l.flackern, proc.glut / TICK_HZ, Math.ceil(l.radiusTiles));
    }
  };
}
