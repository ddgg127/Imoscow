import {
  DEFAULT_GENERATE_PARAMS,
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

const SKILL_EQUIPMENT: Record<string, string> = {
  "Локальные работы": "Диагностический комплект",
  "Работы на подключение и дозаказы": "ONT",
  "Аварийные работы": "Рефлектометр",
};

const SPEC_PAIRS: Array<[string, string]> = [
  [TZ_SKILLS[0], TZ_SKILLS[1]],
  [TZ_SKILLS[0], TZ_SKILLS[2]],
  [TZ_SKILLS[1], TZ_SKILLS[2]],
];

function skillsForEngineer(level: EngineerLevel, indexWithinLevel: number): string[] {
  if (level === "новичок") {
    return [TZ_SKILLS[indexWithinLevel % 3]];
  }
  if (level === "специалист") {
    return [...SPEC_PAIRS[indexWithinLevel % 3]];
  }
  return [...TZ_SKILLS];
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
    const skills = skillsForEngineer(level, indexWithinLevel);
    return {
      id: `E${String(i + 1).padStart(3, "0")}`,
      name: uniqueName(rng, usedNames),
      ...place,
      shiftStart: shift[0],
      shiftEnd: shift[1],
      skills,
      equipment: skills.map((s) => SKILL_EQUIPMENT[s]),
      vehicle: VEHICLES[i % VEHICLES.length],
      level,
    };
  });

  for (const job of jobs) {
    if (rng() * 100 < params.vehicleConstraintShare) {
      job.vehicle = vehicleForJob(rng, engineers, job.skills[0]);
    }
  }
  coverSkills(engineers, rng);

  return {
    meta: {
      seed: params.seed,
      generatedAt: new Date().toISOString(),
      params,
      catalog: { skills: TZ_SKILLS.length, tasks: CATALOG.tasks.length },
      notes: [
        "У заявки ровно один навык из справочника ТЗ: локальные работы, подключение и дозаказы, аварийные работы.",
        "У инженера 1, 2 или 3 навыка того же справочника: новичок, специалист, профи. Один тип транспорта.",
        "Требуемый транспорт у заявки заполнен только если ограничение задано.",
        "События перепланирования: отмена заявки, недоступность инженера, новая срочная заявка.",
        "Адреса — реальные здания OSM. Маршрут начинается в точке старта, возврат туда не требуется.",
      ],
    },
    jobs,
    engineers,
    events: buildEvents(rng, jobs, engineers, usedPlaces),
  };
}

function tzSkillOf(task: CatalogTask): (typeof TZ_SKILLS)[number] {
  const text = `${task.domain} ${task.title} ${task.skills.join(" ")}`.toLocaleLowerCase("ru");
  if (/авар|обрыв|повреж|восстанов/.test(text)) return TZ_SKILLS[2];
  if (/оптик|gpon|подключ|абонент|терминал|кросс|дозаказ/.test(text)) return TZ_SKILLS[1];
  return TZ_SKILLS[0];
}

function coverSkills(engineers: Engineer[], rng: Rng): void {
  for (const skill of TZ_SKILLS) {
    if (engineers.some((item) => item.skills.includes(skill))) continue;
    const host = engineers[intBetween(rng, 0, engineers.length - 1)];
    if (host.skills.length < 3) host.skills.push(skill);
    else host.skills[0] = skill;
  }
}

function buildEvents(rng: Rng, jobs: Job[], engineers: Engineer[], usedPlaces: Set<string>) {
  const ordinary = jobs.filter((item) => item.priority === "Обычная");
  const cancelled = pick(rng, ordinary.length ? ordinary : jobs);
  const missing = pick(rng, engineers);
  const skill = pick(rng, TZ_SKILLS);
  const place = takePlace(rng, usedPlaces, "workplace");
  const durationMin = intBetween(rng, 30, 60);
  const window = windowForDuration(rng, durationMin);
  const urgent: Job = {
    id: `U${String(jobs.length + 1).padStart(3, "0")}`,
    title: "Срочный выезд",
    ...place,
    durationMin,
    windowStart: window.start,
    windowEnd: window.end,
    priority: "Срочная",
    skills: [skill],
    skillCount: 1,
    equipment: SKILL_EQUIPMENT[skill],
    vehicle: rng() < 0.5 ? pick(rng, VEHICLES) : undefined,
  };
  return [
    { type: "отмена заявки" as const, time: "08:30", jobId: cancelled.id },
    { type: "недоступность инженера" as const, time: "08:40", engineerId: missing.id },
    { type: "срочная заявка" as const, time: "08:45", job: urgent },
  ];
}

export function datasetSummary(data: Dataset): string {
  const { jobs, engineers } = data;
  const engC = countBy(engineers.map((e) => e.level));
  return [
    `справочник навыков ТЗ: ${TZ_SKILLS.join("; ")}`,
    `инженеры ${engineers.length}: новички ${engC.новичок ?? 0}, специалисты ${engC.специалист ?? 0}, профи ${engC.профи ?? 0}`,
    `заявки ${jobs.length}: ${TZ_SKILLS.map((skill) => `${skill} ${jobs.filter((item) => item.skills[0] === skill).length}`).join(", ")}`,
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
