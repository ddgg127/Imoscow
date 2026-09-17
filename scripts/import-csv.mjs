import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceDir = path.join(root, "data", "csv");
const geocodePath = path.join(root, "data", "geocoding-cache.json");
const geocode = fs.existsSync(geocodePath) ? JSON.parse(fs.readFileSync(geocodePath, "utf8")) : { provider: "Не выполнено", entries: {} };
const specs = [
  { region: "Восток", key: "east", center: [37.73, 55.73] },
  { region: "Юго-восток", key: "southeast", center: [37.72, 55.57] },
  { region: "Югоцентр", key: "southcenter", center: [37.61, 55.67] },
];
const colors = ["#7657ff", "#00a89d", "#ff8b3d", "#2d82d7", "#e84f87", "#8b5e34", "#7a9c32", "#d35f45", "#5367c9", "#a04fa4", "#168b67", "#b67b1f"];

function read(file) {
  const text = new TextDecoder("windows-1251").decode(fs.readFileSync(file));
  const rows = text.trim().split(/\r?\n/).map(line => line.split(";"));
  const headers = rows.shift().map(value => value.trim());
  const data = rows.filter(row => /^\d+$/.test(row[0]?.trim() ?? "")).map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]?.trim() ?? ""])));
  const office = rows.find(row => /^Адрес офиса$/i.test(row[0]?.trim() ?? ""))?.[1]?.trim() ?? "";
  return { data, office };
}

function normalizeAddress(value) {
  return value.replace(/^г\.Город Москва,?/i, "Москва,").replace(/^Город Москва,?/i, "Москва,").replace(/^г\.\s*Москва\s*,?/i, "Москва,").replace(/^МО,\s*/i, "Московская область, ").replace(/\s+/g, " ").replace(/,\s*,/g, ",").trim();
}

function hash(value) {
  let result = 2166136261;
  for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}

function fallbackCoordinate(center, seed) {
  const first = hash(`${seed}:lng`) / 0xffffffff - .5;
  const second = hash(`${seed}:lat`) / 0xffffffff - .5;
  return [Number((center[0] + first * .24).toFixed(5)), Number((center[1] + second * .16).toFixed(5))];
}

function geocoded(address, center, seed) {
  const entry = geocode.entries?.[normalizeAddress(address)];
  return {
    coordinates: entry?.coordinates ?? fallbackCoordinate(center, seed),
    geocodeStatus: entry?.status ?? "not_found",
    geocodeDisplayName: entry?.displayName ?? null,
  };
}

function minutes(value) {
  const match = value.match(/(\d{1,2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 540;
}

function engineerName(raw) {
  if (!raw) return "";
  const clean = raw.replace(/^Бригада\s+/i, "").trim();
  return clean.includes(" ") ? clean : `Инженер ${clean}`;
}
function initials(name) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase(); }

function skillCategory(kind) {
  if (/подключ|конвергенц|дозаказ|гигабит/i.test(kind)) return "Подключение";
  if (/TVE|ТВ\.|приставк/i.test(kind)) return "Телевидение";
  return "Диагностика и ремонт";
}

const jobs = [];
const engineerSeed = new Map();
for (const spec of specs) {
  const syntheticFile = read(path.join(sourceDir, `${spec.key}-synthetic.csv`));
  const control = read(path.join(sourceDir, `${spec.key}-control.csv`)).data;
  const officeGeo = geocoded(syntheticFile.office, spec.center, `${spec.region}:office`);
  syntheticFile.data.forEach((row, index) => {
    const assignment = control[index] ?? {};
    const name = engineerName(assignment["Бригада"] ?? "");
    const engineerId = name ? `${spec.key}-${hash(name).toString(36)}` : null;
    const kind = row["Тип заявки HD"] || row["Тип заявки BK"] || "Выездные работы";
    const equipment = /гигабит|gpon/i.test(`${kind} ${row["Гигабитное подключение"]}`) ? "GPON" : /авар|повреж|диагност/i.test(kind) ? "Рефлектометр" : "ONT";
    const start = minutes(row["Начало"]);
    const end = minutes(row["Окончание"]);
    const id = String(row["Заявка"]);
    const location = geocoded(row["Адрес"], spec.center, `${row["Район"]}:${row["Адрес"]}:${id}`);
    const job = {
      id,
      time: `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}–${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`,
      windowStart: start, windowEnd: end, area: row["Район"], address: row["Адрес"], kind,
      skillCategory: skillCategory(kind), tone: ["violet", "blue", "amber", "green"][hash(id) % 4], region: spec.region,
      engineerId: null, baselineEngineerId: null, ...location, risk: false, equipment, requiredTransport: "Автомобиль",
      priority: 1, serviceMinutes: 45, source: "CSV", status: assignment["Статус BK"] || "Не назначена",
    };
    jobs.push(job);
    if (engineerId) {
      const seed = engineerSeed.get(engineerId) ?? { id: engineerId, name, region: spec.region, jobs: [], office: officeGeo };
      seed.jobs.push(job);
      engineerSeed.set(engineerId, seed);
    }
  });
}

const engineers = [...engineerSeed.values()].map((seed, index) => ({
  id: seed.id, initials: initials(seed.name), name: seed.name, route: `Маршрут ${String(index + 1).padStart(2, "0")}`,
  jobs: seed.jobs.length, distance: "0 км", load: Math.min(100, Math.round(seed.jobs.length * 45 / 840 * 100)),
  color: colors[index % colors.length], region: seed.region, start: seed.office.coordinates,
  skills: [...new Set(seed.jobs.map(job => job.skillCategory))], equipment: ["ONT", "GPON", "Рефлектометр"],
  transport: "Автомобиль", shiftStart: 480, shiftEnd: 1320,
}));

const uniqueAddresses = [...new Set(jobs.map(job => normalizeAddress(job.address)))];
const uniqueEntries = uniqueAddresses.map(address => geocode.entries?.[address]);
const precise = uniqueEntries.filter(entry => entry?.status === "precise").length;
const approximate = uniqueEntries.filter(entry => entry?.status === "approximate").length;
const missing = uniqueEntries.filter(entry => !entry?.coordinates).length;
const lowConfidence = uniqueEntries.filter(entry => entry?.matchQuality === "low_confidence").length;
const jobPrecise = jobs.filter(job => job.geocodeStatus === "precise").length;
const jobApproximate = jobs.filter(job => job.geocodeStatus === "approximate").length;
const jobMissing = jobs.filter(job => job.geocodeStatus === "not_found").length;
const qualityPercent = Math.round((jobPrecise + jobApproximate * .6) / jobs.length * 1000) / 10;
const metadata = {
  rows: jobs.length, regions: specs.map(item => item.region), generatedAt: new Date().toISOString(),
  assumptions: { serviceMinutes: 45, transport: "Автомобиль", shift: "08:00–22:00", speedKmh: 32 },
  geocoding: { provider: geocode.provider, unique: uniqueAddresses.length, precise, approximate, missing, lowConfidence, jobPrecise, jobApproximate, jobMissing, coveragePercent: Math.round((jobs.length - jobMissing) / jobs.length * 1000) / 10, qualityPercent, readyForMileageComparison: missing === 0 && lowConfidence === 0 },
};

const output = `/* Generated from data/csv by scripts/import-csv.mjs. */\nexport const csvJobs = ${JSON.stringify(jobs, null, 2)};\nexport const csvEngineers = ${JSON.stringify(engineers, null, 2)};\nexport const csvMeta = ${JSON.stringify(metadata, null, 2)};\n`;
fs.writeFileSync(path.join(root, "lib", "csv-data.generated.ts"), output, "utf8");
console.log(`Imported ${jobs.length} jobs and ${engineers.length} engineers from CSV. Geocoding: ${precise} precise, ${approximate} approximate, ${missing} missing unique addresses.`);
