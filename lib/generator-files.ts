import { applyAverageWindows, scaleEngineers, scaleJobs, type Engineer, type Job, type Region } from "./vrptw.ts";
import type { Coordinate } from "./map-providers.ts";
import catalog from "../generator/src/data/moscow-buildings.json" with { type: "json" };

export const BUILDING_COUNT = catalog.buildings.length;

export const TZ_SKILLS = [
  "Локальные работы",
  "Работы на подключение и дозаказы",
  "Аварийные работы",
] as const;

export type TzSkill = (typeof TZ_SKILLS)[number];

export const SKILL_EQUIPMENT: Record<string, string> = {
  "Локальные работы": "Диагностический комплект",
  "Работы на подключение и дозаказы": "ONT",
  "Аварийные работы": "Рефлектометр",
};

export const VEHICLES = [
  "Автомобиль",
  "Пешеход",
  "Велосипед",
  "Общественный транспорт",
] as const;

export type Vehicle = (typeof VEHICLES)[number];

export type TzReplanEvent = {
  type: "отмена заявки" | "недоступность инженера" | "срочная заявка";
  time: string;
  entityId: string;
  job?: Job;
};

export type GeneratedTzDataset = {
  jobs: Job[];
  engineers: Engineer[];
  events: TzReplanEvent[];
  speedKmh: number;
  stats: {
    totalJobs: number;
    totalEngineers: number;
    jobsBySkill: Record<string, number>;
    jobsByEquipment: Record<string, number>;
    engineersByLevel: Record<string, number>;
    engineersByVehicle: Record<string, number>;
    engineersBySkill: Record<string, number>;
    urgentJobsCount: number;
    constrainedTransportJobsCount: number;
  };
};

export type GenerateTzOptions = {
  jobs: number;
  engineers: number;
  windowMinutes: number;
  speedKmh: number;
  jobEasy?: number; // % Локальные работы
  jobMedium?: number; // % Подключение и дозаказы
  jobHard?: number; // % Аварийные работы
  novice?: number; // % Новички (1 навык)
  specialist?: number; // % Специалисты (2 навыка)
  pro?: number; // % Профи (3 навыка)
  urgentShare?: number; // % срочных заявок
  vehicleConstraintShare?: number; // % с ограничением транспорта
  seed?: number;
};

const MALE_FIRST = [
  "Алексей", "Дмитрий", "Иван", "Сергей", "Андрей", "Никита", "Павел", "Роман",
  "Максим", "Артём", "Кирилл", "Егор", "Олег", "Виктор", "Игорь", "Антон",
  "Михаил", "Константин", "Владимир", "Евгений",
];
const FEMALE_FIRST = [
  "Мария", "Анна", "Елена", "Ольга", "Наталья", "Екатерина", "Дарья", "Юлия",
  "Светлана", "Татьяна",
];
const MALE_LAST = [
  "Соколов", "Мельников", "Паршин", "Волков", "Новиков", "Морозов", "Фёдоров",
  "Михайлов", "Алексеев", "Лебедев", "Семёнов", "Егоров", "Павлов", "Козлов",
  "Степанов", "Николаев", "Орлов", "Кузнецов", "Попов", "Васильев",
];
const FEMALE_LAST = [
  "Андреева", "Кузнецова", "Попова", "Васильева", "Петрова", "Соколова", "Новикова",
  "Орлова", "Волкова", "Морозова", "Лебедева", "Козлова",
];

const SHIFTS: Array<[number, number]> = [
  [8 * 60, 17 * 60],
  [8 * 60, 18 * 60],
  [8 * 60 + 30, 17 * 60 + 30],
  [9 * 60, 18 * 60],
  [9 * 60, 19 * 60],
  [7 * 60 + 30, 16 * 60 + 30],
  [10 * 60, 19 * 60],
];

const SPEC_PAIRS: Array<[TzSkill, TzSkill]> = [
  [TZ_SKILLS[0], TZ_SKILLS[1]],
  [TZ_SKILLS[0], TZ_SKILLS[2]],
  [TZ_SKILLS[1], TZ_SKILLS[2]],
];

const JOB_TITLES_BY_SKILL: Record<TzSkill, string[]> = {
  "Локальные работы": [
    "Диагностика абонентской линии",
    "Настройка пользовательского роутера",
    "Замена соединительного патч-корда",
    "Проверка параметров оптического сигнала",
    "Ревизия кабельного ввода в квартиру",
    "Настройка IPTV-приставки абонента",
    "Диагностика Ethernet-розетки",
    "Проверка скорости доступа и Wi-Fi покрытия",
  ],
  "Работы на подключение и дозаказы": [
    "Подключение нового абонента GPON",
    "Установка оптического терминала ONT",
    "Монтаж оптического дроп-кабеля",
    "Дозаказ услуг: подключение второй линии",
    "Сборка кросс-панели и переключение порта",
    "Установка гигабитного роутера с ONT",
    "Подключение цифровой телефонии и ТВ",
    "Модернизация линии до 1 Гбит/с",
  ],
  "Аварийные работы": [
    "Аварийный выезд: обрыв магистрального кабеля",
    "Восстановление связи в подъезде (обрыв стояка)",
    "Устранение высокого затухания на муфте",
    "Срочный ремонт распределительной коробки",
    "Замена повреждённого оптического шнура узла",
    "Восстановление оптического линка после повреждения",
    "Локализация обрыва рефлектометром и сварка",
  ],
};

function createRng(seed = 42) {
  let s = (seed ^ 0x12345678) >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function intBetween(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pick<T>(rng: () => number, list: T[]): T {
  return list[Math.floor(rng() * list.length)] ?? list[0];
}

function shuffleList<T>(rng: () => number, list: readonly T[]): T[] {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function minutesToHm(total: number): string {
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = String(Math.floor(wrapped / 60)).padStart(2, "0");
  const m = String(wrapped % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function regionForPoint(lon: number, lat: number): Region {
  if (lon >= 37.70) return "Восток";
  if (lat <= 55.65) return "Юго-восток";
  return "Югоцентр";
}

const SCALE_COLORS = ["#6547e7", "#0f938b", "#e97931", "#4381d2", "#c44b8a", "#2f9e44", "#c9a227", "#db3f55"];

export function generateTzDataset(rawOptions: Partial<GenerateTzOptions> = {}): GeneratedTzDataset {
  const jobCount = Math.max(1, rawOptions.jobs ?? 80);
  const engineerCount = Math.max(1, rawOptions.engineers ?? 24);
  const targetWindow = Math.max(60, rawOptions.windowMinutes ?? 180);
  const speedKmh = Math.max(10, rawOptions.speedKmh ?? 24);
  const urgentShare = rawOptions.urgentShare ?? 15;
  const vehicleConstraintShare = rawOptions.vehicleConstraintShare ?? 25;
  const seed = rawOptions.seed ?? 42;

  const rng = createRng(seed);
  const allBuildings = catalog.buildings;
  const residential = allBuildings.filter(b => b.kind === "residential");
  const workplace = allBuildings.filter(b => b.kind === "workplace");
  const resPool = residential.length > 0 ? residential : allBuildings;
  const workPool = workplace.length > 0 ? workplace : allBuildings;

  // Равномерно перемешиваем по сиду, чтобы адреса распределялись по всей Москве, а не кучковались в одном районе
  const shuffledResEngineers = shuffleList(rng, resPool);
  // Пул зданий для заявок: 75% реальные жилые дома москвичей (квартиры/интернет/ремонт) + 25% коммерческие объекты
  const mixedJobPool = shuffleList(rng, [
    ...resPool,
    ...resPool,
    ...resPool,
    ...workPool,
  ]);

  // 1. Инженеры: сбалансированное распределение навыков, оборудования и транспорта
  const noviceN = Math.max(0, Math.round(engineerCount * ((rawOptions.novice ?? 30) / 100)));
  let specN = Math.max(0, Math.round(engineerCount * ((rawOptions.specialist ?? 45) / 100)));
  if (noviceN + specN > engineerCount) specN = Math.max(0, engineerCount - noviceN);
  const proN = Math.max(0, engineerCount - noviceN - specN);

  const levels: Array<{ level: "новичок" | "специалист" | "профи"; skills: TzSkill[] }> = [];
  for (let i = 0; i < noviceN; i++) {
    levels.push({ level: "новичок", skills: [TZ_SKILLS[i % 3]] });
  }
  for (let i = 0; i < specN; i++) {
    levels.push({ level: "специалист", skills: [...SPEC_PAIRS[i % 3]] });
  }
  for (let i = 0; i < proN; i++) {
    levels.push({ level: "профи", skills: [...TZ_SKILLS] });
  }

  const usedNames = new Set<string>();
  const engineers: Engineer[] = levels.map(({ level, skills }, i) => {
    let name = "";
    for (let attempt = 0; attempt < 200; attempt++) {
      const female = rng() < 0.35;
      const candidate = female
        ? `${pick(rng, FEMALE_FIRST)} ${pick(rng, FEMALE_LAST)}`
        : `${pick(rng, MALE_FIRST)} ${pick(rng, MALE_LAST)}`;
      if (!usedNames.has(candidate)) {
        name = candidate;
        usedNames.add(candidate);
        break;
      }
    }
    if (!name) name = `Инженер ${i + 1}`;

    const b = shuffledResEngineers[i % shuffledResEngineers.length];
    const shift = SHIFTS[i % SHIFTS.length];
    const vehicle = VEHICLES[i % VEHICLES.length];
    const equipment = skills.map(s => SKILL_EQUIPMENT[s]);
    const region = regionForPoint(b.lon, b.lat);

    const eng: Engineer & { address: string; level: string } = {
      id: `E${String(i + 1).padStart(3, "0")}`,
      initials: name.split(" ").map(p => p[0]).join("").toUpperCase().slice(0, 2),
      name,
      route: `Маршрут ${String(i + 1).padStart(2, "0")}`,
      jobs: 0,
      distance: "0 км",
      load: 0,
      color: SCALE_COLORS[i % SCALE_COLORS.length],
      region,
      start: [b.lon, b.lat] as Coordinate,
      skills,
      equipment,
      transport: vehicle,
      shiftStart: shift[0],
      shiftEnd: shift[1],
      speedKmh,
      address: b.address,
      level,
    };
    return eng;
  });

  // 2. Заявки: равномерно чередуем навыки и распределяем по зданиям
  const easyPct = rawOptions.jobEasy ?? 40;
  const medPct = rawOptions.jobMedium ?? 35;
  const hardPct = rawOptions.jobHard ?? 25;
  const totalWeight = easyPct + medPct + hardPct || 100;

  const localN = Math.max(0, Math.round((easyPct / totalWeight) * jobCount));
  let connectN = Math.max(0, Math.round((medPct / totalWeight) * jobCount));
  if (localN + connectN > jobCount) connectN = Math.max(0, jobCount - localN);
  const emergencyN = Math.max(0, jobCount - localN - connectN);

  const jobSkills: TzSkill[] = [];
  let l = 0, c = 0, e = 0;
  while (l < localN || c < connectN || e < emergencyN) {
    if (l < localN) { jobSkills.push(TZ_SKILLS[0]); l++; }
    if (c < connectN) { jobSkills.push(TZ_SKILLS[1]); c++; }
    if (e < emergencyN) { jobSkills.push(TZ_SKILLS[2]); e++; }
  }

  const jobs: Job[] = jobSkills.map((skill, i) => {
    const b = mixedJobPool[i % mixedJobPool.length];
    const urgent = (rng() * 100) < urgentShare;
    const titles = JOB_TITLES_BY_SKILL[skill];
    const title = titles[i % titles.length];

    let serviceMinutes = 30;
    if (skill === "Локальные работы") serviceMinutes = intBetween(rng, 20, 40);
    else if (skill === "Работы на подключение и дозаказы") serviceMinutes = intBetween(rng, 35, 65);
    else serviceMinutes = intBetween(rng, 45, 90);

    // Окно: длительность варьируется вокруг targetWindow
    const spanVariation = intBetween(rng, -Math.floor(targetWindow * 0.35), Math.floor(targetWindow * 0.45));
    const span = Math.max(serviceMinutes + 25, targetWindow + spanVariation);
    const earliestStart = 8 * 60;
    const latestStart = Math.max(earliestStart, 19 * 60 - span);
    const windowStart = intBetween(rng, earliestStart, latestStart);
    const windowEnd = windowStart + span;

    const equipment = SKILL_EQUIPMENT[skill];
    const constrainVehicle = (rng() * 100) < vehicleConstraintShare;
    let requiredTransport = "";
    if (constrainVehicle) {
      const capable = engineers.filter(eng => eng.skills.includes(skill));
      requiredTransport = capable.length ? pick(rng, capable).transport : pick(rng, [...VEHICLES]);
    }

    const region = regionForPoint(b.lon, b.lat);
    const jobItem: Job = {
      id: String(i + 1).padStart(4, "0"),
      time: `${minutesToHm(windowStart)}–${minutesToHm(windowEnd)}`,
      windowStart,
      windowEnd,
      area: b.area || "Москва",
      address: b.address,
      kind: skill,
      workType: title,
      tone: skill === "Аварийные работы" ? "amber" : skill === "Работы на подключение и дозаказы" ? "blue" : "violet",
      region,
      engineerId: null,
      baselineEngineerId: null,
      coordinates: [b.lon, b.lat] as Coordinate,
      geocodeVerified: true,
      geocodeQuality: "house",
      risk: false,
      equipment,
      requiredTransport,
      priority: urgent ? 10 : 1,
      serviceMinutes,
      normativeMinutes: serviceMinutes + (skill === "Аварийные работы" ? 20 : 0),
      travelReserveMinutes: skill === "Аварийные работы" ? 20 : 0,
      estimatedTravelMinutes: 15,
      normSource: "демонстрационное допущение",
      urgency: urgent ? "urgent" : "normal",
      workClass: skill === "Аварийные работы" ? "emergency" : skill === "Работы на подключение и дозаказы" ? "connection" : "repair",
      source: "Генератор ТЗ",
      status: "Новая",
      executionStatus: "not_started",
      cancelled: false,
    };
    return jobItem;
  });

  // 3. События перепланирования (3 регламентированных ТЗ типа)
  const normalJobs = jobs.filter(j => j.priority < 10);
  const cancelJob = normalJobs[Math.floor(normalJobs.length / 2)] ?? jobs[0];
  const unavailableEngineer = engineers[Math.floor(engineers.length / 2)] ?? engineers[0];

  const urgentBuilding = mixedJobPool[(jobCount + 7) % mixedJobPool.length];
  const urgentSkill = TZ_SKILLS[2]; // Аварийные работы
  const urgentJob: Job = {
    id: String(jobs.length + 1).padStart(4, "0"),
    time: "10:30–12:30",
    windowStart: 10 * 60 + 30,
    windowEnd: 12 * 60 + 30,
    area: urgentBuilding.area || "Москва",
    address: urgentBuilding.address,
    kind: urgentSkill,
    workType: "Срочный выезд: аварийное повреждение кабеля",
    tone: "amber",
    region: regionForPoint(urgentBuilding.lon, urgentBuilding.lat),
    engineerId: null,
    baselineEngineerId: null,
    coordinates: [urgentBuilding.lon, urgentBuilding.lat] as Coordinate,
    geocodeVerified: true,
    geocodeQuality: "house",
    risk: false,
    equipment: SKILL_EQUIPMENT[urgentSkill],
    requiredTransport: "Автомобиль",
    priority: 10,
    serviceMinutes: 50,
    normativeMinutes: 70,
    travelReserveMinutes: 20,
    estimatedTravelMinutes: 20,
    normSource: "экспертный норматив",
    urgency: "urgent",
    workClass: "emergency",
    source: "Событие перепланирования",
    status: "Новая",
    executionStatus: "not_started",
    cancelled: false,
  };

  const events: TzReplanEvent[] = [
    { type: "отмена заявки", time: "08:30", entityId: cancelJob.id },
    { type: "недоступность инженера", time: "08:40", entityId: unavailableEngineer.id },
    { type: "срочная заявка", time: "08:45", entityId: urgentJob.id, job: urgentJob },
  ];

  // Сбор статистики для информативных карточек
  const jobsBySkill: Record<string, number> = {};
  const jobsByEquipment: Record<string, number> = {};
  for (const j of jobs) {
    jobsBySkill[j.kind] = (jobsBySkill[j.kind] ?? 0) + 1;
    jobsByEquipment[j.equipment] = (jobsByEquipment[j.equipment] ?? 0) + 1;
  }
  const engineersByLevel: Record<string, number> = {};
  const engineersByVehicle: Record<string, number> = {};
  const engineersBySkill: Record<string, number> = {};
  for (const e of engineers) {
    const lvl = (e as Engineer & { level?: string }).level ?? "специалист";
    engineersByLevel[lvl] = (engineersByLevel[lvl] ?? 0) + 1;
    engineersByVehicle[e.transport] = (engineersByVehicle[e.transport] ?? 0) + 1;
    for (const s of e.skills) {
      engineersBySkill[s] = (engineersBySkill[s] ?? 0) + 1;
    }
  }

  return {
    jobs,
    engineers,
    events,
    speedKmh,
    stats: {
      totalJobs: jobs.length,
      totalEngineers: engineers.length,
      jobsBySkill,
      jobsByEquipment,
      engineersByLevel,
      engineersByVehicle,
      engineersBySkill,
      urgentJobsCount: jobs.filter(j => j.priority >= 10).length,
      constrainedTransportJobsCount: jobs.filter(j => Boolean(j.requiredTransport)).length,
    },
  };
}

// -------------------------------------------------------------
// Экспорт трёх CSV таблиц строго по структуре ТЗ
// -------------------------------------------------------------

const SEP = ";";

function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/["\n\r;]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function csvFile(header: string[], rows: unknown[][]): string {
  const bom = "\uFEFF";
  const sepHeader = `sep=${SEP}\r\n`;
  const head = header.map(csvCell).join(SEP);
  const body = rows.map(row => row.map(csvCell).join(SEP)).join("\r\n");
  return `${bom}${sepHeader}${head}\r\n${body}\r\n`;
}

export function engineersToTzCsv(engineers: Engineer[]): string {
  const header = [
    "ID инженера",
    "Имя",
    "Адрес старта",
    "Широта",
    "Долгота",
    "Начало смены",
    "Конец смены",
    "Число навыков",
    "Навыки",
    "Оборудование",
    "Транспорт",
    "Уровень",
  ];
  const rows = engineers.map(e => [
    e.id,
    e.name,
    (e as Engineer & { address?: string }).address ?? `Старт ${e.name}`,
    e.start[1],
    e.start[0],
    minutesToHm(e.shiftStart),
    minutesToHm(e.shiftEnd),
    e.skills.length,
    e.skills.join(", "),
    e.equipment.join(", "),
    e.transport,
    (e as Engineer & { level?: string }).level ?? (e.skills.length === 1 ? "новичок" : e.skills.length === 2 ? "специалист" : "профи"),
  ]);
  return csvFile(header, rows);
}

export function jobsToTzCsv(jobs: Job[]): string {
  const header = [
    "ID заявки",
    "Название задачи",
    "Адрес",
    "Широта",
    "Долгота",
    "Длительность, мин",
    "Начало окна",
    "Конец окна",
    "Приоритет",
    "Требуемый навык",
    "Требуемое оборудование",
    "Требуемый транспорт",
  ];
  const rows = jobs.map(j => [
    j.id,
    j.workType ?? j.kind,
    j.address,
    j.coordinates[1],
    j.coordinates[0],
    j.serviceMinutes,
    minutesToHm(j.windowStart),
    minutesToHm(j.windowEnd),
    j.priority >= 10 ? "Срочная" : "Обычная",
    j.kind,
    j.equipment,
    j.requiredTransport ?? "",
  ]);
  return csvFile(header, rows);
}

export function eventsToTzCsv(events: TzReplanEvent[]): string {
  const header = [
    "Тип события",
    "Время события",
    "ID сущности",
    "Название задачи",
    "Адрес",
    "Широта",
    "Долгота",
    "Длительность, мин",
    "Начало окна",
    "Конец окна",
    "Приоритет",
    "Требуемый навык",
    "Требуемое оборудование",
    "Требуемый транспорт",
  ];
  const rows = events.map(ev => {
    const j = ev.job;
    return [
      ev.type,
      ev.time,
      ev.entityId,
      j ? (j.workType ?? j.kind) : "",
      j ? j.address : "",
      j ? j.coordinates[1] : "",
      j ? j.coordinates[0] : "",
      j ? j.serviceMinutes : "",
      j ? minutesToHm(j.windowStart) : "",
      j ? minutesToHm(j.windowEnd) : "",
      j ? (j.priority >= 10 ? "Срочная" : "Обычная") : "",
      j ? j.kind : "",
      j ? j.equipment : "",
      j ? (j.requiredTransport ?? "") : "",
    ];
  });
  return csvFile(header, rows);
}

export function downloadBlob(filename: string, content: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadAllTzCsvs(dataset: GeneratedTzDataset) {
  downloadBlob("engineers.csv", engineersToTzCsv(dataset.engineers));
  window.setTimeout(() => downloadBlob("jobs.csv", jobsToTzCsv(dataset.jobs)), 200);
  window.setTimeout(() => downloadBlob("replan_events.csv", eventsToTzCsv(dataset.events)), 400);
}

export function downloadTzJson(dataset: GeneratedTzDataset) {
  const jsonContent = JSON.stringify({
    format: "fieldflow-tz-dataset-v1",
    speedKmh: dataset.speedKmh,
    stats: dataset.stats,
    events: dataset.events.map(ev => ({
      type: ev.type,
      time: ev.time,
      ...(ev.type === "отмена заявки" ? { jobId: ev.entityId } : {}),
      ...(ev.type === "недоступность инженера" ? { engineerId: ev.entityId } : {}),
      ...(ev.type === "срочная заявка" && ev.job ? { job: ev.job } : {}),
    })),
    engineers: dataset.engineers,
    jobs: dataset.jobs,
  }, null, 2);
  downloadBlob(`dataset-${dataset.jobs.length}-jobs.json`, jsonContent, "application/json;charset=utf-8");
}

// -------------------------------------------------------------
// Обратная совместимость для тестов и старых вызовов
// -------------------------------------------------------------

export type GeneratedDataset = { jobs: Job[]; engineers: Engineer[]; speedKmh: number };

export function generateDataset(sourceJobs: Job[], sourceEngineers: Engineer[], options: { jobs: number; engineers: number; windowMinutes: number; speedKmh: number; highPriority?: boolean }): GeneratedDataset {
  const jobs = applyAverageWindows(scaleJobs(sourceJobs, options.jobs), options.windowMinutes).map((job, index) => {
    const elevated = Boolean(options.highPriority) && index % 7 === 2;
    return { ...job, engineerId: null, baselineEngineerId: null, status: job.cancelled ? "Отменена" : "Новая", executionStatus: "not_started" as const,
      urgency: elevated ? "urgent" as const : "normal" as const, priority: elevated ? 2 : 1 };
  });
  return { jobs, engineers: scaleEngineers(sourceEngineers, options.engineers, jobs), speedKmh: options.speedKmh };
}

const columns = ["recordType", "id", "region", "area", "address", "kind", "workType", "lon", "lat", "geocodeQuality", "windowStart", "windowEnd", "serviceMinutes", "normativeMinutes", "travelReserveMinutes", "estimatedTravelMinutes", "normSource", "equipment", "requiredTransport", "allowedTransports", "priority", "urgency", "workClass", "status", "executionStatus", "cancelled", "name", "initials", "skills", "transport", "shiftStart", "shiftEnd", "startAddress", "startMode", "officeAddress", "equipmentIssue", "color", "speedKmh"] as const;

function legacyCsvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  const safe = /^[=+@\-\t\r]/.test(text) && !/^-?\d+(?:\.\d+)?$/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function generatedCsv(dataset: GeneratedDataset) {
  const jobs = dataset.jobs.map(job => ({ recordType: "job", id: job.id, region: job.region, area: job.area, address: job.address, kind: job.kind, workType: job.workType ?? job.kind, lon: job.coordinates[0], lat: job.coordinates[1], geocodeQuality: job.geocodeQuality, windowStart: job.windowStart, windowEnd: job.windowEnd, serviceMinutes: job.serviceMinutes, normativeMinutes: job.normativeMinutes, travelReserveMinutes: job.travelReserveMinutes, estimatedTravelMinutes: job.estimatedTravelMinutes, normSource: job.normSource, equipment: job.equipment, requiredTransport: job.requiredTransport, allowedTransports: job.allowedTransports?.join("|"), priority: job.priority, urgency: job.urgency, workClass: job.workClass, status: job.status, executionStatus: job.executionStatus ?? "not_started", cancelled: Boolean(job.cancelled), speedKmh: dataset.speedKmh }));
  const engineers = dataset.engineers.map(engineer => ({ recordType: "engineer", id: engineer.id, region: engineer.region, lon: engineer.start[0], lat: engineer.start[1], equipment: engineer.equipment.join("|"), name: engineer.name, initials: engineer.initials, skills: engineer.skills.join("|"), transport: engineer.transport, shiftStart: engineer.shiftStart, shiftEnd: engineer.shiftEnd, startAddress: engineer.startAddress, startMode: engineer.startMode, officeAddress: engineer.officeAddress, equipmentIssue: engineer.equipmentIssue, color: engineer.color, speedKmh: engineer.speedKmh ?? "" }));
  return "\uFEFF" + columns.join(",") + "\r\n" + [...jobs, ...engineers].map(row => columns.map(column => legacyCsvCell((row as Record<string, unknown>)[column])).join(",")).join("\r\n") + "\r\n";
}

export function generatedJson(dataset: GeneratedDataset) {
  return JSON.stringify({ format: "fieldflow-dataset-v1", speedKmh: dataset.speedKmh, jobs: dataset.jobs, engineers: dataset.engineers }, null, 2);
}

export function downloadGeneratedDataset(dataset: GeneratedDataset, format: "csv" | "json") {
  const content = format === "csv" ? generatedCsv(dataset) : generatedJson(dataset);
  downloadBlob(`fieldflow-${dataset.jobs.length}-jobs-${dataset.engineers.length}-engineers.${format}`, content, format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8");
}
