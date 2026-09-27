import {
  ALL_SKILLS,
  DEFAULT_GENERATE_PARAMS,
  EXTRA_SKILLS,
  SKILL_EQUIPMENT,
  SKILL_EQUIPMENT_POOLS,
  type Dataset,
  type Engineer,
  type EngineerLevel,
  type GenerateParams,
  type Job,
  type Priority,
  TZ_SKILLS,
  VEHICLES,
  type Vehicle,
} from "../engine/types";
import type { Building, BuildingKind } from "./building-types";
import { CATALOG, type CatalogTask } from "./catalog";
import { MOSCOW_BUILDINGS } from "./moscow-addresses";
import { createRng, intBetween, pick, splitByShare, type Rng } from "./rng";

const MALE_FIRST = [
  "Алексей", "Дмитрий", "Иван", "Сергей", "Андрей", "Никита", "Павел", "Роман",
  "Максим", "Артём", "Кирилл", "Егор", "Олег", "Виктор", "Игорь", "Антон",
];
const FEMALE_FIRST = [
  "Мария", "Анна", "Елена", "Ольга", "Наталья", "Екатерина", "Дарья", "Юлия",
];
const MALE_LAST = [
  "Соколов", "Мельников", "Паршин", "Волков", "Новиков", "Морозов", "Фёдоров",
  "Михайлов", "Алексеев", "Лебедев", "Семёнов", "Егоров", "Павлов", "Козлов",
  "Степанов", "Николаев", "Орлов",
];
const FEMALE_LAST = [
  "Андреева", "Кузнецова", "Попова", "Васильева", "Петрова", "Соколова", "Новикова",
  "Орлова", "Волкова", "Морозова", "Лебедева", "Козлова",
];

const SHIFTS: Array<[string, string]> = [
  ["08:00", "17:00"],
  ["08:00", "18:00"],
  ["09:00", "18:00"],
  ["09:00", "19:00"],
  ["07:30", "16:30"],
  ["10:00", "19:00"],
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function minutesToHm(total: number): string {
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`;
}

function uniqueName(rng: Rng, used: Set<string>): string {
  for (let i = 0; i < 200; i++) {
    const female = rng() < 0.35;
    const name = female
      ? `${pick(rng, FEMALE_FIRST)} ${pick(rng, FEMALE_LAST)}`
      : `${pick(rng, MALE_FIRST)} ${pick(rng, MALE_LAST)}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const name = `${pick(rng, MALE_FIRST)} ${pick(rng, MALE_LAST)} ${intBetween(rng, 2, 99)}`;
  used.add(name);
  return name;
}

function windowForDuration(rng: Rng, durationMin: number): { start: string; end: string } {
  const span = Math.max(durationMin + 30, intBetween(rng, durationMin + 60, durationMin + 180));
  const earliest = 8 * 60;
  const latestStart = 19 * 60 - span;
  const start = intBetween(rng, earliest, Math.max(earliest, latestStart));
  return { start: minutesToHm(start), end: minutesToHm(start + span) };
}

function unusedBuildings(pool: Building[], used: Set<string>): Building[] {
  return pool.filter((b) => !used.has(b.address));
}

/**
 * Реальное здание: сначала нужный тип (жильё / рабочее), затем район без занятых точек.
 * Так заявки не склеиваются на одних вестибюлях, а инженеры стартуют из жилых домов.
 */
function takePlace(rng: Rng, used: Set<string>, prefer: BuildingKind) {
  if (MOSCOW_BUILDINGS.length === 0) {
    throw new Error("Справочник зданий пуст. Запустите npm run fetch-buildings");
  }
  const preferred = unusedBuildings(
    MOSCOW_BUILDINGS.filter((b) => b.kind === prefer),
    used,
  );
  const any = unusedBuildings(MOSCOW_BUILDINGS, used);
  const pool = preferred.length > 0 ? preferred : any.length > 0 ? any : MOSCOW_BUILDINGS;

  const usedAreas = new Set(
    MOSCOW_BUILDINGS.filter((b) => used.has(b.address)).map((b) => b.area),
  );
  const fresh = pool.filter((b) => !usedAreas.has(b.area));
  const spread = fresh.length > 0 ? fresh : pool;
  const areas = [...new Set(spread.map((b) => b.area))];
  const area = pick(rng, areas);
  const inArea = spread.filter((b) => b.area === area);
  const building = pick(rng, inArea);
  used.add(building.address);
  return { address: building.address, lat: building.lat, lon: building.lon };
}

function uniqueStrings(items: readonly string[]): string[] {
  return [...new Set(items)];
}

const SPEC_PAIRS: Array<[string, string]> = [
  [TZ_SKILLS[0], TZ_SKILLS[1]],
  [TZ_SKILLS[0], TZ_SKILLS[2]],
  [TZ_SKILLS[1], TZ_SKILLS[2]],
];

function kitForSkills(skills: readonly string[], level: EngineerLevel, rng: Rng): string[] {
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

function extraSkillsFor(level: EngineerLevel, index: number, rng: Rng): string[] {
  if (level === "новичок") return [];
  const first = EXTRA_SKILLS[index % EXTRA_SKILLS.length];
  if (level === "специалист") return rng() < 0.62 ? [first] : [];
  const second = EXTRA_SKILLS[(index + 1) % EXTRA_SKILLS.length];
  return rng() < 0.48 ? [first, second] : [first];
}

function skillsForEngineer(level: EngineerLevel, indexWithinLevel: number, rng: Rng): string[] {
  if (level === "новичок") return [TZ_SKILLS[indexWithinLevel % 3]];
  if (level === "специалист") return uniqueStrings([...SPEC_PAIRS[indexWithinLevel % 3], ...extraSkillsFor(level, indexWithinLevel, rng)]);
  return uniqueStrings([...TZ_SKILLS, ...extraSkillsFor(level, indexWithinLevel, rng)]);
}

function localTool(rng: Rng, skill: string, engineers: Engineer[]): string {
  const pool = SKILL_EQUIPMENT_POOLS[skill] ?? [SKILL_EQUIPMENT[skill] ?? skill];
  const capable = engineers.filter((engineer) => engineer.skills.includes(skill));
  const held = uniqueStrings(capable.flatMap((engineer) => (engineer.equipment ?? []).filter((tool) => pool.includes(tool))));
  return pick(rng, held.length ? held : [pool[0]!]);
}

function vehicleForJob(rng: Rng, engineers: Engineer[], skill: string): Vehicle {
  const capable = engineers.filter((e) => e.skills.includes(skill));
  if (capable.length > 0 && rng() < 0.75) return pick(rng, capable).vehicle;
  return pick(rng, VEHICLES);
}

export function generateDataset(raw: Partial<GenerateParams> = {}): Dataset {
  const params: GenerateParams = { ...DEFAULT_GENERATE_PARAMS, ...raw };
  const rng = createRng(params.seed);
  const usedPlaces = new Set<string>();
  const usedNames = new Set<string>();

  const [localN, connectN, emergencyN] = splitByShare(params.jobCount, [
    params.jobEasy,
    params.jobMedium,
    params.jobHard,
  ]);
  const jobSkills: Array<(typeof TZ_SKILLS)[number]> = [];
  let l = 0, c = 0, e = 0;
  while (l < localN || c < connectN || e < emergencyN) {
    if (l < localN) { jobSkills.push(TZ_SKILLS[0]); l++; }
    if (c < connectN) { jobSkills.push(TZ_SKILLS[1]); c++; }
    if (e < emergencyN) { jobSkills.push(TZ_SKILLS[2]); e++; }
  }

  const jobs: Job[] = jobSkills.map((skill, i) => {
    const same = CATALOG.tasks.filter((task) => tzSkillOf(task) === skill);
    const template = pick(rng, same.length ? same : CATALOG.tasks);
    const durationMin = intBetween(rng, template.durationMin[0], template.durationMin[1]);
    const window = windowForDuration(rng, durationMin);
    const place = takePlace(rng, usedPlaces, "workplace");
    const urgent = rng() * 100 < params.urgentShare;
    return {
      id: `J${String(i + 1).padStart(3, "0")}`,
      title: template.title,
      ...place,
      durationMin,
      windowStart: window.start,
      windowEnd: window.end,
      priority: (urgent ? "Срочная" : "Обычная") satisfies Priority,
      skills: [skill],
      skillCount: 1,
      equipment: SKILL_EQUIPMENT[skill],
    };
  });

  const [noviceN, specN, proN] = splitByShare(params.engineerCount, [
    params.novice,
    params.specialist,
    params.pro,
  ]);
  const levels: Array<{ level: EngineerLevel; indexWithinLevel: number }> = [
    ...Array.from({ length: noviceN }, (_, idx) => ({ level: "новичок" as const, indexWithinLevel: idx })),
    ...Array.from({ length: specN }, (_, idx) => ({ level: "специалист" as const, indexWithinLevel: idx })),
    ...Array.from({ length: proN }, (_, idx) => ({ level: "профи" as const, indexWithinLevel: idx })),
  ];

  const engineers: Engineer[] = levels.map(({ level, indexWithinLevel }, i) => {
    const place = takePlace(rng, usedPlaces, "residential");
    const shift = SHIFTS[i % SHIFTS.length];
    const skills = skillsForEngineer(level, indexWithinLevel, rng);
    return {
      id: `E${String(i + 1).padStart(3, "0")}`,
      name: uniqueName(rng, usedNames),
      ...place,
      shiftStart: shift[0],
      shiftEnd: shift[1],
      skills,
      equipment: kitForSkills(skills, level, rng),
      vehicle: VEHICLES[i % VEHICLES.length],
      level,
    };
  });
  coverSkills(engineers, rng);

  const extraTitles: Record<string, string[]> = {
    "Монтаж СКС": ["Прокладка витой пары в офисе", "Сборка патч-панели этажа", "Тестирование линии категории 6"],
    "Видеонаблюдение": ["Установка IP-камеры на фасаде", "Настройка видеорегистратора", "Замена камеры в подъезде"],
    "Электропитание": ["Замена ИБП в шкафу узла", "Ревизия щита питания этажа", "Подключение резервного питания"],
  };
  const extraBudget = Math.round(jobs.filter((job) => job.skills[0] !== TZ_SKILLS[2]).length * 0.18);
  let extraConverted = 0;
  for (const job of jobs) {
    if (extraConverted >= extraBudget) break;
    if (job.skills[0] === TZ_SKILLS[2]) continue;
    const extrasHeld = uniqueStrings(engineers.flatMap((engineer) => engineer.skills.filter((skill) => (EXTRA_SKILLS as readonly string[]).includes(skill))));
    if (!extrasHeld.length || rng() > 0.35) continue;
    const skill = pick(rng, extrasHeld);
    job.skills = [skill];
    job.title = pick(rng, extraTitles[skill] ?? [job.title]);
    extraConverted += 1;
  }

  for (const job of jobs) {
    job.equipment = localTool(rng, job.skills[0] ?? TZ_SKILLS[0], engineers);
    if (rng() * 100 < params.vehicleConstraintShare) {
      job.vehicle = vehicleForJob(rng, engineers, job.skills[0]);
    }
  }

  return {
    meta: {
      seed: params.seed,
      generatedAt: new Date().toISOString(),
      params,
      catalog: { skills: ALL_SKILLS.length, tasks: CATALOG.tasks.length },
      notes: [
        "У заявки один требуемый навык и конкретный инструмент из пула этого навыка.",
        "Инженеры получают набор инструментов по уровню: новичок узкий комплект, профи полный пул плюс смежные навыки.",
        "Требуемый транспорт у заявки заполнен только если ограничение задано.",
        "События перепланирования создаются генератором: отмена заявки, недоступность инженера, срочная заявка.",
        "Адреса — реальные здания OSM. Маршрут начинается в точке старта, возврат туда не требуется.",
      ],
    },
    jobs,
    engineers,
    events: buildEvents(rng, jobs, engineers, usedPlaces, params),
  };
}

function tzSkillOf(task: CatalogTask): (typeof TZ_SKILLS)[number] {
  const text = `${task.domain} ${task.title} ${task.skills.join(" ")}`.toLocaleLowerCase("ru");
  if (/авар|обрыв|повреж|восстанов/.test(text)) return TZ_SKILLS[2];
  if (/оптик|gpon|подключ|абонент|терминал|кросс|дозаказ/.test(text)) return TZ_SKILLS[1];
  return TZ_SKILLS[0];
}

function coverSkills(engineers: Engineer[], rng: Rng): void {
  for (const skill of ALL_SKILLS) {
    if (engineers.some((item) => item.skills.includes(skill))) continue;
    const host = [...engineers].sort((a, b) => b.skills.length - a.skills.length)[0] ?? engineers[intBetween(rng, 0, engineers.length - 1)];
    if (!host) continue;
    if (!host.skills.includes(skill)) host.skills.push(skill);
    const pool = SKILL_EQUIPMENT_POOLS[skill] ?? [SKILL_EQUIPMENT[skill] ?? skill];
    host.equipment = uniqueStrings([...(host.equipment ?? []), ...pool.slice(0, host.level === "новичок" ? 1 : 2)]);
  }
}

function spreadTimes(rng: Rng, count: number): string[] {
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

function buildEvents(rng: Rng, jobs: Job[], engineers: Engineer[], usedPlaces: Set<string>, params: GenerateParams) {
  const cancelN = Math.max(0, Math.min(jobs.length, Math.round(params.cancelEvents)));
  const unavailableN = Math.max(0, Math.min(engineers.length, Math.round(params.unavailableEvents)));
  const urgentN = Math.max(0, Math.min(12, Math.round(params.urgentEvents)));
  const times = spreadTimes(rng, cancelN + unavailableN + urgentN);
  const events: Dataset["events"] = [];
  let timeIndex = 0;

  const ordinary = jobs.filter((item) => item.priority === "Обычная");
  const cancelPool = ordinary.length ? ordinary : jobs;
  const usedJobs = new Set<string>();
  for (let i = 0; i < cancelN; i++) {
    const cancelled = cancelPool.find((item) => !usedJobs.has(item.id)) ?? cancelPool[i % cancelPool.length];
    if (!cancelled) break;
    usedJobs.add(cancelled.id);
    events.push({ type: "отмена заявки", time: times[timeIndex++] ?? "10:00", jobId: cancelled.id });
  }

  const usedEngineers = new Set<string>();
  for (let i = 0; i < unavailableN; i++) {
    const missing = engineers.find((item) => !usedEngineers.has(item.id)) ?? engineers[i % engineers.length];
    if (!missing) break;
    usedEngineers.add(missing.id);
    events.push({ type: "недоступность инженера", time: times[timeIndex++] ?? "11:00", engineerId: missing.id });
  }

  for (let i = 0; i < urgentN; i++) {
    const skill = pick(rng, [...ALL_SKILLS]);
    const place = takePlace(rng, usedPlaces, "workplace");
    const durationMin = intBetween(rng, 30, 60);
    const window = windowForDuration(rng, durationMin);
    const urgent: Job = {
      id: `U${String(jobs.length + i + 1).padStart(3, "0")}`,
      title: "Срочный выезд",
      ...place,
      durationMin,
      windowStart: window.start,
      windowEnd: window.end,
      priority: "Срочная",
      skills: [skill],
      skillCount: 1,
      equipment: localTool(rng, skill, engineers),
      vehicle: rng() < 0.5 ? pick(rng, VEHICLES) : undefined,
    };
    events.push({ type: "срочная заявка", time: times[timeIndex++] ?? "12:00", job: urgent });
  }

  events.sort((a, b) => a.time.localeCompare(b.time));
  return events;
}

export function datasetSummary(data: Dataset): string {
  const { jobs, engineers } = data;
  const engC = countBy(engineers.map((e) => e.level));
  return [
    `справочник навыков: ${ALL_SKILLS.join("; ")}`,
    `инженеры ${engineers.length}: новички ${engC.новичок ?? 0}, специалисты ${engC.специалист ?? 0}, профи ${engC.профи ?? 0}`,
    `заявки ${jobs.length}: ${[...new Set(jobs.map((item) => item.skills[0]))].map((skill) => `${skill} ${jobs.filter((item) => item.skills[0] === skill).length}`).join(", ")}`,
    `срочных ${jobs.filter((j) => j.priority === "Срочная").length}, с требованием ТС ${jobs.filter((j) => j.vehicle).length}`,
    `адреса OSM: заявка «${jobs[0]?.address ?? "—"}», старт «${engineers[0]?.address ?? "—"}»`,
    `seed ${data.meta.seed}`,
  ].join("\n");
}

function countBy(keys: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = (out[k] ?? 0) + 1;
  return out;
}
