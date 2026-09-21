import type { Coordinate } from "./map-providers";
import type { Engineer, Job, Region } from "./vrptw";

export type ImportedPlan = { jobs: Job[]; engineers?: Engineer[]; warnings: string[] };

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
  const parsed = Number(value(row, aliases).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function timeMinutes(raw: string, fallback: number) {
  const match = raw.match(/(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : fallback;
}

export function canonicalSkill(raw: string) {
  if (skills.includes(raw as typeof skills[number])) return raw;
  if (/авар|повреж|обрыв|нет\s*(?:линк|связ)|восстанов|недоступ/i.test(raw)) return skills[2];
  if (/подключ|монтаж|дозаказ|gpon|гигабит|конверг|миграц|замен/i.test(raw)) return skills[1];
  return skills[0];
}

function canonicalTransport(raw: string) {
  if (/пеш/i.test(raw)) return "Пешком";
  if (/вело/i.test(raw)) return "Велосипед";
  if (/обществен|метро|автобус/i.test(raw)) return "Общественный транспорт";
  if (/авто/i.test(raw)) return "Автомобиль";
  return transports.includes(raw) ? raw : "Автомобиль";
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
  if (skill === skills[2]) return 60;
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

function isPlannerEngineer(value: unknown): value is Engineer {
  if (!value || typeof value !== "object") return false;
  const item = value as Engineer;
  return typeof item.initials === "string" && Array.isArray(item.start) && typeof item.shiftStart === "number" && Array.isArray(item.skills);
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
    const id = value(row, ["id", "номер", "заявка", "номер заявки", "id заявки"]) || `IMPORT-${index + 1}`;
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
    const resolvedRegion = verified ? regionFromPoint(point, centers) : region;
    const transport = canonicalTransport(value(row, ["transport", "транспорт", "requiredtransport", "vehicle", "требуемый транспорт"]));
    const equipment = equipmentFor(value(row, ["equipment", "оборудование"]), kind);
    const priority = priorityFor(value(row, ["priority", "приоритет"]), kind);
    return {
      id, time: `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}–${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`,
      windowStart: start, windowEnd: end, area: value(row, ["area", "район"]) || resolvedRegion, address,
      kind, workType: rawWork, tone: ["violet", "blue", "amber", "green"][index % 4], region: resolvedRegion,
      engineerId: null, baselineEngineerId: null, coordinates: point, geocodeVerified: verified,
      geocodeQuality: verified ? "house" : "fallback", risk: false, equipment, requiredTransport: transport, allowedTransports: kind === skills[2] ? [...new Set([transport, "Автомобиль"])] : transports, priority,
      serviceMinutes: serviceFor(value(row, ["serviceminutes", "service_minutes", "норматив", "длительность", "durationmin"]), kind),
      source, status: value(row, ["status", "статус"]) || "Новая", cancelled: /^(true|1|да)$/i.test(value(row, ["cancelled", "отменена"])),
    };
  });
  const duplicates = jobs.filter((job, index) => jobs.findIndex(candidate => candidate.id === job.id) !== index);
  if (duplicates.length) throw new Error(`Повторяются номера заявок: ${[...new Set(duplicates.map(job => job.id))].join(", ")}`);
  return { jobs, warnings };
}

function rowsToEngineers(rows: Record<string, unknown>[], centers: Record<Region, Coordinate>) {
  return rows.map((row, index): Engineer => {
    const id = value(row, ["id", "id инженера", "engineerid"]) || `ENG-${index + 1}`;
    const name = value(row, ["name", "имя"]) || `Инженер ${index + 1}`;
    const lon = numberValue(row, ["lon", "lng", "longitude", "долгота"]);
    const lat = numberValue(row, ["lat", "latitude", "широта"]);
    const start: Coordinate = lon != null && lat != null ? [lon, lat] : centers["Югоцентр"];
    const region = regionFromPoint(start, centers);
    const shiftStart = timeMinutes(value(row, ["shiftstart", "shift_start", "начало смены"]), 480);
    const shiftEnd = timeMinutes(value(row, ["shiftend", "shift_end", "конец смены"]), 1080);
    const mappedSkills = plannerSkills(value(row, ["skills", "навыки"]), value(row, ["level", "уровень"]));
    return {
      id, initials: initialsOf(name, id), name, route: region, jobs: 0, distance: "0", load: 0,
      color: engineerColors[index % engineerColors.length], region, start, skills: mappedSkills,
      equipment: [...new Set(mappedSkills.map(skill => equipmentFor("", skill)))],
      transport: canonicalTransport(value(row, ["transport", "транспорт", "vehicle"])),
      shiftStart, shiftEnd,
    };
  });
}

function normalizeEngineers(raw: unknown, centers: Record<Region, Coordinate>) {
  if (!Array.isArray(raw) || !raw.length) return undefined;
  if (raw.every(isPlannerEngineer)) return raw;
  return rowsToEngineers(raw as Record<string, unknown>[], centers);
}

export async function importPlanFile(file: File, centers: Record<Region, Coordinate>): Promise<ImportedPlan> {
  const buffer = await file.arrayBuffer();
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch { text = new TextDecoder("windows-1251").decode(buffer); }
  if (file.name.toLocaleLowerCase().endsWith(".json")) {
    const payload = JSON.parse(text) as unknown;
    const object: { jobs?: unknown[]; engineers?: unknown[] } = Array.isArray(payload) ? { jobs: payload } : payload as { jobs?: unknown[]; engineers?: unknown[] };
    if (!Array.isArray(object.jobs)) throw new Error("JSON должен содержать массив jobs или быть массивом заявок");
    const imported = rowsToJobs(object.jobs as Record<string, unknown>[], centers, "Генератор");
    return { ...imported, engineers: normalizeEngineers(object.engineers, centers) };
  }
  if (!/\.csv$/i.test(file.name)) throw new Error("Поддерживаются только CSV и JSON");
  const parsed = parseCsv(text);
  if (looksLikeEngineerRows(parsed.headers, parsed.rows)) {
    return { jobs: [], engineers: rowsToEngineers(parsed.rows, centers), warnings: ["Загружен список инженеров без заявок. Добавьте CSV или JSON заявок."] };
  }
  return rowsToJobs(parsed.rows, centers);
}
