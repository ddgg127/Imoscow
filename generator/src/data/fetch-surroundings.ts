/**
 * Догружает реальные дома дальше от метро: 0,9 / 1,5 / 2,1 км.
 * Результат сливается с moscow-buildings.json.
 *
 *   npx tsx src/data/fetch-surroundings.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MOSCOW_METRO } from "./moscow-metro";
import type { Building, BuildingKind, BuildingsFile } from "./building-types";

const OUT = path.resolve("src/data/moscow-buildings.json");
const PHOTON = "https://photon.komoot.io/reverse";
const RINGS = [900, 1500, 2100];
const BEARINGS = [40, 220];
const RESIDENTIAL = new Set(["apartments", "residential", "house", "detached", "semidetached_house", "terrace", "dormitory", "bungalow"]);

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function offset(lat: number, lon: number, distM: number, bearingDeg: number) {
  const br = (bearingDeg * Math.PI) / 180;
  return {
    lat: lat + (distM * Math.cos(br)) / 111320,
    lon: lon + (distM * Math.sin(br)) / (111320 * Math.cos((lat * Math.PI) / 180)),
  };
}

async function photonAt(lat: number, lon: number): Promise<Omit<Building, "area"> | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${PHOTON}?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`, {
        headers: { "User-Agent": "ImoscowFieldflow/0.1 (educational dispatch prototype)" },
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 429 || res.status === 503) {
        await sleep(700 * (attempt + 1));
        continue;
      }
      if (!res.ok) return null;
      const json = await res.json() as { features?: Array<{ properties?: { osm_value?: string; housenumber?: string; street?: string; city?: string }; geometry?: { coordinates?: number[] } }> };
      const feature = json.features?.[0];
      const props = feature?.properties ?? {};
      const coords = feature?.geometry?.coordinates;
      if (!props.street || !props.housenumber || !coords || props.city !== "Москва") return null;
      if (/мжд|километр|платформ/i.test(props.street)) return null;
      const kind: BuildingKind = RESIDENTIAL.has((props.osm_value ?? "").toLowerCase()) ? "residential" : "workplace";
      return {
        address: `Москва, ${props.street.trim()}, д. ${props.housenumber.trim()}`,
        lat: Math.round(coords[1]! * 1e6) / 1e6,
        lon: Math.round(coords[0]! * 1e6) / 1e6,
        kind,
      };
    } catch {
      await sleep(400 * (attempt + 1));
    }
  }
  return null;
}

const existing = JSON.parse(readFileSync(OUT, "utf8")) as BuildingsFile;
const taken = new Set(existing.buildings.map(item => item.address));
const added: Building[] = [];
const queries = MOSCOW_METRO.filter((_, index) => index % 2 === 0).flatMap(station => RINGS.flatMap(dist => BEARINGS.map(bearing => ({ station, ...offset(station.lat, station.lon, dist, bearing) }))));

let cursor = 0;
async function worker() {
  while (cursor < queries.length) {
    const query = queries[cursor++];
    const hit = await photonAt(query.lat, query.lon);
    if (hit && !taken.has(hit.address)) {
      taken.add(hit.address);
      added.push({ ...hit, area: query.station.area });
    }
    if (cursor % 40 === 0 || cursor === queries.length) console.log(`${cursor}/${queries.length}, новых ${added.length}`);
    await sleep(90);
  }
}

await Promise.all(Array.from({ length: 4 }, () => worker()));

const buildings = [...existing.buildings, ...added].sort((a, b) => a.area.localeCompare(b.area, "ru") || a.address.localeCompare(b.address, "ru"));
const file: BuildingsFile = {
  source: "OpenStreetMap via Photon: дома у метро и окружение на 0,9 / 1,5 / 2,1 км",
  fetchedAt: new Date().toISOString(),
  buildings,
};
writeFileSync(OUT, `${JSON.stringify(file, null, 2)}\n`, "utf8");
console.log(`всего ${buildings.length} (было ${existing.buildings.length})`);
