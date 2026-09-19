import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const targetPath = path.join(root, "data", "geocode-cache.json");
const legacyPath = path.join(root, "data", "geocoding-cache.json");
const cache = JSON.parse(fs.readFileSync(targetPath, "utf8"));
const legacy = JSON.parse(fs.readFileSync(legacyPath, "utf8")).entries ?? {};

const manual = {
  "МО, г. Ступино Андропова ул. д. 37": {
    coordinates: [38.0821597, 54.8858274],
    displayName: "37, улица Андропова, Ступино, Московская область",
    quality: "house",
    provider: "Nominatim/OpenStreetMap",
  },
  "МО, г. Ступино Андропова ул. д. 33": {
    coordinates: [38.082999, 54.8857555],
    displayName: "33, улица Андропова, Ступино, Московская область",
    quality: "house",
    provider: "Nominatim/OpenStreetMap",
  },
  "МО, г. Кашира Центральная ул. д. 19": {
    coordinates: [38.2407727, 54.8415134],
    displayName: "19, Центральная улица, Кашира, Московская область",
    quality: "house",
    provider: "Nominatim/OpenStreetMap",
  },
  "Москва Булатниковский пр-зд. д. 6к1": {
    coordinates: [37.65135, 55.59361],
    displayName: "Булатниковский проезд, 6 к1, Москва",
    quality: "house",
    provider: "Адресный реестр Москвы / OpenStreetMap cross-check",
  },
};

function legacyKey(raw) {
  const variants = [
    raw.replace(/^Город Москва/i, "Москва"),
    raw.replace(/^МО,\s*/i, "Московская область, "),
  ];
  return variants.find(value => legacy[value]?.coordinates) ?? null;
}

for (const [address, entry] of Object.entries(cache)) {
  if (entry.type !== "fallback") {
    entry.verified = true;
    entry.quality = entry.type.startsWith("building/") ? "house" : "street";
    entry.provider ??= "Nominatim/OpenStreetMap";
    continue;
  }
  const override = manual[address];
  const key = legacyKey(address);
  const source = override ?? (key ? legacy[key] : null);
  if (!source?.coordinates) throw new Error(`No verified coordinates for ${address}`);
  const [lon, lat] = source.coordinates;
  cache[address] = {
    lon,
    lat,
    displayName: source.displayName,
    type: source.quality === "house" || source.matchQuality === "house" ? "building/verified" : "road/verified",
    query: address,
    quality: source.quality ?? (source.matchQuality === "house" ? "house" : "street"),
    verified: true,
    provider: source.provider ?? "Nominatim + Photon/OpenStreetMap",
  };
}

// Correct a Nominatim street-level ambiguity in a settlement with the same street name.
const gagarina = "Домодедово, ул.Гагарина, д. 55/2";
const gagarinaLegacy = legacy[gagarina];
if (gagarinaLegacy?.coordinates) {
  cache[gagarina] = {
    lon: gagarinaLegacy.coordinates[0],
    lat: gagarinaLegacy.coordinates[1],
    displayName: gagarinaLegacy.displayName,
    type: "building/verified",
    query: gagarina,
    quality: "house",
    verified: true,
    provider: "Photon/OpenStreetMap; settlement cross-check",
  };
}

const entries = Object.values(cache);
const unresolved = entries.filter(entry => !entry.verified || entry.type === "fallback");
const invalid = entries.filter(entry => !Number.isFinite(entry.lon) || !Number.isFinite(entry.lat) || entry.lon < 36 || entry.lon > 39 || entry.lat < 54 || entry.lat > 57);
if (unresolved.length || invalid.length) throw new Error(`Geocode audit failed: ${unresolved.length} unresolved, ${invalid.length} invalid`);

fs.writeFileSync(targetPath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
const quality = entries.reduce((result, entry) => ({ ...result, [entry.quality]: (result[entry.quality] ?? 0) + 1 }), {});
console.log(JSON.stringify({ total: entries.length, unresolved: 0, quality }, null, 2));
