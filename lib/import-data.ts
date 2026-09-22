import type { Coordinate } from "./map-providers";
import type { Engineer, Job, Region } from "./vrptw";

export type ImportedPlan = { jobs: Job[]; engineers?: Engineer[]; speedKmh?: number; warnings: string[] };

const regions: Region[] = ["Восток", "Юго-восток", "Югоцентр"];
const skills = ["Локальные работы", "Подключение и модернизация", "Аварийно-восстановительные работы"] as const;
const transports = ["Автомобиль", "Общественный транспорт", "Велосипед", "Пешком"];

function value(row: Record<string, unknown>, aliases: string[]) {
  const entry = Object.entries(row).find(([key]) => aliases.some(alias => key.trim().toLocaleLowerCase("ru") === alias.toLocaleLowerCase("ru")));
  return entry?.[1] == null ? "" : String(entry[1]).trim();
}

function numberValue(row: Record<string, unknown>, aliases: string[]) {
  const parsed = Number(value(row, aliases).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function timeMinutes(raw: string, fallback: number) {
  if (/^\d+$/.test(raw) && Number(raw) >= 0 && Number(raw) <= 1440) return Number(raw);
  const match = raw.match(/(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : fallback;
}

export function canonicalSkill(raw: string) {
  if (skills.includes(raw as typeof skills[number])) return raw;
  if (/авар|повреж|обрыв|нет\s*(?:линк|связ)|восстанов|недоступ/i.test(raw)) return skills[2];
  if (/подключ|монтаж|дозаказ|gpon|гигабит|конверг|миграц|замен/i.test(raw)) return skills[1];
  return skills[0];
}

function equipmentFor(raw: string, skill: string) {
  if (raw) return raw;
  if (skill === skills[2]) return "Рефлектометр";
  if (skill === skills[1]) return "ONT";
  return "Диагностический комплект";
}

function serviceFor(raw: string, skill: string) {
  const explicit = Number(raw);
  if (Number.isFinite(explicit) && explicit >= 5 && explicit <= 480) return Math.round(explicit);
  if (skill === skills[2]) return 60;
  if (skill === skills[1]) return 45;
  return 30;
}

function normalizeRegion(raw: string, address: string): Region {
  const exact = regions.find(region => region.toLocaleLowerCase("ru") === raw.toLocaleLowerCase("ru"));
  if (exact) return exact;
  if (/домодедово|кашира|ступино/i.test(address)) return "Юго-восток";
  return "Югоцентр";
}

function parseCsv(text: string) {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(cell.trim()); cell = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  const headers = rows.shift()?.map(header => header.replace(/^\uFEFF/, "").trim()) ?? [];
  return rows.map(cells => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

function rowsToJobs(rows: Record<string, unknown>[], centers: Record<Region, Coordinate>) {
  const warnings: string[] = [];
  const jobs = rows.map((row, index): Job => {
    const id = value(row, ["id", "номер", "заявка", "номер заявки"]) || `IMPORT-${index + 1}`;
    const address = value(row, ["address", "адрес"]);
    if (!address) throw new Error(`Строка ${index + 2}: отсутствует адрес`);
    const rawWork = value(row, ["worktype", "work_type", "тип работы", "тип заявки hd", "тип заявки bk", "kind", "навык"]) || "Локальные работы";
    const kind = canonicalSkill(rawWork);
    const start = timeMinutes(value(row, ["windowstart", "window_start", "начало", "окно с"]), 540);
    const end = timeMinutes(value(row, ["windowend", "window_end", "окончание", "окно до"]), Math.max(660, start + 120));
    if (end <= start) throw new Error(`Строка ${index + 2}: окончание окна должно быть позже начала`);
    const region = normalizeRegion(value(row, ["region", "регион", "зона"]), address);
    const embedded = Array.isArray(row.coordinates) ? row.coordinates.map(Number) : [];
    const lon = Number.isFinite(embedded[0]) ? embedded[0] : numberValue(row, ["lon", "lng", "longitude", "долгота"]);
    const lat = Number.isFinite(embedded[1]) ? embedded[1] : numberValue(row, ["lat", "latitude", "широта"]);
    const verified = lon != null && lat != null && lon >= 30 && lon <= 50 && lat >= 50 && lat <= 60;
    if (!verified) warnings.push(`№ ${id}: координаты будут геокодированы по адресу`);
    const transportRaw = value(row, ["transport", "транспорт", "requiredtransport"]);
    const transport = transports.includes(transportRaw) ? transportRaw : "Автомобиль";
    const allowedRaw = row.allowedTransports;
    const allowed = Array.isArray(allowedRaw) ? allowedRaw.map(String) : value(row, ["allowedTransports", "allowed_transports"]).split("|").filter(Boolean);
    const equipment = equipmentFor(value(row, ["equipment", "оборудование"]), kind);
    const priority = Math.min(100, Math.max(1, Math.round(numberValue(row, ["priority", "приоритет"]) ?? (kind === skills[2] ? 5 : 2))));
    return {
      id, time: `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}–${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`,
      windowStart: start, windowEnd: end, area: value(row, ["area", "район"]) || region, address,
      kind, workType: rawWork, tone: ["violet", "blue", "amber", "green"][index % 4], region,
      engineerId: null, baselineEngineerId: null, coordinates: verified ? [lon!, lat!] : centers[region], geocodeVerified: verified,
      geocodeQuality: verified ? (value(row, ["geocodeQuality"]) === "street" ? "street" : "house") : "fallback", risk: false, equipment, requiredTransport: transport, allowedTransports: allowed.length ? allowed : kind === skills[2] ? [...new Set([transport, "Автомобиль"])] : transports, priority,
      serviceMinutes: serviceFor(value(row, ["serviceminutes", "service_minutes", "норматив", "длительность"]), kind),
      source: "Импорт", status: value(row, ["status", "статус"]) || "Новая", cancelled: /^(true|1|да)$/i.test(value(row, ["cancelled", "отменена"])),
    };
  });
  const duplicates = jobs.filter((job, index) => jobs.findIndex(candidate => candidate.id === job.id) !== index);
  if (duplicates.length) throw new Error(`Повторяются номера заявок: ${[...new Set(duplicates.map(job => job.id))].join(", ")}`);
  return { jobs, warnings };
}

function rowsToEngineers(rows: Record<string, unknown>[]): Engineer[] {
  const engineers = rows.map((row, index): Engineer => {
    const id = value(row, ["id"]);
    const name = value(row, ["name", "имя"]);
    const region = value(row, ["region", "регион"]) as Region;
    const embedded = Array.isArray(row.start) ? row.start.map(Number) : [];
    const lon = Number.isFinite(embedded[0]) ? embedded[0] : numberValue(row, ["lon", "lng", "longitude"]);
    const lat = Number.isFinite(embedded[1]) ? embedded[1] : numberValue(row, ["lat", "latitude"]);
    const skillsValue = Array.isArray(row.skills) ? row.skills.map(String) : value(row, ["skills", "навыки"]).split("|");
    const equipmentValue = Array.isArray(row.equipment) ? row.equipment.map(String) : value(row, ["equipment", "оборудование"]).split("|");
    const shiftStart = timeMinutes(value(row, ["shiftStart", "shift_start"]), -1);
    const shiftEnd = timeMinutes(value(row, ["shiftEnd", "shift_end"]), -1);
    if (!id || !name || !regions.includes(region) || lon == null || lat == null || lon < 30 || lon > 50 || lat < 50 || lat > 60 || !skillsValue.some(Boolean) || shiftStart < 0 || shiftEnd <= shiftStart) {
      throw new Error(`Инженер ${index + 1}: проверьте имя, регион, координаты, навыки и смену`);
    }
    return { id, name, initials: value(row, ["initials"]) || name.split(/\s+/).map(part => part[0]).slice(0, 2).join(""), route: value(row, ["route"]) || `Маршрут ${index + 1}`, jobs: 0, distance: "0 км", load: 0, color: value(row, ["color"]) || "#6848e2", region, start: [lon, lat], skills: skillsValue.filter(Boolean), equipment: equipmentValue.filter(Boolean), transport: value(row, ["transport", "транспорт"]) || "Автомобиль", shiftStart, shiftEnd };
  });
  if (new Set(engineers.map(item => item.id)).size !== engineers.length) throw new Error("Повторяются номера инженеров");
  return engineers;
}

export function importPlanText(text: string, name: string, centers: Record<Region, Coordinate>): ImportedPlan {
  if (name.toLocaleLowerCase().endsWith(".json")) {
    const payload = JSON.parse(text) as unknown;
    const object: { jobs?: unknown[]; engineers?: unknown[]; speedKmh?: number } = Array.isArray(payload) ? { jobs: payload } : payload as { jobs?: unknown[]; engineers?: unknown[]; speedKmh?: number };
    if (!Array.isArray(object.jobs) || !object.jobs.length) throw new Error("JSON должен содержать непустой массив jobs");
    const imported = rowsToJobs(object.jobs as Record<string, unknown>[], centers);
    return { ...imported, engineers: Array.isArray(object.engineers) ? rowsToEngineers(object.engineers as Record<string, unknown>[]) : undefined, speedKmh: Number.isFinite(object.speedKmh) ? object.speedKmh : undefined };
  }
  if (!/\.csv$/i.test(name)) throw new Error("Поддерживаются только CSV и JSON");
  const rows = parseCsv(text);
  const jobs = rows.filter(row => !value(row, ["recordType", "record_type"]) || value(row, ["recordType", "record_type"]) === "job");
  const engineers = rows.filter(row => value(row, ["recordType", "record_type"]) === "engineer");
  if (!jobs.length) throw new Error("В CSV нет заявок");
  const imported = rowsToJobs(jobs, centers);
  const speedKmh = numberValue(rows[0], ["speedKmh", "speed_kmh"]);
  return { ...imported, engineers: engineers.length ? rowsToEngineers(engineers) : undefined, speedKmh: speedKmh && speedKmh > 0 ? speedKmh : undefined };
}

export async function importPlanFile(file: File, centers: Record<Region, Coordinate>): Promise<ImportedPlan> {
  const buffer = await file.arrayBuffer();
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch { text = new TextDecoder("windows-1251").decode(buffer); }
  return importPlanText(text, file.name, centers);
}
