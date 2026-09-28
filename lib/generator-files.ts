import { ALL_SKILLS, EXTRA_SKILLS, SKILL_EQUIPMENT, SKILL_EQUIPMENT_POOLS, TZ_SKILLS, VEHICLES, type TzSkill, type Vehicle } from "./domain.ts";
import { applyAverageWindows, fallbackTravel, jobPriorityLevel, scaleEngineers, scaleJobs, type Engineer, type Job, type Region } from "./vrptw.ts";
import { issueDailyEquipment } from "./equipment-issue.ts";
import type { Coordinate } from "./map-providers.ts";
import catalog from "../generator/src/data/moscow-buildings.json" with { type: "json" };

export { ALL_SKILLS, EXTRA_SKILLS, SKILL_EQUIPMENT, SKILL_EQUIPMENT_POOLS, TZ_SKILLS, VEHICLES };
export type { TzSkill, Vehicle };

export const BUILDING_COUNT = catalog.buildings.length;

export type TzReplanEvent = {
  type: "отмена заявки" | "недоступность инженера" | "срочная заявка" | "новая заявка";
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
  extraSkillShare?: number; // % заявок с дополнительными навыками
  cancelEvents?: number;
  unavailableEvents?: number;
  urgentEvents?: number;
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

const JOB_TITLES_BY_SKILL: Record<string, string[]> = {
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
  "Монтаж СКС": [
    "Прокладка витой пары в офисе",
    "Сборка патч-панели этажа",
    "Обжим и маркировка портов СКС",
    "Тестирование линии категории 6",
  ],
  "Видеонаблюдение": [
    "Установка IP-камеры на фасаде",
    "Настройка видеорегистратора",
    "Замена камеры в подъезде",
    "Юстировка обзора камеры двора",
  ],
  "Электропитание": [
    "Замена ИБП в шкафу узла",
    "Ревизия щита питания этажа",
    "Подключение резервного питания",
    "Измерение нагрузки в шкафу",
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

function uniqueStrings(items: readonly string[]): string[] {
  return [...new Set(items)];
}

function kitForSkills(skills: readonly string[], level: string, rng: () => number): string[] {
  const tools: string[] = [];
  for (const skill of skills) {
    const pool = SKILL_EQUIPMENT_POOLS[skill] ?? [SKILL_EQUIPMENT[skill] ?? skill];
    if (level === "новичок") {
      tools.push(pool[0]!);
      if (pool[1] && rng() < 0.4) tools.push(pool[1]);
    } else if (level === "специалист") {
      tools.push(pool[0]!);
      if (pool[1]) tools.push(pool[1]);
      if (pool[2] && rng() < 0.55) tools.push(pool[2]);
    } else {
      tools.push(...pool);
    }
  }
  return uniqueStrings(tools);
}

function extraSkillsFor(level: string, index: number, rng: () => number): string[] {
  if (level === "новичок") return [];
  const first = EXTRA_SKILLS[index % EXTRA_SKILLS.length];
  if (level === "специалист") return rng() < 0.62 ? [first] : [];
  const second = EXTRA_SKILLS[(index + 1) % EXTRA_SKILLS.length];
  return rng() < 0.48 ? [first, second] : [first];
}

function toneForSkill(skill: string): string {
  if (skill === TZ_SKILLS[2] || skill === "Электропитание") return "amber";
  if (skill === TZ_SKILLS[1] || skill === "Монтаж СКС") return "blue";
  if (skill === "Видеонаблюдение") return "green";
  return "violet";
}

function workClassForSkill(skill: string): NonNullable<Job["workClass"]> {
  if (skill === TZ_SKILLS[2]) return "emergency";
  if (skill === TZ_SKILLS[1] || skill === "Монтаж СКС" || skill === "Видеонаблюдение") return "connection";
  return "repair";
}

function serviceRangeForSkill(skill: string): [number, number] {
  if (skill === TZ_SKILLS[2]) return [45, 90];
  if (skill === TZ_SKILLS[1]) return [35, 65];
  if (skill === "Электропитание") return [30, 70];
  if (skill === "Видеонаблюдение") return [35, 75];
  if (skill === "Монтаж СКС") return [30, 60];
  return [20, 40];
}

function titleForSkill(skill: string, index: number): string {
  const titles = JOB_TITLES_BY_SKILL[skill] ?? JOB_TITLES_BY_SKILL[TZ_SKILLS[0]]!;
  return titles[index % titles.length]!;
}

function localToolForSkill(rng: () => number, skill: string, region: Region, engineers: Engineer[]): string {
  const pool = SKILL_EQUIPMENT_POOLS[skill] ?? [SKILL_EQUIPMENT[skill] ?? skill];
  const capable = engineers.filter(engineer => engineer.region === region && engineer.skills.includes(skill));
  const held = uniqueStrings(capable.flatMap(engineer => engineer.equipment.filter(tool => pool.includes(tool))));
  return pick(rng, held.length ? held : [pool[0]!]);
}

/** Synthetic requests should ask for a tool that a local engineer actually received. */
function matchGeneratedJobsToIssuedKits(jobs: Job[], engineers: Engineer[]): void {
  for (const job of jobs) {
    const local = engineers.filter(engineer => engineer.region === job.region);
    const candidates = local.flatMap(engineer => engineer.skills
      .filter(skill => (SKILL_EQUIPMENT_POOLS[skill] ?? [SKILL_EQUIPMENT[skill] ?? skill]).includes(engineer.equipment[0] ?? ""))
      .map(skill => ({ engineer, skill })));
    candidates.sort((a, b) =>
      Number(b.skill === job.kind) - Number(a.skill === job.kind)
      || Number(b.engineer.equipment[0] === job.equipment) - Number(a.engineer.equipment[0] === job.equipment)
      || Number(!job.requiredTransport || b.engineer.transport === job.requiredTransport) - Number(!job.requiredTransport || a.engineer.transport === job.requiredTransport)
      || a.engineer.id.localeCompare(b.engineer.id));
    const chosen = candidates[0];
    if (!chosen) continue;
    if (chosen.skill !== job.kind) {
      job.kind = chosen.skill;
      job.workType = titleForSkill(chosen.skill, Number.parseInt(job.id, 10) || 0);
      job.tone = toneForSkill(chosen.skill);
      job.workClass = workClassForSkill(chosen.skill);
    }
    job.equipment = chosen.engineer.equipment[0]!;
    if (job.requiredTransport) job.requiredTransport = chosen.engineer.transport;
  }
}

function coverZoneSkills(engineers: Engineer[], skills: readonly string[]): void {
  const zones: Region[] = ["Восток", "Юго-восток", "Югоцентр"];
  for (const zone of zones) {
    const local = engineers.filter(engineer => engineer.region === zone);
    if (!local.length) continue;
    for (const skill of skills) {
      if (local.some(engineer => engineer.skills.includes(skill))) continue;
      const host = [...local].sort((a, b) => b.skills.length - a.skills.length || a.id.localeCompare(b.id))[0];
      if (!host) continue;
      host.skills = uniqueStrings([...host.skills, skill]);
      const pool = SKILL_EQUIPMENT_POOLS[skill] ?? [SKILL_EQUIPMENT[skill] ?? skill];
      const take = host.skills.length <= 1 ? 1 : Math.min(2, pool.length);
      host.equipment = uniqueStrings([...host.equipment, ...pool.slice(0, take)]);
    }
  }
}

function applyExtraSkillJobs(jobs: Job[], engineers: Engineer[], rng: () => number, share: number): void {
  const shareClamped = Math.max(0, Math.min(40, share));
  const candidates = jobs.filter(job => job.kind !== TZ_SKILLS[2]);
  const budget = Math.round(candidates.length * shareClamped / 100);
  if (budget <= 0) return;
  let converted = 0;
  for (const job of shuffleList(rng, candidates)) {
    if (converted >= budget) break;
    const extrasHeld = uniqueStrings(
      engineers.filter(engineer => engineer.region === job.region).flatMap(engineer => engineer.skills.filter(skill => EXTRA_SKILLS.includes(skill as typeof EXTRA_SKILLS[number]))),
    );
    if (!extrasHeld.length) continue;
    const skill = pick(rng, extrasHeld);
    const [lo, hi] = serviceRangeForSkill(skill);
    job.kind = skill;
    job.workType = titleForSkill(skill, converted + Number.parseInt(job.id, 10));
    job.tone = toneForSkill(skill);
    job.workClass = workClassForSkill(skill);
    job.equipment = localToolForSkill(rng, skill, job.region, engineers);
    job.serviceMinutes = intBetween(rng, lo, hi);
    job.normativeMinutes = job.serviceMinutes + (skill === "Электропитание" ? 15 : 0);
    if (job.requiredTransport) {
      const capable = engineers.filter(engineer =>
        engineer.region === job.region
        && engineer.skills.includes(skill)
        && engineer.equipment.includes(job.equipment)
      );
      job.requiredTransport = capable.length ? pick(rng, capable).transport : "";
    }
    converted += 1;
  }
}

function nextGeneratedJobId(jobs: Job[]): string {
  const nums = jobs.map(job => Number.parseInt(job.id, 10)).filter(Number.isFinite);
  const max = nums.length ? Math.max(...nums) : jobs.length;
  return String(max + 1).padStart(4, "0");
}

function spreadEventTimes(rng: () => number, count: number): string[] {
  const used = new Set<number>();
  const minutes: number[] = [];
  for (let i = 0; i < count; i++) {
    let value = 9 * 60 + intBetween(rng, 0, 7 * 60);
    value = Math.round(value / 5) * 5;
    let guard = 0;
    while (used.has(value) && guard < 48) {
      value = ((value + 15 - 9 * 60) % (8 * 60)) + 9 * 60;
      guard += 1;
    }
    used.add(value);
    minutes.push(value);
  }
  minutes.sort((a, b) => a - b);
  return minutes.map(minutesToHm);
}

type BuildingRef = { address: string; area?: string; lon: number; lat: number };

function makeUrgentEventJob(
  rng: () => number,
  jobs: Job[],
  engineers: Engineer[],
  buildings: BuildingRef[],
  index: number,
): Job {
  const building = buildings[(jobs.length + index * 11 + 7) % buildings.length] ?? buildings[0]!;
  const region = regionForPoint(building.lon, building.lat);
  const localSkills = uniqueStrings(engineers.filter(engineer => engineer.region === region).flatMap(engineer => engineer.skills));
  const skill = pick(rng, localSkills.length ? localSkills : [...ALL_SKILLS]);
  const [lo, hi] = serviceRangeForSkill(skill);
  const serviceMinutes = intBetween(rng, lo, hi);
  const span = Math.max(serviceMinutes + 40, intBetween(rng, 90, 150));
  const windowStart = intBetween(rng, 9 * 60, 16 * 60);
  const windowEnd = Math.min(22 * 60, windowStart + span);
  const capable = engineers.filter(engineer => engineer.region === region && engineer.skills.includes(skill));
  const requiredTransport = rng() < 0.45 && capable.some(engineer => engineer.transport === "Автомобиль")
    ? "Автомобиль"
    : "";
  return {
    id: nextGeneratedJobId(jobs),
    time: `${minutesToHm(windowStart)}–${minutesToHm(windowEnd)}`,
    windowStart,
    windowEnd,
    area: building.area || "Москва",
    address: building.address,
    kind: skill,
    workType: `Срочный выезд: ${titleForSkill(skill, index).toLocaleLowerCase("ru")}`,
    tone: toneForSkill(skill),
    region,
    engineerId: null,
    baselineEngineerId: null,
    coordinates: [building.lon, building.lat] as Coordinate,
    geocodeVerified: true,
    geocodeQuality: "house",
    risk: false,
    equipment: localToolForSkill(rng, skill, region, engineers),
    requiredTransport,
    priority: 2,
    serviceMinutes,
    normativeMinutes: serviceMinutes + 20,
    travelReserveMinutes: 20,
    estimatedTravelMinutes: 20,
    normSource: "экспертный норматив",
    urgency: "urgent",
    workClass: workClassForSkill(skill),
    source: "Событие перепланирования",
    status: "Новая",
    executionStatus: "not_started",
    cancelled: false,
  };
}

function clampEventCount(value: number | undefined, fallback: number, max: number): number {
  if (value == null || !Number.isFinite(value)) return Math.min(fallback, max);
  return Math.max(0, Math.min(max, Math.round(value)));
}

function placeUrgentWindow(job:Job,time:string) {
  const [hour,minute]=time.split(":").map(Number);
  const appearance=hour*60+minute;
  const span=job.windowEnd-job.windowStart;
  job.windowStart=Math.max(appearance,job.windowStart);
  job.windowEnd=Math.min(1320,job.windowStart+span);
  if (job.windowStart+job.serviceMinutes>job.windowEnd) throw new Error("Срочная работа не помещается до 22:00.");
  job.time=`${minutesToHm(job.windowStart)}–${minutesToHm(job.windowEnd)}`;
  return job;
}

export function createTzReplanEvent(options: {
  type: TzReplanEvent["type"];
  time: string;
  jobs: Job[];
  engineers: Engineer[];
  events?: TzReplanEvent[];
  buildings?: BuildingRef[];
  seed?: number;
  entityId?: string;
  job?: Job;
}): TzReplanEvent {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(options.time)) throw new Error("Некорректное время события.");
  const [hour,minute]=options.time.split(":").map(Number);
  const appearance=hour*60+minute;
  if (appearance<450 || appearance>1320) throw new Error("События доступны с 07:30 до 22:00.");
  const rng = createRng(options.seed ?? 17);
  const jobs = options.jobs;
  const engineers = options.engineers;
  const events = options.events ?? [];
  const buildings = options.buildings ?? catalog.buildings;
  if (options.type === "отмена заявки") {
    if (options.entityId) {
      const target=[...jobs, ...events.flatMap(event => event.job ? [event.job] : [])].find(job => job.id === options.entityId);
      if (!target) throw new Error("Выбранная заявка не найдена.");
      if (appearance >= target.windowEnd) throw new Error("Заявка к этому времени уже вышла из окна выполнения.");
      if (events.some(event => event.type === "отмена заявки" && event.entityId === options.entityId)) throw new Error("Для этой заявки уже создано событие отмены.");
      const appearanceEvent=events.find(event => event.job && event.entityId === options.entityId);
      if (appearanceEvent && appearanceEvent.time > options.time) throw new Error("Заявку нельзя отменить до её появления.");
      return { type: options.type, time: options.time, entityId: options.entityId };
    }
    const used = new Set(events.filter(event => event.type === "отмена заявки").map(event => event.entityId));
    const ordinary = jobs.filter(job => jobPriorityLevel(job) === 1 && !used.has(job.id));
    const pool = ordinary.length ? ordinary : jobs.filter(job => !used.has(job.id));
    const job = pool[Math.floor(pool.length / 2)] ?? jobs[0];
    return { type: "отмена заявки", time: options.time, entityId: job?.id ?? "0001" };
  }
  if (options.type === "недоступность инженера") {
    if (options.entityId) {
      if (!engineers.some(engineer => engineer.id === options.entityId)) throw new Error("Выбранный инженер не найден.");
      return { type: options.type, time: options.time, entityId: options.entityId };
    }
    const used = new Set(events.filter(event => event.type === "недоступность инженера").map(event => event.entityId));
    const pool = engineers.filter(engineer => !used.has(engineer.id));
    const engineer = pool[Math.floor(pool.length / 2)] ?? engineers[0];
    return { type: "недоступность инженера", time: options.time, entityId: engineer?.id ?? "E001" };
  }
  if (options.type === "срочная заявка" && options.entityId && !options.job) {
    const target=[...jobs,...events.flatMap(event=>event.job ? [event.job] : [])].find(job=>job.id===options.entityId);
    if (!target) throw new Error("Заявка для повышения приоритета не найдена.");
    if (target.cancelled || jobPriorityLevel(target)===2) throw new Error("Эта заявка уже срочная или отменена.");
    const appearanceEvent=events.find(event=>event.job?.id===target.id);
    if (appearanceEvent && appearanceEvent.time>options.time) throw new Error("Нельзя повысить приоритет заявки до её появления.");
    if (appearance>=target.windowEnd) throw new Error("Нельзя повысить приоритет заявки после конца её окна.");
    if (events.some(event=>event.type==="срочная заявка" && !event.job && event.entityId===target.id)) throw new Error("Эта заявка уже повышена до срочной другим событием.");
    return { type:options.type,time:options.time,entityId:target.id };
  }
  const existingUrgent = events.filter(event => event.job).map(event => event.job!);
  if (options.job) {
    if ([...jobs, ...existingUrgent].some(job => job.id === options.job!.id)) throw new Error("Номер новой заявки уже существует.");
    const job=options.job;
    if (!job.address.trim() || !job.kind || !job.equipment || !job.geocodeVerified || !job.coordinates.every(Number.isFinite)) throw new Error("Проверьте адрес, координаты, навык и оборудование новой заявки.");
    if (job.windowStart<450 || job.windowEnd>1320 || job.serviceMinutes<5 || !Number.isInteger(job.serviceMinutes) || !Number.isFinite(job.windowStart) || !Number.isFinite(job.windowEnd) || Math.max(appearance,job.windowStart)+job.serviceMinutes>job.windowEnd) throw new Error("Работы не помещаются в окно после появления заявки.");
    const urgent=options.type==="срочная заявка";
    return { type: options.type, time: options.time, entityId: options.job.id, job: { ...options.job, priority: urgent ? 2 : 1, urgency: urgent ? "urgent" : "normal", engineerId: null, baselineEngineerId: null, cancelled: false, executionStatus: "not_started" } };
  }
  if (options.type === "новая заявка") throw new Error("Заполните параметры новой заявки.");
  const job = placeUrgentWindow(makeUrgentEventJob(rng, [...jobs, ...existingUrgent], engineers, buildings, existingUrgent.length),options.time);
  matchGeneratedJobsToIssuedKits([job], engineers);
  return { type: "срочная заявка", time: options.time, entityId: job.id, job };
}

function buildReplanEvents(
  rng: () => number,
  jobs: Job[],
  engineers: Engineer[],
  buildings: BuildingRef[],
  options: { cancelEvents?: number; unavailableEvents?: number; urgentEvents?: number },
): TzReplanEvent[] {
  const cancelN = clampEventCount(options.cancelEvents, 1, jobs.length);
  const unavailableN = clampEventCount(options.unavailableEvents, 1, engineers.length);
  const urgentN = clampEventCount(options.urgentEvents, 1, 12);
  const times = spreadEventTimes(rng, cancelN + unavailableN + urgentN);
  const events: TzReplanEvent[] = [];
  let timeIndex = 0;

  const usedJobs = new Set<string>();
  const cancelPool = shuffleList(rng, jobs.filter(job => jobPriorityLevel(job) === 1));
  const fallbackJobs = [...cancelPool, ...shuffleList(rng, jobs.filter(job => jobPriorityLevel(job) !== 1))];
  for (let i = 0; i < cancelN; i++) {
    const time=times[timeIndex++] ?? "10:00";
    const eventMinute=Number(time.slice(0,2))*60+Number(time.slice(3));
    const remaining=fallbackJobs.filter(item => !usedJobs.has(item.id));
    const job = remaining.find(item => item.windowStart >= eventMinute)
      ?? remaining.find(item => item.windowEnd > eventMinute)
      ?? remaining[0];
    if (!job) break;
    usedJobs.add(job.id);
    events.push({ type: "отмена заявки", time, entityId: job.id });
  }

  const usedEngineers = new Set<string>();
  const engineerPool = shuffleList(rng, engineers);
  for (let i = 0; i < unavailableN; i++) {
    const engineer = engineerPool.find(item => !usedEngineers.has(item.id)) ?? engineerPool[i % engineerPool.length];
    if (!engineer) break;
    usedEngineers.add(engineer.id);
    events.push({ type: "недоступность инженера", time: times[timeIndex++] ?? "11:00", entityId: engineer.id });
  }

  const urgentJobs: Job[] = [];
  for (let i = 0; i < urgentN; i++) {
    const time=times[timeIndex++] ?? "12:00";
    const job = placeUrgentWindow(makeUrgentEventJob(rng, [...jobs, ...urgentJobs], engineers, buildings, i),time);
    urgentJobs.push(job);
    events.push({ type: "срочная заявка", time, entityId: job.id, job });
  }

  events.sort((a, b) => a.time.localeCompare(b.time));
  return events;
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
  const extraSkillShare = rawOptions.extraSkillShare ?? 18;
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

  const levels: Array<{ level: "новичок" | "специалист" | "профи"; skills: string[] }> = [];
  for (let i = 0; i < noviceN; i++) {
    levels.push({ level: "новичок", skills: [TZ_SKILLS[i % 3]] });
  }
  for (let i = 0; i < specN; i++) {
    levels.push({
      level: "специалист",
      skills: uniqueStrings([...SPEC_PAIRS[i % 3], ...extraSkillsFor("специалист", i, rng)]),
    });
  }
  for (let i = 0; i < proN; i++) {
    levels.push({
      level: "профи",
      skills: uniqueStrings([...TZ_SKILLS, ...extraSkillsFor("профи", i, rng)]),
    });
  }

  const zoneOrder: Region[] = ["Восток", "Юго-восток", "Югоцентр"];
  const zoneShare = (zone: Region) => mixedJobPool.filter(building => regionForPoint(building.lon, building.lat) === zone).length / mixedJobPool.length;
  const minimumZoneCrew = engineerCount >= 9 ? 2 : engineerCount >= 3 ? 1 : 0;
  const eastCount = Math.max(minimumZoneCrew, Math.round(engineerCount * zoneShare("Восток")));
  const southeastCount = Math.max(minimumZoneCrew, Math.round(engineerCount * zoneShare("Юго-восток")));
  const zoneQuota: Record<Region, number> = {
    "Восток": Math.min(eastCount, engineerCount),
    "Юго-восток": Math.min(southeastCount, Math.max(0, engineerCount - eastCount)),
    "Югоцентр": Math.max(0, engineerCount - eastCount - southeastCount),
  };
  const assignedZones: Region[] = Array(engineerCount).fill("Югоцентр");
  const openIndices = levels.map((_, index) => index).sort((a, b) => levels[b].skills.length - levels[a].skills.length || a - b);
  const remainingQuota = { ...zoneQuota };
  for (const zone of zoneOrder) {
    if (!remainingQuota[zone]) continue;
    const index = openIndices.shift();
    if (index == null) break;
    assignedZones[index] = zone;
    remainingQuota[zone]--;
  }
  const remainingZones = zoneOrder.flatMap(zone => Array(remainingQuota[zone]).fill(zone) as Region[]);
  for (const [position, index] of openIndices.entries()) assignedZones[index] = remainingZones[position];
  const startsByZone = Object.fromEntries(zoneOrder.map(zone => [zone, shuffleList(createRng(seed ^ (zone.length * 7919)), resPool.filter(building => regionForPoint(building.lon, building.lat) === zone))])) as Record<Region, typeof resPool>;
  const usedStarts: Record<Region, number> = { "Восток": 0, "Юго-восток": 0, "Югоцентр": 0 };

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

    const assignedZone = assignedZones[i];
    const zoneStarts = startsByZone[assignedZone];
    const b = zoneStarts.length ? zoneStarts[usedStarts[assignedZone]++ % zoneStarts.length] : shuffledResEngineers[i % shuffledResEngineers.length];
    const shift = SHIFTS[i % SHIFTS.length];
    const vehicle = VEHICLES[i % VEHICLES.length];
    const equipment = kitForSkills(skills, level, rng);
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
      address: b.address,
      level,
    };
    return eng;
  });
  coverZoneSkills(engineers, ALL_SKILLS);

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

  const chooseJobs = (share: number, salt: number) => new Set(
    shuffleList(createRng(seed ^ salt), jobSkills.map((_, index) => index))
      .slice(0, Math.max(0, Math.min(jobCount, Math.round(jobCount * share / 100)))),
  );
  const urgentIndices = chooseJobs(urgentShare, 0x173a9);
  const transportIndices = chooseJobs(vehicleConstraintShare, 0x38b71);

  const draftedJobs = jobSkills.map((skill, i) => {
    const b = mixedJobPool[i % mixedJobPool.length];
    const urgent = urgentIndices.has(i);
    const region = regionForPoint(b.lon, b.lat);
    const title = titleForSkill(skill, i);
    const [lo, hi] = serviceRangeForSkill(skill);
    const serviceMinutes = intBetween(rng, lo, hi);

    // Окно: длительность варьируется вокруг targetWindow
    const spanVariation = intBetween(rng, -Math.floor(targetWindow * 0.35), Math.floor(targetWindow * 0.45));
    const span = Math.max(serviceMinutes + 25, targetWindow + spanVariation);
    const earliestStart = 8 * 60;
    const latestStart = Math.max(earliestStart, 19 * 60 - span);
    const windowStart = intBetween(rng, earliestStart, latestStart);
    const windowEnd = windowStart + span;

    const equipment = localToolForSkill(rng, skill, region, engineers);
    const constrainVehicle = transportIndices.has(i);
    let requiredTransport = "";
    if (constrainVehicle) {
      const capable = engineers.filter(eng => eng.region === region && eng.skills.includes(skill) && eng.equipment.includes(equipment));
      requiredTransport = capable.length ? pick(rng, capable).transport : pick(rng, [...VEHICLES]);
    }

    const jobItem: Job = {
      id: String(i + 1).padStart(4, "0"),
      time: `${minutesToHm(windowStart)}–${minutesToHm(windowEnd)}`,
      windowStart,
      windowEnd,
      area: b.area || "Москва",
      address: b.address,
      kind: skill,
      workType: title,
      tone: toneForSkill(skill),
      region,
      engineerId: null,
      baselineEngineerId: null,
      coordinates: [b.lon, b.lat] as Coordinate,
      geocodeVerified: true,
      geocodeQuality: "house",
      risk: false,
      equipment,
      requiredTransport,
      priority: urgent ? 2 : 1,
      serviceMinutes,
      normativeMinutes: serviceMinutes + (skill === TZ_SKILLS[2] ? 20 : 0),
      travelReserveMinutes: skill === TZ_SKILLS[2] ? 20 : 0,
      estimatedTravelMinutes: 15,
      normSource: "демонстрационное допущение",
      urgency: urgent ? "urgent" : "normal",
      workClass: workClassForSkill(skill),
      source: "Генератор",
      status: "Новая",
      executionStatus: "not_started",
      cancelled: false,
    };
    return jobItem;
  });
  applyExtraSkillJobs(draftedJobs, engineers, rng, extraSkillShare);
  const jobs: Job[] = applyAverageWindows(draftedJobs, targetWindow);

  // Keep synthetic job requirements stable: generation anchors its initial
  // kit coverage locally; the planner may then reissue kits across zones.
  const issuedEngineers = issueDailyEquipment(engineers, jobs, fallbackTravel(speedKmh), speedKmh, true);
  matchGeneratedJobsToIssuedKits(jobs, issuedEngineers);

  const events = buildReplanEvents(rng, jobs, issuedEngineers, mixedJobPool, {
    cancelEvents: rawOptions.cancelEvents,
    unavailableEvents: rawOptions.unavailableEvents,
    urgentEvents: rawOptions.urgentEvents,
  });
  matchGeneratedJobsToIssuedKits(events.flatMap(event => event.job ? [event.job] : []), issuedEngineers);

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
    engineers: issuedEngineers,
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
      urgentJobsCount: jobs.filter(j => jobPriorityLevel(j) === 2).length,
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
    "Доступное оборудование",
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
    (e.equipmentOptions ?? e.equipment).join("|"),
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
    jobPriorityLevel(j) === 2 ? "Срочная" : "Обычная",
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
      j ? (jobPriorityLevel(j) === 2 ? "Срочная" : "Обычная") : "",
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
      ...((ev.type === "срочная заявка" || ev.type === "новая заявка") && ev.job ? { job: ev.job } : {}),
      ...(ev.type === "срочная заявка" && !ev.job ? { jobId: ev.entityId } : {}),
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
  return { jobs, engineers: issueDailyEquipment(scaleEngineers(sourceEngineers, options.engineers, jobs), jobs), speedKmh: options.speedKmh };
}

const columns = ["recordType", "id", "region", "area", "address", "kind", "workType", "lon", "lat", "geocodeQuality", "windowStart", "windowEnd", "serviceMinutes", "normativeMinutes", "travelReserveMinutes", "estimatedTravelMinutes", "normSource", "equipment", "equipmentOptions", "requiredTransport", "allowedTransports", "priority", "urgency", "workClass", "status", "executionStatus", "cancelled", "name", "initials", "skills", "transport", "shiftStart", "shiftEnd", "startAddress", "startMode", "officeAddress", "equipmentIssue", "color", "speedKmh"] as const;

function legacyCsvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  const safe = /^[=+@\-\t\r]/.test(text) && !/^-?\d+(?:\.\d+)?$/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function generatedCsv(dataset: GeneratedDataset) {
  const jobs = dataset.jobs.map(job => ({ recordType: "job", id: job.id, region: job.region, area: job.area, address: job.address, kind: job.kind, workType: job.workType ?? job.kind, lon: job.coordinates[0], lat: job.coordinates[1], geocodeQuality: job.geocodeQuality, windowStart: job.windowStart, windowEnd: job.windowEnd, serviceMinutes: job.serviceMinutes, normativeMinutes: job.normativeMinutes, travelReserveMinutes: job.travelReserveMinutes, estimatedTravelMinutes: job.estimatedTravelMinutes, normSource: job.normSource, equipment: job.equipment, requiredTransport: job.requiredTransport, allowedTransports: job.allowedTransports?.join("|"), priority: job.priority, urgency: job.urgency, workClass: job.workClass, status: job.status, executionStatus: job.executionStatus ?? "not_started", cancelled: Boolean(job.cancelled), speedKmh: dataset.speedKmh }));
  const engineers = dataset.engineers.map(engineer => ({ recordType: "engineer", id: engineer.id, region: engineer.region, lon: engineer.start[0], lat: engineer.start[1], equipment: engineer.equipment.join("|"), equipmentOptions: (engineer.equipmentOptions ?? engineer.equipment).join("|"), name: engineer.name, initials: engineer.initials, skills: engineer.skills.join("|"), transport: engineer.transport, shiftStart: engineer.shiftStart, shiftEnd: engineer.shiftEnd, startAddress: engineer.startAddress, startMode: engineer.startMode, officeAddress: engineer.officeAddress, equipmentIssue: engineer.equipmentIssue, color: engineer.color, speedKmh: engineer.speedKmh ?? "" }));
  return "\uFEFF" + columns.join(",") + "\r\n" + [...jobs, ...engineers].map(row => columns.map(column => legacyCsvCell((row as Record<string, unknown>)[column])).join(",")).join("\r\n") + "\r\n";
}

export function generatedJson(dataset: GeneratedDataset) {
  return JSON.stringify({ format: "fieldflow-dataset-v1", speedKmh: dataset.speedKmh, jobs: dataset.jobs, engineers: dataset.engineers }, null, 2);
}

export function downloadGeneratedDataset(dataset: GeneratedDataset, format: "csv" | "json") {
  const content = format === "csv" ? generatedCsv(dataset) : generatedJson(dataset);
  downloadBlob(`fieldflow-${dataset.jobs.length}-jobs-${dataset.engineers.length}-engineers.${format}`, content, format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8");
}
