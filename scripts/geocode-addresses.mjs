import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceDir = path.join(root, "data", "csv");
const cachePath = path.join(root, "data", "geocoding-cache.json");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function rowsFrom(file) {
  const text = new TextDecoder("windows-1251").decode(fs.readFileSync(file));
  const lines = text.split(/\r?\n/).filter(Boolean).map(line => line.split(";"));
  const headers = lines.shift().map(value => value.trim());
  const addressIndex = headers.indexOf("Адрес");
  const addresses = lines
    .filter(row => /^\d+$/.test(row[0]?.trim() ?? ""))
    .map(row => row[addressIndex]?.trim())
    .filter(Boolean);
  const office = lines.find(row => /^Адрес офиса$/i.test(row[0]?.trim() ?? ""))?.[1]?.trim();
  if (office) addresses.push(office);
  return addresses;
}

export function normalizeAddress(value) {
  return value
    .replace(/^г\.Город Москва,?/i, "Москва,")
    .replace(/^Город Москва,?/i, "Москва,")
    .replace(/^г\.\s*Москва\s*,?/i, "Москва,")
    .replace(/^МО,\s*/i, "Московская область, ")
    .replace(/\s+/g, " ")
    .replace(/,\s*,/g, ",")
    .trim();
}

function nominatimQuery(address) {
  return address
    .replace(/ул\.\s*/gi, "улица ")
    .replace(/пер\.\s*/gi, "переулок ")
    .replace(/пр-д\.?\s*/gi, "проезд ")
    .replace(/проезд\.\s*/gi, "проезд ")
    .replace(/просп\.\s*/gi, "проспект ")
    .replace(/пр-кт\.\s*/gi, "проспект ")
    .replace(/б-р\.\s*/gi, "бульвар ")
    .replace(/наб\.\s*/gi, "набережная ")
    .replace(/ш\.\s*/gi, "шоссе ")
    .replace(/,\s*д\.\s*/gi, ", ")
    .replace(/\s+к\s+(\d+)/gi, " корпус $1")
    .replace(/(\d)к(\d+)/gi, "$1 корпус $2")
    .replace(/\s+с\s*(\d+)/gi, " строение $1")
    .replace(/\s+/g, " ")
    .trim();
}

const files = fs.readdirSync(sourceDir).filter(name => name.endsWith("-synthetic.csv"));
const addresses = [...new Set(files.flatMap(name => rowsFrom(path.join(sourceDir, name))).map(normalizeAddress))].sort();
const cache = fs.existsSync(cachePath)
  ? JSON.parse(fs.readFileSync(cachePath, "utf8"))
  : { version: 1, provider: "Nominatim + Photon / OpenStreetMap", entries: {} };
cache.entries ??= {};
cache.provider = "Nominatim + Photon / OpenStreetMap";

function save() {
  cache.generatedAt = new Date().toISOString();
  cache.uniqueAddresses = addresses.length;
  fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

let completed = 0;
let requested = 0;
for (const address of addresses) {
  if (cache.entries[address]?.coordinates) {
    completed++;
    continue;
  }
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", `${nominatimQuery(address)}, Россия`);
  url.searchParams.set("limit", "1");
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "FieldFlow-Hackathon/1.0 (CSV geocoding cache)",
        "accept-language": "ru",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const match = payload.features?.[0];
    cache.entries[address] = match ? {
      query: address,
      coordinates: match.geometry.coordinates.map(Number),
      displayName: [match.properties.name, match.properties.street, match.properties.housenumber, match.properties.city, match.properties.state].filter(Boolean).join(", "),
      status: match.properties.housenumber ? "precise" : "approximate",
      osmType: match.properties.osm_value ?? match.properties.type ?? "unknown",
    } : { query: address, coordinates: null, displayName: null, status: "not_found", osmType: null };
  } catch (error) {
    console.error(`Geocoding stopped at ${address}: ${error instanceof Error ? error.message : error}`);
    save();
    process.exit(1);
  }
  requested++;
  completed++;
  if (requested % 10 === 0 || completed === addresses.length) {
    const matched = Object.values(cache.entries).filter(entry => entry.coordinates).length;
    console.log(`${completed}/${addresses.length}; matched ${matched}`);
    save();
  }
  await wait(350);
}

const genericWords = new Set(["москва", "московская", "область", "город", "домодедово", "кашира", "ступино", "район", "улица", "проспект", "проезд", "переулок", "шоссе", "набережная", "бульвар", "россия", "корпус", "строение"]);
const fold = value => value.toLowerCase().replaceAll("ё", "е");
function addressTokens(address) {
  return (fold(address).replace(/д\.?\s*\d.*$/, "").match(/[а-яa-z-]{4,}/g) ?? []).filter(word => !genericWords.has(word));
}
function streetOnlyQuery(address) {
  let query = nominatimQuery(address).replace(/,\s*\d.*$/, "").replace(/,?\s+д\.?\s*\d.*$/i, "").trim();
  query = query.replace(/^Москва,\s*(.+)$/i, "$1, Москва").replace(/^Москва\s+(.+)$/i, "$1, Москва");
  query = query.replace(/^(улица|бульвар|набережная|переулок|проспект|проезд|шоссе)\s+([^,]+),\s*(.+)$/i, "$2 $1, $3");
  return query;
}

// Validate that the returned object actually names the requested street. False-positive
// house matches are replaced by a reliable street centroid and explicitly downgraded.
let validated = 0;
for (const address of addresses) {
  const entry = cache.entries[address];
  if (!entry?.coordinates || (entry.validated && entry.matchQuality !== "low_confidence")) continue;
  const tokens = addressTokens(address);
  const display = fold(entry.displayName ?? "");
  if (!tokens.length || tokens.some(token => display.includes(token))) {
    entry.validated = true;
    entry.matchQuality = entry.status === "precise" ? "house" : "street_or_object";
    continue;
  }
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", `${streetOnlyQuery(address)}, Россия`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "ru");
  const response = await fetch(url, { headers: { "user-agent": "FieldFlow-Hackathon/1.0 (geocoding validation)", "accept-language": "ru" } });
  if (!response.ok) throw new Error(`Validation HTTP ${response.status}`);
  const [match] = await response.json();
  if (match) {
    entry.coordinates = [Number(match.lon), Number(match.lat)];
    entry.displayName = match.display_name;
    entry.status = "approximate";
    entry.osmType = match.type ?? match.addresstype ?? "road";
    entry.matchQuality = "street_fallback";
  } else {
    entry.status = "approximate";
    entry.matchQuality = "low_confidence";
  }
  entry.validated = true;
  validated++;
  save();
  await wait(1100);
}
if (validated) console.log(`Validated and repaired ${validated} suspicious matches.`);

save();
const values = addresses.map(address => cache.entries[address]);
const precise = values.filter(entry => entry?.status === "precise").length;
const approximate = values.filter(entry => entry?.status === "approximate").length;
const missing = values.filter(entry => !entry?.coordinates).length;
const lowConfidence = values.filter(entry => entry?.matchQuality === "low_confidence").length;
console.log(JSON.stringify({ unique: addresses.length, precise, approximate, missing, lowConfidence }, null, 2));
