import fs from "node:fs";
import path from "node:path";
import { geocodeMany } from "./geocode.mjs";

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
  const match = value.match(/(\d{2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 540;
}

function engineerName(raw) {
  if (!raw) return "";
  const clean = raw.replace(/^Бригада\s+/i, "").trim();
  return clean.includes(" ") ? clean : `Инженер ${clean}`;
}

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
}

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
const offices = {};
for (const table of tables) {
  offices[table.region] = {
    address: table.office,
    coordinates: geocoded.get(table.office) ?? table.center,
  };
}

const jobs = [];
const engineerSeed = new Map();
for (const table of tables) {
  const officeCoords = offices[table.region].coordinates;
  table.synthetic.forEach((row, index) => {
    const assignment = table.control[index] ?? {};
    const name = engineerName(assignment["Бригада"] ?? "");
    const engineerId = name ? `${table.key}-${hash(name).toString(36)}` : null;
    const kind = row["Тип заявки HD"] || row["Тип заявки BK"] || "Выездные работы";
    const equipment = /гигабит|gpon/i.test(`${kind} ${row["Гигабитное подключение"]}`) ? "GPON" : /авар|повреж|диагност/i.test(kind) ? "Рефлектометр" : "ONT";
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
      tone: ["violet", "blue", "amber", "green"][hash(id) % 4],
      region: table.region,
      engineerId,
      baselineEngineerId: engineerId,
      coordinates: geocoded.get(row["Адрес"]) ?? officeCoords,
      risk: false,
      equipment,
      requiredTransport: "Автомобиль",
      priority: 1,
      serviceMinutes: 45,
      source: "CSV",
      status: assignment["Статус BK"] || "Не назначена",
    };
    jobs.push(job);
    if (engineerId) {
      const seed = engineerSeed.get(engineerId) ?? { id: engineerId, name, region: table.region, jobs: [] };
      seed.jobs.push(job);
      engineerSeed.set(engineerId, seed);
    }
  });
}

const engineers = [...engineerSeed.values()].map((seed, index) => ({
  id: seed.id,
  initials: initials(seed.name),
  name: seed.name,
  route: `Маршрут ${String(index + 1).padStart(2, "0")}`,
  jobs: seed.jobs.length,
  distance: "0 км",
  load: Math.min(100, Math.round(seed.jobs.length * 45 / 720 * 100)),
  color: colors[index % colors.length],
  region: seed.region,
  start: offices[seed.region].coordinates,
  skills: [...new Set(seed.jobs.map(job => job.kind))],
  equipment: [...new Set(["ONT", "GPON", "Рефлектометр", ...seed.jobs.map(job => job.equipment)])],
  transport: "Автомобиль",
  shiftStart: 480,
  shiftEnd: 1320,
}));

const output = `/* Generated from data/csv by scripts/import-csv.mjs. Coordinates come from Nominatim house-level geocoding. */\nexport const csvJobs = ${JSON.stringify(jobs, null, 2)};\nexport const csvEngineers = ${JSON.stringify(engineers, null, 2)};\nexport const csvMeta = ${JSON.stringify({ rows: jobs.length, regions: specs.map(item => item.region), generatedAt: new Date().toISOString().slice(0, 10), geocoded: true, offices }, null, 2)};\n`;
fs.writeFileSync(path.join(root, "lib", "csv-data.generated.ts"), output, "utf8");
console.log(`Imported ${jobs.length} jobs and ${engineers.length} engineers from CSV.`);
