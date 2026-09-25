import type { Coordinate } from "./map-providers";
import type { Engineer, Job, Region } from "./vrptw";

export type ImportedPlan = { jobs: Job[]; engineers?: Engineer[]; speedKmh?: number; warnings: string[] };

const regions: Region[] = ["Восток", "Юго-восток", "Югоцентр"];
const skills = ["Локальные работы", "Подключение и модернизация", "Аварийно-восстановительные работы"] as const;
const transports = ["Автомобиль", "Общественный транспорт", "Велосипед", "Пешком"];
const engineerColors = ["#6547e7", "#0f938b", "#e97931", "#4381d2", "#c44b8a", "#2f9e44", "#c9a227", "#db3f55"];

function normalizeKey(key: string) {
  return key.trim().toLocaleLowerCase("ru").replace(/,/g, "").replace(/\s+/g, " ");
}

function keyMatches(key: string, alias: string) {
  const k = normalizeKey(key);
  const a = alias.trim().toLocaleLowerCase("ru");
  return k === a || k.startsWith(`${a} `) || k.endsWith(` ${a}`);
}

function value(row: Record<string, unknown>, aliases: string[]) {
  const entry = Object.entries(row).find(([key]) => aliases.some(alias => keyMatches(key, alias)));
  if (entry?.[1] == null) return "";
  return Array.isArray(entry[1]) ? entry[1].map(item => String(item).trim()).filter(Boolean).join(", ") : String(entry[1]).trim();
}

function numberValue(row: Record<string, unknown>, aliases: string[]) {
  const raw = value(row, aliases);
  if (!raw) return null;
  const parsed = Number(raw.replace(",", "."));
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

function canonicalTransport(raw: string, fallback = "") {
  if (!raw.trim()) return fallback;
  if (/пеш/i.test(raw)) return "Пешком";
  if (/вело/i.test(raw)) return "Велосипед";
  if (/обществен|метро|автобус/i.test(raw)) return "Общественный транспорт";
  if (/авто/i.test(raw)) return "Автомобиль";
  return transports.includes(raw) ? raw : raw.trim();
}

function plannerSkills(raw: string, level = "") {
  const parts = raw.split(/[,;]/).map(part => part.trim()).filter(Boolean);
  const mapped = [...new Set(parts.map(canonicalSkill))];
  if (/профи/i.test(level) || parts.length >= 3) return [...skills];
  if (/специал/i.test(level) || parts.length === 2) return mapped.length >= 2 ? mapped : [skills[0], skills[1]];
  return mapped.length ? mapped : [skills[0]];
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
  if (skill === skills[2]) return 80;
  if (skill === skills[1]) return 45;
  return 30;
}

function priorityFor(raw: string, skill: string) {
  if (/срочн/i.test(raw)) return 10;
  const parsed = Number(raw.replace(",", "."));
  if (Number.isFinite(parsed)) return Math.min(100, Math.max(1, Math.round(parsed)));
  return skill === skills[2] ? 5 : 2;
}

function normalizeRegion(raw: string, address: string): Region {
  const exact = regions.find(region => region.toLocaleLowerCase("ru") === raw.toLocaleLowerCase("ru"));
  if (exact) return exact;
  if (/домодедово|кашира|ступино/i.test(address)) return "Юго-восток";
  return "Югоцентр";
}

function regionFromPoint(point: Coordinate, centers: Record<Region, Coordinate>): Region {
  return regions.reduce((best, region) => {
    const current = Math.hypot(point[0] - centers[region][0], point[1] - centers[region][1]);
    const known = Math.hypot(point[0] - centers[best][0], point[1] - centers[best][1]);
    return current < known ? region : best;
  });
}

function initialsOf(name: string, id: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  return (name.slice(0, 2) || id.slice(0, 2) || "ИН").toUpperCase();
}

function parseCsv(text: string) {
  const trimmed = text.replace(/^\uFEFF/, "").replace(/^sep=.+\r?\n/i, "");
  const first = trimmed.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let index = 0; index < trimmed.length; index++) {
    const char = trimmed[index];
    if (char === '"') {
      if (quoted && trimmed[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && trimmed[index + 1] === "\n") index++;
      row.push(cell.trim()); cell = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  const headers = rows.shift()?.map(header => header.replace(/^\uFEFF/, "").trim()) ?? [];
  return { headers, rows: rows.map(cells => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]))) };
}

function looksLikeEngineerRows(headers: string[], rows: Record<string, unknown>[]) {
  const joined = headers.map(normalizeKey).join(" ");
  if (/инженер|имя|смены|адрес старта/.test(joined)) return true;
  const sample = rows[0];
  return Boolean(sample && value(sample, ["имя", "name"]) && !value(sample, ["address", "адрес"]));
}

function rowsToJobs(rows: Record<string, unknown>[], centers: Record<Region, Coordinate>, source = "Импорт") {
  const warnings: string[] = [];
  const jobs = rows.map((row, index): Job => {
    const rawId = value(row, ["id", "номер", "заявка", "номер заявки", "id заявки"]);
    const id = /^\d+$/.test(rawId) ? rawId.padStart(4, "0") : rawId || String(index + 1).padStart(4, "0");
    const address = value(row, ["address", "адрес"]);
    if (!address) throw new Error(`Строка ${index + 2}: отсутствует адрес`);
    const rawWork = value(row, ["worktype", "work_type", "тип работы", "тип заявки hd", "тип заявки bk", "kind", "навык", "навыки", "название задачи", "title"]) || "Локальные работы";
    const kind = canonicalSkill(rawWork);
    const start = timeMinutes(value(row, ["windowstart", "window_start", "начало", "окно с", "начало окна"]), 540);
    const end = timeMinutes(value(row, ["windowend", "window_end", "окончание", "окно до", "конец окна"]), Math.max(660, start + 120));
    if (end <= start) throw new Error(`Строка ${index + 2}: окончание окна должно быть позже начала`);
    const region = normalizeRegion(value(row, ["region", "регион", "зона"]), address);
    const embedded = Array.isArray(row.coordinates) ? row.coordinates.map(Number) : [];
    const lon = Number.isFinite(embedded[0]) ? embedded[0] : numberValue(row, ["lon", "lng", "longitude", "долгота"]);
    const lat = Number.isFinite(embedded[1]) ? embedded[1] : numberValue(row, ["lat", "latitude", "широта"]);
    const verified = lon != null && lat != null && lon >= 30 && lon <= 50 && lat >= 50 && lat <= 60;
    if (!verified) warnings.push(`№ ${id}: координаты будут геокодированы по адресу`);
    const point: Coordinate = verified ? [lon!, lat!] : centers[region];
    const resolvedRegion = value(row, ["region", "регион", "зона"]) ? region : verified ? regionFromPoint(point, centers) : region;
    const transport = canonicalTransport(value(row, ["transport", "транспорт", "requiredtransport", "vehicle", "требуемый транспорт"]));
    const allowedRaw = row.allowedTransports;
    const allowed = (Array.isArray(allowedRaw) ? allowedRaw.map(String) : value(row, ["allowedTransports", "allowed_transports"]).split(/[|,]/)).map(item => canonicalTransport(item)).filter(Boolean);
    const equipment = equipmentFor(value(row, ["equipment", "оборудование"]), kind);
    const priority = priorityFor(value(row, ["priority", "приоритет"]), kind);
    const explicitService = value(row, ["serviceminutes", "service_minutes", "время работы", "длительность", "durationmin"]);
    const explicitNorm = numberValue(row, ["normativeMinutes", "normative_minutes", "норматив"]);
    const reserve = numberValue(row, ["travelReserveMinutes", "travel_reserve_minutes"]) ?? (kind === skills[2] ? 20 : 0);
    const serviceMinutes = explicitService ? serviceFor(explicitService, kind) : explicitNorm != null ? Math.max(5, Math.round(explicitNorm - reserve)) : serviceFor("", kind);
    const workClass = value(row, ["workClass", "work_class"]) || (kind === skills[2] ? "emergency" : kind === skills[1] ? "connection" : "repair");
    const urgency = /^(urgent|срочн)/i.test(value(row, ["urgency", "срочность", "приоритет срочности"])) ? "urgent" : "normal";
    return {
      id, time: `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}–${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`,
      windowStart: start, windowEnd: end, area: value(row, ["area", "район"]) || resolvedRegion, address,
      kind, workType: rawWork, tone: ["violet", "blue", "amber", "green"][index % 4], region: resolvedRegion,
      engineerId: null, baselineEngineerId: null, coordinates: point, geocodeVerified: verified,
      geocodeQuality: verified ? (value(row, ["geocodeQuality"]) === "street" ? "street" : "house") : "fallback", risk: false, equipment, requiredTransport: transport, allowedTransports: allowed.length ? allowed : undefined, priority,
      serviceMinutes, normativeMinutes: explicitNorm ?? (kind === skills[2] ? 100 : undefined), travelReserveMinutes: reserve,
      estimatedTravelMinutes: numberValue(row, ["estimatedTravelMinutes", "estimated_travel_minutes"]) ?? reserve,
      normSource: explicitService || explicitNorm != null ? "введено пользователем" : kind === skills[2] ? "экспертный норматив" : "демонстрационное допущение",
      urgency, workClass: ["emergency", "connection", "repair"].includes(workClass) ? workClass as Job["workClass"] : "repair",
      source, status: value(row, ["status", "статус"]) || "Новая", executionStatus: (["not_started", "in_progress", "completed"].includes(value(row, ["executionStatus", "execution_status", "выполнение"])) ? value(row, ["executionStatus", "execution_status", "выполнение"]) : "not_started") as Job["executionStatus"], cancelled: /^(true|1|да)$/i.test(value(row, ["cancelled", "отменена"])),
    };
  });
  const duplicates = jobs.filter((job, index) => jobs.findIndex(candidate => candidate.id === job.id) !== index);
  if (duplicates.length) throw new Error(`Повторяются номера заявок: ${[...new Set(duplicates.map(job => job.id))].join(", ")}`);
  return { jobs, warnings };
}

function rowsToEngineers(rows: Record<string, unknown>[], centers: Record<Region, Coordinate>): Engineer[] {
  const engineers = rows.map((row, index): Engineer => {
    const id = value(row, ["id", "id инженера", "engineerid"]) || `ENG-${index + 1}`;
    const name = value(row, ["name", "имя"]) || `Инженер ${index + 1}`;
    const embedded = Array.isArray(row.start) ? row.start.map(Number) : [];
    const lon = Number.isFinite(embedded[0]) ? embedded[0] : numberValue(row, ["lon", "lng", "longitude", "долгота"]);
    const lat = Number.isFinite(embedded[1]) ? embedded[1] : numberValue(row, ["lat", "latitude", "широта"]);
    const rawSkills = value(row, ["skills", "навыки"]);
    const skillsValue = Array.isArray(row.skills) ? row.skills.map(String) : rawSkills.includes("|") ? rawSkills.split("|") : plannerSkills(rawSkills, value(row, ["level", "уровень"]));
    const rawEquipment = value(row, ["equipment", "оборудование"]);
    const equipmentValue = Array.isArray(row.equipment) ? row.equipment.map(String) : rawEquipment ? rawEquipment.split("|") : [...new Set(skillsValue.map(skill => equipmentFor("", skill)))];
    const shiftStart = timeMinutes(value(row, ["shiftStart", "shift_start", "начало смены"]), 480);
    const shiftEnd = timeMinutes(value(row, ["shiftEnd", "shift_end", "конец смены"]), 1080);
    const point: Coordinate = [lon ?? 0, lat ?? 0];
    const explicitRegion = value(row, ["region", "регион"]);
    const region = regions.includes(explicitRegion as Region) ? explicitRegion as Region : regionFromPoint(point, centers);
    if (lon == null || lat == null || lon < 30 || lon > 50 || lat < 50 || lat > 60 || !skillsValue.some(Boolean) || shiftStart < 0 || shiftEnd <= shiftStart) {
      throw new Error(`Инженер ${index + 1}: проверьте имя, регион, координаты, навыки и смену`);
    }
    return { id, name, initials: value(row, ["initials"]) || initialsOf(name, id), route: value(row, ["route"]) || `Маршрут ${index + 1}`, jobs: 0, distance: "0 км", load: 0, color: value(row, ["color"]) || engineerColors[index % engineerColors.length], region, start: [lon, lat], skills: skillsValue.filter(Boolean), equipment: equipmentValue.filter(Boolean), transport: canonicalTransport(value(row, ["transport", "транспорт", "vehicle"]), "Автомобиль"), shiftStart, shiftEnd, speedKmh: numberValue(row, ["speedKmh", "speed_kmh", "скорость"]) ?? undefined };
  });
  if (new Set(engineers.map(item => item.id)).size !== engineers.length) throw new Error("Повторяются номера инженеров");
  return engineers;
}

export function importPlanText(text: string, name: string, centers: Record<Region, Coordinate>): ImportedPlan {
  if (name.toLocaleLowerCase().endsWith(".json")) {
    const payload = JSON.parse(text) as unknown;
    const object: { jobs?: unknown[]; engineers?: unknown[]; speedKmh?: number } = Array.isArray(payload) ? { jobs: payload } : payload as { jobs?: unknown[]; engineers?: unknown[]; speedKmh?: number };
    if (!Array.isArray(object.jobs)) throw new Error("JSON должен содержать массив jobs или быть массивом заявок");
    const imported = rowsToJobs(object.jobs as Record<string, unknown>[], centers, "Генератор");
    return { ...imported, engineers: Array.isArray(object.engineers) && object.engineers.length ? rowsToEngineers(object.engineers as Record<string, unknown>[], centers) : undefined, speedKmh: Number.isFinite(object.speedKmh) ? object.speedKmh : undefined };
  }
  if (!/\.csv$/i.test(name)) throw new Error("Поддерживаются только CSV и JSON");
  const { headers, rows } = parseCsv(text);
  if (looksLikeEngineerRows(headers, rows) && !headers.some(header => keyMatches(header, "recordType"))) {
    return { jobs: [], engineers: rowsToEngineers(rows, centers), warnings: ["Загружен список инженеров без заявок. Добавьте CSV или JSON заявок."] };
  }
  const jobs = rows.filter(row => !value(row, ["recordType", "record_type"]) || value(row, ["recordType", "record_type"]) === "job");
  const engineers = rows.filter(row => value(row, ["recordType", "record_type"]) === "engineer");
  if (!jobs.length) throw new Error("В CSV нет заявок");
  const imported = rowsToJobs(jobs, centers);
  const speedKmh = numberValue(rows[0], ["speedKmh", "speed_kmh"]);
  return { ...imported, engineers: engineers.length ? rowsToEngineers(engineers, centers) : undefined, speedKmh: speedKmh && speedKmh > 0 ? speedKmh : undefined };
}

export async function importPlanFile(file: File, centers: Record<Region, Coordinate>): Promise<ImportedPlan> {
  const buffer = await file.arrayBuffer();
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch { text = new TextDecoder("windows-1251").decode(buffer); }
  return importPlanText(text, file.name, centers);
}
