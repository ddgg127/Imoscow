import type { Place } from "../engine/types";
import type { Building, BuildingKind, BuildingsFile } from "./building-types";
import catalog from "./moscow-buildings.json";

const file = catalog as BuildingsFile;

export type { Building, BuildingKind };

export const MOSCOW_BUILDINGS: Building[] = file.buildings;

/** Плоский список для мест, где достаточно address/lat/lon. */
export const MOSCOW_ADDRESSES: Place[] = MOSCOW_BUILDINGS.map(({ address, lat, lon }) => ({
  address,
  lat,
  lon,
}));
