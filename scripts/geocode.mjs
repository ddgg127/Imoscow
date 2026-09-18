import fs from "node:fs";
import path from "node:path";

const cacheFile = path.join(process.cwd(), "data", "geocode-cache.json");
const UA = "FieldFlow-Hackathon/1.0 (route planning; local geocode cache)";
const PARK_RE = /park|wood|forest|nature|grass|pitch|station|subway|halt|peak|water|river|cemetery|leisure/i;
const BUILDING_RE = /building|house|apartments|residential|yes|address|office|retail|commercial|industrial/i;

export function normalizeAddress(raw) {
  let value = String(raw ?? "")
    .replace(/г\.\s*Город\s*/gi, "")
    .replace(/Город\s+/gi, "")
    .replace(/^г\.\s*/i, "")
    .replace(/(^|[,.\s])пр-кт(?:\.|\s+)/gi, "$1проспект ")
    .replace(/(^|[,.\s])пр-т(?:\.|\s+)/gi, "$1проспект ")
    .replace(/(^|[,.\s])ул(?:\.|\s+)/gi, "$1улица ")
    .replace(/(^|[,.\s])пер(?:\.|\s+)/gi, "$1переулок ")
    .replace(/(^|[,.\s])наб(?:\.|\s+)/gi, "$1набережная ")
    .replace(/(^|[,.\s])ш(?:\.|\s+)/gi, "$1шоссе ")
    .replace(/(^|[,.\s])пл(?:\.|\s+)/gi, "$1площадь ")
    .replace(/(^|[,.\s])б-р(?:\.|\s+)/gi, "$1бульвар ")
    .replace(/(^|[,.\s])проезд(?:\.|\s+)/gi, "$1проезд ")
    .replace(/(^|,\s*)д\.?\s*(?=\d)/gi, "$1")
    .replace(/\s+корп(?:ус)?\.?\s*/gi, "к")
    .replace(/\s+к\.?\s+(\d)/gi, "к$1")
    .replace(/(\d[А-Яа-яA-Za-z]?)\s*стр(?:оение)?\.?\s*/gi, "$1с")
    .replace(/москва(?=\s+\S)/i, "Москва,")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
  if (!/(москва|домодедово|кашира)/i.test(value)) value = `Москва, ${value}`;
  return value.replace(/москва\s*,?\s*москва/gi, "Москва").replace(/\s+/g, " ").trim();
}

function extractHouse(query) {
  const last = query.split(",").map(part => part.trim()).at(-1) ?? "";
  const match = last.match(/(\d+[кс]?\d*)/i);
  return match ? match[1].toLowerCase().replace(/\s+/g, "") : "";
}

function normalizeHouse(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, "").replace("корпус", "к").replace("строение", "с").replace("/", "");
}

function queryVariants(query) {
  const variants = [query];
  const swapped = query.replace(/улица\s+(\d+-я\s+\S+)/i, "$1 улица");
  if (swapped !== query) variants.push(swapped);
  const asKorpus = query.replace(/(\d)с\s*(\d+)/gi, "$1к$2");
  if (asKorpus !== query) variants.push(asKorpus);
  const houseOnly = query.replace(/(\d+)\s*[кс]\s*\d+\s*$/i, "$1").replace(/(\d+)[кс]\d+\s*$/i, "$1");
  if (houseOnly !== query) variants.push(houseOnly);
  return [...new Set(variants)];
}

export function loadGeocodeCache() {
  if (!fs.existsSync(cacheFile)) return {};
  try { return JSON.parse(fs.readFileSync(cacheFile, "utf8")); } catch { return {}; }
}

export function saveGeocodeCache(cache) {
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2), "utf8");
}

function scoreHit(hit, query) {
  const kind = `${hit.addresstype ?? ""} ${hit.category ?? ""} ${hit.type ?? ""} ${hit.class ?? ""}`;
  if (PARK_RE.test(kind)) return -5;
  let score = 0;
  if (BUILDING_RE.test(kind)) score += 4;
  if (Number(hit.place_rank) >= 26) score += 1;
  const wanted = normalizeHouse(extractHouse(query));
  const got = normalizeHouse(hit.address?.house_number ?? "");
  if (wanted && got && (got === wanted || got.replaceAll("с", "к") === wanted.replaceAll("с", "к"))) score += 6;
  else if (wanted && got && got.startsWith(wanted.match(/^\d+/)?.[0] ?? "__")) score += 2;
  return score;
}

function pickHit(hits, query) {
  return [...hits].sort((a, b) => scoreHit(b, query) - scoreHit(a, query)).find(hit => scoreHit(hit, query) >= 4);
}

function fallbackHit(hits, query) {
  return [...hits].sort((a, b) => scoreHit(b, query) - scoreHit(a, query)).find(hit => scoreHit(hit, query) >= 0);
}

async function nominatim(query) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("countrycodes", "ru");
  url.searchParams.set("addressdetails", "1");
  const response = await fetch(url, { headers: { "user-agent": UA, "accept-language": "ru" } });
  if (response.status === 429) {
    await new Promise(resolve => setTimeout(resolve, 4000));
    return nominatim(query);
  }
  if (!response.ok) throw new Error(`Nominatim ${response.status}`);
  return response.json();
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let lastRequest = 0;
async function search(query) {
  const wait = 1100 - (Date.now() - lastRequest);
  if (wait > 0) await delay(wait);
  try {
    return await nominatim(query);
  } finally {
    lastRequest = Date.now();
  }
}

export async function geocodeAddress(raw, cache, fallback) {
  const key = String(raw ?? "").trim();
  if (!key) return { coords: fallback, fromCache: true };
  const cached = cache[key];
  if (cached?.lon && cached?.lat && process.env.GEOCODE_RETRY !== "1") {
    return { coords: [Number(cached.lon), Number(cached.lat)], fromCache: true };
  }
  const query = normalizeAddress(key);
  let best = null;
  let bestScore = -99;
  let usedQuery = query;
  for (const variant of queryVariants(query)) {
    let hits = [];
    try { hits = await search(variant); } catch { hits = []; }
    const candidate = pickHit(hits, variant) ?? fallbackHit(hits, variant);
    if (!candidate) continue;
    const score = scoreHit(candidate, variant);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
      usedQuery = variant;
    }
    if (bestScore >= 6) break;
  }
  if (best?.lon && best?.lat && bestScore >= 0) {
    cache[key] = {
      lon: Number(best.lon),
      lat: Number(best.lat),
      displayName: best.display_name,
      type: `${best.addresstype ?? ""}/${best.type ?? ""}`,
      query: usedQuery,
    };
    return { coords: [cache[key].lon, cache[key].lat], fromCache: false };
  }
  cache[key] = { lon: fallback[0], lat: fallback[1], displayName: "", type: "fallback", query };
  return { coords: fallback, fromCache: false };
}

export async function geocodeMany(addresses, fallbacks) {
  const cache = loadGeocodeCache();
  const result = new Map();
  let done = 0;
  let fetched = 0;
  for (const address of addresses) {
    const fallback = fallbacks.get(address) ?? [37.62, 55.75];
    const { coords, fromCache } = await geocodeAddress(address, cache, fallback);
    result.set(address, coords);
    done += 1;
    if (!fromCache) fetched += 1;
    if (done % 8 === 0 || done === addresses.length) {
      saveGeocodeCache(cache);
      console.log(`Geocoded ${done}/${addresses.length} (network ${fetched})`);
    }
  }
  saveGeocodeCache(cache);
  const fallbackCount = addresses.filter(address => cache[address]?.type === "fallback").length;
  const buildings = addresses.filter(address => BUILDING_RE.test(cache[address]?.type ?? "")).length;
  console.log(`Geocode cache ready: ${buildings} buildings, ${fallbackCount} fallbacks.`);
  return result;
}
