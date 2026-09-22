/**
 * Одноразовая выгрузка реальных зданий вокруг якорей метро (Photon reverse / OSM).
 * Генератор потом читает moscow-buildings.json офлайн.
 *
 *   npm run fetch-buildings
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { MOSCOW_METRO } from "./moscow-metro";
import type { Building, BuildingKind, BuildingsFile } from "./building-types";

const OUT = path.resolve("src/data/moscow-buildings.json");
const PHOTON = "https://photon.komoot.io/reverse";
const MAX_DIST_M = 450;
const PER_AREA_RESIDENTIAL = 4;
const PER_AREA_WORKPLACE = 4;
const CONCURRENCY = 3;
const HEADERS = { "User-Agent": "ImoscowFieldflow/0.1 (educational dispatch prototype)" };

const RINGS: Array<{ dist: number; bearings: number[] }> = [
  { dist: 120, bearings: [25, 115, 205, 295] },
  { dist: 210, bearings: [70, 160, 250, 340] },
  { dist: 300, bearings: [0, 180] },
];

const RESIDENTIAL_TAGS = new Set([
  "apartments",
  "residential",
  "house",
  "detached",
  "semidetached_house",
  "terrace",
  "dormitory",
  "bungalow",
]);

const SKIP_KEYS = new Set([
  "railway",
  "highway",
  "natural",
  "landuse",
  "leisure",
  "waterway",
  "public_transport",
]);

type PhotonProps = {
  osm_key?: string;
  osm_value?: string;
  housenumber?: string;
  street?: string;
  city?: string;
  district?: string;
};

type PhotonHit = {
  address: string;
  lat: number;
  lon: number;
  kind: BuildingKind;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function offset(lat: number, lon: number, distM: number, bearingDeg: number): { lat: number; lon: number } {
  const br = (bearingDeg * Math.PI) / 180;
  const dLat = (distM * Math.cos(br)) / 111320;
  const dLon = (distM * Math.sin(br)) / (111320 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lon: lon + dLon };
}

function distM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLon / 2);
  const h =
    s1 * s1 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * s2 * s2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

function kindOf(p: PhotonProps): BuildingKind {
  const val = (p.osm_value ?? "").toLowerCase();
  if (RESIDENTIAL_TAGS.has(val)) return "residential";
  return "workplace";
}

function formatAddress(street: string, house: string): string {
  return `Москва, ${street.trim()}, д. ${house.trim()}`;
}

async function photonReverse(lat: number, lon: number): Promise<PhotonHit | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const url = `${PHOTON}?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`;
    const res = await fetch(url, { headers: HEADERS });
    if (res.status === 429 || res.status === 503) {
      await sleep(800 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`Photon ${res.status}`);
    const json = (await res.json()) as {
      features?: Array<{ properties?: PhotonProps; geometry?: { coordinates?: number[] } }>;
    };
    const feat = json.features?.[0];
    const p = feat?.properties ?? {};
    const coords = feat?.geometry?.coordinates;
    if (!p.street || !p.housenumber || !coords || coords.length < 2) return null;
    if (p.city !== "Москва") return null;
    if (SKIP_KEYS.has((p.osm_key ?? "").toLowerCase())) return null;
    if (/мжд|километр|\bкм\b|платформ/i.test(p.street)) return null;
    const hitLat = coords[1]!;
    const hitLon = coords[0]!;
    return {
      address: formatAddress(p.street, p.housenumber),
      lat: Math.round(hitLat * 1e6) / 1e6,
      lon: Math.round(hitLon * 1e6) / 1e6,
      kind: kindOf(p),
    };
  }
  return null;
}

async function mapPool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
      await sleep(80);
    }
  }
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

function pickClosest(
  items: Array<PhotonHit & { dist: number }>,
  kind: BuildingKind,
  n: number,
  taken: Set<string>,
): Building[] {
  const chosen: Building[] = [];
  for (const x of items.filter((i) => i.kind === kind).sort((a, b) => a.dist - b.dist)) {
    if (chosen.length >= n) break;
    if (taken.has(x.address)) continue;
    taken.add(x.address);
    chosen.push({ address: x.address, lat: x.lat, lon: x.lon, kind: x.kind, area: "" });
  }
  return chosen;
}

async function main() {
  type Query = { area: string; stationLat: number; stationLon: number; lat: number; lon: number };
  const queries: Query[] = [];
  for (const station of MOSCOW_METRO) {
    for (const ring of RINGS) {
      for (const bearing of ring.bearings) {
        const p = offset(station.lat, station.lon, ring.dist, bearing);
        queries.push({
          area: station.area,
          stationLat: station.lat,
          stationLon: station.lon,
          lat: p.lat,
          lon: p.lon,
        });
      }
    }
  }

  console.log(`Photon reverse: ${queries.length} точек вокруг ${MOSCOW_METRO.length} станций`);
  let done = 0;
  const hits = await mapPool(queries, CONCURRENCY, async (q) => {
    const hit = await photonReverse(q.lat, q.lon);
    done += 1;
    if (done % 50 === 0 || done === queries.length) {
      console.log(`  ${done}/${queries.length}`);
    }
    if (!hit) return null;
    const d = distM(q.stationLat, q.stationLon, hit.lat, hit.lon);
    if (d > MAX_DIST_M) return null;
    return { ...hit, dist: d, area: q.area };
  });

  const taken = new Set<string>();
  const buildings: Building[] = [];
  for (const station of MOSCOW_METRO) {
    const nearby = hits.filter((h): h is NonNullable<typeof h> => h !== null && h.area === station.area);
    const res = pickClosest(nearby, "residential", PER_AREA_RESIDENTIAL, taken);
    const work = pickClosest(nearby, "workplace", PER_AREA_WORKPLACE, taken);
    for (const b of [...res, ...work]) buildings.push({ ...b, area: station.area });
  }

  buildings.sort((a, b) => a.area.localeCompare(b.area, "ru") || a.address.localeCompare(b.address, "ru"));

  const file: BuildingsFile = {
    source: "OpenStreetMap via Photon reverse, здания с улицей и номером дома в радиусе 450 м от вестибюлей метро",
    fetchedAt: new Date().toISOString(),
    buildings,
  };
  writeFileSync(OUT, `${JSON.stringify(file, null, 2)}\n`, "utf8");

  const resN = buildings.filter((b) => b.kind === "residential").length;
  const workN = buildings.filter((b) => b.kind === "workplace").length;
  const areas = new Set(buildings.map((b) => b.area)).size;
  console.log(`записано ${buildings.length} зданий (${resN} жилых, ${workN} рабочих) в ${areas} районах → ${OUT}`);
  if (buildings.length < 200) {
    throw new Error("Слишком мало зданий: повторите выгрузку");
  }
}

await main();
