import fs from "node:fs";
import path from "node:path";
import { geocodeMany, loadGeocodeCache } from "./geocode.mjs";

const root = process.cwd();
const sourceDir = path.join(root, "data", "csv");
const specs = [
  { region: "Восток", key: "east", center: [37.78, 55.71] },
  { region: "Юго-восток", key: "southeast", center: [37.67, 55.59] },
  { region: "Югоцентр", key: "southcenter", center: [37.61, 55.65] },
];
const colors = ["#7657ff", "#00a89d", "#ff8b3d", "#2d82d7", "#e84f87", "#8b5e34", "#7a9c32", "#d35f45", "#5367c9", "#a04fa4", "#168b67", "#b67b1f"];

function readCp1251(file) {
  return new TextDecoder("windows-1251").decode(fs.readFileSync(file));
}

function parseJobs(file) {
  const rows = readCp1251(file).trim().split(/\r?\n/).map(line => line.split(";"));
  const headers = rows.shift().map(value => value.trim());
  return rows.filter(row => /^\d+$/.test(row[0]?.trim() ?? "")).map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]?.trim() ?? ""])));
}

function parseOffice(file) {
  const line = readCp1251(file).split(/\r?\n/).map(value => value.trim()).find(value => /адрес\s+офиса/i.test(value));
  return line?.split(";")[1]?.trim() ?? "";
}

function hash(value) {
  let result = 2166136261;
  for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}

function minutes(value) {
  const match = value.match(/(\d{1,2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 540;
}

const skillCatalog = ["Локальные работы", "Подключение и модернизация", "Аварийно-восстановительные работы"];

function canonicalSkill(workType) {
  if (/авар|повреж|обрыв|нет\s*(?:линк|связ)|восстанов|недоступ/i.test(workType)) return skillCatalog[2];
  if (/подключ|монтаж|дозаказ|gpon|гигабит|конверг|миграц|замен/i.test(workType)) return skillCatalog[1];
  return skillCatalog[0];
}

function serviceMinutes(workType, skill) {
  // Expert rule: 100 minutes for an incident include a provisional 20-minute trip.
  // The route replaces that reserve with its own road-travel estimate.
  if (skill === skillCatalog[2]) return 80;
  if (skill === skillCatalog[1]) return /gpon|гигабит|гбит|кабел|монтаж/i.test(workType) ? 60 : 45;
  return /информ|консультац|монитор|настрой|диагност/i.test(workType) ? 30 : 45;
}

function equipmentFor(workType, skill) {
  if (skill === skillCatalog[2]) return "Рефлектометр";
  if (/гигабит|gpon/i.test(workType)) return "Комплект GPON";
  if (skill === skillCatalog[1]) return "ONT";
  return "Диагностический комплект";
}

const transportCycle = ["Автомобиль", "Общественный транспорт", "Велосипед", "Пешком"];
const skillPatterns = [
  [skillCatalog[0], skillCatalog[1], skillCatalog[2]],
  [skillCatalog[0], skillCatalog[1]],
  [skillCatalog[0], skillCatalog[2]],
  [skillCatalog[1], skillCatalog[2]],
  [skillCatalog[0]], [skillCatalog[1]], [skillCatalog[2]],
];

const tables = specs.map(spec => ({
  ...spec,
  office: parseOffice(path.join(sourceDir, `${spec.key}-synthetic.csv`)),
  synthetic: parseJobs(path.join(sourceDir, `${spec.key}-synthetic.csv`)),
  control: parseJobs(path.join(sourceDir, `${spec.key}-control.csv`)),
}));

const uniqueAddresses = [];
const fallbacks = new Map();
for (const table of tables) {
  if (table.office && !fallbacks.has(table.office)) {
    uniqueAddresses.push(table.office);
    fallbacks.set(table.office, table.center);
  }
  for (const row of table.synthetic) {
    const address = row["Адрес"];
    if (address && !fallbacks.has(address)) {
      uniqueAddresses.push(address);
      fallbacks.set(address, table.center);
    }
  }
}

const geocoded = await geocodeMany(uniqueAddresses, fallbacks);
const geocodeCache = loadGeocodeCache();
const fallbackAddresses = uniqueAddresses.filter(address => !geocodeCache[address]?.verified || geocodeCache[address].type === "fallback");
const quality = uniqueAddresses.reduce((counts, address) => {
  const key = geocodeCache[address]?.quality ?? "fallback";
  counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}, {});
const geocoding = { uniqueAddresses: uniqueAddresses.length, fallbackAddresses: fallbackAddresses.length, resolvedAddresses: uniqueAddresses.length - fallbackAddresses.length, verifiedAddresses: uniqueAddresses.filter(address => geocodeCache[address]?.verified).length, quality };
const offices = {};
for (const table of tables) {
  offices[table.region] = {
    address: table.office,
    coordinates: geocoded.get(table.office) ?? table.center,
  };
}

const jobs = [];
for (const table of tables) {
  const officeCoords = offices[table.region].coordinates;
  table.synthetic.forEach(row => {
    const workType = row["Тип заявки HD"] || row["Тип заявки BK"] || "Выездные работы";
    const kind = canonicalSkill(workType);
    const equipment = equipmentFor(`${workType} ${row["Гигабитное подключение"]}`, kind);
    const start = minutes(row["Начало"]);
    const end = minutes(row["Окончание"]);
    const id = String(row["Заявка"]);
    const job = {
      id,
      time: `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}–${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`,
      windowStart: start,
      windowEnd: end,
      area: row["Район"],
      address: row["Адрес"],
      kind,
      workType,
      tone: ["violet", "blue", "amber", "green"][hash(id) % 4],
      region: table.region,
      engineerId: null,
      baselineEngineerId: null,
      coordinates: geocoded.get(row["Адрес"]) ?? officeCoords,
      geocodeVerified: geocodeCache[row["Адрес"]]?.verified === true,
      geocodeQuality: geocodeCache[row["Адрес"]]?.quality ?? "fallback",
      geocodeDisplayName: geocodeCache[row["Адрес"]]?.displayName ?? "",
      risk: false,
      equipment,
      requiredTransport: "",
      allowedTransports: undefined,
      priority: 1,
      serviceMinutes: serviceMinutes(`${workType} ${row["Гигабитное подключение"] ?? ""}`, kind),
      normativeMinutes: kind === skillCatalog[2] ? 100 : undefined,
      travelReserveMinutes: kind === skillCatalog[2] ? 20 : 0,
      estimatedTravelMinutes: kind === skillCatalog[2] ? 20 : 0,
      normSource: kind === skillCatalog[2] ? "экспертный норматив" : "демонстрационное допущение",
      urgency: "normal",
      workClass: kind === skillCatalog[2] ? "emergency" : kind === skillCatalog[1] ? "connection" : "repair",
      source: "CSV",
      status: "Новая",
    };
    jobs.push(job);
  });
}

// Control is an independent distribution. Only its number of distinct brigades
// per region sizes this synthetic pool; no row, name or historical assignment
// is joined to a synthetic request.
const engineers = tables.flatMap(table => {
  const count = new Set(table.control.map(row => row["Бригада"]).filter(Boolean)).size;
  // Explicit, reproducible demonstration assumption: three SE engineers start
  // from a verified address in a service city with their kit already issued.
  // These are NOT historical employee homes or control-file assignments.
  const localCities = ["Кашира", "Домодедово", "Ступино"];
  const localStarts = table.region === "Юго-восток" ? localCities.map(city =>
    table.synthetic.map(row => row["Адрес"]).filter(address => address.includes(city) && geocodeCache[address]?.verified).sort((a, b) => a.localeCompare(b, "ru"))[0]
  ) : [];
  return Array.from({ length: count }, (_, slot) => {
  const localAddress = table.region === "Юго-восток" && slot >= 7 && slot < 10 ? localStarts[slot - 7] : undefined;
  const startAddress = localAddress || table.office;
  return ({
  id: `${table.key}-demo-${String(slot + 1).padStart(2, "0")}`,
  initials: `${table.region[0]}${slot + 1}`,
  name: `Инженер ${table.region} ${String(slot + 1).padStart(2, "0")}`,
  route: `Маршрут ${String(slot + 1).padStart(2, "0")}`,
  jobs: 0,
  distance: "0 км",
  load: 0,
  color: colors[slot % colors.length],
  region: table.region,
  start: geocoded.get(startAddress) ?? offices[table.region].coordinates,
  startAddress,
  startMode: localAddress ? "local" : "office",
  officeAddress: table.office,
  equipmentIssue: localAddress ? "preissued" : "office_before_shift",
  skills: skillPatterns[slot % skillPatterns.length],
  equipment: skillPatterns[slot % skillPatterns.length].flatMap(skill => skill === skillCatalog[2] ? ["Рефлектометр"] : skill === skillCatalog[1] ? ["ONT", "Комплект GPON"] : ["Диагностический комплект"]),
  transport: transportCycle[slot % transportCycle.length],
  shiftStart: 480,
  shiftEnd: 1320,
  }); });
});
engineers.forEach((engineer, index) => { engineer.route = `Маршрут ${String(index + 1).padStart(2, "0")}`; });
for (const table of tables) {
  const local = engineers.filter(engineer => engineer.region === table.region && engineer.startMode === "local");
  const office = engineers.filter(engineer => engineer.region === table.region && engineer.startMode === "office");
  const counts = crew => crew.flatMap(engineer => [...new Set(engineer.equipment)]).reduce((stock, item) => {
    stock[item] = (stock[item] ?? 0) + 1;
    return stock;
  }, {});
  offices[table.region].officeEngineers = office.length;
  offices[table.region].localEngineers = local.length;
  offices[table.region].issuedEquipmentCounts = counts(office);
  offices[table.region].preissuedEquipmentCounts = counts(local);
}

const output = `/* Generated from data/csv by scripts/import-csv.mjs. Coordinates are cached geocodes or explicitly counted fallbacks. */\nexport const csvJobs = ${JSON.stringify(jobs, null, 2)};\nexport const csvEngineers = ${JSON.stringify(engineers, null, 2)};\nexport const csvMeta = ${JSON.stringify({ rows: jobs.length, regions: specs.map(item => item.region), generatedAt: new Date().toISOString().slice(0, 10), geocoding, offices }, null, 2)};\n`;
fs.writeFileSync(path.join(root, "lib", "csv-data.generated.ts"), output, "utf8");
console.log(`Imported ${jobs.length} jobs and ${engineers.length} engineers from CSV.`);
